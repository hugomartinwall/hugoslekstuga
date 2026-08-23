/**
 * WebAudio voice synthesis — every sound is generated, nothing sampled.
 *
 * Ported from game1, where the envelope and cleanup shape were proven: a voice
 * is 1–2 oscillators (or the shared noise buffer) → optional biquad → per-voice
 * gain → the master bus, and every envelope ends with an exponential ramp to
 * near-zero and an explicit `stop()`, so nodes disconnect and GC themselves.
 *
 * The recipes are new, because the game is. Turn-based combat needs FEWER and
 * BETTER sounds than a real-time one: at most a couple of voices fire per turn,
 * each with a beat of silence around it, so each one is heard properly and has
 * to carry meaning on its own.
 *
 * Zero audio bytes ship (`CLAUDE.md` §2 — no asset we cannot regenerate from
 * code), which is also why the whole音 budget is free.
 */

export type Priority = 0 | 1 | 2; // low | mid | high

/** The primary source node of a voice — its `onended` marks the voice free. */
export type VoiceEnd = AudioScheduledSourceNode;

/**
 * A 0.5 s white-noise buffer, built once per context.
 *
 * `Math.random` is fine here and ONLY here: this is presentation, outside
 * `src/sim/`, and noise that replayed identically every time would be a
 * strange thing to want.
 */
export function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

interface Env {
  attack: number;
  duration: number;
  peak: number;
}

function envGain(ctx: AudioContext, out: AudioNode, e: Env, at = 0): GainNode {
  const g = ctx.createGain();
  const t = ctx.currentTime + at;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(e.peak, t + e.attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + e.duration);
  g.connect(out);
  return g;
}

function osc(
  ctx: AudioContext,
  type: OscillatorType,
  freq: number,
  out: AudioNode,
  stopAt: number,
  at = 0,
): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, ctx.currentTime + at);
  o.connect(out);
  o.start(ctx.currentTime + at);
  o.stop(ctx.currentTime + at + stopAt);
  return o;
}

function noise(
  ctx: AudioContext,
  buffer: AudioBuffer,
  out: AudioNode,
  stopAt: number,
): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.connect(out);
  src.start();
  src.stop(ctx.currentTime + stopAt);
  return src;
}

/* ------------------------------------------------------------ the recipes */

/**
 * A landed physical blow. Low thump plus a filtered noise crack.
 *
 * `weight` 0..1 scales pitch down and length up, so a big hit is *bigger*
 * rather than merely louder — the same principle as the impact hold in
 * `ART_DIRECTION.md` §5.
 */
export function playImpact(
  ctx: AudioContext,
  buf: AudioBuffer,
  out: AudioNode,
  weight = 0.5,
): VoiceEnd {
  const t = ctx.currentTime;
  const dur = 0.16 + weight * 0.16;
  const g = envGain(ctx, out, { attack: 0.004, duration: dur, peak: 0.26 });
  const body = ctx.createOscillator();
  body.type = "sine";
  body.frequency.setValueAtTime(210 - weight * 90, t);
  body.frequency.exponentialRampToValueAtTime(60, t + dur * 0.7);
  body.connect(g);
  body.start();
  body.stop(t + dur);

  const ng = envGain(ctx, out, { attack: 0.002, duration: 0.07, peak: 0.14 });
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(1400 - weight * 600, t);
  lp.connect(ng);
  noise(ctx, buf, lp, 0.07);
  return body;
}

/** Fire: a breathy upward rush. */
export function playFire(ctx: AudioContext, buf: AudioBuffer, out: AudioNode): VoiceEnd {
  const t = ctx.currentTime;
  const g = envGain(ctx, out, { attack: 0.02, duration: 0.42, peak: 0.2 });
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.setValueAtTime(1.1, t);
  bp.frequency.setValueAtTime(420, t);
  bp.frequency.exponentialRampToValueAtTime(1900, t + 0.32);
  bp.connect(g);
  return noise(ctx, buf, bp, 0.42);
}

