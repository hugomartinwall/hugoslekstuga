/**
 * Entry point.
 *
 * The shape that must never change (`CLAUDE.md` §4): the SIMULATION advances in
 * fixed 30 Hz ticks fed only by commands; the RENDERER interpolates between the
 * last two sim states and never writes back. Input devices reduce to commands
 * app-side.
 *
 * ## What changed when combat became real-time
 *
 * Less than you would expect, and all of it in the same direction. The turn
 * build treated a fight as a MODE: walking into a marker froze the world,
 * opened a second state machine, swapped the HUD, and handed the fight its own
 * off-clock pacing. Every one of those is gone. A marker now spawns its foes
 * into a simulation that never stopped, so there is one state, one clock, one
 * HUD and one view — and this file got shorter rather than longer.
 *
 * The world M1 authored survives whole: the graded road, the carved arenas, the
 * burning village, the troughs, and Sella waiting on the road to be freed.
 */

import {
  CircleGeometry,
  Color,
  Mesh as ThreeMesh,
  MeshStandardMaterial,
  NoToneMapping,
  PCFSoftShadowMap,
  Vector3,
  WebGLRenderer,
} from "three";
import { installBrowserQuirks, type Listen } from "./app/browser-quirks";
import { Economy, type RewardedSlot } from "./app/economy";
import {
  discover,
  discoveredCount,
  loadCampaign,
  loadMeta,
  markStageCleared,
  saveCampaign,
  saveMeta,
  type CampaignSave,
  type MetaSave,
} from "./app/save";
import { AudioSystem } from "./audio/audio";
import {
  CASTABLES,
  CHAPTERS,
  MIX_COUNT,
  QUEUE_MAX,
  STAGES,
  chapterOfStage,
  encodeFound,
  foeKind,
  foundBitsThroughStage,
  isChapterEnd,
  type Element,
  type StatusId,
} from "./content";
import { gatherRtCommands, groundUnderRay, newMoveLatch } from "./input/rt-commands";
import { SpellInput } from "./input/spell-input";
// The ONE resolver (CLAUDE.md §6), shared with the HUD — so the grimoire
// banner names the mix with the same string the queue preview shows.
import { resolveMix } from "./sim/rt/spell";
import { createLoop } from "./loop";
import { DEV_HANDLES } from "./dev";
import { motionPref, nextMotionPref, setMotionPref } from "./render/motion";
import type { GameFonts } from "./fonts";
import { getPlatform, setGameHooks } from "./platform/local";
import { FX, WORLD } from "./render/art";
import { srgbToLinear } from "./render/mesh/dsl";
import {
  CameraRig,
  DIORAMA_YAW,
  FollowYaw,
  updateFrameLead,
  type CameraMode,
  type FrameLead,
} from "./render/camera";
import { foeBarHeight } from "./render/chars/sporeling";
import { Particles } from "./render/fx/particles";
import { PostStack } from "./render/fx/post";
import { Resaturation } from "./render/fx/resaturation";
import { RtEventFx } from "./render/fx/rt-event-fx";
import { ThreatEdge } from "./render/fx/threat-edge";
import { Quality, probeTier, type QualitySettings, type Tier } from "./render/quality";
import { ELEMENT_RGB, RtView } from "./render/rt-view";
import { World } from "./render/world";
import { createRtState, hashRt, type RtState } from "./sim/rt/state";
import {
  PICKUP_RADIUS,
  leftBehindFind,
  rtStep,
  type RtCommand,
  type RtEvents,
} from "./sim/rt/step";
import {
  CAMPAIGN_WATER_LEVEL,
  SELLA_NAME,
  VILLAGE,
  applyResume,
  scenarioHeightfieldOptions,
  setupEncounters,
  setupRoad,
  setupVillage,
} from "./sim/scenario";
import { TICK_HZ } from "./sim/tick";
import { createSimWorld } from "./sim/world";
import { Dialogue } from "./ui/dialogue";
import { Hud } from "./ui/hud";
import { Seam, type SeamAction } from "./ui/seam";
import { SpellHud } from "./ui/spell-hud";

const WORLD_SEED = 1337;
// One water level, owned by the scenario — the road grading needs it (the
// northern route crosses a lake basin and builds a causeway above it).
const WATER_LEVEL = CAMPAIGN_WATER_LEVEL;

export interface GreyrotOptions {
  /** Leave the game — Escape, or the seam's BACK TO PLAYHOUSE. */
  onExit: () => void;
  /** Resolved house font families; see `fonts.ts`. */
  fonts: GameFonts;
}

export interface GreyrotHandle {
  /** Stop the loop, drop the GL context, close audio, unbind every listener. */
  destroy(): void;
}

/**
 * Boot Greyrot into an existing canvas and UI root.
 *
 * game2 called this `boot()`, took no arguments, found its two DOM nodes by id
 * and ran on import. The site's games are factories that hand back a handle
 * (see `lib/overrun/game.ts` and `lib/adventure/game.ts`), because a route can
 * unmount — twice, under StrictMode — and everything built here has to be
 * releasable.
 */
