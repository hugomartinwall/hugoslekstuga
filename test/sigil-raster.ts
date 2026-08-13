import type { Poly, Sigil } from "../lib/overrun/render/sigil";

/**
 * Test-only helpers: a tiny polygon rasteriser and a colour-vision simulator.
 *
 * Deliberately NOT in src/ — none of this ships. The sigils are polygons
 * precisely so this can be twenty lines of even-odd scan rather than a bezier
 * flattener.
 */

const inPoly = (poly: Poly, x: number, y: number): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/**
 * Rasterise a sigil into an n×n boolean grid over [-1,1]².
 * `squashY` models the camera's 6% vertical tilt compression.
 */
export function raster(s: Sigil, n: number, squashY = 1): boolean[] {
  const g = new Array<boolean>(n * n).fill(false);
  for (let py = 0; py < n; py++) {
    const y = ((py + 0.5) / n) * 2 - 1;
    for (let px = 0; px < n; px++) {
      const x = ((px + 0.5) / n) * 2 - 1;
      for (const poly of s.polys) {
        if (inPoly(poly, x, y / squashY)) {
          g[py * n + px] = true;
          break;
        }
      }
    }
  }
  return g;
}

export const filled = (g: readonly boolean[]): number => g.reduce((a, b) => a + (b ? 1 : 0), 0);

/** Jaccard distance over the union — Hamming would be swamped by empty space. */
export function jaccard(a: readonly boolean[], b: readonly boolean[]): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] || b[i]) union++;
    if (a[i] && b[i]) inter++;
  }
  return union === 0 ? 0 : 1 - inter / union;
}

/** Largest k for which every polygon survives a k-cell binary erosion. */
export function minFeatureCells(s: Sigil, n: number, squashY = 1): number {
  let g = raster(s, n, squashY);
  const at = (grid: readonly boolean[], x: number, y: number) =>
    x < 0 || y < 0 || x >= n || y >= n ? false : grid[y * n + x]!;
  for (let k = 0; k < n; k++) {
    const next = new Array<boolean>(n * n).fill(false);
    let any = false;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const keep =
          at(g, x, y) && at(g, x - 1, y) && at(g, x + 1, y) && at(g, x, y - 1) && at(g, x, y + 1);
        next[y * n + x] = keep;
        if (keep) any = true;
      }
    }
    if (!any) return k; // eroded away after k passes
    g = next;
  }
  return n;
}

/* ------------------------------------------------ colour vision simulation */

const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const toLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Brettel/Viénot-style dichromacy simulation on linear RGB.
 * Approximate, but more than good enough to catch two faction colours
 * collapsing onto each other.
 */
export type CVD = "deuteranopia" | "protanopia" | "tritanopia";

const MAT: Record<CVD, number[]> = {
  // rows: r,g,b coefficients
  protanopia: [0.1121, 0.8853, -0.0005, 0.1127, 0.8897, -0.0001, 0.0045, 0.0085, 1.0],
  deuteranopia: [0.292, 0.7054, -0.0003, 0.2934, 0.7089, 0.0004, -0.0195, 0.0333, 1.0],
  tritanopia: [1.0, 0.1483, -0.1471, 0.0, 0.8672, 0.1332, 0.0, 0.2394, 0.7559],
};

/** Returns simulated linear-RGB, which is what the separation metric compares. */
export function simulate(hex: string, kind: CVD): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as [number, number, number];
  const m = MAT[kind];
  return [
    m[0]! * r + m[1]! * g + m[2]! * b,
    m[3]! * r + m[4]! * g + m[5]! * b,
    m[6]! * r + m[7]! * g + m[8]! * b,
  ];
}

/** Euclidean distance in simulated linear RGB. 0 = indistinguishable. */
export function cvdDistance(a: string, b: string, kind: CVD): number {
  const x = simulate(a, kind);
  const y = simulate(b, kind);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
