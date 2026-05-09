import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { haversineMeters } from "@/lib/geo/providers.server";

// ---------- Roster ----------
export const listChwWorkers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    const q = isAdmin
      ? supabaseAdmin.from("chw_workers").select("*").order("created_at", { ascending: false })
      : supabaseAdmin.from("chw_workers").select("*").eq("user_id", context.userId);
    const { data, error } = await q;
    return { workers: data ?? [], error: error?.message ?? null, isAdmin: !!isAdmin };
  });

export const ChwWorkerInput = z.object({
  id: z.string().uuid().optional().nullable(),
  user_id: z.string().uuid(),
  display_name: z.string().min(2).max(120),
  languages: z.array(z.string().min(2).max(8)).default(["en"]),
  skills: z.array(z.string().min(2).max(40)).default([]),
  base_lat: z.number().min(-90).max(90).optional().nullable(),
  base_lng: z.number().min(-180).max(180).optional().nullable(),
  is_active: z.boolean().default(true),
});
export type ChwWorkerInputT = z.input<typeof ChwWorkerInput>;

export const upsertChwWorker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ChwWorkerInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { ok: false, error: "forbidden" };
    const { id, ...rest } = data;
    const payload = { ...rest, base_lat: rest.base_lat ?? null, base_lng: rest.base_lng ?? null };
    const { error } = id
      ? await supabaseAdmin.from("chw_workers").update(payload).eq("id", id)
      : await supabaseAdmin.from("chw_workers").insert(payload);
    return { ok: !error, error: error?.message ?? null };
  });

// ---------- Assignments ----------
export const listAssignments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      status: z.string().optional().nullable(),
      onlyMine: z.boolean().default(false),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = supabaseAdmin
      .from("chw_assignments")
      .select("*, chw:chw_workers(display_name, user_id)")
      .order("due_at", { ascending: true })
      .limit(200);
    if (data.status) q = q.eq("status", data.status as "pending");
    if (data.onlyMine) {
      const { data: me } = await supabaseAdmin.from("chw_workers").select("id").eq("user_id", context.userId).maybeSingle();
      if (!me) return { assignments: [], error: null as string | null };
      q = q.eq("chw_id", me.id);
    }
    const { data: rows, error } = await q;
    return { assignments: rows ?? [], error: error?.message ?? null };
  });

export const DispatchInput = z.object({
  patient_id: z.string().uuid(),
  task_type: z.enum(["home_visit", "medication_check", "wellness_call", "transport", "education", "triage_followup"]),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  due_at: z.string().datetime().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  patient_lat: z.number().min(-90).max(90).optional().nullable(),
  patient_lng: z.number().min(-180).max(180).optional().nullable(),
  preferred_chw_id: z.string().uuid().optional().nullable(),
});
export type DispatchInputT = z.input<typeof DispatchInput>;

export const StatusUpdateInput = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "accepted", "in_progress", "completed", "cancelled", "escalated"]),
  notes: z.string().max(2000).optional().nullable(),
  geo_lat: z.number().min(-90).max(90).optional().nullable(),
  geo_lng: z.number().min(-180).max(180).optional().nullable(),
});
export type StatusUpdateInputT = z.input<typeof StatusUpdateInput>;

export const dispatchAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => DispatchInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    const { data: isProv } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "provider" });
    if (!isAdmin && !isProv) return { ok: false, error: "forbidden", assignment: null };

    // Auto-route: pick nearest active CHW if none preferred and we have coords.
    let chwId = data.preferred_chw_id ?? null;
    if (!chwId && data.patient_lat != null && data.patient_lng != null) {
      const { data: workers } = await supabaseAdmin
        .from("chw_workers")
        .select("id, base_lat, base_lng")
        .eq("is_active", true)
        .not("base_lat", "is", null)
        .not("base_lng", "is", null);
      const ranked = (workers ?? [])
        .map((w: { id: string; base_lat: number | null; base_lng: number | null }) => ({
          id: w.id,
          dist: haversineMeters(
            { lat: w.base_lat as number, lng: w.base_lng as number },
            { lat: data.patient_lat as number, lng: data.patient_lng as number },
          ),
        }))
        .sort((a, b) => a.dist - b.dist);
      chwId = ranked[0]?.id ?? null;
    }

    const { data: row, error } = await supabaseAdmin
      .from("chw_assignments")
      .insert({
        chw_id: chwId,
        patient_id: data.patient_id,
        task_type: data.task_type,
        priority: data.priority,
        due_at: data.due_at ?? new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        notes: data.notes ?? null,
        patient_lat: data.patient_lat ?? null,
        patient_lng: data.patient_lng ?? null,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error || !row) return { ok: false, error: error?.message ?? "insert failed", assignment: null };

    await supabaseAdmin.from("audit_events").insert({
      actor_id: context.userId, action: "chw.dispatched", entity: "chw_assignments", entity_id: row.id,
      meta: { chw_id: chwId, task_type: data.task_type, priority: data.priority },
    });

    // Stubbed external notification (Twilio/SMS or push). Real wiring lives behind connector + worker app.
    return { ok: true, error: null as string | null, assignment: row };
  });

export const updateAssignmentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => StatusUpdateInput.parse(d))
  .handler(async ({ data, context }) => {
    // Confirm caller owns the assignment (CHW) or is admin.
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    const { data: assignment } = await supabaseAdmin
      .from("chw_assignments").select("id, chw_id").eq("id", data.id).maybeSingle();
    if (!assignment) return { ok: false, error: "not_found" };

    let chwId: string | null = null;
    if (!isAdmin) {
      const { data: me } = await supabaseAdmin.from("chw_workers").select("id").eq("user_id", context.userId).maybeSingle();
      if (!me || me.id !== assignment.chw_id) return { ok: false, error: "forbidden" };
      chwId = me.id;
    } else {
      chwId = assignment.chw_id as string | null;
    }

    const { error: upErr } = await supabaseAdmin
      .from("chw_assignments").update({ status: data.status }).eq("id", data.id);
    if (upErr) return { ok: false, error: upErr.message };

    if (chwId) {
      await supabaseAdmin.from("chw_check_ins").insert({
        assignment_id: data.id, chw_id: chwId, status: data.status,
        notes: data.notes ?? null, geo_lat: data.geo_lat ?? null, geo_lng: data.geo_lng ?? null,
      });
    }
    await supabaseAdmin.from("audit_events").insert({
      actor_id: context.userId, action: `chw.${data.status}`, entity: "chw_assignments", entity_id: data.id,
      meta: { has_geo: data.geo_lat != null },
    });
    return { ok: true, error: null as string | null };
  });
