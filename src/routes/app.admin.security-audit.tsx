import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { listSecurityFindingAudit, type SecurityFindingAuditRow } from "@/lib/security.functions";
import { PermissionDeniedCard } from "@/components/admin/PermissionDeniedCard";
import { reasonFromResult, type ForbiddenInfo } from "@/lib/permission";
import { HistoryFilters, type HistoryFilterState, emptyFilters, applyHistoryFilter, paginate, Pager } from "@/components/admin/HistoryFilters";
import { downloadCsv, downloadJson, timestampedName } from "@/lib/exports";
import { securityAuditExportCols } from "@/lib/security-audit-export";
import { PageHeader } from "./app";

export const Route = createFileRoute("/app/admin/security-audit")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [{ title: "Security finding audit — ApexCare AI" }, { name: "robots", content: "noindex" }] }),
  component: SecurityAuditPage,
});

const RESOLUTION_TONE: Record<string, string> = {
  fixed: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  ignored: "bg-muted text-muted-foreground border-border",
  reintroduced: "bg-rose-500/10 text-rose-700 border-rose-500/30",
};

function SecurityAuditPage() {
  const listFn = useServerFn(listSecurityFindingAudit);
  const [rows, setRows] = useState<SecurityFindingAuditRow[]>([]);
  const [counts, setCounts] = useState({ fixed: 0, ignored: 0, reintroduced: 0 });
  const [forbidden, setForbidden] = useState<ForbiddenInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<HistoryFilterState>(emptyFilters);
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      const r = await listFn({ data: {} });
      const denial = reasonFromResult(r);
      if (denial) { setForbidden(denial); setLoading(false); return; }
      setForbidden(null);
      setRows(r.rows ?? []);
      setCounts(r.counts ?? { fixed: 0, ignored: 0, reintroduced: 0 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load audit log");
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const filtered = useMemo(
    () => applyHistoryFilter(rows, filters, {
      date: (r) => r.created_at,
      status: (r) => r.resolution,
      searchable: (r) => `${r.internal_id} ${r.scanner_name} ${r.notes ?? ""} ${(r.affected_endpoints ?? []).join(" ")} ${(r.affected_queries ?? []).join(" ")}`,
    }),
    [rows, filters],
  );
  const { slice, total, pages } = paginate(filtered, page, 25);

  const exportCols = [
    { key: "created_at", label: "Recorded at", value: (r: SecurityFindingAuditRow) => r.created_at },
    { key: "resolution", label: "Resolution", value: (r: SecurityFindingAuditRow) => r.resolution },
    { key: "internal_id", label: "Internal ID", value: (r: SecurityFindingAuditRow) => r.internal_id },
    { key: "scanner_name", label: "Scanner", value: (r: SecurityFindingAuditRow) => r.scanner_name },
    { key: "resolved_by", label: "Resolved by", value: (r: SecurityFindingAuditRow) => r.resolved_by ?? "" },
    { key: "affected_endpoints", label: "Affected endpoints", value: (r: SecurityFindingAuditRow) => (r.affected_endpoints ?? []).join("; ") },
    { key: "affected_queries", label: "Affected queries", value: (r: SecurityFindingAuditRow) => (r.affected_queries ?? []).join("; ") },
    { key: "notes", label: "Notes", value: (r: SecurityFindingAuditRow) => r.notes ?? "" },
  ];

  if (forbidden) return <div className="p-10"><PermissionDeniedCard info={forbidden} onRetry={load} /></div>;

  return (
    <div className="p-10 max-w-6xl mx-auto">
      <PageHeader title="Security finding audit" sub="Immutable log of every permission-related security fix, ignore, or reintroduction — with the endpoints and queries touched." />

      <div className="grid grid-cols-3 gap-3 mb-6">
        <Stat label="Fixed" value={counts.fixed} tone="bg-emerald-500/10 text-emerald-700" />
        <Stat label="Ignored" value={counts.ignored} tone="bg-muted text-muted-foreground" />
        <Stat label="Reintroduced" value={counts.reintroduced} tone="bg-rose-500/10 text-rose-700" />
      </div>

      <div className="mb-4 flex justify-end">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={load}>
          <RefreshCw className="w-3 h-3 mr-1" /> Refresh
        </Button>
      </div>

      <HistoryFilters
        value={filters}
        onChange={(v) => { setFilters(v); setPage(1); }}
        statusOptions={[
          { value: "fixed", label: "Fixed" },
          { value: "ignored", label: "Ignored" },
          { value: "reintroduced", label: "Reintroduced" },
        ]}
        searchPlaceholder="Internal ID, scanner, endpoint, query…"
        onExportCsv={() => downloadCsv(timestampedName("security-finding-audit"), filtered, exportCols)}
        onExportJson={() => downloadJson(timestampedName("security-finding-audit"), filtered)}
      />

      <div className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No audit entries match the current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground uppercase tracking-wider bg-muted/30">
                <tr>
                  <th className="text-left py-2 px-3">When</th>
                  <th className="text-left py-2 px-3">Resolution</th>
                  <th className="text-left py-2 px-3">Finding</th>
                  <th className="text-left py-2 px-3">Scanner</th>
                  <th className="text-left py-2 px-3">Endpoints / queries</th>
                  <th className="text-left py-2 px-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((r) => (
                  <tr key={r.id} className="border-t border-border/60 align-top">
                    <td className="py-2 px-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="py-2 px-3">
                      <span className={`inline-block px-2 py-0.5 rounded border ${RESOLUTION_TONE[r.resolution] ?? RESOLUTION_TONE.ignored}`}>{r.resolution}</span>
                    </td>
                    <td className="py-2 px-3 font-mono text-[11px]">{r.internal_id}</td>
                    <td className="py-2 px-3">{r.scanner_name}</td>
                    <td className="py-2 px-3 max-w-sm break-words">
                      {(r.affected_endpoints ?? []).length > 0 && (
                        <div><span className="text-muted-foreground">endpoints:</span> <code className="text-[11px]">{(r.affected_endpoints ?? []).join(", ")}</code></div>
                      )}
                      {(r.affected_queries ?? []).length > 0 && (
                        <div><span className="text-muted-foreground">queries:</span> <code className="text-[11px]">{(r.affected_queries ?? []).join(", ")}</code></div>
                      )}
                      {(r.affected_endpoints ?? []).length === 0 && (r.affected_queries ?? []).length === 0 && "—"}
                    </td>
                    <td className="py-2 px-3 max-w-md break-words">{r.notes ?? "—"}</td>
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

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-xl border border-border p-4 ${tone}`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider opacity-80"><ShieldCheck className="w-4 h-4" />{label}</div>
      <div className="text-3xl font-serif mt-1">{value}</div>
    </div>
  );
}
