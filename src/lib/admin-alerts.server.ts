// Admin alert emails: booking alerts, security-sync spike alerts.
// Delivery is best-effort and every attempt is logged to `audit_events` so the
// admin notification history page shows it. Alert settings live in the
// single-row `admin_alert_settings` table (RLS: admin read/update only).

type Admin = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (t: string) => any;
};

export type AlertSettings = {
  alert_email: string;
  spike_window_minutes: number;
  spike_threshold: number;
};

export async function getAlertSettings(admin: Admin): Promise<AlertSettings | null> {
  const { data, error } = await admin.from("admin_alert_settings").select("alert_email, spike_window_minutes, spike_threshold").eq("id", 1).maybeSingle();
  if (error || !data) return null;
  return data as AlertSettings;
}

async function sendTemplate(opts: {
  admin: Admin;
  templateName: string;
  recipient: string;
  idempotencyKey: string;
  templateData: Record<string, unknown>;
  auditEntity: string;
  auditEntityId: string | null;
}): Promise<void> {
  const appUrl = (process.env["APP_BASE_URL"] ?? "https://harmony-forge-nexus.lovable.app").replace(/\/$/, "");
  let httpStatus = 0;
  let errMsg: string | null = null;
  try {
    const res = await fetch(`${appUrl}/lovable/email/transactional/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-source": "admin-alert" },
      body: JSON.stringify({
        templateName: opts.templateName,
        recipientEmail: opts.recipient,
        idempotencyKey: opts.idempotencyKey,
        templateData: opts.templateData,
      }),
    });
    httpStatus = res.status;
    if (!res.ok) errMsg = `Send route returned ${res.status}`;
  } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e);
  }

  try {
    await opts.admin.from("audit_events").insert({
      actor_id: null,
      action: errMsg ? "email.failed" : "email.queued",
      entity: opts.auditEntity,
      entity_id: opts.auditEntityId,
      meta: {
        template: opts.templateName,
        recipient: opts.recipient,
        idempotency_key: opts.idempotencyKey,
        http_status: httpStatus,
        error: errMsg,
      },
    });
  } catch {
    // Alert logging must never throw into the caller's flow.
  }
}

/** New-booking alert to the admin address. Fire-and-forget. */
export async function notifyAdminBooking(input: {
  admin: Admin;
  appointmentId: string;
  patientName: string;
  patientEmail: string;
  providerName: string;
  whenLocal: string;
  channel: string;
  reason: string;
}): Promise<void> {
  const settings = await getAlertSettings(input.admin);
  if (!settings?.alert_email) return;
  const appUrl = (process.env["APP_BASE_URL"] ?? "https://harmony-forge-nexus.lovable.app").replace(/\/$/, "");
  await sendTemplate({
    admin: input.admin,
    templateName: "admin-booking-alert",
    recipient: settings.alert_email,
    idempotencyKey: `admin-booking-alert-${input.appointmentId}`,
    templateData: {
      patientName: input.patientName,
      patientEmail: input.patientEmail,
      providerName: input.providerName,
      whenLocal: input.whenLocal,
      channel: input.channel,
      reason: input.reason,
      bookingsUrl: `${appUrl}/app/admin/bookings`,
    },
    auditEntity: "appointments",
    auditEntityId: input.appointmentId,
  });
}

/**
 * Security-sync spike alert. Counts non-accepted sync attempts inside the
 * configured window; fires at most once per window bucket via the
 * idempotency key, so repeated failures do not flood the inbox.
 * Returns true when an alert email was queued.
 */
export async function maybeSendSyncSpikeAlert(input: {
  admin: Admin;
  windowMinutes: number;
  threshold: number;
  nowMs?: number;
}): Promise<boolean> {
  const now = input.nowMs ?? Date.now();
  const since = new Date(now - input.windowMinutes * 60_000).toISOString();
  const { data: rows, error } = await input.admin
    .from("security_sync_attempts")
    .select("status, error, source_ip, received_at")
    .neq("status", "accepted")
    .gte("received_at", since)
    .order("received_at", { ascending: false })
    .limit(500);
  if (error || !rows) return false;
  const failures = rows.length;
  if (failures < input.threshold) return false;

  const windowStart = Math.floor(now / (input.windowMinutes * 60_000));
  const idem = `sync-spike-${windowStart}-${input.windowMinutes}`;
  const byStatus = rows.reduce<Record<string, number>>((acc, r) => {
    const k = String((r as { status?: string }).status ?? "unknown");
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const breakdown = Object.entries(byStatus)
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");
  const latest = rows[0] as { error?: string | null; source_ip?: string | null };
  const appUrl = (process.env["APP_BASE_URL"] ?? "https://harmony-forge-nexus.lovable.app").replace(/\/$/, "");

  await sendTemplate({
    admin: input.admin,
    templateName: "security-sync-spike",
    recipient: (await getAlertSettings(input.admin))?.alert_email ?? "",
    idempotencyKey: idem,
    templateData: {
      windowMinutes: input.windowMinutes,
      threshold: input.threshold,
      failures,
      breakdown,
      lastError: latest.error ?? "",
      lastSourceIp: latest.source_ip ?? "",
      auditUrl: `${appUrl}/app/admin/security-sync`,
    },
    auditEntity: "security_sync_attempts",
    auditEntityId: null,
  });
  return true;
}
