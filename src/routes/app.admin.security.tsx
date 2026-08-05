import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, CheckCircle2, AlertCircle, RefreshCw, Loader2, FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { listSecurityFindings, exportSecurityFindings } from "@/lib/security.functions";
import { runServerExport } from "@/lib/security-export-client";
import { PermissionDeniedCard } from "@/components/admin/PermissionDeniedCard";
import { reasonFromResult, type ForbiddenInfo } from "@/lib/permission";
import { HistoryFilters, type HistoryFilterState, emptyFilters, applyHistoryFilter, paginate, Pager } from "@/components/admin/HistoryFilters";
import { PageHeader } from "./app";

export const Route = createFileRoute("/app/admin/security")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [{ title: "Security tracker — ApexCare AI" }, { name: "robots", content: "noindex" }] }),
  component: SecurityPage,
});

type Finding = {
  id: string;
  scanner_name: string;
  internal_id: string;
  title: string;
  severity: "error" | "warn" | "info";
  resource: string | null;
  status: "open" | "fixed" | "ignored";
  rationale: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

const SEVERITY_TONE: Record<Finding["severity"], string> = {
  error: "bg-rose-500/10 text-rose-700 border-rose-500/30",
  warn: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  info: "bg-sky-500/10 text-sky-700 border-sky-500/30",
};
const STATUS_TONE: Record<Finding["status"], string> = {
  fixed: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  ignored: "bg-muted text-muted-foreground border-border",
  open: "bg-rose-500/10 text-rose-700 border-rose-500/30",
};

function SecurityPage() {
  const listFn = useServerFn(listSecurityFindings);
  const exportFn = useServerFn(exportSecurityFindings);
  const [exporting, setExporting] = useState(false);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [counts, setCounts] = useState({ open: 0, fixed: 0, ignored: 0 });
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
      setFindings((r.findings ?? []) as Finding[]);
      setCounts(r.counts ?? { open: 0, fixed: 0, ignored: 0 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load findings");
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const filtered = useMemo(
    () => applyHistoryFilter(findings, filters, {
      date: (f) => f.last_seen_at,
      status: (f) => f.status,
      searchable: (f) => `${f.title} ${f.internal_id} ${f.resource ?? ""} ${f.scanner_name} ${f.rationale ?? ""}`,
    }),
    [findings, filters],
  );
  const { slice, total, pages } = paginate(filtered, page, 25);

  const exportCols = [
    { key: "status", label: "Status", value: (f: Finding) => f.status },
    { key: "severity", label: "Severity", value: (f: Finding) => f.severity },
    { key: "scanner_name", label: "Scanner", value: (f: Finding) => f.scanner_name },
    { key: "internal_id", label: "ID", value: (f: Finding) => f.internal_id },
    { key: "title", label: "Finding", value: (f: Finding) => f.title },
    { key: "resource", label: "Resource", value: (f: Finding) => f.resource ?? "" },
    { key: "rationale", label: "Rationale / resolution", value: (f: Finding) => f.rationale ?? "" },
    { key: "last_seen_at", label: "Last seen", value: (f: Finding) => f.last_seen_at },
  ];

  // Downloads go through the RBAC-enforced server export endpoint, not the
  // client-side list, so a non-admin can never produce a report file.
  const runExport = async (format: "csv" | "json") => {
    if (exporting) return;
    setExporting(true);
    const outcome = await runServerExport({ fn: exportFn as never, filters, format, basename: "security-findings", cols: exportCols });
    setExporting(false);
    if (!outcome.ok) {
      if (outcome.denied) setForbidden(outcome.denied);
      else toast.error(outcome.error ?? "Export failed");
    }
  };

  if (forbidden) return <div className="p-10"><PermissionDeniedCard info={forbidden} onRetry={load} /></div>;

  return (
    <div className="p-10 max-w-6xl mx-auto">
      <PageHeader title="Security tracker" sub="Live scanner findings synced from the security-sync webhook. Filter, export, and track resolution." />

      <div className="grid grid-cols-3 gap-3 mb-6">
        <Stat label="Open" value={counts.open} icon={<AlertCircle className="w-4 h-4" />} tone="bg-rose-500/10 text-rose-700" />
        <Stat label="Fixed" value={counts.fixed} icon={<CheckCircle2 className="w-4 h-4" />} tone="bg-emerald-500/10 text-emerald-700" />
        <Stat label="Accepted risk" value={counts.ignored} icon={<ShieldCheck className="w-4 h-4" />} tone="bg-muted text-muted-foreground" />
      </div>

      <div className="mb-4 text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
        <FileText className="w-3 h-3" />
        Accepted-risk rationale: <code>docs/security/accepted-risks.md</code>
        <Button variant="ghost" size="sm" className="h-7 text-xs ml-auto" onClick={load}>
          <RefreshCw className="w-3 h-3 mr-1" /> Refresh
        </Button>
      </div>

      <HistoryFilters
        value={filters}
        onChange={(v) => { setFilters(v); setPage(1); }}
        statusOptions={[
          { value: "open", label: "Open" },
          { value: "fixed", label: "Fixed" },
          { value: "ignored", label: "Accepted risk" },
        ]}
        searchPlaceholder="Finding, resource, scanner…"
        onExportCsv={() => void runExport("csv")}
        onExportJson={() => void runExport("json")}
      />

      <div className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No findings match the current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground uppercase tracking-wider bg-muted/30">
                <tr>
                  <th className="text-left py-2 px-3">Status</th>
                  <th className="text-left py-2 px-3">Severity</th>
                  <th className="text-left py-2 px-3">Finding</th>
                  <th className="text-left py-2 px-3">Resource</th>
                  <th className="text-left py-2 px-3">Scanner</th>
                  <th className="text-left py-2 px-3">Resolution / rationale</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((f) => (
                  <tr key={f.id} className="border-t border-border/60 align-top">
                    <td className="py-2 px-3"><span className={`inline-block px-2 py-0.5 rounded border ${STATUS_TONE[f.status]}`}>{f.status}</span></td>
                    <td className="py-2 px-3"><span className={`inline-block px-2 py-0.5 rounded border ${SEVERITY_TONE[f.severity]}`}>{f.severity}</span></td>
                    <td className="py-2 px-3 font-medium">{f.title}<div className="text-[10px] text-muted-foreground font-mono mt-0.5">{f.internal_id}</div></td>
                    <td className="py-2 px-3 font-mono text-[11px]">{f.resource ?? "—"}</td>
                    <td className="py-2 px-3">{f.scanner_name}</td>
                    <td className="py-2 px-3 max-w-md break-words">{f.rationale ?? "—"}</td>
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

function Stat({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: string }) {
  return (
    <div className={`rounded-xl border border-border p-4 ${tone}`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider opacity-80">{icon}{label}</div>
      <div className="text-3xl font-serif mt-1">{value}</div>
    </div>
  );
}
