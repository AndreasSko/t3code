import type { PullRequestReaction, PullRequestReactionContent } from "@t3tools/contracts";

/** The picker's order, which is GitHub's: the two verdicts first, then the rest as it lists them. */
export const PULL_REQUEST_REACTION_ORDER: ReadonlyArray<PullRequestReactionContent> = [
  "thumbs-up",
  "thumbs-down",
  "laugh",
  "hooray",
  "confused",
  "heart",
  "rocket",
  "eyes",
];

const REACTION_EMOJI: Record<PullRequestReactionContent, string> = {
  "thumbs-up": "👍",
  "thumbs-down": "👎",
  laugh: "😄",
  hooray: "🎉",
  confused: "😕",
  heart: "❤️",
  rocket: "🚀",
  eyes: "👀",
};

const REACTION_NAME: Record<PullRequestReactionContent, string> = {
  "thumbs-up": "thumbs up",
  "thumbs-down": "thumbs down",
  laugh: "laugh",
  hooray: "hooray",
  confused: "confused",
  heart: "heart",
  rocket: "rocket",
  eyes: "eyes",
};

export function pullRequestReactionEmoji(content: PullRequestReactionContent): string {
  return REACTION_EMOJI[content];
}

export function pullRequestReactionName(content: PullRequestReactionContent): string {
  return REACTION_NAME[content];
}

/** Past three names the sentence stops being readable and starts being a list. */
const NAMED_ACTOR_LIMIT = 3;

function joinNames(parts: ReadonlyArray<string>): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

/** "others" only alongside somebody named; on its own a count is people, not other people. */
function countRemainder(count: number, named: boolean): string {
  if (named) return `${count} ${count === 1 ? "other" : "others"}`;
  return `${count} ${count === 1 ? "person" : "people"}`;
}

/** Name the viewer as You only when actors leave room within count; otherwise
 * they may already include the viewer. Host count bounds names and the remainder. */
export function pullRequestReactionTooltip(reaction: PullRequestReaction): string {
  const viewerHasRoom = reaction.actors.length < reaction.count;
  const names =
    reaction.viewerHasReacted && viewerHasRoom ? ["You", ...reaction.actors] : [...reaction.actors];
  const shown = names.slice(0, Math.min(NAMED_ACTOR_LIMIT, reaction.count));
  const others = Math.max(0, reaction.count - shown.length);
  const parts = [...shown, ...(others > 0 ? [countRemainder(others, shown.length > 0)] : [])];
  return `${joinNames(parts)} reacted with ${pullRequestReactionName(reaction.content)} emoji`;
}

/** Optimistic reaction changes answer the press before the slow host reread. */
export function applyPendingPullRequestReactions(
  reactions: ReadonlyArray<PullRequestReaction>,
  pending: ReadonlyMap<PullRequestReactionContent, boolean>,
): ReadonlyArray<PullRequestReaction> {
  if (pending.size === 0) return reactions;
  const byContent = new Map(reactions.map((reaction) => [reaction.content, reaction] as const));
  for (const [content, reacted] of pending) {
    const current = byContent.get(content);
    if (current === undefined) {
      if (reacted) {
        byContent.set(content, { content, count: 1, actors: [], viewerHasReacted: true });
      }
      continue;
    }
    if (current.viewerHasReacted === reacted) continue;
    const count = current.count + (reacted ? 1 : -1);
    if (count <= 0) byContent.delete(content);
    else byContent.set(content, { ...current, count, viewerHasReacted: reacted });
  }
  return PULL_REQUEST_REACTION_ORDER.flatMap((content) => byContent.get(content) ?? []);
}
