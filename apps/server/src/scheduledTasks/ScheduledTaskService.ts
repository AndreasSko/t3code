import {
  CommandId,
  MessageId,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ScheduledTask,
  ScheduledTaskError,
  ScheduledTaskId,
  ThreadId,
  ScheduledTaskWebhookDeliveryId,
  type ScheduledTaskDeleteInput,
  type ScheduledTaskDeleteResult,
  type ScheduledTaskGetWebhookDeliveryInput,
  type ScheduledTaskGetWebhookDeliveryResult,
  type ScheduledTaskListWebhookDeliveriesInput,
  type ScheduledTaskListWebhookDeliveriesResult,
  type ScheduledTaskRotateWebhookTokenInput,
  type ScheduledTaskWebhookDeliveryOutcome,
  type ScheduledTaskListResult,
  type ScheduledTaskMutationResult,
  type ScheduledTaskRunNowInput,
  type ScheduledTaskRunNowResult,
  type ScheduledTaskSetEnabledInput,
  type ScheduledTaskUpsertInput,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as Metric from "effect/Metric";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as Metrics from "../observability/Metrics.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import { isMissedFixedTimeRun, isSameSchedule, nextScheduledRunAt } from "./Schedule.ts";
import {
  redactHeaders,
  redactQuery,
  renderWebhookPrompt,
  type WebhookRequest,
} from "./webhookTemplate.ts";
import { constantTimeEquals, verifyWebhookSignature } from "./webhookVerification.ts";

export const WEBHOOK_ROUTE_PREFIX = "/api/hooks";
const WEBHOOK_DELIVERY_RETENTION = 50;
/** Body bytes kept in the delivery log. */
const WEBHOOK_DELIVERY_LOG_BODY_LIMIT = 64 * 1024;
/** Prompt characters kept in the delivery log. */
const WEBHOOK_DELIVERY_LOG_PROMPT_LIMIT = 64 * 1024;
const WEBHOOK_MAX_QUEUED_PER_TASK = 20;
/** Enforce locally too: callers can bypass the relay via the public tunnel. */
const WEBHOOK_RATE_LIMIT_PER_MINUTE = 60;

/**
 * Where a webhook task's public URL points: `${relayHookBaseUrl}/${taskId}/${token}`.
 * Null when the environment has no managed tunnel on T3 Connect; clients then show the path.
 */
interface WebhookOrigin {
  readonly relayHookBaseUrl: string | null;
}

const ENDPOINT_KEY = /^[0-9a-f]{16}$/;

/** Uses the managed tunnel key so public hook URLs do not reveal the environment id. */
export function relayHookBaseUrl(input: {
  readonly relayUrl: string;
  readonly tunnelName: string | undefined;
}): string | null {
  const endpointKey = input.tunnelName?.split("-").at(-1);
  const relayUrl = input.relayUrl.replace(/\/+$/, "");
  if (relayUrl === "" || endpointKey === undefined || !ENDPOINT_KEY.test(endpointKey)) {
    return null;
  }
  return `${relayUrl}/v1/hooks/${endpointKey}`;
}

export class ScheduledTaskWebhookOrigin extends Context.Reference<Effect.Effect<WebhookOrigin>>(
  "t3/scheduledTasks/ScheduledTaskWebhookOrigin",
  {
    defaultValue: () => Effect.succeed({ relayHookBaseUrl: null }),
  },
) {}

/** `reason` is shown in the delivery log. */
class WebhookDeliverySkipped extends Data.TaggedError("WebhookDeliverySkipped")<{
  readonly reason: string;
}> {}

interface RateWindow {
  readonly accepted: ReadonlyArray<number>;
  /** Whether a rejection was already logged in this window. */
  readonly rejectedLogged: boolean;
}

export interface WebhookTriggerRequest extends WebhookRequest {
  readonly hookId: string;
  readonly token: string;
  readonly body: Uint8Array;
  /** Set by T3 Connect; the same id is never dispatched twice. */
  readonly relayDeliveryId?: string;
  /** When the relay received a held request; defaults to now. */
  readonly receivedAt?: string;
}

/** Unknown hooks and wrong tokens both return `not_found`. */
/** Metrics outcome returned as `x-t3-hook-outcome`; never contains request contents. */
export type WebhookDeliveryOutcome =
  | "accepted"
  | "duplicate"
  | "prompt_too_long"
  | "queue_full"
  | "rate_limited"
  | "disabled"
  | "rejected_signature"
  | "expired"
  | "not_found"
  | "error";

export type WebhookTriggerResult =
  | {
      readonly _tag: "accepted";
      readonly deliveryId: ScheduledTaskWebhookDeliveryId;
      /** A 202 covers more than a started run; this says which. */
      readonly outcome: "accepted" | "duplicate" | "prompt_too_long";
    }
  | { readonly _tag: "not_found" }
  | { readonly _tag: "rejected_signature" }
  | { readonly _tag: "disabled" }
  | {
      readonly _tag: "rate_limited";
      readonly outcome: "rate_limited" | "queue_full";
    }
  | { readonly _tag: "expired" };

const decodeTask = Schema.decodeUnknownEffect(ScheduledTask);
const decodeTaskId = Schema.decodeUnknownOption(ScheduledTaskId);
const decodeScheduleJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ScheduledTask.fields.schedule),
);
const decodeWorkspaceStrategyJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ScheduledTask.fields.workspaceStrategy),
);
const decodeModelSelectionJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ScheduledTask.fields.modelSelection),
);
const HeadersJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));
const MissingFieldsJson = Schema.fromJsonString(Schema.Array(Schema.String));
const decodeHeadersJson = Schema.decodeUnknownOption(HeadersJson);
const decodeMissingFieldsJson = Schema.decodeUnknownOption(MissingFieldsJson);
const encodeHeadersJson = Schema.encodeSync(HeadersJson);
const encodeMissingFieldsJson = Schema.encodeSync(MissingFieldsJson);

interface ScheduledTaskRow {
  readonly task_id: string;
  readonly title: string;
  readonly prompt: string;
  readonly enabled: number;
  readonly schedule_json: string;
  readonly project_id: string;
  readonly thread_id: string | null;
  readonly workspace_strategy_json: string;
  readonly model_selection_json: string;
  readonly runtime_mode: string;
  readonly interaction_mode: string;
  readonly created_by: string;
  readonly creation_source: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly next_run_at: string | null;
  readonly last_run_at: string | null;
  readonly last_run_status: string;
  readonly last_run_error: string | null;
  readonly run_count: number;
  readonly webhook_token: string | null;
  readonly webhook_secret: string | null;
}

interface WebhookDeliveryRow {
  readonly delivery_id: string;
  readonly task_id: string;
  readonly received_at: string;
  readonly method: string;
  readonly query: string;
  readonly headers_json: string;
  readonly body: string;
  readonly body_bytes: number;
  readonly body_truncated: number;
  readonly outcome: string;
  readonly signature_verified: number;
  readonly missing_fields_json: string;
  readonly rendered_prompt: string | null;
  readonly error: string | null;
}

