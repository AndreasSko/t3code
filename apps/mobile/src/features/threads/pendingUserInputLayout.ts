const PENDING_USER_INPUT_MAX_HEIGHT = 560;
const PENDING_USER_INPUT_MIN_HEIGHT = 160;
const PENDING_USER_INPUT_VERTICAL_GAP = 12;

/** Until measured, reserve a portrait iPhone keyboard with QuickType; underestimating would let the card overshoot. */
export const ESTIMATED_KEYBOARD_HEIGHT = 336;

/** Card and feed-inset motion must share a clock; 220ms is close to iOS keyboard motion's ~250ms. */
export const USER_INPUT_TOGGLE_DURATION_MS = 220;

export function derivePendingUserInputMaxHeight(input: {
  readonly windowHeight: number;
  readonly keyboardHeight: number;
  readonly navigationHeaderHeight: number;
  readonly composerOverlapHeight: number;
}): number {
  const availableHeight =
    input.windowHeight -
    Math.max(0, input.keyboardHeight) -
    Math.max(0, input.navigationHeaderHeight) -
    Math.max(0, input.composerOverlapHeight) -
    PENDING_USER_INPUT_VERTICAL_GAP;

  return Math.min(
    PENDING_USER_INPUT_MAX_HEIGHT,
    Math.max(PENDING_USER_INPUT_MIN_HEIGHT, availableHeight),
  );
}
