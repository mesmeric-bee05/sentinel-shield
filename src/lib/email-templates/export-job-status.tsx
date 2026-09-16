import * as React from "react";
import { Body, Container, Head, Heading, Html, Link, Preview, Section, Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";

type Data = {
  dataset?: string;
  format?: string;
  status?: string;
  rows?: number | string;
  error?: string;
  jobsUrl?: string;
};

export function ExportJobStatusEmail(props: Record<string, unknown>) {
  const d = props as Data;
  const failed = d.status === "failed";
  return (
    <Html>
      <Head />
      <Preview>{failed ? "A security export failed" : "Your security export is ready"}</Preview>
      <Body style={{ background: "#f6f7f9", fontFamily: "Inter, Arial, sans-serif", padding: "24px" }}>
        <Container style={{ background: "#ffffff", borderRadius: 12, padding: 24, maxWidth: 560 }}>
          <Heading style={{ fontSize: 20, margin: "0 0 12px" }}>
            {failed ? "Security export failed" : "Security export ready"}
          </Heading>
          <Section>
            <Text style={{ margin: "4px 0", fontSize: 14 }}>Dataset: {d.dataset}</Text>
            <Text style={{ margin: "4px 0", fontSize: 14 }}>Format: {d.format}</Text>
            {!failed && <Text style={{ margin: "4px 0", fontSize: 14 }}>Rows: {String(d.rows ?? 0)}</Text>}
            {failed && d.error ? <Text style={{ margin: "4px 0", fontSize: 14, color: "#b42318" }}>Reason: {d.error}</Text> : null}
          </Section>
          <Section style={{ marginTop: 16 }}>
            <Link href={d.jobsUrl} style={{ fontSize: 14, color: "#0b6bcb" }}>
              Open the export jobs page
            </Link>
          </Section>
          <Text style={{ marginTop: 20, fontSize: 12, color: "#667085" }}>
            Download links are single use and expire five minutes after you create them.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const template: TemplateEntry = {
  component: ExportJobStatusEmail,
  displayName: "Security export status",
  subject: (data) => (data['status'] === "failed" ? "Security export failed" : "Your security export is ready"),
  previewData: {
    dataset: "security_findings",
    format: "CSV",
    status: "complete",
    rows: 128,
    jobsUrl: "https://harmony-forge-nexus.lovable.app/app/admin/security-exports",
  },
};
