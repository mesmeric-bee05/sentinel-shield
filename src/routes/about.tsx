import { createFileRoute } from "@tanstack/react-router";
import { MarketingFooter, MarketingNav } from "@/components/marketing/Layout";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — ApexCare AI" },
      { name: "description", content: "ApexCare AI is building the AI-Powered Healthcare Operating System: one platform for scheduling, telemedicine, clinical AI, and operations." },
      { property: "og:title", content: "About ApexCare AI" },
      { property: "og:description", content: "Our mission is to eliminate fragmentation in healthcare." },
      { property: "og:url", content: "https://harmony-forge-nexus.lovable.app/about" },
    ],
    links: [{ rel: "canonical", href: "https://harmony-forge-nexus.lovable.app/about" }],
  }),
  component: () => (
    <div className="min-h-screen">
      <MarketingNav />
      <section className="mx-auto max-w-3xl px-6 py-24">
        <div className="text-xs uppercase tracking-[0.2em] text-accent">About us</div>
        <h1 className="font-serif text-5xl md:text-6xl mt-3 tracking-tight">Healthcare deserves a platform — not another point tool.</h1>
        <div className="prose prose-neutral mt-8 text-muted-foreground space-y-5 text-lg leading-relaxed">
          <p>91% of providers now use AI in some capacity, but it lives in disconnected silos: one tool for scheduling, another for video, a third for notes, a fourth for analytics. Patients pay the price.</p>
          <p>ApexCare AI was founded on a single conviction: clinical operations intelligence is a platform problem, not a feature problem. We are building the connective tissue that turns scattered point tools into a coherent operating system for care delivery.</p>
          <p>Our team unifies experience across health systems, large-scale infrastructure, and frontier AI research. Our standard is not "good enough" — it is hospital-grade reliability with Apple-grade craft.</p>
        </div>
      </section>
      <MarketingFooter />
    </div>
  ),
});
