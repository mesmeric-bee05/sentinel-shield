// Saved filter presets for the security export audit panel.
// Presets are per-admin; `is_shared` publishes one to every admin (read-only
// for non-owners — RLS restricts UPDATE/DELETE to the owner).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = { from: (t: string) => any };

export type ExportFilterPreset = {
  id: string;
  owner_id: string;
  name: string;
  dataset: string | null;
  actor_filter: string | null;
  status_filter: string | null;
  search: string | null;
  scan_window_from: string | null;
  scan_window_to: string | null;
  date_from: string | null;
  date_to: string | null;
  is_shared: boolean;
  created_at: string;
};

const PRESET_COLS =
  "id, owner_id, name, dataset, actor_filter, status_filter, search, scan_window_from, scan_window_to, date_from, date_to, is_shared, created_at";

async function isAdmin(context: { supabase: { rpc: (n: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown }> }; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  return data === true;
}

async function db(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Db;
}

/** Presets visible to the caller: their own plus any shared preset. */
export const listExportFilterPresets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ error: string | null; presets: ExportFilterPreset[] }> => {
    if (!(await isAdmin(context as never))) return { error: "Forbidden", presets: [] };
    const client = await db();
    const { data, error } = await client
      .from("security_export_filter_presets")
      .select(PRESET_COLS)
      .or(`owner_id.eq.${context.userId},is_shared.eq.true`)
      .order("name", { ascending: true });
    return { error: error?.message ?? null, presets: (data ?? []) as ExportFilterPreset[] };
  });

const SavePresetInput = z.object({
  id: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(80),
  dataset: z.string().max(80).optional().nullable(),
  actor_filter: z.string().max(120).optional().nullable(),
  status_filter: z.string().max(80).optional().nullable(),
  search: z.string().max(200).optional().nullable(),
  scan_window_from: z.string().max(40).optional().nullable(),
  scan_window_to: z.string().max(40).optional().nullable(),
  date_from: z.string().max(40).optional().nullable(),
  date_to: z.string().max(40).optional().nullable(),
  is_shared: z.boolean().default(false),
});

/** Create or update (upsert by owner+name) a preset owned by the caller. */
export const saveExportFilterPreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SavePresetInput.parse(d))
  .handler(async ({ data, context }): Promise<{ error: string | null; preset: ExportFilterPreset | null }> => {
    if (!(await isAdmin(context as never))) return { error: "Forbidden", preset: null };
    const client = await db();
    const values = {
      owner_id: context.userId,
      name: data.name.trim(),
      dataset: data.dataset || null,
      actor_filter: data.actor_filter || null,
      status_filter: data.status_filter || null,
      search: data.search || null,
      scan_window_from: data.scan_window_from || null,
      scan_window_to: data.scan_window_to || null,
      date_from: data.date_from || null,
      date_to: data.date_to || null,
      is_shared: data.is_shared,
    };

    if (data.id) {
      // Ownership is re-checked server-side; a non-owner cannot patch a shared preset.
      const { data: row, error } = await client
        .from("security_export_filter_presets")
        .update(values)
        .eq("id", data.id)
        .eq("owner_id", context.userId)
        .select(PRESET_COLS)
        .maybeSingle();
      if (error) return { error: error.message, preset: null };
      if (!row) return { error: "Preset not found or not yours", preset: null };
      return { error: null, preset: row as ExportFilterPreset };
    }

    const { data: row, error } = await client
      .from("security_export_filter_presets")
      .upsert(values, { onConflict: "owner_id,name" })
      .select(PRESET_COLS)
      .maybeSingle();
    if (error) return { error: error.message, preset: null };
    return { error: null, preset: (row ?? null) as ExportFilterPreset | null };
  });

/** Delete one of the caller's own presets. */
export const deleteExportFilterPreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ error: string | null; deleted: boolean }> => {
    if (!(await isAdmin(context as never))) return { error: "Forbidden", deleted: false };
    const client = await db();
    const { data: rows, error } = await client
      .from("security_export_filter_presets")
      .delete()
      .eq("id", data.id)
      .eq("owner_id", context.userId)
      .select("id");
    if (error) return { error: error.message, deleted: false };
    return { error: null, deleted: (rows ?? []).length > 0 };
  });
