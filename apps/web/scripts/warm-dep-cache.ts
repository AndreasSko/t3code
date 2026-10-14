// @effect-diagnostics nodeBuiltinImport:off - setup-script bootstrap, runs before any Effect runtime exists.
/** Vite hashes the absolute root, so each worktree needs its own dependency cache to avoid a slow first load. */
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { optimizeDeps, resolveConfig } from "vite";

const webRoot = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));

// logLevel "error" silences the "manually calling optimizeDeps is deprecated"
// warning — deliberate here: warming ahead of the server is the whole point.
const config = await resolveConfig({ root: webRoot, logLevel: "error" }, "serve");
await optimizeDeps(config);
console.log("[warm-dep-cache] web dependency cache is warm");
