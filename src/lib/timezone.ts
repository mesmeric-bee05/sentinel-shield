// Browser-safe timezone helpers
export function getBrowserTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

export function formatInTz(date: Date, tz: string, opts: Intl.DateTimeFormatOptions = {
  weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
}): string {
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: tz }).format(date);
}

export function formatUtc(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
  }).format(date);
}
