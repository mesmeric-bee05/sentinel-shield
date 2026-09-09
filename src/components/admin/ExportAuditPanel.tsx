// Admin-only view of who downloaded security data, when, with which filters
// and over which scan window. Reads through listSecurityExportAudit, which
// re-verifies the admin role server-side.
//
// Supports search/filtering by actor, dataset (export kind), scan window and
// created-at range, plus a direct Sentry link per row via the correlation ID.
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2, RefreshCw, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listSecurityExportAudit, type SecurityExportAuditRow } from "@/lib/security.functions";
import { reasonFromResult, type ForbiddenInfo } from "@/lib/permission";
import { PermissionDeniedCard } from "@/components/admin/PermissionDeniedCard";
import { EXPORT_DATASETS, datasetLabel } from "@/lib/security-export-datasets";
import { sentrySearchUrl } from "@/lib/sentry-link";
import { ExportPresetBar } from "@/components/admin/ExportPresetBar";

const PAGE_SIZE = 20;

type Filters = { actor: string; kind: string; from: string; to: string; windowFrom: string; windowTo: string };
const EMPTY: Filters = { actor: "", kind: "", from: "", to: "", windowFrom: "", windowTo: "" };

const startOfDay = (d: string) => (d ? new Date(`${d}T00:00:00.000Z`).toISOString() : null);
const endOfDay = (d: string) => (d ? new Date(`${d}T23:59:59.999Z`).toISOString() : null);

