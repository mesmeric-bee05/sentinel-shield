import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, CheckCircle2, AlertTriangle, ShieldAlert, RefreshCw, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { getSecurityScanDiff, getLatestScanAt } from "@/lib/security.functions";
import { ScanDiffResponseSchema, type ScanDiffEntry, type ScanDiffResponse } from "@/lib/security-contracts";
import { PermissionDeniedCard } from "@/components/admin/PermissionDeniedCard";
import { reasonFromResult, type ForbiddenInfo } from "@/lib/permission";
import { downloadCsv, downloadJson, timestampedName } from "@/lib/exports";
import { advanceWatermark, isStale, type Watermark } from "@/lib/scan-watermark";
import { PageHeader } from "./app";

export const Route = createFileRoute("/app/admin/security-diff")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({
    meta: [
      { title: "Scan diff — ApexCare AI" },
      { name: "description", content: "Resolved vs remaining security findings between the last two scans." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ScanDiffPage,
});

const EMPTY: ScanDiffResponse = {
  error: null,
  latestScanAt: null,
  previousScanAt: null,
  resolved: [],
  remaining: [],
  newlyIntroduced: [],
  reports: [],
};

const SEVERITY_TONE: Record<ScanDiffEntry["severity"], string> = {
  error: "bg-rose-500/10 text-rose-700 border-rose-500/30",
  warn: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  info: "bg-sky-500/10 text-sky-700 border-sky-500/30",
};

const diffCols = [
  { key: "bucket", label: "Bucket", value: (r: ScanDiffEntry & { bucket?: string }) => r.bucket ?? "" },
  { key: "internal_id", label: "Internal ID", value: (r: ScanDiffEntry) => r.internal_id },
  { key: "severity", label: "Severity", value: (r: ScanDiffEntry) => r.severity },
  { key: "scanner_name", label: "Scanner", value: (r: ScanDiffEntry) => r.scanner_name },
  { key: "title", label: "Title", value: (r: ScanDiffEntry) => r.title },
  { key: "resource", label: "Resource", value: (r: ScanDiffEntry) => r.resource ?? "" },
  { key: "status", label: "Status", value: (r: ScanDiffEntry) => r.status },
  { key: "last_seen_at", label: "Last seen", value: (r: ScanDiffEntry) => r.last_seen_at },
];

function ScanDiffPage() {
  const diffFn = useServerFn(getSecurityScanDiff);
  const latestFn = useServerFn(getLatestScanAt);
  const [diff, setDiff] = useState<ScanDiffResponse>(EMPTY);
  const [forbidden, setForbidden] = useState<ForbiddenInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const watermark = useRef<Watermark>(null);

  const load = async () => {
    setLoading(true);
    try {
      const raw = await diffFn({ data: undefined });
      const denial = reasonFromResult(raw);
      if (denial) { setForbidden(denial); setLoading(false); return; }
      setForbidden(null);
      // Parse against the shared contract so server drift surfaces immediately.
      const parsed = ScanDiffResponseSchema.safeParse(raw);
      if (!parsed.success) {
        toast.error("Scan diff response did not match the expected contract.");
        setDiff(EMPTY);
      } else {
        setDiff(parsed.data);
        watermark.current = advanceWatermark(watermark.current, parsed.data.latestScanAt);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load scan diff");
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Auto-refresh when a new scan writes to security_findings so the resolved vs
  // remaining view never shows a stale snapshot. Debounced: a scan writes many
  // rows in a burst, and we only want one reload at the end of it.
  //
  // Realtime alone loses events across reconnects and browser sleep, so a
  // watermark backfill also runs on (re)subscribe, tab focus, network return
  // and on a slow interval: it asks the server for the newest scan timestamp
  // and reloads when the server is ahead of what is on screen.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const scheduleReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { setLive(true); void load(); }, 1500);
    };

    const backfill = async () => {
      if (cancelled || document.hidden) return;
      try {
        const res = await latestFn({ data: undefined });
        if (res.error || !res.latestScanAt) return;
        if (isStale(watermark.current, res.latestScanAt)) { setLive(true); void load(); }
      } catch { /* transient — the next backfill tick retries */ }
    };

    const channel = supabase
      .channel("security-findings-diff")
      .on("postgres_changes", { event: "*", schema: "public", table: "security_findings" }, scheduleReload)
      .subscribe((status) => { if (status === "SUBSCRIBED") void backfill(); });

    const onVisible = () => { if (!document.hidden) void backfill(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    const poll = setInterval(() => { void backfill(); }, 60_000);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      supabase.removeChannel(channel);
    };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const allRows = [
    ...diff.resolved.map((r) => ({ ...r, bucket: "resolved" })),
    ...diff.remaining.map((r) => ({ ...r, bucket: "remaining" })),
    ...diff.newlyIntroduced.map((r) => ({ ...r, bucket: "new" })),
  ];

  if (forbidden) return <div className="p-10"><PermissionDeniedCard info={forbidden} onRetry={load} /></div>;

  return (
    <div className="p-10 max-w-6xl mx-auto">
      <PageHeader
        title="Scan diff"
        sub="Resolved vs remaining findings between the two most recent scan snapshots."
      />

      <div className="flex items-center flex-wrap gap-3 mb-6 text-xs text-muted-foreground">
        <span className="font-mono">{diff.previousScanAt ? new Date(diff.previousScanAt).toLocaleString() : "no previous scan"}</span>
        <ArrowRight className="w-3 h-3" />
        <span className="font-mono">{diff.latestScanAt ? new Date(diff.latestScanAt).toLocaleString() : "no scan data"}</span>
        <div className="ml-auto flex items-center gap-2">
          {diff.reports.map((r) => (
            <a key={r.url} href={r.url} className="inline-flex items-center gap-1 underline hover:text-foreground" target="_blank" rel="noreferrer">
              <ExternalLink className="w-3 h-3" />{r.label}
            </a>
          ))}
          {live && <span className="inline-flex items-center gap-1 text-emerald-600"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />live</span>}
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={load}>
            <RefreshCw className="w-3 h-3 mr-1" /> Refresh
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => downloadCsv(timestampedName("security-scan-diff"), allRows, diffCols)}>CSV</Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => downloadJson(timestampedName("security-scan-diff"), allRows)}>JSON</Button>
        </div>
      </div>

      {loading ? (
        <div className="p-10 text-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading scan diff…</div>
      ) : (
        <div className="space-y-6">
          <DiffTable
            title="Newly introduced"
            hint="Open in the latest scan and absent from the previous one — triage first."
            icon={<ShieldAlert className="w-4 h-4 text-rose-600" />}
            rows={diff.newlyIntroduced}
          />
          <DiffTable
            title="Remaining"
            hint="Still open in both scans."
            icon={<AlertTriangle className="w-4 h-4 text-amber-600" />}
            rows={diff.remaining}
          />
          <DiffTable
            title="Resolved"
            hint="Fixed, accepted as documented risk, or no longer reported."
            icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />}
            rows={diff.resolved}
          />
        </div>
      )}
    </div>
  );
}

function DiffTable({ title, hint, icon, rows }: { title: string; hint: string; icon: React.ReactNode; rows: ScanDiffEntry[] }) {
  return (
    <section className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
      <header className="px-5 py-3 border-b border-border/60 flex items-center gap-2">
        {icon}
        <h2 className="font-serif text-base">{title}</h2>
        <span className="text-xs text-muted-foreground">{hint}</span>
        <span className="ml-auto text-xs font-mono text-muted-foreground">{rows.length}</span>
      </header>
      {rows.length === 0 ? (
        <div className="p-6 text-center text-xs text-muted-foreground">Nothing in this bucket.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground uppercase tracking-wider bg-muted/30">
              <tr>
                <th className="text-left py-2 px-3">Severity</th>
                <th className="text-left py-2 px-3">Internal ID</th>
                <th className="text-left py-2 px-3">Finding</th>
                <th className="text-left py-2 px-3">Resource</th>
                <th className="text-left py-2 px-3">Scanner</th>
                <th className="text-left py-2 px-3">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.scanner_name}-${r.internal_id}`} className="border-t border-border/60 align-top">
                  <td className="py-2 px-3"><span className={`inline-block px-2 py-0.5 rounded border ${SEVERITY_TONE[r.severity]}`}>{r.severity}</span></td>
                  <td className="py-2 px-3 font-mono text-[11px]">{r.internal_id}</td>
                  <td className="py-2 px-3 font-medium">{r.title}</td>
                  <td className="py-2 px-3 font-mono text-[11px]">{r.resource ?? "—"}</td>
                  <td className="py-2 px-3">{r.scanner_name}</td>
                  <td className="py-2 px-3 whitespace-nowrap">{new Date(r.last_seen_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
