const NEW_TASK_DRAFT_PREFIX = "new-task:";

export function newTaskDraftKey(draftId: string): string {
  return `${NEW_TASK_DRAFT_PREFIX}${draftId}`;
}

export function isNewTaskDraftKey(draftKey: string): boolean {
  return draftKey.startsWith(NEW_TASK_DRAFT_PREFIX);
}

/** Outbox recovery and "Edit task" must derive the same key for a rejected creation. */
export function restoredNewTaskDraftKey(messageId: string): string {
  return newTaskDraftKey(`restored-${messageId}`);
}

/** UUID draft ids contain no colon; a colon after the prefix identifies an environment/project key. */
export function parseLegacyNewTaskDraftKey(
  draftKey: string,
): { readonly environmentId: string; readonly projectId: string } | null {
  if (!isNewTaskDraftKey(draftKey)) {
    return null;
  }
  const scope = draftKey.slice(NEW_TASK_DRAFT_PREFIX.length);
  const separator = scope.lastIndexOf(":");
  if (separator <= 0 || separator === scope.length - 1) {
    return null;
  }
  return { environmentId: scope.slice(0, separator), projectId: scope.slice(separator + 1) };
}
