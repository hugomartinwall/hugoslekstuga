// Theme assignment for the Map view. Each tool gets exactly one cluster — the
// best single description of what it is for. Cross-cluster edges in lib/links.ts
// are intentional bridges, not theme membership.

export type ClusterId =
  | "files"
  | "writing"
  | "time"
  | "wellness"
  | "creative"
  | "code";

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
  code: {
    id: "code",
    label: "Code",
    color: "#0d9488",
    description: "Pixels, CSS, patterns",
  },
};

export const CLUSTER_ORDER: ClusterId[] = [
  "files",
  "writing",
  "time",
  "wellness",
  "creative",
  "code",
];

export const TOOL_CLUSTER: Record<string, ClusterId> = {
  // Files
  convert: "files",
  pdf: "files",
  squeeze: "files",
  qr: "files",
  strip: "files",
  trace: "files",
  ascii: "files",
  base64: "files",
  favicon: "files",
  sift: "files",
  // Writing
  read: "writing",
  markdown: "writing",
  diff: "writing",
  slug: "writing",
  case: "writing",
  cleantext: "writing",
  lorem: "writing",
  bionic: "writing",
  sum: "writing",
  // Time
  focus: "time",
  talk: "time",
  until: "time",
  zones: "time",
  ago: "time",
  plus: "time",
  // Wellness
  feeling: "wellness",
  three: "wellness",
  breathe: "wellness",
  sleep: "wellness",
  stretch: "wellness",
  advice: "wellness",
  tally: "wellness",
  noise: "wellness",
  typing: "wellness",
  // Creative
  palette: "creative",
  sketch: "creative",
  idea: "creative",
  roll: "creative",
  tip: "creative",
  picker: "creative",
  scale: "creative",
  mash: "creative",
  // Code (new)
  gradient: "code",
  contrast: "code",
  shadow: "code",
  easing: "code",
  regex: "code",
};

export function clusterFor(slug: string): ClusterId | undefined {
  return TOOL_CLUSTER[slug];
}

export function sameCluster(a: string, b: string): boolean {
  const ca = TOOL_CLUSTER[a];
  const cb = TOOL_CLUSTER[b];
  return ca !== undefined && ca === cb;
}
