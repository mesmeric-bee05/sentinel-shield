// Pure rollup helpers for the security-sync metrics panel.
// Shared by the admin UI and the parity test so the rendered chart and the
// server metrics response can be asserted equal.
import type { SecuritySyncDailyMetric } from "@/lib/security.functions";

export type DayRollup = { day: string; accepted: number; other: number; total: number };

/** Group daily metric rows into an accepted / non-accepted split, newest first. */
export function rollupByDay(metrics: SecuritySyncDailyMetric[], limitDays = 14): DayRollup[] {
  const byDay = new Map<string, { accepted: number; other: number }>();
  for (const m of metrics) {
    const key = m.day.slice(0, 10);
    const row = byDay.get(key) ?? { accepted: 0, other: 0 };
    if (m.status === "accepted") row.accepted += m.count;
    else row.other += m.count;
    byDay.set(key, row);
  }
  return [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, limitDays)
    .map(([day, v]) => ({ day, accepted: v.accepted, other: v.other, total: v.accepted + v.other }));
}

/** Totals across the whole rollup window. */
export function rollupTotals(rows: DayRollup[]): { accepted: number; other: number; total: number } {
  return rows.reduce(
    (acc, r) => ({ accepted: acc.accepted + r.accepted, other: acc.other + r.other, total: acc.total + r.total }),
    { accepted: 0, other: 0, total: 0 },
  );
}

/** Same ordering/tie-break the server uses for the top-offender list. */
export function rankIps(counts: Record<string, number>, limit = 10): { source_ip: string; count: number }[] {
  return Object.entries(counts)
    .map(([source_ip, count]) => ({ source_ip, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
