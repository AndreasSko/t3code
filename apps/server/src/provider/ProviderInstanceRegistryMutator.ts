/** Kept separate from the public registry so downstream consumers can only read it. */
import type { ProviderInstanceConfigMap } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface ProviderInstanceRegistryMutatorShape {
  /** Unchanged maps cause no scope churn or change events; driver failures become shadows so settings watchers survive. */
  readonly reconcile: (configMap: ProviderInstanceConfigMap) => Effect.Effect<void>;
}

export class ProviderInstanceRegistryMutator extends Context.Service<
  ProviderInstanceRegistryMutator,
  ProviderInstanceRegistryMutatorShape
>()("t3/provider/ProviderInstanceRegistryMutator") {}
