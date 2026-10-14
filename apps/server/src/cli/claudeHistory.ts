import * as Effect from "effect/Effect";
import { Argument, Command } from "effect/cli";

import { runClaudeHistoryWorker } from "../claudeHistoryWorker.ts";

/** The executable has no host Node for a sibling history script, so it uses this hidden subcommand. */
export const claudeHistoryCommand = Command.make("__claude-history", {
  method: Argument.String("method"),
  sessionId: Argument.String("session-id"),
  options: Argument.String("options").pipe(Argument.optional),
}).pipe(
  Command.unlisted,
  Command.withHandler(({ method, sessionId, options }) =>
    Effect.promise(() =>
      runClaudeHistoryWorker(
        method,
        sessionId,
        options._tag === "Some" ? options.value : undefined,
      ),
    ),
  ),
);
