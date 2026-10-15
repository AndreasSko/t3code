import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

const { onBeforeSendHeadersMock } = vi.hoisted(() => ({
  onBeforeSendHeadersMock: vi.fn(),
}));

vi.mock("electron", () => ({
  session: { defaultSession: { webRequest: { onBeforeSendHeaders: onBeforeSendHeadersMock } } },
}));

import * as DesktopConnectionHeaders from "./DesktopConnectionHeaders.ts";

describe("DesktopConnectionHeaders", () => {
  it.effect("adds the headers to HTTP and WebSocket requests for that origin only", () =>
    Effect.gen(function* () {
      const connectionHeaders = yield* DesktopConnectionHeaders.DesktopConnectionHeaders;
      yield* connectionHeaders.set("https://t3.example.test/", { "Coder-Session-Token": "abc" });

      const [filter, listener] = onBeforeSendHeadersMock.mock.calls.at(-1)!;
      assert.deepEqual(filter, {
        urls: ["https://t3.example.test/*", "wss://t3.example.test/*"],
      });
      const send = (url: string) => {
        let sent: Record<string, string> = {};
        listener(
          { url, requestHeaders: { Accept: "*/*" } },
          (response: { requestHeaders: Record<string, string> }) => {
            sent = response.requestHeaders;
          },
        );
        return sent;
      };
      assert.deepEqual(send("wss://t3.example.test/ws?wsTicket=1"), {
        Accept: "*/*",
        "Coder-Session-Token": "abc",
      });
      yield* connectionHeaders.set("https://t3.example.test/", { accept: "application/json" });
      assert.deepEqual(send("https://t3.example.test/api"), { accept: "application/json" });
      assert.deepEqual(send("https://t3.example.test.evil.test/"), { Accept: "*/*" });

      yield* connectionHeaders.set("https://t3.example.test/", {});
      assert.deepEqual(onBeforeSendHeadersMock.mock.calls.at(-1), [null]);
    }).pipe(Effect.provide(DesktopConnectionHeaders.layer)),
  );
});
