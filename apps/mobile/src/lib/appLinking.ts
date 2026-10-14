/** Ignore launcher and sharing wake URLs; the persisted share inbox owns navigation.
 * Scheme-only dictation returns must wake the app without resetting navigation. */
export function shouldHandleAppLink(url: string): boolean {
  return (
    !url.includes("expo-development-client") &&
    !url.includes("://expo-sharing") &&
    !/^t3code(-dev|-preview)?:\/*$/.test(url)
  );
}
