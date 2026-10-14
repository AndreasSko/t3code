import {
  RelayClientTracer,
  withLocalTracing,
  withRelayClientTracing,
} from "@t3tools/shared/relayTracing";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";
import { HttpServerRequest, HttpTraceContext } from "effect/http";

/** Export the full handler trace only for T3 Connect connection work. */
export const traceRelayRequest = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => effect.pipe(withRelayClientTracing);

/** Call only after T3 Connect session verification; record auth timing afterwards.
 * Handler work stays local unless it opts into traceRelayRequest. */
export const traceAuthenticatedRelayRequest = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  authentication: { readonly startTime: bigint; readonly endTime: bigint },
): Effect.Effect<A, E, R | HttpServerRequest.HttpServerRequest> =>
  Effect.all([RelayClientTracer, HttpServerRequest.HttpServerRequest]).pipe(
    Effect.flatMap(([tracer, request]): Effect.Effect<A, E, R> => {
      if (Option.isNone(tracer)) return effect;
      const parent = HttpTraceContext.fromHeaders(request.headers);
      const sampled = Option.isNone(parent) || parent.value.sampled;
      const startSpan = (
        name: string,
        kind: Tracer.SpanKind,
        parent: Option.Option<Tracer.AnySpan>,
      ) =>
        tracer.value.span({
          name,
          parent,
          annotations: Context.empty(),
          links: [],
          startTime: authentication.startTime,
          kind,
          root: Option.isNone(parent),
          sampled,
        });
      const span = startSpan("environment.relay.request", "server", parent);
      startSpan("EnvironmentAuth.authenticateHttpRequest", "internal", Option.some(span)).end(
        authentication.endTime,
        Exit.void,
      );
      return effect.pipe(
        Effect.withParentSpan(span),
        Effect.onExit((exit) =>
          Clock.currentTimeNanos.pipe(Effect.map((endTime) => span.end(endTime, exit))),
        ),
        withRelayClientTracing,
      );
    }),
  );

/** Keep handler work local while its relay span records timing and outcome. */
export const traceLocalHandlerWork = withLocalTracing;
