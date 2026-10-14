/**
 * Environments scan native sessions, including work outside T3. Send aggregated
 * buckets only; raw transcript records stay off the wire.
 */
import * as Schema from "effect/Schema";

import { ForwardCompatibleArray, NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Bump for incompatible shapes; unknown array variants and optional fields
 * are additive and need no bump. Older versions render as partial coverage.
 */
export const USAGE_CONTRACT_VERSION = 6 as const;

/** Minimum merge version; v4 buckets remain valid with additive provider and source fields. */
export const USAGE_MERGE_COMPATIBLE_SINCE = 4 as const;

export const UsageProviderKind = Schema.Literals([
  "claude",
  "codex",
  "grok",
  "cursor",
  "opencode",
  "antigravity",
  "pi",
]);
export type UsageProviderKind = typeof UsageProviderKind.Type;

/** YYYY-MM-DD in the reporting time zone, not UTC, to match the user's day. */
const USAGE_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const UsageDay = TrimmedNonEmptyString.check(Schema.isPattern(USAGE_DAY_PATTERN)).pipe(
  Schema.brand("UsageDay"),
);
export type UsageDay = typeof UsageDay.Type;

export const UsageResolution = Schema.Literals(["day", "hour"]);
export type UsageResolution = typeof UsageResolution.Type;

/**
 * unpriced tokens count in totals but contribute no cost; modelPriced
 * uses custom overrides or LiteLLM rates.
 */
export const UsageCostSource = Schema.Literals(["providerReported", "modelPriced", "unpriced"]);
export type UsageCostSource = typeof UsageCostSource.Type;

/**
 * The three input counts are disjoint. reasoningTokens is already included
 * in outputTokens and must never be added again.
 */
export const UsageTokenTotals = Schema.Struct({
  uncachedInputTokens: NonNegativeInt,
  cachedInputTokens: NonNegativeInt,
  cacheCreationTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
  reasoningTokens: NonNegativeInt,
});
export type UsageTokenTotals = typeof UsageTokenTotals.Type;

/**
 * A bucket's cost split by token category, in USD. A provider-reported cost is
 * split in proportion to the model's list rates.
 */
export const UsageCategoryCost = Schema.Struct({
  input: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  output: Schema.Number,
});
export type UsageCategoryCost = typeof UsageCategoryCost.Type;

/**
 * hourStart is a UTC hourly-bucket start. costUsd is API-equivalent, not subscription
 * spend; unpricedRecords contribute tokens but no cost.
 */
export const UsageBucket = Schema.Struct({
  day: UsageDay,
  hourStart: Schema.optional(TrimmedNonEmptyString),
  provider: UsageProviderKind,
  model: TrimmedNonEmptyString,
  /** Source directory, so overlapping multi-home environments merge once per source. */
  sourcePath: Schema.optional(TrimmedNonEmptyString),
  totals: UsageTokenTotals,
  costUsd: Schema.Number,
  /**
   * Full input cost minus actual cached cost; computed server-side because
   * it needs the rate table.
   */
  cacheSavingsUsd: Schema.Number,
  /** Costs without known rates stay out of the split, even when provider-reported.
   * Absent when nothing can be split or the server predates it. */
  categoryCostUsd: Schema.optional(UsageCategoryCost),
  /** Cost of fast and ultrafast requests. Absent when zero; the rest is standard. */
  fastCostUsd: Schema.optional(Schema.Number),
  ultrafastCostUsd: Schema.optional(Schema.Number),
  /** What fast and ultrafast requests cost above the standard rate. Absent when zero. */
  speedPremiumUsd: Schema.optional(Schema.Number),
  costSource: UsageCostSource,
  /** Distinct assistant responses, after de-duplication. */
  records: NonNegativeInt,
  unpricedRecords: NonNegativeInt,
  /** Distinct transcript sessions that contributed to this cell. */
  sessions: NonNegativeInt,
});
export type UsageBucket = typeof UsageBucket.Type;

/**
 * Deduplicate fingerprints before merging so environments sharing a
 * physical transcript directory do not double-count usage.
 */
export const UsageSourceFingerprint = Schema.Struct({
  hostId: TrimmedNonEmptyString,
  provider: UsageProviderKind,
  resolvedHomePath: TrimmedNonEmptyString,
  /**
   * device:inode distinguishes directories when machines share hostnames and paths.
   * Empty when filesystem identity cannot be read.
   */
  volumeId: Schema.String,
});
export type UsageSourceFingerprint = typeof UsageSourceFingerprint.Type;

export const UsageSourceStatus = Schema.Literals(["ok", "missing", "partial", "failed"]);
export type UsageSourceStatus = typeof UsageSourceStatus.Type;

export const UsageSource = Schema.Struct({
  fingerprint: UsageSourceFingerprint,
  status: UsageSourceStatus,
  scannedFiles: NonNegativeInt,
  skippedFiles: NonNegativeInt,
  /** Records that parsed but carried no recognisable usage payload. */
  malformedRecords: NonNegativeInt,
  /** Use this total: sessions span days and models, so summing bucket counts overcounts. */
  distinctSessions: NonNegativeInt,
  message: Schema.NullOr(TrimmedNonEmptyString),
  /** An action the client can offer to make this source available. */
  action: Schema.optionalKey(Schema.Literal("enableCursorKeychain")),
  /** Cached answer while refresh runs; request awaitRefresh for the refreshed source. */
  refreshing: Schema.optionalKey(Schema.Literal(true)),
});
export type UsageSource = typeof UsageSource.Type;

export const UsagePricingStatus = Schema.Literals(["fresh", "cached", "unavailable"]);
export type UsagePricingStatus = typeof UsagePricingStatus.Type;

export const UsagePricing = Schema.Struct({
  status: UsagePricingStatus,
  source: TrimmedNonEmptyString,
  fetchedAt: Schema.NullOr(Schema.String),
  knownModels: NonNegativeInt,
});
export type UsagePricing = typeof UsagePricing.Type;

export const UsageSummaryInput = Schema.Struct({
  /** Inclusive first day of the window, in `timeZone`. */
  sinceDay: UsageDay,
  /** Inclusive last day of the window, in `timeZone`. */
  untilDay: UsageDay,
  /** Use an IANA zone because fixed offsets fail across DST boundaries. */
  timeZone: TrimmedNonEmptyString,
  /** Defaults to daily for older clients. */
  resolution: Schema.optional(UsageResolution),
  /** Inclusive UTC instant for an hourly rolling window. */
  sinceTime: Schema.optional(TrimmedNonEmptyString),
  /** Exclusive UTC instant for an hourly rolling window. */
  untilTime: Schema.optional(TrimmedNonEmptyString),
  /** Follow up refreshing sources with this to await fresh data; older servers always wait. */
  awaitRefresh: Schema.optional(Schema.Boolean),
});
export type UsageSummaryInput = typeof UsageSummaryInput.Type;

export const UsageSummary = Schema.Struct({
  contractVersion: Schema.Number,
  readAt: Schema.String,
  timeZone: TrimmedNonEmptyString,
  sinceDay: UsageDay,
  untilDay: UsageDay,
  buckets: ForwardCompatibleArray(UsageBucket),
  sources: ForwardCompatibleArray(UsageSource),
  pricing: UsagePricing,
  /** Wall-clock cost of the scan, surfaced in diagnostics. */
  scanDurationMs: NonNegativeInt,
});
export type UsageSummary = typeof UsageSummary.Type;

export class UsageReadError extends Schema.TaggedError<UsageReadError>()("UsageReadError", {
  reason: Schema.Literals(["scanFailed", "invalidWindow"]),
  /** Stable, bounded description. The underlying failure travels in `cause`. */
  detail: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Usage read failed (${this.reason}): ${this.detail}`;
  }
}
