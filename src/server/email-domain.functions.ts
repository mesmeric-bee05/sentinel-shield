import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// DNS-over-HTTPS via Cloudflare — works inside the Worker runtime.
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
    const { data } = await supabaseAdmin.from("email_settings")
      .select("delivery_mode, sender_domain, updated_at, last_dns_check_at, live_since_at")
      .eq("id", 1).single();
    return {
      settings: data ?? { delivery_mode: "sandbox", sender_domain: null, updated_at: null, last_dns_check_at: null, live_since_at: null },
      error: null as string | null,
    };
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

    const patch: { sender_domain?: string | null; delivery_mode?: "sandbox" | "live"; updated_at: string; live_since_at?: string | null } = {
      updated_at: new Date().toISOString(),
    };
    if (data.senderDomain !== undefined) patch.sender_domain = data.senderDomain;
    if (data.deliveryMode !== undefined) {
      patch.delivery_mode = data.deliveryMode;
      patch.live_since_at = data.deliveryMode === "live" ? new Date().toISOString() : null;
    }

    const { error } = await supabaseAdmin.from("email_settings").update(patch).eq("id", 1);
    if (error) return { error: error.message };

    await supabaseAdmin.from("audit_events").insert({
      actor_id: context.userId,
      action: data.deliveryMode === "live" ? "email.delivery_mode_live" : data.deliveryMode === "sandbox" ? "email.delivery_mode_sandbox" : "email.settings_updated",
      entity: "email_settings",
      entity_id: null,
      meta: { ...data },
    });

    return { error: null as string | null };
  });

const CheckInput = z.object({ domain: z.string().min(3).max(253).regex(/^[a-z0-9.-]+$/i) });

export type DnsCheckRow = {
  id: "ns" | "mx" | "spf" | "dkim" | "dmarc";
  label: string;
  status: "pass" | "fail" | "warn";
  values: string[];
  expected: string;
  diagnostic: string;
};

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
    const spfHit = spf.filter((r) => r.toLowerCase().includes("v=spf1"));
    const spfOk = spfHit.length > 0;
    const dkimOk = dkim.length > 0 && dkim.some((r) => r.toLowerCase().includes("k=") || r.toLowerCase().includes("p="));
    const dmarcHit = dmarcRoot.filter((r) => r.toLowerCase().includes("v=dmarc1"));
    const dmarcOk = dmarcHit.length > 0;

    const checks: DnsCheckRow[] = [
      {
        id: "ns", label: "NS delegation → Lovable nameservers",
        status: nsOk ? "pass" : "fail",
        values: ns,
        expected: "ns3.lovable.cloud, ns4.lovable.cloud",
        diagnostic: nsOk
          ? "Subdomain delegated to Lovable."
          : ns.length === 0
            ? "No NS records returned. Add the two Lovable NS records at your registrar."
            : `NS still points elsewhere: ${ns.join(", ")}`,
      },
      {
        id: "mx", label: "MX records present",
        status: mxOk ? "pass" : "fail",
        values: mx,
        expected: "Lovable-managed MX (auto-provisioned in delegated zone)",
        diagnostic: mxOk ? "MX answers received." : "No MX records. Wait for delegation to propagate (up to 30 min).",
      },
      {
        id: "spf", label: "SPF (v=spf1 …)",
        status: spfOk ? "pass" : "fail",
        values: spfHit,
        expected: "v=spf1 include:lovable.cloud ~all",
        diagnostic: spfOk ? "SPF policy publishes Lovable as a permitted sender." : "TXT record missing or does not start with v=spf1.",
      },
      {
        id: "dkim", label: "DKIM (lovable._domainkey)",
        status: dkimOk ? "pass" : "fail",
        values: dkim,
        expected: "lovable._domainkey TXT containing k=rsa; p=…",
        diagnostic: dkimOk ? "DKIM key visible — signatures will verify." : "No DKIM record on lovable._domainkey selector.",
      },
      {
        id: "dmarc", label: "DMARC policy",
        status: dmarcOk ? "pass" : "warn",
        values: dmarcHit,
        expected: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${d}`,
        diagnostic: dmarcOk ? "DMARC policy published." : "DMARC not required, but recommended for reputation.",
      },
    ];

    const allPass = nsOk && mxOk && spfOk && dkimOk;

    // Persist last-check timestamp for the wizard.
    await supabaseAdmin.from("email_settings").update({
      last_dns_check_at: new Date().toISOString(),
    }).eq("id", 1);

    return { error: null as string | null, checks, allPass, checkedAt: new Date().toISOString() };
  });

export const getDeliverySwitchHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { error: "Forbidden" as const, rows: [] };
    const { data } = await supabaseAdmin.from("audit_events")
      .select("id, action, created_at, meta")
      .in("action", ["email.delivery_mode_live", "email.delivery_mode_sandbox", "email.delivery_mode_auto_live"])
      .order("created_at", { ascending: false })
      .limit(20);
    return { error: null as string | null, rows: data ?? [] };
  });
