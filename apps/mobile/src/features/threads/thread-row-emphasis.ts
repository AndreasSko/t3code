import type { ThreadListV2Status } from "./threadListV2";

/** Recede background work to prioritize human attention; an unseen completion cannot foreground ongoing work. */
export function shouldRecedeThreadRow(input: {
  readonly status: ThreadListV2Status;
  readonly selected: boolean;
}): boolean {
  return !input.selected && (input.status === "working" || input.status === "waiting");
}
