import * as Schema from "effect/Schema";
import * as HttpServerRespondable from "effect/http/HttpServerRespondable";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { SourceControlProviderKind } from "./sourceControl.ts";

export const PullRequestInvolvement = Schema.Literals(["all", "reviewing", "authored"]);
export type PullRequestInvolvement = typeof PullRequestInvolvement.Type;

export const PullRequestState = Schema.Literals(["open", "closed", "merged"]);
export type PullRequestState = typeof PullRequestState.Type;

export const PullRequestListState = Schema.Literals(["all", "open", "closed", "merged"]);
export type PullRequestListState = typeof PullRequestListState.Type;

export const PullRequestReviewDecision = Schema.Literals([
  "approved",
  "changes-requested",
  "review-required",
]);
export type PullRequestReviewDecision = typeof PullRequestReviewDecision.Type;

/** One qualifier's value, bounded because it is written into a host's own search query. */
const PullRequestQualifierValue = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
const PullRequestQualifierValues = Schema.Array(PullRequestQualifierValue).check(
  Schema.isMaxLength(10),
);

/**
 * `checks` is host-side only: rows carry no check state, so an unsupported host
 * returns an unfiltered listing.
 */
export const PullRequestListFilters = Schema.Struct({
  draft: Schema.optional(Schema.Literals(["only", "hide"])),
  review: Schema.optional(
    Schema.Literals(["approved", "changes-requested", "review-required", "none"]),
  ),
  checks: Schema.optional(Schema.Literals(["passing", "failing"])),
  /**
   * Each group is a GitHub label qualifier: match every group and any name within
   * a group, e.g. `label:size:S,size:XS`. Bounds limit host search qualifiers.
   */
  labels: Schema.optional(Schema.Array(PullRequestQualifierValues).check(Schema.isMaxLength(10))),
  excludedLabels: Schema.optional(PullRequestQualifierValues),
  author: Schema.optional(PullRequestQualifierValue),
});
export type PullRequestListFilters = typeof PullRequestListFilters.Type;

export const PullRequestChecksState = Schema.Literals(["passing", "failing", "pending"]);
export type PullRequestChecksState = typeof PullRequestChecksState.Type;

export const PullRequestMergeability = Schema.Literals(["mergeable", "conflicting", "unknown"]);
export type PullRequestMergeability = typeof PullRequestMergeability.Type;

export const PullRequestMergeMethod = Schema.Literals(["merge", "squash", "rebase"]);
export type PullRequestMergeMethod = typeof PullRequestMergeMethod.Type;

export const PullRequestAction = Schema.Literals([
  "merge",
  "ready",
  "draft",
  "close",
  "reopen",
  "update-branch",
  /**
   * The host waits for merge requirements and merges automatically; `merge`
   * instead fails when those requirements are unmet.
   */
  "enable-auto-merge",
  "disable-auto-merge",
  /** Open a new change request that reverses a merged one. */
  "revert",
  /** Allow Actions workflows from a fork pull request to begin running. */
  "approve-workflows",
]);
export type PullRequestAction = typeof PullRequestAction.Type;

/**
 * Use the host's offered update methods, narrowed by viewer permissions;
 * GitHub can refuse a rebase it cannot replay.
 */
export const PullRequestUpdateMethod = Schema.Literals(["merge", "rebase"]);
export type PullRequestUpdateMethod = typeof PullRequestUpdateMethod.Type;

/**
 * Behind does not imply conflicting. Unknown means the host did not compare
 * the head repository with its base.
 */
export const PullRequestBaseComparison = Schema.Literals(["up-to-date", "behind", "unknown"]);
export type PullRequestBaseComparison = typeof PullRequestBaseComparison.Type;

export const PullRequestActor = Schema.Struct({
  isBot: Schema.optional(Schema.Boolean),
  login: TrimmedNonEmptyString,
  name: Schema.NullOr(Schema.String),
  /** Null where a host does not report one, which is what the initials fall back to. */
  avatarUrl: Schema.NullOr(Schema.String),
});
export type PullRequestActor = typeof PullRequestActor.Type;

export const PullRequestLabel = Schema.Struct({
  name: TrimmedNonEmptyString,
  color: Schema.NullOr(Schema.String),
});
export type PullRequestLabel = typeof PullRequestLabel.Type;

export const PullRequestCheckStatus = Schema.Literals([
  "pending",
  "action-required",
  "success",
  "failure",
  "skipped",
  "neutral",
  "cancelled",
]);
export type PullRequestCheckStatus = typeof PullRequestCheckStatus.Type;

export const PullRequestCheck = Schema.Struct({
  name: TrimmedNonEmptyString,
  status: PullRequestCheckStatus,
  description: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  /** The base branch requires this check to merge. Absent where the host does not say. */
  required: Schema.optional(Schema.Boolean),
});
export type PullRequestCheck = typeof PullRequestCheck.Type;

/** GitHub's eight reactions are the shared set; GitLab awards outside it are ignored. */
export const PullRequestReactionContent = Schema.Literals([
  "thumbs-up",
  "thumbs-down",
  "laugh",
  "hooray",
  "confused",
  "heart",
  "rocket",
  "eyes",
]);
export type PullRequestReactionContent = typeof PullRequestReactionContent.Type;

export const PullRequestReaction = Schema.Struct({
  content: PullRequestReactionContent,
  count: PositiveInt,
  /**
   * May contain fewer logins than count. Excludes the viewer when viewerHasReacted
   * is true, but count still includes them.
   */
  actors: Schema.Array(TrimmedNonEmptyString),
  viewerHasReacted: Schema.Boolean,
});
export type PullRequestReaction = typeof PullRequestReaction.Type;

export const PullRequestCommentKind = Schema.Literals([
  "issue-comment",
  "review-comment",
  "review",
]);
export type PullRequestCommentKind = typeof PullRequestCommentKind.Type;

