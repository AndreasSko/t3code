import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type {
  PullRequestAction,
  PullRequestComment,
  PullRequestInvolvement,
  PullRequestListState,
  PullRequestMergeMethod,
} from "@t3tools/contracts";

import * as AzureDevOpsCli from "./AzureDevOpsCli.ts";
import {
  decodeItemContentJson,
  decodeIterationChangesJson,
  decodeIterationsJson,
  decodePullRequestJson,
  decodePullRequestListJson,
  decodeThreadsJson,
  decodeViewerJson,
  type AzureDevOpsChangeEntry,
  type AzureDevOpsItemContent,
  type AzureDevOpsIteration,
  type AzureDevOpsPullRequest,
  type AzureDevOpsRepositoryLocation,
} from "./azureDevOpsPullRequestJson.ts";
import type { ProviderListCursor } from "@t3tools/source-control-core/server/PullRequestProvider";

export class AzureDevOpsPullRequestReadError extends Schema.TaggedError<AzureDevOpsPullRequestReadError>()(
  "AzureDevOpsPullRequestReadError",
  {
    command: Schema.Literal("az"),
    cwd: Schema.String,
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {
  get detail(): string {
    return `Azure CLI returned an unreadable ${this.operation} response.`;
  }

  override get message(): string {
    return `Azure CLI failed in ${this.operation}: ${this.detail}`;
  }
}

export class AzureDevOpsViewerUnavailableError extends Schema.TaggedError<AzureDevOpsViewerUnavailableError>()(
  "AzureDevOpsViewerUnavailableError",
  {
    command: Schema.Literal("az"),
    cwd: Schema.String,
  },
) {
  get detail(): string {
    return "Azure CLI could not name the signed-in account. Run `az login` and retry.";
  }

  override get message(): string {
    return `Azure CLI failed in getViewer: ${this.detail}`;
  }
}

export class AzureDevOpsPullRequestIncompleteError extends Schema.TaggedError<AzureDevOpsPullRequestIncompleteError>()(
  "AzureDevOpsPullRequestIncompleteError",
  {
    command: Schema.Literal("az"),
    cwd: Schema.String,
    number: Schema.Int,
  },
) {
  get detail(): string {
    return "Azure DevOps returned no branch or link for the pull request.";
  }

  override get message(): string {
    return `Azure CLI failed in getPullRequest: ${this.detail}`;
  }
}

/** Reviewer names travel as argv because az offers no request body; reject flag-like values. */
export class AzureDevOpsReviewerNameError extends Schema.TaggedError<AzureDevOpsReviewerNameError>()(
  "AzureDevOpsReviewerNameError",
  {
    command: Schema.Literal("az"),
    cwd: Schema.String,
  },
) {
  get detail(): string {
    return "A reviewer is named by an email address or an identity id.";
  }

  override get message(): string {
    return `Azure CLI failed in setPullRequestReviewers: ${this.detail}`;
  }
}

export type AzureDevOpsPullRequestCliError =
  | AzureDevOpsCli.AzureDevOpsCliError
  | AzureDevOpsPullRequestReadError
  | AzureDevOpsPullRequestIncompleteError
  | AzureDevOpsReviewerNameError
  | AzureDevOpsViewerUnavailableError;

/** The version every REST call below is pinned to, so a new default cannot reshape a response. */
const REST_API_VERSION = "7.1";
const PULL_REQUEST_LIST_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
/** A 2000-file page exceeds the default megabyte; truncation would leave invalid JSON. */
const CHANGE_ENTRIES_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
/** Azure wraps file content in escaped JSON or base64, requiring more room than raw bytes. */
const ITEM_CONTENT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
/** Unpaginated review history grows with review length; default output limits can cut JSON mid-string. */
const REVIEW_HISTORY_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/** Azure's own ceiling for one page of an iteration's changes. */
const CHANGE_ENTRIES_PER_PAGE = 2000;

/** Bound raw skipped entries, since folder-only pages must still advance and eventually stop. */
const MAX_CHANGE_ENTRIES = 10_000;

export interface AzureDevOpsIterationChanges {
  readonly changes: ReadonlyArray<AzureDevOpsChangeEntry>;
  readonly truncated: boolean;
}

export class AzureDevOpsPullRequestCli extends Context.Service<
  AzureDevOpsPullRequestCli,
  {
    readonly getViewer: (input: {
      readonly cwd: string;
    }) => Effect.Effect<string, AzureDevOpsPullRequestCliError>;

    readonly listPullRequests: (input: {
      readonly cwd: string;
      readonly repository: string;
      readonly state: PullRequestListState;
      readonly involvement: PullRequestInvolvement;
      readonly viewer: string;
      readonly limit: number;
      /**
       * Where to carry on from. Azure has no date filter for a pull request listing, so the only
       * part of a cursor it can use is how many rows have already been handed over.
       */
      readonly cursor?: ProviderListCursor | undefined;
    }) => Effect.Effect<
      {
        readonly items: ReadonlyArray<AzureDevOpsPullRequest>;
        readonly truncated: boolean;
        /** Raw Azure rows consumed to produce this page, including malformed rows. */
        readonly cursorAdvance: number;
      },
      AzureDevOpsPullRequestCliError
    >;

    readonly getPullRequest: (input: {
      readonly cwd: string;
      readonly number: number;
    }) => Effect.Effect<AzureDevOpsPullRequest, AzureDevOpsPullRequestCliError>;

    /** Threads are not reachable through `az repos pr`, so they come from the REST API. */
    readonly listThreads: (input: {
      readonly cwd: string;
      readonly location: AzureDevOpsRepositoryLocation;
      readonly number: number;
    }) => Effect.Effect<ReadonlyArray<PullRequestComment>, AzureDevOpsPullRequestCliError>;

    /** Azure hangs changed files off push iterations; diff reads start here. */
    readonly listIterations: (input: {
      readonly cwd: string;
      readonly location: AzureDevOpsRepositoryLocation;
      readonly number: number;
    }) => Effect.Effect<ReadonlyArray<AzureDevOpsIteration>, AzureDevOpsPullRequestCliError>;

    /** Changes against the merge base, giving the whole pull request rather than just the latest push. */
    readonly listIterationChanges: (input: {
      readonly cwd: string;
      readonly location: AzureDevOpsRepositoryLocation;
      readonly number: number;
      readonly iterationId: number;
    }) => Effect.Effect<AzureDevOpsIterationChanges, AzureDevOpsPullRequestCliError>;

    /** Azure has no patch-content route; read each side separately to build a patch. */
    readonly readItemContent: (input: {
      readonly cwd: string;
      readonly location: AzureDevOpsRepositoryLocation;
      readonly path: string;
      readonly commit: string;
    }) => Effect.Effect<AzureDevOpsItemContent, AzureDevOpsPullRequestCliError>;

    readonly runPullRequestAction: (input: {
      readonly cwd: string;
      readonly number: number;
      readonly action: PullRequestAction;
      readonly mergeMethod?: PullRequestMergeMethod;
    }) => Effect.Effect<void, AzureDevOpsPullRequestCliError>;

    readonly updatePullRequest: (input: {
      readonly cwd: string;
      readonly number: number;
      readonly title?: string | undefined;
      readonly body?: string | undefined;
    }) => Effect.Effect<void, AzureDevOpsPullRequestCliError>;

    /** az can add/remove named reviewers but cannot list candidates. */
    readonly setPullRequestReviewers: (input: {
      readonly cwd: string;
      readonly number: number;
      readonly reviewers: ReadonlyArray<string>;
      readonly requested: boolean;
    }) => Effect.Effect<void, AzureDevOpsPullRequestCliError>;
  }
>()("@t3tools/source-control-azure-devops/server/AzureDevOpsPullRequestCli") {}

function statusArgs(state: PullRequestListState): ReadonlyArray<string> {
  switch (state) {
    case "open":
      return ["--status", "active"];
    case "merged":
      return ["--status", "completed"];
    case "closed":
      return ["--status", "abandoned"];
    case "all":
      return ["--status", "all"];
  }
}

function involvementArgs(input: {
  readonly involvement: PullRequestInvolvement;
  readonly viewer: string;
}): ReadonlyArray<string> {
  switch (input.involvement) {
    case "authored":
      return ["--creator", input.viewer];
    case "reviewing":
      return ["--reviewer", input.viewer];
    case "all":
      return [];
  }
}

function actionArgs(
  action: PullRequestAction,
  mergeMethod: PullRequestMergeMethod | undefined,
): ReadonlyArray<string> {
  switch (action) {
    case "merge":
      return ["--status", "completed", "--squash", mergeMethod === "squash" ? "true" : "false"];
    case "enable-auto-merge":
      return [
        "--auto-complete",
        "true",
        ...(mergeMethod === undefined
          ? []
          : ["--squash", mergeMethod === "squash" ? "true" : "false"]),
      ];
    case "disable-auto-merge":
      return ["--auto-complete", "false"];
    case "ready":
      return ["--draft", "false"];
    case "draft":
      return ["--draft", "true"];
    case "close":
      return ["--status", "abandoned"];
    case "update-branch":
      return [];
    case "reopen":
      return ["--status", "active"];
    case "revert":
    case "approve-workflows":
      throw new Error(`Azure DevOps pull request action ${action} is unsupported`);
  }
}

/** Reject leading dashes so reviewer values cannot become az flags. */
function isReviewerName(value: string): boolean {
  const name = value.trim();
  return name.length > 0 && !name.startsWith("-");
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const azure = yield* AzureDevOpsCli.AzureDevOpsCli;

  // --detect resolves organization, project and repository from each checkout's remote.
  const detectArgs = ["--detect", "true"] as const;

  const executeJson = (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly maxOutputBytes?: number;
  }) =>
    azure.execute({
      cwd: input.cwd,
      args: [...input.args, "--only-show-errors", "--output", "json"],
      ...(input.maxOutputBytes === undefined ? {} : { maxOutputBytes: input.maxOutputBytes }),
    });

  /** az devops invoke uses the extension's login; az rest can select the wrong tenant
   * and return a sign-in page instead of the requested JSON. */
  const invoke = <A>(input: {
    readonly cwd: string;
    readonly operation: string;
    readonly resource: string;
    readonly routeParameters: ReadonlyArray<string>;
    readonly queryParameters?: ReadonlyArray<string>;
    readonly maxOutputBytes?: number;
    readonly decode: (raw: string) => Result.Result<A, unknown>;
  }): Effect.Effect<A, AzureDevOpsPullRequestCliError> =>
    executeJson({
      cwd: input.cwd,
      ...(input.maxOutputBytes === undefined ? {} : { maxOutputBytes: input.maxOutputBytes }),
      args: [
        "devops",
        "invoke",
        ...detectArgs,
        "--area",
        "git",
        "--resource",
        input.resource,
        "--api-version",
        REST_API_VERSION,
        "--route-parameters",
        ...input.routeParameters,
        ...(input.queryParameters === undefined
          ? []
          : ["--query-parameters", ...input.queryParameters]),
      ],
    }).pipe(
      Effect.flatMap((result) => {
        const decoded = input.decode(result.stdout.trim());
        return Result.isSuccess(decoded)
          ? Effect.succeed(decoded.success)
          : Effect.fail(
              new AzureDevOpsPullRequestReadError({
                command: "az",
                cwd: input.cwd,
                operation: input.operation,
                cause: decoded.failure,
              }),
            );
      }),
    );

  /** Azure item routes require the leading slash omitted from internal repository paths. */
  const toItemPath = (path: string) => (path.startsWith("/") ? path : `/${path}`);

  const repositoryRoute = (location: AzureDevOpsRepositoryLocation): ReadonlyArray<string> => [
    `project=${location.project}`,
    `repositoryId=${location.repository}`,
  ];

  const pullRequestRoute = (input: {
    readonly location: AzureDevOpsRepositoryLocation;
    readonly number: number;
  }): ReadonlyArray<string> => [
    ...repositoryRoute(input.location),
    `pullRequestId=${input.number}`,
  ];

  /** Offset cursors must count malformed raw rows too; a short decoded page is not the end. */
  const listPullRequestPage = (input: {
    readonly cwd: string;
    readonly repository: string;
    readonly state: PullRequestListState;
    readonly involvement: PullRequestInvolvement;
    readonly viewer: string;
    readonly limit: number;
    readonly skip: number;
    readonly cursorAdvance: number;
    readonly items: ReadonlyArray<AzureDevOpsPullRequest>;
  }): Effect.Effect<
    {
      readonly items: ReadonlyArray<AzureDevOpsPullRequest>;
      readonly truncated: boolean;
      readonly cursorAdvance: number;
    },
    AzureDevOpsPullRequestCliError
  > => {
    const remaining = input.limit - input.items.length;
    const top = remaining + 1;
    return executeJson({
      cwd: input.cwd,
      maxOutputBytes: PULL_REQUEST_LIST_MAX_OUTPUT_BYTES,
      args: [
        "repos",
        "pr",
        "list",
        ...detectArgs,
        "--repository",
        input.repository,
        ...statusArgs(input.state),
        ...involvementArgs(input),
        "--include-links",
        ...(input.skip === 0 ? [] : ["--skip", String(input.skip)]),
        "--top",
        String(top),
      ],
    }).pipe(
      Effect.flatMap((result) => {
        const raw = result.stdout.trim();
        if (raw.length === 0) {
          return Effect.succeed({
            items: input.items,
            truncated: false,
            cursorAdvance: input.cursorAdvance,
          });
        }
        const decoded = decodePullRequestListJson(raw);
        if (!Result.isSuccess(decoded)) {
          return Effect.fail(
            new AzureDevOpsPullRequestReadError({
              command: "az",
              cwd: input.cwd,
              operation: "listPullRequests",
              cause: decoded.failure,
            }),
          );
        }

        const lastItemIndex = decoded.success.rawIndexes[remaining - 1];
        if (lastItemIndex !== undefined) {
          const consumed = lastItemIndex + 1;
          return Effect.succeed({
            items: [...input.items, ...decoded.success.items.slice(0, remaining)],
            // A full raw response may have more rows even when malformed entries used the probe.
            truncated: consumed < decoded.success.rawCount || decoded.success.rawCount === top,
            cursorAdvance: input.cursorAdvance + consumed,
          });
        }

        const items = [...input.items, ...decoded.success.items];
        if (decoded.success.rawCount < top) {
          return Effect.succeed({
            items,
            truncated: false,
            cursorAdvance: input.cursorAdvance + decoded.success.rawCount,
          });
        }
        return listPullRequestPage({
          ...input,
          skip: input.skip + decoded.success.rawCount,
          cursorAdvance: input.cursorAdvance + decoded.success.rawCount,
          items,
        });
      }),
    );
  };

  return AzureDevOpsPullRequestCli.of({
    getViewer: (input) =>
      executeJson({ cwd: input.cwd, args: ["account", "show", "--query", "user"] }).pipe(
        Effect.flatMap((result): Effect.Effect<string, AzureDevOpsPullRequestCliError> => {
          // --query user returns only the account; restore the decoder's expected wrapper.
          const decoded = decodeViewerJson(`{"user":${result.stdout.trim() || "null"}}`);
          if (!Result.isSuccess(decoded)) {
            return Effect.fail(
              new AzureDevOpsPullRequestReadError({
                command: "az",
                cwd: input.cwd,
                operation: "getViewer",
                cause: decoded.failure,
              }),
            );
          }
          return decoded.success === null
            ? Effect.fail(new AzureDevOpsViewerUnavailableError({ command: "az", cwd: input.cwd }))
            : Effect.succeed(decoded.success);
        }),
        // az account show cannot identify a PAT login; --creator me resolves it in the extension.
        // Viewers without a pull request remain unnamed rather than being compared as "me".
        Effect.catchIf(
          (error) => error._tag !== "AzureDevOpsCliUnavailableError",
          () =>
            executeJson({
              cwd: input.cwd,
              args: [
                "repos",
                "pr",
                "list",
                ...detectArgs,
                "--creator",
                "me",
                "--status",
                "all",
                "--top",
                "1",
              ],
            }).pipe(
              Effect.flatMap((result): Effect.Effect<string, AzureDevOpsPullRequestCliError> => {
                const decoded = decodePullRequestListJson(result.stdout.trim() || "[]");
                const login = Result.isSuccess(decoded)
                  ? decoded.success.items[0]?.author?.login
                  : undefined;
                return login === undefined
                  ? Effect.fail(
                      new AzureDevOpsViewerUnavailableError({ command: "az", cwd: input.cwd }),
                    )
                  : Effect.succeed(login);
              }),
            ),
        ),
      ),

    listPullRequests: (input) =>
      listPullRequestPage({
        cwd: input.cwd,
        repository: input.repository,
        state: input.state,
        involvement: input.involvement,
        viewer: input.viewer,
        limit: input.limit,
        // Raw offsets can shift when pull requests arrive between pages, so seam rows may repeat.
        skip: input.cursor?.delivered ?? 0,
        cursorAdvance: 0,
        items: [],
      }),

    getPullRequest: (input) =>
      executeJson({
        cwd: input.cwd,
        args: ["repos", "pr", "show", ...detectArgs, "--id", String(input.number)],
      }).pipe(
        Effect.flatMap(
          (result): Effect.Effect<AzureDevOpsPullRequest, AzureDevOpsPullRequestCliError> => {
            const decoded = decodePullRequestJson(result.stdout.trim());
            if (!Result.isSuccess(decoded)) {
              return Effect.fail(
                new AzureDevOpsPullRequestReadError({
                  command: "az",
                  cwd: input.cwd,
                  operation: "getPullRequest",
                  cause: decoded.failure,
                }),
              );
            }
            return decoded.success === null
              ? Effect.fail(
                  new AzureDevOpsPullRequestIncompleteError({
                    command: "az",
                    cwd: input.cwd,
                    number: input.number,
                  }),
                )
              : Effect.succeed(decoded.success);
          },
        ),
      ),

    listThreads: (input) =>
      invoke({
        cwd: input.cwd,
        operation: "listThreads",
        resource: "pullRequestThreads",
        routeParameters: pullRequestRoute(input),
        maxOutputBytes: REVIEW_HISTORY_MAX_OUTPUT_BYTES,
        decode: decodeThreadsJson,
      }),

    listIterations: (input) =>
      invoke({
        cwd: input.cwd,
        operation: "listIterations",
        resource: "pullRequestIterations",
        routeParameters: pullRequestRoute(input),
        maxOutputBytes: REVIEW_HISTORY_MAX_OUTPUT_BYTES,
        decode: decodeIterationsJson,
      }),

    listIterationChanges: (input) => {
      const page = (skip: number) =>
        invoke({
          cwd: input.cwd,
          operation: "listIterationChanges",
          resource: "pullRequestIterationChanges",
          routeParameters: [...pullRequestRoute(input), `iterationId=${input.iterationId}`],
          // Request Azure's maximum page size; nextSkip, not the count, identifies the next page.
          queryParameters: [`$top=${CHANGE_ENTRIES_PER_PAGE}`, `$skip=${skip}`],
          maxOutputBytes: CHANGE_ENTRIES_MAX_OUTPUT_BYTES,
          decode: decodeIterationChangesJson,
        });
      const from = (
        skip: number,
        collected: ReadonlyArray<AzureDevOpsChangeEntry>,
      ): Effect.Effect<AzureDevOpsIterationChanges, AzureDevOpsPullRequestCliError> =>
        page(skip).pipe(
          Effect.flatMap((answer) => {
            const changes = [...collected, ...answer.changes];
            if (answer.nextSkip === null) return Effect.succeed({ changes, truncated: false });
            // Repeated or over-budget offsets stop as truncated so the walk cannot loop forever.
            return answer.nextSkip <= skip || answer.nextSkip >= MAX_CHANGE_ENTRIES
              ? Effect.succeed({ changes, truncated: true })
              : from(answer.nextSkip, changes);
          }),
        );
      return from(0, []);
    },

    readItemContent: (input) =>
      invoke({
        cwd: input.cwd,
        operation: "readItemContent",
        resource: "items",
        routeParameters: repositoryRoute(input.location),
        queryParameters: [
          `path=${toItemPath(input.path)}`,
          "versionDescriptor.versionType=commit",
          `versionDescriptor.version=${input.commit}`,
          "includeContent=true",
          // Azure's binary flag is only returned with contentMetadata; encoded content cannot prove it.
          "includeContentMetadata=true",
          // Without this Azure answers with the file's own bytes rather than with a JSON
          // envelope, and `az devops invoke` refuses anything it cannot parse as JSON.
          "$format=json",
        ],
        maxOutputBytes: ITEM_CONTENT_MAX_OUTPUT_BYTES,
        decode: decodeItemContentJson,
      }),

    setPullRequestReviewers: (input) =>
      input.reviewers.some((reviewer) => !isReviewerName(reviewer))
        ? Effect.fail(new AzureDevOpsReviewerNameError({ command: "az", cwd: input.cwd }))
        : azure
            .execute({
              cwd: input.cwd,
              args: [
                "repos",
                "pr",
                "reviewer",
                input.requested ? "add" : "remove",
                ...detectArgs,
                "--id",
                String(input.number),
                // One `--reviewers` takes them all, because az reads the flag as a list and a
                // second one would replace the first rather than add to it.
                "--reviewers",
                ...input.reviewers,
                "--only-show-errors",
                "--output",
                "json",
              ],
            })
            .pipe(Effect.asVoid),

    runPullRequestAction: (input) =>
      azure
        .execute({
          cwd: input.cwd,
          args: [
            "repos",
            "pr",
            "update",
            ...detectArgs,
            "--id",
            String(input.number),
            ...actionArgs(input.action, input.mergeMethod),
            "--only-show-errors",
            "--output",
            "json",
          ],
        })
        .pipe(Effect.asVoid),

    updatePullRequest: (input) =>
      azure
        .execute({
          cwd: input.cwd,
          args: [
            "repos",
            "pr",
            "update",
            ...detectArgs,
            "--id",
            String(input.number),
            // --flag=value keeps leading bullets from becoming az flags and the description in one argument.
            ...(input.title === undefined ? [] : [`--title=${input.title}`]),
            ...(input.body === undefined ? [] : [`--description=${input.body}`]),
            "--only-show-errors",
            "--output",
            "json",
          ],
        })
        .pipe(Effect.asVoid),
  });
});

export const layer = Layer.effect(AzureDevOpsPullRequestCli, make);
