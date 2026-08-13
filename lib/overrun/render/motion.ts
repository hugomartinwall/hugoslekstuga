/**
 * Reduced-motion preference, cached, with a player override.
 *
 * This lived as a module-private cache inside renderer.ts, which is why
 * `Shake.kick` in fx.ts could not reach it and re-queried `matchMedia` on every
 * kick — and up to five kicks land in a single frame. Hoisting it here fixes
 * that and gives the settings panel somewhere to write.
 *
 * Three states rather than a boolean: the OS setting is a default, not a
 * verdict. A player whose system has reduce-motion on but who wants the full
 * game must be able to say so, and vice versa — so the override wins in *both*
 * directions.
 *
 * Imports nothing, so anything in the render layer can depend on it.
 */

export type MotionPref = "auto" | "on" | "off";

const PREF_KEY = "hugoslekstuga:overrun:motion";

let osReduced = false;
let pref: MotionPref = "auto";
let effective = false;
const listeners: ((reduced: boolean) => void)[] = [];

/** Pure, and exported for tests: the whole policy in one expression. */
export function effectiveReduced(p: MotionPref, os: boolean): boolean {
  return p === "auto" ? os : p === "on";
}

function recompute(): void {
  const next = effectiveReduced(pref, osReduced);
  if (next === effective) return;
  effective = next;
  for (const fn of listeners) fn(next);
}

// Gated on `window`, not just wrapped in try/catch: node defines a localStorage
// global now, and merely touching it makes the test runner emit a warning.
if (typeof window !== "undefined") {
  try {
    const raw = window.localStorage.getItem(PREF_KEY);
    if (raw === "auto" || raw === "on" || raw === "off") pref = raw;
  } catch {
    /* sandboxed iframe without storage access — stay on "auto" */
  }
}

if (typeof matchMedia === "function") {
  const mq = matchMedia("(prefers-reduced-motion: reduce)");
  osReduced = mq.matches;
  mq.addEventListener?.("change", (e) => {
    osReduced = e.matches;
    recompute();
  });
}
effective = effectiveReduced(pref, osReduced);

/** Cached — never calls matchMedia. Safe to call several times per frame. */
export function reducedMotion(): boolean {
  return effective;
}

export function motionPref(): MotionPref {
  return pref;
}

export function setMotionPref(p: MotionPref): void {
  pref = p;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PREF_KEY, p);
    } catch {
      /* fine — the preference just won't survive a reload */
    }
  }
  recompute();
}

/** Cycles auto → off → on → auto. "off" means full motion. */
export function nextMotionPref(p: MotionPref): MotionPref {
  return p === "auto" ? "off" : p === "off" ? "on" : "auto";
}

export function onMotionChange(fn: (reduced: boolean) => void): void {
  listeners.push(fn);
}

/**
 * A sine pulse that flattens to 0 when motion is reduced.
 *
 * `periodMs` is a PERIOD — the wall-clock time for one full cycle. It is NOT
 * the divisor from a hand-rolled `Math.sin(now / n)`, where `n` is an inverse
 * angular frequency and the real period is `2π·n`.
 *
 * That distinction has cost us once already. Four call sites were converted
 * from `Math.sin(now / n)` to `pulse(now, n)` verbatim, which ran every one of
 * them 2π ≈ 6.28× too fast — the selection ring ended up at 6.7 Hz and the aim
 * ring at 8.3 Hz, both inside the photosensitive band that a PEGI 12 title has
 * no business being in. Nothing failed, because nothing pinned the units; the
 * period cases in test/ease.test.ts exist so it cannot happen silently again.
 * When converting, multiply by 2π.
 *
 * Callers must keep drawing whatever the pulse modulates — some of these mark
 * the selected node and the keyboard aim cursor, so the mark has to survive
 * even when its animation does not. Where the mark is a pure STATE indicator,
 * prefer no pulse at all over a slow one.
 */
export function pulse(now: number, periodMs: number): number {
  return effective ? 0 : Math.sin((now / periodMs) * Math.PI * 2);
}
