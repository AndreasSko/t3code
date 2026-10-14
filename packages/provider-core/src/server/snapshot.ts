import type { ProviderUsageLimitsUpdate, ServerProvider } from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";
import type { ProviderMaintenanceCapabilities } from "./maintenance.ts";

export interface ManagedServerProvider {
  /** Use fresh:true before updates so execution never trusts pre-click ownership. */
  readonly resolveMaintenance: (options?: {
    readonly fresh?: boolean;
  }) => Effect.Effect<ProviderMaintenanceCapabilities>;
  readonly getSnapshot: Effect.Effect<ServerProvider>;
  readonly refresh: Effect.Effect<ServerProvider>;
  readonly streamChanges: Stream.Stream<ServerProvider>;
  /** Sparse windows merge by id between probes; no usable window is a no-op. */
  readonly applyUsageLimits: (
    update: ProviderUsageLimitsUpdate & { readonly checkedAt: string },
  ) => Effect.Effect<void>;
}
