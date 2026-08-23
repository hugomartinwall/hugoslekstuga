/**
 * The shared presentation reactions to a sim tick — particles, shake and
 * puppet triggers for `RtEvents`, plus the continuous effects (bolt trails,
 * fire breathing, the charge glow) that run every frame.
 *
 * One module, imported by BOTH entries (`CLAUDE.md` §6): the cast, impact,
 * ignition and death blocks had been written twice — once in `main.ts`, once
 * in `sandbox.ts` — and had already drifted apart in count, origin and
 * gravity. Anything entry-specific stays with the entry: audio, HUD flashes,
 * banners, and the seams. This module owns what a tick LOOKS like.
 *
 * §11's juice law governs: shake answers what happens TO the player and what
 * they SUCCEED at — a landed combo, an ignition, a kill, a hit taken. Never
 * the routine act of casting, which in real time is the most frequent input
 * in the game and therefore the rule most likely to be quietly broken.
 */

import { foeKind } from "../../content/foes";
import type { RtEvents } from "../../sim/rt/step";
import type { RtState } from "../../sim/rt/state";
import { ARRIVAL_CUE_RADIUS } from "../../sim/staging";
import { TICK_HZ } from "../../sim/tick";
import { ELEMENT_FX, FOE_TRAIL, FX } from "../art";
import { ELEMENT_RGB, attackColour, type RtView } from "../rt-view";
import type { Particles } from "./particles";

/** The element a status reads as, for particle colour. One mapping, shared. */
export function statusElement(id: string): string {
  switch (id) {
    case "burning":
      return "fire";
    case "wet":
      return "water";
    case "frozen":
      return "frost";
    case "shocked":
      return "lightning";
    case "oiled":
      return "oil";
    default:
      return "spore";
  }
}

/** A combo landed this tick — the caller flashes its own HUD with it. */
export interface ComboFlash {
  label: string;
  element: string;
}

export interface EventFxCtx {
  particles: Particles;
  view: RtView;
  heightAt: (x: number, z: number) => number;
  /** The camera rig's addShake, passed as a closure to keep this module small. */
  shake: (strength: number) => void;
}

export class RtEventFx {
  private fireAcc = 0;
  private chargeAcc = 0;
  private dripAcc = 0;

  constructor(private ctx: EventFxCtx) {}