export class ScheduledTaskService extends Context.Service<
  ScheduledTaskService,
  {
    readonly list: () => Effect.Effect<ScheduledTaskListResult, ScheduledTaskError>;
    /** Emits a full snapshot on subscribe and after each change. */
    readonly subscribeList: () => Stream.Stream<ScheduledTaskListResult, ScheduledTaskError>;
    readonly upsert: (
      input: ScheduledTaskUpsertInput,
    ) => Effect.Effect<ScheduledTaskMutationResult, ScheduledTaskError>;
    readonly setEnabled: (
      input: ScheduledTaskSetEnabledInput,
    ) => Effect.Effect<ScheduledTaskMutationResult, ScheduledTaskError>;
    readonly delete: (
      input: ScheduledTaskDeleteInput,
    ) => Effect.Effect<ScheduledTaskDeleteResult, ScheduledTaskError>;
    readonly runNow: (
      input: ScheduledTaskRunNowInput,
    ) => Effect.Effect<ScheduledTaskRunNowResult, ScheduledTaskError>;
    /** Invalidates the old webhook URL immediately. */
    readonly rotateWebhookToken: (
      input: ScheduledTaskRotateWebhookTokenInput,
    ) => Effect.Effect<ScheduledTaskMutationResult, ScheduledTaskError>;
    readonly listWebhookDeliveries: (
      input: ScheduledTaskListWebhookDeliveriesInput,
    ) => Effect.Effect<ScheduledTaskListWebhookDeliveriesResult, ScheduledTaskError>;
    readonly getWebhookDelivery: (
      input: ScheduledTaskGetWebhookDeliveryInput,
    ) => Effect.Effect<ScheduledTaskGetWebhookDeliveryResult, ScheduledTaskError>;
    /** Returns once logged; dispatch continues in the background to meet sender timeouts. */
    readonly triggerWebhook: (
      request: WebhookTriggerRequest,
    ) => Effect.Effect<WebhookTriggerResult, ScheduledTaskError>;
  }
>()("t3/scheduledTasks/ScheduledTaskService") {}

function taskError(message: string, input?: { taskId?: ScheduledTaskId; cause?: unknown }) {
  return new ScheduledTaskError({
    message,
    ...(input?.taskId === undefined ? {} : { taskId: input.taskId }),
    ...(input?.cause === undefined ? {} : { cause: input.cause }),
  });
}

function iso(value: DateTime.DateTime): string {
  return DateTime.formatIso(DateTime.toUtc(value));
}

const localNow = DateTime.withCurrentZoneLocal(DateTime.nowInCurrentZone);

function nextRunAt(
  task: Pick<ScheduledTask, "enabled" | "schedule">,
  from: DateTime.DateTime,
): string | null {
  if (!task.enabled) return null;
  // A stored interval can decode yet overflow the representable DateTime
  // range; an unrepresentable occurrence means the task has no next run.
  try {
    const next = nextScheduledRunAt(task.schedule, from);
    return next !== null && Number.isFinite(DateTime.toEpochMillis(next)) ? iso(next) : null;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  if (Cause.isCause(error)) return Cause.pretty(error);
  if (error instanceof Error) return error.message;
  return String(error);
}

function webhookPath(taskId: string, token: string): string {
  return `${WEBHOOK_ROUTE_PREFIX}/${encodeURIComponent(taskId)}/${token}`;
}

function webhookEndpoint(
  row: Pick<ScheduledTaskRow, "task_id" | "webhook_token" | "webhook_secret">,
  origin: WebhookOrigin | null,
): ScheduledTask["webhook"] {
  if (row.webhook_token === null) return undefined;
  const base = origin?.relayHookBaseUrl ?? null;
  return {
    path: webhookPath(row.task_id, row.webhook_token),
    url: base === null ? null : `${base}/${encodeURIComponent(row.task_id)}/${row.webhook_token}`,
    hasSecret: row.webhook_secret !== null,
  };
}

const decodeRow = (row: ScheduledTaskRow, origin: WebhookOrigin | null = null) =>
  Effect.gen(function* () {
    const schedule = yield* decodeScheduleJson(row.schedule_json);
    const webhook = schedule.type === "webhook" ? webhookEndpoint(row, origin) : undefined;
    const workspaceStrategy = yield* decodeWorkspaceStrategyJson(row.workspace_strategy_json);
    const modelSelection = yield* decodeModelSelectionJson(row.model_selection_json);
    return yield* decodeTask({
      // The stored id decodes through the task schema so a corrupt value fails
      // as a typed parse error, not a `ScheduledTaskId.make` defect.
      id: row.task_id,
      title: row.title,
      prompt: row.prompt,
      enabled: row.enabled === 1,
      schedule,
      projectId: row.project_id,
      threadId: row.thread_id,
      workspaceStrategy,
      modelSelection,
      runtimeMode: row.runtime_mode,
      interactionMode: row.interaction_mode,
      createdBy: row.created_by,
      creationSource: row.creation_source,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      nextRunAt: row.next_run_at,
      lastRunAt: row.last_run_at,
      lastRunStatus: row.last_run_status,
      lastRunError: row.last_run_error,
      runCount: row.run_count,
      ...(webhook === undefined ? {} : { webhook }),
    });
  }).pipe(
    Effect.mapError((cause) => {
      // The typed diagnostic can only carry an id that itself decodes; a
      // corrupt stored id is omitted rather than re-thrown as a defect.
      const taskId = decodeTaskId(row.task_id);
      return taskError("Could not decode schedule task row.", {
        ...(Option.isSome(taskId) ? { taskId: taskId.value } : {}),
        cause,
      });
    }),
  );

export const listDueTasks = Effect.fn("ScheduledTaskService.listDueTasks")(function* (
  now: DateTime.DateTime,
) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<ScheduledTaskRow>`
    SELECT * FROM scheduled_tasks
    WHERE enabled = 1 AND next_run_at IS NOT NULL
      AND next_run_at <= ${iso(now)} AND last_run_status <> 'running'
    ORDER BY next_run_at ASC, task_id ASC
  `;
  const tasks: ScheduledTask[] = [];
  for (const row of rows) {
    const decoded = yield* Effect.result(decodeRow(row));
    if (Result.isSuccess(decoded)) {
      const task = decoded.success;
      // next_run_at accepts arbitrary strings; reject invalid DateTimes before the poll's unsafe parse.
      if (task.nextRunAt === null || Option.isSome(DateTime.make(task.nextRunAt))) {
        tasks.push(task);
      } else {
        yield* Effect.logWarning("Skipping schedule task row with invalid next_run_at", {
          taskId: row.task_id,
        });
      }
    } else {
      yield* Effect.logWarning("Skipping undecodable schedule task row", {
        taskId: row.task_id,
        cause: decoded.failure,
      });
    }
  }
  return tasks;
});

