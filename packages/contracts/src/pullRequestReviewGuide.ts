import * as Schema from "effect/Schema";

import { IsoDateTime, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

/**
 * The server clamps excerpts and notes to changed lines and adds omitted files
 * to a closing stop so the guide accounts for the whole change.
 */

/** A maintainer judgment at a stop; bug findings belong to review agents. */
export const PullRequestReviewGuideAttention = Schema.Struct({
  kind: Schema.Literals(["tradeoff", "contract", "product", "risk", "accessibility"]),
  note: TrimmedNonEmptyString,
});
export type PullRequestReviewGuideAttention = typeof PullRequestReviewGuideAttention.Type;

/** Line numbers refer to the named side; old excerpts show removed code. */
export const PullRequestReviewGuideExcerpt = Schema.Struct({
  path: TrimmedNonEmptyString,
  side: Schema.Literals(["new", "old"]),
  start: PositiveInt,
  end: PositiveInt,
  caption: Schema.String,
});
export type PullRequestReviewGuideExcerpt = typeof PullRequestReviewGuideExcerpt.Type;

/** An explanation anchored inside its stop's excerpts, separate from bug findings. */
export const PullRequestReviewGuideNote = Schema.Struct({
  path: TrimmedNonEmptyString,
  line: PositiveInt,
  title: TrimmedNonEmptyString,
  body: Schema.String,
});
export type PullRequestReviewGuideNote = typeof PullRequestReviewGuideNote.Type;

export const PullRequestReviewGuideStop = Schema.Struct({
  title: TrimmedNonEmptyString,
  summary: Schema.String,
  attention: Schema.NullOr(PullRequestReviewGuideAttention),
  excerpts: Schema.Array(PullRequestReviewGuideExcerpt),
  /** Unexcerpted files appear in exactly one stop; excerpted files may span stops. */
  files: Schema.Array(
    Schema.Struct({
      path: TrimmedNonEmptyString,
      note: Schema.optionalKey(Schema.String),
    }),
  ),
  notes: Schema.Array(PullRequestReviewGuideNote),
  questions: Schema.Array(TrimmedNonEmptyString),
});
export type PullRequestReviewGuideStop = typeof PullRequestReviewGuideStop.Type;

export const PullRequestReviewGuide = Schema.Struct({
  /** The head the guide was written against. A different head means the guide is stale. */
  headSha: TrimmedNonEmptyString,
  generatedAt: IsoDateTime,
  modelSelection: ModelSelection,
  stops: Schema.Array(PullRequestReviewGuideStop),
});
export type PullRequestReviewGuide = typeof PullRequestReviewGuide.Type;

/**
 * Generation runs on the server so large changes do not hold a request open.
 * Restart drops in-progress runs.
 */
export const PullRequestReviewGuideRun = Schema.Union([
  Schema.TaggedStruct("Running", {
    headSha: TrimmedNonEmptyString,
    startedAt: IsoDateTime,
  }),
  Schema.TaggedStruct("Failed", {
    headSha: TrimmedNonEmptyString,
    failedAt: IsoDateTime,
    detail: TrimmedNonEmptyString,
  }),
]);
export type PullRequestReviewGuideRun = typeof PullRequestReviewGuideRun.Type;

/**
 * A guide is stale when its headSha differs from currentHeadSha.
 * A finished run leaves only guide; run tracks active or failed generation.
 */
export const PullRequestReviewGuideResult = Schema.Struct({
  guide: Schema.NullOr(PullRequestReviewGuide),
  run: Schema.NullOr(PullRequestReviewGuideRun),
  /** Null where the host did not report a head with the detail. */
  currentHeadSha: Schema.NullOr(TrimmedNonEmptyString),
});
export type PullRequestReviewGuideResult = typeof PullRequestReviewGuideResult.Type;
