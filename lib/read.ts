export type ReadStats = {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  sentences: number;
  paragraphs: number;
  syllables: number;
  readingMinutes: number;
  speakingMinutes: number;
  fleschReadingEase: number | null;
  fleschKincaidGrade: number | null;
  averageWordsPerSentence: number | null;
  topWords: { word: string; count: number }[];
};

const STOP_WORDS = new Set([
  "the","a","an","and","or","but","if","of","to","in","on","at","for","with",
  "is","are","was","were","be","been","being","have","has","had","do","does",
  "did","will","would","can","could","should","may","might","must","shall",
  "i","you","he","she","it","we","they","me","him","her","us","them","my",
  "your","his","its","our","their","this","that","these","those","as","by",
  "from","not","no","so","than","too","very","just","also","up","out","over",
  "under","again","further","then","once","here","there","when","where","why",
  "how","all","any","both","each","few","more","most","other","some","such",
  "only","own","same","s","t","don","now","into","about","because","while",
  "off","through","between","after","before","above","below","what","which",
  "who","whom","whose"
]);

export function computeReadStats(input: string): ReadStats {
  const text = input ?? "";
  const characters = [...text].length;
  const charactersNoSpaces = [...text.replace(/\s+/g, "")].length;

  const words = extractWords(text);
  const wordCount = words.length;

  const sentences = countSentences(text);
  const paragraphs = countParagraphs(text);
  const syllables = words.reduce((acc, w) => acc + countSyllables(w), 0);

  const wpmRead = 240; // common adult reading speed
  const wpmSpeak = 130; // average speaking rate
  const readingMinutes = wordCount / wpmRead;
  const speakingMinutes = wordCount / wpmSpeak;

  let fleschReadingEase: number | null = null;
  let fleschKincaidGrade: number | null = null;
  let averageWordsPerSentence: number | null = null;
  if (wordCount > 0 && sentences > 0) {
    const wps = wordCount / sentences;
    const spw = syllables / wordCount;
    averageWordsPerSentence = wps;
    fleschReadingEase = 206.835 - 1.015 * wps - 84.6 * spw;
    fleschKincaidGrade = 0.39 * wps + 11.8 * spw - 15.59;
  }

  const topWords = topNonStopWords(words, 10);

  return {
    characters,
    charactersNoSpaces,
    words: wordCount,
    sentences,
    paragraphs,
    syllables,
    readingMinutes,
    speakingMinutes,
    fleschReadingEase,
    fleschKincaidGrade,
    averageWordsPerSentence,
    topWords,
  };
}

export function gradeForFleschEase(score: number | null): string {
  if (score === null) return "—";
  if (score >= 90) return "Very easy (5th grade)";
  if (score >= 80) return "Easy (6th grade)";
  if (score >= 70) return "Fairly easy (7th grade)";
  if (score >= 60) return "Plain English (8th–9th grade)";
  if (score >= 50) return "Fairly difficult (10th–12th)";
  if (score >= 30) return "Difficult (college)";
  return "Very confusing (college grad)";
}

function extractWords(text: string): string[] {
  // Letters from many scripts plus apostrophes-within-word.
  const re = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
  const out: string[] = [];
  for (const m of text.matchAll(re)) out.push(m[0]);
  return out;
}

function countSentences(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  // Split on sentence-ending punctuation followed by space or end.
  const matches = trimmed.match(/[^.!?\n]+[.!?]+(?=\s|$)/g);
  if (matches && matches.length > 0) return matches.length;
  // Fallback for text without terminal punctuation.
  return 1;
}

function countParagraphs(text: string): number {
  const parts = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return parts.length;
}

function countSyllables(word: string): number {
  // English-leaning heuristic. Reasonable for mixed text; not a true syllabifier.
  const w = word.toLowerCase().replace(/[^a-zà-öø-ÿ]/g, "");
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;
  const stripped = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "");
  const groups = stripped.match(/[aeiouyàáâäåèéêëìíîïòóôöùúûü]+/g);
  return groups ? Math.max(1, groups.length) : 1;
}

function topNonStopWords(
  words: string[],
  n: number,
): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const w of words) {
    const lower = w.toLowerCase();
    if (lower.length <= 2) continue;
    if (STOP_WORDS.has(lower)) continue;
    counts.set(lower, (counts.get(lower) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([word, count]) => ({ word, count }));
}
