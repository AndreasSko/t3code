/**
 * Anthropic rejects images over 2000px per side once a request holds more than 20 images.
 * Claude Code forwards mid-turn attachments unchanged, so one large paste can break
 * every later request in that thread.
 */
export const IMAGE_ATTACHMENT_MAX_EDGE = 2000;

/** Formats a client re-encodes in place. GIF, WebP, and SVG are left as attached. */
export type DownscalableImageMimeType = "image/png" | "image/jpeg";

export function downscalableImageMimeType(mimeType: string): DownscalableImageMimeType | null {
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/png") return "image/png";
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "image/jpeg";
  return null;
}

/** Preserves aspect ratio within `IMAGE_ATTACHMENT_MAX_EDGE`; returns null if it already fits. */
export function fitImageAttachmentSize(size: {
  readonly width: number;
  readonly height: number;
}): { width: number; height: number } | null {
  const longestEdge = Math.max(size.width, size.height);
  if (longestEdge <= IMAGE_ATTACHMENT_MAX_EDGE) return null;
  const scale = IMAGE_ATTACHMENT_MAX_EDGE / longestEdge;
  return {
    width: Math.max(1, Math.min(IMAGE_ATTACHMENT_MAX_EDGE, Math.round(size.width * scale))),
    height: Math.max(1, Math.min(IMAGE_ATTACHMENT_MAX_EDGE, Math.round(size.height * scale))),
  };
}
