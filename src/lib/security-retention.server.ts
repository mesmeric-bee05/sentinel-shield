// Server-only retention/cleanup routine for the security export tables.
//
// Order matters: stored payload bodies are cleared first (they dominate storage
// and have the shortest window), then whole rows past their retention window.
// Every run writes a `security_retention_runs` summary row so deletions stay
// auditable.

/* eslint-disable @typescript-eslint/no-explicit-any */
type AdminClient = { from: (t: string) => any };

export type RetentionSettings = {
  export_audit_days: number;
  export_jobs_days: number;
  job_payload_days: number;
  enabled: boolean;
};

export const DEFAULT_RETENTION: RetentionSettings = {
  export_audit_days: 180,
  export_jobs_days: 90,
  job_payload_days: 7,
  enabled: true,
};

export type RetentionResult = {
  audit_rows_deleted: number;
  job_rows_deleted: number;
  payloads_cleared: number;
  duration_ms: number;
  error: string | null;
  skipped: boolean;
};

function cutoff(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function loadRetentionSettings(admin: AdminClient): Promise<RetentionSettings> {
  const { data } = await admin.from("security_retention_settings").select("*").eq("id", true).maybeSingle();
  if (!data) return DEFAULT_RETENTION;
  return {
    export_audit_days: Number(data.export_audit_days ?? DEFAULT_RETENTION.export_audit_days),
    export_jobs_days: Number(data.export_jobs_days ?? DEFAULT_RETENTION.export_jobs_days),
    job_payload_days: Number(data.job_payload_days ?? DEFAULT_RETENTION.job_payload_days),
    enabled: data.enabled !== false,
  };
}

/** Run the cleanup. Never throws — failures are recorded on the run row. */
export async function runRetentionCleanup(opts: {
  admin: AdminClient;
  source: "manual" | "cron";
  actorId?: string | null;
}): Promise<RetentionResult> {
  const { admin, source } = opts;
  const t0 = Date.now();
  const result: RetentionResult = { audit_rows_deleted: 0, job_rows_deleted: 0, payloads_cleared: 0, duration_ms: 0, error: null, skipped: false };

  try {
    const settings = await loadRetentionSettings(admin);
    if (!settings.enabled) {
      result.skipped = true;
      result.duration_ms = Date.now() - t0;
      return result;
    }

    // 1. Clear stored payload bodies past the payload window (row is kept).
    const payloadCutoff = cutoff(settings.job_payload_days);
    const { data: cleared } = await admin
      .from("security_export_jobs")
      .update({ result_payload: null, download_token_hash: null, download_token_expires_at: null })
      .lt("created_at", payloadCutoff)
      .not("result_payload", "is", null)
      .select("id");
    result.payloads_cleared = (cleared ?? []).length;

    // 2. Delete whole job rows past the job window.
    const { data: jobs } = await admin.from("security_export_jobs").delete().lt("created_at", cutoff(settings.export_jobs_days)).select("id");
    result.job_rows_deleted = (jobs ?? []).length;

    // 3. Delete export audit rows past the audit window.
    const { data: audit } = await admin.from("security_export_audit").delete().lt("created_at", cutoff(settings.export_audit_days)).select("id");
    result.audit_rows_deleted = (audit ?? []).length;
  } catch (e) {
    result.error = e instanceof Error ? e.message : "Retention cleanup failed";
  }

  result.duration_ms = Date.now() - t0;
  try {
    await admin.from("security_retention_runs").insert({
      triggered_by: opts.actorId ?? null,
      trigger_source: source,
      audit_rows_deleted: result.audit_rows_deleted,
      job_rows_deleted: result.job_rows_deleted,
      payloads_cleared: result.payloads_cleared,
      duration_ms: result.duration_ms,
      error: result.error,
    });
  } catch {
    /* run-log write is best effort */
  }
  return result;
}
