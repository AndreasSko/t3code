import { useEffect, useRef, useState } from "react";
import { isEditableFocused } from "./lib/editableFocus";

export interface ShortcutModifierState {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const EMPTY_SHORTCUT_MODIFIER_STATE: ShortcutModifierState = {
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
};

export function areShortcutModifierStatesEqual(
  left: ShortcutModifierState,
  right: ShortcutModifierState,
): boolean {
  return (
    left.metaKey === right.metaKey &&
    left.ctrlKey === right.ctrlKey &&
    left.altKey === right.altKey &&
    left.shiftKey === right.shiftKey
  );
}

export function useShortcutModifierState(ignoreEditable = false): ShortcutModifierState {
  const [state, setState] = useState(EMPTY_SHORTCUT_MODIFIER_STATE);
  const stateRef = useRef(EMPTY_SHORTCUT_MODIFIER_STATE);

  useEffect(() => {
    const updateState = (next: ShortcutModifierState) => {
      // Even a no-op state dispatch can cost work in the sidebar's large tree.
      // Ordinary typing must return before dispatching a React update.
      if (areShortcutModifierStatesEqual(stateRef.current, next)) return;
      stateRef.current = next;
      setState(next);
    };
    const onKeyboardEvent = (event: KeyboardEvent) => {
      updateState(
        ignoreEditable && isEditableFocused(event.target)
          ? EMPTY_SHORTCUT_MODIFIER_STATE
          : shortcutModifierStateAfterKeyboardEvent(stateRef.current, event),
      );
    };
    // Dictation can synthesize Meta+V without keyup; reset on paste so jump hints do not stick. A physically
    // held modifier registers again on the next real key event.
    const onResetEvent = () => {
      updateState(EMPTY_SHORTCUT_MODIFIER_STATE);
    };

    const onFocus = (event: FocusEvent) => {
      if (ignoreEditable && isEditableFocused(event.target)) onResetEvent();
    };
    window.addEventListener("focusin", onFocus);
    window.addEventListener("keydown", onKeyboardEvent, true);
    window.addEventListener("keyup", onKeyboardEvent, true);
    window.addEventListener("paste", onResetEvent, true);
    window.addEventListener("blur", onResetEvent);
    return () => {
      window.removeEventListener("focusin", onFocus);
      window.removeEventListener("keydown", onKeyboardEvent, true);
      window.removeEventListener("keyup", onKeyboardEvent, true);
      window.removeEventListener("paste", onResetEvent, true);
      window.removeEventListener("blur", onResetEvent);
    };
  }, [ignoreEditable]);

  return state;
}

function normalizeModifierKey(key: string): keyof ShortcutModifierState | null {
  switch (key) {
    case "Meta":
    case "OS":
    case "Command":
      return "metaKey";
    case "Control":
      return "ctrlKey";
    case "Alt":
    case "Option":
      return "altKey";
    case "Shift":
      return "shiftKey";
    default:
      return null;
  }
}

export function shortcutModifierStateAfterKeyboardEvent(
  currentState: ShortcutModifierState,
  event: KeyboardEvent,
): ShortcutModifierState {
  const normalizedModifierKey = normalizeModifierKey(event.key);
  let nextState: ShortcutModifierState;
  if (normalizedModifierKey) {
    nextState = {
      ...currentState,
      [normalizedModifierKey]: event.type === "keydown",
    };
  } else {
    // Set held modifiers only on real modifier keydown; synthetic dictation Meta+V can leave metaKey stuck true
    // on later non-modifier events, which may only clear bits.
    nextState = {
      metaKey: currentState.metaKey && event.metaKey,
      ctrlKey: currentState.ctrlKey && event.ctrlKey,
      altKey: currentState.altKey && event.altKey,
      shiftKey: currentState.shiftKey && event.shiftKey,
    };
  }

  return areShortcutModifierStatesEqual(currentState, nextState) ? currentState : nextState;
}
