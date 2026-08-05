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
}

function envGain(ctx: AudioContext, out: AudioNode, e: Env): GainNode {
  const g = ctx.createGain();
  const t = ctx.currentTime;
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
