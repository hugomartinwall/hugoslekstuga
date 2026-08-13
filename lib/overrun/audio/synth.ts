/**
 * WebAudio voice synthesis — every sound is generated, nothing sampled.
 * A voice is 1–2 oscillators (or the shared noise buffer) → optional biquad →
 * per-voice gain → the master bus. All envelopes end with an exponential ramp
 * to near-zero and an explicit stop, so nodes disconnect and GC themselves.
 */

export type Priority = 0 | 1 | 2; // low | mid | high

/** The primary source node of a voice — its `onended` marks the voice free. */
export type VoiceEnd = AudioScheduledSourceNode;

/** Build a 0.5 s white-noise buffer once per context (generated, not sampled). */
export function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

interface Env {
  attack: number; // seconds
  duration: number; // seconds until silence
  peak: number;
  at?: number; // absolute start time; defaults to now, for multi-note figures
}

function envGain(ctx: AudioContext, out: AudioNode, e: Env): GainNode {
  const g = ctx.createGain();
  const t = e.at ?? ctx.currentTime;
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
): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, ctx.currentTime);
  o.connect(out);
  o.start();
  o.stop(ctx.currentTime + stopAt);
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

/* ------------------------------------------------------------- recipes */

export function playSendWhoosh(
  ctx: AudioContext,
  buf: AudioBuffer,
  out: AudioNode,
  enemy: boolean,
): VoiceEnd {
  const t = ctx.currentTime;
  const g = envGain(ctx, out, { attack: 0.015, duration: 0.25, peak: enemy ? 0.07 : 0.22 });
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.Q.setValueAtTime(1.2, t);
  f.frequency.setValueAtTime(enemy ? 900 : 400, t);
  f.frequency.exponentialRampToValueAtTime(enemy ? 350 : 1800, t + 0.18);
  f.connect(g);
  return noise(ctx, buf, f, 0.25);
}

export function playCapturePing(ctx: AudioContext, out: AudioNode): VoiceEnd {
  const t = ctx.currentTime;
  const g = envGain(ctx, out, { attack: 0.005, duration: 0.45, peak: 0.28 });
  const tri = ctx.createOscillator();
  tri.type = "triangle";
  tri.frequency.setValueAtTime(660, t);
  tri.frequency.linearRampToValueAtTime(880, t + 0.04);
  tri.connect(g);
  tri.start();
  tri.stop(t + 0.45);
  const shimmer = ctx.createGain();
  shimmer.gain.setValueAtTime(0.4, t);
  shimmer.connect(g);
  osc(ctx, "sine", 1320, shimmer, 0.45);
  return tri;
}

export function playNodeLostThud(ctx: AudioContext, buf: AudioBuffer, out: AudioNode): VoiceEnd {
  const t = ctx.currentTime;
  const g = envGain(ctx, out, { attack: 0.008, duration: 0.3, peak: 0.32 });
  const s = ctx.createOscillator();
  s.type = "sine";
  s.frequency.setValueAtTime(200, t);
  s.frequency.exponentialRampToValueAtTime(70, t + 0.16);
  s.connect(g);
  s.start();
  s.stop(t + 0.3);
  const ng = envGain(ctx, out, { attack: 0.005, duration: 0.08, peak: 0.15 });
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(350, t);
  lp.connect(ng);
  noise(ctx, buf, lp, 0.08);
  return s;
}

export function playEnemyCaptureTick(ctx: AudioContext, out: AudioNode): VoiceEnd {
  const g = envGain(ctx, out, { attack: 0.003, duration: 0.08, peak: 0.06 });
  return osc(ctx, "triangle", 240, g, 0.08);
}

export function playArrival(
  ctx: AudioContext,
  out: AudioNode,
  hostile: boolean,
  batchScale: number,
): VoiceEnd {
  const jitter = 1 + (Math.random() - 0.5) * 0.16;
  if (hostile) {
    const g = envGain(ctx, out, { attack: 0.002, duration: 0.07, peak: 0.07 * batchScale });
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(900, ctx.currentTime);
    lp.connect(g);
    return osc(ctx, "square", 260 * jitter, lp, 0.07);
  }
  const g = envGain(ctx, out, { attack: 0.002, duration: 0.06, peak: 0.06 * batchScale });
  return osc(ctx, "triangle", 1100 * jitter, g, 0.06);
}

