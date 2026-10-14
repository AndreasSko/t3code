/**
 * Signal a spawned POSIX group. Reject pid <=1/non-integers with ESRCH:
 * kill(0) targets this server's group and kill(-1) targets all the user's processes.
 */
export function signalProcessGroup(pid: number, signal: NodeJS.Signals | 0): void {
  if (!Number.isSafeInteger(pid) || pid <= 1) {
    throw Object.assign(new Error(`kill ESRCH: not a spawned process group (${pid})`), {
      code: "ESRCH",
    });
  }
  process.kill(-pid, signal);
}
