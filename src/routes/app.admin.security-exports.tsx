import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw, Download, Play, ExternalLink, RotateCcw, Link2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "./app";
import { PermissionDeniedCard } from "@/components/admin/PermissionDeniedCard";
import { reasonFromResult, type ForbiddenInfo } from "@/lib/permission";
import { startSecurityExportJob, listSecurityExportJobs, downloadSecurityExportJob, retrySecurityExportJob, mintSecurityExportDownload } from "@/lib/security.functions";
import { ExportPresetBar } from "@/components/admin/ExportPresetBar";
import { EXPORT_DATASETS, datasetLabel, type SecurityExportJob } from "@/lib/security-export-datasets";
import { sentrySearchUrl } from "@/lib/sentry-link";
import { timestampedName } from "@/lib/exports";

export const Route = createFileRoute("/app/admin/security-exports")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({
    meta: [
      { title: "Export jobs — ApexCare AI" },
      { name: "description", content: "Queue large security exports and download them once the job finishes." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ExportJobsPage,
});

const MAX_ATTEMPTS = 5;

const STATUS_TONE: Record<string, string> = {
  queued: "bg-muted text-muted-foreground border-border",
  running: "bg-sky-500/10 text-sky-700 border-sky-500/30",
  complete: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  failed: "bg-rose-500/10 text-rose-700 border-rose-500/30",
};

function saveText(name: string, text: string, format: string) {
  const mime = format === "json" ? "application/json" : "text/csv;charset=utf-8";
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.${format === "json" ? "json" : "csv"}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ExportJobsPage() {
  const startFn = useServerFn(startSecurityExportJob);
  const listFn = useServerFn(listSecurityExportJobs);
  const downloadFn = useServerFn(downloadSecurityExportJob);
  const retryFn = useServerFn(retrySecurityExportJob);
  const mintFn = useServerFn(mintSecurityExportDownload);

  const [jobs, setJobs] = useState<SecurityExportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [denied, setDenied] = useState<ForbiddenInfo | null>(null);
  const [dataset, setDataset] = useState<string>(EXPORT_DATASETS[0].value);
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [busyJob, setBusyJob] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listFn({ data: { page: 1, pageSize: 25 } });
      const d = reasonFromResult(res);
      if (d) { setDenied(d); setJobs([]); }
      else { setDenied(null); setJobs(res.rows); }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load export jobs");
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Poll while anything is still in flight so the status page stays live.
  useEffect(() => {
    if (!jobs.some((j) => j.status === "queued" || j.status === "running")) return;
    const t = setInterval(() => { void load(); }, 3000);
    return () => clearInterval(t);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [jobs]);

  const queue = async () => {
    setStarting(true);
    try {
      const res = await startFn({
        data: {
          dataset: dataset as never,
          format,
          search: search || null,
          status: null,
          from: from ? new Date(`${from}T00:00:00.000Z`).toISOString() : null,
          to: to ? new Date(`${to}T23:59:59.999Z`).toISOString() : null,
        },
      });
      const d = reasonFromResult(res);
      if (d) { setDenied(d); return; }
      if (res.error) { toast.error(res.error); return; }
      toast.success("Export job finished — download it below.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not queue export");
    } finally {
      setStarting(false);
    }
  };

  const download = async (job: SecurityExportJob) => {
    try {
      const res = await downloadFn({ data: { jobId: job.id } });
      const d = reasonFromResult(res);
      if (d) { setDenied(d); return; }
      if (res.error || !res.payload) { toast.error(res.error ?? "Export payload unavailable"); return; }
      saveText(timestampedName(job.dataset), res.payload, res.format ?? "csv");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    }
  };

  const retry = async (job: SecurityExportJob) => {
    setBusyJob(job.id);
    try {
      const res = await retryFn({ data: { jobId: job.id } });
      const d = reasonFromResult(res);
      if (d) { setDenied(d); return; }
      if (res.error) toast.error(res.error);
      else toast.success(`Retry ${res.attempts} ${res.status === "complete" ? "completed" : "finished"}.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setBusyJob(null);
    }
  };

  // Preferred download path: a single-use link that expires in 5 minutes. If
  // minting is unavailable we fall back to the inline payload transfer.
  const signedDownload = async (job: SecurityExportJob) => {
    setBusyJob(job.id);
    try {
      const res = await mintFn({ data: { jobId: job.id } });
      const d = reasonFromResult(res);
      if (d) { setDenied(d); return; }
      if (res.error || !res.url) { toast.message("Signed link unavailable — downloading directly."); await download(job); return; }
      window.location.href = res.url;
      toast.success("Download link opened (valid for 5 minutes, single use).");
      await load();
    } catch {
      await download(job);
    } finally {
      setBusyJob(null);
    }
  };

  if (denied) return <div className="p-10"><PermissionDeniedCard info={denied} onRetry={load} /></div>;

  return (
    <div className="p-10 max-w-6xl mx-auto">
      <PageHeader title="Export jobs" sub="Queue a large security export, watch its progress, and download the file once the job completes." />

      <ExportPresetBar
        current={{ dataset, actor_filter: null, scan_window_from: null, scan_window_to: null, date_from: from || null, date_to: to || null }}
        onApply={(p) => {
          if (p.dataset) setDataset(p.dataset);
          setFrom(p.date_from ?? "");
          setTo(p.date_to ?? "");
          setSearch(p.search ?? "");
        }}
      />

      <section className="rounded-2xl border border-border bg-card shadow-card p-5 mb-6 grid gap-3 md:grid-cols-6 items-end text-xs">
        <label className="grid gap-1 md:col-span-2">
          <span className="text-muted-foreground">Dataset</span>
          <select className="h-9 rounded-md border border-input bg-background px-2 text-xs" value={dataset} onChange={(e) => setDataset(e.target.value)}>
            {EXPORT_DATASETS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground">Format</span>
          <select className="h-9 rounded-md border border-input bg-background px-2 text-xs" value={format} onChange={(e) => setFormat(e.target.value as "csv" | "json")}>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground">From</span>
          <Input type="date" className="h-9 text-xs" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground">To</span>
          <Input type="date" className="h-9 text-xs" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className="flex gap-2">
          <Input className="h-9 text-xs" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Button size="sm" className="h-9 text-xs" disabled={starting} onClick={() => void queue()}>
            {starting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}Run
          </Button>
        </div>
      </section>

      <div className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
        <header className="px-5 py-3 border-b border-border/60 flex items-center">
          <h2 className="font-serif text-base">Recent jobs</h2>
          <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={load}><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
        </header>
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading jobs…</div>
        ) : jobs.length === 0 ? (
          <div className="p-10 text-center text-xs text-muted-foreground">No export jobs yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground uppercase tracking-wider bg-muted/30">
                <tr>
                  <th className="text-left py-2 px-3">Queued</th>
                  <th className="text-left py-2 px-3">Dataset</th>
                  <th className="text-left py-2 px-3">Format</th>
                  <th className="text-left py-2 px-3">Status</th>
                  <th className="text-left py-2 px-3">Progress</th>
                  <th className="text-left py-2 px-3">Size</th>
                  <th className="text-left py-2 px-3">Attempts</th>
                  <th className="text-left py-2 px-3">Event</th>
                  <th className="text-left py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const link = sentrySearchUrl(j.correlation_id);
                  const attempts = j.attempt_count ?? 1;
                  const history = Array.isArray(j.attempt_history) ? j.attempt_history : [];
                  const busy = busyJob === j.id;
                  return (
                    <tr key={j.id} className="border-t border-border/60 align-top">
                      <td className="py-2 px-3 whitespace-nowrap">{new Date(j.created_at).toLocaleString()}</td>
                      <td className="py-2 px-3">{datasetLabel(j.dataset)}</td>
                      <td className="py-2 px-3 uppercase">{j.format}</td>
                      <td className="py-2 px-3">
                        <span className={`inline-block px-2 py-0.5 rounded border ${STATUS_TONE[j.status] ?? STATUS_TONE["queued"]}`}>{j.status}</span>
                        {j.error && <div className="text-rose-600 mt-1 max-w-xs break-words">{j.error}</div>}
                      </td>
                      <td className="py-2 px-3 font-mono">{j.progress_rows}{j.total_rows != null ? ` / ${j.total_rows}` : ""}</td>
                      <td className="py-2 px-3 font-mono">{j.result_bytes != null ? `${Math.max(1, Math.round(j.result_bytes / 1024))} KB` : "—"}</td>
                      <td className="py-2 px-3 font-mono">
                        {attempts}/{MAX_ATTEMPTS}
                        {history.length > 0 && (
                          <details className="mt-1 font-sans">
                            <summary className="cursor-pointer text-muted-foreground">history</summary>
                            <ul className="mt-1 space-y-1 max-w-xs">
                              {history.map((h, i) => (
                                <li key={i} className="break-words text-[11px] text-muted-foreground">
                                  #{h.attempt ?? i + 1} {h.at ? new Date(h.at).toLocaleString() : ""} — {h.error ?? "no reason recorded"}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                      <td className="py-2 px-3 font-mono text-[11px]">
                        {link ? (
                          <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline hover:text-foreground">
                            <ExternalLink className="w-3 h-3" />{(j.correlation_id ?? "").slice(0, 8)}
                          </a>
                        ) : ((j.correlation_id ?? "—").slice(0, 8))}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex flex-col gap-1 items-stretch">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={j.status !== "complete" || busy}
                            onClick={() => void signedDownload(j)}
                            title="Creates a single-use link that expires in 5 minutes"
                          >
                            {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Link2 className="w-3 h-3 mr-1" />}Download
                          </Button>
                          {j.status === "failed" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              disabled={busy || attempts >= MAX_ATTEMPTS}
                              onClick={() => void retry(j)}
                              title={attempts >= MAX_ATTEMPTS ? "Retry limit reached" : "Re-run this export with the same filters"}
                            >
                              <RotateCcw className="w-3 h-3 mr-1" />Retry
                            </Button>
                          )}
                          {j.status === "complete" && (
                            <Button size="sm" variant="ghost" className="h-7 text-[11px]" disabled={busy} onClick={() => void download(j)}>
                              <Download className="w-3 h-3 mr-1" />Direct
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
