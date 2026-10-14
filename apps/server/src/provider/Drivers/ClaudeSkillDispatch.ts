/** Claude expands one skill only when /name starts the last text block; $name is literal.
 * Leading whitespace or later-line slashes do not invoke it; trailing text becomes ARGUMENTS.
 * Earlier mentions become inline /name for the Skill tool (anthropics/claude-code#87113). */

/** Match packages/shared/src/composerInlineTokens.ts so rendered chips and dispatched skills agree. */
const SKILL_MENTION_PATTERN =
  /(^|\s)\p{Sc}(?![0-9][0-9_]*(?:[kKmMbBtT]|[eE][0-9]+)?(?:\s|$))(?=[a-zA-Z0-9:_-]*[a-zA-Z])([a-zA-Z0-9][a-zA-Z0-9:_-]*)(?=\s|$)/gu;

export interface ClaudeSkillDispatch {
  /** Text before the dispatched mention, or `undefined` when it opens the prompt. */
  readonly leadingText: string | undefined;
  /** `/name` plus the trailing text, ready to be the message's last text block. */
  readonly commandText: string;
  readonly skillName: string;
}

/** Dispatch the last known $skill; unknown mentions such as $HOME stay literal.
 * Undefined means send the prompt unchanged. */
export function planClaudeSkillDispatch(
  prompt: string,
  skillNames: ReadonlySet<string>,
): ClaudeSkillDispatch | undefined {
  const mentions = [...prompt.matchAll(SKILL_MENTION_PATTERN)].flatMap((match) => {
    const name = match[2] ?? "";
    if (!skillNames.has(name)) return [];
    const start = (match.index ?? 0) + (match[1]?.length ?? 0);
    return [{ name, start, end: (match.index ?? 0) + match[0].length }];
  });
  const last = mentions.at(-1);
  if (!last) {
    return undefined;
  }

  const leading = prompt.slice(0, last.start);
  const trailing = prompt.slice(last.end);
  const leadingWithInlineSlashes = mentions
    .slice(0, -1)
    .reduceRight(
      (text, mention) =>
        `${text.slice(0, mention.start)}/${mention.name}${text.slice(mention.end)}`,
      leading,
    )
    .trimEnd();

  return {
    leadingText: leadingWithInlineSlashes.length > 0 ? leadingWithInlineSlashes : undefined,
    commandText: `/${last.name}${trailing}`.trimEnd(),
    skillName: last.name,
  };
}
