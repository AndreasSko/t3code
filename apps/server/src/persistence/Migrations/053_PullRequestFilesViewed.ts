import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Store only cleared files; deleting unchecked marks avoids growth from merely scrolling past files.
  // Revisions detect changed files after pushes; nullable revision semantics are defined by PullRequestFileViewedMark.
  yield* sql`
    CREATE TABLE IF NOT EXISTS pull_request_files_viewed (
      provider TEXT NOT NULL,
      host TEXT NOT NULL,
      repository TEXT NOT NULL,
      number INTEGER NOT NULL,
      viewer TEXT NOT NULL,
      path TEXT NOT NULL,
      revision TEXT,
      viewed_at TEXT NOT NULL,
      PRIMARY KEY (provider, host, repository, number, viewer, path)
    ) WITHOUT ROWID
  `;
});
