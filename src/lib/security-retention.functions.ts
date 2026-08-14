// Admin-facing retention configuration + manual cleanup trigger.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { emitSecurityEventAsync } from "@/lib/telemetry";

export type RetentionSettingsRow = {
  export_audit_days: number;
  export_jobs_days: number;
  job_payload_days: number;
  enabled: boolean;
  updated_at: string | null;
};

export type RetentionRunRow = {
  id: string;
  trigger_source: string;
  audit_rows_deleted: number;
  job_rows_deleted: number;
  payloads_cleared: number;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
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

const DEFAULTS: RetentionSettingsRow = { export_audit_days: 180, export_jobs_days: 90, job_payload_days: 7, enabled: true, updated_at: null };

export const getRetentionConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ error: string | null; settings: RetentionSettingsRow | null; runs: RetentionRunRow[] }> => {
    if (!(await isAdmin(context as never))) return { error: "Forbidden", settings: null, runs: [] };
    const client = await db();
    const [{ data: settings }, { data: runs }] = await Promise.all([
      client.from("security_retention_settings").select("export_audit_days, export_jobs_days, job_payload_days, enabled, updated_at").eq("id", true).maybeSingle(),
      client.from("security_retention_runs").select("id, trigger_source, audit_rows_deleted, job_rows_deleted, payloads_cleared, duration_ms, error, created_at").order("created_at", { ascending: false }).limit(10),
    ]);
    return { error: null, settings: (settings ?? DEFAULTS) as RetentionSettingsRow, runs: (runs ?? []) as RetentionRunRow[] };
  });

const UpdateInput = z.object({
  export_audit_days: z.number().int().min(1).max(3650),
  export_jobs_days: z.number().int().min(1).max(3650),
  job_payload_days: z.number().int().min(1).max(3650),
  enabled: z.boolean(),
});

export const updateRetentionConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => UpdateInput.parse(d))
  .handler(async ({ data, context }): Promise<{ error: string | null; settings: RetentionSettingsRow | null }> => {
    if (!(await isAdmin(context as never))) return { error: "Forbidden", settings: null };
    const client = await db();
    const { data: row, error } = await client
      .from("security_retention_settings")
      .upsert({ id: true, ...data, updated_by: context.userId }, { onConflict: "id" })
      .select("export_audit_days, export_jobs_days, job_payload_days, enabled, updated_at")
      .maybeSingle();
    if (error) return { error: error.message, settings: null };
    emitSecurityEventAsync({ event: "security.retention.configured", attrs: { user_id: context.userId, ...data } });
    return { error: null, settings: row as RetentionSettingsRow };
  });

export const runRetentionNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await isAdmin(context as never))) return { error: "Forbidden" as string | null, result: null };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runRetentionCleanup } = await import("@/lib/security-retention.server");
    const result = await runRetentionCleanup({ admin: supabaseAdmin as never, source: "manual", actorId: context.userId });
    emitSecurityEventAsync({
      event: result.error ? "security.retention.failed" : "security.retention.completed",
      severity: result.error ? "error" : "info",
      attrs: { user_id: context.userId, source: "manual", ...result },
    });
    return { error: result.error, result };
  });
