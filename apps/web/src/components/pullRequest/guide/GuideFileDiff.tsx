import {
  cloneFileDiffMetadata,
  type FileDiffContentsLoader,
  type FileDiffMetadata,
} from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useMemo } from "react";

import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";

import { DIFF_VIEW_UNSAFE_CSS } from "../../diffs/StyledDiffCodeView";

/** Hide the viewer header because the stop already names this file. */
export function GuideFileDiff({
  file,
  loadDiffFiles,
}: {
  file: FileDiffMetadata;
  loadDiffFiles: FileDiffContentsLoader;
}) {
  const { resolvedTheme } = useTheme();
  // Expansion mutates metadata; clone it so excerpts keep their original patch.
  const expandable = useMemo(() => cloneFileDiffMetadata(file), [file]);
  const options = useMemo(
    () => ({
      diffStyle: "unified" as const,
      lineDiffType: "none" as const,
      overflow: "scroll" as const,
      disableFileHeader: true,
      theme: resolveDiffThemeName(resolvedTheme),
      themeType: resolvedTheme,
      preferredHighlighter: PREFERRED_HIGHLIGHTER,
      unsafeCSS: DIFF_VIEW_UNSAFE_CSS,
      loadDiffFiles,
    }),
    [loadDiffFiles, resolvedTheme],
  );
  return (
    <div className="border-t border-border/60">
      <FileDiff fileDiff={expandable} options={options} />
    </div>
  );
}