  /**
   * React to one tick's events. Returns the combo to flash (the HUD objects
   * differ per entry) — the shake for it is already applied here.
   */
  apply(ev: RtEvents, s: RtState): ComboFlash | null {
    const { particles, view, heightAt, shake } = this.ctx;

    // The root begins: the gather pose, held until launch. Before this event
    // existed the only cast animation STARTED at launch, which played the
    // anticipation after the bolt had already left. No shake — routine input.
    if (ev.castCommitted) {
      view.heroCastCommit(ev.castCommitted.ticks / TICK_HZ, ev.castCommitted.elements.length);
    }

    for (const c of ev.casts) {
      // The launch is a RELEASE now, not the anticipation.
      view.heroCastRelease();
      const col = ELEMENT_RGB[c.element] ?? ELEMENT_RGB.spore!;
      // A live cast bursts ALONG the commanded facing (R1's facing cue): the
      // muzzle puff states the fire line in the same instant the bolt takes
      // it, so a whiff teaches where the aim actually was. Reads the sim's
      // own facing vector and nothing else — never the foe list, never the
      // cursor (the §12 assist ban's boundary, in comp's phrasing). A fizzle
      // stays a directionless sigh.
      const dir: [number, number, number] | null = c.fizzled
        ? null
        : [s.hero.fx, 0.2, s.hero.fz];
      particles.emit({
        count: c.fizzled ? 8 : 18,
        origin: [c.x, heightAt(c.x, c.z) + 1.0, c.z],
        speed: c.fizzled ? 0.8 : 2.6,
        ...(dir ? { direction: dir } : {}),
        spread: c.fizzled ? 0.9 : 0.4,
        color: c.fizzled ? [0.7, 0.75, 0.8] : [...col],
        lifetime: 0.4,
        size: 0.11,
        gravity: c.fizzled ? -0.6 : -0.4,
        intensity: c.fizzled ? 0.8 : 2.2,
      });
      // No shake. Casting is routine input.
    }

    // A foe began a telegraphed attack: a burst of its attack element at the
    // body, drifting up — the windup pose says "watch me", this says "and
    // THIS is what is coming".
    for (const w of ev.windups) {
      particles.emit({
        count: 8,
        origin: [w.x, heightAt(w.x, w.z) + 0.9, w.z],
        speed: 0.9,
        spread: 0.8,
        color: attackColour(w.element, false),
        lifetime: 0.6,
        size: 0.12,
        gravity: -0.7,
        intensity: 1.8,
      });
    }

    // Every detonation POINT — a bolt bursting on empty ground was the most
    // common outcome of a cast and used to emit nothing at all. Scaled by the
    // blast radius, so the picture agrees with the hitbox.
    for (const d of ev.detonations) {
      const col = attackColour(d.element, d.fromHero);
      const near = Math.hypot(d.x - s.hero.x, d.z - s.hero.z) < d.radius + 1.2;
      // A foe's blow landing on or near the hero gets a directional bias —
      // "bitten from THERE" — instead of a neutral sphere.
      let dir: [number, number, number] | null = null;
      if (!d.fromHero && near) {
        const dx = d.x - d.sourceX;
        const dz = d.z - d.sourceZ;
        const l = Math.hypot(dx, dz) || 1;
        dir = [dx / l, 0.4, dz / l];
      }
      particles.emit({
        count: Math.round(8 + d.radius * 8),
        origin: [d.x, heightAt(d.x, d.z) + 0.5, d.z],
        speed: 1.6 + d.radius * 0.6,
        ...(dir ? { direction: dir } : {}),
        spread: dir ? 0.5 : 1,
        color: col,
        lifetime: 0.45,
        size: 0.13,
        gravity: 0.9,
        // Additive blending eats dark colours: an oil burst at the standard
        // intensity is invisible. Oil gets pushed hard enough to read as the
        // brown it is instead of as nothing.
        intensity: d.element === "oil" ? 4.5 : 2.0,
      });
    }

    // A find collected — the world-side half of the grant ceremony (the
    // banner and the arc flash are the entries' halves). A rising column in
    // the element's colour at the spot the gem stood, so the reward happens
    // WHERE the walk earned it. No shake: a pickup is a gift, not a blow.
    for (const p of ev.pickedUp) {
      const col =
        p.kind === "weave" ? FX.colourRestored : (ELEMENT_RGB[p.kind] ?? ELEMENT_RGB.spore!);
      particles.emit({
        count: 42,
        origin: [p.x, heightAt(p.x, p.z) + 1.0, p.z],
        speed: 2.4,
        spread: 1,
        color: [...col],
        lifetime: 0.8,
        size: 0.14,
        gravity: -1.6,
        intensity: 2.8,
      });
    }

    let combo: ComboFlash | null = null;
    for (const h of ev.impacts) {
      const col = ELEMENT_RGB[h.element] ?? ELEMENT_RGB.spore!;
      // The burst scales with what actually LANDED, so a heavy hit visibly
      // outclasses a graze (fourth playtest: "show how much and when enemies
      // take damage"). Round 5 invoked the recorded fallback — floating
      // damage numbers now ride each impact too (SpellHud.spawnDamage, fed
      // by both entries) — and the burst stays: layers, not replacement.
      const heft = Math.min(1, h.damage / 24);
      particles.emit({
        count: Math.round((h.chained ? 22 : 12) + heft * 18),
        origin: [h.x, heightAt(h.x, h.z) + 0.8, h.z],
        speed: 2.2 + heft * 1.2,
        spread: 1,
        color: [...col],
        lifetime: 0.5,
        size: 0.11 + heft * 0.05,
        gravity: 1.6,
        intensity: (h.chained ? 3.0 : 2.0) + heft * 1.2,
      });
      // The hop itself, drawn: without this a chain was two disconnected
      // bursts, and the fourth playtest could not see the jump at all. The
      // LINE is the readable connection (view.chainFlash); the particle run
      // is the shimmer that survives after it fades.
      if (h.chained && h.source) {
        view.chainFlash(h.source.x, h.source.z, h.x, h.z);
        this.chainArc(h.source, h);
      }
      if (h.combo && !combo) combo = { label: h.combo, element: h.element };
    }
    if (combo) shake(0.3); // a success, per §11

    for (const st of ev.statuses) {
      const col = ELEMENT_RGB[statusElement(st.status)] ?? ELEMENT_RGB.spore!;
      particles.emit({
        count: 10,
        origin: [st.x, heightAt(st.x, st.z) + 1.0, st.z],
        speed: 1.1,
        spread: 0.9,
        color: [...col],
        lifetime: 0.7,
        size: 0.09,
        gravity: -0.4,
        intensity: 1.8,
      });
    }

    for (const p of ev.patches) {
      if (!p.ignited) continue;
      // Ignition is a moment. It is the discovery every player makes first and
      // it should be the loudest non-lethal thing in the game.
      shake(0.45);
      particles.emit({
        count: 60,
        origin: [p.x, heightAt(p.x, p.z) + 0.2, p.z],
        speed: 3.4,
        spread: 1,
        color: [...FX.burning],
        lifetime: 0.8,
        size: 0.24,
        gravity: -1.8,
        intensity: 3.4,
      });
    }

    for (const d of ev.deaths) {
      shake(0.35); // the player's success
      particles.emit({
        count: 44,
        origin: [d.x, heightAt(d.x, d.z) + 0.8, d.z],
        speed: 2.8,
        spread: 1,
        color: [...FX.rotSpore],
        lifetime: 0.9,
        size: 0.14,
        gravity: 1.1,
        intensity: 2.6,
      });
    }

    // THE ARRIVAL (R5, the Dry Gulch's conditional reinforcement) — and it is
    // authored as the KILL BEAT RUN BACKWARDS, on purpose.
    //
    // fun's binding condition is that an arrival must read as *"the pack is not
    // shrinking"* and never as *"the game is adding enemies"* — the one way the
    // mechanic fails even when the rule underneath it is right. The player has
    // already been taught the opposite sentence forty times by then: a kill is
    // rot-spore blooming OUTWARD and settling (`ev.deaths`, gravity positive).
    // So an arrival is the same spores, the same colour, converging INWARD and
    // rising. No new vocabulary, and the grammar itself says *the grey is
    // putting one back* rather than *here is another enemy*.
    //
    // Built for PERIPHERAL vision, because mech's stated failure mode is the
    // player's attention being committed to a twelve-body brawl in the middle
    // of the frame. Peripheral vision reads MOTION and VALUE, not hue or
    // detail — so the cue is a wide, fast, radial convergence rather than a
    // small puff, and it runs at high intensity against the gulch's bright dry
    // ground. A quiet cue at the rim is a cue nobody sees.
    //
    // **No shake, deliberately.** An arrival is something happening TO the
    // player, which §11 permits — but every entry in that table is an IMPACT
    // (a hit, a kill, a combo, an ignition, a slam), and up to eight arrivals
    // in one fight would rumble the screen eight times while saying "something
    // hit you" when nothing did. game1's lesson is that shake spent on
    // non-impacts stops meaning impact.
    for (const r of ev.reinforced) {
      const y = heightAt(r.x, r.z);
      // The gather: eight short runs on a ring, each aimed at the centre.
      // `spread` near zero keeps them directional, and a high `drag` makes them
      // ARRIVE and stop rather than fly through — convergence, not an implosion.
      // The radius V12 requires to be in frame, imported rather than copied:
      // the rule inspects the cue the renderer draws, and a 2.5 m rule checking
      // a 4 m ring would be auditing a cue nobody sees.
      const RING = ARRIVAL_CUE_RADIUS;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        particles.emit({
          count: 5,
          origin: [r.x + Math.cos(a) * RING, y + 0.5, r.z + Math.sin(a) * RING],
          direction: [-Math.cos(a), 0.12, -Math.sin(a)],
          spread: 0.14,
          speed: 3.6,
          speedJitter: 0.22,
          color: [...FX.rotSpore],
          lifetime: 0.85,
          lifetimeJitter: 0.2,
          size: 0.17,
          gravity: -0.5,
          drag: 2.8,
          intensity: 1.9,
        });
      }
      // The body rising through the gather — the second beat, and the one that
      // ties the cue to the thing that arrived instead of leaving it a flourish
      // on empty ground.
      particles.emit({
        count: 18,
        origin: [r.x, y + 0.2, r.z],
        direction: [0, 1, 0],
        spread: 0.5,
        speed: 1.15,
        color: [...FX.rotSpore],
        lifetime: 0.95,
        size: 0.22,
        gravity: -0.9,
        intensity: 2.0,
      });
    }

