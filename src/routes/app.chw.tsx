import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ClipboardList, Loader2, MapPin } from "lucide-react";
import { listAssignments, updateAssignmentStatus } from "@/server/chw.functions";
import { PageHeader } from "./app";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/app/chw")({ component: ChwHomePage });

const STATUSES = ["accepted", "in_progress", "completed", "cancelled", "escalated"] as const;

function ChwHomePage() {
  const la = useServerFn(listAssignments);
  const upd = useServerFn(updateAssignmentStatus);
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["chw-mine"],
    queryFn: () => la({ data: { onlyMine: true, status: null } }),
  });

  const update = useMutation({
    mutationFn: (v: Parameters<typeof upd>[0]["data"]) => upd({ data: v }),
    onSuccess: (r) => {
      if (r.ok) { toast.success("Updated"); qc.invalidateQueries({ queryKey: ["chw-mine"] }); }
      else toast.error(r.error ?? "Failed");
    },
  });

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <PageHeader title="My CHW queue" sub="Tasks dispatched to you. Update status with optional check-in geo-tag." />
      <div className="space-y-3">
        {list.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {!list.isLoading && (list.data?.assignments.length ?? 0) === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground"><ClipboardList className="w-6 h-6 mx-auto mb-2 opacity-60" />Nothing assigned yet.</Card>
        )}
        {list.data?.assignments.map((a) => (
          <AssignmentRow
            key={a.id}
            assignment={a}
            pending={update.isPending}
            onUpdate={(v) => update.mutate({ id: a.id, ...v })}
          />
        ))}
      </div>
    </div>
  );
}

function AssignmentRow({
  assignment, onUpdate, pending,
}: {
  assignment: { id: string; task_type: string; priority: string; status: string; due_at: string; notes: string | null };
  onUpdate: (v: { status: (typeof STATUSES)[number]; notes: string | null; geo_lat: number | null; geo_lng: number | null }) => void;
  pending: boolean;
}) {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("in_progress");
  const [notes, setNotes] = useState("");
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="font-medium">{assignment.task_type.replace("_", " ")} <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-secondary">{assignment.status}</span></div>
        <div className="text-xs text-muted-foreground">Due {new Date(assignment.due_at).toLocaleString()}</div>
      </div>
      {assignment.notes && <div className="text-sm mt-2 text-muted-foreground">{assignment.notes}</div>}
      <div className="grid md:grid-cols-3 gap-3 mt-3">
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => navigator.geolocation?.getCurrentPosition((p) => { setGeo({ lat: p.coords.latitude, lng: p.coords.longitude }); toast.success("Geo captured"); })}>
          <MapPin className="w-3 h-3 mr-1" /> {geo ? "Geo set" : "Tag location"}
        </Button>
        <Button onClick={() => onUpdate({ status, notes: notes || null, geo_lat: geo?.lat ?? null, geo_lng: geo?.lng ?? null })} disabled={pending}>
          {pending && <Loader2 className="w-3 h-3 mr-2 animate-spin" />} Submit check-in
        </Button>
      </div>
      <Textarea className="mt-3" rows={2} placeholder="Notes…" value={notes} onChange={(e) => setNotes(e.target.value)} />
    </Card>
  );
}
