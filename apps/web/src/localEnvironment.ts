/**
 * When desktop local execution is disabled there is no primary; authenticate only saved remote
 * environments.
 */
export function isLocalEnvironmentDisabled(): boolean {
  return window.desktopBridge?.getLocalEnvironmentEnabled?.() === false;
}
