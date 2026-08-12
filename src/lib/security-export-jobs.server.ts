// Server-only runner for async security export jobs.
//
// A job is created in `security_export_jobs`, then pages are collected with the
// service-role client (the caller's admin role is verified BEFORE this module is
// reached) and the finished CSV/JSON payload is stored on the job row so the
// admin can download it later without re-running the query.

import { toCsv, type ExportColumn } from "@/lib/exports";
import type { ExportDataset } from "@/lib/security-export-datasets";

const PAGE = 500;
const MAX_PAGES = 60; // 30k rows hard ceiling
const MAX_BYTES = 8 * 1024 * 1024; // stored payload cap

export type JobFilters = {
  search?: string | null;
  status?: string | null;
  from?: string | null;
  to?: string | null;
};

type Row = Record<string, unknown>;

const COLUMNS: Record<ExportDataset, ExportColumn<Row>[]> = {
  security_findings: [
    { key: "internal_id", label: "Internal ID", value: (r) => String(r["internal_id"] ?? "") },
    { key: "scanner_name", label: "Scanner", value: (r) => String(r["scanner_name"] ?? "") },
    { key: "title", label: "Title", value: (r) => String(r["title"] ?? "") },
    { key: "severity", label: "Severity", value: (r) => String(r["severity"] ?? "") },
    { key: "resource", label: "Resource", value: (r) => String(r["resource"] ?? "") },
    { key: "status", label: "Status", value: (r) => String(r["status"] ?? "") },
    { key: "first_seen_at", label: "First seen", value: (r) => String(r["first_seen_at"] ?? "") },
    { key: "last_seen_at", label: "Last seen", value: (r) => String(r["last_seen_at"] ?? "") },
  ],
  security_finding_audit: [
    { key: "created_at", label: "Recorded at", value: (r) => String(r["created_at"] ?? "") },
    { key: "resolution", label: "Resolution", value: (r) => String(r["resolution"] ?? "") },
    { key: "internal_id", label: "Internal ID", value: (r) => String(r["internal_id"] ?? "") },
    { key: "scanner_name", label: "Scanner", value: (r) => String(r["scanner_name"] ?? "") },
    { key: "resolved_by", label: "Resolved by", value: (r) => String(r["resolved_by"] ?? "") },
    { key: "affected_endpoints", label: "Affected endpoints", value: (r) => ((r["affected_endpoints"] as string[] | null) ?? []).join("; ") },
    { key: "affected_queries", label: "Affected queries", value: (r) => ((r["affected_queries"] as string[] | null) ?? []).join("; ") },
    { key: "notes", label: "Notes", value: (r) => String(r["notes"] ?? "") },
  ],
  security_sync_attempts: [
    { key: "received_at", label: "Received at", value: (r) => String(r["received_at"] ?? "") },
    { key: "status", label: "Status", value: (r) => String(r["status"] ?? "") },
    { key: "source_ip", label: "Source IP", value: (r) => String(r["source_ip"] ?? "") },
    { key: "signature_valid", label: "Signature valid", value: (r) => String(r["signature_valid"] ?? "") },
    { key: "payload_bytes", label: "Payload bytes", value: (r) => String(r["payload_bytes"] ?? "") },
    { key: "finding_count", label: "Findings", value: (r) => String(r["finding_count"] ?? "") },
    { key: "duration_ms", label: "Duration (ms)", value: (r) => String(r["duration_ms"] ?? "") },
    { key: "correlation_id", label: "Correlation ID", value: (r) => String(r["correlation_id"] ?? "") },
    { key: "error", label: "Error", value: (r) => String(r["error"] ?? "") },
  ],
  security_export_audit: [
    { key: "created_at", label: "When", value: (r) => String(r["created_at"] ?? "") },
    { key: "actor_id", label: "Actor", value: (r) => String(r["actor_id"] ?? "") },
    { key: "export_kind", label: "Dataset", value: (r) => String(r["export_kind"] ?? "") },
    { key: "format", label: "Format", value: (r) => String(r["format"] ?? "") },
    { key: "filters", label: "Filters", value: (r) => JSON.stringify(r["filters"] ?? {}) },
    { key: "scan_window_from", label: "Scan window from", value: (r) => String(r["scan_window_from"] ?? "") },
    { key: "scan_window_to", label: "Scan window to", value: (r) => String(r["scan_window_to"] ?? "") },
    { key: "row_count", label: "Rows", value: (r) => String(r["row_count"] ?? "") },
    { key: "duration_ms", label: "Duration (ms)", value: (r) => String(r["duration_ms"] ?? "") },
    { key: "correlation_id", label: "Correlation ID", value: (r) => String(r["correlation_id"] ?? "") },
  ],
};

