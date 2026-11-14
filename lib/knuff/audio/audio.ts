/**
 * The sound (§10): all synthesised with WebAudio, no audio file anywhere.
 *
 * Nothing is made until the first touch or key of the visit: `unlock()`
 * creates the AudioContext inside that gesture (a phone refuses sound
 * made any other way) and resumes it after a hidden tab. A phone's silent
 * switch silences sound made in script and most phones are on silent, so
 * every cue also has something to see; the game does not work around the
 * switch.
 *
 * The cues are short tones and filtered noise, after the feel toy's
 * (launch, cushion, the pop's pentatonic, the landing, the nope, the pip),
 * which the owner played. The polisher's two-bar loop is scheduled a
 * quarter of a second ahead on the context's own clock, as Adventure's
 * music is: a timer only wakes the scheduler.
 *
 * The mute is held here; its key is read and written through save.ts by
 * the app layer, not here (§12.1). `dispose()` stops the scheduler and
 * closes the context: browsers cap live contexts, and a route that mounts
 * twice under StrictMode must not keep one per mount.
 */

/** One sound, and what pitches it. */
export type Cue =
  | { k: "launch"; power: number }
  | { k: "pop"; n: number }
  | { k: "cushion"; speed: number }
  | { k: "plate"; charm: string }
  | { k: "land" }
  | { k: "pip" }
  | { k: "nope" }
  | { k: "announce" }
  | { k: "patter"; n: number }
  | { k: "hurt" }
  | { k: "battery"; late: boolean }
  | { k: "blast" }
  | { k: "chime" }
  | { k: "hour" }
  | { k: "morning" }
  | { k: "lights" }
  | { k: "flick" }
  | { k: "hit"; kind: "polisher" | "gum" | "bag" }
  | { k: "knock" }
  | { k: "down" }
  | { k: "throw" };

export type KnuffAudio = {
  /** The first touch or key, and every one after: make the context once, and wake it if the browser put it to sleep. */
  unlock(): void;
  /** Has a context been made? */
  readonly started: boolean;
  readonly muted: boolean;
  setMuted(muted: boolean): void;
  /** Play one cue now. Nothing while muted, before the first touch or key, or after dispose. */
  play(cue: Cue): void;
  /** The polisher's loop: on while it is in the room and the night runs; `pace` (1 at its starting speed) quickens it as the machine speeds up. */
  setLoop(on: boolean, pace?: number): void;
  /** A hidden tab: let the context sleep. `unlock` or `wake` brings it back. */
  sleep(): void;
  /** The tab is shown again: resume a context that exists (a phone may still want a touch). */
  wake(): void;
  /** Stop the scheduler and close the context. Nothing plays after this. Safe to call twice. */
  dispose(): void;
};

export type AudioOptions = {
  /** Makes the context: the browser's AudioContext unless a test hands in its own. Null where there is none. */
  make?: () => AudioContext | null;
  /** The scheduler's timer, and how to stop it: the window's unless a test hands in its own. */
  every?: (fn: () => void, ms: number) => number;
  stop?: (id: number) => void;
};

/** The pops of a launch climb this scale, one phrase per launch: C major pentatonic over two octaves (the toy's). */
const SCALE = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98, 1760.0];
/** Never more than this many sounds at once. */
const MAX_VOICES = 20;
/** The master level, under the compressor. */
const LEVEL = 0.55;
/** How far ahead the loop is scheduled, s, and how often the scheduler wakes, ms. */
const AHEAD_S = 0.25;
const WAKE_MS = 60;
/** The loop: 120 steps a minute at the polisher's starting speed, eight to a bar, two bars. */
const LOOP_BPM = 120;
const LOOP_STEPS = 16;
/** The motor's line under the loop, as MIDI notes (0 = rest), and where the brush hisses. */
const LOOP_BASS = [45, 0, 45, 48, 45, 0, 52, 0, 43, 0, 43, 47, 43, 0, 50, 48];
const LOOP_BRUSH = [0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1];

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
/** A number a parameter can take: finite, and inside the range given. */
const safe = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

/** The browser's context (its type is inferred: nothing at a module's top level names a page global, as the architecture suite reads it). */
function browserContext() {
  const scope = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Make = scope.AudioContext ?? scope.webkitAudioContext;
  return Make ? new Make() : null;
}

