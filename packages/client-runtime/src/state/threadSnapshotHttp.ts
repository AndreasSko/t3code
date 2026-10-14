import type { OrchestrationV2ThreadDetailSnapshot, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import type { PreparedConnection } from "../connection/model.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import type { RemoteEnvironmentRequestError } from "../rpc/http.ts";
import {
  executeAuthenticatedEnvironmentHttpRequest,
  withOrchestrationProtocolHeader,
} from "./environmentHttpAuth.ts";

// Short timeouts discard slow snapshot work; HTTP-path failures use socket fallback,
// while older history pages have no fallback and wait for this deadline.
const DEFAULT_THREAD_SNAPSHOT_TIMEOUT_MS = 20_000;

export type ThreadSnapshotHistoryMeta = {
  readonly historyCursor: string | null;
  readonly hasMoreHistory: boolean;
  /** Max local turn ordinal from the full projection; optional on older servers. */
  readonly latestLocalTurnOrdinal?: number | null;
};

/** present seeds socket resume, missing is definitive 404, unavailable uses socket fallback. */
export type ThreadSnapshotLoadResult =
  | {
      readonly _tag: "present";
      readonly snapshot: OrchestrationV2ThreadDetailSnapshot;
      readonly history?: ThreadSnapshotHistoryMeta;
    }
  | { readonly _tag: "missing" }
  | { readonly _tag: "unavailable" };

/** Loads compressible thread snapshots over HTTP to keep large first frames off the socket. */
export const fetchEnvironmentThreadSnapshot = Effect.fn(
  "clientRuntime.state.fetchEnvironmentThreadSnapshot",
)(function* (input: {
  readonly prepared: PreparedConnection;
  readonly threadId: ThreadId;
  readonly signer: Option.Option<ManagedRelay.ManagedRelayDpopSigner["Service"]>;
  readonly remoteAuthorization?: Option.Option<
    RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization["Service"]
  >;
  readonly timeoutMs?: number;
}) {
  return yield* executeAuthenticatedEnvironmentHttpRequest({
    ...input,
    group: "orchestration",
    method: "GET",
    url: (urls) => urls.threadSnapshot({ params: { threadId: input.threadId } }),
    timeoutMs: input.timeoutMs ?? DEFAULT_THREAD_SNAPSHOT_TIMEOUT_MS,
    request: ({ client, headers }) =>
      client.threadSnapshot({
        params: { threadId: input.threadId },
        headers: withOrchestrationProtocolHeader(headers),
      }),
  });
});

export type FetchEnvironmentThreadSnapshotError = RemoteEnvironmentRequestError;

/** Distinguishes definitive missing threads from transient HTTP failures needing socket fallback. */
export class ThreadSnapshotLoader extends Context.Service<
  ThreadSnapshotLoader,
  {
    readonly load: (
      prepared: PreparedConnection,
      threadId: ThreadId,
    ) => Effect.Effect<ThreadSnapshotLoadResult>;
  }
>()("@t3tools/client-runtime/state/threadSnapshotHttp/ThreadSnapshotLoader") {}
