import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const LOVABLE_AI = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

async function callAI(body: unknown) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("AI gateway not configured");
  const res = await fetch(LOVABLE_AI, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 429) throw new Error("AI is busy right now — please retry in a moment.");
  if (res.status === 402) throw new Error("AI usage limit reached. Add credits in Workspace settings.");
  if (!res.ok) throw new Error(`AI error ${res.status}`);
  return res.json();
}

const SuggestInput = z.object({
  query: z.string().min(3).max(500),
  specialty: z.string().max(80).optional(),
});

export const suggestSlots = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SuggestInput.parse(d))
  .handler(async ({ data }) => {
    try {
      const json = await callAI({
        model: MODEL,
        messages: [
          { role: "system", content: "You are an AI scheduling assistant for ApexCare AI. Given a patient's natural-language scheduling request, propose 3 candidate appointment windows. Use realistic near-future dates within the next 14 days during weekday business hours. Be concise and explain why each slot fits." },
          { role: "user", content: `Patient request: "${data.query}"${data.specialty ? `\nSpecialty context: ${data.specialty}` : ""}\nReturn 3 suggestions.` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "propose_slots",
            description: "Propose 3 ranked appointment slots.",
            parameters: {
              type: "object",
              properties: {
                slots: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string", description: "Human readable slot e.g. 'Tue Mar 12, 9:30 AM'" },
                      iso: { type: "string", description: "ISO 8601 datetime" },
                      reason: { type: "string", description: "Why this slot is a great match (1 sentence)" },
                      score: { type: "number", description: "0-1 fit score" },
                    },
                    required: ["label", "iso", "reason", "score"],
                  },
                },
              },
              required: ["slots"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "propose_slots" } },
      });
      const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      const parsed = args ? JSON.parse(args) : { slots: [] };
      return { slots: parsed.slots ?? [], error: null as string | null };
    } catch (e) {
      return { slots: [], error: e instanceof Error ? e.message : "AI unavailable" };
    }
  });

const SummaryInput = z.object({ reason: z.string().min(3).max(2000) });
export const summarizeIntake = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SummaryInput.parse(d))
  .handler(async ({ data }) => {
    try {
      const json = await callAI({
        model: MODEL,
        messages: [
          { role: "system", content: "You are a clinical assistant. Convert a patient's free-text reason for visit into a 1-2 sentence professional clinical summary suitable for a provider's pre-visit card. Do not diagnose. Stay neutral." },
          { role: "user", content: data.reason },
        ],
      });
      const text = json.choices?.[0]?.message?.content ?? "";
      return { summary: text.trim(), error: null as string | null };
    } catch (e) {
      return { summary: "", error: e instanceof Error ? e.message : "AI unavailable" };
    }
  });

const ScribeInput = z.object({ transcript: z.string().min(3).max(8000) });
export const scribeDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ScribeInput.parse(d))
  .handler(async ({ data }) => {
    try {
      const json = await callAI({
        model: MODEL,
        messages: [
          { role: "system", content: "You are an ambient clinical scribe. Convert a consultation transcript into a SOAP note (Subjective, Objective, Assessment, Plan). Use clear clinical language. Mark uncertainty with '[verify]'. Output as Markdown with the four headings." },
          { role: "user", content: data.transcript },
        ],
      });
      const text = json.choices?.[0]?.message?.content ?? "";
      return { note: text, error: null as string | null };
    } catch (e) {
      return { note: "", error: e instanceof Error ? e.message : "AI unavailable" };
    }
  });
