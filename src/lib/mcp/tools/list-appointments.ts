import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_my_appointments",
  title: "List my appointments",
  description: "List the signed-in user's appointments, optionally only upcoming ones.",
  inputSchema: {
    upcoming_only: z.boolean().optional().describe("Only return future appointments."),
    limit: z.number().int().min(1).max(50).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ upcoming_only, limit }, ctx) => {
    const sb = supabaseForUser(ctx);
    let q = sb
      .from("appointments")
      .select("id, starts_at, ends_at, status, channel, reason, provider_id")
      .order("starts_at", { ascending: true })
      .limit(limit ?? 20);
    if (upcoming_only) q = q.gte("starts_at", new Date().toISOString());
    const { data, error } = await q;
    if (error) throw new ToolError(error.message);
    const appointments = (data ?? []).map((a) => ({
      id: String(a.id), starts_at: String(a.starts_at), ends_at: String(a.ends_at),
      status: String(a.status), channel: String(a.channel), reason: a.reason ? String(a.reason) : null,
      provider_id: String(a.provider_id),
    }));
    return { content: [{ type: "text", text: JSON.stringify(appointments) }], structuredContent: { appointments } };
  },
});
