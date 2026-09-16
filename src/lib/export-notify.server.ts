// Optional completion / failure notification for async security export jobs.
//
// Delivery is best-effort: a notification problem must never change the
// outcome of an export job. Every attempt is recorded in `audit_events` so the
// admin notification history page shows it alongside other mail.

type Admin = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (t: string) => any;
};

export type ExportNotifyInput = {
  admin: Admin;
  jobId: string;
  actorId: string;
  recipient: string;
  dataset: string;
  format: string;
  status: "complete" | "failed";
  rows: number;
  error: string | null;
};

/** Send (best effort) an export-outcome email and log the attempt. */
export async function notifyExportOutcome(input: ExportNotifyInput): Promise<void> {
  const appUrl = (process.env['APP_BASE_URL'] ?? "https://harmony-forge-nexus.lovable.app").replace(/\/$/, "");
  const idem = `export-job-${input.jobId}-${input.status}`;
  let httpStatus = 0;
  let errMsg: string | null = null;

  try {
    const res = await fetch(`${appUrl}/lovable/email/transactional/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-source": "security-export" },
      body: JSON.stringify({
        templateName: "export-job-status",
        recipientEmail: input.recipient,
        idempotencyKey: idem,
        templateData: {
          dataset: input.dataset,
          format: input.format.toUpperCase(),
          status: input.status,
          rows: input.rows,
          error: input.error ?? "",
          jobsUrl: `${appUrl}/app/admin/security-exports`,
        },
      }),
    });
    httpStatus = res.status;
    if (!res.ok) errMsg = `Send route returned ${res.status}`;
  } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e);
  }

  try {
    await input.admin.from("audit_events").insert({
      actor_id: input.actorId,
      action: errMsg ? "email.failed" : "email.queued",
      entity: "security_export_jobs",
      entity_id: input.jobId,
      meta: {
        template: "export-job-status",
        recipient: input.recipient,
        idempotency_key: idem,
        http_status: httpStatus,
        job_status: input.status,
        error: errMsg,
      },
    });
    await input.admin.from("security_export_jobs").update({ notified_at: new Date().toISOString() }).eq("id", input.jobId);
  } catch {
    // Logging failures are swallowed on purpose — the export already succeeded.
  }
}
