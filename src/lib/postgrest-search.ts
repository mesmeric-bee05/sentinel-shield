/**
 * Helpers for embedding caller-supplied text in PostgREST filters.
 *
 * PostgREST `or(...)` filters use `,`, `(`, `)` and `"` as syntax, so any of
 * those inside a search term would let the caller alter the filter's meaning.
 * Strip them and escape LIKE wildcards so the term only ever matches literally.
 */
export function ilikeTerm(raw: string): string {
  return raw
    .replace(/[,()"'\\]/g, " ")
    .replace(/[%_]/g, (m) => `\\${m}`)
    .trim()
    .slice(0, 120);
}
