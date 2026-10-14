import * as Context from "effect/Context";
import type * as Stream from "effect/Stream";

import type { PlatformConnectionRegistration } from "../connection/catalog.ts";

export class PlatformConnectionSource extends Context.Service<
  PlatformConnectionSource,
  {
    /** Emits the full platform-managed set so reconciliation handles both additions and removals. */
    readonly registrations: Stream.Stream<ReadonlyArray<PlatformConnectionRegistration>>;
  }
>()("@t3tools/client-runtime/platform/source/PlatformConnectionSource") {}
