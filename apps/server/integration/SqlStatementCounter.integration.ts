import * as Tracer from "effect/Tracer";

export interface SqlStatementCounter {
  readonly tracer: Tracer.Tracer;
  /** Statements executed so far. Read before and after a phase and subtract. */
  readonly count: () => number;
}

/** Effect SQL emits one client span named by db.system.name (sqlite) per statement.
 * Share a counter across runtimes so background and request SQL spans share a count. */
export function makeSqlStatementCounter(): SqlStatementCounter {
  let statements = 0;
  const tracer = Tracer.make({
    span: (options) => {
      if (options.kind === "client" && options.name === "sqlite") statements += 1;
      return new Tracer.NativeSpan(options);
    },
  });
  return { tracer, count: () => statements };
}