/**
 * A turret killing a packet: a short bright zap. Deliberately thin and high so
 * it cuts through without competing with the player's own combat sounds — a
 * turret firing is information, not an event.
 */
/**
 * Volatile detonation: a short filtered noise thump with a falling body.
 *
 * Deliberately the lowest, widest sound in the SFX set — it is the only event
 * that damages nodes the player was not attacking, so it has to read as "that
 * hurt" without a visual.
 */
export function playVolatileBlast(
  ctx: AudioContext,
  out: AudioNode,
  batchScale: number,
): VoiceEnd {
  const t = ctx.currentTime;
  const g = envGain(ctx, out, { attack: 0.002, duration: 0.34, peak: 0.13 * batchScale });

  // Noise burst through a falling lowpass — the "crump".
  const frames = Math.ceil(ctx.sampleRate * 0.34);
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(1800, t);
  lp.frequency.exponentialRampToValueAtTime(180, t + 0.3);
  noise.connect(lp);
  lp.connect(g);
  noise.start();
  noise.stop(t + 0.34);

  // Sine drop underneath for weight.
  const s = ctx.createOscillator();
  s.type = "sine";
  s.frequency.setValueAtTime(160, t);
  s.frequency.exponentialRampToValueAtTime(42, t + 0.28);
  s.connect(g);
  s.start();
  s.stop(t + 0.34);
  return s;
}

/**
 * Siphon drain: a soft upward glide — something being pulled away from you.
 * Quiet by design; it fires every 1.5 s while a siphon is in contact and must
 * never become nagging over a 17-minute session.
 */
export function playSiphonDrain(ctx: AudioContext, out: AudioNode, batchScale: number): VoiceEnd {
  const t = ctx.currentTime;
  const g = envGain(ctx, out, { attack: 0.02, duration: 0.22, peak: 0.028 * batchScale });
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(900, t);
  bp.Q.setValueAtTime(4, t);
  bp.connect(g);
  const s = ctx.createOscillator();
  s.type = "triangle";
  s.frequency.setValueAtTime(320, t);
  s.frequency.exponentialRampToValueAtTime(760, t + 0.2);
  s.connect(bp);
  s.start();
  s.stop(t + 0.22);
  return s;
}

/**
 * A corrupter taking a passing unit. Deliberately the siphon's sweep played
 * backwards — falling, not rising — because the two mechanics are cousins and
 * the ear should hear which one is happening without looking. Slightly louder
 * than a drain: this one costs the player a unit AND gives one away.
 */
export function playCorrupterSteal(
  ctx: AudioContext,
  out: AudioNode,
  batchScale: number,
): VoiceEnd {
  const t = ctx.currentTime;
  const g = envGain(ctx, out, { attack: 0.008, duration: 0.26, peak: 0.036 * batchScale });
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(1100, t);
  bp.Q.setValueAtTime(3.2, t);
  bp.connect(g);
  const s = ctx.createOscillator();
  s.type = "triangle";
  s.frequency.setValueAtTime(820, t);
  s.frequency.exponentialRampToValueAtTime(240, t + 0.24);
  s.connect(bp);
  s.start();
  s.stop(t + 0.26);
  return s;
}

export function playTurretZap(ctx: AudioContext, out: AudioNode, batchScale: number): VoiceEnd {
  const t = ctx.currentTime;
  const g = envGain(ctx, out, { attack: 0.001, duration: 0.09, peak: 0.05 * batchScale });
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.setValueAtTime(1400, t);
  hp.connect(g);
  const s = ctx.createOscillator();
  s.type = "sawtooth";
  s.frequency.setValueAtTime(1800 * (1 + (Math.random() - 0.5) * 0.2), t);
  s.frequency.exponentialRampToValueAtTime(620, t + 0.07);
  s.connect(hp);
  s.start();
  s.stop(t + 0.09);
  return s;
}

