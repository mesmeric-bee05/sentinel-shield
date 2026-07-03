// Server-only HMAC-signed CSRF token utilities.
// Token format: `${base64url(iat)}.${base64url(hmacSHA256(secret, userId + "|" + iat))}`
// TTL: 2 hours. Verified in constant time. Never persisted; issued per session
// and rotated on demand by the client attacher when a request comes back 403.
import { createHmac, timingSafeEqual } from "crypto";

const TTL_MS = 2 * 60 * 60 * 1000;

function getSecret(): string {
  // CSRF_SECRET is provisioned; fall back to SUPABASE_SERVICE_ROLE_KEY hashed
  // so tokens still work in environments where CSRF_SECRET is missing (dev).
  const s = process.env.CSRF_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("CSRF_SECRET (or SUPABASE_SERVICE_ROLE_KEY) not set");
  return s;
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromB64url(s: string): Buffer {
  const pad = 4 - (s.length % 4);
  const norm = (s + (pad < 4 ? "=".repeat(pad) : "")).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(norm, "base64");
}

function sign(userId: string, iat: number): string {
  const secret = getSecret();
  const mac = createHmac("sha256", secret).update(`${userId}|${iat}`).digest();
  return `${b64url(String(iat))}.${b64url(mac)}`;
}

export function issueCsrfToken(userId: string): { token: string; expiresAt: number } {
  const iat = Date.now();
  return { token: sign(userId, iat), expiresAt: iat + TTL_MS };
}

export function verifyCsrfToken(userId: string, token: string | null | undefined): boolean {
  if (!token || typeof token !== "string" || !token.includes(".")) return false;
  const [iatPart, macPart] = token.split(".");
  const iatBuf = fromB64url(iatPart);
  const iat = Number(iatBuf.toString("utf8"));
  if (!Number.isFinite(iat)) return false;
  if (Date.now() - iat > TTL_MS) return false;

  const expected = createHmac("sha256", getSecret()).update(`${userId}|${iat}`).digest();
  const actual = fromB64url(macPart);
  if (expected.length !== actual.length) return false;
  try {
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
