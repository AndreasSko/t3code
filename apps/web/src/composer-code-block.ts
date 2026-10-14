import { exitCode } from "@tiptap/pm/commands";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { isClosingFence, parseOpeningFence, serializeSelection } from "~/composer-rich-text-doc";

/** Use spaces because Markdown readers render tabs at different widths; two spaces matches repo indentation. */
export const CODE_BLOCK_INDENT = "  ";

export function leadingWhitespace(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? "";
}

/** Tolerate hand-indented odd spaces and tabs; an unindented line must never lose its first code character. */
export function outdentLine(line: string): string {
  if (line.startsWith(CODE_BLOCK_INDENT)) return line.slice(CODE_BLOCK_INDENT.length);
  if (line.startsWith("\t")) return line.slice(1);
  if (line.startsWith(" ")) return line.slice(1);
  return line;
}

export function indentLines(lines: ReadonlyArray<string>, direction: "in" | "out"): string[] {
  return lines.map((line) => {
    // Indenting a blank line would leave trailing whitespace behind on a line
    // the user cannot see the caret move on, so leave it be.
    if (direction === "in") return line.length === 0 ? line : `${CODE_BLOCK_INDENT}${line}`;
    return outdentLine(line);
  });
}

export function selectionInOneCodeBlock(state: EditorState): boolean {
  const { $from, $to } = state.selection;
  return $from.parent.type.spec.code === true && $from.sameParent($to);
}

function codeBlockRange(
  state: EditorState,
): { readonly from: number; readonly to: number; readonly text: string } | null {
  const { $from, $to } = state.selection;
  const parent = $from.parent;
  if (parent.type.spec.code !== true) return null;
  // Same occurrence, not merely equal structure: two identical fences would
  // otherwise let a selection across them edit through the block boundary.
  if (!$from.sameParent($to)) return null;
  const from = $from.start();
  return { from, to: from + parent.content.size, text: parent.textContent };
}

/** Carry indentation because ProseMirror's default newline resets to column zero. */
export function indentedNewlineInCodeBlock(
  state: EditorState,
  dispatch?: (transaction: Transaction) => void,
): boolean {
  const block = codeBlockRange(state);
  if (!block) return false;

  const { from, to } = state.selection;
  const beforeCursor = block.text.slice(0, from - block.from);
  const currentLine = beforeCursor.slice(beforeCursor.lastIndexOf("\n") + 1);
  const indent = leadingWhitespace(currentLine);

  // Nothing to carry, so let the default newline handle it and keep this path
  // out of the undo history.
  if (indent.length === 0) return false;

  if (dispatch) {
    const inserted = `\n${indent}`;
    const transaction = state.tr.insertText(inserted, from, to);
    const caret = from + inserted.length;
    transaction.setSelection(TextSelection.create(transaction.doc, caret));
    dispatch(transaction.scrollIntoView());
  }
  return true;
}

/**
 * Two trailing blank lines leave a fence so an end-of-prompt code block cannot trap the caret. Treat
 * carried indentation as blank too.
 */
export function exitCodeBlockOnTrailingBlankLines(view: EditorView): boolean {
  const { $from, empty } = view.state.selection;
  if (!empty || $from.parent.type.spec.code !== true) return false;
  if ($from.parentOffset !== $from.parent.content.size) return false;
  const trailing = /\n[ \t]*\n[ \t]*$/.exec($from.parent.textContent);
  if (!trailing) return false;
  const transaction = view.state.tr.delete($from.pos - trailing[0].length, $from.pos);
  // An unclosed fence runs to the end of the draft; the prose after it would
  // be read back as code, so leaving it writes the closing fence.
  if (!$from.parent.attrs.close) {
    transaction.setNodeAttribute($from.before(), "close", `\n${$from.parent.attrs.fence}`);
  }
  view.dispatch(transaction);
  return exitCode(view.state, (tr) => view.dispatch(tr.scrollIntoView()));
}

/**
 * A typed closing fence ends the block there; following lines become paragraphs as the stored draft
 * expects.
 */
