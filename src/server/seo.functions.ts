import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SITE = "https://harmony-forge-nexus.lovable.app";

// ---------------- GSC connector ----------------

const GATEWAY = "https://connector-gateway.lovable.dev/google_search_console";

function gscHeaders(): HeadersInit | null {
  const lk = process.env.LOVABLE_API_KEY;
  const ck = process.env.GOOGLE_SEARCH_CONSOLE_API_KEY;
  if (!lk || !ck) return null;
  return {
    Authorization: `Bearer ${lk}`,
    "X-Connection-Api-Key": ck,
    "Content-Type": "application/json",
  };
}

async function logGsc(opts: {
  kind: "verify" | "sitemap_resubmit" | "token_request";
  status: "success" | "failed";
  http_status?: number;
  error_message?: string | null;
  duration_ms: number;
  site_url?: string | null;
  actor_id?: string | null;
}) {
  try {
    await supabaseAdmin.from("gsc_republish_log").insert({
      kind: opts.kind,
      status: opts.status,
      http_status: opts.http_status ?? null,
      error_message: opts.error_message ?? null,
      duration_ms: opts.duration_ms,
      site_url: opts.site_url ?? null,
      actor_id: opts.actor_id ?? null,
    });
  } catch {
    /* best-effort */
  }
}

export const getSeoSettings = createServerFn({ method: "GET" })
  .handler(async () => {
    const { data } = await supabaseAdmin.from("seo_settings")
      .select("gsc_meta_token, gsc_site_url, gsc_verified_at, gsc_sitemap_submitted_at, updated_at")
      .eq("id", 1).single();
    return { settings: data ?? null };
  });

export const getGscState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { error: "Forbidden" as const };
    const connected = gscHeaders() !== null;
    const { data: settings } = await supabaseAdmin.from("seo_settings").select("*").eq("id", 1).single();
    return { error: null as string | null, connected, settings };
  });

const TokenInput = z.object({ siteUrl: z.string().url() });

export const requestGscToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => TokenInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { error: "Forbidden" as const };
    const headers = gscHeaders();
    if (!headers) return { error: "Google Search Console connector not linked." };

    const siteUrl = data.siteUrl.endsWith("/") ? data.siteUrl : `${data.siteUrl}/`;
    const started = Date.now();
    const r = await fetch(`${GATEWAY}/siteVerification/v1/token`, {
      method: "POST",
      headers,
      body: JSON.stringify({ site: { identifier: siteUrl, type: "SITE" }, verificationMethod: "META" }),
    });
    if (!r.ok) {
      const txt = await r.text();
      await logGsc({ kind: "token_request", status: "failed", http_status: r.status, error_message: txt.slice(0, 500), duration_ms: Date.now() - started, site_url: siteUrl, actor_id: context.userId });
      return { error: `GSC token request failed (${r.status}): ${friendlyGscError(txt, r.status)}` };
    }
    const j = (await r.json()) as { token: string };

    const tagContent = j.token.replace(/^<meta[^>]*content="/i, "").replace(/"[^>]*\/?>$/i, "");

    await supabaseAdmin.from("seo_settings").update({
      gsc_meta_token: tagContent,
      gsc_site_url: siteUrl,
      updated_at: new Date().toISOString(),
    }).eq("id", 1);
    await logGsc({ kind: "token_request", status: "success", http_status: 200, duration_ms: Date.now() - started, site_url: siteUrl, actor_id: context.userId });

    return { error: null, token: tagContent, siteUrl };
  });

