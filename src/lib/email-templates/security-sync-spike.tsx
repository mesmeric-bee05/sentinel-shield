import * as React from "react";
import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";

export interface SyncSpikeAlertProps {
  windowMinutes?: number;
  threshold?: number;
  failures?: number;
  breakdown?: string;
  lastError?: string;
  lastSourceIp?: string;
  auditUrl?: string;
}

const SyncSpikeAlertEmail = ({
  windowMinutes = 15,
  threshold,
  failures,
  breakdown,
  lastError,
  lastSourceIp,
  auditUrl,
}: SyncSpikeAlertProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Security sync spike: {failures ?? "?"} failed attempts in {windowMinutes} min</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brand}>
          <Text style={brandMark}>ApexCare<span style={{ color: "#c9a84c" }}>.</span>AI — Security alert</Text>
        </Section>
        <Heading style={h1}>Security sync spike detected</Heading>
        <Text style={text}>
          The findings-sync endpoint logged <strong>{failiesOr(failures)} failed attempts</strong> in the last {windowMinutes} minutes (threshold {threshold ?? "—"}). Someone may be probing the endpoint without a valid signing secret.
        </Text>
        <Section style={card}>
          <KV label="Window" value={`${windowMinutes} minutes`} />
          <KV label="Failed attempts" value={String(failiesOr(failures))} />
          {breakdown ? <KV label="By status" value={breakdown} /> : null}
          {lastSourceIp ? <KV label="Latest source" value={lastSourceIp} /> : null}
          {lastError ? <KV label="Latest error" value={lastError} /> : null}
        </Section>
        {auditUrl ? (
          <Section style={{ textAlign: "center", margin: "28px 0" }}>
            <Button href={auditUrl} style={cta}>Open the sync audit page</Button>
          </Section>
        ) : null}
        <Hr style={hr} />
        <Text style={footer}>Alerts are throttled to one per spike window. Ongoing spikes are visible on the sync health page.</Text>
      </Container>
    </Body>
  </Html>
);

function failiesOr(v: number | undefined): string {
  return typeof v === "number" ? String(v) : "?";
}

const KV = ({ label, value }: { label: string; value: string }) => (
  <Section style={{ padding: "8px 0" }}>
    <Text style={kvLabel}>{label}</Text>
    <Text style={kvValue}>{value}</Text>
  </Section>
);

export const template = {
  component: SyncSpikeAlertEmail,
  subject: (d: Record<string, unknown>) => `Security sync spike: ${d.failures ?? "?"} failed attempts in ${d.windowMinutes ?? "?"} min`,
  displayName: "Security sync spike alert",
  previewData: {
    windowMinutes: 15,
    threshold: 5,
    failures: 14,
    breakdown: "rate_limited 9 · invalid_signature 4 · replay 1",
    lastError: "signature mismatch",
    lastSourceIp: "203.0.113.7",
    auditUrl: "https://harmony-forge-nexus.lovable.app/app/admin/security-sync",
  },
} satisfies TemplateEntry;

const main: React.CSSProperties = { backgroundColor: "#ffffff", fontFamily: "ui-serif, Georgia, 'Times New Roman', serif", color: "#0d0d0d", margin: 0, padding: 0 };
const container: React.CSSProperties = { maxWidth: "560px", margin: "0 auto", padding: "32px 28px" };
const brand: React.CSSProperties = { paddingBottom: "8px", borderBottom: "1px solid #eceae3", marginBottom: "24px" };
const brandMark: React.CSSProperties = { fontFamily: "ui-serif, Georgia, serif", fontSize: "16px", fontWeight: 600, margin: 0, letterSpacing: "-0.01em" };
const h1: React.CSSProperties = { fontSize: "24px", lineHeight: "1.2", margin: "8px 0 16px", fontWeight: 600 };
const text: React.CSSProperties = { fontSize: "15px", color: "#3a3a3a", lineHeight: "1.55", margin: "0 0 20px", fontFamily: "system-ui, -apple-system, sans-serif" };
const card: React.CSSProperties = { backgroundColor: "#fdf3f2", border: "1px solid #e7c4c0", borderRadius: "12px", padding: "16px 20px" };
const kvLabel: React.CSSProperties = { fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.12em", color: "#8a5a54", margin: 0, fontFamily: "system-ui, sans-serif" };
const kvValue: React.CSSProperties = { fontSize: "15px", color: "#0d0d0d", margin: "2px 0 0", fontFamily: "system-ui, sans-serif", fontWeight: 500 };
const cta: React.CSSProperties = { backgroundColor: "#7a2e26", color: "#ffffff", padding: "12px 22px", borderRadius: "8px", textDecoration: "none", fontSize: "14px", fontWeight: 600, fontFamily: "system-ui, sans-serif", display: "inline-block" };
const hr: React.CSSProperties = { borderColor: "#eceae3", margin: "32px 0 18px" };
const footer: React.CSSProperties = { fontSize: "12px", color: "#7a7770", lineHeight: "1.55", fontFamily: "system-ui, sans-serif", margin: 0 };
