type Voice = {
  source: AudioScheduledSourceNode;
  nodes: AudioNode[];
};
type Tone = {
  frequency: number;
  end?: number;
  duration: number;
  gain: number;
  type?: OscillatorType;
  delay?: number;
  attack?: number;
  music?: boolean;
};
type Noise = {
  duration: number;
  gain: number;
  frequency: number;
  end?: number;
  filter?: BiquadFilterType;
  q?: number;
  delay?: number;
  attack?: number;
  music?: boolean;
};

/** Original, locally synthesized sound. No audio files, network calls or streaming. */
export class AudioEngine {
  muted = false;
  musicEnabled = true;
  platformMuted = false;
  paused = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private effects: GainNode | null = null;
  private music: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private voices = new Set<Voice>();
  private lastPlayed = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private combat = false;
  private nextBeat = 0;
  private beat = 0;
  private disposed = false;

  unlock(): void {
    if (this.disposed) return;
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext({ latencyHint: "interactive" });
        this.master = this.ctx.createGain();
        this.master.gain.value = 0;
        this.effects = this.ctx.createGain();
        this.effects.gain.value = 0.8;
        this.effects.connect(this.master);
        this.music = this.ctx.createGain();
        this.music.gain.value = 0;
        this.music.connect(this.master);
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -15;
        this.compressor.knee.value = 16;
        this.compressor.ratio.value = 6;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.12;
        this.master.connect(this.compressor);
        this.compressor.connect(this.ctx.destination);
        this.noiseBuffer = this.ctx.createBuffer(
          1,
          this.ctx.sampleRate,
          this.ctx.sampleRate,
        );
        const samples = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++)
          samples[i] = Math.random() * 2 - 1;
        this.nextBeat = this.ctx.currentTime + 0.05;
        this.timer = setInterval(() => this.scheduleMusic(), 45);
      }
      void this.ctx.resume().catch(() => {});
      this.sync();
    } catch {
      // Browsers without Web Audio can still play the entire game.
    }
  }

  sync(): void {
    if (!this.ctx || !this.master || !this.music) return;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(
      this.muted || this.platformMuted || this.paused ? 0 : 0.57,
      now,
      0.035,
    );
    this.music.gain.setTargetAtTime(
      this.musicEnabled ? (this.combat ? 0.34 : 0.2) : 0,
      now,
      0.18,
    );
  }

  setCombat(active: boolean): void {
    this.combat = active;
    this.sync();
  }

  play(name: string, intensity = 1): void {
    if (
      !this.ctx ||
      this.ctx.state !== "running" ||
      this.muted ||
      this.platformMuted ||
      this.paused
    )
      return;
    const aliases: Record<string, string> = {
      shot: "gun",
      shoot: "gun",
      blaster: "gun",
      scatter: "shotgun",
      electric: "arc",
      zap: "arc",
      explosion: "rocket",
      hit: "impact",
      hurt: "damage",
      enemydeath: "death",
      coin: "pickup",
      collect: "pickup",
      purchase: "buy",
      wavewin: "win",
      wave: "win",
      victory: "win",
      lose: "defeat",
      click: "select",
      hover: "tick",
      pistol: "gun",
      flame: "flame",
      flamethrower: "flame",
      frostgun: "frost",
      railgun: "rail",
      blade: "boomerang",
      orbit: "arc",
      boss: "boss-warning",
      boss_warning: "boss-warning",
      boss_charge: "boss-charge",
      boss_burst: "boss-burst",
      boss_phase: "boss-phase",
      pinball: "gun",
      thumper: "thump",
      mortar: "thump",
      flare: "flame",
      skyfall: "arc",
      tesla_orb: "arc",
      halo: "frost",
      gravity: "frost",
      shatter: "frost",
      spore_mine: "needle",
      hive: "needle",
      sentry: "gun",
    };
    name = aliases[name] ?? name;
    const now = this.ctx.currentTime;
    const limits: Record<string, number> = {
      gun: 0.045,
      shotgun: 0.07,
      arc: 0.08,
      rocket: 0.11,
      impact: 0.065,
      death: 0.085,
      pickup: 0.06,
      damage: 0.16,
      tick: 0.07,
      flame: 0.12,
      frost: 0.12,
      needle: 0.05,
      rail: 0.18,
      boomerang: 0.15,
      beam: 0.13,
      weave: 0.3,
      "boss-warning": 0.8,
      "boss-charge": 0.5,
      "boss-burst": 0.2,
      "boss-phase": 1,
      thump: 0.09,
      eclipse: 1.2,
      "eclipse-collapse": 1,
      horde: 1.5,
      bounce: 0.04,
      pop: 0.06,
      chime: 0.2,
    };
    if (now - (this.lastPlayed.get(name) ?? -100) < (limits[name] ?? 0.035))
      return;
    this.lastPlayed.set(name, now);
    const v = Math.max(
      0.15,
      Math.min(1.5, Number.isFinite(intensity) ? intensity : 1),
    );
    const jitter = 0.94 + Math.random() * 0.12;
    switch (name) {
      case "thump":
        // Piston and lobber: a sub-bass drop with a soft mechanical click on top.
        this.tone({
          frequency: 90 * jitter,
          end: 40,
          duration: 0.18,
          gain: 0.5 * v,
        });
        this.tone({
          frequency: 620 * jitter,
          end: 240,
          duration: 0.03,
          gain: 0.06 * v,
          type: "triangle",
        });
        this.noise({
          duration: 0.08,
          gain: 0.12 * v,
          frequency: 900,
          end: 260,
          filter: "lowpass",
        });
        break;
      case "eclipse":
        // Charge (on fire): a rising filtered-noise sweep over a sub drone.
        // The crack lives in "eclipse-collapse" so it lands on the real
        // collapse instead of a fixed delay.
        this.noise({
          duration: 1.5,
          gain: 0.22 * v,
          frequency: 180,
          end: 5200,
          filter: "bandpass",
          q: 2.2,
          attack: 0.25,
        });
        this.tone({
          frequency: 41,
          end: 55,
          duration: 1.55,
          gain: 0.34 * v,
          attack: 0.3,
        });
        this.tone({
          frequency: 82,
          end: 110,
          duration: 1.5,
          gain: 0.09 * v,
          type: "triangle",
          attack: 0.4,
        });
        break;
      case "eclipse-collapse":
        // Collapse: the crack and a shimmer as the ring folds in.
        this.noise({
          duration: 0.32,
          gain: 0.62 * v,
          frequency: 3800,
          end: 120,
          filter: "lowpass",
        });
        this.tone({
          frequency: 160,
          end: 30,
          duration: 0.5,
          gain: 0.6 * v,
        });
        [1760, 2217, 2637, 3520].forEach((frequency, index) =>
          this.tone({
            frequency,
            end: frequency * 1.01,
            duration: 0.9 - index * 0.12,
            gain: 0.045 * v,
            delay: 0.06 + index * 0.05,
            attack: 0.02,
          }),
        );
        break;
      case "bounce":
        // Ricochet: a short, quiet triangle blip dropping in pitch.
        this.tone({
          frequency: 1400 * jitter,
          end: 900,
          duration: 0.05,
          gain: 0.04 * v,
          type: "triangle",
        });
        break;
      case "pop":
        // Hive and shatter bursts: a filtered noise burst with a tone drop.
        this.noise({
          duration: 0.07,
          gain: 0.1 * v,
          frequency: 2600 * jitter,
          end: 700,
          filter: "bandpass",
          q: 1.4,
        });
        this.tone({
          frequency: 760 * jitter,
          end: 320,
          duration: 0.06,
          gain: 0.06 * v,
          type: "triangle",
        });
        break;
      case "chime":
        // Barrier charge: two sines a fifth apart, gentle attack.
        this.tone({
          frequency: 880,
          duration: 0.25,
          gain: 0.05 * v,
          attack: 0.01,
        });
        this.tone({
          frequency: 1320,
          duration: 0.25,
          gain: 0.035 * v,
          attack: 0.015,
          delay: 0.02,
        });
        break;
      case "horde":
        // Two-note warning sting: a swarm is on its way.
        [329.6, 466.2].forEach((frequency, index) => {
          this.tone({
            frequency,
            end: frequency * 0.985,
            duration: 0.26,
            gain: 0.2 * v,
            type: "square",
            delay: index * 0.17,
            attack: 0.01,
          });
          this.tone({
            frequency: frequency / 2,
            duration: 0.3,
            gain: 0.12 * v,
            type: "triangle",
            delay: index * 0.17,
            attack: 0.01,
          });
        });
        this.noise({
          duration: 0.12,
          gain: 0.08 * v,
          frequency: 2600,
          end: 900,
          filter: "highpass",
          delay: 0.17,
        });
        break;
      case "merge":
        this.noise({
          duration: 0.2,
          gain: 0.18 * v,
          frequency: 380,
          end: 1200,
        });
        [220, 330, 440, 660].forEach((frequency, index) =>
          this.tone({
            frequency,
            end: frequency * 1.02,
            duration: 0.38,
            gain: 0.13 * v,
            type: "triangle",
            delay: index * 0.07,
            attack: 0.015,
          }),
        );
        break;
      case "flame":
        this.noise({
          duration: 0.24,
          gain: 0.2 * v,
          frequency: 370,
          end: 1050,
          filter: "lowpass",
          attack: 0.018,
        });
        this.tone({
          frequency: 78 * jitter,
          end: 44,
          duration: 0.2,
          gain: 0.075 * v,
          type: "triangle",
        });
        break;
      case "frost":
        this.tone({
          frequency: 1510 * jitter,
          end: 740,
          duration: 0.2,
          gain: 0.065 * v,
        });
        this.tone({
          frequency: 2200,
          end: 1600,
          duration: 0.12,
          gain: 0.025 * v,
          delay: 0.035,
        });
        this.noise({
          duration: 0.1,
          gain: 0.09 * v,
          frequency: 3100,
          end: 1400,
          filter: "highpass",
        });
        break;
      case "needle":
        this.tone({
          frequency: 2050 * jitter,
          end: 620,
          duration: 0.055,
          gain: 0.052 * v,
          type: "triangle",
        });
        this.noise({ duration: 0.028, gain: 0.04 * v, frequency: 3600 });
        break;
      case "rail":
        this.tone({
          frequency: 400,
          end: 80,
          duration: 0.23,
          gain: 0.27 * v,
          type: "triangle",
        });
        this.noise({
          duration: 0.22,
          gain: 0.29 * v,
          frequency: 7200,
          end: 420,
          filter: "lowpass",
        });
        this.tone({
          frequency: 1568,
          end: 3136,
          duration: 0.085,
          gain: 0.048 * v,
        });
        break;
      case "boomerang":
        this.noise({
          duration: 0.22,
          gain: 0.12 * v,
          frequency: 2200,
          end: 700,
          q: 1,
          attack: 0.025,
        });
        this.tone({
          frequency: 420,
          end: 210,
          duration: 0.25,
          gain: 0.072 * v,
          type: "triangle",
        });
        break;
      case "beam":
        this.tone({
          frequency: 440 * jitter,
          end: 660,
          duration: 0.19,
          gain: 0.045 * v,
          type: "sawtooth",
          attack: 0.018,
        });
        this.tone({
          frequency: 880,
          end: 1320,
          duration: 0.15,
          gain: 0.032 * v,
        });
        this.noise({
          duration: 0.15,
          gain: 0.07 * v,
          frequency: 1100,
          end: 2400,
          q: 1.3,
        });
        break;
      case "weave":
        [392, 587.33, 783.99].forEach((frequency, i) =>
          this.tone({
            frequency,
            end: frequency * 1.125,
            duration: 0.3,
            gain: 0.1 * v,
            delay: i * 0.035,
          }),
        );
        this.noise({
          duration: 0.3,
          gain: 0.16 * v,
          frequency: 650,
          end: 4300,
          attack: 0.035,
        });
        break;
      case "boss-warning":
        [110, 110, 82.41].forEach((frequency, i) =>
          this.tone({
            frequency,
            duration: 0.45,
            gain: 0.17 * v,
            type: "triangle",
            delay: i * 0.19,
          }),
        );
        this.tone({
          frequency: 55,
          duration: 0.95,
          gain: 0.17 * v,
          attack: 0.06,
        });
        break;
      case "boss-charge":
        this.noise({
          duration: 0.48,
          gain: 0.23 * v,
          frequency: 260,
          end: 2300,
          filter: "lowpass",
          attack: 0.14,
        });
        this.tone({
          frequency: 60,
          end: 160,
          duration: 0.44,
          gain: 0.15 * v,
          type: "triangle",
          attack: 0.08,
        });
        break;
      case "boss-burst":
        this.tone({ frequency: 128, end: 41, duration: 0.28, gain: 0.29 * v });
        this.noise({
          duration: 0.18,
          gain: 0.17 * v,
          frequency: 1600,
          end: 330,
          filter: "lowpass",
        });
        break;
      case "boss-phase":
        [196, 130.81, 97.999].forEach((frequency, i) =>
          this.tone({
            frequency,
            duration: 0.7,
            gain: 0.17 * v,
            type: "triangle",
            delay: i * 0.09,
          }),
        );
        this.noise({
          duration: 0.54,
          gain: 0.2 * v,
          frequency: 450,
          end: 3200,
          attack: 0.13,
        });
        break;
      case "gun":
        this.tone({
          frequency: 205 * jitter,
          end: 67,
          duration: 0.12,
          gain: 0.3 * v,
          type: "triangle",
        });
        this.noise({
          duration: 0.095,
          gain: 0.22 * v,
          frequency: 3100,
          end: 950,
          filter: "lowpass",
        });
        this.tone({
          frequency: 1300 * jitter,
          end: 410,
          duration: 0.042,
          gain: 0.035 * v,
          type: "square",
        });
        break;
      case "shotgun":
        this.tone({
          frequency: 142 * jitter,
          end: 36,
          duration: 0.27,
          gain: 0.62 * v,
        });
        this.noise({
          duration: 0.24,
          gain: 0.56 * v,
          frequency: 2600,
          end: 180,
          filter: "lowpass",
        });
        this.noise({
          duration: 0.045,
          gain: 0.27 * v,
          frequency: 4200,
          filter: "highpass",
        });
        this.tone({
          frequency: 310,
          end: 70,
          duration: 0.12,
          gain: 0.13 * v,
          type: "triangle",
          delay: 0.025,
        });
        break;
      case "arc":
        this.tone({
          frequency: 390 * jitter,
          end: 1770,
          duration: 0.065,
          gain: 0.1 * v,
          type: "sawtooth",
        });
        this.tone({
          frequency: 1210 * jitter,
          end: 310,
          duration: 0.12,
          gain: 0.12 * v,
          type: "triangle",
          delay: 0.035,
        });
        this.noise({
          duration: 0.15,
          gain: 0.17 * v,
          frequency: 1700,
          end: 900,
          q: 1.5,
        });
        break;
      case "rocket":
        this.tone({ frequency: 100, end: 28, duration: 0.65, gain: 0.74 * v });
        this.noise({
          duration: 0.58,
          gain: 0.72 * v,
          frequency: 1900,
          end: 75,
          filter: "lowpass",
        });
        this.noise({ duration: 0.12, gain: 0.3 * v, frequency: 2400, q: 0.7 });
        this.tone({
          frequency: 52,
          end: 33,
          duration: 0.46,
          gain: 0.16 * v,
          type: "triangle",
          delay: 0.07,
        });
        break;
      case "impact":
        this.noise({
          duration: 0.065,
          gain: 0.12 * v,
          frequency: 1800 * jitter,
          end: 420,
        });
        this.tone({
          frequency: 125 * jitter,
          end: 65,
          duration: 0.07,
          gain: 0.08 * v,
          type: "triangle",
        });
        break;
      case "damage":
        this.tone({
          frequency: 150,
          end: 53,
          duration: 0.22,
          gain: 0.27 * v,
          type: "triangle",
        });
        this.noise({
          duration: 0.13,
          gain: 0.23 * v,
          frequency: 1100,
          end: 160,
          filter: "lowpass",
        });
        this.tone({
          frequency: 680,
          end: 340,
          duration: 0.16,
          gain: 0.065 * v,
          delay: 0.02,
        });
        break;
      case "dash":
        this.noise({
          duration: 0.23,
          gain: 0.34 * v,
          frequency: 420,
          end: 5800,
          q: 0.8,
          attack: 0.055,
        });
        this.tone({
          frequency: 95,
          end: 420,
          duration: 0.16,
          gain: 0.13 * v,
          type: "triangle",
          attack: 0.025,
        });
        break;
      case "death":
        this.tone({
          frequency: 310 * jitter,
          end: 55,
          duration: 0.13,
          gain: 0.08 * v,
          type: "triangle",
        });
        this.noise({
          duration: 0.095,
          gain: 0.09 * v,
          frequency: 1300,
          end: 200,
          filter: "lowpass",
        });
        break;
      case "pickup":
        this.tone({
          frequency: 1046.5 * (1 + (Math.floor(now * 3) % 3) * 0.125),
          duration: 0.12,
          gain: 0.065 * v,
        });
        this.tone({
          frequency: 1568,
          duration: 0.08,
          gain: 0.025 * v,
          delay: 0.02,
        });
        break;
      case "buy":
        [440, 659.25, 880].forEach((frequency, i) =>
          this.tone({
            frequency,
            duration: 0.21,
            gain: 0.13 * v,
            delay: i * 0.055,
          }),
        );
        this.noise({ duration: 0.06, gain: 0.07 * v, frequency: 2200 });
        break;
      case "reroll":
        [740, 622, 494].forEach((frequency, i) =>
          this.tone({
            frequency,
            end: frequency * 0.9,
            duration: 0.095,
            gain: 0.07 * v,
            type: "triangle",
            delay: i * 0.045,
          }),
        );
        break;
      case "select":
        this.tone({
          frequency: 659.25,
          end: 783.99,
          duration: 0.09,
          gain: 0.09 * v,
        });
        this.noise({ duration: 0.022, gain: 0.05 * v, frequency: 3400 });
        break;
      case "tick":
        this.tone({ frequency: 830, duration: 0.035, gain: 0.025 * v });
        break;
      case "start":
        [110, 164.81, 220].forEach((frequency, i) =>
          this.tone({
            frequency,
            end: frequency * 1.015,
            duration: 0.46,
            gain: 0.19 * v,
            type: "triangle",
            delay: i * 0.11,
          }),
        );
        this.noise({
          duration: 0.32,
          gain: 0.18 * v,
          frequency: 400,
          end: 3200,
          attack: 0.12,
        });
        break;
      case "win":
        [329.63, 440, 659.25, 880].forEach((frequency, i) =>
          this.tone({
            frequency,
            duration: 0.8,
            gain: 0.16 * v,
            delay: i * 0.105,
            attack: 0.018,
          }),
        );
        this.tone({
          frequency: 110,
          duration: 1.1,
          gain: 0.25 * v,
          type: "triangle",
        });
        break;
      case "defeat":
        [220, 164.81, 110, 82.41].forEach((frequency, i) =>
          this.tone({
            frequency,
            end: frequency * 0.96,
            duration: 0.7,
            gain: 0.19 * v,
            type: "triangle",
            delay: i * 0.16,
          }),
        );
        this.noise({
          duration: 0.7,
          gain: 0.2 * v,
          frequency: 1000,
          end: 60,
          filter: "lowpass",
        });
        break;
    }
  }

  private tone(options: Tone): void {
    if (!this.ctx || !this.effects || !this.music || this.voices.size >= 64)
      return;
    const t = this.ctx.currentTime + (options.delay ?? 0);
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    oscillator.type = options.type ?? "sine";
    oscillator.frequency.setValueAtTime(options.frequency, t);
    if (options.end)
      oscillator.frequency.exponentialRampToValueAtTime(
        options.end,
        t + options.duration,
      );
    this.envelope(
      gain,
      t,
      options.duration,
      options.gain,
      options.attack ?? 0.003,
    );
    oscillator.connect(gain);
    gain.connect(options.music ? this.music : this.effects);
    this.track(oscillator, [oscillator, gain]);
    oscillator.start(t);
    oscillator.stop(t + options.duration + 0.015);
  }

  private noise(options: Noise): void {
    if (
      !this.ctx ||
      !this.effects ||
      !this.music ||
      !this.noiseBuffer ||
      this.voices.size >= 64
    )
      return;
    const t = this.ctx.currentTime + (options.delay ?? 0);
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = options.filter ?? "bandpass";
    filter.frequency.setValueAtTime(options.frequency, t);
    filter.Q.value = options.q ?? 0.6;
    if (options.end)
      filter.frequency.exponentialRampToValueAtTime(
        options.end,
        t + options.duration,
      );
    const gain = this.ctx.createGain();
    this.envelope(
      gain,
      t,
      options.duration,
      options.gain,
      options.attack ?? 0.002,
    );
    source.connect(filter);
    filter.connect(gain);
    gain.connect(options.music ? this.music : this.effects);
    this.track(source, [source, filter, gain]);
    source.start(t, Math.random() * 0.4);
    source.stop(t + options.duration + 0.015);
  }

  private envelope(
    gain: GainNode,
    time: number,
    duration: number,
    volume: number,
    attack: number,
  ): void {
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  }

  private track(source: AudioScheduledSourceNode, nodes: AudioNode[]): void {
    const voice = { source, nodes };
    this.voices.add(voice);
    source.onended = () => {
      nodes.forEach((node) => node.disconnect());
      source.onended = null;
      this.voices.delete(voice);
    };
  }

  private scheduleMusic(): void {
    if (!this.ctx || this.ctx.state !== "running") return;
    const now = this.ctx.currentTime;
    if (!this.musicEnabled || this.muted || this.platformMuted || this.paused) {
      this.nextBeat = now + 0.08;
      return;
    }
    if (this.nextBeat < now - 0.2) this.nextBeat = now + 0.025;
    const stepDuration = 60 / 112 / 4;
    while (this.nextBeat < now + 0.13) {
      const step = this.beat++ % 64;
      const delay = Math.max(0, this.nextBeat - now);
      const root = [55, 55, 65.406, 48.999][Math.floor(step / 16)];
      // A sparse four-bar ostinato leaves room for weapon transients and pickups.
      if (step % 4 === 0 || (this.combat && step % 16 === 11)) {
        this.tone({
          frequency: root * (step % 16 === 8 ? 2 : 1),
          duration: 0.23,
          gain: 0.33,
          type: "triangle",
          delay,
          music: true,
        });
      }
      if (this.combat && step % 4 === 0) {
        this.tone({
          frequency: 104,
          end: 38,
          duration: 0.18,
          gain: 0.38,
          delay,
          music: true,
        });
      }
      if (this.combat && step % 8 === 4) {
        this.noise({
          duration: 0.1,
          gain: 0.1,
          frequency: 1800,
          filter: "highpass",
          delay,
          music: true,
        });
        this.tone({
          frequency: 160,
          end: 100,
          duration: 0.08,
          gain: 0.09,
          delay,
          music: true,
        });
      }
      if (this.combat && step % 4 === 2) {
        this.noise({
          duration: 0.028,
          gain: 0.045,
          frequency: 6500,
          filter: "highpass",
          delay,
          music: true,
        });
      }
      if (step % 16 === 0) {
        [2, 3, 4.01].forEach((ratio) =>
          this.tone({
            frequency: root * ratio,
            duration: 2.2,
            gain: 0.09,
            delay,
            attack: 0.34,
            music: true,
          }),
        );
      }
      if (step % 16 === 6 || step % 16 === 14) {
        this.tone({
          frequency: root * (step % 16 === 6 ? 8 : 6),
          duration: 0.64,
          gain: 0.035,
          delay,
          attack: 0.012,
          music: true,
        });
      }
      this.nextBeat += stepDuration;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.timer);
    for (const voice of this.voices) {
      voice.source.onended = null;
      try {
        voice.source.stop();
      } catch {}
      voice.nodes.forEach((node) => node.disconnect());
    }
    this.voices.clear();
    this.effects?.disconnect();
    this.music?.disconnect();
    this.master?.disconnect();
    this.compressor?.disconnect();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.master = null;
    this.effects = null;
    this.music = null;
    this.compressor = null;
    this.noiseBuffer = null;
  }
}
