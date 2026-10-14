import type { DesktopUpdateRemoteOutcome, DesktopUpdateState } from "@t3tools/contracts";

/** "wait" joins an action already in flight until the updater's next state change. */
export type RemoteDesktopUpdateStep =
  | { readonly action: "check" }
  | { readonly action: "download" }
  | { readonly action: "install" }
  | { readonly action: "wait" }
  | {
      readonly action: "done";
      readonly outcome: DesktopUpdateRemoteOutcome;
      readonly reason?: string;
    };

/** Count retries to cap update loops while tolerating one state replay from the background poller. */
export interface RemoteDesktopUpdateAttempts {
  readonly checks: number;
  readonly downloads: number;
}

export const MAX_REMOTE_UPDATE_CHECKS = 2;
export const MAX_REMOTE_UPDATE_DOWNLOADS = 3;

/** Same predicate DesktopUpdates.installDownloadedUpdate uses for admission. */
function isInstallableDesktopUpdateState(state: DesktopUpdateState): boolean {
  return (
    state.downloadedVersion !== null &&
    (state.status === "downloaded" ||
      (state.status === "error" &&
        (state.errorContext === null || state.errorContext === "install")))
  );
}

export function nextRemoteDesktopUpdateStep(
  state: DesktopUpdateState,
  attempts: RemoteDesktopUpdateAttempts,
  disabledReason: string | null,
): RemoteDesktopUpdateStep {
  if (!state.enabled || state.status === "disabled") {
    return {
      action: "done",
      outcome: "failed",
      reason: disabledReason ?? "Automatic updates are disabled on this machine.",
    };
  }
  // An install of this version already failed to apply here. Installing it
  // again from afar would stop the app's threads for nothing, so only the user
  // on this machine retries it.
  if (
    state.notAppliedVersion !== undefined &&
    (state.downloadedVersion ?? state.availableVersion) === state.notAppliedVersion
  ) {
    return {
      action: "done",
      outcome: "failed",
      reason: `Update ${state.notAppliedVersion} did not apply on this machine. Retry it from the desktop app there.`,
    };
  }
  // Mirror installDownloadedUpdate's own admission rule exactly, so the run
  // never reports an install that the updater then refuses. A download
  // survives an unrelated background updater error (errorContext null) and
  // a previous failed install (errorContext "install"); it does not survive
  // a check or download error, which fall through to the error branch.
  if (isInstallableDesktopUpdateState(state)) {
    return { action: "install" };
  }
  if (state.status === "downloading" || state.status === "checking") {
    return { action: "wait" };
  }
  if (state.status === "available") {
    if (attempts.downloads >= MAX_REMOTE_UPDATE_DOWNLOADS) {
      return {
        action: "done",
        outcome: "failed",
        reason: state.message ?? "The desktop app failed to download the update.",
      };
    }
    return { action: "download" };
  }
  // Background up-to-date/error states are stale until this remote run checks for itself.
  if (state.status === "up-to-date") {
    if (attempts.checks === 0) {
      return { action: "check" };
    }
    return { action: "done", outcome: "up-to-date" };
  }
  if (state.status === "error") {
    if (attempts.checks === 0) {
      return { action: "check" };
    }
    return {
      action: "done",
      outcome: "failed",
      reason: state.message ?? "The desktop app update failed.",
    };
  }
  if (attempts.checks >= MAX_REMOTE_UPDATE_CHECKS) {
    return {
      action: "done",
      outcome: "failed",
      reason: "The desktop app did not report an update result.",
    };
  }
  return { action: "check" };
}

/** Empty reasons fail the wire schema and drop terminal reports, leaving the server waiting for its timeout. */
export function normalizeRemoteUpdateReason(reason: string | undefined): string | undefined {
  const trimmed = reason?.trim();
  return trimmed ? trimmed : undefined;
}