    // Damage TO the player. The clearest case in §11's rule.
    if (ev.heroDamage > 0) shake(Math.min(0.9, 0.25 + ev.heroDamage * 0.03));
    if (ev.bystanderDown.length > 0) shake(0.25);

    // The boss phase turn (R4): a boss beat happening TO the player — the
    // "boss slam" family in §8's shake table, held BELOW a slam because the
    // real escalation is carried by state the player reads for the rest of
    // the fight (the crest flare, the douser walks, the adds). One burst in
    // the boss's own two colours: rot-violet body, water off the sodden
    // hide — no new vocabulary.
    if (ev.bossPhase) {
      const b = ev.bossPhase;
      shake(0.4);
      const y = heightAt(b.x, b.z);
      particles.emit({
        count: 30,
        origin: [b.x, y + 1.4, b.z],
        speed: 3.0,
        spread: 1,
        color: [...FX.rotSpore],
        lifetime: 0.7,
        size: 0.16,
        gravity: 0.6,
        intensity: 2.8,
      });
      particles.emit({
        count: 22,
        origin: [b.x, y + 1.2, b.z],
        speed: 2.4,
        spread: 0.8,
        color: [...FX.wet],
        lifetime: 0.6,
        size: 0.14,
        gravity: 2.2, // water sheds DOWN off the hide
        intensity: 2.4,
      });
    }

