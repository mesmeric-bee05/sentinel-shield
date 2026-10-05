// Admin-only list of booked appointments with patient and provider details.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AdminBooking = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  channel: string;
  reason: string | null;
  created_at: string;
  patient_name: string | null;
  patient_email: string | null;
  patient_phone: string | null;
  provider_name: string | null;
  provider_specialty: string | null;
};

const Input = z.object({
  scope: z.enum(["upcoming", "past", "all"]).default("upcoming"),
  status: z.string().max(40).optional(),
  search: z.string().max(120).optional(),
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(5).max(100).default(25),
});

export const listAdminBookings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const empty = { bookings: [] as AdminBooking[], total: 0 };
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { ...empty, error: "forbidden", status: 403 };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    let q = supabaseAdmin
      .from("appointments")
      .select("id, starts_at, ends_at, status, channel, reason, created_at, patient_id, provider_id", { count: "exact" });
    if (data.scope === "upcoming") q = q.gte("starts_at", now).order("starts_at", { ascending: true });
    else if (data.scope === "past") q = q.lt("starts_at", now).order("starts_at", { ascending: false });
    else q = q.order("starts_at", { ascending: false });
    if (data.status) q = q.eq("status", data.status as never);

    // Search narrows by patient name/email or provider name first.
    const term = data.search?.trim();
    if (term) {
      const like = `%${term.replace(/[%_,()]/g, "")}%`;
      const [{ data: pats }, { data: provs }] = await Promise.all([
        supabaseAdmin.from("profiles").select("id").or(`full_name.ilike.${like},email.ilike.${like}`).limit(200),
        supabaseAdmin.from("providers").select("id").ilike("display_name", like).limit(200),
      ]);
      const pIds = (pats ?? []).map((p) => p.id);
      const vIds = (provs ?? []).map((p) => p.id);
      if (!pIds.length && !vIds.length) return { ...empty, error: null };
      const parts = [];
      if (pIds.length) parts.push(`patient_id.in.(${pIds.join(",")})`);
      if (vIds.length) parts.push(`provider_id.in.(${vIds.join(",")})`);
      q = q.or(parts.join(","));
    }

    const from = data.page * data.pageSize;
    const { data: rows, count, error } = await q.range(from, from + data.pageSize - 1);
    if (error) return { ...empty, error: "Could not load bookings." };

    const patientIds = [...new Set((rows ?? []).map((r) => r.patient_id))];
    const providerIds = [...new Set((rows ?? []).map((r) => r.provider_id))];
    const [{ data: profiles }, { data: providers }] = await Promise.all([
      patientIds.length ? supabaseAdmin.from("profiles").select("id, full_name, email, phone, phone_e164").in("id", patientIds) : Promise.resolve({ data: [] }),
      providerIds.length ? supabaseAdmin.from("providers").select("id, display_name, specialty").in("id", providerIds) : Promise.resolve({ data: [] }),
    ]);
    const pMap = new Map((profiles ?? []).map((p) => [p.id, p]));
    const vMap = new Map((providers ?? []).map((p) => [p.id, p]));

    const bookings: AdminBooking[] = (rows ?? []).map((r) => {
      const p = pMap.get(r.patient_id);
      const v = vMap.get(r.provider_id);
      return {
        id: r.id, starts_at: r.starts_at, ends_at: r.ends_at, status: r.status, channel: r.channel,
        reason: r.reason, created_at: r.created_at,
        patient_name: p?.full_name ?? null, patient_email: p?.email ?? null,
        patient_phone: p?.phone_e164 ?? p?.phone ?? null,
        provider_name: v?.display_name ?? null, provider_specialty: v?.specialty ?? null,
      };
    });
    return { bookings, total: count ?? 0, error: null };
  });
