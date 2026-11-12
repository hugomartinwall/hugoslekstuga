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
 * Slow motion lives in the State: the loop only asks `wouldSlow` how fast
 * to feed ticks. The panels are the page's (Client.tsx renders them from
 * the view this file reports); what they do goes through the handle.
 * Saving and sound join in the steps that build them.
 *
 * Until the game ships the handle also carries `setTune`, for the knob
 * keys of the builds the owner checks. No night is ever played under two
 * sets of rules: a change of rules makes the night again.
 */
import { readAccent, subscribeAccent } from "@/lib/hugo/sprite";
import { END, KIND_NAME } from "./content/copy";
import { CLOCK } from "./content/night";
import { DEFAULT_TUNE, mergeTune } from "./content/tune";
import { DEV_HANDLES } from "./dev";
import type { KnuffFonts } from "./fonts";
import { attachPointer, type Aim, type PullView } from "./input/pointer";
import { createLoop } from "./loop";
import { createEffects } from "./render/effects";
import { pauseKeyRect, type Layout } from "./render/layout";
import { effectiveReduced, type MotionPref } from "./render/motion";
import { createRenderer } from "./render/renderer";
import { aimLine, type AimLine } from "./sim/aim";
import { threat } from "./sim/hot";
import { createState, type StartOptions } from "./sim/state";
import { step, wouldSlow } from "./sim/step";
import type { Launch, SimEvent, State, Tune } from "./sim/types";

/** The three knobs the owner's builds carry on the screen, and the one more behind MORE. */
export type KnuffKnobs = { pace: number; popHotTicks: number; aimCushions: number; pipRefillTicks: number };

/** What the end panel shows. */
export type KnuffOver = {
  score: number;
  /** What the panel calls the night: the hour he fell in, or MORNING. */
  night: string;
  bestShot: number;
  /** The best score since the page opened, under these rules. Nothing is stored yet. */
  best: number;
  newBest: boolean;
  /** What took the last heart ("lost to a runaway token"); empty when morning came. */
  line: string;
};

/**
 * What the page needs to know, and nothing more: which screen is up, what
 * the knobs are set to (so their keys show it), and when the night is
 * over, what the end panel says.
 */
export type KnuffView = {
  screen: "start" | "play" | "paused" | "over" | "tooSmall";
  /** The knobs the next night is made with. */
  knobs: KnuffKnobs;
  /** Every knob that is not at its starting value, as JSON: what MORE prints. */
  named: string;
  over: KnuffOver | null;
};

/** The view before the game has said anything. */
export const FIRST_VIEW: KnuffView = {
  screen: "start",
  knobs: {
    pace: DEFAULT_TUNE.pace,
    popHotTicks: DEFAULT_TUNE.popHotTicks,
    aimCushions: DEFAULT_TUNE.aimCushions,
    pipRefillTicks: DEFAULT_TUNE.pipRefillTicks,
  },
  named: "{}",
  over: null,
};

export type KnuffOptions = {
  fonts: KnuffFonts;
  /** The one callback: called when the view changes, never per frame. */
  onChange: (view: KnuffView) => void;
  /** Knobs laid over the default table (content/tune.ts): the `?tune=` of the owner's builds. */
  tune?: Partial<Tune>;
  /** The owner's builds: a laptop page is never too small. */
  playable?: boolean;
};

export type KnuffHandle = {
  /** Stop the loop and take every listener, observer and timer away. Safe to call twice. */
  destroy(): void;
  /** Pause. Does nothing unless a night is in progress; a held pull is dropped all the same. */
  pause(): void;
  /** Go on where it stopped. The room stays frozen for a moment, so the press that resumed is not a shot. */
  resume(): void;
  /** AGAIN: a new seed and the start screen. */
  restart(): void;
  /** BACK TO PLAYHOUSE: the night ends with no panel. */
  abandon(): void;
  /**
   * The knob keys. A patch that changes only the aim line's cushions
   * takes effect at once: it changes what is drawn and nothing else. Any
   * other patch changes the rules: on the start screen the night is made
   * again, a night in progress is dropped for the start screen, and after
   * a night is over the patch waits for the next one.
   */
  setTune(patch: Partial<Tune>): void;
};

/**
 * The automation seam, `window.__knuff` in development only. It reads,
 * and it drives the same path as the loop: `step` is the loop's tick and
 * `launch` is what a release hands over.
 */
