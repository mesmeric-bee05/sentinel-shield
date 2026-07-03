// Public HMAC-protected sync endpoint for security findings.
// External scanners POST { findings: [...] } signed with SECURITY_SYNC_SECRET
// (raw body HMAC-SHA256 hex in the `x-signature` header). No user auth — this
// is a server-to-server webhook. Signature verification is mandatory before any
// DB write.
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

const FindingSchema = z.object({
  scanner_name: z.string().min(1).max(100),
  internal_id: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  severity: z.enum(["error", "warn", "info"]),
  resource: z.string().max(500).optional().nullable(),
  status: z.enum(["open", "fixed", "ignored"]).default("open"),
  rationale: z.string().max(2000).optional().nullable(),
});
const BodySchema = z.object({ findings: z.array(FindingSchema).max(500) });

function verifySignature(secret: string, rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const sig = Buffer.from(signatureHeader);
  const exp = Buffer.from(expected);
  if (sig.length !== exp.length) return false;
  try { return timingSafeEqual(sig, exp); } catch { return false; }
}

export const Route = createFileRoute("/api/public/security-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.SECURITY_SYNC_SECRET;
        if (!secret) return new Response("sync_disabled", { status: 503 });

        const raw = await request.text();
        if (!verifySignature(secret, raw, request.headers.get("x-signature"))) {
          return new Response("invalid_signature", { status: 401 });
        }

        let parsed: z.infer<typeof BodySchema>;
        try {
          parsed = BodySchema.parse(JSON.parse(raw));
        } catch (e) {
          return new Response(`invalid_payload: ${e instanceof Error ? e.message : "unknown"}`, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
        if (error) return new Response(`upsert_failed: ${error.message}`, { status: 500 });

        return Response.json({ ok: true, upserted: rows.length });
      },
    },
  },
});
