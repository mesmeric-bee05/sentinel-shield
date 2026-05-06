import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Calendar, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "./app";

export const Route = createFileRoute("/app/provider")({
  head: () => ({ meta: [{ title: "Clinician — ApexCare AI" }] }),
  component: ProviderToday,
});

type Appt = { id: string; starts_at: string; status: string; reason: string | null; ai_summary: string | null; no_show_risk: number | null; patient: { full_name: string | null; email: string | null } | null };

function ProviderToday() {
  const { user, roles } = useAuth();
  const [appts, setAppts] = useState<Appt[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: prov } = await supabase.from("providers").select("id").eq("user_id", user.id).maybeSingle();
      if (!prov) return;
      const { data } = await supabase.from("appointments")
        .select("id, starts_at, status, reason, ai_summary, no_show_risk, patient:profiles!appointments_patient_id_fkey(full_name, email)")
        .eq("provider_id", prov.id)
        .order("starts_at", { ascending: true });
      setAppts((data ?? []) as unknown as Appt[]);
    })();
  }, [user]);

  if (!roles.includes("provider")) {
    return (
      <div className="p-10 max-w-3xl mx-auto">
        <PageHeader title="Clinician workspace" sub="Provider role required." />
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          You're not registered as a provider. Contact an administrator to be added to the clinician roster.
        </div>
      </div>
    );
  }

  return (
    <div className="p-10 max-w-5xl mx-auto">
      <PageHeader title="Today" sub="Your schedule, patient queue, and AI-summarized intake." />
      {appts.length === 0 ? (
        <div className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-10 text-center">No appointments yet.</div>
      ) : (
        <ul className="space-y-3">
          {appts.map((a) => (
            <li key={a.id} className="rounded-xl border border-border bg-card p-5 shadow-card">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-muted grid place-items-center"><User className="w-4 h-4" /></div>
                  <div>
                    <div className="font-medium">{a.patient?.full_name ?? a.patient?.email ?? "Patient"}</div>
                    <div className="text-xs text-muted-foreground mt-0.5"><Calendar className="inline w-3 h-3 mr-1" />{new Date(a.starts_at).toLocaleString()}</div>
                    {a.reason && <div className="text-sm mt-2 text-muted-foreground">{a.reason}</div>}
                  </div>
                </div>
                <div className="text-right">
                  <RiskBadge risk={a.no_show_risk ?? 0.1} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RiskBadge({ risk }: { risk: number }) {
  const level = risk > 0.5 ? { c: "bg-destructive/10 text-destructive", l: "High risk" } : risk > 0.25 ? { c: "bg-warning/20 text-warning-foreground", l: "Medium" } : { c: "bg-success/15 text-success-foreground", l: "Low risk" };
  return <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded ${level.c}`}>{level.l}</span>;
}