export async function createGreyrot(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  opts: GreyrotOptions,
): Promise<GreyrotHandle> {
  /* --------------------------------------------------------- teardown */
  /**
   * Overrun's discipline, in shape: nothing is attached without its undo being
   * recorded in the same breath.
   *
   * Only listeners need it here. Overrun also wraps `setTimeout`, because its
   * win path schedules a save ~900 ms out that would clobber the next mount's;
   * Greyrot schedules nothing from this scope. The timers it does own belong to
   * the HUD classes, and the two that reach past their own DOM — `Hud`'s banner
   * pump and `Dialogue`'s document keydown — are released in their `destroy()`.
   */
  const disposers: (() => void)[] = [];
  let destroyed = false;

  const listen = ((
    target: EventTarget,
    type: string,
    fn: (e: never) => void,
    o?: AddEventListenerOptions,
  ) => {
    const handler = fn as EventListener;
    target.addEventListener(type, handler, o);
    disposers.push(() => target.removeEventListener(type, handler, o));
  }) as Listen;

  await getPlatform().init();
  getPlatform().loadingStart();

  /* ----------------------------------------------------------------- save */
  // Loaded before anything is built, so quality and mute come up right rather
  // than flickering into place. §7's two keys: a corrupt campaign must not be
  // able to take the settings down with it, so they are read independently and
  // either one failing yields defaults.
  const meta: MetaSave = await loadMeta();
  const campaign: CampaignSave = await loadCampaign();
  meta.lifetime.runs++;
  // Lifetime totals are cumulative and the sim's counters are per-run, so the
  // baseline is captured once here. Adding `state.kills` straight onto
  // `meta.lifetime.kills` at every seam would count this run again at each one.
  const lifetimeKillsBase = meta.lifetime.kills;
  const lifetimeSporesBase = meta.lifetime.spores;

  const economy = new Economy({
    now: () => Date.now(),
    // §8: adblock users play normally. Resolved once, here, so no offer can
    // ever render a button that cannot pay out.
    adblock: await getPlatform().hasAdblock(),
  });

  /* ------------------------------------------------------------------ sim */

  const simWorld = createSimWorld({
    seed: WORLD_SEED,
    waterLevel: WATER_LEVEL,
    heightfield: scenarioHeightfieldOptions(),
  });
  // Power is found, not chosen: the campaign opens with SPORE alone and a
  // one-element hand. The road grants the rest (`content/stages.ts`). The
  // sandbox creates its state with everything unlocked — this line is the
  // difference between the curriculum and the feel harness.
  const state: RtState = createRtState(WORLD_SEED, { unlocked: ["spore"], queueMax: 1 });
  const heightAt = (x: number, z: number): number => simWorld.field.heightAt(x, z);

  // ORDER IS LOAD-BEARING: encounters and the village first, because the road
  // connects where things ACTUALLY ended up rather than where they were
  // authored — arena placement can nudge a fight sideways to find flat ground.
  setupEncounters(simWorld, state);
  setupVillage(simWorld, state);
  setupRoad(simWorld, state);
  // Resume where the last seam left off. Only the stage index and the spore
  // count are restored, because those are the only DECISIONS in the save (§7) —
  // everything else about the world is rebuilt from the same seed and the same
  // authored tables, which is what makes the save 200 bytes instead of a
  // snapshot.
  state.loot = campaign.spores;
  // Held power is DERIVED from the stages already walked (§7: the cleared
  // bitset is the decision log). Sim-side and tested, because it carries the
  // pickup-soundness argument: finds behind the last cleared gate are taken,
  // the last cleared stage's find stands back up ahead of the resume point.
  applyResume(state, campaign.stage, campaign.found);
  // §9: the player arrives already in motion. Sim-side, so it replays and it is
  // testable — a hero standing still on an empty road is a title screen with
  // extra steps. It surrenders for good the instant the player steers.
  state.autorun = true;

  // Two queues, and the second is not redundant. `gatherRtCommands` clears the
  // first at the top of every tick, so anything pushed into it BETWEEN ticks is
  // silently wiped; injections go through `externalQueue` and are spliced in.
  const commandQueue: RtCommand[] = [];
  const externalQueue: RtCommand[] = [];

  /* ------------------------------------------------------------- renderer */

  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.shadowMap.type = PCFSoftShadowMap;
  // The post stack owns tonemapping and the sRGB write.
  renderer.toneMapping = NoToneMapping;

  const quality = new Quality("medium");
  const post = new PostStack(renderer);
  const particles = new Particles(8000);
  const world = new World({ sim: simWorld }, quality.settings);
  const rig = new CameraRig(1);
  world.scene.add(particles.points);

  const view = new RtView(world.scene, heightAt);
  // Every foe kind's shader program compiles at boot through the view's
  // invisible warm pool + `applyQuality`'s scene compile below — never at a
  // fight's first spawn, which was the worst frame the perf gate could find.

  // Two HUDs, and both are needed. `SpellHud` is the combat surface — health,
  // the element arc, the queue strip. `Hud` carries the things that outlive a
  // fight: the spore count, transient banners, and THE MUTE BUTTON, which is
  // the only wiring for `audio.toggleUserMuted()` and a platform requirement
  // (§3, §11). Their selectors do not collide and their anchors do not overlap.
  const hud = new Hud(uiRoot);
  // The seam layer: defeat, stage clear, camp. Modal, above both HUDs, and the
  // only place in the game a rewarded offer may appear (§8: between states,
  // never during gameplay).
  const seam = new Seam(uiRoot);
  // The speech bubble — Sella's introduction. Not a mode: the sim never
  // pauses, `drawFrame` aims the camera and anchors the bubble, and any
  // input advances it.
  const dialogue = new Dialogue(uiRoot);
  /** The bystander the camera leans toward while their intro plays. */
  let introFocus: string | null = null;
  /** A rescue that fired under a seam panel — the intro waits its turn. */
  let pendingIntro: string | null = null;
  // Round 7: the village is the WATER lesson, and Sella's intro is its ask.
  // She begs the douse, not a trick — the lightning arrives AFTER, as thanks.
  const INTRO_LINES = [
    "Oh, thank you. I thought no one was coming.",
    "I'm Sella — my village is just ahead, and it's burning.",
    "Cinder-things lit the huts. You carry water — help me put them out.",
  ];
  /**
   * A follower one-liner waiting for its frame — the promise-keeping half of
   * the intro above (fourth playtest: "I got no onboarding as Sella
   * promised"). Latest beat wins; a beat that finds its speaker gone is
   * dropped, never revived. `calm` waits for a quiet frame the way the intro
   * does; without it the line may start under fire — the bubble survives
   * fights by design.
   */
  /**
   * `awaitTake` (R6, fun's ruling on the SPARK beat) — hold the line until the
   * TAKE CHIP for a find is actually on screen, rather than firing it on the
   * stage clear.
   *
   * fun drove the shipped trigger three times at 1280x800, same instant and
   * same viewport, and the gem projected at sx **-407, -506 and +683** — off
   * the left edge twice, dead centre once. The discriminator is the heading
   * the player carries into the gate, set by which of two burning huts 7.6 m
   * apart they doused last. *A witness whose frame depends on which hut you
   * doused last is not a witness.*
   *
   * ⚠️ THE OBVIOUS FIX IS REFUTED: firing the line EARLIER does not work.
   * Standing 0.51 m from the gem with the stage uncleared, the chip renders
   * EMPTY and twenty F presses grant nothing — the gem being ahead and the gem
   * being takeable are the same gate. Moving the line converts a framing
   * defect into a silent refusal from the character whose whole job is keeping
   * promises.
   *
   * This gates on the chip instead, which is **presentation gating on
   * presentation** — the same shape as `calm` beside it. The chip is computed
   * from `state.pickups`, `state.stages[].cleared` and the hero's position,
   * all of which this frame already reads; nothing new is pulled out of the
   * sim and nothing is written back. It also generalises: every find-adjacent
   * line gets *"the referent is on screen"* as its trigger condition instead
   * of a hope.
   */
  let pendingSay: { lines: string[]; calm: boolean; awaitTake?: true } | null = null;
  /** The bystander a non-intro bubble anchors to. Never takes the camera. */
  let sayFocus: string | null = null;
  // Sella keeps her promise in two beats: she points at the find her gate
  // stood up, then hands the player the idea the pool is about to prove.
  // Confirmation, not teaching — the funnel's masher pilot still fires the
  // chain without ever hearing her (it cannot: pilots are sim-only). Round 7
  // reframed the point line: the spark is THANKS for the doused village, so
  // her intro's ask and this payoff bracket the water lesson in her voice.
  const SPARK_POINT_LINES = ["You saved my home. That glow up the road — my spark. Take it, it's yours."];
  const SPARK_TAKE_LINES = ["I wonder what happens when you spark something standing in water."];
  // The urging line — fires once when the village fight is won while huts
  // still burn: the gate's refusal needs a voice the first time it happens.
  const DOUSE_URGE_LINES = ["The fires! Douse every hut — the gate stays shut while my village burns."];
  let saidDouseUrge = false;
  /** Pyre-out banner debounce (R6a: five stacked copies measured). */
  let lastPyreBannerAt = 0;
  // The one-way road, said once in her voice (round 6): the wall is the
  // world's rule, and a rule nobody states reads as a bug. Fires on the
  // first blocked backward step WHILE she is following — a pre-rescue bump
  // must not burn the line on an absent speaker.
  const ROAD_BLOCKED_LINES = ["The rot closed the road behind us. We go forward."];
  let saidRoadBlocked = false;

  /* ------------------------------------------------------------- audio */

  const audio = new AudioSystem();
  // Every press, not just the first — the first one might be denied.
  for (const evt of ["pointerdown", "keydown"] as const) {
    listen(window, evt, () => audio.unlock(), { passive: true });
  }
  audio.setPlatformMuted(getPlatform().isMuted());
  getPlatform().onMuteChange((m) => audio.setPlatformMuted(m));
  // The player's own toggle is ours to remember; the PLATFORM's toggle is not,
  // and is read live from the SDK every session (§3).
  if (meta.muted !== audio.isUserMuted()) audio.toggleUserMuted();
  // Motion, beside mute. The pref is read at module load and cached, so
  // flipping it takes effect on the next frame that asks — no reload.
  hud.setMotionPref(motionPref());
  hud.onMotionToggle(() => {
    const next = nextMotionPref(motionPref());
    setMotionPref(next);
    return next;
  });
  hud.onMuteToggle(() => {
    meta.muted = audio.toggleUserMuted();
    void saveMeta(meta);
    return meta.muted;
  });
  hud.setMuted(audio.isUserMuted());
  view.hero.onFootfall = () => {
    audio.footfall();
    particles.emit({
      count: 3,
      origin: [state.hero.x, heightAt(state.hero.x, state.hero.z) + 0.05, state.hero.z],
      speed: 0.6,
      spread: 0.8,
      color: [...FX.dust],
      lifetime: 0.45,
      size: 0.1,
      gravity: 0.8,
      intensity: 0.8,
    });
  };

  // The camera's own ground includes the HUTS: they are authored scenery the
  // carve never fells and the one class of obstacle the clamp cannot see —
  // a camera that stands inside one renders the inside of a roof. Blocker
  // radius exactly (1.9 × scale, the sim's own), so the lift can only fire
  // with the camera truly inside a hut and never pops on the normal walk
  // past one. A hut OCCLUDING from mid-sightline is left alone: it only
  // happens pushing backward against the one-way wall in the village, and
  // it recovers the moment the push stops.
  rig.setGroundSampler((cx, cz) => {
    let g = heightAt(cx, cz);
    for (const hut of VILLAGE.huts) {
      if (Math.hypot(cx - hut.x, cz - hut.z) < 1.9 * hut.scale) {
        g = Math.max(g, heightAt(hut.x, hut.z) + 2.6 * hut.scale);
      }
    }
    return g;
  });
  rig.snap(0, heightAt(0, 0), 0);

  /* -------------------------------------------------------- village dress */

  // Trough water: flat translucent discs on the sim's wet zones — the visual
  // for the exact circles the Wet status reads. One dataset, two consumers, and
  // in real time the sim asks those circles every tick (`rt/step.ts` step 7),
  // so what you can see is precisely what soaks you.
  // The palette's water, converted at the boundary — this used to be a raw
  // literal fed straight to a linear material, one of the two srgb leaks the
  // render audit flagged.
  const waterMat = new MeshStandardMaterial({
    color: new Color(
      srgbToLinear(WORLD.water[0]),
      srgbToLinear(WORLD.water[1]),
      srgbToLinear(WORLD.water[2]),
    ),
    roughness: 0.2,
    metalness: 0.05,
    transparent: true,
    opacity: 0.8,
  });
  for (const t of simWorld.wetZones) {
    const disc = new ThreeMesh(new CircleGeometry(t.r, 20), waterMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(t.x, heightAt(t.x, t.z) + 0.04, t.z);
    world.scene.add(disc);
  }

  // Burning huts: looping fire + smoke emitters at the roofline. The flames
  // are driven by SIM state now (`state.hutFires`), not by the static layout —
  // the fires can be put out with water, so what burns is gameplay truth. The
  // pairing is by order: `setupVillage` pushes one fire per burning hut, in
  // VILLAGE.huts order.
  const burningHuts = VILLAGE.huts.filter((hu) => hu.burning);
  let fireAccumulator = 0;
  let firePhase = 0;
  function emitFires(dt2: number): void {
    fireAccumulator += dt2;
    if (fireAccumulator < 0.06) return;
    fireAccumulator = 0;
    firePhase += 1;
    for (let hi = 0; hi < burningHuts.length; hi++) {
      const hu = burningHuts[hi]!;
      if (state.hutFires[hi] && !state.hutFires[hi]!.lit) continue;
      const ground = heightAt(hu.x, hu.z);
      // Flames lick around the ROOF SURFACE, not just the peak — a ring of
      // emitters walking around the cone is what reads as "this building is on
      // fire" instead of "someone lit a candle on the ridge".
      for (let i = 0; i < 3; i++) {
        const a = (firePhase * 0.7 + (i * Math.PI * 2) / 3) % (Math.PI * 2);
        const r = 1.35 * hu.scale;
        particles.emit({
          count: 6,
          origin: [
            hu.x + Math.cos(a) * r,
            ground + (2.0 + 0.5 * Math.sin(a * 2)) * hu.scale,
            hu.z + Math.sin(a) * r,
          ],
          speed: 1.6,
          direction: [0, 1, 0],
          spread: 0.35,
          color: [1.0, 0.42, 0.1],
          lifetime: 0.9,
          size: 0.34,
          gravity: -2.2, // fire rises, hard
          intensity: 3.2,
        });
      }
      // The crown at the peak + embers.
      particles.emit({
        count: 5,
        origin: [hu.x, ground + 3.1 * hu.scale, hu.z],
        speed: 1.4,
        direction: [0, 1, 0],
        spread: 0.45,
        color: [1.0, 0.6, 0.15],
        lifetime: 0.7,
        size: 0.3,
        gravity: -2.4,
        intensity: 3.4,
      });
      // Smoke column.
      particles.emit({
        count: 2,
        origin: [hu.x, ground + 3.6 * hu.scale, hu.z],
        speed: 0.8,
        direction: [0.15, 1, 0.05],
        spread: 0.4,
        color: [0.14, 0.13, 0.12],
        lifetime: 2.6,
        size: 0.7,
        gravity: -0.8,
        intensity: 0.3,
      });
    }
    // Brazier bowls (R4, damp_pyres + the boss arena): a steady small fire
    // over each LIT keep-lit pyre — flame scaled to a 0.6 m bowl, not a
    // roofline, licking from the coal heap at the rim (~1.05 m). A dark bowl
    // emits NOTHING: lit-vs-dark is the objective read, and a smoke wisp on
    // a dead pyre would soften exactly the absence the player must notice.
    // (mech's event handlers own the transitions — steam on douse, a flame
    // burst on relight; this is the steady state between them.)
    for (const hf of state.hutFires) {
      if (!hf.keepLit || !hf.lit) continue;
      const ground = heightAt(hf.x, hf.z);
      particles.emit({
        count: 4,
        origin: [hf.x, ground + 1.05, hf.z],
        speed: 1.1,
        direction: [0, 1, 0],
        spread: 0.22,
        color: [1.0, 0.42, 0.1],
        lifetime: 0.55,
        size: 0.26,
        gravity: -2.0, // fire rises
        intensity: 3.0,
      });
      // Sparse embers over the flame — the glint that survives at distance.
      if ((firePhase + hf.id) % 3 === 0) {
        particles.emit({
          count: 2,
          origin: [hf.x, ground + 1.15, hf.z],
          speed: 1.5,
          direction: [0, 1, 0],
          spread: 0.5,
          color: [1.0, 0.6, 0.15],
          lifetime: 0.9,
          size: 0.16,
          gravity: -1.6,
          intensity: 3.4,
        });
      }
    }
  }

  /* -------------------------------------------------------------- input */

  const input = new SpellInput(canvas, opts.onExit);
  let queueDirty = true;
  const spellHud = new SpellHud(uiRoot, {
    onElement: (e: Element) => input.pressElement(e),
    onCastDown: () => input.castDown(performance.now()),
    onCastUp: () => input.castUp(performance.now()),
    onClear: () => input.clearQueue(),
    onTake: () => input.pressTake(),
  });

  /** The cursor's ray into the world, or null before any pointer movement. */
  function cursorRay(): {
    ox: number;
    oy: number;
    oz: number;
    dx: number;
    dy: number;
    dz: number;
  } | null {
    const p = input.aim;
    if (!p) return null;
    const ndcX = (p.px / canvas.clientWidth) * 2 - 1;
    const ndcY = -(p.py / canvas.clientHeight) * 2 + 1;
    const origin = rig.camera.position;
    const dir = new Vector3(ndcX, ndcY, 0.5).unproject(rig.camera).sub(origin).normalize();
    return { ox: origin.x, oy: origin.y, oz: origin.z, dx: dir.x, dy: dir.y, dz: dir.z };
  }

  /**
   * Where the cursor meets the ground — STEERING only.
   *
   * The cursor decides where the hero walks and nothing else. It does not pick
   * a target and it does not aim. A cast fires along the hero's facing, on both
   * devices; see `sim/rt/aim.ts` for why that is the whole system.
   */
  function cursorGround(): { x: number; z: number } | null {
    const ray = cursorRay();
    return ray ? groundUnderRay(ray, heightAt) : null;
  }

  /* ------------------------------------------------------------- resize */

  function resize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const pr = quality.pixelRatio();
    if (canvas.width !== Math.round(w * pr) || canvas.height !== Math.round(h * pr)) {
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h, false);
    }
    rig.setAspect(w / h || 1);
    post.setSize(Math.round(w * pr), Math.round(h * pr));
    particles.setPixelScale(Math.round(h * pr));
  }

  function applyQuality(q: QualitySettings): void {
    renderer.shadowMap.enabled = q.shadowMapSize > 0;
    world.applyQuality(q);
    post.setQuality(q);
    particles.setBudget(q.particles);
    rig.setFar(q.viewDistance * 1.25);
    resize();
    // A tier change invalidates every program variant (shadows on/off is a
    // different shader), and three relinks them LAZILY at next draw — which
    // for anything not currently on screen means at its first appearance,
    // mid-fight (measured: the arena ring's link was the first fight's
    // 170 ms spawn frame at the perf gate's 4× throttle). One warm render
    // through the REAL pipeline compiles what a seam frame can afford to —
    // `renderer.compile` cannot do this job: the post stack renders into a
    // linear target and compile builds the canvas's srgb variants, one
    // cache-key field apart and useless.
    view.setWarm(true);
    post.render(world.scene, rig.camera);
    view.setWarm(false);
  }
  quality.onChange(applyQuality);
  applyQuality(quality.settings);

  /* ------------------------------------------------------ quality probe */

  const tier = await probeTier(() => {
    resize();
    post.render(world.scene, rig.camera);
  });
  quality.set(tier, false); // adaptive degradation stays enabled

  /* ------------------------------------------------------- presentation */

  /** CSS colour for a combo flash, from the one fx vocabulary. */
  function cssColour(element: string): string {
    const c = ELEMENT_RGB[element] ?? ELEMENT_RGB.spore!;
    return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;
  }

  // The shared tick-reaction module (§6): particles, shake and puppet
  // triggers live in ONE place both entries import — the blocks below had
  // been written twice and had already drifted. What stays here is what is
  // this entry's own: audio, HUD, banners, and the seams.
  const eventFx = new RtEventFx({
    particles,
    view,
    heightAt,
    shake: (str) => rig.addShake(str),
  });

  // The flanker's eyes-off tell (R2) — the screen-edge glow that makes the
  // sim-enforced stalk phase perceivable without eyes-on. See threat-edge.ts.
  const threatEdge = new ThreatEdge(heightAt);

  // The resaturation drive (R1): the saturation uniform finally has a driver —
  // drain under a fight lock, a restoration wave from the last kill, a warm
  // pulse at the gate. Projection uses last frame's camera at event time,
  // same one-frame drift the damage numbers accept below.
  const resat = new Resaturation(post, (x, z) => {
    const p = new Vector3(x, heightAt(x, z) + 0.9, z).project(rig.camera);
    if (p.z > 1) return null;
    return { u: p.x * 0.5 + 0.5, v: p.y * 0.5 + 0.5 };
  });

  /**
   * Presentation reactions to what one tick reported.
   *
   * §11's juice law governs and is unchanged by the pivot: shake answers what
   * happens TO the player and what they SUCCEED at — a landed combo, an
   * ignition, a kill, a hit taken. Never the routine act of casting. game1
   * shipped shake on the player's own actions and rumbled constantly.
   */
  function applyEvents(ev: RtEvents): void {
    lastEvents = ev;
    audio.onRtEvents(ev);
    if (ev.queueChanged) queueDirty = true;

    const combo = eventFx.apply(ev, state);
    if (combo) spellHud.flashCombo(combo.label, cssColour(combo.element));
    resat.onEvents(ev, state);

    // The soak-heal beat lands ON the bar it heals (ev.bossSoaked; fun's
    // binding watch-item — an unseen re-soak is an invisible heal). EVERY
    // beat pulses, refresh and re-wrap alike: the coat FX in rt-event-fx
    // mark only the re-wrap, the bar marks the hp.
    if (ev.bossSoaked) spellHud.pulseFoeBar(ev.bossSoaked.id);

    // Damage numbers (round 5: "otherwise it's like fighting blind"), layered
    // over the round-4 damage-scaled bursts, not replacing them. Hero damage
    // stays the HP bar + shake; status-tick DoT emits no impact events and is
    // deliberately not numbered — the foe HP bar shows the drain. Projection
    // uses last frame's camera (applyEvents runs before this frame's
    // rig.update): one frame of drift on a 900 ms transient is invisible.
    for (const i of ev.impacts) {
      if (i.onHero) continue;
      const p = new Vector3(i.x, heightAt(i.x, i.z) + 1.5, i.z).project(rig.camera);
      if (p.z > 1) continue;
      spellHud.spawnDamage(
        (p.x * 0.5 + 0.5) * innerWidth,
        (-p.y * 0.5 + 0.5) * innerHeight,
        i.damage,
        i.chained || i.combo !== null,
      );
    }

    /* ------------------------------------------------------- world beats */

    for (const d of ev.hutDoused) {
      // Which fire went out decides the words (R4): a hut douse is a success
      // the player engineered; a PYRE going dark is a setback — no spores
      // were paid sim-side, so the banner must not claim them.
      const pyre = state.hutFires.find((hf) => hf.x === d.x && hf.z === d.z);
      const wasPyre = pyre?.keepLit;
      const ground = heightAt(d.x, d.z);
      if (wasPyre) {
        // A soft blow, not a reward: small shake (something happened TO the
        // player's objective), steam, and the count the chip carries on.
        // DEDUPED (fun's R4 pass measured five stacked copies under repeated
        // douses) — one banner per beat, wall-clock side because banners are
        // presentation. VOICE (fun's ruling on gfx's catch): a GATING bowl
        // instructs ("cast FIRE to relight it"); the boss arena's tactical
        // bowls (stage −1) get the state voice only — an imperative implies
        // an objective, and the no-second-objective condition binds.
        rig.addShake(0.15);
        const now = performance.now();
        if (now - lastPyreBannerAt > 2500) {
          lastPyreBannerAt = now;
          hud.showBanner(
            "A pyre goes dark",
            pyre.stage >= 0 ? "cast FIRE to relight it" : undefined,
          );
        }
      } else {
        // A success the player engineered — steam, a banner, a modest shake
        // (§11). The spores were already paid sim-side so a replay pays them
        // too. The LAST douse of a gated stage gets its own words: the
        // objective just completed, and "the fire dies" undersells the gate
        // swinging open.
        rig.addShake(0.3);
        const stillBurning = state.hutFires.some(
          (hf) => hf.lit && !hf.keepLit && hf.stage === state.stageIndex,
        );
        hud.showBanner(stillBurning ? "The fire dies" : "The village breathes", "+3 spores");
      }
      particles.emit({
        count: 70,
        origin: [d.x, ground + (wasPyre ? 1.2 : 2.4), d.z],
        speed: 2.2,
        direction: [0, 1, 0],
        spread: 0.8,
        color: [...FX.wet],
        lifetime: 1.4,
        size: 0.3,
        gravity: -1.0, // steam rises
        intensity: 1.6,
      });
      // The hiss itself rides the shared audio feed (playDouse, round 6).
    }

    for (const r of ev.pyreLit) {
      // The relight (R4) — a success the player engineered, the douse's
      // mirror: flame burst at the bowl, the chip counts itself down.
      rig.addShake(0.3);
      const litGate = state.hutFires.some(
        (hf) => !hf.lit && hf.keepLit && hf.stage === state.stageIndex,
      );
      hud.showBanner(litGate ? "The pyre takes" : "The pyres burn", undefined);
      particles.emit({
        count: 60,
        origin: [r.x, heightAt(r.x, r.z) + 1.1, r.z],
        speed: 2.6,
        direction: [0, 1, 0],
        spread: 0.7,
        color: [...FX.burning],
        lifetime: 0.9,
        size: 0.24,
        gravity: -0.4,
        intensity: 2.2,
      });
    }

    for (const r of ev.rescued) {
      // The introduction (second playtest: "it should introduce itself") —
      // the camera leans in on the speaker and three one-liners play, while
      // the game keeps running. The banner this replaced taught nothing; the
      // bubble says who she is and what she is FOR (the SPARK at the
      // village), in words. PENDING rather than immediate: the s2 gate and
      // the rescue radius overlap by geometry, so the rescue can fire on the
      // same tick the stage-clear seam opens — and an intro under a modal
      // panel is two ceremonies talking over each other. drawFrame starts it
      // the first quiet frame, and owns the camera and the walk-away out.
      pendingIntro = r.name;
      particles.emit({
        count: 40,
        origin: [r.x, heightAt(r.x, r.z) + 1.2, r.z],
        speed: 1.8,
        spread: 1,
        color: [...FX.shocked],
        lifetime: 0.9,
        size: 0.12,
        gravity: 0.6,
        intensity: 2.6,
      });
    }

    if (ev.markersCleared.length > 0) {
      hud.showBanner("The grey gives way", `${state.loot} spores`);
      getPlatform().happytime();
      // The gate's refusal, voiced the first time it becomes real: the fight
      // is won, huts still burn, and the seam will not open around them
      // (round 7 — dousing is required). Gated on Sella following, like the
      // road rule: a beat needs its speaker.
      if (
        !saidDouseUrge &&
        state.hutFires.some((hf) => hf.lit && !hf.keepLit && hf.stage === state.stageIndex) &&
        state.bystanders.some((b) => b.name === SELLA_NAME && b.ai === "following")
      ) {
        saidDouseUrge = true;
        pendingSay = { lines: DOUSE_URGE_LINES, calm: true };
      }
    }

    /* ------------------------------------------------------------ grants */
    // The ceremony half of a find: the panel promised it, this is it landing.
    // The button's own flash comes from `setUnlocked` seeing the new element.
    // The subtitle is the stage's own grantsNote — authored per find and dead
    // data until now ("Sella shares the storm" never reached the screen).
    for (const g of ev.granted) {
      const label = CASTABLES.find((c) => c.element === g)?.label ?? g;
      const note = STAGES.find((st) => st.grants === g)?.grantsNote ?? "a new element joins the arc";
      hud.showBanner(`${label} found`, note);
      // ⚠️ NO `flashCombo` HERE (R6, fun's binding ruling on the find stack).
      // The banner and the flash were saying THE SAME WORD AT THE SAME INSTANT
      // — "SPARK found" at 18% of viewport height and "SPARK" at 24% — while
      // the arc button was already flashing on its own (`setUnlocked` seeing
      // the new element). **Three ceremonies for one event, two of them
      // carrying one word, stacked in one band.**
      //
      // Measured before the cut, at a real WATER grant: the banner renders 76px
      // tall against a 27px anchor gap, so at 800x450 and 390x844 the flash sat
      // ENTIRELY INSIDE the banner's rect, and at 1280x800 they overlapped by
      // 17px. Suppressing it here removes all four chapter-1 find collisions —
      // WATER, SPARK, FIRE, THE WEAVE — at zero layout cost.
      //
      // It also BUYS something rather than only removing: the flash now means
      // exactly one thing, *a mix landed*. Loudness costs vocabulary, and this
      // word was being spent twice on the same sentence.
      getPlatform().happytime();
      // The promise's second beat: SPARK is in hand, the pool is a stride
      // ahead, and Sella plants the question the trough answers.
      if (g === "lightning") pendingSay = { lines: SPARK_TAKE_LINES, calm: true };
    }
    if (ev.wove) {
      const note = STAGES.find((st) => st.grants === "weave")?.grantsNote ?? "two elements, one cast";
      hud.showBanner("The weave", note);
      // Same ruling as the element grants above: the banner already says it.
      getPlatform().happytime();
    }
    // The one-way road, stated once (round 6). Gated on Sella actually
    // FOLLOWING: pendingSay drops a beat whose speaker is missing, and a
    // pre-rescue bump must not burn the only telling of the rule.
    if (
      ev.roadBlocked &&
      !saidRoadBlocked &&
      state.foes.length === 0 &&
      state.bystanders.some((b) => b.name === SELLA_NAME && b.ai === "following")
    ) {
      saidRoadBlocked = true;
      pendingSay = { lines: ROAD_BLOCKED_LINES, calm: true };
    }

    /* ------------------------------------------------------------- seams */

    if (ev.heroDown) {
      // A queued line delivered after a revive would land as a non sequitur.
      pendingSay = null;
      showDefeat(false);
    }
    // The offer window ran out. Redraw without the revive — §8's five seconds
    // are the offer's whole life, and a button that outlives its own countdown
    // teaches the player that the countdown was decorative.
    if (ev.heroDefeated) showDefeat(true);
    if (ev.heroRevived) seam.close();
    if (ev.stageCleared >= 0) {
      // The promise's first beat: the gate that finds SPARK just closed its
      // stage, the gem stands on the road ahead, and Sella points at it.
      if (STAGES[ev.stageCleared]?.grants === "lightning") {
        // Queued on the clear, DELIVERED when the gem's chip is on screen —
        // see `awaitTake`. The gate disc is r 2.4 with its centre 3.47 m from
        // the gem, so a player who clears on the far side stands up to 5.87 m
        // away with the gem behind them; that spread is the whole defect.
        pendingSay = { lines: SPARK_POINT_LINES, calm: true, awaitTake: true };
      }
      showStageClear(ev.stageCleared);
    }
  }

  /* ---------------------------------------------------------- the seams */

  /**
   * Between states, in §8's sense: the loop stops and gameplay is reported as
   * stopped, so a rewarded offer is legal here and nowhere else.
   *
   * Deliberately NOT used for the defeat window, which keeps running — the
   * five seconds are sim ticks, the world carries on around the body, and
   * pausing would freeze the very countdown the panel is displaying.
   */
  function enterSeam(): void {
    loop.pause();
    getPlatform().gameplayStop();
  }
  function leaveSeam(): void {
    getPlatform().gameplayStart();
    loop.resume();
  }

  /** Persist. §7: at seams only, never mid-fight. */
  function autosave(): void {
    campaign.spores = state.loot;
    campaign.stage = state.stageIndex;
    campaign.chapter = chapterOfStage(state.stageIndex);
    // Held power is a DECISION now (finds are takeable, therefore skippable),
    // so the save records it rather than deriving it from the stages walked.
    campaign.found = encodeFound(state.unlocked, state.queueMax >= QUEUE_MAX);
    meta.lifetime.kills = lifetimeKillsBase + state.kills;
    meta.lifetime.spores = lifetimeSporesBase + state.loot;
    void saveCampaign(campaign);
    void saveMeta(meta);
  }

  /**
   * Build a rewarded action, or nothing at all.
   *
   * Returning `null` rather than a disabled button is the §8 rule that matters
   * most: an offer that cannot pay must not be on screen. Ads off, an
   * adblocker, a spent session cap and a daily cap all take this path, and none
   * of them ever produces a button that does nothing.
   */
  function rewarded(
    slot: RewardedSlot,
    label: string,
    onGrant: (multiplier: number) => void,
    stageIndex = -1,
  ): SeamAction | null {
    const offer = economy.offer(slot, campaign, stageIndex);
    if (!offer.available) return null;
    return {
      label,
      note: "watch a short ad",
      onPick: () => {
        void economy.claim(slot, campaign, stageIndex).then((granted) => {
          if (granted) onGrant(offer.multiplier);
        });
      },
    };
  }

  /**
   * The way out, as a seam button.
   *
   * Escape quits from anywhere (see `input/spell-input.ts`), but a player who
   * has just died is looking at a panel, not remembering a keybind — so the
   * panels that stop the action carry it explicitly. Same affordance Overrun
   * and Adventure put in their pause menus, same words.
   */
  function leaveAction(): SeamAction {
    return {
      label: "Back to playhouse",
      onPick: () => opts.onExit(),
    };
  }

  function showDefeat(final: boolean): void {
    const stage = STAGES[state.stageIndex];
    const entry = state.stageIndex > 0 ? state.stages[state.stageIndex - 1] : null;
    const restartAt = entry ? { x: entry.exitX, z: entry.exitZ } : { x: 0, z: 0 };

    const actions: SeamAction[] = [];
    // The rewarded revive, only while the window is open.
    if (!final) {
      const revive = rewarded("revive", "Get up", () => {
        externalQueue.push({ type: "revive" });
      }, state.stageIndex);
      if (revive) actions.push(revive);
    }
    // THE NON-AD PATH, and it is unconditional. §8 requires one to exist; the
    // simplest way to guarantee that through every future edit is to push it
    // outside every branch.
    actions.push({
      label: "Try again",
      note: stage ? `from the start of ${stage.name}` : undefined,
      onPick: () => {
        externalQueue.push({ type: "restartStage", ...restartAt });
        // Re-entering gameplay (§3). The loop was never paused — the world
        // keeps turning around a downed hero, which is the whole point of one
        // simulation on one clock.
        getPlatform().gameplayStart();
        reportZone();
      },
    });
    actions.push(leaveAction());

    seam.show({
      title: final ? "The rot takes you" : "You are down",
      subtitle: final ? undefined : "Get up, or start the stage over",
      countdown: !final,
      actions,
    });
    if (final) {
      meta.lifetime.defeats++;
      autosave();
      // An exit from gameplay (§3). Not a pause: the loop keeps running so the
      // world carries on behind the panel.
      getPlatform().gameplayStop();
    }
  }

  /** §3: crash-report context — where the player is, in our own words. */
  function reportZone(): void {
    getPlatform().setContext({ zone: STAGES[state.stageIndex]?.name ?? "camp" });
  }

  function showStageClear(index: number): void {
    // Cleared bit BEFORE the save that persists it. It used to be the line
    // after, which meant the bit only reached storage at the NEXT seam.
    markStageCleared(campaign, index);
    getPlatform().happytime();
    // §3, wired from day one: their load metric's sibling. The denominator is
    // the full campaign, so the number is honest now (huge steps, few stages)
    // and stays honest as Acts fill in.
    getPlatform().reportCompleted(((index + 1) / STAGES.length) * 100);

    const stage = STAGES[index];
    const chapter = chapterOfStage(index);
    const camp = isChapterEnd(index);
    const last = index >= STAGES.length - 1;

    /* ------------------------------------- the boundary: a toast, not a stop */
    // Third playtest: "a minimal checkpoint, not stopping the whole game
    // feeling." A stage boundary no longer opens a panel or pauses anything —
    // crossing the gate advances, saves, and slides a toast past a player who
    // never breaks stride. No `gameplayStop` either: with no offer on this
    // surface (§8's stage-double moved off it — see CLAUDE.md §8), gameplay
    // genuinely continues. The camp below keeps the full seam.
    if (!camp) {
      externalQueue.push({ type: "advanceStage" });
      // Written directly rather than via `autosave()`, which reads
      // `state.stageIndex` — and the command above does not apply until the
      // next tick, so autosave here would faithfully persist the stage the
      // player just finished.
      campaign.spores = state.loot;
      campaign.stage = index + 1;
      campaign.chapter = chapterOfStage(campaign.stage);
      campaign.found = encodeFound(state.unlocked, state.queueMax >= QUEUE_MAX);
      meta.lifetime.kills = lifetimeKillsBase + state.kills;
      meta.lifetime.spores = lifetimeSporesBase + state.loot;
      void saveCampaign(campaign);
      void saveMeta(meta);
      getPlatform().setContext({ zone: STAGES[campaign.stage]?.name ?? "camp" });

      const what =
        stage?.grants === "weave"
          ? "THE WEAVE"
          : stage?.grants
            ? (CASTABLES.find((c) => c.element === stage.grants)?.label ??
              String(stage.grants))
            : null;
      hud.showBanner(
        `${stage?.name ?? "Stage"} — clear`,
        what ? `ahead: ${what}` : `${state.loot} spores · ${state.kills} felled`,
      );
      return;
    }

    /* --------------------------------------------- the camp: the real seam */
    enterSeam();
    autosave();

    const actions: SeamAction[] = [];
    const bonus = rewarded("campCrate", "Open a supply crate", (m) => {
      state.loot += Math.round(40 * m);
      autosave();
      hud.showBanner("Supplies", `+${Math.round(40 * m)} spores`);
    });
    if (bonus) actions.push(bonus);

    actions.push({
      label: last ? "Walk it again" : "Onward",
      note: last ? "the road ends here, for now" : undefined,
      onPick: () => {
        if (last) externalQueue.push({ type: "newRun", x: 0, z: 0 });
        else externalQueue.push({ type: "advanceStage" });
        campaign.stage = last ? 0 : index + 1;
        campaign.chapter = chapterOfStage(campaign.stage);
        if (last) {
          campaign.cleared = 0;
          // Walking it again resets the finds too (`newRun` stands them up).
          campaign.found = 0;
        } else {
          campaign.found = encodeFound(state.unlocked, state.queueMax >= QUEUE_MAX);
        }
        void saveCampaign(campaign);
        leaveSeam();
        // After the command lands, the sim's stage index has moved — one tick
        // later. Named from the SAVE's number, which is already the new stage.
        getPlatform().setContext({ zone: STAGES[campaign.stage]?.name ?? "camp" });
      },
    });
    actions.push(leaveAction());

    seam.show({
      title: "Camp",
      subtitle: `${CHAPTERS[chapter]?.name ?? "The road"} — the fires are banked`,
      rows: [
        { label: "Spores", value: String(state.loot) },
        { label: "Felled", value: String(state.kills) },
        { label: "Mixes found", value: `${discoveredCount(campaign)} / ${MIX_COUNT}` },
      ],
      actions,
    });

    // §8: midgame ads at chapter ends and camp returns ONLY, never on a stage
    // boundary. The SDK owns the cooldown; `adCooldown` back is the expected
    // answer and not an error.
    economy.midgame("camp", chapter);
  }

  /* ---------------------------------------------------------------- loop */

  let lastFrame = performance.now();
  /** Seconds of calm before the camera returns to the walking framing. */
  let fightLinger = 0;
  // R4: seconds left on the Thornback's entrance push-in, and the edge
  // detector that starts it. Presentation only — the fight is already live
  // underneath it (§5: the push-in freezes nothing).
  let bossIntro = 0;
  let hadBoss = false;
  // The stage frame's velocity look-ahead — persistent so it eases rather
  // than snaps when walking starts, stops, or a fight takes the lens.
  const frameLead: FrameLead = { x: 0, z: 0 };
  // The world-space latch for held movement, shared between the command
  // gather (which writes it) and the follow-yaw (which reads it). Rule 4 in
  // rt-commands.ts — the latch is what lets the camera turn under a held key
  // without the two chasing each other.
  const moveLatch = newMoveLatch();
  const followYaw = new FollowYaw();
  // Reused per frame for the foe HP bars — no per-frame allocation.
  const foeBarScratch: { id: number; x: number; y: number; frac: number; boss?: boolean }[] = [];
  /**
   * Boss ids whose bar has ever shown (fun's R4 finding): a boss bar, once
   * earned, stays up through full-hp drink-backs. Ids are unique per run,
   * so the set stays trivially small; a stage retry spawns fresh ids.
   */
  const bossBarSeen = new Set<number>();
  /**
   * What the last tick reported, for the debug handle.
   *
   * A headless driver advances with `step()` and gets no event list back, so
   * anything that exists only as an EVENT — the chain firing, a combo landing,
   * an ignition — was invisible to a browser check and had to be inferred from
   * state. It usually cannot be: the Wet+Lightning chain kills both targets on
   * the tick it lands, so "two shocked foes" never appears in any state a
   * driver can sample. This is how §14's "verify it in a real browser" reaches
   * the things the unit tests measure off events.
   */
  let lastEvents: RtEvents | null = null;

  function gatherCommands(): RtCommand[] {
    return gatherRtCommands({
      input,
      hero: state.hero,
      yaw: rig.currentYaw,
      cursorGround,
      latch: moveLatch,
      out: commandQueue,
      external: externalQueue,
    });
  }

  /**
   * Draw one frame.
   *
   * Named rather than inlined into the loop so the debug handle can render
   * without a `requestAnimationFrame`. Browsers do not fire rAF for a hidden
   * document, so a scripted run in a background tab gets a live simulation and
   * a frozen picture — which looks exactly like a crash.
   */
  function renderFrame(alpha: number, dtOverride?: number): void {
    const now = performance.now();
    const dt = dtOverride ?? Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    drawFrame(dt, alpha);
  }

  let fireEmitAcc = 0;

  function drawFrame(dt: number, alpha: number): void {
    quality.sample(dt * 1000);
    resize();

    view.update(dt, state, alpha);
    particles.update(dt);
    emitFires(dt);
    // Bolt trails, the charge glow, and breathing fire patches — shared with
    // the sandbox via the fx module.
    eventFx.update(dt, state);

    // The lit gate breathes too: a slow rise of lantern-warm motes between
    // the posts, so "the road is open" reads from across the stage. Campaign
    // dressing, so it stays with this entry.
    fireEmitAcc += dt;
    if (fireEmitAcc >= 0.08) {
      fireEmitAcc = 0;
      const beacon = view.gateBeacon(state);
      if (beacon) {
        particles.emit({
          count: 2,
          origin: [beacon.x, beacon.y + 1.2, beacon.z],
          speed: 0.7,
          direction: [0, 1, 0],
          spread: 0.5,
          color: [...FX.colourRestored],
          lifetime: 1.6,
          size: 0.14,
          gravity: -0.5,
          intensity: 2.2,
        });
      }
    }

    /* ----------------------------------------------------------------- hud */
    const h = state.hero;
    spellHud.setHealth(h.hp, h.maxHp);
    // Recharge reads the live sim timer — 1 when ready, filling as the
    // recovery runs out (third playtest's "loading bar").
    spellHud.setRecharge(h.castCd > 0 ? 1 - h.castCd / Math.max(1, state.castCooldown) : 1);
    spellHud.setStatuses(h.statuses.map((st) => st.id as StatusId));
    spellHud.setCastSelf(input.castHeldPastThreshold(performance.now()));
    spellHud.setStick(input.stickVisual());
    if (queueDirty) {
      queueDirty = false;
      spellHud.setQueue(h.queue);
    }
    // The growing arc. Both early-out on no change, so per-frame is free.
    spellHud.setUnlocked(state.unlocked);
    spellHud.setQueueMax(state.queueMax);
    hud.setLoot(state.loot);
    // The douse objective (round 7): once the stage's fight is won, the only
    // thing between the player and the gate is fires — count them, name the
    // tool. Read live off the sim every frame so the chip counts itself down
    // and vanishes with the last hiss; hidden during the fight because a
    // fight IS the objective while it lasts.
    const litGating = state.hutFires.filter(
      (hf) => hf.lit && !hf.keepLit && hf.stage === state.stageIndex,
    ).length;
    // The pyre objective (R4): the inverse count — bowls gone DARK on the
    // gating stage, named with their tool exactly like the douse chip.
    const darkGating = state.hutFires.filter(
      (hf) => !hf.lit && hf.keepLit && hf.stage === state.stageIndex,
    ).length;
    // The left-behind find (R4): the seam refuses to close behind an untaken
    // find (rt/step.ts 2c), so once this stage's fight is won the only thing
    // between the player and the gate can be a find they walked past — name
    // it, the way the douse chip names the fires. Shown only after the
    // fight, like the douse chip, so it never nags a player who is still on
    // their way to the gem; read live off the sim, so the take clears it on
    // the spot. The douse objective outranks it (they cannot both gate one
    // seam in chapter 1, but priority is cheap and explicit).
    //
    // ⚠️ R6, fun's live finding, and it is R4's own defect one layer up. This
    // component identified the missing find BY NAME at every point of the Dry
    // Gulch's runway — `leftBehindCandidate: "weave"` at the s5 gate, past the
    // gem and inside the triggered fight — and said nothing at all three,
    // because `fightDone` waits for the current stage's fight to be cleared
    // and that fight is the one the player cannot win without the thing this
    // banner would name. The comment above is right for the normal case and
    // exactly inverted for that one: on the gulch runway the player is PAST
    // the gem and walking into the fight that needs it, which is the one
    // moment nagging is the correct behaviour. So a find that the current
    // stage's fight cannot be won without shows IMMEDIATELY — before the
    // fight, and during it.
    //
    // The predicate is `rt/step.ts`'s `leftBehindFind`, not a second inline
    // copy: the gate conjunct and this chip had drifted into two predicates
    // with different answers, which is precisely how the run stayed winnable
    // while the player was never told why it had stopped being winnable-looking.
    const held = leftBehindFind(state);
    const leftLabel = held
      ? held.pickup.kind === "weave"
        ? "THE WEAVE"
        : (CASTABLES.find((c) => c.element === held.pickup.kind)?.label ??
          String(held.pickup.kind))
      : null;
    const fightDone = state.markers.every(
      (m) => m.stage !== state.stageIndex || m.cleared,
    );
    // Shown through a live fight only in the blocked case — the normal chip
    // still waits for quiet, because a fight IS the objective while it lasts.
    const nagNow = held?.blocking === true;
    hud.setObjective(
      litGating > 0 && state.foes.length === 0 && !state.autorun
        ? `${litGating} hut${litGating === 1 ? "" : "s"} still burn${litGating === 1 ? "s" : ""} — cast WATER`
        : darkGating > 0 && state.foes.length === 0 && !state.autorun
          ? `${darkGating} pyre${darkGating === 1 ? "" : "s"} gone dark — cast FIRE`
          : leftLabel &&
              (nagNow || (fightDone && state.foes.length === 0 && !state.autorun))
            ? `${leftLabel} left behind — walk back and take it`
            : null,
    );
    // The defeat countdown, read off the sim rather than off a second timer.
    // `hero.downTicks` is the only clock; this is a view of it (§4).
    if (h.downTicks > 0) seam.setCountdown(h.downTicks / TICK_HZ);

    /* -------------------------------------------------------------- camera */
    // The framings survive the pivot (§5) — what died is the FREEZE, not the
    // camera. A fight still pulls the frame in; it simply does so while the
    // world keeps running. The linger stops a snap-back cutting the last kill.

    // A queued introduction starts on the first quiet frame: no seam panel,
    // no fight, hero upright, speaker still close. If the player has already
    // walked off, it is dropped without a word — an intro that chases the
    // player down is worse than none.
    if (pendingIntro && !seam.open && state.foes.length === 0 && h.downTicks === 0 && !h.defeated) {
      const who = state.bystanders.find((b) => b.name === pendingIntro);
      if (who && Math.hypot(h.x - who.x, h.z - who.z) <= 4) {
        introFocus = pendingIntro;
        dialogue.start(who.name, INTRO_LINES, () => {
          introFocus = null;
        });
      }
      pendingIntro = null;
    }

    // A follower one-liner waits the same way, but never takes the camera,
    // and a non-`calm` beat may start under fire. Starting one ends whatever
    // bubble is up (latest beat wins) — the right outcome when the player
    // sprints from the gem straight into the next trigger. The follower is
    // at heel, so the 9 m gate only drops a beat whose speaker is missing.
    // The TAKE chip rides the find in range (third playtest: "walk up to the
    // item, press E to pick up" — F here, E composes FROST). Same projection
    // as the bubble; the chip is also touch's TAKE button.
    //
    // ⚠️ COMPUTED HERE, ABOVE `pendingSay`, AND THE ORDER IS THE POINT. This
    // scan used to sit ~160 lines below, next to the chip's own draw. A beat
    // gating on `awaitTake` would then have been reading the PREVIOUS frame's
    // answer — a measurement of the wrong instant, which is the one mistake
    // this codebase has paid for most often. One scan, both consumers, and the
    // consumer that decides comes first.
    let takeable: (typeof state.pickups)[number] | null = null;
    let takeD = PICKUP_RADIUS;
    for (const p of state.pickups) {
      if (p.taken || !state.stages[p.stage]?.cleared) continue;
      const d = Math.hypot(h.x - p.x, h.z - p.z);
      if (d <= takeD) {
        takeD = d;
        takeable = p;
      }
    }

    if (
      pendingSay &&
      !seam.open &&
      h.downTicks === 0 &&
      !h.defeated &&
      (!pendingSay.calm || state.foes.length === 0) &&
      // The referent, not the occasion (R6, fun).
      (!pendingSay.awaitTake || takeable !== null)
    ) {
      const who = state.bystanders.find((b) => b.name === SELLA_NAME && b.ai === "following");
      if (who && Math.hypot(h.x - who.x, h.z - who.z) <= 9) {
        // `start` first: it ends the previous bubble, whose onDone clears the
        // old focus — the new focus must be written after that fires.
        dialogue.start(who.name, pendingSay.lines, () => {
          sayFocus = null;
        });
        introFocus = null;
        sayFocus = who.name;
      }
      pendingSay = null;
    }

    // The introduction: the previously-unused `boss` framing leans in on the
    // speaker. Ends early only if the player walks away (a conversation is
    // an offer, not a cage) or the hero goes down — the defeat panel must
    // never open over a camera looking at someone else. A FIGHT no longer
    // ends it (the third playtest lost Sella's lines to exactly that): the
    // bubble lingers through combat, only the camera yields.
    const focusName = introFocus ?? sayFocus;
    const speaker = focusName
      ? state.bystanders.find((b) => b.name === focusName)
      : undefined;
    if (
      dialogue.active &&
      (!speaker ||
        h.downTicks > 0 ||
        h.defeated ||
        Math.hypot(h.x - speaker.x, h.z - speaker.z) > 6)
    ) {
      dialogue.end();
    }
    const bubbleTarget = dialogue.active && speaker ? speaker : null;
    // The camera lean-in belongs to the INTRO in a quiet moment only — a
    // fight takes the lens back, a follower one-liner never gets it at all,
    // and the bubble simply rides the speaker through either.
    const intro = introFocus && bubbleTarget && state.foes.length === 0 ? bubbleTarget : null;

    const fighting = state.foes.length > 0;
    fightLinger = fighting ? 1.4 : Math.max(0, fightLinger - dt);
    // The Thornback's entrance (R4): its first appearance in the foe list
    // hands the lens a ~2 s push-in on the boss itself — then the fight runs
    // on the encounter framing every other fight has already proven. The
    // sim never pauses under it, and a dead/cleared boss releases instantly.
    const boss = state.foes.find((f) => f.kindId === "thornback" && f.hp > 0);
    if (boss && !hadBoss) bossIntro = 2.0;
    hadBoss = !!boss;
    bossIntro = boss ? Math.max(0, bossIntro - dt) : 0;
    const mode: CameraMode = intro
      ? "lean"
      : boss && bossIntro > 0
        ? "boss"
        : fighting || fightLinger > 0
          ? "encounter"
          : "stage";
    rig.setMode(mode);

    // Frame the hero, biased toward the thick of it so a fight behind you is
    // still on screen. Presentation only; the sim never learns a camera exists.
    // On the open road the frame also LEADS the walk (round 5: the hairpin
    // legs run screen-right, where an unled frame shows ~0.78 s ahead).
    updateFrameLead(frameLead, h.vx, h.vz, !intro && !fighting, dt, rig.currentYaw);
    let fx = h.x;
    let fz = h.z;
    if (intro) {
      fx = intro.x;
      fz = intro.z;
    } else if (boss && bossIntro > 0) {
      // The push-in frames the BOSS, not the hero — the one framing in the
      // game whose subject is the enemy (§5's cinematic, §13's cover).
      fx = boss.x;
      fz = boss.z;
    } else {
      if (fighting) {
        let cx = 0;
        let cz = 0;
        for (const f of state.foes) {
          cx += f.x;
          cz += f.z;
        }
        cx /= state.foes.length;
        cz /= state.foes.length;
        fx += (cx - h.x) * 0.22;
        fz += (cz - h.z) * 0.22;
      }
      // Applied before the ground sample so the terrain height and shadow
      // anchor follow the led frame, not the hero's feet.
      fx += frameLead.x;
      fz += frameLead.z;
    }
    const groundY = heightAt(fx, fz);
    // The walking frame follows the commanded walk; fights, the intro lean-in
    // and the linger return to the authored yaw placement pre-cleared.
    rig.setYaw(followYaw.update(dt, moveLatch.movedDx, moveLatch.movedDz, mode === "stage"));
    rig.update(dt, fx, groundY, fz, groundY);
    // Blockers between the rotated lens and the hero screen-door out. At the
    // authored yaw the strength is 0 and today's pixels are untouched.
    {
      const off = Math.atan2(
        Math.sin(rig.currentYaw - DIORAMA_YAW),
        Math.cos(rig.currentYaw - DIORAMA_YAW),
      );
      const t = Math.min(1, Math.max(0, (Math.abs(off) - 0.15) / 0.35));
      world.setSightLine(
        rig.camera.position.x,
        rig.camera.position.y,
        rig.camera.position.z,
        h.x,
        heightAt(h.x, h.z) + 1.2,
        h.z,
        t * t * (3 - 2 * t),
      );
    }

    // Foe HP bars, world-anchored over every hurt foe (round 5). Projection
    // happens HERE, after the rig update, same as every other anchored chip;
    // the interpolated body position comes from the view so the bar rides
    // the rendered puppet, not the sim tick.
    //
    // BOSS exception to the shown-only-once-hurt rule (fun's R4 boss-pass
    // finding): once a boss has EVER been hurt its bar stays up at full hp
    // too — the soak-regen drinking back to FULL is exactly the moment the
    // player most needs to see, and the old rule removed the bar right
    // then. Roster foes keep the rule: their full bar is noise.
    foeBarScratch.length = 0;
    for (const f of state.foes) {
      if (!f.alive) continue;
      const boss = !!foeKind(f.kindId).boss;
      if (boss && f.hp < f.maxHp) bossBarSeen.add(f.id);
      if (f.hp >= f.maxHp && !(boss && bossBarSeen.has(f.id))) continue;
      const p = view.foePosition(f.id);
      if (!p) continue;
      // Anchor height is per-kind (R4): a flat 1.6 m put the bar INSIDE the
      // 2.15 m thornback's face, and clipped it off the top of the entrance
      // cinematic (fun's frame + the capture record agree).
      const spot = new Vector3(p.x, p.y + foeBarHeight(f.kindId), p.z).project(rig.camera);
      if (spot.z > 1) continue;
      foeBarScratch.push({
        id: f.id,
        x: (spot.x * 0.5 + 0.5) * innerWidth,
        y: (-spot.y * 0.5 + 0.5) * innerHeight,
        frac: f.hp / f.maxHp,
        boss,
      });
    }
    spellHud.updateFoeBars(foeBarScratch);

    if (takeable && !seam.open && h.downTicks === 0 && !h.defeated) {
      const what =
        takeable.kind === "weave"
          ? "THE WEAVE"
          : (CASTABLES.find((c) => c.element === takeable!.kind)?.label ?? String(takeable.kind));
      spellHud.setTake(`${input.touchMode ? "" : "F · "}take ${what}`);
      const spot = new Vector3(
        takeable.x,
        heightAt(takeable.x, takeable.z) + 2.1,
        takeable.z,
      ).project(rig.camera);
      spellHud.placeTake((spot.x * 0.5 + 0.5) * innerWidth, (-spot.y * 0.5 + 0.5) * innerHeight);
    } else {
      spellHud.setTake(null);
    }

    // The bubble rides the speaker's head — the first world-anchored UI in
    // the codebase, and the projection happens HERE, after the rig update,
    // so it never lags the camera by a frame. Anchored to `bubbleTarget`
    // rather than `intro`: it stays up through a fight.
    if (bubbleTarget) {
      dialogue.tick(dt);
      const head = new Vector3(
        bubbleTarget.x,
        heightAt(bubbleTarget.x, bubbleTarget.z) + 1.75,
        bubbleTarget.z,
      ).project(rig.camera);
      dialogue.place((head.x * 0.5 + 0.5) * innerWidth, (-head.y * 0.5 + 0.5) * innerHeight);
    }
    world.update(
      dt,
      rig.camera.position.x,
      rig.camera.position.y,
      rig.camera.position.z,
      rig.camera.far,
      // Shadow frustum anchors to the framed GROUND position, never the
      // camera — see World.updateShadowAnchor.
      fx,
      groundY,
      fz,
    );

    // The resaturation drive writes the grade last, just before the present —
    // drain, wave front and pulse are all per-frame uniform writes.
    resat.update(dt, state);
    threatEdge.update(state, rig.camera, dt);
    post.render(world.scene, rig.camera);
  }

  /**
   * One tick, plus the two things that have to happen around it.
   *
   * Extracted because the debug handle's `step()` also advances the sim, and a
   * scripted run that skipped grimoire discovery would make the headless
   * pedagogy checks measure a different game from the one a player plays (§6:
   * a debug handle that does not take the game's own path is a debug handle
   * that lies).
   */
  function simStep(batch: RtCommand[]): void {
    // The mix has to be read BEFORE the tick — `rtStep` empties the queue into
    // `hero.casting` the moment it accepts a cast, so afterwards there is
    // nothing left to record.
    //
    // And it is the queue PLUS whatever this batch is about to add, which is
    // not a nicety: `rtStep` processes queue commands and the cast in one pass
    // over one command list, so a mix composed and fired inside a single tick
    // is entirely in the batch and not yet in `hero.queue`. Reading only the
    // queue recorded nothing at all for those — found by driving the opening
    // in a browser and watching the grimoire stay at 0 through a run that cast
    // a dozen times.
    const pending = batch.flatMap((c) => (c.type === "queue" ? [c.element] : []));
    const mix = [...state.hero.queue, ...pending].slice(0, QUEUE_MAX);
    const casting = batch.some((c) => c.type === "cast") && !state.hero.casting && mix.length > 0;

    applyEvents(rtStep(simWorld, state, batch));

    // The grimoire is a RECORD of what you worked out (`GAME_DESIGN.md` §4),
    // so it fills in on the cast, not on the kill — including fizzles, because
    // discovering that FIRE and WATER annihilate is a lesson and one the player
    // paid a cast for.
    if (casting && discover(campaign, mix)) {
      // ⚠️ THE BANNER, NOT THE FLASH (R7, fun's binding ruling on the double
      // flash) — and the reason is that these two words were never about the
      // same object.
      //
      // `discover()` fires on the CAST tick; `flashCombo(combo.label)` fires
      // on the IMPACT tick, one bolt-flight later. Both landed in the same
      // channel 34 px apart, so the player saw "NEW MIX" pop and then a
      // second word shove in above it a beat later — **two pops, one place**,
      // reading as one two-line message about one thing.
      //
      // They are two things. `"Chain!"` is the PEDAGOGY: *the water made the
      // lightning jump*, which is the lesson the Mire Pool exists to teach.
      // `"NEW MIX"` is the REWARD: the grimoire grew. **Pedagogy keeps the
      // flash channel; the reward moves to where rewards already live** —
      // the same shape as the grant suppression one channel along, where the
      // flash went and the banner kept the ceremony.
      //
      // The banner also says MORE than the flash did: it names the mix the
      // grimoire actually records, where "NEW MIX" was the generic word for
      // it. fun measured all three viewports with a real fight behind it —
      // flash 253..283, banner 81..157, objective chip 41..75 at 800x450 —
      // and no pair collides.
      //
      // COST ACCEPTED AND RECORDED (fun's words, so nobody discovers it
      // later): a 4.2 s opaque panel mid-fight, ~14x in chapter 1, and one
      // more claimant on the banner slot's `MIN_DWELL`. If the slot cost ever
      // reds a gate, fun has PRE-RULED fallback B ship: suppress this
      // discovery flash only on casts whose impact will also flash a combo,
      // and let it fire alone otherwise.
      hud.showBanner(resolveMix(mix, "aimed").name, "new in the grimoire");
    }
  }

  const loop = createLoop({
    simTick: () => simStep(gatherCommands()),
    render: (alpha) => renderFrame(alpha),
  });

  setGameHooks({
    pause: () => loop.pause(),
    resume: () => loop.resume(),
    mute: () => audio.setAdMuted(true),
    unmute: () => audio.setAdMuted(false),
  });
  // Blur/hide → pause is right for players but makes headless driving and the
  // deterministic capture rig impossible (a driven browser's focus churns
  // constantly). The debug handle can switch it off.
  let autopause = true;
  installBrowserQuirks(canvas, {
    suspend: () => {
      if (autopause) loop.pause();
      // §11: pause AND mute on visibilitychange — their documented Samsung App
      // fix, and simple courtesy in a browser tab.
      audio.setAdMuted(true);
    },
    resume: () => {
      loop.resume();
      audio.setAdMuted(false);
      audio.unlock(); // iOS suspends the context on tab-out
    },
  }, listen);

  function teleportTo(x: number, z: number): void {
    state.hero.x = x;
    state.hero.z = z;
    state.hero.vx = 0;
    state.hero.vz = 0;
  }

  /* -------------------------------------------------------- debug handle */

  // Automation seam. Gated so it is statically dead in production, matching
  // Adventure's window.__adventure. Renamed off `__game` — the site hosts
  // three of them now.
  const devHandle: Record<string, unknown> = {
    loop,
    renderer,
    world,
    rig,
    quality,
    post,
    particles,
    simWorld,
    input,
    view,

    getState: () => state,
    /** What the last tick reported. See `lastEvents`. */
    events: () => lastEvents,
    hashState: () => hashRt(state),
    enqueue: (cmd: RtCommand) => externalQueue.push(cmd),

    /**
     * Advance `n` ticks and draw.
     *
     * Goes through `gatherCommands` so a scripted run takes the game's own
     * path — a debug handle that does not is a debug handle that lies (§6) —
     * and DRAWS at the end, because a hidden document fires no rAF and a
     * scripted run would otherwise look like a crash.
     *
     * alpha = 1, not 0: `RtView` interpolates now, so alpha 0 would draw the
     * PREVIOUS tick and every scripted measurement would be 33 ms stale.
     */
    step: (n: number, cmd?: RtCommand) => {
      for (let i = 0; i < n; i++) {
        const batch = gatherCommands();
        if (cmd) batch.push(cmd);
        simStep(batch);
      }
      renderFrame(1, 1 / TICK_HZ);
    },
    /** Draw without advancing — for capture between scripted steps. */
    render: () => renderFrame(1, 1 / TICK_HZ),

    /**
     * Move the hero, zeroing velocity.
     *
     * ⚠️ USE THIS TO GO BACKWARD. NEVER `step(n, walkSouth)` (R5, the
     * backward-walk rig trap — same family as `startStage`'s forward-only
     * note below, and it cost gfx a re-measurement it could not reproduce).
     *
     * THE ROAD IS ONE-WAY (`rt/step.ts` §8b): samples before the previous
     * stage's gate stop counting as road, so the corridor clamp runs out of
     * corridor ~CORRIDOR_HALF behind the last crossed gate and a hero walked
     * south simply STOPS there. That is correct for players and it is a
     * silent no-op for a rig: no error, no event, no `roadBlocked` a driver
     * is obliged to read — the loop just keeps stepping and the pose keeps
     * not changing.
     *
     * ***How it is detected, and it is the only reason it was:*** two
     * scripted approaches that backed off along the road by different amounts
     * returned BYTE-IDENTICAL camera poses. Both had backed into the same
     * gate. An impossible coincidence is the tell; without one, a backward
     * walk reports a plausible wrong number rather than a failure.
     *
     * The general rule this belongs to: **every player-facing constraint is a
     * potential silent no-op for a harness, and the harness will not say so.**
     * If a scripted measurement depends on WHERE the hero ended up, assert
     * the pose you asked for — do not assume the walk delivered it.
     */
    teleport: (x: number, z: number) => teleportTo(x, z),
    setAutopause: (on: boolean) => {
      autopause = on;
      if (!on) loop.resume();
    },
    setQuality: (t: Tier) => quality.set(t),
    setCamera: (m: CameraMode) => rig.setMode(m),

    // Scripted content, for driving the funnel and for capture.
    spawn: (kindId: string, x: number, z: number) =>
      externalQueue.push({ type: "spawn", kindId, x, z }),
    cast: (elements: Element[], form: "aimed" | "self" = "aimed") => {
      for (const e of elements) externalQueue.push({ type: "queue", element: e });
      const aim = { x: state.hero.x + state.hero.fx * 9, z: state.hero.z + state.hero.fz * 9 };
      externalQueue.push({ type: "cast", form, aimX: aim.x, aimZ: aim.z });
    },

    /* --------------------------------------------- campaign + seam driving */
    // Planned in §6 and now real, because the stage chain, the defeat state and
    // the save are exactly the things that cannot be verified from a unit test:
    // they only exist once the app, the sim and the DOM are wired together.
    startStage: (i: number) => {
      // The same derivation a resume runs — flags, held power, and which
      // finds still stand — so a debug jump is a legal save, not a powerless
      // hero staring down a fight the curriculum assumes gear for.
      //
      // ⚠️⚠️ IT IS A RESUME, NOT A RESET — AND FOUR THINGS SURVIVE IT (R6,
      // fun; three of them produced wrong runs before they were named).
      // METHOD 16c is the general form: when you reset state, ask what ELSE
      // survives, because the list is never the one you wrote.
      //
      //   1. `pickups` ARE NOT RESET. On a page carrying an existing save the
      //      finds stand taken, so a jump meant to reproduce a SKIPPER reports
      //      `weaveTaken: true, queueMax: 2` before a single tick and silently
      //      measures a hero holding the very thing under test. Clear
      //      `localStorage` and reload first, and ASSERT the condition you
      //      think you arranged rather than assuming it.
      //   2. LIVE FOES ARE NOT CLEARED. Whatever was chasing you is still
      //      chasing you, at the new position.
      //   3. IT LANDS ON THE FIGHT, not at the approach. The hero is put at
      //      the PREVIOUS stage's exit, so the target stage's walk-in is
      //      already spent — there is no approach left to measure, which
      //      makes it the wrong tool for any framing or pacing question.
      //   4. `teleport` IS CLAMPED BY THE ONE-WAY CORRIDOR. Asked for
      //      (−7, 91) at stage 8 it delivered (−3.4, 95.9). It reports no
      //      error; the only reason that was caught is that fun asserted the
      //      pose it had asked for. Always read back the position.
      //
      // ⚠️ FORWARD-ONLY IN PRACTICE (R4.5, fun's harness note — it cost them
      // twenty minutes and nearly a false regression report). Jumping BACKWARD
      // (7 → 5) rewinds `stageIndex` but leaves the higher stages' `cleared`
      // flags set, so the seam never fires and the index pins where it was
      // put. Anything keyed on stage index — the companion's hold point, the
      // corridor's one-way boundary — then behaves correctly for a stage the
      // driver did not think it was in, which reads exactly like an AI
      // regression. To go backward, reload the page and jump forward.
      const idx = Math.max(0, Math.min(state.stages.length - 1, i));
      state.stageIndex = idx;
      applyResume(state, idx, foundBitsThroughStage(idx));
      const entry = idx > 0 ? state.stages[idx - 1] : null;
      teleportTo(entry?.exitX ?? 0, entry?.exitZ ?? 0);
    },
    kill: () => {
      state.hero.hp = 0;
      state.hero.iframes = 0;
    },
    getSave: () => ({ meta, campaign }),
    economy: () => ({
      ...economy.stats(),
      offers: Object.fromEntries(
        (["stageDouble", "revive", "lootReroll", "campCrate", "grimoireHint", "bossAffix"] as const).map(
          (s) => [s, economy.offer(s, campaign, state.stageIndex)],
        ),
      ),
    }),
    seam: () => ({
      open: seam.open,
      title: document.querySelector(".seam-title")?.textContent ?? null,
      actions: [...document.querySelectorAll(".seam-btn")].map((b) => b.textContent),
    }),

    stats: () => ({
      tier: quality.settings.tier,
      foliage: world.foliageCount,
      calls: post.sceneStats.calls,
      triangles: post.sceneStats.triangles,
      tick: state.tick,
      hero: {
        x: state.hero.x,
        z: state.hero.z,
        hp: state.hero.hp,
        down: state.hero.downTicks,
        defeated: state.hero.defeated,
      },
      foes: state.foes.length,
      patches: state.patches.length,
      loot: state.loot,
      stage: state.stageIndex,
      stages: state.stages.map((s2) => ({ id: s2.id, cleared: s2.cleared })),
      lock: state.lock,
      mixes: discoveredCount(campaign),
      markers: state.markers.map((m) => ({
        id: m.id,
        stage: m.stage,
        triggered: m.triggered,
        cleared: m.cleared,
      })),
    }),
  };

  if (DEV_HANDLES) {
    (window as unknown as Record<string, unknown>).__greyrot = devHandle;
  }

  getPlatform().loadingStop();
  loop.start();

  // §3: the first frame of real interactivity, not the loading screen. Pim is
  // already running down the road by the time this fires — which is the whole
  // point of `state.autorun` being sim-side.
  //
  // game2 dropped a boot ring here. The site has no loading screen to drop:
  // the sky and terrain render from the first frame, which was always the
  // intent ("the loading screen IS the world").
  getPlatform().gameplayStart();
  reportZone();

  /* ---------------------------------------------------------- the handle */

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;

      // Order matters: stop simulating before tearing down what the sim
      // draws into, or a final in-flight frame renders against disposed
      // geometry.
      loop.stop();
      input.detach();
      audio.dispose();

      view.dispose();
      post.dispose?.();
      particles.dispose?.();
      world.dispose?.();
      // SpellHud and Seam attach only to elements under `uiRoot`, which the
      // route removes wholesale — they need no teardown of their own. These
      // two reach outside it: Hud onto a timer, Dialogue onto `document`.
      hud.destroy();
      dialogue.destroy();

      // dispose() frees the GPU objects; forceContextLoss() releases the
      // context itself. Without the second call Chrome keeps the context
      // alive against its ~16-context limit, and the ninth visit to the
      // route renders nothing at all.
      renderer.dispose();
      renderer.forceContextLoss?.();

      for (const d of disposers) d();
      disposers.length = 0;

      if (DEV_HANDLES) delete (window as unknown as Record<string, unknown>).__greyrot;
    },
  };
}
