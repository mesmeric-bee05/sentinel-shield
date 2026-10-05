import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Activity, Calendar, ShieldCheck, Stethoscope, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { getRetentionConfig, type RetentionRunRow, type RetentionSettingsRow } from "@/lib/security-retention.functions";
import { PageHeader } from "./app";

export const Route = createFileRoute("/app/admin")({
  head: () => ({ meta: [{ title: "Operations — ApexCare AI" }] }),
  component: AdminLayout,
});

function AdminLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const isIndex = path.replace(/\/$/, "") === "/app/admin";
  return isIndex ? <AdminOverview /> : <Outlet />;
}

const DATASET_LABEL: Record<string, string> = {
  security_export_audit: "Export audit log",
  security_export_jobs: "Export jobs",
};

function RetentionSummaryCard() {
  const getFn = useServerFn(getRetentionConfig);
  const [state, setState] = useState<{ loading: boolean; error: string | null; settings: RetentionSettingsRow[]; runs: RetentionRunRow[] }>(
    { loading: true, error: null, settings: [], runs: [] },
  );
  useEffect(() => {
    getFn()
      .then((r) => setState({ loading: false, error: r.error, settings: r.settings ?? [], runs: r.runs ?? [] }))
      .catch((e) => setState({ loading: false, error: e instanceof Error ? e.message : "Failed to load", settings: [], runs: [] }));
  }, [getFn]);

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-card mt-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-serif text-lg flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-accent" /> Data retention</h3>
        <Link to="/app/admin/retention" className="text-sm text-primary font-medium">Manage retention →</Link>
      </div>
      {state.loading ? (
        <p className="text-sm text-muted-foreground">Loading retention settings…</p>
      ) : state.error ? (
        <p className="text-sm text-destructive">{state.error === "Forbidden" ? "Insufficient permissions to view retention settings." : state.error}</p>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Current settings</div>
            <ul className="space-y-2 text-sm">
              {state.settings.map((s) => (
                <li key={s.dataset} className="flex justify-between gap-4 border-b border-border pb-2">
                  <span>{DATASET_LABEL[s.dataset] ?? s.dataset}</span>
                  <span className="text-muted-foreground text-right">
                    Rows {s.retention_days}d · files {s.payload_retention_days}d
                    <br />
                    <span className="text-xs">Last run: {s.last_run_at ? new Date(s.last_run_at).toLocaleString() : "never"}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Recent cleanups</div>
            {state.runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No cleanups have run yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {state.runs.slice(0, 5).map((r) => (
                  <li key={r.id} className="flex justify-between gap-4">
                    <span>{new Date(r.created_at).toLocaleString()} · {DATASET_LABEL[r.dataset] ?? r.dataset}</span>
                    <span className={r.error ? "text-destructive" : "text-muted-foreground"}>
                      {r.error ? "Failed" : `${r.deleted_rows} deleted, ${r.cleared_payloads} cleared`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

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
      <RetentionSummaryCard />
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
