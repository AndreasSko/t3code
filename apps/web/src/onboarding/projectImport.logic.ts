import { findProjectByPath } from "@t3tools/client-runtime/state/projects";
import type { AgentSessionProjectCandidate, EnvironmentId, ProjectId } from "@t3tools/contracts";

const RECENT_PROJECT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** One or two threads in a directory is usually a one-off question, not a project. */
const DEFAULT_SELECTION_MIN_THREADS = 3;

/**
 * Offer every candidate for history import; default-select active repositories. Missing git data from older
 * servers counts as a repository.
 */
export function partitionOnboardingProjects<T extends AgentSessionProjectCandidate>(
  candidates: ReadonlyArray<T>,
  now = Date.now(),
) {
  const cutoff = now - RECENT_PROJECT_WINDOW_MS;

  return {
    available: candidates,
    recent: candidates.filter((candidate) => {
      if (candidate.git === null) return false;
      if (candidate.threadCount < DEFAULT_SELECTION_MIN_THREADS) return false;
      if (candidate.lastActiveAt === null) return false;
      const lastActiveAt = Date.parse(candidate.lastActiveAt);
      return lastActiveAt >= cutoff && lastActiveAt <= now;
    }),
  };
}

export interface OnboardingProjectGroup<T> {
  readonly key: string;
  /** GitHub `owner/name`, or the checkout's folder name when the origin is elsewhere. */
  readonly label: string;
  readonly repository: string | null;
  readonly candidates: ReadonlyArray<T>;
  readonly threadCount: number;
  readonly lastActiveAt: string | null;
}

function latestActivity(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return left > right ? left : right;
}

/**
 * Group clones by normalized origin; keep unidentifiable repositories separate and non-git directories
 * foldable.
 */
export function groupOnboardingProjects<
  T extends Pick<
    AgentSessionProjectCandidate,
    "path" | "title" | "git" | "threadCount" | "lastActiveAt"
  >,
>(candidates: ReadonlyArray<T>) {
  const groups = new Map<string, OnboardingProjectGroup<T> & { candidates: Array<T> }>();
  const other: Array<T> = [];

  for (const candidate of candidates) {
    if (candidate.git === null) {
      other.push(candidate);
      continue;
    }
    const git = candidate.git ?? { remoteKey: null, repository: null };
    const key = git.remoteKey === null ? `path:${candidate.path}` : `remote:${git.remoteKey}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        key,
        label: git.repository ?? candidate.title,
        repository: git.repository,
        candidates: [candidate],
        threadCount: candidate.threadCount,
        lastActiveAt: candidate.lastActiveAt,
      });
      continue;
    }
    existing.candidates.push(candidate);
    groups.set(key, {
      ...existing,
      threadCount: existing.threadCount + candidate.threadCount,
      lastActiveAt: latestActivity(existing.lastActiveAt, candidate.lastActiveAt),
    });
  }

  const repositories = [...groups.values()].sort((left, right) => {
    if (left.lastActiveAt === right.lastActiveAt) return left.label.localeCompare(right.label);
    if (left.lastActiveAt === null) return 1;
    if (right.lastActiveAt === null) return -1;
    return right.lastActiveAt.localeCompare(left.lastActiveAt);
  });

  return { repositories, other };
}

/** Use the server's project match before the client snapshot, which can lag behind the scan. */
export function resolveOnboardingProjectId(
  projects: ReadonlyArray<{
    readonly id: ProjectId;
    readonly environmentId: EnvironmentId;
    readonly workspaceRoot: string;
  }>,
  environmentId: EnvironmentId,
  candidate: Pick<AgentSessionProjectCandidate, "path" | "projectId">,
): ProjectId | null {
  if (candidate.projectId !== undefined) return candidate.projectId;
  const environmentProjects = projects.filter((project) => project.environmentId === environmentId);
  const currentRootMatch = findProjectByPath(environmentProjects, candidate.path);
  if (currentRootMatch !== undefined) return currentRootMatch.id;
  return null;
}

/** Prefer a selected project with imported history, then a completed empty import. */
export function resolveOnboardingLandingProject<T>(
  selection: ReadonlyArray<string>,
  projectsWithImportedHistory: ReadonlyMap<string, T>,
  completedProjects: ReadonlyMap<string, T>,
): T | undefined {
  for (const path of selection) {
    const project = projectsWithImportedHistory.get(path);
    if (project !== undefined) return project;
  }
  for (const path of selection) {
    const project = completedProjects.get(path);
    if (project !== undefined) return project;
  }
  return undefined;
}

/** Keep the folder name visible and truncate its prefix; recognize both separators for remote environments. */
export function splitOnboardingProjectPath(path: string): {
  readonly name: string;
  readonly parent: string;
} {
  if (/^[A-Za-z]:[\\/]+$/.test(path) || /^[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/]*$/.test(path)) {
    return { name: path, parent: "" };
  }
  const trimmed = path.replace(/[\\/]+$/, "");
  const separatorIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (trimmed.length === 0) return { name: path, parent: "" };
  if (separatorIndex < 0) return { name: trimmed, parent: "" };
  return { name: trimmed.slice(separatorIndex + 1), parent: trimmed.slice(0, separatorIndex + 1) };
}

/** Paths identify projects only within the computer that owns them. */
export function onboardingProjectKey(environmentId: EnvironmentId, path: string): string {
  return JSON.stringify([environmentId, path]);
}
