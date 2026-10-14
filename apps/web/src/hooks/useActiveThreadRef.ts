import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useMemo } from "react";

/** Key on ids because the thread shell changes identity during runs; dependent effects must stay stable. */
export function useActiveThreadRef(
  thread: { readonly environmentId: EnvironmentId; readonly id: ThreadId } | null | undefined,
): ScopedThreadRef | null {
  const environmentId = thread?.environmentId ?? null;
  const threadId = thread?.id ?? null;
  return useMemo(
    () =>
      environmentId !== null && threadId !== null ? scopeThreadRef(environmentId, threadId) : null,
    [environmentId, threadId],
  );
}
