import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Search, ShieldCheck, UserPlus, X, Check } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listRoleRequests, decideRoleRequest, searchUsers, grantRole, revokeRole } from "@/server/roles.functions";
import { PageHeader } from "./app";

export const Route = createFileRoute("/app/admin/roles")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [{ title: "Role management — ApexCare AI" }] }),
  component: RolesPage,
});

type Request = { id: string; user_id: string; requested_role: string; justification: string | null; status: string; created_at: string; profile: { email: string | null; full_name: string | null } | null };
type FoundUser = { id: string; email: string | null; full_name: string | null; roles: string[] };

function RolesPage() {
  const listFn = useServerFn(listRoleRequests);
  const decideFn = useServerFn(decideRoleRequest);
  const searchFn = useServerFn(searchUsers);
  const grantFn = useServerFn(grantRole);
  const revokeFn = useServerFn(revokeRole);

  const [requests, setRequests] = useState<Request[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<FoundUser[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const loadRequests = async () => {
    const r = await listFn({});
    if (r.error === "Forbidden") { setForbidden(true); setLoading(false); return; }
    setRequests((r.items as Request[]) ?? []); setLoading(false);
  };
  useEffect(() => { loadRequests(); /* eslint-disable-next-line */ }, []);

  const doSearch = async () => {
    const r = await searchFn({ data: { q } });
    setUsers((r.items as FoundUser[]) ?? []);
  };

  const decide = async (id: string, approve: boolean) => {
    setBusy(id);
    const r = await decideFn({ data: { id, approve } });
    setBusy(null);
    if (!r.ok) return toast.error(r.error || "Failed");
    toast.success(approve ? "Approved" : "Denied");
    loadRequests();
  };

  const setRole = async (userId: string, role: "patient" | "provider" | "admin", grant: boolean) => {
    setBusy(userId + role);
    const r = grant ? await grantFn({ data: { userId, role } }) : await revokeFn({ data: { userId, role } });
    setBusy(null);
    if (!r.ok) return toast.error(r.error || "Failed");
    toast.success(grant ? `Granted ${role}` : `Revoked ${role}`);
    doSearch();
  };

  if (forbidden) return (
    <div className="p-10 max-w-3xl mx-auto">
      <PageHeader title="Role management" sub="Admin role required." />
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Restricted.</div>
    </div>
  );

  const pending = requests.filter((r) => r.status === "pending");

  return (
    <div className="p-10 max-w-6xl mx-auto">
      <PageHeader title="Roles" sub="Approve elevated-access requests and manage clinician/admin grants." />

      <section className="mb-10">
        <h2 className="font-serif text-xl mb-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-accent" /> Pending requests <span className="text-xs text-muted-foreground font-sans">({pending.length})</span></h2>
        {loading ? <div className="text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline" /></div> : pending.length === 0 ? (
          <div className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-8 text-center">No pending requests.</div>
        ) : (
          <ul className="space-y-2">
            {pending.map((r) => (
              <li key={r.id} className="rounded-xl border border-border bg-card p-4 shadow-card">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium">{r.profile?.full_name ?? r.profile?.email ?? "Unknown"}</div>
                    <div className="text-xs text-muted-foreground">{r.profile?.email} · requested <span className="text-accent">{r.requested_role}</span> · {new Date(r.created_at).toLocaleString()}</div>
                    {r.justification && <p className="text-sm mt-2 max-w-prose">{r.justification}</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => decide(r.id, false)} disabled={busy === r.id}><X className="w-3.5 h-3.5 mr-1" />Deny</Button>
                    <Button size="sm" onClick={() => decide(r.id, true)} disabled={busy === r.id}>{busy === r.id ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}Approve</Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-serif text-xl mb-3 flex items-center gap-2"><UserPlus className="w-4 h-4 text-accent" /> Manage users</h2>
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by email or name…" className="pl-9" onKeyDown={(e) => e.key === "Enter" && doSearch()} />
          </div>
          <Button onClick={doSearch}>Search</Button>
        </div>
        {users.length === 0 ? (
          <div className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-8 text-center">Search to manage roles. Searches and grants are recorded in the audit log.</div>
        ) : (
          <ul className="space-y-2">
            {users.map((u) => (
              <li key={u.id} className="rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-4 shadow-card">
                <div>
                  <div className="font-medium">{u.full_name ?? u.email}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                  <div className="flex gap-1 mt-2">
                    {u.roles.length === 0 && <span className="text-[10px] text-muted-foreground">no roles</span>}
                    {u.roles.map((r) => <span key={r} className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted">{r}</span>)}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <RoleAssign onAssign={(role, grant) => setRole(u.id, role, grant)} current={u.roles} disabled={!!busy} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RoleAssign({ onAssign, current, disabled }: { onAssign: (r: "patient" | "provider" | "admin", grant: boolean) => void; current: string[]; disabled: boolean }) {
  const [role, setRole] = useState<"provider" | "admin">("provider");
  const has = current.includes(role);
  return (
    <>
      <Select value={role} onValueChange={(v) => setRole(v as "provider" | "admin")}>
        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="provider">provider</SelectItem>
          <SelectItem value="admin">admin</SelectItem>
        </SelectContent>
      </Select>
      {has ? (
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => onAssign(role, false)}>Revoke</Button>
      ) : (
        <Button size="sm" disabled={disabled} onClick={() => onAssign(role, true)}>Grant</Button>
      )}
    </>
  );
}
