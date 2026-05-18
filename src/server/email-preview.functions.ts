import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import * as React from "react";
import { render } from "@react-email/render";
import { TEMPLATES } from "@/lib/email-templates/registry";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Json = string | number | boolean | null | { [k: string]: Json } | Json[];
const JsonObj = z.record(z.string(), z.unknown());

const Input = z.object({
  templateName: z.string().min(1).max(100),
  data: JsonObj.optional(),
});

export const renderEmailPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => Input.parse(d))
  .handler(async ({ data, context }): Promise<{ error?: string; html?: string; text?: string; subject?: string; displayName?: string; previewData?: Record<string, Json> }> => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) return { error: "Forbidden" };

    const entry = TEMPLATES[data.templateName];
    if (!entry) return { error: "Unknown template" };

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
      previewData: (entry.previewData ?? {}) as Record<string, Json>,
    };
  });

export const listEmailTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ error?: string; templates: Array<{ name: string; displayName: string; previewData: Record<string, Json> }> }> => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) return { error: "Forbidden", templates: [] };
    return {
      templates: Object.entries(TEMPLATES).map(([name, t]) => ({
        name,
        displayName: t.displayName ?? name,
        previewData: (t.previewData ?? {}) as Record<string, Json>,
      })),
    };
  });
