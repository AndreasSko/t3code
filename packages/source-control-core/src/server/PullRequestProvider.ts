import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type {
  PullRequestStackMembership,
  PullRequestAction,
  PullRequestStackHead,
  PullRequestActor,
  PullRequestBaseComparison,
  PullRequestCapabilities,
  PullRequestChecksState,
  PullRequestCheck,
  PullRequestChecks,
  PullRequestComment,
  PullRequestFileViewed,
  PullRequestCommit,
  PullRequestInvolvement,
  PullRequestLabel,
  PullRequestListFilters,
  PullRequestListState,
  PullRequestMergeCapabilities,
  PullRequestMergeMethod,
  PullRequestMergeability,
  PullRequestOmittedFileStat,
  PullRequestReaction,
  PullRequestReactionContent,
  PullRequestReviewCommentDraft,
  PullRequestReviewDecision,
  PullRequestReviewThread,
  PullRequestThreadCommentsResult,
  PullRequestReviewVerdict,
  PullRequestReviewerCandidateList,
  PullRequestReviewerKind,
  PullRequestLabelCandidateList,
  PullRequestState,
  PullRequestPreview,
  PullRequestUpdateMethod,
  PullRequestViewerPermissions,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import { SourceControlProviderKind as SourceControlProviderKindSchema } from "@t3tools/contracts";

/** Missing/unauthenticated tools disable the workspace provider; rate limits pause the host.
 * Other failures affect only the request. */
export class PullRequestProviderError extends Schema.TaggedError<PullRequestProviderError>()(
  "PullRequestProviderError",
  {
    provider: SourceControlProviderKindSchema,
    operation: Schema.String,
    reason: Schema.Literals([
      "missing-tool",
      "unauthenticated",
      "rate-limited",
      "not-found",
      "failed",
    ]),
    detail: Schema.String,
    retryAt: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `${this.provider} failed in ${this.operation}: ${this.detail}`;
  }
}

/**
 * `status` moves with the state, mergeability, head, or checks, which the detail read reports;
 * `remarks` moves with comments and reviews, which only the activity read reports.
 */
export interface ProviderChangeRequestWatchFingerprint {
  readonly status: string;
  readonly remarks: string;
}

export interface PullRequestProviderFailure {
  readonly reason: PullRequestProviderError["reason"];
  readonly retryAt?: number | undefined;
}

export interface ProviderChangeRequest {
  readonly stack?: PullRequestStackMembership;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly author: PullRequestActor | null;
  readonly headBranch: string;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly baseBranch: string;
  readonly state: PullRequestState;
  readonly isDraft: boolean;
  readonly mergeability: PullRequestMergeability;
  readonly additions: number;
  readonly deletions: number;
  readonly createdAt: string;
  readonly closedAt?: string | null;
  readonly mergedAt?: string | null;
  readonly updatedAt: string;
  /** Accounts with a review requested. Team-level requests are excluded by each provider. */
  readonly reviewRequestLogins: ReadonlyArray<string>;
  readonly labels: ReadonlyArray<PullRequestLabel>;
  /** Absent from a host that does not summarise its reviews, which is every host but GitHub. */
  readonly reviewDecision?: PullRequestReviewDecision | null | undefined;
  /** Absent from a host that reports no check rollup on its listings. */
  readonly checksState?: PullRequestChecksState | null | undefined;
}

export interface ProviderChangeRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly state: PullRequestState;
  readonly isDraft?: boolean;
  readonly closedAt?: string | null;
  readonly mergedAt?: string | null;
  readonly updatedAt: string;
  /** Overview fields, present where the host's single read returns them at no extra cost. */
  readonly author?: PullRequestActor | null | undefined;
  readonly additions?: number | undefined;
  readonly deletions?: number | undefined;
  readonly changedFiles?: number | undefined;
  readonly reviewDecision?: PullRequestReviewDecision | null | undefined;
  readonly checksState?: PullRequestChecksState | null | undefined;
  readonly mergeability?: PullRequestMergeability | undefined;
  /**
   * The host-native stack the pull request sits in, from the same read. Null when the host says
   * it is in none; absent when the read did not ask.
   */
  readonly stack?: PullRequestStackMembership | null | undefined;
}

