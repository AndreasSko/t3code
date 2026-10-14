import * as Cause from "effect/Cause";
import * as Scope from "effect/Scope";
import * as Effect from "effect/Effect";
import * as TxQueue from "effect/TxQueue";
import * as TxRef from "effect/TxRef";

export interface DrainableWorker<A> {
  /** Updates outstanding work atomically with enqueue so drain cannot miss an item. */
  readonly enqueue: (item: A) => Effect.Effect<void>;

  /**
   * Resolves when the queue is empty and the worker is idle (not processing).
   */
  readonly drain: Effect.Effect<void>;
}

/**
 * Scoped worker with deterministic drain; closing the scope drops queued items so drain resolves.
 * Failed or defective items are logged and skipped without stopping later items.
 */
export const makeDrainableWorker = <A, E, R>(
  process: (item: A) => Effect.Effect<void, E, R>,
): Effect.Effect<DrainableWorker<A>, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const outstanding = yield* TxRef.make(0);
    const queue = yield* Effect.acquireRelease(TxQueue.unbounded<A>(), (queue) =>
      // Uncount only the dropped items: an item still running uncounts itself,
      // even when a parallel scope closes it after this finalizer.
      TxQueue.clear(queue).pipe(
        Effect.flatMap((dropped) => TxRef.update(outstanding, (n) => n - dropped.length)),
        Effect.andThen(TxQueue.shutdown(queue)),
        Effect.tx,
      ),
    );

    yield* TxQueue.take(queue).pipe(
      Effect.flatMap((a) =>
        // `suspend` turns a `process` that throws while building its effect
        // into this item's defect instead of the loop's.
        Effect.suspend(() => process(a)).pipe(
          // Only the item's own failure, defect, or interruption lands here and
          // the loop continues; interrupting the worker fiber still stops it.
          // Callers treat an item that only interrupted itself as cancelled,
          // not failed.
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logError("DrainableWorker item failed", cause),
          ),
          Effect.ensuring(TxRef.update(outstanding, (n) => n - 1)),
        ),
      ),
      Effect.forever,
      Effect.forkScoped,
    );

    const drain: DrainableWorker<A>["drain"] = TxRef.get(outstanding).pipe(
      Effect.flatMap((n) => (n > 0 ? Effect.txRetry : Effect.void)),
      Effect.tx,
    );

    const enqueue = (element: A): Effect.Effect<boolean, never, never> =>
      TxQueue.offer(queue, element).pipe(
        Effect.tap((offered) => (offered ? TxRef.update(outstanding, (n) => n + 1) : Effect.void)),
        Effect.tx,
      );

    return { enqueue, drain } satisfies DrainableWorker<A>;
  });
