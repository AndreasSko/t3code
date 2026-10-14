import {
  getSharedHighlighter,
  type DiffsHighlighter,
  type HighlighterTypes,
  type SupportedLanguages,
} from "@pierre/diffs";

import { resolveDiffThemeName } from "./diffRendering";

/**
 * Use Oniguruma WASM to avoid JS-regex backtracking hangs; the singleton is first-caller-wins so every
 * creation site must pass this engine.
 */
export const PREFERRED_HIGHLIGHTER: HighlighterTypes = "shiki-wasm";

const highlighterPromiseCache = new Map<string, Promise<DiffsHighlighter>>();

export function getSyntaxHighlighterPromise(language: string): Promise<DiffsHighlighter> {
  const cached = highlighterPromiseCache.get(language);
  if (cached) return cached;

  const promise = getSharedHighlighter({
    themes: [resolveDiffThemeName("dark"), resolveDiffThemeName("light")],
    langs: [language as SupportedLanguages],
    preferredHighlighter: PREFERRED_HIGHLIGHTER,
  }).catch((error) => {
    if (language === "text") {
      highlighterPromiseCache.delete(language);
      // "text" itself failed — Shiki cannot initialize at all, surface the error
      throw error;
    }
    return getSyntaxHighlighterPromise("text");
  });
  highlighterPromiseCache.set(language, promise);
  return promise;
}
