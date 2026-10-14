import * as Schema from "effect/Schema";

import { PortSchema, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

// A supervisor must not restart a server refused by the state-directory owner.
export const SERVER_EXIT_CODE_STATE_DIR_OWNED = 78;

export const DesktopBackendBootstrap = Schema.Struct({
  mode: Schema.Literal("desktop"),
  noBrowser: Schema.Boolean,
  port: PortSchema,
  // WSL uses its Linux home, not the Windows baseDir mapped under /mnt/c.
  t3Home: Schema.optional(Schema.String),
  host: Schema.String,
  desktopBootstrapToken: Schema.String,
  // This secret derives rotating bootstrap tokens instead of trusting the startup token forever;
  // see @t3tools/shared/desktopBootstrapToken.
  desktopBootstrapSecret: Schema.optionalKey(Schema.String),
  // Absent means the backend hydrates PATH; WSL and older desktops depend on this.
  shellEnvironmentPrepared: Schema.optionalKey(Schema.Boolean),
  tailscaleServeEnabled: Schema.Boolean,
  tailscaleServePort: PortSchema,
  otlpTracesUrl: Schema.optional(Schema.String),
  otlpMetricsUrl: Schema.optional(Schema.String),
  otlpLogsUrl: Schema.optional(Schema.String),
  desktopTelemetryFd: Schema.optionalKey(PositiveInt),
  desktopTelemetryControlFd: Schema.optionalKey(PositiveInt),
  /** Desktop -> server: the desktop's browser tabs, as newline-delimited JSON. */
  desktopBrowserFd: Schema.optionalKey(PositiveInt),
  /** Server -> desktop: commands for those tabs. */
  desktopBrowserControlFd: Schema.optionalKey(PositiveInt),
  resourceMonitorPath: Schema.optionalKey(TrimmedNonEmptyString),
});

export type DesktopBackendBootstrap = typeof DesktopBackendBootstrap.Type;

/** A fresh shutdown marker in t3Home/runtime preserves managed tunnels through a desktop update restart. */
export const DESKTOP_UPDATE_RESTART_MARKER_FILE = "desktop-update-restart";
