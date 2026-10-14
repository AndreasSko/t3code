import { useAtomValue } from "@effect/atom-react";
import {
  type KeybindingCommand,
  type KeybindingShortcut,
  MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
  type ScopedThreadRef,
  THREAD_JUMP_KEYBINDING_COMMANDS,
} from "@t3tools/contracts";
import {
  type HtmlRenderShortcut,
  htmlRenderShortcutsMessage,
  htmlRenderThemeFragment,
  htmlRenderThemeMessage,
  htmlRenderResult,
  readHtmlRenderContentHeight,
  readHtmlRenderKeyDown,
  readHtmlRenderLinkRequest,
} from "@t3tools/shared/htmlRender";
import {
  isMacPlatform,
  matchesKeybindingShortcut,
  normalizeEventKey,
} from "@t3tools/shared/keybindings";
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useOpenLink } from "~/browser/useOpenLink";
import { useHtmlRenderTheme } from "~/hooks/useHtmlRenderTheme";
import { shortcutConflictKey } from "~/keybindings";
import { useOpenChangeRequestLink } from "~/lib/openPullRequestLink";
import { readLocalApi } from "~/localApi";
import { cn } from "~/lib/utils";
import { primaryServerKeybindingsAtom, serverEnvironment } from "~/state/server";

/** Hide Chromium PDF chrome and fit width; the panel supplies its own header. */
const PDF_VIEWER_FRAGMENT = "#toolbar=0&view=FitH";

/** Pages can forge key reports; allow only view commands, never thread mutations. */
const HTML_RENDER_SHORTCUT_COMMANDS: ReadonlySet<KeybindingCommand> = new Set([
  "commandPalette.toggle",
  "filePicker.toggle",
  "projectSearch.toggle",
  "chat.find",
  "sidebar.toggle",
  "rightPanel.toggle",
  "rightPanel.toggleMaximized",
  "threadPanel.toggle",
  "terminal.toggle",
  "preview.toggle",
  "navigation.back",
  "navigation.forward",
  "thread.previous",
  "thread.next",
  ...THREAD_JUMP_KEYBINDING_COMMANDS,
  // Share Cmd/Ctrl+digit with thread jumps, and act only while the picker is open.
  ...MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
]);

