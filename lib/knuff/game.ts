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
 *
 * The sound (audio/) starts on the first touch or key, hears each tick's
 * events, and is closed on destroy; M mutes. The picture reads one motion
 * value, `reduced`: the player's choice (`setMotion`: auto, on or off, the
 * panel's system, reduced and full) laid over the system's setting.
 *
 * What is kept on the device goes through save.ts and nothing else: the
 * record (written when a night begins and when it ends), the three
 * settings (read here when the game is made, written when they change),
 * and the night of this browser session. That one is written at every
 * pause of a night in progress and when the page unmounts in the middle
 * of one; read when the game is made and left in place, so the Resume
 * panel can offer it; and deleted when the night goes on, when that panel
 * is answered, at BACK TO PLAYHOUSE and at the end of a night (§3.11).
 */
import { readAccent, subscribeAccent } from "@/lib/hugo/sprite";
import { createAudio, type Cue } from "./audio/audio";
import { createEars } from "./audio/events";
import { CHARM_NAME, END, KIND_NAME } from "./content/copy";
import { CLOCK } from "./content/night";
import { DEFAULT_TUNE } from "./content/tune";
import { DEV_HANDLES } from "./dev";
import type { KnuffFonts } from "./fonts";
import { createKeys } from "./input/keyboard";
import { attachPointer, type Aim, type PullView } from "./input/pointer";
import { createLoop } from "./loop";
import { createEffects } from "./render/effects";
import { pauseKeyRect, type Layout } from "./render/layout";
import { effectiveReduced, type MotionPref } from "./render/motion";
import { createRenderer } from "./render/renderer";
import { aimLine, type AimLine } from "./sim/aim";
import { threat } from "./sim/hot";
import { browserStorages, createStore, MORNING_CLOCK } from "./save";
import { createState, type StartOptions } from "./sim/state";
import { step, wouldSlow } from "./sim/step";
import type { Launch, SimEvent, State, Tune } from "./sim/types";

/** What the end panel shows. */
export type KnuffOver = {
  score: number;
  /** What the panel calls the night: the hour he fell in, 06:00 when the lights came on, or MORNING. */
  night: string;
  bestShot: number;
  /** The best score since the page opened, under these rules. Nothing is stored yet. */
  best: number;
  newBest: boolean;
  /** What took the last heart ("lost to a runaway token"), or "the lights came on"; empty when morning came. */
  line: string;
};

/**
 * What the page needs to know, and nothing more: which screen is up, the
 * settings, and when the night is over, what the end panel says.
 */
export type KnuffView = {
  screen: "start" | "play" | "paused" | "over" | "tooSmall";
  /**
   * A night paused or left earlier in this browser session waits: the hour
   * it stopped in ("23:00"), which the Resume panel offers. Null when none
   * waits, or once the panel is answered. The screen is "start" meanwhile.
   */
  waiting: string | null;
  /** Laid out for a phone (a coarse pointer): which line a page too small shows. */
  coarse: boolean;
  over: KnuffOver | null;
  /** The body charms taken this night, by name, in the order they were taken: the pause panel lists them. */
  charms: string[];
  /** Sound off (M, or the pause panel's switch). */
  muted: boolean;
  /** The player's choice of motion: "auto" (system), "on" (reduced) or "off" (full). */
  motion: MotionPref;
  /** Which way a pull launches him: "back" (away from the pull) or "push" (along it). */
  pull: "back" | "push";
};

/** The view before the game has said anything. */
export const FIRST_VIEW: KnuffView = {
  screen: "start",
  waiting: null,
  coarse: false,
  over: null,
  charms: [],
  muted: false,
  motion: "auto",
  pull: "back",
};

export type KnuffOptions = {
  fonts: KnuffFonts;
  /** The one callback: called when the view changes, never per frame. */
  onChange: (view: KnuffView) => void;
};

