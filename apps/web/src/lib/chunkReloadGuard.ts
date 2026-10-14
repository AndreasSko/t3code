// Lazy chunk requests can 404 after deploys; reload once for fresh assets. Keep a session guard against
// loops.
const CHUNK_RELOAD_GUARD_KEY = "t3code:chunk-load-reloaded";

/**
 * Called by vite:preloadError; returns whether it reloaded so the caller can decide whether to surface the
 * error.
 */
export function reloadOnceForChunkLoadError(
  getStorage: () => Storage = () => window.sessionStorage,
  reload: () => void = () => window.location.reload(),
): boolean {
  let alreadyReloaded: boolean;
  try {
    const storage = getStorage();
    alreadyReloaded = storage.getItem(CHUNK_RELOAD_GUARD_KEY) === "1";
    if (!alreadyReloaded) storage.setItem(CHUNK_RELOAD_GUARD_KEY, "1");
  } catch {
    // Without storage the guard cannot survive a reload, so a persistent
    // failure would loop forever. Let the error surface instead.
    return false;
  }
  if (alreadyReloaded) return false;
  reload();
  return true;
}

/** Clears the guard after a successful boot so a later stale deploy can reload again. */
export function clearChunkReloadGuard(getStorage: () => Storage = () => window.sessionStorage) {
  try {
    getStorage().removeItem(CHUNK_RELOAD_GUARD_KEY);
  } catch {
    // Blocked storage never held the flag.
  }
}
