import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" });
  return Boolean(data);
}

export const getBookingEmailHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ appointmentId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await assertAdmin(context.userId))) {
      return { ok: false as const, error: "Forbidden", appointment: null, recipient: null, events: [] };
    }
    const { data: appt } = await supabaseAdmin
      .from("appointments")
      .select("id, starts_at, ends_at, channel, reason, ai_summary, patient_id, provider:providers(display_name, specialty, location)")
      .eq("id", data.appointmentId)
      .maybeSingle();
    if (!appt) return { ok: false as const, error: "Appointment not found", appointment: null, recipient: null, events: [] };

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, phone_e164, sms_opt_in")
      .eq("id", appt.patient_id)
      .maybeSingle();

    const { data: events } = await supabaseAdmin
      .from("audit_events")
      .select("id, action, created_at, meta")
      .eq("entity", "appointments")
      .eq("entity_id", data.appointmentId)
      .in("action", ["email.sent", "email.queued", "email.skipped", "email.failed", "email.resent", "sms.sent", "sms.skipped", "sms.failed"])
      .order("created_at", { ascending: false })
      .limit(100);

    return { ok: true as const, error: null, appointment: appt, recipient: profile, events: events ?? [] };
  });

export const resendBookingConfirmation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ appointmentId: z.string().uuid(), reason: z.string().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await assertAdmin(context.userId))) {
      return { ok: false as const, error: "Forbidden", status: 0 };
    }

    const { data: appt } = await supabaseAdmin
      .from("appointments")
      .select("id, starts_at, ends_at, channel, reason, ai_summary, patient_id, provider:providers(display_name, specialty, location)")
      .eq("id", data.appointmentId)
      .maybeSingle();
    if (!appt) return { ok: false as const, error: "Appointment not found", status: 0 };

    const { data: profile } = await supabaseAdmin
      .from("profiles").select("full_name, email").eq("id", appt.patient_id).maybeSingle();
    if (!profile?.email) return { ok: false as const, error: "Recipient has no email on file", status: 0 };

    // Suppression check (defence in depth — also enforced server-side by send route).
    const { data: suppressed } = await supabaseAdmin
      .from("suppressed_emails" as never)
      .select("email")
      .eq("email", profile.email)
      .maybeSingle();
    if (suppressed) return { ok: false as const, error: "Recipient is on the suppression list — cannot bypass.", status: 0 };

    const appUrl = (process.env.APP_BASE_URL ?? "https://harmony-forge-nexus.lovable.app").replace(/\/$/, "");
    const start = new Date(appt.starts_at);
    const idem = `booking-confirm-${appt.id}-resend-${Date.now()}`;

    let status = 0;
    let errMsg: string | null = null;
    try {
      const res = await fetch(`${appUrl}/lovable/email/transactional/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-source": "admin-resend" },
        body: JSON.stringify({
          templateName: "booking-confirmation",
          recipientEmail: profile.email,
          idempotencyKey: idem,
          templateData: {
            patientName: profile.full_name ?? "there",
            providerName: appt.provider?.display_name ?? "your provider",
            specialty: appt.provider?.specialty ?? "",
            whenLocal: start.toLocaleString(),
            whenUtc: start.toISOString(),
            channel: appt.channel,
            location: appt.provider?.location ?? "",
            roomUrl: `${appUrl}/app/room/${appt.id}`,
            appointmentUrl: `${appUrl}/app/appointments`,
            reason: appt.reason ?? "",
            aiSummary: appt.ai_summary ?? "",
          },
        }),
      });
      status = res.status;
      if (!res.ok) errMsg = `Send route returned ${res.status}`;
    } catch (e) {
      errMsg = e instanceof Error ? e.message : String(e);
    }

    await supabaseAdmin.from("audit_events").insert({
      actor_id: context.userId,
      action: errMsg ? "email.failed" : "email.resent",
      entity: "appointments",
      entity_id: appt.id,
      meta: { template: "booking-confirmation", idempotency_key: idem, status, reason: data.reason ?? null, error: errMsg },
    });

    return { ok: !errMsg, error: errMsg, status };
  });

export const previewBookingEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ appointmentId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await assertAdmin(context.userId))) return { ok: false as const, error: "Forbidden", data: null };
    const { data: appt } = await supabaseAdmin
      .from("appointments")
      .select("id, starts_at, channel, reason, ai_summary, patient_id, provider:providers(display_name, specialty, location)")
      .eq("id", data.appointmentId).maybeSingle();
    if (!appt) return { ok: false as const, error: "Not found", data: null };
    const { data: profile } = await supabaseAdmin.from("profiles").select("full_name, email").eq("id", appt.patient_id).maybeSingle();
    const appUrl = (process.env.APP_BASE_URL ?? "https://harmony-forge-nexus.lovable.app").replace(/\/$/, "");
    const start = new Date(appt.starts_at);
    return {
      ok: true as const, error: null,
      data: {
        recipientEmail: profile?.email ?? null,
        templateData: {
          patientName: profile?.full_name ?? "there",
          providerName: appt.provider?.display_name ?? "your provider",
          specialty: appt.provider?.specialty ?? "",
          whenLocal: start.toLocaleString(),
          whenUtc: start.toISOString(),
          channel: appt.channel,
          location: appt.provider?.location ?? "",
          roomUrl: `${appUrl}/app/room/${appt.id}`,
          appointmentUrl: `${appUrl}/app/appointments`,
          reason: appt.reason ?? "",
          aiSummary: appt.ai_summary ?? "",
        },
      },
    };
  });