/** One layer of a host-native stack, bottom to top order is the array's. */
export interface ProviderChangeRequestStackLayer {
  readonly title?: string;
  readonly isDraft?: boolean;
  readonly headSha?: string;
  readonly number: number;
  readonly headBranch: string;
  readonly state: PullRequestState;
}

/** Host-native stack, merged/retargeted as one unit. Other hosts use derived branch chains. */
export interface ProviderChangeRequestStack {
  readonly id: string;
  readonly number: number;
  readonly url: string;
  readonly base: string;
  readonly layers: ReadonlyArray<ProviderChangeRequestStackLayer>;
}

export interface ProviderChangeRequestPage {
  readonly items: ReadonlyArray<ProviderChangeRequest>;
  readonly truncated: boolean;
  /**
   * Optional count-based cursor advance. Most hosts advance by the rows delivered after local
   * de-duplication; an offset-paged host may need to count malformed raw rows it consumed too.
   */
  readonly cursorAdvance?: number;
  /** False when the host's ordering cannot support a continuation; callers must request a larger limit. */
  readonly continues: boolean;
}

/** Service-built cursor; providers translate the same boundary into host-specific pagination. */
export interface ProviderListCursor {
  /** Inclusive oldest timestamp, validated before use in a host filter.
   * Equal timestamps may straddle pages; the service drops already-delivered rows. */
  readonly updatedBefore: string;
  /** Offset-paged hosts count consumed rows, including malformed rows reported via cursorAdvance. */
  readonly delivered: number;
}

export interface ProviderBatchedChangeRequest extends ProviderChangeRequest {
  /** Provider-native identity, exactly as it was asked for, so the caller can file the row. */
  readonly repository: string;
}

/** One newest-first slice across repositories; callers partition by repository
 * and advance each covered repository to the slice's oldest boundary. */
export interface ProviderBatchedChangeRequestPage {
  readonly items: ReadonlyArray<ProviderBatchedChangeRequest>;
  readonly truncated: boolean;
}

export interface ProviderChangeRequestStat {
  readonly repository: string;
  readonly number: number;
  readonly additions: number;
  readonly deletions: number;
}

export interface ProviderChangeRequestDetail extends ProviderChangeRequest {
  readonly headSha?: string | null;
  readonly body: string;
  readonly changedFiles: number;
  readonly mergedAt: string | null;
  readonly closedAt: string | null;
  readonly reviewers: ReadonlyArray<PullRequestActor>;
  readonly checks: ReadonlyArray<PullRequestCheck>;
  readonly mergeCapabilities: PullRequestMergeCapabilities;
  readonly viewerPermissions: PullRequestViewerPermissions;
  /** Absent from a host that cannot compare the branch with its base, which is most of them. */
  readonly baseComparison?: PullRequestBaseComparison;
  readonly behindBy?: number;
  /** Absent from a host that does not report whether it is armed to merge this on its own. */
  readonly autoMergeEnabled?: boolean;
  /** The strategy stored with an armed auto-merge, where the host reports it. */
  readonly autoMergeMethod?: PullRequestMergeMethod;
  readonly workflowApprovalsRequired?: number;
}

/** The conversation-shaped half of a detail, loaded after the core can already render. */
export interface ProviderChangeRequestActivity {
  readonly author?: PullRequestActor | null;
  /** Optional because most hosts already report their reviewer list in the core detail. */
  readonly reviewers?: ReadonlyArray<PullRequestActor>;
  readonly comments: ReadonlyArray<PullRequestComment>;
  /** Host count, even when the bounded read returns fewer comments; otherwise use delivered count. */
  readonly commentCount: number;
  readonly commentsTruncated: boolean;
  readonly reviewThreadsTruncated?: boolean;
  readonly reviewThreads: ReadonlyArray<PullRequestReviewThread>;
  readonly commits: ReadonlyArray<PullRequestCommit>;
  readonly reactions?: ReadonlyArray<PullRequestReaction>;
}

export interface ProviderDiffSlice {
  readonly patch: string;
  /** Something in this slice could not be shown, as opposed to there being more slices. */
  readonly truncated: boolean;
  readonly nextCursor: string | null;
  /** The host's own counts for the files whose hunks it withheld from this slice. */
  readonly omittedFileStats?: ReadonlyArray<PullRequestOmittedFileStat>;
}

