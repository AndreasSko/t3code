import * as NodeModule from "node:module";
import * as Effect from "effect/Effect";

// Windows force-kills desktop backends, so flush enabled compile caches
// after startup rather than relying on exit.
export const flushCompileCache = Effect.try(() => NodeModule.flushCompileCache()).pipe(
  Effect.ignore,
);
