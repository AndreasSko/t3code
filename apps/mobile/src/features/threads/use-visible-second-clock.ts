import { useIsFocused } from "@react-navigation/native";
import { useEffect, useLayoutEffect, useState } from "react";
import { AppState } from "react-native";

/** Gate hidden retained routes to avoid re-renders, and refresh before paint when ticking resumes. */
export function useVisibleSecondClock(enabled: boolean): number {
  const focused = useIsFocused();
  const [appActive, setAppActive] = useState(() => AppState.currentState === "active");
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setAppActive(state === "active"),
    );
    // A change between the first render and this subscription has no event to replay.
    // oxlint-disable-next-line react/set-state-in-effect -- Syncs state the listener missed.
    setAppActive(AppState.currentState === "active");
    return () => subscription.remove();
  }, []);
  const ticking = enabled && focused && appActive;
  useLayoutEffect(() => {
    if (!ticking) return;
    // oxlint-disable-next-line react/set-state-in-effect -- Resuming reads the clock that stood still.
    setNowMs(Date.now());
    const intervalId = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(intervalId);
  }, [ticking]);
  return nowMs;
}
