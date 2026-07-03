import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listSecurityFindings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      severity: z.enum(["error", "warn", "info"]).optional().nullable(),
      status: z.enum(["open", "fixed", "ignored"]).optional().nullable(),
      scanner: z.string().max(100).optional().nullable(),
    }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { error: "Forbidden" as const, findings: [], counts: { open: 0, fixed: 0, ignored: 0 } };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("security_findings")
      .select("*")
      .order("severity", { ascending: true })
      .order("last_seen_at", { ascending: false })
      .limit(500);
    if (data.severity) q = q.eq("severity", data.severity);
    if (data.status) q = q.eq("status", data.status);
    if (data.scanner) q = q.eq("scanner_name", data.scanner);

    const { data: rows, error } = await q;
    if (error) return { error: error.message, findings: [], counts: { open: 0, fixed: 0, ignored: 0 } };

    const counts = { open: 0, fixed: 0, ignored: 0 };
    for (const r of rows ?? []) counts[r.status as "open" | "fixed" | "ignored"] = (counts[r.status as "open" | "fixed" | "ignored"] ?? 0) + 1;

    return { error: null as string | null, findings: rows ?? [], counts };
  });
