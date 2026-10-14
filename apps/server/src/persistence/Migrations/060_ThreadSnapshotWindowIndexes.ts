import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // ProjectionStore's turn_anchors CTE needs this index to bound newest-user-message lookups
  // without scanning every turn item in a long thread.
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_projection_turn_items_user_message_idx
    ON orchestration_v2_projection_turn_items(thread_id, ordinal, turn_item_id)
    WHERE type = 'user_message'
  `;
  // Snapshots retain unfinished nodes; index them separately to avoid scanning thousands of finished nodes.
  // Scanning finished nodes accounted for more than half of the node query's time.
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_projection_nodes_live_idx
    ON orchestration_v2_projection_nodes(thread_id)
    WHERE status IN ('pending', 'starting', 'running', 'waiting')
  `;
});
