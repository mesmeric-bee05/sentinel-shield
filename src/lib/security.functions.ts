import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildPagination, type ScanDiffEntry, type ScanDiffResponse } from "@/lib/security-contracts";
import { emitSecurityEventAsync, newCorrelationId } from "@/lib/telemetry";
import { EXPORT_DATASET_VALUES, type ExportDataset, type SecurityExportJob } from "@/lib/security-export-datasets";

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
  status: "accepted" | "invalid_signature" | "invalid_payload" | "replay" | "disabled" | "write_failed" | "payload_too_large" | "rate_limited";
  error: string | null;
  duration_ms: number | null;
};

export const listSecuritySyncAttempts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      status: z.enum(["accepted", "invalid_signature", "invalid_payload", "replay", "disabled", "write_failed", "payload_too_large", "rate_limited"]).optional().nullable(),
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

export type SecurityFindingAuditRow = {
  id: string;
  created_at: string;
  internal_id: string;
  scanner_name: string;
  resolution: string;
  resolved_by: string | null;
  affected_endpoints: string[];
  affected_queries: string[];
  notes: string | null;
};

export const listSecurityFindingAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      resolution: z.enum(["fixed", "ignored", "reintroduced"]).optional().nullable(),
      limit: z.number().int().min(1).max(1000).default(1000),
    }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { error: "Forbidden" as const, rows: [] as SecurityFindingAuditRow[], counts: { fixed: 0, ignored: 0, reintroduced: 0 } };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("security_finding_audit")
      .select("id, created_at, internal_id, scanner_name, resolution, resolved_by, affected_endpoints, affected_queries, notes")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.resolution) q = q.eq("resolution", data.resolution);

    const { data: rows, error } = await q;
    if (error) return { error: error.message, rows: [] as SecurityFindingAuditRow[], counts: { fixed: 0, ignored: 0, reintroduced: 0 } };

    const counts = { fixed: 0, ignored: 0, reintroduced: 0 } as Record<string, number>;
    for (const r of rows ?? []) counts[r.resolution as string] = (counts[r.resolution as string] ?? 0) + 1;

    return { error: null as string | null, rows: (rows ?? []) as SecurityFindingAuditRow[], counts: counts as { fixed: number; ignored: number; reintroduced: number } };
  });

export type SecuritySyncDailyMetric = {
  day: string;
  status: string;
  count: number;
  bytes: number | null;
  avg_duration_ms: number | null;
  last_seen: string | null;
};

/**
 * Daily aggregate over `security_sync_metrics_daily` view — powers the
 * top-of-page rollup on the sync audit dashboard. Admin-only; reads via
 * service role because the view has no anon/authenticated grants.
 */
export const getSecuritySyncMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      days: z.number().int().min(1).max(90).default(14),
    }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { error: "Forbidden" as const, metrics: [] as SecuritySyncDailyMetric[], topIps: [] as { source_ip: string; count: number }[] };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - data.days * 86400_000).toISOString();

    const { data: metrics, error } = await supabaseAdmin
      .from("security_sync_metrics_daily" as never)
      .select("day, status, count, bytes, avg_duration_ms, last_seen")
      .gte("day", since)
      .order("day", { ascending: false });
    if (error) return { error: error.message, metrics: [] as SecuritySyncDailyMetric[], topIps: [] as { source_ip: string; count: number }[] };

    // Top offender IPs in the same window (non-accepted attempts).
    const { data: ipRows } = await supabaseAdmin
      .from("security_sync_attempts" as never)
      .select("source_ip, status")
      .gte("received_at", since)
      .neq("status", "accepted")
      .limit(5000);
    const ipCounts: Record<string, number> = {};
    for (const r of (ipRows ?? []) as { source_ip: string | null }[]) {
      const ip = r.source_ip ?? "unknown";
      ipCounts[ip] = (ipCounts[ip] ?? 0) + 1;
    }
    const topIps = Object.entries(ipCounts)
      .map(([source_ip, count]) => ({ source_ip, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return { error: null as string | null, metrics: (metrics ?? []) as unknown as SecuritySyncDailyMetric[], topIps };
  });


// ---------------------------------------------------------------------------
// Export endpoints — RBAC-enforced, paginated, telemetry-instrumented.
// Every export path re-verifies the caller's admin role via `has_role` on the
// caller-scoped client BEFORE any service-role read, and emits a structured
// `security.export` event so download activity is monitorable in production.
// ---------------------------------------------------------------------------

const ExportInput = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(1000).default(500),
  search: z.string().max(200).optional().nullable(),
  status: z.string().max(50).optional().nullable(),
  from: z.string().max(40).optional().nullable(),
  to: z.string().max(40).optional().nullable(),
});
type ExportInputT = z.infer<typeof ExportInput>;

