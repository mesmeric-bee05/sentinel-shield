import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, MapPin, Search, Sparkles, Star, Video } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "./app";
import { suggestSlots } from "@/server/ai.functions";

export const Route = createFileRoute("/app/discover")({
  head: () => ({ meta: [{ title: "Find care — ApexCare AI" }] }),
  component: Discover,
});

type Provider = { id: string; display_name: string; specialty: string; bio: string | null; location: string | null; rating: number | null; photo_url: string | null; telemedicine_enabled: boolean };
type Slot = { label: string; iso: string; reason: string; score: number };

function Discover() {
  const { user } = useAuth();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [q, setQ] = useState("");
  const [aiQuery, setAiQuery] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [bookingFor, setBookingFor] = useState<{ p: Provider; s: Slot } | null>(null);

  useEffect(() => {
    supabase.from("providers").select("*").eq("is_active", true).then(({ data }) => setProviders((data ?? []) as Provider[]));
  }, []);

  const filtered = providers.filter((p) => {
    const t = q.toLowerCase();
    return !t || p.display_name.toLowerCase().includes(t) || p.specialty.toLowerCase().includes(t) || (p.location ?? "").toLowerCase().includes(t);
  });

  const askAi = async () => {
    if (aiQuery.trim().length < 3) return;
    setAiLoading(true); setSlots([]);
    const r = await suggestSlots({ data: { query: aiQuery } });
    setAiLoading(false);
    if (r.error) return toast.error(r.error);
    setSlots(r.slots as Slot[]);
  };

  const book = async (p: Provider, s: Slot) => {
    if (!user) return;
    setBookingFor({ p, s });
    const start = new Date(s.iso);
    const end = new Date(start.getTime() + 30 * 60_000);
    const { error } = await supabase.from("appointments").insert({
      patient_id: user.id,
      provider_id: p.id,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      channel: p.telemedicine_enabled ? "telemedicine" : "in_person",
      reason: aiQuery.slice(0, 500) || "General consultation",
      status: "scheduled",
    });
    setBookingFor(null);
    if (error) return toast.error(error.message);
    toast.success(`Booked with ${p.display_name} on ${s.label}`);
  };

  return (
    <div className="p-10 max-w-6xl mx-auto">
      <PageHeader title="Find care" sub="Search providers, or describe what you need and let the AI concierge propose slots." />

      <div className="rounded-2xl border border-border bg-gradient-ai p-6 mb-8">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-accent"><Sparkles className="w-3.5 h-3.5" /> AI Concierge</div>
        <div className="mt-4 grid md:grid-cols-[1fr_auto] gap-3">
          <Textarea value={aiQuery} onChange={(e) => setAiQuery(e.target.value)} placeholder="e.g. I need a dermatologist next week, mornings only, in NY" className="bg-background/80" rows={2} maxLength={500} />
          <Button onClick={askAi} disabled={aiLoading} size="lg">
            {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Sparkles className="w-4 h-4 mr-2" />Suggest slots</>}
          </Button>
        </div>
        {slots.length > 0 && (
          <div className="mt-5 grid md:grid-cols-3 gap-3">
            {slots.map((s, i) => (
              <div key={i} className="rounded-xl bg-background border border-border p-4 ai-shimmer">
                <div className="text-xs uppercase tracking-wider text-accent">Suggestion {i + 1}</div>
                <div className="font-medium mt-1">{s.label}</div>
                <p className="text-xs text-muted-foreground mt-1">{s.reason}</p>
                <Button size="sm" className="mt-3 w-full" disabled={filtered.length === 0 || !!bookingFor} onClick={() => book(filtered[0], s)}>
                  {bookingFor ? "Booking…" : `Book with ${filtered[0]?.display_name?.split(" ").slice(-1)[0] ?? "provider"}`}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="relative mb-6">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by specialty, name, or location…" className="pl-9" />
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((p) => (
          <article key={p.id} className="rounded-2xl border border-border bg-card overflow-hidden shadow-card hover:shadow-elegant transition">
            <div className="aspect-[3/2] bg-muted overflow-hidden">
              {p.photo_url && <img src={p.photo_url} alt={p.display_name} className="w-full h-full object-cover" loading="lazy" />}
            </div>
            <div className="p-5">
              <div className="text-xs uppercase tracking-wider text-accent">{p.specialty}</div>
              <div className="font-serif text-xl mt-1">{p.display_name}</div>
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Star className="w-3 h-3 text-warning" />{p.rating?.toFixed(1)}</span>
                {p.location && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{p.location}</span>}
                {p.telemedicine_enabled && <span className="inline-flex items-center gap-1 text-accent"><Video className="w-3 h-3" />Telemedicine</span>}
              </div>
              <p className="text-sm text-muted-foreground mt-3 line-clamp-2">{p.bio}</p>
              <Button size="sm" className="mt-4 w-full" onClick={() => {
                const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(10, 0, 0, 0);
                book(p, { label: tomorrow.toLocaleString(), iso: tomorrow.toISOString(), reason: "Next available", score: 1 });
              }}>Book next available</Button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
