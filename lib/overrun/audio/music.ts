import {
  BUS_COMP,
  DELAY_STEPS,
  DUCK,
  HUMANIZE,
  hum,
  hz,
  LEAD_SWEEP,
  LOOP_STEPS,
  loopVariant,
  MIX,
  mixAt,
  MOODS,
  notesAt,
  PAN,
  REVERB,
  stepTimeOffset,
  tiltGain,
  VOICES,
  type MusicMood,
  type NoteEvent,
  type VoiceParams,
} from "./score";

export { MOODS, type MusicMood } from "./score";

/**
 * Music playback. The composition itself lives in ./score as pure data; this
 * file only turns note events into WebAudio voices and manages the mix.
 *
 * Six voices on five gain-staged layers:
 *  - bass + chords + arp + lead: always audible. The melody *is* the point, so
 *    it does not gate on intensity — an early version faded it in only when
 *    things got tense, which meant most of a session had no tune at all.
 *  - percussion: fades in as the board heats up, so intensity adds drive
 *    rather than adding the song.
 *
 * The lead runs through a dotted-eighth feedback delay. That is not decoration:
 * the melody deliberately leaves long rests, and the delay is what keeps those
 * rests from sounding like the music stopped.
 *
 * Steps are scheduled ahead on the AudioContext clock in short chunks, driven
 * from a cheap interval — WebAudio timing is sample-accurate and setTimeout is
 * emphatically not.
 */

const LOOKAHEAD_S = 0.5;
const SCHEDULE_EVERY_MS = 120;

/** Background music, so it sits well under the SFX bus by default. */
const DEFAULT_VOLUME = 0.38;

/** Vibrato only on notes long enough to hold — a wobble on a 16th is a warble. */
const VIBRATO_MIN_STEPS = 5;
const VIBRATO_HZ = 5.2;
const VIBRATO_CENTS = 7;
/** Let the note speak before it starts moving. */
const VIBRATO_ONSET_S = 0.14;

type LayerName = "bass" | "chord" | "arp" | "lead" | "counter" | "perc";

export class Music {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private layers: Record<LayerName, GainNode | null> = {
    bass: null,
    chord: null,
    arp: null,
    lead: null,
    counter: null,
    perc: null,
  };
  /** Dotted-eighth echo on the lead. Built once; retimed when tempo changes. */
  private delay: DelayNode | null = null;
  private delaySend: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  /** Procedural room. Per-voice sends; the bass stays dry on purpose. */
  private reverbSends: Record<"chord" | "arp" | "lead" | "counter", GainNode | null> = {
    chord: null,
    arp: null,
    lead: null,
    counter: null,
  };

  /**
   * Kick-keyed duck on the sustained bed (see DUCK in score.ts). One gain
   * per layer, in series AFTER the layer gain — deliberately not the layer's
   * own gain param, which setHeat automates with setTargetAtTime; two
   * automations on one AudioParam fight.
   */
  private duckGains: Record<"chord" | "arp" | "counter", GainNode | null> = {
    chord: null,
    arp: null,
    counter: null,
  };

  private timer: ReturnType<typeof setInterval> | null = null;
  private nextStepAt = 0;
  private step = 0;

  private mood: MusicMood = MOODS[1]!;
  private enabled = true;
  private volume = DEFAULT_VOLUME;
  private ducked = false;
  /** Last heat handed to setHeat — scales the duck with the kick's audibility. */
  private heat = 0;

  private get stepDur(): number {
    return 60 / this.mood.bpm / 4; // one 16th
  }

