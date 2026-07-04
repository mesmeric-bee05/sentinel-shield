// Public HMAC-protected sync endpoint for security findings.
// External scanners POST { nonce, issued_at, findings: [...] } signed with
// SECURITY_SYNC_SECRET (raw body HMAC-SHA256 hex in the `x-signature` header).
//
// Replay protection: every request MUST carry a unique `nonce` and an
// `issued_at` timestamp within ±5 minutes of server time. The nonce is
// persisted to `security_sync_attempts` under a UNIQUE index — a duplicate
// nonce is a 409 and never re-applies findings.
//
// Every attempt (success or failure) is logged to `security_sync_attempts`
// for the admin sync-audit page.
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

const REPLAY_WINDOW_MS = 5 * 60 * 1000;

const FindingSchema = z.object({
  scanner_name: z.string().min(1).max(100),
  internal_id: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  severity: z.enum(["error", "warn", "info"]),
  resource: z.string().max(500).optional().nullable(),
  status: z.enum(["open", "fixed", "ignored"]).default("open"),
  rationale: z.string().max(2000).optional().nullable(),
});
const BodySchema = z.object({
  nonce: z.string().min(16).max(128),
  issued_at: z.string().datetime(),
  findings: z.array(FindingSchema).max(500),
});

type AttemptStatus =
  | "accepted"
  | "invalid_signature"
  | "invalid_payload"
  | "replay"
  | "disabled"
  | "write_failed";

function verifySignature(secret: string, rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const sig = Buffer.from(signatureHeader);
  const exp = Buffer.from(expected);
  if (sig.length !== exp.length) return false;
  try { return timingSafeEqual(sig, exp); } catch { return false; }
}

function clientIp(request: Request): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? null;
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip") ?? null;
}

export const Route = createFileRoute("/api/public/security-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const t0 = Date.now();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const ip = clientIp(request);

        const logAttempt = async (opts: {
          status: AttemptStatus;
          signature_valid: boolean;
          nonce: string | null;
          payload_bytes: number | null;
          finding_count: number | null;
          error: string | null;
        }) => {
          try {
            await supabaseAdmin.from("security_sync_attempts" as never).insert({
              source_ip: ip,
              nonce: opts.nonce,
              signature_valid: opts.signature_valid,
              payload_bytes: opts.payload_bytes,
              finding_count: opts.finding_count,
              status: opts.status,
              error: opts.error,
              duration_ms: Date.now() - t0,
            } as never);
          } catch {
            // Never fail the response because attempt logging failed.
          }
        };

        const secret = process.env.SECURITY_SYNC_SECRET;
        if (!secret) {
          await logAttempt({ status: "disabled", signature_valid: false, nonce: null, payload_bytes: null, finding_count: null, error: "SECURITY_SYNC_SECRET unset" });
          return new Response("sync_disabled", { status: 503 });
        }

        const raw = await request.text();
        const payloadBytes = raw.length;
        const signatureValid = verifySignature(secret, raw, request.headers.get("x-signature"));
        if (!signatureValid) {
          await logAttempt({ status: "invalid_signature", signature_valid: false, nonce: null, payload_bytes: payloadBytes, finding_count: null, error: "signature mismatch" });
          return new Response("invalid_signature", { status: 401 });
        }

        let parsed: z.infer<typeof BodySchema>;
        try {
          parsed = BodySchema.parse(JSON.parse(raw));
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unknown";
          await logAttempt({ status: "invalid_payload", signature_valid: true, nonce: null, payload_bytes: payloadBytes, finding_count: null, error: msg });
          return new Response(`invalid_payload: ${msg}`, { status: 400 });
        }

        const issuedMs = new Date(parsed.issued_at).getTime();
        if (!Number.isFinite(issuedMs) || Math.abs(Date.now() - issuedMs) > REPLAY_WINDOW_MS) {
          await logAttempt({ status: "invalid_payload", signature_valid: true, nonce: parsed.nonce, payload_bytes: payloadBytes, finding_count: parsed.findings.length, error: "issued_at outside replay window" });
          return new Response("invalid_payload: stale issued_at", { status: 400 });
        }

        // Reserve the nonce first. UNIQUE index on nonce enforces replay protection.
        const { error: attemptErr } = await supabaseAdmin
          .from("security_sync_attempts" as never)
          .insert({
            source_ip: ip,
            nonce: parsed.nonce,
            signature_valid: true,
            payload_bytes: payloadBytes,
            finding_count: parsed.findings.length,
            status: "accepted",
            duration_ms: Date.now() - t0,
          } as never);
        if (attemptErr) {
          if ((attemptErr as { code?: string }).code === "23505") {
            // Fresh log row (nonce would collide, so leave nonce null for the audit row).
            await logAttempt({ status: "replay", signature_valid: true, nonce: null, payload_bytes: payloadBytes, finding_count: parsed.findings.length, error: `duplicate nonce ${parsed.nonce}` });
            return new Response("replay", { status: 409 });
          }
          await logAttempt({ status: "write_failed", signature_valid: true, nonce: null, payload_bytes: payloadBytes, finding_count: parsed.findings.length, error: attemptErr.message });
          return new Response(`attempt_log_failed: ${attemptErr.message}`, { status: 500 });
        }

        const now = new Date().toISOString();
        const rows = parsed.findings.map((f) => ({
          scanner_name: f.scanner_name,
          internal_id: f.internal_id,
          title: f.title,
          severity: f.severity,
          resource: f.resource ?? null,
          status: f.status,
          rationale: f.rationale ?? null,
          last_seen_at: now,
        }));

        const { error } = await supabaseAdmin
          .from("security_findings")
          .upsert(rows, { onConflict: "scanner_name,internal_id" });
        if (error) {
          await logAttempt({ status: "write_failed", signature_valid: true, nonce: null, payload_bytes: payloadBytes, finding_count: rows.length, error: error.message });
          return new Response(`upsert_failed: ${error.message}`, { status: 500 });
        }

        return Response.json({ ok: true, upserted: rows.length, nonce: parsed.nonce });
      },
    },
  },
});