export function exitCodeBlockOnClosingFence(
  state: EditorState,
  dispatch?: (transaction: Transaction) => void,
): boolean {
  const block = codeBlockRange(state);
  if (!block || !state.selection.empty) return false;
  const caret = state.selection.from - block.from;
  const lineStart = block.text.lastIndexOf("\n", caret - 1) + 1;
  const newlineAfter = block.text.indexOf("\n", caret);
  const lineEnd = newlineAfter === -1 ? block.text.length : newlineAfter;
  const line = block.text.slice(lineStart, lineEnd);
  const node = state.selection.$from.parent;
  if (caret !== lineEnd || !isClosingFence(line, String(node.attrs.fence))) return false;

  if (dispatch) {
    const { schema } = state;
    const paragraph = (text: string) =>
      schema.nodes.paragraph!.create(null, text ? schema.text(text) : null);
    const code = block.text.slice(0, Math.max(0, lineStart - 1));
    const rest = newlineAfter === -1 ? [] : block.text.slice(newlineAfter + 1).split("\n");
    const closed = node.type.create(
      { ...node.attrs, close: `\n${line}` },
      code ? schema.text(code) : null,
    );
    const start = state.selection.$from.before();
    const transaction = state.tr.replaceWith(start, start + node.nodeSize, [
      closed,
      paragraph(""),
      ...rest.map(paragraph),
    ]);
    transaction.setSelection(TextSelection.create(transaction.doc, start + closed.nodeSize + 1));
    dispatch(transaction.scrollIntoView());
  }
  return true;
}

/** A caret indents in place; a ranged selection indents whole touched lines. */
export function indentCodeBlock(
  state: EditorState,
  direction: "in" | "out",
  dispatch?: (transaction: Transaction) => void,
): boolean {
  const block = codeBlockRange(state);
  if (!block) return false;

  const { from, to } = state.selection;
  const startOffset = from - block.from;
  const endOffset = to - block.from;

  if (from === to && direction === "in") {
    if (dispatch) {
      const transaction = state.tr.insertText(CODE_BLOCK_INDENT, from, to);
      dispatch(transaction.scrollIntoView());
    }
    return true;
  }

  // Grow the range to whole lines so indenting is stable no matter where in the
  // first and last lines the selection happens to start and end.
  const lineStart = block.text.lastIndexOf("\n", Math.max(0, startOffset - 1)) + 1;
  // A selection ending at the start of a line does not touch that line.
  const newlineAfter = block.text.indexOf("\n", Math.max(startOffset, endOffset - 1));
  const lineEnd = newlineAfter === -1 ? block.text.length : newlineAfter;

  const originalLines = block.text.slice(lineStart, lineEnd).split("\n");
  const nextLines = indentLines(originalLines, direction);
  if (nextLines.join("\n") === originalLines.join("\n")) return true;

  if (dispatch) {
    const transaction = state.tr.insertText(
      nextLines.join("\n"),
      block.from + lineStart,
      block.from + lineEnd,
    );
    // Preserve the selected lines so repeated Tab presses keep indenting the same block.
    const firstDelta = (nextLines[0]?.length ?? 0) - (originalLines[0]?.length ?? 0);
    const totalDelta = nextLines.join("\n").length - originalLines.join("\n").length;
    const nextFrom = Math.max(block.from + lineStart, from + firstDelta);
    const nextTo = Math.max(nextFrom, to + totalDelta);
    transaction.setSelection(TextSelection.create(transaction.doc, nextFrom, nextTo));
    dispatch(transaction.scrollIntoView());
  }
  return true;
}

/** Tiptap input rules fire on space; handle Enter explicitly so a typed fence becomes a block. */
export function convertCodeFenceOnEnter(
  state: EditorState,
  dispatch?: (transaction: Transaction) => void,
): boolean {
  const { $from, empty } = state.selection;
  // Top-level paragraphs only: the list and quote serializers have no line
  // to write a fence into, so one created inside them would vanish.
  if (!empty || $from.parent.type.name !== "paragraph" || $from.depth !== 1) return false;
  if ($from.parentOffset !== $from.parent.content.size) return false;
  // Use the parser's grammar and serialized chip sources so Enter and draft rebuilds recognize the same
  // fence.
  const opening = parseOpeningFence(serializeSelection(state.doc, $from.start(), $from.end()));
  const codeBlock = state.schema.nodes.codeBlock;
  if (!opening || !codeBlock) return false;

  if (dispatch) {
    const blockStart = $from.before();
    const { fence, language } = opening;
    const transaction = state.tr.replaceWith(
      blockStart,
      blockStart + $from.parent.nodeSize,
      codeBlock.create({ language, fence, close: `\n${fence}` }),
    );
    transaction.setSelection(TextSelection.create(transaction.doc, blockStart + 1));
    dispatch(transaction.scrollIntoView());
  }
  return true;
}
