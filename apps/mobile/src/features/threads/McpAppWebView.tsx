import type { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";
import {
  makeMcpAppHost,
  McpAppHostRefusal,
  mcpAppStyleVariables,
  mcpResourceBytes,
  type McpAppCallToolResult,
  type McpAppHost,
  type McpAppHostContext,
} from "@t3tools/client-runtime/mcp-apps";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { CommandId, MessageId } from "@t3tools/contracts";
import {
  mcpAppAllowAttribute,
  mcpAppFileName,
  mcpAppReferencesEqual,
  type McpAppReference,
} from "@t3tools/shared/mcpApp";
import * as Predicate from "effect/Predicate";
import Constants from "expo-constants";
import { useNavigation } from "@react-navigation/native";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { AppText as Text } from "../../components/AppText";
import { shareGeneratedAttachment } from "../../lib/attachmentDownload";
import { mobileHtmlRenderTheme } from "../../lib/htmlRenderTheme";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { uuidv4 } from "../../lib/uuid";
import { useAssetUrlState } from "../../state/assets";
import { useThreadShell } from "../../state/entities";
import { mcpAppEnvironment } from "../../state/mcpApps";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { MCP_APP_INLINE_MAX_HEIGHT, mcpAppInlineHeight } from "./mcpAppSizing";

const ROW_BOTTOM_MARGIN = 8;

// The SDK requires real parent/source windows, so host the app in an opaque-origin iframe.
// Android exposes the bridge to every frame: authenticate outer-page relays and stop after app navigation.
// This authenticates the document; it cannot prevent the app from carrying data in a navigation URL.
function outerDocument(src: string, allow: string, secret: string) {
  const attribute = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;height:100%;background:transparent}iframe{border:0;display:block;width:100%;height:100%}</style></head>
<body><iframe id="app" sandbox="allow-scripts allow-forms" allow="${attribute(allow)}"></iframe>
<script>(function(){var frame=document.getElementById("app"),secret=${JSON.stringify(secret)},loads=0,live=true;
var send=function(m){window.ReactNativeWebView.postMessage(JSON.stringify({secret:secret,message:m}));};
frame.addEventListener("load",function(){loads+=1;if(loads>1&&live){live=false;send({t3:"navigated"});}});
window.addEventListener("message",function(e){if(live&&e.source===frame.contentWindow)send(e.data);});
window.__t3McpAppReceive=function(m){live&&frame.contentWindow&&frame.contentWindow.postMessage(m,"*");};
frame.src=${JSON.stringify(src).replace(/</g, "\\u003c")};})();</script></body></html>`;
}

const commandFailure = (result: {
  readonly cause: Parameters<typeof squashAtomCommandFailure>[0]["cause"];
}) => {
  const error = squashAtomCommandFailure(result);
  return new McpAppHostRefusal(
    error instanceof Error && error.message.trim() !== "" ? error.message : "Request failed.",
  );
};

const confirm = (title: string, message: string, action: string) =>
  new Promise<boolean>((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: action, onPress: () => resolve(true) },
      ],
      // Android dismisses an earlier alert when another opens; release its pending request slot.
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });

/** Largest file an app may hand the user through `ui/download-file`. */
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

/** Inline and fullscreen require separate WebViews, so switching tears down the inline document. */
export function ThreadMcpApp(props: {
  readonly environmentId: EnvironmentId;
  /** The thread that produced the app, which its requests run against. */
  readonly threadId: ThreadId;
  /** The thread on screen, which approved app messages are sent to. */
  readonly conversationThreadId: ThreadId;
  readonly itemId: TurnItemId;
  readonly revision: string;
  readonly app: McpAppReference;
  readonly width: number;
  readonly displayMode?: "inline" | "fullscreen";
  readonly onExitFullscreen?: () => void;
  /** Full screen only: the screen's height, which the app is told it fills. */
  readonly height?: number;
}) {
  // One reference per app: a new object with the same content (a refetch, a
  // rerender) must not rebuild the host of a document that is already live.
  const [height, setHeight] = useState(MCP_APP_INLINE_MAX_HEIGHT);
  const [app, setApp] = useState(props.app);
  if (!mcpAppReferencesEqual(app, props.app)) {
    setApp(props.app);
    setHeight(MCP_APP_INLINE_MAX_HEIGHT);
  }
  const fullscreen = props.displayMode === "fullscreen";
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [closed, setClosed] = useState(false);
  const [presentedFullscreen, setPresentedFullscreen] = useState(false);
  // Reopened documents need a fresh WebView and host.
  const [documentKey, setDocumentKeyState] = useState(0);

  const { themeId, themeAppearance, themeVariables, systemColorsActive } =
    useAppearancePreferences();
  const theme = useMemo(
    () =>
      mobileHtmlRenderTheme({
        themeId,
        appearance: themeAppearance,
        variables: themeVariables,
        systemColors: systemColorsActive,
        platform: Platform.OS,
      }),
    [themeId, themeAppearance, themeVariables, systemColorsActive],
  );
  const resource = useMemo(
    () => ({
      _tag: "attachment" as const,
      attachmentId: app.attachmentId,
      fileName: mcpAppFileName(app),
      mimeType: "text/html",
      disposition: "inline" as const,
      renderIntent: "mcp-app" as const,
    }),
    [app],
  );
  const asset = useAssetUrlState(props.environmentId, resource);
  // The view keeps its first URL: a re-minted one would reload the app.
  const [uri, setUri] = useState<string | null>(null);
  if (uri === null && asset._tag === "Success") setUri(asset.url);
  const [loaded, setLoaded] = useState(false);
  const [navigatedAway, setNavigatedAway] = useState(false);
  // Reclaimed web processes need fresh initialization and replay; retry only once to avoid crash loops.
  const [generation, setGeneration] = useState(0);
  const [crashed, setCrashed] = useState(false);
  const restart = () => {
    if (generation > 0) {
      setCrashed(true);
      return;
    }
    setLoaded(false);
    setHeight(MCP_APP_INLINE_MAX_HEIGHT);
    // The initial token may have expired; use the asset query's refreshed URL.
    if (asset._tag === "Success") setUri(asset.url);
    setGeneration(1);
  };
  // Minted per view, so only this view's outer page can speak for its app.
  const [secret] = useState(uuidv4);
  // Reopened documents use the refreshed URL because the first token may have expired.
  const setDocumentKey = (next: (value: number) => number) => {
    setLoaded(false);
    setHeight(MCP_APP_INLINE_MAX_HEIGHT);
    setNavigatedAway(false);
    if (asset._tag === "Success") setUri(asset.url);
    setDocumentKeyState(next);
  };
  // The focus listener needs the latest helper and refreshed asset URL.
  const openNewDocument = useRef(setDocumentKey);
  useEffect(() => {
    openNewDocument.current = setDocumentKey;
  });
  useEffect(() => {
    if (!presentedFullscreen) return;
    return navigation.addListener("focus", () => {
      openNewDocument.current((value) => value + 1);
      setPresentedFullscreen(false);
    });
  }, [navigation, presentedFullscreen]);

  // The feed omits tool input and output; the app needs both.
  const detail = useEnvironmentQuery(
    orchestrationEnvironment.turnItem({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, itemId: props.itemId, revision: props.revision },
    }),
  );
  const storedItem = detail.data?.item;
  const toolCall = useMemo(() => {
    if (storedItem?.type !== "dynamic_tool") return undefined;
    const output = storedItem.output as { readonly result?: unknown } | undefined;
    return {
      arguments: storedItem.input,
      result: output?.result as McpAppCallToolResult | undefined,
    };
  }, [storedItem]);

  const callTool = useAtomCommand(mcpAppEnvironment.callTool, { reportFailure: false });
  const toolInfo = useAtomCommand(mcpAppEnvironment.toolInfo, { reportFailure: false });
  const readResource = useAtomCommand(mcpAppEnvironment.readResource, { reportFailure: false });
  const updateModelContext = useAtomCommand(mcpAppEnvironment.updateModelContext, {
    reportFailure: false,
  });
  const [toolDefinition, setToolDefinition] = useState<unknown>(undefined);
  // Read current context without rebuilding the host and dropping the app session.
  // A fullscreen app must step aside for this conversation's pending approval or question.
  const conversation = useThreadShell(
    scopeThreadRef(props.environmentId, props.conversationThreadId),
  );
  const awaitingUser =
    conversation?.hasPendingApprovals === true || conversation?.hasPendingUserInput === true;
  const live = {
    awaitingUser,
    theme,
    props,
    callTool,
    toolInfo,
    readResource,
    updateModelContext,
    insets,
    toolDefinition,
    navigation,
  };
  const latest = useRef(live);
  useEffect(() => {
    latest.current = live;
  });
  useEffect(() => {
    let cancelled = false;
    void latest.current
      .toolInfo({
        environmentId: props.environmentId,
        input: { threadId: props.threadId, itemId: props.itemId, name: app.tool },
      })
      .then((info) => {
        if (!cancelled && info._tag === "Success" && info.value.tool !== undefined) {
          setToolDefinition(info.value.tool);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.environmentId, props.threadId, props.itemId, app.tool]);
  const webView = useRef<WebView<object>>(null);
  const hostRef = useRef<McpAppHost | null>(null);

  useEffect(() => {
    if (uri === null) return;
    const scope = () => {
      const { environmentId, threadId, itemId } = latest.current.props;
      return { environmentId, input: { threadId, itemId } };
    };
    const hostContext = (): McpAppHostContext => {
      const current = latest.current;
      const isFullscreen = current.props.displayMode === "fullscreen";
      return {
        theme: current.theme.appearance,
        styles: { variables: mcpAppStyleVariables(current.theme.variables) },
        displayMode: isFullscreen ? "fullscreen" : "inline",
        availableDisplayModes: ["inline", "fullscreen"],
        containerDimensions: isFullscreen
          ? {
              width: current.props.width,
              height: current.props.height ?? MCP_APP_INLINE_MAX_HEIGHT,
            }
          : { width: current.props.width, maxHeight: MCP_APP_INLINE_MAX_HEIGHT },
        platform: "mobile",
        locale: Intl.DateTimeFormat().resolvedOptions().locale,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        userAgent: `t3-code/${Constants.expoConfig?.version ?? "0.0.0"}`,
        deviceCapabilities: { touch: true, hover: false },
        // The modal reserves top/bottom insets for its header and home indicator.
        safeAreaInsets: isFullscreen
          ? { top: 0, right: current.insets.right, bottom: 0, left: current.insets.left }
          : { top: 0, right: 0, bottom: 0, left: 0 },
        ...(current.toolDefinition === undefined
          ? {}
          : { toolInfo: { tool: current.toolDefinition } }),
      };
    };
    const next = makeMcpAppHost({
      app,
      hostVersion: Constants.expoConfig?.version ?? "0.0.0",
      post: (message) =>
        webView.current?.injectJavaScript(
          `window.__t3McpAppReceive&&window.__t3McpAppReceive(${JSON.stringify(message)});true;`,
        ),
      hostContext,
      callTool: async ({ name, arguments: args }) => {
        const { environmentId, input } = scope();
        const info = await latest.current.toolInfo({ environmentId, input: { ...input, name } });
        if (info._tag !== "Success") throw commandFailure(info);
        if (!info.value.callable) throw new McpAppHostRefusal("This app cannot call that tool.");
        if (
          !info.value.readOnly &&
          !(await confirm(
            `Allow ${app.server} to run ${info.value.title ?? name}?`,
            JSON.stringify(args, null, 2),
            "Allow",
          ))
        ) {
          throw new McpAppHostRefusal("Declined by the user.");
        }
        const result = await latest.current.callTool({
          environmentId,
          input: { ...input, name, arguments: args },
        });
        if (result._tag !== "Success") throw commandFailure(result);
        return result.value;
      },
      readResource: async ({ uri: resourceUri }) => {
        const { environmentId, input } = scope();
        const result = await latest.current.readResource({
          environmentId,
          input: { ...input, uri: resourceUri },
        });
        if (result._tag !== "Success") throw commandFailure(result);
        return result.value;
      },
      openLink: async (url) => {
        // WebViews cannot verify a user tap, so ask before opening external links.
        if (!(await confirm(`Open a link from ${app.server}?`, url, "Open"))) {
          throw new McpAppHostRefusal("Declined by the user.");
        }
        if (!(await tryOpenExternalUrl(url, "mcp-app"))) {
          throw new McpAppHostRefusal("The link could not be opened.");
        }
      },
      sendMessage: async (text) => {
        if (!(await confirm(`Send this message from ${app.server}?`, text, "Send"))) {
          throw new McpAppHostRefusal("Declined by the user.");
        }
        // The outbox survives dropped connections and uses thread settings when the message sends.
        await enqueueThreadOutboxMessage({
          environmentId: latest.current.props.environmentId,
          threadId: latest.current.props.conversationThreadId,
          messageId: MessageId.make(uuidv4()),
          commandId: CommandId.make(uuidv4()),
          text,
          attachments: [],
          dispatchMode: "queue",
          createdAt: new Date().toISOString(),
        });
      },
      updateModelContext: async (context) => {
        const { environmentId, input } = scope();
        const result = await latest.current.updateModelContext({
          environmentId,
          input: {
            ...input,
            ...context,
            conversationThreadId: latest.current.props.conversationThreadId,
          },
        });
        if (result._tag !== "Success") throw commandFailure(result);
      },
      requestDisplayMode: async (mode) => {
        const current = latest.current.props;
        // Full screen would cover the approval or question the agent waits
        // on, or a screen the user moved to.
        if (
          mode === "fullscreen" &&
          (latest.current.awaitingUser || !latest.current.navigation.isFocused())
        ) {
          return current.displayMode ?? "inline";
        }
        if (mode === "fullscreen" && current.displayMode !== "fullscreen") {
          // Finish inline teardown before opening the separate fullscreen document.
          await hostRef.current?.teardown();
          // Recheck after teardown: an approval or navigation change may have arrived while awaiting it.
          if (latest.current.awaitingUser || !latest.current.navigation.isFocused()) {
            openNewDocument.current((value) => value + 1);
            return "inline";
          }
          setPresentedFullscreen(true);
          latest.current.navigation.navigate("ThreadMcpApp", {
            environmentId: String(current.environmentId),
            threadId: String(current.threadId),
            conversationThreadId: String(current.conversationThreadId),
            itemId: String(current.itemId),
            revision: current.revision,
          });
          return "fullscreen";
        }
        if (mode === "inline" && current.displayMode === "fullscreen") {
          await hostRef.current?.teardown();
          current.onExitFullscreen?.();
          return "inline";
        }
        return current.displayMode ?? "inline";
      },
      downloadFile: async (files) => {
        const names = files.map((file) => file.name).join(", ");
        if (!(await confirm(`Save a file from ${app.server}?`, names, "Save"))) {
          throw new McpAppHostRefusal("Declined by the user.");
        }
        for (const file of files) {
          let bytes: Uint8Array | undefined;
          let mimeType = file.mimeType ?? "application/octet-stream";
          if (file._tag === "embedded") {
            bytes = file.bytes;
          } else {
            const { environmentId, input } = scope();
            const read = await latest.current.readResource({
              environmentId,
              input: { ...input, uri: file.uri },
            });
            if (read._tag !== "Success") throw commandFailure(read);
            const content = read.value.contents[0];
            bytes = mcpResourceBytes(content);
            const declared = (content as { readonly mimeType?: unknown } | undefined)?.mimeType;
            if (typeof declared === "string") mimeType = declared;
          }
          if (bytes === undefined) throw new McpAppHostRefusal(`${file.name} has no contents.`);
          if (bytes.byteLength > MAX_DOWNLOAD_BYTES) {
            throw new McpAppHostRefusal(`${file.name} is too large to save.`);
          }
          const shared = await shareGeneratedAttachment({
            bytes,
            attachment: { name: file.name, mimeType },
            signal: new AbortController().signal,
          });
          if (!shared) throw new McpAppHostRefusal("Sharing is not available on this device.");
        }
      },
      onRequestTeardown: () => {
        const current = latest.current.props;
        if (current.displayMode === "fullscreen") {
          void hostRef.current?.teardown().then(() => current.onExitFullscreen?.());
        } else {
          void hostRef.current?.teardown().then(() => setClosed(true));
        }
      },
      onSizeChanged: (size) => {
        if (latest.current.props.displayMode === "fullscreen") return;
        const nextHeight = mcpAppInlineHeight(size.height);
        if (nextHeight !== undefined) setHeight(nextHeight);
      },
    });
    hostRef.current = next;
    return () => {
      // An unmount cannot wait: the request goes out before the view does.
      void next.teardown();
      hostRef.current = null;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A restarted view needs a new host.
  }, [uri, app, generation, documentKey]);

  // The host reads the context through `latest`; these only say when to resend.
  useEffect(() => {
    hostRef.current?.updateHostContext();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Context changes trigger a resend.
  }, [theme, props.width, props.height, insets, toolDefinition]);
  useEffect(() => {
    if (toolCall !== undefined) hostRef.current?.setToolCall(toolCall);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Each new document needs the call.
  }, [toolCall, uri, generation, documentKey]);

  const source = useMemo(
    () =>
      uri === null
        ? null
        : { html: outerDocument(uri, mcpAppAllowAttribute(app.permissions), secret) },
    [uri, app.permissions, secret],
  );

  if (presentedFullscreen) {
    return (
      <View
        style={{ height, marginBottom: ROW_BOTTOM_MARGIN }}
        className="items-center justify-center rounded-lg border border-border"
      >
        <Text className="text-sm text-foreground-muted">
          The {app.server} app is open full screen
        </Text>
      </View>
    );
  }

  if (closed) {
    return (
      <View
        style={{ height, marginBottom: ROW_BOTTOM_MARGIN }}
        className="items-center justify-center gap-2 rounded-lg border border-border"
      >
        <Text className="text-sm text-foreground-muted">The {app.server} app was closed</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setDocumentKey((value) => value + 1);
            setClosed(false);
          }}
        >
          <Text className="text-sm text-foreground">Show app</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={fullscreen ? { flex: 1 } : { height, marginBottom: ROW_BOTTOM_MARGIN }}>
      {navigatedAway ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-sm text-foreground-muted">
            The {app.server} app left its page and was stopped
          </Text>
        </View>
      ) : uri !== null && !crashed ? (
        <WebView<object>
          key={`${documentKey}:${generation}`}
          ref={webView}
          onContentProcessDidTerminate={restart}
          onRenderProcessGone={restart}
          source={source!}
          accessibilityLabel={`${app.server} app`}
          style={{ flex: 1, backgroundColor: "transparent" }}
          nestedScrollEnabled
          originWhitelist={["*"]}
          // Android labels nested-frame navigations as top-frame; rely on the iframe sandbox there.
          // On iOS, allow only the outer page at the top; app links use the bridge.
          onShouldStartLoadWithRequest={(request) =>
            Platform.OS === "android" ||
            request.isTopFrame === false ||
            request.url === "about:blank"
          }
          setSupportMultipleWindows={false}
          onLoadEnd={() => setLoaded(true)}
          // These errors concern the outer view, so render a failure instead of a blank box.
          onError={() => setCrashed(true)}
          onHttpError={() => setCrashed(true)}
          onMessage={(event: WebViewMessageEvent) => {
            let envelope: unknown;
            try {
              envelope = JSON.parse(event.nativeEvent.data);
            } catch {
              return;
            }
            if (!Predicate.isObject(envelope) || envelope.secret !== secret) return;
            const message = envelope.message;
            if (Predicate.isObject(message) && message.t3 === "navigated") {
              hostRef.current?.dispose();
              setNavigatedAway(true);
              return;
            }
            hostRef.current?.receive(message);
          }}
        />
      ) : asset._tag === "Failure" || crashed ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-sm text-foreground-muted">Unable to load the {app.server} app</Text>
        </View>
      ) : null}
      {uri !== null && !loaded && !crashed && !navigatedAway ? (
        <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : null}
    </View>
  );
}
