// Server-only signed-download tokens for completed security export jobs.
//
// A token is minted only for an admin who has just passed the RBAC check, and
// is bound to (jobId, actorId, expiry). The public redemption endpoint
// re-derives the HMAC and compares it in constant time, then checks that the
// job row still carries the same token hash, that it has not expired, and that
// it has not already been consumed. Nothing about the payload is reachable
// without a valid, unexpired, unconsumed token.
import { createHmac, timingSafeEqual, randomBytes, createHash } from "crypto";

/** Default lifetime of a download link. */
export const DOWNLOAD_TTL_MS = 5 * 60 * 1000;

function getSecret(): string {
  const s = process.env['SECURITY_EXPORT_SECRET'] ?? process.env['CSRF_SECRET'] ?? process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!s) throw new Error("No signing secret available for export download tokens");
  return s;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromB64url(s: string): Buffer {
  const pad = 4 - (s.length % 4);
  return Buffer.from((s + (pad < 4 ? "=".repeat(pad) : "")).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function mac(jobId: string, actorId: string, exp: number, salt: string): Buffer {
  return createHmac("sha256", getSecret()).update(`${jobId}|${actorId}|${exp}|${salt}`).digest();
}

export type MintedToken = { token: string; tokenHash: string; expiresAt: string };

/** Mint a one-time token. Persist `tokenHash` + `expiresAt` on the job row. */
export function mintDownloadToken(jobId: string, actorId: string, ttlMs = DOWNLOAD_TTL_MS): MintedToken {
  const exp = Date.now() + ttlMs;
  const salt = randomBytes(12).toString("hex");
  const token = [b64url(Buffer.from(jobId)), b64url(Buffer.from(actorId)), b64url(Buffer.from(String(exp))), salt, b64url(mac(jobId, actorId, exp, salt))].join(".");
  return { token, tokenHash: hashToken(token), expiresAt: new Date(exp).toISOString() };
}

/** Stable hash stored on the job row — the raw token is never persisted. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type VerifiedToken = { ok: true; jobId: string; actorId: string; tokenHash: string } | { ok: false; reason: string };

/** Verify structure, signature and expiry. DB-side single-use is checked by the caller. */
export function verifyDownloadToken(token: string | null | undefined): VerifiedToken {
  if (!token || typeof token !== "string") return { ok: false, reason: "missing_token" };
  const parts = token.split(".");
  if (parts.length !== 5) return { ok: false, reason: "malformed_token" };
  const [jobPart, actorPart, expPart, salt, macPart] = parts as [string, string, string, string, string];
  let jobId: string, actorId: string, exp: number;
  try {
    jobId = fromB64url(jobPart).toString("utf8");
    actorId = fromB64url(actorPart).toString("utf8");
    exp = Number(fromB64url(expPart).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed_token" };
  }
  if (!Number.isFinite(exp)) return { ok: false, reason: "malformed_token" };

  const expected = mac(jobId, actorId, exp, salt);
  const actual = fromB64url(macPart);
  if (expected.length !== actual.length) return { ok: false, reason: "bad_signature" };
  let valid = false;
  try {
    valid = timingSafeEqual(expected, actual);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "bad_signature" };
  if (Date.now() > exp) return { ok: false, reason: "expired" };
  return { ok: true, jobId, actorId, tokenHash: hashToken(token) };
}
