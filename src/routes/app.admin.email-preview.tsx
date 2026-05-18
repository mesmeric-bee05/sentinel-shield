import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mail, Code2, Type } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { listEmailTemplates, renderEmailPreview } from "@/server/email-preview.functions";
import { PageHeader } from "./app";

export const Route = createFileRoute("/app/admin/email-preview")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [
    { title: "Email preview (sandbox) — ApexCare AI" },
    { name: "robots", content: "noindex" },
  ] }),
  component: EmailPreviewPage,
});

function EmailPreviewPage() {
  const listFn = useServerFn(listEmailTemplates);
  const renderFn = useServerFn(renderEmailPreview);
  const [templates, setTemplates] = useState<Array<{ name: string; displayName: string; previewData: Record<string, unknown> }>>([]);
  const [active, setActive] = useState<string | null>(null);
  const [dataJson, setDataJson] = useState("{}");
  const [rendered, setRendered] = useState<{ html: string; text: string; subject: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listFn({}).then((r) => {
      if ("error" in r && r.error) { setForbidden(true); return; }
      setTemplates(r.templates);
      if (r.templates[0]) {
        setActive(r.templates[0].name);
        setDataJson(JSON.stringify(r.templates[0].previewData, null, 2));
      }
    });
  }, [listFn]);

  const run = async () => {
    if (!active) return;
    setLoading(true); setErr(null);
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(dataJson || "{}"); } catch { setErr("Invalid JSON"); setLoading(false); return; }
    const r = await renderFn({ data: { templateName: active, data: parsed } });
    setLoading(false);
    if ("error" in r && r.error) { setErr(r.error); return; }
    setRendered({ html: r.html ?? "", text: r.text ?? "", subject: r.subject ?? "" });
  };

  useEffect(() => { if (active) run(); /* eslint-disable-next-line */ }, [active]);

  const iframeSrcDoc = useMemo(() => rendered?.html ?? "", [rendered]);

  if (forbidden) return (
    <div className="p-10 max-w-3xl mx-auto">
      <PageHeader title="Email preview" sub="Admin role required." />
    </div>
  );

  return (
    <div className="p-10 max-w-7xl mx-auto">
      <PageHeader
        title="Email preview (sandbox)"
        sub="Render every transactional template end-to-end without needing a verified sender domain or real delivery. Useful for QA, design review, and stakeholder sign-off."
      />

      <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 mb-6 text-xs text-sky-700 flex gap-3">
        <Mail className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <strong>Preview-only mode.</strong> Lovable's transactional sender comes online after you configure a verified sender domain. Until then, templates render here exactly as they will in the inbox. Set up the domain to enable real delivery.
        </div>
      </div>

      <div className="grid lg:grid-cols-[280px_1fr] gap-6">
        <aside className="space-y-3">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Template</label>
          <Select value={active ?? ""} onValueChange={(v) => {
            setActive(v);
            const t = templates.find((x) => x.name === v);
            if (t) setDataJson(JSON.stringify(t.previewData, null, 2));
          }}>
            <SelectTrigger><SelectValue placeholder="Pick a template" /></SelectTrigger>
            <SelectContent>
              {templates.map((t) => <SelectItem key={t.name} value={t.name}>{t.displayName}</SelectItem>)}
            </SelectContent>
          </Select>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Template data (JSON)</label>
            <Textarea value={dataJson} onChange={(e) => setDataJson(e.target.value)} rows={16} className="font-mono text-xs mt-1" />
          </div>
          <Button onClick={run} disabled={!active || loading} className="w-full">
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Render preview
          </Button>
          {err && <div className="text-xs text-rose-600 rounded-md border border-rose-500/30 bg-rose-500/5 p-2">{err}</div>}
        </aside>

        <section className="rounded-2xl border border-border bg-card overflow-hidden shadow-card">
          <div className="px-5 py-3 border-b border-border bg-muted/30">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Subject</div>
            <div className="text-sm font-medium">{rendered?.subject ?? "—"}</div>
          </div>
          <Tabs defaultValue="html" className="w-full">
            <TabsList className="m-3">
              <TabsTrigger value="html"><Mail className="w-3.5 h-3.5 mr-1.5" />HTML</TabsTrigger>
              <TabsTrigger value="text"><Type className="w-3.5 h-3.5 mr-1.5" />Plain text</TabsTrigger>
              <TabsTrigger value="source"><Code2 className="w-3.5 h-3.5 mr-1.5" />Source</TabsTrigger>
            </TabsList>
            <TabsContent value="html" className="p-0">
              <iframe title="Email preview" srcDoc={iframeSrcDoc} className="w-full h-[700px] bg-white" sandbox="" />
            </TabsContent>
            <TabsContent value="text" className="p-5">
              <pre className="text-xs whitespace-pre-wrap font-mono text-foreground">{rendered?.text ?? ""}</pre>
            </TabsContent>
            <TabsContent value="source" className="p-5">
              <pre className="text-[10px] whitespace-pre-wrap font-mono text-muted-foreground max-h-[700px] overflow-auto">{rendered?.html ?? ""}</pre>
            </TabsContent>
          </Tabs>
        </section>
      </div>
    </div>
  );
}
