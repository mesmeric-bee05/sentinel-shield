import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { estimateTravel, haversineMeters, type LatLng } from "@/lib/geo/providers.server";

export const listFacilities = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({
      near: z.object({ lat: z.number(), lng: z.number() }).optional().nullable(),
      radiusKm: z.number().min(0.5).max(500).default(25),
      facilityType: z.string().optional().nullable(),
      limit: z.number().int().min(1).max(200).default(50),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    let q = supabaseAdmin.from("care_facilities").select("*").eq("is_active", true).limit(data.limit);
    if (data.facilityType) q = q.eq("facility_type", data.facilityType);
    const { data: rows, error } = await q;
    if (error) return { facilities: [], error: error.message };
    let facilities = rows ?? [];
    if (data.near) {
      const near = data.near;
      facilities = facilities
        .map((f: { latitude: number; longitude: number }) => ({
          ...f,
          distance_km: haversineMeters({ lat: f.latitude, lng: f.longitude }, near) / 1000,
        }))
        .filter((f: { distance_km: number }) => f.distance_km <= data.radiusKm)
        .sort((a: { distance_km: number }, b: { distance_km: number }) => a.distance_km - b.distance_km);
    }
    return { facilities, error: null as string | null };
  });

export const getTravelEstimate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      origin: z.object({ lat: z.number(), lng: z.number() }),
      destination: z.object({ lat: z.number(), lng: z.number() }),
      mode: z.enum(["driving", "walking", "transit"]).default("driving"),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const o: LatLng = data.origin, d: LatLng = data.destination;
    const est = await estimateTravel(o, d, data.mode);
    return { estimate: est };
  });

export const upsertFacility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid().optional().nullable(),
      name: z.string().min(2).max(200),
      facility_type: z.enum(["clinic", "hospital", "pharmacy", "urgent_care", "lab", "community_center"]),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      address: z.string().max(500).optional().nullable(),
      phone: z.string().max(40).optional().nullable(),
      hours: z.string().max(200).optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) return { ok: false, error: "forbidden" };
    const { error } = data.id
      ? await supabaseAdmin.from("care_facilities").update(data).eq("id", data.id)
      : await supabaseAdmin.from("care_facilities").insert(data);
    return { ok: !error, error: error?.message ?? null };
  });
