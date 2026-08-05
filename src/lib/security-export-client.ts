// Client helper that drives the RBAC-enforced server export endpoints.
//
// Downloads always go through a server function that re-verifies the caller's
// admin role, so a non-admin never receives rows even if they reach the button.
// Pages are fetched server-side (500 rows/page) until `pagination.hasMore` is
// false, which keeps large exports off a single timing-out query.
import type { HistoryFilterState } from "@/components/admin/HistoryFilters";
import type { ExportColumn } from "@/lib/exports";
import { downloadCsv, downloadJson, timestampedName } from "@/lib/exports";
import { reasonFromResult, type ForbiddenInfo } from "@/lib/permission";
import type { Pagination } from "@/lib/security-contracts";

export type ExportFilters = { page: number; pageSize: number; search?: string | null; status?: string | null; from?: string | null; to?: string | null };
export type ExportPage<T> = { error: string | null; rows: T[]; pagination: Pagination };
export type ExportFn<T> = (args: { data: ExportFilters }) => Promise<ExportPage<T>>;

const PAGE_SIZE = 500;
const MAX_PAGES = 40; // hard ceiling: 20k rows per download

/** Map the shared admin filter bar into server-side export filters. */
export function toExportFilters(f: HistoryFilterState, page = 1, pageSize = PAGE_SIZE): ExportFilters {
  return {
    page,
    pageSize,
    search: f.q || null,
    status: f.status || null,
    from: f.from ? new Date(`${f.from}T00:00:00.000Z`).toISOString() : null,
    to: f.to ? new Date(`${f.to}T23:59:59.999Z`).toISOString() : null,
  };
}

export type ExportOutcome<T> = { ok: true; rows: T[] } | { ok: false; denied: ForbiddenInfo | null; error: string | null };

/** Fetch every page for the current filters. Never throws on denial. */
export async function fetchAllExportRows<T>(fn: ExportFn<T>, filters: HistoryFilterState): Promise<ExportOutcome<T>> {
  const rows: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fn({ data: toExportFilters(filters, page) });
    const denied = reasonFromResult(res);
    if (denied) return { ok: false, denied, error: res.error };
    if (res.error) return { ok: false, denied: null, error: res.error };
    rows.push(...res.rows);
    if (!res.pagination.hasMore) break;
  }
  return { ok: true, rows };
}

/** Fetch + download in one call. Returns the outcome so callers can surface denial UI. */
export async function runServerExport<T>(opts: {
  fn: ExportFn<T>;
  filters: HistoryFilterState;
  format: "csv" | "json";
  basename: string;
  cols: ExportColumn<T>[];
}): Promise<ExportOutcome<T>> {
  const outcome = await fetchAllExportRows(opts.fn, opts.filters);
  if (!outcome.ok) return outcome;
  const name = timestampedName(opts.basename);
  if (opts.format === "csv") downloadCsv(name, outcome.rows, opts.cols);
  else downloadJson(name, outcome.rows);
  return outcome;
}
