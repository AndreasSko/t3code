import { create } from "zustand";

import type { ScopedThreadRef } from "@t3tools/contracts";

/**
 * Compare ref fields: colon-joined scopedThreadKey values can collide and must not move drops across
 * threads.
 */
export function isSameSidebarThreadRef(a: ScopedThreadRef, b: ScopedThreadRef): boolean {
  return a.environmentId === b.environmentId && a.threadId === b.threadId;
}

/**
 * Queue drops with individual ids so repeated drops retain files and stale navigation clears only its own
 * entry.
 */
export interface SidebarPendingFileDrop {
  id: string;
  threadRef: ScopedThreadRef;
  files: File[];
}

interface SidebarPendingFileDropStoreState {
  pending: SidebarPendingFileDrop[];
  /** Returns the queued drop id for identity-checked cleanup. */
  queuePendingFileDrop: (entry: Omit<SidebarPendingFileDrop, "id">) => string;
  clearPendingFileDrop: (id: string) => void;
  clearPendingFileDropsForThread: (threadRef: ScopedThreadRef) => void;
  /** Consume matching files oldest first; return null without changing state when none match. */
  consumePendingFileDrop: (threadRef: ScopedThreadRef) => File[] | null;
}

let nextPendingFileDropId = 0;

export const useSidebarPendingFileDropStore = create<SidebarPendingFileDropStoreState>()(
  (set, get) => ({
    pending: [],
    queuePendingFileDrop: (entry) => {
      const id = `sidebar-file-drop-${(nextPendingFileDropId += 1)}`;
      set((state) => ({ pending: [...state.pending, { ...entry, id }] }));
      return id;
    },
    clearPendingFileDrop: (id) => {
      set((state) => ({ pending: state.pending.filter((drop) => drop.id !== id) }));
    },
    clearPendingFileDropsForThread: (threadRef) => {
      set((state) => ({
        pending: state.pending.filter((drop) => !isSameSidebarThreadRef(drop.threadRef, threadRef)),
      }));
    },
    consumePendingFileDrop: (threadRef) => {
      const matches = get().pending.filter((drop) =>
        isSameSidebarThreadRef(drop.threadRef, threadRef),
      );
      if (matches.length === 0) {
        return null;
      }
      const matchedIds = new Set(matches.map((drop) => drop.id));
      set((state) => ({ pending: state.pending.filter((drop) => !matchedIds.has(drop.id)) }));
      return matches.flatMap((drop) => drop.files);
    },
  }),
);
