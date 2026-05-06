import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RoleEnum = z.enum(["patient", "provider", "admin"]);

// Anyone signed in can request a non-patient role.
export const requestRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ role: z.enum(["provider", "admin"]), justification: z.string().min(10).max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("role_requests")
      .insert({ user_id: context.userId, requested_role: data.role, justification: data.justification });
    if (error) return { ok: false, error: error.message };
    return { ok: true, error: null };
  });

// Bootstrap first admin: SQL fn validates that no admins exist.
export const bootstrapFirstAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("bootstrap_first_admin", { _user_id: context.userId });
    if (error) return { ok: false, error: error.message };
    return { ok: data === true, error: data ? null : "An admin already exists" };
  });

export const getSystemRoleStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("admin_count");
    return { adminCount: (data as number | null) ?? 0 };
  });

// Admin-only: approve/deny a role request via SECURITY DEFINER fn (admin client).
export const decideRoleRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), approve: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    // Verify admin via RLS-safe call before invoking service-role fn.
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { ok: false, error: "Forbidden" };
    const { error } = await supabaseAdmin.rpc("decide_role_request" as never, { _request_id: data.id, _approve: data.approve } as never);
    if (error) return { ok: false, error: error.message };
    return { ok: true, error: null };
  });

export const grantRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid(), role: RoleEnum }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { ok: false, error: "Forbidden" };
    const { error } = await supabaseAdmin.from("user_roles").upsert({ user_id: data.userId, role: data.role }, { onConflict: "user_id,role" });
    if (error) return { ok: false, error: error.message };
    await supabaseAdmin.from("audit_events").insert({ actor_id: context.userId, action: "role.grant", entity: "user_roles", entity_id: data.userId, meta: { role: data.role, via: "admin_console" } });
    return { ok: true, error: null };
  });

export const revokeRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid(), role: RoleEnum }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { ok: false, error: "Forbidden" };
    if (data.role === "admin") {
      const { count } = await supabaseAdmin.from("user_roles").select("*", { count: "exact", head: true }).eq("role", "admin");
      if ((count ?? 0) <= 1) return { ok: false, error: "Cannot remove the last admin" };
    }
    const { error } = await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId).eq("role", data.role);
    if (error) return { ok: false, error: error.message };
    await supabaseAdmin.from("audit_events").insert({ actor_id: context.userId, action: "role.revoke", entity: "user_roles", entity_id: data.userId, meta: { role: data.role } });
    return { ok: true, error: null };
  });

export const listRoleRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { items: [], error: "Forbidden" };
    const { data, error } = await supabaseAdmin
      .from("role_requests")
      .select("id, user_id, requested_role, justification, status, decided_by, decided_at, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return { items: [], error: error.message };
    const userIds = Array.from(new Set((data ?? []).map((r) => r.user_id)));
    const { data: profiles } = await supabaseAdmin.from("profiles").select("id, email, full_name").in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
    return {
      items: (data ?? []).map((r) => ({ ...r, profile: byId.get(r.user_id) ?? null })),
      error: null as string | null,
    };
  });

export const searchUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ q: z.string().max(120) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { items: [], error: "Forbidden" };
    let q = supabaseAdmin.from("profiles").select("id, email, full_name").limit(25);
    if (data.q.trim()) q = q.or(`email.ilike.%${data.q}%,full_name.ilike.%${data.q}%`);
    const { data: profiles, error } = await q;
    if (error) return { items: [], error: error.message };
    const ids = (profiles ?? []).map((p) => p.id);
    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const rolesByUser = new Map<string, string[]>();
    (roles ?? []).forEach((r) => {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role);
      rolesByUser.set(r.user_id, arr);
    });
    return {
      items: (profiles ?? []).map((p) => ({ ...p, roles: rolesByUser.get(p.id) ?? [] })),
      error: null as string | null,
    };
  });
