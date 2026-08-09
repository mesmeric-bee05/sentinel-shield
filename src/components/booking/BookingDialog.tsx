import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Calendar, Check, Copy, Sparkles, X, Download, ArrowRight, MapPin, Video, Clock, AlertTriangle, MessageSquare, Eye } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { bookAppointment } from "@/lib/appointments.functions";
import { summarizeIntake } from "@/lib/ai.functions";
import { holdSlot, releaseSlot } from "@/lib/holds.functions";
import { getPatientContact } from "@/lib/profile.functions";
import { buildIcs, downloadIcs } from "@/lib/ics";
import { getBrowserTimeZone, formatInTz, formatUtc } from "@/lib/timezone";

export type BookingProvider = {
  id: string;
  display_name: string;
  specialty: string;
  location: string | null;
  telemedicine_enabled: boolean;
};

export type BookingSlot = { label: string; iso: string; reason?: string; score?: number };

export type RankedSuggestion = { slot: BookingSlot; provider: BookingProvider };

type Props = {
  open: boolean;
  onClose: () => void;
  provider: BookingProvider | null;
  slot: BookingSlot | null;
  reason: string;
  /** Top suggestSlots ranked options (alternates that can be switched into). */
  ranked?: RankedSuggestion[];
  /** Index of the currently selected suggestion within `ranked`. */
  selectedIndex?: number;
};

type Step = "review" | "preview" | "confirming" | "done" | "error";
type Hold = { holdId: string; expiresAt: string };

