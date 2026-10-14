// @effect-diagnostics nodeBuiltinImport:off - runs once at test setup, outside any Effect runtime.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as HostProcess from "../HostProcess.ts";

// Windows CI exposes an 8.3 temp path, but git/realpath return its long form.
// Node reads TEMP/TMP on each os.tmpdir() call, so resolving them prevents path mismatches.
if (HostProcess.Platform.defaultValue() === "win32") {
  try {
    const longForm = NodeFS.realpathSync.native(NodeOS.tmpdir());
    process.env.TEMP = longForm;
    process.env.TMP = longForm;
  } catch {
    // Leave the host's value alone if it cannot be resolved.
  }
}
