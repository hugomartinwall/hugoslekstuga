/**
 * Format a byte count as a human-readable string. Three tiers — B, KB, MB —
 * which is enough for every file the toolbox handles (PDFs, images, CSVs).
 * If we ever ship a tool that handles GB-scale files, extend here.
 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
