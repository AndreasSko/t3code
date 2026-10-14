import { closeHistory, isHistoryTransaction } from "@tiptap/pm/history";
import type { Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";

/**
 * ProseMirror joins adjacent edits, including store rewrites; split undo groups on change-kind switches and
 * after one second so typing, deletion, and rewrites remain separate steps.
 */
export const COMPOSER_UNDO_GROUP_DELAY = 1000;

export type ComposerChangeKind = "insert" | "delete" | "other";

/**
 * Our paste/cut paths replace ProseMirror's clipboard handling; tag every dispatch to keep separate undo
 * steps.
 */
export function markAsClipboardEdit(tr: Transaction, event: "paste" | "cut"): Transaction {
  return tr.setMeta("uiEvent", event);
}

function changeKindOf(tr: Transaction): ComposerChangeKind | null {
  if (!tr.docChanged) return null;
  const uiEvent = tr.getMeta("uiEvent");
  if (uiEvent === "paste" || uiEvent === "drop" || uiEvent === "cut") return "other";
  // IME input replaces its own range on each keystroke; it is still typing.
  if (tr.getMeta("composition") != null) return "insert";
  let kind: ComposerChangeKind | null = null;
  for (const step of tr.steps) {
    if (!(step instanceof ReplaceStep)) return "other";
    const inserts = step.slice.size > 0;
    const deletes = step.to > step.from;
    const stepKind = inserts && !deletes ? "insert" : deletes && !inserts ? "delete" : "other";
    if (kind !== null && kind !== stepKind) return "other";
    kind = stepKind;
  }
  return kind;
}

/**
 * Run before applying tr. Change-kind switches and one-off edits start undo steps; undo/redo also reset
 * grouping.
 */
export function groupUndoByChangeKind(
  tr: Transaction,
  previous: ComposerChangeKind | null,
): ComposerChangeKind | null {
  if (isHistoryTransaction(tr)) return "other";
  const kind = changeKindOf(tr);
  if (kind === null) return previous;
  if (previous !== null && (kind !== previous || kind === "other")) closeHistory(tr);
  return kind;
}
