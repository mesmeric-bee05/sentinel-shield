import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { MarketingFooter, MarketingNav } from "@/components/marketing/Layout";

export const Route = createFileRoute("/for-providers")({
  head: () => ({
    meta: [
      { title: "For Providers & Health Systems — ApexCare AI" },
      { name: "description", content: "AI-driven scheduling, ambient notes, telemedicine, and operations intelligence for clinics, hospitals, and provider networks." },
      { property: "og:title", content: "ApexCare AI for Providers" },
      { property: "og:description", content: "Reclaim clinical time. Lower no-shows. Run on a real platform." },
      { property: "og:url", content: "https://harmony-forge-nexus.lovable.app/for-providers" },
    ],
    links: [{ rel: "canonical", href: "https://harmony-forge-nexus.lovable.app/for-providers" }],
  }),
  component: () => (
    <div className="min-h-screen">
      <MarketingNav />
      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="text-xs uppercase tracking-[0.2em] text-accent">For providers & health systems</div>
        <h1 className="font-serif text-5xl md:text-6xl mt-3 tracking-tight max-w-3xl">Reclaim clinical time. Lower no-shows. Run on a real platform.</h1>
        <p className="mt-5 text-muted-foreground max-w-2xl text-lg">Designed with clinicians for clinicians. Today's schedule, no-show risk, AI-summarized intake, ambient SOAP notes — and an admin operations console that rivals modern data products.</p>
        <div className="mt-12 grid md:grid-cols-3 gap-5">
          {[
            { t: "Clinician workspace", d: "Day timeline, queue lanes, patient context drawer, AI intake summary." },
            { t: "Predictive no-show", d: "Heuristic v1 ships now; clean swap point for ML model in Phase 2." },
            { t: "Operations console", d: "Capacity heatmap, utilization, KPI strip, audit log viewer." },
          ].map((b) => (
            <div key={b.t} className="p-7 rounded-xl border border-border bg-card shadow-card">
              <div className="font-serif text-xl">{b.t}</div>
              <p className="mt-2 text-sm text-muted-foreground">{b.d}</p>
            </div>
          ))}
        </div>
        <div className="mt-12">
          <Button asChild size="lg"><Link to="/contact">Book a tailored walkthrough</Link></Button>
        </div>
      </section>
      <MarketingFooter />
    </div>
  ),
});