function forbiddenExport(page: number, pageSize: number) {
  return { error: "Forbidden" as const, rows: [] as never[], pagination: buildPagination(0, page, pageSize) };
}

/** Resolve an admin-role check without coupling to the generated client's rpc overloads. */
async function assertAdmin(call: () => PromiseLike<{ data: unknown }>): Promise<boolean> {
  const { data } = await call();
  return data === true;
}

/**
 * Record one audit row per export run (page 1 only — later pages belong to the
 * same run). Never throws: an audit write must not fail the download.
 */
async function recordExportAudit(opts: {
  actorId: string;
  dataset: string;
  input: ExportInputT;
  rowCount: number;
  durationMs: number;
  correlationId?: string;
}): Promise<void> {
  if (opts.input.page !== 1) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("security_export_audit").insert({
      actor_id: opts.actorId,
      export_kind: opts.dataset,
      format: "server",
      filters: {
        search: opts.input.search ?? null,
        status: opts.input.status ?? null,
        pageSize: opts.input.pageSize,
      },
      scan_window_from: opts.input.from ?? null,
      scan_window_to: opts.input.to ?? null,
      row_count: opts.rowCount,
      duration_ms: opts.durationMs,
      correlation_id: opts.correlationId ?? null,
    });
  } catch {
    // non-fatal
  }
}

function range(input: ExportInputT): { from: number; to: number } {
  const from = (input.page - 1) * input.pageSize;
  return { from, to: from + input.pageSize - 1 };
}

