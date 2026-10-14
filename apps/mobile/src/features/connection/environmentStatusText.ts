import {
  connectionStatusText,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";

/**
 * Mobile has no tooltip, so compatibility details must say whether to update the app or host.
 */
export function environmentStatusText(connection: EnvironmentConnectionPresentation): string {
  return connection.phase === "unsupported" && connection.error !== null
    ? connection.error
    : connectionStatusText(connection);
}
