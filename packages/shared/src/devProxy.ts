/**
 * Vite's proxy and the server catch-all must share these prefixes: drift returns
 * index.html for backend requests or creates redirect loops through the proxy.
 */
export const DEV_PROXIED_PATH_PREFIXES = ["/api", "/oauth", "/.well-known", "/ws", "/mcp"] as const;

/**
 * Preserve the browser's Host so MCP OAuth metadata names the fetched origin
 * and /ws cookie sessions pass the server's Origin/Host check.
 */
export const DEV_PROXIED_ORIGIN_PRESERVING_PREFIXES: ReadonlySet<string> = new Set([
  "/oauth",
  "/.well-known",
  "/mcp",
  "/ws",
]);

export function isDevProxiedPath(pathname: string): boolean {
  return DEV_PROXIED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
