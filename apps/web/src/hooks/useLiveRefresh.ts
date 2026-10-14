/**
 * Refresh on return and while actively viewed; throttle all triggers together and skip the first arrival
 * because the view already has its initial read in flight.
 */
import { useEffect, useId, useRef } from "react";

/** Long enough that alt-tabbing through windows does not become a request per tab stop. */
export const LIVE_REFRESH_MIN_INTERVAL_MS = 10_000;

/** Slow enough to preserve host quota while still updating a view left open. */
export const LIVE_REFRESH_INTERVAL_MS = 5 * 60_000;

/** Stop after six idle minutes, allowing the five-minute refresh first; interaction resumes reads. */
export const LIVE_REFRESH_IDLE_AFTER_MS = 6 * 60_000;

/** Refresh only while visible and after the minimum interval; missed ticks collapse into one read. */
export function shouldLiveRefresh(input: {
  readonly visible: boolean;
  readonly now: number;
  readonly lastRefreshedAt: number;
}): boolean {
  return input.visible && input.now - input.lastRefreshedAt >= LIVE_REFRESH_MIN_INTERVAL_MS;
}

/** Skip the first arrival because mount already reads; another read would cancel it and spend quota twice. */
export function shouldRefreshOnArrival(input: {
  readonly visible: boolean;
  readonly now: number;
  readonly lastRefreshedAt: number | undefined;
}): boolean {
  return (
    input.lastRefreshedAt !== undefined &&
    shouldLiveRefresh({ ...input, lastRefreshedAt: input.lastRefreshedAt })
  );
}

export function shouldRefreshOnInterval(input: {
  readonly visible: boolean;
  readonly now: number;
  readonly lastRefreshedAt: number;
  readonly lastInteractedAt: number;
}): boolean {
  return (
    input.now - input.lastInteractedAt < LIVE_REFRESH_IDLE_AFTER_MS && shouldLiveRefresh(input)
  );
}

/** Keep per-view timestamps outside React so remounting cannot bypass the refresh interval. */
const lastRefreshedAtByView = new Map<string, number>();

/** Track activity per window, only while a live view is mounted. */
let lastInteractedAt = 0;
const interactionWatchers = new Set<() => void>();
const INTERACTION_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel"] as const;
const noteInteraction = () => {
  const now = Date.now();
  const wasIdle = now - lastInteractedAt >= LIVE_REFRESH_IDLE_AFTER_MS;
  lastInteractedAt = now;
  if (wasIdle) for (const resume of interactionWatchers) resume();
};

function watchInteraction(resume: () => void): () => void {
  if (interactionWatchers.size === 0) {
    lastInteractedAt = Date.now();
    for (const event of INTERACTION_EVENTS) {
      document.addEventListener(event, noteInteraction, { passive: true });
    }
  }
  interactionWatchers.add(resume);
  return () => {
    interactionWatchers.delete(resume);
    if (interactionWatchers.size > 0) return;
    for (const event of INTERACTION_EVENTS) {
      document.removeEventListener(event, noteInteraction);
    }
  };
}

export function useLiveRefresh(
  refresh: (() => void) | null,
  options: {
    readonly enabled?: boolean;
    readonly key?: string;
    readonly intervalMs?: number;
  } = {},
): void {
  const { enabled = true, key, intervalMs = LIVE_REFRESH_INTERVAL_MS } = options;
  // Held in a ref so a caller can pass a fresh closure every render without re-arming the
  // listeners, which would otherwise refresh on every render that changed anything at all.
  const latest = useRef(refresh);
  latest.current = refresh;
  // A keyed view tracks the thing being shown, not the panel slot; otherwise tree position identifies the
  // view.
  const fallbackViewId = useId();
  const viewId = key ?? fallbackViewId;

  useEffect(() => {
    if (!enabled) return;
    const read = (now: number) => {
      if (latest.current === null) return;
      lastRefreshedAtByView.set(viewId, now);
      latest.current();
    };
    const visible = () => document.visibilityState === "visible";
    const onArrival = () => {
      const now = Date.now();
      if (now - lastInteractedAt >= LIVE_REFRESH_IDLE_AFTER_MS) return;
      const lastRefreshedAt = lastRefreshedAtByView.get(viewId);
      if (lastRefreshedAt === undefined) {
        lastRefreshedAtByView.set(viewId, now);
        return;
      }
      if (shouldRefreshOnArrival({ visible: visible(), now, lastRefreshedAt })) read(now);
    };
    const onInterval = () => {
      const now = Date.now();
      const lastRefreshedAt = lastRefreshedAtByView.get(viewId) ?? now;
      if (shouldRefreshOnInterval({ visible: visible(), now, lastRefreshedAt, lastInteractedAt })) {
        read(now);
      }
    };

    let timer: ReturnType<typeof setInterval> | undefined;
    // Run the timer only while visible; return from hidden state needs one read, not every missed tick.
    const syncTimer = () => {
      clearInterval(timer);
      timer = visible() ? setInterval(onInterval, intervalMs) : undefined;
    };
    const onVisibilityChange = () => {
      onArrival();
      syncTimer();
    };

    const stopWatchingInteraction = watchInteraction(() => {
      onArrival();
      syncTimer();
    });
    onArrival();
    syncTimer();
    window.addEventListener("focus", onArrival);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onArrival);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopWatchingInteraction();
    };
  }, [enabled, viewId, intervalMs]);
}
