import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "search_providers",
  title: "Search providers",
  description: "Find active care providers by specialty or name.",
  inputSchema: {
    query: z.string().max(80).optional().describe("Specialty or name to match."),
    telemedicine_only: z.boolean().optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, telemedicine_only }, ctx) => {
    const sb = supabaseForUser(ctx);
    let q = sb
      .from("providers")
      .select("id, display_name, specialty, location, rating, telemedicine_enabled, years_experience")
      .eq("is_active", true)
      .limit(25);
    if (query) {
      const s = query.replace(/[%,()]/g, "");
      q = q.or(`specialty.ilike.%${s}%,display_name.ilike.%${s}%`);
    }
    if (telemedicine_only) q = q.eq("telemedicine_enabled", true);
    const { data, error } = await q;
    if (error) throw new ToolError(error.message);
    const providers = (data ?? []).map((p) => ({
      id: String(p.id), name: String(p.display_name), specialty: String(p.specialty),
      location: p.location ? String(p.location) : null, rating: p.rating == null ? null : Number(p.rating),
      telemedicine: Boolean(p.telemedicine_enabled),
    }));
    return { content: [{ type: "text", text: JSON.stringify(providers) }], structuredContent: { providers } };
  },
});
