// Admin retention settings: how long export audit rows, export job rows and
// stored file payloads are kept, plus a manual "run cleanup now" trigger and a
// history of recent cleanup runs.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw, Trash2, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "./app";
import { PermissionDeniedCard } from "@/components/admin/PermissionDeniedCard";
import { reasonFromResult, type ForbiddenInfo } from "@/lib/permission";
import {
  getRetentionConfig,
  updateRetentionConfig,
  runRetentionNow,
  type RetentionSettingsRow,
  type RetentionRunRow,
  type RetentionRunResult,
} from "@/lib/security-retention.functions";

export const Route = createFileRoute("/app/admin/retention")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({
    meta: [
      { title: "Data retention — ApexCare AI" },
      { name: "description", content: "Configure how long security export audit rows, export jobs and stored files are kept, and run cleanup on demand." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Data retention — ApexCare AI" },
      { property: "og:description", content: "Retention windows and manual cleanup for security export data." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RetentionPage,
});

const DATASET_LABEL: Record<string, string> = {
  security_export_audit: "Export audit records",
  security_export_jobs: "Export jobs",
};

function RetentionPage() {
  const getFn = useServerFn(getRetentionConfig);
  const updateFn = useServerFn(updateRetentionConfig);
  const runFn = useServerFn(runRetentionNow);

  const [settings, setSettings] = useState<RetentionSettingsRow[]>([]);
  const [runs, setRuns] = useState<RetentionRunRow[]>([]);
  const [draft, setDraft] = useState<Record<string, { retention: string; payload: string }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<RetentionRunResult | null>(null);
  const [denied, setDenied] = useState<ForbiddenInfo | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getFn({ data: undefined });
      const d = reasonFromResult(res);
      if (d) { setDenied(d); setSettings([]); setRuns([]); }
      else {
        setDenied(null);
        setSettings(res.settings);
        setRuns(res.runs);
        setDraft(Object.fromEntries(res.settings.map((s) => [s.dataset, { retention: String(s.retention_days), payload: String(s.payload_retention_days) }])));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load retention settings");
    }
    setLoading(false);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const save = async (dataset: string) => {
    const d = draft[dataset];
    if (!d) return;
    const retention = Number(d.retention);
    const payload = Number(d.payload);
    if (!Number.isInteger(retention) || retention < 1 || retention > 3650 || !Number.isInteger(payload) || payload < 1 || payload > 3650) {
      toast.error("Enter whole numbers of days between 1 and 3650.");
      return;
    }
    setSaving(dataset);
    try {
      const res = await updateFn({ data: { dataset: dataset as "security_export_audit" | "security_export_jobs", retention_days: retention, payload_retention_days: payload } });
      const denyInfo = reasonFromResult(res);
      if (denyInfo) { setDenied(denyInfo); return; }
      if (res.error) toast.error(res.error);
      else { toast.success(`${DATASET_LABEL[dataset] ?? dataset} retention saved.`); await load(); }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(null);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await runFn({ data: undefined });
      const d = reasonFromResult(res);
      if (d) { setDenied(d); return; }
      setLastRun(res.result);
      if (res.error) toast.error(res.error);
      else toast.success(`Cleanup finished — ${res.result?.deleted_rows ?? 0} rows deleted, ${res.result?.cleared_payloads ?? 0} stored files cleared.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cleanup failed");
    } finally {
      setRunning(false);
    }
  };

  if (denied) return <div className="p-10"><PermissionDeniedCard info={denied} onRetry={load} /></div>;

  return (
    <div className="p-10 max-w-5xl mx-auto">
      <PageHeader title="Data retention" sub="How long security export audit records, export jobs and their stored files are kept before automatic deletion." />

      <section className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
        <header className="px-5 py-3 border-b border-border/60 flex items-center gap-2">
          <h2 className="font-serif text-base">Current settings</h2>
          <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={() => void load()}>
            <RefreshCw className="w-3 h-3 mr-1" />Refresh
          </Button>
          <Button size="sm" className="h-7 text-xs" disabled={running} onClick={() => void runNow()}>
            {running ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Trash2 className="w-3 h-3 mr-1" />}Run cleanup now
          </Button>
        </header>

        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>
        ) : (
          <div className="divide-y divide-border/60">
            {settings.map((s) => (
              <div key={s.dataset} className="px-5 py-4 grid gap-3 md:grid-cols-5 items-end text-xs">
                <div className="md:col-span-2">
                  <div className="font-medium text-sm">{DATASET_LABEL[s.dataset] ?? s.dataset}</div>
                  <div className="text-muted-foreground mt-1">
                    Last cleanup {s.last_run_at ? new Date(s.last_run_at).toLocaleString() : "never"} · {s.last_deleted_count} rows removed
                  </div>
                </div>
                <label className="grid gap-1">
                  <span className="text-muted-foreground">Keep rows (days)</span>
                  <Input
                    className="h-9 text-xs"
                    inputMode="numeric"
                    value={draft[s.dataset]?.retention ?? ""}
                    onChange={(e) => setDraft((p) => ({ ...p, [s.dataset]: { retention: e.target.value, payload: p[s.dataset]?.payload ?? "" } }))}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-muted-foreground">Keep stored files (days)</span>
                  <Input
                    className="h-9 text-xs"
                    inputMode="numeric"
                    value={draft[s.dataset]?.payload ?? ""}
                    onChange={(e) => setDraft((p) => ({ ...p, [s.dataset]: { retention: p[s.dataset]?.retention ?? "", payload: e.target.value } }))}
                  />
                </label>
                <Button size="sm" variant="outline" className="h-9 text-xs" disabled={saving === s.dataset} onClick={() => void save(s.dataset)}>
                  {saving === s.dataset ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}Save
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {lastRun && (
        <section className="mt-6 rounded-2xl border border-border bg-card shadow-card p-5 text-xs">
          <h2 className="font-serif text-base mb-2">Last manual cleanup</h2>
          <p className="text-muted-foreground">
            {lastRun.deleted_rows} rows deleted · {lastRun.cleared_payloads} stored files cleared · {lastRun.duration_ms} ms
            {lastRun.error ? ` · error: ${lastRun.error}` : ""}
          </p>
        </section>
      )}

      <section className="mt-6 rounded-2xl border border-border bg-card shadow-card overflow-hidden">
        <header className="px-5 py-3 border-b border-border/60">
          <h2 className="font-serif text-base">Recent cleanup runs</h2>
        </header>
        {runs.length === 0 ? (
          <div className="p-10 text-center text-xs text-muted-foreground">No cleanup has run yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground uppercase tracking-wider bg-muted/30">
                <tr>
                  <th className="text-left py-2 px-3">When</th>
                  <th className="text-left py-2 px-3">Dataset</th>
                  <th className="text-left py-2 px-3">Rows deleted</th>
                  <th className="text-left py-2 px-3">Files cleared</th>
                  <th className="text-left py-2 px-3">Duration</th>
                  <th className="text-left py-2 px-3">Error</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-border/60">
                    <td className="py-2 px-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="py-2 px-3">{DATASET_LABEL[r.dataset] ?? r.dataset}</td>
                    <td className="py-2 px-3 font-mono">{r.deleted_rows}</td>
                    <td className="py-2 px-3 font-mono">{r.cleared_payloads}</td>
                    <td className="py-2 px-3 font-mono">{r.duration_ms != null ? `${r.duration_ms} ms` : "—"}</td>
                    <td className="py-2 px-3 text-rose-600 break-words max-w-xs">{r.error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
