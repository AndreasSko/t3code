/**
 * Disable context isolation for the React picker hook; keep sandbox on and Node integration off because pages share its world.
 * Electron parses this attribute without trimming and requires true/false strings; whitespace or yes/no can silently change flags.
 */
export const PREVIEW_WEBVIEW_PREFERENCES =
  "contextIsolation=false,sandbox=true,nodeIntegration=false";
