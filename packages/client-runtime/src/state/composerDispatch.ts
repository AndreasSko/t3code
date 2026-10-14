/** Shared follow-up semantics for web alternate send (Mod+Enter) and mobile send long-press. */
export type ComposerDispatchMode = "auto" | "queue" | "steer" | "restart";
export type ActiveTurnComposerAction = Exclude<ComposerDispatchMode, "auto">;

/** The alternate switches between queue and steer relative to the configured action. */
export function resolveComposerDispatchMode(input: {
  readonly running: boolean;
  readonly alternateModifier: boolean;
  readonly activeTurnDefault?: ActiveTurnComposerAction;
}): ComposerDispatchMode {
  if (!input.running) return "auto";
  const defaultAction = input.activeTurnDefault ?? "steer";
  if (input.alternateModifier) return defaultAction === "queue" ? "steer" : "queue";
  return defaultAction;
}

/** What the alternate would do, for labelling the affordance that triggers it. */
export function alternateComposerDispatchAction(
  activeTurnDefault?: ActiveTurnComposerAction,
): ActiveTurnComposerAction {
  return resolveComposerDispatchMode({
    running: true,
    alternateModifier: true,
    ...(activeTurnDefault === undefined ? {} : { activeTurnDefault }),
  }) as ActiveTurnComposerAction;
}
