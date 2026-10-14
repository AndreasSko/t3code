/** `id` is positional on purpose: the same attachment can be embedded twice in one body. */
export type PullRequestBodySegment =
  | { readonly id: string; readonly kind: "markdown"; readonly text: string }
  | {
      readonly id: string;
      readonly kind: "attachment";
      readonly url: string;
      /** GitHub dropped images use img tags; a standalone bare attachment URL indicates video. */
      readonly media: "video" | "image" | "unknown";
    };

const FENCE_PATTERN = /^\s{0,3}((?:`{3,})|(?:~{3,}))(.*)$/u;
// Bound closing-tag scans so unclosed video tags cannot repeatedly rescan the entire body.
const VIDEO_TAG_MAX_LINES = 8;
/** Four spaces open an indented code block, so its contents stay verbatim markdown. */
const INDENTED_CODE_PATTERN = /^(?: {4}|\t)/u;
const BARE_URL_PATTERN = /^<?(https?:\/\/\S+?)>?$/u;
const IMAGE_EXTENSION_PATTERN = /\.(?:png|jpe?g|gif|webp|avif|heic|heif|svg)(?:$|[?#])/iu;
const MARKDOWN_LINK_PATTERN = /^\[[^\]]*\]\((https?:\/\/[^\s)]+)\)$/u;
const VIDEO_EXTENSION_PATTERN = /\.(?:mp4|webm|mov|m4v|ogv)(?:$|[?#])/iu;
/** A dropped video becomes a bare asset link; a dropped image becomes an `<img>` tag. */
const GITHUB_ASSET_PATTERN = /^https:\/\/github\.com\/user-attachments\/assets\/[\w-]+$/iu;
const VIDEO_TAG_SRC_PATTERN = /<(?:video|source)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/iu;
/** Only a tag that owns its line is an embed; inline, it is prose the renderer should keep. */
const STANDALONE_VIDEO_TAG_PATTERN = /^\s*<video\b/iu;
const VIDEO_TAG_END_PATTERN = /<\/video>\s*$/iu;

/** Anything else — `javascript:`, `data:`, a relative path — is not an upload to link out to. */
function isWebUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function attachmentFromLine(
  line: string,
): { url: string; media: "video" | "image" | "unknown" } | null {
  const url =
    BARE_URL_PATTERN.exec(line.trim())?.[1] ?? MARKDOWN_LINK_PATTERN.exec(line.trim())?.[1];
  if (url === undefined || !isWebUrl(url)) return null;
  if (VIDEO_EXTENSION_PATTERN.test(url) || GITHUB_ASSET_PATTERN.test(url)) {
    return { url, media: "video" };
  }
  if (IMAGE_EXTENSION_PATTERN.test(url)) return { url, media: "image" };
  return null;
}

/** Extracts standalone media while preserving ordinary links, code, and existing image embeds. */
export function splitPullRequestBody(body: string): ReadonlyArray<PullRequestBodySegment> {
  const segments: PullRequestBodySegment[] = [];
  const markdown: string[] = [];
  let openFence: string | null = null;

  // Blank lines around a run are dropped, but never leading spaces: four of them open an
  // indented code block, so trimming a run would silently turn code into prose.
  const flushMarkdown = () => {
    const text = markdown.join("\n").replace(/^\n+/u, "").replace(/\s+$/u, "");
    markdown.length = 0;
    if (text.trim().length > 0) {
      segments.push({ id: `markdown:${segments.length}`, kind: "markdown", text });
    }
  };

  const lines = body.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const fenceMatch = FENCE_PATTERN.exec(line);
    if (fenceMatch !== null) {
      const fence = fenceMatch[1]!;
      // Closing fences need the same marker, sufficient length, and no trailing info string.
      const closes =
        openFence !== null &&
        fence[0] === openFence[0] &&
        fence.length >= openFence.length &&
        fenceMatch[2]!.trim().length === 0;
      if (openFence === null) {
        openFence = fence;
      } else if (closes) {
        openFence = null;
      }
      markdown.push(line);
      continue;
    }
    if (openFence !== null || INDENTED_CODE_PATTERN.test(line)) {
      markdown.push(line);
      continue;
    }

    const bareAttachment = attachmentFromLine(line);
    if (bareAttachment !== null) {
      flushMarkdown();
      segments.push({ id: `attachment:${segments.length}`, kind: "attachment", ...bareAttachment });
      continue;
    }

    if (!STANDALONE_VIDEO_TAG_PATTERN.test(line)) {
      markdown.push(line);
      continue;
    }
    // Bound multiline tag lookup and join text only after finding its close.
    const lastCandidate = Math.min(index + VIDEO_TAG_MAX_LINES, lines.length) - 1;
    let cursor = index;
    while (cursor < lastCandidate && !VIDEO_TAG_END_PATTERN.test(lines[cursor]!)) {
      cursor += 1;
    }
    const source = VIDEO_TAG_END_PATTERN.test(lines[cursor]!)
      ? VIDEO_TAG_SRC_PATTERN.exec(lines.slice(index, cursor + 1).join("\n"))?.[1]
      : undefined;
    if (source !== undefined && isWebUrl(source)) {
      flushMarkdown();
      segments.push({
        id: `attachment:${segments.length}`,
        kind: "attachment",
        url: source,
        // The author wrote the tag, so this one is a video whatever the URL looks like.
        media: "video",
      });
      index = cursor;
    } else {
      // Unclosed, or nothing linkable in it: prose. Only this line is consumed, so the
      // lines that were looked at are still parsed on their own terms.
      markdown.push(line);
    }
  }

  flushMarkdown();
  return segments;
}
