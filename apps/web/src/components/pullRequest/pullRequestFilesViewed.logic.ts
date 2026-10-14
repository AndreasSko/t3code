import type { PullRequestFileViewedState, PullRequestFilesViewedResult } from "@t3tools/contracts";

/** What the host last said about each file, by path. Absent means the host said nothing. */
export type FileViewedStates = ReadonlyMap<string, PullRequestFileViewedState>;

export type FileViewedOverlay = ReadonlyMap<string, boolean>;

export function toFileViewedStates(
  result: PullRequestFilesViewedResult | null,
): FileViewedStates | null {
  if (result === null) return null;
  return new Map(result.files.map((file) => [file.path, file.state]));
}

/** dismissed means changed since review, so the file must count as unseen. */
function isViewedState(state: PullRequestFileViewedState | undefined): boolean {
  return state === "viewed";
}

export function isStaleViewedState(state: PullRequestFileViewedState | undefined): boolean {
  return state === "dismissed";
}

export function isFileViewed(
  path: string,
  states: FileViewedStates | null,
  overlay: FileViewedOverlay,
): boolean {
  const pressed = overlay.get(path);
  return pressed ?? isViewedState(states?.get(path));
}

export function countViewedFiles(
  paths: ReadonlyArray<string>,
  states: FileViewedStates | null,
  overlay: FileViewedOverlay,
): number {
  return paths.reduce(
    (total, path) => (isFileViewed(path, states, overlay) ? total + 1 : total),
    0,
  );
}

/** Keep optimistic ticks until a post-write read arrives to avoid checkbox
 * flashes; answered paths accept contradictory state while pending writes remain protected. */
export function settleFileViewedOverlay(
  overlay: FileViewedOverlay,
  states: FileViewedStates | null,
  pending: ReadonlySet<string>,
  answered: ReadonlySet<string>,
): FileViewedOverlay {
  if (states === null || overlay.size === 0) return overlay;
  const next = new Map(overlay);
  for (const [path, pressed] of overlay) {
    if (pending.has(path)) continue;
    if (answered.has(path) || isViewedState(states.get(path)) === pressed) next.delete(path);
  }
  return next.size === overlay.size ? overlay : next;
}

/** Revert only presses this failed request still owns so newer presses survive. */
export function revertFileViewedOverlay(
  overlay: FileViewedOverlay,
  batch: ReadonlyArray<{ readonly path: string; readonly viewed: boolean }>,
  owned: ReadonlySet<string>,
): FileViewedOverlay {
  const next = new Map(overlay);
  for (const { path, viewed } of batch) {
    if (!owned.has(path)) continue;
    if (next.get(path) === viewed) next.delete(path);
  }
  return next.size === overlay.size ? overlay : next;
}

export function toFileViewedBatch(
  overlay: FileViewedOverlay,
): ReadonlyArray<{ readonly path: string; readonly viewed: boolean }> {
  return [...overlay].map(([path, viewed]) => ({ path, viewed }));
}
