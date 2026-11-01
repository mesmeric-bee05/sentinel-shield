// Regression checks for the six findings fixed on 2026-11-01.
// Pure-code assertions: no network or database needed.
import { readFileSync, readdirSync } from "node:fs";
import { csvEscape } from "../../src/lib/exports";
import { ilikeTerm } from "../../src/lib/postgrest-search";

let pass = 0, fail = 0;
function check(name: string, ok: boolean) {
  if (ok) { pass++; console.log(`✓ ${name}`); } else { fail++; console.error(`✗ ${name}`); }
}

// 1. Audit log CSV export neutralizes formulas in every cell, headers included.
check("formula email becomes text", /^"?'/.test(csvEscape("=HYPERLINK(\"http://x\",\"y\")")));
check("plus prefix neutralized", csvEscape("+SUM(A1)").startsWith("'"));
check("minus prefix neutralized", csvEscape("-1+1").startsWith("'"));
const audit = readFileSync("src/routes/app.admin.audit.tsx", "utf8");
check("audit export uses csvEscape", audit.includes(".map(csvEscape)"));
check("audit export no raw quoting", !audit.includes(".replace(/\"/g"));

// 2. Search terms cannot alter PostgREST or() filters.
check("strips filter syntax", ilikeTerm("a),b),id.eq.1") === "a  b  id.eq.1");
check("escapes LIKE wildcards", ilikeTerm("100%_done") === "100\\%\\_done");
check("strips backslashes and quotes", !/[\\"']/.test(ilikeTerm('x\\y"z\'w')));
check("caps length", ilikeTerm("x".repeat(500)).length <= 120);
const roles = readFileSync("src/lib/roles.functions.ts", "utf8");
check("user search sanitizes term", roles.includes("const term = ilikeTerm(data.q);"));
check("user search embeds sanitized term", roles.includes("email.ilike.%${term}%"));
check("no raw user search term in or()", !roles.includes("${data.q}"));
const security = readFileSync("src/lib/security.functions.ts", "utf8");
check("findings export sanitizes search", (security.match(/ilikeTerm\(data\.search\)/g) ?? []).length >= 2);
check("no raw search term in security exports", !security.includes("${data.search}%"));

// 3. Bootstrap now needs the server-side setup key and the admin client.
check("bootstrap requires setup key", roles.includes('process.env["ADMIN_BOOTSTRAP_SECRET"]'));
check("bootstrap fails closed without secret", /if \(!expected \|\| data\.setupKey !== expected\)/.test(roles));
check("bootstrap no longer calls the client rpc", !roles.includes('rpc("bootstrap_first_admin"'));
check("bootstrap writes through admin client", roles.includes('.from("user_roles")\n      .upsert({ user_id: context.userId, role: "admin" }'));
const bootstrapPage = readFileSync("src/routes/app.bootstrap.tsx", "utf8");
check("bootstrap page collects setup key", bootstrapPage.includes("setupKey"));
check("bootstrap page sends setup key", bootstrapPage.includes("setupKey }"));

// 4. Migration: revokes the RPC from clients and guards provider rating.
const migrationDirs = ["supabase/migrations", "drizzle/migrations"];
const nov1 = migrationDirs.flatMap((d) => {
  try { return readdirSync(d).filter((f) => f.endsWith(".sql")).map((f) => `${d}/${f}`); } catch { return []; }
})
  .map((p) => ({ p, sql: readFileSync(p, "utf8") }))
  .find((m) => m.sql.includes("providers_guard_rating"));
check("rating-guard migration exists", nov1 !== undefined);
if (nov1) {
  check("migration revokes bootstrap rpc from authenticated", /REVOKE EXECUTE ON FUNCTION public\.bootstrap_first_admin\(uuid\) FROM PUBLIC, anon, authenticated/.test(nov1.sql));
  check("migration blocks non-admin rating change", nov1.sql.includes("NEW.rating IS DISTINCT FROM OLD.rating"));
  check("migration trigger uses security invoker", nov1.sql.includes("SECURITY INVOKER"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
