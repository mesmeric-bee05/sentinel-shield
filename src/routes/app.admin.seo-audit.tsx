import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { runSeoAudit, type SeoCheck } from "@/server/seo.functions";
import { PageHeader } from "./app";

export const Route = createFileRoute("/app/admin/seo-audit")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [{ title: "SEO audit — ApexCare AI" }, { name: "robots", content: "noindex" }] }),
  component: SeoAuditPage,
});

const CATEGORIES = ["Meta", "Open Graph", "JSON-LD", "Sitemap/robots", "GSC", "Lighthouse"] as const;

function SeoAuditPage() {
  const fn = useServerFn(runSeoAudit);
  const [checks, setChecks] = useState<SeoCheck[]>([]);
  const [summary, setSummary] = useState<{ pass: number; warn: number; fail: number; total: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [at, setAt] = useState<string | null>(null);
  const [runCount, setRunCount] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const run = async () => {
    setRunning(true);
    setProgress(5);
    // Animate progress through the 6 categories so the rerun feels alive.
    tickRef.current = setInterval(() => {
      setProgress((p) => (p < 92 ? p + Math.max(1, Math.round((95 - p) / 8)) : p));
    }, 250);
    try {
      const r = await fn({});
      setChecks(r.checks);
      setSummary(r.summary);
      setAt(r.generatedAt);
      setRunCount((n) => n + 1);
    } finally {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      setProgress(100);
      setTimeout(() => { setRunning(false); setProgress(0); }, 350);
    }
  };
  useEffect(() => { run(); return () => { if (tickRef.current) clearInterval(tickRef.current); }; /* eslint-disable-next-line */ }, []);

  const worst = (rows: SeoCheck[]): SeoCheck["status"] => {
    if (rows.some((r) => r.status === "fail")) return "fail";
    if (rows.some((r) => r.status === "warn")) return "warn";
    if (rows.every((r) => r.status === "pass")) return "pass";
    return "pending";
  };

  return (
    <div className="p-10 max-w-5xl mx-auto">
      <PageHeader
        title="SEO audit"
        sub="Server-side checks for meta, Open Graph, JSON-LD, sitemap/robots, Google Search Console, and Lighthouse."
        action={<Button variant="outline" size="sm" onClick={run} disabled={running}>{running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}Rerun audit</Button>}
      />

      <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
        <span>{at ? `Last full run ${new Date(at).toLocaleString()}` : "Running first audit…"}</span>
        <span>Run #{runCount}</span>
      </div>
      {running && <Progress value={progress} className="mb-6" />}
      {!running && <div className="mb-6 h-2" />}

      <div className="grid grid-cols-4 gap-3 mb-8">
        <Tile label="Passing" value={summary?.pass ?? 0} tone="success" />
        <Tile label="Warnings" value={summary?.warn ?? 0} tone="warn" />
        <Tile label="Failing" value={summary?.fail ?? 0} tone="danger" />
        <Tile label="Total" value={summary?.total ?? 0} tone="neutral" />
      </div>

      <div className="space-y-6">
        {CATEGORIES.map((cat) => {
          const rows = checks.filter((c) => c.category === cat);
          if (rows.length === 0) return null;
          const sectionStatus = worst(rows);
          return (
            <section key={cat}>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs uppercase tracking-wider text-muted-foreground">{cat}</h2>
                <div className="flex items-center gap-2">
                  <StatusBadge status={sectionStatus} />
                  {at && <span className="text-[10px] text-muted-foreground">Checked {new Date(at).toLocaleTimeString()}</span>}
                </div>
              </div>
              <div className="rounded-2xl border border-border bg-card divide-y divide-border shadow-card">
                {rows.map((c) => (
                  <div key={c.id} className="flex items-start gap-4 p-4">
                    <StatusIcon status={c.status} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{c.label}</div>
                      <div className="text-xs text-muted-foreground mt-1">{c.detail}</div>
                    </div>
                    <StatusBadge status={c.status} />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone: "success" | "danger" | "warn" | "neutral" }) {
  const cls = { success: "text-emerald-600", danger: "text-rose-600", warn: "text-amber-600", neutral: "text-foreground" }[tone];
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-serif text-3xl mt-1 ${cls}`}>{value}</div>
    </div>
  );
}

function StatusIcon({ status }: { status: SeoCheck["status"] }) {
  if (status === "pass") return <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5" />;
  if (status === "fail") return <XCircle className="w-5 h-5 text-rose-600 mt-0.5" />;
  if (status === "warn") return <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />;
  return <Loader2 className="w-5 h-5 text-muted-foreground mt-0.5 animate-spin" />;
}

function StatusBadge({ status }: { status: SeoCheck["status"] }) {
  const m = {
    pass: { c: "bg-emerald-500/10 text-emerald-700", t: "PASS" },
    warn: { c: "bg-amber-500/10 text-amber-700", t: "WARN" },
    fail: { c: "bg-rose-500/10 text-rose-700", t: "FAIL" },
    pending: { c: "bg-muted text-muted-foreground", t: "…" },
  }[status];
  return <span className={`text-[10px] px-2 py-1 rounded-md font-medium ${m.c}`}>{m.t}</span>;
}
