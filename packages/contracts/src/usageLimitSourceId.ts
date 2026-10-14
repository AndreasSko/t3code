import * as Schema from "effect/Schema";

/** Separate module avoids a circular dependency between settings and usage-limit contracts. */
export const UsageLimitSourceId = Schema.String.pipe(Schema.brand("UsageLimitSourceId"));
export type UsageLimitSourceId = typeof UsageLimitSourceId.Type;
