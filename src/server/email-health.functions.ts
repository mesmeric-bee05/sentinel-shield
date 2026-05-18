import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Bucket = { sent: number; queued: number; failed: number; skipped: number; resent: number; total: number };

export const getEmailHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) return { error: "Forbidden" as const };

    const sinceISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: rows, error } = await supabase
      .from("audit_events")
      .select("action, created_at, entity_id, meta")
      .like("action", "email.%")
      .gte("created_at", sinceISO)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) return { error: error.message };

    const bucket: Bucket = { sent: 0, queued: 0, failed: 0, skipped: 0, resent: 0, total: rows?.length ?? 0 };
    const failures: Array<{ id: string; created_at: string; entity_id: string | null; reason: string }> = [];

    for (const r of rows ?? []) {
      const status = r.action.split(".")[1] ?? "";
      if (status in bucket) (bucket as Record<string, number>)[status]++;
      if (status === "failed") {
        const meta = (r.meta ?? {}) as Record<string, unknown>;
        failures.push({
          id: `${r.created_at}-${r.entity_id ?? ""}`,
          created_at: r.created_at,
          entity_id: r.entity_id,
          reason: typeof meta.reason === "string" ? meta.reason : typeof meta.error === "string" ? meta.error : "unknown",
        });
      }
    }

    const successRate = bucket.sent + bucket.failed > 0
      ? Math.round((bucket.sent / (bucket.sent + bucket.failed)) * 100)
      : null;

    return {
      windowHours: 24,
      stats: bucket,
      successRate,
      failures: failures.slice(0, 25),
      // Email queue infra (pgmq) is provisioned via Lovable Email Infrastructure;
      // until a sender domain is configured, the worker doesn't exist yet.
      queueReady: false,
    };
  });
