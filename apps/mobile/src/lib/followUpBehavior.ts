import type { ActiveTurnComposerAction } from "@t3tools/client-runtime/state/composer-dispatch";

/** During a running turn, queue waits and steer interrupts with the new message; this preference is device-local. */
export type FollowUpBehavior = Extract<ActiveTurnComposerAction, "queue" | "steer">;

export const DEFAULT_FOLLOW_UP_BEHAVIOR: FollowUpBehavior = "queue";
