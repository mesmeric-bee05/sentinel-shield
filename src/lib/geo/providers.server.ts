// Geo provider adapters: Mapbox + HERE + deterministic stub fallback.
// Server-only — never import from client bundles.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type LatLng = { lat: number; lng: number };
export type TravelMode = "driving" | "walking" | "transit";
export type TravelEstimate = {
  durationSeconds: number;
  distanceMeters: number;
  provider: "mapbox" | "here" | "stub";
  cached: boolean;
};

const R_EARTH_M = 6_371_000;
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.sqrt(s));
}

function stubEstimate(o: LatLng, d: LatLng, mode: TravelMode): TravelEstimate {
  const meters = Math.max(50, Math.round(haversineMeters(o, d)));
  // Rough average speeds (m/s): driving 12, transit 8, walking 1.4
  const speed = mode === "walking" ? 1.4 : mode === "transit" ? 8 : 12;
  return {
    durationSeconds: Math.round(meters / speed),
    distanceMeters: meters,
    provider: "stub",
    cached: false,
  };
}

async function mapboxEstimate(o: LatLng, d: LatLng, mode: TravelMode): Promise<TravelEstimate | null> {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) return null;
  const profile = mode === "walking" ? "walking" : mode === "transit" ? "driving" : "driving";
  const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${o.lng},${o.lat};${d.lng},${d.lat}?access_token=${token}&overview=false`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = (await res.json()) as { routes?: Array<{ duration: number; distance: number }> };
    const r = j.routes?.[0];
    if (!r) return null;
    return { durationSeconds: Math.round(r.duration), distanceMeters: Math.round(r.distance), provider: "mapbox", cached: false };
  } catch {
    return null;
  }
}

async function hereEstimate(o: LatLng, d: LatLng, mode: TravelMode): Promise<TravelEstimate | null> {
  const apiKey = process.env.HERE_API_KEY;
  if (!apiKey) return null;
  const transport = mode === "walking" ? "pedestrian" : mode === "transit" ? "publicTransport" : "car";
  const url = `https://router.hereapi.com/v8/routes?transportMode=${transport}&origin=${o.lat},${o.lng}&destination=${d.lat},${d.lng}&return=summary&apiKey=${apiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = (await res.json()) as { routes?: Array<{ sections?: Array<{ summary?: { duration: number; length: number } }> }> };
    const s = j.routes?.[0]?.sections?.[0]?.summary;
    if (!s) return null;
    return { durationSeconds: Math.round(s.duration), distanceMeters: Math.round(s.length), provider: "here", cached: false };
  } catch {
    return null;
  }
}

export async function estimateTravel(o: LatLng, d: LatLng, mode: TravelMode = "driving"): Promise<TravelEstimate> {
  // Cache: round to 4 decimals (~11m) so identical lookups hit
  const r = (n: number) => Math.round(n * 10_000) / 10_000;
  const ol = r(o.lat), og = r(o.lng), dl = r(d.lat), dg = r(d.lng);

  const { data: cached } = await supabaseAdmin
    .from("travel_time_cache")
    .select("duration_seconds, distance_meters, provider, computed_at")
    .eq("origin_lat", ol).eq("origin_lng", og)
    .eq("dest_lat", dl).eq("dest_lng", dg)
    .eq("mode", mode)
    .gt("computed_at", new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString())
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cached) {
    return {
      durationSeconds: cached.duration_seconds,
      distanceMeters: cached.distance_meters,
      provider: cached.provider as TravelEstimate["provider"],
      cached: true,
    };
  }

  const est =
    (await mapboxEstimate({ lat: ol, lng: og }, { lat: dl, lng: dg }, mode)) ??
    (await hereEstimate({ lat: ol, lng: og }, { lat: dl, lng: dg }, mode)) ??
    stubEstimate({ lat: ol, lng: og }, { lat: dl, lng: dg }, mode);

  await supabaseAdmin.from("travel_time_cache").insert({
    origin_lat: ol, origin_lng: og, dest_lat: dl, dest_lng: dg,
    mode, provider: est.provider,
    duration_seconds: est.durationSeconds, distance_meters: est.distanceMeters,
  });
  return est;
}