export const layer = Layer.effect(
  ScheduledTaskService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const crypto = yield* Crypto.Crypto;
    const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
    const threadManagement = yield* ThreadManagementService.ThreadManagementService;
    const secretRequests = yield* SecretRequests.SecretRequests;
    const scheduler = yield* Scheduler.Scheduler;
    const readWebhookOrigin = yield* ScheduledTaskWebhookOrigin;
    // Webhook deliveries for one task dispatch in arrival order rather than
    // being dropped while an earlier delivery is still dispatching.
    const webhookPermits = yield* Ref.make<ReadonlyMap<ScheduledTaskId, Semaphore.Semaphore>>(
      new Map(),
    );
    // Keyed by task id and creation time, so deliveries of a deleted task that
    // finish late release their own count, never a recreated task's.
    const webhookQueued = yield* Ref.make<ReadonlyMap<string, number>>(new Map());
    const webhookRateWindows = yield* Ref.make<ReadonlyMap<ScheduledTaskId, RateWindow>>(new Map());
    const activeRuns = yield* Ref.make<ReadonlySet<ScheduledTaskId>>(new Set());
    // Each signal re-emits the full list, so a slow subscriber needs only the latest.
    const changesPubSub = yield* PubSub.sliding<void>(1);
    const notifyChanged = PubSub.publish(changesPubSub, undefined).pipe(Effect.asVoid);

    const selectAllRows = () => sql<ScheduledTaskRow>`
      SELECT
        task_id,
        title,
        prompt,
        enabled,
        schedule_json,
        project_id,
        thread_id,
        workspace_strategy_json,
        model_selection_json,
        runtime_mode,
        interaction_mode,
        created_by,
        creation_source,
        created_at,
        updated_at,
        next_run_at,
        last_run_at,
        last_run_status,
        last_run_error,
        run_count,
        webhook_token,
        webhook_secret
      FROM scheduled_tasks
      ORDER BY updated_at DESC, task_id ASC
    `;

    // Strict decode for the API surface: a corrupt row is a visible error.
    const listRows = Effect.fn("ScheduledTaskService.listRows")(function* () {
      const rows = yield* selectAllRows();
      const origin = yield* readWebhookOrigin;
      return yield* Effect.forEach(rows, (row) => decodeRow(row, origin), { concurrency: 1 });
    });

    const getRows = (id: ScheduledTaskId) => sql<ScheduledTaskRow>`
      SELECT
        task_id,
        title,
        prompt,
        enabled,
        schedule_json,
        project_id,
        thread_id,
        workspace_strategy_json,
        model_selection_json,
        runtime_mode,
        interaction_mode,
        created_by,
        creation_source,
        created_at,
        updated_at,
        next_run_at,
        last_run_at,
        last_run_status,
        last_run_error,
        run_count,
        webhook_token,
        webhook_secret
      FROM scheduled_tasks
      WHERE task_id = ${id}
    `;

    /** Missing tasks return null; load and decode errors propagate. */
    const findTask = Effect.fn("ScheduledTaskService.findTask")(function* (id: ScheduledTaskId) {
      const rows = yield* getRows(id).pipe(
        Effect.mapError((cause) =>
          taskError("Could not load schedule task.", { taskId: id, cause }),
        ),
      );
      const row = rows[0];
      if (row === undefined) return null;
      return yield* decodeRow(row, yield* readWebhookOrigin);
    });

    const findWebhookCredentials = (id: ScheduledTaskId) =>
      getRows(id).pipe(
        Effect.map((rows) =>
          rows[0] === undefined
            ? null
            : { token: rows[0].webhook_token, secret: rows[0].webhook_secret },
        ),
        Effect.mapError((cause) =>
          taskError("Could not load schedule task.", { taskId: id, cause }),
        ),
      );

    const newWebhookToken = crypto.randomBytes(32).pipe(
      Effect.map((bytes) => Buffer.from(bytes).toString("base64url")),
      Effect.mapError((cause) => taskError("Could not generate webhook token.", { cause })),
    );

    const loadTask = Effect.fn("ScheduledTaskService.loadTask")(function* (id: ScheduledTaskId) {
      const task = yield* findTask(id);
      if (task === null) {
        return yield* taskError("Schedule task not found.", { taskId: id });
      }
      return task;
    });

    // Omit run-state columns so saves preserve concurrent transitions.
    // Check existence in this write so a stale edit cannot resurrect a deleted task.
    const saveTask = (
      task: ScheduledTask,
      requireExisting: boolean,
      webhook: {
        readonly token: string | null;
        readonly secret: string | null;
        /** False when the save carried no new secret, so a concurrent change survives. */
        readonly secretChanged: boolean;
      },
    ) =>
      sql<{ task_id: string }>`
        INSERT INTO scheduled_tasks (
          task_id,
          title,
          prompt,
          enabled,
          schedule_json,
          project_id,
          thread_id,
          workspace_strategy_json,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          created_by,
          creation_source,
          created_at,
          updated_at,
          next_run_at,
          last_run_at,
          last_run_status,
          last_run_error,
          run_count,
          webhook_token,
          webhook_secret
        )
        SELECT
          ${task.id},
          ${task.title},
          ${task.prompt},
          ${task.enabled ? 1 : 0},
          ${JSON.stringify(task.schedule)},
          ${task.projectId},
          ${task.threadId},
          ${JSON.stringify(task.workspaceStrategy)},
          ${JSON.stringify(task.modelSelection)},
          ${task.runtimeMode},
          ${task.interactionMode},
          ${task.createdBy},
          ${task.creationSource},
          ${task.createdAt},
          ${task.updatedAt},
          ${task.nextRunAt},
          ${task.lastRunAt},
          ${task.lastRunStatus},
          ${task.lastRunError},
          ${task.runCount},
          ${webhook.token},
          ${webhook.secret}
        WHERE ${requireExisting ? 0 : 1} = 1
           OR EXISTS (SELECT 1 FROM scheduled_tasks WHERE task_id = ${task.id})
        ON CONFLICT (task_id)
        DO UPDATE SET
          title = excluded.title,
          prompt = excluded.prompt,
          enabled = excluded.enabled,
          schedule_json = excluded.schedule_json,
          project_id = excluded.project_id,
          thread_id = excluded.thread_id,
          workspace_strategy_json = excluded.workspace_strategy_json,
          model_selection_json = excluded.model_selection_json,
          runtime_mode = excluded.runtime_mode,
          interaction_mode = excluded.interaction_mode,
          creation_source = excluded.creation_source,
          updated_at = excluded.updated_at,
          next_run_at = excluded.next_run_at,
          -- Only rotate changes a live token, so a save racing a rotation
          -- cannot bring the old URL back.
          webhook_token = CASE
            WHEN excluded.webhook_token IS NULL THEN NULL
            ELSE COALESCE(scheduled_tasks.webhook_token, excluded.webhook_token)
          END,
          webhook_secret = CASE
            WHEN ${webhook.secretChanged ? 1 : 0} = 1 THEN excluded.webhook_secret
            ELSE scheduled_tasks.webhook_secret
          END
        RETURNING task_id
      `.pipe(
        Effect.mapError((cause) =>
          taskError("Could not save schedule task.", { taskId: task.id, cause }),
        ),
        Effect.flatMap((rows) =>
          rows.length > 0
            ? Effect.void
            : taskError("Schedule task not found.", { taskId: task.id }),
        ),
      );

    const deleteRow = (id: ScheduledTaskId) =>
      sql
        .withTransaction(
          sql`DELETE FROM scheduled_task_webhook_deliveries WHERE task_id = ${id}`.pipe(
            Effect.andThen(sql`DELETE FROM scheduled_tasks WHERE task_id = ${id}`),
          ),
        )
        .pipe(
          Effect.mapError((cause) =>
            taskError("Could not delete schedule task.", { taskId: id, cause }),
          ),
        );

    // Targeted UPDATEs keep completing runs from resurrecting deleted tasks
    // or clobbering concurrent edits to their definitions.
    const markRunning = (id: ScheduledTaskId, startedAtIso: string) =>
      sql<{ task_id: string }>`
        UPDATE scheduled_tasks
        SET updated_at = ${startedAtIso},
            last_run_at = ${startedAtIso},
            last_run_status = 'running',
            last_run_error = NULL
        WHERE task_id = ${id}
        RETURNING task_id
      `.pipe(
        Effect.mapError((cause) =>
          taskError("Could not mark schedule task as running.", { taskId: id, cause }),
        ),
        // A task deleted after the re-read must not be dispatched from the stale snapshot.
        Effect.flatMap((rows) =>
          rows.length > 0 ? Effect.void : taskError("Schedule task not found.", { taskId: id }),
        ),
      );

    const markCompleted = (input: {
      readonly id: ScheduledTaskId;
      readonly completedAtIso: string;
      readonly nextRunAtIso: string | null;
      readonly status: "succeeded" | "failed";
      readonly error: string | null;
      readonly startedAtIso: string;
    }) =>
      sql`
        UPDATE scheduled_tasks
        SET updated_at = ${input.completedAtIso},
            next_run_at = ${input.nextRunAtIso},
            last_run_status = ${input.status},
            last_run_error = ${input.error},
            run_count = run_count + 1
        WHERE task_id = ${input.id}
          AND last_run_status = 'running'
          AND last_run_at = ${input.startedAtIso}
      `.pipe(
        Effect.mapError((cause) =>
          taskError("Could not record schedule task run.", { taskId: input.id, cause }),
        ),
      );

    // Release running rows after failures so polls cannot skip them forever.
    // Dispatch may have happened: advance next_run_at and count the attempt to prevent replay.
    const releaseStuckRun = (task: ScheduledTask, message: string) =>
      Effect.gen(function* () {
        const now = yield* localNow;
        // Honor in-flight schedule edits; use the run snapshot only if the re-read fails.
        const reread = yield* Effect.result(findTask(task.id));
        if (Result.isSuccess(reread) && reread.success === null) return; // deleted — nothing to release
        const source = Result.isSuccess(reread) && reread.success !== null ? reread.success : task;
        yield* sql`
          UPDATE scheduled_tasks
          SET last_run_status = 'failed',
              last_run_error = ${message},
              next_run_at = ${nextRunAt(source, now)},
              updated_at = ${iso(now)},
              run_count = run_count + 1
          WHERE task_id = ${task.id} AND last_run_status = 'running'
        `;
        yield* notifyChanged;
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Could not release stuck schedule task run", {
            taskId: task.id,
            cause,
          }),
        ),
      );

    const runTask = Effect.fn("ScheduledTaskService.runTask")(function* (
      task: ScheduledTask,
      trigger: "scheduled" | "manual" | "webhook",
      webhook?: { readonly deliveryId: string; readonly prompt: string },
    ) {
      const reserved = yield* Ref.modify(activeRuns, (active) => {
        if (active.has(task.id)) return [false, active] as const;
        const next = new Set(active);
        next.add(task.id);
        return [true, next] as const;
      });
      if (!reserved) {
        if (trigger !== "scheduled") {
          return yield* taskError("Schedule task is already running.", { taskId: task.id });
        }
        return task;
      }

      return yield* Effect.gen(function* () {
        const startedAt = yield* localNow;
        const startedAtIso = iso(startedAt);

        // Re-read before changing run state; deleted, paused, or postponed tasks must not fire.
        const active = yield* findTask(task.id);
        if (active === null) {
          if (webhook !== undefined) {
            return yield* new WebhookDeliverySkipped({
              reason: "The task was deleted before this delivery ran.",
            });
          }
          // A manual run on a just-deleted task must fail loudly, not report
          // a successful run that never dispatched.
          if (trigger !== "scheduled") {
            return yield* taskError("Schedule task not found.", { taskId: task.id });
          }
          return task;
        }
        // A next_run_at corrupted between the poll read and this re-read must
        // not defect the poll; an unparseable value is treated as not due.
        const parsedNextRunAt =
          active.nextRunAt === null ? Option.none() : DateTime.make(active.nextRunAt);
        if (
          trigger === "scheduled" &&
          (!active.enabled ||
            Option.isNone(parsedNextRunAt) ||
            DateTime.toEpochMillis(parsedNextRunAt.value) > DateTime.toEpochMillis(startedAt))
        ) {
          return active;
        }
        // Queued deliveries must not run paused tasks or tasks whose identity or trigger changed.
        if (webhook !== undefined) {
          const reason =
            active.createdAt !== task.createdAt
              ? "The task was replaced before this delivery ran."
              : active.schedule.type !== "webhook"
                ? "The task's trigger changed before this delivery ran."
                : !active.enabled
                  ? "The task was paused before this delivery ran."
                  : null;
          if (reason !== null) return yield* new WebhookDeliverySkipped({ reason });
        }

        yield* markRunning(active.id, startedAtIso);
        yield* notifyChanged;

        // Key webhook runs by delivery to prevent duplicate dispatch.
        const fireKey =
          webhook === undefined
            ? `${active.id}:${DateTime.toEpochMillis(startedAt)}:${trigger}`
            : `${active.id}:webhook:${webhook.deliveryId}`;
        const commandId = CommandId.make(`scheduled-task:${fireKey}`);
        const messageId = MessageId.make(`scheduled-task-message:${fireKey}`);
        // Honor prompt/model/binding edits after polling; webhook prompts use the arrival-time row.
        const prompt = webhook?.prompt ?? active.prompt;

        // Effect.exit captures defects and interruptions too, so markCompleted records failed dispatches.
        const result =
          active.threadId === null
            ? yield* Effect.exit(
                threadLaunch.launch({
                  commandId,
                  projectId: active.projectId,
                  title: active.title,
                  modelSelection: active.modelSelection,
                  runtimeMode: active.runtimeMode,
                  interactionMode: active.interactionMode,
                  workspaceStrategy: active.workspaceStrategy,
                  initialMessage: {
                    messageId,
                    scheduledTaskId: active.id,
                    text: prompt,
                    attachments: [],
                  },
                  createdBy: active.createdBy,
                  creationSource: active.creationSource,
                }),
              )
            : yield* Effect.exit(
                threadManagement.sendToThread({
                  projectId: active.projectId,
                  commandId,
                  threadId: ThreadId.make(active.threadId),
                  messageId,
                  scheduledTaskId: active.id,
                  text: prompt,
                  attachments: [],
                  modelSelection: active.modelSelection,
                  // Scheduled prompts must not interrupt tools in the bound thread.
                  mode: "queue",
                  createdBy: active.createdBy,
                  creationSource: active.creationSource,
                }),
              );

        const completedAt = yield* localNow;
        const runSucceeded = result._tag === "Success";
        const lastRunStatus = runSucceeded ? ("succeeded" as const) : ("failed" as const);
        const lastRunError = runSucceeded ? null : errorMessage(result.cause);
        // Compute the next run from the current schedule, honoring edits or deletions during dispatch.
        const current = yield* findTask(task.id);
        const scheduleSource = current ?? task;
        const completed: ScheduledTask = {
          ...scheduleSource,
          updatedAt: iso(completedAt),
          lastRunAt: startedAtIso,
          nextRunAt: nextRunAt(scheduleSource, completedAt),
          lastRunStatus,
          lastRunError,
          runCount: scheduleSource.runCount + 1,
        };
        if (current !== null) {
          // Guard by startedAtIso so a task recreated under the same id is not stamped by the old run.
          yield* markCompleted({
            id: task.id,
            completedAtIso: completed.updatedAt,
            nextRunAtIso: completed.nextRunAt,
            status: lastRunStatus,
            error: lastRunError,
            startedAtIso,
          });
          yield* notifyChanged;
        }
        return completed;
      }).pipe(
        Effect.onError((cause) => releaseStuckRun(task, errorMessage(cause))),
        Effect.ensuring(
          Ref.update(activeRuns, (active) => {
            const next = new Set(active);
            next.delete(task.id);
            return next;
          }),
        ),
      );
    });

    // A due fixed-time run that is long past its slot (server was off or
    // asleep) is skipped and re-aimed at its next occurrence, not fired late.
    const rescheduleMissedRun = Effect.fn("ScheduledTaskService.rescheduleMissedRun")(function* (
      task: ScheduledTask,
      now: DateTime.DateTime,
    ) {
      const next = nextRunAt(task, now);
      yield* Effect.logInfo("Skipping missed schedule task run", {
        taskId: task.id,
        missedRunAt: task.nextRunAt,
        rescheduledTo: next,
      });
      yield* sql`
        UPDATE scheduled_tasks
        SET next_run_at = ${next},
            updated_at = ${iso(now)}
        WHERE task_id = ${task.id}
      `.pipe(
        Effect.mapError((cause) =>
          taskError("Could not reschedule missed schedule task run.", { taskId: task.id, cause }),
        ),
      );
      yield* notifyChanged;
    });

    const runDueTasks = Effect.fn("ScheduledTaskService.runDueTasks")(function* () {
      const now = yield* localNow;
      const tasks = yield* listDueTasks(now).pipe(
        Effect.mapError((cause) => taskError("Could not list schedule tasks.", { cause })),
      );
      const due = tasks.flatMap((task) =>
        task.nextRunAt === null ? [] : [{ task, dueAt: DateTime.makeUnsafe(task.nextRunAt) }],
      );
      yield* Effect.forEach(
        due,
        ({ task, dueAt }) =>
          Effect.suspend(() =>
            isMissedFixedTimeRun(task.schedule, dueAt, now)
              ? rescheduleMissedRun(task, now)
              : runTask(task, "scheduled"),
          ).pipe(
            Effect.catch((cause) =>
              Effect.logWarning("Scheduled task run failed", { taskId: task.id, cause }),
            ),
          ),
        { concurrency: 1, discard: true },
      );
    });

    // Interrupted dispatches may already have run, so advance next_run_at and count the attempt.
    // Release running rows to avoid permanent skips; JSON schedules require per-row recovery.
    yield* Effect.gen(function* () {
      const rows = yield* selectAllRows();
      const stuck = rows.filter((row) => row.last_run_status === "running");
      if (stuck.length === 0) return;
      const now = yield* localNow;
      yield* Effect.forEach(
        stuck,
        (row) =>
          Effect.gen(function* () {
            const decoded = yield* Effect.result(decodeRow(row));
            if (Result.isSuccess(decoded)) {
              yield* sql`
                UPDATE scheduled_tasks
                SET last_run_status = 'failed',
                    last_run_error = 'Run was interrupted by a server restart.',
                    next_run_at = ${nextRunAt(decoded.success, now)},
                    updated_at = ${iso(now)},
                    run_count = run_count + 1
                WHERE task_id IS ${row.task_id} AND last_run_status = 'running'
              `;
              return;
            }
            // Release corrupt rows from running; the lenient poller skips them, preventing replay.
            yield* Effect.logWarning(
              "Recovering undecodable schedule task row without rescheduling",
              { taskId: row.task_id, cause: decoded.failure },
            );
            yield* sql`
              UPDATE scheduled_tasks
              SET last_run_status = 'failed',
                  last_run_error = 'Run was interrupted by a server restart.',
                  updated_at = ${iso(now)},
                  run_count = run_count + 1
              WHERE task_id IS ${row.task_id} AND last_run_status = 'running'
            `;
          }),
        { concurrency: 1, discard: true },
      );
      yield* notifyChanged;
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not reset interrupted schedule task runs", { cause }),
      ),
    );

    yield* scheduler.register("scheduled-tasks", runDueTasks());

    const list: ScheduledTaskService["Service"]["list"] = () =>
      listRows().pipe(
        Effect.map((tasks) => ({ tasks })),
        Effect.mapError((cause) => taskError("Could not list schedule tasks.", { cause })),
      );

    const subscribeList: ScheduledTaskService["Service"]["subscribeList"] = () =>
      Stream.unwrap(
        Effect.gen(function* () {
          // Subscribe before taking the snapshot so a change landing between
          // the two is buffered by the subscription rather than dropped.
          const subscription = yield* PubSub.subscribe(changesPubSub);
          return Stream.concat(
            Stream.fromEffect(list()),
            Stream.fromSubscription(subscription).pipe(Stream.mapEffect(() => list())),
          );
        }),
      );

    const upsert: ScheduledTaskService["Service"]["upsert"] = (input) =>
      Effect.gen(function* () {
        const now = yield* localNow;
        const uuid =
          input.commandId === undefined
            ? yield* crypto
                .randomUUIDv4()
                .pipe(
                  Effect.mapError((cause) =>
                    taskError("Could not generate schedule task id.", { cause }),
                  ),
                )
            : null;
        const id =
          input.id ??
          ScheduledTaskId.make(
            input.commandId ? `scheduled-task:${input.commandId}` : `scheduled-task:${uuid}`,
          );
        // Resolved ids preserve history on commandId replay; real load errors must propagate.
        const existingTask = yield* findTask(id);
        // Only schedule/enabled changes restart the clock; title or prompt edits must not postpone a due run.
        const schedule: ScheduledTask["schedule"] =
          input.schedule.type === "webhook"
            ? {
                type: "webhook",
                signature:
                  input.schedule.signature == null
                    ? null
                    : {
                        header: input.schedule.signature.header.toLowerCase(),
                        encoding: input.schedule.signature.encoding,
                        prefix: input.schedule.signature.prefix,
                      },
                maxDeliveryAgeMinutes: input.schedule.maxDeliveryAgeMinutes ?? null,
              }
            : input.schedule;
        const webhook =
          input.schedule.type === "webhook"
            ? yield* Effect.gen(function* () {
                const existing = existingTask === null ? null : yield* findWebhookCredentials(id);
                // Saving a webhook task keeps its URL; only rotate changes it.
                const token = existing?.token ?? (yield* newWebhookToken);
                const signature =
                  input.schedule.type === "webhook" ? input.schedule.signature : null;
                // secretRef is consumed once; a replay keeps the secret stored by the original save.
                const replay = input.commandId !== undefined && existing?.secret != null;
                const fromRef =
                  signature?.secretRef === undefined
                    ? undefined
                    : yield* secretRequests
                        .consume({ ref: signature.secretRef, projectId: input.projectId })
                        .pipe(
                          Effect.catch((error) =>
                            replay
                              ? Effect.succeed(undefined)
                              : Effect.fail(taskError(error.message, { taskId: id })),
                          ),
                        );
                // A ref, when given, is the only source: a plain secret sent
                // alongside it must not replace what a replayed save stored.
                const provided = signature?.secretRef === undefined ? signature?.secret : fromRef;
                const secret = signature == null ? null : (provided ?? existing?.secret ?? null);
                const secretChanged =
                  signature == null || provided !== undefined || existing === null;
                if (signature != null && secret === null) {
                  return yield* taskError("A webhook signature check needs a signing secret.", {
                    taskId: id,
                  });
                }
                return { token, secret, secretChanged };
              })
            : { token: null, secret: null, secretChanged: true };
        const scheduleUnchanged =
          existingTask !== null &&
          existingTask.enabled === input.enabled &&
          isSameSchedule(existingTask.schedule, schedule);
        const task: ScheduledTask = {
          id,
          title: input.title,
          prompt: input.prompt,
          enabled: input.enabled,
          schedule,
          projectId: input.projectId,
          threadId: input.threadId ?? null,
          workspaceStrategy: input.workspaceStrategy,
          modelSelection: input.modelSelection,
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
          createdBy: existingTask?.createdBy ?? input.createdBy ?? "user",
          creationSource: input.creationSource ?? "web",
          createdAt: existingTask?.createdAt ?? iso(now),
          updatedAt: iso(now),
          nextRunAt: scheduleUnchanged
            ? existingTask.nextRunAt
            : nextRunAt({ enabled: input.enabled, schedule }, now),
          lastRunAt: existingTask?.lastRunAt ?? null,
          lastRunStatus: existingTask?.lastRunStatus ?? "never",
          lastRunError: existingTask?.lastRunError ?? null,
          runCount: existingTask?.runCount ?? 0,
        };
        yield* saveTask(task, input.requireExisting === true, webhook);
        yield* notifyChanged;
        return { task: (yield* findTask(id)) ?? task };
      });

    const setEnabled: ScheduledTaskService["Service"]["setEnabled"] = (input) =>
      Effect.gen(function* () {
        const existing = yield* loadTask(input.id);
        if (existing.enabled === input.enabled) return { task: existing };
        const now = yield* localNow;
        const next = nextRunAt({ enabled: input.enabled, schedule: existing.schedule }, now);
        // RETURNING so a task deleted between the load and this UPDATE is a
        // visible not-found error, not a false success.
        const updated = yield* sql<{ task_id: string }>`
          UPDATE scheduled_tasks
          SET enabled = ${input.enabled ? 1 : 0},
              next_run_at = ${next},
              updated_at = ${iso(now)}
          WHERE task_id = ${input.id}
          RETURNING task_id
        `.pipe(
          Effect.mapError((cause) =>
            taskError("Could not update schedule task.", { taskId: input.id, cause }),
          ),
        );
        if (updated.length === 0) {
          return yield* taskError("Schedule task not found.", { taskId: input.id });
        }
        yield* notifyChanged;
        return {
          task: { ...existing, enabled: input.enabled, nextRunAt: next, updatedAt: iso(now) },
        };
      });

    const deleteTask: ScheduledTaskService["Service"]["delete"] = (input) =>
      deleteRow(input.id).pipe(
        Effect.andThen(
          Effect.all([
            Ref.update(webhookRateWindows, (windows) => {
              const next = new Map(windows);
              next.delete(input.id);
              return next;
            }),
            Ref.update(webhookPermits, (permits) => {
              const next = new Map(permits);
              next.delete(input.id);
              return next;
            }),
          ]),
        ),
        Effect.andThen(notifyChanged),
        Effect.as({ id: input.id }),
      );

    const runNow: ScheduledTaskService["Service"]["runNow"] = (input: ScheduledTaskRunNowInput) =>
      Effect.gen(function* () {
        const task = yield* loadTask(input.id);
        if (task.schedule.type === "webhook") {
          // There is no request to render the prompt from.
          return yield* taskError("Webhook tasks run when their URL receives a request.", {
            taskId: input.id,
          });
        }
        const next = yield* runTask(task, "manual").pipe(
          Effect.mapError((cause) =>
            taskError("Could not run schedule task.", { taskId: input.id, cause }),
          ),
        );
        return { task: next };
      });

    const rotateWebhookToken: ScheduledTaskService["Service"]["rotateWebhookToken"] = (input) =>
      Effect.gen(function* () {
        const task = yield* loadTask(input.id);
        if (task.schedule.type !== "webhook") {
          return yield* taskError("Only webhook tasks have a URL token.", { taskId: input.id });
        }
        const token = yield* newWebhookToken;
        const now = yield* localNow;
        // Matching created_at keeps a rotation from landing on a task deleted
        // and recreated under the same id since it was loaded.
        const updated = yield* sql<{ task_id: string }>`
          UPDATE scheduled_tasks
          SET webhook_token = ${token}, updated_at = ${iso(now)}
          WHERE task_id = ${input.id} AND created_at = ${task.createdAt}
          RETURNING task_id
        `.pipe(
          Effect.mapError((cause) =>
            taskError("Could not rotate webhook token.", { taskId: input.id, cause }),
          ),
        );
        if (updated.length === 0) {
          return yield* taskError("Schedule task was deleted or replaced.", { taskId: input.id });
        }
        yield* notifyChanged;
        return { task: yield* loadTask(input.id) };
      });

    const deliveryHeaders = (row: WebhookDeliveryRow): Readonly<Record<string, string>> =>
      Option.getOrElse(decodeHeadersJson(row.headers_json), () => ({}));
    const decodeDeliverySummary = (row: WebhookDeliveryRow) => ({
      id: ScheduledTaskWebhookDeliveryId.make(row.delivery_id),
      taskId: ScheduledTaskId.make(row.task_id),
      receivedAt: row.received_at,
      method: row.method,
      contentType: deliveryHeaders(row)["content-type"] ?? null,
      bodyBytes: row.body_bytes,
      outcome: row.outcome as ScheduledTaskWebhookDeliveryOutcome,
      signatureVerified: row.signature_verified === 1,
      missingFields: Option.getOrElse(decodeMissingFieldsJson(row.missing_fields_json), () => []),
      error: row.error,
    });

    const listWebhookDeliveries: ScheduledTaskService["Service"]["listWebhookDeliveries"] = (
      input,
    ) =>
      sql<WebhookDeliveryRow>`
        SELECT * FROM scheduled_task_webhook_deliveries
        WHERE task_id = ${input.id}
        ORDER BY received_at DESC, rowid DESC
      `.pipe(
        Effect.map((rows) => ({ deliveries: rows.map(decodeDeliverySummary) })),
        Effect.mapError((cause) =>
          taskError("Could not list webhook deliveries.", { taskId: input.id, cause }),
        ),
      );

    const getWebhookDelivery: ScheduledTaskService["Service"]["getWebhookDelivery"] = (input) =>
      Effect.gen(function* () {
        const rows = yield* sql<WebhookDeliveryRow>`
          SELECT * FROM scheduled_task_webhook_deliveries
          WHERE task_id = ${input.id} AND delivery_id = ${input.deliveryId}
        `.pipe(
          Effect.mapError((cause) =>
            taskError("Could not load webhook delivery.", { taskId: input.id, cause }),
          ),
        );
        const row = rows[0];
        if (row === undefined) {
          return yield* taskError("Webhook delivery not found.", { taskId: input.id });
        }
        return {
          delivery: {
            ...decodeDeliverySummary(row),
            query: row.query,
            headers: deliveryHeaders(row),
            body: row.body,
            bodyTruncated: row.body_truncated === 1,
            renderedPrompt: row.rendered_prompt,
          },
        };
      });

    const recordDelivery = (input: {
      readonly id: string;
      readonly taskId: ScheduledTaskId;
      readonly receivedAt: string;
      readonly request: WebhookTriggerRequest;
      readonly outcome: ScheduledTaskWebhookDeliveryOutcome;
      readonly signatureVerified: boolean;
      readonly missing: ReadonlyArray<string>;
      readonly renderedPrompt: string | null;
      readonly error?: string;
    }) => {
      const truncated = input.request.body.byteLength > WEBHOOK_DELIVERY_LOG_BODY_LIMIT;
      const loggedBody = truncated
        ? new TextDecoder().decode(input.request.body.subarray(0, WEBHOOK_DELIVERY_LOG_BODY_LIMIT))
        : input.request.bodyText;
      return sql
        .withTransaction(
          Effect.gen(function* () {
            // Conditional on the task existing, so a delivery racing a delete
            // cannot leave rows that a recreated task with the same id would show.
            yield* sql`
              INSERT INTO scheduled_task_webhook_deliveries (
                delivery_id, task_id, received_at, method, query, headers_json, body,
                body_bytes, body_truncated, outcome, signature_verified,
                missing_fields_json, rendered_prompt, error
              )
              SELECT
                ${input.id}, ${input.taskId}, ${input.receivedAt}, ${input.request.method},
                ${redactQuery(input.request.query)},
                ${encodeHeadersJson(redactHeaders(input.request.headers))},
                ${loggedBody},
                ${input.request.body.byteLength}, ${truncated ? 1 : 0}, ${input.outcome},
                ${input.signatureVerified ? 1 : 0}, ${encodeMissingFieldsJson(input.missing)},
                ${input.renderedPrompt?.slice(0, WEBHOOK_DELIVERY_LOG_PROMPT_LIMIT) ?? null},
                ${input.error ?? null}
              WHERE EXISTS (SELECT 1 FROM scheduled_tasks WHERE task_id = ${input.taskId})
              -- A held request retried after a rate limit reuses its relay
              -- delivery id; the newer attempt replaces the logged one.
              ON CONFLICT (delivery_id) DO UPDATE SET
                outcome = excluded.outcome,
                signature_verified = excluded.signature_verified,
                missing_fields_json = excluded.missing_fields_json,
                rendered_prompt = excluded.rendered_prompt,
                error = excluded.error
            `;
            yield* sql`
            DELETE FROM scheduled_task_webhook_deliveries
            WHERE task_id = ${input.taskId}
              AND delivery_id NOT IN (
                SELECT delivery_id FROM scheduled_task_webhook_deliveries
                WHERE task_id = ${input.taskId}
                -- rowid breaks timestamp ties in arrival order; delivery ids are random.
                ORDER BY received_at DESC, rowid DESC
                LIMIT ${WEBHOOK_DELIVERY_RETENTION}
              )
          `;
          }),
        )
        .pipe(
          Effect.mapError((cause) =>
            taskError("Could not record webhook delivery.", { taskId: input.taskId, cause }),
          ),
        );
    };

    const markDeliveryFailed = (deliveryId: string, message: string) =>
      sql`
        UPDATE scheduled_task_webhook_deliveries
        SET outcome = 'dispatch_failed', error = ${message}
        WHERE delivery_id = ${deliveryId}
      `.pipe(Effect.ignore);

    /** The sliding minute counts valid-token requests, including rejected signatures. */
    const takeRateSlot = (id: ScheduledTaskId, nowMs: number) =>
      Ref.modify(
        webhookRateWindows,
        (
          windows,
        ): readonly [
          "allowed" | "first_rejected" | "rejected",
          ReadonlyMap<ScheduledTaskId, RateWindow>,
        ] => {
          const current = windows.get(id);
          const recent = (current?.accepted ?? []).filter((at) => nowMs - at < 60_000);
          if (recent.length >= WEBHOOK_RATE_LIMIT_PER_MINUTE) {
            const first = current?.rejectedLogged !== true;
            return [
              first ? "first_rejected" : "rejected",
              new Map(windows).set(id, { accepted: recent, rejectedLogged: true }),
            ];
          }
          return [
            "allowed",
            new Map(windows).set(id, { accepted: [...recent, nowMs], rejectedLogged: false }),
          ];
        },
      );

    const webhookPermit = (id: ScheduledTaskId) =>
      Effect.gen(function* () {
        const existing = (yield* Ref.get(webhookPermits)).get(id);
        if (existing !== undefined) return existing;
        const created = yield* Semaphore.make(1);
        return yield* Ref.modify(webhookPermits, (permits) => {
          const raced = permits.get(id);
          return raced === undefined
            ? [created, new Map(permits).set(id, created)]
            : [raced, permits];
        });
      });

    // Detached from the request so the HTTP response does not wait for the
    // run; scoped to the service so shutdown interrupts it.
    const serviceScope = yield* Effect.scope;

    /** Finer outcomes distinguish queue pressure and oversized prompts in operational metrics. */
    const observeDelivery = (
      request: WebhookTriggerRequest,
      outcome: WebhookDeliveryOutcome,
      receivedAt: DateTime.DateTime | undefined,
      now: DateTime.DateTime | undefined,
    ) =>
      Effect.gen(function* () {
        const source = request.relayDeliveryId === undefined ? "direct" : "relay";
        yield* Effect.annotateCurrentSpan({
          "scheduled_task.webhook.outcome": outcome,
          "scheduled_task.webhook.source": source,
        });
        yield* Metrics.increment(Metrics.webhookDeliveriesTotal, { outcome, source });
        if (request.receivedAt !== undefined && receivedAt !== undefined && now !== undefined) {
          const heldMs = Math.max(
            0,
            DateTime.toEpochMillis(now) - DateTime.toEpochMillis(receivedAt),
          );
          yield* Effect.annotateCurrentSpan({ "scheduled_task.webhook.held_ms": heldMs });
          yield* Metric.update(Metrics.webhookHeldDelay, Duration.millis(heldMs));
        }
      });

    const triggerWebhook: ScheduledTaskService["Service"]["triggerWebhook"] = (request) =>
      triggerWebhookUnobserved(request).pipe(
        Effect.tapError(() => observeDelivery(request, "error", undefined, undefined)),
        Metrics.withMetrics({ timer: Metrics.webhookDeliveryDuration }),
        Effect.withSpan("ScheduledTaskService.triggerWebhook", {
          attributes: {
            "scheduled_task.webhook.method": request.method,
            "scheduled_task.webhook.body_bytes": request.body.byteLength,
            "scheduled_task.webhook.source":
              request.relayDeliveryId === undefined ? "direct" : "relay",
          },
        }),
      );

    const triggerWebhookUnobserved = (request: WebhookTriggerRequest) =>
      Effect.gen(function* () {
        const taskId = decodeTaskId(request.hookId);
        const notFound = observeDelivery(request, "not_found", undefined, undefined).pipe(
          Effect.as({ _tag: "not_found" as const }),
        );
        if (Option.isNone(taskId)) return yield* notFound;
        const rows = yield* getRows(taskId.value).pipe(
          Effect.mapError((cause) =>
            taskError("Could not load schedule task.", { taskId: taskId.value, cause }),
          ),
        );
        const row = rows[0];
        // A wrong token is indistinguishable from an unknown hook, so the URL
        // does not reveal which hooks exist.
        if (
          row === undefined ||
          row.webhook_token === null ||
          !constantTimeEquals(request.token, row.webhook_token)
        ) {
          return yield* notFound;
        }
        const task = yield* decodeRow(row);
        yield* Effect.annotateCurrentSpan({ "scheduled_task.id": task.id });
        const schedule = task.schedule;
        if (schedule.type !== "webhook") return yield* notFound;

        const now = yield* localNow;
        // Callers can forge relay headers through the public tunnel; clamp receivedAt to now
        // so future timestamps cannot bypass max age or pin delivery-log entries.
        const receivedAt =
          request.receivedAt === undefined
            ? now
            : DateTime.min(
                Option.getOrElse(DateTime.make(request.receivedAt), () => now),
                now,
              );
        const observe = (outcome: WebhookDeliveryOutcome) =>
          observeDelivery(request, outcome, receivedAt, now);
        const deliveryId = ScheduledTaskWebhookDeliveryId.make(
          request.relayDeliveryId === undefined
            ? `delivery:${yield* crypto
                .randomUUIDv4()
                .pipe(
                  Effect.mapError((cause) =>
                    taskError("Could not generate delivery id.", { cause }),
                  ),
                )}`
            : `delivery:relay:${request.relayDeliveryId}`,
        );
        // Retain claims longer than relay retries, independently of the trimmed delivery log.
        // Release retryable rate-limited claims so the relay can deliver them again.
        const releaseClaim = <A>(result: A) =>
          request.relayDeliveryId === undefined
            ? Effect.succeed(result)
            : sql`
                DELETE FROM scheduled_task_webhook_relay_deliveries
                WHERE relay_delivery_id = ${request.relayDeliveryId}
              `.pipe(Effect.ignore, Effect.as(result));
        // Claiming through forking must be uninterruptible: sender timeouts could otherwise
        // leave a claimed delivery that never runs or a queue slot that never releases.
        return yield* Effect.uninterruptible(
          Effect.gen(function* () {
            if (request.relayDeliveryId !== undefined) {
              const claimed = yield* sql<{ relay_delivery_id: string }>`
                INSERT INTO scheduled_task_webhook_relay_deliveries
                  (relay_delivery_id, task_id, seen_at)
                VALUES (${request.relayDeliveryId}, ${task.id}, ${iso(now)})
                ON CONFLICT (relay_delivery_id) DO NOTHING
                RETURNING relay_delivery_id
              `.pipe(
                Effect.mapError((cause) =>
                  taskError("Could not record webhook delivery.", { taskId: task.id, cause }),
                ),
              );
              if (claimed.length === 0) {
                yield* observe("duplicate");
                return { _tag: "accepted" as const, deliveryId, outcome: "duplicate" as const };
              }
              // Older claims can no longer be replayed by the relay.
              yield* sql`
                DELETE FROM scheduled_task_webhook_relay_deliveries
                WHERE seen_at < ${iso(DateTime.subtract(now, { hours: 48 }))}
              `.pipe(Effect.ignore);
            }
            const log = (
              outcome: ScheduledTaskWebhookDeliveryOutcome,
              details: {
                readonly signatureVerified?: boolean;
                readonly missing?: ReadonlyArray<string>;
                readonly renderedPrompt?: string;
                readonly error?: string;
              } = {},
            ) =>
              recordDelivery({
                id: deliveryId,
                taskId: task.id,
                receivedAt: iso(receivedAt),
                request,
                outcome,
                signatureVerified: details.signatureVerified ?? false,
                missing: details.missing ?? [],
                renderedPrompt: details.renderedPrompt ?? null,
                ...(details.error === undefined ? {} : { error: details.error }),
              });

            // Only the first rejected request in a window is logged, so a flood
            // cannot write rows or push the real deliveries out of the log.
            const slot = yield* takeRateSlot(task.id, DateTime.toEpochMillis(now));
            if (slot !== "allowed") {
              if (slot === "first_rejected") yield* log("rate_limited");
              yield* observe("rate_limited");
              return yield* releaseClaim({
                _tag: "rate_limited" as const,
                outcome: "rate_limited" as const,
              });
            }
            if (!task.enabled) {
              yield* log("disabled");
              yield* observe("disabled");
              return { _tag: "disabled" as const };
            }
            const signature = schedule.signature;
            if (signature !== null) {
              const verified =
                row.webhook_secret !== null &&
                verifyWebhookSignature({
                  signature,
                  secret: row.webhook_secret,
                  headers: request.headers,
                  body: request.body,
                });
              if (!verified) {
                yield* log("rejected_signature");
                yield* observe("rejected_signature");
                return { _tag: "rejected_signature" as const };
              }
            }
            const maxAgeMinutes = schedule.maxDeliveryAgeMinutes ?? null;
            if (
              maxAgeMinutes !== null &&
              DateTime.toEpochMillis(now) - DateTime.toEpochMillis(receivedAt) >
                maxAgeMinutes * 60_000
            ) {
              yield* log("expired", { signatureVerified: signature !== null });
              yield* observe("expired");
              return { _tag: "expired" as const };
            }

            const rendered = renderWebhookPrompt(task.prompt, request);
            // Oversized prompts cannot be retried, so retain their claims.
            // Provider validation trims the prompt before checking its length.
            if (rendered.prompt.trim().length > PROVIDER_SEND_TURN_MAX_INPUT_CHARS) {
              yield* log("dispatch_failed", {
                signatureVerified: signature !== null,
                missing: rendered.missing,
                renderedPrompt: rendered.prompt,
                error: "The filled-in prompt is too long.",
              });
              yield* observe("prompt_too_long");
              return { _tag: "accepted" as const, deliveryId, outcome: "prompt_too_long" as const };
            }
            // Bound parked fibers for stuck tasks; do not log refused requests
            // that could push real deliveries out of the log.
            const queueKey = `${task.id}\u0000${task.createdAt}`;
            const queued = yield* Ref.modify(webhookQueued, (counts) => {
              const count = counts.get(queueKey) ?? 0;
              return count >= WEBHOOK_MAX_QUEUED_PER_TASK
                ? ([false, counts] as const)
                : ([true, new Map(counts).set(queueKey, count + 1)] as const);
            });
            if (!queued) {
              yield* observe("queue_full");
              return yield* releaseClaim({
                _tag: "rate_limited" as const,
                outcome: "queue_full" as const,
              });
            }
            const release = Ref.update(webhookQueued, (counts) => {
              const next = new Map(counts);
              const count = (next.get(queueKey) ?? 1) - 1;
              if (count <= 0) next.delete(queueKey);
              else next.set(queueKey, count);
              return next;
            });
            yield* log("accepted", {
              signatureVerified: signature !== null,
              missing: rendered.missing,
              renderedPrompt: rendered.prompt,
            }).pipe(Effect.onError(() => release));
            yield* observe("accepted");
            const permit = yield* webhookPermit(task.id);
            const runOutcome = (outcome: "started" | "skipped" | "failed") =>
              Effect.all([
                Effect.annotateCurrentSpan({ "scheduled_task.webhook.run_outcome": outcome }),
                Metrics.increment(Metrics.webhookRunsTotal, { outcome }),
              ]);
            yield* runTask(task, "webhook", { deliveryId, prompt: rendered.prompt }).pipe(
              Effect.flatMap((completed) =>
                completed.lastRunStatus === "failed"
                  ? runOutcome("failed").pipe(
                      Effect.andThen(markDeliveryFailed(deliveryId, "The run failed to start.")),
                    )
                  : runOutcome("started"),
              ),
              Effect.catchTags({
                WebhookDeliverySkipped: (skipped) =>
                  runOutcome("skipped").pipe(
                    Effect.andThen(markDeliveryFailed(deliveryId, skipped.reason)),
                  ),
              }),
              // The log is readable over RPC, so it gets a fixed reason; the
              // cause, which can carry request data, stays in the server log.
              Effect.catchCause((cause) =>
                Effect.logWarning("Webhook dispatch failed", { taskId: task.id, cause }).pipe(
                  Effect.andThen(runOutcome("failed")),
                  Effect.andThen(markDeliveryFailed(deliveryId, "The run failed to start.")),
                ),
              ),
              permit.withPermits(1),
              // Its own trace: the request that triggered it has already been answered.
              Effect.withSpan("ScheduledTaskService.runWebhookDelivery", {
                root: true,
                attributes: {
                  "scheduled_task.id": task.id,
                  "scheduled_task.webhook.delivery_id": deliveryId,
                },
              }),
              Effect.ensuring(release),
              Effect.forkIn(serviceScope),
            );
            return { _tag: "accepted" as const, deliveryId, outcome: "accepted" as const };
          }),
        );
      });

    return ScheduledTaskService.of({
      list,
      subscribeList,
      upsert,
      setEnabled,
      delete: deleteTask,
      runNow,
      rotateWebhookToken,
      listWebhookDeliveries,
      getWebhookDelivery,
      triggerWebhook,
    });
  }),
);
