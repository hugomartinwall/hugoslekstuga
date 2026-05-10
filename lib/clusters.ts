// Theme assignment for the Map view. Each tool gets exactly one cluster — the
// best single description of what it is for. Cross-cluster edges in lib/links.ts
// are intentional bridges, not theme membership.

export type ClusterId =
  | "files"
  | "writing"
  | "time"
  | "wellness"
  | "creative"
  | "games";

export type Cluster = {
  id: ClusterId;
  label: string;
  /** Hex used to tint intra-cluster edges and the legend pill. */
  color: string;
  description: string;
};

export const CLUSTERS: Record<ClusterId, Cluster> = {
  files: {
    id: "files",
    label: "Files",
    color: "#f97316",
    description: "Sharing & shaping documents",
  },
  writing: {
    id: "writing",
    label: "Writing",
    color: "#4f66f2",
    description: "Text in, text out",
  },
  time: {
    id: "time",
    label: "Time",
    color: "#ffc233",
    description: "Pacing & coordination",
  },
  wellness: {
    id: "wellness",
    label: "Wellness",
    color: "#3fa66e",
    description: "Body & mind",
  },
  creative: {
    id: "creative",
    label: "Creative",
    color: "#ff7ab2",
    description: "Visual & generative",
  },
  games: {
    id: "games",
    label: "Games",
    color: "#9333ea",
    description: "Quick play, sharable scores",
  },
};

export const CLUSTER_ORDER: ClusterId[] = [
  "files",
  "writing",
  "time",
  "wellness",
  "creative",
  "games",
];

export const TOOL_CLUSTER: Record<string, ClusterId> = {
  // Files
  convert: "files",
  pdf: "files",
  qr: "files",
  strip: "files",
  // Writing
  read: "writing",
  diff: "writing",
  case: "writing",
  cleantext: "writing",
  lorem: "writing",
  // Time
  focus: "time",
  // Wellness
  breathe: "wellness",
  stretch: "wellness",
  advice: "wellness",
  typing: "wellness",
  // Creative
  roll: "creative",
  // Games
  munch: "games",
};

export function clusterFor(slug: string): ClusterId | undefined {
  return TOOL_CLUSTER[slug];
}

export function sameCluster(a: string, b: string): boolean {
  const ca = TOOL_CLUSTER[a];
  const cb = TOOL_CLUSTER[b];
  return ca !== undefined && ca === cb;
}

/**
 * The route a tool lives at. Most tools are under /tools/<slug>; games
 * get their own /games/<slug> prefix so the URL reads honestly as a
 * game and not yet-another-utility.
 */
export function pathFor(slug: string): string {
  return TOOL_CLUSTER[slug] === "games" ? `/games/${slug}` : `/tools/${slug}`;
}

/**
 * Readable text colour to layer on top of a cluster's accent. Time (yellow)
 * and Creative (pink) take ink; the other clusters take cream. Mirrors the
 * tool-color rule in lib/colors.ts but indexed by cluster instead of accent.
 */
export function preferredTextOnCluster(id: ClusterId): "#1a1812" | "#fbf6ee" {
  return id === "time" || id === "creative" ? "#1a1812" : "#fbf6ee";
}
