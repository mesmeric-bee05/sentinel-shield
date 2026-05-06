import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BookInput = z.object({
  providerId: z.string().uuid(),
  startsAtIso: z.string().datetime(),
  durationMinutes: z.number().int().min(15).max(120).default(30),
  channel: z.enum(["in_person", "telemedicine"]).default("telemedicine"),
  reason: z.string().min(3).max(2000),
  aiSummary: z.string().max(4000).optional().nullable(),
});

export const bookAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => BookInput.parse(d))
  .handler(async ({ data, context }) => {
    const start = new Date(data.startsAtIso);
    const end = new Date(start.getTime() + data.durationMinutes * 60_000);
    const { data: row, error } = await context.supabase
      .from("appointments")
      .insert({
        patient_id: context.userId,
        provider_id: data.providerId,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        channel: data.channel,
        reason: data.reason,
        ai_summary: data.aiSummary ?? null,
        status: "scheduled",
      })
      .select("id, starts_at, ends_at, channel, reason, ai_summary, provider:providers(display_name, specialty, location)")
      .single();
    if (error || !row) return { ok: false, error: error?.message ?? "Booking failed", appointment: null };
    await supabaseAdmin.from("audit_events").insert({ actor_id: context.userId, action: "appointment.created", entity: "appointments", entity_id: row.id, meta: { provider_id: data.providerId, channel: data.channel } });
    return { ok: true, error: null as string | null, appointment: row };
  });

export const getAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // RLS lets the patient or assigned provider see it.
    const { data: row, error } = await context.supabase
      .from("appointments")
      .select("id, starts_at, ends_at, status, channel, reason, ai_summary, patient_id, provider_id, provider:providers(display_name, specialty, photo_url)")
      .eq("id", data.id)
      .single();
    if (error || !row) return { appointment: null, error: "Not found", role: null };
    const role = row.patient_id === context.userId ? "patient" : "provider";
    return { appointment: row, error: null as string | null, role };
  });

export const saveScribeNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ appointmentId: z.string().uuid(), note: z.string().min(5).max(20000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("appointments").update({ ai_summary: data.note }).eq("id", data.appointmentId);
    if (error) return { ok: false, error: error.message };
    await supabaseAdmin.from("audit_events").insert({ actor_id: context.userId, action: "scribe.saved", entity: "appointments", entity_id: data.appointmentId, meta: { length: data.note.length } });
    return { ok: true, error: null as string | null };
  });

export const logRoomEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ appointmentId: z.string().uuid(), event: z.enum(["join", "leave"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await supabaseAdmin.from("audit_events").insert({ actor_id: context.userId, action: `room.${data.event}`, entity: "appointments", entity_id: data.appointmentId, meta: {} });
    return { ok: true };
  });
