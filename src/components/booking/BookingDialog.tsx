import { useEffect, useState } from "react";
import { Loader2, Calendar, Check, Copy, Sparkles, X, Download, ArrowRight, MapPin, Video } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { bookAppointment } from "@/server/appointments.functions";
import { summarizeIntake } from "@/server/ai.functions";
import { downloadIcs } from "@/lib/ics";

export type BookingProvider = {
  id: string;
  display_name: string;
  specialty: string;
  location: string | null;
  telemedicine_enabled: boolean;
};

export type BookingSlot = { label: string; iso: string; reason?: string };

type Props = {
  open: boolean;
  onClose: () => void;
  provider: BookingProvider | null;
  slot: BookingSlot | null;
  reason: string;
};

type Step = "review" | "confirming" | "done" | "error";

export function BookingDialog({ open, onClose, provider, slot, reason }: Props) {
  const [step, setStep] = useState<Step>("review");
  const [aiSummary, setAiSummary] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [appointmentId, setAppointmentId] = useState<string | null>(null);

  const book = useServerFn(bookAppointment);
  const summarize = useServerFn(summarizeIntake);

  useEffect(() => {
    if (!open) return;
    setStep("review"); setAiSummary(""); setErrorMsg(""); setAppointmentId(null);
    if (reason.trim().length >= 5) {
      setAiLoading(true);
      summarize({ data: { reason } })
        .then((r) => setAiSummary(r.summary || ""))
        .catch(() => {})
        .finally(() => setAiLoading(false));
    }
  }, [open, reason, summarize]);

  if (!open || !provider || !slot) return null;

  const start = new Date(slot.iso);
  const end = new Date(start.getTime() + 30 * 60_000);
  const channel: "telemedicine" | "in_person" = provider.telemedicine_enabled ? "telemedicine" : "in_person";

  const confirm = async () => {
    setStep("confirming"); setErrorMsg("");
    try {
      const r = await book({ data: {
        providerId: provider.id,
        startsAtIso: start.toISOString(),
        durationMinutes: 30,
        channel,
        reason,
        aiSummary: aiSummary || null,
      }});
      if (!r.ok || !r.appointment) { setErrorMsg(r.error || "Booking failed"); setStep("error"); return; }
      setAppointmentId(r.appointment.id);
      setStep("done");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Booking failed"); setStep("error");
    }
  };

  const addToCalendar = () => {
    downloadIcs(`apexcare-${provider.display_name.replace(/\W+/g, "-").toLowerCase()}`, {
      uid: appointmentId ?? `${Date.now()}`,
      title: `ApexCare visit — ${provider.display_name}`,
      description: `Reason: ${reason}\n${aiSummary ? `Clinical summary: ${aiSummary}\n` : ""}${channel === "telemedicine" ? "Join the telemedicine room from your ApexCare appointments page." : ""}`,
      location: channel === "telemedicine" ? "Telemedicine (ApexCare)" : provider.location ?? "",
      url: appointmentId ? `${window.location.origin}/app/room/${appointmentId}` : undefined,
      start, end,
    });
    toast.success("Calendar invite downloaded");
  };

  const copyDetails = async () => {
    const text = `ApexCare appointment\nProvider: ${provider.display_name} (${provider.specialty})\nWhen: ${start.toLocaleString()}\nChannel: ${channel}\nReason: ${reason}`;
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg p-0 overflow-hidden gap-0">
        {step === "done" ? (
          <SuccessView provider={provider} start={start} channel={channel} appointmentId={appointmentId} onAdd={addToCalendar} onCopy={copyDetails} onClose={onClose} />
        ) : (
          <>
            <div className="px-6 pt-6 pb-4 border-b border-border">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-[0.2em] text-accent">Confirm booking</div>
                <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>
              <h2 className="font-serif text-2xl mt-2">{provider.display_name}</h2>
              <p className="text-sm text-muted-foreground">{provider.specialty}</p>
            </div>

            <div className="p-6 space-y-4">
              <Row icon={Calendar} label="When" value={start.toLocaleString(undefined, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} sub="30 minute consultation" />
              <Row icon={channel === "telemedicine" ? Video : MapPin} label="Channel" value={channel === "telemedicine" ? "Telemedicine" : "In person"} sub={channel === "in_person" ? provider.location ?? "" : "Link will be in your appointments"} />

              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Reason for visit</div>
                <p className="text-sm">{reason}</p>
              </div>

              <div className="rounded-xl border border-accent/30 bg-gradient-ai p-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-accent">
                  <Sparkles className="w-3 h-3" />
                  AI clinical pre-summary
                </div>
                <div className="text-sm mt-2 min-h-[2.5rem]">
                  {aiLoading ? <span className="text-muted-foreground inline-flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Drafting…</span> : (aiSummary || <span className="text-muted-foreground">Pre-summary will appear here.</span>)}
                </div>
              </div>

              {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
            </div>

            <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={step === "confirming"}>Cancel</Button>
              <Button onClick={confirm} disabled={step === "confirming"}>
                {step === "confirming" ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Booking…</> : <>Confirm booking <ArrowRight className="w-4 h-4 ml-2" /></>}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ icon: Icon, label, value, sub }: { icon: typeof Calendar; label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg bg-muted grid place-items-center shrink-0"><Icon className="w-4 h-4 text-muted-foreground" /></div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="font-medium text-sm">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function SuccessView({ provider, start, channel, appointmentId, onAdd, onCopy, onClose }: { provider: BookingProvider; start: Date; channel: string; appointmentId: string | null; onAdd: () => void; onCopy: () => void; onClose: () => void }) {
  return (
    <div className="p-8 text-center">
      <div className="w-14 h-14 rounded-full bg-accent/10 text-accent grid place-items-center mx-auto mb-4">
        <Check className="w-7 h-7" />
      </div>
      <h2 className="font-serif text-2xl">You're booked</h2>
      <p className="text-sm text-muted-foreground mt-1">{provider.display_name} · {start.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground mt-1">{channel === "telemedicine" ? "Join the secure room from your appointments." : "Please arrive 10 minutes early."}</p>

      <div className="grid grid-cols-2 gap-2 mt-6">
        <Button variant="outline" onClick={onAdd}><Download className="w-4 h-4 mr-2" />Add to calendar</Button>
        <Button variant="outline" onClick={onCopy}><Copy className="w-4 h-4 mr-2" />Copy details</Button>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <Button asChild className="col-span-2">
          <Link to="/app/appointments" onClick={onClose}>Go to appointments</Link>
        </Button>
        {channel === "telemedicine" && appointmentId && (
          <Button asChild variant="ghost" className="col-span-2">
            <Link to="/app/room/$appointmentId" params={{ appointmentId }} onClick={onClose}>Test telemedicine room</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
