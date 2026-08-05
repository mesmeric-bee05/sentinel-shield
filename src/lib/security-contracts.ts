// Response contracts for the security admin surfaces.
//
// These Zod schemas are the single source of truth for the shape the server
// returns and the shape the UI consumes. `tests/security/security-sync-metrics-contract.test.ts`
// parses live server responses against them, so any drift (renamed field,
// changed nullability, missing pagination metadata) fails CI instead of the page.
import { z } from "zod";

export const PaginationSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  pages: z.number().int().min(0),
  hasMore: z.boolean(),
});
export type Pagination = z.infer<typeof PaginationSchema>;

/** Derive pagination metadata consistently on both server and client. */
export function buildPagination(total: number, page: number, pageSize: number): Pagination {
  const pages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
  return { page, pageSize, total, pages, hasMore: page < pages };
}

export const SecuritySyncDailyMetricSchema = z.object({
  day: z.string(),
  status: z.string(),
  count: z.number(),
  bytes: z.number().nullable(),
  avg_duration_ms: z.number().nullable(),
  last_seen: z.string().nullable(),
});

export const TopIpSchema = z.object({
  source_ip: z.string(),
  count: z.number().int().min(0),
});

export const SecuritySyncMetricsResponseSchema = z.object({
  error: z.string().nullable(),
  metrics: z.array(SecuritySyncDailyMetricSchema),
  topIps: z.array(TopIpSchema),
});

export const SecuritySyncAttemptSchema = z.object({
  id: z.string(),
  received_at: z.string(),
  source_ip: z.string().nullable(),
  nonce: z.string().nullable(),
  signature_valid: z.boolean(),
  payload_bytes: z.number().nullable(),
  finding_count: z.number().nullable(),
  status: z.enum([
    "accepted",
    "invalid_signature",
    "invalid_payload",
    "replay",
    "disabled",
    "write_failed",
    "payload_too_large",
    "rate_limited",
  ]),
  error: z.string().nullable(),
  duration_ms: z.number().nullable(),
});

export const SecurityFindingSchema = z.object({
  id: z.string(),
  scanner_name: z.string(),
  internal_id: z.string(),
  title: z.string(),
  severity: z.enum(["error", "warn", "info"]),
  resource: z.string().nullable(),
  status: z.enum(["open", "fixed", "ignored"]),
  rationale: z.string().nullable(),
  first_seen_at: z.string(),
  last_seen_at: z.string(),
});

export const SecurityFindingAuditRowSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  internal_id: z.string(),
  scanner_name: z.string(),
  resolution: z.string(),
  resolved_by: z.string().nullable(),
  affected_endpoints: z.array(z.string()),
  affected_queries: z.array(z.string()),
  notes: z.string().nullable(),
});

/** Generic export envelope: RBAC verdict + page of rows + pagination metadata. */
export function exportResponseSchema<T extends z.ZodTypeAny>(row: T) {
  return z.object({
    error: z.string().nullable(),
    rows: z.array(row),
    pagination: PaginationSchema,
  });
}

export const FindingsExportResponseSchema = exportResponseSchema(SecurityFindingSchema);
export const AuditExportResponseSchema = exportResponseSchema(SecurityFindingAuditRowSchema);
export const AttemptsExportResponseSchema = exportResponseSchema(SecuritySyncAttemptSchema);

export const ScanDiffEntrySchema = z.object({
  internal_id: z.string(),
  scanner_name: z.string(),
  title: z.string(),
  severity: z.enum(["error", "warn", "info"]),
  resource: z.string().nullable(),
  status: z.enum(["open", "fixed", "ignored"]),
  last_seen_at: z.string(),
  first_seen_at: z.string(),
});

export const ScanDiffResponseSchema = z.object({
  error: z.string().nullable(),
  latestScanAt: z.string().nullable(),
  previousScanAt: z.string().nullable(),
  resolved: z.array(ScanDiffEntrySchema),
  remaining: z.array(ScanDiffEntrySchema),
  newlyIntroduced: z.array(ScanDiffEntrySchema),
  reports: z.array(z.object({ label: z.string(), url: z.string() })),
});

export type ScanDiffEntry = z.infer<typeof ScanDiffEntrySchema>;
export type ScanDiffResponse = z.infer<typeof ScanDiffResponseSchema>;
export type FindingsExportResponse = z.infer<typeof FindingsExportResponseSchema>;
export type AuditExportResponse = z.infer<typeof AuditExportResponseSchema>;
export type AttemptsExportResponse = z.infer<typeof AttemptsExportResponseSchema>;