export function ExportAuditPanel() {
  const listFn = useServerFn(listSecurityExportAudit);
  const [rows, setRows] = useState<SecurityExportAuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState<ForbiddenInfo | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);

  const load = async (p = page, f = applied) => {
    setLoading(true);
    try {
      const res = await listFn({
        data: {
          page: p,
          pageSize: PAGE_SIZE,
          actor: f.actor || null,
          kind: f.kind || null,
          from: startOfDay(f.from),
          to: endOfDay(f.to),
          windowFrom: startOfDay(f.windowFrom),
          windowTo: endOfDay(f.windowTo),
        },
      });
      const d = reasonFromResult(res);
      if (d) { setDenied(d); setRows([]); }
      else { setDenied(null); setRows(res.rows); setTotal(res.pagination.total); }
    } catch { /* surfaced via empty state */ }
    setLoading(false);
  };

  useEffect(() => { load(page, applied); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page, applied]);

  if (denied) return <PermissionDeniedCard info={denied} onRetry={() => load(1, applied)} />;

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const set = (k: keyof Filters) => (v: string) => setFilters((s) => ({ ...s, [k]: v }));
  const apply = () => { setPage(1); setApplied(filters); };
  const clear = () => { setFilters(EMPTY); setPage(1); setApplied(EMPTY); };

  // Applying a preset sets every field at once and immediately re-runs the
  // query from page 1 (the effect on `applied` triggers the reload).
  const day = (v: string | null) => (v ? v.slice(0, 10) : "");
  const applyPreset = (p: { dataset: string | null; actor_filter: string | null; date_from: string | null; date_to: string | null; scan_window_from: string | null; scan_window_to: string | null }) => {
    const next: Filters = {
      actor: p.actor_filter ?? "",
      kind: p.dataset ?? "",
      from: day(p.date_from),
      to: day(p.date_to),
      windowFrom: day(p.scan_window_from),
      windowTo: day(p.scan_window_to),
    };
    setFilters(next);
    setPage(1);
    setApplied(next);
  };


  return (
    <section className="rounded-2xl border border-border bg-card shadow-card overflow-hidden mt-6">
      <header className="px-5 py-3 border-b border-border/60 flex items-center gap-2">
        <Download className="w-4 h-4 text-muted-foreground" />
        <h2 className="font-serif text-base">Export audit</h2>
        <span className="text-xs text-muted-foreground">Every security data download: actor, filters, scan window, row count.</span>
        <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={() => load(page, applied)}>
          <RefreshCw className="w-3 h-3 mr-1" />Refresh
        </Button>
      </header>

      <div className="px-5 py-3 border-b border-border/60 grid gap-2 md:grid-cols-6 text-xs">
        <Input className="h-8 text-xs" placeholder="Actor ID…" value={filters.actor} onChange={(e) => set("actor")(e.target.value)} />
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={filters.kind}
          onChange={(e) => set("kind")(e.target.value)}
          aria-label="Export type"
        >
          <option value="">All datasets</option>
          {EXPORT_DATASETS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
        <label className="flex items-center gap-1">
          <span className="text-muted-foreground whitespace-nowrap">From</span>
          <Input type="date" className="h-8 text-xs" value={filters.from} onChange={(e) => set("from")(e.target.value)} />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-muted-foreground whitespace-nowrap">To</span>
          <Input type="date" className="h-8 text-xs" value={filters.to} onChange={(e) => set("to")(e.target.value)} />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-muted-foreground whitespace-nowrap">Window ≥</span>
          <Input type="date" className="h-8 text-xs" value={filters.windowFrom} onChange={(e) => set("windowFrom")(e.target.value)} />
        </label>
        <div className="flex gap-2">
          <label className="flex items-center gap-1 flex-1">
            <span className="text-muted-foreground whitespace-nowrap">≤</span>
            <Input type="date" className="h-8 text-xs" value={filters.windowTo} onChange={(e) => set("windowTo")(e.target.value)} />
          </label>
          <Button size="sm" className="h-8 text-xs" onClick={apply}>Apply</Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={clear} aria-label="Clear filters"><X className="w-3 h-3" /></Button>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading export audit…</div>
      ) : rows.length === 0 ? (
        <div className="p-8 text-center text-xs text-muted-foreground">No exports match these filters.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground uppercase tracking-wider bg-muted/30">
              <tr>
                <th className="text-left py-2 px-3">When</th>
                <th className="text-left py-2 px-3">Actor</th>
                <th className="text-left py-2 px-3">Dataset</th>
                <th className="text-left py-2 px-3">Filters</th>
                <th className="text-left py-2 px-3">Scan window</th>
                <th className="text-left py-2 px-3">Rows</th>
                <th className="text-left py-2 px-3">Duration</th>
                <th className="text-left py-2 px-3">Event</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const link = sentrySearchUrl(r.correlation_id);
                return (
                  <tr key={r.id} className="border-t border-border/60 align-top">
                    <td className="py-2 px-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="py-2 px-3 font-mono text-[11px]">{r.actor_id.slice(0, 8)}…</td>
                    <td className="py-2 px-3">{datasetLabel(r.export_kind)}</td>
                    <td className="py-2 px-3 font-mono text-[11px] max-w-xs break-words">{JSON.stringify(r.filters)}</td>
                    <td className="py-2 px-3 whitespace-nowrap text-[11px]">
                      {r.scan_window_from ? new Date(r.scan_window_from).toLocaleDateString() : "—"} → {r.scan_window_to ? new Date(r.scan_window_to).toLocaleDateString() : "—"}
                    </td>
                    <td className="py-2 px-3 font-mono">{r.row_count}</td>
                    <td className="py-2 px-3 font-mono">{r.duration_ms ?? "—"}ms</td>
                    <td className="py-2 px-3 font-mono text-[11px]">
                      {link ? (
                        <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline hover:text-foreground">
                          <ExternalLink className="w-3 h-3" />{(r.correlation_id ?? "").slice(0, 8)}
                        </a>
                      ) : (
                        (r.correlation_id ?? "—").slice(0, 8)
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <footer className="px-5 py-2 border-t border-border/60 flex items-center gap-2 text-xs text-muted-foreground">
        <span>Showing {rows.length} of {total}</span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
          <span className="self-center">{page} / {pages}</span>
          <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </footer>
    </section>
  );
}
