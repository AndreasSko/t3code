import { type ChangeEvent, type KeyboardEvent, useState } from "react";

/**
 * Spread the returned props onto Input; commit on blur/Enter to avoid per-keystroke settings writes.
 * Upstream values resync only while unfocused so external updates cannot clobber an active edit.
 */
export function useCommitOnBlur(value: string, onCommit: (next: string) => void) {
  const [draft, setDraft] = useState<string | null>(null);

  return {
    value: draft ?? value,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      setDraft(event.target.value);
    },
    onFocus: () => {
      setDraft(value);
    },
    onBlur: () => {
      const next = draft ?? value;
      setDraft(null);
      if (next !== value) {
        onCommit(next);
      }
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter") {
        event.preventDefault();
        (event.target as HTMLInputElement).blur();
      }
    },
  };
}
