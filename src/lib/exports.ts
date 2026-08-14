// CSV / JSON download helpers for admin history panels.
// The pure serializers (`toCsv`, `sanitizeCell`) are isomorphic and are also
// used by the server-side async export job runner; only the `download*`
// helpers touch the DOM and must be called from browser event handlers.

export type ExportColumn<T> = { key: string; label: string; value: (row: T) => string | number | null | undefined };

/**
 * Spreadsheet formula-injection guard.
 *
 * Excel / Google Sheets / LibreOffice treat a cell whose first character is
 * one of `= + - @` (or a leading TAB / CR, which those characters can hide
 * behind) as a formula. Exported text originates from the security-sync
 * webhook, scanner titles, free-text audit notes and JSON filter blobs, so a
 * crafted value such as `=cmd|'/c calc'!A1` would execute on open.
 *
 * Every string written into a tabular export — row cells, column HEADERS and
 * metadata fields alike — goes through `sanitizeCell`, which prefixes a single
 * quote. Spreadsheets strip the quote on display, so the value still reads as
 * the original plain text.
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/** True when the raw string would be parsed as a formula by a spreadsheet. */
export function isFormulaTrigger(s: string): boolean {
  return FORMULA_TRIGGER.test(s);
}

/** Prefix a dangerous leading character with `'` so it stays inert text. */
export function neutralizeFormula(s: string): string {
  return FORMULA_TRIGGER.test(s) ? `'${s}` : s;
}

/**
 * Normalize any exportable value to a spreadsheet-safe string.
 * Numbers and booleans pass through verbatim (they can never be formulas);
 * arrays and objects are flattened first, then neutralized.
 */
export function sanitizeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const raw =
    typeof v === "string" ? v : Array.isArray(v) ? v.map((x) => (x === null || x === undefined ? "" : String(x))).join("; ") : JSON.stringify(v);
  return neutralizeFormula(raw);
}

/** RFC-4180 quoting applied on top of the formula guard. */
export function csvEscape(v: unknown): string {
  const s = sanitizeCell(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T>(rows: T[], cols: ExportColumn<T>[]): string {
  // Headers are sanitized too: dataset labels can come from stored config.
  const header = cols.map((c) => csvEscape(c.label)).join(",");
  const body = rows.map((r) => cols.map((c) => csvEscape(c.value(r))).join(",")).join("\n");
  return `${header}\n${body}\n`;
}

/**
 * Convert arbitrary JSON records to CSV, deriving the column set from the
 * union of keys. Used when an export has no declared column registry so the
 * same escaping rules still apply to JSON-to-CSV conversions.
 */
export function jsonRowsToCsv(rows: Array<Record<string, unknown>>): string {
  const keys: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  const cols: ExportColumn<Record<string, unknown>>[] = keys.map((k) => ({ key: k, label: k, value: (r) => sanitizeCell(r[k]) }));
  return toCsv(rows, cols);
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv<T>(filename: string, rows: T[], cols: ExportColumn<T>[]) {
  download(filename.endsWith(".csv") ? filename : `${filename}.csv`, toCsv(rows, cols), "text/csv;charset=utf-8");
}

export function downloadJson<T>(filename: string, rows: T[]) {
  download(filename.endsWith(".json") ? filename : `${filename}.json`, JSON.stringify(rows, null, 2), "application/json");
}

export function timestampedName(base: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${base}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
