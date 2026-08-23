/**
 * Presentation for the real-time sim.
 *
 * Reads `RtState` and never writes to it (`CLAUDE.md` §4). Owns the puppets,
 * the ground patches and the projectiles; particles, shake and audio stay with
 * the caller, which owns those systems.
 *
 * ## The field is the thing to get right
 *
 * A patch of burning oil has to read as *dangerous ground* at 800×450, from a
 * fixed 3/4 angle, on a Chromebook. So patches are flat translucent discs —
 * eight triangles each, one shared geometry, pooled and reused — with the
 * colour vocabulary from `art.ts` and an opacity that falls as they age. Fire
 * additionally seeds the particle system, which is where the actual heat
 * comes from. No decals, no render targets, no second pass.
 */

import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Color,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  SphereGeometry,
  type Scene,
} from "three";
import { foeKind, type PatchKind } from "../content";
import type { FieldPatch } from "../sim/rt/field";
import type { RtState } from "../sim/rt/state";
import { DOWN_TICKS } from "../sim/constants";
import { TICK_HZ } from "../sim/tick";
import { ELEMENT_COLOUR, ELEMENT_FX, FX, WORLD } from "./art";
import type { Rig } from "./chars/humanoid";
import { Puppet, partGeometry } from "./chars/puppet";
import { FOE_RIGS, PIM_PALETTE, SELLA_PALETTE, sporelingRig } from "./chars/sporeling";
import { srgbToLinear } from "./mesh/dsl";

/**
 * Patch colours, from the one fx vocabulary. Never invent a colour here.
 *
 * Authored in sRGB like everything else in `art.ts`, and converted to linear
 * at THIS boundary — the renderer's working space is linear and passing
 * authored values straight to `Color.setRGB` washes them out. The first pass
 * did exactly that and every patch rendered the same pale yellow: an oil slick
 * and a fire were indistinguishable, which for a game about setting oil on
 * fire is the whole mechanic invisible.
 */
const PATCH_COLOUR: Record<PatchKind, [number, number, number]> = {
  water: [...FX.wet],
  fire: [...FX.burning],
  // Near-black and glossy. Oil must read as a hazard you can SEE you are
  // standing in, against warm green ground.
  oil: [0.06, 0.05, 0.045],
  ice: [...FX.frozen],
};

/**
 * Opacity per kind, and it carries meaning: oil is nearly opaque because it is
 * the one you must notice before you light it; water is a wash. Ice sits
 * between (R2): it costs you your footing, so it must read as a THING you
 * are standing on, not weather — and against the water wash, opacity is one
 * of the three channels (shape, edge, luminance) that survive the 0.78
 * fight-drain grade, where hue does not.
 */
const PATCH_OPACITY: Record<PatchKind, number> = {
  water: 0.5,
  fire: 0.7,
  oil: 0.88,
  ice: 0.62,
};

/**
 * The ice pane (R2). Water and ice were both soft 22-gon discs in
 * neighbouring cold hues — at 800×450 under the drained fight grade the
 * pair was a coin flip, and the whole point of the Rimecap is that its
 * floor is a hazard the player reads instantly. Ice therefore separates on
 * the channels desaturation cannot touch: a JAGGED nine-wedge pane instead
 * of a smooth circle, and flat per-facet luminance steps instead of one
 * uniform fill. Facet shades multiply `PATCH_COLOUR.ice` through the
 * vertex-colour path, so the §6 vocabulary is untouched — same frozen
 * pale-blue, crystalline form. Puddle vs pane, in silhouette terms.
 *
 * Authored tables, not random: the pane must be identical every build for
 * the mesh/capture regression story, and per-patch variety comes from a
 * stable spin seeded off the patch position in `updatePatches`.
 */
const ICE_RIM: [number, number][] = [
  // [angle jitter (rad), outer radius] per wedge corner, 9 wedges.
  [0.04, 1.0],
  [-0.06, 0.68],
  [0.05, 0.94],
  [0.0, 0.63],
  [-0.04, 1.0],
  [0.06, 0.7],
  [-0.05, 0.9],
  [0.03, 0.66],
  [0.0, 0.97],
];
const ICE_FACETS = [1.12, 0.82, 1.0, 0.76, 1.08, 0.88, 1.15, 0.8, 0.95];

function buildIcePane(): BufferGeometry {
  const n = ICE_RIM.length;
  const pos: number[] = [];
  const col: number[] = [];
  for (let i = 0; i < n; i++) {
    const [ja, ra] = ICE_RIM[i]!;
    const [jb, rb] = ICE_RIM[(i + 1) % n]!;
    const a = (i / n) * Math.PI * 2 + ja;
    const b = (((i + 1) % n) / n) * Math.PI * 2 + jb + (i + 1 === n ? Math.PI * 2 : 0);
    // Fan wedge: centre, rim a, rim b — non-indexed so each facet holds one
    // flat shade (an indexed fan would gouraud the steps away).
    pos.push(0, 0, 0, Math.cos(a) * ra, Math.sin(a) * ra, 0, Math.cos(b) * rb, Math.sin(b) * rb, 0);
    const f = ICE_FACETS[i]!;
    for (let v = 0; v < 3; v++) col.push(f, f, f);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  return geo;
}

/** A unit-colour attribute so one vertexColors material serves the smooth
 * disc and the faceted pane alike (a missing colour attribute under
 * `vertexColors: true` is a shader error, not a no-op). */
function withWhiteColors(geo: CircleGeometry): CircleGeometry {
  const count = geo.getAttribute("position").count;
  geo.setAttribute("color", new BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  return geo;
}

/** Set a material colour from an authored sRGB triple. */
function setSrgb(target: Color, c: readonly [number, number, number]): void {
  target.setRGB(srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2]));
}

interface FoeEntry {
  puppet: Puppet;
  material: MeshStandardMaterial;
  lastHp: number;
  hitFlash: number;
  /** Last tick's windup, so the windup→0 edge can fire the release whip. */
  lastWindup: number;
  /** Seconds left on the boss's dry-off SHAKE (the dog-shake torso wiggle). */
  dryShake?: number;
}

/** One bolt's presentation-space pose, for trail emission by the caller. */
export interface BoltVis {
  x: number;
  y: number;
  z: number;
  element: string;
  fromHero: boolean;
}

/** One tick's worth of the presentation-relevant fields of a body. */
interface Snap {
  x: number;
  z: number;
  fx: number;
  fz: number;
  speed: number;
}

/**
 * Anything with a position that moves between ticks.
 *
 * Facing is optional because projectiles do not have one — they still need
 * interpolating (a bolt covers ~0.47 m per tick) but there is nothing to turn.
 */
interface Lerpable {
  x: number;
  z: number;
  vx: number;
  vz: number;
  fx?: number;
  fz?: number;
}

