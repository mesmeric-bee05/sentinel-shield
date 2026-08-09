// Admin-only view of who downloaded security data, when, with which filters
// and over which scan window. Reads through listSecurityExportAudit, which
// re-verifies the admin role server-side.
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listSecurityExportAudit, type SecurityExportAuditRow } from "@/lib/security.functions";
import { reasonFromResult, type ForbiddenInfo } from "@/lib/permission";
import { PermissionDeniedCard } from "@/components/admin/PermissionDeniedCard";

const PAGE_SIZE = 20;

export function ExportAuditPanel() {
  const listFn = useServerFn(listSecurityExportAudit);
  const [rows, setRows] = useState<SecurityExportAuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState<ForbiddenInfo | null>(null);

  const load = async (p = page) => {
    setLoading(true);
    try {
      const res = await listFn({ data: { page: p, pageSize: PAGE_SIZE } });
      const d = reasonFromResult(res);
      if (d) { setDenied(d); setRows([]); }
      else { setDenied(null); setRows(res.rows); setTotal(res.pagination.total); }
    } catch { /* surfaced via empty state */ }
    setLoading(false);
  };

  useEffect(() => { load(page); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page]);

  if (denied) return <PermissionDeniedCard info={denied} onRetry={() => load(1)} />;

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="rounded-2xl border border-border bg-card shadow-card overflow-hidden mt-6">
      <header className="px-5 py-3 border-b border-border/60 flex items-center gap-2">
        <Download className="w-4 h-4 text-muted-foreground" />
        <h2 className="font-serif text-base">Export audit</h2>
        <span className="text-xs text-muted-foreground">Every security data download: actor, filters, scan window, row count.</span>
        <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={() => load(page)}>
          <RefreshCw className="w-3 h-3 mr-1" />Refresh
        </Button>
      </header>
      {loading ? (
        <div className="p-8 text-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading export audit…</div>
      ) : rows.length === 0 ? (
        <div className="p-8 text-center text-xs text-muted-foreground">No exports recorded yet.</div>
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
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border/60 align-top">
                  <td className="py-2 px-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="py-2 px-3 font-mono text-[11px]">{r.actor_id.slice(0, 8)}…</td>
                  <td className="py-2 px-3">{r.export_kind}</td>
                  <td className="py-2 px-3 font-mono text-[11px] max-w-xs break-words">{JSON.stringify(r.filters)}</td>
                  <td className="py-2 px-3 whitespace-nowrap text-[11px]">
                    {r.scan_window_from ? new Date(r.scan_window_from).toLocaleDateString() : "—"} → {r.scan_window_to ? new Date(r.scan_window_to).toLocaleDateString() : "—"}
                  </td>
                  <td className="py-2 px-3 font-mono">{r.row_count}</td>
                  <td className="py-2 px-3 font-mono">{r.duration_ms ?? "—"}ms</td>
                </tr>
              ))}
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
