import type { ScopedThreadRef } from "@t3tools/contracts";

/** Desktop tab identities must include the environment and server epoch: server ids are process-local. */
export function previewRuntimeTabId(
  threadRef: ScopedThreadRef,
  serverEpoch: string | null,
  tabId: string,
): string {
  return JSON.stringify([threadRef.environmentId, threadRef.threadId, serverEpoch, tabId]);
}

export function isCurrentPreviewRuntimeTab(
  threadRef: ScopedThreadRef,
  serverEpoch: string | null,
  tabId: string,
  runtimeTabId: string,
): boolean {
  return previewRuntimeTabId(threadRef, serverEpoch, tabId) === runtimeTabId;
}