/**
 * Fighting somewhere else on the board — AI against AI, or against neutrals.
 * The whole point is that it should barely register: a low, soft thump that
 * says the war is bigger than you without ever pulling focus. Without it a
 * four-faction board sounds empty everywhere the player is not looking.
 */
export function playDistantWar(ctx: AudioContext, buf: AudioBuffer, out: AudioNode): VoiceEnd {
  const t = ctx.currentTime;
  const g = envGain(ctx, out, { attack: 0.02, duration: 0.22, peak: 0.035 });
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(260, t);
  lp.connect(g);
  noise(ctx, buf, lp, 0.22);
  const s = ctx.createOscillator();
  s.type = "sine";
  s.frequency.setValueAtTime(110 * (1 + (Math.random() - 0.5) * 0.3), t);
  s.connect(envGain(ctx, out, { attack: 0.015, duration: 0.2, peak: 0.03 }));
  s.start();
  s.stop(t + 0.2);
  return s;
}

/** A faction knocked out. Descending, final, and clearly not about you. */
export function playRivalEliminated(ctx: AudioContext, out: AudioNode): void {
  const t = ctx.currentTime;
  [440, 330, 220].forEach((f, i) => {
    const g = envGain(ctx, out, { attack: 0.01, duration: 0.34, peak: 0.11, at: t + i * 0.11 });
    const s = ctx.createOscillator();
    s.type = "triangle";
    s.frequency.setValueAtTime(f, t + i * 0.11);
    s.connect(g);
    s.start(t + i * 0.11);
    s.stop(t + i * 0.11 + 0.34);
  });
}

/** Buying an upgrade: a bright two-note confirmation, up not down. */
export function playPurchase(ctx: AudioContext, out: AudioNode): void {
  const t = ctx.currentTime;
  [660, 990].forEach((f, i) => {
    const g = envGain(ctx, out, { attack: 0.004, duration: 0.2, peak: 0.14, at: t + i * 0.07 });
    const s = ctx.createOscillator();
    s.type = "triangle";
    s.frequency.setValueAtTime(f, t + i * 0.07);
    s.connect(g);
    s.start(t + i * 0.07);
    s.stop(t + i * 0.07 + 0.2);
  });
}

/** A node finishing its size upgrade — the payoff, so it rings a little. */
export function playUpgradeComplete(ctx: AudioContext, out: AudioNode): VoiceEnd {
  const t = ctx.currentTime;
  const g = envGain(ctx, out, { attack: 0.006, duration: 0.45, peak: 0.16 });
  const s = ctx.createOscillator();
  s.type = "triangle";
  s.frequency.setValueAtTime(520, t);
  s.frequency.exponentialRampToValueAtTime(1040, t + 0.18);
  s.connect(g);
  s.start();
  s.stop(t + 0.45);
  return s;
}

export function playVictory(ctx: AudioContext, out: AudioNode): void {
  const notes: Array<[number, number, number, number]> = [
    // [freq, startOffset, duration, peak]
    [523, 0, 0.25, 0.22],
    [659, 0.09, 0.25, 0.22],
    [784, 0.18, 0.25, 0.22],
    [1046, 0.3, 0.7, 0.25],
  ];
  for (const [freq, at, dur, peak] of notes) {
    const t = ctx.currentTime + at;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    g.connect(out);
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(freq, t);
    o.connect(g);
    o.start(t);
    o.stop(t + dur);
  }
}

export function playDefeat(ctx: AudioContext, out: AudioNode): void {
  const t = ctx.currentTime;
  const g = envGain(ctx, out, { attack: 0.02, duration: 0.9, peak: 0.2 });
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(700, t);
  lp.connect(g);
  for (const detune of [-6, 6]) {
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

export function playUiTap(ctx: AudioContext, out: AudioNode): VoiceEnd {
  const g = envGain(ctx, out, { attack: 0.002, duration: 0.06, peak: 0.12 });
  return osc(ctx, "sine", 880, g, 0.06);
}
