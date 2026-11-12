/**
 * createKnuff: the app layer. It owns the State, the loop, the seed and
 * the one callback to the page, and it wires the pull to the simulation
 * and the simulation to the canvas.
 *
 * The page it lives in mounts and unmounts, and in development React's
 * StrictMode mounts, cleans up and mounts again. So everything this file
 * registers on the window, the document, the root or a media query goes
 * through one `disposers` list, and `destroy()` leaves nothing behind: no
 * frame loop, no listener, no observer.
 *
 * STEP 0: the room plays as the feel toy plays. Slow motion is still the
 * toy's shell rule (free at rest, a meter in flight); it moves into the
 * State with the night. Pause, the panels, saving and sound join in the
 * steps that build them, and the handle grows with them.
 */
import { readAccent, subscribeAccent } from "@/lib/hugo/sprite";
import { DEFAULT_TUNE, mergeTune } from "./content/tune";
import { DEV_HANDLES } from "./dev";
import type { KnuffFonts } from "./fonts";
import { attachPointer, type Aim, type PullView } from "./input/pointer";
import { createLoop } from "./loop";
import { createEffects } from "./render/effects";
import type { Layout } from "./render/layout";
import { effectiveReduced, type MotionPref } from "./render/motion";
import { createRenderer } from "./render/renderer";
import { aimLine, type AimLine } from "./sim/aim";
import { createState, type StartOptions } from "./sim/state";
import { step } from "./sim/step";
import type { Launch, SimEvent, State, Tune } from "./sim/types";

/**
 * What the page needs to know, and nothing more. Step 0 knows which
 * screen is up; `paused` and `over` join with the night, and the score
 * and the settings with the panels that show them.
 */
export type KnuffView = {
  screen: "start" | "play" | "tooSmall";
};

export type KnuffOptions = {
  fonts: KnuffFonts;
  /** The one callback: called when the view changes, never per frame. */
  onChange: (view: KnuffView) => void;
  /** Knobs laid over the default table (content/tune.ts) for this game. */
  tune?: Partial<Tune>;
};

export type KnuffHandle = {
  /** Stop the loop and take every listener and observer away. Safe to call twice. */
  destroy(): void;
};

/**
 * The automation seam, `window.__knuff` in development only. It reads,
 * and it drives the same path as the loop: `step` is the loop's tick and
 * `launch` is what a release hands over.
 */
export type KnuffDev = {
  state(): State;
  /** Take `n` ticks now, as the loop would. */
  step(n: number): void;
  /** Begin again from a State made with these options (and this seed, if one is given). */
  start(start?: StartOptions & { seed?: number }): void;
  /** Off: a hidden tab or a blurred window no longer stops the loop or drops a pull. */
  setAutopause(on: boolean): void;
  /** Hand over a launch as a release would: it fires on the next tick. */
  launch(launch: Launch): void;
  tune(): Tune;
  view(): KnuffView;
  /** Where everything is drawn, in CSS px. */
  layout(): Layout;
  /** The pull being held, or null. */
  pull(): PullView | null;
  /** The aim line of the held pull, or null. */
  aim(): AimLine | null;
  /** Is the frame loop running? */
  running(): boolean;
};

/** STEP 0 ONLY, the toy's slow-motion meter: seconds one held aim may spend in flight, and how fast it comes back. */
const FOCUS_MAX_S = 2.5;
const FOCUS_REFILL_PER_S = 0.55;

/** The player's choice of motion arrives with the settings; until then the system's setting decides. */
const MOTION: MotionPref = "auto";

/** A new seed for a new game. Nobody promises that a seed plays the same on two devices. */
function newSeed(): number {
  return (Date.now() ^ (Math.random() * 0x100000000)) >>> 0;
}

