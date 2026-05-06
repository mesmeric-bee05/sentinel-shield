import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { bootstrapFirstAdmin, getSystemRoleStatus } from "@/server/roles.functions";

export const Route = createFileRoute("/app/bootstrap")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [{ title: "First-time setup — ApexCare AI" }] }),
  component: Bootstrap,
});

function Bootstrap() {
  const status = useServerFn(getSystemRoleStatus);
  const bootstrap = useServerFn(bootstrapFirstAdmin);
  const { refreshRoles } = useAuth();
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [adminCount, setAdminCount] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    status({}).then((r) => { setAdminCount(r.adminCount); setLoading(false); });
  }, [status]);

  const claim = async () => {
    setBusy(true);
    const r = await bootstrap({});
    setBusy(false);
    if (!r.ok) return toast.error(r.error || "Could not bootstrap");
    toast.success("You're now the platform admin");
    await refreshRoles();
    nav({ to: "/app/admin" });
  };

  return (
    <div className="min-h-[80vh] grid place-items-center p-6">
      <div className="max-w-md w-full rounded-2xl border border-border bg-card p-8 shadow-elegant text-center">
        <div className="w-12 h-12 rounded-full bg-accent/10 text-accent grid place-items-center mx-auto mb-4"><ShieldCheck className="w-6 h-6" /></div>
        <h1 className="font-serif text-2xl">First-time setup</h1>
        {loading ? <p className="text-sm text-muted-foreground mt-3"><Loader2 className="w-4 h-4 animate-spin inline" /></p> : adminCount > 0 ? (
          <>
            <p className="text-sm text-muted-foreground mt-3">An administrator already exists. Ask them to grant you a role from the admin console.</p>
            <Button variant="outline" className="mt-6" onClick={() => nav({ to: "/app" })}>Back to workspace</Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mt-3">No administrators exist yet. As the first signed-in user, you can claim the founding admin role. This action is recorded permanently in the audit log.</p>
            <Button className="mt-6 w-full" onClick={claim} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
              Claim founding admin
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
