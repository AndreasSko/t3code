import { SourceControlProviderKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import type { PullRequestCapabilities, PullRequestViewerPermissions } from "@t3tools/contracts";

import * as AzureDevOpsPullRequestCli from "./AzureDevOpsPullRequestCli.ts";
import {
  azureDevOpsFilePatch,
  azureDevOpsUnreadableFilePatch,
  formatAzureDevOpsDiffCursor,
  parseAzureDevOpsDiffCursor,
  MAX_DIFF_SLICE_BYTES,
  MAX_DIFF_SLICE_EDITS,
  MAX_DIFF_SLICE_FILES,
  byteLength,
  MAX_FILE_DIFF_EDITS,
  type AzureDevOpsFileTexts,
} from "./azureDevOpsDiff.ts";
import {
  PullRequestProviderError,
  type PullRequestProviderFailure,
  type ProviderChangeRequest,
  type ProviderChangeRequestActivity,
  type ProviderChangeRequestDetail,
  type ProviderChangeRequestSummary,
  type ProviderDiffSlice,
  type PullRequestProviderApi,
} from "@t3tools/source-control-core/server/PullRequestProvider";
import type {
  AzureDevOpsChangeEntry,
  AzureDevOpsItemContent,
  AzureDevOpsIteration,
  AzureDevOpsPullRequest,
  AzureDevOpsRepositoryLocation,
} from "./azureDevOpsPullRequestJson.ts";
import { definition } from "../client/definition.ts";

/** Each file costs two Python startups; four concurrent files allow eight az processes. */
const DIFF_FILE_CONCURRENCY = 4;

/** Share the spawn budget across readers so concurrent reviews cannot multiply Python startups. */
export const MAX_DIFF_SPAWNS = 2 * DIFF_FILE_CONCURRENCY;

export const LOCATION_CACHE_CAPACITY = 128;

const CAPABILITIES: PullRequestCapabilities = {
  diff: true,
  // Posting has not been exercised against Azure, so the composer stays hidden.
  comment: false,
  actions: [...definition.changeRequestActions],
  // Azure squashes as a completion option; it has no rebase strategy of its own.
  mergeMethods: ["merge", "squash"],
  // `az repos pr list` filters by status, creator, reviewer and branch, and by no text at all.
  search: false,
  reactions: false,
  review: { inlineComment: false, reply: false, resolve: false, verdicts: [] },
  // az adds/removes identities but cannot list candidates; the page takes a name instead.
  reviewers: { request: true, listCandidates: false },
  edit: { changeRequest: true, comment: false },
  // Azure viewed marks use an undocumented, iteration-keyed endpoint; keep environment marks here.
  viewedFiles: "environment",
};

/** az PR reads expose no permissions. Keep actions available and let Azure explain a refusal. */
const AZURE_DEVOPS_VIEWER_PERMISSIONS: PullRequestViewerPermissions = {
  actions: CAPABILITIES.actions,
  comment: CAPABILITIES.comment,
  resolve: CAPABILITIES.review.resolve,
  verdicts: CAPABILITIES.review.verdicts,
  requestReviewers: CAPABILITIES.reviewers.request,
};

export function azureDevOpsProviderFailure(
  error: AzureDevOpsPullRequestCli.AzureDevOpsPullRequestCliError,
): PullRequestProviderFailure {
  if (error._tag === "AzureDevOpsCliUnavailableError") return { reason: "missing-tool" };
  if (error._tag === "AzureDevOpsCliAuthenticationError") return { reason: "unauthenticated" };
  if (error._tag === "AzureDevOpsCliRateLimitError") return { reason: "rate-limited" };
  if (error._tag === "AzureDevOpsPullRequestNotFoundError") return { reason: "not-found" };
  return { reason: "failed" };
}

function toChangeRequest(pullRequest: AzureDevOpsPullRequest): ProviderChangeRequest {
  return {
    number: pullRequest.number,
    title: pullRequest.title,
    url: pullRequest.url,
    author: pullRequest.author,
    headBranch: pullRequest.headBranch,
    baseBranch: pullRequest.baseBranch,
    state: pullRequest.state,
    isDraft: pullRequest.isDraft,
    mergeability: pullRequest.mergeability,
    // Azure counts a pull request's files but never its lines, and counting them here would mean
    // reading every file on both sides of every row of a listing.
    additions: 0,
    deletions: 0,
    createdAt: pullRequest.createdAt,
    closedAt: pullRequest.state === "closed" ? pullRequest.closedAt : null,
    mergedAt: pullRequest.state === "merged" ? pullRequest.closedAt : null,
    updatedAt: pullRequest.updatedAt,
    reviewRequestLogins: pullRequest.reviewRequestLogins,
    // Azure keeps labels on work items rather than on the pull request.
    labels: [],
  };
}

export const make = Effect.gen(function* () {
  const cli = yield* AzureDevOpsPullRequestCli.AzureDevOpsPullRequestCli;
  const diffSpawns = yield* Semaphore.make(MAX_DIFF_SPAWNS);
  const readItemContent = (input: Parameters<typeof cli.readItemContent>[0]) =>
    diffSpawns.withPermits(1)(cli.readItemContent(input));

  const fail =
    (operation: string) => (error: AzureDevOpsPullRequestCli.AzureDevOpsPullRequestCliError) =>
      new PullRequestProviderError({
        provider: SourceControlProviderKind.make("azure-devops"),
        operation,
        ...azureDevOpsProviderFailure(error),
        detail: error.detail,
        cause: error,
      });

  const unsupported = (operation: string) =>
    Effect.fail(
      new PullRequestProviderError({
        provider: SourceControlProviderKind.make("azure-devops"),
        operation,
        reason: "failed",
        detail: "Azure DevOps reviews cannot be written from here yet.",
      }),
    );

  const EMPTY_DIFF_SLICE: ProviderDiffSlice = { patch: "", truncated: false, nextCursor: null };

  /** Cache immutable repository locations; LRU favors recently used reviews over cold entries. */
  const locations = new Map<string, AzureDevOpsRepositoryLocation>();

  const locationOf = (input: { readonly cwd: string; readonly number: number }) => {
    const key = `${input.cwd} ${input.number}`;
    const held = locations.get(key);
    if (held !== undefined) {
      locations.delete(key);
      locations.set(key, held);
      return Effect.succeed(held);
    }
    return cli.getPullRequest({ cwd: input.cwd, number: input.number }).pipe(
      Effect.map((pullRequest) => {
        const location = pullRequest.location;
        if (location === null) return null;
        if (locations.size >= LOCATION_CACHE_CAPACITY) {
          const oldest = locations.keys().next().value;
          if (oldest !== undefined) locations.delete(oldest);
        }
        locations.set(key, location);
        return location;
      }),
    );
  };

  /** Resolve repository location and re-read iterations, since a push adds a new latest iteration. */
  const diffScope = (input: { readonly cwd: string; readonly number: number }) =>
    Effect.gen(function* () {
      const location = yield* locationOf(input);
      if (location === null) return null;
      const iterations = yield* cli.listIterations({
        cwd: input.cwd,
        location,
        number: input.number,
      });
      return { location, iterations };
    });

  const EMPTY_ITEM: AzureDevOpsItemContent = { contents: "", isBinary: false };

  /** Read both sides concurrently; omit nonexistent sides because Azure fails rather than returning empty. */
  const readTexts = (input: {
    readonly cwd: string;
    readonly location: AzureDevOpsRepositoryLocation;
    readonly iteration: AzureDevOpsIteration;
    readonly change: Pick<AzureDevOpsChangeEntry, "changeKind" | "path" | "oldPath">;
  }) =>
    Effect.all(
      [
        input.change.changeKind === "new"
          ? Effect.succeed(EMPTY_ITEM)
          : readItemContent({
              cwd: input.cwd,
              location: input.location,
              path: input.change.oldPath,
              commit: input.iteration.mergeBaseCommit,
            }),
        input.change.changeKind === "deleted"
          ? Effect.succeed(EMPTY_ITEM)
          : readItemContent({
              cwd: input.cwd,
              location: input.location,
              path: input.change.path,
              commit: input.iteration.headCommit,
            }),
      ],
      { concurrency: 2 },
    ).pipe(
      Effect.map(([oldItem, newItem]): AzureDevOpsFileTexts => ({
        oldContents: oldItem.contents,
        newContents: newItem.contents,
        // Azure hands a file it calls binary over in an encoding of its own, so its own word on
        // that is taken rather than looked for in bytes it may never have sent verbatim.
        binary: oldItem.isBinary || newItem.isBinary,
      })),
    );

  /** The latest iteration compares against the merge base, so it contains the whole pull request. */
  const listLatestChanges = (input: {
    readonly cwd: string;
    readonly location: AzureDevOpsRepositoryLocation;
    readonly number: number;
    readonly iterations: ReadonlyArray<AzureDevOpsIteration>;
  }) => {
    const latest = input.iterations.at(-1);
    return latest === undefined
      ? Effect.succeed({
          changes: [],
          truncated: false,
        } as AzureDevOpsPullRequestCli.AzureDevOpsIterationChanges)
      : cli.listIterationChanges({
          cwd: input.cwd,
          location: input.location,
          number: input.number,
          iterationId: latest.id,
        });
  };

  const provider: PullRequestProviderApi = {
    kind: SourceControlProviderKind.make("azure-devops"),
    capabilities: CAPABILITIES,
    // The bare repository name repeats across an organization; the project path does not.
    repositoryKey: ({ canonicalKey }) => canonicalKey,

    getViewer: (input) =>
      cli.getViewer({ cwd: input.cwd }).pipe(Effect.mapError(fail("getViewer"))),

    // az has no free-text PR filter; return the wider page for the caller to filter.
    listChangeRequests: (input) =>
      cli
        .listPullRequests({
          cwd: input.cwd,
          repository: input.repository,
          state: input.state,
          involvement: input.involvement,
          viewer: input.viewer,
          limit: input.limit,
          cursor: input.cursor,
        })
        .pipe(
          Effect.mapError(fail("listChangeRequests")),
          Effect.map((batch) => ({
            items: batch.items.map(toChangeRequest),
            truncated: batch.truncated,
            cursorAdvance: batch.cursorAdvance,
            continues: true,
          })),
        ),

    // Linked-thread polling omits file counts to avoid iteration and change reads.
    getChangeRequestSummary: (input) =>
      cli.getPullRequest({ cwd: input.cwd, number: input.number }).pipe(
        Effect.mapError(fail("getChangeRequestSummary")),
        Effect.map((pullRequest): ProviderChangeRequestSummary => ({
          number: pullRequest.number,
          title: pullRequest.title,
          url: pullRequest.url,
          author: pullRequest.author,
          headBranch: pullRequest.headBranch,
          baseBranch: pullRequest.baseBranch,
          state: pullRequest.state,
          isDraft: pullRequest.isDraft,
          mergeability: pullRequest.mergeability,
          closedAt: pullRequest.state === "closed" ? pullRequest.closedAt : null,
          mergedAt: pullRequest.state === "merged" ? pullRequest.closedAt : null,
          updatedAt: pullRequest.updatedAt,
        })),
      ),

    getChangeRequest: (input) =>
      Effect.gen(function* () {
        const pullRequest = yield* cli.getPullRequest({ cwd: input.cwd, number: input.number });
        const location = pullRequest.location;
        // The file count is two reads past the pull request itself, and it is the only thing
        // riding on them, so a failure leaves it unknown rather than losing the whole detail.
        const changedFiles =
          location === null
            ? 0
            : yield* cli.listIterations({ cwd: input.cwd, location, number: input.number }).pipe(
                Effect.flatMap((iterations) =>
                  listLatestChanges({
                    cwd: input.cwd,
                    location,
                    number: input.number,
                    iterations,
                  }),
                ),
                Effect.map((listed) => listed.changes.length),
                Effect.orElseSucceed(() => 0),
              );
        const detail: ProviderChangeRequestDetail = {
          ...toChangeRequest(pullRequest),
          body: pullRequest.body,
          changedFiles,
          mergedAt: pullRequest.state === "merged" ? pullRequest.closedAt : null,
          closedAt: pullRequest.state === "closed" ? pullRequest.closedAt : null,
          reviewers: pullRequest.reviewers,
          checks: [],
          mergeCapabilities: { merge: true, squash: true, rebase: false },
          viewerPermissions: AZURE_DEVOPS_VIEWER_PERMISSIONS,
          autoMergeEnabled: pullRequest.autoMergeEnabled,
          ...(pullRequest.autoMergeMethod === undefined
            ? {}
            : { autoMergeMethod: pullRequest.autoMergeMethod }),
        };
        return detail;
      }).pipe(Effect.mapError(fail("getChangeRequest"))),

    getChangeRequestActivity: (input) =>
      cli.getPullRequest({ cwd: input.cwd, number: input.number }).pipe(
        Effect.mapError(fail("getChangeRequestActivity")),
        Effect.flatMap((pullRequest) =>
          (pullRequest.location === null
            ? Effect.succeed({ comments: [], truncated: true })
            : cli
                .listThreads({
                  cwd: input.cwd,
                  location: pullRequest.location,
                  number: input.number,
                })
                .pipe(
                  Effect.map((comments) => ({ comments, truncated: false })),
                  Effect.orElseSucceed(() => ({ comments: [], truncated: true })),
                )
          ).pipe(
            Effect.map((conversation): ProviderChangeRequestActivity => ({
              comments: conversation.comments,
              commentCount: conversation.comments.length,
              commentsTruncated: conversation.truncated,
              reviewThreads: [],
              commits: [],
            })),
          ),
        ),
      ),

    // No az PR endpoint reports viewer permissions, so this needs no request.
    getViewerPermissions: () => Effect.succeed(AZURE_DEVOPS_VIEWER_PERMISSIONS),

    // `input.commit` is deliberately dropped: Azure states no commit list on a pull request, so
    // the Code tab has nothing to scope itself to and always asks for the whole change.
    getDiff: (input) =>
      Effect.gen(function* () {
        const scope = yield* diffScope(input);
        if (scope === null) return EMPTY_DIFF_SLICE;
        const cursor = parseAzureDevOpsDiffCursor(input.cursor);
        // Reading on stays with the push the first slice was taken against. A push landing
        // mid-read would otherwise renumber the files and hand the reader one twice, or none.
        const iteration =
          cursor === null
            ? scope.iterations.at(-1)
            : scope.iterations.find((candidate) => candidate.id === cursor.iterationId);
        if (iteration === undefined) return EMPTY_DIFF_SLICE;
        const listed = yield* cli.listIterationChanges({
          cwd: input.cwd,
          location: scope.location,
          number: input.number,
          iterationId: iteration.id,
        });
        const changes = listed.changes;

        const sections: string[] = [];
        let truncated = listed.truncated;
        let bytes = 0;
        let edits = 0;
        let index = cursor?.fileIndex ?? 0;
        let full = false;
        // Size batches by remaining budgets and observed per-file cost to avoid reading files twice.
        // Always admit one file so an oversized section cannot stall the cursor.
        const batchWidth = () => {
          if (sections.length === 0) return DIFF_FILE_CONCURRENCY;
          const admits = (left: number, spent: number) =>
            Math.ceil(left / Math.max(1, spent / sections.length));
          return Math.max(
            1,
            Math.min(
              DIFF_FILE_CONCURRENCY,
              MAX_DIFF_SLICE_FILES - sections.length,
              admits(MAX_DIFF_SLICE_BYTES - bytes, bytes),
              admits(MAX_DIFF_SLICE_EDITS - MAX_FILE_DIFF_EDITS - edits, edits),
            ),
          );
        };
        while (!full && index < changes.length) {
          const batch = changes.slice(index, index + batchWidth());
          const read = yield* Effect.forEach(
            batch,
            (change) =>
              // A pair Azure refuses is one file rather than the whole slice: an oversize blob or
              // a path `az` will not carry through leaves that file listed without its hunks, and
              // everything around it still renders.
              readTexts({ cwd: input.cwd, location: scope.location, iteration, change }).pipe(
                // Recover only file-specific failures; auth, rate limits and missing az must reach the host handler.
                Effect.catchTags({
                  AzureDevOpsPullRequestNotFoundError: () => Effect.succeed(null),
                  AzureDevOpsCommandFailedError: () => Effect.succeed(null),
                  AzureDevOpsPullRequestReadError: () => Effect.succeed(null),
                }),
                Effect.map((texts) => ({ change, texts })),
              ),
            { concurrency: DIFF_FILE_CONCURRENCY },
          );
          for (const { change, texts } of read) {
            // Yield before synchronous diff work so other server tasks can run between files.
            yield* Effect.yieldNow;
            const file =
              texts === null
                ? azureDevOpsUnreadableFilePatch(change)
                : azureDevOpsFilePatch({ change, texts });
            sections.push(file.section);
            bytes += byteLength(file.section);
            edits += file.edits;
            truncated = truncated || file.truncated;
            index += 1;
            // Header-only files still cost two reads, so bound file count as well as bytes and edits.
            // Check after adding a file so an oversized section still advances the cursor.
            if (
              bytes >= MAX_DIFF_SLICE_BYTES ||
              edits + MAX_FILE_DIFF_EDITS > MAX_DIFF_SLICE_EDITS ||
              sections.length >= MAX_DIFF_SLICE_FILES ||
              file.abandoned
            ) {
              full = true;
              break;
            }
          }
        }

        const slice: ProviderDiffSlice = {
          patch: sections.join(""),
          truncated,
          nextCursor:
            index >= changes.length
              ? null
              : formatAzureDevOpsDiffCursor({ iterationId: iteration.id, fileIndex: index }),
        };
        return slice;
      }).pipe(Effect.mapError(fail("getDiff"))),

    // Expansion re-reads both files at the latest iteration because the request carries no push identity.
    getDiffFileContents: (input) =>
      Effect.gen(function* () {
        const scope = yield* diffScope(input);
        const iteration = scope?.iterations.at(-1);
        if (scope === null || iteration === undefined) return { oldContents: "", newContents: "" };
        return yield* readTexts({
          cwd: input.cwd,
          location: scope.location,
          iteration,
          change: {
            changeKind: input.changeType,
            path: input.newPath,
            oldPath: input.oldPath,
          },
        });
      }).pipe(Effect.mapError(fail("getDiffFileContents"))),

    /** Missing paths mean deleted only after a complete changes read; omit them when truncated
     * so an unseen file cannot lose its viewed mark. */
    getFileRevisions: (input) =>
      Effect.gen(function* () {
        const revisions = new Map<string, string>();
        if (input.paths.length === 0) return { revisions };
        const scope = yield* diffScope(input);
        if (scope === null) return { revisions };
        const listed = yield* listLatestChanges({
          ...scope,
          cwd: input.cwd,
          number: input.number,
        });
        const marked = new Set(input.paths);
        for (const change of listed.changes) {
          if (!marked.has(change.path) || change.objectId === null) continue;
          revisions.set(change.path, change.objectId);
        }
        if (!listed.truncated) {
          for (const path of input.paths) {
            if (!revisions.has(path)) revisions.set(path, "");
          }
        }
        return { revisions };
      }).pipe(Effect.mapError(fail("getFileRevisions"))),

    runAction: (input) =>
      cli
        .runPullRequestAction({
          cwd: input.cwd,
          number: input.number,
          action: input.action,
          ...(input.mergeMethod === undefined ? {} : { mergeMethod: input.mergeMethod }),
        })
        .pipe(Effect.mapError(fail("runAction"))),

    updateChangeRequest: (input) =>
      cli
        .updatePullRequest({
          cwd: input.cwd,
          number: input.number,
          title: input.title,
          body: input.body,
        })
        .pipe(Effect.mapError(fail("updateChangeRequest"))),

    listReviewerCandidates: () =>
      Effect.fail(
        new PullRequestProviderError({
          provider: SourceControlProviderKind.make("azure-devops"),
          operation: "listReviewerCandidates",
          reason: "failed",
          detail: "Azure DevOps cannot say who may review a pull request.",
        }),
      ),

    setReviewerRequest: (input) =>
      cli
        .setPullRequestReviewers({
          cwd: input.cwd,
          number: input.number,
          // Azure names an identity by an email address or a guid, and has no team to ask, so a
          // candidate's id is the whole of what it takes.
          reviewers: input.reviewers.map((reviewer) => reviewer.id),
          requested: input.requested,
        })
        .pipe(Effect.mapError(fail("setReviewerRequest"))),

    comment: () => unsupported("comment"),

    submitReview: () => unsupported("submitReview"),

    replyToThread: () => unsupported("replyToThread"),

    setThreadResolution: () => unsupported("setThreadResolution"),

    setReaction: () => unsupported("setReaction"),
  };

  return provider;
});
