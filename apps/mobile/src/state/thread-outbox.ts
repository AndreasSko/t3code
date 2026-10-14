import { appAtomRegistry } from "./atom-registry";
import { createThreadOutboxManager } from "./thread-outbox-manager";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import { expoThreadOutboxStorage, flushThreadOutboxWrites } from "./thread-outbox-storage";

export * from "./thread-outbox-model";

export const threadOutboxManager = createThreadOutboxManager({
  registry: appAtomRegistry,
  storage: expoThreadOutboxStorage,
});

/** Flush queued mutations before restart; waiting only for writes already mid-file would miss enqueues. */
export async function flushThreadOutbox(): Promise<void> {
  await threadOutboxManager.serialize(async () => {});
  await flushThreadOutboxWrites();
}

export function enqueueThreadOutboxMessage(message: QueuedThreadMessage): Promise<void> {
  return threadOutboxManager.enqueue(message);
}

/** Waits for pending writes to settle; false if the message was rolled back. */
export function confirmThreadOutboxMessageQueued(message: QueuedThreadMessage): Promise<boolean> {
  return threadOutboxManager.confirmQueued(message);
}

/** False when removed or superseded since expectedRevision was captured; never resurrect a stale payload. */
export function updateThreadOutboxMessage(
  message: QueuedThreadMessage,
  expectedRevision?: number,
): Promise<boolean> {
  return threadOutboxManager.update(message, expectedRevision);
}

/** Snapshot of a queued message's write revision, for update's CAS. */
export function threadOutboxRevision(messageId: QueuedThreadMessage["messageId"]): number {
  return threadOutboxManager.revisionOf(messageId);
}

// Removal also needs composer references for file cleanup; keep that dependency out of this module.
