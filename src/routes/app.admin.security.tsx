import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { ShieldCheck, CheckCircle2, AlertCircle, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "./app";

export const Route = createFileRoute("/app/admin/security")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [{ title: "Security tracker — ApexCare AI" }, { name: "robots", content: "noindex" }] }),
  component: SecurityPage,
});

type Status = "fixed" | "ignored" | "open";
type Finding = {
  id: string;
  scanner: string;
  title: string;
  severity: "error" | "warn" | "info";
  resource: string;
  status: Status;
  rationale?: string;
  fixedIn?: string;
};

// Catalogue derived from the latest scan + recorded remediations in
// docs/security/accepted-risks.md. Status reflects what was applied in the
// 2026-06-11/12 hardening pass.
const CATALOGUE: Finding[] = [
  { id: "ai_fns_no_auth", scanner: "agent_security", title: "AI inference endpoints callable without authentication", severity: "error", resource: "src/server/ai.functions.ts", status: "fixed", fixedIn: "requireSupabaseAuth added to suggestSlots / summarizeIntake / scribeDraft" },
  { id: "list_assignments_any_user", scanner: "agent_security", title: "Any authenticated user could read all CHW assignments", severity: "error", resource: "src/server/chw.functions.ts → listAssignments", status: "fixed", fixedIn: "Role gate + provider-scoping by appointments before service-role query" },
  { id: "seo_audit_no_auth", scanner: "agent_security", title: "SEO audit endpoint wrote to DB without authentication", severity: "warn", resource: "src/server/seo.functions.ts → runSeoAudit", status: "fixed", fixedIn: "Admin-only middleware applied" },
  { id: "chw_assignments_patient_lat_lng_exposure", scanner: "supabase_lov", title: "Raw patient GPS exposed to all providers", severity: "error", resource: "public.chw_assignments", status: "fixed", fixedIn: "Policy scoped to providers with an appointment for that patient" },
  { id: "profiles_providers_read_all", scanner: "supabase_lov", title: "All patient PHI readable by any provider", severity: "error", resource: "public.profiles", status: "fixed", fixedIn: "Provider read policy scoped to patients with an appointment" },
  { id: "chw_check_ins_providers_read_all", scanner: "supabase_lov", title: "All CHW check-ins (geo) readable by any provider", severity: "warn", resource: "public.chw_check_ins", status: "fixed", fixedIn: "Provider read policy scoped to check-ins for their patients" },
  { id: "chw_workers_providers_read_all", scanner: "supabase_lov", title: "All CHW worker base locations readable by any provider", severity: "warn", resource: "public.chw_workers", status: "fixed", fixedIn: "Provider read policy scoped to workers assigned to their patients" },
  { id: "seo_settings_public_read", scanner: "supabase_lov", title: "SEO settings publicly readable", severity: "warn", resource: "public.seo_settings", status: "fixed", fixedIn: "Public read removed; admin-only. Meta token served via getSeoMeta server fn" },
  { id: "chw_assignments_realtime_no_channel_policy", scanner: "supabase_lov", title: "Realtime broadcasts on chw_assignments without channel policy", severity: "error", resource: "supabase_realtime publication", status: "fixed", fixedIn: "Dropped chw_assignments from supabase_realtime publication" },
  { id: "care_facilities_phone_public", scanner: "supabase_lov", title: "Care facility phone numbers publicly exposed", severity: "warn", resource: "public.care_facilities", status: "ignored", rationale: "Intentional: public-facing clinic directory number. See docs/security/accepted-risks.md §1." },
  { id: "SUPA_authenticated_security_definer_function_executable", scanner: "supabase", title: "Signed-in users can execute SECURITY DEFINER functions", severity: "warn", resource: "public.has_role, acquire_slot_hold, …", status: "ignored", rationale: "All functions self-authorize. Revoking EXECUTE would break RLS evaluation. See docs/security/accepted-risks.md §2." },
];

const SEVERITY_TONE: Record<Finding["severity"], string> = {
  error: "bg-rose-500/10 text-rose-700 border-rose-500/30",
  warn: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  info: "bg-sky-500/10 text-sky-700 border-sky-500/30",
};
const STATUS_TONE: Record<Status, string> = {
  fixed: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  ignored: "bg-muted text-muted-foreground border-border",
  open: "bg-rose-500/10 text-rose-700 border-rose-500/30",
};

function SecurityPage() {
  const fixed = CATALOGUE.filter((f) => f.status === "fixed").length;
  const ignored = CATALOGUE.filter((f) => f.status === "ignored").length;
  const open = CATALOGUE.filter((f) => f.status === "open").length;

  return (
    <div className="p-10 max-w-6xl mx-auto">
      <PageHeader title="Security tracker" sub="Catalogue of scanner findings, severity, impacted resource, and resolution status." />

      <div className="grid grid-cols-3 gap-3 mb-6">
        <Stat label="Fixed" value={fixed} icon={<CheckCircle2 className="w-4 h-4" />} tone="bg-emerald-500/10 text-emerald-700" />
        <Stat label="Accepted risk" value={ignored} icon={<ShieldCheck className="w-4 h-4" />} tone="bg-muted text-muted-foreground" />
        <Stat label="Open" value={open} icon={<AlertCircle className="w-4 h-4" />} tone="bg-rose-500/10 text-rose-700" />
      </div>

      <div className="mb-4 text-xs text-muted-foreground flex items-center gap-2">
        <FileText className="w-3 h-3" />
        Accepted-risk rationale and review cadence: <code>docs/security/accepted-risks.md</code>.
        Run a fresh scan from <Link to="/app/admin/audit" className="underline">More → Security</Link>.
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground uppercase tracking-wider bg-muted/30">
              <tr>
                <th className="text-left py-2 px-3">Status</th>
                <th className="text-left py-2 px-3">Severity</th>
                <th className="text-left py-2 px-3">Finding</th>
                <th className="text-left py-2 px-3">Resource</th>
                <th className="text-left py-2 px-3">Scanner</th>
                <th className="text-left py-2 px-3">Resolution / rationale</th>
              </tr>
            </thead>
            <tbody>
              {CATALOGUE.map((f) => (
                <tr key={f.id} className="border-t border-border/60 align-top">
                  <td className="py-2 px-3"><span className={`inline-block px-2 py-0.5 rounded border ${STATUS_TONE[f.status]}`}>{f.status}</span></td>
                  <td className="py-2 px-3"><span className={`inline-block px-2 py-0.5 rounded border ${SEVERITY_TONE[f.severity]}`}>{f.severity}</span></td>
                  <td className="py-2 px-3 font-medium">{f.title}<div className="text-[10px] text-muted-foreground font-mono mt-0.5">{f.id}</div></td>
                  <td className="py-2 px-3 font-mono text-[11px]">{f.resource}</td>
                  <td className="py-2 px-3">{f.scanner}</td>
                  <td className="py-2 px-3 max-w-md break-words">{f.fixedIn ?? f.rationale ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: string }) {
  return (
    <div className={`rounded-xl border border-border p-4 ${tone}`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider opacity-80">{icon}{label}</div>
      <div className="text-3xl font-serif mt-1">{value}</div>
    </div>
  );
}
