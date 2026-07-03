import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, Plus, UsersRound, ListChecks } from "lucide-react";
import { listChwWorkers, upsertChwWorker, listAssignments, dispatchAssignment, type ChwWorkerInputT, type DispatchInputT } from "@/lib/chw.functions";
import { PageHeader } from "./app";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/app/admin/chw")({ component: ChwPage });

const TASK_TYPES = ["home_visit", "medication_check", "wellness_call", "transport", "education", "triage_followup"] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

function ChwPage() {
  const lw = useServerFn(listChwWorkers);
  const la = useServerFn(listAssignments);
  const upsert = useServerFn(upsertChwWorker);
  const dispatch = useServerFn(dispatchAssignment);
  const qc = useQueryClient();

  const workers = useQuery({ queryKey: ["chw-workers"], queryFn: () => lw({ data: undefined }) });
  const [statusFilter, setStatusFilter] = useState<string>("");
  const assignments = useQuery({
    queryKey: ["chw-assignments", statusFilter],
    queryFn: () => la({ data: { status: statusFilter || null, onlyMine: false } }),
  });

  const createWorker = useMutation({
    mutationFn: (v: ChwWorkerInputT) => upsert({ data: v }),
    onSuccess: (r) => {
      if (r.ok) { toast.success("CHW saved"); qc.invalidateQueries({ queryKey: ["chw-workers"] }); }
      else toast.error(r.error ?? "Failed");
    },
  });
  const createAssign = useMutation({
    mutationFn: (v: DispatchInputT) => dispatch({ data: v }),
    onSuccess: (r) => {
      if (r.ok) { toast.success("Dispatched"); qc.invalidateQueries({ queryKey: ["chw-assignments"] }); }
      else toast.error(r.error ?? "Failed");
    },
  });

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <PageHeader
        title="Community Health Worker Mesh"
        sub="Roster, dispatch, and check-ins for last-mile community care. Auto-routes to the nearest active CHW when patient coordinates are provided."
        action={
          <div className="flex gap-2">
            <NewWorkerDialog onCreate={(v) => createWorker.mutate(v)} pending={createWorker.isPending} />
            <NewAssignmentDialog onCreate={(v) => createAssign.mutate(v)} pending={createAssign.isPending} />
          </div>
        }
      />

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="overflow-hidden">
          <div className="p-4 border-b font-semibold flex items-center gap-2"><UsersRound className="w-4 h-4" /> Workers ({workers.data?.workers.length ?? 0})</div>
          <div className="divide-y">
            {workers.isLoading && <div className="p-6 text-sm text-muted-foreground">Loading…</div>}
            {workers.data?.workers.map((w) => (
              <div key={w.id} className="p-4">
                <div className="font-medium flex items-center gap-2">{w.display_name} {!w.is_active && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-secondary">inactive</span>}</div>
                <div className="text-xs text-muted-foreground">Skills: {w.skills.join(", ") || "—"} · Languages: {w.languages.join(", ")}</div>
                {w.base_lat != null && w.base_lng != null && (
                  <div className="text-xs text-muted-foreground">Base: {w.base_lat.toFixed(3)}, {w.base_lng.toFixed(3)}</div>
                )}
              </div>
            ))}
            {!workers.isLoading && (workers.data?.workers.length ?? 0) === 0 && <div className="p-6 text-sm text-muted-foreground">No CHWs yet. Add one to get started.</div>}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="p-4 border-b flex items-center justify-between">
            <div className="font-semibold flex items-center gap-2"><ListChecks className="w-4 h-4" /> Assignments ({assignments.data?.assignments.length ?? 0})</div>
            <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {["pending", "accepted", "in_progress", "completed", "cancelled", "escalated"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="divide-y max-h-[60vh] overflow-auto">
            {assignments.isLoading && <div className="p-6 text-sm text-muted-foreground">Loading…</div>}
            {assignments.data?.assignments.map((a) => {
              const chw = (a as { chw?: { display_name?: string } | null }).chw;
              return (
                <div key={a.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{a.task_type.replace("_", " ")}</div>
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-secondary">{a.status}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Priority: {a.priority} · Due {new Date(a.due_at).toLocaleString()} · CHW: {chw?.display_name ?? "unassigned"}
                  </div>
                  {a.notes && <div className="text-xs mt-1">{a.notes}</div>}
                </div>
              );
            })}
            {!assignments.isLoading && (assignments.data?.assignments.length ?? 0) === 0 && <div className="p-6 text-sm text-muted-foreground">No assignments.</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}

function NewWorkerDialog({ onCreate, pending }: { onCreate: (v: ChwWorkerInputT) => void; pending: boolean }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    user_id: "", display_name: "", languages: "en", skills: "",
    base_lat: undefined as number | undefined, base_lng: undefined as number | undefined, is_active: true,
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><Plus className="w-4 h-4 mr-1" /> CHW</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add CHW</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label>User ID (auth)</Label><Input value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })} placeholder="uuid" /></div>
          <div><Label>Display name</Label><Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></div>
          <div><Label>Languages (comma)</Label><Input value={form.languages} onChange={(e) => setForm({ ...form, languages: e.target.value })} /></div>
          <div><Label>Skills (comma)</Label><Input value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Base lat</Label><Input type="number" step="0.0001" onChange={(e) => setForm({ ...form, base_lat: parseFloat(e.target.value) })} /></div>
            <div><Label>Base lng</Label><Input type="number" step="0.0001" onChange={(e) => setForm({ ...form, base_lng: parseFloat(e.target.value) })} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={pending || form.user_id.length < 8 || form.display_name.length < 2}
            onClick={() => {
              onCreate({
                user_id: form.user_id,
                display_name: form.display_name,
                languages: form.languages.split(",").map((s) => s.trim()).filter(Boolean),
                skills: form.skills.split(",").map((s) => s.trim()).filter(Boolean),
                base_lat: form.base_lat ?? null,
                base_lng: form.base_lng ?? null,
                is_active: true,
              });
              setOpen(false);
            }}
          >
            {pending && <Loader2 className="w-3 h-3 mr-2 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewAssignmentDialog({ onCreate, pending }: { onCreate: (v: DispatchInputT) => void; pending: boolean }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    patient_id: "", task_type: "wellness_call" as (typeof TASK_TYPES)[number],
    priority: "normal" as (typeof PRIORITIES)[number], notes: "",
    patient_lat: undefined as number | undefined, patient_lng: undefined as number | undefined,
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-1" /> Dispatch</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Dispatch CHW assignment</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label>Patient ID</Label><Input value={form.patient_id} onChange={(e) => setForm({ ...form, patient_id: e.target.value })} placeholder="uuid" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Task</Label>
              <Select value={form.task_type} onValueChange={(v) => setForm({ ...form, task_type: v as typeof form.task_type })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TASK_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v as typeof form.priority })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Patient lat</Label><Input type="number" step="0.0001" onChange={(e) => setForm({ ...form, patient_lat: parseFloat(e.target.value) })} /></div>
            <div><Label>Patient lng</Label><Input type="number" step="0.0001" onChange={(e) => setForm({ ...form, patient_lng: parseFloat(e.target.value) })} /></div>
          </div>
          <div><Label>Notes</Label><Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button
            disabled={pending || form.patient_id.length < 8}
            onClick={() => {
              onCreate({
                patient_id: form.patient_id,
                task_type: form.task_type,
                priority: form.priority,
                notes: form.notes || null,
                patient_lat: form.patient_lat ?? null,
                patient_lng: form.patient_lng ?? null,
                due_at: null,
                preferred_chw_id: null,
              });
              setOpen(false);
            }}
          >
            {pending && <Loader2 className="w-3 h-3 mr-2 animate-spin" />} Dispatch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
