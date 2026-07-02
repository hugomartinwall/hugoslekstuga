"use client";

/**
 * Lördagsmorgon — Saturday-morning cel.
 *
 * The interface IS the cartoon: boiling ink outlines (3 seeded path
 * variants swapped at 8fps), halftone-dot shadows, die-cut sticker
 * buttons, squash-and-stretch with anticipation. Idle motion runs at
 * 8–12fps via steps()/step-end so the page feels drawn, not tweened.
 *
 * Everything is namespaced: selectors under `.skin-sat`, keyframes
 * `sat-*`, fonts from --font-sat-display / --font-sat-body (set by
 * page.tsx). No house tokens are touched.
 *
 * SSR notes: all module-scope randomness is seeded (mulberry32), so
 * server and client render identical markup. Anything that needs
 * window (rAF physics, ResizeObserver, matchMedia, pointer tracking)
 * starts in useEffect / useSyncExternalStore.
 */

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";

/* ------------------------------------------------------------------ */
/* Seeded randomness + wobbly-path helpers (the boiling line)          */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pt = [number, number];

/** Smooth closed path through midpoints; corners become control points,
 *  which rounds them off like a fast pen stroke. */
function smoothLoop(pts: Pt[]): string {
  const n = pts.length;
  const mid = (p: Pt, q: Pt): Pt => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const m0 = mid(pts[n - 1], pts[0]);
  let d = `M${m0[0].toFixed(1)} ${m0[1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const m = mid(p, pts[(i + 1) % n]);
    d += ` Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
  }
  return d + "Z";
}

/** One wobbly hand-drawn rectangle outline. Same seed → same wobble. */
function wobblyRectPath(
  w: number,
  h: number,
  seed: number,
  inset = 4.5,
  amp = 1.6,
): string {
  const rnd = mulberry32(Math.round(seed));
  const j = () => (rnd() * 2 - 1) * amp;
  const pts: Pt[] = [];
  const x0 = inset;
  const y0 = inset;
  const x1 = w - inset;
  const y1 = h - inset;
  const walk = (ax: number, ay: number, bx: number, by: number) => {
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(2, Math.round(len / 26));
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      pts.push([ax + (bx - ax) * t + j(), ay + (by - ay) * t + j()]);
    }
  };
  walk(x0, y0, x1, y0);
  walk(x1, y0, x1, y1);
  walk(x1, y1, x0, y1);
  walk(x0, y1, x0, y0);
  return smoothLoop(pts);
}

/** Wobbly ellipse/circle outline (timer ring, Hugo, the sun). */
function wobblyEllipsePath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: number,
  amp = 2.2,
  segs = 18,
): string {
  const rnd = mulberry32(Math.round(seed));
  const pts: Pt[] = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const wob = 1 + ((rnd() * 2 - 1) * amp) / Math.min(rx, ry);
    pts.push([cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob]);
  }
  return smoothLoop(pts);
}

/** Open wobbly horizontal stroke (the ground line). */
function wobblyLinePath(
  x0: number,
  x1: number,
  y: number,
  seed: number,
  amp = 3,
  step = 34,
): string {
  const rnd = mulberry32(Math.round(seed));
  const pts: Pt[] = [];
  const n = Math.max(2, Math.round((x1 - x0) / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([x0 + (x1 - x0) * t, y + (rnd() * 2 - 1) * amp]);
  }
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const m: Pt = [
      (pts[i][0] + pts[i + 1][0]) / 2,
      (pts[i][1] + pts[i + 1][1]) / 2,
    ];
    d += ` Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L${last[0].toFixed(1)} ${last[1].toFixed(1)}`;
  return d;
}

/* ------------------------------------------------------------------ */
/* Shared hooks                                                        */
/* ------------------------------------------------------------------ */

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(cb: () => void) {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const getReducedMotion = () => window.matchMedia(REDUCED_QUERY).matches;
const getReducedMotionServer = () => false;

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    getReducedMotionServer,
  );
}

/** Steps 0 → count-1 at a hand-animation frame rate. Frozen when idle. */
function useBoilFrame(active: boolean, count = 3, fps = 8): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(
      () => setFrame((f) => (f + 1) % count),
      Math.round(1000 / fps),
    );
    return () => window.clearInterval(id);
  }, [active, count, fps]);
  return frame;
}

/* ------------------------------------------------------------------ */
/* Fixed, deterministic art (module scope = identical on server)       */
/* ------------------------------------------------------------------ */

const H1_TEXT = "lördagsmorgon";
const h1Rng = mulberry32(19790614);
/** Frozen per-letter baseline jitter, ±2px. Never animated. */
const H1_OFFSETS = Array.from(H1_TEXT, () =>
  Math.round((h1Rng() * 4 - 2) * 10) / 10,
);

const ACCENTS = [
  { name: "fire red", hex: "#F5402C" },
  { name: "cobalt", hex: "#2B5DF5" },
  { name: "sunshine", hex: "#FFC800" },
  { name: "bubblegum", hex: "#FF4F9A" },
  { name: "grass", hex: "#2FB25B" },
  { name: "grape", hex: "#7A3FF2" },
  { name: "tangerine", hex: "#FF7A1A" },
  { name: "pool cyan", hex: "#29B6E8" },
];

/** Timer ring — 3 boil frames, viewBox 230×130. */
const TIMER_PATHS = [0, 1, 2].map((f) =>
  wobblyEllipsePath(115, 65, 101, 52, 880 + f * 3, 2.6, 20),
);

/** Hugo's body — 3 boil frames, viewBox 160×170. */
const HUGO_BODY_PATHS = [0, 1, 2].map((f) =>
  wobblyEllipsePath(80, 78, 54, 52, 4200 + f * 7, 2.6, 22),
);

const SUN_DISC_PATH = wobblyEllipsePath(60, 60, 26, 26, 314, 1.8, 16);
const sunRng = mulberry32(45);
const SUN_RAYS = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2 + 0.19;
  const r1 = 33 + sunRng() * 2;
  const r2 = 43 + sunRng() * 4;
  return {
    x1: 60 + Math.cos(a) * r1,
    y1: 60 + Math.sin(a) * r1,
    x2: 60 + Math.cos(a) * r2,
    y2: 60 + Math.sin(a) * r2,
  };
});