export const verifyAndSubmitSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { error: "Forbidden" as const };
    const headers = gscHeaders();
    if (!headers) return { error: "Google Search Console connector not linked." };

    const { data: settings } = await supabaseAdmin.from("seo_settings").select("gsc_site_url").eq("id", 1).single();
    const siteUrl = settings?.gsc_site_url || `${SITE}/`;

    const startedV = Date.now();
    const vr = await fetch(`${GATEWAY}/siteVerification/v1/webResource?verificationMethod=META`, {
      method: "POST", headers,
      body: JSON.stringify({ site: { identifier: siteUrl, type: "SITE" } }),
    });
    if (!vr.ok) {
      const txt = await vr.text();
      await logGsc({ kind: "verify", status: "failed", http_status: vr.status, error_message: txt.slice(0, 500), duration_ms: Date.now() - startedV, site_url: siteUrl, actor_id: context.userId });
      return { error: `Verify failed (${vr.status}): ${friendlyGscError(txt, vr.status)}`, code: parseGscCode(txt) };
    }

    const encoded = encodeURIComponent(siteUrl);
    await fetch(`${GATEWAY}/webmasters/v3/sites/${encoded}`, { method: "PUT", headers });

    const sitemap = `${siteUrl.replace(/\/$/, "")}/sitemap.xml`;
    const startedS = Date.now();
    const sr = await fetch(`${GATEWAY}/webmasters/v3/sites/${encoded}/sitemaps/${encodeURIComponent(sitemap)}`, {
      method: "PUT", headers,
    });
    const sitemapErr = sr.ok ? null : (await sr.text()).slice(0, 500);
    await logGsc({ kind: "sitemap_resubmit", status: sr.ok ? "success" : "failed", http_status: sr.status, error_message: sitemapErr, duration_ms: Date.now() - startedS, site_url: siteUrl, actor_id: context.userId });

    const now = new Date().toISOString();
    await supabaseAdmin.from("seo_settings").update({
      gsc_verified_at: now,
      gsc_sitemap_submitted_at: sr.ok ? now : null,
      updated_at: now,
    }).eq("id", 1);
    await logGsc({ kind: "verify", status: "success", http_status: 200, duration_ms: Date.now() - startedV, site_url: siteUrl, actor_id: context.userId });

    await supabaseAdmin.from("audit_events").insert({
      actor_id: context.userId,
      action: "seo.gsc_verified",
      entity: "seo_settings",
      entity_id: null,
      meta: { siteUrl, sitemapSubmitted: sr.ok },
    });

    return { error: null as string | null, sitemapSubmitted: sr.ok, sitemapError: sitemapErr };
  });

export const resubmitSitemap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { error: "Forbidden" as const };
    const headers = gscHeaders();
    if (!headers) return { error: "Google Search Console connector not linked." };

    const { data: settings } = await supabaseAdmin.from("seo_settings").select("gsc_site_url, gsc_verified_at").eq("id", 1).single();
    if (!settings?.gsc_verified_at) return { error: "Verify the site first." };
    const siteUrl = settings.gsc_site_url || `${SITE}/`;
    const encoded = encodeURIComponent(siteUrl);
    const sitemap = `${siteUrl.replace(/\/$/, "")}/sitemap.xml`;
    const started = Date.now();
    const sr = await fetch(`${GATEWAY}/webmasters/v3/sites/${encoded}/sitemaps/${encodeURIComponent(sitemap)}`, {
      method: "PUT", headers,
    });
    if (!sr.ok) {
      const txt = await sr.text();
      await logGsc({ kind: "sitemap_resubmit", status: "failed", http_status: sr.status, error_message: txt.slice(0, 500), duration_ms: Date.now() - started, site_url: siteUrl, actor_id: context.userId });
      return { error: `Sitemap submit failed (${sr.status}): ${friendlyGscError(txt, sr.status)}` };
    }
    const now = new Date().toISOString();
    await supabaseAdmin.from("seo_settings").update({ gsc_sitemap_submitted_at: now, updated_at: now }).eq("id", 1);
    await logGsc({ kind: "sitemap_resubmit", status: "success", http_status: sr.status, duration_ms: Date.now() - started, site_url: siteUrl, actor_id: context.userId });
    await supabaseAdmin.from("audit_events").insert({
      actor_id: context.userId, action: "seo.gsc_sitemap_resubmitted", entity: "seo_settings", entity_id: null, meta: { siteUrl },
    });
    return { error: null as string | null };
  });

export const listGscHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { error: "Forbidden" as const, rows: [] };
    const { data } = await supabaseAdmin.from("gsc_republish_log")
      .select("id, kind, status, http_status, error_message, duration_ms, site_url, created_at")
      .order("created_at", { ascending: false }).limit(50);
    return { error: null as string | null, rows: data ?? [] };
  });

