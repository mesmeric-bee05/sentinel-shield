import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bell, ChevronLeft, ChevronRight, Download, Filter, Loader2, Mail, MessageSquare, Search, ShieldAlert } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { listNotificationEvents } from "@/server/notifications.functions";
import { PageHeader } from "./app";

export const Route = createFileRoute("/app/admin/notifications")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [{ title: "Notifications audit — ApexCare AI" }] }),
  component: NotificationsAuditPage,
});

type Row = {
  id: string; created_at: string; actor_id: string | null;
  entity: string; entity_id: string | null; action: string;
  meta: Record<string, unknown> | null;
  recipient: { email: string | null; full_name: string | null; phone_e164: string | null } | null;
};

const channelOf = (a: string) => (a.startsWith("email.") ? "email" : a.startsWith("sms.") ? "sms" : "other");
const statusOf = (a: string) => a.split(".")[1] ?? "";

const statusTone: Record<string, string> = {
  sent: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/20",
  queued: "bg-sky-500/10 text-sky-600 ring-sky-500/20",
  skipped: "bg-amber-500/10 text-amber-600 ring-amber-500/20",
  failed: "bg-rose-500/10 text-rose-600 ring-rose-500/20",
};

function NotificationsAuditPage() {
  const list = useServerFn(listNotificationEvents);
  const [items, setItems] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [channel, setChannel] = useState<"all" | "email" | "sms">("all");
  const [status, setStatus] = useState<"all" | "sent" | "queued" | "skipped" | "failed">("all");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [appointmentId, setAppointmentId] = useState("");

  const load = async () => {
    setLoading(true);
    const r = await list({ data: {
      from: from ? new Date(from).toISOString() : null,
      to: to ? new Date(to).toISOString() : null,
      channel, status,
      recipientEmail: recipientEmail || null,
      appointmentId: appointmentId.trim() && /^[0-9a-f-]{36}$/i.test(appointmentId.trim()) ? appointmentId.trim() : null,
      page, pageSize, forExport: false,
    }});
    if (r.error === "Forbidden") { setForbidden(true); setLoading(false); return; }
    setItems(r.items as unknown as Row[]); setTotal(r.total); setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page]);

  const apply = () => { setPage(0); load(); };
  const reset = () => { setFrom(""); setTo(""); setChannel("all"); setStatus("all"); setRecipientEmail(""); setAppointmentId(""); setPage(0); setTimeout(load, 0); };

  const exportCsv = async () => {
    setExporting(true);
    const r = await list({ data: {
      from: from ? new Date(from).toISOString() : null,
      to: to ? new Date(to).toISOString() : null,
      channel, status,
      recipientEmail: recipientEmail || null,
      appointmentId: appointmentId.trim() && /^[0-9a-f-]{36}$/i.test(appointmentId.trim()) ? appointmentId.trim() : null,
      page: 0, pageSize: 5000, forExport: true,
    }});
    setExporting(false);
    const headers = ["timestamp","channel","status","recipient_name","recipient_email","recipient_phone","appointment_id","meta"];
    const csv = [headers.join(",")].concat(
      (r.items as unknown as Row[]).map((row) => [
        row.created_at,
        channelOf(row.action),
        statusOf(row.action),
        row.recipient?.full_name ?? "",
        row.recipient?.email ?? "",
        row.recipient?.phone_e164 ?? "",
        row.entity_id ?? "",
        JSON.stringify(row.meta ?? {}),
      ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    ).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `apexcare-notifications-${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  if (forbidden) return (
    <div className="p-10 max-w-3xl mx-auto">
      <PageHeader title="Notifications audit" sub="Admin role required." />
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Restricted.</div>
    </div>
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="p-10 max-w-7xl mx-auto">
      <PageHeader
        title="Notifications audit"
        sub="Every booking confirmation email and SMS, with delivery state, recipient, and source appointment."
        action={
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting}>
            {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />} Export CSV
          </Button>
        }
      />

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 mb-6 text-xs text-amber-700 flex gap-3">
        <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <strong>Production checklist:</strong> Twilio SMS Pumping Protection and SMS Geo Permissions should be enabled in your Twilio console before scaling production traffic. Skipped events with reason <code className="font-mono">twilio_not_configured</code> indicate a missing connector or <code className="font-mono">TWILIO_FROM_NUMBER</code> secret.
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 mb-6 grid md:grid-cols-7 gap-3 shadow-card">
        <div className="md:col-span-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">From</label>
          <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="md:col-span-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">To</label>
          <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="md:col-span-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Channel</label>
          <Select value={channel} onValueChange={(v) => setChannel(v as typeof channel)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channels</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="sms">SMS</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</label>
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="queued">Queued</SelectItem>
              <SelectItem value="skipped">Skipped</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Recipient email</label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-7" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="contains…" />
          </div>
        </div>
        <div className="md:col-span-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Appointment ID</label>
          <Input value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)} placeholder="uuid" className="font-mono text-xs" />
        </div>
        <div className="md:col-span-1 flex items-end gap-2">
          <Button onClick={apply} className="flex-1"><Filter className="w-4 h-4 mr-2" />Apply</Button>
          <Button variant="ghost" onClick={reset}>Reset</Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3">Timestamp</th>
              <th className="text-left px-4 py-3">Channel</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Recipient</th>
              <th className="text-left px-4 py-3">Appointment</th>
              <th className="text-left px-4 py-3">Detail</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-10 text-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline" /></td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">No notification events match these filters.</td></tr>
            ) : items.map((r) => {
              const ch = channelOf(r.action);
              const st = statusOf(r.action);
              return (
                <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      {ch === "email" ? <Mail className="w-3.5 h-3.5" /> : <MessageSquare className="w-3.5 h-3.5" />}
                      {ch.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ring-1 ${statusTone[st] ?? "bg-muted text-muted-foreground ring-border"}`}>{st}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs">{r.recipient?.full_name ?? <span className="text-muted-foreground">—</span>}</div>
                    <div className="text-[10px] text-muted-foreground">{ch === "sms" ? r.recipient?.phone_e164 : r.recipient?.email}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground">{r.entity_id?.slice(0, 8)}…</td>
                  <td className="px-4 py-3">
                    {r.meta && Object.keys(r.meta).length > 0 ? (
                      <Popover>
                        <PopoverTrigger asChild><Button variant="ghost" size="sm">View</Button></PopoverTrigger>
                        <PopoverContent className="w-96"><pre className="text-xs whitespace-pre-wrap">{JSON.stringify(r.meta, null, 2)}</pre></PopoverContent>
                      </Popover>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
        <div className="inline-flex items-center gap-1"><Bell className="w-3 h-3" /> {total.toLocaleString()} events</div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}><ChevronLeft className="w-4 h-4" /></Button>
          <span>Page {page + 1} / {totalPages}</span>
          <Button size="sm" variant="ghost" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      </div>
    </div>
  );
}
