import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getGscState, requestGscToken, verifyAndSubmitSite, resubmitSitemap, listGscHistory } from "@/server/seo.functions";
import { HistoryFilters, type HistoryFilterState, emptyFilters, applyHistoryFilter, paginate, Pager } from "@/components/admin/HistoryFilters";
import { downloadCsv, downloadJson, timestampedName } from "@/lib/exports";
import { PermissionDeniedCard } from "@/components/admin/PermissionDeniedCard";
import { reasonFromResult } from "@/lib/permission";
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
type HistoryRow = { id: string; kind: string; status: string; http_status: number | null; error_message: string | null; duration_ms: number; site_url: string | null; created_at: string };

function GscPage() {
  const loadFn = useServerFn(getGscState);
  const tokenFn = useServerFn(requestGscToken);
  const verifyFn = useServerFn(verifyAndSubmitSite);
  const resubmitFn = useServerFn(resubmitSitemap);
  const historyFn = useServerFn(listGscHistory);

  const [state, setState] = useState<State | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [siteUrl, setSiteUrl] = useState("https://harmony-forge-nexus.lovable.app");
  const [busy, setBusy] = useState<null | "token" | "verify" | "resubmit">(null);
  const [lastError, setLastError] = useState<{ step: "token" | "verify" | "resubmit"; message: string } | null>(null);

  const load = async () => {
    const [s, h] = await Promise.all([loadFn({}), historyFn({}).catch(() => ({ rows: [] as HistoryRow[] }))]);
    setState(s);
    if ("rows" in h) setHistory(h.rows as HistoryRow[]);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const [filters, setFilters] = useState<HistoryFilterState>(emptyFilters);
  const [page, setPage] = useState(1);
  const filteredHistory = applyHistoryFilter(history, filters, {
    date: (r) => r.created_at,
    status: (r) => r.status,
    searchable: (r) => `${r.kind} ${r.status} ${r.site_url ?? ""} ${r.error_message ?? ""}`,
  });
  const { slice: historySlice, total: historyTotal, pages: historyPages } = paginate(filteredHistory, page, 25);
  const gscExportCols = [
    { key: "created_at", label: "When", value: (r: HistoryRow) => r.created_at },
    { key: "kind", label: "Action", value: (r: HistoryRow) => r.kind },
    { key: "status", label: "Status", value: (r: HistoryRow) => r.status },
    { key: "http_status", label: "HTTP", value: (r: HistoryRow) => r.http_status ?? "" },
    { key: "duration_ms", label: "Duration (ms)", value: (r: HistoryRow) => r.duration_ms },
    { key: "site_url", label: "Site URL", value: (r: HistoryRow) => r.site_url ?? "" },
    { key: "error_message", label: "Error", value: (r: HistoryRow) => r.error_message ?? "" },
  ];

  const denial = state ? reasonFromResult(state) : null;
  if (denial) {
    return <div className="p-10"><PermissionDeniedCard info={denial} onRetry={load} /></div>;
  }

  const connected = state && "connected" in state && state.connected;
  const settings = state && "settings" in state ? state.settings : null;

  const isTransient = (msg: string) => /\b(5\d{2}|network|timeout|ETIMED|fetch failed)\b/i.test(msg);

  const runWithRetry = async <T extends { error?: string | null }>(label: "token" | "verify" | "resubmit", fn: () => Promise<T>): Promise<T> => {
    setBusy(label); setLastError(null);
    let r = await fn();
    if (r.error && isTransient(r.error)) {
      await new Promise((res) => setTimeout(res, 2000));
      r = await fn();
    }
    setBusy(null);
    return r;
  };

  const generateToken = async () => {
    const r = await runWithRetry("token", () => tokenFn({ data: { siteUrl } }));
    if (r.error) { setLastError({ step: "token", message: r.error }); toast.error(r.error); }
    else { toast.success("Token saved — republish to ship the meta tag, then click Verify."); }
    await load();
  };

  const verify = async () => {
    const r = await runWithRetry("verify", () => verifyFn({}));
    if (r.error) { setLastError({ step: "verify", message: r.error }); toast.error(r.error); await load(); return; }
    // Auto-resubmit sitemap to push the freshly-deployed meta tag and clear the GSC finding.
    const rr = await runWithRetry("resubmit", () => resubmitFn({}));
    if (rr.error) { setLastError({ step: "resubmit", message: rr.error }); toast.warning(`Verified, but resubmit failed: ${rr.error}`); }
    else toast.success("Verified, sitemap submitted, SEO finding cleared.");
    await load();
  };

  const resubmit = async () => {
    const r = await runWithRetry("resubmit", () => resubmitFn({}));
    if (r.error) { setLastError({ step: "resubmit", message: r.error }); toast.error(r.error); }
    else toast.success("Sitemap resubmitted.");
    await load();
  };

  return (
    <div className="p-10 max-w-4xl mx-auto">
      <PageHeader title="Google Search Console" sub="Authorize GSC, ship a verification meta tag, then submit the sitemap — all from inside the app." />

      {lastError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 mb-4 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-rose-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-rose-700">{stepLabel(lastError.step)} failed</div>
              <div className="text-xs text-rose-700/80 mt-1 break-words">{lastError.message}</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => lastError.step === "token" ? generateToken() : lastError.step === "verify" ? verify() : resubmit()}>
              <RefreshCw className="w-3 h-3 mr-1" /> Retry
            </Button>
          </div>
        </div>
      )}

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
            <Button onClick={generateToken} disabled={!connected || busy !== null}>{busy === "token" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Generate token"}</Button>
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
            <Button onClick={verify} disabled={!connected || !settings?.gsc_meta_token || busy !== null}>
              {busy === "verify" ? <Loader2 className="w-4 h-4 animate-spin" /> : <><ShieldCheck className="w-4 h-4 mr-2" />Verify & submit</>}
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

        <Card label="4. Resubmit sitemap" ok={!!settings?.gsc_sitemap_submitted_at}>
          <p className="text-xs text-muted-foreground mb-3">After republishing, push <code>/sitemap.xml</code> to GSC again so newly added pages get crawled and the SEO finding clears.</p>
          <Button onClick={resubmit} disabled={!settings?.gsc_verified_at || busy !== null} variant="outline" size="sm">
            {busy === "resubmit" ? <Loader2 className="w-4 h-4 animate-spin" /> : <><RefreshCw className="w-4 h-4 mr-2" />Resubmit now</>}
          </Button>
        </Card>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-sm">Republish history</h3>
            <Button onClick={load} variant="ghost" size="sm"><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
          </div>
          <HistoryFilters
            value={filters}
            onChange={(v) => { setFilters(v); setPage(1); }}
            statusOptions={[{ value: "success", label: "Success" }, { value: "failed", label: "Failed" }]}
            searchPlaceholder="Action, site, error…"
            onExportCsv={() => downloadCsv(timestampedName("gsc-history"), filteredHistory, gscExportCols)}
            onExportJson={() => downloadJson(timestampedName("gsc-history"), filteredHistory)}
          />
          {historySlice.length === 0 ? (
            <div className="text-xs text-muted-foreground">No GSC actions match the filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground uppercase tracking-wider">
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-3">When</th>
                    <th className="text-left py-2 pr-3">Action</th>
                    <th className="text-left py-2 pr-3">Status</th>
                    <th className="text-left py-2 pr-3">HTTP</th>
                    <th className="text-left py-2 pr-3">Duration</th>
                    <th className="text-left py-2">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {historySlice.map((h) => (
                    <tr key={h.id} className="border-b border-border/50 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap">{new Date(h.created_at).toLocaleString()}</td>
                      <td className="py-2 pr-3"><code>{h.kind}</code></td>
                      <td className="py-2 pr-3">
                        {h.status === "success"
                          ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="w-3 h-3" />success</span>
                          : <span className="inline-flex items-center gap-1 text-rose-700"><XCircle className="w-3 h-3" />failed</span>}
                      </td>
                      <td className="py-2 pr-3">{h.http_status ?? "—"}</td>
                      <td className="py-2 pr-3">{h.duration_ms}ms</td>
                      <td className="py-2 break-words max-w-[280px]">{h.error_message ?? (h.site_url ?? "OK")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-xs text-muted-foreground mt-2">Showing {historySlice.length} of {historyTotal}</div>
          <Pager page={page} pages={historyPages} onPage={setPage} />
        </div>

        <Button onClick={load} variant="outline" size="sm"><RefreshCw className="w-4 h-4 mr-2" />Refresh status</Button>
      </div>
    </div>
  );
}

function stepLabel(s: "token" | "verify" | "resubmit"): string {
  return s === "token" ? "Token request" : s === "verify" ? "Verification" : "Sitemap resubmit";
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
