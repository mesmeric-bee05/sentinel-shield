import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { listAdminQueue, requeueAssignment } from "@/server/chw.functions";
import { PermissionDeniedCard } from "@/components/admin/PermissionDeniedCard";
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

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-700",
  accepted: "bg-sky-500/10 text-sky-700",
  in_progress: "bg-blue-500/10 text-blue-700",
  completed: "bg-emerald-500/10 text-emerald-700",
  cancelled: "bg-muted text-muted-foreground",
  escalated: "bg-rose-500/10 text-rose-700",
};

function ChwQueuePage() {
  const listFn = useServerFn(listAdminQueue);
  const requeueFn = useServerFn(requeueAssignment);

  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [stuckOnly, setStuckOnly] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [requeuing, setRequeuing] = useState<string | null>(null);
  const [filters, setFilters] = useState<HistoryFilterState>(emptyFilters);
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    const r = await listFn({ data: { stuckOnly } });
    if ("error" in r && r.error === "Forbidden") { setForbidden(true); setLoading(false); return; }
    setRows((r.rows ?? []) as Row[]);
    setCounts((r.counts ?? {}) as Record<string, number>);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [stuckOnly]);

  // Realtime subscription — refresh on any change.
  useEffect(() => {
    const channel = supabase
      .channel("admin-chw-queue")
      .on("postgres_changes", { event: "*", schema: "public", table: "chw_assignments" }, () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line
  }, [stuckOnly]);

  const filtered = useMemo(() => applyHistoryFilter(rows, filters, {
    date: (r) => r.created_at,
    status: (r) => r.status,
    searchable: (r) => `${r.task_type} ${r.priority} ${r.chw?.display_name ?? ""} ${r.last_error ?? ""} ${r.id}`,
  }), [rows, filters]);

  const { slice, total, pages } = paginate(filtered, page, 25);

  const handleRequeue = async (id: string) => {
    setRequeuing(id);
    const r = await requeueFn({ data: { id } });
    setRequeuing(null);
    if (r.ok) { toast.success(`Re-queued (attempt ${r.retry_count})`); load(); }
    else toast.error(r.error ?? "Re-queue failed");
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
  ];

  if (forbidden) return <div className="p-10"><PermissionDeniedCard /></div>;

  return (
    <div className="p-10 max-w-7xl mx-auto">
      <PageHeader title="CHW queue" sub="Live assignment status across the mesh. Re-run stuck jobs without leaving the page." />

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
        {(["pending", "accepted", "in_progress", "completed", "cancelled", "escalated"] as const).map((s) => (
          <div key={s} className={`rounded-xl border border-border p-3 ${STATUS_COLORS[s] ?? ""}`}>
            <div className="text-[10px] uppercase tracking-wider opacity-80">{s.replace("_", " ")}</div>
            <div className="text-2xl font-serif">{counts[s] ?? 0}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-3">
        <label className="text-xs flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={stuckOnly} onChange={(e) => setStuckOnly(e.target.checked)} />
          Stuck only (pending/accepted &gt; 30 min)
        </label>
        <Button variant="ghost" size="sm" onClick={load} className="h-7 text-xs"><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
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
                  const stuck = (r.status === "pending" || r.status === "accepted") &&
                    Date.now() - new Date(r.created_at).getTime() > 30 * 60 * 1000;
                  return (
                    <tr key={r.id} className="border-t border-border/60 align-top">
                      <td className="py-2 px-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="py-2 px-3"><code>{r.task_type}</code></td>
                      <td className="py-2 px-3">{r.priority}</td>
                      <td className="py-2 px-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${STATUS_COLORS[r.status] ?? ""}`}>
                          {r.status === "completed" ? <CheckCircle2 className="w-3 h-3" /> :
                            stuck ? <AlertTriangle className="w-3 h-3" /> :
                              <Clock className="w-3 h-3" />}
                          {r.status}
                        </span>
                      </td>
                      <td className="py-2 px-3">{r.chw?.display_name ?? <span className="text-muted-foreground">unassigned</span>}</td>
                      <td className="py-2 px-3">{r.retry_count}</td>
                      <td className="py-2 px-3 max-w-[260px] break-words text-rose-700">{r.last_error ?? "—"}</td>
                      <td className="py-2 px-3 text-right">
                        {(stuck || r.status === "escalated") && (
                          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={requeuing === r.id} onClick={() => handleRequeue(r.id)}>
                            {requeuing === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><RefreshCw className="w-3 h-3 mr-1" />Re-run</>}
                          </Button>
                        )}
                      </td>
                    </tr>
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
