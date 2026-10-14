import { useEffect } from "react";
import { AppState } from "react-native";
import { scheduleOnUI } from "react-native-worklets";

function collectUiRuntimeGarbage() {
  "worklet";
  // Hermes exposes `gc` on the worklets UI runtime; skip quietly on runtimes that do not.
  const gc = (globalThis as { gc?: () => void }).gc;
  if (typeof gc === "function") gc();
}

/**
 * React Native's iOS memory warnings collect only the main JS heap.
 * Collect worklets' separate Hermes heap to release retained shadow nodes and serializables.
 */
export function useUiRuntimeMemoryWarningGc() {
  useEffect(() => {
    const subscription = AppState.addEventListener("memoryWarning", () => {
      scheduleOnUI(collectUiRuntimeGarbage);
    });
    return () => subscription.remove();
  }, []);
}
