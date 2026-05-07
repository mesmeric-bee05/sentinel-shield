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
  holdId: z.string().uuid().optional().nullable(),
  smsRequested: z.boolean().optional().default(false),
});

export const bookAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => BookInput.parse(d))
  .handler(async ({ data, context }) => {
    const start = new Date(data.startsAtIso);
    const end = new Date(start.getTime() + data.durationMinutes * 60_000);

    // Final overlap guard against scheduled appointments and other patients' active holds.
    const { data: conflict } = await supabaseAdmin
      .from("appointments")
      .select("id")
      .eq("provider_id", data.providerId)
      .in("status", ["scheduled", "in_progress"])
      .lt("starts_at", end.toISOString())
      .gt("ends_at", start.toISOString())
      .limit(1);
    if (conflict && conflict.length > 0) {
      return { ok: false, error: "That time is no longer available.", appointment: null };
    }

    const { data: otherHolds } = await supabaseAdmin
      .from("slot_holds")
      .select("id, patient_id")
      .eq("provider_id", data.providerId)
      .gt("expires_at", new Date().toISOString())
      .lt("starts_at", end.toISOString())
      .gt("ends_at", start.toISOString());
    const blocked = (otherHolds ?? []).some((h: { patient_id: string }) => h.patient_id !== context.userId);
    if (blocked) return { ok: false, error: "Another patient is finalizing this slot.", appointment: null };

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

    // Release the hold (if any).
    if (data.holdId) {
      await supabaseAdmin.from("slot_holds").delete().eq("id", data.holdId).eq("patient_id", context.userId);
    }

    await supabaseAdmin.from("audit_events").insert({
      actor_id: context.userId, action: "appointment.created", entity: "appointments", entity_id: row.id,
      meta: { provider_id: data.providerId, channel: data.channel, hold_id: data.holdId ?? null },
    });

    // Fire-and-forget notifications. Never block the booking response.
    void sendBookingNotifications({
      appointmentId: row.id,
      patientId: context.userId,
      providerName: row.provider?.display_name ?? "your provider",
      specialty: row.provider?.specialty ?? "",
      location: row.provider?.location ?? null,
      startsAt: start,
      endsAt: end,
      channel: data.channel,
      reason: data.reason,
      aiSummary: data.aiSummary ?? null,
      smsRequested: !!data.smsRequested,
    }).catch((e) => console.error("[notifications]", e));

    return { ok: true, error: null as string | null, appointment: row };
  });

export const getAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
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

// ---------- Notifications (server-only helpers) ----------

type NotifyArgs = {
  appointmentId: string;
  patientId: string;
  providerName: string;
  specialty: string;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  channel: "in_person" | "telemedicine";
  reason: string;
  aiSummary: string | null;
  smsRequested: boolean;
};

async function sendBookingNotifications(a: NotifyArgs): Promise<void> {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("full_name, email, phone_e164, sms_opt_in")
    .eq("id", a.patientId)
    .maybeSingle();
  if (!profile) return;

  const appUrl = (process.env.APP_BASE_URL ?? "https://harmony-forge-nexus.lovable.app").replace(/\/$/, "");
  const roomUrl = `${appUrl}/app/room/${a.appointmentId}`;
  const apptUrl = `${appUrl}/app/appointments`;
  const whenUtc = a.startsAt.toISOString();

  // ---- Email via Lovable Emails (transactional). Only sends if email infra is set up. ----
  try {
    const res = await fetch(`${appUrl}/lovable/email/transactional/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-source": "booking" },
      body: JSON.stringify({
        templateName: "booking-confirmation",
        recipientEmail: profile.email,
        idempotencyKey: `booking-confirm-${a.appointmentId}`,
        templateData: {
          patientName: profile.full_name ?? "there",
          providerName: a.providerName,
          specialty: a.specialty,
          whenUtc,
          channel: a.channel,
          location: a.location ?? "",
          roomUrl,
          appointmentUrl: apptUrl,
          reason: a.reason,
          aiSummary: a.aiSummary ?? "",
        },
      }),
    });
    await supabaseAdmin.from("audit_events").insert({
      actor_id: a.patientId,
      action: res.ok ? "email.sent" : "email.skipped",
      entity: "appointments", entity_id: a.appointmentId,
      meta: { template: "booking-confirmation", status: res.status },
    });
  } catch (e) {
    await supabaseAdmin.from("audit_events").insert({
      actor_id: a.patientId, action: "email.failed", entity: "appointments", entity_id: a.appointmentId,
      meta: { error: String(e instanceof Error ? e.message : e) },
    });
  }

  // ---- SMS via Twilio connector (only if user opted in AND requested AND we have credentials). ----
  if (a.smsRequested && profile.sms_opt_in && profile.phone_e164) {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const twilioKey = process.env.TWILIO_API_KEY;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    if (!lovableKey || !twilioKey || !fromNumber) {
      await supabaseAdmin.from("audit_events").insert({
        actor_id: a.patientId, action: "sms.skipped", entity: "appointments", entity_id: a.appointmentId,
        meta: { reason: "twilio_not_configured" },
      });
      return;
    }
    const localTime = a.startsAt.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const link = a.channel === "telemedicine" ? roomUrl : apptUrl;
    const body = `ApexCare: visit with ${a.providerName} on ${localTime}. ${a.channel === "telemedicine" ? "Join: " : "Details: "}${link} Reply STOP to opt out.`;
    try {
      const res = await fetch("https://connector-gateway.lovable.dev/twilio/Messages.json", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": twilioKey,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: profile.phone_e164, From: fromNumber, Body: body }),
      });
      const data = await res.json().catch(() => ({}));
      await supabaseAdmin.from("audit_events").insert({
        actor_id: a.patientId,
        action: res.ok ? "sms.sent" : "sms.failed",
        entity: "appointments", entity_id: a.appointmentId,
        meta: { sid: (data as { sid?: string }).sid ?? null, status: res.status },
      });
    } catch (e) {
      await supabaseAdmin.from("audit_events").insert({
        actor_id: a.patientId, action: "sms.failed", entity: "appointments", entity_id: a.appointmentId,
        meta: { error: String(e instanceof Error ? e.message : e) },
      });
    }
  }
}
