import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as ErrorReporter from "effect/ErrorReporter";

// Typed RPC failures are expected responses; log only defects.
const reporter: ErrorReporter.ErrorReporter = {
  [ErrorReporter.TypeId]: ErrorReporter.TypeId,
  report: ({ cause, fiber }) => {
    for (const reason of cause.reasons) {
      if (reason._tag !== "Die" || ErrorReporter.isIgnored(reason.defect)) continue;
      // Preserve the failing fiber's logger context; fork so reporting cannot
      // throw back into the server.
      Effect.runForkWith(fiber.context)(
        Effect.logError("Unhandled defect", Cause.fromReasons([reason])),
      );
    }
  },
};

export const layer = ErrorReporter.layer([reporter]);
