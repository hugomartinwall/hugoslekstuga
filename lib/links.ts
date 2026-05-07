// Curated relationships between tools. These drive the force-directed graph
// on the homepage Map view. Each entry is an undirected edge.
//
// Themes (loose):
//   files     — sharing & shaping documents
//   writing   — text in, text out
//   time      — pacing & coordination
//   wellness  — body & mind
//   creative  — visual & generative

export type Link = [from: string, to: string];

export const LINKS: Link[] = [
  // Files
  ["convert", "pdf"],
  ["convert", "squeeze"],
  ["pdf", "squeeze"],
  ["convert", "qr"],
  ["pdf", "qr"],

  // Writing
  ["read", "markdown"],
  ["markdown", "diff"],
  ["read", "diff"],
  ["markdown", "slug"],
  ["read", "slug"],
  ["markdown", "emoji"],

  // Time / productivity
  ["focus", "talk"],
  ["focus", "stretch"],
  ["focus", "breathe"],
  ["focus", "until"],
  ["talk", "until"],
  ["talk", "stretch"],
  ["until", "zones"],
  ["until", "sleep"],
  ["zones", "talk"],

  // Wellness
  ["feeling", "breathe"],
  ["feeling", "three"],
  ["feeling", "advice"],
  ["breathe", "three"],
  ["breathe", "stretch"],
  ["breathe", "sleep"],
  ["three", "sleep"],
  ["sleep", "stretch"],

  // Creative
  ["palette", "sketch"],
  ["palette", "memory"],
  ["sketch", "memory"],
  ["sketch", "idea"],
  ["idea", "roll"],
  ["idea", "advice"],
  ["roll", "advice"],

  // Numbers / decisions
  ["tip", "roll"],

  // A few cross-cluster bridges so the graph isn't disconnected
  ["palette", "qr"],
  ["sketch", "markdown"],
  ["emoji", "feeling"],
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
