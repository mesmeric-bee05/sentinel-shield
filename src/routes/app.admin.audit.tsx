import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Download, Filter, Loader2, Search, Shield, ChevronLeft, ChevronRight } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { listAuditEvents, distinctAuditFacets } from "@/server/audit.functions";
import { PageHeader } from "./app";

export const Route = createFileRoute("/app/admin/audit")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [{ title: "Audit log — ApexCare AI" }] }),
  component: AuditPage,
});

type Row = { id: string; created_at: string; actor_id: string | null; entity: string; entity_id: string | null; action: string; meta: Record<string, unknown> | null; actor: { email: string | null; full_name: string | null } | null };

function AuditPage() {
  const list = useServerFn(listAuditEvents);
  const facets = useServerFn(distinctAuditFacets);
  const [items, setItems] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [entity, setEntity] = useState("");
  const [action, setAction] = useState("");
  const [actorEmail, setActorEmail] = useState("");
  const [entities, setEntities] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);

  useEffect(() => {
    facets({}).then((r) => { setEntities(r.entities); setActions(r.actions); }).catch(() => {});
  }, [facets]);

  const load = async () => {
    setLoading(true);
    const r = await list({ data: {
      from: from ? new Date(from).toISOString() : null,
      to: to ? new Date(to).toISOString() : null,
      entity: entity || null,
      action: action || null,
      actorEmail: actorEmail || null,
      page, pageSize, forExport: false,
    }});
    if (r.error === "Forbidden") { setForbidden(true); setLoading(false); return; }
    setItems(r.items as Row[]); setTotal(r.total); setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page]);

  const apply = () => { setPage(0); load(); };
  const reset = () => { setFrom(""); setTo(""); setEntity(""); setAction(""); setActorEmail(""); setPage(0); setTimeout(load, 0); };

  const exportCsv = async () => {
    setExporting(true);
    const r = await list({ data: {
      from: from ? new Date(from).toISOString() : null,
      to: to ? new Date(to).toISOString() : null,
      entity: entity || null, action: action || null,
      actorEmail: actorEmail || null,
      page: 0, pageSize: 5000, forExport: true,
    }});
    setExporting(false);
    const headers = ["timestamp","actor_email","actor_id","entity","entity_id","action","meta"];
    const csv = [headers.join(",")].concat(
      (r.items as Row[]).map((row) => [
        row.created_at,
        row.actor?.email ?? "",
        row.actor_id ?? "",
        row.entity,
        row.entity_id ?? "",
        row.action,
        JSON.stringify(row.meta ?? {}),
      ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    ).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `apexcare-audit-${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  if (forbidden) return (
    <div className="p-10 max-w-3xl mx-auto">
      <PageHeader title="Audit log" sub="Admin role required." />
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Restricted.</div>
    </div>
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="p-10 max-w-7xl mx-auto">
      <PageHeader title="Audit log" sub="Tamper-evident record of every privileged action and patient interaction." action={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting}>
            {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />} Export CSV
          </Button>
        </div>
      } />

      <div className="rounded-2xl border border-border bg-card p-4 mb-6 grid md:grid-cols-6 gap-3 shadow-card">
        <div className="md:col-span-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">From</label>
          <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="md:col-span-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">To</label>
          <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="md:col-span-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Entity</label>
          <Select value={entity || "__all"} onValueChange={(v) => setEntity(v === "__all" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All entities</SelectItem>
              {entities.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Action</label>
          <Select value={action || "__all"} onValueChange={(v) => setAction(v === "__all" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All actions</SelectItem>
              {actions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Actor email</label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-7" value={actorEmail} onChange={(e) => setActorEmail(e.target.value)} placeholder="contains…" />
          </div>
        </div>
        <div className="md:col-span-1 flex items-end gap-2">
          <Button onClick={apply} className="flex-1"><Filter className="w-4 h-4 mr-2" />Apply</Button>
          <Button variant="ghost" onClick={reset}>Reset</Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr><th className="text-left px-4 py-3">Timestamp</th><th className="text-left px-4 py-3">Actor</th><th className="text-left px-4 py-3">Entity</th><th className="text-left px-4 py-3">Action</th><th className="text-left px-4 py-3">Meta</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="p-10 text-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline" /></td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={5} className="p-10 text-center text-muted-foreground">No events match these filters.</td></tr>
            ) : items.map((r) => (
              <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-4 py-3 font-mono text-xs">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-4 py-3"><div className="text-xs">{r.actor?.email ?? <span className="text-muted-foreground">system</span>}</div><div className="text-[10px] text-muted-foreground font-mono">{r.actor_id?.slice(0,8)}</div></td>
                <td className="px-4 py-3"><div className="text-xs">{r.entity}</div><div className="text-[10px] text-muted-foreground font-mono">{r.entity_id?.slice(0,8)}</div></td>
                <td className="px-4 py-3"><span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-accent/10 text-accent">{r.action}</span></td>
                <td className="px-4 py-3">
                  {r.meta && Object.keys(r.meta).length > 0 ? (
                    <Popover>
                      <PopoverTrigger asChild><Button variant="ghost" size="sm">View</Button></PopoverTrigger>
                      <PopoverContent className="w-96"><pre className="text-xs whitespace-pre-wrap">{JSON.stringify(r.meta, null, 2)}</pre></PopoverContent>
                    </Popover>
                  ) : <span className="text-xs text-muted-foreground">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
        <div className="inline-flex items-center gap-1"><Shield className="w-3 h-3" /> {total.toLocaleString()} events</div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}><ChevronLeft className="w-4 h-4" /></Button>
          <span>Page {page + 1} / {totalPages}</span>
          <Button size="sm" variant="ghost" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      </div>
    </div>
  );
}
