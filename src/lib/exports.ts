// CSV / JSON download helpers for admin history panels.
// Browser-only — call from event handlers.

export type ExportColumn<T> = { key: string; label: string; value: (row: T) => string | number | null | undefined };

// Spreadsheet formula-injection guard: Excel/Sheets treat a cell starting with
// =, +, -, @, TAB or CR as a formula. Export text can originate from the
// security-sync webhook or free-text audit notes, so neutralize it with a
// leading apostrophe before normal CSV quoting.
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function neutralizeFormula(s: string): string {
  return FORMULA_TRIGGER.test(s) ? `'${s}` : s;
}

function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  // Numbers are emitted verbatim: they can never be interpreted as a formula.
  const s = typeof v === "number" ? String(v) : neutralizeFormula(String(v));
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}


export function toCsv<T>(rows: T[], cols: ExportColumn<T>[]): string {
  const header = cols.map((c) => csvEscape(c.label)).join(",");
  const body = rows.map((r) => cols.map((c) => csvEscape(c.value(r))).join(",")).join("\n");
  return `${header}\n${body}\n`;
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