export const PullRequestComment = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: PullRequestCommentKind,
  author: Schema.NullOr(PullRequestActor),
  body: Schema.String,
  createdAt: IsoDateTime,
  editedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  url: Schema.NullOr(Schema.String),
  path: Schema.NullOr(Schema.String),
  reviewState: Schema.NullOr(Schema.String),
  /** Absent from a host with no reactions at all, which is a different thing from none on this. */
  reactions: Schema.optional(Schema.Array(PullRequestReaction)),
  /**
   * Absent falls back to authorship. A host must set this identically on the
   * comment's timeline and review-thread copies.
   */
  canEdit: Schema.optional(Schema.Boolean),
});
export type PullRequestComment = typeof PullRequestComment.Type;

/**
 * `left` is before the change; `right` is after. The same line number can
 * refer to different lines in a unified diff.
 */
export const PullRequestDiffSide = Schema.Literals(["left", "right"]);
export type PullRequestDiffSide = typeof PullRequestDiffSide.Type;

export const PullRequestReviewVerdict = Schema.Literals(["comment", "approve", "request-changes"]);
export type PullRequestReviewVerdict = typeof PullRequestReviewVerdict.Type;

export const PullRequestThreadComment = Schema.Struct({
  id: TrimmedNonEmptyString,
  author: Schema.NullOr(PullRequestActor),
  body: Schema.String,
  createdAt: IsoDateTime,
  editedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  url: Schema.NullOr(Schema.String),
  reactions: Schema.optional(Schema.Array(PullRequestReaction)),
  /**
   * Absent falls back to authorship. A host must set this identically on the
   * comment's timeline and review-thread copies.
   */
  canEdit: Schema.optional(Schema.Boolean),
});
export type PullRequestThreadComment = typeof PullRequestThreadComment.Type;

/** The same remarks appear flat in the timeline and grouped at their diff line. */
export const PullRequestReviewThread = Schema.Struct({
  id: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  /** Null when the host anchors the thread to a file rather than to a line. */
  line: Schema.NullOr(PositiveInt),
  side: PullRequestDiffSide,
  isResolved: Schema.Boolean,
  /**
   * The original line is absent from the diff; list separately to avoid
   * pinning the thread to an unrelated line.
   */
  isOutdated: Schema.Boolean,
  comments: Schema.Array(PullRequestThreadComment),
  /** Host-reported total, when this thread was read in pages. */
  commentCount: Schema.optional(NonNegativeInt),
  /** Opaque cursor for the next comment page. Absent once this thread is whole. */
  nextCommentsCursor: Schema.optional(TrimmedNonEmptyString),
  /** Only narrows the repository-wide resolve permission; it cannot grant it. */
  canResolve: Schema.optional(Schema.Boolean),
});
export type PullRequestReviewThread = typeof PullRequestReviewThread.Type;

/** GitHub accepts team reviewers; the other hosts only accept users. */
export const PullRequestReviewerKind = Schema.Literals(["user", "team"]);
export type PullRequestReviewerKind = typeof PullRequestReviewerKind.Type;

/** Team candidates use their slug as the actor login. */
export const PullRequestReviewerCandidate = Schema.Struct({
  ...PullRequestActor.fields,
  /**
   * Opaque host address, sent back unchanged: GitHub login/team slug,
   * GitLab numeric user id, or Bitbucket account uuid.
   */
  id: TrimmedNonEmptyString,
  kind: PullRequestReviewerKind,
  isRequested: Schema.Boolean,
});
export type PullRequestReviewerCandidate = typeof PullRequestReviewerCandidate.Type;

export const PullRequestReviewerCandidateList = Schema.Struct({
  /** Never includes the author: nobody is asked to review their own change request. */
  candidates: Schema.Array(PullRequestReviewerCandidate),
  /**
   * The host has more eligible reviewers than were read; missing names
   * may still be requested.
   */
  truncated: Schema.Boolean,
});
export type PullRequestReviewerCandidateList = typeof PullRequestReviewerCandidateList.Type;

export const PullRequestLabelCandidate = Schema.Struct({
  ...PullRequestLabel.fields,
  description: Schema.NullOr(Schema.String),
  isApplied: Schema.Boolean,
});
export type PullRequestLabelCandidate = typeof PullRequestLabelCandidate.Type;

export const PullRequestLabelCandidateList = Schema.Struct({
  candidates: Schema.Array(PullRequestLabelCandidate),
  /** The repository defines more labels than the read asked for; the list is not all of them. */
  truncated: Schema.Boolean,
});
export type PullRequestLabelCandidateList = typeof PullRequestLabelCandidateList.Type;

export const PullRequestCommit = Schema.Struct({
  oid: TrimmedNonEmptyString,
  messageHeadline: Schema.String,
  committedDate: IsoDateTime,
  /** Per-commit line counts where the host can return them without a request per commit. */
  additions: Schema.optional(NonNegativeInt),
  deletions: Schema.optional(NonNegativeInt),
  /** Optional because some hosts and older servers do not expose commit authors. */
  authors: Schema.optional(Schema.Array(PullRequestActor)),
});
export type PullRequestCommit = typeof PullRequestCommit.Type;

/** GitLab cannot request changes; Azure DevOps' CLI provides no diff for inline comments. */
export const PullRequestReviewCapabilities = Schema.Struct({
  inlineComment: Schema.Boolean,
  reply: Schema.Boolean,
  resolve: Schema.Boolean,
  /** The verdicts a submitted review can carry. Empty means reviews cannot be submitted. */
  verdicts: Schema.Array(PullRequestReviewVerdict),
});
export type PullRequestReviewCapabilities = typeof PullRequestReviewCapabilities.Type;

