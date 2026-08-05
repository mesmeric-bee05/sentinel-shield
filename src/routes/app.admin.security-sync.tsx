import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, AlertCircle, RefreshCw, Loader2, ShieldAlert, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { listSecuritySyncAttempts, getSecuritySyncMetrics, type SecuritySyncAttempt, type SecuritySyncDailyMetric } from "@/lib/security.functions";
import { PermissionDeniedCard } from "@/components/admin/PermissionDeniedCard";
import { reasonFromResult, type ForbiddenInfo } from "@/lib/permission";
import { HistoryFilters, type HistoryFilterState, emptyFilters, applyHistoryFilter, paginate, Pager } from "@/components/admin/HistoryFilters";
import { downloadCsv, downloadJson, timestampedName } from "@/lib/exports";
import { rollupByDay } from "@/lib/security-sync-metrics";
import { PageHeader } from "./app";

export const Route = createFileRoute("/app/admin/security-sync")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [{ title: "Security sync audit — ApexCare AI" }, { name: "robots", content: "noindex" }] }),
  component: SecuritySyncPage,
});

const STATUS_TONE: Record<SecuritySyncAttempt["status"], string> = {
  accepted: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  invalid_signature: "bg-rose-500/10 text-rose-700 border-rose-500/30",
  invalid_payload: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  replay: "bg-orange-500/10 text-orange-700 border-orange-500/30",
  disabled: "bg-muted text-muted-foreground border-border",
  write_failed: "bg-rose-500/10 text-rose-700 border-rose-500/30",
  payload_too_large: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  rate_limited: "bg-orange-500/10 text-orange-700 border-orange-500/30",
};

