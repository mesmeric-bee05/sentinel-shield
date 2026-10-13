// Regression checks for the five findings fixed on 2026-10-13.
// Pure-code assertions: no network or database needed.
import { readFileSync } from "node:fs";
import { safeNext } from "../../src/lib/safe-next";
import { sanitizeCell } from "../../src/lib/exports";

let pass = 0, fail = 0;
function check(name: string, ok: boolean) {
  if (ok) { pass++; console.log(`✓ ${name}`); } else { fail++; console.error(`✗ ${name}`); }
}

// 1. Login redirect rejects off-site targets.
check("redirect keeps same-site path", safeNext("/app/admin?x=1") === "/app/admin?x=1");
check("redirect rejects //evil.com", safeNext("//evil.com") === undefined);
check("redirect rejects /\\evil.com", safeNext("/\\evil.com") === undefined);
check("redirect rejects absolute URL", safeNext("https://evil.com") === undefined);
check("redirect rejects tab trick", safeNext("/\t/evil.com") === undefined);

// 2. Notifications CSV neutralizes formulas.
check("formula name becomes text", sanitizeCell("=HYPERLINK(\"x\")").startsWith("'"));
check("@ prefix neutralized", sanitizeCell("@SUM(A1)").startsWith("'"));
const notif = readFileSync("src/routes/app.admin.notifications.index.tsx", "utf8");
check("notifications export uses sanitizeCell", notif.includes("sanitizeCell(c)"));

// 3. Retention cleanup no longer accepts the public key.
const cleanup = readFileSync("src/routes/api/public/security-retention-cleanup.ts", "utf8");
check("cleanup uses dedicated secret", cleanup.includes("RETENTION_CLEANUP_SECRET"));
check("cleanup ignores publishable/anon key", !/process\.env\[['"]SUPABASE_(ANON|PUBLISHABLE)_KEY/.test(cleanup));

// 4 + 5. CHW scoping.
const chw = readFileSync("src/lib/chw.functions.ts", "utf8");
check("workers scoped to own assignments", chw.includes('q = q.eq("chw_id", meWorker.id);\n    }'));
check("providers need an appointment with the patient", /eq\("provider_id", prov\.id\)\.eq\("patient_id", data\.patient_id\)/.test(chw));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
