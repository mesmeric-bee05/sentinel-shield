import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const NOTIFICATION_ACTIONS = [
  "email.sent", "email.queued", "email.skipped", "email.failed",
  "sms.sent", "sms.skipped", "sms.failed",
] as const;

const FilterInput = z.object({
  from: z.string().datetime().nullable().optional(),
  to: z.string().datetime().nullable().optional(),
  channel: z.enum(["email", "sms", "all"]).default("all"),
  status: z.enum(["sent", "queued", "skipped", "failed", "all"]).default("all"),
  recipientEmail: z.string().max(120).nullable().optional(),
  appointmentId: z.string().uuid().nullable().optional(),
  page: z.number().int().min(0).max(1000).default(0),
  pageSize: z.number().int().min(10).max(200).default(50),
  forExport: z.boolean().default(false),
});

type EventRow = {
  id: string; created_at: string; actor_id: string | null;
  entity: string; entity_id: string | null; action: string;
  meta: Record<string, unknown> | null;
};

export const listNotificationEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => FilterInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { items: [], total: 0, error: "Forbidden" as const };

    // Build action filter
    let actions = [...NOTIFICATION_ACTIONS] as string[];
    if (data.channel !== "all") actions = actions.filter((a) => a.startsWith(`${data.channel}.`));
    if (data.status !== "all") actions = actions.filter((a) => a.endsWith(`.${data.status}`));
    if (actions.length === 0) return { items: [], total: 0, error: null };

    // Optional recipient filter — resolve email → patient ids → look up appointments → entity_ids
    let entityFilter: string[] | null = null;
    if (data.recipientEmail?.trim()) {
      const { data: profs } = await supabaseAdmin.from("profiles").select("id").ilike("email", `%${data.recipientEmail.trim()}%`).limit(500);
      const patientIds = (profs ?? []).map((p) => p.id);
      if (patientIds.length === 0) return { items: [], total: 0, error: null };
      const { data: appts } = await supabaseAdmin.from("appointments").select("id").in("patient_id", patientIds).limit(2000);
      entityFilter = (appts ?? []).map((a) => a.id);
      if (entityFilter.length === 0) return { items: [], total: 0, error: null };
    }
    if (data.appointmentId) {
      entityFilter = entityFilter ? entityFilter.filter((id) => id === data.appointmentId) : [data.appointmentId];
      if (entityFilter.length === 0) return { items: [], total: 0, error: null };
    }

    const limit = data.forExport ? 5000 : data.pageSize;
    const offset = data.forExport ? 0 : data.page * data.pageSize;

    let q = supabaseAdmin.from("audit_events")
      .select("id, created_at, actor_id, entity, entity_id, action, meta", { count: "exact" })
      .in("action", actions)
      .eq("entity", "appointments")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (data.from) q = q.gte("created_at", data.from);
    if (data.to) q = q.lte("created_at", data.to);
    if (entityFilter) q = q.in("entity_id", entityFilter);

    const { data: rows, count, error } = await q;
    if (error) return { items: [], total: 0, error: error.message };
    const events = (rows ?? []) as EventRow[];

    // Resolve recipient profile (actor is the patient)
    const actorIds = Array.from(new Set(events.map((r) => r.actor_id).filter(Boolean))) as string[];
    const { data: profiles } = await supabaseAdmin.from("profiles")
      .select("id, email, full_name, phone_e164")
      .in("id", actorIds.length ? actorIds : ["00000000-0000-0000-0000-000000000000"]);
    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

    if (data.forExport) {
      await supabaseAdmin.from("audit_events").insert({
        actor_id: context.userId, action: "audit.exported", entity: "audit_events", entity_id: null,
        meta: { kind: "notifications", count: events.length, filters: data },
      });
    }

    return {
      items: events.map((r) => ({
        ...r,
        recipient: r.actor_id ? byId.get(r.actor_id) ?? null : null,
      })),
      total: count ?? 0,
      error: null as string | null,
    };
  });
