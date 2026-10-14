import type {
  OrchestrationV2PendingBackgroundTask,
  OrchestrationV2ProviderThread,
  OrchestrationV2Run,
  OrchestrationV2TurnItem,
  ThreadId,
  ThreadPullRequestLink,
} from "@t3tools/contracts";
import { isOrchestrationV2WorkActive } from "@t3tools/contracts";

import { threadPullRequestKeyOf } from "./threadPullRequests.ts";

const BACKGROUND_TURN_ITEM_TYPES = new Set<OrchestrationV2TurnItem["type"]>([
  "command_execution",
  "dynamic_tool",
  "subagent",
]);

/**
 * True terminal run statuses (includes `rolled_back`). Retained as the
 * canonical terminal set for this module; do not widen or reuse it as the
 * background-wait gate — that gate intentionally excludes `rolled_back`.
 */
const TERMINAL_RUN_STATUSES = new Set<OrchestrationV2Run["status"]>([
  "cancelled",
  "completed",
  "failed",
  "interrupted",
  "rolled_back",
]);

/**
 * waiting includes successful turns awaiting checkpoint capture.
 * Exclude rolled_back: the provider-thread roster is not tied to a run.
 */
const SETTLED_FOR_BACKGROUND_WAIT_RUN_STATUSES = new Set<OrchestrationV2Run["status"]>([
  "cancelled",
  "completed",
  "failed",
  "interrupted",
  "waiting",
]);

// Keep TERMINAL_RUN_STATUSES referenced so the true-terminal set stays defined
// next to the background-wait subset (rolled_back is terminal, not wait-settled).
void TERMINAL_RUN_STATUSES;

export type PendingBackgroundWorkTask = OrchestrationV2PendingBackgroundTask;

export function turnItemUpdateCanEndBackgroundWork(
  item: Pick<OrchestrationV2TurnItem, "type" | "status">,
): boolean {
  return BACKGROUND_TURN_ITEM_TYPES.has(item.type) && !isOrchestrationV2WorkActive(item.status);
}

/**
 * Long-lived commands do not delay completion alerts; subagents and monitors can wake the agent (#13625).
 * Unknown adapter work delays completion conservatively.
 */
export function backgroundWorkHoldsCompletion(
  tasks: ReadonlyArray<Pick<PendingBackgroundWorkTask, "kind">>,
): boolean {
  return tasks.some((task) => backgroundWorkKindHoldsCompletion(task.kind));
}

function backgroundWorkKindHoldsCompletion(kind: PendingBackgroundWorkTask["kind"]): boolean {
  switch (kind) {
    case "command":
      return false;
    case "subagent":
    case "monitor":
    case "background_task":
      return true;
  }
}

type PendingBackgroundWorkRun = Pick<OrchestrationV2Run, "id" | "ordinal" | "status">;

type PendingBackgroundWorkPullRequest = Pick<
  ThreadPullRequestLink,
  "host" | "repository" | "number" | "url" | "source" | "watch"
>;

type PendingBackgroundWorkProviderThread = Pick<
  OrchestrationV2ProviderThread,
  "id" | "pendingBackgroundTasks"
>;

type PendingBackgroundWorkTurnItem = {
  readonly id: OrchestrationV2TurnItem["id"] | string;
  readonly type: OrchestrationV2TurnItem["type"];
  readonly status: OrchestrationV2TurnItem["status"];
  readonly title: string | null;
  /** When present and the run is rolled_back, the item is abandoned, not pending. */
  readonly runId?: OrchestrationV2Run["id"] | string | null;
  readonly nativeItemRef?: {
    readonly nativeId: string | null;
  } | null;
  readonly input?: unknown;
  readonly prompt?: string | undefined;
  readonly childThreadId?: ThreadId | null;
};

function isLatestRunSettledForBackgroundWait(
  latestRun: PendingBackgroundWorkRun | null | undefined,
): boolean {
  if (latestRun === undefined || latestRun === null) {
    return false;
  }
  return SETTLED_FOR_BACKGROUND_WAIT_RUN_STATUSES.has(latestRun.status);
}

function isPersistentDynamicToolInput(input: unknown): boolean {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return false;
  }
  return Reflect.get(input, "persistent") === true;
}

function descriptionFromTurnItem(item: PendingBackgroundWorkTurnItem): string | undefined {
  if (typeof item.title === "string" && item.title.trim().length > 0) {
    return item.title.trim();
  }
  if (item.type === "command_execution" && typeof item.input === "string") {
    const command = item.input.trim();
    return command.length > 0 ? command : undefined;
  }
  if (item.type === "dynamic_tool") {
    const toolName = Reflect.get(item, "toolName");
    if (typeof toolName === "string" && toolName.trim().length > 0) {
      return toolName.trim();
    }
  }
  if (item.type === "subagent" && typeof item.prompt === "string") {
    const prompt = item.prompt.trim();
    return prompt.length > 0 ? prompt : undefined;
  }
  return undefined;
}

