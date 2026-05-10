// Curated relationships between tools. These drive the force-directed graph
// on the homepage Map view. Each entry is an undirected edge.
//
// Themes (loose):
//   files     — sharing & shaping documents
//   writing   — text in, text out
//   time      — pacing & coordination
//   wellness  — body & mind
//   creative  — visual & generative
//   games     — quick play, sharable scores

export type Link = [from: string, to: string];

export const LINKS: Link[] = [
  // ---------- Files ----------
  ["convert", "pdf"],
  ["convert", "qr"],
  ["pdf", "qr"],
  ["strip", "pdf"],

  // ---------- Writing ----------
  ["read", "diff"],
  ["cleantext", "diff"],

  // ---------- Time + Wellness ----------
  ["focus", "stretch"],
  ["focus", "breathe"],
  ["breathe", "stretch"],

  // ---------- Cross-cluster bridges ----------
  ["typing", "read"],
  ["typing", "focus"],
  ["typing", "stretch"],
  ["roll", "advice"],

  // ---------- Games ----------
  ["munch", "typing"],
  ["munch", "roll"],

  // NOTE: `lorem` and `case` are currently orphans on the map (no edges
  // survived the Phase 1 cuts). Phase 3 will hand-curate the full edge
  // graph for the smaller toolset and reconnect them.
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
