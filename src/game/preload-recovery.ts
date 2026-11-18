const KEY = 'city-preload-reload';
const RETRY_WINDOW_MS = 60_000;

/** One recovery reload across builds/tabs' navigation, even when storage is disabled. */
export function installPreloadRecovery(host: Window = window, now: () => number = Date.now) {
  let attempted = false;
  const handle = (event: Event) => {
    if (attempted || !host.navigator.onLine) return;
    try {
      const previous = Number(host.sessionStorage.getItem(KEY));
      if (previous && now() - previous < RETRY_WINDOW_MS) return;
      host.sessionStorage.setItem(KEY, String(now()));
    } catch { return; } // Without persistent state a reload cannot be made loop-safe.
    attempted = true;
    event.preventDefault();
    host.location.reload();
  };
  host.addEventListener('vite:preloadError', handle);
  return () => host.removeEventListener('vite:preloadError', handle);
}
