/**
 * All game audio. 100% synthesised — the bundle ships zero audio bytes.
 *
 * The AudioContext is created lazily inside the first user gesture (autoplay
 * policy) and re-resumed opportunistically: iOS suspends it after calls,
 * Control Centre music, or a tab switch.
 *
 * ## It consumes typed events, not a state diff
 *
 * game1 recovered its events by diffing two consecutive sim states, because
 * its sim did not report any. Ours does — `SimEvents` from `step()` and
 * `CombatEvents` from the turn engine — so this file reads them directly and
 * there is no second, drifting definition of "what happened".
 *
 * ## Three independent mute reasons OR together
 *
 * - the ad contract: mute only while an ad actually plays, driven by the
 *   platform wrapper's `GameHooks` (`CLAUDE.md` §8 — mute on `adStarted`, not
 *   on request);
 * - the PLATFORM's own mute toggle, which §3 requires us to respect;
 * - the player's mute button, a device preference kept in localStorage and
 *   deliberately NOT in cloud save.
 */

import type { StatusId } from "../content";
import type { RtEvents } from "../sim/rt/step";
import {
  makeNoiseBuffer,
  playDeath,
  playDefeat,
  playDouse,
  playFanfare,
  playFire,
  playFootfall,
  playFrost,
  playImpact,
  playJoin,
  playLightning,
  playStatus,
  playToast,
  playUiTap,
  playVictory,
  playWater,
  type Priority,
  type VoiceEnd,
} from "./synth";

const MUTE_PREF_KEY = "hugoslekstuga:greyrot:muted";
const MASTER_GAIN = 0.9;
/** At/above these counts, drop low- then mid-priority voices. High always plays. */
const VOICE_CAP_LOW = 10;
const VOICE_CAP_MID = 14;

