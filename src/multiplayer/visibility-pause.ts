/**
 * Hidden tabs release realtime seats after a grace period, then rejoin on return.
 * `onShown` runs each time the page becomes visible again, whether or not the grace period ran out.
 */
export function createVisibilityPause(onPause: () => void, onResume: () => void,
  source: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> | undefined = typeof document === 'undefined' ? undefined : document,
  delayMs = 30000, onShown?: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined, paused = false;
  function changed(event?: Event) {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (source?.hidden) {
      if (!paused) timer = setTimeout(() => { timer = undefined; paused = true; onPause(); }, delayMs);
    } else {
      if (paused) { paused = false; onResume(); }
      if (event) onShown?.();
    }
  }
  source?.addEventListener('visibilitychange', changed);
  changed();
  return {
    get paused() { return paused; },
    get hidden() { return !!source?.hidden; },
    dispose() { if (timer !== undefined) clearTimeout(timer); source?.removeEventListener('visibilitychange', changed); },
  };
}
