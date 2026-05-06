import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const FilterInput = z.object({
  from: z.string().datetime().nullable().optional(),
  to: z.string().datetime().nullable().optional(),
  entity: z.string().max(80).nullable().optional(),
  action: z.string().max(120).nullable().optional(),
  actorEmail: z.string().max(120).nullable().optional(),
  page: z.number().int().min(0).max(1000).default(0),
  pageSize: z.number().int().min(10).max(200).default(50),
  forExport: z.boolean().default(false),
});

export const listAuditEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => FilterInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { items: [], total: 0, error: "Forbidden" };

    let actorIds: string[] | null = null;
    if (data.actorEmail?.trim()) {
      const { data: profs } = await supabaseAdmin.from("profiles").select("id").ilike("email", `%${data.actorEmail}%`).limit(200);
      actorIds = (profs ?? []).map((p) => p.id);
      if (actorIds.length === 0) return { items: [], total: 0, error: null };
    }

    const limit = data.forExport ? 5000 : data.pageSize;
    const offset = data.forExport ? 0 : data.page * data.pageSize;

    let q = supabaseAdmin.from("audit_events").select("id, created_at, actor_id, entity, entity_id, action, meta", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (data.from) q = q.gte("created_at", data.from);
    if (data.to) q = q.lte("created_at", data.to);
    if (data.entity) q = q.eq("entity", data.entity);
    if (data.action) q = q.eq("action", data.action);
    if (actorIds) q = q.in("actor_id", actorIds);
    const { data: rows, count, error } = await q;
    if (error) return { items: [], total: 0, error: error.message };

    const ids = Array.from(new Set((rows ?? []).map((r) => r.actor_id).filter(Boolean))) as string[];
    const { data: profiles } = await supabaseAdmin.from("profiles").select("id, email, full_name").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

    if (data.forExport) {
      await supabaseAdmin.from("audit_events").insert({ actor_id: context.userId, action: "audit.exported", entity: "audit_events", entity_id: null, meta: { count: rows?.length ?? 0, filters: { from: data.from, to: data.to, entity: data.entity, action: data.action } } });
    }

    return {
      items: (rows ?? []).map((r) => ({ ...r, actor: r.actor_id ? byId.get(r.actor_id) ?? null : null })),
      total: count ?? 0,
      error: null as string | null,
    };
  });

export const distinctAuditFacets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { entities: [], actions: [] };
    const { data } = await supabaseAdmin.from("audit_events").select("entity, action").limit(2000);
    const entities = Array.from(new Set((data ?? []).map((r) => r.entity))).sort();
    const actions = Array.from(new Set((data ?? []).map((r) => r.action))).sort();
    return { entities, actions };
  });