export type KnuffHandle = {
  /** Stop the loop and take every listener, observer and timer away. Safe to call twice. */
  destroy(): void;
  /** Pause. Does nothing unless a night is in progress; a held pull is dropped all the same. */
  pause(): void;
  /** Go on where it stopped. The room stays frozen for a moment, so the press that resumed is not a shot. */
  resume(): void;
  /** AGAIN and NEW NIGHT: a new seed and the start screen. Deletes the stored night. */
  restart(): void;
  /** RESUME 23:00: the night read when the game was made goes on, and its key is deleted. */
  resumeStored(): void;
  /** BACK TO PLAYHOUSE: the night ends with no panel, and the stored night is deleted. */
  abandon(): void;
  /** Sound on or off. M does the same from the keyboard. */
  setMuted(muted: boolean): void;
  /** Reduced motion: "auto" follows the system, "on" reduces, "off" never does. Changes the picture only. */
  setMotion(pref: MotionPref): void;
  /** Pull back, or push. A setting, not a rule: a held pull is dropped, and the night goes on. */
  setPull(dir: "back" | "push"): void;
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
  /** The aim line on the screen (a held pull's, or the keys'), or null. */
  aim(): AimLine | null;
  /** Is the frame loop running? */
  running(): boolean;
};

/** The end panel appears this long after the night ends, ms. */
const END_PANEL_MS = 800;
/** After RESUME the room stays frozen this long, ms, and until no pointer that was down is still down. */
const RESUME_HOLD_MS = 500;
/** The lights come on at the end of a night that reached 06:00's end, over this long, ms (§10, §12.7). */
const LIGHTS_MS = 1000;
/** His celebration pixels at MORNING change places this often, ms. */
const SPARKLE_MS = 220;

/** A new seed for a new game. Nobody promises that a seed plays the same on two devices. */
function newSeed(): number {
  return (Date.now() ^ (Math.random() * 0x100000000)) >>> 0;
}