/** Azure DevOps can edit title/description but cannot post or edit comments here. */
export const PullRequestEditCapabilities = Schema.Struct({
  changeRequest: Schema.Boolean,
  comment: Schema.Boolean,
});
export type PullRequestEditCapabilities = typeof PullRequestEditCapabilities.Type;

/** Azure DevOps can request reviewers without listing eligible candidates. */
export const PullRequestReviewerCapabilities = Schema.Struct({
  request: Schema.Boolean,
  /** When false, accept a name directly instead of offering an incomplete candidate menu. */
  listCandidates: Schema.Boolean,
});
export type PullRequestReviewerCapabilities = typeof PullRequestReviewerCapabilities.Type;

/**
 * `host` shares viewed-file marks with the host's web UI; `environment`
 * keeps them on this server for hosts without a readable shared record.
 */
export const PullRequestViewedFilesStore = Schema.Literals(["host", "environment"]);
export type PullRequestViewedFilesStore = typeof PullRequestViewedFilesStore.Type;

/**
 * Hide unsupported actions: Azure DevOps' CLI exposes no patch, and
 * Bitbucket cannot reopen a declined pull request.
 */
export const PullRequestCapabilities = Schema.Struct({
  diff: Schema.Boolean,
  comment: Schema.Boolean,
  /** The actions this host can carry out; anything absent is never offered. */
  actions: Schema.Array(PullRequestAction),
  /** Merge strategies the provider itself offers, before repository settings narrow them. */
  mergeMethods: Schema.Array(PullRequestMergeMethod),
  /** Absent or empty means the host cannot update branches. */
  updateMethods: Schema.optional(Schema.Array(PullRequestUpdateMethod)),
  /** False means the host returns unfiltered rows and the client must filter them. */
  search: Schema.Boolean,
  /** Covers both reading and changing reactions. Absent means unsupported. */
  reactions: Schema.optional(Schema.Boolean),
  /** Absent means viewed-file tracking is unsupported. */
  viewedFiles: Schema.optional(PullRequestViewedFilesStore),
  review: PullRequestReviewCapabilities,
  reviewers: PullRequestReviewerCapabilities,
  /** Absent means editing is unsupported, including on older servers. */
  edit: Schema.optional(PullRequestEditCapabilities),
  /** Absent means stacks can only be inferred from base branches. */
  stacks: Schema.optional(Schema.Boolean),
  stackActions: Schema.optional(Schema.Boolean),
  /** Absent means listing and changing labels is unsupported. */
  labels: Schema.optional(Schema.Boolean),
});
export type PullRequestCapabilities = typeof PullRequestCapabilities.Type;

/**
 * Viewer permissions narrow host capabilities. Unreported optional permissions
 * are granted unless the field specifies another fallback; the host enforces writes.
 */
export const PullRequestViewerPermissions = Schema.Struct({
  /** May request remote stack rebases, including when this layer is already current. */
  stackRebase: Schema.optional(Schema.Boolean),
  /** Which of the actions this viewer may take; anything absent is theirs to look at only. */
  actions: Schema.Array(PullRequestAction),
  comment: Schema.Boolean,
  resolve: Schema.Boolean,
  /** The verdicts this viewer may submit a review with. Empty means they may not review. */
  verdicts: Schema.Array(PullRequestReviewVerdict),
  requestReviewers: Schema.Boolean,
  /** Narrowed from host capabilities; absent or empty denies branch updates. */
  updateMethods: Schema.optional(Schema.Array(PullRequestUpdateMethod)),
  /** Absent grants permission, but the host must also support label changes. */
  labels: Schema.optional(Schema.Boolean),
  /** Absent falls back to authorship and merge access. */
  editChangeRequest: Schema.optional(Schema.Boolean),
});
export type PullRequestViewerPermissions = typeof PullRequestViewerPermissions.Type;

export const PullRequestMergeCapabilities = Schema.Struct({
  merge: Schema.Boolean,
  squash: Schema.Boolean,
  rebase: Schema.Boolean,
});
export type PullRequestMergeCapabilities = typeof PullRequestMergeCapabilities.Type;

export const PullRequestStackMembership = Schema.Struct({
  number: PositiveInt,
  position: PositiveInt,
  size: PositiveInt,
  base: TrimmedNonEmptyString,
});
export type PullRequestStackMembership = typeof PullRequestStackMembership.Type;

export const PullRequestListEntry = Schema.Struct({
  stack: Schema.optional(PullRequestStackMembership),
  provider: SourceControlProviderKind,
  /** Distinguishes accounts on github.com and GitHub Enterprise hosts. */
  host: TrimmedNonEmptyString,
  projectId: ProjectId,
  projectTitle: TrimmedNonEmptyString,
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  author: Schema.NullOr(PullRequestActor),
  headBranch: TrimmedNonEmptyString,
  baseBranch: TrimmedNonEmptyString,
  state: PullRequestState,
  isDraft: Schema.Boolean,
  mergeability: PullRequestMergeability,
  /**
   * Zero can mean counts were not read. GitHub list rows load counts separately
   * through PullRequestListStatsInput.
   */
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  /** Server epoch milliseconds when the provider read started; preserved on cache hits. */
  observedAt: Schema.optional(Schema.Finite),
  viewerReviewRequested: Schema.Boolean,
  labels: Schema.Array(PullRequestLabel),
  /** Absent where the host does not summarise its reviews, which is every host but GitHub. */
  reviewDecision: Schema.optional(PullRequestReviewDecision),
  /** Absent where the host reports no check rollup, or the change request has no checks. */
  checksState: Schema.optional(PullRequestChecksState),
});
export type PullRequestListEntry = typeof PullRequestListEntry.Type;

/**
 * Keyed by "<host> <repository>" to distinguish identically named repositories
 * on different hosts. Values are opaque provider cursors, returned unchanged.
 */
export const PullRequestListCursors = Schema.Record(
  TrimmedNonEmptyString,
  // Bounded because it arrives from the page and is unfolded into a host's own filter.
  TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
);
export type PullRequestListCursors = typeof PullRequestListCursors.Type;

