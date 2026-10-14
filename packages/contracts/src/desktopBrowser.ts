import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Desktop tabs use newline-delimited JSON over private bootstrap descriptors, with no listening port.
 * CDP frames pass unchanged through one connection per tabId. */

const TabKey = {
  threadId: TrimmedNonEmptyString,
  tabId: TrimmedNonEmptyString,
};

/** Desktop -> server. */
export const DesktopBrowserEvent = Schema.Union([
  /** A desktop `<webview>` for this server tab is attached and can be driven. */
  Schema.Struct({ type: Schema.Literal("attached"), ...TabKey }),
  /** Its `<webview>` went away: closed, crashed, swapped, or devtools took the debugger. */
  Schema.Struct({ type: Schema.Literal("detached"), ...TabKey }),
  Schema.Struct({ type: Schema.Literal("cdp"), ...TabKey, message: Schema.String }),
]);
export type DesktopBrowserEvent = typeof DesktopBrowserEvent.Type;

/** Server -> desktop. */
export const DesktopBrowserCommand = Schema.Union([
  Schema.Struct({ type: Schema.Literal("cdp"), ...TabKey, message: Schema.String }),
  /** The server stopped driving this tab, so the relay can drop its sessions. */
  Schema.Struct({ type: Schema.Literal("release"), ...TabKey }),
  /** Where an agent action is about to land, so the desktop draws its cursor there. */
  Schema.Struct({
    type: Schema.Literal("pointer"),
    ...TabKey,
    phase: Schema.Literals(["move", "click"]),
    x: Schema.Finite,
    y: Schema.Finite,
  }),
]);
export type DesktopBrowserCommand = typeof DesktopBrowserCommand.Type;
