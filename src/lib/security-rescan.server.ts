// Targeted, in-process rechecks for findings that can be proven by exercising
// the actual application code path rather than waiting for a full scan.
import { jsonRowsToCsv } from "@/lib/exports";

export type FindingCheck = { supported: boolean; pass: boolean; detail: string; endpoints: string[] };

const CANARIES = ["=1+1", "+1", "-1", "@SUM(A1)", "\tcmd", "\r\nHYPERLINK"];

function csvInjectionCheck(): FindingCheck {
  const rows = CANARIES.map((v, i) => ({ "=header": v, safe: i }));
  const csv = jsonRowsToCsv(rows);
  const cells = csv.split(/\r?\n/).flatMap((line) => line.split(","));
  const unsafe = cells.filter((c) => /^"?[=+\-@\t\r]/.test(c));
  return {
    supported: true,
    pass: unsafe.length === 0,
    detail: unsafe.length === 0
      ? `All ${CANARIES.length} formula canaries (and the "=header" column name) were neutralized with a leading apostrophe.`
      : `Unescaped cells still start with a spreadsheet trigger: ${unsafe.slice(0, 3).join(" | ")}`,
    endpoints: ["src/lib/exports.ts", "/api/public/security-export-download"],
  };
}

const CHECKS: Record<string, () => FindingCheck> = {
  csv_export_formula_inj: csvInjectionCheck,
};

export function runFindingCheck(internalId: string): FindingCheck {
  const check = CHECKS[internalId];
  if (!check) return { supported: false, pass: false, detail: "", endpoints: [] };
  return check();
}
