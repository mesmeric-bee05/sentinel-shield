// Minimal RFC 5545 ICS generator for a single VEVENT — no deps.
function escapeIcs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
function fmt(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
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
};

export function buildIcs(ev: IcsEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ApexCare AI//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ev.uid}@apexcare.ai`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(ev.start)}`,
    `DTEND:${fmt(ev.end)}`,
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
