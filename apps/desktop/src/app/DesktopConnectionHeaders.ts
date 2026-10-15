import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";

/**
 * Extra headers for saved connections, such as a token for an access proxy in
 * front of a remote server. The renderer cannot set headers on a WebSocket, so
 * the main process adds them to every request the app sends to that origin.
 */
export class DesktopConnectionHeaders extends Context.Service<
  DesktopConnectionHeaders,
  {
    readonly set: (
      httpBaseUrl: string,
      headers: Readonly<Record<string, string>>,
    ) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/app/DesktopConnectionHeaders") {}

/** The http(s) origin a request belongs to; WebSocket upgrades use ws(s). */
const requestOrigin = (url: string) => {
  const parsed = new URL(url);
  if (parsed.protocol === "wss:") parsed.protocol = "https:";
  if (parsed.protocol === "ws:") parsed.protocol = "http:";
  return parsed.origin;
};

const make = Effect.sync(() => {
  const headersByOrigin = new Map<string, Readonly<Record<string, string>>>();

  const install = () => {
    const { webRequest } = Electron.session.defaultSession;
    if (headersByOrigin.size === 0) {
      webRequest.onBeforeSendHeaders(null);
      return;
    }
    // Filter by origin, so other requests skip the listener. A session has one
    // listener only, so a second onBeforeSendHeaders call would replace this one.
    const urls = [...headersByOrigin.keys()].flatMap((origin) => {
      const { host, protocol } = new URL(origin);
      return [`${protocol}//${host}/*`, `${protocol === "https:" ? "wss" : "ws"}://${host}/*`];
    });
    webRequest.onBeforeSendHeaders({ urls }, (details, callback) => {
      const headers = headersByOrigin.get(requestOrigin(details.url)) ?? {};
      // Header names are case-insensitive, so a saved header replaces any casing of it.
      const names = new Set(Object.keys(headers).map((name) => name.toLowerCase()));
      const kept = Object.entries(details.requestHeaders).filter(
        ([name]) => !names.has(name.toLowerCase()),
      );
      callback({ requestHeaders: { ...Object.fromEntries(kept), ...headers } });
    });
  };

  return DesktopConnectionHeaders.of({
    set: (httpBaseUrl, headers) =>
      Effect.sync(() => {
        const origin = new URL(httpBaseUrl).origin;
        if (Object.keys(headers).length === 0) headersByOrigin.delete(origin);
        else headersByOrigin.set(origin, headers);
        install();
      }).pipe(Effect.withSpan("DesktopConnectionHeaders.set")),
  });
});

export const layer = Layer.effect(DesktopConnectionHeaders, make);
