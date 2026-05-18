import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mail, RefreshCw, Search, Send, ShieldAlert, ArrowLeft } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { getBookingEmailHistory, resendBookingConfirmation } from "@/server/notifications.resend.functions";
import { PageHeader } from "./app";

const SearchSchema = z.object({ id: z.string().optional() });

export const Route = createFileRoute("/app/admin/notifications/resend")({
  validateSearch: (s) => SearchSchema.parse(s),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [{ title: "Resend booking email — ApexCare AI" }, { name: "robots", content: "noindex" }] }),
  component: ResendPage,
});

type Event = { id: string; action: string; created_at: string; meta: Record<string, unknown> | null };
type Loaded = {
  appointment: { id: string; starts_at: string; channel: string; provider: { display_name: string; specialty: string } | null } | null;
  recipient: { full_name: string | null; email: string | null } | null;
  events: Event[];
};

const tone: Record<string, string> = {
  sent: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/20",
  resent: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/20",
  queued: "bg-sky-500/10 text-sky-600 ring-sky-500/20",
  skipped: "bg-amber-500/10 text-amber-600 ring-amber-500/20",
  failed: "bg-rose-500/10 text-rose-600 ring-rose-500/20",
};

function ResendPage() {
  const search = Route.useSearch();
  const lookup = useServerFn(getBookingEmailHistory);
  const resend = useServerFn(resendBookingConfirmation);
  const [appointmentId, setAppointmentId] = useState(search.id ?? "");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [data, setData] = useState<Loaded | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (search.id && /^[0-9a-f-]{36}$/i.test(search.id)) {
      setAppointmentId(search.id);
      // auto-trigger lookup once
      (async () => {
        setLoading(true);
        const r = await lookup({ data: { appointmentId: search.id! } });
        setLoading(false);
        if ("error" in r && r.error === "Forbidden") setForbidden(true);
        else setData(r as Loaded);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onLookup = async () => {
    const id = appointmentId.trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) { toast.error("Enter a valid appointment UUID"); return; }
    setLoading(true);
    const r = await lookup({ data: { appointmentId: id } });
    setLoading(false);
    if (!r.ok) {
      if (r.error === "Forbidden") setForbidden(true);
      else toast.error(r.error || "Lookup failed");
      setData(null); return;
    }
    setData({ appointment: r.appointment as Loaded["appointment"], recipient: r.recipient, events: r.events as Event[] });
  };

  const onResend = async () => {
    if (!data?.appointment) return;
    setSending(true);
    const r = await resend({ data: { appointmentId: data.appointment.id, reason: reason || undefined } });
    setSending(false);
    if (r.ok) toast.success("Resend queued"); else toast.error(r.error || "Resend failed");
    onLookup();
  };

  if (forbidden) return (
    <div className="p-10 max-w-3xl mx-auto">
      <PageHeader title="Resend booking email" sub="Admin role required." />
    </div>
  );

  return (
    <div className="p-10 max-w-5xl mx-auto">
      <Link to="/app/admin/notifications" className="text-xs text-muted-foreground inline-flex items-center gap-1 mb-2 hover:text-foreground"><ArrowLeft className="w-3 h-3" /> Back to audit</Link>
      <PageHeader title="Resend booking email" sub="Look up an appointment, review delivery history, and re-trigger the confirmation email." />

      <div className="rounded-2xl border border-border bg-card p-4 mb-6 flex gap-2 shadow-card">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9 font-mono text-xs" value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)} placeholder="Appointment UUID" />
        </div>
        <Button onClick={onLookup} disabled={loading}>{loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}Look up</Button>
      </div>

      {data?.appointment && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Appointment</div>
            <div className="font-medium">{data.appointment.provider?.display_name}</div>
            <div className="text-sm text-muted-foreground">{data.appointment.provider?.specialty}</div>
            <div className="text-sm mt-3">{new Date(data.appointment.starts_at).toLocaleString()}</div>
            <div className="text-xs text-muted-foreground capitalize">{data.appointment.channel}</div>

            <div className="mt-5 pt-5 border-t border-border">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Recipient</div>
              <div className="text-sm">{data.recipient?.full_name ?? "—"}</div>
              <div className="text-xs text-muted-foreground">{data.recipient?.email ?? "no email on file"}</div>
            </div>

            <div className="mt-5 pt-5 border-t border-border">
              <label className="text-xs text-muted-foreground">Note (optional)</label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. patient asked to forward to a new address" rows={2} className="mt-1 text-sm" />
              <Button onClick={onResend} disabled={sending || !data.recipient?.email} className="w-full mt-3">
                {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}Resend confirmation
              </Button>
              {!data.recipient?.email && (
                <div className="text-xs text-amber-600 mt-2 flex items-center gap-1.5"><ShieldAlert className="w-3 h-3" />No email on file — cannot resend.</div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5"><Mail className="w-3 h-3" />Delivery history</div>
            {data.events.length === 0 ? (
              <div className="text-sm text-muted-foreground">No notification events yet for this appointment.</div>
            ) : (
              <ul className="space-y-2">
                {data.events.map((e) => {
                  const st = e.action.split(".")[1] ?? "";
                  return (
                    <li key={e.id} className="flex items-start gap-2 text-xs border-b border-border pb-2 last:border-0">
                      <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ring-1 ${tone[st] ?? "bg-muted text-muted-foreground ring-border"}`}>{e.action}</span>
                      <div className="flex-1">
                        <div className="font-mono text-[10px] text-muted-foreground">{new Date(e.created_at).toLocaleString()}</div>
                        {e.meta && Object.keys(e.meta).length > 0 && (
                          <pre className="mt-1 text-[10px] whitespace-pre-wrap text-muted-foreground">{JSON.stringify(e.meta, null, 2)}</pre>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <Button variant="ghost" size="sm" onClick={onLookup} className="mt-3"><RefreshCw className="w-3 h-3 mr-1.5" />Refresh</Button>
          </div>
        </div>
      )}
    </div>
  );
}
