import {
  type OrchestrationV2Notification,
  MessageId,
  ProviderDriverKind,
  ProviderThreadId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";

export interface ProviderContinuationRequest {
  readonly threadId: ThreadId;
  readonly providerThreadId: ProviderThreadId;
  readonly driver: ProviderDriverKind;
  readonly detail: string | null;
  readonly notification?: OrchestrationV2Notification;
  /**
   * Re-read the cohort before dispatch so later completions join a queued wake
   * and stopped or acknowledged cohorts are dropped.
   */
  readonly delegatedCompletion?: {
    readonly parentRunId: RunId;
    readonly generation: number;
    readonly messageId: MessageId;
  };
  /**
   * adapter_buffered (default) attaches CLI wake output (Claude ignores message text).
   * message_text sends app-owned wake content as a real prompt.
   */
  readonly delivery?: "adapter_buffered" | "message_text";
  /**
   * Use this id to correlate a dispatch with the adapter's held wake;
   * omitted means the service allocates one.
   */
  readonly messageId?: MessageId;
  readonly dispatchIfCurrent?: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<Option.Option<A>, E, R>;
  /** Clears a pending offer that the continuation worker intentionally drops. */
  readonly clearIfCurrent?: () => Effect.Effect<void>;
}

/**
 * Share the live reference with ProviderContinuationService so it drains offers;
 * the default drops them for dependency-free adapter construction.
 */
export class ProviderContinuationRequests extends Context.Reference<{
  readonly offer: (request: ProviderContinuationRequest) => Effect.Effect<void>;
  readonly take: Effect.Effect<ProviderContinuationRequest>;
}>("@t3tools/provider-core/server/ProviderContinuationRequests", {
  defaultValue: () => ({ offer: () => Effect.void, take: Effect.never }),
}) {}

export const layer = Layer.effect(
  ProviderContinuationRequests,
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<ProviderContinuationRequest>();
    return {
      offer: (request: ProviderContinuationRequest) =>
        Queue.offer(queue, request).pipe(Effect.asVoid),
      take: Queue.take(queue),
    };
  }),
);