function parseGscCode(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string; errors?: Array<{ reason?: string }> } };
    return j.error?.errors?.[0]?.reason ?? "";
  } catch { return ""; }
}
function friendlyGscError(body: string, status: number): string {
  const code = parseGscCode(body);
  if (code === "failedToFindMetaTag") return "Google could not find the verification meta tag in the live HTML. Republish the site, then retry.";
  if (status === 401 || status === 403) return "Connector lacks permission — reconnect Google Search Console with the search-console scope.";
  if (status >= 500) return "Google returned a transient error. Auto-retrying.";
  return body.slice(0, 220);
}

// ---------------- SEO audit ----------------

export type SeoCheck = {
  id: string;
  label: string;
  category: "Meta" | "Open Graph" | "JSON-LD" | "Sitemap/robots" | "GSC" | "Lighthouse";
  status: "pass" | "fail" | "warn" | "pending";
  detail: string;
};

async function fetchText(url: string): Promise<{ ok: boolean; text: string; status: number }> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    return { ok: r.ok, text: await r.text(), status: r.status };
  } catch {
    return { ok: false, text: "", status: 0 };
  }
}

export const runSeoAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { error: "Forbidden" as const, runId: null, startedAt: new Date().toISOString(), durationMs: 0, checks: [] };
    const startedAt = new Date();
    const checks: SeoCheck[] = [];

    const home = await fetchText(`${SITE}/`);
    const robots = await fetchText(`${SITE}/robots.txt`);
    const sitemap = await fetchText(`${SITE}/sitemap.xml`);
    const llms = await fetchText(`${SITE}/llms.txt`);
    const about = await fetchText(`${SITE}/about`);
    const forProviders = await fetchText(`${SITE}/for-providers`);

    checks.push({
      id: "title", category: "Meta", label: "Homepage <title> set",
      status: /<title>[^<]*ApexCare/i.test(home.text) ? "pass" : "fail",
      detail: "Homepage must include a brand-aware <title> tag.",
    });
    const desc = home.text.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1] ?? "";
    checks.push({
      id: "description", category: "Meta", label: "Meta description length",
      status: desc.length > 50 && desc.length < 160 ? "pass" : desc.length > 0 ? "warn" : "fail",
      detail: desc ? `${desc.length} chars` : "Missing meta description.",
    });
    checks.push({
      id: "canonical-about", category: "Meta", label: "Canonical on /about",
      status: /rel="canonical"/i.test(about.text) ? "pass" : "fail",
      detail: "Leaf routes should declare a canonical link.",
    });

    checks.push({
      id: "og-home", category: "Open Graph", label: "OG title/description on /",
      status: /property="og:title"/i.test(home.text) && /property="og:description"/i.test(home.text) ? "pass" : "fail",
      detail: "Homepage needs og:title and og:description.",
    });
    checks.push({
      id: "og-providers", category: "Open Graph", label: "OG tags on /for-providers",
      status: /property="og:title"/i.test(forProviders.text) ? "pass" : "fail",
      detail: "Conversion pages should set their own OG metadata.",
    });
    checks.push({
      id: "og-image", category: "Open Graph", label: "og:image present",
      status: /property="og:image"/i.test(home.text) ? "pass" : "warn",
      detail: "Add an og:image for richer social previews.",
    });

    const ldOk = /application\/ld\+json/i.test(home.text) && /Organization|WebSite/.test(home.text);
    checks.push({
      id: "jsonld", category: "JSON-LD", label: "Organization / WebSite JSON-LD",
      status: ldOk ? "pass" : "fail",
      detail: "Structured data improves rich-result eligibility.",
    });

    checks.push({
      id: "robots", category: "Sitemap/robots", label: "robots.txt references sitemap",
      status: robots.ok && /sitemap/i.test(robots.text) ? "pass" : "fail",
      detail: "robots.txt should advertise the sitemap location.",
    });
    checks.push({
      id: "sitemap", category: "Sitemap/robots", label: "sitemap.xml is a valid urlset",
      status: sitemap.ok && sitemap.text.includes("<urlset") ? "pass" : "fail",
      detail: "Sitemap must exist and contain <urlset>.",
    });
    checks.push({
      id: "llms", category: "Sitemap/robots", label: "llms.txt (AI crawler readiness)",
      status: llms.ok && llms.text.startsWith("# ") ? "pass" : "warn",
      detail: "llms.txt helps AI crawlers discover canonical pages.",
    });

    const { data: seo } = await supabaseAdmin.from("seo_settings")
      .select("gsc_meta_token, gsc_verified_at, gsc_sitemap_submitted_at").eq("id", 1).single();
    const tokenLive = !!seo?.gsc_meta_token && home.text.includes(`content="${seo.gsc_meta_token}"`);
    checks.push({
      id: "gsc-meta", category: "GSC", label: "Site-verification meta tag deployed",
      status: tokenLive ? "pass" : seo?.gsc_meta_token ? "warn" : "fail",
      detail: tokenLive ? "Meta tag is live in the published HTML."
        : seo?.gsc_meta_token ? "Token stored — republish to ship the meta tag."
        : "Generate a verification token from the GSC page.",
    });
    checks.push({
      id: "gsc-verified", category: "GSC", label: "Search Console verified",
      status: seo?.gsc_verified_at ? "pass" : "fail",
      detail: seo?.gsc_verified_at ? `Verified ${new Date(seo.gsc_verified_at).toLocaleString()}` : "Not verified yet.",
    });
    checks.push({
      id: "gsc-sitemap", category: "GSC", label: "Sitemap submitted to GSC",
      status: seo?.gsc_sitemap_submitted_at ? "pass" : "warn",
      detail: seo?.gsc_sitemap_submitted_at ? `Last submitted ${new Date(seo.gsc_sitemap_submitted_at).toLocaleString()}` : "Submit the sitemap after verification.",
    });

    try {
      const ps = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(SITE)}&category=PERFORMANCE&category=ACCESSIBILITY&strategy=mobile`);
      if (ps.ok) {
        const pj = (await ps.json()) as { lighthouseResult?: { categories?: Record<string, { score: number }> } };
        const a = pj.lighthouseResult?.categories?.accessibility?.score ?? 0;
        const p = pj.lighthouseResult?.categories?.performance?.score ?? 0;
        checks.push({
          id: "lh-a11y", category: "Lighthouse", label: "Accessibility score",
          status: a >= 0.9 ? "pass" : a >= 0.7 ? "warn" : "fail",
          detail: `Lighthouse accessibility: ${Math.round(a * 100)}/100`,
        });
        checks.push({
          id: "lh-perf", category: "Lighthouse", label: "Performance score",
          status: p >= 0.8 ? "pass" : p >= 0.5 ? "warn" : "fail",
          detail: `Lighthouse performance (mobile): ${Math.round(p * 100)}/100`,
        });
      } else {
        checks.push({ id: "lh", category: "Lighthouse", label: "Lighthouse scan", status: "warn", detail: `PageSpeed API returned ${ps.status}` });
      }
    } catch (e) {
      checks.push({ id: "lh", category: "Lighthouse", label: "Lighthouse scan", status: "warn", detail: `PageSpeed unreachable: ${(e as Error).message}` });
    }

    const summary = {
      pass: checks.filter((c) => c.status === "pass").length,
      warn: checks.filter((c) => c.status === "warn").length,
      fail: checks.filter((c) => c.status === "fail").length,
      total: checks.length,
    };
    const finishedAt = new Date();
    try {
      await supabaseAdmin.from("seo_audit_runs").insert({
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        summary,
        checks,
      });
    } catch { /* best-effort */ }
    return { checks, summary, generatedAt: finishedAt.toISOString(), durationMs: finishedAt.getTime() - startedAt.getTime() };
  });

export const listSeoAuditRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { error: "Forbidden" as const, rows: [] };
    const { data } = await supabaseAdmin.from("seo_audit_runs")
      .select("id, started_at, finished_at, duration_ms, summary")
      .order("started_at", { ascending: false }).limit(20);
    return { error: null as string | null, rows: data ?? [] };
  });
