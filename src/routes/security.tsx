import { createFileRoute } from "@tanstack/react-router";
import { Database, Eye, FileText, Fingerprint, Key, Lock, ServerCog, ShieldCheck } from "lucide-react";
import { MarketingFooter, MarketingNav } from "@/components/marketing/Layout";

export const Route = createFileRoute("/security")({
  head: () => ({
    meta: [
      { title: "Security — ApexCare AI" },
      { name: "description", content: "Zero-Trust architecture, Row-Level Security, server-side secrets, leaked-password defense, immutable audit ledger." },
      { property: "og:title", content: "ApexCare AI Security Architecture" },
      { property: "og:description", content: "Hospital-grade security as foundation, not feature." },
    ],
  }),
  component: SecurityPage,
});

function SecurityPage() {
  const controls = [
    { i: Database, t: "Row-Level Security", d: "Every Postgres table is RLS-enforced. Patients see their rows. Providers see their assigned rows. Admins see all — only via audited paths." },
    { i: Key, t: "Server-side secrets", d: "Service-role keys never cross the client boundary. All privileged writes flow through verified server functions." },
    { i: Lock, t: "Leaked-password defense", d: "HIBP (Have I Been Pwned) is checked on every signup and password change. Compromised credentials are blocked." },
    { i: Eye, t: "Immutable audit ledger", d: "PHI access, role changes, and bookings are recorded to an append-only audit log. Phase 2 hash-chain integrity provides cryptographic tamper-evidence." },
    { i: Fingerprint, t: "Biometric-ready", d: "WebAuthn/FIDO2 enrollment surfaces are reserved across the auth flow for passkey upgrade." },
    { i: ServerCog, t: "Zero-Trust runtime", d: "All server functions re-authenticate the requester. No implicit trust between services." },
    { i: FileText, t: "Validated input boundaries", d: "Every server function validates inputs with strict schemas — length, format, character class." },
    { i: ShieldCheck, t: "Compliance roadmap", d: "Architecture is HIPAA-aligned and SOC 2 Type II is in active progress." },
  ];
  return (
    <div className="min-h-screen">
      <MarketingNav />
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-xs uppercase tracking-[0.2em] text-accent">Security architecture</div>
        <h1 className="font-serif text-5xl md:text-6xl mt-3 tracking-tight max-w-3xl">Built Zero-Trust from the database row to the browser tab.</h1>
        <p className="mt-5 text-muted-foreground max-w-2xl text-lg">
          The average healthcare breach now costs $10.9M. We treat security as the foundation of the platform — not a feature you opt into.
        </p>
        <div className="mt-14 grid md:grid-cols-2 gap-4">
          {controls.map((c) => (
            <div key={c.t} className="p-6 rounded-xl border border-border bg-card shadow-card">
              <c.i className="w-6 h-6 text-accent" />
              <div className="mt-4 font-serif text-xl">{c.t}</div>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{c.d}</p>
            </div>
          ))}
        </div>
      </section>
      <MarketingFooter />
    </div>
  );
}