/** Water: a rounded, damp plop. */
export function playWater(ctx: AudioContext, out: AudioNode): VoiceEnd {
  const t = ctx.currentTime;
  const g = envGain(ctx, out, { attack: 0.006, duration: 0.28, peak: 0.2 });
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(680, t);
  o.frequency.exponentialRampToValueAtTime(190, t + 0.2);
  o.connect(g);
  o.start();
  o.stop(t + 0.28);
  return o;
}

/**
 * Lightning: a hard crack with a bright tail.
 *
 * `chain` makes it longer and adds a rising second strike, so the combo firing
 * sounds like more than one thing happening — the audio half of the "Chain!"
 * flash.
 */
export function playLightning(
  ctx: AudioContext,
  buf: AudioBuffer,
  out: AudioNode,
  chain = false,
): VoiceEnd {
  const t = ctx.currentTime;
  const g = envGain(ctx, out, { attack: 0.001, duration: chain ? 0.5 : 0.3, peak: 0.3 });
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.setValueAtTime(1500, t);
  hp.frequency.exponentialRampToValueAtTime(400, t + 0.24);
  hp.connect(g);
  const src = noise(ctx, buf, hp, chain ? 0.5 : 0.3);

  const zg = envGain(ctx, out, { attack: 0.001, duration: 0.14, peak: 0.16 });
  osc(ctx, "square", 2400, zg, 0.14);
  if (chain) {
    // The jump: a second, higher crack a beat later.
    const cg = envGain(ctx, out, { attack: 0.001, duration: 0.2, peak: 0.18 }, 0.13);
    osc(ctx, "square", 3200, cg, 0.2, 0.13);
  }
  return src;
}

/** Frost: a thin, glassy shimmer. */
export function playFrost(ctx: AudioContext, out: AudioNode): VoiceEnd {
  const t = ctx.currentTime;
  const g = envGain(ctx, out, { attack: 0.01, duration: 0.5, peak: 0.14 });
  const o = ctx.createOscillator();
  o.type = "triangle";
  o.frequency.setValueAtTime(1400, t);
  o.frequency.linearRampToValueAtTime(2100, t + 0.4);
  o.connect(g);
  o.start();
  o.stop(t + 0.5);
  osc(ctx, "sine", 3150, envGain(ctx, out, { attack: 0.01, duration: 0.45, peak: 0.05 }), 0.45);
  return o;
}

/** A combatant falls: a descending, deflating sigh. */
export function playDeath(ctx: AudioContext, buf: AudioBuffer, out: AudioNode): VoiceEnd {
  const t = ctx.currentTime;
  const g = envGain(ctx, out, { attack: 0.01, duration: 0.6, peak: 0.18 });
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(900, t);
  lp.frequency.exponentialRampToValueAtTime(220, t + 0.5);
  lp.connect(g);
  const src = noise(ctx, buf, lp, 0.6);
  const o = ctx.createOscillator();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(240, t);
  o.frequency.exponentialRampToValueAtTime(70, t + 0.5);
  o.connect(envGain(ctx, out, { attack: 0.01, duration: 0.55, peak: 0.1 }));
  o.start();
  o.stop(t + 0.55);
  return src;
}

/**
 * The stage-clear toast chime — the boundary slid past, no pause, no panel.
 *
 * Reborn from the turn build's `playTurn` (the "your move" chime), which
 * shipped exported and unplayed after the pivot: the same light rising
 * triangle, because both mean "the game just moved forward under you". Kept
 * deliberately smaller than `playVictory` — the fight fanfare owns the
 * triad; a boundary is a stride, not a win.
 */
export function playToast(ctx: AudioContext, out: AudioNode): VoiceEnd {
  const t = ctx.currentTime;
  const g = envGain(ctx, out, { attack: 0.004, duration: 0.3, peak: 0.14 });
  const o = ctx.createOscillator();
  o.type = "triangle";
  o.frequency.setValueAtTime(880, t);
  o.frequency.linearRampToValueAtTime(1170, t + 0.06);
  o.connect(g);
  o.start();
  o.stop(t + 0.3);
  return o;
}

