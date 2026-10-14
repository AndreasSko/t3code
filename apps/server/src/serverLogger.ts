import * as SharedObservability from "@t3tools/shared/observability";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as References from "effect/References";
import * as OtlpExporter from "effect/observability/OtlpExporter";
import * as OtlpLogger from "effect/observability/OtlpLogger";

import * as ServerConfig from "./config.ts";

export const layer = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const layerMinimumLogLevel = Layer.succeed(References.MinimumLogLevel, config.logLevel);

  const logs = config.otlpLogsExport;
  const otlpLogger =
    config.otlpLogsUrl === undefined
      ? undefined
      : OtlpLogger.make({
          url: config.otlpLogsUrl,
          exportInterval: `${logs.exportIntervalMs} millis`,
          headers: logs.headers,
          resource: ServerConfig.otlpResource(config),
        });

  // Logger.layer replaces the logger set; name every destination here.
  // OTLP logs supersede tracerLogger's span events, which would export in-span messages twice.
  // https://opentelemetry.io/blog/2026/deprecating-span-events/
  const layerLogger = Logger.layer(
    otlpLogger === undefined
      ? [Logger.consolePretty(), Logger.tracerLogger]
      : [Logger.consolePretty(), otlpLogger],
    { mergeWithExisting: false },
  ).pipe(
    Layer.provide(OtlpExporter.layerFlusher),
    Layer.provide(SharedObservability.layerOtlpSerialization(logs.protocol)),
  );

  return Layer.mergeAll(layerLogger, layerMinimumLogLevel);
}).pipe(Layer.unwrap);
