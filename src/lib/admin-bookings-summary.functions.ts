// Admin-only booking summary for the Operations dashboard.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type BookingSummary = {
  createdToday: number;
  upcoming7d: number;
  cancelledToday: number;
  recent: { id: string; starts_at: string; status: string; patient_name: string | null; provider_name: string | null }[];
  series: { day: string; bookings: number; completed: number }[];
};

export const getBookingSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ summary: BookingSummary | null; error: string | null }> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { summary: null, error: "forbidden" };
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const now = new Date();
    const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
    const in7 = new Date(now.getTime() + 7 * 864e5).toISOString();
    const weekAgo = new Date(dayStart.getTime() - 6 * 864e5);

    const [created, upcoming, cancelled, recent, week] = await Promise.all([
      db.from("appointments").select("id", { count: "exact", head: true }).gte("created_at", dayStart.toISOString()),
      db.from("appointments").select("id", { count: "exact", head: true }).gte("starts_at", now.toISOString()).lte("starts_at", in7).in("status", ["scheduled", "confirmed"]),
      db.from("appointments").select("id", { count: "exact", head: true }).eq("status", "cancelled").gte("updated_at", dayStart.toISOString()),
      db.from("appointments").select("id, starts_at, status, patient_id, provider_id").order("created_at", { ascending: false }).limit(5),
      db.from("appointments").select("created_at, status").gte("created_at", weekAgo.toISOString()).limit(5000),
    ]);

    const rows = recent.data ?? [];
    const [{ data: pats }, { data: provs }] = await Promise.all([
      rows.length ? db.from("profiles").select("id, full_name").in("id", rows.map((r) => r.patient_id)) : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
      rows.length ? db.from("providers").select("id, display_name").in("id", rows.map((r) => r.provider_id)) : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
    ]);
    const pm = new Map((pats ?? []).map((p) => [p.id, p.full_name]));
    const vm = new Map((provs ?? []).map((p) => [p.id, p.display_name]));

    const series = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekAgo.getTime() + i * 864e5);
      const key = d.toISOString().slice(0, 10);
      const day = (week.data ?? []).filter((r) => r.created_at.slice(0, 10) === key);
      return {
        day: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
        bookings: day.length,
        completed: day.filter((r) => r.status === "completed").length,
      };
    });

    return {
      error: null,
      summary: {
        createdToday: created.count ?? 0,
        upcoming7d: upcoming.count ?? 0,
        cancelledToday: cancelled.count ?? 0,
        recent: rows.map((r) => ({ id: r.id, starts_at: r.starts_at, status: r.status, patient_name: pm.get(r.patient_id) ?? null, provider_name: vm.get(r.provider_id) ?? null })),
        series,
      },
    };
  });
