import { useAtomCommand } from "~/state/use-atom-command";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ProjectId,
  PullRequestAction,
  PullRequestDetail,
  PullRequestMergeMethod,
  PullRequestRef,
} from "@t3tools/contracts";
import { useCallback, useRef, useState } from "react";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useClientSettings, useEnvironmentSettings } from "~/hooks/useSettings";
import {
  deriveLogicalProjectKeyFromSettings,
  derivePhysicalProjectKey,
  selectProjectGroupingSettings,
} from "~/logicalProject";
import { buildPhysicalToLogicalProjectKeyMap } from "~/sidebarProjectGrouping";
import { useProjects } from "~/state/entities";
import { usePrimaryEnvironmentId } from "~/state/environments";

import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { usePreparePullRequestThreadAction } from "~/lib/sourceControlActions";
import type { ReviewCommentContext } from "~/reviewCommentContext";
import { pullRequestEnvironment } from "~/state/pullRequests";

import { toastManager } from "../ui/toast";
import { handoffPrompt, handoffReviewComments, readableFailure } from "./pullRequestDetail.logic";
import { pullRequestEntryKey, type EnvironmentPullRequestEntry } from "./pullRequestList.logic";

/** Resolve on demand so hidden quick actions do not rebuild the legacy project grouping. */
export function usePullRequestDefaultMergeMethodResolver(
  environmentId: EnvironmentId,
  projectId: ProjectId,
) {
  const projectDefault = useEnvironmentSettings(
    environmentId,
    (settings) => resolveProjectSettings(settings, projectId).settings.pullRequestMergeMethod,
  );
  const legacyOverrides = useClientSettings((settings) => settings.pullRequestMergeMethodOverrides);
  const grouping = useClientSettings(selectProjectGroupingSettings);
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  return useCallback(() => {
    if (projectDefault != null) return projectDefault;
    if (Object.keys(legacyOverrides).length === 0) return undefined;
    const project = projects.find(
      (candidate) => candidate.environmentId === environmentId && candidate.id === projectId,
    );
    if (!project) return undefined;
    // Duplicate sidebar rows borrow their logical group key from their siblings.
    const key =
      buildPhysicalToLogicalProjectKeyMap({
        projects,
        settings: grouping,
        primaryEnvironmentId,
      }).get(derivePhysicalProjectKey(project)) ??
      deriveLogicalProjectKeyFromSettings(project, grouping);
    return legacyOverrides[key];
  }, [
    projectDefault,
    projects,
    environmentId,
    projectId,
    grouping,
    primaryEnvironmentId,
    legacyOverrides,
  ]);
}

const ACTION_SUCCESS_LABELS: Record<PullRequestAction, string> = {
  merge: "Merge requested",
  ready: "Marked ready for review",
  draft: "Converted to draft",
  close: "Pull request closed",
  reopen: "Pull request reopened",
  "update-branch": "Branch updated with the base branch",
  "enable-auto-merge": "Auto-merge enabled",
  "disable-auto-merge": "Auto-merge disabled",
  revert: "Revert pull request opened",
  "approve-workflows": "Workflows approved",
};

const ACTION_FAILURE_LABELS: Record<PullRequestAction, string> = {
  merge: "Could not merge this pull request",
  ready: "Could not mark this ready for review",
  draft: "Could not convert this to a draft",
  close: "Could not close this pull request",
  reopen: "Could not reopen this pull request",
  "update-branch": "Could not update this branch",
  "enable-auto-merge": "Could not enable auto-merge",
  "disable-auto-merge": "Could not disable auto-merge",
  revert: "Could not open a revert pull request",
  "approve-workflows": "Could not approve workflows",
};

const ACTION_FAILURE_HINTS: Record<PullRequestAction, string> = {
  merge:
    "The host refused the merge. Check that you have write access, that the checks it requires have passed, and that the branch is not conflicting.",
  ready: "The host refused it. Check that you have write access to this repository.",
  draft: "The host refused it. Check that you have write access to this repository.",
  close: "The host refused it. Check that you have write access, or that you opened it.",
  reopen:
    "The host refused it. Check that you have write access, and that the branch still exists.",
  "update-branch":
    "The host refused it. Check that you have write access, and that the base branch has not diverged in a way the host cannot merge.",
  "enable-auto-merge":
    "The host refused it. Check that auto-merge is enabled for this repository and that you have write access.",
  "disable-auto-merge": "The host refused it. Check that you have write access to this repository.",
  revert:
    "The host refused it. Check that you have write access and that this pull request was merged on the host.",
  "approve-workflows":
    "The host refused it. Check that you have Actions write access and that these workflow runs are still awaiting approval.",
};

