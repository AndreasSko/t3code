import type { FileDiffMetadata } from "@pierre/diffs";
import type { EnvironmentId, PullRequestRef } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { getRenderablePatch, resolveFileDiffPath } from "~/lib/diffRendering";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";

import { pullRequestReviewKey } from "../pullRequestReviewStore";

interface LoadedDiff {
  readonly key: string;
  /** The page asked for next; null is the first. */
  readonly cursor: string | null;
  readonly done: boolean;
  readonly files: ReadonlyMap<string, FileDiffMetadata>;
}

const NO_FILES: ReadonlyMap<string, FileDiffMetadata> = new Map();

/** Reuse Code-tab pages and stop fetching once all wanted files arrive;
 * retain loaded pages so revisiting a stop needs no read. */
export function useGuideDiffFiles({
  environmentId,
  reference,
  headSha,
  wantedPaths,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  /** Changed guide heads must invalidate excerpts against the previous diff. */
  headSha: string;
  wantedPaths: ReadonlyArray<string>;
}) {
  const key = `${environmentId}:${pullRequestReviewKey(reference)}:${headSha}`;
  const [loaded, setLoaded] = useState<LoadedDiff>({
    key,
    cursor: null,
    done: false,
    files: NO_FILES,
  });
  const current: LoadedDiff =
    loaded.key === key ? loaded : { key, cursor: null, done: false, files: NO_FILES };
  const missing = wantedPaths.some((path) => !current.files.has(path));
  const loading = missing && !current.done;
  const query = useEnvironmentQuery(
    loading
      ? pullRequestEnvironment.diff({
          environmentId,
          input: { ...reference, ...(current.cursor === null ? {} : { cursor: current.cursor }) },
        })
      : null,
  );

  const data = query.data;
  const cursor = current.cursor;
  useEffect(() => {
    if (data === null) return;
    setLoaded((previous) => {
      const base =
        previous.key === key ? previous : { key, cursor: null, done: false, files: NO_FILES };
      if (base.cursor !== cursor || base.done) return base;
      const parsed = getRenderablePatch(
        data.patch,
        `pull-request-guide:${key}:${cursor ?? "first"}`,
      );
      const files = new Map(base.files);
      if (parsed?.kind === "files") {
        for (const file of parsed.files) files.set(resolveFileDiffPath(file), file);
      }
      return { key, cursor: data.nextCursor, done: data.nextCursor === null, files };
    });
  }, [cursor, data, key]);

  return {
    files: current.files,
    loading: loading && query.error === null,
    error: loading ? query.error : null,
    retry: query.refresh,
  };
}