export function createKnuff(root: HTMLElement, canvas: HTMLCanvasElement, opts: KnuffOptions): KnuffHandle {
  // Everything kept on the device, through save.ts. Storage that is blocked
  // is tolerated in silence: the game plays from memory.
  const storages = browserStorages();
  const store = createStore(storages.local, storages.session);
  /** The game's table (content/tune.ts). Only the pull's direction, a setting and not a rule, is ever changed in it. */
  let tune: Tune = { ...DEFAULT_TUNE, pullDir: store.readPull() };
  // First, and before anything is registered: this is the one call that can throw.
  const renderer = createRenderer(root, canvas, opts.fonts);
  const fx = createEffects(
    () => tune,
    () => state.stats.radius,
  );

  const disposers: Array<() => void> = [];
  // Made now, silent until the first touch or key: no AudioContext exists before then.
  const audio = createAudio();
  const ears = createEars();
  const cues: Cue[] = [];
  let muted = store.readMuted();
  audio.setMuted(muted);
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
  /**
   * The night this browser session kept, as it was read when the game was
   * made; its key is left in place until the Resume panel is answered.
   * While it waits nothing is played and nothing writes the key.
   */
  let stored = store.readRun(tune);
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
  /** The best score kept on the device, as the last night left it. */
  let best = store.readSave().best;
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

  const over = (): KnuffOver | null => {
    if (state.phase !== "over") return null;
    const morning = state.ended === "morning";
    // 06:00 ran out with the polisher unbeaten: the night is called 06:00, and the lights came on.
    const dawn = state.ended === "dawn";
    const hour = dawn ? state.night.hour : state.lastHurtHour >= 0 ? state.lastHurtHour : state.night.hour;
    const by = KIND_NAME[state.lastHurtBy];
    return {
      score: state.score,
      night: morning ? END.morning : CLOCK[Math.min(Math.max(0, hour), CLOCK.length - 1)],
      bestShot: state.bestShot,
      best,
      newBest,
      line: morning ? "" : dawn ? END.dawn : by ? `${END.lostTo} ${by}` : "",
    };
  };

  const view = (): KnuffView => ({
    screen: left
      ? "play"
      : renderer.layout.tooSmall
        ? "tooSmall"
        : stored !== null || state.phase === "waiting"
          ? "start"
          : state.phase === "over"
            ? overShown
              ? "over"
              : "play"
            : paused
              ? "paused"
              : "play",
    waiting: stored !== null && !left ? CLOCK[Math.min(Math.max(0, stored.night.hour), CLOCK.length - 1)] : null,
    coarse: renderer.layout.coarse,
    over: overShown ? over() : null,
    charms: state.charms.map((c) => CHARM_NAME[c] ?? c),
    muted,
    motion,
    pull: tune.pullDir,
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

  /** Is a launch taken now? Not on a page too small, under a panel, while a night waits to be resumed, or once the night is over. */
  const taking = () => !renderer.layout.tooSmall && !paused && !left && stored === null && state.phase !== "over";
  const pointer = attachPointer(root, {
    tune: () => tune,
    enabled: taking,
    onLaunch: (launch) => {
      queued = launch;
    },
    onPress: () => {
      // A press that is cancelled does not move the focus by itself, and
      // keys are heard only while the root has it.
      root.focus({ preventScroll: true });
      // The keys' aim line is hidden again at the next touch or mouse press.
      keys.pressed();
    },
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

  // The keys (§4.3): the same launches, at full power, aimed by turning
  // or by pointing at the nearest intruder.
  const keys = createKeys({
    state: () => state,
    enabled: taking,
    onLaunch: (launch) => {
      // A key fires what its line showed; a pull held at that moment is dropped.
      pointer.cancel();
      queued = launch;
    },
  });
  /** Slow motion follows the same meter for a thumb and for the keys: a pull held, or an aim key down or just up. */
  const pullHeld = () => aimNow() !== null || keys.held(performance.now());
  /**
   * The keys' aim, drawn as a full pull: the band behind him and the line
   * ahead. Shown once an aim key has been used, until the next touch or
   * mouse press, and only while a launch can be taken.
   */
  const keyPull = (): PullView | null => {
    const k = keys.aim();
    if (!k || !taking() || pointer.pull() !== null) return null;
    return {
      x0: 0,
      y0: 0,
      x: 0,
      y: 0,
      pointerType: "keys",
      aim: { launch: { dx: k.dx, dy: k.dy, power: 1 }, pull01: 1, lengthPx: tune.pullFullPx, short: false },
    };
  };

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

  /** A new night on the start screen. */
  const begin = (seed: number = newSeed(), start: StartOptions = {}) => {
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
    keys.reset();
    fx.reset();
    ears.reset();
    lightsFrom = -1;
    loopNow();
    tell();
  };

  /** The night has just ended: a held pull is dropped, never fired, and the panel follows. */
  const ended = () => {
    pointer.cancel();
    queued = null;
    paused = false;
    // A night that is over is not kept: it cannot be used to retry an hour.
    store.deleteRun();
    const morning = state.ended === "morning";
    // How far it got: the hour he fell in (0 to 10), 11 for the boss, 12 for morning.
    const hour = state.ended === "dawn" ? state.night.hour : state.lastHurtHour >= 0 ? state.lastHurtHour : state.night.hour;
    const record = store.nightEnded({
      score: state.score,
      clock: morning ? MORNING_CLOCK : Math.min(MORNING_CLOCK - 1, Math.max(0, hour)),
      bestShot: state.bestShot,
      morning,
    });
    best = record.save.best;
    newBest = record.newBest && state.score > 0;
    // Morning is the one thing that makes him happy across the site: once a night, never for a best score alone.
    if (morning) window.dispatchEvent(new CustomEvent("hugoslekstuga:hugo-happy"));
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
    keys.release(performance.now());
    if (destroyed || left || paused || !inNight()) return;
    paused = true;
    // Whoever paused it, the night is kept for this browser session.
    store.writeRun(tune, state);
    loopNow();
    tell();
  }

  function resume(): void {
    // The key that paused must come up before anything resumes: a press
    // held a moment too long would pause and resume.
    if (destroyed || !paused || pauseKeyDown !== "" || renderer.layout.tooSmall) return;
    paused = false;
    // It goes on: the key only ever holds a night that is not running.
    store.deleteRun();
    hold();
    loopNow();
    tell();
  }

  /** After RESUME the room stays frozen for a moment, and until every pointer that was down is up. */
  function hold(): void {
    holdUntil = performance.now() + RESUME_HOLD_MS;
    holdFor.clear();
    for (const id of down) holdFor.add(id);
  }

  /** The polisher's loop plays while it is in the room and the night runs; it quickens as the machine does. */
  function loopNow(): void {
    const on = !destroyed && !paused && !left && state.phase === "boss" && state.boss.present && state.boss.mode !== "down";
    audio.setLoop(on, state.boss.speed / Math.max(1, tune.bossSpeed));
  }

  /** Sound on or off: M, and the pause panel's switch through the handle. */
  function setMuted(next: boolean): void {
    if (destroyed || next === muted) return;
    muted = next;
    audio.setMuted(muted);
    // M and the pause panel's switch both come here, so both are kept.
    store.writeMuted(muted);
    tell();
  }

  /** Is the room frozen for the moment after RESUME? */
  const resuming = () => holdFor.size > 0 || performance.now() < holdUntil;

  // ── Layout ──────────────────────────────────────────────────────────

  const coarse = window.matchMedia("(pointer: coarse)");
  let measuredDpr = 0;
  const relayout = () => {
    const changed = renderer.measure(coarse.matches);
    measuredDpr = window.devicePixelRatio;
    if (!changed) return;
    // A resize drops a held pull and lays the screen out again. It pauses
    // a night in progress only if the new size is too small to play.
    pointer.cancel();
    if (renderer.layout.tooSmall) {
      queued = null;
      // Written like any other pause; the Too small panel stands where the pause panel would.
      if (inNight() && !left && !paused) {
        paused = true;
        store.writeRun(tune, state);
        loopNow();
      }
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

  // The one motion value the picture reads: the player's choice laid over the system's setting.
  const lessMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let motion: MotionPref = store.readMotion();
  let reduced = effectiveReduced(motion, lessMotion.matches);
  fx.setReduced(reduced);
  const rethinkMotion = () => {
    reduced = effectiveReduced(motion, lessMotion.matches);
    fx.setReduced(reduced);
  };
  listen(lessMotion, "change", rethinkMotion);

  // ── Sound ───────────────────────────────────────────────────────────

  // The first touch or key of the visit makes the sound, inside that
  // gesture; every later one wakes it if the browser let it sleep. On the
  // window, in the capture phase: the first press can be RESUME or NEW
  // NIGHT, which are outside the root (§12.6).
  const unlock = () => audio.unlock();
  for (const type of ["pointerup", "touchend", "click", "keydown"]) listen(window, type, unlock, { capture: true });

  // ── The loop ────────────────────────────────────────────────────────

  const events: SimEvent[] = [];

  /** One tick, with everything that hangs on it. The dev handle's step() is this too. */
  const tick = (): number => {
    events.length = 0;
    const launch = queued;
    queued = null;
    const waiting = state.phase === "waiting";
    step(state, { launch, pullHeld: pullHeld() }, tune, events);
    // The first launch begins the night, and the record counts it.
    if (waiting && inNight()) store.nightBegan();
    let freeze = 0;
    let over = false;
    for (const e of events) {
      freeze = Math.max(freeze, fx.onEvent(e));
      if (e.type === "over") over = true;
    }
    fx.afterTick(state);
    for (const c of ears.hear(events, state, tune, cues)) audio.play(c);
    if (over) ended();
    loopNow();
    tell();
    return freeze;
  };

  /** The picture's clock: the frame's, less the time spent paused. */
  let pausedFor = 0;
  let lastFrameAt = -1;
  /** When the lights began to come on, on the picture's clock; -1 until a night ends at 06:00's end. */
  let lightsFrom = -1;

  const loop = createLoop({
    // The State says which ticks are slowed, and counts them: a pull is
    // held, something in the room can hurt him, and the meter is not empty.
    slowed: () => wouldSlow(state, { launch: queued, pullHeld: pullHeld() }),
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
      keys.frame(performance.now());
      const pull = pointer.pull() ?? keyPull();
      const aim = pull?.aim ?? null;
      // When a night ends as MORNING or as "the lights came on", the lights come on (§10).
      const lit = state.phase === "over" && (state.ended === "morning" || state.ended === "dawn");
      if (lit && lightsFrom < 0) lightsFrom = now;
      const lights = lit ? Math.min(1, (now - lightsFrom) / LIGHTS_MS) : 0;
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
        meter: aim && pullHeld() && threat(state) ? state.slow.meter / Math.max(1, tune.slowMeterMax) : -1,
        accent,
        reduced,
        lights,
        // At MORNING he wears the sprite's celebration pixels; held still with reduced motion.
        sparkle: lit && state.ended === "morning" ? (reduced ? 0 : Math.floor((now - lightsFrom) / SPARKLE_MS) % 2) : null,
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
      audio.sleep();
    } else {
      loop.start();
      audio.wake();
    }
  });
  listen(window, "blur", () => {
    // The key-ups and pointer-ups of a window without focus are never heard.
    pauseKeyDown = "";
    down.clear();
    holdFor.clear();
    keys.release(performance.now());
    if (autopause) pause();
  });
  listen(window, "pagehide", () => pause());

  // The keys act only while the root has the focus, and a key pressed with
  // Ctrl, Cmd or Alt is left alone (the site's palette is Cmd-K and /).
  // Letters are read by their place on the keyboard, not by the letter
  // printed on them. One press is one action.
  listen<KeyboardEvent>(root, "keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // M mutes, at any time, one press one change (decision 11).
    if (e.code === "KeyM") {
      if (!e.repeat) setMuted(!muted);
      return;
    }
    // Aim, point and launch. Their defaults (scrolling, a click) are not wanted on the root.
    if (keys.down(e, performance.now())) {
      e.preventDefault();
      return;
    }
    // Esc or P pauses, while a night is in progress.
    if (e.key !== "Escape" && e.code !== "KeyP") return;
    if (e.repeat) return;
    const can = inNight() && !paused && !left;
    // A held pull is dropped all the same.
    pause();
    if (can && paused) pauseKeyDown = e.key === "Escape" ? "Escape" : "KeyP";
  });
  // The panel is outside the root, so the key-up is watched on the window.
  // So are the aim keys': one may come up after a panel has taken the focus.
  listen<KeyboardEvent>(window, "keyup", (e) => {
    keys.up(e, performance.now());
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
        // As NEW NIGHT: a night that was waiting is not offered again.
        stored = null;
        store.deleteRun();
        begin(seed ?? newSeed(), options);
      },
      setAutopause(on) {
        autopause = on;
        if (!on && !destroyed) loop.start();
      },
      launch(launch) {
        // As a release: there is none on a page too small, under a panel, or after the night.
        if (renderer.layout.tooSmall || paused || left || stored !== null || state.phase === "over") return;
        queued = launch;
      },
      tune: () => tune,
      view,
      layout: () => renderer.layout,
      pull: () => pointer.pull(),
      aim() {
        // The line on the screen: a held pull's, or the keys'.
        const aim = (pointer.pull() ?? keyPull())?.aim ?? null;
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
      // Left in the middle of a night (the Back button, a row of the search
      // palette: neither sends a pagehide): it is kept for this session.
      if (inNight() && !left) store.writeRun(tune, state);
      destroyed = true;
      loop.stop();
      audio.dispose();
      window.clearTimeout(overTimer);
      overTimer = 0;
      for (let i = disposers.length - 1; i >= 0; i--) disposers[i]();
      disposers.length = 0;
    },
    pause,
    resume,
    restart() {
      if (destroyed || left) return;
      // NEW NIGHT answers the Resume panel; AGAIN has nothing kept to delete.
      stored = null;
      store.deleteRun();
      begin();
    },
    resumeStored() {
      if (destroyed || left || stored === null) return;
      // The copy read when the game was made, not the key a second time.
      const night = stored;
      stored = null;
      store.deleteRun();
      begin(night.seed);
      state = night;
      hold();
      loopNow();
      tell();
    },
    abandon() {
      if (destroyed) return;
      // The night it leaves is not offered again.
      stored = null;
      store.deleteRun();
      left = true;
      paused = false;
      queued = null;
      loopNow();
      window.clearTimeout(overTimer);
      overTimer = 0;
      pointer.cancel();
      tell();
    },
    setMuted,
    setMotion(pref) {
      if (destroyed || pref === motion) return;
      motion = pref;
      store.writeMotion(motion);
      rethinkMotion();
      tell();
    },
    setPull(dir) {
      if (destroyed || dir === tune.pullDir) return;
      // A held pull would turn round under the thumb: it is dropped, never fired.
      pointer.cancel();
      tune = { ...tune, pullDir: dir };
      line = null;
      store.writePull(dir);
      tell();
    },
  };
}
