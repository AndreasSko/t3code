import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, PullRequestRef } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { toastManager } from "../ui/toast";
import {
  countViewedFiles,
  isFileViewed,
  isStaleViewedState,
  revertFileViewedOverlay,
  settleFileViewedOverlay,
  toFileViewedBatch,
  toFileViewedStates,
  type FileViewedOverlay,
  type FileViewedStates,
} from "./pullRequestFilesViewed.logic";

/** Batch rapid viewed-file presses for 400 ms before sending one request. */
const FLUSH_DELAY_MS = 400;

const NO_OVERLAY: FileViewedOverlay = new Map();

export interface PullRequestFilesViewedView {
  readonly enabled: boolean;
  readonly isViewed: (path: string) => boolean;
  readonly isStale: (path: string) => boolean;
  readonly setViewed: (path: string, viewed: boolean) => void;
  readonly viewedCount: number;
  /** The host had more files than the read covered, so the count above may be short. */
  readonly truncated: boolean;
  /** Distinguish failed reads from an unseen review when marks use cached or empty state. */
  readonly error: string | null;
  readonly refresh: () => void;
}

/** Keep optimistic marks until a read can confirm their write; server state
 * lets reviews continue across clients. */
export function usePullRequestFilesViewed(options: {
  readonly environmentId: EnvironmentId;
  readonly reference: PullRequestRef;
  readonly enabled: boolean;
  /** The paths on screen, which is what the counter counts. */
  readonly paths: ReadonlyArray<string>;
}): PullRequestFilesViewedView {
  const { environmentId, reference, enabled, paths } = options;
  const query = useEnvironmentQuery(
    enabled ? pullRequestEnvironment.filesViewed({ environmentId, input: reference }) : null,
  );
  const refresh = query.refresh;
  // Cached marks survive read failures; expose the error so stale ticks cannot look current.
  const states = useMemo(() => toFileViewedStates(query.data), [query.data]);
  const truncated = query.data?.truncated === true;
  const error = query.error;
  const [overlay, setOverlay] = useState<FileViewedOverlay>(NO_OVERLAY);
  const setFilesViewed = useAtomCommand(pullRequestEnvironment.setFilesViewed, {
    reportFailure: false,
  });

  // Refs expose latest queued presses and request ownership without rerenders.
  // Later presses take ownership from older in-flight writes.
  const queued = useRef<Map<string, boolean>>(new Map());
  const sentBy = useRef<Map<string, number>>(new Map());
  const requests = useRef(0);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Include environment in scope because project ids can collide across machines.
  const scopeKey = `${environmentId} ${reference.projectId} ${reference.repository} ${reference.number}`;
  const scope = useRef(scopeKey);

  // Record the acknowledged-write baseline; only a later changed answer can retire that press.
  const answeredFrom = useRef<Map<string, FileViewedStates | null>>(new Map());
  const statesRef = useRef(states);
  statesRef.current = states;

  useEffect(() => {
    const pending = new Set([...queued.current.keys(), ...sentBy.current.keys()]);
    const answered = new Set<string>();
    for (const [path, from] of answeredFrom.current) {
      if (pending.has(path) || from === states) continue;
      answered.add(path);
      answeredFrom.current.delete(path);
    }
    setOverlay((current) => settleFileViewedOverlay(current, states, pending, answered));
  }, [states]);

  const flush = useCallback(() => {
    flushTimer.current = null;
    const batch = toFileViewedBatch(queued.current);
    if (batch.length === 0) return;
    queued.current = new Map();
    const sentFrom = scope.current;
    const request = ++requests.current;
    for (const file of batch) sentBy.current.set(file.path, request);
    void setFilesViewed({ environmentId, input: { ...reference, files: batch } }).then((result) => {
      const mine = batch
        .map((file) => file.path)
        .filter((path) => sentBy.current.get(path) === request);
      for (const path of mine) sentBy.current.delete(path);
      if (scope.current !== sentFrom) return;
      if (result._tag === "Failure") {
        // Revert only presses still owned by this failure, preserving queued or later writes.
        const owned = new Set(mine.filter((path) => !queued.current.has(path)));
        setOverlay((current) => revertFileViewedOverlay(current, batch, owned));
        // Interrupted connections already show their failure; obsolete requests own no visible ticks.
        if (owned.size > 0 && !isAtomCommandInterrupted(result)) {
          toastManager.add({ type: "error", title: "Could not update viewed files" });
        }
        return;
      }
      // Accept the next read even if a newer push reports dismissed instead of viewed.
      for (const path of mine) answeredFrom.current.set(path, statesRef.current);
      refresh();
    });
  }, [environmentId, reference, refresh, setFilesViewed]);

  // Ref reads keep setViewed stable so changing flush state cannot rebuild every file header.
  const flushRef = useRef(flush);
  flushRef.current = flush;

  // Flush with the scope being left so final presses cannot target the next PR or environment.
  useEffect(() => {
    const flushScope = flushRef.current;
    scope.current = scopeKey;
    return () => {
      if (flushTimer.current !== null) {
        clearTimeout(flushTimer.current);
        flushScope();
      }
      queued.current = new Map();
      sentBy.current = new Map();
      answeredFrom.current = new Map();
      setOverlay(NO_OVERLAY);
    };
  }, [scopeKey]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const refreshFromHost = useCallback(() => refreshRef.current(), []);

  const setViewed = useCallback((path: string, viewed: boolean) => {
    setOverlay((current) => new Map(current).set(path, viewed));
    queued.current.set(path, viewed);
    if (flushTimer.current !== null) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => flushRef.current(), FLUSH_DELAY_MS);
  }, []);

  const isViewed = useCallback(
    (path: string) => isFileViewed(path, states, overlay),
    [overlay, states],
  );
  const isStale = useCallback(
    (path: string) => !overlay.has(path) && isStaleViewedState(states?.get(path)),
    [overlay, states],
  );
  const viewedCount = useMemo(
    () => countViewedFiles(paths, states, overlay),
    [overlay, paths, states],
  );

  return useMemo(
    () => ({
      enabled,
      isViewed,
      isStale,
      setViewed,
      viewedCount,
      truncated,
      error,
      refresh: refreshFromHost,
    }),
    [enabled, error, isStale, isViewed, refreshFromHost, setViewed, truncated, viewedCount],
  );
}