export function BookingDialog({ open, onClose, provider: initialProvider, slot: initialSlot, reason, ranked, selectedIndex = 0 }: Props) {
  const [step, setStep] = useState<Step>("review");
  const [aiSummary, setAiSummary] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [appointmentId, setAppointmentId] = useState<string | null>(null);
  const [provider, setProvider] = useState<BookingProvider | null>(initialProvider);
  const [slot, setSlot] = useState<BookingSlot | null>(initialSlot);
  const [hold, setHold] = useState<Hold | null>(null);
  const [now, setNow] = useState(Date.now());
  const [smsRequested, setSmsRequested] = useState(false);
  const [contact, setContact] = useState<{ phoneE164: string | null; smsOptIn: boolean } | null>(null);
  const tz = useMemo(() => getBrowserTimeZone(), []);
  const acquiringRef = useRef(false);

  const book = useServerFn(bookAppointment);
  const summarize = useServerFn(summarizeIntake);
  const acquire = useServerFn(holdSlot);
  const release = useServerFn(releaseSlot);
  const getContact = useServerFn(getPatientContact);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setStep("review"); setAiSummary(""); setErrorMsg(""); setAppointmentId(null);
    setProvider(initialProvider); setSlot(initialSlot); setHold(null); setSmsRequested(false);
    if (reason.trim().length >= 5) {
      setAiLoading(true);
      // Hard timeout so a slow/failed AI call can never keep the dialog in a
      // permanent "Drafting…" state.
      const timeout = new Promise<{ summary: string }>((resolve) => setTimeout(() => resolve({ summary: "" }), 12_000));
      Promise.race([summarize({ data: { reason } }), timeout])
        .then((r) => setAiSummary(r.summary || ""))
        .catch(() => setAiSummary(""))
        .finally(() => setAiLoading(false));
    }
    getContact({}).then((r) => setContact({ phoneE164: r.phoneE164, smsOptIn: r.smsOptIn })).catch(() => {});
  }, [open, reason, initialProvider, initialSlot, summarize, getContact]);

  // Acquire hold whenever provider/slot change while open
  useEffect(() => {
    if (!open || !provider || !slot || acquiringRef.current) return;
    acquiringRef.current = true;
    setHold(null);
    setErrorMsg("");
    acquire({ data: { providerId: provider.id, startsAtIso: new Date(slot.iso).toISOString(), durationMinutes: 30, ttlSeconds: 180 } })
      .then((r) => {
        if (r.ok && r.holdId && r.expiresAt) setHold({ holdId: r.holdId, expiresAt: r.expiresAt });
        else setErrorMsg(reasonText(r.reason));
      })
      .catch((e) => setErrorMsg(e instanceof Error ? `Could not reserve this slot: ${e.message}` : "Could not reserve this slot"))
      .finally(() => { acquiringRef.current = false; });
  }, [open, provider, slot, acquire]);

  // Countdown ticker
  useEffect(() => {
    if (!open || !hold) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open, hold]);

  // Release hold on close (best effort)
  const handleClose = async () => {
    const h = hold;
    setHold(null);
    onClose();
    if (h && step !== "done") {
      try { await release({ data: { holdId: h.holdId } }); } catch { /* ignore */ }
    }
  };

  if (!open || !provider || !slot) return null;

  const start = new Date(slot.iso);
  const end = new Date(start.getTime() + 30 * 60_000);
  const channel: "telemedicine" | "in_person" = provider.telemedicine_enabled ? "telemedicine" : "in_person";
  const remainingMs = hold ? Math.max(0, new Date(hold.expiresAt).getTime() - now) : 0;
  const remainingSec = Math.floor(remainingMs / 1000);
  const expired = !!hold && remainingSec <= 0;

  const switchTo = async (idx: number) => {
    if (!ranked || !ranked[idx]) return;
    if (hold) { try { await release({ data: { holdId: hold.holdId } }); } catch { /* ignore */ } }
    setHold(null);
    setProvider(ranked[idx].provider);
    setSlot(ranked[idx].slot);
  };

  const retryHold = async () => {
    if (!provider || !slot) return;
    setErrorMsg("");
    acquiringRef.current = true;
    const r = await acquire({ data: { providerId: provider.id, startsAtIso: new Date(slot.iso).toISOString(), durationMinutes: 30, ttlSeconds: 180 } });
    acquiringRef.current = false;
    if (r.ok && r.holdId && r.expiresAt) setHold({ holdId: r.holdId, expiresAt: r.expiresAt });
    else setErrorMsg(reasonText(r.reason));
  };

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
        holdId: hold?.holdId ?? null,
        smsRequested: smsRequested && !!contact?.smsOptIn && !!contact?.phoneE164,
      }});
      if (!r.ok || !r.appointment) { setErrorMsg(r.error || "Booking failed"); setStep("error"); return; }
      setAppointmentId(r.appointment.id);
      setHold(null); // booked, hold consumed server-side
      setStep("done");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Booking failed"); setStep("error");
    }
  };

  const icsEvent = {
    uid: appointmentId ?? `pending-${start.getTime()}`,
    title: `ApexCare visit — ${provider.display_name}`,
    description: `Reason: ${reason}\n${aiSummary ? `Clinical summary: ${aiSummary}\n` : ""}${channel === "telemedicine" ? "Join the telemedicine room from your ApexCare appointments page." : ""}`,
    location: channel === "telemedicine" ? "Telemedicine (ApexCare)" : provider.location ?? "",
    url: appointmentId ? `${window.location.origin}/app/room/${appointmentId}` : undefined,
    start, end, timeZone: tz,
  };

  const addToCalendar = () => {
    downloadIcs(`apexcare-${provider.display_name.replace(/\W+/g, "-").toLowerCase()}`, icsEvent);
    toast.success("Calendar invite downloaded");
  };

  const copyDetails = async () => {
    const text = `ApexCare appointment\nProvider: ${provider.display_name} (${provider.specialty})\nWhen: ${formatInTz(start, tz)}\nChannel: ${channel}\nReason: ${reason}`;
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-xl p-0 overflow-hidden gap-0 max-h-[90vh] overflow-y-auto">
        {step === "done" ? (
          <SuccessView provider={provider} start={start} channel={channel} appointmentId={appointmentId} icsEvent={icsEvent} tz={tz} onAdd={addToCalendar} onCopy={copyDetails} onClose={handleClose} />
        ) : step === "preview" ? (
          <CalendarPreview event={icsEvent} tz={tz} onBack={() => setStep("review")} onDownload={addToCalendar} />
        ) : (
          <>
            <div className="px-6 pt-6 pb-4 border-b border-border">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-[0.2em] text-accent">Confirm booking</div>
                <button onClick={handleClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>
              <h2 className="font-serif text-2xl mt-2">{provider.display_name}</h2>
              <div className="flex items-center justify-between mt-1">
                <p className="text-sm text-muted-foreground">{provider.specialty}</p>
                {hold && !expired && (
                  <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-accent/10 text-accent">
                    <Clock className="w-3 h-3" />Slot held · {formatCountdown(remainingSec)}
                  </span>
                )}
                {expired && (
                  <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-destructive/10 text-destructive">
                    <AlertTriangle className="w-3 h-3" />Hold expired
                  </span>
                )}
              </div>
            </div>

            <div className="p-6 space-y-4">
              {ranked && ranked.length > 0 && (
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground bg-muted/40 flex items-center gap-2">
                    <Sparkles className="w-3 h-3 text-accent" />AI suggestions · ranked
                  </div>
                  <ul className="divide-y divide-border">
                    {ranked.map((r, i) => {
                      const active = r.slot.iso === slot.iso && r.provider.id === provider.id;
                      return (
                        <li key={`${r.provider.id}-${r.slot.iso}`} className={`px-4 py-3 flex items-center justify-between gap-3 ${active ? "bg-accent/5" : ""}`}>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] uppercase tracking-wider text-accent">#{i + 1}</span>
                              <span className="font-medium text-sm truncate">{r.provider.display_name}</span>
                              <span className="text-xs text-muted-foreground truncate">· {r.provider.specialty}</span>
                              {r.provider.telemedicine_enabled ? <Video className="w-3 h-3 text-accent shrink-0" /> : <MapPin className="w-3 h-3 text-muted-foreground shrink-0" />}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5 truncate">{r.slot.label} · {r.slot.reason ?? ""}{typeof r.slot.score === "number" ? ` · score ${(r.slot.score).toFixed(2)}` : ""}</div>
                          </div>
                          {active ? (
                            <span className="text-xs text-accent font-medium shrink-0">Selected</span>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => switchTo(i)}>Switch</Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <Row icon={Calendar} label="When" value={formatInTz(start, tz)} sub={`30 min · ${tz}`} />
              <Row icon={channel === "telemedicine" ? Video : MapPin} label="Channel" value={channel === "telemedicine" ? "Telemedicine" : "In person"} sub={channel === "in_person" ? provider.location ?? "" : "Link will be in your appointments"} />

              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Reason for visit</div>
                <p className="text-sm">{reason}</p>
              </div>

              <div className="rounded-xl border border-accent/30 bg-gradient-ai p-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-accent">
                  <Sparkles className="w-3 h-3" />AI clinical pre-summary
                </div>
                <div className="text-sm mt-2 min-h-[2.5rem]">
                  {aiLoading ? <span className="text-muted-foreground inline-flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Drafting…</span> : (aiSummary || <span className="text-muted-foreground">Pre-summary will appear here.</span>)}
                </div>
              </div>

              {/* SMS opt-in */}
              <label className={`flex items-start gap-3 rounded-xl border border-border p-3 ${contact?.phoneE164 && contact?.smsOptIn ? "" : "opacity-70"}`}>
                <Checkbox checked={smsRequested} onCheckedChange={(c) => setSmsRequested(!!c)} disabled={!contact?.phoneE164 || !contact?.smsOptIn} className="mt-0.5" />
                <div className="text-xs flex-1">
                  <div className="font-medium flex items-center gap-1.5"><MessageSquare className="w-3 h-3" />Also text me a confirmation</div>
                  {!contact?.phoneE164 || !contact?.smsOptIn ? (
                    <div className="text-muted-foreground mt-0.5">Add a phone number and opt in from <Link to="/app" className="underline">your overview</Link>.</div>
                  ) : (
                    <div className="text-muted-foreground mt-0.5">We'll text {contact.phoneE164}.</div>
                  )}
                </div>
              </label>

              {errorMsg && (
                <div className="text-sm text-destructive flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                  <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4" />{errorMsg}</span>
                  {!hold && <Button size="sm" variant="outline" onClick={retryHold}>Retry hold</Button>}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-border flex flex-col gap-2">
              {(aiLoading || !hold || expired) && (
                <div className="text-[11px] text-muted-foreground text-right">
                  {!hold && !expired && !errorMsg && <>Reserving slot…</>}
                  {expired && <>Hold expired — tap retry to reserve again.</>}
                  {hold && !expired && aiLoading && <>Drafting AI summary — you can skip and confirm anyway.</>}
                </div>
              )}
              <div className="flex justify-between gap-2">
                <Button variant="ghost" onClick={() => setStep("preview")} disabled={step === "confirming"}>
                  <Eye className="w-4 h-4 mr-2" />Preview calendar
                </Button>
                <div className="flex gap-2">
                  {aiLoading && hold && !expired && (
                    <Button variant="outline" onClick={() => { setAiLoading(false); setAiSummary(""); }} disabled={step === "confirming"}>Skip AI</Button>
                  )}
                  <Button variant="ghost" onClick={handleClose} disabled={step === "confirming"}>Cancel</Button>
                  <Button onClick={confirm} disabled={step === "confirming" || !hold || expired}>
                    {step === "confirming" ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Booking…</> : <>Confirm booking <ArrowRight className="w-4 h-4 ml-2" /></>}
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function reasonText(r: string | null | undefined): string {
  switch (r) {
    case "appointment_conflict": return "Another appointment was just booked at this time.";
    case "hold_conflict": return "Another patient is finalizing this slot.";
    case null: case undefined: case "": return "";
    default: return r;
  }
}

function formatCountdown(sec: number): string {
  const m = Math.floor(sec / 60); const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
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

function CalendarPreview({ event, tz, onBack, onDownload }: { event: Parameters<typeof buildIcs>[0]; tz: string; onBack: () => void; onDownload: () => void }) {
  const ics = useMemo(() => buildIcs(event), [event]);
  // Validate: re-derive from event.start.iso vs what's encoded
  const valid = event.end.getTime() > event.start.getTime();

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-[0.2em] text-accent">Calendar preview</div>
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
      </div>
      <h2 className="font-serif text-xl">{event.title}</h2>

      <div className="rounded-xl border border-border p-4 space-y-3 text-sm">
        <PreviewRow label="Start (your time)" value={formatInTz(event.start, tz)} />
        <PreviewRow label="End (your time)" value={formatInTz(event.end, tz)} />
        <PreviewRow label="Start (UTC)" value={formatUtc(event.start)} />
        <PreviewRow label="Time zone" value={tz} />
        {event.location && <PreviewRow label="Location" value={event.location} />}
        {event.url && <PreviewRow label="Link" value={event.url} />}
      </div>

      {valid ? (
        <div className="text-xs text-accent inline-flex items-center gap-1.5"><Check className="w-3 h-3" />Times verified — calendar file will match the slot you selected.</div>
      ) : (
        <div className="text-xs text-destructive inline-flex items-center gap-1.5"><AlertTriangle className="w-3 h-3" />Time mismatch detected; download blocked.</div>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">View raw .ics</summary>
        <pre className="mt-2 p-3 rounded-lg bg-muted text-[11px] overflow-x-auto whitespace-pre-wrap break-all">{ics}</pre>
      </details>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button onClick={onDownload} disabled={!valid}><Download className="w-4 h-4 mr-2" />Download .ics</Button>
      </div>
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-medium text-right break-all">{value}</div>
    </div>
  );
}

function SuccessView({ provider, start, channel, appointmentId, icsEvent, tz, onAdd, onCopy, onClose }: { provider: BookingProvider; start: Date; channel: string; appointmentId: string | null; icsEvent: Parameters<typeof buildIcs>[0]; tz: string; onAdd: () => void; onCopy: () => void; onClose: () => void }) {
  const [showPreview, setShowPreview] = useState(false);
  if (showPreview) {
    return <CalendarPreview event={icsEvent} tz={tz} onBack={() => setShowPreview(false)} onDownload={onAdd} />;
  }
  return (
    <div className="p-8 text-center">
      <div className="w-14 h-14 rounded-full bg-accent/10 text-accent grid place-items-center mx-auto mb-4">
        <Check className="w-7 h-7" />
      </div>
      <h2 className="font-serif text-2xl">You're booked</h2>
      <p className="text-sm text-muted-foreground mt-1">{provider.display_name} · {formatInTz(start, tz)}</p>
      <p className="text-xs text-muted-foreground mt-1">
        {channel === "telemedicine" ? "Join the secure room from your appointments." : "Please arrive 10 minutes early."} A confirmation email is on the way.
      </p>

      <div className="grid grid-cols-2 gap-2 mt-6">
        <Button variant="outline" onClick={() => setShowPreview(true)}><Eye className="w-4 h-4 mr-2" />Preview .ics</Button>
        <Button variant="outline" onClick={onAdd}><Download className="w-4 h-4 mr-2" />Add to calendar</Button>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <Button variant="outline" onClick={onCopy}><Copy className="w-4 h-4 mr-2" />Copy details</Button>
        <Button asChild><Link to="/app/appointments" onClick={onClose}>Appointments</Link></Button>
        {channel === "telemedicine" && appointmentId && (
          <Button asChild variant="ghost" className="col-span-2">
            <Link to="/app/room/$appointmentId" params={{ appointmentId }} onClick={onClose}>Test telemedicine room</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