/** Paginated, admin-only export of `security_findings`. */
export const exportSecurityFindings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ExportInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const t0 = Date.now();
    if (!(await assertAdmin(() => context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" })))) {
      emitSecurityEventAsync({ event: "security.export.denied", severity: "warning", attrs: { dataset: "security_findings", user_id: context.userId } });
      return forbiddenExport(data.page, data.pageSize);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { from, to } = range(data);
    let q = supabaseAdmin
      .from("security_findings")
      .select("id, scanner_name, internal_id, title, severity, resource, status, rationale, first_seen_at, last_seen_at", { count: "exact" })
      .order("last_seen_at", { ascending: false })
      .range(from, to);
    if (data.status) q = q.eq("status", data.status);
    if (data.from) q = q.gte("last_seen_at", data.from);
    if (data.to) q = q.lte("last_seen_at", data.to);
    if (data.search) q = q.or(`title.ilike.%${data.search}%,internal_id.ilike.%${data.search}%,resource.ilike.%${data.search}%`);

    const { data: rows, count, error } = await q;
    if (error) {
      emitSecurityEventAsync({ event: "security.export.failed", severity: "error", attrs: { dataset: "security_findings", error: error.message } });
      return { error: error.message, rows: [] as never[], pagination: buildPagination(0, data.page, data.pageSize) };
    }
    const correlationId = newCorrelationId();
    await recordExportAudit({ actorId: context.userId, dataset: "security_findings", input: data, rowCount: count ?? 0, durationMs: Date.now() - t0, correlationId });
    emitSecurityEventAsync({
      correlationId,
      event: "security.export.completed",
      attrs: { dataset: "security_findings", user_id: context.userId, rows: rows?.length ?? 0, total: count ?? 0, page: data.page, duration_ms: Date.now() - t0 },
    });
    return { error: null as string | null, rows: rows ?? [], pagination: buildPagination(count ?? 0, data.page, data.pageSize) };
  });

/** Paginated, admin-only export of `security_finding_audit`. */
export const exportSecurityFindingAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ExportInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const t0 = Date.now();
    if (!(await assertAdmin(() => context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" })))) {
      emitSecurityEventAsync({ event: "security.export.denied", severity: "warning", attrs: { dataset: "security_finding_audit", user_id: context.userId } });
      return forbiddenExport(data.page, data.pageSize);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { from, to } = range(data);
    let q = supabaseAdmin
      .from("security_finding_audit")
      .select("id, created_at, internal_id, scanner_name, resolution, resolved_by, affected_endpoints, affected_queries, notes", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (data.status) q = q.eq("resolution", data.status);
    if (data.from) q = q.gte("created_at", data.from);
    if (data.to) q = q.lte("created_at", data.to);
    if (data.search) q = q.or(`internal_id.ilike.%${data.search}%,scanner_name.ilike.%${data.search}%,notes.ilike.%${data.search}%`);

    const { data: rows, count, error } = await q;
    if (error) {
      emitSecurityEventAsync({ event: "security.export.failed", severity: "error", attrs: { dataset: "security_finding_audit", error: error.message } });
      return { error: error.message, rows: [] as never[], pagination: buildPagination(0, data.page, data.pageSize) };
    }
    const correlationId = newCorrelationId();
    await recordExportAudit({ actorId: context.userId, dataset: "security_finding_audit", input: data, rowCount: count ?? 0, durationMs: Date.now() - t0, correlationId });
    emitSecurityEventAsync({
      correlationId,
      event: "security.export.completed",
      attrs: { dataset: "security_finding_audit", user_id: context.userId, rows: rows?.length ?? 0, total: count ?? 0, page: data.page, duration_ms: Date.now() - t0 },
    });
    return { error: null as string | null, rows: rows ?? [], pagination: buildPagination(count ?? 0, data.page, data.pageSize) };
  });

/** Paginated, admin-only export of `security_sync_attempts`. */
export const exportSecuritySyncAttempts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ExportInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const t0 = Date.now();
    if (!(await assertAdmin(() => context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" })))) {
      emitSecurityEventAsync({ event: "security.export.denied", severity: "warning", attrs: { dataset: "security_sync_attempts", user_id: context.userId } });
      return forbiddenExport(data.page, data.pageSize);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { from, to } = range(data);
    let q = supabaseAdmin
      .from("security_sync_attempts" as never)
      .select("*", { count: "exact" })
      .order("received_at", { ascending: false })
      .range(from, to);
    if (data.status) q = q.eq("status", data.status);
    if (data.from) q = q.gte("received_at", data.from);
    if (data.to) q = q.lte("received_at", data.to);

    const { data: rows, count, error } = await q;
    if (error) {
      emitSecurityEventAsync({ event: "security.export.failed", severity: "error", attrs: { dataset: "security_sync_attempts", error: error.message } });
      return { error: error.message, rows: [] as SecuritySyncAttempt[], pagination: buildPagination(0, data.page, data.pageSize) };
    }
    const correlationId = newCorrelationId();
    await recordExportAudit({ actorId: context.userId, dataset: "security_sync_attempts", input: data, rowCount: count ?? 0, durationMs: Date.now() - t0, correlationId });
    emitSecurityEventAsync({
      correlationId,
      event: "security.export.completed",
      attrs: { dataset: "security_sync_attempts", user_id: context.userId, rows: rows?.length ?? 0, total: count ?? 0, page: data.page, duration_ms: Date.now() - t0 },
    });
    return { error: null as string | null, rows: (rows ?? []) as unknown as SecuritySyncAttempt[], pagination: buildPagination(count ?? 0, data.page, data.pageSize) };
  });

// ---------------------------------------------------------------------------
// Scan-to-scan diff
// ---------------------------------------------------------------------------

/**
 * Compare the two most recent scan snapshots. Scans are identified by the
 * distinct `last_seen_at` timestamps written by the security-sync webhook
 * (all findings in one sync share a timestamp, so a snapshot = one bucket).
 *
 * resolved        — present in the previous snapshot, now fixed/ignored or absent
 * remaining       — present in both snapshots and still open
 * newlyIntroduced — open in the latest snapshot but absent from the previous one
 */
export const getSecurityScanDiff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ScanDiffResponse> => {
    const empty = { latestScanAt: null, previousScanAt: null, resolved: [], remaining: [], newlyIntroduced: [], reports: [] };
    if (!(await assertAdmin(() => context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" })))) return { error: "Forbidden", ...empty };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("security_findings")
      .select("internal_id, scanner_name, title, severity, resource, status, first_seen_at, last_seen_at")
      .order("last_seen_at", { ascending: false })
      .limit(2000);
    if (error) return { error: error.message, ...empty };

    const all = (rows ?? []) as ScanDiffEntry[];
    // Bucket by scan timestamp (second precision absorbs per-row write skew).
    const bucketKey = (iso: string) => iso.slice(0, 19);
    const buckets = [...new Set(all.map((r) => bucketKey(r.last_seen_at)))].sort().reverse();
    const latestKey = buckets[0] ?? null;
    const previousKey = buckets[1] ?? null;

    const latest = all.filter((r) => latestKey && bucketKey(r.last_seen_at) === latestKey);
    const previous = all.filter((r) => previousKey && bucketKey(r.last_seen_at) === previousKey);
    const prevIds = new Map(previous.map((r) => [`${r.scanner_name}::${r.internal_id}`, r]));
    const latestIds = new Map(latest.map((r) => [`${r.scanner_name}::${r.internal_id}`, r]));

    const resolved: ScanDiffEntry[] = [];
    const remaining: ScanDiffEntry[] = [];
    const newlyIntroduced: ScanDiffEntry[] = [];

    for (const [key, row] of latestIds) {
      if (row.status === "open") {
        if (prevIds.has(key)) remaining.push(row);
        else newlyIntroduced.push(row);
      } else {
        resolved.push(row);
      }
    }
    // Findings that dropped out of the latest scan entirely count as resolved.
    for (const [key, row] of prevIds) {
      if (!latestIds.has(key) && row.status === "open") resolved.push({ ...row, status: "fixed" });
    }

    const bySeverity = (a: ScanDiffEntry, b: ScanDiffEntry) =>
      ["error", "warn", "info"].indexOf(a.severity) - ["error", "warn", "info"].indexOf(b.severity) || a.internal_id.localeCompare(b.internal_id);

    return {
      error: null,
      latestScanAt: latest[0]?.last_seen_at ?? null,
      previousScanAt: previous[0]?.last_seen_at ?? null,
      resolved: resolved.sort(bySeverity),
      remaining: remaining.sort(bySeverity),
      newlyIntroduced: newlyIntroduced.sort(bySeverity),
      reports: [
        { label: "Latest findings report", url: "/docs/security/findings-report.md" },
        { label: "Accepted risks", url: "/docs/security/accepted-risks.md" },
      ],
    };
  });

export type SecurityExportAuditRow = {
  id: string;
  actor_id: string;
  export_kind: string;
  format: string;
  filters: Record<string, string | number | boolean | null>;
  scan_window_from: string | null;
  scan_window_to: string | null;
  row_count: number;
  duration_ms: number | null;
  correlation_id: string | null;
  created_at: string;
};

const ExportAuditFilterInput = ExportInput.extend({
  actor: z.string().max(80).optional().nullable(),
  kind: z.string().max(80).optional().nullable(),
  windowFrom: z.string().max(40).optional().nullable(),
  windowTo: z.string().max(40).optional().nullable(),
});

/** Admin-only listing of who exported security data, when, and with what filters. */
export const listSecurityExportAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ExportAuditFilterInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    if (!(await assertAdmin(() => context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" })))) {
      return { error: "Forbidden", rows: [] as SecurityExportAuditRow[], pagination: buildPagination(0, data.page, data.pageSize) };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { from, to } = range(data);
    let q = supabaseAdmin
      .from("security_export_audit")
      .select("id, actor_id, export_kind, format, filters, scan_window_from, scan_window_to, row_count, duration_ms, correlation_id, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (data.kind) q = q.eq("export_kind", data.kind);
    if (data.actor) q = q.filter("actor_id::text", "ilike", `%${data.actor.replace(/[%,()]/g, "")}%`);
    if (data.search) {
      const term = data.search.replace(/[%,()]/g, "");
      q = q.or(`export_kind.ilike.%${term}%,correlation_id.ilike.%${term}%`);
    }
    if (data.from) q = q.gte("created_at", data.from);
    if (data.to) q = q.lte("created_at", data.to);
    if (data.windowFrom) q = q.gte("scan_window_from", data.windowFrom);
    if (data.windowTo) q = q.lte("scan_window_to", data.windowTo);
    const { data: rows, count, error } = await q;
    return {
      error: error?.message ?? null,
      rows: (rows ?? []).map((r) => ({ ...r, filters: (r.filters ?? {}) as Record<string, string | number | boolean | null> })) as SecurityExportAuditRow[],
      pagination: buildPagination(count ?? 0, data.page, data.pageSize),
    };
  });

// ---------------------------------------------------------------------------
// Async export jobs
// ---------------------------------------------------------------------------

const StartJobInput = z.object({
  dataset: z.enum(EXPORT_DATASET_VALUES),
  format: z.enum(["csv", "json"]).default("csv"),
  search: z.string().max(200).optional().nullable(),
  status: z.string().max(50).optional().nullable(),
  from: z.string().max(40).optional().nullable(),
  to: z.string().max(40).optional().nullable(),
});

/** Queue + run an export job. Returns immediately with the finished job state. */
export const startSecurityExportJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => StartJobInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<{ error: string | null; jobId: string | null }> => {
    if (!(await assertAdmin(() => context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" })))) {
      emitSecurityEventAsync({ event: "security.export.denied", severity: "warning", attrs: { dataset: data.dataset, user_id: context.userId, mode: "async" } });
      return { error: "Forbidden", jobId: null };
    }
    const correlationId = newCorrelationId();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const filters = { search: data.search ?? null, status: data.status ?? null, from: data.from ?? null, to: data.to ?? null };
    const { data: job, error } = await supabaseAdmin
      .from("security_export_jobs")
      .insert({
        requested_by: context.userId,
        dataset: data.dataset,
        format: data.format,
        filters,
        scan_window_from: data.from ?? null,
        scan_window_to: data.to ?? null,
        correlation_id: correlationId,
        status: "queued",
      })
      .select("id")
      .single();
    if (error || !job) return { error: error?.message ?? "Could not queue export", jobId: null };

    const { runExportJob } = await import("@/lib/security-export-jobs.server");
    const result = await runExportJob({
      admin: supabaseAdmin as never,
      jobId: job.id,
      dataset: data.dataset as ExportDataset,
      format: data.format,
      filters,
    });

    emitSecurityEventAsync({
      correlationId,
      event: result.status === "complete" ? "security.export.completed" : "security.export.failed",
      severity: result.status === "complete" ? "info" : "error",
      attrs: { dataset: data.dataset, mode: "async", job_id: job.id, rows: result.rowCount, bytes: result.bytes, user_id: context.userId },
    });
    if (result.status === "complete") {
      await recordExportAudit({
        actorId: context.userId,
        dataset: data.dataset,
        input: { page: 1, pageSize: 500, search: data.search ?? null, status: data.status ?? null, from: data.from ?? null, to: data.to ?? null },
        rowCount: result.rowCount,
        durationMs: 0,
        correlationId,
      });
    }
    return { error: null, jobId: job.id };
  });

/** Admin-only listing of export jobs, newest first. */
export const listSecurityExportJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(20) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    if (!(await assertAdmin(() => context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" })))) {
      return { error: "Forbidden", rows: [] as SecurityExportJob[], pagination: buildPagination(0, data.page, data.pageSize) };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const start = (data.page - 1) * data.pageSize;
    const { data: rows, count, error } = await supabaseAdmin
      .from("security_export_jobs")
      .select("id, requested_by, dataset, format, filters, status, progress_rows, total_rows, result_bytes, error, correlation_id, started_at, finished_at, duration_ms, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(start, start + data.pageSize - 1);
    return {
      error: error?.message ?? null,
      rows: (rows ?? []) as unknown as SecurityExportJob[],
      pagination: buildPagination(count ?? 0, data.page, data.pageSize),
    };
  });

/** Admin-only download of a completed job payload. */
export const downloadSecurityExportJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ error: string | null; dataset: string | null; format: string | null; payload: string | null }> => {
    if (!(await assertAdmin(() => context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" })))) {
      emitSecurityEventAsync({ event: "security.export.denied", severity: "warning", attrs: { job_id: data.jobId, user_id: context.userId, mode: "download" } });
      return { error: "Forbidden", dataset: null, format: null, payload: null };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: job, error } = await supabaseAdmin
      .from("security_export_jobs")
      .select("dataset, format, status, result_payload, correlation_id")
      .eq("id", data.jobId)
      .maybeSingle();
    if (error) return { error: error.message, dataset: null, format: null, payload: null };
    if (!job) return { error: "Job not found", dataset: null, format: null, payload: null };
    if (job.status !== "complete" || !job.result_payload) return { error: `Export is ${job.status}`, dataset: job.dataset, format: job.format, payload: null };
    emitSecurityEventAsync({
      correlationId: job.correlation_id ?? undefined,
      event: "security.export.downloaded",
      attrs: { dataset: job.dataset, job_id: data.jobId, user_id: context.userId },
    });
    return { error: null, dataset: job.dataset, format: job.format, payload: job.result_payload };
  });

/** Newest scan timestamp — used by the diff page watermark backfill. */
export const getLatestScanAt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ error: string | null; latestScanAt: string | null }> => {
    if (!(await assertAdmin(() => context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" })))) {
      return { error: "Forbidden", latestScanAt: null };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("security_findings")
      .select("last_seen_at")
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { error: error?.message ?? null, latestScanAt: data?.last_seen_at ?? null };
  });
