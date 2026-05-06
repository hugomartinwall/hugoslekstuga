export type Hsl = { h: number; s: number; l: number };
export type Rgb = { r: number; g: number; b: number };

export type Harmony = {
  name: string;
  description: string;
  hexes: string[];
};

export function isHex(s: string): boolean {
  return /^#?[0-9a-fA-F]{6}$/.test(s.trim()) || /^#?[0-9a-fA-F]{3}$/.test(s.trim());
}

export function normalizeHex(s: string): string | null {
  let v = s.trim().toLowerCase();
  if (v.startsWith("#")) v = v.slice(1);
  if (/^[0-9a-f]{3}$/.test(v)) {
    v = v.split("").map((c) => c + c).join("");
  }
  if (/^[0-9a-f]{6}$/.test(v)) return `#${v}`;
  return null;
}

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex(rgb: Rgb): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(rgb.r)}${c(rgb.g)}${c(rgb.b)}`;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h *= 60;
  }
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hh = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: Math.round(f(hh + 1 / 3) * 255),
    g: Math.round(f(hh) * 255),
    b: Math.round(f(hh - 1 / 3) * 255),
  };
}

export function rotateHue(hex: string, deg: number): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb({ ...hsl, h: hsl.h + deg }));
}

export function harmonies(baseHex: string): Harmony[] {
  return [
    {
      name: "Complementary",
      description: "Sits opposite on the color wheel. Maximum punch.",
      hexes: [rotateHue(baseHex, 180)],
    },
    {
      name: "Analogous",
      description: "Neighbors on the wheel. Calm, harmonious.",
      hexes: [rotateHue(baseHex, -30), rotateHue(baseHex, 30)],
    },
    {
      name: "Triadic",
      description: "Evenly spaced. Vibrant balance.",
      hexes: [rotateHue(baseHex, 120), rotateHue(baseHex, 240)],
    },
    {
      name: "Split-complement",
      description: "Softer than pure complementary. Friendlier contrast.",
      hexes: [rotateHue(baseHex, 150), rotateHue(baseHex, 210)],
    },
  ];
}

// Relative luminance (sRGB), per WCAG 2.x.
function relLum({ r, g, b }: Rgb): number {
  const f = (c: number) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(aHex: string, bHex: string): number {
  const la = relLum(hexToRgb(aHex));
  const lb = relLum(hexToRgb(bHex));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function preferredText(hex: string): "#1a1812" | "#fbf6ee" {
  return contrast(hex, "#1a1812") >= contrast(hex, "#fbf6ee")
    ? "#1a1812"
    : "#fbf6ee";
}

export function wcagBadge(ratio: number): { tier: string; tone: "ok" | "warn" } {
  if (ratio >= 7) return { tier: "AAA", tone: "ok" };
  if (ratio >= 4.5) return { tier: "AA", tone: "ok" };
  if (ratio >= 3) return { tier: "AA Large", tone: "warn" };
  return { tier: "Low", tone: "warn" };
}

export function randomBaseHex(): string {
  // Random hue, comfortable saturation/lightness band.
  const h = Math.floor(Math.random() * 360);
  const s = 0.55 + Math.random() * 0.25; // 55–80%
  const l = 0.45 + Math.random() * 0.15; // 45–60%
  return rgbToHex(hslToRgb({ h, s, l }));
}
