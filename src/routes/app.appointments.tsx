import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Calendar, Video, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { PageHeader } from "./app";

export const Route = createFileRoute("/app/appointments")({
  head: () => ({ meta: [{ title: "Appointments — ApexCare AI" }] }),
  component: Appointments,
});

type Appt = { id: string; starts_at: string; ends_at: string; status: string; channel: string; reason: string | null; provider: { display_name: string; specialty: string } | null };

function Appointments() {
  const { user } = useAuth();
  const [appts, setAppts] = useState<Appt[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase.from("appointments")
      .select("id, starts_at, ends_at, status, channel, reason, provider:providers(display_name, specialty)")
      .eq("patient_id", user.id)
      .order("starts_at", { ascending: false });
    setAppts((data ?? []) as unknown as Appt[]);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user]);

  const cancel = async (id: string) => {
    const { error } = await supabase.from("appointments").update({ status: "cancelled" }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Appointment cancelled"); load();
  };

  const upcoming = appts.filter((a) => new Date(a.starts_at) >= new Date() && a.status !== "cancelled");
  const past = appts.filter((a) => new Date(a.starts_at) < new Date() || a.status === "cancelled");

  return (
    <div className="p-10 max-w-5xl mx-auto">
      <PageHeader title="Appointments" sub="Manage your visits, join telemedicine, or reschedule." />
      {loading ? <div className="text-sm text-muted-foreground">Loading…</div> : (
        <>
          <Section title="Upcoming" items={upcoming} cancel={cancel} />
          <Section title="Past & cancelled" items={past} />
        </>
      )}
    </div>
  );
}

function Section({ title, items, cancel }: { title: string; items: Appt[]; cancel?: (id: string) => void }) {
  return (
    <div className="mb-10">
      <h2 className="font-serif text-xl mb-4">{title}</h2>
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-8 text-center">Nothing here yet.</div>
      ) : (
        <ul className="space-y-2">
          {items.map((a) => (
            <li key={a.id} className="rounded-xl border border-border bg-card p-4 flex items-center justify-between shadow-card">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-muted grid place-items-center"><Calendar className="w-4 h-4" /></div>
                <div>
                  <div className="font-medium">{a.provider?.display_name ?? "Provider"} <span className="text-muted-foreground font-normal">· {a.provider?.specialty}</span></div>
                  <div className="text-xs text-muted-foreground mt-0.5">{new Date(a.starts_at).toLocaleString()} · {a.reason}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-muted text-muted-foreground">{a.status}</span>
                {a.channel === "telemedicine" && a.status !== "cancelled" && <Button size="sm" variant="outline"><Video className="w-3.5 h-3.5 mr-1.5" />Join</Button>}
                {cancel && <Button size="sm" variant="ghost" onClick={() => cancel(a.id)}><X className="w-3.5 h-3.5" /></Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