/** Status pitches, so each one is identifiable by ear as well as by pip. */
const STATUS_PITCH: Record<StatusId, number> = {
  burning: 660,
  wet: 440,
  shocked: 990,
  frozen: 1320,
  oiled: 330,
  bleeding: 550,
};

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private adMuted = false;
  private platformMuted = false;
  private userMuted = false;
  private activeVoices = 0;
  /** Guards the turn chime against re-firing every frame. */

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
      if (!Ctor) return; // no WebAudio: the game plays silently, and that is fine
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

  /**
   * Close the AudioContext and forget it.
   *
   * game2 had no teardown because the page outlived the game. Browsers cap
   * concurrent AudioContexts (Chrome at six), so without this, navigating in
   * and out of the route half a dozen times ends in a silent game and a
   * console full of refusals. `unlock()` builds a fresh graph on demand, so a
   * disposed system is reusable if it ever needs to be.
   */
  dispose(): void {
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    if (ctx) void ctx.close().catch(() => {});
  }

  private get muted(): boolean {
    return this.adMuted || this.platformMuted || this.userMuted;
  }

  private applyMute(): void {
    if (!this.ctx || !this.master) return;
    // setTargetAtTime rather than assignment — avoids the hard-step click.
    this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_GAIN, this.ctx.currentTime, 0.015);
  }

  /** Driven exclusively by the platform GameHooks (ad started/finished). */
  setAdMuted(muted: boolean): void {
    this.adMuted = muted;
    this.applyMute();
  }

  /** Driven by the platform's own audio setting (`CLAUDE.md` §3). */
  setPlatformMuted(muted: boolean): void {
    this.platformMuted = muted;
    this.applyMute();
  }

  /** Driven by the in-game mute button. */
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

  /* ------------------------------------------------------------ the feeds */

  /**
   * Everything one real-time tick reported.
   *
   * The one feed, shared by the campaign and the sandbox — both used to
   * dispatch these by hand and would have drifted apart on the first new
   * event. Deliberately sparse under load: `admit` drops low-priority voices,
   * and combos outrank ordinary hits, because when the field is chaotic the
   * thing you must still hear is that something COMBINED.
   */
  onRtEvents(ev: RtEvents): void {
    if (!this.ctx || !this.master || this.muted) return;

    for (const c of ev.casts) this.castVoice(c.element, c.fizzled);

    // One impact voice per tick, and the loudest wins — a dozen simultaneous
    // cracks read as one muddy noise rather than as a dozen hits. `chained`
    // counts as a combo for the voice: the Wet+Lightning hop kills its
    // targets on the tick it lands, and for a whole round it played the
    // plain lightning crack because only the combo LABEL was consulted —
    // the same one-token gap the damage numbers already fixed.
    let loudest: RtEvents["impacts"][number] | null = null;
    for (const i of ev.impacts) {
      if (!loudest || i.damage > loudest.damage) loudest = i;
    }
    if (loudest) {
      this.elementHit(loudest.element, loudest.damage, loudest.combo !== null || loudest.chained);
    }

    const applied = ev.statuses[0];
    if (applied) this.status(applied.status as StatusId);

    if (ev.deaths.length > 0) this.death();
    // The ceremony voices, all earned rather than routine (§11): a rescue,
    // a fight cleared, a stage boundary striding past, an element taken,
    // and a hut fire dying to the player's own water.
    if (ev.rescued.length > 0) playJoin(this.ctx, this.master);
    if (ev.markersCleared.length > 0) playVictory(this.ctx, this.master);
    if (ev.stageCleared >= 0) playToast(this.ctx, this.master);
    if (ev.granted.length > 0 || ev.wove) playFanfare(this.ctx, this.master);
    if (ev.hutDoused.length > 0 && this.noiseBuf && this.admit(2)) {
      this.track(playDouse(this.ctx, this.noiseBuf, this.master));
    }
  }

  /* --------------------------------------------------- real-time combat */

  /**
   * One impact, in the real-time system.
   *
   * The turn-based feed above deliberately plays ONE voice per turn because a
   * turn is a discrete, quiet event. Real time is the opposite problem: a busy
   * second can contain a dozen impacts, and playing all of them is noise. The
   * voice budget in `admit` already drops low-priority voices under load, so
   * the rule here is simply to give combos a HIGHER priority than ordinary
   * hits — when the field is chaotic, the thing you must still hear is that
   * something combined.
   */
  elementHit(element: string, damage: number, combo: boolean): void {
    if (!this.ctx || !this.master || !this.noiseBuf || this.muted) return;
    const priority: Priority = combo ? 2 : 1;
    if (!this.admit(priority)) return;
    const ctx = this.ctx;
    const out = this.master;
    switch (element) {
      case "fire":
        this.track(playFire(ctx, this.noiseBuf, out));
        break;
      case "water":
        this.track(playWater(ctx, out));
        break;
      case "lightning":
        this.track(playLightning(ctx, this.noiseBuf, out, combo));
        break;
      case "frost":
        this.track(playFrost(ctx, out));
        break;
      default:
        this.track(playImpact(ctx, this.noiseBuf, out, Math.min(1, damage / 30)));
    }
  }

  /** A cast left the hero. A fizzle gets the water voice — a wet little puff. */
  castVoice(element: string, fizzled: boolean): void {
    if (!this.ctx || !this.master || this.muted || !this.admit(1)) return;
    if (fizzled) {
      this.track(playWater(this.ctx, this.master));
      return;
    }
    this.track(playUiTap(this.ctx, this.master));
    void element;
  }

  /** Something died. */
  /** The run ends. The app decides when; the sim has no defeat state yet. */
  defeat(): void {
    if (!this.ctx || !this.master || this.muted) return;
    playDefeat(this.ctx, this.master);
  }

  death(): void {
    if (!this.ctx || !this.master || !this.noiseBuf || !this.admit(2)) return;
    this.track(playDeath(this.ctx, this.noiseBuf, this.master));
  }

  /** A status landed, pitched so each one is identifiable by ear. */
  status(id: StatusId): void {
    if (!this.ctx || !this.master || !this.admit(0)) return;
    this.track(playStatus(this.ctx, this.master, STATUS_PITCH[id] ?? 660));
  }

  footfall(): void {
    if (!this.ctx || !this.master || !this.noiseBuf || !this.admit(0)) return;
    this.track(playFootfall(this.ctx, this.noiseBuf, this.master));
  }

  uiTap(): void {
    if (!this.admit(1) || !this.ctx || !this.master) return;
    this.track(playUiTap(this.ctx, this.master));
  }
}
