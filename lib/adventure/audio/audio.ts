import type { TickEvents } from "./events";

/**
 * All sound is synthesized — zero audio bytes shipped. The AudioContext
 * is created lazily inside the first user gesture (iOS requirement) and
 * closed in dispose() (browsers cap live contexts; leaking one per visit
 * hurts). Music is a small ahead-of-time scheduler on the AudioContext
 * clock — WebAudio timing is sample-accurate and setTimeout is not.
 */

const KEYS = {
  muted: "hugoslekstuga:adventure:muted",
  music: "hugoslekstuga:adventure:music",
  sfx: "hugoslekstuga:adventure:sfx",
};

export type MoodId = number | "title" | "boss";

export type AudioFacade = {
  unlock(): void;
  dispose(): void;
  sfx(name: string): void;
  playEvents(ev: TickEvents): void;
  setMood(mood: MoodId): void;
  toggleMute(): void;
  stepMusic(): void;
  stepSfx(): void;
  musicLevel(): number;
  sfxLevel(): number;
};

const LEVELS = [0, 0.33, 0.66, 1];

/** Per-world music moods: pentatonic roots + tempo + brightness. */
const MOODS: Record<string, { root: number; minor: boolean; bpm: number; bright: number }> = {
  title: { root: 45, minor: false, bpm: 70, bright: 0.4 },
  boss: { root: 41, minor: true, bpm: 132, bright: 0.9 },
  w1: { root: 45, minor: false, bpm: 92, bright: 0.5 },
  w2: { root: 43, minor: true, bpm: 88, bright: 0.4 },
  w3: { root: 48, minor: false, bpm: 100, bright: 0.6 },
  w4: { root: 41, minor: true, bpm: 84, bright: 0.35 },
  w5: { root: 50, minor: true, bpm: 96, bright: 0.55 },
  w6: { root: 40, minor: true, bpm: 108, bright: 0.7 },
  w7: { root: 47, minor: false, bpm: 90, bright: 0.5 },
  w8: { root: 38, minor: true, bpm: 76, bright: 0.25 },
  w9: { root: 44, minor: true, bpm: 116, bright: 0.8 },
  w10: { root: 45, minor: true, bpm: 124, bright: 0.9 },
};

