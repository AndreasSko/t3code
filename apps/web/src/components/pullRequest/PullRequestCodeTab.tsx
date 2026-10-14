import type { CodeViewItem, DiffLineAnnotation, SelectedLineRange } from "@pierre/diffs";
import type { CodeViewDiffItem, CodeViewHandle } from "@pierre/diffs/react";
import type {
  EnvironmentId,
  PullRequestDetailView,
  PullRequestDiffSide,
  PullRequestOmittedFileStat,
  PullRequestRef,
  PullRequestReviewPosition,
  PullRequestReviewThread,
  PullRequestThreadCommentsResult,
} from "@t3tools/contracts";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  Columns2Icon,
  FolderTreeIcon,
  InfoIcon,
  MessageSquareOffIcon,
  PilcrowIcon,
  Rows3Icon,
  Settings2Icon,
  TextWrapIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide";
import { useAtomRefresh } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { areAllDiffFilesCollapsed } from "~/lib/diffCollapse";
import { pullRequestFindingKey, type PullRequestFinding } from "./pullRequestDetail.logic";
import { canEditPullRequestComment, canResolvePullRequestThread } from "./pullRequestEditing.logic";
import { orderDiffFiles } from "./pullRequestFileOrder.logic";
import {
  buildFileDiffRenderKey,
  fnv1a32,
  getDiffLineStat,
  getRenderablePatch,
  resolveDiffThemeName,
  resolveFileDiffPath,
  resolveFileDiffPreviousPath,
  type RenderablePatch,
} from "~/lib/diffRendering";
import { APP_BASE_NAME } from "~/branding";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { cn } from "~/lib/utils";
import { createPullRequestDiffFileContentsLoader } from "~/lib/diffFileContents";
import {
  buildDiffReviewComment,
  resolveDiffReviewPosition,
  type ReviewCommentContext,
} from "~/reviewCommentContext";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { DiffPanelLoadingState } from "../DiffPanelShell";
import { DiffCommentAnnotation } from "../diffs/DiffCommentAnnotation";
import { DiffFileTree } from "../diffs/DiffFileTree";
import { useCodeViewFileReveal } from "../diffs/useCodeViewFileReveal";
import { diffFileTreeEntries } from "../diffs/diffFileTree.logic";
import { StyledDiffCodeView } from "../diffs/StyledDiffCodeView";
import { Button } from "../ui/button";
import { MorphIcon } from "~/components/MorphIcon";
import { Checkbox } from "../ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  getReviewPositionAnchor,
  PendingReviewCommentCard,
  ReviewThreadCard,
  toViewerSide,
} from "./PullRequestReviewAnnotation";
import {
  isFileDiffCollapsed,
  isLineInFileDiff,
  toggleFileDiffFoldForViewed,
  type DiffFoldOverride,
} from "./pullRequestDiff.logic";
import { PullRequestDiffStat, PullRequestMetaLine } from "./pullRequestPresentation";
import { usePullRequestFilesViewed } from "./usePullRequestFilesViewed";
import {
  nextPendingReviewCommentId,
  pullRequestReviewKey,
  usePendingReviewComments,
  usePullRequestReviewStore,
  type PendingReviewComment,
} from "./pullRequestReviewStore";

interface ReviewAnnotationGroup {
  readonly threads: ReadonlyArray<PullRequestReviewThread>;
  readonly pending: ReadonlyArray<PendingReviewComment>;
  readonly draft: boolean;
}

type ReviewAnnotation = DiffLineAnnotation<ReviewAnnotationGroup>;

/** Commits per press of "Show more" in the scope menu. */
const COMMIT_PAGE_SIZE = 10;

const PULL_REQUEST_FILE_TREE_STORAGE_KEY = "t3code.pullRequestFileTreeOpen";

interface DiffSlice {
  /** What was asked for, null being the first slice. Identifies the slice among the loaded ones. */
  readonly cursor: string | null;
  readonly patch: string;
  readonly truncated: boolean;
  readonly nextCursor: string | null;
  readonly omittedFileStats: ReadonlyArray<PullRequestOmittedFileStat>;
}

/** Use host counts: hunk sums misrepresent files whose hunks were withheld as empty changes. */
const REPLACE_FILE_COUNTS_CSS = `
[data-diffs-header] [data-additions-count],
[data-diffs-header] [data-deletions-count] {
  display: none !important;
}`;

const NO_SLICES: ReadonlyArray<DiffSlice> = [];

interface MutableAnnotationGroup {
  readonly side: PullRequestDiffSide;
  readonly line: number;
  readonly threads: PullRequestReviewThread[];
  readonly pending: PendingReviewComment[];
  draft: boolean;
}

interface DraftAnchor {
  readonly fileKey: string;
  readonly path: string;
  /** What the file was called before the change, for the hosts that resolve a position by both. */
  readonly oldPath: string | null;
  readonly position: PullRequestReviewPosition;
  /** The whole selection, which the comment collapses to one line but a question keeps. */
  readonly range: SelectedLineRange;
}

export interface PullRequestAgentSelectionInput {
  readonly comment: ReviewCommentContext;
  readonly request: string;
}