/** The id `victims()` gives the hero. Foes, bystanders and bolts take `nextId`. */
const HERO_ID = 0;

/** Ticks the hero takes to tip over once down. 0.4 s — a fall, not a wilt. */
const DOWN_FALL_TICKS = 12;

/** Ring resolution. Enough that it reads as a circle on the graded road. */
const LOCK_SEGMENTS = 64;
/** Seconds a chain flash holds. Short — a strike, not a beam. */
const CHAIN_FLASH_S = 0.3;
/** Points per chain flash line. Enough jag to read as lightning at 40 px. */
const CHAIN_FLASH_PTS = 9;

export class RtView {
  private scene: Scene;
  private heightAt: (x: number, z: number) => number;

  readonly hero: Puppet;
  private heroMat: MeshStandardMaterial;
  private foes = new Map<number, FoeEntry>();
  private bystanders = new Map<number, { puppet: Puppet; material: MeshStandardMaterial }>();

  /** Pooled patch discs, grown on demand and hidden rather than destroyed. */
  private patchPool: Mesh[] = [];
  private patchGeo = withWhiteColors(new CircleGeometry(1, 22));
  /** The faceted pane ice swaps in — see `buildIcePane`. */
  private iceGeo = buildIcePane();
  /** The arena-lock ring. One line, built on first use, hidden when unlocked. */
  private lockRing: Line;
  /**
   * Live chain flashes — the Wet+Lightning hop drawn as a jagged line pair,
   * fading over CHAIN_FLASH_S. Particles alone read as unrelated sparkles at
   * 1280×800 (fourth playtest: the jump was invisible); a LINE is the only
   * primitive that reads as a connection at every viewport.
   */
  private chainBolts: { line: Line; mat: LineBasicMaterial; ttl: number }[] = [];
  /** The stage gate: two waymarker posts and their lanterns. Built once. */
  private gate: Group | null = null;
  /** Crossed gates keep their posts — see `updateSpentGates`. */
  private spentGates = new Map<number, Group>();
  private spentWood: MeshStandardMaterial | null = null;
  private gateLanterns: MeshStandardMaterial | null = null;
  private gatePillar: Mesh | null = null;
  private gateAt = -1;

  /** The finds standing on the road. Built once per pickup, hidden when taken. */
  private pickups = new Map<
    number,
    { group: Group; orb: Mesh; orbMat: MeshStandardMaterial; pillar: Mesh }
  >();
  private pickupOrbGeo: OctahedronGeometry | null = null;
  private pickupPillarGeo: CylinderGeometry | null = null;
  /** Pooled projectile beads. */
  private boltPool: Mesh[] = [];
  private boltGeo = new SphereGeometry(0.16, 8, 6);

  /**
   * Interpolation between sim ticks — `CLAUDE.md` §4's "rendering interpolates".
   *
   * The sim runs at 30 Hz and the screen does not, so drawing bodies at the
   * last tick's position gives four identical frames and then a 33 ms jump at
   * 144 Hz. Held HERE rather than in the caller on purpose: this class already
   * tracks per-entity presentation state, entities appear and vanish mid-frame,
   * and a scheme that needs every caller to remember a `capture()` call before
   * every `rtStep` is a scheme that will be forgotten in one of the two
   * entries. `RtState.tick` is the oracle for "a tick landed" — no wall clock,
   * no caller cooperation.
   */
  private lastTick = -1;
  private prev = new Map<number, Snap>();
  private cur = new Map<number, Snap>();

  /** Hero HP last frame, to fire the recoil pose on a drop. */
  private lastHeroHp = Infinity;
  /** Presentation clock for the foe-bolt pulse. Never seen by the sim. */
  private fxTime = 0;
  /** Pooled entries behind `bolts()` — grown on demand, never discarded. */
  private boltVisPool: BoltVis[] = [];
  /** Reused output of `bolts()` — refs into the pool, resized per frame. */
  private boltVisOut: BoltVis[] = [];
  private boltVisCount = 0;


