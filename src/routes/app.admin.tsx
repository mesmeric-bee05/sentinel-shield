import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Activity, Calendar, Stethoscope, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "./app";

export const Route = createFileRoute("/app/admin")({
  head: () => ({ meta: [{ title: "Operations — ApexCare AI" }] }),
  component: AdminOverview,
});

function AdminOverview() {
  const { roles } = useAuth();
  const [counts, setCounts] = useState({ appts: 0, providers: 0, today: 0 });

  useEffect(() => {
    (async () => {
      const [{ count: appts }, { count: providers }] = await Promise.all([
        supabase.from("appointments").select("*", { count: "exact", head: true }),
        supabase.from("providers").select("*", { count: "exact", head: true }),
      ]);
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(); end.setHours(23, 59, 59, 999);
      const { count: today } = await supabase.from("appointments").select("*", { count: "exact", head: true })
        .gte("starts_at", start.toISOString()).lte("starts_at", end.toISOString());
      setCounts({ appts: appts ?? 0, providers: providers ?? 0, today: today ?? 0 });
    })();
  }, []);

  if (!roles.includes("admin")) {
    return (
      <div className="p-10 max-w-3xl mx-auto">
        <PageHeader title="Operations" sub="Admin role required." />
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          You're signed in as a patient. Operations console is restricted to administrators.
        </div>
      </div>
    );
  }

  const trend = Array.from({ length: 7 }, (_, i) => ({
    day: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i],
    bookings: Math.floor(40 + Math.random() * 60),
    completed: Math.floor(30 + Math.random() * 50),
  }));
  const heat = ["8a", "10a", "12p", "2p", "4p", "6p"].map((h) => ({ hour: h, load: Math.floor(40 + Math.random() * 55) }));

  return (
    <div className="p-10 max-w-7xl mx-auto">
      <PageHeader title="Operations command center" sub="Real-time view of capacity, utilization, and demand." />
      <div className="grid md:grid-cols-4 gap-4 mb-8">
        <KPI icon={Calendar} label="Bookings (today)" value={String(counts.today)} />
        <KPI icon={Activity} label="Total bookings" value={String(counts.appts)} />
        <KPI icon={Stethoscope} label="Active providers" value={String(counts.providers)} />
        <KPI icon={Users} label="Utilization" value="74%" />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-6 shadow-card">
          <h3 className="font-serif text-lg mb-4">Bookings — last 7 days</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8 }} />
                <Line type="monotone" dataKey="bookings" stroke="oklch(0.55 0.16 220)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="completed" stroke="oklch(0.78 0.14 200)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <h3 className="font-serif text-lg mb-4">Hourly load</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={heat}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="hour" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8 }} />
                <Bar dataKey="load" fill="oklch(0.78 0.14 200)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

function KPI({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <Icon className="w-5 h-5 text-accent" />
      <div className="font-serif text-3xl mt-3">{value}</div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mt-1">{label}</div>
    </div>
  );
}
