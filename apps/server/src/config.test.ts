import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as ServerConfig from "./config.ts";

describe("otlpResource", () => {
  it.effect("names the host, unless OTEL_RESOURCE_ATTRIBUTES already does", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;

      assert.equal(ServerConfig.otlpResource(config, "box-1").attributes["host.name"], "box-1");

      const configured = {
        ...config,
        otelEnvironment: {
          ...config.otelEnvironment,
          resourceAttributes: { "host.name": "from-env" },
        },
      };
      assert.equal(
        ServerConfig.otlpResource(configured, "box-1").attributes["host.name"],
        "from-env",
      );
    }).pipe(
      Effect.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-otlp-resource-" })),
      Effect.provide(NodeServices.layer),
    ),
  );
});