export function createKnuff(root: HTMLElement, canvas: HTMLCanvasElement, opts: KnuffOptions): KnuffHandle {
  const tune = mergeTune(DEFAULT_TUNE, opts.tune);
  // First, and before anything is registered: this is the one call that can throw.
  const renderer = createRenderer(root, canvas, opts.fonts);
  const fx = createEffects(tune);

  const disposers: Array<() => void> = [];
  const listen = <E extends Event>(
    target: EventTarget,
    type: string,
    fn: (e: E) => void,
    options?: AddEventListenerOptions,
  ) => {
    const l = fn as EventListener;
    target.addEventListener(type, l, options);
    disposers.push(() => target.removeEventListener(type, l, options));
  };

  let destroyed = false;
  let state = createState(newSeed(), tune);
  /** A release waiting for the next tick. */
  let queued: Launch | null = null;
  let focus = FOCUS_MAX_S;
  let autopause = true;
  // His colour is the visitor's, and another tab can change it.
  let accent = readAccent();
  disposers.push(
    subscribeAccent(() => {
      accent = readAccent();
    }),
  );

  // ── What the page is told ───────────────────────────────────────────

  const view = (): KnuffView => ({
    screen: renderer.layout.tooSmall ? "tooSmall" : state.launch.id === 0 ? "start" : "play",
  });
  let told = "";
  const tell = () => {
    if (destroyed) return;
    const v = view();
    const key = JSON.stringify(v);
    if (key === told) return;
    told = key;
    opts.onChange(v);
  };

  // ── The pull ────────────────────────────────────────────────────────

  const pointer = attachPointer(root, {
    tune: () => tune,
    enabled: () => !renderer.layout.tooSmall,
    onLaunch: (launch) => {
      queued = launch;
    },
    // A press that is cancelled does not move the focus by itself, and
    // keys are heard only while the root has it.
    onPress: () => root.focus({ preventScroll: true }),
  });
  disposers.push(pointer.detach);
  /** What the held pull would do if it were let go now; null while there is none, or it has not become one. */
  const aimNow = (): Aim | null => pointer.pull()?.aim ?? null;

  // The aim line: worked out at most once a frame, and only when the aim
  // has moved or a tick has passed.
  let line: AimLine | null = null;
  let lineKey = "";
  const lineFor = (aim: Aim): AimLine => {
    const l = aim.launch;
    const key = `${Math.round(l.dx)}|${Math.round(l.dy)}|${Math.round(l.power * 200)}|${state.tick}`;
    if (line === null || key !== lineKey) {
      line = aimLine(state, l, tune);
      lineKey = key;
    }
    return line;
  };

  // ── Layout ──────────────────────────────────────────────────────────

  const coarse = window.matchMedia("(pointer: coarse)");
  let measuredDpr = 0;
  const relayout = () => {
    const changed = renderer.measure(coarse.matches);
    measuredDpr = window.devicePixelRatio;
    if (!changed) return;
    // A resize drops a held pull and lays the screen out again.
    pointer.cancel();
    if (renderer.layout.tooSmall) queued = null;
    tell();
  };
  // The observer also hears a phone's address bar folding away, which
  // resizes the root without a window resize.
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(relayout);
    observer.observe(root);
    disposers.push(() => observer.disconnect());
  }
  listen(window, "resize", relayout);
  listen(coarse, "change", relayout);

  // ── Motion ──────────────────────────────────────────────────────────

  const lessMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = effectiveReduced(MOTION, lessMotion.matches);
  fx.setReduced(reduced);
  listen(lessMotion, "change", () => {
    reduced = effectiveReduced(MOTION, lessMotion.matches);
    fx.setReduced(reduced);
  });

  // ── The loop ────────────────────────────────────────────────────────

  const events: SimEvent[] = [];

  /** One tick, with everything that hangs on it. The dev handle's step() is this too. */
  const tick = (): number => {
    events.length = 0;
    const launch = queued;
    queued = null;
    step(state, { launch, pullHeld: aimNow() !== null }, tune, events);
    let freeze = 0;
    for (const e of events) freeze = Math.max(freeze, fx.onEvent(e));
    fx.afterTick(state);
    tell();
    return freeze;
  };

  const loop = createLoop({
    // The toy's rule. While a real pull is held the room runs slowed: free
    // while he is at rest, on the meter while he flies.
    slowed(realDt) {
      const aiming = aimNow() !== null;
      const flying = state.him.vx !== 0 || state.him.vy !== 0;
      const slow = aiming && tune.slowShare < 1 && (!flying || focus > 0);
      if (slow && flying) focus = Math.max(0, focus - realDt);
      else if (!aiming) focus = Math.min(FOCUS_MAX_S, focus + realDt * FOCUS_REFILL_PER_S);
      return slow;
    },
    slowShare: () => tune.slowShare,
    launchQueued: () => queued !== null,
    held: () => renderer.layout.tooSmall,
    tick,
    render(frame) {
      // A window dragged to another screen changes the pixel ratio without a resize.
      if (window.devicePixelRatio !== measuredDpr) relayout();
      fx.update(frame.realDt, frame.scaledDt, frame.now);
      const pull = pointer.pull();
      const aim = pull?.aim ?? null;
      const flying = state.him.vx !== 0 || state.him.vy !== 0;
      renderer.draw({
        state,
        tune,
        alpha: frame.alpha,
        now: frame.now,
        pull,
        line: aim ? lineFor(aim) : null,
        focus: aim && tune.slowShare < 1 && flying ? focus / FOCUS_MAX_S : -1,
        accent,
        reduced,
        effects: fx,
      });
    },
  });

  // ── Leaving and coming back ─────────────────────────────────────────

  const hidden = () => document.hidden || document.visibilityState === "hidden";
  // In a hidden tab the frame loop stops, and a held pull is dropped,
  // never fired. The loop measures no time on its first frame back.
  listen(document, "visibilitychange", () => {
    if (!autopause) return;
    if (hidden()) {
      loop.stop();
      pointer.cancel();
    } else {
      loop.start();
    }
  });
  listen(window, "blur", () => {
    if (autopause) pointer.cancel();
  });
  listen(window, "pagehide", () => pointer.cancel());
  // The toy's Escape: it drops a held pull. (It becomes the pause key with the night.)
  listen<KeyboardEvent>(root, "keydown", (e) => {
    if (e.key === "Escape") pointer.cancel();
  });

  relayout();
  tell();
  if (!hidden()) loop.start();

  // ── Dev handle ──────────────────────────────────────────────────────

  if (DEV_HANDLES) {
    const w = window as unknown as { __knuff?: unknown };
    const dev: KnuffDev = {
      state: () => state,
      step(n) {
        if (renderer.layout.tooSmall) return;
        for (let i = 0; i < n; i++) tick();
      },
      start(start = {}) {
        const { seed, ...options } = start;
        state = createState(seed ?? newSeed(), tune, options);
        queued = null;
        focus = FOCUS_MAX_S;
        line = null;
        pointer.cancel();
        fx.reset();
        tell();
      },
      setAutopause(on) {
        autopause = on;
        if (!on && !destroyed) loop.start();
      },
      launch(launch) {
        queued = launch;
      },
      tune: () => tune,
      view,
      layout: () => renderer.layout,
      pull: () => pointer.pull(),
      aim() {
        const aim = aimNow();
        return aim ? lineFor(aim) : null;
      },
      running: () => loop.running,
    };
    w.__knuff = dev;
    // Only its own: a page that has put something else under the name keeps it.
    disposers.push(() => {
      if (w.__knuff === dev) delete w.__knuff;
    });
  }

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      loop.stop();
      for (let i = disposers.length - 1; i >= 0; i--) disposers[i]();
      disposers.length = 0;
    },
  };
}
