import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Copy, Loader2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { checkDnsRecords, getEmailDomainSettings, saveEmailDomainSettings } from "@/server/email-domain.functions";
import { PageHeader } from "./app";

export const Route = createFileRoute("/app/admin/email-domain")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [{ title: "Email domain wizard — ApexCare AI" }, { name: "robots", content: "noindex" }] }),
  component: EmailDomainWizard,
});

type DnsCheck = { id: string; label: string; status: "pass" | "fail" | "warn"; values: string[] };

function EmailDomainWizard() {
  const loadFn = useServerFn(getEmailDomainSettings);
  const saveFn = useServerFn(saveEmailDomainSettings);
  const checkFn = useServerFn(checkDnsRecords);

  const [domain, setDomain] = useState("");
  const [mode, setMode] = useState<"sandbox" | "live">("sandbox");
  const [checks, setChecks] = useState<DnsCheck[] | null>(null);
  const [allPass, setAllPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [autoActivatedAt, setAutoActivatedAt] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const r = await loadFn({});
      if ("error" in r && r.error) return;
      if ("settings" in r && r.settings) {
        setDomain(r.settings.sender_domain ?? "");
        setMode((r.settings.delivery_mode as "sandbox" | "live") ?? "sandbox");
      }
    })();
  }, [loadFn]);

  // Auto-poll every 8s while we have a domain but not all-pass
  useEffect(() => {
    if (!polling || !domain || allPass) return;
    const t = setInterval(() => runCheck(), 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, domain, allPass]);

  const saveDomain = async () => {
    setBusy(true);
    const r = await saveFn({ data: { senderDomain: domain || null } });
    setBusy(false);
    if (r.error) toast.error(r.error); else toast.success("Sender domain saved.");
  };

  const runCheck = async () => {
    if (!domain) return;
    const r = await checkFn({ data: { domain } });
    if (r.error) { toast.error(r.error); return; }
    setChecks((r.checks ?? []) as DnsCheck[]);
    setAllPass(!!r.allPass);
    setLastCheckedAt(new Date().toISOString());
    if (r.allPass) {
      setPolling(false);
      // Auto-flip to live the moment DNS is green and we're still in sandbox.
      if (mode === "sandbox") {
        const sr = await saveFn({ data: { deliveryMode: "live" } });
        if (!sr.error) {
          setMode("live");
          setAutoActivatedAt(new Date().toISOString());
          toast.success("DNS verified — booking confirmations are now sending for real.");
        }
      }
    }
  };

  const activate = async () => {
    setBusy(true);
    const r = await saveFn({ data: { deliveryMode: "live" } });
    setBusy(false);
    if (r.error) toast.error(r.error);
    else { setMode("live"); toast.success("Real delivery activated for booking confirmations."); }
  };

  const revertToSandbox = async () => {
    setBusy(true);
    const r = await saveFn({ data: { deliveryMode: "sandbox" } });
    setBusy(false);
    if (r.error) toast.error(r.error);
    else { setMode("sandbox"); setAutoActivatedAt(null); toast.success("Reverted to sandbox preview."); }
  };

  const passCount = checks?.filter((c) => c.status === "pass").length ?? 0;
  const totalCount = checks?.length ?? 5;
  const pct = checks ? Math.round((passCount / totalCount) * 100) : 0;

  return (
    <div className="p-10 max-w-5xl mx-auto">
      <PageHeader title="Sender domain wizard" sub="Guide bookings from sandbox preview to real delivery in four steps: pick a domain, ship DNS records, watch live verification, then activate." />

      <ol className="space-y-6">
        <Step n={1} title="Choose a sender subdomain" done={!!domain}>
          <p className="text-xs text-muted-foreground mb-3">Use a dedicated subdomain (e.g. <code>notify.yourdomain.com</code>) so marketing traffic never affects deliverability of booking confirmations.</p>
          <div className="flex gap-2">
            <Input placeholder="notify.example.com" value={domain} onChange={(e) => setDomain(e.target.value.trim().toLowerCase())} className="max-w-sm" />
            <Button onClick={saveDomain} disabled={busy || !domain}>Save</Button>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            Need Lovable to provision the DNS records for you? Ask the AI in chat: <em>"Set up the email sender domain for {domain || "my domain"}."</em>
          </div>
        </Step>

        <Step n={2} title="Publish the DNS records" done={checks !== null}>
          <p className="text-xs text-muted-foreground mb-3">
            After saving, Lovable will give you NS records to delegate the subdomain plus auto-generated SPF, DKIM, and DMARC entries.
            Once they're at your registrar, click "Verify".
          </p>
          <RecordTable domain={domain} />
        </Step>

        <Step n={3} title="Live verification" done={allPass}>
          <div className="flex gap-2 mb-4">
            <Button onClick={runCheck} disabled={!domain || busy} variant="outline" size="sm"><RefreshCw className="w-4 h-4 mr-2" />Check now</Button>
            <Button onClick={() => setPolling((p) => !p)} disabled={!domain} variant={polling ? "default" : "outline"} size="sm">
              {polling ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Auto-polling (8s)</> : "Start auto-poll"}
            </Button>
          </div>

          {checks !== null && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1 text-xs">
                <span className={`font-medium ${allPass ? "text-emerald-700" : "text-amber-700"}`}>{passCount}/{totalCount} records verified</span>
                <span className="text-muted-foreground">{lastCheckedAt ? `Last checked ${new Date(lastCheckedAt).toLocaleTimeString()}` : ""}</span>
              </div>
              <Progress value={pct} className={allPass ? "[&>div]:bg-emerald-600" : "[&>div]:bg-amber-500"} />
            </div>
          )}

          {checks === null ? (
            <div className="text-sm text-muted-foreground">Run a check to see live DKIM / SPF / DMARC status.</div>
          ) : (
            <div className="rounded-xl border border-border divide-y divide-border">
              {checks.map((c) => (
                <div key={c.id} className="flex items-start gap-3 p-3 text-sm">
                  <StatusIcon status={c.status} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{c.label}</div>
                    {c.values.length > 0 && (
                      <pre className="mt-1 text-[10px] text-muted-foreground whitespace-pre-wrap break-all">{c.values.join("\n")}</pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Step>

        <Step n={4} title="Activate real delivery" done={mode === "live"}>
          <p className="text-xs text-muted-foreground mb-3">
            When all DNS checks pass, the wizard automatically flips booking confirmations from sandbox preview (audit-only) to real outbound email.
            Current mode: <strong className="text-foreground">{mode}</strong>.
          </p>
          {mode === "live" ? (
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 text-sm text-emerald-700"><ShieldCheck className="w-4 h-4" />Live delivery active{autoActivatedAt ? ` — auto-activated ${new Date(autoActivatedAt).toLocaleTimeString()}` : ""}.</div>
              <div><Button onClick={revertToSandbox} variant="outline" size="sm" disabled={busy}>Undo to sandbox</Button></div>
            </div>
          ) : (
            <>
              <Button onClick={activate} disabled={!allPass || busy}>Activate real delivery manually</Button>
              {!allPass && <div className="text-xs text-amber-600 mt-2">Verification must pass before activation. Auto-activation triggers as soon as it does.</div>}
            </>
          )}
        </Step>
      </ol>
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <li className="rounded-2xl border border-border bg-card p-6 shadow-card">
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-7 h-7 rounded-full grid place-items-center text-xs font-medium ${done ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground"}`}>
          {done ? <CheckCircle2 className="w-4 h-4" /> : n}
        </div>
        <h3 className="font-medium">{title}</h3>
      </div>
      {children}
    </li>
  );
}

function StatusIcon({ status }: { status: "pass" | "fail" | "warn" }) {
  if (status === "pass") return <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600" />;
  if (status === "fail") return <XCircle className="w-4 h-4 mt-0.5 text-rose-600" />;
  return <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600" />;
}

function RecordTable({ domain }: { domain: string }) {
  const sub = domain || "notify.example.com";
  const rows = [
    { type: "NS", host: sub, value: "ns3.lovable.cloud" },
    { type: "NS", host: sub, value: "ns4.lovable.cloud" },
    { type: "TXT", host: sub, value: "v=spf1 include:lovable.cloud ~all" },
    { type: "TXT", host: `lovable._domainkey.${sub}`, value: "k=rsa; p=… (Lovable provides on setup)" },
    { type: "TXT", host: `_dmarc.${sub}`, value: "v=DMARC1; p=quarantine; rua=mailto:dmarc@" + sub },
  ];
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-muted-foreground uppercase tracking-wider">
          <tr><th className="text-left px-3 py-2">Type</th><th className="text-left px-3 py-2">Host</th><th className="text-left px-3 py-2">Value</th><th className="px-3 py-2 w-8" /></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              <td className="px-3 py-2 font-mono">{r.type}</td>
              <td className="px-3 py-2 font-mono">{r.host}</td>
              <td className="px-3 py-2 font-mono break-all">{r.value}</td>
              <td className="px-3 py-2">
                <button onClick={() => { navigator.clipboard.writeText(r.value); toast.success("Copied"); }} className="text-muted-foreground hover:text-foreground"><Copy className="w-3 h-3" /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
