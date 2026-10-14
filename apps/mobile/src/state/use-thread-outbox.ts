import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentShellStatus } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, MessageId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "./atom-registry";
import { environmentShell } from "./shell";
import { threadOutboxManager } from "./thread-outbox";

const threadOutboxShellStatusesAtom = Atom.make(
  (get): ReadonlyMap<EnvironmentId, EnvironmentShellStatus> => {
    const statuses = new Map<EnvironmentId, EnvironmentShellStatus>();
    for (const queue of Object.values(get(threadOutboxManager.queuedMessagesByThreadKeyAtom))) {
      const environmentId = queue[0]?.environmentId;
      if (environmentId !== undefined && !statuses.has(environmentId)) {
        statuses.set(environmentId, get(environmentShell.stateValueAtom(environmentId)).status);
      }
    }
    return statuses;
  },
).pipe(Atom.withLabel("mobile:thread-outbox:shell-statuses"));

/** Hold editor-owned or unsaved message ids until their queued payload is current; delivery would send stale content. */
export const editingQueuedMessageIdsAtom = Atom.make<Readonly<Record<MessageId, true>>>({}).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:thread-outbox:editing-message-ids"),
);

export const dispatchingQueuedMessageIdAtom = Atom.make<MessageId | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:thread-outbox:dispatching-message-id"),
);

export function holdEditingQueuedMessage(messageId: MessageId): void {
  const current = appAtomRegistry.get(editingQueuedMessageIdsAtom);
  if (current[messageId]) {
    return;
  }
  appAtomRegistry.set(editingQueuedMessageIdsAtom, { ...current, [messageId]: true });
}

export function releaseEditingQueuedMessage(messageId: MessageId): void {
  const current = appAtomRegistry.get(editingQueuedMessageIdsAtom);
  if (!current[messageId]) {
    return;
  }
  const next = { ...current };
  delete next[messageId];
  appAtomRegistry.set(editingQueuedMessageIdsAtom, next);
}

export function useThreadOutboxMessages() {
  return useAtomValue(threadOutboxManager.queuedMessagesByThreadKeyAtom);
}

/** Shared active-thread keys exclude creations, which have pending-task rows instead. */
export const queuedThreadKeysAtom = Atom.make((get): ReadonlySet<string> => {
  const keys = new Set<string>();
  for (const [threadKey, queue] of Object.entries(
    get(threadOutboxManager.queuedMessagesByThreadKeyAtom),
  )) {
    if (queue.some((message) => message.creation === undefined)) {
      keys.add(threadKey);
    }
  }
  return keys;
}).pipe(Atom.withLabel("mobile:thread-outbox:queued-thread-keys"));

export function useQueuedThreadKeys(): ReadonlySet<string> {
  return useAtomValue(queuedThreadKeysAtom);
}

export function useThreadOutboxShellStatuses() {
  return useAtomValue(threadOutboxShellStatusesAtom);
}
