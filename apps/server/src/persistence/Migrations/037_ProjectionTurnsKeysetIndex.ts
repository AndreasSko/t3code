import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Including turn_id serves the keyset tiebreak order without sorting all turns before LIMIT.
 * The (thread_id, requested_at) index cannot bound that work by page size.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_turns_thread_keyset
    ON projection_turns(thread_id, requested_at, turn_id)
  `;
});
