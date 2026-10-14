import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Atom, type AtomRegistry } from "effect/reactivity";

import {
  flattenQueuedThreadMessages,
  groupQueuedThreadMessages,
  type QueuedThreadMessage,
} from "./thread-outbox-model";
import type { ThreadOutboxStorage } from "./thread-outbox-storage";

export class ThreadOutboxManagerError extends Schema.TaggedError<ThreadOutboxManagerError>()(
  "ThreadOutboxManagerError",
  {
    operation: Schema.Literals([
      "load",
      "enqueue",
      "update",
      "remove",
      "clear-environment-load",
      "clear-environment-remove",
    ]),
    environmentId: Schema.NullOr(EnvironmentId),
    threadId: Schema.NullOr(ThreadId),
    messageId: Schema.NullOr(MessageId),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Thread outbox operation ${this.operation} failed for environment ${this.environmentId ?? "unknown"}, thread ${this.threadId ?? "unknown"}, message ${this.messageId ?? "unknown"}.`;
  }
}

export interface ThreadOutboxManagerOptions {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly storage: ThreadOutboxStorage;
  readonly warn?: (message: string, error: unknown) => void;
}

export function createThreadOutboxManager(options: ThreadOutboxManagerOptions) {
  const queuedMessagesByThreadKeyAtom = Atom.make<
    Record<string, ReadonlyArray<QueuedThreadMessage>>
  >({}).pipe(Atom.keepAlive, Atom.withLabel("mobile:thread-outbox:queued-messages"));
  const warn =
    options.warn ??
    ((message: string, error: unknown) => {
      console.warn(message, error);
    });
  let loadPromise: Promise<boolean> | null = null;
  let mutationQueue: Promise<void> = Promise.resolve();
  // Monotonic revisions reject stale writers before their payload reaches disk.
  const revisions = new Map<MessageId, number>();
  const bumpRevision = (messageId: MessageId): void => {
    revisions.set(messageId, (revisions.get(messageId) ?? 0) + 1);
  };

  const serialize = <A>(mutation: () => Promise<A>): Promise<A> => {
    const result = mutationQueue.then(mutation, mutation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const currentMessages = (): ReadonlyArray<QueuedThreadMessage> =>
    flattenQueuedThreadMessages(options.registry.get(queuedMessagesByThreadKeyAtom));

  const setMessages = (messages: ReadonlyArray<QueuedThreadMessage>): void => {
    options.registry.set(queuedMessagesByThreadKeyAtom, groupQueuedThreadMessages(messages));
  };

  // Partial loads recover readable messages but cannot authorize cleanup of unreadable records' files.
  const load = (): Promise<boolean> => {
    if (loadPromise !== null) {
      return loadPromise;
    }
    loadPromise = serialize(async () => {
      const result = await options.storage.load();
      const current = currentMessages();
      const currentIds = new Set(current.map((message) => message.messageId));
      const recovered = result.messages.filter(
        (message) => !currentIds.has(message.messageId) && !revisions.has(message.messageId),
      );
      // Accepted edits and removals win over a later disk read. Retaining
      // current objects also keeps retries from restarting the drain.
      if (recovered.length > 0) setMessages([...recovered, ...current]);
      if (result.errors.length > 0) {
        throw new AggregateError(result.errors, "Some queued messages could not be read.");
      }
      return true;
    }).catch((cause) => {
      loadPromise = null;
      warn(
        "[thread-outbox] failed to load persisted messages",
        new ThreadOutboxManagerError({
          operation: "load",
          environmentId: null,
          threadId: null,
          messageId: null,
          cause,
        }),
      );
      return false;
    });
    return loadPromise;
  };

  // Publish synchronously for immediate composer feedback; disk failures roll this attempt back.
  const enqueue = (message: QueuedThreadMessage): Promise<void> => {
    bumpRevision(message.messageId);
    setMessages([
      ...currentMessages().filter((candidate) => candidate.messageId !== message.messageId),
      message,
    ]);
    return serialize(async () => {
      try {
        await options.storage.write(message);
      } catch (cause) {
        // Roll back by reference so a newer same-id enqueue survives this attempt's failure.
        setMessages(currentMessages().filter((candidate) => candidate !== message));
        // Racing updates may have persisted this payload; remove it if rollback leaves no live entry to avoid resurrection.
        if (!currentMessages().some((candidate) => candidate.messageId === message.messageId)) {
          try {
            await options.storage.remove(message);
          } catch {
            // Best effort: bootstrap reconciles the queue against storage.
          }
        }
        throw new ThreadOutboxManagerError({
          operation: "enqueue",
          environmentId: message.environmentId,
          threadId: message.threadId,
          messageId: message.messageId,
          cause,
        });
      }
    });
  };

  // Wait for mutations before delivery so a failed durable write cannot follow an already-sent message.
  const confirmQueued = (message: QueuedThreadMessage): Promise<boolean> =>
    serialize(async () => currentMessages().some((candidate) => candidate === message));

  // Capture expectedRevision before slow work; a removed or superseded message must never be rewritten.
  // Re-check after writing and persist the winner within this mutation so a crash cannot leave stale state.
  const update = (message: QueuedThreadMessage, expectedRevision?: number): Promise<boolean> =>
    serialize(async () => {
      const staleOrMissing = (): boolean =>
        !currentMessages().some((candidate) => candidate.messageId === message.messageId) ||
        (expectedRevision !== undefined &&
          (revisions.get(message.messageId) ?? 0) !== expectedRevision);
      if (staleOrMissing()) {
        return false;
      }
      try {
        await options.storage.write(message);
      } catch (cause) {
        throw new ThreadOutboxManagerError({
          operation: "update",
          environmentId: message.environmentId,
          threadId: message.threadId,
          messageId: message.messageId,
          cause,
        });
      }
      if (staleOrMissing()) {
        const winner = currentMessages().find(
          (candidate) => candidate.messageId === message.messageId,
        );
        if (winner !== undefined) {
          try {
            await options.storage.write(winner);
          } catch {
            // The winner's own serialized write follows this mutation and
            // owns the failure handling for its payload.
          }
        }
        return false;
      }
      bumpRevision(message.messageId);
      setMessages([
        ...currentMessages().filter((candidate) => candidate.messageId !== message.messageId),
        message,
      ]);
      return true;
    });

  // expectedRevision protects newer edits; canRemove protects ownership changes that do not advance the revision.
  const remove = (
    message: QueuedThreadMessage,
    expectedRevision?: number,
    canRemove?: () => boolean,
  ): Promise<QueuedThreadMessage | null> =>
    serialize(async () => {
      const removalCanceled = (): boolean =>
        (expectedRevision !== undefined &&
          (revisions.get(message.messageId) ?? 0) !== expectedRevision) ||
        canRemove?.() === false;
      if (removalCanceled()) {
        return null;
      }
      // Return the live payload so cleanup includes attachments added after the caller's snapshot.
      const removed =
        currentMessages().find((candidate) => candidate.messageId === message.messageId) ?? message;
      try {
        await options.storage.remove(message);
      } catch (cause) {
        throw new ThreadOutboxManagerError({
          operation: "remove",
          environmentId: message.environmentId,
          threadId: message.threadId,
          messageId: message.messageId,
          cause,
        });
      }
      if (removalCanceled()) {
        // Restore a racing enqueue/editor's payload within this mutation so canceled removal is independently durable.
        const winner = currentMessages().find(
          (candidate) => candidate.messageId === message.messageId,
        );
        if (winner !== undefined) {
          try {
            await options.storage.write(winner);
          } catch (cause) {
            throw new ThreadOutboxManagerError({
              operation: "remove",
              environmentId: message.environmentId,
              threadId: message.threadId,
              messageId: message.messageId,
              cause,
            });
          }
        }
        return null;
      }
      setMessages(
        currentMessages().filter((candidate) => candidate.messageId !== message.messageId),
      );
      // Tombstone revisions to prevent same-id retries from matching pre-removal writers (ABA).
      bumpRevision(message.messageId);
      return removed;
    });

  const clearEnvironment = (
    environmentId: EnvironmentId,
  ): Promise<ReadonlyArray<QueuedThreadMessage>> => {
    // Capture revisions before waiting: entries changed after this request must survive the clear.
    const revisionsAtRequest = new Map(revisions);
    return serialize(async () => {
      const persisted = await options.storage
        .load()
        .then((result) => {
          if (result.errors.length > 0) {
            throw new AggregateError(result.errors, "Some queued messages could not be read.");
          }
          return result.messages;
        })
        .catch((cause) => {
          throw new ThreadOutboxManagerError({
            operation: "clear-environment-load",
            environmentId,
            threadId: null,
            messageId: null,
            cause,
          });
        });
      const allMessages = flattenQueuedThreadMessages(
        groupQueuedThreadMessages([...persisted, ...currentMessages()]),
      );
      const candidates = allMessages.filter(
        (message) =>
          message.environmentId === environmentId &&
          (revisions.get(message.messageId) ?? 0) ===
            (revisionsAtRequest.get(message.messageId) ?? 0),
      );
      const candidateRevisions = new Map(
        candidates.map(
          (message) => [message.messageId, revisions.get(message.messageId) ?? 0] as const,
        ),
      );
      const removedFromStorage = new Set<MessageId>();

      await Promise.all(
        candidates.map(async (message) => {
          try {
            await options.storage.remove(message);
            removedFromStorage.add(message.messageId);
          } catch (cause) {
            warn(
              "[thread-outbox] failed to clear persisted message",
              new ThreadOutboxManagerError({
                operation: "clear-environment-remove",
                environmentId: message.environmentId,
                threadId: message.threadId,
                messageId: message.messageId,
                cause,
              }),
            );
          }
        }),
      );

      // A same-id enqueue can publish while one of the removes above waits.
      // Put its payload back before the later serialized enqueue write runs.
      await Promise.all(
        candidates.map(async (message) => {
          if (
            !removedFromStorage.has(message.messageId) ||
            (revisions.get(message.messageId) ?? 0) === candidateRevisions.get(message.messageId)
          ) {
            return;
          }
          const retained = currentMessages().find(
            (candidate) => candidate.messageId === message.messageId,
          );
          if (retained === undefined) {
            return;
          }
          try {
            await options.storage.write(retained);
          } catch (cause) {
            warn(
              "[thread-outbox] failed to restore message retained during environment clear",
              new ThreadOutboxManagerError({
                operation: "clear-environment-remove",
                environmentId: retained.environmentId,
                threadId: retained.threadId,
                messageId: retained.messageId,
                cause,
              }),
            );
          }
        }),
      );

      const removed = candidates.filter(
        (message) =>
          removedFromStorage.has(message.messageId) &&
          (revisions.get(message.messageId) ?? 0) === candidateRevisions.get(message.messageId),
      );
      const removedMessageIds = new Set(removed.map((message) => message.messageId));
      const reconciledMessages = flattenQueuedThreadMessages(
        groupQueuedThreadMessages([...allMessages, ...currentMessages()]),
      ).filter((message) => !removedMessageIds.has(message.messageId));
      for (const message of removed) {
        bumpRevision(message.messageId);
      }
      setMessages(reconciledMessages);
      // Return actual removals so attachment cleanup includes messages recovered by this load.
      return removed;
    });
  };

  return {
    queuedMessagesByThreadKeyAtom,
    serialize,
    load,
    enqueue,
    confirmQueued,
    /** Current write revision for a queued message; input to update's CAS. */
    revisionOf: (messageId: MessageId): number => revisions.get(messageId) ?? 0,
    update,
    remove,
    clearEnvironment,
  };
}
