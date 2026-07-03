import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Clock, Loader2, RotateCcw, ServerCog } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { getEmailHealth } from "@/lib/email-health.functions";
import { PageHeader } from "./app";

export const Route = createFileRoute("/app/admin/email-health")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [
    { title: "Email health — ApexCare AI" },
    { name: "robots", content: "noindex" },
  ] }),
  component: EmailHealthPage,
});

type Health = Awaited<ReturnType<typeof getEmailHealth>> & { error?: undefined };

function EmailHealthPage() {
  const fn = useServerFn(getEmailHealth);
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  const load = async () => {
    setLoading(true);
    const r = await fn({});
    setLoading(false);
    if ("error" in r && r.error === "Forbidden") { setForbidden(true); return; }
    setData(r as Health);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (forbidden) return (
    <div className="p-10 max-w-3xl mx-auto">
      <PageHeader title="Email health" sub="Admin role required." />
    </div>
  );

  return (
    <div className="p-10 max-w-7xl mx-auto">
      <PageHeader
        title="Email health"
        sub="Last 24 hours of transactional email delivery, retry pressure, and failure reasons."
        action={<Button variant="outline" size="sm" onClick={load} disabled={loading}>{loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-2" />}Refresh</Button>}
      />

      {!data?.queueReady && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 mb-6 flex gap-4">
          <ServerCog className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm flex-1">
            <div className="font-medium text-amber-800">Worker not provisioned</div>
            <p className="text-xs text-amber-700 mt-1">
              The durable email queue (pgmq + retry worker) is created when you configure a verified sender domain.
              Booking events are still audited, but real delivery is gated on this setup.
            </p>
          </div>
          <Button asChild size="sm" variant="outline"><Link to="/app/admin/email-preview">Open sandbox preview</Link></Button>
        </div>
      )}

      <div className="grid md:grid-cols-5 gap-3 mb-8">
        <Stat label="Sent" value={data?.stats.sent ?? 0} tone="success" />
        <Stat label="Queued" value={data?.stats.queued ?? 0} tone="info" />
        <Stat label="Failed" value={data?.stats.failed ?? 0} tone="danger" />
        <Stat label="Skipped" value={data?.stats.skipped ?? 0} tone="warn" />
        <Stat label="Success rate" value={data?.successRate != null ? `${data.successRate}%` : "—"} tone="neutral" />
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-card">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <div className="font-medium text-sm">Recent email.failed events</div>
            <div className="text-xs text-muted-foreground">Most recent failures with reason and source appointment.</div>
          </div>
        </div>
        {loading ? (
          <div className="p-10 text-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
        ) : (data?.failures.length ?? 0) === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground inline-flex items-center justify-center gap-2 w-full">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" /> No failures recorded in the last 24h.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">When</th>
                <th className="text-left px-4 py-3">Appointment</th>
                <th className="text-left px-4 py-3">Reason</th>
                <th className="text-left px-4 py-3 w-32">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data?.failures.map((f) => (
                <tr key={f.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap"><Clock className="w-3 h-3 inline mr-1 text-muted-foreground" />{new Date(f.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground">{f.entity_id?.slice(0, 8) ?? "—"}…</td>
                  <td className="px-4 py-3 text-xs"><AlertTriangle className="w-3 h-3 inline mr-1 text-rose-600" />{f.reason}</td>
                  <td className="px-4 py-3">
                    {f.entity_id ? (
                      <Button asChild size="sm" variant="outline"><Link to="/app/admin/notifications/resend" search={{ id: f.entity_id }}>Resend</Link></Button>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone: "success" | "danger" | "warn" | "info" | "neutral" }) {
  const cls: Record<typeof tone, string> = {
    success: "text-emerald-600",
    danger: "text-rose-600",
    warn: "text-amber-600",
    info: "text-sky-600",
    neutral: "text-foreground",
  };
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-serif text-3xl mt-1 ${cls[tone]}`}>{value}</div>
    </div>
  );
}