/**
 * The take-fanfare: an element FOUND and taken with a press — the opening's
 * whole reward loop in one sound. Deliberately distinct from `playVictory`
 * (C-E-G-C, which `markersCleared` owns — a find must not sound like a fight
 * ending): two wide rising intervals, D-A-D, faster and brighter, with a
 * soft sine root underneath for warmth.
 */
export function playFanfare(ctx: AudioContext, out: AudioNode): void {
  const notes: [number, number, number][] = [
    [587, 0, 0.3],
    [880, 0.09, 0.3],
    [1175, 0.18, 0.6],
  ];
  for (const [freq, at, dur] of notes) {
    const g = envGain(ctx, out, { attack: 0.005, duration: dur, peak: 0.18 }, at);
    osc(ctx, "triangle", freq, g, dur, at);
  }
  const root = envGain(ctx, out, { attack: 0.01, duration: 0.55, peak: 0.1 });
  osc(ctx, "sine", 294, root, 0.55);
}

/**
 * The douse hiss: water meets a burning hut and the fire dies as steam.
 * Filtered noise sweeping down — the sound of pressure leaving — sized to
 * read over the water-cast splash that immediately precedes it.
 */
export function playDouse(ctx: AudioContext, buf: AudioBuffer, out: AudioNode): VoiceEnd {
  const t = ctx.currentTime;
  const g = envGain(ctx, out, { attack: 0.015, duration: 0.85, peak: 0.2 });
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(2400, t);
  lp.frequency.exponentialRampToValueAtTime(300, t + 0.8);
  lp.connect(g);
  return noise(ctx, buf, lp, 0.85);
}

/** A status landing: a short, dry tick. Pitched per status by the caller. */
export function playStatus(ctx: AudioContext, out: AudioNode, freq: number): VoiceEnd {
  const g = envGain(ctx, out, { attack: 0.002, duration: 0.12, peak: 0.1 });
  return osc(ctx, "triangle", freq, g, 0.12);
}

/** An ally joins the party. Warm, two rising notes. */
export function playJoin(ctx: AudioContext, out: AudioNode): void {
  for (const [freq, at] of [
    [523, 0],
    [784, 0.11],
  ] as [number, number][]) {
    const g = envGain(ctx, out, { attack: 0.006, duration: 0.5, peak: 0.18 }, at);
    osc(ctx, "triangle", freq, g, 0.5, at);
  }
}

/** Victory: colour coming back into the world. */
export function playVictory(ctx: AudioContext, out: AudioNode): void {
  const notes: [number, number, number][] = [
    [523, 0, 0.26],
    [659, 0.09, 0.26],
    [784, 0.18, 0.26],
    [1046, 0.3, 0.7],
  ];
  for (const [freq, at, dur] of notes) {
    const g = envGain(ctx, out, { attack: 0.005, duration: dur, peak: 0.2 }, at);
    osc(ctx, "triangle", freq, g, dur, at);
  }
}

/** Defeat: two detuned saws sagging downward. */
export function playDefeat(ctx: AudioContext, out: AudioNode): void {
  const t = ctx.currentTime;
  const g = envGain(ctx, out, { attack: 0.02, duration: 0.9, peak: 0.18 });
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(700, t);
  lp.connect(g);
  for (const detune of [-7, 7]) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(311, t);
    o.frequency.setValueAtTime(233, t + 0.35);
    o.detune.setValueAtTime(detune, t);
    o.connect(lp);
    o.start();
    o.stop(t + 0.9);
  }
}

/** A footfall. Very quiet — it plays constantly while walking. */
export function playFootfall(ctx: AudioContext, buf: AudioBuffer, out: AudioNode): VoiceEnd {
  const g = envGain(ctx, out, { attack: 0.002, duration: 0.09, peak: 0.045 });
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(520, ctx.currentTime);
  lp.connect(g);
  return noise(ctx, buf, lp, 0.09);
}

/** UI press. */
export function playUiTap(ctx: AudioContext, out: AudioNode): VoiceEnd {
  const g = envGain(ctx, out, { attack: 0.002, duration: 0.06, peak: 0.1 });
  return osc(ctx, "sine", 880, g, 0.06);
}