export const PullRequestListInput = Schema.Struct({
  state: PullRequestListState,
  involvement: Schema.optional(PullRequestInvolvement),
  filters: Schema.optional(PullRequestListFilters),
  projectId: Schema.optional(ProjectId),
  /**
   * Restrict to projects this client assigned to the connection to avoid duplicates
   * across environments; absent means every project.
   */
  projectIds: Schema.optional(Schema.Array(ProjectId).check(Schema.isMaxLength(100))),
  /**
   * Use the host name, not provider kind, to distinguish GitHub Enterprise accounts.
   * Absent means every workspace host.
   */
  host: Schema.optional(TrimmedNonEmptyString),
  /** Rows to return per repository, which with a continuation is rows per slice. */
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }))),
  /** Only named repositories are read, one slice each; omit for a fresh listing. */
  cursors: Schema.optional(PullRequestListCursors),
  /**
   * Search on the host because client rows only cover loaded pages; unsupported hosts
   * return unfiltered rows. The bound limits CLI arguments and query strings.
   */
  query: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
});
export type PullRequestListInput = typeof PullRequestListInput.Type;

/** One summary per host because github.com and Enterprise accounts can fail independently. */
export const PullRequestProviderSummary = Schema.Struct({
  host: TrimmedNonEmptyString,
  kind: SourceControlProviderKind,
  /** False where a search has to be applied to the rows after they arrive. */
  searchesOnHost: Schema.Boolean,
  /** Allows row actions before detail loads; older servers omit it. */
  actions: Schema.optional(Schema.Array(PullRequestAction)),
  projectCount: PositiveInt,
  /** False when the provider's CLI or credentials are missing, with `detail` saying which. */
  configured: Schema.Boolean,
  detail: Schema.NullOr(TrimmedNonEmptyString),
});
export type PullRequestProviderSummary = typeof PullRequestProviderSummary.Type;

/** One project whose repository could not be read; healthy projects still return entries. */
export const PullRequestListProjectError = Schema.Struct({
  projectId: ProjectId,
  projectTitle: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
});
export type PullRequestListProjectError = typeof PullRequestListProjectError.Type;

export const PullRequestListResult = Schema.Struct({
  /**
   * Signed-in logins keyed by host. Omit unreadable hosts: an open-keyed
   * record cannot encode optional values through the JSON codec.
   */
  viewers: Schema.Record(TrimmedNonEmptyString, TrimmedNonEmptyString),
  providers: Schema.Array(PullRequestProviderSummary),
  /**
   * Newest update first across repositories; re-sort after appending pages
   * because one repository's older slice may be newer than another's rows.
   */
  entries: Schema.Array(PullRequestListEntry),
  errors: Schema.Array(PullRequestListProjectError),
  /** At least one repository hit the per-repository listing cap. */
  truncated: Schema.Boolean,
  /**
   * Return each cursor unchanged. An empty record with truncated=true means
   * the host cannot paginate and more rows require raising limit.
   */
  nextCursors: PullRequestListCursors,
});
export type PullRequestListResult = typeof PullRequestListResult.Type;

/**
 * projectId selects the preferred checkout and, when its repository matches, credentials.
 * Explicit host allows routing through other projects on that host;
 * omitted host uses the project's own host.
 */
export const PullRequestRef = Schema.Struct({
  projectId: ProjectId,
  host: Schema.optional(TrimmedNonEmptyString),
  /** Refuse a routed operation unless this GitHub account still owns the active credential. */
  expectedAccountId: Schema.optional(TrimmedNonEmptyString),
  /** Let another environment answer when this one's cached response has expired. */
  allowStale: Schema.optional(Schema.Boolean),
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
});
export type PullRequestRef = typeof PullRequestRef.Type;

/** Account discovery never needs the originating project's private repository metadata. */
export const PullRequestRoutingIdentityInput = Schema.Struct({
  host: TrimmedNonEmptyString,
});
export type PullRequestRoutingIdentityInput = typeof PullRequestRoutingIdentityInput.Type;

export const PullRequestRoutingIdentityResult = Schema.Struct({
  accountId: TrimmedNonEmptyString,
  host: TrimmedNonEmptyString,
  provider: Schema.Literal("github"),
  viewer: TrimmedNonEmptyString,
});
export type PullRequestRoutingIdentityResult = typeof PullRequestRoutingIdentityResult.Type;

export const PullRequestRoutingResult = Schema.Struct({
  accountId: TrimmedNonEmptyString,
  host: TrimmedNonEmptyString,
  provider: SourceControlProviderKind,
  viewer: TrimmedNonEmptyString,
  projectTitle: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
});
export type PullRequestRoutingResult = typeof PullRequestRoutingResult.Type;

export const PullRequestLinkedThreadsResult = Schema.Struct({
  threads: Schema.Array(
    Schema.Struct({
      id: ThreadId,
      projectId: ProjectId,
      title: Schema.String,
      archivedAt: Schema.NullOr(IsoDateTime),
    }),
  ),
});
export type PullRequestLinkedThreadsResult = typeof PullRequestLinkedThreadsResult.Type;

export const PullRequestPreview = Schema.Struct({
  projectId: ProjectId,
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  author: Schema.NullOr(PullRequestActor),
  state: PullRequestState,
  isDraft: Schema.Boolean,
  createdAt: IsoDateTime,
});
export type PullRequestPreview = typeof PullRequestPreview.Type;

