import type { BrowserLinkTarget, ScopedThreadRef } from "@t3tools/contracts";

import { ensureClientSettingsHydrated, getClientSettings } from "~/hooks/useSettings";
import { isPreviewAvailableFor } from "./previewRuntime";

export interface ResolveLinkTargetInput {
  readonly url: string;
  /** Cmd/Ctrl-click always goes to the system browser, whatever the default. */
  readonly event: { readonly metaKey: boolean; readonly ctrlKey: boolean };
  readonly preference: BrowserLinkTarget;
  readonly canOpenInApp: boolean;
}

/** Cmd/Ctrl-click provides an escape to the system browser when the default is in-app. */
export function resolveLinkTarget(input: ResolveLinkTargetInput): BrowserLinkTarget {
  if (input.event.metaKey || input.event.ctrlKey) return "system";
  if (input.preference !== "app") return "system";
  if (!input.canOpenInApp) return "system";
  if (!isWebUrl(input.url)) return "system";
  return "app";
}

/** Non-HTTP schemes belong to the shell; the in-app browser cannot load them. */
export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Wait for hydration so a persisted in-app preference is not replaced by the schema default. */
export async function resolveBrowserLinkTargetPreference(): Promise<BrowserLinkTarget> {
  await ensureClientSettingsHydrated();
  return getClientSettings().browserLinkTarget;
}

export function canOpenLinksInApp(threadRef: ScopedThreadRef | null | undefined): boolean {
  return threadRef != null && isPreviewAvailableFor(threadRef.environmentId);
}
