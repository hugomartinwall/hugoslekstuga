import type { TickEvents } from "./events";
import {
  makeNoiseBuffer,
  playArrival,
  playCapturePing,
  playDefeat,
  playEnemyCaptureTick,
  playNodeLostThud,
  playSendWhoosh,
  playUiTap,
  playVictory,
  type Priority,
  type VoiceEnd,
} from "./synth";

const MUTE_PREF_KEY = "hugoslekstuga:overrun:muted";
const MASTER_GAIN = 0.9;
const VOICE_CAP_LOW = 12; // at/above this, drop low-priority voices
const VOICE_CAP_MID = 16; // at/above this, drop mid too; high always plays
const ARRIVAL_MIN_GAP_MS = 60;

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
  private noiseBuf: AudioBuffer | null = null;
  private userMuted = false;
  private activeVoices = 0;
  private lastArrivalAt = 0;

  constructor() {
    try {
      this.userMuted = localStorage.getItem(MUTE_PREF_KEY) === "1";
    } catch {
      /* sandboxed iframe without storage access — default unmuted */
    }
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
      this.noiseBuf = makeNoiseBuffer(this.ctx);
    }
    if (this.ctx.state !== "running") void this.ctx.resume();
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
    if (!this.ctx || !this.master || this.muted) return false;
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
    if (!this.ctx || !this.master || !this.noiseBuf || this.muted) return;
    const ctx = this.ctx;
    const out = this.master;
    const buf = this.noiseBuf;

    // One voice per event class per tick; batches scale gain, not voice count.
    const batchScale = (count: number) => Math.min(1.6, 1 + 0.15 * (count - 1));

    if (e.playerCaptures > 0 && this.admit(2)) this.track(playCapturePing(ctx, out));
    if (e.playerLosses > 0 && this.admit(2)) this.track(playNodeLostThud(ctx, buf, out));
    if (e.enemyCaptures > 0 && this.admit(0)) this.track(playEnemyCaptureTick(ctx, out));
    if (e.playerSends > 0 && this.admit(1)) this.track(playSendWhoosh(ctx, buf, out, false));
    if (e.enemySends > 0 && this.admit(0)) this.track(playSendWhoosh(ctx, buf, out, true));

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
    if (!this.ctx || !this.master || this.muted) return;
    playVictory(this.ctx, this.master);
  }

  defeat(): void {
    if (!this.ctx || !this.master || this.muted) return;
    playDefeat(this.ctx, this.master);
  }

  uiTap(): void {
    if (!this.admit(1) || !this.ctx || !this.master) return;
    this.track(playUiTap(this.ctx, this.master));
  }

  /** Unmount path — browsers cap live AudioContexts, so leaking one per visit hurts. */
  dispose(): void {
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
  }
}
