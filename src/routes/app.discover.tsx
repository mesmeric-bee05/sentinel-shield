import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, MapPin, Search, Sparkles, Star, Video } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "./app";
import { suggestSlots } from "@/lib/ai.functions";
import { BookingDialog, type BookingProvider, type BookingSlot, type RankedSuggestion } from "@/components/booking/BookingDialog";

export const Route = createFileRoute("/app/discover")({
  head: () => ({ meta: [{ title: "Find care — ApexCare AI" }] }),
  component: Discover,
});

type Provider = BookingProvider & { bio: string | null; rating: number | null; photo_url: string | null };
type Slot = { label: string; iso: string; reason: string; score: number };

function Discover() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [q, setQ] = useState("");
  const [aiQuery, setAiQuery] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [bookingState, setBookingState] = useState<{ provider: Provider; slot: BookingSlot; reason: string; ranked?: RankedSuggestion[]; selectedIndex?: number } | null>(null);
  const [pickerFor, setPickerFor] = useState<{ slot: Slot; index: number } | null>(null);

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

  const buildRanked = (chosenProvider: Provider): RankedSuggestion[] =>
    slots.slice(0, 3).map((s, i) => ({
      slot: { label: s.label, iso: s.iso, reason: s.reason, score: s.score },
      // Default to the chosen provider for index 0; rotate through filtered list for alternates
      provider: i === 0 ? chosenProvider : (filtered[i % Math.max(filtered.length, 1)] ?? chosenProvider),
    }));

  const openBooking = (provider: Provider, slot: BookingSlot, reason: string, opts?: { ranked?: RankedSuggestion[]; selectedIndex?: number }) => {
    setPickerFor(null);
    setBookingState({ provider, slot, reason, ranked: opts?.ranked, selectedIndex: opts?.selectedIndex });
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
                <div className="flex items-center justify-between text-xs uppercase tracking-wider text-accent">
                  <span>Suggestion {i + 1}</span>
                  <span className="text-muted-foreground normal-case">score {s.score.toFixed(2)}</span>
                </div>
                <div className="font-medium mt-1">{s.label}</div>
                <p className="text-xs text-muted-foreground mt-1">{s.reason}</p>
                <Button size="sm" className="mt-3 w-full" onClick={() => setPickerFor({ slot: s, index: i })}>
                  Choose provider
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
                openBooking(p, { label: tomorrow.toLocaleString(), iso: tomorrow.toISOString(), reason: "Next available" }, aiQuery || "General consultation");
              }}>Book next available</Button>
            </div>
          </article>
        ))}
      </div>

      {/* Provider picker for AI suggestions */}
      {pickerFor && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4" onClick={() => setPickerFor(null)}>
          <div className="bg-card rounded-2xl border border-border max-w-2xl w-full max-h-[80vh] overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="text-xs uppercase tracking-[0.2em] text-accent mb-2">Choose provider for {pickerFor.slot.label}</div>
            <h3 className="font-serif text-xl mb-4">Which clinician would you like to see?</h3>
            <div className="grid sm:grid-cols-2 gap-2">
              {filtered.slice(0, 8).map((p) => (
                <button key={p.id} onClick={() => {
                  const ranked = buildRanked(p);
                  // ensure index 0 is this provider+slot
                  ranked[0] = { provider: p, slot: pickerFor.slot };
                  openBooking(p, pickerFor.slot, aiQuery || "General consultation", { ranked, selectedIndex: 0 });
                }} className="text-left rounded-xl border border-border hover:border-accent p-3 transition">
                  <div className="font-medium text-sm">{p.display_name}</div>
                  <div className="text-xs text-muted-foreground">{p.specialty} · {p.location}</div>
                </button>
              ))}
            </div>
            <Button variant="ghost" className="mt-4 w-full" onClick={() => setPickerFor(null)}>Cancel</Button>
          </div>
        </div>
      )}

      <BookingDialog
        open={!!bookingState}
        onClose={() => setBookingState(null)}
        provider={bookingState?.provider ?? null}
        slot={bookingState?.slot ?? null}
        reason={bookingState?.reason ?? ""}
        ranked={bookingState?.ranked}
        selectedIndex={bookingState?.selectedIndex}
      />
    </div>
  );
}
