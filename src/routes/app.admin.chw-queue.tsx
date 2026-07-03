import { createFileRoute, redirect } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Clock, Loader2, RefreshCw, TimerReset } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { listAdminQueue, requeueAssignment, requeueFailed } from "@/lib/chw.functions";
import { PermissionDeniedCard } from "@/components/admin/PermissionDeniedCard";
import { reasonFromResult, type ForbiddenInfo } from "@/lib/permission";
import { HistoryFilters, type HistoryFilterState, emptyFilters, applyHistoryFilter, paginate, Pager } from "@/components/admin/HistoryFilters";
import { downloadCsv, downloadJson, timestampedName } from "@/lib/exports";
import { PageHeader } from "../routes/app";

export const Route = createFileRoute("/app/admin/chw-queue")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [{ title: "CHW Queue — ApexCare AI" }, { name: "robots", content: "noindex" }] }),
  component: ChwQueuePage,
});

type Row = {
  id: string;
  task_type: string;
  priority: string;
  status: string;
  due_at: string | null;
  created_at: string;
  retry_count: number;
  last_error: string | null;
  last_error_at: string | null;
  chw_id: string | null;
  patient_id: string;
  chw: { display_name: string } | null;
};

type Tab = "all" | "stuck" | "failed";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-700",
  accepted: "bg-sky-500/10 text-sky-700",
  in_progress: "bg-blue-500/10 text-blue-700",
  completed: "bg-emerald-500/10 text-emerald-700",
  cancelled: "bg-muted text-muted-foreground",
  escalated: "bg-rose-500/10 text-rose-700",
};

function isStuck(r: Row): boolean {
  const age = Date.now() - new Date(r.created_at).getTime();
  if ((r.status === "pending" || r.status === "accepted") && age > 30 * 60 * 1000) return true;
  if (r.status === "in_progress" && age > 2 * 60 * 60 * 1000) return true;
  return false;
}
function isFailed(r: Row): boolean {
  return r.status === "cancelled" || r.status === "escalated" || !!r.last_error;
}

