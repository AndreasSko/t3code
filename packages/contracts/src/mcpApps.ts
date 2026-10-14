import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString, TurnItemId } from "./baseSchemas.ts";

// Resolve the app's MCP server from its producing item so it cannot call another server.
const McpAppTarget = {
  threadId: ThreadId,
  itemId: TurnItemId,
};

export const McpAppCallToolInput = Schema.Struct({
  ...McpAppTarget,
  name: TrimmedNonEmptyString,
  arguments: Schema.Record(Schema.String, Schema.Unknown),
});
export type McpAppCallToolInput = typeof McpAppCallToolInput.Type;

/** MCP `CallToolResult`, passed through to the app unchanged. */
export const McpAppCallToolResult = Schema.Struct({
  content: Schema.Array(Schema.Unknown),
  structuredContent: Schema.optional(Schema.Unknown),
  isError: Schema.optional(Schema.Boolean),
  _meta: Schema.optional(Schema.Unknown),
});
export type McpAppCallToolResult = typeof McpAppCallToolResult.Type;

export const McpAppToolInfoInput = Schema.Struct({
  ...McpAppTarget,
  name: TrimmedNonEmptyString,
});
export type McpAppToolInfoInput = typeof McpAppToolInfoInput.Type;

/** Indicates whether an app may call the tool and whether the server declares it read-only. */
export const McpAppToolInfo = Schema.Struct({
  callable: Schema.Boolean,
  readOnly: Schema.Boolean,
  title: Schema.optional(Schema.String),
  /** The server's MCP `Tool` definition, which the host passes to the app as `toolInfo`. */
  tool: Schema.optional(Schema.Unknown),
});
export type McpAppToolInfo = typeof McpAppToolInfo.Type;

export const McpAppReadResourceInput = Schema.Struct({
  ...McpAppTarget,
  uri: TrimmedNonEmptyString,
});
export type McpAppReadResourceInput = typeof McpAppReadResourceInput.Type;

/** MCP `ReadResourceResult`, passed through to the app unchanged. */
export const McpAppReadResourceResult = Schema.Struct({
  contents: Schema.Array(Schema.Unknown),
});
export type McpAppReadResourceResult = typeof McpAppReadResourceResult.Type;

/** Each ui/update-model-context replaces prior context; absent content clears it. */
export const McpAppUpdateModelContextInput = Schema.Struct({
  ...McpAppTarget,
  /** On-screen conversation receives context, including forks showing the app. */
  conversationThreadId: ThreadId,
  content: Schema.optional(Schema.Array(Schema.Unknown)),
  structuredContent: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export type McpAppUpdateModelContextInput = typeof McpAppUpdateModelContextInput.Type;

export const McpAppRequestErrorReason = Schema.Literals([
  "not-an-app",
  "provider-unsupported",
  "session-stopped",
  "tool-not-callable",
  "unsupported-content",
  "request-failed",
]);
export type McpAppRequestErrorReason = typeof McpAppRequestErrorReason.Type;

export class McpAppRequestError extends Schema.TaggedError<McpAppRequestError>()(
  "McpAppRequestError",
  {
    threadId: ThreadId,
    reason: McpAppRequestErrorReason,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "not-an-app":
        return "This tool call has no MCP app.";
      case "provider-unsupported":
        return "This thread's provider cannot run MCP app requests.";
      case "session-stopped":
        // A forked thread shows its source's apps, so this names the thread
        // that made the app rather than the one on screen.
        return "The app's thread is not running. Send a message in the thread that created it to use the app again.";
      case "tool-not-callable":
        return "This app cannot call that tool.";
      case "unsupported-content":
        return "Only text and structured content are supported.";
      case "request-failed":
        return "The app's MCP server request failed.";
    }
  }
}