export function createAudio(): AudioFacade {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let sfxBus: GainNode | null = null;
  let musicBus: GainNode | null = null;
  let voices = 0;
  let muted = false;
  let musicLv = 2;
  let sfxLv = 2;
  let mood = MOODS.title;
  let nextBarAt = 0;
  let barCount = 0;
  let schedulerId = 0;

  try {
    muted = localStorage.getItem(KEYS.muted) === "1";
    const m = Number(localStorage.getItem(KEYS.music));
    const s = Number(localStorage.getItem(KEYS.sfx));
    if (Number.isFinite(m) && m >= 0 && m <= 3) musicLv = m;
    if (Number.isFinite(s) && s >= 0 && s <= 3) sfxLv = s;
  } catch {
    /* private mode */
  }

  const persist = () => {
    try {
      localStorage.setItem(KEYS.muted, muted ? "1" : "0");
      localStorage.setItem(KEYS.music, String(musicLv));
      localStorage.setItem(KEYS.sfx, String(sfxLv));
    } catch {
      /* fine */
    }
  };

  const applyLevels = () => {
    if (!master || !sfxBus || !musicBus || !ctx) return;
    master.gain.setTargetAtTime(muted ? 0 : 0.7, ctx.currentTime, 0.02);
    sfxBus.gain.setTargetAtTime(LEVELS[sfxLv] * 0.8, ctx.currentTime, 0.02);
    musicBus.gain.setTargetAtTime(LEVELS[musicLv] * 0.32, ctx.currentTime, 0.05);
  };

  const unlock = () => {
    if (!ctx) {
      try {
        ctx = new AudioContext();
      } catch {
        return;
      }
      master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.connect(master);
      musicBus = ctx.createGain();
      musicBus.connect(master);
      applyLevels();
      nextBarAt = ctx.currentTime + 0.1;
      schedulerId = window.setInterval(scheduleMusic, 200);
    }
    if (ctx.state === "suspended") void ctx.resume();
  };

  const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

  const tone = (
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    bus: GainNode | null,
    when = 0,
    glideTo = 0,
  ) => {
    if (!ctx || !bus || voices > 14) return;
    voices++;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo > 0) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    osc.onended = () => {
      voices--;
      osc.disconnect();
      g.disconnect();
    };
  };

  const noise = (dur: number, vol: number, freq: number, when = 0) => {
    if (!ctx || !sfxBus || voices > 14) return;
    voices++;
    const t = ctx.currentTime + when;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(freq, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.3), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(sfxBus);
    src.start(t);
    src.onended = () => {
      voices--;
      src.disconnect();
    };
  };

  const SFX: Record<string, () => void> = {
    swing: () => noise(0.09, 0.25, 2400),
    hit: () => tone(220, 0.08, "square", 0.25, sfxBus, 0, 110),
    kill: () => {
      tone(180, 0.1, "square", 0.28, sfxBus, 0, 60);
      noise(0.08, 0.2, 900);
    },
    hurt: () => {
      tone(160, 0.18, "sawtooth", 0.32, sfxBus, 0, 70);
      noise(0.12, 0.25, 500);
    },
    coin: () => {
      tone(1245, 0.06, "sine", 0.2, sfxBus);
      tone(1661, 0.1, "sine", 0.2, sfxBus, 0.055);
    },
    ui: () => tone(880, 0.045, "square", 0.12, sfxBus),
    buy: () => {
      tone(660, 0.07, "square", 0.18, sfxBus);
      tone(880, 0.07, "square", 0.18, sfxBus, 0.07);
      tone(1320, 0.12, "square", 0.18, sfxBus, 0.14);
    },
    deny: () => tone(140, 0.16, "square", 0.2, sfxBus, 0, 90),
    clear: () => {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, "triangle", 0.22, sfxBus, i * 0.1));
    },
    death: () => {
      tone(330, 0.5, "sawtooth", 0.25, sfxBus, 0, 55);
      noise(0.4, 0.2, 300);
    },
    bossdown: () => {
      noise(0.5, 0.4, 240);
      [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, "triangle", 0.24, sfxBus, 0.2 + i * 0.09));
    },
    door: () => noise(0.3, 0.22, 220),
    parry: () => {
      tone(1760, 0.05, "square", 0.22, sfxBus);
      tone(2637, 0.12, "sine", 0.2, sfxBus, 0.04);
    },
    boom: () => noise(0.35, 0.4, 320),
    phase: () => {
      tone(110, 0.3, "sawtooth", 0.28, sfxBus, 0, 220);
      noise(0.25, 0.25, 700);
    },
  };

  // ---- music ----------------------------------------------------------
  const scale = (i: number) => {
    const penta = mood.minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
    return mood.root + penta[((i % penta.length) + penta.length) % penta.length] + Math.floor(i / penta.length) * 12;
  };

  const scheduleMusic = () => {
    if (!ctx || !musicBus || musicLv === 0 || muted) return;
    const barDur = (60 / mood.bpm) * 4;
    // Keep two bars scheduled ahead.
    while (nextBarAt < ctx.currentTime + barDur * 2) {
      const t0 = Math.max(nextBarAt, ctx.currentTime + 0.05);
      const when = t0 - ctx.currentTime;
      const step = barDur / 8;
      const seedBase = barCount * 7;
      for (let i = 0; i < 8; i++) {
        const seed = ((seedBase + i) * 2654435761) >>> 0;
        const roll = (seed % 100) / 100;
        // Bass on the pulse.
        if (i % 2 === 0) {
          tone(midi(scale(((seed >> 4) % 3) - 1) - 12), step * 0.9, "triangle", 0.5, musicBus, when + i * step);
        }
        // Sparse lead, brighter moods sing more.
        if (roll < mood.bright * 0.45) {
          tone(midi(scale((seed >> 6) % 7)), step * 1.6, "square", 0.14, musicBus, when + i * step);
        }
      }
      nextBarAt = t0 + barDur;
      barCount++;
    }
  };

  return {
    unlock,
    dispose() {
      clearInterval(schedulerId);
      if (ctx) void ctx.close();
      ctx = null;
    },
    sfx(name) {
      if (!ctx || muted) return;
      SFX[name]?.();
    },
    playEvents(ev) {
      if (!ctx || muted) return;
      if (ev.swing) SFX.swing();
      if (ev.playerHurt) SFX.hurt();
      if (ev.kills > 0) SFX.kill();
      if (ev.coins > 0) SFX.coin();
      if (ev.bossHit) SFX.hit();
      if (ev.parry) SFX.parry();
      if (ev.doorOpen) SFX.door();
      if (ev.bossPhase) SFX.phase();
      if (ev.explosion) SFX.boom();
    },
    setMood(m) {
      mood = typeof m === "number" ? MOODS[`w${m}`] ?? MOODS.w1 : MOODS[m];
      barCount = 0;
    },
    toggleMute() {
      muted = !muted;
      persist();
      applyLevels();
    },
    stepMusic() {
      musicLv = (musicLv + 1) % 4;
      persist();
      applyLevels();
    },
    stepSfx() {
      sfxLv = (sfxLv + 1) % 4;
      persist();
      applyLevels();
    },
    musicLevel: () => musicLv,
    sfxLevel: () => sfxLv,
  };
}