const GRASS_LINE = wobblyLinePath(0, 1000, 10, 77, 3.2, 34);
const GRASS_TUFTS = [
  "M118 9 c-2 -4 -3 -6 -2 -9 M126 9 c0 -4 1 -6 3 -9 M133 9 c2 -3 4 -5 7 -6",
  "M498 9 c-2 -4 -2 -7 -1 -9 M506 10 c0 -5 2 -7 4 -9 M513 10 c2 -3 5 -4 8 -5",
  "M858 9 c-2 -4 -3 -6 -2 -9 M866 9 c1 -4 2 -6 4 -8 M873 10 c2 -3 4 -5 7 -6",
];

const GRASS_H = 84;
const GRAVITY = 2400;

/** The recess vignette cast: six survivors as bouncing cel balls. */
const BALL_TOOLS = [
  { name: "Advice", color: "#7A3FF2" },
  { name: "Focus", color: "#2B5DF5" },
  { name: "Roll", color: "#F5402C" },
  { name: "Breathe", color: "#29B6E8" },
  { name: "Sudoku", color: "#FFC800" },
  { name: "Sjökort", color: "#2FB25B" },
];
const ballRng = mulberry32(20260702);
const BALLS = BALL_TOOLS.map((t, i) => ({
  ...t,
  xf: 0.09 + ((i + 0.5) / BALL_TOOLS.length) * 0.82 + (ballRng() - 0.5) * 0.05,
  r: Math.round(19 + ballRng() * 9),
  y0f: 0.12 + ballRng() * 0.33,
  kick: 560 + ballRng() * 260,
  delay: 950 + i * 210,
  tilt: Math.round((ballRng() * 6 - 3) * 10) / 10,
}));

/** Hugo's hop, frame by frame at ~13fps: anticipation dip → squash →
 *  launch (legs out) → apex → fall → landing squash → settle. */
const HOP_FRAMES: { t: string; legs?: boolean }[] = [
  { t: "translateY(2px) scale(1.04, 0.95)" },
  { t: "translateY(5px) scale(1.12, 0.84)" },
  { t: "translateY(-24px) scale(0.92, 1.15)", legs: true },
  { t: "translateY(-42px) scale(0.99, 1.04)", legs: true },
  { t: "translateY(-26px) scale(0.96, 1.08)", legs: true },
  { t: "translateY(2px) scale(1.14, 0.82)" },
  { t: "translateY(0) scale(1.05, 0.96)" },
  { t: "none" },
];

/* ------------------------------------------------------------------ */
/* BoilBox — a white cel with a boiling ink outline + halftone shadow  */
/* ------------------------------------------------------------------ */

type BoilBoxProps = {
  seed: number;
  /** Accent hex for the halftone-dot drop shadow. Omit for no shadow. */
  shadow?: string;
  className?: string;
  celClassName?: string;
  children: ReactNode;
};

