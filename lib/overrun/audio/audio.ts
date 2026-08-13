import type { TickEvents } from "./events";
import { Music, MOODS } from "./music";
import {
  makeNoiseBuffer,
  playArrival,
  playCapturePing,
  playDefeat,
  playDistantWar,
  playEnemyCaptureTick,
  playNodeLostThud,
  playPurchase,
  playRivalEliminated,
  playSendWhoosh,
  playCorrupterSteal,
  playSiphonDrain,
  playTurretZap,
  playVolatileBlast,
  playUiTap,
  playUpgradeComplete,
  playVictory,
  type Priority,
  type VoiceEnd,
} from "./synth";

const MUTE_PREF_KEY = "hugoslekstuga:overrun:muted";
const MUSIC_PREF_KEY = "hugoslekstuga:overrun:music";
const SFX_PREF_KEY = "hugoslekstuga:overrun:sfx";
const MASTER_GAIN = 0.9;
/** Four steps so "off" is reachable in the same control as everything else. */
export const LEVEL_STEPS = 4;
const SFX_STEPS = [0, 0.35, 0.7, 1] as const;
/** Step 2 is 0.38, the volume the bed shipped with before it was adjustable. */
const MUSIC_STEPS = [0, 0.18, 0.38, 0.6] as const;
const VOICE_CAP_LOW = 12; // at/above this, drop low-priority voices
const VOICE_CAP_MID = 16; // at/above this, drop mid too; high always plays
const ARRIVAL_MIN_GAP_MS = 60;
/** The far war is ambience; it must never turn into a rhythm section. */
const DISTANT_MIN_GAP_MS = 420;

const clampIdx = (n: number): number =>
  Number.isFinite(n) ? Math.max(0, Math.min(LEVEL_STEPS - 1, Math.round(n))) : LEVEL_STEPS - 1;

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* sandboxed iframe — the preference just won't survive a reload */
  }
}

