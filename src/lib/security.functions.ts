import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildPagination, type ScanDiffEntry, type ScanDiffResponse } from "@/lib/security-contracts";
import { emitSecurityEventAsync } from "@/lib/telemetry";

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
    await recordExportAudit({ actorId: context.userId, dataset: "security_findings", input: data, rowCount: count ?? 0, durationMs: Date.now() - t0 });
    emitSecurityEventAsync({
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
    await recordExportAudit({ actorId: context.userId, dataset: "security_finding_audit", input: data, rowCount: count ?? 0, durationMs: Date.now() - t0 });
    emitSecurityEventAsync({
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
    await recordExportAudit({ actorId: context.userId, dataset: "security_sync_attempts", input: data, rowCount: count ?? 0, durationMs: Date.now() - t0 });
    emitSecurityEventAsync({
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
