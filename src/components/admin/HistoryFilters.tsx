import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Download, Search, X } from "lucide-react";

export type HistoryFilterState = {
  q: string;
  from: string; // yyyy-mm-dd
  to: string;
  status: string; // "" | "success" | "failed" | "warn" | "pass" | "fail"
};

export const emptyFilters: HistoryFilterState = { q: "", from: "", to: "", status: "" };

export function HistoryFilters({
  value, onChange, statusOptions, onExportCsv, onExportJson, searchPlaceholder = "Search…",
}: {
  value: HistoryFilterState;
  onChange: (v: HistoryFilterState) => void;
  statusOptions: { value: string; label: string }[];
  onExportCsv: () => void;
  onExportJson: () => void;
  searchPlaceholder?: string;
}) {
  const set = (patch: Partial<HistoryFilterState>) => onChange({ ...value, ...patch });
  const hasFilters = value.q || value.from || value.to || value.status;
  return (
    <div className="flex flex-wrap items-end gap-2 mb-3">
      <div className="flex-1 min-w-[180px]">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Search</label>
        <div className="relative">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={value.q} onChange={(e) => set({ q: e.target.value })} placeholder={searchPlaceholder} className="pl-7 h-8 text-xs" />
        </div>
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">From</label>
        <Input type="date" value={value.from} onChange={(e) => set({ from: e.target.value })} className="h-8 text-xs w-[140px]" />
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">To</label>
        <Input type="date" value={value.to} onChange={(e) => set({ to: e.target.value })} className="h-8 text-xs w-[140px]" />
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</label>
        <select value={value.status} onChange={(e) => set({ status: e.target.value })} className="h-8 text-xs rounded-md border border-input bg-background px-2">
          <option value="">All</option>
          {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={() => onChange(emptyFilters)} className="h-8 text-xs">
          <X className="w-3 h-3 mr-1" />Clear
        </Button>
      )}
      <div className="ml-auto flex gap-1">
        <Button variant="outline" size="sm" onClick={onExportCsv} className="h-8 text-xs"><Download className="w-3 h-3 mr-1" />CSV</Button>
        <Button variant="outline" size="sm" onClick={onExportJson} className="h-8 text-xs"><Download className="w-3 h-3 mr-1" />JSON</Button>
      </div>
    </div>
  );
}

export function applyHistoryFilter<T>(
  rows: T[],
  f: HistoryFilterState,
  getters: { date: (r: T) => string | null; status: (r: T) => string | null; searchable: (r: T) => string },
): T[] {
  const q = f.q.trim().toLowerCase();
  const fromMs = f.from ? new Date(f.from).getTime() : null;
  const toMs = f.to ? new Date(f.to).getTime() + 86_399_000 : null;
  return rows.filter((r) => {
    if (q && !getters.searchable(r).toLowerCase().includes(q)) return false;
    if (f.status && getters.status(r) !== f.status) return false;
    const d = getters.date(r);
    if (d) {
      const t = new Date(d).getTime();
      if (fromMs !== null && t < fromMs) return false;
      if (toMs !== null && t > toMs) return false;
    }
    return true;
  });
}

export function paginate<T>(rows: T[], page: number, pageSize: number): { slice: T[]; total: number; pages: number } {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pages);
  const start = (safePage - 1) * pageSize;
  return { slice: rows.slice(start, start + pageSize), total, pages };
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 mt-3 text-xs">
      <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} className="h-7">Prev</Button>
      <span className="text-muted-foreground">Page {page} / {pages}</span>
      <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} className="h-7">Next</Button>
    </div>
  );
}