export function createAudio(opts: AudioOptions = {}): KnuffAudio {
  const make = opts.make ?? browserContext;
  const every = opts.every ?? ((fn: () => void, ms: number) => window.setInterval(fn, ms));
  const stop = opts.stop ?? ((id: number) => window.clearInterval(id));

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let voices = 0;
  let muted = false;
  let disposed = false;
  let timer = -1;
  let looping = false;
  let loopPace = 1;
  let nextStepAt = 0;
  let step = 0;

  const level = () => (muted ? 0 : LEVEL);

  /** One tone: `type` from `f0` gliding to `f1` over `dur` s, at `vol`, `when` s from now. */
  function tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, when = 0): void {
    if (!ctx || !master || voices >= MAX_VOICES) return;
    const t = ctx.currentTime + Math.max(0, when);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(safe(f0, 20, 18000), t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(safe(f1, 20, 18000), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(safe(vol, 0.0002, 1), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.01, dur));
    o.connect(g);
    g.connect(master);
    voices++;
    o.onended = () => {
      voices--;
      o.disconnect();
      g.disconnect();
    };
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  /** Filtered noise: a hiss, a crack, a patter. `freq` the band's middle, gliding down to `to`. */
  function noise(dur: number, vol: number, freq: number, to = freq * 0.4, when = 0, type: BiquadFilterType = "bandpass"): void {
    if (!ctx || !master || !noiseBuf || voices >= MAX_VOICES) return;
    const t = ctx.currentTime + Math.max(0, when);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(safe(freq, 40, 16000), t);
    f.frequency.exponentialRampToValueAtTime(safe(to, 40, 16000), t + Math.max(0.01, dur));
    const g = ctx.createGain();
    g.gain.setValueAtTime(safe(vol, 0.0002, 1), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.01, dur));
    src.connect(f);
    f.connect(g);
    g.connect(master);
    voices++;
    src.onended = () => {
      voices--;
      src.disconnect();
      f.disconnect();
      g.disconnect();
    };
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.03);
  }

  /** Each charm's own bright tick as its plate fires. */
  function plate(charm: string): void {
    switch (charm) {
      case "bumper":
        tone("square", 880, 1760, 0.06, 0.07);
        tone("triangle", 1320, 1320, 0.08, 0.06, 0.03);
        return;
      case "pip":
        tone("sine", 1568, 2093, 0.07, 0.09);
        return;
      case "spark":
        noise(0.08, 0.12, 7000, 4000, 0, "highpass");
        tone("square", 2637, 2637, 0.03, 0.04);
        return;
      case "bell":
        // A bell: a pure tone and an inharmonic partial, ringing longer.
        tone("sine", 1046.5, 1046.5, 0.45, 0.09);
        tone("sine", 2793, 2793, 0.25, 0.035);
        return;
      case "coin":
        tone("square", 988, 988, 0.05, 0.06);
        tone("square", 1319, 1319, 0.12, 0.06, 0.05);
        return;
      default:
        tone("triangle", 1200, 1200, 0.05, 0.06);
    }
  }

  function sound(c: Cue): void {
    switch (c.k) {
      case "launch": {
        // A rising blip pitched by power (the toy's).
        const p = safe(c.power, 0, 1);
        tone("triangle", 180 + 120 * p, 420 + 520 * p, 0.11, 0.22);
        return;
      }
      case "pop": {
        // One note; the pops of a launch climb the scale, one phrase per launch.
        const f = SCALE[Math.min(SCALE.length - 1, Math.max(0, c.n - 1))];
        tone("triangle", f, f * 1.01, 0.16, 0.24);
        tone("square", f * 2, f * 2, 0.05, 0.045);
        return;
      }
      case "cushion": {
        // A thud pitched by speed (the toy's wall).
        const s = safe(c.speed, 0, 1);
        tone("square", 150 + 90 * s, 90, 0.045, 0.05 + 0.08 * s);
        return;
      }
      case "plate":
        plate(c.charm);
        return;
      case "land":
        // A soft thump (the toy's bump), with a breath of floor.
        tone("sine", 140, 80, 0.08, 0.14);
        noise(0.05, 0.05, 500, 200);
        return;
      case "pip":
        tone("sine", 1250, 1250, 0.03, 0.04);
        return;
      case "nope":
        // A low "nope": down, then down again.
        tone("sawtooth", 110, 90, 0.08, 0.09);
        tone("sawtooth", 95, 70, 0.1, 0.09, 0.09);
        return;
      case "announce":
        // A short rising figure.
        tone("triangle", midi(72), midi(72), 0.05, 0.05);
        tone("triangle", midi(76), midi(76), 0.05, 0.05, 0.05);
        tone("triangle", midi(79), midi(79), 0.07, 0.05, 0.1);
        return;
      case "patter": {
        // A soft patter: a tap for each thing that landed, a few at most.
        const n = Math.min(4, Math.max(1, c.n));
        for (let i = 0; i < n; i++) noise(0.025, 0.06, 2400 - i * 200, 1200, i * 0.035);
        return;
      }
      case "hurt":
        // A low buzz.
        tone("sawtooth", 82, 62, 0.32, 0.2);
        tone("square", 41, 38, 0.32, 0.08);
        return;
      case "battery":
        tone("square", c.late ? 2200 : 1800, c.late ? 2200 : 1800, 0.012, 0.025);
        return;
      case "blast":
        // A crack, and the room's floor under it.
        noise(0.18, 0.32, 4000, 600);
        tone("sine", 120, 45, 0.25, 0.22);
        return;
      case "chime":
        // A two-note chime.
        tone("triangle", 1318.5, 1318.5, 0.14, 0.12);
        tone("triangle", 1760, 1760, 0.22, 0.12, 0.11);
        return;
      case "hour":
        // A clock chime: two struck notes a fourth apart.
        tone("sine", 784, 784, 0.5, 0.09);
        tone("sine", 1568, 1568, 0.2, 0.03);
        tone("sine", 587.33, 587.33, 0.6, 0.09, 0.28);
        return;
      case "morning":
        // A bright figure, up the scale and home.
        [0, 2, 4, 5, 7, 9].forEach((i, j) => tone("triangle", SCALE[i], SCALE[i], 0.2, 0.13, j * 0.09));
        tone("sine", SCALE[9], SCALE[9], 0.6, 0.08, 0.6);
        return;
      case "lights":
        // The lights coming on: a tube's tick and hum.
        tone("square", 2400, 2400, 0.015, 0.03);
        tone("sine", 100, 100, 0.4, 0.04, 0.05);
        return;
      case "flick":
        // A small tick, quieter than the thump: a token turned away.
        tone("square", 3200, 2600, 0.02, 0.025);
        return;
      case "hit":
        if (c.kind === "polisher") {
          // A clank on the plug.
          tone("square", 220, 140, 0.12, 0.14);
          noise(0.08, 0.12, 3000, 1200);
        } else if (c.kind === "gum") {
          // A squelch.
          tone("sine", 260, 120, 0.12, 0.16);
        } else {
          // The sack: a dull thump with coins in it.
          tone("sine", 160, 90, 0.12, 0.16);
          tone("square", 1975, 1975, 0.04, 0.035, 0.03);
        }
        return;
      case "knock":
        tone("triangle", 1400, 1100, 0.06, 0.1);
        return;
      case "down":
        // It powers down.
        tone("sawtooth", 220, 40, 0.9, 0.14);
        noise(0.6, 0.08, 800, 120);
        return;
      case "throw":
        // A whoosh: the pad throws him.
        noise(0.22, 0.12, 900, 2600);
        return;
    }
  }

  /** The loop's scheduler: lays the steps that fall inside the next quarter second on the context's clock. */
  function schedule(): void {
    if (!ctx || !master || !looping || muted || ctx.state !== "running") return;
    const stepS = 60 / (LOOP_BPM * safe(loopPace, 0.5, 2)) / 2;
    if (nextStepAt < ctx.currentTime) nextStepAt = ctx.currentTime + 0.03;
    while (nextStepAt < ctx.currentTime + AHEAD_S) {
      const when = nextStepAt - ctx.currentTime;
      const i = step % LOOP_STEPS;
      const note = LOOP_BASS[i];
      if (note > 0) tone("sawtooth", midi(note - 12), midi(note - 12), stepS * 0.9, 0.06, when);
      if (LOOP_BRUSH[i]) noise(stepS * 0.6, 0.025, 6000, 3000, when, "highpass");
      nextStepAt += stepS;
      step++;
    }
  }

  return {
    unlock() {
      if (disposed) return;
      try {
        if (!ctx) {
          const made = make();
          if (!made) return;
          ctx = made;
          master = ctx.createGain();
          master.gain.value = level();
          const comp = ctx.createDynamicsCompressor();
          master.connect(comp);
          comp.connect(ctx.destination);
          // One second of noise, made once, for every hiss and crack.
          const len = Math.max(1, Math.floor(ctx.sampleRate));
          noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
          const data = noiseBuf.getChannelData(0);
          for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
          timer = every(schedule, WAKE_MS);
        }
        if (ctx.state === "suspended") void ctx.resume().catch(() => {});
      } catch {
        // No sound on this device: the game plays on in silence.
      }
    },
    get started() {
      return ctx !== null;
    },
    get muted() {
      return muted;
    },
    setMuted(next) {
      muted = next;
      if (ctx && master) master.gain.setTargetAtTime(level(), ctx.currentTime, 0.015);
    },
    play(c) {
      if (!ctx || !master || muted || disposed || ctx.state !== "running") return;
      try {
        sound(c);
      } catch {
        // A sound that fails is a sound not heard; the game goes on.
      }
    },
    setLoop(on, pace = 1) {
      loopPace = pace;
      if (on === looping) return;
      looping = on;
      if (on) {
        step = 0;
        nextStepAt = 0;
      }
    },
    sleep() {
      if (ctx && ctx.state === "running") void ctx.suspend().catch(() => {});
    },
    wake() {
      if (ctx && !disposed && ctx.state === "suspended") void ctx.resume().catch(() => {});
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      looping = false;
      if (timer !== -1) stop(timer);
      timer = -1;
      if (ctx) void ctx.close().catch(() => {});
      ctx = null;
      master = null;
      noiseBuf = null;
    },
  };
}
