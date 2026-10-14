import type { ProviderDriverKind } from "@t3tools/contracts";

export interface ProviderMaintenanceCapabilities {
  readonly provider: ProviderDriverKind;
  readonly packageName: string | null;
  readonly update: ProviderMaintenanceCommandAction | null;
  /**
   * undefined falls back to packageName's npm registry; null means
   * the owning installer was queried but could not determine a version.
   */
  readonly latestVersion?: string | null;
  /** Compare native release revisions when the provider does not use plain semver. */
  readonly compareVersions?: (current: string, latest: string) => number;
}

export interface ProviderMaintenanceCommandAction {
  readonly command: string;
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly lockKey: string;
  /**
   * Native updaters need the instance's environment to target its custom home
   * instead of silently updating the default install.
   */
  readonly env?: NodeJS.ProcessEnv;
}