export interface ProviderDiffFileContents {
  readonly oldContents: string;
  readonly newContents: string;
}

export interface ProviderFilesViewed {
  readonly files: ReadonlyArray<PullRequestFileViewed>;
  /** The host has more files than were read, so the ones missing here are not "unviewed". */
  readonly truncated: boolean;
}

/** Opaque head revisions: empty string means deleted; an absent path means unknown.
 * See docs/internals/pull-request-file-revisions.md for null semantics across layers. */
export interface ProviderFileRevisions {
  readonly revisions: ReadonlyMap<string, string>;
  /** True only for a complete whole-change read, letting later ticks reuse unrequested paths. */
  readonly complete?: boolean;
}

export interface ProviderRepositoryRef {
  readonly cwd: string;
  /** Provider-native repository identity, e.g. `owner/repo` or `group/subgroup/project`. */
  readonly repository: string;
  /** Repository paths omit the host, so callers must distinguish public and Enterprise instances. */
  readonly host: string;
}

export interface PullRequestProviderApi {
  readonly withVerifiedCredential?: <A, E, R>(
    input: { readonly cwd: string; readonly host: string },
    use: (identity: {
      readonly accountId: string;
      readonly viewer: string;
      readonly credentialFingerprint: string;
    }) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | PullRequestProviderError, R>;
  readonly getRoutingIdentity?: (input: {
    readonly cwd: string;
    readonly host: string;
  }) => Effect.Effect<
    { readonly accountId: string; readonly viewer: string },
    PullRequestProviderError
  >;
  readonly kind: SourceControlProviderKind;
  readonly capabilities: PullRequestCapabilities;
  /** Optional merge-text rewrite; absence means the host writes its own message. */
  readonly mergeMessageRewrite?: (message: string) => string;
  /** Override when owner/name is not host-unique, as with Azure organization/project paths.
   * The key scopes checkout routing, listings, and cursors. */
  readonly repositoryKey?: (input: { readonly canonicalKey: string }) => string;

  readonly getViewer: (input: {
    readonly cwd: string;
    readonly host?: string;
  }) => Effect.Effect<string, PullRequestProviderError>;

  readonly listChangeRequests: (
    input: ProviderRepositoryRef & {
      readonly state: PullRequestListState;
      readonly involvement: PullRequestInvolvement;
      readonly viewer: string;
      readonly limit: number;
      /** Hosts without text search return wider pages for the caller to filter. */
      readonly query?: string | undefined;
      readonly cursor?: ProviderListCursor | undefined;
      /** Apply supported filters and ignore others; the caller narrows fields present on returned rows. */
      readonly filters?: PullRequestListFilters | undefined;
    },
  ) => Effect.Effect<ProviderChangeRequestPage, PullRequestProviderError>;

  /** Optional host-wide search; failures fall back to per-repository listing.
   * limit covers the whole slice, and all repositories must share the cursor boundary. */
  readonly listChangeRequestsAcross?: (input: {
    readonly cwd: string;
    readonly host: string;
    readonly repositories: ReadonlyArray<string>;
    readonly state: PullRequestListState;
    readonly involvement: PullRequestInvolvement;
    readonly viewer: string;
    readonly limit: number;
    readonly query?: string | undefined;
    readonly cursor?: ProviderListCursor | undefined;
    readonly filters?: PullRequestListFilters | undefined;
  }) => Effect.Effect<ProviderBatchedChangeRequestPage, PullRequestProviderError>;

  /** Optional when listing rows omit line counts; callers ask only after receiving the rows. */
  readonly listChangeRequestStats?: (input: {
    readonly cwd: string;
    readonly host: string;
    readonly changeRequests: ReadonlyArray<{
      readonly repository: string;
      readonly number: number;
    }>;
  }) => Effect.Effect<ReadonlyArray<ProviderChangeRequestStat>, PullRequestProviderError>;

  readonly getChangeRequestChecks?: (
    input: ProviderRepositoryRef & { readonly number: number },
  ) => Effect.Effect<PullRequestChecks, PullRequestProviderError>;

  readonly getChangeRequest: (
    input: ProviderRepositoryRef & { readonly number: number },
  ) => Effect.Effect<ProviderChangeRequestDetail, PullRequestProviderError>;

  /** Hosts without a narrow read use their existing detail response for hover cards. */
  readonly getChangeRequestPreview?: (
    input: ProviderRepositoryRef & { readonly number: number },
  ) => Effect.Effect<
    Omit<PullRequestPreview, "projectId" | "repository">,
    PullRequestProviderError
  >;

  /** Narrow live fields for linked threads; absence falls back to full detail. */
  readonly getChangeRequestSummary?: (
    input: ProviderRepositoryRef & { readonly number: number },
  ) => Effect.Effect<ProviderChangeRequestSummary, PullRequestProviderError>;

  /** Optional cheap watch fingerprint; null or absence causes a full read. */
  readonly getChangeRequestWatchFingerprint?: (
    input: ProviderRepositoryRef & { readonly number: number },
  ) => Effect.Effect<ProviderChangeRequestWatchFingerprint | null, PullRequestProviderError>;

  /** Optional native stack; without one the service derives chains from base branches. */
  readonly getChangeRequestStack?: (
    input: ProviderRepositoryRef & { readonly includeDetails?: boolean; readonly number: number },
  ) => Effect.Effect<ProviderChangeRequestStack | null, PullRequestProviderError>;

  /** Comments, line threads, and commits, kept off the critical path for the core detail. */
  readonly getChangeRequestActivity: (
    input: ProviderRepositoryRef & { readonly number: number },
  ) => Effect.Effect<ProviderChangeRequestActivity, PullRequestProviderError>;

  readonly getReviewThreadComments?: (
    input: ProviderRepositoryRef & {
      readonly number: number;
      readonly threadId: string;
      readonly cursor: string;
    },
  ) => Effect.Effect<PullRequestThreadCommentsResult, PullRequestProviderError>;

  /** Re-read permissions before writing so client claims and stale access cannot authorize a write.
   * Use the cheapest host read that answers, or no request when permissions are unavailable. */
  readonly getViewerPermissions: (
    input: ProviderRepositoryRef & {
      readonly number: number;
      /** Skip branch comparison when checking permission for an unrelated operation. */
      readonly includeUpdateBranch?: boolean;
    },
  ) => Effect.Effect<PullRequestViewerPermissions, PullRequestProviderError>;

  /** Requires capabilities.diff. Whole patches return nextCursor: null; paged hosts return a cursor. */
  readonly getDiff: (
    input: ProviderRepositoryRef & {
      readonly number: number;
      readonly cursor?: string | undefined;
      readonly commit?: string | undefined;
    },
  ) => Effect.Effect<ProviderDiffSlice, PullRequestProviderError>;

  /** Full files at the patch's revisions. Optional without diff support; expansion is then refused. */
  readonly getDiffFileContents?: (
    input: ProviderRepositoryRef & {
      readonly number: number;
      readonly commit?: string | undefined;
      readonly changeType: "change" | "rename-pure" | "rename-changed" | "new" | "deleted";
      readonly oldPath: string;
      readonly newPath: string;
    },
  ) => Effect.Effect<ProviderDiffFileContents, PullRequestProviderError>;

  /** Requires viewedFiles: "host"; read separately because marks change independently of pushes. */
  readonly getFilesViewed?: (
    input: ProviderRepositoryRef & { readonly number: number },
  ) => Effect.Effect<ProviderFilesViewed, PullRequestProviderError>;

  /** Requires viewedFiles: "host". Batch changes into one round trip even without a bulk endpoint. */
  readonly setFilesViewed?: (
    input: ProviderRepositoryRef & {
      readonly number: number;
      readonly files: ReadonlyArray<{ readonly path: string; readonly viewed: boolean }>;
    },
  ) => Effect.Effect<void, PullRequestProviderError>;

  /** Required for environment-owned viewed marks: compare marked paths' head revisions after pushes.
   * Hosts without per-file revisions may need to read the whole change. */
  readonly getFileRevisions?: (
    input: ProviderRepositoryRef & {
      readonly number: number;
      readonly paths: ReadonlyArray<string>;
    },
  ) => Effect.Effect<ProviderFileRevisions, PullRequestProviderError>;

  readonly runAction: (
    input: ProviderRepositoryRef & {
      readonly number: number;
      readonly action: PullRequestAction;
      readonly stackNumber?: number;
      readonly expectedStackHeads?: ReadonlyArray<PullRequestStackHead>;
      /** Apply `mergeMessageRewrite` to the merge message; never sent to a host without one. */
      readonly removeAgentCreditsOnMerge?: boolean;
      /** Meaningful for `merge` and `enable-auto-merge`; absent takes the host's own default. */
      readonly mergeMethod?: PullRequestMergeMethod;
      /** Only meaningful for `update-branch`; absent takes the host's own default. */
      readonly updateMethod?: PullRequestUpdateMethod;
    },
  ) => Effect.Effect<void, PullRequestProviderError>;

  /** Requires edit.changeRequest; at least one field is supplied because hosts disagree on empty edits. */
  readonly updateChangeRequest?: (
    input: ProviderRepositoryRef & {
      readonly number: number;
      readonly title?: string | undefined;
      readonly body?: string | undefined;
    },
  ) => Effect.Effect<void, PullRequestProviderError>;

  readonly comment: (
    input: ProviderRepositoryRef & { readonly number: number; readonly body: string },
  ) => Effect.Effect<void, PullRequestProviderError>;

  /** Requires edit.comment. Use the conversation's id and let the host enforce authorship
   * at mutation time, since access may change after the conversation read. */
  readonly updateComment?: (
    input: ProviderRepositoryRef & {
      readonly number: number;
      readonly commentId: string;
      readonly kind: "issue-comment" | "review-comment";
      readonly body: string;
    },
  ) => Effect.Effect<void, PullRequestProviderError>;

  /** Requires the declared verdict and inlineComment capability for any line comments. */
  readonly submitReview: (
    input: ProviderRepositoryRef & {
      readonly number: number;
      readonly verdict: PullRequestReviewVerdict;
      readonly body: string;
      readonly comments: ReadonlyArray<PullRequestReviewCommentDraft>;
    },
  ) => Effect.Effect<void, PullRequestProviderError>;

  /** Requires reviewers.listCandidates. Providers exclude the author using host-specific identity rules. */
  readonly listReviewerCandidates: (
    input: ProviderRepositoryRef & { readonly number: number },
  ) => Effect.Effect<PullRequestReviewerCandidateList, PullRequestProviderError>;

  /** Requires reviewers.request; requested=false removes it. Requesting an existing reviewer re-requests. */
  readonly setReviewerRequest: (
    input: ProviderRepositoryRef & {
      readonly number: number;
      readonly reviewers: ReadonlyArray<{
        readonly id: string;
        readonly kind: PullRequestReviewerKind;
      }>;
      readonly requested: boolean;
    },
  ) => Effect.Effect<void, PullRequestProviderError>;

  /** Requires capabilities.labels, together with setLabels. */
  readonly listLabelCandidates?: (
    input: ProviderRepositoryRef & { readonly number: number },
  ) => Effect.Effect<PullRequestLabelCandidateList, PullRequestProviderError>;

  readonly setLabels?: (
    input: ProviderRepositoryRef & {
      readonly number: number;
      readonly labels: ReadonlyArray<string>;
      readonly applied: boolean;
    },
  ) => Effect.Effect<void, PullRequestProviderError>;

  /** Only called when `capabilities.review.reply` is true. */
  readonly replyToThread: (
    input: ProviderRepositoryRef & {
      readonly number: number;
      readonly threadId: string;
      readonly body: string;
    },
  ) => Effect.Effect<void, PullRequestProviderError>;

  /** Requires reactions. subjectId is a conversation remark id; absence targets the change request itself. */
  readonly setReaction: (
    input: ProviderRepositoryRef & {
      readonly number: number;
      readonly subjectId?: string | undefined;
      readonly content: PullRequestReactionContent;
      readonly reacted: boolean;
    },
  ) => Effect.Effect<void, PullRequestProviderError>;

  /** Only called when `capabilities.review.resolve` is true. */
  readonly setThreadResolution: (
    input: ProviderRepositoryRef & {
      readonly number: number;
      readonly threadId: string;
      readonly resolved: boolean;
    },
  ) => Effect.Effect<void, PullRequestProviderError>;
}
