// Admin-facing retention configuration + manual cleanup trigger.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { emitSecurityEventAsync } from "@/lib/telemetry";

export type RetentionSettingsRow = {
  dataset: string;
  retention_days: number;
  payload_retention_days: number;
  last_run_at: string | null;
  last_deleted_count: number;
  updated_at: string | null;
};

export type RetentionRunRow = {
  id: string;
  dataset: string;
  deleted_rows: number;
  cleared_payloads: number;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
};

export type RetentionRunResult = {
  datasets: Array<{ dataset: string; deleted_rows: number; cleared_payloads: number; duration_ms: number; error: string | null }>;
  deleted_rows: number;
  cleared_payloads: number;
  duration_ms: number;
  error: string | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = { from: (t: string) => any };

async function isAdmin(context: { supabase: { rpc: (n: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown }> }; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  return data === true;
}

async function db(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Db;
}

export const getRetentionConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ error: string | null; settings: RetentionSettingsRow[]; runs: RetentionRunRow[] }> => {
    if (!(await isAdmin(context as never))) return { error: "Forbidden", settings: [], runs: [] };
    const client = await db();
    const { loadRetentionSettings } = await import("@/lib/security-retention.server");
    const [settings, { data: runs }] = await Promise.all([
      loadRetentionSettings(client),
      client
        .from("security_retention_runs")
        .select("id, dataset, deleted_rows, cleared_payloads, duration_ms, error, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    return { error: null, settings: settings as RetentionSettingsRow[], runs: (runs ?? []) as RetentionRunRow[] };
  });

const UpdateInput = z.object({
  dataset: z.enum(["security_export_audit", "security_export_jobs"]),
  retention_days: z.number().int().min(1).max(3650),
  payload_retention_days: z.number().int().min(1).max(3650),
});

export const updateRetentionConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => UpdateInput.parse(d))
  .handler(async ({ data, context }): Promise<{ error: string | null; settings: RetentionSettingsRow | null }> => {
    if (!(await isAdmin(context as never))) return { error: "Forbidden", settings: null };
    const client = await db();
    const { data: row, error } = await client
      .from("security_retention_settings")
      .upsert(
        {
          dataset: data.dataset,
          retention_days: data.retention_days,
          payload_retention_days: data.payload_retention_days,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "dataset" },
      )
      .select("dataset, retention_days, payload_retention_days, last_run_at, last_deleted_count, updated_at")
      .maybeSingle();
    if (error) return { error: error.message, settings: null };
    emitSecurityEventAsync({ event: "security.retention.configured", attrs: { user_id: context.userId, ...data } });
    return { error: null, settings: row as RetentionSettingsRow };
  });

export const runRetentionNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ error: string | null; result: RetentionRunResult | null }> => {
    if (!(await isAdmin(context as never))) return { error: "Forbidden", result: null };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runRetentionCleanup } = await import("@/lib/security-retention.server");
    const result = await runRetentionCleanup({ admin: supabaseAdmin as never, source: "manual", actorId: context.userId });
    emitSecurityEventAsync({
      event: result.error ? "security.retention.failed" : "security.retention.completed",
      severity: result.error ? "error" : "info",
      attrs: {
        user_id: context.userId,
        source: "manual",
        deleted_rows: result.deleted_rows,
        cleared_payloads: result.cleared_payloads,
        duration_ms: result.duration_ms,
        error: result.error,
      },
    });
    return { error: result.error, result };
  });
