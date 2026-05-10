import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Circle, Loader2, MessageSquare, Search, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getPatientContact, updatePatientContact } from "@/server/profile.functions";
import { PageHeader } from "./app";

export const Route = createFileRoute("/app/admin/test/sms")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [{ title: "SMS test flow — ApexCare AI" }] }),
  component: SmsTestPage,
});

type Event = { id: string; action: string; created_at: string; meta: Record<string, unknown> | null; entity_id: string | null };

function SmsTestPage() {
  const getContact = useServerFn(getPatientContact);
  const updateContact = useServerFn(updatePatientContact);
  const [contact, setContact] = useState<{ phoneE164: string | null; smsOptIn: boolean } | null>(null);
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [polling, setPolling] = useState(false);
  const [recent, setRecent] = useState<Event[]>([]);
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then((r) => setMe(r.data.user?.id ?? null));
    getContact({}).then((r) => { setContact({ phoneE164: r.phoneE164, smsOptIn: r.smsOptIn }); setPhone(r.phoneE164 ?? ""); });
  }, [getContact]);

  const saveContact = async () => {
    setSaving(true);
    const r = await updateContact({ data: { phoneE164: phone || null, smsOptIn: true } });
    setSaving(false);
    if (r.ok) { toast.success("Contact preferences saved"); setContact({ phoneE164: phone || null, smsOptIn: true }); }
    else toast.error(r.error || "Save failed");
  };

  const pollOnce = async () => {
    if (!me) return;
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data } = await supabase
      .from("audit_events")
      .select("id, action, created_at, meta, entity_id")
      .eq("actor_id", me)
      .gte("created_at", since)
      .like("action", "sms.%")
      .order("created_at", { ascending: false })
      .limit(10);
    setRecent((data ?? []) as Event[]);
  };

  const startPolling = async () => {
    setPolling(true);
    const start = Date.now();
    while (Date.now() - start < 60_000) {
      await pollOnce();
      if (recent.some((r) => r.action === "sms.sent")) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    setPolling(false);
  };

  const checks = [
    { label: "Phone number on profile", ok: !!contact?.phoneE164 },
    { label: "SMS opt-in enabled", ok: !!contact?.smsOptIn },
  ];
  const ready = checks.every((c) => c.ok);

  return (
    <div className="p-10 max-w-4xl mx-auto">
      <PageHeader title="Guided SMS test" sub="Verify Twilio is wired correctly by booking an appointment with SMS opt-in and watching for the sms.sent audit event." />

      <ol className="space-y-4">
        <li className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Step 1 · Pre-flight</div>
          <ul className="space-y-2 mb-4">
            {checks.map((c) => (
              <li key={c.label} className="flex items-center gap-2 text-sm">
                {c.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <Circle className="w-4 h-4 text-muted-foreground" />}
                {c.label}
              </li>
            ))}
          </ul>
          {!ready && (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">Phone (E.164, e.g. +14155551234)</label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+14155551234" />
              </div>
              <Button onClick={saveContact} disabled={saving || !phone}>{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Save & opt in</Button>
            </div>
          )}
        </li>

        <li className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Step 2 · Book a test appointment</div>
          <p className="text-sm text-muted-foreground mb-3">Open the discovery flow, pick any provider and slot, and confirm with the "Also text me a confirmation" box checked.</p>
          <Button asChild disabled={!ready}>
            <Link to="/app/discover">Open discover →</Link>
          </Button>
        </li>

        <li className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5"><MessageSquare className="w-3 h-3" />Step 3 · Watch for sms.sent</div>
          <Button onClick={startPolling} disabled={polling}>
            {polling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}Poll my recent SMS audit events
          </Button>
          <div className="mt-4 space-y-2">
            {recent.length === 0 && !polling && (<div className="text-xs text-muted-foreground">No SMS audit events in the last 5 minutes yet.</div>)}
            {recent.map((e) => {
              const ok = e.action === "sms.sent";
              const sid = (e.meta as { sid?: string } | null)?.sid;
              return (
                <div key={e.id} className={`rounded-lg border p-3 text-xs ${ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/5"}`}>
                  <div className="flex items-center gap-2 font-medium">
                    {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-rose-600" />}
                    {e.action}
                    <span className="text-muted-foreground font-normal">· {new Date(e.created_at).toLocaleTimeString()}</span>
                  </div>
                  {sid && <div className="font-mono mt-1">Twilio SID: {sid}</div>}
                  {e.meta && <pre className="mt-2 text-[10px] text-muted-foreground whitespace-pre-wrap">{JSON.stringify(e.meta, null, 2)}</pre>}
                  {e.entity_id && (
                    <Link to="/app/admin/notifications" className="text-[10px] underline mt-1 inline-block">Open in audit →</Link>
                  )}
                </div>
              );
            })}
          </div>
        </li>
      </ol>
    </div>
  );
}
