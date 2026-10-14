import type { ExecutionEnvironmentPlatformOs } from "@t3tools/contracts";

export type PendingModifier = "ctrl" | "meta";
export type HostPlatform = "mac" | "linux" | "windows" | "unknown";

/** Upper bound of `TerminalWriteInput.data`; longer writes are rejected by the server. */
export const TERMINAL_WRITE_MAX_LENGTH = 65_536;

export type ModifiedTerminalInput =
  | { readonly kind: "write"; readonly data: string }
  | { readonly kind: "paste" };

// C0 controls other than tab, LF, and CR, plus DEL.
// eslint-disable-next-line no-control-regex -- Pasted text must not carry raw terminal controls.
const UNSAFE_PASTE_BYTES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Encodes a key using the toolbar's one-shot Ctrl modifier. */
export function applyCtrlModifier(input: string): string {
  const firstCharacter = input[0];
  if (!firstCharacter) {
    return input;
  }

  const lowerCharacter = firstCharacter.toLowerCase();
  if (lowerCharacter >= "a" && lowerCharacter <= "z") {
    return String.fromCharCode(lowerCharacter.charCodeAt(0) - 96);
  }

  if (firstCharacter === "@") return "\u0000";
  if (firstCharacter === "[") return "\u001b";
  if (firstCharacter === "\\") return "\u001c";
  if (firstCharacter === "]") return "\u001d";
  if (firstCharacter === "^") return "\u001e";
  if (firstCharacter === "_") return "\u001f";
  if (firstCharacter === "?") return "\u007f";

  return input;
}

/** Paste chords use the device clipboard; forwarding Ctrl+V would paste the host clipboard in PowerShell. */
export function resolveModifiedTerminalInput(input: {
  readonly data: string;
  readonly modifier: PendingModifier;
  readonly hostPlatform: HostPlatform;
}): ModifiedTerminalInput {
  const pasteModifier: PendingModifier = input.hostPlatform === "mac" ? "meta" : "ctrl";
  if (input.modifier === pasteModifier && input.data.toLowerCase() === "v") {
    return { kind: "paste" };
  }

  return {
    kind: "write",
    data: input.modifier === "ctrl" ? applyCtrlModifier(input.data) : `\u001b${input.data}`,
  };
}

/** Replace unsafe controls with spaces to defuse embedded paste-end markers; map LF (Ctrl+J) to CR.
 * Native surfaces do not expose bracketed-paste mode. */
export function encodeTerminalPaste(text: string): string {
  return text.replace(UNSAFE_PASTE_BYTES, " ").replace(/\r\n|\n/g, "\r");
}

/** Keeps writes within the wire limit without splitting UTF-16 surrogate pairs. */
export function chunkTerminalWrite(data: string): ReadonlyArray<string> {
  const chunks: string[] = [];
  let start = 0;
  while (start < data.length) {
    let end = Math.min(start + TERMINAL_WRITE_MAX_LENGTH, data.length);
    const last = data.charCodeAt(end - 1);
    if (end < data.length && last >= 0xd800 && last <= 0xdbff) {
      end -= 1;
    }
    chunks.push(data.slice(start, end));
    start = end;
  }
  return chunks;
}

/** Returns null for unknown hosts so callers can use a weaker platform hint. */
export function hostPlatformFromOs(os: ExecutionEnvironmentPlatformOs | null): HostPlatform | null {
  if (os === "darwin") return "mac";
  if (os === "linux") return "linux";
  if (os === "windows") return "windows";
  return null;
}
