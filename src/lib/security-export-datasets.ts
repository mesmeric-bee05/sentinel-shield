// Dataset registry shared by the async export job runner and the admin UI.
// Browser-safe: names + labels only, no server imports.

export const EXPORT_DATASETS = [
  { value: "security_findings", label: "Security findings" },
  { value: "security_finding_audit", label: "Security finding audit" },
  { value: "security_sync_attempts", label: "Security sync attempts" },
  { value: "security_export_audit", label: "Security export audit" },
] as const;

export type ExportDataset = (typeof EXPORT_DATASETS)[number]["value"];

export const EXPORT_DATASET_VALUES = EXPORT_DATASETS.map((d) => d.value) as unknown as [ExportDataset, ...ExportDataset[]];

export function datasetLabel(v: string): string {
  return EXPORT_DATASETS.find((d) => d.value === v)?.label ?? v;
}

export type ExportJobStatus = "queued" | "running" | "complete" | "failed";

export type SecurityExportJob = {
  id: string;
  requested_by: string;
  dataset: string;
  format: string;
  filters: Record<string, string | number | boolean | null>;
  status: ExportJobStatus;
  progress_rows: number;
  total_rows: number | null;
  result_bytes: number | null;
  error: string | null;
  correlation_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  created_at: string;
};
