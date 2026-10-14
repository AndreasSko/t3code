import type { ProviderDriverKind, ProviderInstanceId, ServerProvider } from "@t3tools/contracts";
import type * as Stream from "effect/Stream";
import type { ManagedServerProvider } from "@t3tools/provider-core/server/snapshot";

export type ProviderSnapshotSource = {
  /** Routing is instance-scoped because several instances may share one driver kind. */
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly getSnapshot: ManagedServerProvider["getSnapshot"];
  readonly refresh: ManagedServerProvider["refresh"];
  readonly streamChanges: Stream.Stream<ServerProvider>;
};
