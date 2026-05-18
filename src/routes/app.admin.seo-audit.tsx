import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Circle, ExternalLink, Loader2, RefreshCw, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PageHeader } from "./app";

export const Route = createFileRoute("/app/admin/seo-audit")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [
    { title: "SEO audit — ApexCare AI" },
    { name: "robots", content: "noindex" },
  ] }),
  component: SeoAuditPage,
});

type Check = { id: string; label: string; detail: string; status: "pass" | "fail" | "pending" };

const SITE = "https://harmony-forge-nexus.lovable.app";

function SeoAuditPage() {
  const [checks, setChecks] = useState<Check[]>(() => seed());
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    const next: Check[] = [];

    // robots.txt
    next.push(await fetchCheck("robots", "robots.txt", `${SITE}/robots.txt`, (t) => t.toLowerCase().includes("sitemap")));
    // sitemap.xml
    next.push(await fetchCheck("sitemap", "sitemap.xml", `${SITE}/sitemap.xml`, (t) => t.includes("<urlset")));
    // llms.txt
    next.push(await fetchCheck("llms", "llms.txt (AI readiness)", `${SITE}/llms.txt`, (t) => t.startsWith("# ")));
    // homepage meta
    next.push(await fetchCheck("home-meta", "Homepage title + description", `${SITE}/`, (t) =>
      /<title>[^<]*ApexCare/i.test(t) && /name="description"/i.test(t)
    ));
    // homepage JSON-LD
    next.push(await fetchCheck("jsonld", "Homepage JSON-LD (Organization/WebSite)", `${SITE}/`, (t) =>
      /application\/ld\+json/i.test(t) && /Organization|WebSite/.test(t)
    ));
    // canonical
    next.push(await fetchCheck("canonical", "Canonical link on /about", `${SITE}/about`, (t) =>
      /rel="canonical"/i.test(t)
    ));
    // og tags
    next.push(await fetchCheck("og", "Open Graph tags on /for-providers", `${SITE}/for-providers`, (t) =>
      /property="og:title"/i.test(t) && /property="og:description"/i.test(t)
    ));

    // External integrations remain manual:
    next.push({ id: "gsc", label: "Google Search Console", status: "pending", detail: "Connect the GSC integration and submit the sitemap to clear this finding." });
    next.push({ id: "lighthouse", label: "Lighthouse contrast (published build)", status: "pending", detail: "Republish after the contrast fix; Lighthouse re-runs on the live build." });

    setChecks(next);
    setRunning(false);
  };

  useEffect(() => { run(); /* eslint-disable-next-line */ }, []);

  const pass = checks.filter((c) => c.status === "pass").length;
  const fail = checks.filter((c) => c.status === "fail").length;
  const pending = checks.filter((c) => c.status === "pending").length;

  return (
    <div className="p-10 max-w-5xl mx-auto">
      <PageHeader
        title="SEO audit"
        sub="Live one-page checklist: re-fetches the published site, validates meta, OG, JSON-LD, sitemap, robots, and AI readiness, and surfaces what is still gated on external setup."
        action={<Button variant="outline" size="sm" onClick={run} disabled={running}>{running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}Rerun scan</Button>}
      />

      <div className="grid grid-cols-3 gap-3 mb-8">
        <Tile label="Passing" value={pass} tone="success" />
        <Tile label="Failing" value={fail} tone="danger" />
        <Tile label="Pending action" value={pending} tone="warn" />
      </div>

      <div className="rounded-2xl border border-border bg-card divide-y divide-border shadow-card">
        {checks.map((c) => (
          <div key={c.id} className="flex items-start gap-4 p-5">
            <div className="mt-0.5">
              {c.status === "pass" ? <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                : c.status === "fail" ? <XCircle className="w-5 h-5 text-rose-600" />
                : <Circle className="w-5 h-5 text-amber-600" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">{c.label}</div>
              <div className="text-xs text-muted-foreground mt-1">{c.detail}</div>
            </div>
            {c.id === "gsc" && (
              <a className="text-xs text-primary inline-flex items-center gap-1" href="https://search.google.com/search-console/welcome" target="_blank" rel="noreferrer">Open GSC <ExternalLink className="w-3 h-3" /></a>
            )}
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground mt-6">
        The Lovable SEO scanner runs on the published build. After republishing, click "Rerun scan" here for live HTML checks; the official scanner refreshes on its own cadence and will clear matching findings.
      </p>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone: "success" | "danger" | "warn" }) {
  const cls = { success: "text-emerald-600", danger: "text-rose-600", warn: "text-amber-600" }[tone];
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-serif text-3xl mt-1 ${cls}`}>{value}</div>
    </div>
  );
}

async function fetchCheck(id: string, label: string, url: string, validate: (text: string) => boolean): Promise<Check> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return { id, label, status: "fail", detail: `${url} → HTTP ${r.status}` };
    const text = await r.text();
    return validate(text)
      ? { id, label, status: "pass", detail: `${url} responded and passed validation.` }
      : { id, label, status: "fail", detail: `${url} responded but failed validation. Inspect the live response.` };
  } catch (e) {
    return { id, label, status: "fail", detail: `Could not fetch ${url}: ${(e as Error).message}` };
  }
}

function seed(): Check[] {
  return [
    { id: "robots", label: "robots.txt", detail: "Checking…", status: "pending" },
    { id: "sitemap", label: "sitemap.xml", detail: "Checking…", status: "pending" },
    { id: "llms", label: "llms.txt", detail: "Checking…", status: "pending" },
    { id: "home-meta", label: "Homepage title + description", detail: "Checking…", status: "pending" },
    { id: "jsonld", label: "Homepage JSON-LD", detail: "Checking…", status: "pending" },
    { id: "canonical", label: "Canonical links", detail: "Checking…", status: "pending" },
    { id: "og", label: "Open Graph tags", detail: "Checking…", status: "pending" },
  ];
}