function pendingTaskFromTurnItem(
  taskId: string,
  item: PendingBackgroundWorkTurnItem,
): PendingBackgroundWorkTask {
  const description = descriptionFromTurnItem(item);
  const named = { taskId, ...(description === undefined ? {} : { description }) };
  switch (item.type) {
    case "subagent":
      return {
        ...named,
        kind: "subagent",
        ...(item.childThreadId == null ? {} : { childThreadId: item.childThreadId }),
      };
    case "command_execution":
      return { ...named, kind: "command" };
    default:
      return { ...named, kind: "background_task" };
  }
}

function nativeTaskIdFromTurnItem(item: PendingBackgroundWorkTurnItem): string {
  const nativeId = item.nativeItemRef?.nativeId;
  if (typeof nativeId === "string" && nativeId.length > 0) {
    return nativeId;
  }
  return String(item.id);
}

/**
 * The turn items the pending-work list names, without its settled-run gate.
 * Stop ends exactly these, so the list and Stop cannot disagree.
 */
export function pendingBackgroundTurnItems<Item extends PendingBackgroundWorkTurnItem>(input: {
  readonly turnItems: ReadonlyArray<Item>;
  readonly runs?: ReadonlyArray<PendingBackgroundWorkRun>;
}): ReadonlyArray<Item> {
  const rolledBackRunIds = new Set(
    (input.runs ?? []).filter((run) => run.status === "rolled_back").map((run) => String(run.id)),
  );
  return input.turnItems.filter(
    (item) =>
      BACKGROUND_TURN_ITEM_TYPES.has(item.type) &&
      isOrchestrationV2WorkActive(item.status) &&
      !(item.type === "dynamic_tool" && isPersistentDynamicToolInput(item.input)) &&
      (item.runId === undefined ||
        item.runId === null ||
        !rolledBackRunIds.has(String(item.runId))),
  );
}

/**
 * Watches keep settled threads working between wakes; omit pullRequests when choosing a run to interrupt.
 * Subagent entities are excluded because their turn items already represent the same work.
 */
export function derivePendingBackgroundWork(input: {
  readonly latestRun: PendingBackgroundWorkRun | null | undefined;
  readonly providerThreads: ReadonlyArray<PendingBackgroundWorkProviderThread>;
  readonly turnItems: ReadonlyArray<PendingBackgroundWorkTurnItem>;
  readonly activeProviderThreadId?: string | null;
  readonly hasActiveRun?: boolean;
  /** Pass projection runs unless the caller already excluded rolled-back items in SQL. */
  readonly runs?: ReadonlyArray<PendingBackgroundWorkRun>;
  readonly pullRequests?: ReadonlyArray<PendingBackgroundWorkPullRequest> | undefined;
}): ReadonlyArray<PendingBackgroundWorkTask> {
  const hasActiveRun =
    input.hasActiveRun ??
    input.runs?.some(
      (run) => run.status === "preparing" || run.status === "starting" || run.status === "running",
    ) ??
    false;
  if (hasActiveRun) {
    return [];
  }
  // A thread that never ran waits on nothing else, but a watch started on it still wakes it.
  if (input.latestRun == null) {
    return pullRequestWatchTasks(input.pullRequests);
  }
  if (!isLatestRunSettledForBackgroundWait(input.latestRun)) {
    return [];
  }

  const byTaskId = new Map<string, PendingBackgroundWorkTask>();

  const providerThreads =
    input.activeProviderThreadId === undefined || input.activeProviderThreadId === null
      ? input.providerThreads
      : input.providerThreads.filter((thread) => thread.id === input.activeProviderThreadId);

  for (const providerThread of providerThreads) {
    for (const task of providerThread.pendingBackgroundTasks ?? []) {
      if (task.taskId.length === 0 || byTaskId.has(task.taskId)) {
        continue;
      }
      const { description: rawDescription, ...named } = task;
      const description = rawDescription?.trim();
      byTaskId.set(task.taskId, {
        ...named,
        ...(description === undefined || description.length === 0 ? {} : { description }),
      });
    }
  }

  for (const item of pendingBackgroundTurnItems(input)) {
    const taskId = nativeTaskIdFromTurnItem(item);
    if (byTaskId.has(taskId)) {
      continue;
    }

    byTaskId.set(taskId, pendingTaskFromTurnItem(taskId, item));
  }

  for (const task of pullRequestWatchTasks(input.pullRequests)) byTaskId.set(task.taskId, task);

  return Array.from(byTaskId.values());
}

function pullRequestWatchTasks(
  pullRequests: ReadonlyArray<PendingBackgroundWorkPullRequest> | undefined,
): Array<PendingBackgroundWorkTask> {
  return (pullRequests ?? []).flatMap((link) =>
    link.watch === undefined || link.source === "stack-dismissed"
      ? []
      : [
          {
            taskId: `pull-request-watch:${threadPullRequestKeyOf(link)}`,
            description: `Watching pull request #${link.number}`,
            kind: "monitor" as const,
          },
        ],
  );
}
