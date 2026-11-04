import * as React from "react";
import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";

export interface AdminBookingAlertProps {
  patientName?: string;
  patientEmail?: string;
  providerName?: string;
  whenLocal?: string;
  channel?: string;
  reason?: string;
  bookingsUrl?: string;
}

const AdminBookingAlertEmail = ({
  patientName,
  patientEmail,
  providerName = "",
  whenLocal,
  channel,
  reason,
  bookingsUrl,
}: AdminBookingAlertProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>New booking: {patientName || "A patient"} → {providerName || "provider"}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brand}>
          <Text style={brandMark}>ApexCare<span style={{ color: "#c9a84c" }}>.</span>AI — Admin alert</Text>
        </Section>
        <Heading style={h1}>New booking received</Heading>
        <Text style={text}>
          A patient just booked an appointment. Details below; live data is always on the Bookings page.
        </Text>
        <Section style={card}>
          <KV label="Patient" value={patientName || "—"} />
          {patientEmail ? <KV label="Patient email" value={patientEmail} /> : null}
          <KV label="Provider" value={providerName} />
          <KV label="When" value={whenLocal || "—"} />
          {channel ? <KV label="Channel" value={channel === "telemedicine" ? "Telemedicine" : "In person"} /> : null}
          {reason ? <KV label="Reason" value={reason} /> : null}
        </Section>
        {bookingsUrl ? (
          <Section style={{ textAlign: "center", margin: "28px 0" }}>
            <Button href={bookingsUrl} style={cta}>Open Bookings</Button>
          </Section>
        ) : null}
        <Hr style={hr} />
        <Text style={footer}>You receive this because you are listed as the admin alert address. Alerts can be changed on the Admin alerts page.</Text>
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
  component: AdminBookingAlertEmail,
  subject: (d: Record<string, unknown>) => `New booking: ${(d.patientName as string) || "A patient"} → ${(d.providerName as string) || "provider"}`,
  displayName: "Admin booking alert",
  previewData: {
    patientName: "Jordan Blake",
    patientEmail: "jordan@example.com",
    providerName: "Dr. Amelia Chen",
    whenLocal: "Tue, Nov 10, 2026 · 10:30 AM EAT",
    channel: "telemedicine",
    reason: "Follow-up on lab results",
    bookingsUrl: "https://harmony-forge-nexus.lovable.app/app/admin/bookings",
  },
} satisfies TemplateEntry;

const main: React.CSSProperties = { backgroundColor: "#ffffff", fontFamily: "ui-serif, Georgia, 'Times New Roman', serif", color: "#0d0d0d", margin: 0, padding: 0 };
const container: React.CSSProperties = { maxWidth: "560px", margin: "0 auto", padding: "32px 28px" };
const brand: React.CSSProperties = { paddingBottom: "8px", borderBottom: "1px solid #eceae3", marginBottom: "24px" };
const brandMark: React.CSSProperties = { fontFamily: "ui-serif, Georgia, serif", fontSize: "16px", fontWeight: 600, margin: 0, letterSpacing: "-0.01em" };
const h1: React.CSSProperties = { fontSize: "24px", lineHeight: "1.2", margin: "8px 0 16px", fontWeight: 600 };
const text: React.CSSProperties = { fontSize: "15px", color: "#3a3a3a", lineHeight: "1.55", margin: "0 0 20px", fontFamily: "system-ui, -apple-system, sans-serif" };
const card: React.CSSProperties = { backgroundColor: "#faf8f3", border: "1px solid #eceae3", borderRadius: "12px", padding: "16px 20px" };
const kvLabel: React.CSSProperties = { fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.12em", color: "#7a7770", margin: 0, fontFamily: "system-ui, sans-serif" };
const kvValue: React.CSSProperties = { fontSize: "15px", color: "#0d0d0d", margin: "2px 0 0", fontFamily: "system-ui, sans-serif", fontWeight: 500 };
const cta: React.CSSProperties = { backgroundColor: "#0d0d0d", color: "#ffffff", padding: "12px 22px", borderRadius: "8px", textDecoration: "none", fontSize: "14px", fontWeight: 600, fontFamily: "system-ui, sans-serif", display: "inline-block" };
const hr: React.CSSProperties = { borderColor: "#eceae3", margin: "32px 0 18px" };
const footer: React.CSSProperties = { fontSize: "12px", color: "#7a7770", lineHeight: "1.55", fontFamily: "system-ui, sans-serif", margin: 0 };
