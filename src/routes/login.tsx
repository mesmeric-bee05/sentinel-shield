import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Activity, ChevronLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, primaryRoute } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — ApexCare AI" }, { name: "description", content: "Sign in to your ApexCare AI workspace." }] }),
  component: LoginPage,
});

function LoginPage() {
  const nav = useNavigate();
  const { user, roles, loading } = useAuth();
  const [pending, setPending] = useState(false);

  useEffect(() => { if (!loading && user) nav({ to: primaryRoute(roles) }); }, [user, roles, loading, nav]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: String(fd.get("email")), password: String(fd.get("password")),
    });
    setPending(false);
    if (error) return toast.error(error.message);
    toast.success("Welcome back.");
  };

  const google = async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
    if (error) toast.error(error.message);
  };

  return <AuthShell title="Welcome back" sub="Sign in to your ApexCare AI workspace.">
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required autoComplete="email" /></div>
      <div className="space-y-2"><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" required autoComplete="current-password" /></div>
      <Button type="submit" disabled={pending} className="w-full" size="lg">{pending ? "Signing in…" : "Sign in"}</Button>
    </form>
    <Divider />
    <Button variant="outline" className="w-full" onClick={google}>Continue with Google</Button>
    <p className="text-sm text-muted-foreground text-center mt-6">No account? <Link to="/signup" className="text-primary font-medium">Create one</Link></p>
  </AuthShell>;
}

export function AuthShell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:block bg-gradient-hero relative overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="relative h-full flex flex-col justify-between p-12 text-primary-foreground">
          <Link to="/" className="flex items-center gap-2 w-fit">
            <div className="w-9 h-9 rounded-lg bg-accent text-accent-foreground grid place-items-center"><Activity className="w-5 h-5" /></div>
            <div className="font-serif text-lg">ApexCare<span className="text-accent">.</span>AI</div>
          </Link>
          <div>
            <div className="font-serif text-4xl leading-tight max-w-md text-balance">"The single intelligent platform where every healthcare workflow converges."</div>
            <div className="mt-6 text-sm text-white/60">— ApexCare AI mission</div>
          </div>
          <div className="text-xs text-white/40 uppercase tracking-wider">HIPAA-aligned · Zero-Trust · AI-native</div>
        </div>
      </div>
      <div className="flex items-center justify-center p-6 sm:p-12 bg-background">
        <div className="w-full max-w-md">
          <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-8"><ChevronLeft className="w-4 h-4" />Back home</Link>
          <h1 className="font-serif text-4xl tracking-tight">{title}</h1>
          <p className="mt-2 text-muted-foreground">{sub}</p>
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground"><div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" /></div>;
}