  constructor(scene: Scene, heightAt: (x: number, z: number) => number) {
    this.scene = scene;
    this.heightAt = heightAt;

    this.heroMat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
      metalness: 0,
    });
    // Blaze on: the cap-front wedge that makes the dome a compass (the cue
    // renders the sim's commanded facing and nothing else — the whole puppet
    // already turns with `hero.fx/fz`; the blaze just makes that turn READ
    // through a rotationally symmetric silhouette).
    this.hero = new Puppet(sporelingRig({ palette: PIM_PALETTE, blaze: true }), this.heroMat);
    // A sporeling whose cap does not trail behind its head reads as dead.
    this.hero.setSecondary(["cap"]);
    scene.add(this.hero.group);

    // Prewarm every foe kind NOW, behind the loading ring. Two halves, both
    // measured off the perf gate's worst frame (the first fight's spawn):
    // the rigs and their geometry conversion (see `kindRig`), and one hidden
    // puppet per kind so a boot-time `renderer.compile` can build each foe
    // material's shader PROGRAM before any fight asks for it mid-frame.
    // The pool is permanent and invisible — zero draws, a handful of small
    // meshes — because removing it would let a disposal path someday free
    // the shared programs it exists to keep warm.
    for (const kindId of Object.keys(FOE_RIGS)) {
      const spec = FOE_RIGS[kindId]!;
      for (const part of this.kindRig(kindId).parts) partGeometry(part.mesh);
      const warm = new Puppet(
        this.kindRig(kindId),
        new MeshStandardMaterial({ vertexColors: true, roughness: spec.roughness, metalness: 0 }),
      );
      warm.group.visible = false;
      this.scene.add(warm.group);
    }
    // Same reasoning, one more lazy material: the arena lock ring.
    this.lockRing = this.buildLockRing();
  }

  /* ------------------------------------------------------------- puppets */

  /**
   * Per-kind rig cache. One rig object per kind, shared by every live puppet
   * of it — Puppet's geometry cache keys off the rig's mesh objects, so the
   * expensive DSL→geometry conversion happens once per kind (at prewarm,
   * behind the loading ring) instead of once per SPAWN. Before this, the
   * first fight's spawn regenerated two whole rigs in one frame and was the
   * worst frame the perf gate could find (~180 ms at 4× throttle).
   */
  private kindRigs = new Map<string, Rig>();

  private kindRig(kindId: string): Rig {
    let rig = this.kindRigs.get(kindId);
    if (!rig) {
      // One rig, five silhouettes, from the ONE table (`FOE_RIGS`). An
      // unknown kind falls back to the rotling ON PURPOSE: a missing row
      // must degrade to a legible body, never to a crash or an invisible foe.
      rig = (FOE_RIGS[kindId] ?? FOE_RIGS["rotling"]!).rig();
      this.kindRigs.set(kindId, rig);
    }
    return rig;
  }

  private foeEntry(id: number, kindId: string, hp: number): FoeEntry {
    let e = this.foes.get(id);
    if (e) return e;
    const spec = FOE_RIGS[kindId] ?? FOE_RIGS["rotling"]!;
    const material = new MeshStandardMaterial({
      vertexColors: true,
      roughness: spec.roughness,
      metalness: 0,
    });
    const puppet = new Puppet(this.kindRig(kindId), material);
    puppet.setSecondary(["cap"]);
    this.scene.add(puppet.group);
    // `lastHp` seeds from the CURRENT hp, not Infinity: seeded at Infinity,
    // every foe's first frame read as "hp dropped" and fired the full
    // hit-flash + flinch on spawn — a false "just got hurt" signal §11
    // forbids, and the reason every foe-identity capture since the
    // five-kind era rendered the lineup washed white (R2 find).
    e = { puppet, material, lastHp: hp, hitFlash: 0, lastWindup: 0 };
    this.foes.set(id, e);
    return e;
  }

  /** Snapshot every body's presentation pose into `into`. */
  private snapshot(s: RtState, into: Map<number, Snap>): void {
    const put = (id: number, b: Lerpable): void => {
      into.set(id, {
        x: b.x,
        z: b.z,
        fx: b.fx ?? 0,
        fz: b.fz ?? 1,
        speed: Math.hypot(b.vx, b.vz) * TICK_HZ,
      });
    };
    put(HERO_ID, s.hero);
    for (const f of s.foes) put(f.id, f);
    for (const b of s.bystanders) put(b.id, b);
    for (const p of s.projectiles) put(p.id, p);
  }

  /**
   * Interpolated pose for one body.
   *
   * FIRST-SEEN CASE: a foe that spawned this tick, or a bolt launched this
   * tick, has no previous pose — there is nothing to come from. Snapping to
   * the live pose is right; interpolating from a missing entry would slide the
   * body in from the world origin, or worse, from whatever body last held that
   * id. Entries are dropped in the same pass that disposes the puppet, so a
   * recycled id cannot inherit a stale pose.
   */
  private lerpBody(
    id: number,
    b: Lerpable,
    alpha: number,
  ): Snap {
    const c = this.cur.get(id);
    const p = this.prev.get(id);
    if (!c || !p) {
      return {
        x: b.x,
        z: b.z,
        fx: b.fx ?? 0,
        fz: b.fz ?? 1,
        speed: Math.hypot(b.vx, b.vz) * TICK_HZ,
      };
    }
    let fx = p.fx + (c.fx - p.fx) * alpha;
    let fz = p.fz + (c.fz - p.fz) * alpha;
    // Lerping two unit vectors shortens the result; renormalise or the puppet
    // squashes as it turns.
    const l = Math.hypot(fx, fz) || 1;
    fx /= l;
    fz /= l;
    return {
      x: p.x + (c.x - p.x) * alpha,
      z: p.z + (c.z - p.z) * alpha,
      fx,
      fz,
      speed: p.speed + (c.speed - p.speed) * alpha,
    };
  }

  update(dt: number, s: RtState, alpha: number): void {
    this.fxTime += dt;
    this.updateChainBolts(dt);
    /* ------------------------------------------------- tick bookkeeping */
    const jumped = s.tick - this.lastTick;
    if (jumped !== 0) {
      // What was current is now the previous tick, and the live state is the
      // new current. Buffers are swapped rather than reallocated.
      const swap = this.prev;
      this.prev = this.cur;
      this.cur = swap;
      this.cur.clear();
      this.snapshot(s, this.cur);
      // More than one tick since the last frame means the loop caught up
      // several at once — a stall, an ad, a tab return. There is no previous
      // tick we ever drew, so SNAP rather than smearing several ticks of
      // motion across one frame at a fraction of the real speed.
      if (jumped !== 1) {
        this.prev.clear();
        for (const [k, v] of this.cur) this.prev.set(k, v);
      }
      this.lastTick = s.tick;
    }

    /* ------------------------------------------------------------- hero */
    const h = s.hero;
    const q = this.lerpBody(HERO_ID, h, alpha);
    // Ground sampled at the INTERPOLATED position — sampling at the tick
    // position instead makes the hero visibly bob on a slope.
    const hg = this.heightAt(q.x, q.z);
    // The hero's body answers a hit the way a foe's does. The recoil pose
    // existed from day one and was unreachable for the hero — foes flinched
    // when bitten, the player character did not, which read as the game not
    // registering the hit.
    if (h.hp < this.lastHeroHp) this.hero.hit();
    this.lastHeroHp = h.hp;
    // The ice skid (R2, fun's "slip must be visible ON the hero"): standing
    // on ice while moving feeds the puppet an inflated stride speed, so the
    // legs scramble faster than the ground passes — the cartoon ice-run.
    // Presentation-only re-derivation of the same containment question the
    // sim already billed; no sim state is touched and stillness stays still.
    let strideSpeed = q.speed;
    if (q.speed > 0.1) {
      for (const p of s.patches) {
        if (p.kind !== "ice") continue;
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        if (dx * dx + dz * dz <= p.r * p.r) {
          strideSpeed = q.speed * 1.7;
          break;
        }
      }
    }
    this.hero.update(dt, q.x, q.z, hg, q.fx, q.fz, strideSpeed);

    // DOWN. Without this the defeat panel opens over a hero standing bolt
    // upright in the middle of the road, which reads as a UI bug rather than as
    // a death — and §11's whole point is that the player must be able to SEE
    // what happened to them. Tipped over rather than animated: the rig has no
    // death clip, and a body on its side at 800×450 is unambiguous.
    //
    // Presentation only. The sim already knows the hero is out; this never
    // writes back, and the pose is derived from `downTicks` alone so it is
    // correct on a replay and after a reload.
    // `downTicks` counts DOWN from DOWN_TICKS, so time-since-falling is the
    // complement. Getting that backwards leaves the hero standing for five
    // seconds and then tipping over exactly as they are declared dead.
    const out = h.downTicks > 0 || h.defeated;
    const sinceDown = h.defeated ? DOWN_TICKS : DOWN_TICKS - h.downTicks;
    const fallen = out ? Math.min(1, sinceDown / DOWN_FALL_TICKS) : 0;
    this.hero.group.rotation.z = fallen * Math.PI * 0.46;
    this.hero.group.position.y = hg - fallen * 0.12;

    /* ------------------------------------------------------------- foes */
    const seen = new Set<number>();
    for (const f of s.foes) {
      seen.add(f.id);
      const e = this.foeEntry(f.id, f.kindId, f.hp);
      if (f.hp < e.lastHp) {
        e.hitFlash = 1;
        e.puppet.hit();
      }
      e.lastHp = f.hp;
      const fq = this.lerpBody(f.id, f, alpha);

      // The attack ANIMATION — the playtest's "when oil attacks it should
      // have an oil animation" was half about colour and half about this:
      // foes never moved when they struck. The windup draws the arms back
      // (positive x carries a limb BEHIND, per the rig convention), eased by
      // progress² so the pose peaks just before the blow; the windup→0 edge
      // fires the release whip — the bite or the spit is the same swing the
      // hero's melee uses. State-driven, so it replays and survives a reload.
      if (f.windup > 0) {
        const total = foeKind(f.kindId).windupTicks;
        const k = 1 - f.windup / Math.max(1, total);
        const e2 = k * k;
        e.puppet.setOverlay({
          armLX: 1.05 * e2,
          armRX: 1.05 * e2,
          foreLX: -0.35 * e2,
          foreRX: -0.35 * e2,
          torsoTwist: 0,
        });
      } else if (e.lastWindup > 0) {
        e.puppet.setOverlay(null);
        e.puppet.attack();
      }
      e.lastWindup = f.windup;

      e.puppet.update(dt, fq.x, fq.z, this.heightAt(fq.x, fq.z), fq.fx, fq.fz, fq.speed);

      // The Sodden Thornback's state reads (R4) — all renders of existing
      // sim state, nothing invented:
      //  - the COAT: Wet = the sodden glisten (roughness 0.35) at the
      //    authored value; a dried window (lit braziers pausing its
      //    re-wet) eases to the family's matte 0.8 AND lifts value ×1.22.
      //    The fight's whole mechanism, worn on the hide.
      //  - the PHASE: the crest flares at the turn — the one silhouette
      //    change per phase, eased so nothing snaps (ART_DIRECTION §5).
      if (f.kindId === "thornback") {
        const wet = f.statuses.some((st) => st.id === "wet");
        // THE SHAKE-OFF (the dry window's loudest cue): a ~0.45 s dog-shake
        // torso wiggle, triggered by `bossDryShake` when rt-event-fx sees
        // ev.bossDried — never a render-side wet edge, because the sim
        // keeps a fire-strip beside dark bowls deliberately quiet and a
        // state edge cannot tell the two apart. This arena's backdrop is
        // bright WATER, so any pale particle plume dies against it —
        // silhouette MOTION is the one channel that reads against every
        // backdrop. The windup pose owns the overlay while a telegraph
        // runs; the shake waits its turn rather than fight the pose the
        // player must read.
        if ((e.dryShake ?? 0) > 0 && f.windup <= 0) {
          e.dryShake = (e.dryShake ?? 0) - dt;
          const k = Math.max(0, e.dryShake) / 0.45;
          e.puppet.setOverlay({ torsoTwist: Math.sin(e.dryShake * 42) * 0.38 * k });
          if ((e.dryShake ?? 0) <= 0) e.puppet.setOverlay(null);
        }
        const target = wet ? 0.35 : 0.8;
        e.material.roughness += (target - e.material.roughness) * Math.min(1, dt * 6);
        // The dried window is a VALUE state, not just a material state
        // (R4, fun's binding watch-item): roughness glisten vanishes at
        // 800×450, a value lift does not. The authored palette IS the
        // sodden boss (×1.0 — the resting look stays byte-identical); the
        // dry window lifts the coat WARM-pale (×1.50, 1.44, 1.34) — dried
        // ash in sun, cap landing at ~0.45 value, paler than every roster
        // cap. Two tuning scars live in these numbers: (1) warm, because
        // a uniform grey lift on the B-max violet under the cool hemi
        // fill rendered the dried boss pale BLUE — Frozen's read, a §6
        // lie; (2) THIS loud, because a polite ×1.22 was invisible next
        // to the water-windup telegraph's own emissive wash — the first
        // capture round read the telegraph as the lift and shipped a
        // no-op. Cap sat lands at 0.104, under §2.2's 0.12 ceiling, and
        // the darkest-in-family identity returns with the re-soak. The
        // steam-off/sheet bursts that ANNOUNCE the edges live in
        // rt-event-fx; this holds the fact for the whole window.
        const ease = Math.min(1, dt * 6);
        const c = e.material.color;
        const [tr, tg, tb] = wet ? [1, 1, 1] : [1.5, 1.44, 1.34];
        c.setRGB(c.r + (tr - c.r) * ease, c.g + (tg - c.g) * ease, c.b + (tb - c.b) * ease);
        const crest = e.puppet.joint("crest");
        if (crest) {
          const flare = 1 + 0.45 * (f.phase ?? 0);
          const eased = crest.scale.x + (flare - crest.scale.x) * Math.min(1, dt * 3);
          crest.scale.setScalar(eased);
        }
      }

      // The telegraph, in the attack's own colour (ART_DIRECTION §6): a
      // sopling winds up teal, a seeper oil-brown, a rot bite rot-violet —
      // the same `attackColour` the wind-up particle burst already draws
      // from, mixed toward white for punch. §11 still binds: a wind-up must
      // be readable without erasing the character it belongs to — an earlier
      // build pushed the emissive so hard a Rotling washed to flat amber and
      // stopped reading as a Rotling.
      //
      // "Just got hurt" is a DIFFERENT fact and no longer shares the
      // channel: FX.hitFlash takes precedence during its ~0.2 s decay, then
      // the telegraph tint resumes.
      if (e.hitFlash > 0.01) {
        const h = e.hitFlash;
        e.material.emissive.setRGB(h * FX.hitFlash[0], h * FX.hitFlash[1], h * FX.hitFlash[2]);
      } else if (f.windup > 0) {
        const [ar, ag, ab] = attackColour(foeKind(f.kindId).attackElement, false);
        // Luminance-matched to the retired amber telegraph: the wet teal is
        // twice as bright per unit, and at a flat weight it washed the whole
        // body to white — §11's exact failure. The hue carries the element;
        // the brightness stays where the amber was proven readable — scaled
        // by the kind's windupTint (R4): the match was tuned on ~1 m bodies
        // and the same weight ghosted the 2.15 m thornback.
        const lum = 0.21 * ar + 0.72 * ag + 0.07 * ab;
        const k =
          0.42 *
          Math.min(1.6, 0.36 / Math.max(0.05, lum)) *
          (FOE_RIGS[f.kindId]?.windupTint ?? 1);
        e.material.emissive.setRGB(ar * k, ag * k, ab * k);
      } else {
        e.material.emissive.setRGB(0, 0, 0);
      }
      e.hitFlash = Math.max(0, e.hitFlash - dt * 5);
    }
    for (const [id, e] of this.foes) {
      // Negative ids are marker previews; `updateMarkers` owns their lifetime.
      if (id < 0 || seen.has(id)) continue;
      this.scene.remove(e.puppet.group);
      e.puppet.dispose();
      e.material.dispose();
      this.foes.delete(id);
      this.prev.delete(id);
      this.cur.delete(id);
    }

    /* ------------------------------------------------------- bystanders */
    const seenBy = new Set<number>();
    for (const b of s.bystanders) {
      seenBy.add(b.id);
      let e = this.bystanders.get(b.id);
      if (!e) {
        const material = new MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.8,
          metalness: 0,
        });
        const puppet = new Puppet(
          sporelingRig({ palette: SELLA_PALETTE, build: 0.35, height: 1.12 }),
          material,
        );
        puppet.setSecondary(["cap"]);
        this.scene.add(puppet.group);
        e = { puppet, material };
        this.bystanders.set(b.id, e);
      }
      const bq = this.lerpBody(b.id, b, alpha);
      e.puppet.update(dt, bq.x, bq.z, this.heightAt(bq.x, bq.z), bq.fx, bq.fz, bq.speed);
      // Knocked down: face-planted, and back up in three seconds.
      e.puppet.group.rotation.x = b.down > 0 ? -Math.PI / 2.2 : 0;
    }
    // The foes had a reaping loop and the bystanders did not — a leak, and a
    // ghost Sella left standing the moment anything despawns a bystander.
    for (const [id, e] of this.bystanders) {
      if (seenBy.has(id)) continue;
      this.scene.remove(e.puppet.group);
      e.puppet.dispose();
      e.material.dispose();
      this.bystanders.delete(id);
      this.prev.delete(id);
      this.cur.delete(id);
    }

    this.updateMarkers(s);
    this.updateGate(s);
    this.updateSpentGates(s);
    this.updatePickups(s);
    this.updateLock(s);
    this.updatePatches(s.patches);
    this.updateBolts(s, alpha);
  }

  /**
   * The stage gate: two wooden waymarker posts with lanterns, at the ACTIVE
   * stage's exit.
   *
   * The first playtest's clearest finding was that this point did not exist
   * as a picture: a stage only clears when the hero walks to its exit, and
   * nothing rendered there — so after the last fight the road forward was an
   * invisible coordinate, and the player wandered into the next stage's inert
   * previews instead.
   *
   * Two states, both readable at 800×450:
   * - **Closed** (fights remain): dark posts, unlit lanterns. A landmark.
   * - **Open** (every fight of the active stage won): the lanterns light with
   *   `WORLD.lantern` — the palette's cozy signal, and a glow with a visible
   *   source per the art direction's practicals rule — plus a soft light
   *   pillar so the "go here" reads from across the stage.
   *
   * Presentation only, derived from state every frame. The gate RULE lives in
   * `rtStep`; this is the rule made visible.
   */
  private updateGate(s: RtState): void {
    const stage = s.stages[s.stageIndex];
    if (!stage) {
      if (this.gate) this.gate.visible = false;
      return;
    }
    if (!this.gate) {
      this.gate = new Group();
      const wood = new MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
      setSrgb(wood.color, WORLD.bark);
      this.gateLanterns = new MeshStandardMaterial({ roughness: 0.5, metalness: 0 });
      setSrgb(this.gateLanterns.color, WORLD.lantern);
      const postGeo = new CylinderGeometry(0.09, 0.13, 2.1, 6);
      const lampGeo = new SphereGeometry(0.17, 8, 6);
      for (const side of [-1, 1]) {
        const post = new Mesh(postGeo, wood);
        post.position.set(side * 1.7, 1.05, 0);
        post.rotation.z = side * 0.06; // a hand-planted lean, not a survey line
        post.castShadow = true;
        const lamp = new Mesh(lampGeo, this.gateLanterns);
        lamp.position.set(side * 1.7 + side * -0.12, 2.05, 0);
        this.gate.add(post, lamp);
      }
      // The beacon: a tall soft pillar between the posts. Additive-feeling
      // without an extra light — three lights is the budget and this is not
      // worth one; the emissive lanterns carry the "lit" read up close and the
      // pillar carries it from across the stage.
      const pillarMat = new MeshBasicMaterial({
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      });
      setSrgb(pillarMat.color, WORLD.lantern);
      this.gatePillar = new Mesh(new CylinderGeometry(0.5, 0.9, 7, 10, 1, true), pillarMat);
      this.gatePillar.position.set(0, 3.5, 0);
      this.gatePillar.renderOrder = 3;
      this.gate.add(this.gatePillar);
      this.scene.add(this.gate);
    }
    this.gate.visible = true;
    if (this.gateAt !== s.stageIndex) {
      this.gateAt = s.stageIndex;
      this.gate.position.set(stage.exitX, this.heightAt(stage.exitX, stage.exitZ), stage.exitZ);
    }
    const open = s.markers.every((m) => m.stage !== s.stageIndex || m.cleared);
    if (this.gateLanterns) {
      const g = this.gateLanterns;
      if (open) setSrgb(g.emissive, WORLD.lantern);
      else g.emissive.setRGB(0, 0, 0);
      g.emissiveIntensity = open ? 1.6 : 0;
    }
    if (this.gatePillar) this.gatePillar.visible = open && !stage.cleared;
  }

  /**
   * Crossed gates keep their posts (round 6: the road is one-way now, and an
   * invisible wall on bare road is exactly the §11 failure the corridor and
   * lock-ring comments both call out). Dark posts, no lanterns, no pillar —
   * the silhouette of a gate that is not inviting you anywhere. `newRun`
   * rewinds `stageIndex`, so stale entries are reaped rather than assumed.
   */
  private updateSpentGates(s: RtState): void {
    for (let i = 0; i < s.stageIndex; i++) {
      if (this.spentGates.has(i)) continue;
      const st = s.stages[i];
      if (!st) continue;
      if (!this.spentWood) {
        this.spentWood = new MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
        setSrgb(this.spentWood.color, WORLD.bark);
      }
      const g = new Group();
      const postGeo = new CylinderGeometry(0.09, 0.13, 2.1, 6);
      for (const side of [-1, 1] as const) {
        const post = new Mesh(postGeo, this.spentWood);
        post.position.set(side * 1.7, 1.05, 0);
        post.rotation.z = side * 0.06;
        post.castShadow = true;
        g.add(post);
      }
      g.position.set(st.exitX, this.heightAt(st.exitX, st.exitZ), st.exitZ);
      this.scene.add(g);
      this.spentGates.set(i, g);
    }
    for (const [i, g] of this.spentGates) {
      if (i < s.stageIndex) continue;
      this.scene.remove(g);
      for (const c of g.children) (c as Mesh).geometry.dispose();
      this.spentGates.delete(i);
    }
  }

  /**
   * The finds, standing on the road: a slowly turning gem in the element's
   * colour over a soft light pillar — the gate-lantern idiom, because both
   * mean "walk here" and a player should only have to learn that read once.
   *
   * Two states, both legible at 800×450:
   * - **Waiting** (its stage not yet cleared): the gem alone, dim. A promise
   *   visible from the fight, not yet a beacon — the sim will not collect it
   *   until the gate has opened, so the picture must not say "come now".
   * - **Ready** (stage cleared, not taken): full glow and the pillar.
   *
   * Presentation only, derived from state every frame; `taken` hides the
   * whole thing, and a `newRun` standing the finds back up un-hides it with
   * no extra bookkeeping.
   */
  private updatePickups(s: RtState): void {
    for (const p of s.pickups) {
      let e = this.pickups.get(p.id);
      if (!e) {
        this.pickupOrbGeo ??= new OctahedronGeometry(0.28);
        this.pickupPillarGeo ??= new CylinderGeometry(0.28, 0.5, 5.4, 8, 1, true);
        const rgb =
          p.kind === "weave" ? FX.colourRestored : (ELEMENT_RGB[p.kind] ?? ELEMENT_RGB.spore!);
        const orbMat = new MeshStandardMaterial({ roughness: 0.35, metalness: 0 });
        setSrgb(orbMat.color, rgb);
        setSrgb(orbMat.emissive, rgb);
        const orb = new Mesh(this.pickupOrbGeo, orbMat);
        orb.castShadow = true;
        const pillarMat = new MeshBasicMaterial({
          transparent: true,
          opacity: 0.14,
          depthWrite: false,
        });
        setSrgb(pillarMat.color, rgb);
        const pillar = new Mesh(this.pickupPillarGeo, pillarMat);
        pillar.position.y = 2.7;
        pillar.renderOrder = 3;
        const group = new Group();
        group.add(orb, pillar);
        this.scene.add(group);
        e = { group, orb, orbMat, pillar };
        this.pickups.set(p.id, e);
      }
      if (p.taken) {
        e.group.visible = false;
        continue;
      }
      e.group.visible = true;
      const ready = s.stages[p.stage]?.cleared === true;
      e.group.position.set(p.x, this.heightAt(p.x, p.z), p.z);
      // The bob and spin run on the fx clock — pure presentation, per-id
      // phase so two finds in one frame never move in lockstep.
      e.orb.position.y = 1.15 + Math.sin(this.fxTime * 1.6 + p.id * 1.7) * 0.09;
      e.orb.rotation.y = this.fxTime * 0.9 + p.id;
      e.orbMat.emissiveIntensity = ready ? 1.5 : 0.3;
      e.pillar.visible = ready;
    }
  }

  /** Where the gate's beacon stands, if it is lit — the caller adds embers. */
  gateBeacon(s: RtState): { x: number; y: number; z: number } | null {
    const stage = s.stages[s.stageIndex];
    if (!stage || stage.cleared) return null;
    if (!s.markers.every((m) => m.stage !== s.stageIndex || m.cleared)) return null;
    return { x: stage.exitX, y: this.heightAt(stage.exitX, stage.exitZ), z: stage.exitZ };
  }

  /**
   * The arena lock, drawn as a ring on the ground.
   *
   * An invisible wall is worse than no wall. The lock exists so a stage cannot
   * be jogged past (`CLAUDE.md` §8), and a player who is silently stopped by
   * nothing reads it as the movement being broken — which is exactly the class
   * of thing §11 says the player must be able to see.
   *
   * A ground ring rather than a dome: the camera is a fixed 3/4 diorama, so a
   * ring reads as a boundary from the only angle anyone ever sees, costs one
   * draw call, and never occludes the fight it is containing. It follows the
   * terrain by being segmented, because a flat disc on the graded road buries
   * half of itself.
   */
  /**
   * Build the ring NOW, and build it VISIBLE with every vertex at the origin
   * — not on the first lock, and not warm-but-hidden either. Lazily creating
   * it put its material's first shader link on the exact frame the first
   * fight spawned: the worst frame the perf gate could find (~170 ms at 4×
   * throttle). And `renderer.compile()` cannot warm it, measured the hard
   * way: the game renders through the post stack into a LINEAR target, so
   * the program the draw needs is the `srgb-linear` variant, while compile()
   * builds the canvas's `srgb` one — same material, different program. The
   * only compile that counts is a real draw through the real pipeline, so
   * the ring ships degenerate-visible (65 coincident points rasterize
   * nothing), the boot probe's renders link the program behind the loading
   * ring, and the first `updateLock` hides it. The chain flashes share the
   * program — same LineBasicMaterial key.
   */
  private buildLockRing(): Line {
    const geo = new BufferGeometry();
    const pts = new Float32Array((LOCK_SEGMENTS + 1) * 3);
    geo.setAttribute("position", new BufferAttribute(pts, 3));
    const mat = new LineBasicMaterial({ transparent: true, opacity: 0.55 });
    // Authored sRGB, converted at the render boundary like every other colour
    // in this file — skipping it once made oil and fire render identically.
    setSrgb(mat.color, FX.rotSpore);
    const ring = new Line(geo, mat);
    ring.frustumCulled = false; // the zeroed bound would cull the warm draw
    ring.scale.setScalar(0); // born in the warm state; the boot renders link it
    this.scene.add(ring);
    return ring;
  }

  /**
   * Warm-draw mode for a tier-change seam (round 7): a tier flip invalidates
   * every shader program (shadows on/off is a different variant), and three
   * relinks them lazily at next draw — for a hidden object that means at its
   * first REAL appearance, mid-fight. `renderer.compile` cannot help: the
   * game renders through the post stack's LINEAR target, and compile builds
   * the canvas's srgb variant — measured, one cache-key field apart. So the
   * quality seam renders one manual frame through the real pipeline with the
   * lazily-shown objects visible-but-degenerate (scale 0 rasterizes
   * nothing), and the relink cost lands on the seam frame, where a hitch
   * already lives.
   */
  setWarm(on: boolean): void {
    this.lockRing.visible = on;
    if (on) this.lockRing.scale.setScalar(0);
  }

  private updateLock(s: RtState): void {
    if (!s.lock) {
      this.lockRing.visible = false;
      return;
    }
    const lock = s.lock;
    this.lockRing.visible = true;
    this.lockRing.scale.setScalar(1); // undo a warm draw's degenerate scale
    const pos = this.lockRing.geometry.getAttribute("position") as BufferAttribute;
    for (let i = 0; i <= LOCK_SEGMENTS; i++) {
      const a = (i / LOCK_SEGMENTS) * Math.PI * 2;
      const x = lock.x + Math.cos(a) * lock.r;
      const z = lock.z + Math.sin(a) * lock.r;
      pos.setXYZ(i, x, this.heightAt(x, z) + 0.12, z);
    }
    pos.needsUpdate = true;
    this.lockRing.geometry.computeBoundingSphere();
  }

  /**
   * Draw one chain hop as a forked pair of jagged lines from body to body,
   * lifted through chest height. Fire-and-forget: `update` fades and reaps
   * them. Shocked white-blue only — the status vocabulary is a promise.
   */
  chainFlash(fromX: number, fromZ: number, toX: number, toZ: number): void {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    for (let fork = 0; fork < 2; fork++) {
      const pts = new Float32Array(CHAIN_FLASH_PTS * 3);
      for (let i = 0; i < CHAIN_FLASH_PTS; i++) {
        const t = i / (CHAIN_FLASH_PTS - 1);
        // Endpoints stay pinned to the bodies; the middle jags.
        const jag = i === 0 || i === CHAIN_FLASH_PTS - 1 ? 0 : (Math.random() - 0.5) * 0.5;
        const x = fromX + dx * t + (-dz / d) * jag;
        const z = fromZ + dz * t + (dx / d) * jag;
        const y = this.heightAt(x, z) + 0.9 + Math.sin(t * Math.PI) * 0.55;
        pts[i * 3] = x;
        pts[i * 3 + 1] = y;
        pts[i * 3 + 2] = z;
      }
      const geo = new BufferGeometry();
      geo.setAttribute("position", new BufferAttribute(pts, 3));
      const mat = new LineBasicMaterial({ transparent: true, opacity: 0.95 });
      setSrgb(mat.color, FX.shocked);
      const line = new Line(geo, mat);
      this.scene.add(line);
      this.chainBolts.push({ line, mat, ttl: CHAIN_FLASH_S });
    }
  }

  private updateChainBolts(dt: number): void {
    for (let i = this.chainBolts.length - 1; i >= 0; i--) {
      const b = this.chainBolts[i]!;
      b.ttl -= dt;
      if (b.ttl <= 0) {
        this.scene.remove(b.line);
        b.line.geometry.dispose();
        b.mat.dispose();
        this.chainBolts.splice(i, 1);
      } else {
        b.mat.opacity = 0.95 * (b.ttl / CHAIN_FLASH_S);
      }
    }
  }

  /**
   * Foes standing on the map at fights that have not started yet.
   *
   * `GAME_DESIGN.md` §2 and `RtMarker`'s own docstring both promise fights are
   * *visible and walked into* — no random battles. The turn build kept that
   * promise with `EncounterMarkers`, which died with the turn engine, and the
   * sim only creates a marker's foes on the tick it triggers. Without this an
   * ambush materialises out of nothing at 2.6 m, which is a design regression
   * and, when casts fire forward with no assist, an unfair one: you cannot
   * turn to face something you were given no chance to see.
   *
   * Presentation only — these are puppets standing still, reading `s.markers`.
   * The sim has no idea they are drawn, and the moment the marker triggers they
   * are replaced by the real foes at the same offsets.
   */
  private updateMarkers(s: RtState): void {
    const seen = new Set<number>();
    for (const m of s.markers) {
      if (m.triggered) continue;
      // ACTIVE STAGE ONLY. A fight the sim will refuse to start must not be
      // visible as a row of mannequins — the first playtest walked up to
      // stage-2 previews while stage 1 was still live, was ignored, and read
      // the game as broken. The next stage's fights now appear when its stage
      // opens, which reads as the world responding to the seam.
      if (m.stage !== s.stageIndex) continue;
      for (let i = 0; i < m.foes.length; i++) {
        const f = m.foes[i]!;
        // Negative keys, so a preview can never collide with a live foe id.
        const key = -1 - (m.id * 8 + i);
        seen.add(key);
        // hp 0 is inert here: previews never appear in the foes loop, so
        // their lastHp is never compared.
        const e = this.foeEntry(key, f.kindId, 0);
        const x = m.x + f.dx;
        const z = m.z + f.dz;
        // Idle facing back down the road — until the hero is close, at which
        // point the preview TURNS to watch them come. "They have noticed you"
        // instead of shop-window dummies; the sim's trigger fires moments
        // later, so the turn reads as the fight waking up.
        let fx = 0;
        let fz = -1;
        const dx = s.hero.x - x;
        const dz = s.hero.z - z;
        const d = Math.hypot(dx, dz);
        if (d < 8 && d > 1e-6) {
          fx = dx / d;
          fz = dz / d;
        }
        e.puppet.update(0.016, x, z, this.heightAt(x, z), fx, fz, 0);
      }
    }
    for (const [id, e] of this.foes) {
      if (id >= 0 || seen.has(id)) continue;
      this.scene.remove(e.puppet.group);
      e.puppet.dispose();
      e.material.dispose();
      this.foes.delete(id);
    }
  }

  /* -------------------------------------------------------------- field */

  private updatePatches(patches: readonly FieldPatch[]): void {
    for (let i = 0; i < patches.length; i++) {
      const p = patches[i]!;
      let mesh = this.patchPool[i];
      if (!mesh) {
        mesh = new Mesh(
          this.patchGeo,
          new MeshBasicMaterial({ transparent: true, depthWrite: false, vertexColors: true }),
        );
        mesh.rotation.x = -Math.PI / 2;
        // Render after the ground so a patch never z-fights with terrain.
        mesh.renderOrder = 2;
        this.scene.add(mesh);
        this.patchPool.push(mesh);
      }
      mesh.visible = true;
      // Ice is a faceted pane, everything liquid is the smooth disc — the
      // pool is indexed, not per-kind, so the slot swaps geometry to match
      // (an assignment, not a rebuild).
      mesh.geometry = p.kind === "ice" ? this.iceGeo : this.patchGeo;
      // A stable in-plane spin off the patch POSITION, so neighbouring ice
      // panes are not nine identical stamped stars. Position, not pool
      // index: slots shift as earlier patches expire, and an index seed
      // would visibly re-spin every surviving pane on each expiry.
      mesh.rotation.z = p.kind === "ice" ? (p.x * 7.13 + p.z * 3.71) % (Math.PI * 2) : 0;
      const mat = mesh.material as MeshBasicMaterial;
      setSrgb(mat.color, PATCH_COLOUR[p.kind]);
      // Fade over the last third of its life, so the floor forgetting is
      // something the player can see coming rather than a patch blinking out.
      const life = p.ticksLeft / Math.max(1, p.totalTicks);
      mat.opacity = PATCH_OPACITY[p.kind] * Math.min(1, life * 3);
      // The pane scales up 15%: its notched rim dips to 0.63 r, and a
      // hazard that under-draws its own sim circle surprises the player
      // with a slip on clean-looking ground. Over-coverage errs safe —
      // an over-cautious player lost nothing.
      mesh.scale.setScalar(p.kind === "ice" ? p.r * 1.15 : p.r);
      mesh.position.set(p.x, this.heightAt(p.x, p.z) + 0.05, p.z);
    }
    for (let i = patches.length; i < this.patchPool.length; i++) {
      this.patchPool[i]!.visible = false;
    }
  }

  /** Emitter points for fire patches — the caller owns the particle system. */
  fireEmitters(s: RtState): { x: number; y: number; z: number; r: number }[] {
    const out: { x: number; y: number; z: number; r: number }[] = [];
    for (const p of s.patches) {
      if (p.kind !== "fire") continue;
      out.push({ x: p.x, y: this.heightAt(p.x, p.z), z: p.z, r: p.r });
    }
    return out;
  }

  /* --------------------------------------------------------- projectiles */

  private updateBolts(s: RtState, alpha: number): void {
    this.boltVisCount = 0;
    for (let i = 0; i < s.projectiles.length; i++) {
      const p = s.projectiles[i]!;
      // Bolts move ~0.47 m per tick, so an uninterpolated one visibly STEPS —
      // the most obvious stutter in the scene and the easiest to miss in a
      // still screenshot.
      const bq = this.lerpBody(p.id, p, alpha);
      let mesh = this.boltPool[i];
      if (!mesh) {
        mesh = new Mesh(
          this.boltGeo,
          new MeshBasicMaterial({ transparent: true, opacity: 0.95 }),
        );
        this.scene.add(mesh);
        this.boltPool.push(mesh);
      }
      mesh.visible = true;
      setSrgb(
        (mesh.material as MeshBasicMaterial).color,
        attackColour(p.element, p.fromHero),
      );
      const y = this.heightAt(bq.x, bq.z) + 0.65;
      if (p.fromHero) {
        // The hero's shot: bigger than the old bead (it was a 0.18 m unlit
        // dot, indistinguishable across all six elements), stretched along
        // its flight, with the element's own proportions — a SPARK is a thin
        // fast streak, a spore puff is a fat slow ball. The shot itself tells
        // you what is coming (and a bigger mix throws a bigger one).
        const fx = ELEMENT_FX[p.element as keyof typeof ELEMENT_FX] ?? ELEMENT_FX.spore;
        const base = (0.55 + p.radius * 0.55) * fx.boltScale;
        mesh.scale.set(base, base, base * fx.stretch);
        mesh.rotation.y = Math.atan2(p.vx, p.vz);
      } else {
        // A foe's shot: a pulsing, wobbling blob — organic where the hero's
        // is directed, so the two never read alike even at 800×450.
        const pulse = 1 + 0.22 * Math.sin(this.fxTime * 13 + p.id * 2.1);
        const base = (0.7 + p.radius * 0.4) * pulse;
        mesh.scale.set(base, base * (2 - pulse), base);
        mesh.rotation.y = 0;
      }
      mesh.position.set(bq.x, y, bq.z);

      const v = (this.boltVisPool[this.boltVisCount] ??= {
        x: 0,
        y: 0,
        z: 0,
        element: "spore",
        fromHero: true,
      });
      v.x = bq.x;
      v.y = y;
      v.z = bq.z;
      v.element = p.element;
      v.fromHero = p.fromHero;
      this.boltVisCount++;
    }
    for (let i = s.projectiles.length; i < this.boltPool.length; i++) {
      this.boltPool[i]!.visible = false;
    }
  }

  /**
   * Every bolt drawn last frame, in presentation space — for trail emission
   * by the fx layer. The array is reused; read it, do not keep it.
   */
  bolts(): readonly BoltVis[] {
    this.boltVisOut.length = this.boltVisCount;
    for (let i = 0; i < this.boltVisCount; i++) this.boltVisOut[i] = this.boltVisPool[i]!;
    return this.boltVisOut;
  }

  /** Ground point of a foe, for particle emission. */
  foePosition(id: number): { x: number; y: number; z: number } | null {
    const e = this.foes.get(id);
    if (!e) return null;
    const g = e.puppet.group.position;
    return { x: g.x, y: g.y, z: g.z };
  }

  /**
   * Start the boss's dry-off dog-shake (rt-event-fx calls this on
   * `ev.bossDried`). The wiggle itself runs in the per-frame foe update,
   * where it defers to any live windup pose.
   */
  bossDryShake(id: number): void {
    const e = this.foes.get(id);
    if (e) e.dryShake = 0.45;
  }

  heroAttack(): void {
    this.hero.attack();
  }

  /** The root began: gather pose, held until the release. */
  heroCastCommit(durationSec: number, weight: number): void {
    this.hero.castCharge(durationSec, weight);
  }

  /** The spell left: thrust whip, then home. */
  heroCastRelease(): void {
    this.hero.castRelease();
  }

  dispose(): void {
    for (const e of this.foes.values()) {
      this.scene.remove(e.puppet.group);
      e.puppet.dispose();
      e.material.dispose();
    }
    for (const e of this.bystanders.values()) {
      this.scene.remove(e.puppet.group);
      e.puppet.dispose();
      e.material.dispose();
    }
    this.scene.remove(this.hero.group);
    this.hero.dispose();
    this.heroMat.dispose();
    for (const m of [...this.patchPool, ...this.boltPool]) {
      this.scene.remove(m);
      (m.material as MeshBasicMaterial).dispose();
    }
    this.patchGeo.dispose();
    this.iceGeo.dispose();
    this.boltGeo.dispose();
  }
}

/** Impact and bolt colour per element — the fx vocabulary (ART_DIRECTION §6). */
export const ELEMENT_RGB: Record<string, [number, number, number]> = Object.fromEntries(
  Object.entries(ELEMENT_COLOUR).map(([k, v]) => [k, [...v] as [number, number, number]]),
);

/**
 * The colour of an attack in flight, honest about whose it is. A foe's
 * elemental attack keeps the element's colour — a Seeper's oil bolt IS oil,
 * which is the playtest's exact complaint ("the enemy spores seem to be made
 * out of oil") inverted into the rule. Only the Greyrot's own spore attack
 * swaps to the rot violet-grey: the hero's spore is warm cream, and the two
 * must never read alike.
 */
export function attackColour(element: string, fromHero: boolean): [number, number, number] {
  if (!fromHero && element === "spore") return [...FX.rotSpore];
  return ELEMENT_RGB[element] ?? ELEMENT_RGB.spore!;
}

/** Shared with the HUD so a button and its particles can never disagree. */
export function elementColour(e: string): Color {
  const c = new Color();
  setSrgb(c, ELEMENT_RGB[e] ?? ELEMENT_RGB.spore!);
  return c;
}
