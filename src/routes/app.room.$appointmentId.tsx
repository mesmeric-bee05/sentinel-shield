import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff, ScreenShare, Sparkles, Save, Copy, Loader2, ShieldCheck, Activity, FileText } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getAppointment, saveScribeNote, logRoomEvent } from "@/lib/appointments.functions";
import { scribeDraft } from "@/lib/ai.functions";

export const Route = createFileRoute("/app/room/$appointmentId")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  head: () => ({ meta: [{ title: "Telemedicine — ApexCare AI" }] }),
  component: Room,
});

type Appt = { id: string; starts_at: string; status: string; channel: string; reason: string | null; ai_summary: string | null; provider: { display_name: string; specialty: string; photo_url: string | null } | null };

function Room() {
  const { appointmentId } = Route.useParams();
  const nav = useNavigate();
  const getAppt = useServerFn(getAppointment);
  const saveNote = useServerFn(saveScribeNote);
  const logEvent = useServerFn(logRoomEvent);
  const draft = useServerFn(scribeDraft);

  const [appt, setAppt] = useState<Appt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [transcript, setTranscript] = useState("");
  const [note, setNote] = useState("");
  const [draftBusy, setDraftBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [recOn, setRecOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const recRef = useRef<unknown>(null);

  useEffect(() => {
    getAppt({ data: { id: appointmentId } }).then((r) => {
      if (r.error) { setError(r.error); return; }
      setAppt(r.appointment as Appt);
      setNote((r.appointment as Appt)?.ai_summary ?? "");
      logEvent({ data: { appointmentId, event: "join" } }).catch(() => {});
    });
    return () => { logEvent({ data: { appointmentId, event: "leave" } }).catch(() => {}); };
  }, [appointmentId, getAppt, logEvent]);

  useEffect(() => {
    let active = true;
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((s) => {
      if (!active) { s.getTracks().forEach((t) => t.stop()); return; }
      setStream(s);
      if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play().catch(() => {}); }
    }).catch((e) => toast.error(`Camera/mic blocked: ${e instanceof Error ? e.message : "permission denied"}`));
    return () => { active = false; stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMic = () => { stream?.getAudioTracks().forEach((t) => (t.enabled = !micOn)); setMicOn(!micOn); };
  const toggleCam = () => { stream?.getVideoTracks().forEach((t) => (t.enabled = !camOn)); setCamOn(!camOn); };

  const startRec = () => {
    const SR = (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SR) { toast.error("Live transcription not supported in this browser. Type into the transcript box."); return; }
    const rec = new SR() as { continuous: boolean; interimResults: boolean; lang: string; onresult: (e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void; onend: () => void; start: () => void; stop: () => void };
    rec.continuous = true; rec.interimResults = true; rec.lang = "en-US";
    rec.onresult = (e) => {
      let txt = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) txt += e.results[i][0].transcript + " ";
      }
      if (txt) setTranscript((prev) => prev + txt);
    };
    rec.onend = () => setRecOn(false);
    rec.start(); recRef.current = rec; setRecOn(true);
  };
  const stopRec = () => { try { (recRef.current as { stop: () => void } | null)?.stop(); } catch {} setRecOn(false); };

  const generateNote = async () => {
    if (transcript.trim().length < 5) return toast.error("Add some transcript first");
    setDraftBusy(true);
    const r = await draft({ data: { transcript } });
    setDraftBusy(false);
    if (r.error) return toast.error(r.error);
    setNote(r.note);
    toast.success("Draft generated");
  };
  const save = async () => {
    setSaveBusy(true);
    const r = await saveNote({ data: { appointmentId, note } });
    setSaveBusy(false);
    if (!r.ok) return toast.error(r.error || "Save failed");
    toast.success("Saved to appointment");
  };
  const endCall = () => {
    stream?.getTracks().forEach((t) => t.stop());
    nav({ to: "/app/appointments" });
  };

  if (error) return (
    <div className="min-h-screen grid place-items-center p-10 text-center">
      <div>
        <h1 className="font-serif text-2xl">Room unavailable</h1>
        <p className="text-sm text-muted-foreground mt-2">{error}</p>
        <Button asChild variant="outline" className="mt-4"><Link to="/app/appointments">Back to appointments</Link></Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-sidebar text-sidebar-foreground flex flex-col">
      <header className="px-6 py-3 border-b border-sidebar-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-accent" />
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-sidebar-foreground/85">Telemedicine room</div>
            <div className="font-serif">{appt?.provider?.display_name ?? "Loading…"}</div>
          </div>
        </div>
        <div className="text-xs inline-flex items-center gap-2 text-sidebar-foreground/85"><ShieldCheck className="w-3.5 h-3.5 text-accent" /> Encrypted in transit · Audit-logged</div>
      </header>

      <div className="flex-1 grid lg:grid-cols-[1fr_380px] gap-0">
        <div className="relative bg-black grid place-items-center overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-950 to-black" />
          <div className="relative z-10 text-center text-white/70">
            <div className="w-24 h-24 rounded-full bg-white/5 grid place-items-center mx-auto mb-4 backdrop-blur"><Video className="w-10 h-10" /></div>
            <p className="font-serif text-xl text-white/90">Waiting for the other participant…</p>
            <p className="text-xs mt-1 text-white/75">Phase 2 shell — full WebRTC peering ships in Phase 3.</p>
          </div>

          {/* Local PiP */}
          <div className="absolute bottom-6 right-6 w-56 aspect-video rounded-xl overflow-hidden border border-white/10 shadow-2xl bg-black z-20">
            <video ref={videoRef} muted playsInline className="w-full h-full object-cover" />
            {!camOn && <div className="absolute inset-0 grid place-items-center bg-black/80 text-white/80 text-xs">Camera off</div>}
          </div>

          {/* Controls */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-black/60 backdrop-blur px-3 py-2 rounded-full border border-white/10">
            <CtlButton onClick={toggleMic} active={micOn} icon={micOn ? Mic : MicOff} />
            <CtlButton onClick={toggleCam} active={camOn} icon={camOn ? Video : VideoOff} />
            <CtlButton onClick={() => toast("Screen share coming in Phase 3")} active icon={ScreenShare} />
            <button onClick={endCall} className="ml-1 px-4 h-10 rounded-full bg-destructive text-destructive-foreground flex items-center gap-2 text-sm hover:opacity-90"><PhoneOff className="w-4 h-4" />End</button>
          </div>
        </div>

        <aside className="bg-background text-foreground border-l border-border flex flex-col">
          <div className="p-4 border-b border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-accent"><Sparkles className="w-3.5 h-3.5" /> AI Scribe</div>
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-warning/15 text-warning-foreground">Stub</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Drafts only — review before adding to record.</p>
          </div>

          <div className="p-4 border-b border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">Live transcript</span>
              {recOn ? (
                <Button size="sm" variant="outline" onClick={stopRec}><span className="w-2 h-2 rounded-full bg-destructive animate-pulse mr-2" />Stop</Button>
              ) : (
                <Button size="sm" variant="outline" onClick={startRec}><Mic className="w-3 h-3 mr-1" />Listen</Button>
              )}
            </div>
            <Textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={6} placeholder="Speech-to-text or manual transcript…" />
          </div>

          <div className="p-4 flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">SOAP draft</span>
              <Button size="sm" onClick={generateNote} disabled={draftBusy}>{draftBusy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <FileText className="w-3 h-3 mr-1" />}Generate</Button>
            </div>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={12} className="flex-1 font-mono text-xs" placeholder="Subjective / Objective / Assessment / Plan will appear here…" />
            <div className="grid grid-cols-2 gap-2 mt-3">
              <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(note); toast.success("Copied"); }}><Copy className="w-3 h-3 mr-1" />Copy</Button>
              <Button size="sm" onClick={save} disabled={saveBusy}>{saveBusy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}Save</Button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function CtlButton({ onClick, active, icon: Icon }: { onClick: () => void; active: boolean; icon: typeof Mic }) {
  return (
    <button onClick={onClick} className={`w-10 h-10 rounded-full grid place-items-center transition ${active ? "bg-white/10 text-white hover:bg-white/20" : "bg-destructive/80 text-white hover:bg-destructive"}`}>
      <Icon className="w-4 h-4" />
    </button>
  );
}
