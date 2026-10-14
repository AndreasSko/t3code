import { Easing, ReduceMotion } from "react-native-reanimated";

/**
 * Match pane durations and easing so simultaneous sidebar/inspector swaps
 * do not make the center pane wobble.
 */
export const WORKSPACE_PANE_TIMING = {
  duration: 260,
  easing: Easing.inOut(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;
