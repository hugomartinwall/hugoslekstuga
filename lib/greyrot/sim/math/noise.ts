/**
 * Deterministic noise — shared pure math.
 *
 * This lives under src/sim/ because the SIMULATION owns the ground truth of
 * the world (walkability needs the heightfield), and the architecture guard
 * forbids sim→render imports. The renderer imports from here instead — that
 * direction is allowed. Moved verbatim from render/mesh/dsl.ts; the mesh
 * fingerprint manifest depends on these exact values, so any change here must
 * be intentional and re-snapshotted.
 *
 * Everything is integer/multiply/floor arithmetic — IEEE-exact on every
 * platform, which is what lets world generation participate in determinism.
 */

export type NVec3 = [number, number, number];

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise in 3D. Cheap, tileable enough for surface detail. */
export function valueNoise(seed: number): (p: NVec3) => number {
  const perm = new Uint8Array(512);
  const r = mulberry32(seed);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = base[i]!;
    base[i] = base[j]!;
    base[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255]!;

  const grad = (h: number, x: number, y: number, z: number): number => {
    switch (h & 3) {
      case 0:
        return x + y;
      case 1:
        return -x + z;
      case 2:
        return y - z;
      default:
        return -y + x;
    }
  };
  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

  return (p: NVec3): number => {
    const xi = Math.floor(p[0]) & 255;
    const yi = Math.floor(p[1]) & 255;
    const zi = Math.floor(p[2]) & 255;
    const xf = p[0] - Math.floor(p[0]);
    const yf = p[1] - Math.floor(p[1]);
    const zf = p[2] - Math.floor(p[2]);
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);
    const a = perm[xi]! + yi;
    const b = perm[xi + 1]! + yi;
    const aa = perm[a]! + zi;
    const ab = perm[a + 1]! + zi;
    const ba = perm[b]! + zi;
    const bb = perm[b + 1]! + zi;
    return lerp(
      lerp(
        lerp(grad(perm[aa]!, xf, yf, zf), grad(perm[ba]!, xf - 1, yf, zf), u),
        lerp(grad(perm[ab]!, xf, yf - 1, zf), grad(perm[bb]!, xf - 1, yf - 1, zf), u),
        v,
      ),
      lerp(
        lerp(grad(perm[aa + 1]!, xf, yf, zf - 1), grad(perm[ba + 1]!, xf - 1, yf, zf - 1), u),
        lerp(
          grad(perm[ab + 1]!, xf, yf - 1, zf - 1),
          grad(perm[bb + 1]!, xf - 1, yf - 1, zf - 1),
          u,
        ),
        v,
      ),
      w,
    );
  };
}
