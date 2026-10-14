import { type RefObject, useLayoutEffect, useState } from "react";

import { type ResizableWidthHandlers, useResizableWidth } from "./useResizableWidth";
import { observeResize } from "../lib/observeResize";

export interface PreviewPanelInlineSize {
  readonly width: number;
  readonly handlers: ResizableWidthHandlers;
}

const PREVIEW_PANEL_WIDTH_STORAGE_KEY = "t3code:preview-panel-width";
const PREVIEW_PANEL_MIN_WIDTH = 360;
/** Wide screens use a viewport fraction cap; narrow rows preserve the sibling column's usable width. */
const PREVIEW_PANEL_MAX_WIDTH_FRACTION = 0.7;
/** Below 360px the sibling composer overflows, so the panel yields. */
const SIBLING_COLUMN_MIN_WIDTH = 360;
const PREVIEW_PANEL_DEFAULT_WIDTH = 540;

export function usePreviewPanelInlineSize(
  hostRef?: RefObject<HTMLElement | null>,
  options: {
    readonly enabled?: boolean | undefined;
    readonly widthStorageKey?: string | undefined;
    readonly defaultWidth?: number | undefined;
    readonly container?: HTMLElement | null | undefined;
  } = {},
): PreviewPanelInlineSize {
  const maxWidth = useViewportClampedMaxWidth(hostRef, options.enabled ?? true, options.container);
  return useResizableWidth({
    storageKey: options.widthStorageKey ?? PREVIEW_PANEL_WIDTH_STORAGE_KEY,
    defaultWidth: options.defaultWidth ?? PREVIEW_PANEL_DEFAULT_WIDTH,
    minWidth: PREVIEW_PANEL_MIN_WIDTH,
    maxWidth,
    edge: "left",
  });
}

function useViewportClampedMaxWidth(
  hostRef: RefObject<HTMLElement | null> | undefined,
  enabled: boolean,
  container: HTMLElement | null | undefined,
): number {
  const [maxWidth, setMaxWidth] = useState(() =>
    getPreviewPanelMaxWidth(typeof window === "undefined" ? 1280 : window.innerWidth),
  );
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const row = container ?? (enabled ? hostRef?.current?.parentElement : null) ?? null;
    // Clamp persisted width before paint to avoid an over-wide flash; store only the cap so unchanged bounds
    // during sidebar drags do not rerender the panel owner.
    const measure = () => {
      setMaxWidth(getPreviewPanelMaxWidth(window.innerWidth, row?.clientWidth));
    };
    measure();
    let frame = 0;
    const onResize = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    window.addEventListener("resize", onResize);
    const stopObserving = row ? observeResize(row, measure) : undefined;
    return () => {
      window.removeEventListener("resize", onResize);
      if (frame !== 0) window.cancelAnimationFrame(frame);
      stopObserving?.();
    };
  }, [container, hostRef, enabled]);
  return maxWidth;
}
export function getPreviewPanelMaxWidth(viewportWidth: number, containerWidth?: number): number {
  const fractionCap = Math.floor(viewportWidth * PREVIEW_PANEL_MAX_WIDTH_FRACTION);
  const containerCap =
    containerWidth === undefined ? Infinity : Math.floor(containerWidth) - SIBLING_COLUMN_MIN_WIDTH;
  // Never allow max below min; useResizableWidth would persist the inversion and overwrite the saved width.
  return Math.max(PREVIEW_PANEL_MIN_WIDTH, Math.min(fractionCap, containerCap));
}
