import { useSyncExternalStore } from "react";

/** One shared timer supplies minute-quantized YYYY-MM-DDTHH:MM snapshots to every consumer. */

function currentMinute(): string {
  return new Date().toISOString().slice(0, 16);
}

let nowMinute = currentMinute();
let timerId: number | null = null;
let timerIsInterval = false;
const listeners = new Set<() => void>();

function tick(): void {
  const next = currentMinute();
  if (next !== nowMinute) {
    nowMinute = next;
    for (const listener of listeners) listener();
  }
}

function startTimer(): void {
  // Reread the clock at each UTC minute boundary so throttled or delayed timers self-correct.
  timerIsInterval = false;
  timerId = window.setTimeout(
    () => {
      tick();
      timerIsInterval = true;
      timerId = window.setInterval(tick, 60_000);
    },
    60_000 - (Date.now() % 60_000),
  );
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    startTimer();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timerId !== null) {
      if (timerIsInterval) window.clearInterval(timerId);
      else window.clearTimeout(timerId);
      timerId = null;
    }
  };
}

function getSnapshot(): string {
  // Without a timer the cached minute may be stale; reread on mount. With a timer, keep snapshots stable
  // between notifications as useSyncExternalStore requires.
  if (timerId === null) {
    nowMinute = currentMinute();
  }
  return nowMinute;
}

export function useNowMinute(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