function BoilBox({
  seed,
  shadow,
  className = "",
  celClassName = "",
  children,
}: BoilBoxProps) {
  const reduced = usePrefersReducedMotion();
  const celRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const frame = useBoilFrame(!reduced && size !== null, 3, 8);

  useEffect(() => {
    const el = celRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const paths = useMemo(() => {
    if (!size) return null;
    return [0, 1, 2].map((f) => wobblyRectPath(size.w, size.h, seed * 97 + f * 13));
  }, [size, seed]);

  return (
    <div className={`sat-shadowed ${className}`}>
      {shadow ? (
        <div
          aria-hidden
          className="sat-dots"
          style={{ "--sat-halftone": shadow } as CSSProperties}
        />
      ) : null}
      <div
        ref={celRef}
        className={`sat-cel ${paths ? "sat-cel-live" : ""} ${celClassName}`}
      >
        {paths && size ? (
          <svg
            aria-hidden
            className="sat-cel-line"
            width={size.w}
            height={size.h}
            viewBox={`0 0 ${size.w} ${size.h}`}
          >
            <path d={paths[frame % paths.length]} />
          </svg>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* DustPuff — 4 drawn puff frames at ~10fps, plays once on mount       */
/* ------------------------------------------------------------------ */

function DustPuff({
  className = "",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden
      className={`sat-puff ${className}`}
      style={style}
      viewBox="0 0 80 40"
      width={80}
      height={40}
    >
      <g className="sat-pf sat-pf1">
        <circle cx="34" cy="30" r="4" />
        <circle cx="45" cy="28" r="5" />
      </g>
      <g className="sat-pf sat-pf2">
        <circle cx="26" cy="28" r="6" />
        <circle cx="40" cy="24" r="7" />
        <circle cx="53" cy="28" r="5" />
      </g>
      <g className="sat-pf sat-pf3">
        <circle cx="18" cy="26" r="5" />
        <circle cx="33" cy="20" r="7" />
        <circle cx="48" cy="22" r="6" />
        <circle cx="61" cy="26" r="4" />
      </g>
      <g className="sat-pf sat-pf4">
        <circle cx="12" cy="24" r="4" />
        <circle cx="34" cy="15" r="5" />
        <circle cx="58" cy="20" r="4" />
        <circle cx="69" cy="26" r="3" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* DrawnField — hand-drawn input; focus = faster boil + scribble       */
/* ------------------------------------------------------------------ */

function DrawnField({
  label,
  accent,
  defaultValue,
  placeholder,
}: {
  label: string;
  accent: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <label
      className="sat-field flex w-full flex-col gap-1.5"
      style={{ "--sat-accent": accent } as CSSProperties}
    >
      <span className="sat-field-label">{label}</span>
      <input
        type="text"
        className="sat-input"
        defaultValue={defaultValue}
        placeholder={placeholder}
      />
      <svg
        aria-hidden
        className="sat-scribble"
        viewBox="0 0 240 10"
        preserveAspectRatio="none"
      >
        <path
          pathLength={1}
          vectorEffect="non-scaling-stroke"
          d="M3 7 Q14 2 26 6 T52 5 T78 7 T104 4 T130 7 T156 5 T182 7 T208 5 T237 6"
        />
      </svg>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Section 1 — header                                                  */
/* ------------------------------------------------------------------ */

function Header() {
  return (
    <header className="flex flex-col gap-4">
      <p className="sat-kicker">rebrand direction 01 · saturday-morning cel</p>
      <h1 className="sat-h1" aria-label={H1_TEXT}>
        {Array.from(H1_TEXT).map((ch, i) => (
          <span
            key={i}
            aria-hidden
            style={{ transform: `translateY(${H1_OFFSETS[i]}px)` }}
          >
            {ch}
          </span>
        ))}
      </h1>
      <p className="sat-lede">
        the interface is a cartoon: ink that boils at eight frames a second,
        halftone shadows, and not one straight line in the building.
      </p>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Section 2 — specimen strip                                          */
/* ------------------------------------------------------------------ */

function Specimen() {
  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h2 className="sat-h2">the specimen sheet</h2>
        <p className="sat-note">
          palette, type, stickers, cels — the kit every page gets built from.
        </p>
      </div>

      <ul className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
        {ACCENTS.map((a) => (
          <li key={a.hex} className="sat-chip">
            <div className="sat-chip-swatch" style={{ background: a.hex }} />
            <p className="sat-chip-name">{a.name}</p>
            <p className="sat-chip-hex">{a.hex}</p>
          </li>
        ))}
      </ul>

      <div>
        <p className="sat-type-display">saturday morning, forever</p>
        <p className="sat-type-body">
          every tool does one thing, sharply. no ads, no accounts, no cookie
          banner — open a tab, use it, close it. the whole interface is drawn
          by hand, and it refuses to apologise.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-5">
        <figure className="flex flex-col items-center gap-2">
          <span
            className="sat-btn sat-btn-demo"
            style={{ "--sat-accent": "#2B5DF5" } as CSSProperties}
          >
            start
          </span>
          <figcaption className="sat-note">default</figcaption>
        </figure>
        <figure className="flex flex-col items-center gap-2">
          <span
            className="sat-btn sat-btn-demo sat-btn-demo-hover"
            style={{ "--sat-accent": "#2B5DF5" } as CSSProperties}
          >
            start
          </span>
          <figcaption className="sat-note">hover</figcaption>
        </figure>
        <figure className="flex flex-col items-center gap-2">
          <span
            className="sat-btn sat-btn-demo sat-btn-demo-active"
            style={{ "--sat-accent": "#2B5DF5" } as CSSProperties}
          >
            start
          </span>
          <figcaption className="sat-note">active</figcaption>
        </figure>
        <figure className="flex flex-col items-center gap-2">
          <button
            type="button"
            className="sat-btn"
            style={{ "--sat-accent": "#F5402C" } as CSSProperties}
          >
            press me
          </button>
          <figcaption className="sat-note">live — press it</figcaption>
        </figure>
      </div>

      <div className="max-w-md">
        <DrawnField
          label="intention, generally"
          accent="#7A3FF2"
          placeholder="click me, then type"
        />
      </div>

      <BoilBox seed={11} shadow="#FF4F9A" className="max-w-sm" celClassName="p-5">
        <div className="flex flex-col items-start gap-2">
          <p className="sat-card-title">advice</p>
          <p className="sat-card-body">
            one aphorism a day. no archive, no scroll. come back tomorrow.
          </p>
          <span
            className="sat-btn sat-btn-demo sat-btn-sm"
            style={{ "--sat-accent": "#FF4F9A" } as CSSProperties}
          >
            open
          </span>
        </div>
      </BoilBox>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Section 3 — recess (mini-homepage vignette)                         */
/* ------------------------------------------------------------------ */

function Recess() {
  const reduced = usePrefersReducedMotion();
  const sceneRef = useRef<HTMLDivElement>(null);
  const ballRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [puffs, setPuffs] = useState<
    { id: number; leftPct: number; topPx: number }[]
  >([]);

  useEffect(() => {
    if (reduced) return;
    const scene = sceneRef.current;
    if (!scene) return;
    const H = scene.getBoundingClientRect().height;
    const floor = H - GRASS_H + 10; // ball bottoms sink a touch into grass
    const state = BALLS.map((b) => ({
      y: H * b.y0f,
      vy: 0,
      born: false,
      impact: -1e9,
    }));
    const t0 = performance.now();
    let last = t0;
    let lastCommit = 0;
    let raf = 0;

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const elapsed = now - t0;

      state.forEach((s, i) => {
        const b = BALLS[i];
        if (!s.born) {
          if (elapsed < b.delay) return;
          s.born = true;
          setPuffs((p) => [
            ...p,
            { id: i, leftPct: b.xf * 100, topPx: s.y - b.r - 12 },
          ]);
        }
        s.vy += GRAVITY * dt;
        s.y += s.vy * dt;
        if (s.y >= floor && s.vy > 0) {
          s.y = floor;
          // never let the playground go quiet: bounce at least `kick`
          s.vy = -Math.max(Math.abs(s.vy) * 0.55, b.kick);
          s.impact = now;
        }
      });

      // commit to the DOM at 12fps — drawn, not tweened
      if (now - lastCommit >= 1000 / 12) {
        lastCommit = now;
        state.forEach((s, i) => {
          const el = ballRefs.current[i];
          if (!el || !s.born) return;
          const b = BALLS[i];
          const since = (now - s.impact) / 1000;
          let sx = 1;
          let sy = 1;
          if (since < 0.13) {
            const a = 1 - since / 0.13;
            sx = 1 + 0.24 * a;
            sy = 1 - 0.3 * a;
          } else if (Math.abs(s.vy) > 900) {
            const st = Math.min((Math.abs(s.vy) - 900) / 2800, 0.12);
            sy = 1 + st;
            sx = 1 - st * 0.7;
          }
          el.style.transform = `translateY(${(s.y - b.r * 2).toFixed(1)}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
        });
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="sat-h2">recess</h2>
        <p className="sat-note">
          the homepage as a playground — the tools bounce until somebody opens
          one. hover the sun.
        </p>
      </div>

      <BoilBox seed={23} shadow="#2FB25B">
        <div ref={sceneRef} className="sat-vignette">
          <svg className="sat-cloud sat-cloud-a" viewBox="0 0 120 44" aria-hidden>
            <path d="M14 36 Q3 36 5 27 Q7 18 17 20 Q19 9 31 10 Q40 3 48 11 Q59 7 62 17 Q73 15 74 25 Q84 24 82 32 Q80 38 70 37 Z" />
          </svg>
          <svg className="sat-cloud sat-cloud-b" viewBox="0 0 120 44" aria-hidden>
            <path d="M14 36 Q3 36 5 27 Q7 18 17 20 Q19 9 31 10 Q40 3 48 11 Q59 7 62 17 Q73 15 74 25 Q84 24 82 32 Q80 38 70 37 Z" />
          </svg>

          <svg className="sat-sun" viewBox="0 0 120 120" aria-hidden>
            <g className="sat-sun-rays">
              {SUN_RAYS.map((r, i) => (
                <line
                  key={i}
                  x1={r.x1.toFixed(1)}
                  y1={r.y1.toFixed(1)}
                  x2={r.x2.toFixed(1)}
                  y2={r.y2.toFixed(1)}
                />
              ))}
            </g>
            <path className="sat-sun-disc" d={SUN_DISC_PATH} />
            <g className="sat-sun-open">
              <circle cx="52" cy="56" r="3" />
              <circle cx="68" cy="56" r="3" />
            </g>
            <g className="sat-sun-shut">
              <path d="M47 56 Q52 60 57 56" />
              <path d="M63 56 Q68 60 73 56" />
            </g>
            <path className="sat-sun-smile" d="M51 66 Q60 73 69 66" />
          </svg>

          <div className="sat-grass" aria-hidden>
            <div className="sat-grass-fill" />
            <svg
              className="sat-groundline"
              viewBox="0 0 1000 24"
              preserveAspectRatio="none"
            >
              <path
                className="sat-line"
                d={GRASS_LINE}
                pathLength={1}
                vectorEffect="non-scaling-stroke"
              />
              {GRASS_TUFTS.map((d, i) => (
                <path
                  key={i}
                  className="sat-tuft"
                  d={d}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          </div>

          {BALLS.map((b, i) => (
            <div
              key={b.name}
              ref={(el) => {
                ballRefs.current[i] = el;
              }}
              className="sat-ball"
              aria-hidden
              style={
                {
                  left: `calc(${(b.xf * 100).toFixed(2)}% - ${b.r}px)`,
                  width: b.r * 2,
                  height: b.r * 2,
                  background: b.color,
                  ...(reduced
                    ? { top: "auto", bottom: GRASS_H - 10, transform: "none" }
                    : { top: 0, transform: "translateY(-80px) scale(0)" }),
                } as CSSProperties
              }
            />
          ))}

          {BALLS.map((b) => (
            <p
              key={b.name}
              className="sat-tag"
              style={{
                left: `${(b.xf * 100).toFixed(2)}%`,
                transform: `translateX(-50%) rotate(${b.tilt}deg)`,
                animationDelay: `${b.delay + 160}ms`,
              }}
            >
              {b.name}
            </p>
          ))}

          {puffs.map((p) => (
            <DustPuff
              key={p.id}
              style={{
                left: `calc(${p.leftPct.toFixed(2)}% - 40px)`,
                top: p.topPx,
              }}
            />
          ))}
        </div>
      </BoilBox>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Section 4 — Focus, skinned (identical mock across all directions)   */
/* ------------------------------------------------------------------ */

function FocusMock() {
  const reduced = usePrefersReducedMotion();
  const ringFrame = useBoilFrame(!reduced, 3, 8);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="sat-h2">focus, skinned</h2>
        <p className="sat-note">
          the same mock in every direction, so the A/B stays honest.
        </p>
      </div>

      <BoilBox
        seed={37}
        shadow="#2B5DF5"
        className="mx-auto w-full max-w-md"
        celClassName="p-6 sm:p-7"
      >
        <div className="flex flex-col gap-4">
          <Link href="/" className="sat-backlink self-start">
            ← playhouse
          </Link>

          <div className="flex flex-col gap-1">
            <h3 className="sat-focus-title">Focus</h3>
            <p className="sat-focus-tagline">Set an intention. Start the timer.</p>
          </div>

          <DrawnField
            label="Intention"
            accent="#2B5DF5"
            defaultValue="write the newsletter"
          />

          <div className="flex flex-wrap gap-2" role="group" aria-label="presets">
            <button type="button" className="sat-pill" aria-pressed="false">
              15 min
            </button>
            <button
              type="button"
              className="sat-pill sat-pill-on"
              aria-pressed="true"
            >
              25 min
            </button>
            <button type="button" className="sat-pill" aria-pressed="false">
              45 min
            </button>
          </div>

          <div className="sat-timer">
            <svg viewBox="0 0 230 130" aria-hidden>
              <path d={TIMER_PATHS[ringFrame % TIMER_PATHS.length]} />
            </svg>
            <p className="sat-timer-digits">12:34</p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              className="sat-btn"
              style={{ "--sat-accent": "#2B5DF5" } as CSSProperties}
            >
              Start
            </button>
            <button type="button" className="sat-btn sat-btn-ghost">
              Brown noise — off
            </button>
          </div>

          <div className="flex items-center justify-center gap-3">
            <svg
              className="sat-tally"
              viewBox="0 0 32 22"
              width={32}
              height={22}
              aria-hidden
            >
              <path d="M7 3 C7.4 8 6.8 14 6.2 19" />
              <path d="M16 2.6 C16.2 8 15.8 13 15.4 19.4" />
              <path d="M25 3.4 C25.6 8 25 14 24.4 19" />
            </svg>
            <p className="sat-focus-foot">Today: 3 sessions · 75 min</p>
          </div>
        </div>
      </BoilBox>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Section 5 — mini-Hugo (live drawn mascot)                           */
/* ------------------------------------------------------------------ */

function HugoPanel() {
  const reduced = usePrefersReducedMotion();
  const bodyFrame = useBoilFrame(!reduced, 3, 8);
  const [blink, setBlink] = useState(false);
  const [hopFrame, setHopFrame] = useState(-1); // -1 = idle
  const [hopId, setHopId] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const pupilsRef = useRef<SVGGElement>(null);
  const hopTimer = useRef<number | null>(null);

  // blink every 3–8s (reduced motion: eyes just stay open)
  useEffect(() => {
    if (reduced) return;
    let alive = true;
    let t1 = 0;
    let t2 = 0;
    const loop = () => {
      t1 = window.setTimeout(() => {
        if (!alive) return;
        setBlink(true);
        t2 = window.setTimeout(() => {
          if (!alive) return;
          setBlink(false);
          loop();
        }, 140);
      }, 3000 + Math.random() * 5000);
    };
    loop();
    return () => {
      alive = false;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [reduced]);

  // pupils track the pointer (user-driven, so allowed under reduced motion)
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const svg = svgRef.current;
      const g = pupilsRef.current;
      if (!svg || !g) return;
      const r = svg.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height * 0.42;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const len = Math.hypot(dx, dy) || 1;
      const m = Math.min(len / 40, 1) * 3.5;
      g.setAttribute(
        "transform",
        `translate(${((dx / len) * m).toFixed(1)} ${((dy / len) * m).toFixed(1)})`,
      );
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  useEffect(
    () => () => {
      if (hopTimer.current !== null) window.clearInterval(hopTimer.current);
    },
    [],
  );

  const hop = () => {
    if (reduced || hopFrame >= 0) return;
    setHopId((n) => n + 1);
    setHopFrame(0);
    let i = 0;
    hopTimer.current = window.setInterval(() => {
      i += 1;
      if (i >= HOP_FRAMES.length) {
        if (hopTimer.current !== null) window.clearInterval(hopTimer.current);
        hopTimer.current = null;
        setHopFrame(-1);
      } else {
        setHopFrame(i);
      }
    }, 75);
  };

  const frame = hopFrame >= 0 ? HOP_FRAMES[hopFrame] : null;

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="sat-h2">hugo, inked</h2>
        <p className="sat-note">still the mascot. now with a pulse.</p>
      </div>

      <BoilBox
        seed={53}
        shadow="#FFC800"
        className="mx-auto w-full max-w-sm"
        celClassName="p-6"
      >
        <div className="flex flex-col items-center gap-3">
          <div
            className="sat-hugo-stage"
            role="button"
            tabIndex={0}
            aria-label="hugo. click to make him hop."
            onClick={hop}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                hop();
              }
            }}
          >
            <svg
              ref={svgRef}
              className="sat-hugo"
              viewBox="0 0 160 170"
              style={frame ? { transform: frame.t } : undefined}
            >
              <g
                className="sat-hugo-legs"
                style={{ opacity: frame?.legs ? 1 : 0 }}
              >
                <path d="M68 126 C66 138 64 144 60 152 M60 152 L50 155" />
                <path d="M92 126 C94 138 96 144 100 152 M100 152 L110 155" />
              </g>
              <path
                className="sat-hugo-body"
                d={HUGO_BODY_PATHS[bodyFrame % HUGO_BODY_PATHS.length]}
              />
              <circle className="sat-hugo-blush" cx="52" cy="88" r="6" />
              <circle className="sat-hugo-blush" cx="108" cy="88" r="6" />
              {blink ? (
                <g className="sat-hugo-lids">
                  <path d="M54 66 Q63 74 72 66" />
                  <path d="M88 66 Q97 74 106 66" />
                </g>
              ) : (
                <g>
                  <ellipse className="sat-hugo-eye" cx="63" cy="66" rx="8.5" ry="11.5" />
                  <ellipse className="sat-hugo-eye" cx="97" cy="66" rx="8.5" ry="11.5" />
                  <g ref={pupilsRef}>
                    <circle className="sat-hugo-pupil" cx="63" cy="68" r="3.4" />
                    <circle className="sat-hugo-pupil" cx="97" cy="68" r="3.4" />
                  </g>
                </g>
              )}
            </svg>
            {hopFrame >= 2 ? <DustPuff key={hopId} className="sat-hugo-puff" /> : null}
          </div>
          <p className="sat-caption">click him. go on.</p>
        </div>
      </BoilBox>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* The page                                                            */
/* ------------------------------------------------------------------ */

export default function LordagsmorgonClient() {
  return (
    <div className="skin-sat">
      <style>{css}</style>
      <div className="sat-grain" aria-hidden />
      <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-16 px-5 py-14 sm:px-8 sm:py-16">
        <Header />
        <Specimen />
        <Recess />
        <FocusMock />
        <HugoPanel />
        <p className="sat-foot">
          direction 01 of 03. the other two live in the lab index — pick
          whichever survives a monday morning.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The skin. Every selector is scoped to .skin-sat; every keyframe is  */
/* namespaced sat-*. Nothing here leans on house tokens.               */
/* ------------------------------------------------------------------ */

const css = `
.skin-sat {
  --sat-sky: #DDF1FA;
  --sat-sky-2: #EAF7FD;
  --sat-cel: #FFFFFF;
  --sat-ink: #17233B;
  --sat-ink-soft: #46536E;
  --sat-ink-muted: #8B96AB;
  --sat-cream: #FFF4DC;
  --sat-red: #F5402C;
  --sat-cobalt: #2B5DF5;
  --sat-sunshine: #FFC800;
  --sat-pink: #FF4F9A;
  --sat-grass: #2FB25B;
  --sat-grape: #7A3FF2;
  --sat-tangerine: #FF7A1A;
  --sat-cyan: #29B6E8;
  position: relative;
  min-height: 100dvh;
  background: var(--sat-sky);
  color: var(--sat-ink);
  font-family: var(--font-sat-body), "Nunito", ui-rounded, sans-serif;
  font-size: 16px;
  line-height: 1.55;
  overflow-x: clip;
}

/* static paper grain on the sky — a frozen feTurbulence tile, never animated */
.skin-sat .sat-grain {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.05;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23g)'/%3E%3C/svg%3E");
}

/* ---- type ------------------------------------------------------- */

.skin-sat .sat-kicker {
  font-family: var(--font-sat-display), cursive;
  font-weight: 700;
  font-size: 15px;
  color: var(--sat-ink-soft);
}
.skin-sat .sat-h1 {
  font-family: var(--font-sat-display), cursive;
  font-weight: 800;
  /* min sized so "lördagsmorgon" (13 glyphs) never breaks mid-word at 375px */
  font-size: clamp(2.3rem, 9vw, 6.2rem);
  line-height: 1.02;
  letter-spacing: -0.01em;
  font-variation-settings: "BNCE" 36;
}
.skin-sat .sat-h1 span { display: inline-block; }
.skin-sat .sat-lede {
  max-width: 40rem;
  font-size: 17px;
  color: var(--sat-ink-soft);
}
.skin-sat .sat-h2 {
  font-family: var(--font-sat-display), cursive;
  font-weight: 800;
  font-size: 29px;
  font-variation-settings: "BNCE" 24;
}
.skin-sat .sat-note { font-size: 14.5px; color: var(--sat-ink-muted); }
.skin-sat .sat-type-display {
  font-family: var(--font-sat-display), cursive;
  font-weight: 800;
  font-size: clamp(2rem, 6vw, 3.4rem);
  line-height: 1.05;
  font-variation-settings: "BNCE" 30;
}
.skin-sat .sat-type-body {
  max-width: 36rem;
  margin-top: 10px;
  font-size: 16.5px;
  color: var(--sat-ink-soft);
}
.skin-sat .sat-foot {
  font-size: 14.5px;
  color: var(--sat-ink-soft);
  max-width: 30rem;
}

/* ---- cels (white panels with boiling ink outlines) --------------- */

.skin-sat .sat-shadowed { position: relative; }
.skin-sat .sat-dots {
  position: absolute;
  inset: 0;
  transform: translate(10px, 12px);
  border-radius: 22px 12px 24px 14px / 14px 24px 12px 22px;
  background-image: radial-gradient(var(--sat-halftone, var(--sat-cobalt)) 1.7px, transparent 1.9px);
  background-size: 9px 9px;
}
.skin-sat .sat-cel {
  position: relative;
  background: var(--sat-cel);
  border: 3px solid var(--sat-ink); /* pencil fallback until measured */
  border-radius: 13px 11px 14px 12px / 12px 14px 11px 13px;
}
.skin-sat .sat-cel-live { border-color: transparent; }
.skin-sat .sat-cel-line {
  position: absolute;
  top: -3px;
  left: -3px;
  pointer-events: none;
  overflow: visible;
}
.skin-sat .sat-cel-line path {
  fill: none;
  stroke: var(--sat-ink);
  stroke-width: 3px;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.skin-sat .sat-card-title {
  font-family: var(--font-sat-display), cursive;
  font-weight: 800;
  font-size: 22px;
  font-variation-settings: "BNCE" 22;
}
.skin-sat .sat-card-body { font-size: 15px; color: var(--sat-ink-soft); }

/* ---- palette chips ----------------------------------------------- */

.skin-sat .sat-chip { list-style: none; }
.skin-sat .sat-chip-swatch {
  height: 64px;
  border: 3px solid var(--sat-ink);
  border-radius: 20px 8px 22px 9px / 9px 22px 8px 20px;
}
.skin-sat .sat-chip:nth-child(2n) .sat-chip-swatch {
  border-radius: 9px 21px 8px 23px / 21px 9px 23px 8px;
}
.skin-sat .sat-chip:nth-child(3n) .sat-chip-swatch {
  border-radius: 18px 18px 6px 22px / 8px 20px 10px 24px;
}
.skin-sat .sat-chip-name {
  margin-top: 7px;
  font-family: var(--font-sat-display), cursive;
  font-weight: 700;
  font-size: 15px;
}
.skin-sat .sat-chip-hex { font-size: 13px; color: var(--sat-ink-muted); }

/* ---- sticker buttons ---------------------------------------------
   die-cut: accent fill, thick white outline, then the ink line.
   hover = anticipation (dips 2px BEFORE it pops), held at step-end
   so it plays as 4 drawn frames. active = squash. */

.skin-sat .sat-btn {
  display: inline-block;
  font-family: var(--font-sat-display), cursive;
  font-weight: 700;
  font-size: 16.5px;
  line-height: 1.25;
  color: #fff;
  background: var(--sat-accent, var(--sat-cobalt));
  border: 4px solid var(--sat-cel);
  outline: 3px solid var(--sat-ink);
  border-radius: 20px 24px 18px 26px / 24px 18px 26px 20px;
  padding: 9px 24px;
  transform-origin: 50% 100%;
  cursor: pointer;
}
.skin-sat .sat-btn:hover { animation: sat-anticipate 0.3s step-end both; }
.skin-sat .sat-btn:active {
  animation: none;
  transform: translateY(1px) scaleY(0.9) scaleX(1.07);
}
.skin-sat .sat-btn:focus-visible { outline-style: dashed; }
.skin-sat .sat-btn-ghost { color: var(--sat-ink); background: var(--sat-cel); }
.skin-sat .sat-btn-sm { font-size: 14px; padding: 5px 16px; }
.skin-sat .sat-btn-demo { pointer-events: none; }
.skin-sat .sat-btn-demo-hover { transform: translateY(-2px); }
.skin-sat .sat-btn-demo-active { transform: translateY(1px) scaleY(0.9) scaleX(1.07); }
@keyframes sat-anticipate {
  0%   { transform: translateY(0); }
  25%  { transform: translateY(2px) scaleY(0.95) scaleX(1.04); }
  50%  { transform: translateY(-3px) scaleY(1.04) scaleX(0.98); }
  75%  { transform: translateY(-2px); }
  100% { transform: translateY(-2px); }
}

/* ---- preset pills (mini stickers) --------------------------------- */

.skin-sat .sat-pill {
  font-family: var(--font-sat-display), cursive;
  font-weight: 700;
  font-size: 14px;
  color: var(--sat-ink);
  background: var(--sat-cel);
  border: 3px solid var(--sat-ink);
  border-radius: 18px 14px 20px 13px / 14px 20px 13px 18px;
  padding: 5px 14px;
  cursor: pointer;
  transform-origin: 50% 100%;
}
.skin-sat .sat-pill:hover { animation: sat-anticipate 0.3s step-end both; }
.skin-sat .sat-pill:active {
  animation: none;
  transform: translateY(1px) scaleY(0.9) scaleX(1.07);
}
.skin-sat .sat-pill-on {
  color: #fff;
  background: var(--sat-cobalt);
  border-color: var(--sat-cel);
  outline: 3px solid var(--sat-ink);
  transform: rotate(-2deg);
}

/* ---- drawn inputs -------------------------------------------------
   the box boils slowly at rest; focus makes it boil faster and a
   scribble underline draws itself in. */

.skin-sat .sat-field-label {
  font-family: var(--font-sat-display), cursive;
  font-weight: 700;
  font-size: 14px;
  color: var(--sat-ink-soft);
}
.skin-sat .sat-input {
  width: 100%;
  font-family: var(--font-sat-body), "Nunito", sans-serif;
  font-size: 16px;
  color: var(--sat-ink);
  background: var(--sat-cel);
  border: 3px solid var(--sat-ink);
  border-radius: 14px 4px 16px 5px / 5px 16px 4px 14px;
  padding: 9px 14px;
  animation: sat-boil-border 0.5s step-end infinite;
}
.skin-sat .sat-input::placeholder { color: var(--sat-ink-muted); }
.skin-sat .sat-input:focus { outline: none; animation-duration: 0.22s; }
@keyframes sat-boil-border {
  0%   { border-radius: 14px 4px 16px 5px / 5px 16px 4px 14px; }
  33%  { border-radius: 5px 15px 6px 14px / 15px 5px 14px 6px; }
  66%  { border-radius: 15px 6px 5px 16px / 6px 15px 16px 4px; }
  100% { border-radius: 14px 4px 16px 5px / 5px 16px 4px 14px; }
}
.skin-sat .sat-scribble {
  width: 100%;
  height: 9px;
  overflow: visible;
}
.skin-sat .sat-scribble path {
  fill: none;
  stroke: var(--sat-accent, var(--sat-cobalt));
  stroke-width: 3px;
  stroke-linecap: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
}
.skin-sat .sat-field:focus-within .sat-scribble path {
  animation: sat-scribble-in 0.4s steps(8) forwards;
}
@keyframes sat-scribble-in { to { stroke-dashoffset: 0; } }

/* ---- recess vignette ---------------------------------------------- */

.skin-sat .sat-vignette {
  position: relative;
  height: clamp(340px, 60vh, 560px);
  overflow: hidden;
  border-radius: inherit;
  background: var(--sat-sky-2);
}
.skin-sat .sat-cloud { position: absolute; }
.skin-sat .sat-cloud path {
  fill: var(--sat-cel);
  stroke: var(--sat-ink);
  stroke-width: 3px;
  stroke-linejoin: round;
}
.skin-sat .sat-cloud-a {
  top: 9%;
  left: -170px;
  width: 150px;
  animation: sat-drift 70s steps(320) -20s infinite;
}
.skin-sat .sat-cloud-b {
  top: 26%;
  left: -140px;
  width: 105px;
  animation: sat-drift 96s steps(380) -38s infinite;
}
@keyframes sat-drift {
  from { transform: translateX(0); }
  to   { transform: translateX(2300px); }
}

.skin-sat .sat-sun {
  position: absolute;
  top: 7%;
  right: 5%;
  width: 112px;
  height: 112px;
}
.skin-sat .sat-sun-disc {
  fill: var(--sat-sunshine);
  stroke: var(--sat-ink);
  stroke-width: 3px;
}
.skin-sat .sat-sun-rays line {
  stroke: var(--sat-ink);
  stroke-width: 3px;
  stroke-linecap: round;
}
.skin-sat .sat-sun-rays {
  transform-box: fill-box;
  transform-origin: center;
  animation: sat-spin 26s steps(52) infinite;
}
@keyframes sat-spin { to { transform: rotate(360deg); } }
.skin-sat .sat-sun-open circle { fill: var(--sat-ink); }
.skin-sat .sat-sun-shut path,
.skin-sat .sat-sun-smile {
  fill: none;
  stroke: var(--sat-ink);
  stroke-width: 3px;
  stroke-linecap: round;
}
.skin-sat .sat-sun-shut { opacity: 0; }
.skin-sat .sat-sun:hover .sat-sun-open { animation: sat-eyes-open 0.55s step-end 1; }
.skin-sat .sat-sun:hover .sat-sun-shut { animation: sat-eyes-shut 0.55s step-end 1; }
@keyframes sat-eyes-open { 0% { opacity: 0; } 45% { opacity: 1; } 100% { opacity: 1; } }
@keyframes sat-eyes-shut { 0% { opacity: 1; } 45% { opacity: 0; } 100% { opacity: 0; } }

.skin-sat .sat-grass {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 84px;
}
.skin-sat .sat-grass-fill {
  position: absolute;
  inset: 2px 0 0 0;
  background: var(--sat-grass);
  opacity: 0;
  animation: sat-appear 0.01s step-end 0.6s forwards;
}
.skin-sat .sat-groundline {
  position: absolute;
  top: -10px;
  left: 0;
  width: 100%;
  height: 24px;
  overflow: visible;
}
.skin-sat .sat-groundline .sat-line {
  fill: none;
  stroke: var(--sat-ink);
  stroke-width: 3px;
  stroke-linecap: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: sat-draw 0.9s steps(14) 0.15s forwards;
}
.skin-sat .sat-groundline .sat-tuft {
  fill: none;
  stroke: var(--sat-ink);
  stroke-width: 2.5px;
  stroke-linecap: round;
  opacity: 0;
  animation: sat-appear 0.01s step-end 0.9s forwards;
}
@keyframes sat-draw { to { stroke-dashoffset: 0; } }
@keyframes sat-appear { to { opacity: 1; } }

.skin-sat .sat-ball {
  position: absolute;
  border: 3px solid var(--sat-ink);
  border-radius: 51% 47% 53% 49% / 49% 53% 47% 51%;
  transform-origin: 50% 100%;
}
.skin-sat .sat-ball::after {
  content: "";
  position: absolute;
  left: 16%;
  top: 12%;
  width: 30%;
  height: 20%;
  background: rgba(255, 255, 255, 0.75);
  border-radius: 60% 40% 55% 45% / 55% 45% 60% 40%;
  transform: rotate(-16deg);
}
.skin-sat .sat-tag {
  position: absolute;
  bottom: 26px;
  padding: 1px 10px;
  font-family: var(--font-sat-display), cursive;
  font-weight: 700;
  font-size: 13.5px;
  white-space: nowrap;
  color: var(--sat-ink);
  background: var(--sat-cel);
  border: 2.5px solid var(--sat-ink);
  border-radius: 12px 5px 13px 6px / 6px 13px 5px 12px;
  opacity: 0;
  animation: sat-appear 0.01s step-end forwards;
}

/* ---- dust puffs (4 drawn frames, ~10fps, plays once on mount) ----- */

.skin-sat .sat-puff { position: absolute; pointer-events: none; }
.skin-sat .sat-puff circle {
  fill: var(--sat-cel);
  stroke: var(--sat-ink);
  stroke-width: 2.5px;
}
.skin-sat .sat-puff .sat-pf4 circle { fill: none; }
.skin-sat .sat-pf { opacity: 0; }
.skin-sat .sat-pf1 { animation: sat-pf1 0.42s step-end forwards; }
.skin-sat .sat-pf2 { animation: sat-pf2 0.42s step-end forwards; }
.skin-sat .sat-pf3 { animation: sat-pf3 0.42s step-end forwards; }
.skin-sat .sat-pf4 { animation: sat-pf4 0.42s step-end forwards; }
@keyframes sat-pf1 { 0% { opacity: 1; } 25% { opacity: 0; } 100% { opacity: 0; } }
@keyframes sat-pf2 { 0% { opacity: 0; } 25% { opacity: 1; } 50% { opacity: 0; } 100% { opacity: 0; } }
@keyframes sat-pf3 { 0% { opacity: 0; } 50% { opacity: 1; } 75% { opacity: 0; } 100% { opacity: 0; } }
@keyframes sat-pf4 { 0% { opacity: 0; } 75% { opacity: 0.7; } 100% { opacity: 0; } }

/* ---- focus mock ---------------------------------------------------- */

.skin-sat .sat-backlink {
  font-family: var(--font-sat-display), cursive;
  font-weight: 700;
  font-size: 14px;
  color: var(--sat-ink-soft);
  text-decoration: none;
}
.skin-sat .sat-backlink:hover { color: var(--sat-ink); }
.skin-sat .sat-focus-title {
  font-family: var(--font-sat-display), cursive;
  font-weight: 800;
  font-size: 34px;
  line-height: 1.1;
  font-variation-settings: "BNCE" 26;
}
.skin-sat .sat-focus-tagline { font-size: 15.5px; color: var(--sat-ink-soft); }
.skin-sat .sat-timer {
  position: relative;
  width: 230px;
  height: 130px;
  margin: 2px auto;
  display: flex;
  align-items: center;
  justify-content: center;
}
.skin-sat .sat-timer svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.skin-sat .sat-timer path {
  fill: none;
  stroke: var(--sat-ink);
  stroke-width: 3.5px;
  stroke-linecap: round;
}
.skin-sat .sat-timer-digits {
  font-family: var(--font-sat-display), cursive;
  font-weight: 800;
  font-size: 54px;
  line-height: 1;
  font-variation-settings: "BNCE" 18;
}
.skin-sat .sat-tally path {
  fill: none;
  stroke: var(--sat-ink-soft);
  stroke-width: 2.6px;
  stroke-linecap: round;
}
.skin-sat .sat-focus-foot { font-size: 14px; color: var(--sat-ink-muted); }

/* ---- hugo ---------------------------------------------------------- */

.skin-sat .sat-hugo-stage {
  position: relative;
  width: 170px;
  height: 178px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.skin-sat .sat-hugo-stage:focus-visible {
  outline: 3px dashed var(--sat-cobalt);
  outline-offset: 6px;
  border-radius: 24px 18px 26px 16px / 18px 26px 16px 24px;
}
.skin-sat .sat-hugo {
  display: block;
  width: 160px;
  height: 170px;
  margin: 0 auto;
  transform-origin: 50% 78%;
}
.skin-sat .sat-hugo-body { fill: var(--sat-ink); }
.skin-sat .sat-hugo-eye { fill: var(--sat-cream); }
.skin-sat .sat-hugo-pupil { fill: var(--sat-ink); }
.skin-sat .sat-hugo-lids path {
  fill: none;
  stroke: var(--sat-cream);
  stroke-width: 3.5px;
  stroke-linecap: round;
}
.skin-sat .sat-hugo-blush { fill: var(--sat-pink); opacity: 0.35; }
.skin-sat .sat-hugo-legs path {
  fill: none;
  stroke: var(--sat-ink);
  stroke-width: 4px;
  stroke-linecap: round;
}
.skin-sat .sat-hugo-puff {
  left: 50%;
  bottom: 0;
  transform: translateX(-50%);
}
.skin-sat .sat-caption {
  font-family: var(--font-sat-display), cursive;
  font-weight: 700;
  font-size: 15px;
  color: var(--sat-ink-soft);
  text-align: center;
}

/* ---- reduced motion: the cartoon freezes on frame 1 ---------------- */

@media (prefers-reduced-motion: reduce) {
  .skin-sat *,
  .skin-sat *::before,
  .skin-sat *::after {
    animation: none !important;
    transition: none !important;
  }
  /* animations that end in a "forwards" state get pinned to it */
  .skin-sat .sat-groundline .sat-line { stroke-dashoffset: 0; }
  .skin-sat .sat-groundline .sat-tuft,
  .skin-sat .sat-grass-fill,
  .skin-sat .sat-tag { opacity: 1; }
  .skin-sat .sat-cloud-a { transform: translateX(26vw); }
  .skin-sat .sat-cloud-b { transform: translateX(64vw); }
  .skin-sat .sat-field:focus-within .sat-scribble path { stroke-dashoffset: 0; }
}
`;
