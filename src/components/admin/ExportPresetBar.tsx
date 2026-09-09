// Saved filter presets for the export audit panel.
// Presets belong to the admin who created them; shared ones are read-only for
// everyone else (enforced server-side, mirrored here by hiding delete).
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bookmark, Loader2, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listExportFilterPresets,
  saveExportFilterPreset,
  deleteExportFilterPreset,
  type ExportFilterPreset,
} from "@/lib/security-presets.functions";

export type PresetValues = {
  dataset: string | null;
  actor_filter: string | null;
  scan_window_from: string | null;
  scan_window_to: string | null;
  date_from: string | null;
  date_to: string | null;
};

export function ExportPresetBar({
  current,
  onApply,
}: {
  current: PresetValues;
  onApply: (p: ExportFilterPreset) => void;
}) {
  const listFn = useServerFn(listExportFilterPresets);
  const saveFn = useServerFn(saveExportFilterPreset);
  const deleteFn = useServerFn(deleteExportFilterPreset);

  const [presets, setPresets] = useState<ExportFilterPreset[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [naming, setNaming] = useState(false);
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = await listFn({ data: undefined });
      if (res.error) { setError(res.error); return; }
      setError(null);
      setPresets(res.presets);
    } catch {
      setError("Could not load presets.");
    }
  };

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const apply = (id: string) => {
    setSelected(id);
    const p = presets.find((x) => x.id === id);
    if (p) onApply(p);
  };

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await saveFn({ data: { name: name.trim(), status_filter: null, search: null, is_shared: shared, ...current } });
      if (res.error) setError(res.error);
      else {
        setError(null);
        setNaming(false);
        setName("");
        setShared(false);
        await refresh();
        if (res.preset) setSelected(res.preset.id);
      }
    } catch {
      setError("Could not save preset.");
    }
    setBusy(false);
  };

  const remove = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await deleteFn({ data: { id: selected } });
      if (res.error) setError(res.error);
      else { setSelected(""); await refresh(); }
    } catch {
      setError("Could not delete preset.");
    }
    setBusy(false);
  };

  const selectedPreset = presets.find((p) => p.id === selected);

  return (
    <div className="px-5 py-2 border-b border-border/60 flex flex-wrap items-center gap-2 text-xs">
      <Bookmark className="w-3.5 h-3.5 text-muted-foreground" />
      <select
        className="h-8 rounded-md border border-input bg-background px-2 text-xs min-w-44"
        value={selected}
        onChange={(e) => apply(e.target.value)}
        aria-label="Saved filter preset"
      >
        <option value="">Saved presets…</option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>{p.name}{p.is_shared ? " (shared)" : ""}</option>
        ))}
      </select>

      {naming ? (
        <>
          <Input
            className="h-8 text-xs w-44"
            autoFocus
            placeholder="Preset name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setNaming(false); }}
          />
          <label className="flex items-center gap-1 text-muted-foreground">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            Share with admins
          </label>
          <Button size="sm" className="h-8 text-xs" disabled={busy || !name.trim()} onClick={() => void save()}>
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setNaming(false)}>Cancel</Button>
        </>
      ) : (
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setNaming(true)}>
          <Save className="w-3 h-3 mr-1" />Save current filters
        </Button>
      )}

      {selectedPreset && !selectedPreset.is_shared && !naming && (
        <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive" disabled={busy} onClick={() => void remove()}>
          <Trash2 className="w-3 h-3 mr-1" />Delete
        </Button>
      )}

      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
}
