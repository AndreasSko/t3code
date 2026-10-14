// Preserve managed tunnels when shutdown hands off to a replacement server.
import { DESKTOP_UPDATE_RESTART_MARKER_FILE } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import {
  SERVICE_STATE_FILE,
  SERVICE_STOP_MARKER_FILE,
  serviceStateHasPendingUpdate,
} from "./serviceProtocol.ts";

// The desktop app stops its backends within seconds of writing the marker.
const DESKTOP_UPDATE_RESTART_MARKER_TTL = Duration.minutes(1);

// The launcher owns this durable state, so read it directly both when a trial
// decides whether it owns pre-activation cleanup and while a server tears down.
export const pendingServiceUpdateExists = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runtimeDir = path.join(config.baseDir, "runtime");
  const stateText = yield* fs
    .readFileString(path.join(runtimeDir, SERVICE_STATE_FILE))
    .pipe(Effect.option);
  return Option.isSome(stateText) && serviceStateHasPendingUpdate(stateText.value);
});

// Pending update state alone also covers explicit stops; the launcher stop
// marker distinguishes those from update handoffs.
export const pendingUpdateHandoffExists = Effect.gen(function* () {
  if (!(yield* pendingServiceUpdateExists)) {
    return false;
  }
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runtimeDir = path.join(config.baseDir, "runtime");
  const stopping = yield* fs
    .exists(path.join(runtimeDir, SERVICE_STOP_MARKER_FILE))
    .pipe(Effect.orElseSucceed(() => false));
  return !stopping;
});

// Consume the desktop update marker first during shutdown; only fresh
// markers count so a hard-killed server cannot preserve a tunnel on later quit.
export const desktopUpdateRestartPending = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const markerPath = path.join(config.baseDir, "runtime", DESKTOP_UPDATE_RESTART_MARKER_FILE);
  const marker = yield* fs.stat(markerPath).pipe(Effect.option);
  if (Option.isNone(marker)) {
    return false;
  }
  yield* fs.remove(markerPath).pipe(Effect.ignore);
  const now = yield* Clock.currentTimeMillis;
  return Option.match(marker.value.mtime, {
    onNone: () => false,
    onSome: (writtenAt) =>
      now - writtenAt.getTime() < Duration.toMillis(DESKTOP_UPDATE_RESTART_MARKER_TTL),
  });
});
