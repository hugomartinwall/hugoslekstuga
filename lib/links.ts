// Curated relationships between tools. These drive the force-directed graph
// on the homepage Map view. Each entry is an undirected edge.
//
// Themes (loose):
//   files     — sharing & shaping documents
//   writing   — text in, text out
//   time      — pacing & coordination
//   wellness  — body & mind
//   creative  — visual & generative
//   code      — pixels, CSS, patterns

export type Link = [from: string, to: string];

export const LINKS: Link[] = [
  // ---------- Files ----------
  ["convert", "pdf"],
  ["convert", "squeeze"],
  ["pdf", "squeeze"],
  ["convert", "qr"],
  ["pdf", "qr"],
  ["strip", "squeeze"],
  ["strip", "pdf"],
  ["trace", "ascii"],
  ["trace", "favicon"],
  ["ascii", "favicon"],
  ["base64", "qr"],
  ["base64", "favicon"],
  ["base64", "convert"],
  ["favicon", "squeeze"],

  // ---------- Writing ----------
  ["read", "markdown"],
  ["markdown", "diff"],
  ["read", "diff"],
  ["markdown", "slug"],
  ["read", "slug"],
  ["case", "slug"],
  ["case", "markdown"],
  ["cleantext", "slug"],
  ["cleantext", "markdown"],
  ["cleantext", "diff"],
  ["lorem", "markdown"],
  ["lorem", "idea"],
  ["bionic", "read"],
  ["bionic", "markdown"],

  // ---------- Time ----------
  ["focus", "talk"],
  ["focus", "stretch"],
  ["focus", "breathe"],
  ["focus", "until"],
  ["talk", "until"],
  ["talk", "stretch"],
  ["until", "zones"],
  ["until", "sleep"],
  ["zones", "talk"],
  ["ago", "until"],
  ["ago", "zones"],
  ["plus", "until"],
  ["plus", "zones"],
  ["plus", "talk"],
  ["plus", "focus"],

  // ---------- Wellness ----------
  ["feeling", "breathe"],
  ["feeling", "three"],
  ["feeling", "advice"],
  ["breathe", "three"],
  ["breathe", "stretch"],
  ["breathe", "sleep"],
  ["three", "sleep"],
  ["sleep", "stretch"],
  ["tally", "focus"],
  ["tally", "tip"],
  ["noise", "focus"],
  ["noise", "breathe"],
  ["noise", "sleep"],
  ["typing", "read"],
  ["typing", "focus"],
  ["typing", "stretch"],

  // ---------- Creative ----------
  ["palette", "sketch"],
  ["sketch", "idea"],
  ["idea", "roll"],
  ["idea", "advice"],
  ["roll", "advice"],
  ["picker", "roll"],
  ["picker", "tip"],
  ["picker", "mash"],
  ["scale", "idea"],
  ["scale", "tip"],
  ["mash", "idea"],
  ["mash", "slug"],

  // ---------- Code ----------
  ["gradient", "shadow"],
  ["gradient", "contrast"],
  ["gradient", "palette"],
  ["shadow", "easing"],
  ["contrast", "palette"],
  ["easing", "shadow"],
  ["regex", "slug"],
  ["regex", "diff"],
  ["regex", "cleantext"],

  // ---------- Cross-cluster bridges ----------
  ["tip", "roll"],
  ["palette", "qr"],
  ["sketch", "markdown"],
  ["ascii", "sketch"],
  ["trace", "palette"],
  ["typing", "talk"],

  // sum (writing) bridges out — it's a math notepad, so it sits next to
  // its cluster neighbours and the other calc-shaped tools across the map.
  ["sum", "read"],
  ["sum", "markdown"],
  ["sum", "tip"],
  ["sum", "plus"],
  ["sum", "scale"],

  // sift (files) — a data explorer, neighbouring the converter and the
  // other "look inside a file" tools, plus a math/data bridge to sum.
  ["sift", "convert"],
  ["sift", "base64"],
  ["sift", "read"],
  ["sift", "sum"],
  ["sift", "diff"],
];

// Quick lookup: how many neighbours does each tool have?
export function neighbourCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [a, b] of LINKS) {
    counts[a] = (counts[a] ?? 0) + 1;
    counts[b] = (counts[b] ?? 0) + 1;
  }
  return counts;
}

export function neighboursOf(slug: string): Set<string> {
  const out = new Set<string>();
  for (const [a, b] of LINKS) {
    if (a === slug) out.add(b);
    if (b === slug) out.add(a);
  }
  return out;
}