/** Separate from detail so sidebar status reads skip permissions, checks and comparisons. */
export const PullRequestSummary = Schema.Struct({
  provider: SourceControlProviderKind,
  projectId: ProjectId,
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  state: PullRequestState,
  isDraft: Schema.optional(Schema.Boolean),
  headBranch: TrimmedNonEmptyString,
  baseBranch: TrimmedNonEmptyString,
  closedAt: Schema.optional(Schema.NullOr(Schema.String)),
  mergedAt: Schema.optional(Schema.NullOr(Schema.String)),
  updatedAt: IsoDateTime,
  /** Server epoch milliseconds when the provider read started; preserved on cache hits. */
  observedAt: Schema.optional(Schema.Finite),
  author: Schema.optional(Schema.NullOr(PullRequestActor)),
  additions: Schema.optional(NonNegativeInt),
  deletions: Schema.optional(NonNegativeInt),
  changedFiles: Schema.optional(NonNegativeInt),
  reviewDecision: Schema.optional(Schema.NullOr(PullRequestReviewDecision)),
  checksState: Schema.optional(Schema.NullOr(PullRequestChecksState)),
  mergeability: Schema.optional(PullRequestMergeability),
  /** Null when the host says the pull request is in no stack; absent when the read did not ask. */
  stack: Schema.optional(Schema.NullOr(PullRequestStackMembership)),
});
export type PullRequestSummary = typeof PullRequestSummary.Type;

export const PullRequestStack = Schema.Struct({
  id: TrimmedNonEmptyString,
  number: PositiveInt,
  url: TrimmedNonEmptyString,
  base: TrimmedNonEmptyString,
  layers: Schema.Array(
    Schema.Struct({
      number: PositiveInt,
      title: Schema.optional(Schema.String),
      isDraft: Schema.optional(Schema.Boolean),
      headSha: Schema.optional(TrimmedNonEmptyString),
      headBranch: TrimmedNonEmptyString,
      state: PullRequestState,
    }),
  ),
});
export type PullRequestStack = typeof PullRequestStack.Type;

/**
 * Read line counts separately: measured across twelve GitHub repositories,
 * search took 7.1s with counts and 4.0s without; counts cost 40-60% of wall time.
 */
export const PullRequestDiffStat = Schema.Struct({
  projectId: ProjectId,
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
});
export type PullRequestDiffStat = typeof PullRequestDiffStat.Type;

/** Bounded because each reference becomes a host lookup. */
export const PullRequestListStatsInput = Schema.Struct({
  refs: Schema.Array(PullRequestRef).check(Schema.isMaxLength(500)),
});
export type PullRequestListStatsInput = typeof PullRequestListStatsInput.Type;

/** Hosts without batched stats are omitted; their listing's counts remain valid. */
export const PullRequestListStatsResult = Schema.Struct({
  stats: Schema.Array(PullRequestDiffStat),
});
export type PullRequestListStatsResult = typeof PullRequestListStatsResult.Type;

/**
 * With a reference, invalidates detail and diff; without one, listings.
 * Keep refresh explicit so ordinary reads share cached host requests.
 */
export const PullRequestInvalidateInput = Schema.Struct({
  reference: Schema.optional(PullRequestRef),
  /** Refresh review progress across routed environments without discarding the patch. */
  filesViewedOnly: Schema.optional(Schema.Boolean),
});
export type PullRequestInvalidateInput = typeof PullRequestInvalidateInput.Type;

/**
 * A routed read supplies a hint; the receiving environment confirms it
 * with the host before changing thread links.
 */
export const PullRequestReportStateInput = Schema.Struct({
  reference: PullRequestRef,
  state: PullRequestState,
});
export type PullRequestReportStateInput = typeof PullRequestReportStateInput.Type;

export const PullRequestDetail = Schema.Struct({
  provider: SourceControlProviderKind,
  capabilities: PullRequestCapabilities,
  viewerPermissions: PullRequestViewerPermissions,
  projectId: ProjectId,
  projectTitle: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  body: Schema.String,
  url: TrimmedNonEmptyString,
  author: Schema.NullOr(PullRequestActor),
  state: PullRequestState,
  isDraft: Schema.Boolean,
  mergeability: PullRequestMergeability,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  changedFiles: NonNegativeInt,
  headBranch: TrimmedNonEmptyString,
  headRepositoryNameWithOwner: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  headSha: Schema.optional(TrimmedNonEmptyString),
  baseBranch: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  /** Server epoch milliseconds when the provider read started; preserved on cache hits. */
  observedAt: Schema.optional(Schema.Finite),
  mergedAt: Schema.NullOr(IsoDateTime),
  closedAt: Schema.NullOr(IsoDateTime),
  reviewers: Schema.Array(PullRequestActor),
  labels: Schema.Array(PullRequestLabel),
  checks: Schema.Array(PullRequestCheck),
  mergeCapabilities: PullRequestMergeCapabilities,
  /** Signed-in login used to authorize editing remarks; absent disables editing. */
  viewer: Schema.optional(TrimmedNonEmptyString),
  /** Absent does not establish that the branch is current. */
  baseComparison: Schema.optional(PullRequestBaseComparison),
  behindBy: Schema.optional(NonNegativeInt),
  /**
   * Absent means unknown, not disabled; treating it as disabled could
   * arm an auto-merge that is already armed.
   */
  autoMergeEnabled: Schema.optional(Schema.Boolean),
  autoMergeMethod: Schema.optional(PullRequestMergeMethod),
  /** GitHub Actions runs on this head commit that are waiting for a maintainer's approval. */
  workflowApprovalsRequired: Schema.optional(NonNegativeInt),
});
export type PullRequestDetail = typeof PullRequestDetail.Type;

export const PullRequestChecks = Schema.Struct({
  state: PullRequestState,
  checks: Schema.Array(PullRequestCheck),
});
export type PullRequestChecks = typeof PullRequestChecks.Type;

/**
 * Load activity independently so paginated history cannot delay core detail.
 * GitHub's activity query can enrich avatars and completed reviewers.
 */
