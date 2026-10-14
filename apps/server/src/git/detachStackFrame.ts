import * as Effect from "effect/Effect";
import * as References from "effect/References";

const snapshotStack = (
  frame: References.StackFrame | undefined,
): References.StackFrame | undefined => {
  if (frame === undefined) return undefined;
  const stack = frame.stack();
  return { name: frame.name, stack: () => stack, parent: snapshotStack(frame.parent) };
};

/** Materialize the lookup fiber's stack so a lazy caller frame cannot retain request snapshots for the TTL. */
export const detachStackFrame = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const frame = snapshotStack(yield* References.CurrentStackFrame);
    return yield* Effect.provideService(effect, References.CurrentStackFrame, frame);
  });