function SecuritySyncPage() {
  const listFn = useServerFn(listSecuritySyncAttempts);
  const metricsFn = useServerFn(getSecuritySyncMetrics);
  const [attempts, setAttempts] = useState<SecuritySyncAttempt[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [metrics, setMetrics] = useState<SecuritySyncDailyMetric[]>([]);
  const [topIps, setTopIps] = useState<{ source_ip: string; count: number }[]>([]);
  const [forbidden, setForbidden] = useState<ForbiddenInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<HistoryFilterState>(emptyFilters);
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      const [r, m] = await Promise.all([
        listFn({ data: {} }),
        metricsFn({ data: { days: 14 } }),
      ]);
      const denial = reasonFromResult(r) ?? reasonFromResult(m);
      if (denial) { setForbidden(denial); setLoading(false); return; }
      setForbidden(null);
      setAttempts(r.attempts ?? []);
      setCounts(r.counts24h ?? {});
      setMetrics(m.metrics ?? []);
      setTopIps(m.topIps ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load sync attempts");
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const filtered = useMemo(
    () => applyHistoryFilter(attempts, filters, {
      date: (a) => a.received_at,
      status: (a) => a.status,
      searchable: (a) => `${a.status} ${a.nonce ?? ""} ${a.source_ip ?? ""} ${a.error ?? ""}`,
    }),
    [attempts, filters],
  );
  const { slice, total, pages } = paginate(filtered, page, 25);

  const exportCols = [
    { key: "received_at", label: "Received", value: (a: SecuritySyncAttempt) => a.received_at },
    { key: "status", label: "Status", value: (a: SecuritySyncAttempt) => a.status },
    { key: "signature_valid", label: "Signature valid", value: (a: SecuritySyncAttempt) => String(a.signature_valid) },
    { key: "source_ip", label: "Source IP", value: (a: SecuritySyncAttempt) => a.source_ip ?? "" },
    { key: "nonce", label: "Nonce", value: (a: SecuritySyncAttempt) => a.nonce ?? "" },
    { key: "payload_bytes", label: "Bytes", value: (a: SecuritySyncAttempt) => a.payload_bytes ?? "" },
    { key: "finding_count", label: "Findings", value: (a: SecuritySyncAttempt) => a.finding_count ?? "" },
    { key: "duration_ms", label: "Duration (ms)", value: (a: SecuritySyncAttempt) => a.duration_ms ?? "" },
    { key: "error", label: "Error", value: (a: SecuritySyncAttempt) => a.error ?? "" },
  ];

  const runExport = async (format: "csv" | "json") => {
    const outcome = await runServerExport({ fn: exportFn as never, filters, format, basename: "security-sync-attempts", cols: exportCols });
    if (!outcome.ok) {
      if (outcome.denied) setForbidden(outcome.denied);
      else toast.error(outcome.error ?? "Export failed");
    }
  };

  if (forbidden) return <div className="p-10"><PermissionDeniedCard info={forbidden} onRetry={load} /></div>;

  return (
    <div className="p-10 max-w-6xl mx-auto">
      <PageHeader title="Security sync audit" sub="Every hit on /api/public/security-sync, with signature checks, replay detection, and outcome logging (last 24h summary + full history)." />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Stat label="Accepted" value={counts.accepted ?? 0} icon={<CheckCircle2 className="w-4 h-4" />} tone="bg-emerald-500/10 text-emerald-700" />
        <Stat label="Replays" value={counts.replay ?? 0} icon={<ShieldAlert className="w-4 h-4" />} tone="bg-orange-500/10 text-orange-700" />
        <Stat label="Bad signature" value={counts.invalid_signature ?? 0} icon={<XCircle className="w-4 h-4" />} tone="bg-rose-500/10 text-rose-700" />
        <Stat label="Bad payload" value={counts.invalid_payload ?? 0} icon={<AlertCircle className="w-4 h-4" />} tone="bg-amber-500/10 text-amber-700" />
        <Stat label="Write failed" value={counts.write_failed ?? 0} icon={<AlertCircle className="w-4 h-4" />} tone="bg-rose-500/10 text-rose-700" />
      </div>

      <MetricsPanel metrics={metrics} topIps={topIps} />



      <div className="mb-2 text-xs text-muted-foreground flex items-center gap-2">
        <Clock className="w-3 h-3" /> Auto-refresh every 15s
        <Button variant="ghost" size="sm" className="h-7 text-xs ml-auto" onClick={load}>
          <RefreshCw className="w-3 h-3 mr-1" />Refresh
        </Button>
      </div>

      <HistoryFilters
        value={filters}
        onChange={(v) => { setFilters(v); setPage(1); }}
        statusOptions={[
          { value: "accepted", label: "Accepted" },
          { value: "replay", label: "Replay" },
          { value: "invalid_signature", label: "Invalid signature" },
          { value: "invalid_payload", label: "Invalid payload" },
          { value: "write_failed", label: "Write failed" },
          { value: "disabled", label: "Disabled" },
        ]}
        searchPlaceholder="Nonce, IP, error…"
        onExportCsv={() => void runExport("csv")}
        onExportJson={() => void runExport("json")}
      />

      <div className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No sync attempts match the current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground uppercase tracking-wider bg-muted/30">
                <tr>
                  <th className="text-left py-2 px-3">Received</th>
                  <th className="text-left py-2 px-3">Status</th>
                  <th className="text-left py-2 px-3">Source IP</th>
                  <th className="text-left py-2 px-3">Nonce</th>
                  <th className="text-right py-2 px-3">Bytes</th>
                  <th className="text-right py-2 px-3">Findings</th>
                  <th className="text-right py-2 px-3">Duration</th>
                  <th className="text-left py-2 px-3">Error</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((a) => (
                  <tr key={a.id} className="border-t border-border/60 align-top">
                    <td className="py-2 px-3 whitespace-nowrap">{new Date(a.received_at).toLocaleString()}</td>
                    <td className="py-2 px-3"><span className={`inline-block px-2 py-0.5 rounded border ${STATUS_TONE[a.status]}`}>{a.status}</span></td>
                    <td className="py-2 px-3 font-mono">{a.source_ip ?? "—"}</td>
                    <td className="py-2 px-3 font-mono max-w-[220px] truncate" title={a.nonce ?? ""}>{a.nonce ?? "—"}</td>
                    <td className="py-2 px-3 text-right">{a.payload_bytes ?? "—"}</td>
                    <td className="py-2 px-3 text-right">{a.finding_count ?? "—"}</td>
                    <td className="py-2 px-3 text-right">{a.duration_ms != null ? `${a.duration_ms}ms` : "—"}</td>
                    <td className="py-2 px-3 max-w-md break-words text-rose-700">{a.error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="text-xs text-muted-foreground mt-2">Showing {slice.length} of {total}</div>
      <Pager page={page} pages={pages} onPage={setPage} />
    </div>
  );
}

function MetricsPanel({ metrics, topIps }: { metrics: SecuritySyncDailyMetric[]; topIps: { source_ip: string; count: number }[] }) {
  // Roll up by day into an accepted / non-accepted split so the panel gives
  // admins a quick "healthy?" read without opening the table.
  // Roll up by day into an accepted / non-accepted split so the panel gives
  // admins a quick "healthy?" read without opening the table. Shared helper so
  // the parity test asserts the exact numbers rendered here.
  const rollup = rollupByDay(metrics, 14);
  const days: [string, { accepted: number; other: number }][] = rollup.map((r) => [r.day, { accepted: r.accepted, other: r.other }]);
  const maxTotal = Math.max(1, ...rollup.map((r) => r.total));


  if (metrics.length === 0 && topIps.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-card p-4 mb-6 grid md:grid-cols-3 gap-4">
      <div className="md:col-span-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Last 14 days — accepted vs failed</div>
        {days.length === 0 ? (
          <div className="text-xs text-muted-foreground">No attempts in window.</div>
        ) : (
          <div className="flex items-end gap-1 h-24">
            {days.slice().reverse().map(([day, v]) => {
              const total = v.accepted + v.other;
              const h = (total / maxTotal) * 100;
              const okPct = total > 0 ? (v.accepted / total) * 100 : 0;
              return (
                <div key={day} className="flex-1 flex flex-col items-center gap-1" title={`${day}: ${v.accepted} accepted, ${v.other} failed`}>
                  <div className="w-full bg-muted/30 rounded overflow-hidden flex flex-col justify-end" style={{ height: `${Math.max(4, h)}%` }}>
                    <div className="bg-rose-500/70" style={{ height: `${100 - okPct}%` }} />
                    <div className="bg-emerald-500/70" style={{ height: `${okPct}%` }} />
                  </div>
                  <div className="text-[9px] text-muted-foreground">{day.slice(5)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Top offender IPs (14d)</div>
        {topIps.length === 0 ? (
          <div className="text-xs text-muted-foreground">No failed attempts.</div>
        ) : (
          <ul className="text-xs space-y-1">
            {topIps.slice(0, 5).map((ip) => (
              <li key={ip.source_ip} className="flex justify-between font-mono">
                <span className="truncate">{ip.source_ip}</span>
                <span className="text-rose-700 ml-2">{ip.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: string }) {
  return (
    <div className={`rounded-xl border border-border p-4 ${tone}`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider opacity-80">{icon}{label}</div>
      <div className="text-3xl font-serif mt-1">{value}</div>
    </div>
  );
}