export const PullRequestActivity = Schema.Struct({
  author: Schema.optional(Schema.NullOr(PullRequestActor)),
  reviewers: Schema.optional(Schema.Array(PullRequestActor)),
  comments: Schema.Array(PullRequestComment),
  /** Host total, never below comments.length; equals it when the read is complete. */
  commentCount: NonNegativeInt,
  /** True only when the read hit its own bound before exhausting the host. */
  commentsTruncated: Schema.Boolean,
  /** Whether the thread listing itself is incomplete, apart from pages within a thread. */
  reviewThreadsTruncated: Schema.optional(Schema.Boolean),
  reviewThreads: Schema.Array(PullRequestReviewThread),
  commits: Schema.Array(PullRequestCommit),
  /** Reactions on the change request's description, separate from comment reactions. */
  reactions: Schema.optional(Schema.Array(PullRequestReaction)),
});
export type PullRequestActivity = typeof PullRequestActivity.Type;

export const PullRequestDetailView = Schema.Struct({
  ...PullRequestDetail.fields,
  ...PullRequestActivity.fields,
  // Restore required identity fields after activity's optional overrides.
  author: Schema.NullOr(PullRequestActor),
  reviewers: Schema.Array(PullRequestActor),
});
export type PullRequestDetailView = typeof PullRequestDetailView.Type;

/**
 * GitHub refuses diffs beyond 300 files. Page by whole files so each slice
 * parses independently and the viewer can render before all files arrive.
 */
export const PullRequestDiffInput = Schema.Struct({
  ...PullRequestRef.fields,
  /** Opaque provider cursor; omit for the first slice. */
  cursor: Schema.optional(TrimmedNonEmptyString),
  /** Omit for the whole change; otherwise read this commit's comparison. */
  commit: Schema.optional(TrimmedNonEmptyString),
});
export type PullRequestDiffInput = typeof PullRequestDiffInput.Type;

/** Real line counts for a file whose hunks the host withheld from the patch. */
export const PullRequestOmittedFileStat = Schema.Struct({
  path: TrimmedNonEmptyString,
  additions: Schema.Number,
  deletions: Schema.Number,
});
export type PullRequestOmittedFileStat = typeof PullRequestOmittedFileStat.Type;

export const PullRequestDiffResult = Schema.Struct({
  patch: Schema.String,
  /** Content omitted within this slice, separate from further slices in nextCursor. */
  truncated: Schema.Boolean,
  nextCursor: Schema.NullOr(TrimmedNonEmptyString),
  /** Use host counts for withheld hunks instead of inferring zero from the patch. */
  omittedFileStats: Schema.optional(Schema.Array(PullRequestOmittedFileStat)),
});
export type PullRequestDiffResult = typeof PullRequestDiffResult.Type;

/** Full old/new contents let Pierre expand context omitted by a host-backed patch. */
export const PullRequestDiffFileContentsInput = Schema.Struct({
  ...PullRequestRef.fields,
  /** One commit's own comparison; absent means the whole change request. */
  commit: Schema.optional(TrimmedNonEmptyString),
  changeType: Schema.Literals(["change", "rename-pure", "rename-changed", "new", "deleted"]),
  oldPath: TrimmedNonEmptyString,
  newPath: TrimmedNonEmptyString,
});
export type PullRequestDiffFileContentsInput = typeof PullRequestDiffFileContentsInput.Type;

export const PullRequestDiffFileContentsResult = Schema.Struct({
  oldContents: Schema.String,
  newContents: Schema.String,
});
export type PullRequestDiffFileContentsResult = typeof PullRequestDiffFileContentsResult.Type;

/** Bound client paths to keep oversized values out of SQL and GraphQL writes. */
const MAX_FILE_PATH_LENGTH = 4096;
/**
 * Do not trim: leading and trailing spaces are legal filename characters
 * and must match the host's viewed-file keys.
 */
const FilePath = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(MAX_FILE_PATH_LENGTH));

/** `dismissed` means a previously viewed file changed in a later push. */
export const PullRequestFileViewedState = Schema.Literals(["unviewed", "viewed", "dismissed"]);
export type PullRequestFileViewedState = typeof PullRequestFileViewedState.Type;

export const PullRequestFileViewed = Schema.Struct({
  path: FilePath,
  state: PullRequestFileViewedState,
});
export type PullRequestFileViewed = typeof PullRequestFileViewed.Type;

/**
 * Read separately from the patch: viewed marks change on every click,
 * while the patch is cached and changes only on pushes.
 */
export const PullRequestFilesViewedResult = Schema.Struct({
  /** Only the files the host reported a state for. A file missing from this list is unviewed. */
  files: Schema.Array(PullRequestFileViewed),
  truncated: Schema.Boolean,
});
export type PullRequestFilesViewedResult = typeof PullRequestFilesViewedResult.Type;

/**
 * Matches the read cap: each mark is a SQL statement or GraphQL field,
 * and clients must be able to read back every mark in a write.
 */
const MAX_FILES_VIEWED_PRESSES = 500;

/** Batch changes because clicks arrive faster than host responses. */
export const PullRequestSetFilesViewedInput = Schema.Struct({
  ...PullRequestRef.fields,
  files: Schema.Array(
    Schema.Struct({
      path: FilePath,
      viewed: Schema.Boolean,
    }),
  ).check(Schema.isMaxLength(MAX_FILES_VIEWED_PRESSES)),
});
export type PullRequestSetFilesViewedInput = typeof PullRequestSetFilesViewedInput.Type;

export const PullRequestStackHead = Schema.Struct({
  number: PositiveInt,
  headSha: TrimmedNonEmptyString,
});
export type PullRequestStackHead = typeof PullRequestStackHead.Type;

