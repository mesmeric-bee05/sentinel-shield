// Redemption endpoint for time-limited security export download links.
//
// The link is minted by `mintSecurityExportDownload` only after the caller has
// passed the admin RBAC check. This route re-verifies the HMAC itself, so it
// does not depend on site auth (it lives under /api/public/* which bypasses the
// edge auth wrapper). Checks, in order:
//   1. token structure + HMAC signature (timing-safe) + expiry
//   2. the job row still carries the same token hash (revocable)
//   3. the token has not already been consumed (single use)
//   4. the job is complete and still holds a payload
import { createFileRoute } from "@tanstack/react-router";
import { verifyDownloadToken } from "@/lib/security-export-tokens.server";
import { emitSecurityEvent } from "@/lib/telemetry";

function deny(reason: string, status = 403) {
  emitSecurityEvent({ event: "security.export.download_denied", severity: "warning", attrs: { reason } });
  return new Response(reason, { status, headers: { "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/public/security-export-download")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = new URL(request.url).searchParams.get("token");
        const verified = verifyDownloadToken(token);
        if (!verified.ok) return deny(verified.reason, verified.reason === "expired" ? 410 : 403);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        const db = supabaseAdmin as unknown as { from: (t: string) => any };
        const { data: job, error } = await db
          .from("security_export_jobs")
          .select("id, dataset, format, status, result_payload, correlation_id, download_token_hash, download_token_expires_at, download_token_actor, download_consumed_at")
          .eq("id", verified.jobId)
          .maybeSingle();

        if (error) return deny("lookup_failed", 500);
        if (!job) return deny("job_not_found", 404);
        if (job.download_token_hash !== verified.tokenHash) return deny("token_revoked");
        if (job.download_token_actor && job.download_token_actor !== verified.actorId) return deny("actor_mismatch");
        if (job.download_consumed_at) return deny("token_already_used", 410);
        if (job.download_token_expires_at && Date.parse(job.download_token_expires_at) < Date.now()) return deny("expired", 410);
        if (job.status !== "complete" || !job.result_payload) return deny("job_not_complete", 409);

        // Single use: burn the token before handing over the bytes.
        await db
          .from("security_export_jobs")
          .update({ download_consumed_at: new Date().toISOString(), download_token_hash: null })
          .eq("id", job.id);

        emitSecurityEvent({
          correlationId: job.correlation_id ?? undefined,
          event: "security.export.downloaded",
          attrs: { dataset: job.dataset, job_id: job.id, user_id: verified.actorId, mode: "signed_url" },
        });

        const isJson = job.format === "json";
        const filename = `${job.dataset}-${job.id.slice(0, 8)}.${isJson ? "json" : "csv"}`;
        return new Response(job.result_payload, {
          status: 200,
          headers: {
            "Content-Type": isJson ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
            // Session-scoped, single-use content: never cacheable.
            "Cache-Control": "no-store, private",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
