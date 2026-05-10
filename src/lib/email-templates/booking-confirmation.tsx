import * as React from "react";
import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";

const SITE_NAME = "ApexCare AI";

export interface BookingConfirmationProps {
  patientName?: string;
  providerName?: string;
  specialty?: string;
  whenLocal?: string;
  whenUtc?: string;
  channel?: "telemedicine" | "in_person";
  location?: string;
  roomUrl?: string;
  appointmentUrl?: string;
  reason?: string;
  aiSummary?: string;
}

const BookingConfirmationEmail = ({
  patientName,
  providerName = "your provider",
  specialty = "",
  whenLocal,
  whenUtc,
  channel = "telemedicine",
  location,
  roomUrl,
  appointmentUrl,
  reason,
  aiSummary,
}: BookingConfirmationProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your visit with {providerName} is confirmed</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brand}>
          <Text style={brandMark}>ApexCare<span style={{ color: "#c9a84c" }}>.</span>AI</Text>
        </Section>
        <Heading style={h1}>{patientName ? `Hi ${patientName}, you're booked.` : "You're booked."}</Heading>
        <Text style={text}>
          Your appointment with <strong>{providerName}</strong>{specialty ? ` (${specialty})` : ""} is confirmed.
        </Text>

        <Section style={card}>
          <KV label="When" value={whenLocal ?? whenUtc ?? ""} />
          {whenUtc && whenLocal && <KV label="UTC" value={whenUtc} />}
          <KV label="Channel" value={channel === "telemedicine" ? "Telemedicine" : "In person"} />
          {channel === "in_person" && location ? <KV label="Location" value={location} /> : null}
          {reason ? <KV label="Reason" value={reason} /> : null}
        </Section>

        {aiSummary ? (
          <Section style={aiCard}>
            <Text style={aiLabel}>AI clinical pre-summary</Text>
            <Text style={aiBody}>{aiSummary}</Text>
          </Section>
        ) : null}

        {channel === "telemedicine" && roomUrl ? (
          <Section style={{ textAlign: "center", margin: "28px 0" }}>
            <Button href={roomUrl} style={cta}>Join the telemedicine room</Button>
          </Section>
        ) : appointmentUrl ? (
          <Section style={{ textAlign: "center", margin: "28px 0" }}>
            <Button href={appointmentUrl} style={cta}>View appointment</Button>
          </Section>
        ) : null}

        <Hr style={hr} />
        <Text style={footer}>
          Need to reschedule or cancel? Open your appointment in {SITE_NAME} and use the controls there. Replies to this email reach our team.
        </Text>
      </Container>
    </Body>
  </Html>
);

const KV = ({ label, value }: { label: string; value: string }) => (
  <Section style={{ padding: "8px 0" }}>
    <Text style={kvLabel}>{label}</Text>
    <Text style={kvValue}>{value}</Text>
  </Section>
);

export const template = {
  component: BookingConfirmationEmail,
  subject: (d: Record<string, unknown>) => `Your visit with ${(d.providerName as string) || "your provider"} is confirmed`,
  displayName: "Booking confirmation",
  previewData: {
    patientName: "Jordan",
    providerName: "Dr. Amelia Chen",
    specialty: "Internal Medicine",
    whenLocal: "Tue, Jun 3, 2026 · 10:30 AM PDT",
    whenUtc: "2026-06-03T17:30:00Z",
    channel: "telemedicine",
    roomUrl: "https://harmony-forge-nexus.lovable.app/app/room/00000000-0000-0000-0000-000000000000",
    appointmentUrl: "https://harmony-forge-nexus.lovable.app/app/appointments",
    reason: "Annual physical and lab review",
    aiSummary: "Routine wellness check; review recent labs and update preventive care plan.",
  },
} satisfies TemplateEntry;

const main: React.CSSProperties = { backgroundColor: "#ffffff", fontFamily: "ui-serif, Georgia, 'Times New Roman', serif", color: "#0d0d0d", margin: 0, padding: 0 };
const container: React.CSSProperties = { maxWidth: "560px", margin: "0 auto", padding: "32px 28px" };
const brand: React.CSSProperties = { paddingBottom: "8px", borderBottom: "1px solid #eceae3", marginBottom: "24px" };
const brandMark: React.CSSProperties = { fontFamily: "ui-serif, Georgia, serif", fontSize: "20px", fontWeight: 600, margin: 0, letterSpacing: "-0.01em" };
const h1: React.CSSProperties = { fontSize: "26px", lineHeight: "1.2", margin: "8px 0 16px", fontWeight: 600 };
const text: React.CSSProperties = { fontSize: "15px", color: "#3a3a3a", lineHeight: "1.55", margin: "0 0 20px", fontFamily: "system-ui, -apple-system, sans-serif" };
const card: React.CSSProperties = { backgroundColor: "#faf8f3", border: "1px solid #eceae3", borderRadius: "12px", padding: "16px 20px" };
const kvLabel: React.CSSProperties = { fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.12em", color: "#7a7770", margin: 0, fontFamily: "system-ui, sans-serif" };
const kvValue: React.CSSProperties = { fontSize: "15px", color: "#0d0d0d", margin: "2px 0 0", fontFamily: "system-ui, sans-serif", fontWeight: 500 };
const aiCard: React.CSSProperties = { marginTop: "16px", border: "1px solid #d8c98a", backgroundColor: "#fdf9eb", borderRadius: "12px", padding: "14px 18px" };
const aiLabel: React.CSSProperties = { fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.16em", color: "#a08a2c", margin: 0, fontFamily: "system-ui, sans-serif" };
const aiBody: React.CSSProperties = { fontSize: "14px", color: "#3a3a3a", margin: "6px 0 0", lineHeight: "1.5", fontFamily: "system-ui, sans-serif" };
const cta: React.CSSProperties = { backgroundColor: "#0d0d0d", color: "#ffffff", padding: "12px 22px", borderRadius: "8px", textDecoration: "none", fontSize: "14px", fontWeight: 600, fontFamily: "system-ui, sans-serif", display: "inline-block" };
const hr: React.CSSProperties = { borderColor: "#eceae3", margin: "32px 0 18px" };
const footer: React.CSSProperties = { fontSize: "12px", color: "#7a7770", lineHeight: "1.55", fontFamily: "system-ui, sans-serif", margin: 0 };
