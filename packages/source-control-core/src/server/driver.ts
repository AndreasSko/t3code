/** Register one driver per host; both repository and pull-request registries consume it.
 * make's R channel declares dependencies the server supplies from the package layers. */
import type { SourceControlProviderKind } from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

import type { SourceControlProviderDiscoverySpec } from "./discovery.ts";
import type { PullRequestProviderApi } from "./PullRequestProvider.ts";
import type * as SourceControlProvider from "./SourceControlProvider.ts";

export interface SourceControlDriverInstance {
  readonly sourceControl: SourceControlProvider.SourceControlProvider["Service"];
  readonly discovery: SourceControlProviderDiscoverySpec;
  /** Null for a host whose pull requests this build cannot read. */
  readonly pullRequests: PullRequestProviderApi | null;
}

export interface SourceControlDriver<R = never> {
  readonly kind: SourceControlProviderKind;
  readonly make: Effect.Effect<SourceControlDriverInstance, never, R>;
}

export const defineSourceControlDriver = <R>(
  driver: SourceControlDriver<R>,
): SourceControlDriver<R> => driver;
