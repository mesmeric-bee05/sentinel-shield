import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Calendar, ChevronRight, Sparkles, Stethoscope, Video } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { PageHeader } from "./app";

export const Route = createFileRoute("/app/")({
  head: () => ({ meta: [{ title: "Overview — ApexCare AI" }] }),
  component: Overview,
});

type Appt = { id: string; starts_at: string; status: string; channel: string; reason: string | null; provider: { display_name: string; specialty: string } | null };

function Overview() {
  const { user } = useAuth();
  const [appts, setAppts] = useState<Appt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase.from("appointments")
      .select("id, starts_at, status, channel, reason, provider:providers(display_name, specialty)")
      .eq("patient_id", user.id)
      .order("starts_at", { ascending: true })
      .limit(5)
      .then(({ data }) => { setAppts((data ?? []) as unknown as Appt[]); setLoading(false); });
  }, [user]);

  const upcoming = appts.filter((a) => new Date(a.starts_at) >= new Date());

  return (
    <div className="p-10 max-w-6xl mx-auto">
      <PageHeader title={`Welcome${user?.email ? `, ${user.email.split("@")[0]}` : ""}`} sub="Here's a snapshot of your care." />
      <div className="grid md:grid-cols-3 gap-4 mb-10">
        <Card icon={Calendar} label="Upcoming visits" value={String(upcoming.length)} />
        <Card icon={Stethoscope} label="Total bookings" value={String(appts.length)} />
        <Card icon={Sparkles} label="AI assistance" value="Active" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card shadow-card p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-serif text-xl">Next appointments</h2>
            <Button asChild size="sm" variant="outline"><Link to="/app/appointments">View all</Link></Button>
          </div>
          {loading ? <div className="text-sm text-muted-foreground">Loading…</div> :
            upcoming.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-border rounded-xl">
                <Calendar className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
                <div className="text-sm text-muted-foreground">No upcoming visits.</div>
                <Button asChild size="sm" className="mt-4"><Link to="/app/discover">Find a provider</Link></Button>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {upcoming.map((a) => (
                  <li key={a.id} className="py-3 flex items-center justify-between">
                    <div>
                      <div className="font-medium">{a.provider?.display_name ?? "Provider"} <span className="text-muted-foreground font-normal">· {a.provider?.specialty}</span></div>
                      <div className="text-xs text-muted-foreground">{new Date(a.starts_at).toLocaleString()}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-muted text-muted-foreground">{a.status}</span>
                      {a.channel === "telemedicine" && <Button asChild size="sm" variant="outline"><Link to="/app/room/$appointmentId" params={{ appointmentId: a.id }}><Video className="w-3.5 h-3.5 mr-1.5" />Join</Link></Button>}
                    </div>
                  </li>
                ))}
              </ul>
            )
          }
        </div>
        <div className="rounded-2xl border border-border bg-gradient-ai p-6">
          <Sparkles className="w-6 h-6 text-accent" />
          <div className="mt-4 font-serif text-xl">AI Concierge</div>
          <p className="text-sm text-muted-foreground mt-1">Describe what you need and let the platform find the best care.</p>
          <Button asChild className="mt-5 w-full"><Link to="/app/discover">Start a search <ChevronRight className="w-4 h-4 ml-1" /></Link></Button>
        </div>
      </div>
    </div>
  );
}

function Card({ icon: Icon, label, value }: { icon: typeof Calendar; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
      <Icon className="w-5 h-5 text-accent" />
      <div className="font-serif text-3xl mt-4">{value}</div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mt-1">{label}</div>
    </div>
  );
}