/** New inline comments join the local review draft rather than posting immediately. */
function PullRequestCodeTab({
  scrollerRef,
  environmentId,
  reference,
  detail,
  selectedCommitOid,
  onSelectedCommitChange,
  pendingFinding,
  fixFindingLabel = "Fix in a thread",
  onFixFinding,
  onAddToAgentSelection,
  onRefresh,
  refreshToken = 0,
  revealRequest = null,
}: {
  scrollerRef: (node: HTMLDivElement | null) => void;
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  detail: PullRequestDetailView;
  /** Commit whose diff is open. Null keeps the whole pull-request diff selected. */
  selectedCommitOid: string | null;
  onSelectedCommitChange: (oid: string | null) => void;
  pendingFinding?: string | null;
  fixFindingLabel?: string;
  onFixFinding?: (finding: PullRequestFinding) => void;
  onAddToAgentSelection?: (input: PullRequestAgentSelectionInput) => void;
  onRefresh: () => void;
  /** Bumped by the panel's refresh button: drop the accumulated pages and re-read the diff. */
  refreshToken?: number;
  /** A file another tab asked to show. A new nonce asks again for the same path. */
  revealRequest?: { readonly path: string; readonly nonce: number } | null;
}) {
  const { resolvedTheme } = useTheme();
  const settings = useClientSettings();
  const [toggledFiles, setToggledFiles] = useState<ReadonlySet<string>>(() => new Set());
  // Keep the commit menu to 10 entries per page; large changes would otherwise turn it into a scroll.
  const [visibleCommitCount, setVisibleCommitCount] = useState(COMMIT_PAGE_SIZE);
  /** Set once the reader has asked for every file at once, until they pick a file apart again. */
  const [foldOverride, setFoldOverride] = useState<DiffFoldOverride>(null);
  const effectiveFoldOverride =
    foldOverride ?? (settings.diffFilesCollapsed ? "folded" : "expanded");
  const diffLayout = settings.diffLayout;
  const updateClientSettings = useUpdateClientSettings();
  const [wordWrap, setWordWrap] = useState(settings.wordWrap);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(settings.diffIgnoreWhitespace);
  const [fileTreeOpen, setFileTreeOpen] = useLocalStorage(
    PULL_REQUEST_FILE_TREE_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const [selectedLines, setSelectedLines] = useState<{
    id: string;
    range: SelectedLineRange;
  } | null>(null);
  const [draft, setDraft] = useState<DraftAnchor | null>(null);
  const [threadPending, setThreadPending] = useState(false);
  const [orphansOpen, setOrphansOpen] = useState(false);
  // Bind slices to the PR before effects reset state so stale cursors cannot reach another PR.
  const [sliceState, setSliceState] = useState<{
    readonly key: string;
    readonly cursor: string | null;
    readonly slices: ReadonlyArray<DiffSlice>;
  }>({ key: "", cursor: null, slices: NO_SLICES });
  const parseCache = useRef(new Map<string, RenderablePatch>());
  const [viewer, setViewer] = useState<CodeViewHandle<ReviewAnnotationGroup, undefined> | null>(
    null,
  );

  const referenceKey = pullRequestReviewKey(reference);
  const commit = selectedCommitOid;
  const scopeKey = commit === null ? referenceKey : `${referenceKey}@${commit}`;
  // Reset on PR switches so an open composer cannot attach its comment to another change.
  useEffect(() => {
    setDraft(null);
    setSelectedLines(null);
    setToggledFiles(new Set());
    setFoldOverride(null);
    setVisibleCommitCount(COMMIT_PAGE_SIZE);
    setOrphansOpen(false);
    setSliceState({ key: scopeKey, cursor: null, slices: NO_SLICES });
    parseCache.current.clear();
  }, [scopeKey]);

  const loadedSlices = sliceState.key === scopeKey ? sliceState.slices : NO_SLICES;
  const cursor = sliceState.key === scopeKey ? sliceState.cursor : null;
  const diffQuery = useEnvironmentQuery(
    pullRequestEnvironment.diff({
      environmentId,
      input: {
        ...reference,
        ...(cursor === null ? {} : { cursor }),
        ...(commit === null ? {} : { commit }),
      },
    }),
  );
  // Preserve slices separately to avoid reparsing an increasingly concatenated patch.
  useEffect(() => {
    const data = diffQuery.data;
    if (data === null) return;
    setSliceState((previous) => {
      const slices = previous.key === scopeKey ? previous.slices : NO_SLICES;
      const next = {
        cursor,
        patch: data.patch,
        truncated: data.truncated,
        nextCursor: data.nextCursor,
        omittedFileStats: data.omittedFileStats ?? [],
      };
      const index = slices.findIndex((slice) => slice.cursor === cursor);
      if (index === -1) {
        return { key: scopeKey, cursor, slices: [...slices, next] };
      }
      const existing = slices[index];
      if (
        existing !== undefined &&
        existing.patch === next.patch &&
        existing.truncated === next.truncated &&
        existing.nextCursor === next.nextCursor &&
        existing.omittedFileStats.length === next.omittedFileStats.length &&
        existing.omittedFileStats.every((file, index) => {
          const refreshed = next.omittedFileStats[index];
          return (
            refreshed !== undefined &&
            refreshed.path === file.path &&
            refreshed.additions === file.additions &&
            refreshed.deletions === file.deletions
          );
        })
      ) {
        return previous;
      }
      // Replacement pages invalidate later cursors because they belonged to the old diff.
      return { key: scopeKey, cursor, slices: [...slices.slice(0, index), next] };
    });
  }, [cursor, diffQuery.data, scopeKey]);
  // Refresh from page one because cursors address one snapshot of the diff.
  const refreshFirstDiffPage = useAtomRefresh(
    pullRequestEnvironment.diff({
      environmentId,
      input: { ...reference, ...(commit === null ? {} : { commit }) },
    }),
  );
  const reviewKey = referenceKey;
  const pendingComments = usePendingReviewComments(reference);
  const addComment = usePullRequestReviewStore((store) => store.addComment);
  const removeComment = usePullRequestReviewStore((store) => store.removeComment);
  const replyToThread = useAtomCommand(pullRequestEnvironment.replyToThread, {
    reportFailure: false,
  });
  const setThreadResolution = useAtomCommand(pullRequestEnvironment.setThreadResolution, {
    reportFailure: false,
  });
  const updateComment = useAtomCommand(pullRequestEnvironment.updateComment, {
    reportFailure: false,
  });
  const loadThreadComments = useAtomCommand(pullRequestEnvironment.threadComments, {
    reportFailure: false,
  });
  const getDiffFileContents = useAtomCommand(pullRequestEnvironment.diffFileContents);
  const loadDiffFiles = useMemo(
    () =>
      createPullRequestDiffFileContentsLoader(getDiffFileContents, {
        environmentId,
        reference,
        commit,
        cacheKey: `pull-request:${referenceKey}:${detail.updatedAt}:${commit ?? "all"}`,
      }),
    [commit, detail.updatedAt, environmentId, getDiffFileContents, reference, referenceKey],
  );

  const review = useMemo(() => {
    const hostReview = detail.capabilities.review;
    const viewer = detail.viewerPermissions;
    return {
      inlineComment: hostReview.inlineComment && viewer.comment,
      reply: hostReview.reply && viewer.comment,
      resolve: hostReview.resolve && viewer.resolve,
    };
  }, [detail.capabilities.review, detail.viewerPermissions]);
  // Review comments anchor to the head diff; commit-scope line numbers address different code.
  const canCommentOnLines = review.inlineComment && commit === null;
  // Cache each parsed slice independently; theme changes invalidate tokenizer output.
  const parsedSlices = useMemo(
    () =>
      loadedSlices.map((slice) => {
        // Refreshed pages reuse cursors, so hash patch contents to invalidate their cached parse.
        const cacheKey = `pull-request:${scopeKey}:${resolvedTheme}:${ignoreWhitespace}:${slice.cursor ?? "first"}:${fnv1a32(slice.patch)}`;
        const cached = parseCache.current.get(cacheKey);
        if (cached) return cached;
        const parsed = getRenderablePatch(slice.patch, cacheKey, {
          compactPartialHunkOffsets: true,
          ignoreWhitespace,
        });
        if (parsed) parseCache.current.set(cacheKey, parsed);
        return parsed;
      }),
    [loadedSlices, resolvedTheme, scopeKey, ignoreWhitespace],
  );
  // Order only within slices so later arrivals cannot move files being read.
  const files = useMemo(
    () =>
      parsedSlices.flatMap((parsed) =>
        parsed?.kind === "files" ? orderDiffFiles(parsed.files) : [],
      ),
    [parsedSlices],
  );
  const filePaths = useMemo(() => files.map((file) => resolveFileDiffPath(file)), [files]);
  // Viewed state belongs to the PR, so clearing a file applies across commit scopes.
  const viewedFilesStore = detail.capabilities.viewedFiles;
  const filesViewed = usePullRequestFilesViewed({
    environmentId,
    reference,
    enabled: viewedFilesStore !== undefined,
    paths: filePaths,
  });
  const {
    setViewed,
    refresh: refreshFilesViewed,
    enabled: filesViewedEnabled,
    isViewed: isFileViewed,
    isStale: isFileViewedStale,
  } = filesViewed;
  // Host refresh must restart diffs and viewed marks that a newer push may have invalidated.
  const appliedRefreshToken = useRef(refreshToken);
  useEffect(() => {
    if (appliedRefreshToken.current === refreshToken) return;
    appliedRefreshToken.current = refreshToken;
    setSliceState({ key: scopeKey, cursor: null, slices: NO_SLICES });
    refreshFirstDiffPage();
    refreshFilesViewed();
  }, [refreshToken, scopeKey, refreshFirstDiffPage, refreshFilesViewed]);
  const nextCursor = loadedSlices.at(-1)?.nextCursor ?? null;
  // Withheld or unparsed content does not imply another page is available.
  const withheldContent =
    loadedSlices.some((slice) => slice.truncated) ||
    parsedSlices.some((parsed) => parsed?.kind === "raw");

  // Threads outside rendered hunks belong in the off-diff list instead of disappearing.
  const placedThreadIds = useMemo(() => {
    const placed = new Set<string>();
    // Commit-scoped line numbers differ from the head diff where review comments anchor.
    if (commit !== null) return placed;
    for (const file of files) {
      const path = resolveFileDiffPath(file);
      for (const thread of detail.reviewThreads) {
        if (
          thread.path === path &&
          thread.line !== null &&
          isLineInFileDiff(file, thread.side, thread.line)
        ) {
          placed.add(thread.id);
        }
      }
    }
    return placed;
  }, [commit, detail.reviewThreads, files]);

  // Separate expensive annotation hashes from cheap viewed/folded state changes.
  const annotatedFiles = useMemo(
    () =>
      files.map((fileDiff) => {
        const fileKey = buildFileDiffRenderKey(fileDiff);
        const path = resolveFileDiffPath(fileDiff);
        // One annotation per line must hold both the existing conversation and the new draft.
        const groups = new Map<string, MutableAnnotationGroup>();
        const groupAt = (side: PullRequestDiffSide, line: number) => {
          const key = `${side}:${line}`;
          const existing = groups.get(key);
          if (existing) return existing;
          const created: MutableAnnotationGroup = {
            side,
            line,
            threads: [],
            pending: [],
            draft: false,
          };
          groups.set(key, created);
          return created;
        };

        for (const thread of detail.reviewThreads) {
          if (thread.path !== path || thread.line === null) continue;
          if (!placedThreadIds.has(thread.id)) continue;
          groupAt(thread.side, thread.line).threads.push(thread);
        }
        if (commit === null) {
          for (const comment of pendingComments) {
            if (comment.path !== path) continue;
            const anchor = getReviewPositionAnchor(comment.position);
            groupAt(anchor.side, anchor.line).pending.push(comment);
          }
        }
        if (draft?.fileKey === fileKey) {
          const anchor = getReviewPositionAnchor(draft.position);
          groupAt(anchor.side, anchor.line).draft = true;
        }

        const annotations: ReviewAnnotation[] = [...groups.values()].map((group) => ({
          side: toViewerSide(group.side),
          lineNumber: group.line,
          metadata: { threads: group.threads, pending: group.pending, draft: group.draft },
        }));
        return {
          fileKey,
          path,
          fileDiff,
          annotations,
          // Item versions must include annotation content or the viewer will not rerender it.
          annotationsVersion: fnv1a32(
            annotations
              .map(
                ({ side, lineNumber, metadata }) =>
                  `${side}:${lineNumber}:${metadata.draft ? "d" : ""}:${metadata.pending
                    .map((comment) => `${comment.id}:${comment.body}`)
                    .join(",")}:${metadata.threads
                    .map(
                      (thread) =>
                        `${thread.id}:${thread.isResolved ? "r" : ""}:${
                          thread.isOutdated ? "o" : ""
                        }:${thread.comments
                          .map(
                            (comment) =>
                              `${comment.id}:${comment.author?.login ?? ""}:${comment.createdAt}:${comment.body}:${(
                                comment.reactions ?? []
                              )
                                .map(
                                  (r) => `${r.content}:${r.count}:${r.viewerHasReacted ? "v" : ""}`,
                                )
                                .join(",")}`,
                          )
                          .join(";")}`,
                    )
                    .join(",")}`,
              )
              .join("|"),
          ),
        };
      }),
    [commit, detail.reviewThreads, draft, files, pendingComments, placedThreadIds],
  );

  const items = useMemo<CodeViewDiffItem<ReviewAnnotationGroup>[]>(
    () =>
      annotatedFiles.map(({ fileKey, path, fileDiff, annotations, annotationsVersion }) => {
        const collapsed = isFileDiffCollapsed(fileKey, effectiveFoldOverride, toggledFiles);
        // Ticking an already folded file still needs an item-version change to update its checkbox.
        const viewedMark = filesViewedEnabled
          ? `e${isFileViewed(path) ? "v" : ""}${isFileViewedStale(path) ? "s" : ""}`
          : "";
        return {
          id: fileKey,
          type: "diff" as const,
          fileDiff,
          annotations,
          collapsed,
          version: fnv1a32(`${collapsed ? "1" : "0"}:${viewedMark}:${annotationsVersion}`),
        };
      }),
    [
      annotatedFiles,
      filesViewedEnabled,
      effectiveFoldOverride,
      isFileViewed,
      isFileViewedStale,
      toggledFiles,
    ],
  );
  const omittedFileStats = useMemo(
    () =>
      new Map(
        loadedSlices.flatMap((slice) =>
          slice.omittedFileStats.map((file) => [file.path, file] as const),
        ),
      ),
    [loadedSlices],
  );
  const sourceFileStats = useMemo(
    () =>
      new Map(
        parsedSlices.flatMap((parsed) =>
          parsed?.kind === "files"
            ? parsed.files.map(
                (file, index) =>
                  [
                    buildFileDiffRenderKey(file),
                    getDiffLineStat([parsed.sourceFiles[index] ?? file]),
                  ] as const,
              )
            : [],
        ),
      ),
    [parsedSlices],
  );
  const fileKeys = useMemo(() => items.map((item) => item.id), [items]);
  const collapsedFileKeys = useMemo(
    () => new Set(items.filter((item) => item.collapsed === true).map((item) => item.id)),
    [items],
  );
  const allFilesCollapsed = areAllDiffFilesCollapsed(fileKeys, collapsedFileKeys);
  const fileTreeEntries = useMemo(() => diffFileTreeEntries(files), [files]);

  // A persistent sentinel would retry failed slices forever; require an explicit retry.
  const canLoadNextSlice =
    nextCursor !== null &&
    nextCursor !== cursor &&
    !diffQuery.isPending &&
    diffQuery.error === null;
  const loadNextSlice = useCallback(() => {
    if (nextCursor === null) return;
    setSliceState((previous) => ({ ...previous, cursor: nextCursor }));
  }, [nextCursor]);

  // The viewer mounts its footer asynchronously; state reruns the observer when the sentinel exists.
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (sentinel === null || !canLoadNextSlice) return;
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed.some((entry) => entry.isIntersecting)) loadNextSlice();
      },
      // Prefetch the next slice 240 px before the sentinel reaches the viewport.
      { rootMargin: "240px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canLoadNextSlice, loadNextSlice, sentinel]);

  // Stable callbacks preserve viewer SlotPortals memos instead of recreating every visible portal.
  const toggleFile = useCallback(
    (fileKey: string) =>
      setToggledFiles((current) => {
        const next = new Set(current);
        if (next.has(fileKey)) next.delete(fileKey);
        else next.add(fileKey);
        return next;
      }),
    [],
  );

  // Viewing also folds files, but toolbar folding must not mark them viewed.
  const setFileViewed = useCallback(
    (fileKey: string, path: string, viewed: boolean) => {
      setViewed(path, viewed);
      setToggledFiles((current) =>
        toggleFileDiffFoldForViewed(fileKey, viewed, effectiveFoldOverride, current),
      );
    },
    [effectiveFoldOverride, setViewed],
  );

  const requestTreeReveal = useCodeViewFileReveal(viewer, scopeKey);
  const revealFile = useCallback(
    (path: string) => {
      const item = items.find((candidate) => resolveFileDiffPath(candidate.fileDiff) === path);
      if (item === undefined) return;
      if (item.collapsed === true) toggleFile(item.id);
      requestTreeReveal(item.id);
    },
    [items, requestTreeReveal, toggleFile],
  );
  // Keep reveals pending until their file arrives through diff pagination.
  const answeredReveal = useRef<number | null>(null);
  useEffect(() => {
    if (revealRequest === null || answeredReveal.current === revealRequest.nonce) return;
    if (!items.some((item) => resolveFileDiffPath(item.fileDiff) === revealRequest.path)) {
      // The reader is not scrolling toward it, so the sentinel would never ask for its slice.
      if (canLoadNextSlice) loadNextSlice();
      return;
    }
    answeredReveal.current = revealRequest.nonce;
    revealFile(revealRequest.path);
  }, [canLoadNextSlice, items, loadNextSlice, revealFile, revealRequest]);

  const toggleAllFiles = () => {
    // A fold override also applies to future slices, unlike a set of currently loaded file keys.
    setFoldOverride(areAllDiffFilesCollapsed(fileKeys, collapsedFileKeys) ? "expanded" : "folded");
    setToggledFiles(new Set());
  };

  const orderedCommits = useMemo(
    () =>
      // GitLab timestamps retain UTC offsets; compare instants rather than strings.
      detail.commits.toSorted(
        (left, right) => Date.parse(right.committedDate) - Date.parse(left.committedDate),
      ),
    [detail.commits],
  );

  const beginComment = useCallback(
    (range: SelectedLineRange | null, context: { item: CodeViewItem<ReviewAnnotationGroup> }) => {
      if (!range || !canCommentOnLines) return;
      const item = context.item;
      if (item.type !== "diff") return;
      const file = files.find((candidate) => buildFileDiffRenderKey(candidate) === item.id);
      if (!file) return;
      // Only GitHub supports multiline comments; use the range's final line consistently across hosts.
      const path = resolveFileDiffPath(file);
      const previousPath = resolveFileDiffPreviousPath(file);
      const sourceFile = parsedSlices
        .flatMap((slice) => (slice?.kind === "files" ? slice.sourceFiles : []))
        .find((candidate) => resolveFileDiffPath(candidate) === path);
      const side = range.endSide ?? range.side;
      const position =
        (sourceFile && resolveDiffReviewPosition(sourceFile, range.end, side)) ??
        resolveDiffReviewPosition(file, range.end, side);
      if (position === null) return;
      setDraft({
        fileKey: item.id,
        path,
        oldPath: previousPath === path ? null : previousPath,
        position,
        range,
      });
    },
    [canCommentOnLines, files, parsedSlices],
  );

  // Reuse thread-panel selection parsing so the same gesture cannot drift between surfaces.
  const finishSelection = useCallback(
    (anchor: DraftAnchor, text: string, onFinish: (comment: ReviewCommentContext) => void) => {
      const file = files.find((candidate) => buildFileDiffRenderKey(candidate) === anchor.fileKey);
      const comment =
        file === undefined
          ? null
          : buildDiffReviewComment({
              id: `pull-request-selection:${anchor.fileKey}:${anchor.range.start}:${anchor.range.end}`,
              sectionId: `pull-request:${detail.number}`,
              sectionTitle: `PR #${detail.number} review`,
              filePath: anchor.path,
              fileDiff: file,
              range: anchor.range,
              text,
            });
      setDraft(null);
      setSelectedLines(null);
      if (comment !== null) onFinish(comment);
    },
    [detail.number, files],
  );

  // Stable render props and options preserve SlotPortals memos across selection and draft updates.
  const renderCodeViewFooter = useCallback(
    () =>
      // A complete diff stays readable when a later refresh fails; report only pages still owed.
      nextCursor === null ? null : (
        <div
          ref={setSentinel}
          className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground"
        >
          {diffQuery.error !== null ? (
            <>
              <span>The rest of this diff could not be loaded.</span>
              <Button size="xs" variant="outline" onClick={() => diffQuery.refresh()}>
                Retry
              </Button>
            </>
          ) : diffQuery.isPending ? (
            "Loading more files..."
          ) : null}
        </div>
      ),
    [nextCursor, diffQuery.error, diffQuery.isPending, diffQuery.refresh],
  );

  const renderHeaderPrefix = useCallback(
    (item: CodeViewItem<ReviewAnnotationGroup>) => {
      const collapsed = item.collapsed === true;
      return (
        <Button
          size="icon-micro"
          variant="ghost-muted"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand diff" : "Collapse diff"}
          className="mr-1"
          onClick={(event) => {
            event.stopPropagation();
            toggleFile(item.id);
          }}
        >
          <MorphIcon className="size-4" icon={collapsed ? ChevronRight : ChevronDown} />
        </Button>
      );
    },
    [toggleFile],
  );

  // Read through refs to keep header portal callbacks stable as viewed state refreshes.
  const filesViewedRef = useRef(filesViewed);
  filesViewedRef.current = filesViewed;
  const setFileViewedRef = useRef(setFileViewed);
  setFileViewedRef.current = setFileViewed;

  const renderHeaderMetadata = useCallback(
    (item: CodeViewItem<ReviewAnnotationGroup>) => {
      if (item.type !== "diff") return null;
      let { additions, deletions } =
        sourceFileStats.get(item.id) ?? getDiffLineStat([item.fileDiff]);
      const path = resolveFileDiffPath(item.fileDiff);
      if (additions === 0 && deletions === 0) {
        const withheld = omittedFileStats.get(path);
        if (withheld) ({ additions, deletions } = withheld);
      }
      const stat = (
        <PullRequestDiffStat
          additions={additions}
          deletions={deletions}
          className="font-mono text-2xs"
        />
      );
      const viewedFiles = filesViewedRef.current;
      if (!viewedFiles.enabled) return stat;
      const viewed = viewedFiles.isViewed(path);
      const stale = viewedFiles.isStale(path);
      return (
        <span className="flex items-center gap-3">
          {stat}
          {/* The header itself folds the file, so the tick keeps its press to itself. The
              attribute is what the header's capture listener looks for. */}
          <label
            data-viewed-toggle=""
            className="flex cursor-pointer select-none items-center gap-1.5 text-2xs text-muted-foreground"
            onClick={(event) => event.stopPropagation()}
          >
            <Checkbox
              aria-label={stale ? "Changed" : "Viewed"}
              checked={viewed}
              onCheckedChange={(next) => setFileViewedRef.current(item.id, path, next === true)}
            />
            {stale ? (
              <Tooltip>
                <TooltipTrigger render={<span className="text-warning-foreground" />}>
                  Changed
                </TooltipTrigger>
                <TooltipPopup side="bottom">
                  This file has been pushed to since you marked it viewed.
                </TooltipPopup>
              </Tooltip>
            ) : (
              <span className="@max-xs:hidden">Viewed</span>
            )}
          </label>
        </span>
      );
    },
    [omittedFileStats, sourceFileStats],
  );

  const diffViewOptions = useMemo(
    () => ({
      diffStyle: diffLayout === "split" ? ("split" as const) : ("unified" as const),
      lineDiffType: "none" as const,
      overflow: wordWrap ? ("wrap" as const) : ("scroll" as const),
      theme: resolveDiffThemeName(resolvedTheme),
      preferredHighlighter: PREFERRED_HIGHLIGHTER,
      themeType: resolvedTheme,
      stickyHeaders: true,
      loadDiffFiles,
      enableGutterUtility: canCommentOnLines && draft === null,
      enableLineSelection: canCommentOnLines && draft === null,
      // Both gutter clicks and line-number drags must open the comment composer.
      onGutterUtilityClick: beginComment,
      onLineSelectionEnd: beginComment,
    }),
    [diffLayout, wordWrap, resolvedTheme, loadDiffFiles, canCommentOnLines, draft, beginComment],
  );

  const runThreadCommand = useCallback(
    async (label: string, run: () => Promise<{ readonly _tag: string }>): Promise<boolean> => {
      if (threadPending) return false;
      setThreadPending(true);
      const result = await run();
      setThreadPending(false);
      if (result._tag === "Failure") {
        toastManager.add({ type: "error", title: label });
        return false;
      }
      onRefresh();
      return true;
    },
    [onRefresh, threadPending],
  );

  const renderThreadCard = useCallback(
    (thread: PullRequestReviewThread) => (
      <ReviewThreadCard
        // Host-local thread ids can collide across PRs; include the PR in editor keys.
        key={`${reference.projectId}#${reference.number}:${thread.id}`}
        thread={thread}
        workspaceRoot={detail.workspaceRoot}
        canReply={review.reply}
        canResolve={review.resolve && canResolvePullRequestThread(detail, thread)}
        canReact={detail.capabilities.reactions === true}
        environmentId={environmentId}
        reference={reference}
        pending={threadPending}
        fixPending={pendingFinding === pullRequestFindingKey({ kind: "thread", thread })}
        fixLabel={fixFindingLabel}
        {...(onFixFinding ? { onFix: () => onFixFinding({ kind: "thread", thread }) } : {})}
        onLoadMore={async (cursor): Promise<PullRequestThreadCommentsResult | null> => {
          const result = await loadThreadComments({
            environmentId,
            input: { ...reference, threadId: thread.id, cursor },
          });
          if (result._tag === "Failure") {
            toastManager.add({
              type: "error",
              title: "More comments could not be loaded",
            });
            return null;
          }
          return result.value;
        }}
        onReply={(body) =>
          runThreadCommand("Reply could not be posted", () =>
            replyToThread({
              environmentId,
              input: { ...reference, threadId: thread.id, body },
            }),
          )
        }
        canEditComment={(comment) =>
          canEditPullRequestComment(detail, {
            author: comment.author,
            kind: "review-comment",
            canEdit: comment.canEdit,
          })
        }
        onEditComment={(commentId, body) =>
          runThreadCommand("The comment could not be saved", () =>
            updateComment({
              environmentId,
              input: { ...reference, commentId, kind: "review-comment", body },
            }),
          )
        }
        onToggleResolved={() =>
          void runThreadCommand("The conversation could not be updated", () =>
            setThreadResolution({
              environmentId,
              input: { ...reference, threadId: thread.id, resolved: !thread.isResolved },
            }),
          )
        }
        onReacted={onRefresh}
      />
    ),
    [
      detail,
      environmentId,
      fixFindingLabel,
      loadThreadComments,
      onRefresh,
      onFixFinding,
      pendingFinding,
      reference,
      replyToThread,
      review.reply,
      review.resolve,
      runThreadCommand,
      setThreadResolution,
      threadPending,
      updateComment,
    ],
  );

  const renderAnnotation = useCallback(
    (annotation: ReviewAnnotation) => (
      <div className="py-1 font-sans text-foreground">
        {annotation.metadata.threads.map(renderThreadCard)}
        {annotation.metadata.pending.map((comment) => (
          <PendingReviewCommentCard
            key={comment.id}
            comment={comment}
            onRemove={() => removeComment(reviewKey, comment.id)}
          />
        ))}
        {annotation.metadata.draft && draft ? (
          <DiffCommentAnnotation
            kind="draft"
            rangeLabel={`${draft.path}:${getReviewPositionAnchor(draft.position).line}`}
            text=""
            submitLabel="Add to review"
            {...(onAddToAgentSelection
              ? {
                  secondaryAction: {
                    label: "Add to agent",
                    onAction: (text: string) =>
                      finishSelection(draft, text, (comment) =>
                        onAddToAgentSelection({ comment, request: text }),
                      ),
                  },
                }
              : {})}
            onCancel={() => {
              setDraft(null);
              setSelectedLines(null);
            }}
            onComment={(body) => {
              addComment(reviewKey, {
                id: nextPendingReviewCommentId(),
                path: draft.path,
                ...(draft.oldPath === null ? {} : { oldPath: draft.oldPath }),
                position: draft.position,
                body,
              });
              setDraft(null);
              setSelectedLines(null);
            }}
          />
        ) : null}
      </div>
    ),
    [
      addComment,
      draft,
      finishSelection,
      onAddToAgentSelection,
      removeComment,
      renderThreadCard,
      reviewKey,
    ],
  );

  // Removed commits must reset to the whole diff; an empty commit list hides
  // the scope menu and would otherwise leave no way out of an obsolete scope.
  const selectedCommit = orderedCommits.find((entry) => entry.oid === commit);
  useEffect(() => {
    if (commit !== null && selectedCommit === undefined) {
      onSelectedCommitChange(null);
    }
  }, [commit, onSelectedCommitChange, selectedCommit]);
  const scopeLabel = selectedCommit ? selectedCommit.messageHeadline : "All commits";
  const changeIgnoreWhitespace = (next: boolean) => {
    setIgnoreWhitespace(next);
    setDraft(null);
    setSelectedLines(null);
  };
  const toolbar = (
    <div className="@container flex h-10 min-h-10 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-background px-4 text-xs text-muted-foreground">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {}
        {orderedCommits.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button size="xs" variant="secondary" />}
              className="min-w-0 max-w-64"
              aria-label={`Diff scope: ${scopeLabel}`}
            >
              <span className="truncate">{scopeLabel}</span>
              <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-w-[min(28rem,calc(100vw-2rem))]">
              <DropdownMenuRadioGroup
                value={commit ?? "all"}
                onValueChange={(value) => onSelectedCommitChange(value === "all" ? null : value)}
              >
                <DropdownMenuRadioItem value="all" closeOnClick>
                  <span>All commits</span>
                </DropdownMenuRadioItem>
                {orderedCommits.slice(0, visibleCommitCount).map((entry) => (
                  <DropdownMenuRadioItem key={entry.oid} value={entry.oid} closeOnClick>
                    {}
                    <span className="flex items-center gap-2">
                      <Tooltip>
                        <TooltipTrigger
                          render={<span className="min-w-0 truncate">{entry.messageHeadline}</span>}
                        />
                        <TooltipPopup side="top">{entry.messageHeadline}</TooltipPopup>
                      </Tooltip>
                      <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                        {entry.oid.slice(0, 7)}
                      </span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {orderedCommits.length > visibleCommitCount ? (
                // Kept out of the radio group: it changes how much of the list is on screen
                // rather than what the diff is scoped to.
                <DropdownMenuItem
                  closeOnClick={false}
                  onClick={() => setVisibleCommitCount((count) => count + COMMIT_PAGE_SIZE)}
                >
                  <span className="text-muted-foreground">
                    Show more ({orderedCommits.length - visibleCommitCount} left)
                  </span>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {/* Icons leave caveats readable within the narrow toolbar. */}
        <PullRequestMetaLine>
          <span className="shrink-0 tabular-nums">
            {files.length} {files.length === 1 ? "file" : "files"}
            {nextCursor === null ? "" : "+"}
          </span>
          {filesViewed.enabled && files.length > 0 ? (
            <span className="flex min-w-0 items-center gap-1 tabular-nums">
              {/* Identify local viewed marks where the host keeps none; preserve count width. */}
              <span className="shrink-0">
                {filesViewed.viewedCount} / {files.length}
              </span>
              <span className="truncate">
                {viewedFilesStore === "environment" ? `viewed in ${APP_BASE_NAME}` : "viewed"}
              </span>
              {viewedFilesStore === "environment" ? (
                <Tooltip>
                  <TooltipTrigger render={<span className="flex shrink-0 items-center" />}>
                    <InfoIcon
                      aria-label="These ticks are kept here, not on the host"
                      className="text-muted-foreground size-3.5"
                    />
                  </TooltipTrigger>
                  <TooltipPopup side="bottom">
                    This host keeps no shared record of which files you have read, so these ticks
                    are kept by this environment. They follow you between the apps connected to it,
                    but the host's own web UI will not show them.
                  </TooltipPopup>
                </Tooltip>
              ) : null}
              {filesViewed.error !== null ? (
                <Tooltip>
                  <TooltipTrigger render={<span className="flex shrink-0 items-center" />}>
                    <TriangleAlertIcon
                      aria-label="Your ticks could not be read"
                      className="size-3.5 text-warning-foreground"
                    />
                  </TooltipTrigger>
                  <TooltipPopup side="bottom">
                    The boxes below are whatever was last read, and empty if nothing has been read
                    yet. {filesViewed.error}
                  </TooltipPopup>
                </Tooltip>
              ) : null}
              {filesViewed.truncated ? (
                <Tooltip>
                  <TooltipTrigger render={<span className="flex shrink-0 items-center" />}>
                    <TriangleAlertIcon
                      aria-label="This count covers only part of the change"
                      className="size-3.5 text-warning-foreground"
                    />
                  </TooltipTrigger>
                  <TooltipPopup side="bottom">
                    This change has more files than the host will report ticks for in one read, so
                    the count is short and some boxes below start empty.
                  </TooltipPopup>
                </Tooltip>
              ) : null}
            </span>
          ) : null}
          {withheldContent ? (
            <Tooltip>
              <TooltipTrigger render={<span className="flex shrink-0 items-center" />}>
                <TriangleAlertIcon
                  aria-label="Some of this diff was not shown"
                  className="size-3.5 text-warning-foreground"
                />
              </TooltipTrigger>
              <TooltipPopup side="bottom">
                The host withheld part of this diff — a binary file, or a change too large to
                inline.
              </TooltipPopup>
            </Tooltip>
          ) : null}
          {commit !== null && review.inlineComment ? (
            <Tooltip>
              <TooltipTrigger render={<span className="flex shrink-0 items-center" />}>
                <MessageSquareOffIcon
                  aria-label="Line comments are written from the whole change"
                  className="size-3.5"
                />
              </TooltipTrigger>
              <TooltipPopup side="bottom">
                A comment is anchored to the whole change, so switch to All commits to write one.
              </TooltipPopup>
            </Tooltip>
          ) : null}
        </PullRequestMetaLine>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={<Button size="icon-sm" variant="ghost" />}
                  className="@lg:hidden"
                  aria-label="Diff options"
                />
              }
            >
              <Settings2Icon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="top">Diff options</TooltipPopup>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuCheckboxItem
              checked={ignoreWhitespace}
              onCheckedChange={(checked) => changeIgnoreWhitespace(checked)}
            >
              Hide whitespace changes
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={wordWrap}
              onCheckedChange={(checked) => setWordWrap(checked)}
            >
              Wrap lines
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={diffLayout}
              onValueChange={(value) => {
                if (value === "stacked" || value === "split") {
                  updateClientSettings({ diffLayout: value });
                }
              }}
            >
              <DropdownMenuRadioItem value="stacked" closeOnClick>
                Stacked
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="split" closeOnClick>
                Split
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="hidden items-center gap-1 @lg:flex">
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  aria-label={
                    ignoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"
                  }
                  variant="ghost"
                  size="sm"
                  pressed={ignoreWhitespace}
                  onPressedChange={(pressed) => changeIgnoreWhitespace(Boolean(pressed))}
                />
              }
            >
              <PilcrowIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {ignoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"}
            </TooltipPopup>
          </Tooltip>
          <ToggleGroup
            aria-label="Diff layout"
            className="shrink-0"
            variant="segmented"
            value={[diffLayout]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "stacked" || next === "split") {
                updateClientSettings({ diffLayout: next });
              }
            }}
          >
            <Toggle aria-label="Stacked diff view" value="stacked">
              <Rows3Icon className="size-3.5" />
            </Toggle>
            <Toggle aria-label="Split diff view" value="split">
              <Columns2Icon className="size-3.5" />
            </Toggle>
          </ToggleGroup>
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  aria-label={wordWrap ? "Disable diff line wrapping" : "Enable diff line wrapping"}
                  variant="ghost"
                  size="sm"
                  pressed={wordWrap}
                  onPressedChange={(pressed) => {
                    setWordWrap(Boolean(pressed));
                  }}
                />
              }
            >
              <TextWrapIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {wordWrap ? "Disable line wrapping" : "Enable line wrapping"}
            </TooltipPopup>
          </Tooltip>
        </div>
        {fileKeys.length > 0 ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={allFilesCollapsed ? "Expand all files" : "Collapse all files"}
                  onClick={toggleAllFiles}
                />
              }
            >
              <MorphIcon
                className="size-3.5"
                icon={allFilesCollapsed ? ChevronsUpDown : ChevronsDownUp}
              />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {allFilesCollapsed ? "Expand all files" : "Collapse all files"}
            </TooltipPopup>
          </Tooltip>
        ) : null}
        {fileKeys.length > 0 ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  aria-label={fileTreeOpen ? "Hide file tree" : "Show file tree"}
                  variant="ghost"
                  size="sm"
                  pressed={fileTreeOpen}
                  onPressedChange={(pressed) => setFileTreeOpen(Boolean(pressed))}
                />
              }
            >
              <FolderTreeIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {fileTreeOpen ? "Hide file tree" : "Show file tree"}
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
  // Empty or unreadable diffs still need their scope toolbar to navigate away.
  const withToolbar = (body: ReactNode) => (
    <div className="flex h-full min-h-0 flex-col">
      {toolbar}
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-auto">
        {body}
      </div>
    </div>
  );

  if (diffQuery.isPending && loadedSlices.length === 0) {
    return withToolbar(<DiffPanelLoadingState label="Loading pull request diff..." />);
  }

  // Failed later slices must preserve already loaded diff content.
  if (diffQuery.error && loadedSlices.length === 0) {
    return withToolbar(
      <p className="px-4 py-5 text-sm text-muted-foreground">{diffQuery.error}</p>,
    );
  }

  // Raw fallback must wait for all pages or it would remove the sentinel
  // and leave the rest of the change unfetched.
  const rawSlices =
    nextCursor === null
      ? parsedSlices.flatMap((parsed) => (parsed?.kind === "raw" ? [parsed] : []))
      : [];
  if (files.length === 0 && rawSlices.length > 0) {
    return withToolbar(
      <div className="space-y-4 px-4 py-5">
        {rawSlices.map((slice) => (
          <div key={`${slice.reason}:${slice.text.slice(0, 64)}`} className="space-y-2">
            <p className="text-xs text-muted-foreground">{slice.reason}</p>
            <pre className="whitespace-pre-wrap break-words font-mono text-xs">{slice.text}</pre>
          </div>
        ))}
      </div>,
    );
  }

  if (items.length === 0 && nextCursor === null) {
    return withToolbar(
      <p className="px-4 py-5 text-sm text-muted-foreground">
        {commit === null
          ? "This pull request has no file changes."
          : "This commit has no file changes."}
      </p>,
    );
  }

  const orphanThreads = detail.reviewThreads.filter((thread) => !placedThreadIds.has(thread.id));
  const orphanFiles = new Map<string, PullRequestReviewThread[]>();
  for (const thread of orphanThreads) {
    const existing = orphanFiles.get(thread.path);
    if (existing) existing.push(thread);
    else orphanFiles.set(thread.path, [thread]);
  }

  const unstructured =
    rawSlices.length === 0 ? null : (
      // Keep unparseable slices readable alongside structured files.
      <div className="space-y-4 border-t border-border/60 px-4 py-5">
        {rawSlices.map((slice) => (
          <div key={`${slice.reason}:${slice.text.slice(0, 64)}`} className="space-y-2">
            <p className="text-xs text-muted-foreground">{slice.reason}</p>
            <pre className="whitespace-pre-wrap break-words font-mono text-xs">{slice.text}</pre>
          </div>
        ))}
      </div>
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {toolbar}
      {}
      {orphanFiles.size > 0 ? (
        <div className="shrink-0 border-b border-border/60">
          <Collapsible open={orphansOpen} onOpenChange={setOrphansOpen}>
            {}
            <h2>
              <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-4 py-2 text-left text-xs text-muted-foreground">
                {/* Pending pages may still contain these conversations; do not call them off-diff yet. */}
                <span>
                  {nextCursor === null
                    ? "Conversations not on the current diff"
                    : "Conversations not on the diff loaded so far"}
                </span>
                <ChevronRightIcon
                  aria-hidden
                  className={cn("size-3.5 transition-transform", orphansOpen && "rotate-90")}
                />
                <span aria-hidden className="tabular-nums">
                  {orphanThreads.length}
                </span>
                <span className="sr-only">
                  {orphanThreads.length === 1
                    ? "1 conversation"
                    : `${orphanThreads.length} conversations`}
                </span>
              </CollapsibleTrigger>
            </h2>
            <CollapsiblePanel>
              {/* Cap conversations so they cannot consume all space above the diff. */}
              <div className="max-h-64 space-y-3 overflow-auto px-4 pb-3">
                {[...orphanFiles].map(([path, threads]) => (
                  <div key={path}>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <p className="truncate px-3 text-xs text-muted-foreground">{path}</p>
                        }
                      />
                      <TooltipPopup side="top">{path}</TooltipPopup>
                    </Tooltip>
                    <div className="mt-1 space-y-2">
                      {threads.map((thread) => (
                        <div key={thread.id}>
                          {thread.line === null ? null : (
                            <p className="px-3 text-xs text-muted-foreground">Line {thread.line}</p>
                          )}
                          {renderThreadCard(thread)}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CollapsiblePanel>
          </Collapsible>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {}
        <div
          className="relative min-h-0 min-w-0 flex-1"
          // composedPath reaches headers through the viewer's shadow root.
          onClickCapture={(event) => {
            const composedPath = event.nativeEvent.composedPath?.() ?? [];
            for (const node of composedPath) {
              if (!(node instanceof HTMLElement)) continue;
              // Capture precedes the chevron click; toggling here too would cancel its toggle.
              if (node instanceof HTMLButtonElement || node instanceof HTMLAnchorElement) {
                return;
              }
              // Viewed labels already fold their file; skip them to avoid toggling twice.
              if (node.hasAttribute("data-viewed-toggle")) return;
              if (node.hasAttribute("data-diffs-header")) {
                const filePath = node.querySelector("[data-title]")?.textContent?.trim();
                if (filePath === undefined || filePath === "") return;
                const item = items.find(
                  (candidate) => resolveFileDiffPath(candidate.fileDiff) === filePath,
                );
                if (item !== undefined) toggleFile(item.id);
                return;
              }
            }
          }}
        >
          {/* The viewer must own its virtual scroll container or absolute rows paint over neighbors. */}
          <StyledDiffCodeView<ReviewAnnotationGroup>
            // Reserve scrollbar space so overflow changes cannot shift metadata and line numbers.
            className="@container h-full overflow-auto [scrollbar-gutter:stable]"
            containerRef={scrollerRef}
            viewerRef={setViewer}
            items={items}
            selectedLines={selectedLines}
            onSelectedLinesChange={setSelectedLines}
            options={diffViewOptions}
            // Keep the paging sentinel inside the viewer-owned scroll container.
            renderCodeViewFooter={renderCodeViewFooter}
            renderHeaderPrefix={renderHeaderPrefix}
            renderHeaderMetadata={renderHeaderMetadata}
            renderAnnotation={renderAnnotation}
            // Find can ask again before the unfolded file arrives, so this unfolds and never folds.
            onRevealSearchMatch={(item) =>
              setToggledFiles((current) =>
                toggleFileDiffFoldForViewed(item.id, false, effectiveFoldOverride, current),
              )
            }
            unsafeCSSExtra={REPLACE_FILE_COUNTS_CSS}
          />
        </div>
        {fileTreeOpen ? (
          <aside className="flex w-[min(20rem,40%)] min-w-48 shrink-0 border-l border-border/60">
            <DiffFileTree
              ariaLabel={`Pull request #${detail.number} files`}
              entries={fileTreeEntries}
              onSelectFile={revealFile}
              footer={
                nextCursor === null ? null : (
                  <div className="shrink-0 border-t border-border/60 p-2">
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      className="w-full"
                      disabled={diffQuery.isPending}
                      onClick={diffQuery.error !== null ? () => diffQuery.refresh() : loadNextSlice}
                    >
                      {diffQuery.error !== null
                        ? "Retry"
                        : diffQuery.isPending
                          ? "Loading more files..."
                          : "Load more files"}
                    </Button>
                  </div>
                )
              }
            />
          </aside>
        ) : null}
      </div>
      {unstructured}
    </div>
  );
}

export default PullRequestCodeTab;
