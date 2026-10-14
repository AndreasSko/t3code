import type { DesktopEnvironmentBootstrap } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { readDesktopSecondaryBootstraps } from "./desktopLocal";

const DESKTOP_LOCAL_BOOTSTRAP_POLL_MS = 2_000;

/**
 * Poll because the bridge has no change event; failures retain the snapshot and successful empty reads
 * clear it.
 */
export function useDesktopLocalBootstraps(): ReadonlyArray<DesktopEnvironmentBootstrap> {
  const [bootstraps, setBootstraps] = useState<ReadonlyArray<DesktopEnvironmentBootstrap>>(
    readDesktopSecondaryBootstraps,
  );

  useEffect(() => {
    const read = () => setBootstraps(readDesktopSecondaryBootstraps());
    read();
    const interval = setInterval(read, DESKTOP_LOCAL_BOOTSTRAP_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  return bootstraps;
}
