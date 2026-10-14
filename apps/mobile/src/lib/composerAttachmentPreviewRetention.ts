import type { FileBackedComposerAttachment } from "./composerImages";
import { retainComposerAttachmentFile } from "./composerAttachmentFiles";

/** Register owner-side cleanup from draft state to avoid a dependency cycle; releases before state loads have nothing to clean. */
type UnusedAttachmentHandler = (attachment: FileBackedComposerAttachment) => void;

let onAttachmentUnused: UnusedAttachmentHandler | null = null;

export function registerComposerAttachmentUnusedHandler(handler: UnusedAttachmentHandler): void {
  onAttachmentUnused = handler;
}

/** Keeps a native preview or upload readable until it finishes, then retries ownership cleanup. */
export function retainComposerAttachmentFileForPreview(
  attachment: FileBackedComposerAttachment,
): () => void {
  return retainComposerAttachmentFile(attachment.fileUri, () => {
    onAttachmentUnused?.(attachment);
  });
}