    // The sodden coat's two EDGES (R4 — fun's binding watch-item: an unseen
    // re-soak is an invisible heal), driven by the SIM'S OWN EVENTS, never a
    // render-side state edge. The distinction is load-bearing: mech's
    // contract keeps a fire-strip beside DARK bowls deliberately silent
    // (that is a 1.5 s micro-window, and a loud cue there would teach the
    // real dry-window announcement to lie) — a state-edge detector cannot
    // tell the two apart, and the first cut of this block shouted on both.
    if (ev.bossDried) {
      // DRY WINDOW OPENS — the loud edge, three channels: this steam plume,
      // the dog-shake torso wiggle (the view owns the puppet), and the
      // standing matte-pale coat rt-view holds for the window's whole
      // length. No shake(): the window recurs all fight; screen shake stays
      // with the slam (§11). Plume, not shroud, tuned in two passes: the
      // first cut (size 0.2, speed 0.8, cool grey) dwelt on the silhouette
      // and washed the body pale BLUE — Frozen's read, a §6 lie. From the
      // diorama's high angle a rising plume always crosses the body in
      // screen space, so the veil itself must be unable to say ice:
      // FX.steam is warm-neutral, the cone wide, the count thin.
      const b = ev.bossDried;
      view.bossDryShake(b.id);
      particles.emit({
        count: 18,
        origin: [b.x, heightAt(b.x, b.z) + 1.7, b.z],
        speed: 1.1,
        direction: [0, 1, 0],
        spread: 0.8,
        color: [...FX.steam],
        lifetime: 1.0,
        size: 0.13,
        gravity: -1.3, // steam rises and clears — fire's hard rise is -2.2
        intensity: 1.0, // vapor is matter leaving, not energy arriving
      });
    }
    if (ev.bossSoaked?.resoaked) {
      // RE-SOAK — the window closes (or the born-sodden coat wraps on at
      // spawn — the sim includes that first application on purpose; it is
      // the establishing beat): water sheets DOWN the hide, the exact
      // inverse of the steam (down vs up, wet-teal vs pale grey). The
      // bossPhase burst's water grammar, reused — no new vocabulary. The
      // HEAL half of every bossSoaked beat is entry-side: the boss bar
      // pulses cyan in the HUD (main.ts), so no healed point is invisible.
      const b = ev.bossSoaked;
      particles.emit({
        count: 20,
        origin: [b.x, heightAt(b.x, b.z) + 2.0, b.z],
        speed: 1.6,
        spread: 0.75,
        color: [...FX.wet],
        lifetime: 0.6,
        size: 0.14,
        gravity: 2.4, // sheds DOWN off the hide
        intensity: 2.0,
      });
    }