export const PullRequestActionInput = Schema.Struct({
  /** Native stack scope; only send to environments advertising pullRequestStackActions. */
  stackNumber: Schema.optional(PositiveInt),
  expectedStackHeads: Schema.optional(Schema.Array(PullRequestStackHead)),
  ...PullRequestRef.fields,
  action: PullRequestAction,
  /** Applies to merge and enable-auto-merge; omitted means the host's default. */
  mergeMethod: Schema.optional(PullRequestMergeMethod),
  /** Only read for `update-branch`, where absent means the host's own default. */
  updateMethod: Schema.optional(PullRequestUpdateMethod),
});
export type PullRequestActionInput = typeof PullRequestActionInput.Type;

// Preserve markdown whitespace. GitHub caps bodies at 65,536 characters;
// the service rejects whitespace-only bodies.
const CommentBody = Schema.String.check(Schema.isNonEmpty()).check(Schema.isMaxLength(65_536));

export const PullRequestCommentInput = Schema.Struct({
  ...PullRequestRef.fields,
  body: CommentBody,
});
export type PullRequestCommentInput = typeof PullRequestCommentInput.Type;

/**
 * Omit unchanged fields; the service rejects a request with neither.
 * Preserve markdown whitespace and allow an empty body to clear the description.
 * GitHub caps titles at 256 characters; 1024 here bounds subprocess input.
 */
export const PullRequestUpdateInput = Schema.Struct({
  ...PullRequestRef.fields,
  title: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(1024))),
  body: Schema.optional(Schema.String.check(Schema.isMaxLength(65_536))),
});
export type PullRequestUpdateInput = typeof PullRequestUpdateInput.Type;

/**
 * kind selects the host endpoint. Review summaries are excluded because
 * some hosts, such as Bitbucket, represent votes without editable text.
 */
export const PullRequestCommentUpdateInput = Schema.Struct({
  ...PullRequestRef.fields,
  commentId: TrimmedNonEmptyString,
  kind: Schema.Literals(["issue-comment", "review-comment"]),
  body: CommentBody,
});
export type PullRequestCommentUpdateInput = typeof PullRequestCommentUpdateInput.Type;

export const PullRequestReviewPosition = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("added"),
    newLine: PositiveInt,
  }),
  Schema.Struct({
    kind: Schema.Literal("deleted"),
    oldLine: PositiveInt,
  }),
  Schema.Struct({
    kind: Schema.Literal("context"),
    oldLine: PositiveInt,
    newLine: PositiveInt,
    /** Which copy of an unchanged line the reviewer selected in a split diff. */
    side: PullRequestDiffSide,
  }),
]);
export type PullRequestReviewPosition = typeof PullRequestReviewPosition.Type;

export const PullRequestReviewCommentDraft = Schema.Struct({
  path: TrimmedNonEmptyString,
  /** GitLab needs both paths to anchor a comment on a renamed file. */
  oldPath: Schema.optional(TrimmedNonEmptyString),
  position: PullRequestReviewPosition,
  body: CommentBody,
});
export type PullRequestReviewCommentDraft = typeof PullRequestReviewCommentDraft.Type;

/**
 * Submit verdict and line comments together so unfinished reviews stay private
 * and hosts without pending reviews behave consistently.
 */
export const PullRequestSubmitReviewInput = Schema.Struct({
  ...PullRequestRef.fields,
  verdict: PullRequestReviewVerdict,
  /** The review's own words. May be empty, which is how an approval with no remarks is sent. */
  body: Schema.String.check(Schema.isMaxLength(65_536)),
  comments: Schema.Array(PullRequestReviewCommentDraft),
});
export type PullRequestSubmitReviewInput = typeof PullRequestSubmitReviewInput.Type;

export const PullRequestThreadCommentsInput = Schema.Struct({
  ...PullRequestRef.fields,
  threadId: TrimmedNonEmptyString,
  cursor: TrimmedNonEmptyString,
});
export type PullRequestThreadCommentsInput = typeof PullRequestThreadCommentsInput.Type;

export const PullRequestThreadCommentsResult = Schema.Struct({
  comments: Schema.Array(PullRequestThreadComment),
  nextCursor: Schema.NullOr(TrimmedNonEmptyString),
});
export type PullRequestThreadCommentsResult = typeof PullRequestThreadCommentsResult.Type;

export const PullRequestThreadReplyInput = Schema.Struct({
  ...PullRequestRef.fields,
  threadId: TrimmedNonEmptyString,
  body: CommentBody,
});
export type PullRequestThreadReplyInput = typeof PullRequestThreadReplyInput.Type;

export const PullRequestThreadResolutionInput = Schema.Struct({
  ...PullRequestRef.fields,
  threadId: TrimmedNonEmptyString,
  resolved: Schema.Boolean,
});
export type PullRequestThreadResolutionInput = typeof PullRequestThreadResolutionInput.Type;

export const PullRequestReactionInput = Schema.Struct({
  ...PullRequestRef.fields,
  /** Omit to react to the change request itself rather than a comment. */
  subjectId: Schema.optional(TrimmedNonEmptyString),
  content: PullRequestReactionContent,
  reacted: Schema.Boolean,
});
export type PullRequestReactionInput = typeof PullRequestReactionInput.Type;

/**
 * Use requested=false to remove a request; requesting a completed reviewer again
 * is a re-request through the same operation.
 */
