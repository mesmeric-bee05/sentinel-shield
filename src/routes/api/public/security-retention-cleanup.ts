// Scheduled retention cleanup endpoint.
//
// Called by pg_cron via pg_net with the project's anon/publishable key in the
// `apikey` header. The route lives under /api/public/* (edge auth bypassed), so
// it verifies the caller itself before doing any deletion.
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";
import { emitSecurityEvent } from "@/lib/telemetry";

function keyMatches(provided: string | null): boolean {
  const expected = process.env['SUPABASE_ANON_KEY'] ?? process.env['SUPABASE_PUBLISHABLE_KEY'] ?? "";
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/public/security-retention-cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = request.headers.get("apikey") ?? request.headers.get("x-api-key");
        if (!keyMatches(apiKey)) {
          emitSecurityEvent({ event: "security.retention.denied", severity: "warning", attrs: { reason: "bad_api_key" } });
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runRetentionCleanup } = await import("@/lib/security-retention.server");
        const result = await runRetentionCleanup({ admin: supabaseAdmin as never, source: "cron" });

        emitSecurityEvent({
          event: result.error ? "security.retention.failed" : "security.retention.completed",
          severity: result.error ? "error" : "info",
          attrs: { source: "cron", ...result },
        });

        return new Response(JSON.stringify(result), {
          status: result.error ? 500 : 200,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
