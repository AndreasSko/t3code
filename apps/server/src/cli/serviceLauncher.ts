import * as Effect from "effect/Effect";
import { Command } from "effect/cli";

import { main as runServiceLauncher } from "../serviceLauncher.ts";

/** Run outside runMain so SIGTERM waits for child shutdown instead of
 * interrupting the CLI fiber and exiting during termination. */
export const serviceLauncherCommand = Command.make("__service-launcher").pipe(
  Command.unlisted,
  Command.withHandler(() =>
    Effect.sync(() => {
      runServiceLauncher().catch((cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        process.stderr.write(`[service-launcher] ${error.message}\n`);
        process.exitCode = 1;
      });
    }),
  ),
);
