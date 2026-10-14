import { useAtomMount } from "@effect/atom-react";

import { runningThreadKeepAliveAtom } from "../../state/threads";

/** Mount running-thread subscriptions without reading updates to avoid rerenders
 * and replay or sync flashes when opening a thread. */
export function RunningThreadKeepAlive() {
  useAtomMount(runningThreadKeepAliveAtom);
  return null;
}