  /** Attach to the shared output. Idempotent; safe to call on every unlock. */
  attach(ctx: AudioContext, out: AudioNode, noise: AudioBuffer): void {
    if (this.ctx) return;
    this.ctx = ctx;
    this.noise = noise;

    this.bus = ctx.createGain();
    this.bus.gain.setValueAtTime(0, ctx.currentTime);
    // Gentle glue between the music bus and `out` (= master). Upstream of
    // master, so the mute ramp is untouched; settings live in BUS_COMP
    // beside the offline mirror's approximation of them.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.setValueAtTime(BUS_COMP.thresholdDb, ctx.currentTime);
    comp.knee.setValueAtTime(BUS_COMP.kneeDb, ctx.currentTime);
    comp.ratio.setValueAtTime(BUS_COMP.ratio, ctx.currentTime);
    comp.attack.setValueAtTime(BUS_COMP.attackS, ctx.currentTime);
    comp.release.setValueAtTime(BUS_COMP.releaseS, ctx.currentTime);
    this.bus.connect(comp);
    comp.connect(out);

    const cold = mixAt(0);
    const layer = (name: LayerName): GainNode => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(cold[name], ctx.currentTime);
      g.connect(this.bus!);
      return g;
    };
    this.layers.bass = layer("bass");
    this.layers.lead = layer("lead");
    this.layers.perc = layer("perc");
    // Chord and arp route through their duck gains (kick-keyed, see DUCK) —
    // and the arp through its pan. The chord's width comes from splitting its
    // detuned pair inside pitched(), so no layer-level panner here; GainNodes
    // pass a stereo signal through untouched. Reverb sends tap the LAYER
    // output below, i.e. pre-duck — the tails keep breathing while the dry
    // bed leans away from the kick.
    const duckedLayer = (name: "chord" | "arp" | "counter", pan: number): GainNode => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(cold[name], ctx.currentTime);
      const duck = ctx.createGain();
      duck.gain.setValueAtTime(1, ctx.currentTime);
      this.duckGains[name] = duck;
      g.connect(duck);
      if (pan !== 0) {
        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(pan, ctx.currentTime);
        duck.connect(panner);
        panner.connect(this.bus!);
      } else {
        duck.connect(this.bus!);
      }
      return g;
    };
    this.layers.chord = duckedLayer("chord", 0);
    this.layers.arp = duckedLayer("arp", PAN.arp);
    this.layers.counter = duckedLayer("counter", PAN.counter);

    // Lead → delay → feedback, with a lowpass in the loop so each repeat is
    // darker than the last and the echoes fade out of the way instead of
    // piling up as hiss.
    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.setValueAtTime(DELAY_STEPS * this.stepDur, ctx.currentTime);
    const feedback = ctx.createGain();
    feedback.gain.setValueAtTime(0.34, ctx.currentTime);
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.setValueAtTime(2200, ctx.currentTime);
    const wet = ctx.createGain();
    wet.gain.setValueAtTime(0.3, ctx.currentTime);
    this.delaySend = ctx.createGain();
    this.delaySend.gain.setValueAtTime(1, ctx.currentTime);

    this.delaySend.connect(this.delay);
    this.delay.connect(damp).connect(feedback).connect(this.delay);
    this.delay.connect(wet).connect(this.layers.lead);

    /*
     * The room. Every voice used to be bone dry — a large part of "cheap
     * notes" is a note with no space around it. Procedural impulse (noise
     * under an exponential decay, REVERB.seconds long), per-voice sends so
     * the pad sits furthest back and the bass stays dry and solid.
     */
    const convolver = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * REVERB.seconds);
    const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
      }
    }
    convolver.buffer = impulse;
    const reverbWet = ctx.createGain();
    reverbWet.gain.setValueAtTime(REVERB.wet, ctx.currentTime);
    convolver.connect(reverbWet).connect(this.bus);
    const send = (name: "chord" | "arp" | "lead" | "counter"): GainNode => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(REVERB.send[name]! * this.mood.reverbMul, ctx.currentTime);
      g.connect(convolver);
      return g;
    };
    this.reverbSends.chord = send("chord");
    this.reverbSends.arp = send("arp");
    this.reverbSends.lead = send("lead");
    this.reverbSends.counter = send("counter");
    this.layers.chord.connect(this.reverbSends.chord);
    this.layers.arp.connect(this.reverbSends.arp);
    this.layers.lead.connect(this.reverbSends.lead);
    this.layers.counter.connect(this.reverbSends.counter);

    this.nextStepAt = ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.schedule(), SCHEDULE_EVERY_MS);
    // Fade the whole bus in rather than starting at full — music that snaps on
    // at the first tap is startling.
    this.applyBusGain(1.5);
  }

  /**
   * 0..1: how contested the board is. Adds drive, never the tune.
   * Long time constants — the mix should breathe with the match, not twitch
   * on a single capture.
   */
  setHeat(heat: number): void {
    this.heat = heat;
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const m = mixAt(heat);
    this.layers.perc?.gain.setTargetAtTime(m.perc, t, 2.2);
    // Chords open up slightly as things get busy, which lifts the whole mix
    // without making the melody louder.
    this.layers.chord?.gain.setTargetAtTime(m.chord, t, 2.5);
  }

  /** Switch biome identity: key, tempo, lead blend, kit and room size. */
  setMood(mood: MusicMood): void {
    this.mood = mood;
    // The echo is a rhythmic figure, not an effect — it has to track tempo or
    // it stops landing on the off-beats and just smears.
    if (this.ctx && this.delay) {
      const t = this.ctx.currentTime;
      this.delay.delayTime.setTargetAtTime(DELAY_STEPS * this.stepDur, t, 0.3);
      for (const name of ["chord", "arp", "lead", "counter"] as const) {
        this.reverbSends[name]?.gain.setTargetAtTime(
          REVERB.send[name]! * mood.reverbMul,
          t,
          0.5,
        );
      }
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.applyBusGain(0.25);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyBusGain(0.1);
  }

  /** Quieter under menus and overlays — not stopped. */
  duck(on: boolean): void {
    if (this.ducked === on) return;
    this.ducked = on;
    this.applyBusGain(0.2);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private applyBusGain(tau: number): void {
    if (!this.ctx || !this.bus) return;
    const target = this.enabled ? this.volume * (this.ducked ? 0.4 : 1) : 0;
    this.bus.gain.setTargetAtTime(target, this.ctx.currentTime, tau);
  }

  /** Schedule any steps falling inside the lookahead window. */
  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    // Suspended context (hidden tab, iOS interruption): hold the clock rather
    // than letting it run on, or resuming would dump every overdue step at once.
    if (ctx.state !== "running") {
      this.nextStepAt = Math.max(this.nextStepAt, ctx.currentTime);
      return;
    }
    const until = ctx.currentTime + LOOKAHEAD_S;
    let guard = 0;
    while (this.nextStepAt < until && guard++ < 64) {
      const loop = Math.floor(this.step / LOOP_STEPS);
      const variant = loopVariant(loop);
      const lead = variant !== "breather";
      // Swing: odd 16ths lean late. Applied at SCHEDULING time in both engines
      // (see stepTimeOffset) — swing in one and not the other would make the
      // preview a different piece of music than the game.
      const at = this.nextStepAt + stepTimeOffset(this.step) * this.stepDur;
      const inLoop = this.step - loop * LOOP_STEPS;
      let idx = 0;
      for (const n of notesAt(this.step, { lead })) {
        // Arrangement variants (see loopVariant): the arp sits out phrase A on
        // "thinArp" loops; "octaveLead" adds a quiet upper double to the tune.
        if (variant === "thinArp" && n.voice === "arp" && inLoop < LOOP_STEPS / 2) continue;
        this.play(n, at, this.step, idx++);
        if (variant === "octaveLead" && n.voice === "lead") {
          this.play({ ...n, semi: n.semi + 12, velocity: n.velocity * 0.28 }, at, this.step, idx++);
        }
      }
      this.step++;
      this.nextStepAt += this.stepDur;
    }
  }

  private play(n: NoteEvent, at: number, step: number, idx: number): void {
    /*
     * The human layer. Deterministic (hash of position, not Math.random — the
     * SFX engine jitters randomly, but the music must render identically in
     * the offline preview or the preview stops being the game): velocity leans
     * ±7%, pitched voices drift ±5 ms, drums hold tighter at ±2 ms, and the
     * pad's notes strum instead of firing on one sample. Every note in the old
     * engine was exactly on-grid at exactly its table gain, forever — the
     * single largest reason it read as a music box rather than a performance.
     */
    const drum = n.voice === "hat" || n.voice === "kick" || n.voice === "snare";
    const seed = step * 31 + idx * 7;
    const velocity = n.velocity * (1 + HUMANIZE.velocity * hum(seed));
    const timing = (drum ? HUMANIZE.drumTimingS : HUMANIZE.timingS) * hum(seed + 3);
    const strum = n.voice === "chord" ? (idx % 3) * HUMANIZE.strumS : 0;
    const t = Math.max(at + timing + strum, this.ctx!.currentTime + 0.001);
    const hn = { ...n, velocity };

    // The mood's kit: Glacier plays with no drums at all, Deep Field's are soft.
    if (drum) {
      if (this.mood.drums === "none") return;
      if (this.mood.drums === "soft") hn.velocity *= 0.7;
    }

    switch (hn.voice) {
      case "bass":
        this.pitched(hn, t, VOICES.bass, this.layers.bass!, ["triangle"]);
        break;
      case "chord":
        // Two voices a few cents apart so the pad moves instead of sitting flat.
        this.pitched(hn, t, VOICES.chord, this.layers.chord!, ["triangle", "triangle"], {
          detune: 5,
          spreadPan: PAN.chordSpread,
        });
        break;
      case "arp":
        this.pitched(
          { ...hn, semi: hn.semi + this.mood.arpLift },
          t,
          VOICES.arp,
          this.layers.arp!,
          ["triangle"],
        );
        break;
      case "lead":
        this.lead(hn, t);
        break;
      case "counter":
        // Two triangles a touch apart, like the pad but narrower — a shadow
        // voice, not a second lead.
        this.pitched(hn, t, VOICES.counter, this.layers.counter!, ["triangle", "triangle"], {
          detune: 4,
        });
        break;
      case "hat":
        this.hat(t, hn.velocity);
        break;
      case "kick":
        this.kick(t, hn.velocity);
        // The duck rides on EMITTED kicks only — this line sits after the
        // mood's drum gate above, so Glacier's drumless kit never pumps.
        this.scheduleDuck(t);
        break;
      case "snare":
        this.snare(t, hn.velocity);
        break;
    }
  }

  /**
   * The melody. Three oscillators — two detuned bodies and a quieter edge —
   * through a filter that opens on the attack and closes again, with vibrato
   * on anything long enough to hold. Every one of those is there because the
   * previous single oscillator through a fixed filter sounded like a beeper.
   */
  private lead(n: NoteEvent, at: number): void {
    const ctx = this.ctx!;
    const v = this.mood.lead;
    const p = VOICES.lead;
    const freq = hz(n.semi, this.mood.transpose);
    const dur = n.len * this.stepDur;
    const hold = Math.max(0.06, dur * 0.82);
    const end = at + hold + p.release;

    const amp = ctx.createGain();
    const peak = p.peak * n.velocity * tiltGain(freq);
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.linearRampToValueAtTime(peak, at + p.attack);
    amp.gain.setValueAtTime(peak, at + hold);
    amp.gain.exponentialRampToValueAtTime(0.0001, end);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.setValueAtTime(1.6, at);
    const base = Math.min(freq * p.cutoffMul * v.bright, p.cutoffMax);
    const open = Math.min(base * LEAD_SWEEP.open, 12000);
    lp.frequency.setValueAtTime(open, at);
    lp.frequency.setTargetAtTime(base, at + p.attack, LEAD_SWEEP.decayS);

    lp.connect(amp);
    amp.connect(this.layers.lead!);
    amp.connect(this.delaySend!);

    // Vibrato is shared by all three oscillators, so they stay in unison.
    let lfo: OscillatorNode | null = null;
    let lfoGain: GainNode | null = null;
    if (n.len >= VIBRATO_MIN_STEPS) {
      lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(VIBRATO_HZ, at);
      lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(0, at);
      lfoGain.gain.setTargetAtTime(VIBRATO_CENTS, at + VIBRATO_ONSET_S, 0.12);
      lfo.connect(lfoGain);
      lfo.start(at);
      lfo.stop(end + 0.02);
    }

    /*
     * FM electric-piano pairs, replacing the plain detuned triangles.
     *
     * A triangle through a low lowpass is spectrally a sine — the audit's root
     * cause for "cheap-sounding notes" was that every pitched voice in the
     * game was, effectively, a beep. A 2:1 FM pair whose modulation index
     * DECAYS is the classic DX-piano recipe: bright bell-ish attack relaxing
     * into a warm sustain, i.e. an instrument with a touch, not a tone with a
     * volume. Two pairs at ±detune keep the width the old stack had; the
     * mood's edge oscillator survives as seasoning on top.
     */
    const fmPair = (detune: number, gain: number): void => {
      const carrier = ctx.createOscillator();
      carrier.type = "sine";
      carrier.frequency.setValueAtTime(freq, at);
      carrier.detune.setValueAtTime(detune, at);
      lfoGain?.connect(carrier.detune);

      const mod = ctx.createOscillator();
      mod.type = "sine";
      mod.frequency.setValueAtTime(freq * 2, at);
      const modGain = ctx.createGain();
      // Index envelope: the whole EP character lives in this decay.
      modGain.gain.setValueAtTime(freq * 1.5 * v.bright, at);
      modGain.gain.setTargetAtTime(freq * 0.12, at + 0.01, 0.22);
      mod.connect(modGain).connect(carrier.frequency);

      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, at);
      carrier.connect(g).connect(lp);
      carrier.start(at);
      carrier.stop(end + 0.02);
      mod.start(at);
      mod.stop(end + 0.02);
    };

    const voice = (type: OscillatorType, detune: number, gain: number): void => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, at);
      osc.detune.setValueAtTime(detune, at);
      lfoGain?.connect(osc.detune);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, at);
      osc.connect(g).connect(lp);
      osc.start(at);
      osc.stop(end + 0.02);
    };

    fmPair(-v.detune, 0.5);
    fmPair(v.detune, 0.5);
    if (v.edgeMix > 0) voice(v.edge, 0, v.edgeMix);
  }

  /**
   * The kick-keyed lean on the sustained bed. Depth scales with the perc
   * layer's current mix (a cold, inaudible kick must not duck the bed
   * against silence). Kicks are ≥ ~0.8 s apart at these tempos and the whole
   * envelope lasts ~0.7 s, so ramps never overlap in practice; the anchor
   * set below lands within ~1% of unity even in the worst case.
   */
  private scheduleDuck(at: number): void {
    const percScale = mixAt(this.heat).perc / MIX.perc;
    const depth = DUCK.depth * percScale;
    if (depth <= 0.001) return;
    const duckEnd = at + DUCK.attackS + DUCK.holdS;
    for (const g of [this.duckGains.chord, this.duckGains.arp, this.duckGains.counter]) {
      if (!g) continue;
      g.gain.setValueAtTime(1, Math.max(at - 0.002, this.ctx!.currentTime));
      g.gain.linearRampToValueAtTime(1 - depth, at + DUCK.attackS);
      g.gain.setValueAtTime(1 - depth, duckEnd);
      g.gain.setTargetAtTime(1, duckEnd, DUCK.releaseS);
    }
  }

  /** Bass, chords and arp: one or two oscillators, static filter, no vibrato. */
  private pitched(
    n: NoteEvent,
    at: number,
    p: VoiceParams,
    out: GainNode,
    types: readonly OscillatorType[],
    opts: { detune?: number; spreadPan?: number } = {},
  ): void {
    const ctx = this.ctx!;
    const freq = hz(n.semi, this.mood.transpose);
    const dur = n.len * this.stepDur;
    // Plucked voices decay on their own; sustained ones hold most of the note
    // and then release, which is what makes a pad ring rather than blip.
    const hold = p.sustain ? Math.max(0.05, dur * 0.85) : Math.min(dur, p.release);
    const end = at + hold + p.release;

    const g = ctx.createGain();
    const peak = (p.peak * n.velocity) / types.length;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + p.attack);
    if (p.sustain) g.gain.setValueAtTime(peak, at + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    g.connect(out);

    const cutoff = Math.min(freq * p.cutoffMul, p.cutoffMax);
    // Shared filter for the mono path, created lazily so spread mode (where
    // every oscillator takes its own filter+panner chain) doesn't leave an
    // orphan node wired to the envelope. With spreadPan the −detune body
    // goes left, the +detune body right — the pad's stereo width IS its
    // detune pair split apart; mono fold sums back to exactly the old
    // beating pair. The envelope gain is shared either way; GainNodes pass
    // stereo through untouched.
    let lp: BiquadFilterNode | null = null;
    const sharedLp = (): BiquadFilterNode => {
      if (!lp) {
        lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(cutoff, at);
        lp.connect(g);
      }
      return lp;
    };

    types.forEach((type, i) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, at);
      // Spread the voices symmetrically: -d, +d for a pair, 0 for a single.
      const spread = opts.detune ?? 0;
      const side = types.length === 1 ? 0 : i * 2 - 1;
      if (spread) osc.detune.setValueAtTime(side * spread, at);
      if (opts.spreadPan && side !== 0) {
        const lpK = ctx.createBiquadFilter();
        lpK.type = "lowpass";
        lpK.frequency.setValueAtTime(cutoff, at);
        const pan = ctx.createStereoPanner();
        pan.pan.setValueAtTime(side * opts.spreadPan, at);
        osc.connect(lpK).connect(pan).connect(g);
      } else {
        osc.connect(sharedLp());
      }
      osc.start(at);
      osc.stop(end + 0.02);
    });
  }

  private hat(at: number, velocity: number): void {
    const ctx = this.ctx!;
    if (!this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(7000, at);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16 * velocity, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.045);
    // The hat sits left, opposing the arp's right (PAN) — width from the
    // decorations while kick and snare hold the centre.
    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime(PAN.hat, at);
    src.connect(hp).connect(g).connect(pan).connect(this.layers.perc!);
    src.start(at);
    src.stop(at + 0.06);
  }

  private kick(at: number, velocity: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(120, at);
    osc.frequency.exponentialRampToValueAtTime(48, at + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7 * velocity, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
    osc.connect(g).connect(this.layers.perc!);
    osc.start(at);
    osc.stop(at + 0.14);
  }

  /**
   * The backbeat: band-passed noise snap over a short 190 Hz body. Soft — a
   * lo-fi rim, not a rock snare — because it plays once a bar under a strategy
   * game, forever.
   */
  private snare(at: number, velocity: number): void {
    const ctx = this.ctx!;
    if (!this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(2600, at);
    bp.Q.setValueAtTime(0.9, at);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32 * velocity, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
    src.connect(bp).connect(g).connect(this.layers.perc!);
    src.start(at);
    src.stop(at + 0.1);

    const body = ctx.createOscillator();
    body.type = "sine";
    body.frequency.setValueAtTime(190, at);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.18 * velocity, at);
    bg.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    body.connect(bg).connect(this.layers.perc!);
    body.start(at);
    body.stop(at + 0.08);
  }
}
