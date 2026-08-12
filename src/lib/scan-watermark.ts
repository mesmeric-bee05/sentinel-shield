// Watermark bookkeeping for the security scan diff page.
//
// Realtime channels drop messages during reconnects and browser sleep, so the
// diff page also tracks the newest scan timestamp it has rendered. Whenever the
// socket resubscribes, the tab becomes visible, or the network returns, we ask
// the server for the newest scan timestamp and compare against the watermark —
// if the server is ahead, a scan completed while we were disconnected and the
// diff is refetched.

export type Watermark = string | null;

/** True when the server has a newer scan than the one currently rendered. */
export function isStale(current: Watermark, serverLatest: Watermark): boolean {
  if (!serverLatest) return false;
  if (!current) return true;
  return new Date(serverLatest).getTime() > new Date(current).getTime();
}

/** Keep the newest of the two timestamps. */
export function advanceWatermark(current: Watermark, next: Watermark): Watermark {
  if (!next) return current;
  if (!current) return next;
  return new Date(next).getTime() > new Date(current).getTime() ? next : current;
}
