import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// DNS-over-HTTPS via Cloudflare — works inside the Worker runtime (no Node `dns` module).
async function dnsLookup(name: string, type: "TXT" | "MX" | "NS" | "CNAME"): Promise<string[]> {
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
    });
    if (!r.ok) return [];
    const j = (await r.json()) as { Answer?: Array<{ data: string; type: number }> };
    return (j.Answer ?? []).map((a) => a.data.replace(/^"|"$/g, ""));
  } catch {
    return [];
  }
}

export const getEmailDomainSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { error: "Forbidden" as const };
    const { data } = await supabaseAdmin.from("email_settings").select("delivery_mode, sender_domain, updated_at").eq("id", 1).single();
    return { settings: data ?? { delivery_mode: "sandbox", sender_domain: null, updated_at: null }, error: null as string | null };
  });

const SaveInput = z.object({
  senderDomain: z.string().min(3).max(253).regex(/^[a-z0-9.-]+$/i).nullable().optional(),
  deliveryMode: z.enum(["sandbox", "live"]).optional(),
});

export const saveEmailDomainSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SaveInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { error: "Forbidden" as const };

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.senderDomain !== undefined) patch.sender_domain = data.senderDomain;
    if (data.deliveryMode !== undefined) patch.delivery_mode = data.deliveryMode;

    const { error } = await supabaseAdmin.from("email_settings").update(patch).eq("id", 1);
    if (error) return { error: error.message };

    await supabaseAdmin.from("audit_events").insert({
      actor_id: context.userId,
      action: "email.settings_updated",
      entity: "email_settings",
      entity_id: null,
      meta: { ...data },
    });

    return { error: null as string | null };
  });

const CheckInput = z.object({ domain: z.string().min(3).max(253).regex(/^[a-z0-9.-]+$/i) });

export const checkDnsRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => CheckInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { error: "Forbidden" as const };

    const d = data.domain.toLowerCase();
    const [ns, mx, spf, dkim, dmarcRoot] = await Promise.all([
      dnsLookup(d, "NS"),
      dnsLookup(d, "MX"),
      dnsLookup(d, "TXT"),
      dnsLookup(`lovable._domainkey.${d}`, "TXT"),
      dnsLookup(`_dmarc.${d}`, "TXT"),
    ]);

    const nsOk = ns.some((r) => r.toLowerCase().includes("lovable.cloud"));
    const mxOk = mx.length > 0;
    const spfOk = spf.some((r) => r.toLowerCase().includes("v=spf1"));
    const dkimOk = dkim.length > 0 && dkim.some((r) => r.toLowerCase().includes("k=") || r.toLowerCase().includes("p="));
    const dmarcOk = dmarcRoot.some((r) => r.toLowerCase().includes("v=dmarc1"));

    const checks = [
      { id: "ns", label: "NS delegation → Lovable nameservers", status: nsOk ? "pass" : "fail", values: ns },
      { id: "mx", label: "MX records present", status: mxOk ? "pass" : "fail", values: mx },
      { id: "spf", label: "SPF (v=spf1 …)", status: spfOk ? "pass" : "fail", values: spf.filter((r) => r.includes("v=spf1")) },
      { id: "dkim", label: "DKIM (lovable._domainkey)", status: dkimOk ? "pass" : "fail", values: dkim },
      { id: "dmarc", label: "DMARC policy", status: dmarcOk ? "pass" : "warn", values: dmarcRoot.filter((r) => r.toLowerCase().includes("v=dmarc1")) },
    ] as const;

    const allPass = nsOk && mxOk && spfOk && dkimOk;
    return { error: null as string | null, checks, allPass };
  });
