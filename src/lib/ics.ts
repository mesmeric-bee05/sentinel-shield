// Minimal RFC 5545 ICS generator for a single VEVENT — no deps.
function escapeIcs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
function pad(n: number, w = 2) { return String(n).padStart(w, "0"); }
function fmtUtc(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
// Format a Date as a local timestamp in `tz` (no Z suffix), for use with TZID.
function fmtLocal(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(d).reduce<Record<string, string>>((acc, p) => { if (p.type !== "literal") acc[p.type] = p.value; return acc; }, {});
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}${parts.month}${parts.day}T${hour}${parts.minute}${parts.second}`;
}

export type IcsEvent = {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  url?: string;
  start: Date;
  end: Date;
  organizerEmail?: string;
  timeZone?: string; // IANA tz; if omitted, UTC is used
};

export function buildIcs(ev: IcsEvent): string {
  const tz = ev.timeZone;
  const dtStart = tz ? `DTSTART;TZID=${tz}:${fmtLocal(ev.start, tz)}` : `DTSTART:${fmtUtc(ev.start)}`;
  const dtEnd = tz ? `DTEND;TZID=${tz}:${fmtLocal(ev.end, tz)}` : `DTEND:${fmtUtc(ev.end)}`;

  // Minimal VTIMEZONE block; calendar apps will fall back to their own definitions for IANA names.
  const vtimezone = tz ? [
    "BEGIN:VTIMEZONE",
    `TZID:${tz}`,
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    `TZOFFSETFROM:${getOffset(ev.start, tz)}`,
    `TZOFFSETTO:${getOffset(ev.start, tz)}`,
    `TZNAME:${tz}`,
    "END:STANDARD",
    "END:VTIMEZONE",
  ] : [];

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ApexCare AI//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...vtimezone,
    "BEGIN:VEVENT",
    `UID:${ev.uid}@apexcare.ai`,
    `DTSTAMP:${fmtUtc(new Date())}`,
    dtStart,
    dtEnd,
    `SUMMARY:${escapeIcs(ev.title)}`,
    ev.description ? `DESCRIPTION:${escapeIcs(ev.description)}` : "",
    ev.location ? `LOCATION:${escapeIcs(ev.location)}` : "",
    ev.url ? `URL:${escapeIcs(ev.url)}` : "",
    ev.organizerEmail ? `ORGANIZER:mailto:${ev.organizerEmail}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}

function getOffset(d: Date, tz: string): string {
  // Returns ±HHMM
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset", hour: "2-digit" });
  const part = dtf.formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const m = part.match(/GMT([+-]?)(\d{1,2})(?::?(\d{2}))?/);
  if (!m) return "+0000";
  const sign = m[1] === "-" ? "-" : "+";
  const hh = m[2].padStart(2, "0");
  const mm = (m[3] ?? "00").padStart(2, "0");
  return `${sign}${hh}${mm}`;
}

export function downloadIcs(filename: string, ev: IcsEvent) {
  const blob = new Blob([buildIcs(ev)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** True if both Date instances refer to the same UTC instant. */
export function sameInstant(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}
