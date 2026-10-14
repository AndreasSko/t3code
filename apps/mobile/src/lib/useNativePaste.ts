import type { PasteEventPayload } from "expo-paste-input";
import { useCallback } from "react";

/** Handles image pastes for expo-paste-input; text pastes remain owned by the native TextInput. */
export function useNativePaste(onImages: (uris: ReadonlyArray<string>) => void) {
  return useCallback(
    (payload: PasteEventPayload) => {
      if (payload.type === "images" && payload.uris && payload.uris.length > 0) {
        onImages(payload.uris);
      }
    },
    [onImages],
  );
}
