import { ComposerPromptEditorTiptap } from "./ComposerPromptEditorTiptap";
import type { ComposerPromptEditorProps } from "./ComposerPromptEditorTiptap";

export type {
  ComposerCitationCommentRequest,
  ComposerPromptEditorHandle,
  ComposerPromptEditorProps,
} from "./ComposerPromptEditorTiptap";

/** Plain mode keeps Markdown literal; literalText also preserves context-token sources. */
export function ComposerPromptEditor(props: ComposerPromptEditorProps) {
  return <ComposerPromptEditorTiptap {...props} />;
}
