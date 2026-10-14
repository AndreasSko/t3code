/**
 * Private GitHub media returns unauthenticated 404s; fetch with gh because the renderer has no session.
 * Signed objects/private-user-images URLs load directly; credentials cannot rescue expired signatures.
 */

const RAW_HOST = "raw.githubusercontent.com";
/** Git LFS pointers resolve here, which is where an LFS-tracked screenshot's bytes live. */
const LFS_HOST = "media.githubusercontent.com";
const ATTACHMENT_PATH_PATTERN = /^\/user-attachments\/assets\/[\w-]+$/u;
/** What GitHub wrote into a body before `user-attachments`; older descriptions still carry it. */
const LEGACY_ATTACHMENT_PATH_PATTERN = /^\/[^/]+\/[^/]+\/assets\/\d+\/[\w-]+$/u;
/** `blob` and `raw` both address file bytes; `raw` is the one the token is honoured on. */
const REPOSITORY_FILE_PATTERN = /^\/([^/]+)\/([^/]+)\/(?:raw|blob)\/(.*[^/])$/u;

/** Port, userinfo, and fragment say nothing about which bytes GitHub will serve. */
function canonicalUrl(host: string, url: URL): string {
  return `https://${host}${url.pathname}${url.search}`;
}

/** Returns the credentialed GitHub fetch URL, or null for media that should load directly. */
export function githubMediaFetchUrl(source: string): string | null {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (host === RAW_HOST || host === LFS_HOST) return canonicalUrl(host, url);
  if (host !== "github.com" && host !== "www.github.com") return null;
  if (
    ATTACHMENT_PATH_PATTERN.test(url.pathname) ||
    LEGACY_ATTACHMENT_PATH_PATTERN.test(url.pathname)
  ) {
    return `https://github.com${url.pathname}`;
  }
  const repositoryFile = REPOSITORY_FILE_PATTERN.exec(url.pathname);
  // `?raw=true` is how the web UI spells "the bytes, not the page"; the raw host needs no query.
  return repositoryFile
    ? `https://${RAW_HOST}/${repositoryFile[1]}/${repositoryFile[2]}/${repositoryFile[3]}`
    : null;
}

/**
 * Last path segment, for the signed URL's display name. A percent sequence GitHub accepts but
 * `decodeURIComponent` rejects is left encoded rather than failing the whole asset.
 */
export function githubMediaFileName(fetchUrl: string): string {
  const segment = new URL(fetchUrl).pathname.split("/").pop() ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    decoded = segment;
  }
  const name = decoded.replace(/[\p{Cc}\\/]/gu, "");
  return name.length > 0 ? name : "github-media";
}