const DATE_COLUMN: Record<ExportDataset, string> = {
  security_findings: "last_seen_at",
  security_finding_audit: "created_at",
  security_sync_attempts: "received_at",
  security_export_audit: "created_at",
};

const STATUS_COLUMN: Record<ExportDataset, string> = {
  security_findings: "status",
  security_finding_audit: "resolution",
  security_sync_attempts: "status",
  security_export_audit: "export_kind",
};

const SEARCH_COLUMNS: Record<ExportDataset, string[]> = {
  security_findings: ["title", "internal_id", "resource"],
  security_finding_audit: ["internal_id", "scanner_name", "notes"],
  security_sync_attempts: ["source_ip", "nonce", "error"],
  security_export_audit: ["export_kind", "correlation_id"],
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type AdminClient = { from: (t: string) => any };

async function fetchPage(admin: AdminClient, dataset: ExportDataset, filters: JobFilters, page: number) {
  const from = (page - 1) * PAGE;
  let q = admin
    .from(dataset)
    .select("*", { count: "exact" })
    .order(DATE_COLUMN[dataset], { ascending: false })
    .range(from, from + PAGE - 1);
  if (filters.status) q = q.eq(STATUS_COLUMN[dataset], filters.status);
  if (filters.from) q = q.gte(DATE_COLUMN[dataset], filters.from);
  if (filters.to) q = q.lte(DATE_COLUMN[dataset], filters.to);
  if (filters.search) {
    const term = filters.search.replace(/[%,()]/g, "");
    q = q.or(SEARCH_COLUMNS[dataset].map((c) => `${c}.ilike.%${term}%`).join(","));
  }
  const { data, count, error } = await q;
  return { rows: (data ?? []) as Row[], count: (count ?? 0) as number, error: error?.message ?? null };
}

export function serializeRows(dataset: ExportDataset, rows: Row[], format: "csv" | "json"): string {
  if (format === "json") return JSON.stringify(rows, null, 2);
  return toCsv(rows, COLUMNS[dataset]);
}

/**
 * Run an export job to completion, updating progress as pages land.
 * Never throws — failures are recorded on the job row.
 */
export async function runExportJob(opts: {
  admin: AdminClient;
  jobId: string;
  dataset: ExportDataset;
  format: "csv" | "json";
  filters: JobFilters;
}): Promise<{ status: "complete" | "failed"; rowCount: number; bytes: number; error: string | null }> {
  const { admin, jobId, dataset, format, filters } = opts;
  const t0 = Date.now();
  const patch = async (values: Record<string, unknown>) => {
    try {
      await admin.from("security_export_jobs").update(values).eq("id", jobId);
    } catch {
      /* progress writes are best-effort */
    }
  };

  await patch({ status: "running", started_at: new Date().toISOString() });

  const rows: Row[] = [];
  let total = 0;
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await fetchPage(admin, dataset, filters, page);
      if (res.error) throw new Error(res.error);
      total = res.count;
      rows.push(...res.rows);
      await patch({ progress_rows: rows.length, total_rows: total });
      if (rows.length >= total || res.rows.length < PAGE) break;
    }

    const payload = serializeRows(dataset, rows, format);
    const bytes = new TextEncoder().encode(payload).length;
    if (bytes > MAX_BYTES) {
      const error = `Export too large (${Math.round(bytes / 1024)} KB). Narrow your filters and try again.`;
      await patch({ status: "failed", error, finished_at: new Date().toISOString(), duration_ms: Date.now() - t0 });
      return { status: "failed", rowCount: rows.length, bytes, error };
    }
    await patch({
      status: "complete",
      result_payload: payload,
      result_bytes: bytes,
      progress_rows: rows.length,
      total_rows: total,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - t0,
    });
    return { status: "complete", rowCount: rows.length, bytes, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Export failed";
    await patch({ status: "failed", error, finished_at: new Date().toISOString(), duration_ms: Date.now() - t0 });
    return { status: "failed", rowCount: rows.length, bytes: 0, error };
  }
}
