import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../../state/atom-registry";

// Keep the account id so a sign-out before navigation cannot present the wrong account's sheet.
export const connectOnboardingRequestAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:connect-onboarding-request"),
);

export function requestConnectOnboarding(accountId: string): void {
  appAtomRegistry.set(connectOnboardingRequestAtom, accountId);
}

export function clearConnectOnboardingRequest(): void {
  appAtomRegistry.set(connectOnboardingRequestAtom, null);
}
