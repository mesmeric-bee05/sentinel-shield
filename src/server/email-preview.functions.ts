import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import * as React from "react";
import { render } from "@react-email/render";
import { TEMPLATES } from "@/lib/email-templates/registry";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  templateName: z.string().min(1).max(100),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const renderEmailPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) return { error: "Forbidden" as const };

    const entry = TEMPLATES[data.templateName];
    if (!entry) return { error: "Unknown template" as const };

    const props = (data.data ?? entry.previewData ?? {}) as Record<string, unknown>;
    const element = React.createElement(entry.component, props);
    const html = await render(element);
    const text = await render(element, { plainText: true });
    const subject = typeof entry.subject === "function" ? entry.subject(props) : entry.subject;

    return {
      html,
      text,
      subject,
      displayName: entry.displayName ?? data.templateName,
      previewData: entry.previewData ?? {},
    };
  });

export const listEmailTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) return { error: "Forbidden" as const, templates: [] };
    return {
      templates: Object.entries(TEMPLATES).map(([name, t]) => ({
        name,
        displayName: t.displayName ?? name,
        previewData: t.previewData ?? {},
      })),
    };
  });
