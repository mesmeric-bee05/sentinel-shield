// Admin bookings: every booked slot with patient contact details.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "./app";
import { PermissionDeniedCard } from "@/components/admin/PermissionDeniedCard";
import { reasonFromResult, type ForbiddenInfo } from "@/lib/permission";
import { listAdminBookings, type AdminBooking } from "@/lib/admin-bookings.functions";

export const Route = createFileRoute("/app/admin/bookings")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({
    meta: [
      { title: "Bookings — ApexCare AI" },
      { name: "description", content: "All booked appointments with patient and provider details for clinic admins." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Bookings — ApexCare AI" },
      { property: "og:description", content: "Track every booked appointment from the admin dashboard." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BookingsPage,
});

const PAGE = 25;
type Scope = "upcoming" | "past" | "all";

function BookingsPage() {
  const listFn = useServerFn(listAdminBookings);
  const [scope, setScope] = useState<Scope>("upcoming");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AdminBooking[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState<ForbiddenInfo | null>(null);

  useEffect(() => { const t = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(0); }, [scope, status, debounced]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listFn({ data: { scope, status: status || undefined, search: debounced || undefined, page, pageSize: PAGE } });
      const d = reasonFromResult(res);
      if (d) { setDenied(d); return; }
      setDenied(null);
      setError(res.error);
      setRows(res.bookings);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load bookings.");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [scope, status, debounced, page]);

  // Live refresh when any appointment changes.
  useEffect(() => {
    const ch = supabase.channel("admin-bookings").on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, () => void load()).subscribe();
    return () => { void supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, status, debounced, page]);

  if (denied) return <div className="p-10"><PermissionDeniedCard info={denied} onRetry={load} /></div>;

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const fmt = (s: string) => new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="p-10 max-w-6xl mx-auto">
      <PageHeader title="Bookings" sub="Every booked slot with patient contact details." />
      <section className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
        <header className="px-5 py-3 border-b border-border/60 flex flex-wrap items-center gap-2 text-xs">
          {(["upcoming", "past", "all"] as Scope[]).map((s) => (
            <Button key={s} size="sm" variant={scope === s ? "default" : "outline"} className="h-8 text-xs capitalize" onClick={() => setScope(s)}>{s}</Button>
          ))}
          <select aria-label="Status" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            <option value="scheduled">Scheduled</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="no_show">No-show</option>
          </select>
          <Input className="h-8 text-xs w-60" placeholder="Search patient, email or provider" value={search} onChange={(e) => setSearch(e.target.value)} />
          <span className="ml-auto text-muted-foreground">{total} booking{total === 1 ? "" : "s"}</span>
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => void load()}><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
        </header>
        {error && <p className="px-5 py-3 text-sm text-destructive">{error}</p>}
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No bookings match these filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground uppercase tracking-wide">
                <tr className="border-b border-border/60 text-left">
                  <th className="px-5 py-2">When</th><th className="px-3 py-2">Patient</th><th className="px-3 py-2">Contact</th>
                  <th className="px-3 py-2">Provider</th><th className="px-3 py-2">Channel</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className="border-b border-border/40 align-top">
                    <td className="px-5 py-2 whitespace-nowrap">{fmt(b.starts_at)}</td>
                    <td className="px-3 py-2">{b.patient_name ?? "—"}</td>
                    <td className="px-3 py-2 text-xs"><div>{b.patient_email ?? "—"}</div><div className="text-muted-foreground">{b.patient_phone ?? ""}</div></td>
                    <td className="px-3 py-2"><div>{b.provider_name ?? "—"}</div><div className="text-xs text-muted-foreground">{b.provider_specialty ?? ""}</div></td>
                    <td className="px-3 py-2 text-xs">{b.channel === "telemedicine" ? "Telemedicine" : "In person"}</td>
                    <td className="px-3 py-2 text-xs capitalize">{b.status.replace("_", " ")}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-56">{b.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <footer className="px-5 py-3 flex items-center justify-end gap-2 text-xs">
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span>Page {page + 1} of {pages}</span>
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </footer>
      </section>
    </div>
  );
}
