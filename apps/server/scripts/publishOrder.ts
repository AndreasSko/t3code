import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

/** Publish platforms before the launcher so its executables exist.
 * Let all uploads finish on failure: npm cannot retry a version that may already be live. */
export const publishPlatformsThenLauncher = <E, R>(input: {
  readonly platformTarballs: ReadonlyArray<string>;
  readonly launcherTarball: string;
  readonly publish: (tarball: string) => Effect.Effect<void, E, R>;
}) =>
  Effect.gen(function* () {
    const results = yield* Effect.all(input.platformTarballs.map(input.publish), {
      concurrency: "unbounded",
      mode: "result",
    });
    const failed = results.find(Result.isFailure);
    if (failed) {
      return yield* Effect.fail(failed.failure);
    }
    yield* input.publish(input.launcherTarball);
  });
