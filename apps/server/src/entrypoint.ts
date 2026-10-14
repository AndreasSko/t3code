// @effect-diagnostics nodeBuiltinImport:off
// Entrypoint detection runs before any Effect runtime is built, so it stays on
// Node built-ins.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";

/** Node 22.16, 22.17, and 23.11 lack import.meta.main; fall back to entry path comparison. */
export const isEntrypoint = (input: {
  readonly moduleUrl: string;
  readonly entryPath: string | undefined;
  readonly runtimeMain: boolean | undefined;
}): boolean => {
  if (input.runtimeMain !== undefined) {
    return input.runtimeMain;
  }
  if (input.entryPath === undefined || input.entryPath === "") {
    return false;
  }
  if (input.moduleUrl === NodeURL.pathToFileURL(input.entryPath).href) {
    return true;
  }
  // npm/npx launcher symlinks remain in argv while module URLs use real paths.
  try {
    return input.moduleUrl === NodeURL.pathToFileURL(NodeFS.realpathSync(input.entryPath)).href;
  } catch {
    return false;
  }
};