function ChwQueuePage() {
  const listFn = useServerFn(listAdminQueue);
  const requeueFn = useServerFn(requeueAssignment);
  const requeueBulkFn = useServerFn(requeueFailed);

  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [buckets, setBuckets] = useState({ stuck: 0, failed: 0, breached: 0 });
  const [tab, setTab] = useState<Tab>("all");
  const [forbidden, setForbidden] = useState<ForbiddenInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [requeuing, setRequeuing] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [filters, setFilters] = useState<HistoryFilterState>(emptyFilters);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    try {
      const r = await listFn({ data: { stuckOnly: tab === "stuck" } });
      const denial = reasonFromResult(r);
      if (denial) { setForbidden(denial); setLoading(false); return; }
      setForbidden(null);
      setRows((r.rows ?? []) as Row[]);
      setCounts((r.counts ?? {}) as Record<string, number>);
      if (r.buckets) setBuckets(r.buckets);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load queue");
    }
    setLoading(false);
  };

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); /* eslint-disable-next-line */ }, [tab]);

  const filtered = useMemo(() => {
    let base = rows;
    if (tab === "stuck") base = base.filter(isStuck);
    if (tab === "failed") base = base.filter(isFailed);
    return applyHistoryFilter(base, filters, {
      date: (r) => r.created_at,
      status: (r) => r.status,
      searchable: (r) => `${r.task_type} ${r.priority} ${r.chw?.display_name ?? ""} ${r.last_error ?? ""} ${r.id}`,
    });
  }, [rows, filters, tab]);

  const { slice, total, pages } = paginate(filtered, page, 25);

  const handleRequeue = async (id: string) => {
    setRequeuing(id);
    try {
      const r = await requeueFn({ data: { id } });
      if (r.ok) { toast.success(`Re-queued (attempt ${r.retry_count})`); load(); }
      else toast.error(r.error ?? "Re-queue failed");
    } finally { setRequeuing(null); }
  };

  const handleBulkRequeue = async () => {
    const ids = filtered.filter(isFailed).map((r) => r.id);
    if (ids.length === 0) { toast.message("No failed assignments in current view."); return; }
    setBulkRunning(true);
    try {
      const r = await requeueBulkFn({ data: { ids } });
      if (r.ok) {
        toast.success(`Re-queued ${r.requeued} failed assignment${r.requeued === 1 ? "" : "s"}.`);
        load();
      } else toast.error(r.error ?? "Bulk re-queue failed");
    } finally { setBulkRunning(false); }
  };

  const toggleRow = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const exportCols = [
    { key: "created_at", label: "Created", value: (r: Row) => r.created_at },
    { key: "task_type", label: "Task", value: (r: Row) => r.task_type },
    { key: "priority", label: "Priority", value: (r: Row) => r.priority },
    { key: "status", label: "Status", value: (r: Row) => r.status },
    { key: "retry_count", label: "Retries", value: (r: Row) => r.retry_count },
    { key: "chw", label: "CHW", value: (r: Row) => r.chw?.display_name ?? "" },
    { key: "due_at", label: "Due", value: (r: Row) => r.due_at ?? "" },
    { key: "last_error", label: "Last error", value: (r: Row) => r.last_error ?? "" },
    { key: "last_error_at", label: "Last error at", value: (r: Row) => r.last_error_at ?? "" },
  ];

  if (forbidden) return <div className="p-10"><PermissionDeniedCard info={forbidden} onRetry={load} /></div>;

  const failedInView = filtered.filter(isFailed).length;

  return (
    <div className="p-10 max-w-7xl mx-auto">
      <PageHeader title="CHW queue" sub="Live assignment status across the mesh. Re-run stuck or failed jobs without leaving the page." />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
        <BucketCard label="Stuck" value={buckets.stuck} tone="amber" icon={<Clock className="w-4 h-4" />} active={tab === "stuck"} onClick={() => setTab("stuck")} />
        <BucketCard label="Failed / errored" value={buckets.failed} tone="rose" icon={<AlertTriangle className="w-4 h-4" />} active={tab === "failed"} onClick={() => setTab("failed")} />
        <BucketCard label="SLA breached (past due)" value={buckets.breached} tone="orange" icon={<TimerReset className="w-4 h-4" />} active={false} onClick={() => setTab("all")} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
        {(["pending", "accepted", "in_progress", "completed", "cancelled", "escalated"] as const).map((s) => (
          <div key={s} className={`rounded-xl border border-border p-3 ${STATUS_COLORS[s] ?? ""}`}>
            <div className="text-[10px] uppercase tracking-wider opacity-80">{s.replace("_", " ")}</div>
            <div className="text-2xl font-serif">{counts[s] ?? 0}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="inline-flex rounded-lg border border-border p-0.5 text-xs">
          {(["all", "stuck", "failed"] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setPage(1); }}
              className={`px-3 py-1 rounded-md transition ${tab === t ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t === "all" ? "All" : t === "stuck" ? `Stuck (${buckets.stuck})` : `Failed (${buckets.failed})`}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={load} className="h-7 text-xs"><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={handleBulkRequeue}
          disabled={bulkRunning || failedInView === 0}
          title={failedInView === 0 ? "No failed assignments in current view" : `Re-run ${failedInView} failed assignment(s)`}
        >
          {bulkRunning ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
          Re-run failed only ({failedInView})
        </Button>
      </div>

      <HistoryFilters
        value={filters}
        onChange={(v) => { setFilters(v); setPage(1); }}
        statusOptions={[
          { value: "pending", label: "Pending" },
          { value: "accepted", label: "Accepted" },
          { value: "in_progress", label: "In progress" },
          { value: "completed", label: "Completed" },
          { value: "cancelled", label: "Cancelled" },
          { value: "escalated", label: "Escalated" },
        ]}
        searchPlaceholder="Task, CHW, error, id…"
        onExportCsv={() => downloadCsv(timestampedName("chw-queue"), filtered, exportCols)}
        onExportJson={() => downloadJson(timestampedName("chw-queue"), filtered)}
      />

      <div className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No assignments match the current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground uppercase tracking-wider bg-muted/30">
                <tr>
                  <th className="w-8"></th>
                  <th className="text-left py-2 px-3">Created</th>
                  <th className="text-left py-2 px-3">Task</th>
                  <th className="text-left py-2 px-3">Priority</th>
                  <th className="text-left py-2 px-3">Status</th>
                  <th className="text-left py-2 px-3">CHW</th>
                  <th className="text-left py-2 px-3">Retries</th>
                  <th className="text-left py-2 px-3">Last error</th>
                  <th className="text-right py-2 px-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((r) => {
                  const stuck = isStuck(r);
                  const failed = isFailed(r);
                  const open = expanded.has(r.id);
                  return (
                    <Fragment key={r.id}>
                      <tr className="border-t border-border/60 align-top">
                        <td className="py-2 px-2 align-middle">
                          <button onClick={() => toggleRow(r.id)} className="text-muted-foreground hover:text-foreground" aria-label="Toggle details">
                            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          </button>
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                        <td className="py-2 px-3"><code>{r.task_type}</code></td>
                        <td className="py-2 px-3">{r.priority}</td>
                        <td className="py-2 px-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${STATUS_COLORS[r.status] ?? ""}`}>
                            {r.status === "completed" ? <CheckCircle2 className="w-3 h-3" /> :
                              stuck || failed ? <AlertTriangle className="w-3 h-3" /> :
                                <Clock className="w-3 h-3" />}
                            {r.status}
                          </span>
                        </td>
                        <td className="py-2 px-3">{r.chw?.display_name ?? <span className="text-muted-foreground">unassigned</span>}</td>
                        <td className="py-2 px-3">{r.retry_count}</td>
                        <td className="py-2 px-3 max-w-[260px] truncate text-rose-700" title={r.last_error ?? ""}>{r.last_error ?? "—"}</td>
                        <td className="py-2 px-3 text-right">
                          {(stuck || failed) && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={requeuing === r.id} onClick={() => handleRequeue(r.id)}>
                              {requeuing === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><RefreshCw className="w-3 h-3 mr-1" />Re-run</>}
                            </Button>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-muted/20 border-t border-border/40">
                          <td colSpan={9} className="py-3 px-6 text-xs space-y-1">
                            <div><span className="text-muted-foreground">Assignment ID:</span> <code>{r.id}</code></div>
                            <div><span className="text-muted-foreground">Patient ID:</span> <code>{r.patient_id}</code></div>
                            <div><span className="text-muted-foreground">Due at:</span> {r.due_at ? new Date(r.due_at).toLocaleString() : "—"}</div>
                            <div><span className="text-muted-foreground">Last error at:</span> {r.last_error_at ? new Date(r.last_error_at).toLocaleString() : "—"}</div>
                            {r.last_error && (
                              <pre className="bg-background border border-border rounded p-2 mt-2 whitespace-pre-wrap break-words text-rose-700">{r.last_error}</pre>
                            )}
                            {stuck && <div className="text-amber-700">⚠ Stuck: exceeded SLA window for status <code>{r.status}</code>.</div>}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
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

function BucketCard({ label, value, tone, icon, active, onClick }: { label: string; value: number; tone: "amber" | "rose" | "orange"; icon: React.ReactNode; active: boolean; onClick: () => void }) {
  const toneClass = tone === "amber" ? "border-amber-500/40 bg-amber-500/5 text-amber-800" :
    tone === "rose" ? "border-rose-500/40 bg-rose-500/5 text-rose-800" :
      "border-orange-500/40 bg-orange-500/5 text-orange-800";
  return (
    <button onClick={onClick} className={`rounded-xl border p-3 text-left transition ${toneClass} ${active ? "ring-2 ring-offset-1 ring-foreground/20" : "hover:brightness-105"}`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider opacity-80">{icon}{label}</div>
      <div className="text-2xl font-serif mt-1">{value}</div>
    </button>
  );
}
