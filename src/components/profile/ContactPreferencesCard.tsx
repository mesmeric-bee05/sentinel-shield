import { useEffect, useState } from "react";
import { Loader2, Phone, Save } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getPatientContact, updatePatientContact } from "@/server/profile.functions";

export function ContactPreferencesCard() {
  const get = useServerFn(getPatientContact);
  const update = useServerFn(updatePatientContact);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [phone, setPhone] = useState("");
  const [optIn, setOptIn] = useState(false);

  useEffect(() => {
    get({}).then((r) => { setPhone(r.phoneE164 ?? ""); setOptIn(r.smsOptIn); }).finally(() => setLoading(false));
  }, [get]);

  const save = async () => {
    setSaving(true);
    try {
      const trimmed = phone.trim();
      if (trimmed && !/^\+[1-9]\d{6,14}$/.test(trimmed)) {
        toast.error("Phone must be in E.164 format, e.g. +14155552671");
        return;
      }
      const r = await update({ data: { phoneE164: trimmed || null, smsOptIn: optIn && !!trimmed } });
      if (!r.ok) toast.error(r.error ?? "Save failed"); else toast.success("Saved");
    } finally { setSaving(false); }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-accent mb-1"><Phone className="w-3.5 h-3.5" />SMS reminders</div>
      <h3 className="font-serif text-lg">Text confirmations</h3>
      <p className="text-xs text-muted-foreground mt-1">We'll text booking confirmations and reminders. Opt out anytime.</p>
      <div className="mt-4 space-y-3">
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+14155552671" disabled={loading} />
        <label className="flex items-center justify-between text-sm">
          <span>Send me SMS confirmations</span>
          <Switch checked={optIn} onCheckedChange={setOptIn} disabled={loading || !phone.trim()} />
        </label>
        <Button onClick={save} disabled={saving || loading} size="sm" className="w-full">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4 mr-2" />Save preferences</>}
        </Button>
      </div>
    </div>
  );
}