/** onSuccess lets each surface refresh its own displayed data. */
export function usePullRequestActionRunner({
  environmentId,
  reference,
  onSuccess,
  resolveMergeMethod,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef | null;
  onSuccess?: (action: PullRequestAction) => void;
  /** Small surfaces resolve repository settings on the click, not for every visible row. */
  resolveMergeMethod?: (detail: PullRequestDetail) => PullRequestMergeMethod;
}) {
  const runAction = useAtomCommand(pullRequestEnvironment.runAction, {
    reportFailure: false,
  });
  const [actionPending, setActionPending] = useState(false);
  const pendingRef = useRef(false);

  const perform = async (action: PullRequestAction, method?: PullRequestMergeMethod) => {
    if (pendingRef.current || reference === null) return;
    pendingRef.current = true;
    setActionPending(true);
    try {
      const result = await runAction({
        environmentId,
        input: {
          ...reference,
          action,
          ...(method ? { mergeMethod: method } : resolveMergeMethod ? { resolveMergeMethod } : {}),
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      toastManager.add({ type: "success", title: ACTION_SUCCESS_LABELS[action] });
      onSuccess?.(action);
    } catch (failure) {
      toastManager.add({
        type: "error",
        title: ACTION_FAILURE_LABELS[action],
        description: readableFailure(failure, ACTION_FAILURE_HINTS[action]),
      });
    } finally {
      pendingRef.current = false;
      setActionPending(false);
    }
  };

  return { actionPending, perform };
}

/** Queue a close sweep through the same environment lanes as individual actions. */
export function usePullRequestCloseBatch(onClosed: (entry: EnvironmentPullRequestEntry) => void) {
  const runAction = useAtomCommand(pullRequestEnvironment.runAction, { reportFailure: false });
  const pending = useRef(new Set<string>());
  const [closingKeys, setClosingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const close = useCallback(
    async (entries: readonly EnvironmentPullRequestEntry[]) => {
      const batch = entries.filter((entry) => {
        const key = pullRequestEntryKey(entry);
        if (entry.state !== "open" || pending.current.has(key)) return false;
        pending.current.add(key);
        return true;
      });
      if (batch.length === 0) return;
      setClosingKeys(new Set(pending.current));
      let closed = 0;
      const failures: string[] = [];
      await Promise.all(
        batch.map(async (entry) => {
          try {
            const result = await runAction({
              environmentId: entry.environmentId,
              input: {
                projectId: entry.projectId,
                host: entry.host,
                repository: entry.repository,
                number: entry.number,
                action: "close",
              },
            });
            if (result._tag === "Failure") throw squashAtomCommandFailure(result);
            closed++;
            onClosed(entry);
          } catch (failure) {
            failures.push(
              `#${entry.number}: ${readableFailure(failure, ACTION_FAILURE_HINTS.close)}`,
            );
          } finally {
            pending.current.delete(pullRequestEntryKey(entry));
            setClosingKeys(new Set(pending.current));
          }
        }),
      );
      toastManager.add({
        type: failures.length > 0 ? "error" : "success",
        title:
          failures.length > 0
            ? `Closed ${closed} of ${batch.length} pull requests`
            : `Closed ${closed} pull request${closed === 1 ? "" : "s"}`,
        ...(failures.length > 0 ? { description: failures.slice(0, 3).join("\n") } : {}),
      });
    },
    [onClosed, runAction],
  );
  return { close, closingKeys };
}

export interface PullRequestThreadTask {
  prompt: string;
  reviewComments?: ReadonlyArray<ReviewCommentContext>;
}

export type PullRequestHandoffDetail = Pick<
  PullRequestDetail,
  "projectId" | "workspaceRoot" | "url"
>;

/** Preserve handoff provenance across panel unmounts; replace only prompts
 * still identical to the handoff so user edits survive. */
const lastHandoffPromptByDraft = new Map<DraftId, string>();

/** Serialize handoffs within the hook; questions need no checkout while
 * code tasks prepare their branch before delivery. */
export function usePullRequestHandoffs({
  environmentId,
  detail,
}: {
  environmentId: EnvironmentId;
  detail: PullRequestHandoffDetail | null;
}) {
  const newThread = useNewThreadHandler();
  const prepareThread = usePreparePullRequestThreadAction({
    environmentId,
    cwd: detail?.workspaceRoot ?? null,
  });
  // Serialize checkouts and key pending indicators to their initiating action.
  const [handoff, setHandoff] = useState<string | null>(null);

  /** Questions need a thread without changing its checkout; code tasks
   * call this after preparing their requested checkout. */
  const openThreadWithTask = async (
    projectRef: ReturnType<typeof scopeProjectRef>,
    task: PullRequestThreadTask | null,
    opened?: { draftId: DraftId },
  ): Promise<{ draftId: DraftId } | null> => {
    const session =
      opened ??
      (await newThread(projectRef).then(
        (result) => result,
        () => null,
      ));
    if (session === null) return null;
    const store = useComposerDraftStore.getState();
    if (task === null) return session;
    // Replace previous handoff prompt and chips while preserving user-edited prompt text.
    const draft = store.getComposerDraft(session.draftId);
    const existingComments = draft?.reviewComments ?? [];
    const prompt = handoffPrompt(
      {
        prompt: draft?.prompt ?? "",
        lastHandoffPrompt: lastHandoffPromptByDraft.get(session.draftId),
      },
      task.prompt,
    );
    // Remember only the handoff contribution so later replacement cannot erase surrounding user text.
    lastHandoffPromptByDraft.set(session.draftId, task.prompt);
    store.setPrompt(session.draftId, prompt);
    store.setReviewComments(
      session.draftId,
      handoffReviewComments(existingComments, task.reviewComments ?? []),
    );
    return session;
  };

  const startAsk = async (kind: string, task: PullRequestThreadTask) => {
    if (!detail || handoff !== null) return;
    setHandoff(kind);
    const projectRef = scopeProjectRef(environmentId, detail.projectId);
    const opened = await openThreadWithTask(projectRef, task);
    setHandoff(null);
    if (opened === null) {
      toastManager.add({
        type: "error",
        title: "Could not open a thread",
        description: "Try again from the project, or open a thread first.",
      });
      return;
    }
    toastManager.add({
      type: "success",
      title: "Asked in a thread",
      // Empty Ask prompts must not claim question text landed in the composer.
      description:
        task.prompt.length > 0
          ? "The question is in the composer — read it over, then send."
          : "The pull request is in the composer — type your question, then send.",
    });
  };

  const startHandoff = async (
    kind: string,
    task: PullRequestThreadTask | null,
    // Worktrees preserve open work; local checkout moves the branch under other open threads.
    mode: "worktree" | "local" = "worktree",
  ) => {
    if (!detail || handoff !== null) return;
    setHandoff(kind);
    // Menu closure hides progress; loading toasts need explicit completion, not timeouts.
    const toastId = toastManager.add({
      type: "loading",
      title: "Preparing the pull request checkout...",
    });
    const projectRef = scopeProjectRef(environmentId, detail.projectId);
    // Setup scripts require a destination thread, so open it before checkout preparation.
    const opened = await newThread(projectRef).then(
      (session) => session,
      () => null,
    );
    if (opened === null) {
      setHandoff(null);
      // Without a thread, checkout setup and task delivery cannot run.
      toastManager.update(toastId, {
        type: "error",
        title: "Could not open a thread for the checkout",
        description: "Try again from the project, or open a thread first.",
      });
      return;
    }
    const prepared = await prepareThread.run({
      reference: detail.url,
      mode,
      threadId: opened.threadId,
    });
    if (prepared._tag === "Failure") {
      setHandoff(null);
      const detailMessage =
        prepareThread.error instanceof Error ? prepareThread.error.message : null;
      toastManager.update(toastId, {
        type: "error",
        title: "Could not prepare the pull request checkout",
        ...(detailMessage ? { description: detailMessage } : {}),
      });
      return;
    }
    const pointed = await newThread(projectRef, {
      branch: prepared.value.branch,
      worktreePath: prepared.value.worktreePath,
      envMode: prepared.value.worktreePath === null ? "local" : "worktree",
    }).then(
      (session) => session !== null,
      () => false,
    );
    if (!pointed) {
      setHandoff(null);
      // Stop if thread retargeting fails or the task would run in the wrong checkout.
      toastManager.update(toastId, {
        type: "error",
        title: "Checked out, but the thread stayed where it was",
        description: `The checkout is ready on \`${prepared.value.branch}\`. Point a thread at it from the branch picker, then ask again.`,
      });
      return;
    }
    // Release every handoff path: loading toasts never expire and would lock future handoffs.
    setHandoff(null);
    // Existing worked-in worktrees preserve contents and may lag the PR head.
    const staleCheckoutToast = {
      type: "warning",
      title: "Checked out, but not on the latest commits",
      description:
        "The checkout could not be moved onto the pull request's latest commits, so the code there is older than the pull request. Uncommitted work or local commits keep it where it is.",
    } as const;
    if (task === null) {
      toastManager.update(
        toastId,
        prepared.value.isOnPullRequestHead
          ? {
              type: "success",
              title: mode === "local" ? "Checked out here" : "Checked out",
              description:
                mode === "local"
                  ? "This repository is on the pull request's branch, with a thread open on it."
                  : "The pull request is in its own worktree, with a thread open on it.",
            }
          : staleCheckoutToast,
      );
      return;
    }
    await openThreadWithTask(projectRef, task, opened);
    toastManager.update(
      toastId,
      prepared.value.isOnPullRequestHead
        ? {
            type: "success",
            title: "Checkout ready",
            description: "The task is in the composer — read it over, then send.",
          }
        : staleCheckoutToast,
    );
  };

  return { handoff, startAsk, startHandoff };
}