/**
 * All game audio. 100% synthesized (bundle ships zero audio bytes).
 *
 * The AudioContext is created lazily inside the first user gesture (autoplay
 * policy) and re-resumed opportunistically — iOS suspends it after calls,
 * control-center music, or tab switches.
 *
 * Mute is the player's button only — a device preference persisted in
 * localStorage, deliberately NOT part of the game save.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /**
   * Every SFX voice hangs off this; the music bed does NOT — but the mute
   * ramp targets `master`, which is downstream of both buses, so muting
   * covers everything by construction.
   */
  private sfx: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private userMuted = false;
  private sfxIdx = 3;
  private musicIdx = 2;
  /** Music is independently mutable — plenty of players want SFX only. */
  private readonly music = new Music();
  private activeVoices = 0;
  private lastArrivalAt = 0;
  private lastDistantAt = 0;

  constructor() {
    try {
      this.userMuted = localStorage.getItem(MUTE_PREF_KEY) === "1";
      const raw = localStorage.getItem(MUSIC_PREF_KEY);
      this.musicIdx = raw === null ? 2 : clampIdx(Number(raw));
      const sfxRaw = localStorage.getItem(SFX_PREF_KEY);
      this.sfxIdx = sfxRaw === null ? 3 : clampIdx(Number(sfxRaw));
    } catch {
      /* sandboxed iframe without storage access — defaults stand */
    }
    this.music.setEnabled(this.musicIdx > 0);
    this.music.setVolume(MUSIC_STEPS[this.musicIdx]!);
  }

  /* ------------------------------------------------------------- levels */

  sfxLevel(): number {
    return this.sfxIdx;
  }

  musicLevel(): number {
    return this.musicIdx;
  }

  setSfxLevel(idx: number): void {
    this.sfxIdx = clampIdx(idx);
    persist(SFX_PREF_KEY, String(this.sfxIdx));
    if (this.ctx && this.sfx) {
      this.sfx.gain.setTargetAtTime(SFX_STEPS[this.sfxIdx]!, this.ctx.currentTime, 0.015);
    }
  }

  setMusicLevel(idx: number): void {
    this.musicIdx = clampIdx(idx);
    persist(MUSIC_PREF_KEY, String(this.musicIdx));
    this.music.setEnabled(this.musicIdx > 0);
    this.music.setVolume(MUSIC_STEPS[this.musicIdx]!);
  }

  /** Idempotent; call inside EVERY pointerdown and on visibilitychange. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return; // no WebAudio: game plays silently
      this.ctx = new Ctor();
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-18, this.ctx.currentTime);
      compressor.ratio.setValueAtTime(4, this.ctx.currentTime);
      compressor.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.setValueAtTime(this.muted ? 0 : MASTER_GAIN, this.ctx.currentTime);
      this.master.connect(compressor);
      this.sfx = this.ctx.createGain();
      this.sfx.gain.setValueAtTime(SFX_STEPS[this.sfxIdx]!, this.ctx.currentTime);
      this.sfx.connect(this.master);
      this.noiseBuf = makeNoiseBuffer(this.ctx);
    }
    if (this.ctx.state !== "running") void this.ctx.resume();
    // The bed hangs off the master gain, so the mute ramp already covers it.
    this.music.attach(this.ctx, this.master!, this.noiseBuf!);
  }

  /** Unmount path — kill the music scheduler and the AudioContext (browsers
   *  cap live contexts, so leaking one per visit hurts). */
  dispose(): void {
    this.music.stop();
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.master = null;
    this.sfx = null;
    this.noiseBuf = null;
  }

  /* ------------------------------------------------------------- music bed */

  /** Biome index — the bed takes its key and tempo from the level's look. */
  setMusicMood(biomeIndex: number): void {
    this.music.setMood(MOODS[biomeIndex % MOODS.length]!);
  }

  /** 0..1 — how contested the board is. Fades the pulse and lead layers in. */
  setMusicHeat(heat: number): void {
    this.music.setHeat(heat);
  }

  /** Quieter under menus and end-of-level overlays, not stopped. */
  duckMusic(on: boolean): void {
    this.music.duck(on);
  }

  private get muted(): boolean {
    return this.userMuted;
  }

  private applyMute(): void {
    if (!this.ctx || !this.master) return;
    // setTargetAtTime instead of assignment — avoids the hard-step click.
    this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_GAIN, this.ctx.currentTime, 0.015);
  }

  /** Driven exclusively by the mute button. */
  toggleUserMuted(): boolean {
    this.userMuted = !this.userMuted;
    try {
      localStorage.setItem(MUTE_PREF_KEY, this.userMuted ? "1" : "0");
    } catch {
      /* fine */
    }
    this.applyMute();
    // A confirmation tap after muting would be self-defeating.
    if (!this.userMuted) this.uiTap();
    return this.userMuted;
  }

  isUserMuted(): boolean {
    return this.userMuted;
  }

  /** Voice budget: constant-time admission by priority. */
  private admit(priority: Priority): boolean {
    if (!this.ctx || !this.sfx || this.muted) return false;
    if (this.activeVoices >= VOICE_CAP_MID && priority < 2) return false;
    if (this.activeVoices >= VOICE_CAP_LOW && priority < 1) return false;
    return true;
  }

  private track(v: VoiceEnd): void {
    this.activeVoices++;
    v.onended = () => {
      this.activeVoices--;
    };
  }

  onEvents(e: TickEvents): void {
    if (!this.ctx || !this.sfx || !this.noiseBuf || this.muted) return;
    const ctx = this.ctx;
    const out = this.sfx;
    const buf = this.noiseBuf;

    // One voice per event class per tick; batches scale gain, not voice count.
    const batchScale = (count: number) => Math.min(1.6, 1 + 0.15 * (count - 1));

    if (e.playerCaptures > 0 && this.admit(2)) this.track(playCapturePing(ctx, out));
    if (e.playerLosses > 0 && this.admit(2)) this.track(playNodeLostThud(ctx, buf, out));
    if (e.aiCaptures > 0 && this.admit(0)) this.track(playEnemyCaptureTick(ctx, out));
    if (e.playerSends > 0 && this.admit(1)) this.track(playSendWhoosh(ctx, buf, out, false));
    if (e.threatSends > 0 && this.admit(1)) this.track(playSendWhoosh(ctx, buf, out, true));
    // Distant AI-vs-AI war: a rare, very quiet awareness tick.
    if (e.distantSends > 0 && this.admit(0) && Math.random() < 0.3)
      this.track(playEnemyCaptureTick(ctx, out));
    // The far war. Rate-limited and thinned hard: on a 4-faction board these
    // fire most ticks, and one thump per tick would be a machine gun.
    if (e.distantArrivals > 0 && this.admit(0)) {
      const now = performance.now();
      if (now - this.lastDistantAt >= DISTANT_MIN_GAP_MS && Math.random() < 0.5) {
        this.lastDistantAt = now;
        this.track(playDistantWar(ctx, buf, out));
      }
    }
    if (e.turretZaps > 0 && this.admit(1)) {
      this.track(playTurretZap(ctx, out, batchScale(e.turretZaps)));
    }
    // A detonation is loud and structurally surprising — priority 2, like the
    // upgrade payoff, so a busy board cannot swallow it.
    if (e.volatileBlasts > 0 && this.admit(2)) {
      this.track(playVolatileBlast(ctx, out, batchScale(e.volatileBlasts)));
    }
    // The quietest thing in the set: it repeats every 1.5 s while a siphon is
    // in contact, so it takes the lowest priority and gets dropped first.
    if (e.siphonDrains > 0 && this.admit(0)) {
      this.track(playSiphonDrain(ctx, out, batchScale(e.siphonDrains)));
    }
    // A theft is rarer than a drain and costs twice as much, so it sits a rung
    // above it — but still below a zap, which is the louder cousin.
    if (e.corrupterSteals > 0 && this.admit(1)) {
      this.track(playCorrupterSteal(ctx, out, batchScale(e.corrupterSteals)));
    }
    // Rare and structurally important — always worth a voice.
    if (e.rivalsEliminated > 0) playRivalEliminated(ctx, out);
    if (e.playerUpgradesDone > 0 && this.admit(2))
      this.track(playUpgradeComplete(ctx, out));

    const arrivals = e.arrivalsFriendly + e.arrivalsHostile;
    if (arrivals > 0) {
      const now = performance.now();
      if (now - this.lastArrivalAt >= ARRIVAL_MIN_GAP_MS && this.admit(0)) {
        this.lastArrivalAt = now;
        const hostile = e.arrivalsHostile >= e.arrivalsFriendly;
        this.track(playArrival(ctx, out, hostile, batchScale(arrivals)));
      }
    }
  }

  victory(): void {
    if (!this.ctx || !this.sfx || this.muted) return;
    playVictory(this.ctx, this.sfx);
  }

  defeat(): void {
    if (!this.ctx || !this.sfx || this.muted) return;
    playDefeat(this.ctx, this.sfx);
  }

  /** An upgrade purchase in the shop. */
  purchase(): void {
    if (!this.ctx || !this.sfx || this.muted) return;
    playPurchase(this.ctx, this.sfx);
  }

  uiTap(): void {
    if (!this.admit(1) || !this.ctx || !this.sfx) return;
    this.track(playUiTap(this.ctx, this.sfx));
  }
}