export const isPdfPreviewFile = (path: string): boolean =>
  /\.pdf$/i.test(path.split(/[?#]/, 1)[0] ?? "");

/** HTML needs an opaque sandbox origin to isolate app sessions and storage.
 * The script-free built-in PDF viewer requires an unsandboxed frame. */
export function BrowserDocumentFrame(props: {
  readonly src: string;
  readonly title: string;
  readonly pdf: boolean;
  readonly htmlRender?: boolean;
  /** The thread an HTML render's links open beside. */
  readonly threadRef?: ScopedThreadRef | undefined;
}) {
  const className = "min-h-0 flex-1 border-0 bg-white";
  return props.pdf ? (
    // oxlint-disable-next-line react/iframe-missing-sandbox -- the built-in PDF viewer needs an unsandboxed frame.
    <iframe
      key={props.src}
      src={`${props.src}${PDF_VIEWER_FRAGMENT}`}
      title={props.title}
      className={className}
    />
  ) : props.htmlRender ? (
    <HtmlRenderDocument
      key={props.src}
      src={props.src}
      title={props.title}
      threadRef={props.threadRef}
      className="min-h-0 flex-1"
    />
  ) : (
    <iframe
      key={props.src}
      src={props.src}
      title={props.title}
      className={className}
      sandbox="allow-scripts allow-forms allow-popups allow-downloads"
    />
  );
}

/** Bootstrap the theme before first paint and retain the initial src so
 * refreshing signed asset URLs cannot reload the page. */
export function HtmlRenderDocument(props: {
  readonly src: string;
  readonly title: string;
  readonly className?: string;
  /** The thread the page's links open beside, as a chat link would. */
  readonly threadRef?: ScopedThreadRef | undefined;
  /** Receives the page's content height whenever it changes, so an inline frame can fit it. */
  readonly onContentHeight?: (height: number) => void;
}) {
  const theme = useHtmlRenderTheme();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [src] = useState(() => `${props.src.split("#", 1)[0]}${htmlRenderThemeFragment(theme)}`);
  const [loaded, setLoaded] = useState(false);
  const postTheme = () => {
    frameRef.current?.contentWindow?.postMessage(htmlRenderThemeMessage(theme), "*");
  };
  useEffect(postTheme, [theme]);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  // Chat also resolves project scripts from the thread's own environment.
  const environmentKeybindings = useAtomValue(
    serverEnvironment.configValueAtom(props.threadRef?.environmentId ?? null),
  )?.keybindings;
  // Replay only Cmd/Ctrl chords: printable keys would type into the composer.
  // Bindings for other commands block replay regardless of their live context.
  const { shortcuts, blocked } = useMemo(() => {
    const mac = isMacPlatform(navigator.platform);
    const resolve = (shortcut: KeybindingShortcut): HtmlRenderShortcut => ({
      key: shortcut.key,
      metaKey: shortcut.metaKey || (shortcut.modKey && mac),
      ctrlKey: shortcut.ctrlKey || (shortcut.modKey && !mac),
      shiftKey: shortcut.shiftKey,
      altKey: shortcut.altKey,
    });
    const blocked = [...keybindings, ...(environmentKeybindings ?? [])]
      .filter((binding) => !HTML_RENDER_SHORTCUT_COMMANDS.has(binding.command))
      .map((binding) => resolve(binding.shortcut));
    const shortcuts = new Map<string, HtmlRenderShortcut>();
    for (const { command, shortcut } of keybindings) {
      if (
        HTML_RENDER_SHORTCUT_COMMANDS.has(command) &&
        (shortcut.metaKey || shortcut.ctrlKey || shortcut.modKey)
      ) {
        shortcuts.set(shortcutConflictKey(shortcut), resolve(shortcut));
      }
    }
    return { shortcuts: [...shortcuts.values()], blocked };
  }, [environmentKeybindings, keybindings]);
  const postShortcuts = () => {
    frameRef.current?.contentWindow?.postMessage(
      htmlRenderShortcutsMessage(shortcuts, blocked),
      "*",
    );
  };
  useEffect(postShortcuts, [blocked, shortcuts]);
  // Pages can forge key/code pairs; reject chords that could match other commands.
  // Named keys must match event.key too, while dead keys match by code.
  const isShortcut = useEffectEvent(
    (key: NonNullable<ReturnType<typeof readHtmlRenderKeyDown>>) => {
      const matches = (shortcut: HtmlRenderShortcut) =>
        matchesKeybindingShortcut(key, { ...shortcut, modKey: false }, navigator.platform);
      const allowed = shortcuts.filter(matches);
      return (
        allowed.length > 0 &&
        !blocked.some(matches) &&
        (key.key.length === 1 ||
          key.key === "Dead" ||
          allowed.some((shortcut) => shortcut.key === normalizeEventKey(key.key)))
      );
    },
  );
  const openChangeRequestLink = useOpenChangeRequestLink(props.threadRef);
  const openLink = useOpenLink(props.threadRef);
  const open = useEffectEvent((url: string, modifiers: { metaKey: boolean; ctrlKey: boolean }) => {
    // The modifier's destination needs no saved setting, so it never waits on one.
    if (modifiers.metaKey || modifiers.ctrlKey) {
      void readLocalApi()
        ?.shell.openExternal(url)
        .catch((cause: unknown) => console.error(cause));
      return;
    }
    if (
      props.threadRef !== undefined &&
      openChangeRequestLink(
        { ...modifiers, preventDefault: () => undefined, stopPropagation: () => undefined },
        url,
        undefined,
        props.threadRef.environmentId,
      )
    ) {
      return;
    }
    void openLink(url, { event: modifiers }).catch((cause: unknown) => console.error(cause));
  });
  // Gate page-requested opens on focus and recent user activity to prevent opens
  // on load; script focus can still wait for the next user click or key.
  useEffect(() => {
    const openLink = (event: MessageEvent) => {
      const frame = frameRef.current;
      const request = readHtmlRenderLinkRequest(event.data);
      if (
        request === undefined ||
        frame === null ||
        event.source !== frame.contentWindow ||
        document.activeElement !== frame ||
        navigator.userActivation?.isActive === false
      ) {
        return;
      }
      open(request.url, request);
      frame.contentWindow?.postMessage(htmlRenderResult(request.id), "*");
    };
    window.addEventListener("message", openLink);
    return () => window.removeEventListener("message", openLink);
  }, []);
  // Focused frames consume app shortcuts; replay only posted chords, with
  // the same focus and recent-activity guard used for links.
  useEffect(() => {
    const replayKey = (event: MessageEvent) => {
      const frame = frameRef.current;
      const key = readHtmlRenderKeyDown(event.data);
      if (
        key === undefined ||
        frame === null ||
        event.source !== frame.contentWindow ||
        document.activeElement !== frame ||
        navigator.userActivation?.isActive === false
      ) {
        return;
      }
      if (!isShortcut(key)) return;
      frame.dispatchEvent(
        new KeyboardEvent("keydown", { ...key, bubbles: true, cancelable: true }),
      );
    };
    window.addEventListener("message", replayKey);
    return () => window.removeEventListener("message", replayKey);
  }, []);
  const { onContentHeight } = props;
  // Listen during layout so a fast page cannot post its first height before subscription.
  useLayoutEffect(() => {
    if (onContentHeight === undefined) return;
    const resize = (event: MessageEvent) => {
      const height = readHtmlRenderContentHeight(event.data);
      if (height !== undefined && event.source === frameRef.current?.contentWindow) {
        onContentHeight(height);
      }
    };
    window.addEventListener("message", resize);
    return () => window.removeEventListener("message", resize);
  }, [onContentHeight]);
  return (
    <iframe
      ref={frameRef}
      src={src}
      title={props.title}
      // Never allow-same-origin: the opaque origin keeps the page out of the app's session.
      sandbox="allow-scripts allow-forms"
      loading="lazy"
      onLoad={() => {
        setLoaded(true);
        // Covers a theme change that landed while the page was loading.
        postTheme();
        postShortcuts();
      }}
      // Match the initial blank frame scheme to avoid a white flash in dark mode;
      // follow the app scheme once its document loads.
      className={cn("border-0 scheme-light", props.className)}
      style={loaded ? { colorScheme: theme.appearance } : undefined}
    />
  );
}
