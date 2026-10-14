import type {
  OrchestrationV2ThreadProjection,
  OrchestrationV2ThreadStreamItem,
} from "@t3tools/contracts";

import { omitLocalVisibleTurnItems } from "@t3tools/shared/orchestrationV2BoundedSnapshot";

import {
  buildBoundedThreadProjection,
  type BoundedProjectionResult,
} from "./threadHistoryPaging.ts";
import { projectThreadProjectionForWire } from "./WireProjection.ts";

/** Maximum number of reducer applications allowed during a thread resume. */
export const THREAD_RESUME_MAX_REPLAY_EVENTS = 128;

/** Maximum encoded event JSON allowed during a thread resume. */
export const THREAD_RESUME_MAX_REPLAY_ENCODED_BYTES = 1_048_576;

// Decoded objects and temporary strings cost more than stored JSON,
// even when wire projection shrinks the payload later.
export const THREAD_RESUME_MAX_RAW_PAYLOAD_BYTES = 1_048_576;

export function isThreadReplayRawPayloadSafe(rawPayloadBytes: number): boolean {
  return rawPayloadBytes <= THREAD_RESUME_MAX_RAW_PAYLOAD_BYTES;
}

export function threadReplayEncodedBytes(items: ReadonlyArray<unknown>): number {
  let total = 0;
  for (const item of items) {
    const encoded = JSON.stringify(item);
    total += Buffer.byteLength(encoded ?? "", "utf8");
  }
  return total;
}

type ThreadSnapshotStreamItem = Extract<
  OrchestrationV2ThreadStreamItem,
  { readonly kind: "snapshot" }
>;

/** Only opted-in clients receive compact turnItems and the bounded marker. */
export function boundedSnapshotResponseFields(input: {
  readonly bounded: BoundedProjectionResult;
  readonly compactTurnItems: boolean;
}) {
  const { bounded } = input;
  const compactProjection = input.compactTurnItems
    ? omitLocalVisibleTurnItems(bounded.projection)
    : null;
  return {
    projection: compactProjection ?? bounded.projection,
    historyCursor: bounded.historyCursor,
    hasMoreHistory: bounded.hasMoreHistory,
    latestLocalTurnOrdinal: bounded.latestLocalTurnOrdinal,
    payloadBudgetExceeded: bounded.payloadBudgetExceeded,
    ...(compactProjection === null ? {} : { turnItemsOmitLocalVisible: true as const }),
  };
}

export function buildBoundedThreadStreamSnapshot(input: {
  readonly snapshotSequence: number;
  readonly projection: OrchestrationV2ThreadProjection;
  readonly compactTurnItems?: boolean;
}): ThreadSnapshotStreamItem {
  const bounded = buildBoundedThreadProjection({
    snapshotSequence: input.snapshotSequence,
    projection: projectThreadProjectionForWire(input.projection),
  });
  return {
    kind: "snapshot",
    snapshotSequence: input.snapshotSequence,
    ...boundedSnapshotResponseFields({
      bounded,
      compactTurnItems: input.compactTurnItems === true,
    }),
  };
}

export type ThreadResumePlan =
  | {
      readonly mode: "replay";
      readonly afterSequence: number;
      readonly throughSequence: number;
    }
  | { readonly mode: "snapshot" };

/**
 * Invalid cursors and large gaps need a fresh snapshot: event count bounds reducer churn,
 * while encoded bytes bound a few large updates.
 */
export function decideThreadResume(input: {
  readonly afterSequence: number;
  readonly highWater: number;
  readonly replayEventCount: number;
  readonly replayEncodedBytes: number;
}): ThreadResumePlan {
  if (
    input.afterSequence > input.highWater ||
    input.replayEventCount > THREAD_RESUME_MAX_REPLAY_EVENTS ||
    input.replayEncodedBytes > THREAD_RESUME_MAX_REPLAY_ENCODED_BYTES
  ) {
    return { mode: "snapshot" };
  }
  return {
    mode: "replay",
    afterSequence: input.afterSequence,
    throughSequence: input.highWater,
  };
}
