import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, primaryRoute } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "./login";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Create your account — ApexCare AI" },
      { name: "description", content: "Create a free ApexCare AI account to book care in one sentence, attend telemedicine visits, and manage your health on the AI Healthcare Operating System." },
      { property: "og:title", content: "Create your ApexCare AI account" },
      { property: "og:description", content: "Free to start. Book care in one sentence, attend telemedicine visits, and manage health on the AI Healthcare OS." },
      { property: "og:url", content: "https://harmony-forge-nexus.lovable.app/signup" },
    ],
    links: [{ rel: "canonical", href: "https://harmony-forge-nexus.lovable.app/signup" }],
  }),
  component: SignupPage,
});

const Schema = z.object({
  full_name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(128),
});

function SignupPage() {
  const nav = useNavigate();
  const { user, roles, loading } = useAuth();
  const [pending, setPending] = useState(false);
  useEffect(() => { if (!loading && user) nav({ to: primaryRoute(roles) }); }, [user, roles, loading, nav]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = Schema.safeParse({ full_name: fd.get("full_name"), email: fd.get("email"), password: fd.get("password") });
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Please check the form");
    setPending(true);
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: { emailRedirectTo: window.location.origin, data: { full_name: parsed.data.full_name } },
    });
    setPending(false);
    if (error) return toast.error(error.message);
    toast.success("Account created. Welcome to ApexCare AI.");
  };

  const google = async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
    if (error) toast.error(error.message);
  };

  return <AuthShell title="Create your account" sub="Free to start. No credit card required.">
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2"><Label htmlFor="full_name">Full name</Label><Input id="full_name" name="full_name" required maxLength={120} /></div>
      <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required maxLength={255} autoComplete="email" /></div>
      <div className="space-y-2"><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" /></div>
      <Button type="submit" disabled={pending} className="w-full" size="lg">{pending ? "Creating account…" : "Create account"}</Button>
    </form>
    <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground"><div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" /></div>
    <Button variant="outline" className="w-full" onClick={google}>Continue with Google</Button>
    <p className="text-sm text-muted-foreground text-center mt-6">Already have an account? <Link to="/login" className="text-primary font-medium">Sign in</Link></p>
  </AuthShell>;
}
