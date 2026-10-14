export const COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX = 620;
export const COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX = 780;
const RESTING_COMPOSER_IMAGE_THUMBNAIL_LIMIT = 3;

export function getRestingComposerImagePreviewCounts(imageCount: number): {
  visibleCount: number;
  overflowCount: number;
} {
  const visibleCount = Math.min(imageCount, RESTING_COMPOSER_IMAGE_THUMBNAIL_LIMIT);
  return {
    visibleCount,
    overflowCount: Math.max(0, imageCount - visibleCount),
  };
}

export function shouldUseCompactComposerFooter(
  width: number | null,
  options?: { hasWideActions?: boolean },
): boolean {
  const breakpoint = options?.hasWideActions
    ? COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX
    : COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX;
  return width !== null && width < breakpoint;
}

export function shouldUseRestingComposerLayout(input: {
  isExistingThread: boolean;
  isMobileViewport: boolean;
  isScrollCollapsed: boolean;
  hasExpandedChrome: boolean;
  hasMultilinePrompt: boolean;
  timelineOverflows: boolean;
}): boolean {
  // Only a timeline scroll rests the composer; focus loss must not collapse it.
  // Multiline drafts and fitting timelines need no reading space reclaimed.
  return (
    input.isExistingThread &&
    !input.isMobileViewport &&
    input.timelineOverflows &&
    input.isScrollCollapsed &&
    !input.hasMultilinePrompt &&
    !input.hasExpandedChrome
  );
}

/** ChatComposer loses 8px top padding, 38px prompt height (70 -> 32), and a 48px footer. */
export const COMPOSER_RESTING_EXPANSION_MIN_PX = 94;

/** Reserve the measured expanded height so expansion cannot cover the last rows.
 * Estimate only before that measurement exists to avoid shifting the timeline mid-transition. */
export function resolveComposerTimelineInset(input: {
  currentInset: number;
  overlayHeight: number;
  isResting: boolean;
  restingOnlyHeight?: number;
}): number {
  return input.isResting
    ? Math.max(
        input.currentInset,
        input.overlayHeight +
          (input.currentInset === 0
            ? COMPOSER_RESTING_EXPANSION_MIN_PX - (input.restingOnlyHeight ?? 0)
            : 0),
      )
    : input.overlayHeight;
}

/** Status bars replacing an unmounted composer must not inherit its resting state. */
export function overlayComposerIsResting(input: {
  composerMounted: boolean;
  composerReportedResting: boolean;
}): boolean {
  return input.composerMounted && input.composerReportedResting;
}

export function shouldAnimateComposerRestingTransition(input: {
  hasCompletedInitialLayout: boolean;
  stateChanged: boolean;
  hasInterruptedAnimation: boolean;
}): boolean {
  return input.hasCompletedInitialLayout && (input.stateChanged || input.hasInterruptedAnimation);
}

export function shouldUseCompactComposerPrimaryActions(
  width: number | null,
  options?: { hasWideActions?: boolean },
): boolean {
  if (!options?.hasWideActions) {
    return false;
  }
  return width !== null && width < COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX;
}

export interface RestingComposerControlsMeasurement {
  gap: number;
  naturalFixedWidth: number;
  minimumFixedWidth: number;
  blockWidths: readonly number[];
  overflowWidth: number;
  iconOnlyBlockWidths?: readonly number[];
}

function restingComposerControlsWidth(
  input: RestingComposerControlsMeasurement,
  hiddenCount: number,
  fixedWidth = input.naturalFixedWidth,
  iconOnlyCount = 0,
): number {
  const { blockWidths, gap } = input;
  const visibleCount = blockWidths.length - hiddenCount;
  return (
    fixedWidth +
    blockWidths
      .slice(0, visibleCount)
      .reduce(
        (sum, width, index) =>
          sum +
          (index >= blockWidths.length - iconOnlyCount
            ? (input.iconOnlyBlockWidths?.[index] ?? width)
            : width),
        0,
      ) +
    (hiddenCount > 0 ? input.overflowWidth : 0) +
    gap * (visibleCount + (hiddenCount > 0 ? 1 : 0))
  );
}

/** Use natural widths to prevent context labels and composer overflow
 * from repeatedly reclaiming space from each other. */
export function resolveRestingComposerControlsNaturalWidth(
  input: RestingComposerControlsMeasurement,
): number {
  return restingComposerControlsWidth(input, 0);
}

/** Compact labels before overflowing blocks, then shrink the picker to its
 * readable minimum; hide the cluster below that width. */
const RESTING_CONTROLS_SLACK_PX = 1;

export function resolveRestingComposerControlsLayout(
  input: RestingComposerControlsMeasurement & {
    hostWidth: number;
    previous?: { hiddenCount: number; iconOnlyCount?: number; visible: boolean };
  },
): { hiddenCount: number; iconOnlyCount?: number; visible: boolean } {
  const { blockWidths, hostWidth, previous } = input;
  const iconSteps = input.iconOnlyBlockWidths ? blockWidths.length : 0;
  const previousStep = previous
    ? previous.hiddenCount > 0
      ? iconSteps + Math.min(previous.hiddenCount, blockWidths.length)
      : Math.min(previous.iconOnlyCount ?? 0, iconSteps)
    : 0;
  let step = 0;
  const widthAtStep = (candidate: number, fixedWidth = input.naturalFixedWidth) =>
    restingComposerControlsWidth(
      input,
      Math.max(0, candidate - iconSteps),
      fixedWidth,
      Math.min(candidate, iconSteps),
    );
  // Promotions need a pixel of slack: recovering a flexible picker's natural
  // width can jitter by a fraction of a pixel across renders. Demotions are
  // immediate so a threshold cannot clip or flip React between layouts.
  while (
    step < iconSteps + blockWidths.length &&
    widthAtStep(step) > hostWidth - (step < previousStep ? RESTING_CONTROLS_SLACK_PX : 0)
  ) {
    step += 1;
  }
  const hiddenCount = Math.max(0, step - iconSteps);
  const iconOnlyCount = Math.min(step, iconSteps);
  const minimumWidth = widthAtStep(step, input.minimumFixedWidth);
  const visible =
    previous && !previous.visible
      ? minimumWidth <= hostWidth - RESTING_CONTROLS_SLACK_PX
      : minimumWidth <= hostWidth;
  return { hiddenCount, ...(input.iconOnlyBlockWidths ? { iconOnlyCount } : {}), visible };
}

export function resolveScrollToEndClearance(input: {
  overlayHeight: number;
  mainSurfaceTop: number;
  button: { left: number; right: number };
  attachments: ReadonlyArray<{ top: number; left: number; right: number }>;
}): number {
  let contentTop = input.mainSurfaceTop;
  let top = contentTop;
  for (const attachment of input.attachments) {
    contentTop = Math.min(contentTop, attachment.top);
    if (attachment.left < input.button.right && attachment.right > input.button.left) {
      top = Math.min(top, attachment.top);
    }
  }
  return Math.ceil(input.overlayHeight - (top - contentTop));
}
