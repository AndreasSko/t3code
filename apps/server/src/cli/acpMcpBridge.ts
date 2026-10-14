import * as Effect from "effect/Effect";
import { Argument, Command } from "effect/cli";

import { runAcpMcpCliFastPath } from "../mcp/AcpMcpStdioBridge.ts";

/** ACP credentials stay in environment variables; real calls use bin.ts's fast path.
 * Keep these definitions for CLI help and programmatic invocation. */
export const acpMcpBridgeCommand = Command.make("acp-mcp-bridge").pipe(
  Command.withDescription("Bridge T3 Code's MCP endpoint to stdio for ACP agents."),
  Command.unlisted,
  Command.withHandler(() => Effect.promise(() => runAcpMcpCliFastPath("acp-mcp-bridge", []))),
);

/** Terminal fallback for ACP agents that do not expose injected MCP servers. */
export const acpMcpCallCommand = Command.make("acp-mcp-call", {
  tool: Argument.String("tool"),
  argumentsJson: Argument.String("arguments-json"),
}).pipe(
  Command.withDescription("Call one T3 Code MCP tool from an ACP agent terminal."),
  Command.unlisted,
  Command.withHandler(({ tool, argumentsJson }) =>
    Effect.promise(() => runAcpMcpCliFastPath("acp-mcp-call", [tool, argumentsJson])),
  ),
);
