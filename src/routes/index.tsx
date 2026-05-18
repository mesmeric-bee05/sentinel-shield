import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, Brain, Calendar, ChevronRight, Globe, Lock, ShieldCheck, Sparkles, Stethoscope, Video, Workflow, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketingFooter, MarketingNav } from "@/components/marketing/Layout";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ApexCare AI — The AI-Powered Healthcare Operating System" },
      { name: "description", content: "One platform for AI scheduling, telemedicine, ambient clinical notes, and predictive operations — built on a Zero-Trust security model." },
      { property: "og:title", content: "ApexCare AI — Healthcare Operating System" },
      { property: "og:description", content: "Eliminate fragmentation. Unify every patient–provider–admin workflow." },
      { property: "og:url", content: "https://harmony-forge-nexus.lovable.app/" },
    ],
    links: [{ rel: "canonical", href: "https://harmony-forge-nexus.lovable.app/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "ApexCare AI",
          url: "https://harmony-forge-nexus.lovable.app/",
          description: "The AI-Powered Healthcare Operating System unifying scheduling, telemedicine, ambient clinical AI, and Zero-Trust security.",
          sameAs: [],
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "ApexCare AI",
          url: "https://harmony-forge-nexus.lovable.app/",
          description: "AI-Powered Healthcare Operating System for patients, providers, and health systems.",
        }),
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingNav />
      <Hero />
      <TrustBar />
      <Pillars />
      <HowItWorks />
      <Personas />
      <SecuritySection />
      <CTASection />
      <MarketingFooter />
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-hero text-primary-foreground">
      <div className="absolute inset-0 grid-bg opacity-40" />
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-accent/20 blur-3xl" />
      <div className="relative mx-auto max-w-7xl px-6 pt-24 pb-32">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/15 bg-white/5 text-xs uppercase tracking-[0.2em] text-accent">
            <Sparkles className="w-3.5 h-3.5" /> Introducing the AHOS
          </div>
          <h1 className="mt-6 font-serif text-5xl md:text-7xl leading-[1.05] tracking-tight text-balance">
            The AI-Powered <em className="text-accent not-italic">Healthcare</em> Operating System.
          </h1>
          <p className="mt-6 text-lg md:text-xl text-white/70 max-w-2xl text-balance">
            Every patient, provider, and administrator workflow — converged into one intelligent platform.
            ApexCare AI eliminates fragmentation from healthcare with autonomous scheduling, ambient clinical AI, telemedicine,
            and an unbreakable Zero-Trust security spine.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Button asChild size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-glow">
              <Link to="/signup">Start free <ChevronRight className="w-4 h-4 ml-1" /></Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/10">
              <Link to="/for-providers">For health systems</Link>
            </Button>
          </div>
          <div className="mt-12 flex flex-wrap gap-x-8 gap-y-3 text-xs uppercase tracking-wider text-white/75">
            <span className="inline-flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5 text-accent" /> HIPAA-aligned</span>
            <span className="inline-flex items-center gap-2"><Lock className="w-3.5 h-3.5 text-accent" /> Zero-Trust</span>
            <span className="inline-flex items-center gap-2"><Brain className="w-3.5 h-3.5 text-accent" /> AI-native</span>
            <span className="inline-flex items-center gap-2"><Globe className="w-3.5 h-3.5 text-accent" /> Omnichannel</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function TrustBar() {
  const stats = [
    { v: "94%", l: "no-show prediction accuracy (model target)" },
    { v: "<300ms", l: "AI slot suggestion latency" },
    { v: "100%", l: "audit-trail coverage on PHI access" },
    { v: "24/7", l: "omnichannel patient agent" },
  ];
  return (
    <section className="border-y border-border/60 bg-muted/30">
      <div className="mx-auto max-w-7xl px-6 py-10 grid grid-cols-2 md:grid-cols-4 gap-8">
        {stats.map((s) => (
          <div key={s.l}>
            <div className="font-serif text-3xl text-primary">{s.v}</div>
            <div className="text-xs text-muted-foreground mt-1">{s.l}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Pillars() {
  const items = [
    { icon: Calendar, title: "AI Scheduling", body: "Natural-language booking, predictive no-show scoring, intelligent slot ranking." },
    { icon: Video, title: "Telemedicine Suite", body: "WebRTC consultations with built-in pre-call checks and ambient clinical capture." },
    { icon: Brain, title: "Ambient Clinical AI", body: "Post-consult SOAP note drafting, intake summarization, decision support." },
    { icon: Workflow, title: "Operations Intelligence", body: "Capacity heatmaps, utilization, revenue and risk — in real time." },
    { icon: Globe, title: "Omnichannel Agents", body: "Voice, WhatsApp, SMS, web — one autonomous patient interface." },
    { icon: ShieldCheck, title: "Zero-Trust Security", body: "Row-level isolation, immutable audit, leaked-password defense, biometric-ready." },
  ];
  return (
    <section className="mx-auto max-w-7xl px-6 py-28">
      <div className="max-w-2xl">
        <div className="text-xs uppercase tracking-[0.2em] text-accent">The platform</div>
        <h2 className="mt-3 font-serif text-4xl md:text-5xl tracking-tight">Six categories. One operating system.</h2>
        <p className="mt-4 text-muted-foreground text-balance">
          Point solutions can't deliver clinical operations intelligence. ApexCare AI is the platform tier — the connective tissue every other tool plugs into.
        </p>
      </div>
      <div className="mt-14 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        {items.map((p) => (
          <div key={p.title} className="group relative p-7 rounded-2xl border border-border bg-card shadow-card hover:shadow-elegant transition">
            <div className="absolute inset-0 bg-gradient-ai opacity-0 group-hover:opacity-100 transition rounded-2xl pointer-events-none" />
            <div className="relative">
              <div className="w-11 h-11 rounded-lg bg-primary text-primary-foreground grid place-items-center mb-5">
                <p.icon className="w-5 h-5" />
              </div>
              <div className="font-serif text-2xl">{p.title}</div>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{p.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="bg-muted/30 border-y border-border/60">
      <div className="mx-auto max-w-7xl px-6 py-28 grid lg:grid-cols-2 gap-16 items-center">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-accent">How AI scheduling works</div>
          <h2 className="mt-3 font-serif text-4xl md:text-5xl tracking-tight">From "I need care" to "you're booked" — in one sentence.</h2>
          <ol className="mt-10 space-y-6">
            {[
              { t: "Natural-language intent", d: "The patient describes what they need in plain language." },
              { t: "AI ranks the best slots", d: "Models weigh urgency, history, location, insurance, and provider load." },
              { t: "Predictive no-show scoring", d: "Each booking is scored for risk; low-risk slots get auto-confirmed." },
              { t: "Autonomous follow-up", d: "Reminders, rescheduling, and intake — all handled by the agent." },
            ].map((s, i) => (
              <li key={s.t} className="flex gap-4">
                <div className="shrink-0 w-9 h-9 rounded-full border border-accent/40 bg-accent/10 text-accent grid place-items-center font-serif">{i + 1}</div>
                <div>
                  <div className="font-medium">{s.t}</div>
                  <div className="text-sm text-muted-foreground mt-1">{s.d}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="relative">
          <div className="absolute -inset-6 bg-gradient-aurora opacity-20 blur-3xl rounded-3xl" />
          <div className="relative rounded-2xl border border-border bg-card shadow-elegant overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="w-3.5 h-3.5 text-accent" /> ApexCare AI Concierge
            </div>
            <div className="p-6 space-y-4">
              <div className="ml-auto max-w-[80%] bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-3 text-sm">
                I need a dermatologist next week, mornings if possible.
              </div>
              <div className="max-w-[90%] bg-muted rounded-2xl rounded-tl-sm px-4 py-3 text-sm space-y-3">
                <div className="text-xs text-muted-foreground">Found 3 great matches:</div>
                {[
                  { d: "Tue · 9:30 AM", who: "Dr. Marcus Patel", reason: "Top dermatology rating, accepts your insurance" },
                  { d: "Wed · 10:15 AM", who: "Dr. Marcus Patel", reason: "Lower historic no-show pressure" },
                  { d: "Fri · 8:45 AM", who: "Dr. Layla Haddad", reason: "Earliest available; primary care referral path" },
                ].map((s) => (
                  <div key={s.d} className="flex items-center justify-between rounded-xl border border-border bg-background p-3">
                    <div>
                      <div className="text-sm font-medium">{s.d} · {s.who}</div>
                      <div className="text-xs text-muted-foreground">{s.reason}</div>
                    </div>
                    <Button size="sm" variant="outline" className="text-xs">Book</Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Personas() {
  const personas = [
    { icon: Stethoscope, t: "Patients", d: "Find care, book in one sentence, attend visits, manage health — anywhere.", to: "/signup" as const, label: "Try the patient portal" },
    { icon: Activity, t: "Providers", d: "Today's schedule, no-show risk, AI-summarized intake, ambient clinical notes.", to: "/for-providers" as const, label: "See provider workspace" },
    { icon: Workflow, t: "Administrators", d: "Capacity, utilization, revenue, audit. Operations command center, real-time.", to: "/for-providers" as const, label: "Admin operations" },
  ];
  return (
    <section className="mx-auto max-w-7xl px-6 py-28">
      <div className="text-center max-w-2xl mx-auto">
        <div className="text-xs uppercase tracking-[0.2em] text-accent">Built for every role</div>
        <h2 className="mt-3 font-serif text-4xl md:text-5xl tracking-tight">One platform. Three workspaces.</h2>
      </div>
      <div className="mt-14 grid md:grid-cols-3 gap-5">
        {personas.map((p) => (
          <div key={p.t} className="p-8 rounded-2xl border border-border bg-card shadow-card">
            <p.icon className="w-8 h-8 text-primary" />
            <div className="mt-5 font-serif text-2xl">{p.t}</div>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{p.d}</p>
            <Link to={p.to} className="mt-5 inline-flex items-center gap-1 text-sm text-primary hover:gap-2 transition-all">
              {p.label} <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}

function SecuritySection() {
  return (
    <section className="bg-primary text-primary-foreground relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-30" />
      <div className="relative mx-auto max-w-7xl px-6 py-28 grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-accent">Security as foundation</div>
          <h2 className="mt-3 font-serif text-4xl md:text-5xl tracking-tight">A $10.9M breach is not a risk we accept.</h2>
          <p className="mt-5 text-white/70 text-balance">
            Healthcare is the most attacked sector on earth. ApexCare AI is engineered Zero-Trust from the database row to the browser tab.
            Every PHI access is logged. Every role is scoped. Every secret is server-side.
          </p>
          <Button asChild className="mt-8 bg-accent text-accent-foreground hover:bg-accent/90">
            <Link to="/security">Read the security architecture</Link>
          </Button>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {[
            { i: ShieldCheck, t: "Row-Level Security", d: "Postgres RLS on every table; isolation at the row." },
            { i: Lock, t: "Server-side secrets", d: "No private keys ever cross the client boundary." },
            { i: Zap, t: "HIBP defense", d: "Compromised passwords blocked at signup and rotation." },
            { i: Brain, t: "Audit ledger", d: "Every PHI read and write is recorded immutably." },
          ].map((s) => (
            <div key={s.t} className="p-5 rounded-xl border border-white/10 bg-white/5 backdrop-blur">
              <s.i className="w-5 h-5 text-accent" />
              <div className="mt-3 font-medium">{s.t}</div>
              <div className="text-xs text-white/80 mt-1">{s.d}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-28 text-center">
      <h2 className="font-serif text-4xl md:text-6xl tracking-tight text-balance">
        Stop choosing between point tools.<br />Start running on a platform.
      </h2>
      <p className="mt-5 text-muted-foreground max-w-2xl mx-auto">
        ApexCare AI is free to try. Bring patients on in minutes — bring your whole organization on next.
      </p>
      <div className="mt-10 flex flex-wrap justify-center gap-3">
        <Button asChild size="lg"><Link to="/signup">Create your account</Link></Button>
        <Button asChild size="lg" variant="outline"><Link to="/contact">Talk to sales</Link></Button>
      </div>
    </section>
  );
}