    return combo;
  }

  /**
   * A chain hop, drawn: a jagged run of sparks from the body the chain left
   * to the body it found, lifted through chest height so it reads as a leap
   * rather than a ground trail. Shocked white-blue only — the status colour
   * vocabulary is a promise (ART_DIRECTION §6). Presentation-side jitter is
   * fine here; nothing below the render layer sees it.
   */
  private chainArc(from: { x: number; z: number }, to: { x: number; z: number }): void {
    const { particles, heightAt } = this.ctx;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    // Dense and slow-moving: the points have to HOLD the line long enough to
    // read as one — a sparse fast-scattering run read as unrelated sparkles
    // at 1280×800, never as a jump.
    const steps = Math.max(6, Math.round(d * 4));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const jag = (Math.random() - 0.5) * 0.26;
      const px = from.x + dx * t + (-dz / d) * jag;
      const pz = from.z + dz * t + (dx / d) * jag;
      const lift = 1.0 + Math.sin(t * Math.PI) * 0.5;
      particles.emit({
        count: 4,
        origin: [px, heightAt(px, pz) + lift, pz],
        speed: 0.25,
        spread: 0.35,
        color: [...FX.shocked],
        lifetime: 0.4,
        size: 0.14,
        gravity: -0.2,
        intensity: 3.4,
      });
    }
  }

  /**
   * The continuous effects, called once per rendered frame: every bolt trails
   * its element's shape (fire rises, water drips, a foe's attack sheds
   * Greyrot spores), fire patches breathe, and a rooted caster's hands glow
   * with what they are holding. All state-driven — correct on a replay, after
   * a reload, and under `step()`.
   */
  update(dt: number, s: RtState): void {
    const { particles, view, heightAt } = this.ctx;

    /* -------------------------------------------------------- bolt trails */
    for (const b of view.bolts()) {
      const fx = b.fromHero
        ? (ELEMENT_FX[b.element as keyof typeof ELEMENT_FX] ?? ELEMENT_FX.spore)
        : FOE_TRAIL;
      // Stochastic emission: rate·dt is well under 1 per frame, so a coin
      // flip per bolt per frame gives the right average without per-bolt
      // accumulator state (bolts have no stable identity frame to frame).
      if (Math.random() < fx.trailRate * dt) {
        particles.emit({
          count: 1,
          origin: [b.x, b.y, b.z],
          speed: 0.35,
          spread: 1,
          color: attackColour(b.element, b.fromHero),
          lifetime: fx.trailLifetime,
          size: fx.trailSize,
          gravity: fx.trailGravity,
          intensity: 1.6,
        });
      }
    }

    /* ------------------------------------------------------- charge glow */
    // While the root holds, the gathered hands glow with the committed mix —
    // the visible cost of standing still. Reads off `hero.casting`, never a
    // stored event.
    if (s.hero.casting) {
      this.chargeAcc += dt;
      if (this.chargeAcc >= 0.05) {
        this.chargeAcc = 0;
        const h = s.hero;
        const hx = h.x + h.fx * 0.45;
        const hz = h.z + h.fz * 0.45;
        for (const e of s.hero.casting.elements) {
          particles.emit({
            count: 1,
            origin: [hx, heightAt(hx, hz) + 0.95, hz],
            speed: 0.5,
            spread: 1,
            color: ELEMENT_RGB[e] ?? ELEMENT_RGB.spore!,
            lifetime: 0.3,
            size: 0.1,
            gravity: -0.8,
            intensity: 2.4,
          });
        }
      }
    }

    /* ------------------------------------------------------ sodden drips */
    // A wet boss coat DRIPS — sparse FX.wet droplets (§6's Wet shape:
    // falling, short life) at ~2.5/s, whose SILENCE during the dry window
    // is the quiet half of the coat tell. Budget noise against the 1,000
    // Low-tier floor.
    this.dripAcc += dt;
    if (this.dripAcc >= 0.4) {
      this.dripAcc = 0;
      for (const f of s.foes) {
        if (f.hp <= 0 || !foeKind(f.kindId).boss) continue;
        if (!f.statuses.some((st) => st.id === "wet")) continue;
        const a = Math.random() * Math.PI * 2;
        const rr = 0.55 + Math.random() * 0.35;
        particles.emit({
          count: 1,
          origin: [f.x + Math.cos(a) * rr, heightAt(f.x, f.z) + 1.6, f.z + Math.sin(a) * rr],
          speed: 0.1,
          spread: 1,
          color: [...FX.wet],
          lifetime: 0.5,
          size: 0.12,
          gravity: 3.2, // a falling droplet, nothing else
          intensity: 1.6,
        });
      }
    }

    /* ---------------------------------------------------- fire breathing */
    // Fire patches breathe. Emitted here rather than in the sim because it is
    // purely presentation — the patch's gameplay effect is in field.ts.
    this.fireAcc += dt;
    if (this.fireAcc >= 0.08) {
      this.fireAcc = 0;
      for (const f of view.fireEmitters(s)) {
        const n = Math.min(6, Math.max(2, Math.round(f.r * 2)));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + s.tick * 0.11;
          particles.emit({
            count: 2,
            origin: [f.x + Math.cos(a) * f.r * 0.7, f.y + 0.15, f.z + Math.sin(a) * f.r * 0.7],
            speed: 1.5,
            direction: [0, 1, 0],
            spread: 0.4,
            color: [...FX.burning],
            lifetime: 0.7,
            size: 0.26,
            gravity: -2.2, // fire rises, hard
            intensity: 3.0,
          });
        }
      }
    }
  }
}
