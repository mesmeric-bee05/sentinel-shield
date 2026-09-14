// Server-only retention/cleanup routine for the security export tables.
//
// Settings are stored one row per dataset in `security_retention_settings`
// (`dataset`, `retention_days`, `payload_retention_days`). For each dataset we
// first clear stored payload bodies past the (shorter) payload window, then
// delete whole rows past the retention window. Every dataset pass writes a
// `security_retention_runs` row so deletions stay auditable.

/* eslint-disable @typescript-eslint/no-explicit-any */
type AdminClient = { from: (t: string) => any };

/** Datasets this routine knows how to prune. */
export const RETENTION_DATASETS = ["security_export_audit", "security_export_jobs"] as const;
export type RetentionDataset = (typeof RETENTION_DATASETS)[number];

export type RetentionSetting = {
  dataset: string;
  retention_days: number;
  payload_retention_days: number;
  last_run_at: string | null;
  last_deleted_count: number;
  updated_at: string | null;
};

export const DEFAULT_RETENTION: Record<RetentionDataset, { retention_days: number; payload_retention_days: number }> = {
  security_export_audit: { retention_days: 180, payload_retention_days: 7 },
  security_export_jobs: { retention_days: 90, payload_retention_days: 7 },
};

export type DatasetResult = {
  dataset: string;
  deleted_rows: number;
  cleared_payloads: number;
  duration_ms: number;
  error: string | null;
};

export type RetentionResult = {
  datasets: DatasetResult[];
  deleted_rows: number;
  cleared_payloads: number;
  duration_ms: number;
  error: string | null;
};

function cutoff(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Current per-dataset settings, filled in with defaults for missing rows. */
export async function loadRetentionSettings(admin: AdminClient): Promise<RetentionSetting[]> {
  const { data } = await admin
    .from("security_retention_settings")
    .select("dataset, retention_days, payload_retention_days, last_run_at, last_deleted_count, updated_at");
  const rows: RetentionSetting[] = (data ?? []) as RetentionSetting[];
  return RETENTION_DATASETS.map((dataset) => {
    const found = rows.find((r) => r.dataset === dataset);
    if (found) {
      return {
        dataset,
        retention_days: Number(found.retention_days ?? DEFAULT_RETENTION[dataset].retention_days),
        payload_retention_days: Number(found.payload_retention_days ?? DEFAULT_RETENTION[dataset].payload_retention_days),
        last_run_at: found.last_run_at ?? null,
        last_deleted_count: Number(found.last_deleted_count ?? 0),
        updated_at: found.updated_at ?? null,
      };
    }
    return { dataset, ...DEFAULT_RETENTION[dataset], last_run_at: null, last_deleted_count: 0, updated_at: null };
  });
}

async function pruneDataset(admin: AdminClient, setting: RetentionSetting): Promise<DatasetResult> {
  const t0 = Date.now();
  const out: DatasetResult = { dataset: setting.dataset, deleted_rows: 0, cleared_payloads: 0, duration_ms: 0, error: null };
  try {
    if (setting.dataset === "security_export_jobs") {
      // Stored payload bodies dominate storage and have the shortest window;
      // the job row itself is kept for the longer retention window.
      const { data: cleared } = await admin
        .from("security_export_jobs")
        .update({ result_payload: null, download_token_hash: null, download_token_expires_at: null })
        .lt("created_at", cutoff(setting.payload_retention_days))
        .not("result_payload", "is", null)
        .select("id");
      out.cleared_payloads = (cleared ?? []).length;
    }
    const { data: deleted } = await admin
      .from(setting.dataset)
      .delete()
      .lt("created_at", cutoff(setting.retention_days))
      .select("id");
    out.deleted_rows = (deleted ?? []).length;
  } catch (e) {
    out.error = e instanceof Error ? e.message : "Retention cleanup failed";
  }
  out.duration_ms = Date.now() - t0;
  return out;
}

/** Run the cleanup for every dataset. Never throws — failures land on the run rows. */
export async function runRetentionCleanup(opts: {
  admin: AdminClient;
  source: "manual" | "cron";
  actorId?: string | null;
}): Promise<RetentionResult> {
  const { admin } = opts;
  const t0 = Date.now();
  const result: RetentionResult = { datasets: [], deleted_rows: 0, cleared_payloads: 0, duration_ms: 0, error: null };

  let settings: RetentionSetting[] = [];
  try {
    settings = await loadRetentionSettings(admin);
  } catch (e) {
    result.error = e instanceof Error ? e.message : "Could not load retention settings";
    result.duration_ms = Date.now() - t0;
    return result;
  }

  for (const setting of settings) {
    const one = await pruneDataset(admin, setting);
    result.datasets.push(one);
    result.deleted_rows += one.deleted_rows;
    result.cleared_payloads += one.cleared_payloads;
    if (one.error && !result.error) result.error = one.error;

    try {
      await admin.from("security_retention_runs").insert({
        dataset: one.dataset,
        deleted_rows: one.deleted_rows,
        cleared_payloads: one.cleared_payloads,
        duration_ms: one.duration_ms,
        error: one.error,
      });
      await admin
        .from("security_retention_settings")
        .update({ last_run_at: new Date().toISOString(), last_deleted_count: one.deleted_rows })
        .eq("dataset", one.dataset);
    } catch {
      /* run-log write is best effort */
    }
  }

  result.duration_ms = Date.now() - t0;
  return result;
}
