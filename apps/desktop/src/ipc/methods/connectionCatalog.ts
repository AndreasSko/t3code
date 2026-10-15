import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopConnectionCatalogStore from "../../app/DesktopConnectionCatalogStore.ts";
import * as DesktopConnectionHeaders from "../../app/DesktopConnectionHeaders.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const getConnectionCatalog = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_CONNECTION_CATALOG_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.connectionCatalog.get")(function* () {
    const store = yield* DesktopConnectionCatalogStore.DesktopConnectionCatalogStore;
    return Option.getOrNull(yield* store.get);
  }),
});

export const setConnectionCatalog = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_CONNECTION_CATALOG_CHANNEL,
  payload: Schema.String,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.connectionCatalog.set")(function* (catalog) {
    const store = yield* DesktopConnectionCatalogStore.DesktopConnectionCatalogStore;
    return yield* store.set(catalog);
  }),
});

export const clearConnectionCatalog = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CLEAR_CONNECTION_CATALOG_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.connectionCatalog.clear")(function* () {
    const store = yield* DesktopConnectionCatalogStore.DesktopConnectionCatalogStore;
    yield* store.clear;
  }),
});

export const setConnectionHeaders = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_CONNECTION_HEADERS_CHANNEL,
  payload: Schema.Struct({
    httpBaseUrl: Schema.String,
    headers: Schema.Record(Schema.String, Schema.String),
  }),
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.connectionCatalog.setHeaders")(function* (input) {
    const connectionHeaders = yield* DesktopConnectionHeaders.DesktopConnectionHeaders;
    yield* connectionHeaders.set(input.httpBaseUrl, input.headers);
  }),
});
