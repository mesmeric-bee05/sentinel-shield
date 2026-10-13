// Post-login redirect guard: only same-origin relative paths are allowed.
// Rejects "//host", "/\host", any backslash or control character, and
// anything that resolves to a different origin.
export function safeNext(v: unknown): string | undefined {
  if (typeof v !== "string" || v.length > 512) return undefined;
  if (!/^\/(?![/\\])/.test(v) || /[\\\u0000-\u001f]/.test(v)) return undefined;
  try {
    const u = new URL(v, "https://apexcare.invalid");
    if (u.origin !== "https://apexcare.invalid") return undefined;
    return u.pathname + u.search + u.hash;
  } catch {
    return undefined;
  }
}
