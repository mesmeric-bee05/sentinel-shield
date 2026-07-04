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

export type SecuritySyncAttempt = {
  id: string;
  received_at: string;
  source_ip: string | null;
  nonce: string | null;
  signature_valid: boolean;
  payload_bytes: number | null;
  finding_count: number | null;
  status: "accepted" | "invalid_signature" | "invalid_payload" | "replay" | "disabled" | "write_failed";
  error: string | null;
  duration_ms: number | null;
};

export const listSecuritySyncAttempts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      status: z.enum(["accepted", "invalid_signature", "invalid_payload", "replay", "disabled", "write_failed"]).optional().nullable(),
      limit: z.number().int().min(1).max(1000).default(500),
    }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { error: "Forbidden" as const, attempts: [] as SecuritySyncAttempt[], counts24h: {} as Record<string, number> };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("security_sync_attempts" as never)
      .select("*")
      .order("received_at", { ascending: false })
      .limit(data.limit);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) return { error: error.message, attempts: [] as SecuritySyncAttempt[], counts24h: {} as Record<string, number> };

    const attempts = (rows ?? []) as unknown as SecuritySyncAttempt[];
    const cutoff = Date.now() - 24 * 3600 * 1000;
    const counts24h: Record<string, number> = {};
    for (const r of attempts) {
      if (new Date(r.received_at).getTime() >= cutoff) {
        counts24h[r.status] = (counts24h[r.status] ?? 0) + 1;
      }
    }
    return { error: null as string | null, attempts, counts24h };
  });
  });
