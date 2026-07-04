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
    // Authorization: only admin, provider, or CHW workers can list non-own assignments.
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    const { data: isProv } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "provider" });
    const { data: meWorker } = await supabaseAdmin
      .from("chw_workers").select("id").eq("user_id", context.userId).maybeSingle();
    const isChw = !!meWorker;

    if (!data.onlyMine && !isAdmin && !isProv && !isChw) {
      return { assignments: [], error: "forbidden" as const };
    }

    let q = supabaseAdmin
      .from("chw_assignments")
      .select("*, chw:chw_workers(display_name, user_id)")
      .order("due_at", { ascending: true })
      .limit(200);
    if (data.status) q = q.eq("status", data.status as "pending");
    if (data.onlyMine) {
      if (!meWorker) return { assignments: [], error: null as string | null };
      q = q.eq("chw_id", meWorker.id);
    } else if (isProv && !isAdmin) {
      // Scope providers to assignments for patients they actually treat (via appointments).
      const { data: prov } = await supabaseAdmin
        .from("providers").select("id").eq("user_id", context.userId).maybeSingle();
      if (!prov) return { assignments: [], error: null as string | null };
      const { data: appts } = await supabaseAdmin
        .from("appointments").select("patient_id").eq("provider_id", prov.id);
      const patientIds = Array.from(new Set((appts ?? []).map((a) => a.patient_id)));
      if (patientIds.length === 0) return { assignments: [], error: null as string | null };
      q = q.in("patient_id", patientIds);
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

// ---------- Admin queue view ----------
export const listAdminQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      status: z.string().optional().nullable(),
      stuckOnly: z.boolean().default(false),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { error: "Forbidden" as const, rows: [], counts: {}, buckets: { stuck: 0, failed: 0, breached: 0 } };

    let q = supabaseAdmin
      .from("chw_assignments")
      .select("id, task_type, priority, status, due_at, created_at, retry_count, last_error, last_error_at, chw_id, patient_id, chw:chw_workers(display_name)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.status) q = q.eq("status", data.status as "pending");
    if (data.stuckOnly) {
      const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      q = q.in("status", ["pending", "accepted"]).lt("created_at", cutoff);
    }
    const { data: rows, error } = await q;
    if (error) return { error: error.message, rows: [], counts: {}, buckets: { stuck: 0, failed: 0, breached: 0 } };

    const now = Date.now();
    // Stuck buckets:
    //  - pending/accepted > 30m
    //  - in_progress > 2h
    //  - any row with a last_error (failed/cancelled/escalated counted separately)
    const isStuckPending = (r: { status: string; created_at: string }) =>
      (r.status === "pending" || r.status === "accepted") && now - new Date(r.created_at).getTime() > 30 * 60 * 1000;
    const isStuckProgress = (r: { status: string; created_at: string }) =>
      r.status === "in_progress" && now - new Date(r.created_at).getTime() > 2 * 60 * 60 * 1000;
    const isFailed = (r: { status: string; last_error: string | null }) =>
      r.status === "cancelled" || r.status === "escalated" || !!r.last_error;
    const isBreached = (r: { due_at: string | null; status: string }) =>
      !!r.due_at && now > new Date(r.due_at).getTime() && r.status !== "completed";

    const counts: Record<string, number> = {};
    let stuck = 0, failed = 0, breached = 0;
    for (const r of rows ?? []) {
      counts[r.status] = (counts[r.status] ?? 0) + 1;
      if (isStuckPending(r) || isStuckProgress(r)) stuck++;
      if (isFailed(r)) failed++;
      if (isBreached(r)) breached++;
    }
    return {
      error: null as string | null,
      rows: rows ?? [],
      counts,
      buckets: { stuck, failed, breached },
    };
  });

