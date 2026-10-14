import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import { SourceControlProviderKind } from "@t3tools/contracts";

import {
  PersistenceDecodeError,
  PersistenceSqlError,
  type PullRequestFilesViewedRepositoryError,
} from "./Errors.ts";

/**
 * Host and reader isolate marks across self-managed hosts and account changes.
 * An unidentified reader uses the empty string as one shared reader scope.
 */
export const PullRequestFilesViewedScope = Schema.Struct({
  provider: SourceControlProviderKind,
  host: Schema.String,
  repository: Schema.String,
  number: Schema.Int,
  viewer: Schema.String,
});
export type PullRequestFilesViewedScope = typeof PullRequestFilesViewedScope.Type;

export const PullRequestFileViewedMark = Schema.Struct({
  path: Schema.String,
  /**
   * The opaque host revision is empty for a deleted file; null means no baseline and stays cleared until replaced.
   * Other revision nulls are described in `docs/internals/pull-request-file-revisions.md`.
   */
  revision: Schema.NullOr(Schema.String),
});
export type PullRequestFileViewedMark = typeof PullRequestFileViewedMark.Type;

export interface SetPullRequestFilesViewedInput extends PullRequestFilesViewedScope {
  readonly files: ReadonlyArray<PullRequestFileViewedMark & { readonly viewed: boolean }>;
  /** ISO instant when the reader marked the files. */
  readonly viewedAt: string;
}

/** Bound per-scope path sets/maps; match the GitHub reader's 500-file window. */
export const MAX_FILES_VIEWED_ROWS = 500;

export interface PullRequestFilesViewedPage {
  readonly files: ReadonlyArray<PullRequestFileViewedMark>;
  readonly truncated: boolean;
}

/** Store only cleared files; deleting unchecked marks prevents growth from files merely scrolled past. */
export class PullRequestFilesViewedRepository extends Context.Service<
  PullRequestFilesViewedRepository,
  {
    readonly list: (
      input: PullRequestFilesViewedScope,
    ) => Effect.Effect<PullRequestFilesViewedPage, PullRequestFilesViewedRepositoryError>;
    readonly set: (
      input: SetPullRequestFilesViewedInput,
    ) => Effect.Effect<void, PullRequestFilesViewedRepositoryError>;
  }
>()("t3/persistence/PullRequestFilesViewed/PullRequestFilesViewedRepository") {}

function toSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): PullRequestFilesViewedRepositoryError =>
    Schema.isSchemaError(cause)
      ? PersistenceDecodeError.fromSchemaError(decodeOperation, cause)
      : new PersistenceSqlError({ operation: sqlOperation, cause });
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listRows = SqlSchema.findAll({
    Request: PullRequestFilesViewedScope,
    Result: PullRequestFileViewedMark,
    execute: ({ provider, host, repository, number, viewer }) =>
      sql`
        SELECT
          path AS "path",
          revision AS "revision"
        FROM pull_request_files_viewed
        WHERE provider = ${provider}
          AND host = ${host}
          AND repository = ${repository}
          AND number = ${number}
          AND viewer = ${viewer}
        ORDER BY path
        LIMIT ${MAX_FILES_VIEWED_ROWS + 1}
      `,
  });

  return PullRequestFilesViewedRepository.of({
    // Stable path ordering prevents shuffled windows; the extra row proves truncation.
    list: (input) =>
      listRows(input).pipe(
        Effect.map((rows) => ({
          files: rows.slice(0, MAX_FILES_VIEWED_ROWS),
          truncated: rows.length > MAX_FILES_VIEWED_ROWS,
        })),
        Effect.mapError(toSqlOrDecodeError("listPullRequestFilesViewed", "PullRequestFileViewed")),
      ),

    // Small local batches mix clears and un-clears, so use one statement per file.
    set: (input) =>
      // One transaction prevents partial batches from appearing as marks the reader never made.
      sql
        .withTransaction(
          Effect.forEach(
            input.files,
            (file) =>
              file.viewed
                ? sql`
                INSERT INTO pull_request_files_viewed (
                  provider,
                  host,
                  repository,
                  number,
                  viewer,
                  path,
                  revision,
                  viewed_at
                )
                VALUES (
                  ${input.provider},
                  ${input.host},
                  ${input.repository},
                  ${input.number},
                  ${input.viewer},
                  ${file.path},
                  ${file.revision},
                  ${input.viewedAt}
                )
                ON CONFLICT (provider, host, repository, number, viewer, path)
                DO UPDATE SET revision = excluded.revision, viewed_at = excluded.viewed_at
              `
                : sql`
                DELETE FROM pull_request_files_viewed
                WHERE provider = ${input.provider}
                  AND host = ${input.host}
                  AND repository = ${input.repository}
                  AND number = ${input.number}
                  AND viewer = ${input.viewer}
                  AND path = ${file.path}
              `,
            { discard: true },
          ),
        )
        .pipe(
          Effect.mapError(
            (cause) => new PersistenceSqlError({ operation: "setPullRequestFilesViewed", cause }),
          ),
        ),
  });
});

export const layer = Layer.effect(PullRequestFilesViewedRepository, make);
