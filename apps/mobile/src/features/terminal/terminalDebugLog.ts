import { createDebugLogger } from "../../lib/debugLog";

/**
 * Enabled by __DEV__; set globalThis.__T3_TERMINAL_DEBUG__ or globalThis.__T3_DEBUG__
 * in a JS debugger or Metro console to trace release/TestFlight builds.
 */
const logger = createDebugLogger("terminal", {
  enabledInDev: true,
  legacyGlobalFlag: "__T3_TERMINAL_DEBUG__",
});

export function terminalDebugLog(message: string, data?: Record<string, unknown>): void {
  logger.log(message, data);
}
