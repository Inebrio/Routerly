/**
 * Capture mode — the one flag `scripts/capture-screenshots.mjs` sets on every URL it
 * navigates to, so documentation screenshots can suppress values that are correct but
 * non-deterministic (wall-clock reads: an uptime counter, a "last updated" clock, measured
 * request timings). No real user ever visits a URL carrying this query parameter, so this
 * can never affect a real user's UI — it is not read from any header, cookie or storage a
 * real session could set.
 *
 * Single suppression mechanism: every capture-only override in the dashboard goes through
 * this one flag, checked at the exact point a live value would otherwise render.
 */
export function isCaptureMode(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('routerlyCapture');
}
