import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { Activity, Bell, Calendar, FileSearch, LayoutDashboard, LogOut, Search, ShieldCheck, Stethoscope, UserCog, Users, Video } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/app")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: AppShell,
});

function AppShell() {
  const { user, roles, loading, signOut } = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!loading && !user) window.location.href = "/login";
  }, [loading, user]);

  if (loading || !user) return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading workspace…</div>;

  const isProvider = roles.includes("provider");
  const isAdmin = roles.includes("admin");

  const nav = [
    { to: "/app", label: "Overview", icon: LayoutDashboard, exact: true },
    { to: "/app/discover", label: "Find care", icon: Search, show: true },
    { to: "/app/appointments", label: "Appointments", icon: Calendar, show: true },
    { to: "/app/provider", label: "Clinician", icon: Stethoscope, show: isProvider },
    { to: "/app/admin", label: "Operations", icon: Users, show: isAdmin },
    { to: "/app/admin/audit", label: "Audit log", icon: FileSearch, show: isAdmin },
    { to: "/app/admin/notifications", label: "Notifications", icon: Bell, show: isAdmin },
    { to: "/app/admin/roles", label: "Roles", icon: UserCog, show: isAdmin },
  ].filter((n) => n.show !== false);

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-64 shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col">
        <Link to="/" className="flex items-center gap-2 p-5 border-b border-sidebar-border">
          <div className="w-9 h-9 rounded-lg bg-accent text-accent-foreground grid place-items-center"><Activity className="w-5 h-5" /></div>
          <div>
            <div className="font-serif text-base leading-none">ApexCare<span className="text-accent">.</span>AI</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/60">Workspace</div>
          </div>
        </Link>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map((n) => {
            const active = n.exact ? path === n.to : path.startsWith(n.to);
            return (
              <Link key={n.to} to={n.to} className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition ${active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"}`}>
                <n.icon className="w-4 h-4" /> {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-2">
          <div className="px-3 py-2 text-xs">
            <div className="truncate font-medium">{user.email}</div>
            <div className="flex flex-wrap gap-1 mt-1">
              {roles.map((r) => (
                <span key={r} className="px-1.5 py-0.5 rounded bg-sidebar-accent text-[10px] uppercase tracking-wider">{r}</span>
              ))}
            </div>
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" onClick={signOut}>
            <LogOut className="w-4 h-4 mr-2" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

export function PageHeader({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-8">
      <div>
        <h1 className="font-serif text-3xl tracking-tight">{title}</h1>
        {sub && <p className="text-sm text-muted-foreground mt-1">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export const _icons = { Video, ShieldCheck };
