import { useAtomValue } from "@effect/atom-react";
import { parseScopedProjectKey, scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectCloneSnapshot, ScopedProjectRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { serverEnvironment } from "./server";
import { sourceControlEnvironment } from "./sourceControl";

/** Treat the first-list gap as pending so a just-started clone cannot briefly enable Start. */
export type ProjectCloneState = ProjectCloneSnapshot | "pending" | null;

const EMPTY_CLONES: ReadonlyArray<ProjectCloneSnapshot> = [];
const EMPTY_CLONE_ATOM = Atom.make<ProjectCloneState>(null).pipe(
  Atom.withLabel("mobile-project-clone:empty"),
);

const environmentProjectClonesAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): ReadonlyArray<ProjectCloneSnapshot> | "pending" => {
    const config = get(serverEnvironment.configValueAtom(environmentId));
    if (config?.environment.capabilities.projectCloneTracking !== true) return EMPTY_CLONES;
    const result = get(sourceControlEnvironment.projectClones({ environmentId, input: {} }));
    // A failed stream must not block Start forever; the server guards dispatch and reconnect restores the stream.
    if (result._tag === "Failure") return EMPTY_CLONES;
    return Option.getOrElse(AsyncResult.value(result), () => "pending" as const);
  }).pipe(Atom.withLabel(`mobile-project-clones:${environmentId}`)),
);

/** The environment's tracked clones, empty until the stream's first list. */
export const environmentProjectCloneListAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): ReadonlyArray<ProjectCloneSnapshot> => {
    const clones = get(environmentProjectClonesAtom(environmentId));
    return clones === "pending" ? EMPTY_CLONES : clones;
  }).pipe(Atom.withLabel(`mobile-project-clone-list:${environmentId}`)),
);

const projectCloneAtom = Atom.family((key: string) => {
  const ref = parseScopedProjectKey(key);
  return Atom.make((get): ProjectCloneState => {
    if (ref === null) return null;
    const clones = get(environmentProjectClonesAtom(ref.environmentId));
    if (clones === "pending") return "pending";
    return clones.find((clone) => clone.projectId === ref.projectId) ?? null;
  }).pipe(Atom.withLabel(`mobile-project-clone:${key}`));
});

/** Pending until the first clone list; null when finished or never started. */
export function useProjectClone(ref: ScopedProjectRef | null): ProjectCloneState {
  return useAtomValue(ref === null ? EMPTY_CLONE_ATOM : projectCloneAtom(scopedProjectKey(ref)));
}
