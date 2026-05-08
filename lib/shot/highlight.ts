// Shiki-backed code highlighter. We lazy-load the core (~10 KB), the
// requested theme, and the requested language on demand — keeping the
// initial bundle slim. Themes and languages already loaded stay loaded
// so theme/language flips after the first highlight are instant.

import type { Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;
const loadedThemes = new Set<string>();
const loadedLangs = new Set<string>();

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const { createHighlighter } = await import("shiki");
      // Start with no themes/langs — they're added per call.
      const h = await createHighlighter({ themes: [], langs: [] });
      return h;
    })();
  }
  return highlighterPromise;
}

export type HighlightResult = {
  /** HTML string ready to dangerouslySetInnerHTML. */
  html: string;
  /** Background colour Shiki would have used for the theme — useful when
   * we want the surrounding chrome (window bar, padding) to match. */
  bg: string;
  /** Foreground colour for any plaintext fallback. */
  fg: string;
};

export async function highlight(
  code: string,
  language: string,
  theme: string,
): Promise<HighlightResult> {
  const h = await getHighlighter();
  if (!loadedThemes.has(theme)) {
    await h.loadTheme(theme as never);
    loadedThemes.add(theme);
  }
  if (!loadedLangs.has(language)) {
    try {
      await h.loadLanguage(language as never);
      loadedLangs.add(language);
    } catch {
      // Fall back to plain text if the language isn't bundled.
      if (!loadedLangs.has("text")) {
        await h.loadLanguage("text" as never);
        loadedLangs.add("text");
      }
      language = "text";
    }
  }
  const html = h.codeToHtml(code, { lang: language, theme });
  // Pull background/foreground from the loaded theme.
  const t = h.getTheme(theme);
  return {
    html,
    bg: t.bg ?? "#0d1117",
    fg: t.fg ?? "#e6edf3",
  };
}
