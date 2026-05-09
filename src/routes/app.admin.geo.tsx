import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { MapPin, Plus, Route as RouteIcon, Loader2, Building2 } from "lucide-react";
import { listFacilities, getTravelEstimate, upsertFacility } from "@/server/geo.functions";
import { PageHeader } from "./app";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/app/admin/geo")({ component: GeoPage });

const FACILITY_TYPES = ["clinic", "hospital", "pharmacy", "urgent_care", "lab", "community_center"] as const;

function GeoPage() {
  const list = useServerFn(listFacilities);
  const travel = useServerFn(getTravelEstimate);
  const upsert = useServerFn(upsertFacility);
  const qc = useQueryClient();

  const [center, setCenter] = useState({ lat: 40.75, lng: -73.99 });
  const [radius, setRadius] = useState(25);
  const [type, setType] = useState<string>("");

  const { data, isLoading } = useQuery({
    queryKey: ["geo-facilities", center.lat, center.lng, radius, type],
    queryFn: () => list({ data: { near: center, radiusKm: radius, facilityType: type || null, limit: 100 } }),
  });

  const facilities = data?.facilities ?? [];

  const [dest, setDest] = useState<{ lat: number; lng: number } | null>(null);
  const [mode, setMode] = useState<"driving" | "walking" | "transit">("driving");
  const travelQuery = useQuery({
    queryKey: ["geo-travel", center.lat, center.lng, dest?.lat, dest?.lng, mode],
    queryFn: () => travel({ data: { origin: center, destination: dest!, mode } }),
    enabled: !!dest,
  });

  const create = useMutation({
    mutationFn: (vals: Parameters<typeof upsert>[0]["data"]) => upsert({ data: vals }),
    onSuccess: (r) => {
      if (r.ok) {
        toast.success("Facility saved");
        qc.invalidateQueries({ queryKey: ["geo-facilities"] });
      } else toast.error(r.error ?? "Failed");
    },
  });

  const provider = useMemo(() => travelQuery.data?.estimate.provider ?? "stub", [travelQuery.data]);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <PageHeader
        title="Geo-Intelligence"
        sub="Facility coverage, distance and travel-time analytics. Mapbox/HERE adapters fall back to a deterministic stub when keys are absent."
        action={<NewFacilityDialog onCreate={(v) => create.mutate(v)} pending={create.isPending} />}
      />

      <div className="grid lg:grid-cols-3 gap-6 mb-6">
        <Card className="p-4 lg:col-span-2 space-y-3">
          <div className="text-sm font-semibold flex items-center gap-2"><MapPin className="w-4 h-4" /> Search center</div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Lat</Label><Input type="number" step="0.0001" value={center.lat} onChange={(e) => setCenter({ ...center, lat: parseFloat(e.target.value) })} /></div>
            <div><Label>Lng</Label><Input type="number" step="0.0001" value={center.lng} onChange={(e) => setCenter({ ...center, lng: parseFloat(e.target.value) })} /></div>
            <div><Label>Radius (km)</Label><Input type="number" min={1} max={500} value={radius} onChange={(e) => setRadius(parseInt(e.target.value || "0"))} /></div>
          </div>
          <div className="flex items-center gap-3">
            <Select value={type || "all"} onValueChange={(v) => setType(v === "all" ? "" : v)}>
              <SelectTrigger className="w-56"><SelectValue placeholder="All facility types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {FACILITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => navigator.geolocation?.getCurrentPosition((p) => setCenter({ lat: p.coords.latitude, lng: p.coords.longitude }))}>
              Use my location
            </Button>
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="text-sm font-semibold flex items-center gap-2"><RouteIcon className="w-4 h-4" /> Travel estimate</div>
          {!dest && <div className="text-xs text-muted-foreground">Pick a facility to compute travel time.</div>}
          {dest && (
            <>
              <Select value={mode} onValueChange={(v) => setMode(v as "driving")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="driving">Driving</SelectItem>
                  <SelectItem value="walking">Walking</SelectItem>
                  <SelectItem value="transit">Transit</SelectItem>
                </SelectContent>
              </Select>
              <div className="text-sm">
                {travelQuery.isFetching ? (
                  <span className="text-muted-foreground inline-flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Computing…</span>
                ) : travelQuery.data ? (
                  <div className="space-y-1">
                    <div><span className="font-semibold">{Math.round(travelQuery.data.estimate.durationSeconds / 60)} min</span> · {(travelQuery.data.estimate.distanceMeters / 1000).toFixed(1)} km</div>
                    <div className="text-xs text-muted-foreground">Provider: {provider}{travelQuery.data.estimate.cached ? " (cached)" : ""}</div>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="p-4 border-b font-semibold flex items-center gap-2"><Building2 className="w-4 h-4" /> Facilities ({facilities.length})</div>
        <div className="divide-y">
          {isLoading && <div className="p-6 text-sm text-muted-foreground">Loading facilities…</div>}
          {!isLoading && facilities.length === 0 && <div className="p-6 text-sm text-muted-foreground">No facilities in range.</div>}
          {facilities.map((f) => (
            <div key={f.id} className="p-4 flex items-center justify-between hover:bg-muted/40">
              <div>
                <div className="font-medium">{f.name} <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-secondary">{f.facility_type}</span></div>
                <div className="text-xs text-muted-foreground">{f.address ?? "—"} · {f.latitude.toFixed(4)}, {f.longitude.toFixed(4)}{"distance_km" in f && f.distance_km != null ? ` · ${(f.distance_km as number).toFixed(1)} km` : ""}</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setDest({ lat: f.latitude, lng: f.longitude })}>Compute travel</Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function NewFacilityDialog({ onCreate, pending }: { onCreate: (v: Parameters<typeof upsertFacility>[0]["data"]) => void; pending: boolean }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", facility_type: "clinic" as (typeof FACILITY_TYPES)[number],
    latitude: 40.75, longitude: -73.99, address: "", phone: "", hours: "",
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-1" /> Add facility</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New facility</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={form.facility_type} onValueChange={(v) => setForm({ ...form, facility_type: v as typeof form.facility_type })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{FACILITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Lat</Label><Input type="number" step="0.0001" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: parseFloat(e.target.value) })} /></div>
            <div><Label>Lng</Label><Input type="number" step="0.0001" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: parseFloat(e.target.value) })} /></div>
          </div>
          <div><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div><Label>Hours</Label><Input value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button onClick={() => { onCreate(form); setOpen(false); }} disabled={pending || form.name.length < 2}>
            {pending && <Loader2 className="w-3 h-3 mr-2 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
