// End-to-end regression for finding `csv_export_formula_inj`.
//
// Verifies that spreadsheet-dangerous payloads are neutralized to plain text
// across BOTH tabular export paths:
//   1. the declared-column path (`toCsv`) used by client downloads and the
//      async export job runner (`serializeRows`),
//   2. the schemaless JSON-to-CSV path (`jsonRowsToCsv`).
//
// The assertions are shared so any future tabular format inherits the check.
import { describe, it, expect } from "vitest";
import { toCsv, jsonRowsToCsv, sanitizeCell, csvEscape, type ExportColumn } from "@/lib/exports";
import { serializeRows } from "@/lib/security-export-jobs.server";

const PAYLOADS = [
  "=cmd|'/c calc'!A1",
  "+1+1",
  "-2+3",
  "@SUM(A1)",
  "\tcmd /c calc",
  "\r=1+1",
  '=HYPERLINK("http://evil","click"),drop',
];

/** Split a CSV line into raw fields, honouring RFC-4180 quoting. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Parse a whole CSV document (records may contain quoted newlines). */
function parseCsv(csv: string): string[][] {
  const records: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') { quoted = !quoted; cur += ch; continue; }
    if (!quoted && ch === "\n") { records.push(cur.replace(/\r$/, "")); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim() !== "") records.push(cur);
  return records.map(parseCsvLine);
}

/** Shared assertion: no parsed cell may still start with a formula trigger. */
function assertNoLiveFormulas(csv: string) {
  const rows = parseCsv(csv);
  expect(rows.length).toBeGreaterThan(1);
  for (const row of rows) {
    for (const cell of row) {
      expect(cell, `cell "${cell}" opens as a formula`).not.toMatch(/^[=+\-@\t\r]/);
    }
  }
  return rows;
}

/** Shared assertion: the original text survives, only prefixed with `'`. */
function assertRoundTrips(cells: string[], originals: string[]) {
  for (const original of originals) {
    const expected = /^[=+\-@\t\r]/.test(original) ? `'${original}` : original;
    expect(cells).toContain(expected);
  }
}

describe("csv_export_formula_inj — declared-column CSV downloads", () => {
  type Row = { note: string; count: number };
  const cols: ExportColumn<Row>[] = [
    { key: "note", label: "=note", value: (r) => r.note },
    { key: "count", label: "count", value: (r) => r.count },
  ];

  it("escapes payloads in every cell and keeps the CSV parseable", () => {
    const rows: Row[] = PAYLOADS.map((note, i) => ({ note, count: i }));
    const csv = toCsv(rows, cols);
    const parsed = assertNoLiveFormulas(csv);
    assertRoundTrips(parsed.flat(), PAYLOADS);
  });

  it("escapes formula-shaped column headers too", () => {
    const csv = toCsv([{ note: "safe", count: 1 }], cols);
    const header = parseCsv(csv)[0];
    expect(header[0]).toBe("'=note");
    expect(header[0]).not.toMatch(/^=/);
  });

  it("leaves numeric and boolean values untouched", () => {
    expect(sanitizeCell(-5)).toBe("-5");
    expect(sanitizeCell(false)).toBe("false");
    expect(csvEscape(42)).toBe("42");
  });
});

describe("csv_export_formula_inj — JSON-to-CSV conversions", () => {
  it("applies identical escaping when columns are derived from the data", () => {
    const rows = PAYLOADS.map((v, i) => ({ "=header": v, nested: { a: v }, list: [v, "x"], safe: i }));
    const csv = jsonRowsToCsv(rows);
    const parsed = assertNoLiveFormulas(csv);
    expect(parsed[0][0]).toBe("'=header");
    assertRoundTrips(parsed.flat(), PAYLOADS);
  });

  it("matches toCsv output for the same records", () => {
    const rows = PAYLOADS.map((v) => ({ note: v }));
    const viaJson = jsonRowsToCsv(rows);
    const viaCols = toCsv(rows, [{ key: "note", label: "note", value: (r) => r.note }]);
    expect(viaJson).toBe(viaCols);
  });
});

describe("csv_export_formula_inj — async export job serializer", () => {
  const rows = PAYLOADS.map((v, i) => ({
    id: `id-${i}`,
    internal_id: v,
    title: v,
    resource: v,
    severity: "high",
    status: "active",
    created_at: new Date(0).toISOString(),
  }));

  it("produces plain-text cells for the CSV format", () => {
    const csv = serializeRows("security_findings", rows as never, "csv");
    const parsed = assertNoLiveFormulas(csv);
    assertRoundTrips(parsed.flat(), PAYLOADS);
  });

  it("keeps JSON output byte-faithful (no spreadsheet parsing applies)", () => {
    const json = serializeRows("security_findings", rows as never, "json");
    expect(JSON.parse(json)[0].internal_id).toBe(PAYLOADS[0]);
  });
});