// Bulk re-run: only operates on assignments that have failed (cancelled,
// escalated, or carry a last_error). Safe to invoke from the admin queue
// "Re-run failed" action — never touches in-flight or completed work.
export const requeueFailed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      ids: z.array(z.string().uuid()).max(200).optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { ok: false, error: "forbidden" as const, requeued: 0 };

    let q = supabaseAdmin
      .from("chw_assignments")
      .select("id, retry_count, status, last_error");
    if (data.ids && data.ids.length > 0) q = q.in("id", data.ids);
    const { data: candidates, error } = await q;
    if (error) return { ok: false, error: error.message, requeued: 0 };

    const eligible = (candidates ?? []).filter(
      (r) => r.status === "cancelled" || r.status === "escalated" || !!r.last_error,
    );
    if (eligible.length === 0) return { ok: true, error: null as string | null, requeued: 0 };

    const dueAt = new Date(Date.now() + 4 * 3600 * 1000).toISOString();
    let requeued = 0;
    for (const row of eligible) {
      const newRetry = (row.retry_count ?? 0) + 1;
      const { error: upErr } = await supabaseAdmin
        .from("chw_assignments")
        .update({
          status: "pending",
          retry_count: newRetry,
          last_error: null,
          last_error_at: null,
          due_at: dueAt,
        })
        .eq("id", row.id);
      if (!upErr) {
        requeued++;
        const scope = data.ids?.length ? "ids" : "all_failed";
        await supabaseAdmin.from("audit_events").insert({
          actor_id: context.userId,
          action: "chw.requeued_bulk",
          entity: "chw_assignments",
          entity_id: row.id,
          meta: { previous_status: row.status, retry_count: newRetry, scope },
        });
        await supabaseAdmin.from("chw_requeue_log").insert({
          assignment_id: row.id,
          previous_status: row.status,
          retry_count: newRetry,
          actor_id: context.userId,
          scope,
        });
      }
    }
    return { ok: true, error: null as string | null, requeued };
  });


export const requeueAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { ok: false, error: "forbidden" as const };

    const { data: row } = await supabaseAdmin
      .from("chw_assignments")
      .select("id, retry_count, status")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) return { ok: false, error: "not_found" as const };

    const newRetry = (row.retry_count ?? 0) + 1;
    const { error } = await supabaseAdmin
      .from("chw_assignments")
      .update({
        status: "pending",
        retry_count: newRetry,
        last_error: null,
        last_error_at: null,
        due_at: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
      })
      .eq("id", data.id);
    if (error) return { ok: false, error: error.message };

    await supabaseAdmin.from("audit_events").insert({
      actor_id: context.userId,
      action: "chw.requeued",
      entity: "chw_assignments",
      entity_id: data.id,
      meta: { previous_status: row.status, retry_count: newRetry },
    });
    await supabaseAdmin.from("chw_requeue_log").insert({
      assignment_id: data.id,
      previous_status: row.status,
      retry_count: newRetry,
      actor_id: context.userId,
      scope: "single",
    });
    return { ok: true, error: null as string | null, retry_count: newRetry };
  });

// ---------- Requeue log ----------
export const listRequeueLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      scope: z.enum(["single", "ids", "all_failed"]).optional().nullable(),
      limit: z.number().int().min(1).max(1000).default(500),
    }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { error: "Forbidden" as const, rows: [] };

    let q = supabaseAdmin
      .from("chw_requeue_log")
      .select("id, created_at, assignment_id, previous_status, retry_count, actor_id, scope, assignment:chw_assignments(task_type, status)")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.scope) q = q.eq("scope", data.scope);
    const { data: rows, error } = await q;
    if (error) return { error: error.message, rows: [] };

    const actorIds = Array.from(new Set((rows ?? []).map((r) => r.actor_id).filter((x): x is string => !!x)));
    let actorMap: Record<string, string> = {};
    if (actorIds.length > 0) {
      const { data: profs } = await supabaseAdmin
        .from("profiles").select("id, email").in("id", actorIds);
      actorMap = Object.fromEntries((profs ?? []).map((p) => [p.id, p.email ?? ""]));
    }
    const enriched = (rows ?? []).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      assignment_id: r.assignment_id,
      previous_status: r.previous_status,
      retry_count: r.retry_count,
      scope: r.scope,
      actor_id: r.actor_id,
      actor_email: r.actor_id ? actorMap[r.actor_id] ?? "" : "",
      task_type: (r as { assignment?: { task_type?: string | null } }).assignment?.task_type ?? "",
      current_status: (r as { assignment?: { status?: string | null } }).assignment?.status ?? "",
    }));
    return { error: null as string | null, rows: enriched };
  });
