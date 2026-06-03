import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getGscState, requestGscToken, verifyAndSubmitSite, resubmitSitemap } from "@/server/seo.functions";
import { PageHeader } from "../routes/app";

export const Route = createFileRoute("/app/admin/seo/gsc")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [{ title: "Google Search Console — ApexCare AI" }, { name: "robots", content: "noindex" }] }),
  component: GscPage,
});

type State = Awaited<ReturnType<typeof getGscState>>;

function GscPage() {
  const loadFn = useServerFn(getGscState);
  const tokenFn = useServerFn(requestGscToken);
  const verifyFn = useServerFn(verifyAndSubmitSite);
  const resubmitFn = useServerFn(resubmitSitemap);

  const [state, setState] = useState<State | null>(null);
  const [siteUrl, setSiteUrl] = useState("https://harmony-forge-nexus.lovable.app");
  const [busy, setBusy] = useState(false);

  const load = async () => setState(await loadFn({}));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (state && "error" in state && state.error === "Forbidden") {
    return <div className="p-10"><PageHeader title="Google Search Console" sub="Admin role required." /></div>;
  }

  const connected = state && "connected" in state && state.connected;
  const settings = state && "settings" in state ? state.settings : null;

  const generateToken = async () => {
    setBusy(true);
    const r = await tokenFn({ data: { siteUrl } });
    setBusy(false);
    if (r.error) toast.error(r.error);
    else { toast.success("Token saved — republish to ship the meta tag, then click Verify."); await load(); }
  };

  const verify = async () => {
    setBusy(true);
    const r = await verifyFn({});
    if (r.error) { setBusy(false); toast.error(r.error); return; }
    // Auto-resubmit sitemap to push the freshly-deployed meta tag and clear the GSC finding.
    const rr = await resubmitFn({});
    setBusy(false);
    if (rr.error) toast.warning(`Verified, but resubmit failed: ${rr.error}`);
    else toast.success("Verified, sitemap submitted, SEO finding cleared.");
    await load();
  };

  return (
    <div className="p-10 max-w-4xl mx-auto">
      <PageHeader title="Google Search Console" sub="Authorize GSC, ship a verification meta tag, then submit the sitemap — all from inside the app." />

      <div className="space-y-4">
        <Card label="1. Connector status" ok={!!connected}>
          {connected ? <p className="text-sm text-muted-foreground">Google Search Console connector is linked.</p>
            : <div className="space-y-2 text-sm text-muted-foreground">
                <p>Google Search Console isn't linked yet. Ask Lovable in chat:</p>
                <div className="flex items-center gap-2">
                  <code className="rounded bg-muted/40 px-2 py-1 text-xs flex-1">Connect the Google Search Console connector.</code>
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText("Connect the Google Search Console connector."); toast.success("Copied"); }}>Copy</Button>
                </div>
              </div>}
        </Card>

        <Card label="2. Generate verification token" ok={!!settings?.gsc_meta_token}>
          <p className="text-xs text-muted-foreground mb-3">Token is stored, injected into the document head, and ships on the next publish.</p>
          <div className="flex gap-2 mb-3">
            <Input value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} className="max-w-md" />
            <Button onClick={generateToken} disabled={!connected || busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Generate token"}</Button>
          </div>
          {settings?.gsc_meta_token && (
            <pre className="rounded-md bg-muted/40 p-3 text-[11px] break-all">&lt;meta name="google-site-verification" content="{settings.gsc_meta_token}" /&gt;</pre>
          )}
        </Card>

        <Card label="3. Verify and submit sitemap" ok={!!settings?.gsc_verified_at}>
          <p className="text-xs text-muted-foreground mb-3">
            After republishing the app so the meta tag is live, click Verify. Lovable calls the GSC API to confirm ownership, adds the property, and submits <code>/sitemap.xml</code>.
          </p>
          <div className="flex gap-2 items-center">
            <Button onClick={verify} disabled={!connected || !settings?.gsc_meta_token || busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><ShieldCheck className="w-4 h-4 mr-2" />Verify & submit</>}
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href="https://search.google.com/search-console" target="_blank" rel="noreferrer">Open GSC <ExternalLink className="w-3 h-3 ml-1" /></a>
            </Button>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <div><dt className="text-muted-foreground">Verified at</dt><dd>{settings?.gsc_verified_at ? new Date(settings.gsc_verified_at).toLocaleString() : "—"}</dd></div>
            <div><dt className="text-muted-foreground">Sitemap submitted</dt><dd>{settings?.gsc_sitemap_submitted_at ? new Date(settings.gsc_sitemap_submitted_at).toLocaleString() : "—"}</dd></div>
          </dl>
        </Card>

        <Button onClick={load} variant="outline" size="sm"><RefreshCw className="w-4 h-4 mr-2" />Refresh status</Button>
      </div>
    </div>
  );
}

function Card({ label, ok, children }: { label: string; ok: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
      <div className="flex items-center gap-2 mb-3">
        {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-muted-foreground" />}
        <h3 className="font-medium text-sm">{label}</h3>
      </div>
      {children}
    </div>
  );
}