export const PullRequestReviewerRequestInput = Schema.Struct({
  ...PullRequestRef.fields,
  /**
   * Use candidate IDs. Bound the batch for host limits and client-supplied payloads;
   * GitHub refuses more than fifteen reviewers.
   */
  reviewers: Schema.Array(
    Schema.Struct({ id: TrimmedNonEmptyString, kind: PullRequestReviewerKind }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(25)),
  requested: Schema.Boolean,
});
export type PullRequestReviewerRequestInput = typeof PullRequestReviewerRequestInput.Type;

export const PullRequestLabelChangeInput = Schema.Struct({
  ...PullRequestRef.fields,
  labels: Schema.Array(TrimmedNonEmptyString).check(Schema.isMinLength(1), Schema.isMaxLength(25)),
  applied: Schema.Boolean,
});
export type PullRequestLabelChangeInput = typeof PullRequestLabelChangeInput.Type;

export const PullRequestUnavailableReason = Schema.Literals([
  "cli-missing",
  "cli-unauthenticated",
  "provider-unsupported",
]);
export type PullRequestUnavailableReason = typeof PullRequestUnavailableReason.Type;

/**
 * Keep cli-prefixed reasons for wire compatibility; for GitHub and Bitbucket
 * they describe missing or rejected credentials, not missing tools.
 */
const PROVIDER_REQUIREMENT = new Map<
  string,
  { readonly missing: string; readonly unauthenticated: string }
>([
  [
    "github",
    {
      missing:
        "No GitHub credential on the server. Set GH_TOKEN, or install the GitHub CLI (https://cli.github.com/) and run `gh auth login`.",
      unauthenticated:
        "GitHub has no working credential for this host. Run `gh auth login`, or check the account and hosts in Settings → Source Control.",
    },
  ],
  [
    "forgejo",
    {
      missing:
        "Install Forgejo CLI (`fj` 0.6 or later) from https://codeberg.org/forgejo-contrib/forgejo-cli or Gitea CLI (`tea` 0.16 or later) from https://gitea.com/gitea/tea to browse Forgejo pull requests.",
      unauthenticated:
        "Authenticate your Forgejo or Gitea server with `fj --host <server-url> auth add-token` on the T3 Code server. If fj is missing or unconfigured for that server, use `tea login add`. A configured fj account must be repaired with fj.",
    },
  ],
  [
    "gitlab",
    {
      missing:
        "GitLab CLI (`glab`) is required to browse change requests on this host. Install it from https://gitlab.com/gitlab-org/cli and reload.",
      unauthenticated: "GitLab CLI is not authenticated. Run `glab auth login` and retry.",
    },
  ],
  [
    "azure-devops",
    {
      missing:
        "Azure CLI (`az`) with the Azure DevOps extension is required. Install `az`, then run `az extension add --name azure-devops`.",
      unauthenticated: "Azure CLI is not signed in. Run `az login` and retry.",
    },
  ],
  [
    "bitbucket",
    {
      missing:
        "Bitbucket needs API credentials on the server. Add them in Settings → Source Control.",
      unauthenticated:
        "Bitbucket rejected the configured credentials. Check them in Settings → Source Control.",
    },
  ],
]);

/**
 * Resolve the canonical remote's host, falling back to provider kind.
 * Shared by server and client so workspace host buckets agree.
 */
export function pullRequestHostOf(
  identity:
    | {
        readonly canonicalKey?: string | undefined;
        readonly locator?: { readonly remoteUrl: string } | undefined;
      }
    | null
    | undefined,
  kind: SourceControlProviderKind,
): string {
  if (kind === "forgejo") {
    try {
      const remote = new URL(identity?.locator?.remoteUrl ?? "");
      if (remote.protocol === "http:" || remote.protocol === "https:")
        return remote.host.toLowerCase();
    } catch {
      // SSH remotes retain their canonical host; the CLI resolves their web endpoint.
    }
  }
  const host = identity?.canonicalKey?.split("/")[0]?.trim();
  return host === undefined || host.length === 0 ? kind : host.toLowerCase();
}

/**
 * Resolve me/@me to the signed-in login before server and client author comparisons.
 * With no viewer, leave the filter unchanged.
 */
export function resolvePullRequestAuthorFilter(
  author: string,
  viewer: string | null | undefined,
): string {
  const trimmed = author.trim();
  if (!/^@?me$/i.test(trimmed)) return trimmed;
  return viewer === null || viewer === undefined || viewer.trim().length === 0 ? trimmed : viewer;
}

/** Returns host setup guidance, or null when the failure has no setup remedy. */
export function pullRequestProviderRequirement(
  provider: SourceControlProviderKind,
  reason: PullRequestUnavailableReason,
): string | null {
  const requirement = PROVIDER_REQUIREMENT.get(provider);
  if (requirement === undefined) return null;
  switch (reason) {
    case "cli-missing":
      return requirement.missing;
    case "cli-unauthenticated":
      return requirement.unauthenticated;
    case "provider-unsupported":
      return null;
  }
}

/**
 * Derive stable user-facing text from reason and host; raw provider failures
 * remain in cause.
 */
export class PullRequestUnavailableError extends Schema.TaggedError<PullRequestUnavailableError>()(
  "PullRequestUnavailableError",
  {
    reason: PullRequestUnavailableReason,
    provider: Schema.optional(SourceControlProviderKind),
    cause: Schema.optional(Schema.Defect()),
  },
  { httpApiStatus: 503 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(PullRequestUnavailableError)(this, { status: 503 });
  }

  override get message(): string {
    const requirement =
      this.provider === undefined ? undefined : PROVIDER_REQUIREMENT.get(this.provider);
    switch (this.reason) {
      case "cli-missing":
        return (
          requirement?.missing ?? "The tool this host is read through is not installed or set up."
        );
      case "cli-unauthenticated":
        return requirement?.unauthenticated ?? "This host has no working credentials.";
      case "provider-unsupported":
        return "Change requests cannot be browsed for this project's host yet.";
    }
  }
}

export class PullRequestOperationError extends Schema.TaggedError<PullRequestOperationError>()(
  "PullRequestOperationError",
  {
    operation: Schema.String,
    detail: TrimmedNonEmptyString,
    reason: Schema.optional(Schema.Literal("not-found")),
    cause: Schema.optional(Schema.Defect()),
  },
  { httpApiStatus: 502 },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.schemaJson(PullRequestOperationError)(this, { status: 502 });
  }

  override get message(): string {
    return `Pull request operation ${this.operation} failed: ${this.detail}`;
  }
}
