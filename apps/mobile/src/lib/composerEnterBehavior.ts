/** iOS hardware Return: send uses Shift-Return for newline; newline uses Command-Return to submit.
 * Android has no hardware Return handling. */
export type ComposerEnterBehavior = "send" | "newline";

export const DEFAULT_COMPOSER_ENTER_BEHAVIOR: ComposerEnterBehavior = "send";
