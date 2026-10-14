const MODEL_PICKER_CONTENT_SELECTOR = "[data-model-picker-content]";

/** Read the mounted popover directly for shortcut arbitration so a mirrored visibility store cannot drift. */
export function isModelPickerOpen(): boolean {
  return (
    typeof document !== "undefined" &&
    document.querySelector(MODEL_PICKER_CONTENT_SELECTOR) !== null
  );
}