export type KnuffDev = {
  state(): State;
  /** Take `n` ticks now, as the loop would. None while the game is paused. */
  step(n: number): void;
  /** Begin again from a State made with these options (and this seed, if one is given). */
  start(start?: StartOptions & { seed?: number }): void;
  /** Off: a hidden tab or a blurred window no longer pauses, stops the loop or drops a pull. */
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

/** The player's choice of motion arrives with the settings; until then the system's setting decides. */
const MOTION: MotionPref = "auto";
/** The end panel appears this long after the night ends, ms. */
const END_PANEL_MS = 800;
/** After RESUME the room stays frozen this long, ms, and until no pointer that was down is still down. */
const RESUME_HOLD_MS = 500;

/** A new seed for a new game. Nobody promises that a seed plays the same on two devices. */
function newSeed(): number {
  return (Date.now() ^ (Math.random() * 0x100000000)) >>> 0;
}

/** Do two tables differ in anything but the cushions the aim line runs through? That one is drawing only. */
function rulesDiffer(a: Tune, b: Tune): boolean {
  const x = a as unknown as Record<string, unknown>;
  const y = b as unknown as Record<string, unknown>;
  for (const key of Object.keys(x)) {
    if (key !== "aimCushions" && x[key] !== y[key]) return true;
  }
  return false;
}

export function createKnuff(root: HTMLElement, canvas: HTMLCanvasElement, opts: KnuffOptions): KnuffHandle {
  /**
   * Every knob that has been named, by the link or by a key, in one
   * object. The table in use is always this laid over the default table
   * in one pass: `pace` deals six other knobs their values, and one of
   * them named here must outlive a change of pace.
   */
  let named: Partial<Tune> = { ...(opts.tune ?? {}) };
  /** The table the State was made with. */
  let tune = mergeTune(DEFAULT_TUNE, named);
  const playable = opts.playable === true;
  // First, and before anything is registered: this is the one call that can throw.
  const renderer = createRenderer(root, canvas, opts.fonts);
  const fx = createEffects(() => tune);

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
  let autopause = true;
  /** A night in progress is stopped, and the pause panel is up (or would be, on a page too small). */
  let paused = false;
  /** BACK TO PLAYHOUSE was pressed: nothing more happens here. */
  let left = false;
  /** The end panel is up: the night has been over for 800 ms. */
  let overShown = false;
  let overTimer = 0;
  /** The best score since the page opened, under the rules in use. */
  let best = 0;
  let newBest = false;
  /** After RESUME: frozen until this time, and until these pointers are up. */
  let holdUntil = 0;
  const holdFor = new Set<number>();
  /** Pointers that are down anywhere on the page. */
  const down = new Set<number>();
  /** The key that paused, until it comes up: Escape must not resume on the same press. */
  let pauseKeyDown = "";
  // His colour is the visitor's, and another tab can change it.
  let accent = readAccent();
  disposers.push(
    subscribeAccent(() => {
      accent = readAccent();
    }),
  );

  /** A night in progress: the only thing that can be paused. */
  const inNight = () => state.phase === "night" || state.phase === "boss";

  // ── What the page is told ───────────────────────────────────────────

  let knobs: KnuffKnobs = FIRST_VIEW.knobs;
  let namedJson = "{}";
  /** The knobs as the next night will have them: its keys show these. */
  const readKnobs = () => {
    const next = mergeTune(DEFAULT_TUNE, named);
    knobs = {
      pace: next.pace,
      popHotTicks: next.popHotTicks,
      aimCushions: next.aimCushions,
      pipRefillTicks: next.pipRefillTicks,
    };
    const base = DEFAULT_TUNE as unknown as Record<string, unknown>;
    const now = next as unknown as Record<string, unknown>;
    const moved: Record<string, unknown> = {};
    for (const key of Object.keys(base)) if (now[key] !== base[key]) moved[key] = now[key];
    namedJson = JSON.stringify(moved);
  };
  readKnobs();

  const over = (): KnuffOver | null => {
    if (state.phase !== "over") return null;
    const morning = state.ended === "morning";
    const hour = state.lastHurtHour >= 0 ? state.lastHurtHour : state.night.hour;
    const by = KIND_NAME[state.lastHurtBy];
    return {
      score: state.score,
      night: morning ? END.morning : CLOCK[Math.min(Math.max(0, hour), CLOCK.length - 1)],
      bestShot: state.bestShot,
      best,
      newBest,
      line: morning || !by ? "" : `${END.lostTo} ${by}`,
    };
  };

  const view = (): KnuffView => ({
    screen: left
      ? "play"
      : renderer.layout.tooSmall
        ? "tooSmall"
        : state.phase === "waiting"
          ? "start"
          : state.phase === "over"
            ? overShown
              ? "over"
              : "play"
            : paused
              ? "paused"
              : "play",
    knobs,
    named: namedJson,
    over: overShown ? over() : null,
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
    // No pull on a page too small, under a panel, or once the night is over.
    enabled: () => !renderer.layout.tooSmall && !paused && !left && state.phase !== "over",
    onLaunch: (launch) => {
      queued = launch;
    },
    // A press that is cancelled does not move the focus by itself, and
    // keys are heard only while the root has it.
    onPress: () => root.focus({ preventScroll: true }),
    // The pause key is drawn in the canvas, in the top bar's right corner.
    keyAt: (x, y) => {
      if (renderer.layout.tooSmall) return false;
      const rect = root.getBoundingClientRect();
      const k = pauseKeyRect(renderer.layout.bar);
      const px = x - rect.left;
      const py = y - rect.top;
      return px >= k.x && px < k.x + k.w && py >= k.y && py < k.y + k.h;
    },
    onKey: () => pause(),
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
    const key = `${Math.round(l.dx)}|${Math.round(l.dy)}|${Math.round(l.power * 200)}|${state.tick}|${tune.aimCushions}`;
    if (line === null || key !== lineKey) {
      line = aimLine(state, l, tune);
      lineKey = key;
    }
    return line;
  };

  // ── Starting, ending, pausing ───────────────────────────────────────

  /** A new night on the start screen, made with every knob named so far. */
  const begin = (seed: number = newSeed(), start: StartOptions = {}) => {
    const next = mergeTune(DEFAULT_TUNE, named);
    // A best score under other rules says nothing about these.
    if (rulesDiffer(next, tune)) best = 0;
    tune = next;
    state = createState(seed, tune, start);
    queued = null;
    line = null;
    paused = false;
    overShown = false;
    newBest = false;
    holdUntil = 0;
    holdFor.clear();
    window.clearTimeout(overTimer);
    overTimer = 0;
    pointer.cancel();
    fx.reset();
    readKnobs();
    tell();
  };

  /** The night has just ended: a held pull is dropped, never fired, and the panel follows. */
  const ended = () => {
    pointer.cancel();
    queued = null;
    paused = false;
    newBest = state.score > best && state.score > 0;
    if (newBest) best = state.score;
    window.clearTimeout(overTimer);
    overTimer = window.setTimeout(() => {
      overTimer = 0;
      if (destroyed || state.phase !== "over") return;
      overShown = true;
      tell();
    }, END_PANEL_MS);
  };

  function pause(): void {
    // On any pause a held pull is dropped, never fired: also where there is no night to pause.
    pointer.cancel();
    if (destroyed || left || paused || !inNight()) return;
    paused = true;
    tell();
  }

  function resume(): void {
    // The key that paused must come up before anything resumes: a press
    // held a moment too long would pause and resume.
    if (destroyed || !paused || pauseKeyDown !== "" || renderer.layout.tooSmall) return;
    paused = false;
    holdUntil = performance.now() + RESUME_HOLD_MS;
    holdFor.clear();
    for (const id of down) holdFor.add(id);
    tell();
  }

  /** Is the room frozen for the moment after RESUME? */
  const resuming = () => holdFor.size > 0 || performance.now() < holdUntil;

  // ── Layout ──────────────────────────────────────────────────────────

  const coarse = window.matchMedia("(pointer: coarse)");
  let measuredDpr = 0;
  const relayout = () => {
    const changed = renderer.measure(coarse.matches, playable);
    measuredDpr = window.devicePixelRatio;
    if (!changed) return;
    // A resize drops a held pull and lays the screen out again. It pauses
    // a night in progress only if the new size is too small to play.
    pointer.cancel();
    if (renderer.layout.tooSmall) {
      queued = null;
      if (inNight() && !left) paused = true;
    }
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
    let over = false;
    for (const e of events) {
      freeze = Math.max(freeze, fx.onEvent(e));
      if (e.type === "over") over = true;
    }
    fx.afterTick(state);
    if (over) ended();
    tell();
    return freeze;
  };

  /** The picture's clock: the frame's, less the time spent paused. */
  let pausedFor = 0;
  let lastFrameAt = -1;

  const loop = createLoop({
    // The State says which ticks are slowed, and counts them: a pull is
    // held, something in the room can hurt him, and the meter is not empty.
    slowed: () => wouldSlow(state, { launch: queued, pullHeld: aimNow() !== null }),
    slowShare: () => tune.slowShare,
    launchQueued: () => queued !== null,
    held: () => renderer.layout.tooSmall || paused || left || resuming(),
    tick,
    render(frame) {
      // A window dragged to another screen changes the pixel ratio without a resize.
      if (window.devicePixelRatio !== measuredDpr) relayout();
      // A paused picture is a still one: the effects stop where they are,
      // and the clock the hints, the blink and the shake read stops with
      // them and goes on from where it stopped.
      const stopped = paused || left;
      if (stopped && lastFrameAt >= 0) pausedFor += frame.now - lastFrameAt;
      lastFrameAt = frame.now;
      const now = frame.now - pausedFor;
      if (!stopped) fx.update(frame.realDt, frame.scaledDt, now);
      const pull = pointer.pull();
      const aim = pull?.aim ?? null;
      renderer.draw({
        state,
        tune,
        alpha: frame.alpha,
        now,
        still: stopped,
        live: inNight() && !paused && !left,
        pull,
        line: aim ? lineFor(aim) : null,
        // The meter is shown only while a pull is held and there is a threat.
        meter: aim && threat(state) ? state.slow.meter / Math.max(1, tune.slowMeterMax) : -1,
        accent,
        reduced,
        effects: fx,
      });
    },
  });

  // ── Leaving and coming back ─────────────────────────────────────────

  const hidden = () => document.hidden || document.visibilityState === "hidden";
  // The page pauses itself when it is hidden and when the window loses
  // focus. In a hidden tab the frame loop stops as well. The loop measures
  // no time on its first frame back.
  listen(document, "visibilitychange", () => {
    if (!autopause) return;
    if (hidden()) {
      pause();
      loop.stop();
    } else {
      loop.start();
    }
  });
  listen(window, "blur", () => {
    // The key-ups and pointer-ups of a window without focus are never heard.
    pauseKeyDown = "";
    down.clear();
    holdFor.clear();
    if (autopause) pause();
  });
  listen(window, "pagehide", () => pause());

  // Esc or P pauses, while a night is in progress. One press is one
  // action, and a key pressed with Ctrl, Cmd or Alt is left alone. P is
  // read by its place on the keyboard, not by the letter printed on it.
  listen<KeyboardEvent>(root, "keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key !== "Escape" && e.code !== "KeyP") return;
    if (e.repeat) return;
    const can = inNight() && !paused && !left;
    // A held pull is dropped all the same.
    pause();
    if (can && paused) pauseKeyDown = e.key === "Escape" ? "Escape" : "KeyP";
  });
  // The panel is outside the root, so the key-up is watched on the window.
  listen<KeyboardEvent>(window, "keyup", (e) => {
    if (pauseKeyDown === "") return;
    if ((pauseKeyDown === "Escape" && e.key === "Escape") || (pauseKeyDown === "KeyP" && e.code === "KeyP")) pauseKeyDown = "";
  });

  // Which pointers are down, anywhere on the page: the press on RESUME is
  // outside the root, and the room must not start under it.
  listen<PointerEvent>(window, "pointerdown", (e) => down.add(e.pointerId), { capture: true });
  const lifted = (e: PointerEvent) => {
    down.delete(e.pointerId);
    holdFor.delete(e.pointerId);
  };
  listen<PointerEvent>(window, "pointerup", lifted, { capture: true });
  listen<PointerEvent>(window, "pointercancel", lifted, { capture: true });

  relayout();
  tell();
  if (!hidden()) loop.start();

  // ── Dev handle ──────────────────────────────────────────────────────

  if (DEV_HANDLES) {
    const w = window as unknown as { __knuff?: unknown };
    const dev: KnuffDev = {
      state: () => state,
      step(n) {
        if (renderer.layout.tooSmall || paused || left) return;
        for (let i = 0; i < n; i++) tick();
      },
      start(start = {}) {
        const { seed, ...options } = start;
        left = false;
        begin(seed ?? newSeed(), options);
      },
      setAutopause(on) {
        autopause = on;
        if (!on && !destroyed) loop.start();
      },
      launch(launch) {
        // As a release: there is none on a page too small, under a panel, or after the night.
        if (renderer.layout.tooSmall || paused || left || state.phase === "over") return;
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
      window.clearTimeout(overTimer);
      overTimer = 0;
      for (let i = disposers.length - 1; i >= 0; i--) disposers[i]();
      disposers.length = 0;
    },
    pause,
    resume,
    restart() {
      if (destroyed || left) return;
      begin();
    },
    abandon() {
      if (destroyed) return;
      left = true;
      paused = false;
      queued = null;
      window.clearTimeout(overTimer);
      overTimer = 0;
      pointer.cancel();
      tell();
    },
    setTune(patch) {
      if (destroyed || left) return;
      named = { ...named, ...patch };
      const next = mergeTune(DEFAULT_TUNE, named);
      readKnobs();
      if (!rulesDiffer(next, tune)) {
        // Only the line: it changes what is drawn and nothing else.
        tune = next;
        line = null;
        tell();
        return;
      }
      if (state.phase === "over") {
        // The rules wait for the night AGAIN starts; the line does not.
        tune = { ...tune, aimCushions: next.aimCushions };
        line = null;
        tell();
        return;
      }
      // On the start screen the night is made again; a night in progress
      // is dropped and the start screen comes back.
      begin();
    },
  };
}
