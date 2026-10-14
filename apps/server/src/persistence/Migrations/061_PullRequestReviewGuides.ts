import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Host-level keys share guides across checkouts of the same repository.
  // A push preserves the costly model-generated guide so clients can mark it stale.
  yield* sql`
    CREATE TABLE IF NOT EXISTS pull_request_review_guides (
      host TEXT NOT NULL,
      repository TEXT NOT NULL,
      number INTEGER NOT NULL,
      guide_json TEXT NOT NULL,
      PRIMARY KEY (host, repository, number)
    ) WITHOUT ROWID
  `;
});
