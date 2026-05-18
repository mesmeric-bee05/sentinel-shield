import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MarketingFooter, MarketingNav } from "@/components/marketing/Layout";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact — ApexCare AI" },
      { name: "description", content: "Talk to the ApexCare AI team about deploying the AI Healthcare Operating System in your clinic, hospital, or network." },
      { property: "og:title", content: "Contact ApexCare AI" },
      { property: "og:description", content: "Reach our team." },
      { property: "og:url", content: "https://harmony-forge-nexus.lovable.app/contact" },
    ],
    links: [{ rel: "canonical", href: "https://harmony-forge-nexus.lovable.app/contact" }],
  }),
  component: ContactPage,
});

const Schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  org: z.string().trim().max(160).optional(),
  message: z.string().trim().min(5).max(2000),
});

function ContactPage() {
  const [pending, setPending] = useState(false);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = Schema.safeParse({
      name: fd.get("name"), email: fd.get("email"), org: fd.get("org"), message: fd.get("message"),
    });
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? "Please check the form"); return; }
    setPending(true);
    setTimeout(() => { setPending(false); toast.success("Message sent. We'll be in touch shortly."); (e.target as HTMLFormElement).reset(); }, 600);
  };
  return (
    <div className="min-h-screen">
      <MarketingNav />
      <section className="mx-auto max-w-3xl px-6 py-24">
        <div className="text-xs uppercase tracking-[0.2em] text-accent">Contact</div>
        <h1 className="font-serif text-5xl mt-3 tracking-tight">Let's talk.</h1>
        <p className="mt-3 text-muted-foreground">Tell us about your organization and what you'd like to solve.</p>
        <form onSubmit={onSubmit} className="mt-10 space-y-5 p-8 rounded-2xl border border-border bg-card shadow-card">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" name="name" required maxLength={120} /></div>
            <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" name="email" required maxLength={255} /></div>
          </div>
          <div className="space-y-2"><Label htmlFor="org">Organization</Label><Input id="org" name="org" maxLength={160} /></div>
          <div className="space-y-2"><Label htmlFor="message">How can we help?</Label><Textarea id="message" name="message" rows={5} required maxLength={2000} /></div>
          <Button type="submit" disabled={pending} size="lg">{pending ? "Sending…" : "Send message"}</Button>
        </form>
      </section>
      <MarketingFooter />
    </div>
  );
}
