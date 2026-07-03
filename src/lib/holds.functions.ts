import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const holdSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    providerId: z.string().uuid(),
    startsAtIso: z.string().datetime(),
    durationMinutes: z.number().int().min(15).max(120).default(30),
    ttlSeconds: z.number().int().min(60).max(600).default(180),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const start = new Date(data.startsAtIso);
    const end = new Date(start.getTime() + data.durationMinutes * 60_000);
    const { data: r, error } = await context.supabase.rpc("acquire_slot_hold", {
      _provider_id: data.providerId,
      _starts_at: start.toISOString(),
      _ends_at: end.toISOString(),
      _ttl_seconds: data.ttlSeconds,
    });
    if (error) return { ok: false, reason: error.message, holdId: null, expiresAt: null };
    const result = r as { ok: boolean; reason?: string; hold_id?: string; expires_at?: string };
    return {
      ok: result.ok,
      reason: result.reason ?? null,
      holdId: result.hold_id ?? null,
      expiresAt: result.expires_at ?? null,
    };
  });

export const releaseSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ holdId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: ok, error } = await context.supabase.rpc("release_slot_hold", { _hold_id: data.holdId });
    return { ok: !!ok && !error };
  });
