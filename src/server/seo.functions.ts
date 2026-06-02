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
    const r = await fetch(`${GATEWAY}/siteVerification/v1/token`, {
      method: "POST",
      headers,
      body: JSON.stringify({ site: { identifier: siteUrl, type: "SITE" }, verificationMethod: "META" }),
    });
    if (!r.ok) return { error: `GSC token request failed: ${r.status} ${await r.text()}` };
    const j = (await r.json()) as { token: string };

    const tagContent = j.token.replace(/^<meta[^>]*content="/i, "").replace(/"[^>]*\/?>$/i, "");

    await supabaseAdmin.from("seo_settings").update({
      gsc_meta_token: tagContent,
      gsc_site_url: siteUrl,
      updated_at: new Date().toISOString(),
    }).eq("id", 1);

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

    const vr = await fetch(`${GATEWAY}/siteVerification/v1/webResource?verificationMethod=META`, {
      method: "POST", headers,
      body: JSON.stringify({ site: { identifier: siteUrl, type: "SITE" } }),
    });
    if (!vr.ok) return { error: `Verify failed: ${vr.status} ${await vr.text()}` };

    const encoded = encodeURIComponent(siteUrl);
    await fetch(`${GATEWAY}/webmasters/v3/sites/${encoded}`, { method: "PUT", headers });

    const sitemap = `${siteUrl.replace(/\/$/, "")}/sitemap.xml`;
    const sr = await fetch(`${GATEWAY}/webmasters/v3/sites/${encoded}/sitemaps/${encodeURIComponent(sitemap)}`, {
      method: "PUT", headers,
    });

    const now = new Date().toISOString();
    await supabaseAdmin.from("seo_settings").update({
      gsc_verified_at: now,
      gsc_sitemap_submitted_at: sr.ok ? now : null,
      updated_at: now,
    }).eq("id", 1);

    return { error: null as string | null, sitemapSubmitted: sr.ok };
  });

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
  .handler(async () => {
    const checks: SeoCheck[] = [];

    const home = await fetchText(`${SITE}/`);
    const robots = await fetchText(`${SITE}/robots.txt`);
    const sitemap = await fetchText(`${SITE}/sitemap.xml`);
    const llms = await fetchText(`${SITE}/llms.txt`);
    const about = await fetchText(`${SITE}/about`);
    const forProviders = await fetchText(`${SITE}/for-providers`);

    // META
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

    // Open Graph
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

    // JSON-LD
    const ldOk = /application\/ld\+json/i.test(home.text) && /Organization|WebSite/.test(home.text);
    checks.push({
      id: "jsonld", category: "JSON-LD", label: "Organization / WebSite JSON-LD",
      status: ldOk ? "pass" : "fail",
      detail: "Structured data improves rich-result eligibility.",
    });

    // Sitemap / robots
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

    // GSC
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

    // Lighthouse via PageSpeed Insights (no key for low-volume reads)
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
    return { checks, summary, generatedAt: new Date().toISOString() };
  });
