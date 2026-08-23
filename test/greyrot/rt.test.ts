import { describe, expect, it } from "vitest";
import {
  FOES,
  PATCH_TICKS,
  QUEUE_MAX,
  STAGES,
  captiveHoldStage,
  encodeFound,
  foeKind,
  foundBitsThroughStage,
  type Element,
} from "../../lib/greyrot/content";
import {
  ALLY_JOIN_RADIUS,
  CORRIDOR_HALF,
  CORRIDOR_PULL,
  DOWN_TICKS,
  HERO_RADIUS,
  HERO_SELF_DAMAGE,
  LEASH_RADIUS,
} from "../../lib/greyrot/sim/constants";
import { applyElement, addStatus, hasStatus, type ActiveStatus } from "../../lib/greyrot/sim/rt/damage";
import {
  addPatch,
  elementOnField,
  fieldSlipAt,
  fieldStatusesAt,
  stepField,
  MAX_PATCHES,
  type FieldPatch,
} from "../../lib/greyrot/sim/rt/field";
import { forwardAimPoint, leadPoint } from "../../lib/greyrot/sim/rt/aim";
import { PROJECTILE_SPEED, resolveMix } from "../../lib/greyrot/sim/rt/spell";
import {
  createRtState,
  hashRt,
  cloneRtState,
  type RtMarker,
  type RtState,
} from "../../lib/greyrot/sim/rt/state";
import {
  PICKUP_RADIUS,
  leftBehindFind,
  rtStep,
  spawnFoe,
  type RtCommand,
} from "../../lib/greyrot/sim/rt/step";
import {
  SELLA_NAME,
  applyResume,
  buildScenario,
  scenarioHeightfieldOptions,
  setupEncounters,
  setupRoad,
  setupVillage,
  standable,
} from "../../lib/greyrot/sim/scenario";
import { createSimWorld, isWetAt } from "../../lib/greyrot/sim/world";

/**
 * The real-time combat system.
 *
 * The interaction matrix itself is already covered by `turn-engine.test.ts`;
 * what is new here is composition (mix → spell), the ground field, and that
 * both stay deterministic. The rule this file exists to protect is the one
 * that has bitten twice: a combo that is *nominally* implemented but that no
 * player ever triggers is not shipped. So the last block drives the actual
 * tick loop rather than calling the resolvers directly.
 */

const world = (): ReturnType<typeof createSimWorld> =>
  createSimWorld({ seed: 99, waterLevel: -50 }); // waterLevel far below: flat, dry test ground

/**
 * Fell the ambient forest around a test's fighting ground (R5).
 *
 * "Flat, dry test ground" was always the intent of `world()`, but it still
 * carries the procedural scatter — and a handful of sim-rule tests were
 * silently depending on where those trees happened to fall. The R5 scatter
 * change made the dependency visible: a flat, dry world accepts far more
 * candidates than the campaign's wet and steep one, so its census moved
 * 960 → 1086 and three tests that are about RULES (pool conduction, the
 * rooting cost, the terrain grade cap) started measuring trees instead.
 *
 * Clearing matches shipped conditions rather than dodging them: every real
 * arena is carved free of blockers at setup (`carveArena`), and the campaign's
 * fights measure zero obstacles inside their rings. A test about a rule should
 * stand on the same ground the rule is exercised on in play.
 */
const clearArena = (
  w: ReturnType<typeof createSimWorld>,
  x = 0,
  z = 0,
  r = 30,
): void => {
  w.obstacles.clearRegion((o) => Math.hypot(o.x - x, o.z - z) > r);
};

/**
 * A marker with the boring fields filled in.
 *
 * `stage` and `arena` are required on `RtMarker` and are almost never what a
 * given test is about, so they default here rather than being retyped at every
 * call site — where the next added field would have to be retyped again.
 * `arena` defaults far wider than any test walks, so a test that is not about
 * the arena lock never trips over it.
 */
function marker(m: Partial<RtMarker> & Pick<RtMarker, "id" | "x" | "z" | "foes">): RtMarker {
  return {
    stage: 0,
    radius: 2.6,
    arena: 1000,
    triggered: false,
    cleared: false,
    reinforce: null,
    fightTicks: 0,
    reinforceLeft: 0,
    composed: false,
    ...m,
  };
}

function statuses(...ids: ActiveStatus["id"][]): ActiveStatus[] {
  const list: ActiveStatus[] = [];
  for (const id of ids) addStatus(list, id);
  return list;
}

/* ------------------------------------------------------------ composition */

/**
 * A PRESS THAT CANNOT LAND SAYS SO (R6, fun's binding ruling on the WEAVE skip).
 *
 * The queue has two gates — an element you have not found cannot be queued, and
 * the queue holds `queueMax` — and until R6 a press that hit either one was a
 * TOTAL no-op: the queue unchanged, `queueChanged` false, and every one of the
 * 28 fields of `RtEvents` empty. Measured in the browser on the built entry:
 * pressing SPARK after WATER at `queueMax: 1` changed nothing in the sim, the
 * events or the DOM. A refused press was indistinguishable from a press that
 * never happened.
 *
 * That is indefensible in a game whose whole skill is fast composition, and it
 * is not gulch plumbing: it is every locked-element press in the opening thirty
 * seconds, where a new player is mashing keys precisely to find out what they
 * hold. fun: *"land it whatever else happens, and land it first."*
 *
 * The refusal is an EVENT, not state — presentation input, derived, never
 * hashed (`RtEvents`' own contract), so it cannot affect determinism and does
 * not go near `hashRt`.
 *
 * ── CURRENT STATE ── passing. REGRESSION GUARD: it reds if a refusal ever goes
 * silent again, and each half reds independently.
 */
describe("a refused queue press is reported, not swallowed", () => {
  it("queueing past queueMax reports `full` — and names the element refused", () => {
    const w = world();
    const s = createRtState(4101, { unlocked: ["water", "lightning"], queueMax: 1 });
    const first = rtStep(w, s, [{ type: "queue", element: "water" }]);
    expect(first.queueChanged, "the first press should have landed").toBe(true);
    expect(first.queueRefused).toEqual([]);

    const second = rtStep(w, s, [{ type: "queue", element: "lightning" }]);
    // The press did nothing to the queue — that half is the pre-existing rule
    // and it is deliberately unchanged. What changed is that it now SPEAKS.
    expect(s.hero.queue, "the second element must still not be queued").toEqual(["water"]);
    expect(second.queueChanged).toBe(false);
    expect(second.queueRefused).toEqual([{ element: "lightning", reason: "full" }]);
  });

  it("queueing an element you have not found reports `locked`", () => {
    const w = world();
    const s = createRtState(4102, { unlocked: ["spore"], queueMax: 2 });
    const ev = rtStep(w, s, [{ type: "queue", element: "fire" }]);
    expect(s.hero.queue).toEqual([]);
    expect(ev.queueChanged).toBe(false);
    expect(ev.queueRefused).toEqual([{ element: "fire", reason: "locked" }]);
  });

  it("`locked` wins over `full` — the player is missing the element, not the slot", () => {
    // Both gates fail at once. The reason a HUD should say is the one the
    // player can act on: an unfound element is a road problem, a full queue is
    // a Tab away. Pinning the precedence stops it drifting into whichever
    // branch someone reorders first.
    const w = world();
    const s = createRtState(4103, { unlocked: ["water"], queueMax: 1 });
    rtStep(w, s, [{ type: "queue", element: "water" }]);
    const ev = rtStep(w, s, [{ type: "queue", element: "frost" }]);
    expect(ev.queueRefused).toEqual([{ element: "frost", reason: "locked" }]);
  });

  it("a press that LANDS refuses nothing — the vacuity guard", () => {
    // Without this, an implementation that reported every press as refused
    // would pass all three tests above.
    const w = world();
    const s = createRtState(4104, { unlocked: ["water", "lightning"], queueMax: 2 });
    const a = rtStep(w, s, [{ type: "queue", element: "water" }]);
    const b = rtStep(w, s, [{ type: "queue", element: "lightning" }]);
    expect(s.hero.queue).toEqual(["water", "lightning"]);
    expect(a.queueRefused).toEqual([]);
    expect(b.queueRefused).toEqual([]);
  });
});

/**
 * THE FIND YOU WALKED PAST, NAMED WHILE IT STILL MATTERS (R6, fun's revised
 * ruling on the WEAVE skip).
 *
 * The campaign already ships the diagnostic — `main.ts` finds the untaken find
 * by name and writes *"THE WEAVE left behind — walk back and take it"* — and
 * suppresses it behind `fightDone`, which requires the current stage's fight
 * to be CLEARED. On the Dry Gulch's runway that is the fight the player cannot
 * win without the thing the banner would name, so the component that has the
 * string in hand refuses to say it at exactly the moment it is needed. fun
 * measured `leftBehindCandidate: "weave"` and `banner: no` at three separate
 * points on the runway, including inside the triggered fight.
 *
 * That is R4's gate conjunct one layer up — both wait for the far side of the
 * fight that needed the find — and it is why the predicate lives HERE rather
 * than inline in the HUD: one definition, unit-testable, and the view is a
 * view.
 *
 * `blocking` is DERIVED, so it cannot go stale: `stages.ts` documents
 * `reinforce` as the reusable required-mechanic primitive, its only exemption
 * is `composed`, and `composed` needs two distinct elements in ONE cast, which
 * is unqueueable while `queueMax < QUEUE_MAX`. Nothing here reads the gulch by
 * name or by index.
 *
 * ── CURRENT STATE ── passing. REGRESSION GUARD on a defect fun measured live.
 */
describe("a find left behind is named while it can still be acted on", () => {
  /** A state with one stage, one live required-mechanic fight, one untaken find. */
  const skipped = (opts: { weaveTaken: boolean; queueMax: number; cleared: boolean }): RtState => {
    const s = createRtState(4201, { unlocked: ["water", "lightning"], queueMax: opts.queueMax });
    s.stageIndex = 1;
    s.stages = [
      { id: "prev", cleared: true, exitX: 0, exitZ: 0, exitR: 2.4 },
      { id: "here", cleared: false, exitX: 0, exitZ: 30, exitR: 2.4 },
    ];
    s.pickups = [{ id: 1, stage: 0, kind: "weave", x: 0, z: 2, taken: opts.weaveTaken }];
    s.markers = [
      {
        ...({} as RtMarker),
        id: 1,
        stage: 1,
        x: 0,
        z: 20,
        radius: 4,
        arena: 8,
        foes: [],
        triggered: true,
        cleared: opts.cleared,
        composed: false,
        fightTicks: 0,
        reinforceLeft: 12,
        reinforce: { after: 150, every: 10, budget: 12, kindId: "rotling", from: [{ dx: 0, dz: 8 }] },
      },
    ];
    return s;
  };

  it("names the weave while the fight that needs it is still live — the defect", () => {
    const held = leftBehindFind(skipped({ weaveTaken: false, queueMax: 1, cleared: false }));
    expect(held, "no left-behind find reported at all").not.toBeNull();
    expect(held!.pickup.kind).toBe("weave");
    expect(
      held!.blocking,
      "the live fight cannot be won at queueMax 1, and the find that fixes it is behind the player",
    ).toBe(true);
  });

  it("does not cry blocked once the weave is in hand — the vacuity guard", () => {
    // Same fight, same stage, a hero who took it. Without this, a predicate
    // that returned `blocking: true` unconditionally would pass the test above.
    expect(leftBehindFind(skipped({ weaveTaken: true, queueMax: 2, cleared: false }))).toBeNull();
  });

  it("does not cry blocked for a fight with no required mechanic", () => {
    // The find is still behind the player and still owed — but this fight has
    // no `reinforce`, so nothing about it is unwinnable and the normal
    // after-the-fight banner is the right one.
    const s = skipped({ weaveTaken: false, queueMax: 1, cleared: false });
    s.markers[0]!.reinforce = null;
    const held = leftBehindFind(s);
    expect(held!.pickup.kind).toBe("weave");
    expect(held!.blocking, "a fight with no required mechanic is not blocked by one").toBe(false);
  });

  it("does not cry blocked once that fight is won", () => {
    const held = leftBehindFind(skipped({ weaveTaken: false, queueMax: 1, cleared: true }));
    expect(held!.blocking).toBe(false);
  });
});

describe("mix composition", () => {
  it("lightning² is the EXECUTE: exactly one full-hp rotling, in one cast (R6a)", () => {
    // fun's dossier: l² was dominated by Flashfire in all seven scenarios and
    // landed 33 on the 34-hp rotling — one hp under the chapter's defining
    // execute. At 13.6 base the double is exactly 34: a clean no-status
    // kill-shot niche that Flashfire's burn (which wet fights punish) cannot
    // copy. This is the NUMBER's reason; if either side moves, this fails
    // and the niche question reopens rather than silently dying again.
    const l2 = resolveMix(["lightning", "lightning"], "aimed");
    expect(l2.damage).toBe(34);
    expect(l2.damage).toBeGreaterThanOrEqual(FOES.rotling!.maxHp);
    expect(resolveMix(["lightning"], "aimed").damage).toBe(14);
  });

  it("water² is Deluge — more water, more puddle (R6a)", () => {
    // fun's dossier: the water double had no moment — worst-tier damage
    // everywhere, and as setup Conduction beat every wet-then-spark sequence
    // outright. Its identity is the PATCH: half again the puddle, half again
    // the lifetime — zero new rules, and ch2's frost panes inherit it.
    const w2 = resolveMix(["water", "water"], "aimed");
    expect(w2.name).toBe("Deluge");
    expect(w2.patch).toBe("water");
    expect(w2.patchScale).toBe(1.5);
    // Nobody else scales their puddle.
    expect(resolveMix(["water"], "aimed").patchScale).toBe(1);
    expect(resolveMix(["water", "lightning"], "aimed").patchScale).toBe(1);
    expect(resolveMix(["oil", "oil"], "aimed").patchScale).toBe(1);
  });

  it("Deluge lays half again the puddle, for half again as long (R6a)", () => {
    // Sim-level: the identity must survive the projectile threading, not
    // just the resolver. The blast radius is untouched — only the ground.
    const lay = (mix: Element[]): { r: number; ticks: number } => {
      const w = world();
      const s = createRtState(777);
      for (const e of mix) rtStep(w, s, [{ type: "queue", element: e }]);
      rtStep(w, s, [{ type: "cast", form: "aimed", aimX: 0, aimZ: 8 }]);
      for (let i = 0; i < 40 && s.patches.length === 0; i++) rtStep(w, s, []);
      const p = s.patches.find((q) => q.kind === "water")!;
      expect(p, "no water patch laid").toBeTruthy();
      return { r: p.r, ticks: p.ticksLeft };
    };
    const single = lay(["water"]);
    const deluge = lay(["water", "water"]);
    // Ratio form: both patches age identically between laying and reading,
    // so the identity is the RATIO, not an absolute tick count.
    expect(deluge.ticks / single.ticks).toBeGreaterThanOrEqual(1.49);
    expect(deluge.r / single.r).toBeGreaterThanOrEqual(1.5);
  });

  it("an edge-hit on a BIG body deals its damage — the catch and the blast agree", () => {
    // The parked R4 bug, landed red-first at the boss sitting (Phase A): a
    // bolt CATCHES at body-radius + 0.32 but detonated at its own point
    // with blast 1.1 — so for any body over ~0.78 radius an edge-hit could
    // register and deal ZERO (probe: fire@(0.2,5.7) vs the r-0.95 boss
    // centred 1.20 m away — nothing landed; every 0.4-radius common hid it
    // for four rounds). The fix: a bolt that hits a body detonates ON the
    // body, the melee branch's precedent. Geometry here pins the bug band
    // exactly: the aim line passes 1.13 m from the boss centre — inside the
    // 1.27 catch, outside the old 1.1 blast.
    const w = world();
    const s = createRtState(903);
    spawnFoe(s, "thornback", 0, 6);
    const boss = s.foes[0]!;
    boss.windup = 100; // hand-frozen: a winding foe stands still (§10)
    rtStep(w, s, [{ type: "queue", element: "fire" }]);
    rtStep(w, s, [{ type: "cast", form: "aimed", aimX: 1.15, aimZ: 6 }]);
    for (let i = 0; i < 20; i++) rtStep(w, s, []);
    expect(
      boss.hp,
      "the edge-hit registered and dealt nothing — the catch and the blast disagree",
    ).toBeLessThan(boss.maxHp);
  });

  it("a real SHOVE delays the next bite; a bolt tap does not (R6a)", () => {
    // fun's dossier: every shove nova bought ~1.2 m and ZERO safety — the
    // standoff AI re-closed inside one bite interval, so hpLost60 casting
    // Steam Vent equalled not casting at all. One rule rescues the panic
    // job of SV, Mudshot and spore² together: knockback at shove strength
    // (>= 2.0) floors the victim's recover at 10 ticks. A bolt's 0.3-0.4
    // tap stays free — this prices the SHOVE, not damage itself.
    const hit = (mix: Element[]): number => {
      const w = world();
      const s = createRtState(778);
      spawnFoe(s, "rotling", 0, 4);
      const foe = s.foes[0]!;
      for (const e of mix) rtStep(w, s, [{ type: "queue", element: e }]);
      rtStep(w, s, [{ type: "cast", form: "aimed", aimX: 0, aimZ: 4 }]);
      for (let i = 0; i < 30 && foe.hp === foe.maxHp; i++) rtStep(w, s, []);
      expect(foe.hp, "the cast never landed").toBeLessThan(foe.maxHp);
      return foe.recover;
    };
    // 9, not 10: the read happens one tick after the impact, and recover has
    // aged once — the floor itself is 10.
    expect(hit(["spore", "spore"]), "the shove did not stagger").toBeGreaterThanOrEqual(9);
    expect(hit(["water"]), "a bolt tap staggered — the rule leaks").toBe(0);
  });

  it("retired cancellation: the old opposed pairs are SPELLS now", () => {
    // Owner decision (2026-08-08): every mix does something that is needed.
    // Fire+water used to annihilate to a fizzle; it is Steam Vent. The
    // anti-synergy survives on IMPACT in the status matrix, where it is a
    // decision about a target rather than a wasted press.
    const steam = resolveMix(["fire", "water"], "aimed");
    expect(steam.fizzled).toBe(false);
    expect(steam.name).toBe("Steam Vent");
    expect(steam.damage).toBeGreaterThan(0);
    const shock = resolveMix(["fire", "frost"], "aimed");
    expect(shock.fizzled).toBe(false);
    expect(shock.name).toBe("Thermal Shock");
  });

  it("EVERY pair carries an authored identity — no filler mixes", () => {
    // With a queue of two, the fifteen pairs plus six singles and six doubles
    // ARE the spell list. A pair falling through to the composed default
    // ("WATER+SPORE 14") means someone added an element without giving its
    // pairings a job, and the mix would teach the player that mixing is noise.
    const els: Element[] = ["water", "fire", "frost", "lightning", "oil", "spore"];
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const s = resolveMix([els[i]!, els[j]!], "aimed");
        expect(s.name, `${els[i]}+${els[j]} has no authored identity`).not.toContain("+");
      }
    }
  });

  it("resolves the same regardless of queue order", () => {
    const a = resolveMix(["water", "frost"], "aimed");
    const b = resolveMix(["frost", "water"], "aimed");
    expect(a).toEqual(b);
  });

  it("names the authored pairs", () => {
    expect(resolveMix(["water", "frost"], "aimed").name).toBe("Ice Shard");
    expect(resolveMix(["fire", "oil"], "aimed").name).toBe("Sticky Flame");
    expect(resolveMix(["lightning", "spore"], "aimed").name).toBe("Discharge");
  });

  it("gives Ice Shard its identity: freezes and pierces", () => {
    const s = resolveMix(["water", "frost"], "aimed");
    expect(s.status).toBe("frozen");
    expect(s.pierces).toBe(true);
  });

  it("Sticky Flame leaves a fire patch", () => {
    expect(resolveMix(["fire", "oil"], "aimed").patch).toBe("fire");
  });

  it("scales super-linearly with element count, so composing is worth it", () => {
    const one = resolveMix(["fire"], "aimed").damage;
    const two = resolveMix(["fire", "fire"], "aimed").damage;
    expect(two).toBeGreaterThan(one * 2);
  });

  it("costs more cast time the more elements are in it", () => {
    const one = resolveMix(["fire"], "aimed").castTicks;
    const two = resolveMix(["fire", "fire"], "aimed").castTicks;
    expect(two).toBeGreaterThan(one);
  });

  it("self-casts faster than aimed, because there is nothing to aim", () => {
    expect(resolveMix(["fire"], "self").castTicks).toBeLessThan(
      resolveMix(["fire"], "aimed").castTicks,
    );
  });

  it("never produces an invalid mix — every combination resolves", () => {
    const els: Element[] = ["water", "fire", "frost", "lightning", "oil", "spore"];
    for (const a of els) {
      for (const b of els) {
        {
          const s = resolveMix([a, b], "aimed");
          expect(s.name.length).toBeGreaterThan(0);
          expect(Number.isFinite(s.damage)).toBe(true);
          expect(s.castTicks).toBeGreaterThan(0);
        }
      }
    }
  });
});

/* --------------------------------------------------------- the matrix, rt */

describe("applyElement", () => {
  it("keeps the anti-synergy: fire on Wet douses and applies NOTHING", () => {
    const r = applyElement(20, "fire", ["wet"], "burning");
    expect(r.removes).toContain("wet");
    expect(r.applies).toBeNull();
    expect(r.combo).toBe("Doused");
    // And it is resisted, not merely status-blocked.
    expect(r.damage).toBeLessThan(20);
  });

  it("chains lightning off Wet", () => {
    const r = applyElement(15, "lightning", ["wet"], null);
    expect(r.chainOn).toBe("wet");
    expect(r.applies).toBe("shocked");
    // Wet conducts: more damage, not less.
    expect(r.damage).toBeGreaterThan(15);
  });

  it("shatters a Frozen target on a spore hit", () => {
    const r = applyElement(10, "spore", ["frozen"], null);
    expect(r.combo).toBe("Shatter!");
    expect(r.damage).toBe(20);
    expect(r.removes).toContain("frozen");
  });

  it("spreads fire off Oiled", () => {
    const r = applyElement(10, "fire", ["oiled"], null);
    expect(r.spreads).toBe(true);
    expect(r.applies).toBe("burning");
  });

  it("is unchanged by the order statuses were applied in", () => {
    const a = applyElement(12, "fire", statuses("wet", "oiled").map((s) => s.id), "burning");
    const b = applyElement(12, "fire", statuses("oiled", "wet").map((s) => s.id), "burning");
    expect(a).toEqual(b);
  });
});

/* -------------------------------------------------------------- the field */

describe("ground field", () => {
  const ids = (): (() => number) => {
    let n = 1;
    return () => n++;
  };

  it("afflicts whatever stands in it", () => {
    const patches: FieldPatch[] = [];
    addPatch(patches, ids(), "water", 0, 0, 2);
    expect(fieldStatusesAt(patches, 0.5, 0.5)).toContain("wet");
    expect(fieldStatusesAt(patches, 9, 9)).toEqual([]);
  });

  it("makes ice slippery and oil slick", () => {
    const patches: FieldPatch[] = [];
    addPatch(patches, ids(), "ice", 0, 0, 2);
    expect(fieldSlipAt(patches, 0, 0)).toBeGreaterThan(fieldSlipAt(patches, 9, 9));
  });

  it("ignites oil into fire, and the fire is BIGGER than the slick was", () => {
    const patches: FieldPatch[] = [];
    const oil = addPatch(patches, ids(), "oil", 0, 0, 2);
    const before = oil.r;
    const { ignited } = elementOnField(patches, ids(), "fire", 0, 0, 1);
    expect(ignited).toHaveLength(1);
    expect(patches[0]!.kind).toBe("fire");
    expect(patches[0]!.r).toBeGreaterThan(before);
  });

  it("freezes water into ice, and fire melts it back", () => {
    const patches: FieldPatch[] = [];
    addPatch(patches, ids(), "water", 0, 0, 2);
    elementOnField(patches, ids(), "frost", 0, 0, 1);
    expect(patches[0]!.kind).toBe("ice");
    elementOnField(patches, ids(), "fire", 0, 0, 1);
    expect(patches[0]!.kind).toBe("water");
  });

  it("puts fire out with water", () => {
    const patches: FieldPatch[] = [];
    addPatch(patches, ids(), "fire", 0, 0, 2);
    elementOnField(patches, ids(), "water", 0, 0, 1);
    expect(patches).toHaveLength(0);
  });

  it("reports conduction when lightning hits water, without transforming it", () => {
    const patches: FieldPatch[] = [];
    addPatch(patches, ids(), "water", 0, 0, 2);
    const { conducted } = elementOnField(patches, ids(), "lightning", 0, 0, 1);
    expect(conducted).toHaveLength(1);
    expect(patches[0]!.kind).toBe("water");
  });

  it("spreads fire into touching oil, one patch per tick so it is watchable", () => {
    const patches: FieldPatch[] = [];
    const next = ids();
    addPatch(patches, next, "fire", 0, 0, 2);
    addPatch(patches, next, "oil", 3, 0, 2);
    addPatch(patches, next, "oil", 3, 6, 2);
    const first = stepField(patches);
    expect(first).toHaveLength(1);
    expect(patches.filter((p) => p.kind === "fire")).toHaveLength(2);
  });

  it("merges overlapping same-kind patches instead of stacking them", () => {
    const patches: FieldPatch[] = [];
    const next = ids();
    for (let i = 0; i < 10; i++) addPatch(patches, next, "water", 0, 0, 1.5);
    expect(patches).toHaveLength(1);
  });

  it("stays under the cap however hard it is spammed", () => {
    const patches: FieldPatch[] = [];
    const next = ids();
    for (let i = 0; i < 400; i++) {
      addPatch(patches, next, "fire", (i % 40) * 12, Math.floor(i / 40) * 12, 1);
    }
    expect(patches.length).toBeLessThanOrEqual(MAX_PATCHES);
  });

  it("ages out", () => {
    const patches: FieldPatch[] = [];
    addPatch(patches, ids(), "fire", 0, 0, 2);
    for (let i = 0; i < PATCH_TICKS.fire; i++) stepField(patches);
    expect(patches).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------- aim */

describe("aiming — the hero shoots forward, and that is all", () => {
  const hero = { x: 0, z: 0, fx: 0, fz: 1 };

  it("fires along facing, at range", () => {
    expect(forwardAimPoint(hero, 9)).toEqual({ x: 0, z: 9 });
  });

  it("follows the facing wherever it points", () => {
    const r = Math.SQRT1_2;
    const p = forwardAimPoint({ x: 2, z: 3, fx: r, fz: -r }, 10);
    expect(p.x).toBeCloseTo(2 + r * 10, 6);
    expect(p.z).toBeCloseTo(3 - r * 10, 6);
  });

  /*
   * The rule that three playtests were spent arriving at, pinned by its
   * signature as much as by this test: `forwardAimPoint` cannot see the foe
   * list, the cursor, or the device, so no future edit can quietly reintroduce
   * assistance without changing the shape of the call.
   */
  it("CANNOT be influenced by anything else — there is nothing else to pass", () => {
    expect(forwardAimPoint.length).toBe(2); // (from, range). No targets, no cursor.
  });
});

describe("aim is a skill — a moving target can be missed", () => {
  /**
   * Fire at a foe, then drive it sideways while the shot is in the air.
   *
   * The pair of tests below is the entire point of the aiming work: the first
   * proves a shot at a stale position MISSES, the second proves that leading
   * it HITS. Either one alone would be satisfied by a broken system.
   */
  /** The mix under test — its cast time AND its flight speed, derived rather
   *  than hardcoded, because elements now carry shape identities (fire flies
   *  at 1.1×) and a lead computed at the wrong speed is a self-inflicted miss. */
  const SPELL = resolveMix(["fire"], "aimed");
  /** Ticks between issuing a one-element cast and the projectile existing. */
  const LAUNCH_DELAY = SPELL.castTicks - 2;
  const BOLT_SPEED = PROJECTILE_SPEED * SPELL.speed;

  function fireAndDrive(
    aimAt: (foe: { x: number; z: number; vx: number; vz: number }) => { x: number; z: number },
  ): { hit: boolean } {
    const w = world();
    const s = createRtState(88);
    // Inside BASE_CAST_RANGE with room for the lead: flight is now range-
    // capped, and an intercept point past 9 m would clamp and detonate short.
    spawnFoe(s, "rotling", 0, 7);
    const foe = s.foes[0]!;
    foe.maxHp = foe.hp = 500; // survive, so the assertion is about the hit
    // Pin the AI so the ONLY motion is the lateral drift this test imposes.
    // With the seek and the weave still running, "did it miss" would depend on
    // the enemy's choices as much as on the aim, and the test would be
    // measuring two things at once.
    foe.windup = 9999;

    const drift = 0.28; // metres per tick, purely sideways
    const aim = aimAt({ x: foe.x, z: foe.z, vx: drift, vz: 0 });

    rtStep(w, s, [{ type: "queue", element: "fire" }]);
    rtStep(w, s, [{ type: "cast", form: "aimed", aimX: aim.x, aimZ: aim.z }]);

    let hit = false;
    for (let i = 0; i < 90; i++) {
      const f = s.foes[0];
      if (f) f.x += drift;
      const ev = rtStep(w, s, []);
      if (ev.impacts.length > 0) hit = true;
      if (s.projectiles.length === 0 && i > 4) break;
    }
    return { hit };
  }

  it("aiming where it IS misses a target that moves off", () => {
    expect(fireAndDrive((f) => ({ x: f.x, z: f.z })).hit).toBe(false);
  });

  it("aiming where it WILL BE hits", () => {
    // leadPoint exists for exactly this assertion — it is never wired into the
    // live aim path, only into tests and balance bots.
    expect(
      fireAndDrive((f) =>
        // The target keeps drifting during the cast wind-up, so the lead has
        // to cover it. Derived from the mix rather than hardcoded: the cast
        // command's own tick already decrements the timer, so the projectile
        // launches two ticks earlier than `castTicks` alone suggests
        // (measured, not assumed).
        leadPoint({ x: 0, z: 0 }, f, BOLT_SPEED, LAUNCH_DELAY),
      ).hit,
    ).toBe(true);
  });
});

describe("enemy weave", () => {
  it("pushes a charger off the straight line to the hero", () => {
    const w = world();
    const s = createRtState(31);
    spawnFoe(s, "rotling", 0, 14);
    let maxOffAxis = 0;
    for (let i = 0; i < 90; i++) {
      rtStep(w, s, []);
      const f = s.foes[0];
      if (!f) break;
      // The hero sits at x=0, so any |x| is deviation from the beeline.
      maxOffAxis = Math.max(maxOffAxis, Math.abs(f.x));
    }
    // Enough to make a stale aim point miss at a 0.9 m blast radius...
    expect(maxOffAxis).toBeGreaterThan(0.9);
    // ...and not so much that it stops reading as a charge.
    expect(maxOffAxis).toBeLessThan(6);
  });

  it("still closes the distance — weaving is not fleeing", () => {
    const w = world();
    const s = createRtState(32);
    spawnFoe(s, "rotling", 0, 14);
    for (let i = 0; i < 120; i++) rtStep(w, s, []);
    const f = s.foes[0];
    expect(f === undefined || Math.hypot(f.x, f.z) < 6).toBe(true);
  });

  it("never cancels a committed telegraph", () => {
    const w = world();
    const s = createRtState(33);
    spawnFoe(s, "rotling", 0, 1.1);
    let windup = -1;
    let damage = -1;
    for (let t = 0; t < 90; t++) {
      const ev = rtStep(w, s, []);
      if (ev.windups.length > 0 && windup < 0) windup = t;
      if (ev.heroDamage > 0 && damage < 0) damage = t;
    }
    expect(windup).toBeGreaterThanOrEqual(0);
    expect(damage).toBeGreaterThan(windup);
  });

  it("leaves the weeper's oil trail readable — it barely weaves", () => {
    const w = world();
    const s = createRtState(34);
    spawnFoe(s, "seeper", 0, 14);
    let maxOffAxis = 0;
    for (let i = 0; i < 90; i++) {
      rtStep(w, s, []);
      const f = s.foes[0];
      if (f) maxOffAxis = Math.max(maxOffAxis, Math.abs(f.x));
    }
    expect(maxOffAxis).toBeLessThan(1.5);
  });
});

/* ------------------------------------------ the world the campaign needs */

describe("markers, the run-in and rescue", () => {
  const withMarker = (): [ReturnType<typeof createSimWorld>, ReturnType<typeof createRtState>] => {
    const w = world();
    const s = createRtState(500);
    s.markers.push(
      marker({
        id: 0,
        x: 0,
        z: 14,
        foes: [
          { kindId: "rotling", dx: -1, dz: 1 },
          { kindId: "rotling", dx: 1, dz: 1 },
        ],
      }),
    );
    return [w, s];
  };

  it("spawns its fight when the hero walks in, and never freezes the world", () => {
    const [w, s] = withMarker();
    let triggeredAt = -1;
    for (let t = 0; t < 200; t++) {
      const ev = rtStep(w, s, [{ type: "move", dx: 0, dz: 1 }]);
      if (ev.markersTriggered.length > 0) {
        triggeredAt = t;
        break;
      }
    }
    expect(triggeredAt).toBeGreaterThan(0);
    expect(s.foes).toHaveLength(2);
    // The tick keeps advancing and the hero keeps existing — no mode switch.
    const before = s.tick;
    rtStep(w, s, [{ type: "move", dx: 0, dz: 1 }]);
    expect(s.tick).toBe(before + 1);
  });

  it("clears once the fight is won", () => {
    const [w, s] = withMarker();
    for (let t = 0; t < 200 && !s.markers[0]!.triggered; t++) {
      rtStep(w, s, [{ type: "move", dx: 0, dz: 1 }]);
    }
    expect(s.markers[0]!.triggered).toBe(true);
    s.foes.length = 0; // stand in for winning
    rtStep(w, s, []);
    expect(s.markers[0]!.cleared).toBe(true);
  });

  it("the run-in carries the hero to the first fight with no input at all", () => {
    const [w, s] = withMarker();
    s.autorun = true;
    const z0 = s.hero.z;
    for (let t = 0; t < 200 && !s.markers[0]!.triggered; t++) rtStep(w, s, []);
    expect(s.hero.z).toBeGreaterThan(z0 + 5);
    expect(s.markers[0]!.triggered).toBe(true);
  });

  it("the run-in surrenders the moment the player steers, and never takes over again", () => {
    const [w, s] = withMarker();
    s.autorun = true;
    rtStep(w, s, [{ type: "move", dx: -1, dz: 0 }]);
    expect(s.autorun).toBe(false);
    const x = s.hero.x;
    for (let t = 0; t < 30; t++) rtStep(w, s, []);
    // Drifts to a stop where they were left; it does not resume marching north.
    expect(s.hero.z).toBeLessThan(1);
    expect(s.hero.x).toBeLessThan(x + 0.5);
  });

  it("frees a captive by walking to them — no dialog, no menu", () => {
    const w = world();
    const s = createRtState(501);
    rtStep(w, s, [{ type: "spawnBystander", x: 0, z: 6, name: "Sella" }]);
    expect(s.bystanders[0]!.ai).toBe("captive");
    let rescuedAt = -1;
    for (let t = 0; t < 200; t++) {
      const ev = rtStep(w, s, [{ type: "move", dx: 0, dz: 1 }]);
      if (ev.rescued.length > 0) {
        rescuedAt = t;
        break;
      }
    }
    expect(rescuedAt).toBeGreaterThan(0);
    expect(s.bystanders[0]!.ai).toBe("following");
  });

  it("a captive stands its ground; a freed ally follows the hero", () => {
    const w = world();
    const s = createRtState(502);
    rtStep(w, s, [{ type: "spawnBystander", x: 0, z: 6, name: "Sella" }]);
    const sella = s.bystanders[0]!;

    // Captive: the hero walks away and she stays put.
    const startZ = sella.z;
    for (let t = 0; t < 30; t++) rtStep(w, s, [{ type: "move", dx: 0, dz: -1 }]);
    expect(Math.abs(sella.z - startZ)).toBeLessThan(0.01);

    // Freed: walk to her, then away, and she comes along.
    for (let t = 0; t < 300 && sella.ai === "captive"; t++) {
      rtStep(w, s, [{ type: "move", dx: 0, dz: 1 }]);
    }
    expect(sella.ai).toBe("following");
    const heroZ0 = s.hero.z;
    for (let t = 0; t < 90; t++) rtStep(w, s, [{ type: "move", dx: 1, dz: 0 }]);
    expect(s.hero.x).toBeGreaterThan(3);
    // She is near the hero rather than back where she was left.
    expect(Math.hypot(sella.x - s.hero.x, sella.z - s.hero.z)).toBeLessThan(3.5);
    void heroZ0;
  });
});

/* ------------------------------------------------------------ determinism */

describe("determinism", () => {
  /** A fixed, busy script: move, compose, cast, spawn. */
  function script(tick: number): RtCommand[] {
    const out: RtCommand[] = [];
    if (tick === 5) out.push({ type: "spawn", kindId: "rotling", x: 4, z: 4 });
    if (tick === 6) out.push({ type: "spawn", kindId: "seeper", x: -4, z: 5 });
    if (tick === 40) out.push({ type: "spawn", kindId: "ashcap", x: 6, z: -3 });
    const phase = tick % 30;
    if (phase === 2) out.push({ type: "queue", element: "oil" });
    if (phase === 4) out.push({ type: "queue", element: "fire" });
    if (phase === 6) out.push({ type: "cast", form: "aimed", aimX: 4, aimZ: 4 });
    if (phase === 15) out.push({ type: "queue", element: "water" });
    if (phase === 17) out.push({ type: "queue", element: "lightning" });
    if (phase === 19) out.push({ type: "cast", form: "aimed", aimX: -4, aimZ: 5 });
    out.push({ type: "move", dx: Math.sign(Math.sin(tick / 11)), dz: 0 });
    return out;
  }

  function run(seed: number, ticks: number): number {
    const w = world();
    const s = createRtState(seed);
    for (let t = 0; t < ticks; t++) rtStep(w, s, script(t));
    return hashRt(s);
  }

  it("same seed and commands produce the same hash at tick 1800", () => {
    expect(run(1234, 1800)).toBe(run(1234, 1800));
  });

  it("a different seed produces a different hash", () => {
    expect(run(1234, 600)).not.toBe(run(4321, 600));
  });

  it("state stays JSON-serialisable", () => {
    const w = world();
    const s = createRtState(7);
    for (let t = 0; t < 300; t++) rtStep(w, s, script(t));
    const round = cloneRtState(s);
    expect(hashRt(round)).toBe(hashRt(s));
  });
});

/* --------------------------------------------- driven through the tick loop */

describe("played, not just resolved", () => {
  /** Compose a mix and cast it, returning the events of the tick it landed. */
  function castAt(
    w: ReturnType<typeof createSimWorld>,
    s: ReturnType<typeof createRtState>,
    mix: Element[],
    aim: { x: number; z: number },
    form: "aimed" | "self" = "aimed",
  ): ReturnType<typeof rtStep>[] {
    const out: ReturnType<typeof rtStep>[] = [];
    for (const e of mix) out.push(rtStep(w, s, [{ type: "queue", element: e }]));
    out.push(rtStep(w, s, [{ type: "cast", form, aimX: aim.x, aimZ: aim.z }]));
    for (let i = 0; i < 40; i++) out.push(rtStep(w, s, []));
    return out;
  }

  it("kills a Rotling with a composed spell", () => {
    const w = world();
    const s = createRtState(1);
    spawnFoe(s, "rotling", 0, 6);
    // Thermal Shock — the queue holds two now, and the new pair table is what
    // a composed kill looks like: (11+8) × 1.25 × 1.55 = 37 against 34 hp.
    const evs = castAt(w, s, ["fire", "frost"], { x: 0, z: 6 });
    const died = evs.some((e) => e.deaths.length > 0);
    expect(died).toBe(true);
  });

  it("LAYS A PATCH ON EMPTY GROUND — a spell that hits nobody still lands", () => {
    const w = world();
    const s = createRtState(70);
    // No foes at all. Oiling bare floor before anything arrives is the most
    // important tactical move in the system, and the first implementation
    // silently deleted any projectile that expired without hitting a body, so
    // it was impossible to express. The patch count simply stayed at zero.
    castAt(w, s, ["oil", "oil"], { x: 0, z: 8 });
    expect(s.patches.some((p) => p.kind === "oil")).toBe(true);
  });

  it("detonates at the point it was AIMED at, not at maximum range", () => {
    const w = world();
    const s = createRtState(71);
    castAt(w, s, ["oil"], { x: 0, z: 6 });
    const oil = s.patches.find((p) => p.kind === "oil");
    expect(oil).toBeDefined();
    // Within a projectile step of the aim point, not 20 m downrange.
    expect(Math.hypot(oil!.x - 0, oil!.z - 6)).toBeLessThan(1.0);
  });

  it("the former cancellation now lands as a real spell", () => {
    // Steam Vent, played rather than resolved: fire+water reaches the foe and
    // hurts it, where the old rule spent the cast on nothing.
    const w = world();
    const s = createRtState(1);
    spawnFoe(s, "rotling", 0, 6);
    const hpBefore = s.foes[0]!.hp;
    const evs = castAt(w, s, ["fire", "water"], { x: 0, z: 6 });
    expect(evs.some((e) => e.casts.some((c) => c.fizzled))).toBe(false);
    expect(s.hero.queue).toHaveLength(0);
    expect(s.foes[0]!.hp).toBeLessThan(hpBefore);
  });

  it("oil then fire ignites the floor under a foe and burns it down", () => {
    const w = world();
    const s = createRtState(2);
    spawnFoe(s, "seeper", 0, 7);
    const foe = s.foes[0]!;
    foe.hp = 40;
    castAt(w, s, ["oil"], { x: 0, z: 7 });
    expect(s.patches.some((p) => p.kind === "oil")).toBe(true);
    castAt(w, s, ["fire"], { x: 0, z: 7 });
    expect(s.patches.some((p) => p.kind === "fire")).toBe(true);
    // It is standing in fire; it takes damage over time without another cast.
    const hpAfterIgnition = s.foes[0]?.hp ?? 0;
    for (let i = 0; i < 60; i++) rtStep(w, s, []);
    expect(s.foes[0]?.hp ?? 0).toBeLessThan(hpAfterIgnition);
  });

  it("THE HERO CAN SET THEMSELVES ON FIRE — self-cast fire, then stand in it", () => {
    const w = world();
    const s = createRtState(3);
    castAt(w, s, ["fire", "oil"], { x: 0, z: 0 }, "self");
    // The patch is under the hero's own feet, by design.
    expect(s.patches.some((p) => p.kind === "fire")).toBe(true);
    const before = s.hero.hp;
    for (let i = 0; i < 90; i++) rtStep(w, s, []);
    expect(s.hero.hp).toBeLessThan(before);
  });

  it("...and can put themselves out with a water self-cast", () => {
    const w = world();
    const s = createRtState(4);
    addStatus(s.hero.statuses, "burning");
    castAt(w, s, ["water"], { x: 0, z: 0 }, "self");
    expect(s.hero.statuses.some((st) => st.id === "burning")).toBe(false);
  });

  it("lightning into a pool conducts to everything standing in it", () => {
    const w = world();
    clearArena(w);
    const s = createRtState(5);
    spawnFoe(s, "rotling", 1.0, 8);
    spawnFoe(s, "rotling", -1.0, 8);
    // Soak the ground where they stand, then spark the pool. Tough foes, so
    // the assertion is about the CHAIN rather than about them dying.
    for (const f of s.foes) f.maxHp = f.hp = 400;
    castAt(w, s, ["water", "water"], { x: 0, z: 8 });
    expect(s.patches.some((p) => p.kind === "water")).toBe(true);
    expect(s.foes.every((f) => f.statuses.some((st) => st.id === "wet"))).toBe(true);

    const hp = s.foes.map((f) => f.hp);
    const evs = castAt(w, s, ["lightning"], { x: 0, z: 8 });
    const impacts = evs.flatMap((e) => e.impacts);

    // Both foes are still alive and both were hurt: the second one only by the
    // chain, since a single projectile detonates on one body.
    expect(s.foes).toHaveLength(2);
    expect(s.foes.every((f, i) => f.hp < hp[i]!)).toBe(true);
    expect(impacts.some((i) => i.combo === "Chain!" && i.chained)).toBe(true);
  });

  it("hits each body ONCE per detonation, never twice via its own chain", () => {
    const w = world();
    const s = createRtState(55);
    spawnFoe(s, "rotling", 0.6, 8);
    spawnFoe(s, "rotling", -0.6, 8);
    for (const f of s.foes) f.maxHp = f.hp = 400;
    castAt(w, s, ["water", "water"], { x: 0, z: 8 });
    const evs = castAt(w, s, ["lightning"], { x: 0, z: 8 });
    const impacts = evs.flatMap((e) => e.impacts);
    // Two wet foes inside one blast: two impacts, not four. The first pass
    // produced four — each took a direct hit AND a chain from the other.
    expect(impacts).toHaveLength(2);
  });

  it("knocks a bystander down but never kills them", () => {
    const w = world();
    const s = createRtState(6);
    rtStep(w, s, [{ type: "spawnBystander", x: 0, z: 5, name: "Sella" }]);
    let wentDown = false;
    // 16, not 12: with the queue capped at two, the biggest fire hand deals 28
    // rather than 41, and a fleeing Sella dodges most bolts — measured at
    // 0.5 hp remaining after 12 chase-casts.
    for (let i = 0; i < 16; i++) {
      // Chase her. Once she is burning she runs — correct behaviour, and the
      // funniest part — and she outruns a projectile's range in two casts, so
      // a stationary test would pass by never landing anything after the
      // first. A player doing this on purpose would follow, so the test does.
      const by = s.bystanders[0]!;
      s.hero.x = by.x;
      s.hero.z = by.z - 3;
      const evs = castAt(w, s, ["fire", "fire"], { x: by.x, z: by.z });
      if (evs.some((e) => e.bystanderDown.length > 0)) wentDown = true;
    }
    // The joke has to actually land: she goes down...
    expect(wentDown).toBe(true);
    // ...and she is still here, on her feet, at full health.
    expect(s.bystanders).toHaveLength(1);
    expect(s.bystanders[0]!.hp).toBeGreaterThan(0);
    expect(s.bystanders[0]!.down).toBe(0);
  });

  it("catches a bystander in friendly fire, softened", () => {
    const w = world();
    const s = createRtState(61);
    rtStep(w, s, [{ type: "spawnBystander", x: 0, z: 5, name: "Sella" }]);
    castAt(w, s, ["fire"], { x: 0, z: 5 });
    const by = s.bystanders[0]!;
    // Full status — she is on fire, which is the whole joke...
    expect(by.statuses.some((st) => st.id === "burning")).toBe(true);
    // ...and reduced damage, which is what keeps §9's conversion bar safe.
    expect(by.hp).toBeLessThan(by.maxHp);
    expect(by.hp).toBeGreaterThan(by.maxHp * 0.5);
  });

  it("roots the hero while casting, so a big mix is a real commitment", () => {
    const w = world();
    const s = createRtState(8);
    rtStep(w, s, [{ type: "queue", element: "fire" }]);
    rtStep(w, s, [{ type: "queue", element: "fire" }]);
    rtStep(w, s, [{ type: "queue", element: "fire" }]);
    rtStep(w, s, [{ type: "cast", form: "aimed", aimX: 0, aimZ: 9 }]);
    const x0 = s.hero.x;
    const z0 = s.hero.z;
    rtStep(w, s, [{ type: "move", dx: 1, dz: 0 }]);
    rtStep(w, s, [{ type: "move", dx: 1, dz: 0 }]);
    expect(Math.hypot(s.hero.x - x0, s.hero.z - z0)).toBeLessThan(0.01);
  });

  it("caps the queue, and edits mid-cast compose the NEXT mix", () => {
    const w = world();
    const s = createRtState(9);
    for (let i = 0; i < 10; i++) rtStep(w, s, [{ type: "queue", element: "fire" }]);
    expect(s.hero.queue).toHaveLength(QUEUE_MAX);
    rtStep(w, s, [{ type: "cast", form: "aimed", aimX: 0, aimZ: 5 }]);
    // The committed mix was snapshotted into `hero.casting`, so the queue is
    // editable during the root — that is what lets a player chain mixes. The
    // old mid-cast lock predates the snapshot and was retired deliberately.
    rtStep(w, s, [{ type: "queue", element: "water" }]);
    expect(s.hero.queue).toEqual(["water"]);
    expect(s.hero.casting?.elements).toEqual(["fire", "fire"]);
  });

  it("buffers a cast pressed during the root and fires it as the root ends", () => {
    const w = world();
    const s = createRtState(9);
    rtStep(w, s, [{ type: "queue", element: "fire" }]);
    rtStep(w, s, [{ type: "cast", form: "aimed", aimX: 0, aimZ: 9 }]);
    // Mid-root: compose the next mix and press cast again. Neither is lost.
    rtStep(w, s, [{ type: "queue", element: "water" }]);
    rtStep(w, s, [
      { type: "cast", form: "aimed", aimX: 0, aimZ: -9 }, // overwritten —
      { type: "cast", form: "aimed", aimX: 0, aimZ: 9 }, // last press wins
    ]);
    expect(s.hero.buffered).toEqual({ form: "aimed", aimX: 0, aimZ: 9 });
    // Run the root out AND the recovery: the follow-up used to commit on the
    // launch tick ("no dead air"); since the third playtest it commits the
    // tick the recovery runs out — the chain breathes, nothing is lost.
    let launched = -1;
    for (let t = 0; t < 20 && launched < 0; t++) {
      const e = rtStep(w, s, []);
      if (e.casts.length > 0) launched = t;
    }
    expect(launched).toBeGreaterThanOrEqual(0);
    expect(s.hero.buffered).not.toBeNull(); // held THROUGH the recovery
    for (let t = 0; t < s.castCooldown; t++) rtStep(w, s, []);
    expect(s.hero.buffered).toBeNull();
    expect(s.hero.casting?.elements).toEqual(["water"]);
  });

  it("discards a buffered cast when nothing is queued to cast", () => {
    const w = world();
    const s = createRtState(9);
    rtStep(w, s, [{ type: "queue", element: "fire" }]);
    rtStep(w, s, [{ type: "cast", form: "aimed", aimX: 0, aimZ: 9 }]);
    rtStep(w, s, [{ type: "cast", form: "self", aimX: 0, aimZ: 0 }]);
    expect(s.hero.buffered).not.toBeNull();
    for (let t = 0; t < 20; t++) rtStep(w, s, []);
    expect(s.hero.buffered).toBeNull();
    expect(s.hero.casting).toBeNull();
  });

  it("gives foes a telegraph window before the blow lands", () => {
    const w = world();
    const s = createRtState(10);
    spawnFoe(s, "rotling", 0, 1.1);
    let windupSeen = -1;
    let damageSeen = -1;
    for (let t = 0; t < 60; t++) {
      const e = rtStep(w, s, []);
      if (e.windups.length > 0 && windupSeen < 0) windupSeen = t;
      if (e.heroDamage > 0 && damageSeen < 0) damageSeen = t;
    }
    expect(windupSeen).toBeGreaterThanOrEqual(0);
    expect(damageSeen).toBeGreaterThan(windupSeen);
  });

  it("keeps the hero's aim through a knockback — being shoved is not steering", () => {
    const w = world();
    const s = createRtState(10);
    const fx0 = s.hero.fx;
    const fz0 = s.hero.fz;
    // A rotling in biting range, dead ahead. Its hit knocks the hero back,
    // which is velocity the player never asked for — and for one whole
    // milestone that velocity turned the facing, so every bite spun the
    // hero's aim 180° away from the biter. Facing follows INPUT only.
    spawnFoe(s, "rotling", s.hero.x + fx0 * 1.1, s.hero.z + fz0 * 1.1);
    let bitten = false;
    for (let t = 0; t < 120; t++) {
      const e = rtStep(w, s, []);
      if (e.heroDamage > 0) bitten = true;
    }
    expect(bitten).toBe(true);
    expect(s.hero.fx).toBe(fx0);
    expect(s.hero.fz).toBe(fz0);
  });

  it("keeps bodies apart — a pack settles into a ring, never a stack", () => {
    const w = world();
    const s = createRtState(11);
    // Four rotlings from one point — the degenerate case the old sim allowed
    // to persist forever: with no separation, any number of foes could
    // co-locate and read as one. The playtest's "they run into the middle of
    // me all the time" was half this.
    for (let i = 0; i < 4; i++) spawnFoe(s, "rotling", 0.1 * i, 4);
    for (let t = 0; t < 150; t++) rtStep(w, s, []);
    const r = foeKind("rotling").radius;
    const alive = s.foes.filter((f) => f.alive);
    expect(alive.length).toBe(4);
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i]!;
        const b = alive[j]!;
        // Relaxed position-based separation converges rather than teleports,
        // so allow a sliver — but a stack reads as ~0 and must be impossible.
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(2 * r * 0.75);
      }
      // And nobody stands INSIDE the hero (winding up excepted — a committed
      // telegraph must not slide after the player has read it).
      const a = alive[i]!;
      if (a.windup === 0) {
        expect(Math.hypot(a.x - s.hero.x, a.z - s.hero.z)).toBeGreaterThan(
          (r + HERO_RADIUS) * 0.75,
        );
      }
    }
  });

  it("steps back out of your face after biting — recover is not a hug", () => {
    const w = world();
    const s = createRtState(12);
    spawnFoe(s, "rotling", 0, 1.1);
    const k = foeKind("rotling");
    let bitTick = -1;
    let maxAfterBite = 0;
    for (let t = 0; t < 90; t++) {
      const e = rtStep(w, s, []);
      if (e.heroDamage > 0 && bitTick < 0) bitTick = t;
      if (bitTick >= 0 && t > bitTick && t <= bitTick + k.recoverTicks) {
        const f = s.foes[0]!;
        maxAfterBite = Math.max(maxAfterBite, Math.hypot(f.x - s.hero.x, f.z - s.hero.z));
      }
    }
    expect(bitTick).toBeGreaterThanOrEqual(0);
    // During its recover window the foe backs OUT past its own attack range —
    // the old seek branch kept driving it through the hero the whole time.
    expect(maxAfterBite).toBeGreaterThan(k.range);
  });
});

/* ------------------------------------------------------------------------ */
/*  What the sandbox could not see                                           */
/* ------------------------------------------------------------------------ */

/**
 * Five things a flat, dry, 26-metre arena with one wave spawner never
 * exercised — and that the shipped road hits in its first minute.
 *
 * Every one of these was found by asking what the sandbox's *shape* hid rather
 * than by reading the code, which is the same question that found the aim bugs.
 */
describe("a dripping foe is its own conductor — the sopling", () => {
  const wet = (f: { statuses: { id: string }[] }): boolean =>
    f.statuses.some((st) => st.id === "wet");

  it("wets ITSELF: walks at the head of a water line the field bills it for", () => {
    const w = world();
    const s = createRtState(301);
    s.hero.z = -20; // far south, so it walks a long visible line
    spawnFoe(s, "sopling", 0, 6);
    for (let i = 0; i < 80; i++) rtStep(w, s, []);
    expect(s.patches.some((p) => p.kind === "water")).toBe(true);
    expect(wet(s.foes[0]!), "the sopling is not standing in its own wetness").toBe(true);
  });

  it("dies one whole hit sooner to the spark: the wet body takes the combo", () => {
    const w = world();
    const s = createRtState(302);
    s.hero.z = -20;
    spawnFoe(s, "sopling", 0, 6);
    for (let i = 0; i < 80 && !wet(s.foes[0]!); i++) rtStep(w, s, []);
    const f = s.foes[0]!;
    expect(wet(f)).toBe(true);
    // Step into range — the per-element clamp would ground a 20 m bolt.
    s.hero.x = f.x;
    s.hero.z = f.z - 5;
    rtStep(w, s, [{ type: "queue", element: "lightning" }]);
    const evs: ReturnType<typeof rtStep>[] = [
      rtStep(w, s, [{ type: "cast", form: "aimed", aimX: f.x, aimZ: f.z }]),
    ];
    for (let i = 0; i < 40; i++) evs.push(rtStep(w, s, []));
    const hit = evs.flatMap((e) => e.impacts).find((i) => !i.onHero);
    expect(hit, "the bolt never landed").toBeDefined();
    // SPARK 13.6 (R6a) at Wet's ×1.5 — the countable weakness the kind is
    // tuned for. 20.4 lands as 20-21; the 2-sparked-vs-3-dry identity holds
    // at 38 hp (40.8 >= 38; dry 27.2 < 38).
    expect(hit!.combo, "no combo on a wet body").not.toBeNull();
    expect(hit!.damage).toBeGreaterThanOrEqual(20);
    expect(hit!.damage).toBeLessThanOrEqual(21);
    expect(evs.some((e) => e.statuses.some((st) => st.status === "shocked"))).toBe(true);
  });

  it("its own trail conducts — a near miss through the water still bites", () => {
    const w = world();
    const s = createRtState(303);
    s.hero.z = -20;
    spawnFoe(s, "sopling", 0, 6);
    for (let i = 0; i < 80 && !wet(s.foes[0]!); i++) rtStep(w, s, []);
    const f = s.foes[0]!;
    // The head drop — the pool it stands in.
    const pool = s.patches.find((p) => Math.hypot(p.x - f.x, p.z - f.z) <= p.r);
    expect(pool, "the sopling is not standing in its own trail").toBeDefined();
    // Aim BESIDE the body: outside the blast's direct reach of the foe, but
    // with blast + pool overlapping — the forgiveness that lets a naive
    // player find the lesson without a perfect hit.
    const spec = resolveMix(["lightning"], "aimed");
    const aimX = f.x + spec.radius + 0.4;
    const aimZ = f.z;
    expect(Math.hypot(aimX - f.x, aimZ - f.z)).toBeGreaterThan(spec.radius);
    expect(Math.hypot(aimX - pool!.x, aimZ - pool!.z)).toBeLessThanOrEqual(
      pool!.r + spec.radius,
    );
    // Fire from due south of the AIM so the flight path cannot clip the body.
    s.hero.x = aimX;
    s.hero.z = f.z - 4;
    rtStep(w, s, [{ type: "queue", element: "lightning" }]);
    const evs: ReturnType<typeof rtStep>[] = [
      rtStep(w, s, [{ type: "cast", form: "aimed", aimX, aimZ }]),
    ];
    for (let i = 0; i < 20; i++) evs.push(rtStep(w, s, []));
    expect(
      evs.some((e) => e.statuses.some((st) => st.status === "shocked")),
      "the near miss never conducted through the trail",
    ).toBe(true);
  });
});

describe("promotion: the shipped world's rules", () => {
  const castAtFrom = (
    w: ReturnType<typeof createSimWorld>,
    s: ReturnType<typeof createRtState>,
    mix: Element[],
    aim: { x: number; z: number },
    settle = 40,
  ): ReturnType<typeof rtStep>[] => {
    const out: ReturnType<typeof rtStep>[] = [];
    for (const e of mix) out.push(rtStep(w, s, [{ type: "queue", element: e }]));
    out.push(rtStep(w, s, [{ type: "cast", form: "aimed", aimX: aim.x, aimZ: aim.z }]));
    for (let i = 0; i < settle; i++) out.push(rtStep(w, s, []));
    return out;
  };

  /* ----------------------------------------------------- the hard bound */

  it("clamps every body inside the world bound, however long they push", () => {
    const w = world();
    const s = createRtState(700);
    spawnFoe(s, "rotling", 4, 0);
    rtStep(w, s, [{ type: "spawnBystander", x: 2, z: 0, name: "Sella" }]);
    // 4000 ticks is over two minutes of walking due east — the exploration sim
    // had this clamp and this is the assertion that carried it across.
    for (let t = 0; t < 4000; t++) rtStep(w, s, [{ type: "move", dx: 1, dz: 0.001 }]);
    expect(Math.abs(s.hero.x)).toBeLessThanOrEqual(w.obstacles.bound);
    // ⚠️ THE HERO'S LINE IS UNCONDITIONAL; THE OTHER TWO RANGE OVER LISTS THAT
    // HAVE HAD TWO MINUTES OF SIM TO EMPTY (comp's R7 empty-subject census).
    // The rotling can die or despawn, and if `spawnBystander` ever stopped
    // taking, `s.bystanders` is [] and Sella's half of the clamp checks
    // nothing while reporting green. Both bodies are spawned by this test and
    // neither is meant to leave, so their survival is part of the claim rather
    // than a precondition to hope for.
    expect(s.foes, "the rotling did not survive the walk — the foe clamp checked nothing")
      .toHaveLength(1);
    expect(s.bystanders, "Sella never spawned — the bystander clamp checked nothing")
      .toHaveLength(1);
    for (const f of s.foes) expect(Math.abs(f.x)).toBeLessThanOrEqual(w.obstacles.bound);
    for (const b of s.bystanders) expect(Math.abs(b.x)).toBeLessThanOrEqual(w.obstacles.bound);
  });

  /* --------------------------------------------------- terrain is water */

  it("soaks whatever stands in a trough, and dries it off when it leaves", () => {
    const w = world();
    w.wetZones.push({ x: 0, z: 6, r: 3.6 });
    const s = createRtState(701);
    spawnFoe(s, "rotling", 0, 6);
    const foe = s.foes[0]!;
    rtStep(w, s, []);
    expect(foe.statuses.some((st) => st.id === "wet")).toBe(true);

    // Out of the pool, the soak stops being re-applied and times out.
    foe.x = 40;
    foe.z = 40;
    for (let t = 0; t < 200; t++) rtStep(w, s, []);
    expect(foe.statuses.some((st) => st.id === "wet")).toBe(false);
  });

  it("puts a Burning hero out when they run into the water — one rule, two routes", () => {
    const w = world();
    w.wetZones.push({ x: 0, z: 0, r: 3.6 });
    const s = createRtState(702);
    addStatus(s.hero.statuses, "burning");
    rtStep(w, s, []);
    expect(s.hero.statuses.some((st) => st.id === "burning")).toBe(false);
  });

  it("chains lightning between two foes soaked by TERRAIN, with no patch anywhere", () => {
    // The village pool teach, made structural. There is no water spell in this
    // test and `s.patches` stays empty throughout — the ground alone is what
    // makes the combo fire, which is what `PEDAGOGY.md` claims about it.
    const w = world();
    w.wetZones.push({ x: 0, z: 8, r: 3.6 });
    const s = createRtState(703);
    spawnFoe(s, "rotling", -1.6, 7.4);
    spawnFoe(s, "rotling", 1.7, 7.2);
    rtStep(w, s, []); // one tick for the ground to soak them
    expect(s.foes.every((f) => f.statuses.some((st) => st.id === "wet"))).toBe(true);

    const evs = castAtFrom(w, s, ["lightning"], { x: -1.6, z: 7.4 });
    expect(s.patches).toHaveLength(0);
    const impacts = evs.flatMap((e) => e.impacts);
    expect(impacts.some((i) => i.chained)).toBe(true);
  });

  it("chains the hero's own bolt back into a hero who waded into the pool — at the reduced rate", () => {
    // FRIENDLY FIRE, and this is the case that decides whether it is real
    // (`GAME_DESIGN.md` §3.2). Stand in the water you are electrifying and the
    // water does not care whose side you are on.
    //
    // This test previously asserted the opposite, and it was right to at the
    // time: the hero was immune to their own casts outright, and the bug it
    // guarded was `detonate` honouring `hitsHero` while the chain recursion
    // ignored it — an INCONSISTENCY, which is still the real defect class. The
    // guard is now consistent in the other direction, so the assertion inverts
    // and the thing being pinned is the SCALE, which is what makes this a
    // decision rather than a death.
    const w = world();
    w.wetZones.push({ x: 0, z: 0, r: 8 });
    const s = createRtState(704);
    spawnFoe(s, "rotling", 0, 4);
    rtStep(w, s, []);
    expect(s.hero.statuses.some((st) => st.id === "wet")).toBe(true);

    const evs = castAtFrom(w, s, ["lightning"], { x: 0, z: 4 }, 12);
    const impacts = evs.flatMap((e) => e.impacts);
    const onFoe = impacts.find((i) => !i.onHero);
    const onHero = impacts.find((i) => i.onHero);
    expect(onFoe).toBeDefined();
    expect(onHero, "the chain no longer reaches its own caster").toBeDefined();
    // Reduced, not immune and not full. One path, one scale — a mixture would
    // mean the hero was caught twice by one detonation.
    expect(onHero!.damage).toBeCloseTo(onFoe!.damage * HERO_SELF_DAMAGE, 6);
  });

  it("leaves a hero who stayed OUT of the pool completely untouched", () => {
    // The other half, and the one the opening depends on. The pool fight
    // triggers at 4.2 m while the trough is 3.6 m across, so the player meets
    // it standing on dry ground — the taught play (hang back, zap the water)
    // costs nothing, and only wading in does. Friendly fire is a positioning
    // rule (§10.6), not a tax on the lesson.
    const w = world();
    w.wetZones.push({ x: 0, z: 8, r: 3.0 });
    const s = createRtState(714);
    spawnFoe(s, "rotling", 0, 8);
    s.hero.z = 3.4; // dry, and 4.6 m from the foe — just outside CHAIN_RADIUS
    rtStep(w, s, []);
    expect(s.hero.statuses.some((st) => st.id === "wet")).toBe(false);
    const hp = s.hero.hp;

    const evs = castAtFrom(w, s, ["lightning"], { x: 0, z: 8 }, 12);
    expect(evs.flatMap((e) => e.impacts).some((i) => !i.onHero)).toBe(true);
    expect(evs.flatMap((e) => e.impacts).some((i) => i.onHero)).toBe(false);
    expect(s.hero.hp).toBe(hp);
  });

  /* ------------------------------------------------- markers own their foes */

  it("clears only the marker whose own foes are dead", () => {
    const w = world();
    const s = createRtState(705);
    s.markers.push(
      marker({ id: 0, x: 0, z: 6, triggered: true, foes: [] }),
      marker({ id: 1, x: 0, z: 9, triggered: true, foes: [] }),
    );
    // Both fights are ALREADY live, staged directly rather than by walking in.
    // Walking in cannot produce this any more — a marker refuses to trigger
    // while another fight is unresolved — but per-marker ownership still has to
    // hold, because a restart, a scripted spawn or a future stage that opens
    // two fronts all reach the same clearing rule.
    rtStep(w, s, [
      { type: "spawn", kindId: "rotling", x: 0, z: 7, markerId: 0 },
      { type: "spawn", kindId: "rotling", x: 0, z: 10, markerId: 1 },
    ]);
    expect(s.foes).toHaveLength(2);

    // Kill marker 0's foes only.
    for (const f of s.foes) if (f.markerId === 0) f.hp = 0;
    rtStep(w, s, []);
    rtStep(w, s, []);
    expect(s.markers[0]!.cleared).toBe(true);
    expect(s.markers[1]!.cleared).toBe(false);
  });

  it("refuses to open a second fight while the first is unresolved", () => {
    // The road carries markers 6.9 m apart, which is inside any sane arena
    // lock — so without this rule the lock itself would walk the player into
    // the next ambush while they were still in the last one.
    const w = world();
    const s = createRtState(707);
    s.markers.push(
      marker({ id: 0, x: 0, z: 6, foes: [{ kindId: "rotling", dx: 0, dz: 1 }] }),
      marker({ id: 1, x: 0, z: 9, foes: [{ kindId: "rotling", dx: 0, dz: 1 }] }),
    );
    // Walk until well INSIDE marker 1's radius (z ≥ 6.4) and stop there, so
    // the assertion below is about the rule rather than about the hero having
    // wandered out of range.
    for (let t = 0; t < 200 && s.hero.z < 7.5; t++) {
      rtStep(w, s, [{ type: "move", dx: 0, dz: 1 }]);
      s.hero.hp = s.hero.maxHp; // this test is about triggering, not survival
    }
    expect(s.markers[0]!.triggered).toBe(true);
    expect(Math.hypot(s.hero.x, s.hero.z - 9)).toBeLessThan(2.6);
    for (let t = 0; t < 60; t++) {
      rtStep(w, s, []);
      s.hero.hp = s.hero.maxHp;
    }
    expect(s.markers[1]!.triggered, "the second fight woke up during the first").toBe(false);

    // Win the first, and the second opens on its own — the hero has not moved.
    for (const f of s.foes) f.hp = 0;
    for (let t = 0; t < 10; t++) {
      rtStep(w, s, []);
      s.hero.hp = s.hero.maxHp;
    }
    expect(s.markers[0]!.cleared).toBe(true);
    expect(s.markers[1]!.triggered).toBe(true);
  });

  /* ------------------------------------------------------ going down */

  it("goes down at 0 HP instead of sitting there being hit forever", () => {
    // The whole of this used to be `hero.hp = Math.max(0, hero.hp)`: there was
    // no losing condition, so §8's revive had nothing to hang on.
    const w = world();
    const s = createRtState(720);
    s.hero.hp = 4;
    spawnFoe(s, "rotling", 0, 1.2);
    let downAt = -1;
    for (let t = 0; t < 400 && downAt < 0; t++) {
      if (rtStep(w, s, []).heroDown) downAt = t;
    }
    expect(downAt, "the hero never went down").toBeGreaterThan(0);
    expect(s.hero.downTicks).toBe(DOWN_TICKS);
    expect(s.hero.defeated).toBe(false);
  });

  it("cannot be hurt, afflicted or burned while down", () => {
    const w = world();
    const s = createRtState(721);
    s.hero.hp = 1;
    // Standing in fire, with a foe on top — the worst case for a body that is
    // supposed to be out of the world.
    addPatch(s.patches, () => 9001, "fire", 0, 0, 3, 600);
    spawnFoe(s, "rotling", 0, 1.0);
    for (let t = 0; t < 400 && !s.hero.downTicks; t++) rtStep(w, s, []);
    expect(s.hero.downTicks).toBeGreaterThan(0);

    let damageWhileDown = 0;
    for (let t = 0; t < DOWN_TICKS - 2; t++) {
      damageWhileDown += rtStep(w, s, []).heroDamage;
    }
    expect(damageWhileDown, "being killed twice is not a mechanic").toBe(0);
    expect(s.hero.statuses).toHaveLength(0);
  });

  it("ignores movement and casting while down, and takes the revive", () => {
    const w = world();
    const s = createRtState(722);
    s.hero.hp = 1;
    spawnFoe(s, "rotling", 0, 1.0);
    for (let t = 0; t < 400 && !s.hero.downTicks; t++) rtStep(w, s, []);
    const at = { x: s.hero.x, z: s.hero.z };

    const ev = rtStep(w, s, [
      { type: "move", dx: 1, dz: 0 },
      { type: "queue", element: "fire" },
      { type: "cast", form: "aimed", aimX: 9, aimZ: 0 },
    ]);
    expect(ev.casts).toHaveLength(0);
    expect(s.hero.queue).toHaveLength(0);
    expect(s.hero.x).toBeCloseTo(at.x, 6);
    expect(s.hero.z).toBeCloseTo(at.z, 6);

    const rev = rtStep(w, s, [{ type: "revive" }]);
    expect(rev.heroRevived).toBe(true);
    expect(s.hero.downTicks).toBe(0);
    expect(s.hero.defeated).toBe(false);
    expect(s.hero.hp).toBeGreaterThan(0);
    // §8's 2–3 s of spawn invulnerability, spent through the ordinary iframes.
    expect(s.hero.iframes).toBeGreaterThan(60);
  });

  it("declares defeat when the offer window runs out, and stops there", () => {
    const w = world();
    const s = createRtState(723);
    s.hero.hp = 1;
    spawnFoe(s, "rotling", 0, 1.0);
    for (let t = 0; t < 400 && !s.hero.downTicks; t++) rtStep(w, s, []);

    let defeatedAt = -1;
    for (let t = 0; t < DOWN_TICKS + 30; t++) {
      if (rtStep(w, s, []).heroDefeated) defeatedAt = t;
    }
    // Exactly the authored window, in ticks — not "about five seconds".
    expect(defeatedAt).toBe(DOWN_TICKS - 1);
    expect(s.hero.defeated).toBe(true);
    // And it stays defeated. A second `heroDefeated` would re-fire the panel.
    expect(rtStep(w, s, []).heroDefeated).toBe(false);
  });

  it("restarts the stage: fights back to untriggered, hero on their feet", () => {
    const w = world();
    const s = createRtState(724);
    s.stages = [{ id: "a", exitX: 0, exitZ: 40, exitR: 2, cleared: false }];
    s.markers.push(marker({ id: 0, x: 0, z: 6, foes: [{ kindId: "rotling", dx: 0, dz: 1 }] }));
    for (let t = 0; t < 200 && !s.markers[0]!.triggered; t++) {
      rtStep(w, s, [{ type: "move", dx: 0, dz: 1 }]);
    }
    expect(s.foes.length).toBeGreaterThan(0);
    s.hero.hp = 1;
    for (let t = 0; t < 400 && !s.hero.defeated; t++) rtStep(w, s, []);
    expect(s.hero.defeated).toBe(true);

    rtStep(w, s, [{ type: "restartStage", x: 0, z: 0 }]);
    expect(s.hero.defeated).toBe(false);
    expect(s.hero.hp).toBe(s.hero.maxHp);
    expect(s.markers[0]!.triggered).toBe(false);
    expect(s.foes, "the fight's foes outlived the restart").toHaveLength(0);
    expect(s.lock).toBeNull();
  });

  /* ------------------------------------------------------- the leash */

  it("sends a foe home rather than letting it be dragged into the next fight", () => {
    const w = world();
    const s = createRtState(730);
    s.markers.push(marker({ id: 0, x: 0, z: 0, arena: 1000, foes: [] }));
    rtStep(w, s, [{ type: "spawn", kindId: "rotling", x: 0, z: 2, markerId: 0 }]);

    // Run away, far enough and long enough to drag it into the next postcode.
    const f = s.foes[0]!;
    let everLeashed = false;
    let furthestFromHome = 0;
    for (let t = 0; t < 600; t++) {
      rtStep(w, s, [{ type: "move", dx: 0, dz: -1 }]);
      s.hero.hp = s.hero.maxHp;
      everLeashed ||= f.leashed;
      furthestFromHome = Math.max(furthestFromHome, Math.hypot(f.x, f.z));
    }
    expect(Math.abs(s.hero.z), "the hero did not outrun it").toBeGreaterThan(LEASH_RADIUS + 4);
    expect(everLeashed, "the foe never gave up the chase").toBe(true);
    // THE GUARANTEE, and the reason the leash exists: a bounded tether, not a
    // momentary flag. Asserted over the whole run rather than at one instant,
    // because a foe that has come home and re-engaged is correctly unleashed
    // again — the invariant is the distance, not the state at the last tick.
    expect(
      furthestFromHome,
      "the foe could be dragged clean out of its own fight",
    ).toBeLessThan(LEASH_RADIUS + 2);

    // Left alone, it walks back to where its fight is — and STAYS there. A foe
    // that becomes interested again the moment it gets home just paces between
    // its post and the boundary forever, which is what keying the leash on the
    // foe's own distance produced.
    for (let t = 0; t < 400; t++) rtStep(w, s, []);
    expect(Math.hypot(f.x, f.z)).toBeLessThan(2);
    expect(f.leashed, "it went home and then wandered off again").toBe(true);

    // Come back and the fight is waiting, exactly where it was.
    for (let t = 0; t < 600 && f.leashed; t++) {
      rtStep(w, s, [{ type: "move", dx: 0, dz: 1 }]);
      s.hero.hp = s.hero.maxHp;
    }
    expect(f.leashed, "the fight never re-engaged when the player returned").toBe(false);
  });

  it("never leashes a free spawn — it owns no fight to return to", () => {
    const w = world();
    const s = createRtState(731);
    rtStep(w, s, [{ type: "spawn", kindId: "rotling", x: 0, z: 2 }]);
    for (let t = 0; t < 400; t++) {
      rtStep(w, s, [{ type: "move", dx: 0, dz: -1 }]);
      s.hero.hp = s.hero.maxHp;
    }
    expect(s.foes[0]!.leashed).toBe(false);
  });

  /* --------------------------------------------------- the arena lock */

  it("holds the hero inside the arena while its fight is live, then opens", () => {
    const w = world();
    const s = createRtState(740);
    s.markers.push(
      marker({ id: 0, x: 0, z: 6, arena: 5, foes: [{ kindId: "rotling", dx: 0, dz: 1 }] }),
    );
    for (let t = 0; t < 200 && !s.markers[0]!.triggered; t++) {
      rtStep(w, s, [{ type: "move", dx: 0, dz: 1 }]);
    }
    expect(s.lock).not.toBeNull();

    for (let t = 0; t < 300; t++) {
      rtStep(w, s, [{ type: "move", dx: 0, dz: 1 }]);
      // Both combatants topped up: this is about the ring, not about the fight.
      // The foe needs it because its own melee splash catches everything within
      // 0.9 m of the hero — including itself — so left alone it eventually
      // kills itself, clears the marker and opens the lock legitimately.
      s.hero.hp = s.hero.maxHp;
      for (const f of s.foes) f.hp = f.maxHp;
      expect(Math.hypot(s.hero.x, s.hero.z - 6)).toBeLessThanOrEqual(5 + 1e-6);
    }

    // Win it and the ring opens.
    for (const f of s.foes) f.hp = 0;
    rtStep(w, s, []);
    rtStep(w, s, []);
    expect(s.lock).toBeNull();
    for (let t = 0; t < 200; t++) rtStep(w, s, [{ type: "move", dx: 0, dz: 1 }]);
    expect(Math.hypot(s.hero.x, s.hero.z - 6)).toBeGreaterThan(5);
  });

  it("holds the foes inside the ring too — the spitter's band must not leave it", () => {
    // Fourth playtest: an ashcap kited outside the ring up a hill, where a
    // hero clamped to the ring could not follow. Its band is measured from
    // the HERO, who may stand at the ring edge — so the band target can sit
    // outside the ring entirely, and only the 5c clamp keeps the fight
    // reachable.
    const w = world();
    const s = createRtState(742);
    s.markers.push(
      marker({ id: 0, x: 0, z: 6, arena: 5, foes: [{ kindId: "ashcap", dx: 0, dz: 1 }] }),
    );
    for (let t = 0; t < 200 && !s.markers[0]!.triggered; t++) {
      rtStep(w, s, [{ type: "move", dx: 0, dz: 1 }]);
    }
    expect(s.lock).not.toBeNull();
    // Press north the whole time: a hero pinned at the ring edge is exactly
    // what used to drive the ashcap's band target outside it.
    for (let t = 0; t < 300; t++) {
      rtStep(w, s, [{ type: "move", dx: 0, dz: 1 }]);
      // Topped up: about the ring, not the fight (see the hero test above).
      s.hero.hp = s.hero.maxHp;
      for (const f of s.foes) {
        f.hp = f.maxHp;
        expect(Math.hypot(f.x, f.z - 6)).toBeLessThanOrEqual(5 + 1e-6);
      }
    }
  });

  it("never leashes a locked fight — a hero pinned at the ring edge is not fleeing", () => {
    // Found by the round-4 capture rig: the village arena and LEASH_RADIUS
    // are both 9.0, so a hero clamped to the ring edge sat at exactly the
    // leash boundary and float noise sent the whole pack walking home from
    // a player who could not follow. While a lock is live the lock IS the
    // leash: both sides are clamped, and nobody can actually flee.
    const w = world();
    const s = createRtState(744);
    s.markers.push(
      marker({
        id: 0,
        x: 0,
        z: 6,
        arena: LEASH_RADIUS,
        foes: [
          { kindId: "rotling", dx: 0, dz: 1 },
          { kindId: "ashcap", dx: 3, dz: 1 },
        ],
      }),
    );
    for (let t = 0; t < 200 && !s.markers[0]!.triggered; t++) {
      rtStep(w, s, [{ type: "move", dx: 0, dz: 1 }]);
    }
    expect(s.lock).not.toBeNull();
    for (let t = 0; t < 300; t++) {
      rtStep(w, s, [{ type: "move", dx: 1, dz: 0 }]); // pin at the east edge
      s.hero.hp = s.hero.maxHp;
      for (const f of s.foes) {
        f.hp = f.maxHp;
        expect(f.leashed, `${f.kindId} gave up a fight the hero cannot leave`).toBe(false);
      }
    }
    // Engaged means ENGAGED: the charger is on the pinned hero, not at home.
    const rotling = s.foes.find((f) => f.kindId === "rotling")!;
    expect(
      Math.hypot(rotling.x - s.hero.x, rotling.z - s.hero.z),
      "the pack disengaged from a pinned hero",
    ).toBeLessThan(4);
  });

  it("a knockback cannot eject a foe from the ring — not even a winding one", () => {
    const w = world();
    const s = createRtState(743);
    s.markers.push(
      marker({ id: 0, x: 0, z: 6, arena: 5, foes: [{ kindId: "rotling", dx: 0, dz: 1 }] }),
    );
    for (let t = 0; t < 200 && !s.markers[0]!.triggered; t++) {
      rtStep(w, s, [{ type: "move", dx: 0, dz: 1 }]);
    }
    expect(s.lock).not.toBeNull();
    const f = s.foes[0]!;
    // A shove IS a velocity write (step.ts `shove`); write the same shape at
    // the ring's inner edge, big enough to clear it in one tick. Winding, so
    // the velocity applies uncapped — the hardest case to contain.
    f.x = 0;
    f.z = 10.5;
    f.vx = 0;
    f.vz = 2;
    f.windup = 10;
    rtStep(w, s, []);
    expect(Math.hypot(f.x, f.z - 6)).toBeLessThanOrEqual(5 + 1e-6);
  });

  /* ------------------------------------------------- the stage boundary */

  it("clears a stage only once every fight is won AND the exit is reached", () => {
    const w = world();
    const s = createRtState(741);
    // Generous gate: this world has real terrain, and a hero steering at a
    // point still settles a couple of metres off it on a grade. The claim
    // under test is the RULE, not the pathing.
    s.stages = [{ id: "a", exitX: 0, exitZ: 20, exitR: 4, cleared: false }];
    s.markers.push(
      marker({ id: 0, x: 0, z: 6, arena: 1000, foes: [{ kindId: "rotling", dx: 0, dz: 1 }] }),
    );

    // Steer AT the exit, rather than pushing a compass direction — this world
    // has real terrain and a body walking due north slides several metres
    // sideways on the grade, which would make the miss look like a rule.
    const atExit = (): RtCommand => {
      const dx = 0 - s.hero.x;
      const dz = 20 - s.hero.z;
      const d = Math.hypot(dx, dz) || 1;
      return { type: "move", dx: dx / d, dz: dz / d };
    };

    // Stand right on the exit with the fight still live: nothing happens.
    for (let t = 0; t < 400; t++) {
      rtStep(w, s, [atExit()]);
      s.hero.hp = s.hero.maxHp;
      for (const f of s.foes) f.hp = f.maxHp;
    }
    expect(Math.hypot(s.hero.x, s.hero.z - 20)).toBeLessThan(4);
    expect(s.stages[0]!.cleared, "the stage cleared with its fight still live").toBe(false);

    // Win it, and standing on the gate is now enough.
    for (const f of s.foes) f.hp = 0;
    let seam = -1;
    for (let t = 0; t < 100 && seam < 0; t++) {
      seam = rtStep(w, s, [atExit()]).stageCleared;
    }
    expect(seam).toBe(0);
    expect(s.stages[0]!.cleared).toBe(true);
  });

  it("does not wake a fight belonging to a stage that is not live", () => {
    const w = world();
    const s = createRtState(708);
    s.stages = [
      { id: "a", exitX: 0, exitZ: 40, exitR: 2, cleared: false },
      { id: "b", exitX: 0, exitZ: 60, exitR: 2, cleared: false },
    ];
    s.markers.push(marker({ id: 0, stage: 1, x: 0, z: 6, foes: [{ kindId: "rotling", dx: 0, dz: 1 }] }));
    for (let t = 0; t < 300; t++) rtStep(w, s, [{ type: "move", dx: 0, dz: 1 }]);
    expect(s.markers[0]!.triggered, "a dormant stage's fight woke up").toBe(false);
    expect(s.foes).toHaveLength(0);
  });

  it("a free spawn owns no marker, so it neither blocks nor clears one", () => {
    const w = world();
    const s = createRtState(706);
    s.markers.push(marker({ id: 0, x: 0, z: 6, foes: [{ kindId: "rotling", dx: 0, dz: 1 }] }));
    for (let t = 0; t < 300 && !s.markers[0]!.triggered; t++) {
      rtStep(w, s, [{ type: "move", dx: 0, dz: 1 }]);
    }
    // A sandbox-style wave lands on top of the fight.
    rtStep(w, s, [{ type: "spawn", kindId: "rotling", x: 20, z: 20 }]);
    expect(s.foes.some((f) => f.markerId === -1)).toBe(true);

    for (const f of s.foes) if (f.markerId === 0) f.hp = 0;
    rtStep(w, s, []);
    rtStep(w, s, []);
    expect(s.markers[0]!.cleared).toBe(true);
    expect(s.foes.length).toBeGreaterThan(0); // the free spawn is still alive
  });

  /* ---------------------------------------------- the hash actually measures */

  it("hashes the committed mix, so a cast in flight is not invisible", () => {
    const w = world();
    const a = createRtState(707);
    const b = createRtState(707);
    for (const e of ["fire", "fire", "fire"] as Element[]) {
      rtStep(w, a, [{ type: "queue", element: e }]);
      rtStep(w, b, [{ type: "queue", element: e }]);
    }
    // `a` commits the mix; `b` throws it away. The queue is empty in both.
    rtStep(w, a, [{ type: "cast", form: "aimed", aimX: 0, aimZ: 9 }]);
    rtStep(w, b, [{ type: "clear" }]);
    expect(a.hero.queue).toHaveLength(0);
    expect(b.hero.queue).toHaveLength(0);
    expect(hashRt(a)).not.toBe(hashRt(b));
  });

  it("hashes marker ownership and carried loot", () => {
    const w = world();
    const s = createRtState(708);
    spawnFoe(s, "rotling", 3, 3);
    const base = hashRt(s);
    s.foes[0]!.markerId = 2;
    expect(hashRt(s)).not.toBe(base);
    s.foes[0]!.markerId = -1;
    expect(hashRt(s)).toBe(base);
    s.loot += 1;
    expect(hashRt(s)).not.toBe(base);
    void w;
  });

  it("pays spores for a kill, and the payment survives a JSON round-trip", () => {
    const w = world();
    const s = createRtState(709);
    spawnFoe(s, "rotling", 0, 3);
    expect(s.loot).toBe(0);
    s.foes[0]!.hp = 0;
    rtStep(w, s, []);
    expect(s.loot).toBeGreaterThan(0);
    expect(hashRt(cloneRtState(s))).toBe(hashRt(s));
  });
});

/* ------------------------------------------------------------------------ */
/*  The authored road                                                        */
/* ------------------------------------------------------------------------ */

/**
 * Properties of the shipped scenario that are PEDAGOGY rather than code, and
 * that a coordinate tweak could silently break.
 *
 * The pool teach in particular is a claim about placement — "both foes start
 * Wet because of where the fight is" — and a claim like that has to be checked
 * against the real world data, not against the comment that asserts it.
 */
describe("scenery fires — water answers the world's fires too", () => {
  /**
   * The first human playtest cast WATER at a burning hut and the world
   * ignored them: the flames were pure presentation. The player reached for
   * the game's own centre — water answers fire — so now the world answers
   * back (`GAME_DESIGN.md` §3.3).
   */
  const withFire = (): [ReturnType<typeof createSimWorld>, ReturnType<typeof createRtState>] => {
    const w = world();
    const s = createRtState(900);
    s.hutFires.push({ id: s.nextId++, x: 0, z: 8, r: 2.2, lit: true, stage: -1, keepLit: false, lit0: true, stage0: -1 });
    return [w, s];
  };
  const cast = (
    w: ReturnType<typeof createSimWorld>,
    s: ReturnType<typeof createRtState>,
    mix: Element[],
    aimZ: number,
  ): ReturnType<typeof rtStep>[] => {
    const out: ReturnType<typeof rtStep>[] = [];
    for (const e of mix) out.push(rtStep(w, s, [{ type: "queue", element: e }]));
    out.push(rtStep(w, s, [{ type: "cast", form: "aimed", aimX: 0, aimZ }]));
    for (let i = 0; i < 40; i++) out.push(rtStep(w, s, []));
    return out;
  };

  it("a water bolt douses the fire, pays spores, and reports the moment", () => {
    const [w, s] = withFire();
    const evs = cast(w, s, ["water"], 8);
    expect(s.hutFires[0]!.lit).toBe(false);
    expect(s.loot).toBeGreaterThan(0);
    expect(evs.flatMap((e) => e.hutDoused)).toHaveLength(1);
  });

  it("a lit fire INTERCEPTS the bolt — dousing works from any range", () => {
    // Forward-fire's aim point is a fixed 9 m ahead. Without interception, a
    // bolt cast from 4 m away flies through the burning hut and detonates
    // 5 m behind it — dousing would only work from one magic distance, which
    // is exactly the frustration shape the playtest hit.
    const [w, s] = withFire();
    s.hero.z = 4; // hut at 8: the 9 m aim point is at 13, well past it
    cast(w, s, ["water"], 13);
    expect(s.hutFires[0]!.lit, "the bolt sailed through the flames").toBe(false);
  });

  it("fire, lightning and spore do not douse anything", () => {
    const [w, s] = withFire();
    for (const e of ["fire", "lightning", "spore"] as Element[]) {
      cast(w, s, [e], 8);
    }
    expect(s.hutFires[0]!.lit).toBe(true);
  });

  it("newRun relights the village; restartStage leaves it doused", () => {
    const [w, s] = withFire();
    s.stages = [{ id: "a", exitX: 0, exitZ: 40, exitR: 2, cleared: false }];
    cast(w, s, ["water"], 8);
    expect(s.hutFires[0]!.lit).toBe(false);
    rtStep(w, s, [{ type: "restartStage", x: 0, z: 0 }]);
    expect(s.hutFires[0]!.lit, "a stage retry relit the village").toBe(false);
    rtStep(w, s, [{ type: "newRun", x: 0, z: 0 }]);
    expect(s.hutFires[0]!.lit, "walking the road again should restore it").toBe(true);
  });

  it("a lit fire bound to the stage holds its gate SHUT (round 7: dousing is required)", () => {
    const [w, s] = withFire();
    s.stages = [{ id: "a", exitX: 0, exitZ: 12, exitR: 2, cleared: false }];
    s.hutFires[0]!.stage = 0;
    // Stand in the exit disc with the fight (no markers) long since over.
    s.hero.x = 0;
    s.hero.z = 12;
    rtStep(w, s, []);
    expect(s.stages[0]!.cleared, "the gate opened around a burning hut").toBe(false);
    // Douse it, walk back into the disc: now the seam opens.
    s.hero.z = 4;
    cast(w, s, ["water"], 8);
    expect(s.hutFires[0]!.lit).toBe(false);
    s.hero.x = 0;
    s.hero.z = 12;
    const ev = rtStep(w, s, []);
    expect(s.stages[0]!.cleared).toBe(true);
    expect(ev.stageCleared).toBe(0);
  });

  it("a fire bound to ANOTHER stage — or to none — never gates this one", () => {
    for (const stage of [1, -1]) {
      const [w, s] = withFire();
      s.stages = [{ id: "a", exitX: 0, exitZ: 12, exitR: 2, cleared: false }];
      s.hutFires[0]!.stage = stage;
      s.hero.x = 0;
      s.hero.z = 12;
      rtStep(w, s, []);
      expect(s.stages[0]!.cleared, `a fire with stage ${stage} blocked stage 0`).toBe(true);
    }
  });

  it("the village fights still open at range — interception must not eat the pool", () => {
    // The pool fight's bolts fly over water between bodies that stand well
    // clear of the burning huts (nearest lit fire is 3.4 m from the trough
    // edge). This pins that a cast INSIDE the village at a foe is not
    // swallowed by a hut fire on the way.
    const w = world();
    const s = createRtState(901);
    s.hutFires.push({ id: s.nextId++, x: -5.5, z: 24.5, r: 2.2, lit: true, stage: -1, keepLit: false, lit0: true, stage0: -1 });
    s.hero.z = 22;
    spawnFoe(s, "rotling", 0.5, 27);
    rtStep(w, s, []);
    const before = s.foes[0]!.hp;
    cast(w, s, ["lightning"], 31);
    expect(s.foes[0]!.hp, "the bolt never reached the foe").toBeLessThan(before);
  });

  /* ------------------------- braziers: the grammar inverted (R4) -------- */

  const withPyre = (
    lit: boolean,
  ): [ReturnType<typeof createSimWorld>, ReturnType<typeof createRtState>] => {
    const w = world();
    const s = createRtState(902);
    s.hutFires.push({ id: s.nextId++, x: 0, z: 8, r: 1.3, lit, stage: -1, keepLit: true, lit0: true, stage0: -1 });
    return [w, s];
  };

  it("a DARK brazier holds its gate shut; a lit one opens it — the douse gate inverted", () => {
    for (const [lit, wantCleared] of [
      [false, false],
      [true, true],
    ] as const) {
      const [w, s] = withPyre(lit);
      s.hutFires[0]!.stage = 0;
      s.stages = [{ id: "a", exitX: 0, exitZ: 12, exitR: 2, cleared: false }];
      s.hero.x = 0;
      s.hero.z = 12;
      rtStep(w, s, []);
      expect(
        s.stages[0]!.cleared,
        lit ? "a burning pyre blocked its own gate" : "the gate opened around a dark pyre",
      ).toBe(wantCleared);
    }
  });

  it("FIRE relights a dark brazier from EVERY range, reports it — and pays nothing", () => {
    // fun's R4 verdict pass measured a hit band of only 7.8-9.3 m: the
    // catch's muzzle grace was hero-proximity, so a player who obeyed the
    // banner — walked TO the bowl and cast — got nothing, silently. The
    // grace is distance FLOWN now; the whole band works, point-blank
    // included.
    for (const heroZ of [6.7, 4.5, 2] as const) {
      const [w, s] = withPyre(false);
      s.hero.z = heroZ; // bowl at z=8: 1.3 m, 3.5 m, 6 m out
      const evs = cast(w, s, ["fire"], 13);
      expect(
        s.hutFires[0]!.lit,
        `the fire bolt sailed over the dark bowl from ${8 - heroZ} m`,
      ).toBe(true);
      expect(evs.flatMap((e) => e.pyreLit)).toHaveLength(1);
      expect(s.loot).toBe(0);
    }
  });

  it("FIRE never re-ignites a doused hut — the village lesson stays finished", () => {
    const [w, s] = withFire();
    s.hutFires[0]!.lit = false;
    cast(w, s, ["fire"], 8);
    expect(s.hutFires[0]!.lit, "a fire cast re-lit a doused hut").toBe(false);
  });

  it("a water douse of a brazier reports the moment but pays NOTHING", () => {
    const [w, s] = withPyre(true);
    const evs = cast(w, s, ["water"], 8);
    expect(s.hutFires[0]!.lit).toBe(false);
    expect(evs.flatMap((e) => e.hutDoused)).toHaveLength(1);
    expect(s.loot, "a bowl the player can cycle wet/dry paid spores").toBe(0);
  });

  it("the sodden coat: dry beside a lit bowl, re-wet beside a dark one — and burning obeys", () => {
    // The boss's dried-window mechanism (R4), isolated from the stray pools
    // that make the funnel's lane emergent: a lit brazier inside dryRadius
    // pauses the self-wet cadence; a dark one lets it run; and the
    // anti-synergy decides whether fire's status ever sticks. (The
    // born-sodden recut is the boss sitting's, with its probe record.)
    const [w, s] = withPyre(true);
    spawnFoe(s, "thornback", 0, 4);
    const boss = s.foes[0]!;
    // Aim at the LIVE body — the boss orbits its standoff ring, and a cast
    // at the spawn point sails past a boss that has strafed east (measured:
    // the first cut of this test asserted against a clean miss).
    const castAtBoss = (mix: Element[]): void => {
      for (const e of mix) rtStep(w, s, [{ type: "queue", element: e }]);
      rtStep(w, s, [{ type: "cast", form: "aimed", aimX: boss.x, aimZ: boss.z }]);
      for (let i = 0; i < 40; i++) rtStep(w, s, []);
    };
    // Lit bowl at 4 m — inside dryRadius. Two full cadences: still dry.
    for (let t = 0; t < 100; t++) rtStep(w, s, []);
    expect(hasStatus(boss.statuses, "wet"), "the coat re-wet beside a lit bowl").toBe(false);
    // Burning sticks on the dry coat.
    castAtBoss(["fire"]);
    expect(hasStatus(boss.statuses, "burning"), "fire failed on a DRY boss").toBe(true);
    // Douse the bowl: the cadence resumes, the coat returns — and the next
    // re-wet EXTINGUISHES the burning through the same matrix rule.
    s.hutFires[0]!.lit = false;
    for (let t = 0; t < 50; t++) rtStep(w, s, []);
    expect(hasStatus(boss.statuses, "wet"), "the coat never re-wet beside a dark bowl").toBe(
      true,
    );
    expect(
      hasStatus(boss.statuses, "burning"),
      "the re-wet failed to extinguish the burning",
    ).toBe(false);
  });

  it("the phase turn: douser walk, two adds, one event — behaviour, never stats", () => {
    const [w, s] = withPyre(true);
    spawnFoe(s, "thornback", 0, 6, 7);
    const boss = s.foes[0]!;
    expect(boss.phase).toBe(0);
    boss.hp = boss.maxHp * 0.49;
    const ev = rtStep(w, s, []);
    expect(boss.phase, "the phase never turned").toBe(1);
    expect(boss.douser, "phase 2 did not start the douser walk").toBe(true);
    expect(ev.bossPhase?.kindId).toBe("thornback");
    const adds = s.foes.filter((f) => f.kindId === "sopling");
    expect(adds, "the adds never spawned").toHaveLength(2);
    for (const a of adds) expect(a.markerId, "an add is not marker-owned").toBe(7);
    // Once: the next tick turns nothing.
    const ev2 = rtStep(w, s, []);
    expect(ev2.bossPhase, "the phase turned twice").toBeNull();
  });

  /* ------------------- the recut (R4 boss sitting, Phase B) ------------- */

  it("born sodden: the coat is ON from the first standing tick — no free burn window", () => {
    const w = world();
    const s = createRtState(905);
    spawnFoe(s, "thornback", 0, 6);
    rtStep(w, s, []);
    expect(
      hasStatus(s.foes[0]!.statuses, "wet"),
      "the boss spawned dry — the fight banks a free burn window before the anti-synergy exists",
    ).toBe(true);
  });

  it("the soak beat: one attributable pulse per cadence while the coat is on — silent beside a lit bowl", () => {
    const kb = foeKind("thornback").boss!;
    const w = world();
    const s = createRtState(906);
    spawnFoe(s, "thornback", 0, 6);
    const boss = s.foes[0]!;
    boss.windup = 100000; // stands still: any hp change is the mechanic's own
    rtStep(w, s, []); // the born-sodden application (full hp — no heal)
    boss.hp = 100;
    let beats = 0;
    let healed = 0;
    for (let i = 0; i < 46; i++) {
      const ev = rtStep(w, s, []);
      if (ev.bossSoaked) {
        beats++;
        healed += ev.bossSoaked.healed;
      }
    }
    expect(beats, "no soak beat fired across a full cadence").toBe(1);
    expect(
      healed,
      "the heal is not soakRegen × rewetTicks in ONE pulse — a trickle is an invisible heal",
    ).toBeCloseTo(kb.soakRegen * kb.rewetTicks, 5);
    expect(boss.hp).toBeCloseTo(100 + kb.soakRegen * kb.rewetTicks, 5);
    // Light a bowl beside it: the cadence pauses, and with it the drinking —
    // the taught answer to the regen IS the bowl, so the pause must be total.
    s.hutFires.push({ id: s.nextId++, x: 0, z: 8, r: 1.3, lit: true, stage: -1, keepLit: true, lit0: true, stage0: -1 });
    const hpAtPause = boss.hp;
    let pausedBeats = 0;
    for (let i = 0; i < 120; i++) {
      const ev = rtStep(w, s, []);
      if (ev.bossSoaked) pausedBeats++;
    }
    expect(pausedBeats, "the coat kept drinking beside a lit bowl").toBe(0);
    expect(boss.hp, "hp rose with the cadence paused").toBeLessThanOrEqual(hpAtPause);
  });

  it("the dry window announces itself: bossDried fires when the coat ends beside a lit bowl — a dark-bowl strip stays silent", () => {
    // Expiry path: born-sodden, then a bowl lights; the cadence pauses and
    // the standing coat runs out — announced ONCE (fun's watch-item: this
    // moment must be loud, and gfx's steam-off keys off this event).
    const w = world();
    const s = createRtState(907);
    spawnFoe(s, "thornback", 0, 6);
    const boss = s.foes[0]!;
    boss.windup = 100000;
    rtStep(w, s, []);
    expect(hasStatus(boss.statuses, "wet")).toBe(true);
    s.hutFires.push({ id: s.nextId++, x: 0, z: 8, r: 1.3, lit: true, stage: -1, keepLit: true, lit0: true, stage0: -1 });
    let driedEvents = 0;
    for (let i = 0; i < 200; i++) {
      const ev = rtStep(w, s, []);
      if (ev.bossDried) driedEvents++;
    }
    expect(hasStatus(boss.statuses, "wet"), "the coat never ran out beside a lit bowl").toBe(false);
    expect(driedEvents, "the dry window opened silently — the invisible-heal complaint pre-written").toBe(1);

    // Vacuity guard: beside DARK bowls a fire strip buys a 1.5 s micro-window
    // before the cadence re-wets — announcing THAT teaches the loud moment
    // to lie, so it must stay silent.
    const s2 = createRtState(908);
    spawnFoe(s2, "thornback", 0, 4);
    const b2 = s2.foes[0]!;
    b2.windup = 100000;
    rtStep(w, s2, []);
    expect(hasStatus(b2.statuses, "wet")).toBe(true);
    rtStep(w, s2, [{ type: "queue", element: "fire" }]);
    let dried2 = 0;
    for (let i = 0; i < 34; i++) {
      const ev = rtStep(w, s2, i === 0 ? [{ type: "cast", form: "aimed", aimX: b2.x, aimZ: b2.z }] : []);
      if (ev.bossDried) dried2++;
    }
    expect(hasStatus(b2.statuses, "wet"), "the fire strip never landed — this half measured nothing").toBe(false);
    expect(dried2, "a dark-bowl micro-window announced itself as THE window").toBe(0);
  });

  it("a stage RETRY re-arms tactical bowls to authored dark and leaves objective fires inherited — the pinata path, closed", () => {
    const w = world();
    const s = createRtState(909);
    // The boss arena's tactical bowl, authored dark, lit by the player.
    s.hutFires.push({ id: s.nextId++, x: 0, z: 8, r: 1.3, lit: true, stage: -1, keepLit: true, lit0: false, stage0: 0 });
    // A gating pyre of the same stage, standing dark: retry INHERITS it
    // (pinned semantics — that state is progress toward the gate).
    s.hutFires.push({ id: s.nextId++, x: 4, z: 8, r: 1.3, lit: false, stage: 0, keepLit: true, lit0: true, stage0: 0 });
    // Another stage's tactical bowl: out of this retry's scope entirely.
    s.hutFires.push({ id: s.nextId++, x: 8, z: 8, r: 1.3, lit: true, stage: -1, keepLit: true, lit0: false, stage0: 3 });
    rtStep(w, s, [{ type: "restartStage", x: 0, z: 0 }]);
    expect(
      s.hutFires[0]!.lit,
      "the lit bowl survived the retry — every retry fights a pre-dried, regen-free boss",
    ).toBe(false);
    expect(
      s.hutFires[1]!.lit,
      "an OBJECTIVE fire was re-armed — the pinned retry-inherit semantics broke",
    ).toBe(false);
    expect(s.hutFires[2]!.lit, "another stage's bowl was re-armed by this retry").toBe(true);
  });

  it("a bolt's PRIMARY victim is still shoved along the flight line — the edge-hit fix must not eat authored knockback", () => {
    // Phase A detonates a bolt ON its victim, which puts the primary at the
    // blast centre where "away from the blast" is no direction at all
    // (comp's audit catch). The fallback shoves from the bolt's previous
    // flight position — spore's 1.4, the table's loudest shove, must move
    // its direct target downrange.
    const w = world();
    const s = createRtState(910);
    spawnFoe(s, "thornback", 0, 4);
    const boss = s.foes[0]!;
    boss.windup = 100000; // no seek: any displacement is the shove's own
    rtStep(w, s, [{ type: "queue", element: "spore" }]);
    rtStep(w, s, [{ type: "cast", form: "aimed", aimX: 0, aimZ: 4 }]);
    for (let i = 0; i < 25; i++) rtStep(w, s, []);
    // ~0.10 m through friction at kb 1.4 — small, but without the fallback
    // it is exactly 0.0000 (the victim IS the centre), so the bar is noise
    // distance, not feel distance.
    expect(
      boss.z,
      "spore's shove died at the blast centre — the primary victim never moved",
    ).toBeGreaterThan(4.05);
  });

  it("a marker-owned douser hunts only ITS stage's bowls — a foreign flame cannot lure it off its fight", () => {
    // The deadlock regression, measured live: the P2 boss marched at
    // damp_pyres' lit pair two stages back, hit the arena clamp, and stood
    // wedged against the ring at full hp forever.
    for (const [stage0, shouldWalk] of [
      [5, false],
      [0, true],
    ] as const) {
      const w = world();
      const s = createRtState(911);
      s.markers.push({
        id: 7,
        stage: 0,
        x: 0,
        z: 0,
        radius: 4,
        arena: 1000,
        foes: [],
        triggered: true,
        cleared: false,
        reinforce: null,
        fightTicks: 0,
        reinforceLeft: 0,
        composed: false,
      });
      spawnFoe(s, "sopling", 0, 2, 7, true);
      const d = s.foes[0]!;
      s.hutFires.push({ id: s.nextId++, x: 0, z: 14, r: 1.3, lit: true, stage: -1, keepLit: true, lit0: true, stage0 });
      const z0 = d.z;
      for (let i = 0; i < 60; i++) rtStep(w, s, []);
      if (shouldWalk) {
        expect(d.z, "a douser ignored its own stage's lit bowl").toBeGreaterThan(z0 + 1.5);
      } else {
        expect(
          d.z,
          "a douser walked at a FOREIGN stage's bowl — the boss-wedge deadlock",
        ).toBeLessThan(z0 + 1.5);
      }
    }
  });

  it("a stray foe lob cannot douse a KEPT flame — the player's own water still can", () => {
    // The recut measured this as a fight-breaker: an anchored hero defending
    // their lit bowl ate a lob every cycle and the splash re-doused the bowl
    // each time — the artillery deleting the bowl counter-play as a side
    // effect. A foe's water now kills a kept flame only when the blast lands
    // ON the bowl (the P2 douse slam does — proven in the opening funnel,
    // bossDousedAt); the player's own splash keeps full reach both ways.
    const w = world();
    const s = createRtState(912);
    s.hutFires.push({ id: s.nextId++, x: 0, z: 8, r: 1.3, lit: true, stage: -1, keepLit: true, lit0: true, stage0: -1 });
    s.hero.z = 6.3; // 1.7 m from the bowl — inside the old splash reach
    spawnFoe(s, "thornback", 0, 0.5);
    let lobsOnHero = 0;
    for (let i = 0; i < 140; i++) {
      const ev = rtStep(w, s, []);
      lobsOnHero += ev.impacts.filter((im) => im.onHero && im.element === "water").length;
    }
    expect(lobsOnHero, "no lob ever landed — the premise measured nothing").toBeGreaterThan(0);
    expect(s.hutFires[0]!.lit, "a stray lob's splash doused the defended flame").toBe(true);
    // The player's own water, aimed at the bowl, still douses by splash.
    s.foes.length = 0;
    rtStep(w, s, [{ type: "queue", element: "water" }]);
    rtStep(w, s, [{ type: "cast", form: "aimed", aimX: 0, aimZ: 8 }]);
    for (let i = 0; i < 30; i++) rtStep(w, s, []);
    expect(s.hutFires[0]!.lit, "the player's own douse lost its splash reach").toBe(false);
  });

  it("a WET foe quenches a lit brazier on contact; a dry one never does", () => {
    for (const wet of [true, false]) {
      const [w, s] = withPyre(true);
      spawnFoe(s, "rotling", 0, 8.4); // inside the bowl's 1.3 m flame
      if (wet) s.foes[0]!.statuses.push({ id: "wet", ticksLeft: 90 });
      const ev = rtStep(w, s, []);
      expect(
        s.hutFires[0]!.lit,
        wet ? "a wet body in the flame did not quench it" : "a DRY body quenched the pyre",
      ).toBe(!wet);
      if (wet) expect(ev.hutDoused).toHaveLength(1);
      expect(s.loot).toBe(0);
    }
  });
});

describe("power is found — the unlock state is a sim rule, not a HUD trick", () => {
  it("drops a queue command for an element that has not been found", () => {
    const w = world();
    const s = createRtState(950, { unlocked: ["spore"], queueMax: 1 });
    rtStep(w, s, [{ type: "queue", element: "fire" }]);
    expect(s.hero.queue, "a locked element reached the queue").toHaveLength(0);
    rtStep(w, s, [{ type: "queue", element: "spore" }]);
    expect(s.hero.queue).toHaveLength(1);
  });

  it("holds one element until THE WEAVE is found, then two", () => {
    const w = world();
    const s = createRtState(951, { unlocked: ["spore", "fire"], queueMax: 1 });
    rtStep(w, s, [
      { type: "queue", element: "spore" },
      { type: "queue", element: "fire" },
    ]);
    expect(s.hero.queue, "mixed before the weave").toHaveLength(1);
    const ev = rtStep(w, s, [{ type: "grant", weave: true }]);
    expect(ev.wove).toBe(true);
    rtStep(w, s, [{ type: "queue", element: "fire" }]);
    expect(s.hero.queue).toHaveLength(2);
  });

  it("grants once, reports once, and replays — it is a command", () => {
    const w = world();
    const s = createRtState(952, { unlocked: ["spore"], queueMax: 1 });
    const ev1 = rtStep(w, s, [{ type: "grant", element: "fire" }]);
    expect(ev1.granted).toEqual(["fire"]);
    const ev2 = rtStep(w, s, [{ type: "grant", element: "fire" }]);
    expect(ev2.granted, "a re-grant re-fired the ceremony").toEqual([]);
    expect(s.unlocked).toEqual(["spore", "fire"]);
  });

  it("splits the hash — two states differing only in an unlock diverge", () => {
    const base = createRtState(953, { unlocked: ["spore"], queueMax: 1 });
    const h0 = hashRt(base);
    const withFire = cloneRtState(base);
    withFire.unlocked.push("fire");
    expect(hashRt(withFire), "hash ignores unlocked").not.toBe(h0);
    const woven = cloneRtState(base);
    woven.queueMax = 2;
    expect(hashRt(woven), "hash ignores queueMax").not.toBe(h0);
  });

  it("newRun walks the road again from the start: SPORE alone, no weave", () => {
    const w = world();
    const s = createRtState(954, { unlocked: ["spore"], queueMax: 1 });
    s.stages = [{ id: "a", exitX: 0, exitZ: 40, exitR: 2, cleared: true }];
    rtStep(w, s, [
      { type: "grant", element: "fire" },
      { type: "grant", weave: true },
    ]);
    expect(s.unlocked).toHaveLength(2);
    rtStep(w, s, [{ type: "newRun", x: 0, z: 0 }]);
    expect(s.unlocked).toEqual(["spore"]);
    expect(s.queueMax).toBe(1);
  });

  it("the seam heals: advanceStage restores the hero for the next stage", () => {
    // Without this the chapter runs on one health bar and every stage inherits
    // the last one's attrition — the funnel measured the correct-play pilot
    // arriving at the gulch too worn to survive a fight it beat when fresh.
    // Difficulty is the stage's own composition (§10), not the tour's wear.
    const w = world();
    const s = createRtState(955);
    s.stages = [
      { id: "a", exitX: 0, exitZ: 40, exitR: 2, cleared: true },
      { id: "b", exitX: 0, exitZ: 60, exitR: 2, cleared: false },
    ];
    s.hero.hp = 12;
    addStatus(s.hero.statuses, "burning");
    rtStep(w, s, [{ type: "advanceStage" }]);
    expect(s.stageIndex).toBe(1);
    expect(s.hero.hp).toBe(s.hero.maxHp);
    expect(s.hero.statuses).toHaveLength(0);
  });
});

describe("casting roots you — the cost is real, not asserted", () => {
  /**
   * `docs/PEDAGOGY.md`'s ◐ row, made falsifiable. The claim: a three-element
   * mix plants your feet long enough to matter, so a bot that only ever
   * commits big casts takes measurably more damage than one that keeps moving.
   *
   * The isolation is the point of the design. Both bots kite identically and
   * cast on the same cadence at a point far BEHIND the fight, so their casts
   * never hit, never shove, and never kill — the only difference between the
   * two runs is how long each cast roots them (13 ticks vs 6). Foes are topped
   * up so exposure stays equal; the hero is topped up so a defeat cannot end
   * one run early. What is left is the rooting cost and nothing else.
   */
  const damageTaken = (elements: Element[]): number => {
    const w = world();
    // The kiting is the instrument here, so the ground it kites over must not
    // be the variable: with trees in it, both bots bump the same scenery and
    // the rooting difference drowns (measured at the R5 re-baseline — 45/36
    // collapsed to 27/27 when the flat world's census rose).
    clearArena(w);
    const s = createRtState(808);
    rtStep(w, s, [
      { type: "spawn", kindId: "rotling", x: 0, z: 7 },
      { type: "spawn", kindId: "rotling", x: 6, z: -4 },
      { type: "spawn", kindId: "rotling", x: -6, z: -4 },
    ]);
    let taken = 0;
    for (let t = 0; t < 600; t++) {
      const cmds: RtCommand[] = [];
      const near = s.foes.reduce<(typeof s.foes)[number] | null>(
        (a, b) =>
          a === null ||
          Math.hypot(b.x - s.hero.x, b.z - s.hero.z) < Math.hypot(a.x - s.hero.x, a.z - s.hero.z)
            ? b
            : a,
        null,
      );
      if (near && s.hero.castTicks === 0) {
        const dx = s.hero.x - near.x;
        const dz = s.hero.z - near.z;
        const d = Math.hypot(dx, dz) || 1;
        cmds.push({ type: "move", dx: dx / d, dz: dz / d });
      }
      if (t % 30 === 0 && !s.hero.casting && s.hero.castTicks === 0) {
        for (const e of elements) cmds.push({ type: "queue", element: e });
        // Away from everything — the cast must cost TIME and nothing else.
        cmds.push({ type: "cast", form: "aimed", aimX: s.hero.x, aimZ: s.hero.z - 30 });
      }
      taken += rtStep(w, s, cmds).heroDamage;
      s.hero.hp = s.hero.maxHp;
      for (const f of s.foes) f.hp = f.maxHp;
    }
    return taken;
  };

  it("a bot that only casts three-element mixes takes more damage than one that stays light", () => {
    const heavy = damageTaken(["lightning", "lightning", "lightning"]);
    const light = damageTaken(["lightning"]);
    console.log(`[roots] three-element bot took ${heavy}, single-element bot took ${light}`);
    expect(heavy, "three-element casts carried no positioning cost").toBeGreaterThan(light);
  });
});

describe("casting recovers — mashing paces the casts, it does not multiply them", () => {
  // The third playtest: "I should not be able to spam d space d space". A
  // cast command every single tick must yield launches spaced by the
  // recovery, and the mashing must never STALL either — a press during
  // recovery buffers and fires the tick the bar fills.
  it("cast commands on every tick launch at the recovery rate", () => {
    const w = world();
    const s = createRtState(7);
    const launches: number[] = [];
    for (let t = 0; t < 240; t++) {
      const cmds: RtCommand[] = [];
      if (s.hero.queue.length === 0) cmds.push({ type: "queue", element: "spore" });
      cmds.push({ type: "cast", form: "aimed", aimX: s.hero.x, aimZ: s.hero.z + 9 });
      const ev = rtStep(w, s, cmds);
      if (ev.casts.length > 0) launches.push(t);
    }
    expect(launches.length).toBeGreaterThan(4);
    for (let i = 1; i < launches.length; i++) {
      const gap = launches[i]! - launches[i - 1]!;
      expect(gap, "two casts landed inside one recovery").toBeGreaterThanOrEqual(
        s.castCooldown + 1,
      );
      // And the chain keeps breathing: recovery + the wind-up, nothing more.
      expect(gap, "mashing stalled the chain").toBeLessThanOrEqual(s.castCooldown + 12);
    }
  });

  it("the recovery is a live dial — zero restores the old chain", () => {
    const w = world();
    const s = createRtState(7);
    s.castCooldown = 0;
    const launches: number[] = [];
    for (let t = 0; t < 60; t++) {
      const cmds: RtCommand[] = [];
      if (s.hero.queue.length === 0) cmds.push({ type: "queue", element: "spore" });
      cmds.push({ type: "cast", form: "aimed", aimX: s.hero.x, aimZ: s.hero.z + 9 });
      if (rtStep(w, s, cmds).casts.length > 0) launches.push(t);
    }
    // With no recovery the spacing is the wind-up alone — strictly tighter.
    expect(launches.length).toBeGreaterThan(4);
    const gap = launches[1]! - launches[0]!;
    expect(gap).toBeLessThan(13);
  });
});

describe("the road north", () => {
  const road = (): [ReturnType<typeof createSimWorld>, ReturnType<typeof createRtState>] => {
    const w = createSimWorld({
      seed: 1337,
      waterLevel: -1.2,
      heightfield: scenarioHeightfieldOptions(),
    });
    const s = createRtState(1337);
    setupEncounters(w, s);
    setupVillage(w, s);
    setupRoad(w, s);
    return [w, s];
  };

  /**
   * A fight looked up by its STAGE ID, never by array index. The chapter grew
   * from 5 stages to 10 and every index-keyed assertion in this suite kept
   * passing against the WRONG fight — the pool checks matched the village by
   * coincidence, which is this project's named failure mode.
   */
  const markerOf = (s: ReturnType<typeof createRtState>, stageId: string) => {
    const idx = STAGES.findIndex((st) => st.id === stageId);
    const m = s.markers.find((k) => k.stage === idx);
    expect(m, `no marker for stage ${stageId}`).toBeDefined();
    return m!;
  };

  /**
   * Drive the hero through a chain of waypoints with real move commands,
   * calling `probe` after every tick. Steering is the same naive seek the
   * game's own autorun uses; the cap is generous so a graze against a trunk
   * cannot turn a slow walk into a false failure.
   */
  const driveAlong = (
    w: ReturnType<typeof createSimWorld>,
    s: ReturnType<typeof createRtState>,
    waypoints: { x: number; z: number }[],
    probe: () => void,
  ): void => {
    let wp = 0;
    for (let t = 0; t < 900 && wp < waypoints.length; t++) {
      const g = waypoints[wp]!;
      const dx = g.x - s.hero.x;
      const dz = g.z - s.hero.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.9) {
        wp++;
        continue;
      }
      rtStep(w, s, [{ type: "move", dx: dx / d, dz: dz / d }]);
      probe();
    }
  };

  /** Index of the road sample nearest a point — the arc a prop or find sits at. */
  const nearestRoadIndex = (
    w: ReturnType<typeof createSimWorld>,
    x: number,
    z: number,
  ): number => {
    let best = 0;
    let bd = Infinity;
    w.roadPath.forEach((p, i) => {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };

  /**
   * Waypoints hugging the VERGE: the road polyline around sample `centre`,
   * pushed `off` metres perpendicular to one side (`side`), from `before`
   * samples ahead of it to `after` samples past it. Samples are ~1 m apart,
   * so the counts are metres, near enough. This is the walk the corridor
   * clamp permits (4.5 m of lateral freedom) but the road surface (half-width
   * 2.4 m) does not cover — the exact stroll of R1's findings.
   */
  const vergeAround = (
    w: ReturnType<typeof createSimWorld>,
    centre: number,
    side: 1 | -1,
    before: number,
    after: number,
    off: number,
  ): { x: number; z: number }[] => {
    const out: { x: number; z: number }[] = [];
    const last = w.roadPath.length - 1;
    for (let i = centre - before; i <= centre + after; i += 2) {
      const a = w.roadPath[Math.max(0, i - 1)]!;
      const b = w.roadPath[Math.min(last, i + 1)]!;
      const p = w.roadPath[Math.max(0, Math.min(last, i))]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      out.push({
        x: p.x + (-(b.z - a.z) / len) * off * side,
        z: p.z + ((b.x - a.x) / len) * off * side,
      });
    }
    return out;
  };

  it("stages every fight on ground its foes can actually stand on", () => {
    const [w, s] = road();
    expect(s.markers.length).toBe(STAGES.length);
    for (const m of s.markers) {
      for (const f of m.foes) {
        expect(
          standable(w, m.x + f.dx, m.z + f.dz),
          `${f.kindId} at marker ${m.id} spawns somewhere it cannot stand`,
        ).toBe(true);
      }
    }
  });

  it("puts EVERY foe of the pool fight in the water — the teach is the placement", () => {
    const [w, s] = road();
    const pool = markerOf(s, "s4");
    expect(pool.foes.length).toBeGreaterThanOrEqual(2);
    for (const f of pool.foes) {
      expect(
        isWetAt(w, pool.x + f.dx, pool.z + f.dz),
        "a pool foe drifted off the water — the Wet+Lightning teach is now luck",
      ).toBe(true);
    }
  });

  it("keeps the pool foes inside one chain hop of each other", () => {
    // A chain that cannot reach the second body is a combo the player sees
    // once, as a single hit, and never understands.
    const [, s] = road();
    const pool = markerOf(s, "s4");
    for (const a of pool.foes) {
      const near = pool.foes.some(
        (b) => b !== a && Math.hypot(a.dx - b.dx, a.dz - b.dz) <= 4.5,
      );
      expect(near, "a pool foe is out of chain range of every other").toBe(true);
    }
  });

  it("opens the pool fight at range rather than on top of the player", () => {
    // Measured the hard way: with foes 1.9 m out behind a 2.6 m trigger, the
    // chargers were inside the hero's own muzzle before a player had tried two
    // mixes, and the fight was over in 2.4 seconds.
    const [, s] = road();
    const pool = markerOf(s, "s4");
    for (const f of pool.foes) {
      expect(Math.hypot(f.dx, f.dz) + pool.radius).toBeGreaterThan(6);
    }
  });

  it("leaves a gap between every gate and the next stage's triggers", () => {
    // Fourth playtest: the village gate stood INSIDE the pool fight's trigger
    // disc, so the fight spawned on the gate tick — no walk-up, no calm frame,
    // and the SPARK find stood in the middle of a live fight. A stage boundary
    // is a stride, not a stop (§9); a fight that opens ON the boundary makes
    // the stride a lie. Asserted generically so the next authored stage cannot
    // reintroduce it.
    const [, s] = road();
    for (let i = 0; i + 1 < STAGES.length; i++) {
      const exit = STAGES[i]!.exit;
      for (const m of s.markers.filter((k) => k.stage === i + 1)) {
        const gap = Math.hypot(exit.x - m.x, exit.z - m.z) - exit.r - m.radius;
        expect(
          gap,
          `${STAGES[i]!.id}'s gate overlaps a ${STAGES[i + 1]!.id} trigger`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("gives the pool its calm approach — a stride and a half from the gate", () => {
    // The pool is the chapter's demonstration (the world shows Wet+Lightning
    // before the weave is granted), and a demonstration that starts as an
    // ambush teaches nothing — the fourth playtest's own words: "the round
    // just started". 6.6 m is 1.5 s of walking at full tilt.
    const [, s] = road();
    const villageExit = STAGES.find((st) => st.id === "s3")!.exit;
    const pool = markerOf(s, "s4");
    const gap =
      Math.hypot(villageExit.x - pool.x, villageExit.z - pool.z) - villageExit.r - pool.radius;
    expect(gap).toBeGreaterThanOrEqual(6.6);
  });

  it("makes the road one-way: a backward run parks behind the last gate", () => {
    // Round 6: the player ran from mid-chapter back to the starting lake.
    // The corridor clamp now ignores samples before the previous stage's
    // gate, so walking backward runs out of road ~CORRIDOR_HALF behind it.
    const [w, s] = road();
    const idx = STAGES.findIndex((st) => st.id === "s5");
    s.stageIndex = idx;
    const gate = STAGES[idx - 1]!.exit; // the boundary: s4's gate
    s.hero.x = gate.x;
    s.hero.z = gate.z;
    const start = s.markers.find((m) => m.stage === 0)!; // stage 1's fight, far south
    for (let t = 0; t < 700; t++) {
      const dx = start.x - s.hero.x;
      const dz = start.z - s.hero.z;
      const d = Math.hypot(dx, dz) || 1;
      rtStep(w, s, [{ type: "move", dx: dx / d, dz: dz / d }]);
    }
    // 700 ticks at full speed covers ~100 m — without the wall the hero
    // reaches the corridor around the opening fight easily. With it, they
    // are parked within a stride of the gate they crossed.
    expect(
      Math.hypot(s.hero.x - start.x, s.hero.z - start.z),
      "the hero walked back into the opening stage",
    ).toBeGreaterThan(15);
    expect(
      Math.hypot(s.hero.x - gate.x, s.hero.z - gate.z),
      "the hero should be parked just behind the boundary gate",
    ).toBeLessThanOrEqual(CORRIDOR_HALF + 2.5);
  });

  it("keeps SPARK reachable behind the one-way boundary — the s3 doubleback", () => {
    // The s3 gate is crossed heading SE and the gem stands on the RETURN
    // leg. Arc order is what makes that legal: the gem's nearest LEGAL road
    // sample (at or past the s3 gate index) must still be inside the
    // corridor, or the find is walled off from the player who just earned it.
    const [w, s] = road();
    const s4 = STAGES.findIndex((st) => st.id === "s4");
    const boundary = w.gateIndices[s4 - 1]!;
    const gem = s.pickups.find((p) => p.kind === "lightning");
    expect(gem, "no lightning pickup in the placed world").toBeDefined();
    let best = Infinity;
    for (let i = boundary; i < w.roadPath.length; i++) {
      const p = w.roadPath[i]!;
      best = Math.min(best, Math.hypot(gem!.x - p.x, gem!.z - p.z));
    }
    expect(best, "SPARK stands outside the legal corridor of its own stage").toBeLessThanOrEqual(
      CORRIDOR_HALF,
    );
    // And the boundaries themselves are sane: one per stage, strictly rising.
    expect(w.gateIndices.length).toBe(STAGES.length);
    for (let i = 1; i < w.gateIndices.length; i++) {
      expect(w.gateIndices[i]!).toBeGreaterThan(w.gateIndices[i - 1]!);
    }
  });

  it("frees Sella mid-stretch — clear of the gate behind her and the fight ahead", () => {
    // Round 5: she stood 1.56 m from the village fight marker, INSIDE its
    // trigger disc, so her rescue and the fight were one beat. The rescue
    // fires when the hero closes to ALLY_JOIN_RADIUS along the approach from
    // the s2 gate, so THAT point is what needs the margins: outside the gate
    // disc (or the seam and the rescue collide on the same tick) and short of
    // the village trigger (or her three lines start under fire). The
    // stages.ts comment has always CLAIMED this gap; this is the assertion.
    const [, s] = road();
    const sella = s.bystanders.find((b) => b.name === SELLA_NAME);
    expect(sella, "Sella is not standing in the placed world").toBeDefined();
    const gate = STAGES.find((st) => st.id === "s2")!.exit;
    const village = markerOf(s, "s3");

    // She stands clear of the fight's trigger disc outright.
    expect(
      Math.hypot(sella!.x - village.x, sella!.z - village.z),
      "Sella stands inside the village fight's trigger disc",
    ).toBeGreaterThan(village.radius);

    // The rescue point: ALLY_JOIN_RADIUS short of her along the gate approach.
    const d = Math.hypot(sella!.x - gate.x, sella!.z - gate.z);
    const rx = sella!.x - ((sella!.x - gate.x) / d) * ALLY_JOIN_RADIUS;
    const rz = sella!.z - ((sella!.z - gate.z) / d) * ALLY_JOIN_RADIUS;
    expect(
      Math.hypot(rx - gate.x, rz - gate.z) - gate.r,
      "the rescue fires on the gate tick — seam and join collide",
    ).toBeGreaterThanOrEqual(0.5);
    expect(
      Math.hypot(rx - village.x, rz - village.z) - village.radius,
      "the rescue fires inside the village fight's trigger",
    ).toBeGreaterThanOrEqual(1.0);
  });

  it("stands every find clear of the next stage's triggers, with take room", () => {
    // The SPARK gem used to stand 1.96 m from the pool fight's centre — deep
    // inside its trigger disc — so taking the find and starting the fight were
    // one moment. A find is a ceremony; it needs the full take envelope
    // (trigger plus PICKUP_RADIUS) to itself.
    const [, s] = road();
    for (const p of s.pickups) {
      for (const m of s.markers.filter((k) => k.stage === p.stage + 1)) {
        expect(
          Math.hypot(p.x - m.x, p.z - m.z),
          `the ${String(p.kind)} find stands inside a ${STAGES[p.stage + 1]!.id} trigger's take envelope`,
        ).toBeGreaterThanOrEqual(m.radius + PICKUP_RADIUS);
      }
    }
  });

  it("meets the pool on dry ground", () => {
    // GAME_DESIGN §3.2: the self-damage lesson is delivered by CHOICE — hang
    // back on dry ground and zapping the water costs nothing; wade in and the
    // chain comes back through it. That choice only exists if the natural
    // approach is dry: the gate before, the gate after, and the point where
    // the walk crosses the trigger line.
    const [w, s] = road();
    const villageExit = STAGES.find((st) => st.id === "s3")!.exit;
    const poolExit = STAGES.find((st) => st.id === "s4")!.exit;
    const pool = markerOf(s, "s4");
    expect(isWetAt(w, villageExit.x, villageExit.z), "the village gate is in the water").toBe(
      false,
    );
    expect(isWetAt(w, poolExit.x, poolExit.z), "the pool gate is in the water").toBe(false);
    const d = Math.hypot(villageExit.x - pool.x, villageExit.z - pool.z);
    const cx = pool.x + ((villageExit.x - pool.x) / d) * pool.radius;
    const cz = pool.z + ((villageExit.z - pool.z) / d) * pool.radius;
    expect(isWetAt(w, cx, cz), "the fight triggers with the player already wet").toBe(false);
  });

  it("puts the village fight's spitter off the road axis, and its charger on it", () => {
    // The facing lesson (`PEDAGOGY.md`), carried by the VILLAGE fight since the
    // curriculum restage. The charger delivers itself to whoever is walking
    // north; the Cinderling — the fire-spitter that lit the huts (round 7) —
    // holds its band off to the side and has to be turned toward. If both
    // ever end up on the axis, the lesson evaporates and `opening.test.ts`'s
    // naive pilot starts passing a test it should fail.
    const [, s] = road();
    const village = markerOf(s, "s3");
    const charger = village.foes.find((f) => f.kindId === "rotling")!;
    const spitter = village.foes.find((f) => f.kindId === "cinderling")!;
    expect(Math.abs(charger.dx)).toBeLessThan(1.5);
    expect(Math.abs(spitter.dx)).toBeGreaterThan(3);
  });

  it("routes the road via Sella, so she cannot be walked past", () => {
    const [, s] = road();
    const sella = s.bystanders.find((b) => b.name === "Sella")!;
    expect(sella.ai).toBe("captive");
    // Between the Mossy Bend fight and the village fight, which is what makes
    // the rescue unmissable on the walk in.
    expect(sella.z).toBeGreaterThan(markerOf(s, "s2").z);
    expect(sella.z).toBeLessThan(markerOf(s, "s3").z);
  });

  it("closes the stage for a verge walk past the gate — the seam spans the corridor", () => {
    // R1 (fun, by real play). Every exit disc is r=2.4 — the ROAD half-width —
    // while the corridor clamp grants 4.5 m of lateral freedom, so a walk
    // along the verge crosses the gate line without ever entering the disc:
    // the stage never closes, the next stage never wakes, and the road ahead
    // is dead. The seam must span everywhere the clamp lets the hero walk.
    const [w, s] = road();
    for (const m of s.markers) {
      if (m.stage === 0) {
        m.triggered = true;
        m.cleared = true;
      }
    }
    const gate = STAGES[0]!.exit;
    let minGateD = Infinity;
    driveAlong(w, s, vergeAround(w, w.gateIndices[0]!, 1, 9, 9, 4.0), () => {
      minGateD = Math.min(minGateD, Math.hypot(s.hero.x - gate.x, s.hero.z - gate.z));
    });
    // The walk provably stayed out of the disc — otherwise a green here would
    // measure nothing (the named failure mode), and a red would be no repro.
    expect(minGateD, "the verge walk strayed into the exit disc — probe is vacuous").toBeGreaterThan(
      gate.r,
    );
    expect(s.stages[0]!.cleared, "a verge walk slipped past the gate unclosed").toBe(true);
  });

  it("frees Sella for a verge walk too — the rescue spans the corridor", () => {
    // Same hole, second symptom: ALLY_JOIN_RADIUS is 3.0 m against the
    // corridor's 4.5, and "the road is carved through her" is only true of
    // the centreline — a verge walk passes her un-rescued, and with her go
    // the douse ask, the SPARK thanks and the pool's question.
    const [w, s] = road();
    const villageIdx = STAGES.findIndex((st) => st.id === "s3");
    applyResume(s, villageIdx, encodeFound(["water"], false));
    const sella = s.bystanders.find((b) => b.name === SELLA_NAME)!;
    expect(sella.ai).toBe("captive");
    // The road BENDS at her vertex, so the honest verge walk is the arc the
    // clamp actually permits around the outside of the bend: a sweep at 4.2 m
    // from her, from the approach side (the s2 gate) round to the departure
    // side (the village fight), never closer than the corridor's edge allows.
    // (Test-side trig: only src/sim bans it.)
    const village = markerOf(s, "s3");
    const a1 = Math.atan2(s.hero.z - sella.z, s.hero.x - sella.x);
    const a2 = Math.atan2(village.z - sella.z, village.x - sella.x);
    const sweep = (dir: 1 | -1): { x: number; z: number }[] => {
      const out: { x: number; z: number }[] = [];
      let span = (a2 - a1) * dir;
      while (span < 0) span += Math.PI * 2;
      for (let k = 0; k <= 8; k++) {
        const th = a1 + dir * (span * k) / 8;
        out.push({ x: sella.x + Math.cos(th) * 4.2, z: sella.z + Math.sin(th) * 4.2 });
      }
      return out;
    };
    // Of the two ways round her, take the one whose midpoint stays farther
    // from the village fight — the OUTSIDE of the bend.
    const [wa, wb] = [sweep(1), sweep(-1)];
    const far = (p: { x: number; z: number }): number =>
      Math.hypot(p.x - village.x, p.z - village.z);
    const wps = far(wa[4]!) > far(wb[4]!) ? wa : wb;
    // Probe against her CAPTIVE spot, while captive — a freed Sella follows
    // the hero, so measuring her live position would count her own walk as
    // the hero's approach.
    const post = { x: sella.x, z: sella.z };
    let minD = Infinity;
    driveAlong(w, s, wps, () => {
      if (sella.ai !== "captive") return;
      minD = Math.min(minD, Math.hypot(s.hero.x - post.x, s.hero.z - post.z));
    });
    expect(minD, "the verge walk came inside the join radius — probe is vacuous").toBeGreaterThan(
      ALLY_JOIN_RADIUS,
    );
    expect(sella.ai, "a verge walk passed Sella un-rescued").toBe("following");
  });

  it("grants a take on the walk from a won fight to its gem — crossing IS clearing", () => {
    // R1, third symptom of the same hole (fun's exact repro): the FIRE gem
    // stands 3.5 m from its exit, reachable by beeline from the won Ashen
    // Rise fight WITHOUT entering the 2.4 m exit disc — so the stage never
    // cleared and F silently refused at ~1 m from the gem, then granted from
    // the same spot after the disc was crossed. Walking to post-gate content
    // must count as crossing the gate.
    const [w, s] = road();
    const fireIdx = STAGES.findIndex((st) => st.grants === "fire");
    expect(fireIdx, "no stage grants fire").toBeGreaterThan(0);
    applyResume(s, fireIdx, foundBitsThroughStage(fireIdx));
    for (const m of s.markers) {
      if (m.stage === fireIdx) {
        m.triggered = true;
        m.cleared = true;
        s.hero.x = m.x;
        s.hero.z = m.z;
      }
    }
    const gem = s.pickups.find((p) => p.kind === "fire")!;
    const exit = STAGES[fireIdx]!.exit;
    let minExitD = Infinity;
    for (let t = 0; t < 600; t++) {
      const dx = gem.x - s.hero.x;
      const dz = gem.z - s.hero.z;
      const d = Math.hypot(dx, dz);
      if (d <= 1.0) break;
      rtStep(w, s, [{ type: "move", dx: dx / d, dz: dz / d }]);
      minExitD = Math.min(minExitD, Math.hypot(s.hero.x - exit.x, s.hero.z - exit.z));
    }
    expect(minExitD, "the beeline entered the exit disc — repro is vacuous").toBeGreaterThan(
      exit.r,
    );
    rtStep(w, s, [{ type: "take" }]);
    expect(gem.taken, "F refused at the gem after the fight was won").toBe(true);
    expect(s.unlocked).toContain("fire");
  });

  it("stands a find past every granting gate — standable, a stride out, clear of Sella", () => {
    // The geometry IS the unskippability guarantee (the pickup radius is wider
    // than the road half-width), so the geometry is what gets asserted.
    const [w, s] = road();
    const granting = STAGES.map((st, i) => ({ st, i })).filter(({ st }) => st.grants);
    expect(s.pickups.length).toBe(granting.length);
    const sella = s.bystanders.find((b) => b.name === "Sella")!;
    for (const p of s.pickups) {
      const st = STAGES[p.stage]!;
      expect(p.kind, `pickup for ${st.id} carries the wrong find`).toBe(st.grants);
      expect(p.taken).toBe(false);
      expect(standable(w, p.x, p.z), `${String(p.kind)} find is not standable`).toBe(true);
      // Past the gate, within a stride: the ceremony belongs to the gate that
      // earned it, and a find at the gate itself would grant under the panel.
      const d = Math.hypot(p.x - st.exit.x, p.z - st.exit.z);
      expect(d, `${String(p.kind)} find sits on its own gate`).toBeGreaterThan(0.8);
      expect(d, `${String(p.kind)} find has wandered from its gate`).toBeLessThan(6);
      // Never stacked on the rescue beat — the recorded turn-build failure was
      // a teaching moment buried under a banner.
      expect(Math.hypot(p.x - sella.x, p.z - sella.z)).toBeGreaterThanOrEqual(4);
    }
  });

  it("a PRE-FIX poisoned save resumes inside the find window — the legacy soft-lock dies", () => {
    // fun's live catch (R4): the gate-refusal rule stops NEW saves from
    // recording a stage past an untaken find, but an autosave written before
    // the rule exists in the wild — their own browser carried one — and
    // resuming it put the player past the one-way boundary with WATER
    // unreachable forever, silently (the chip gates on the current stage's
    // fight). The clamp: resume may not claim a stage the seam could never
    // have closed; it lands at the untaken find's own stage instead, gem
    // AHEAD, run alive. The found bitmask stays exactly as recorded.
    const [, s] = road();
    const villageIdx = STAGES.findIndex((st) => st.id === "s3");
    // The poisoned shape verbatim: stage past the village, water never taken.
    applyResume(s, villageIdx + 1, encodeFound(["lightning"], false));
    expect(
      s.stageIndex,
      "the poisoned save resumed past the untaken WATER — still soft-locked",
    ).toBe(1);
    const water = s.pickups.find((p) => p.kind === "water")!;
    expect(water.taken).toBe(false);
    // The gem stands AHEAD of the resume point's one-way boundary: its own
    // stage is cleared (takeable) and the corridor's `from` is gate 0.
    expect(s.stages[0]!.cleared).toBe(true);
    expect(s.stages[1]!.cleared, "the clamped stage arrived pre-cleared").toBe(false);
    // An honest post-fix save is untouched by the clamp.
    const [, s2] = road();
    applyResume(s2, villageIdx, encodeFound(["water"], false));
    expect(s2.stageIndex).toBe(villageIdx);
  });

  it("resume past the village walks in with Sella at heel; resume AT it leaves her captive", () => {
    // R4 (fun's R3 finding): a resume past the village left Sella standing
    // captive behind the ONE-WAY road — unreachable, her follower voice
    // (the douse urge, the SPARK thanks, the pool question) gone for the
    // whole run. Her stage clearing implies the rescue: the road is carved
    // through her and the rescue spans the corridor, so this is the fires'
    // derivation applied to a body.
    const villageIdx = STAGES.findIndex((st) => st.id === "s3");
    {
      const [, s] = road();
      applyResume(s, villageIdx + 2, foundBitsThroughStage(villageIdx + 2));
      const sella = s.bystanders.find((b) => b.name === SELLA_NAME)!;
      expect(sella.ai, "a resume past the village left Sella captive forever").toBe("following");
    }
    {
      const [, s] = road();
      applyResume(s, villageIdx, foundBitsThroughStage(villageIdx));
      const sella = s.bystanders.find((b) => b.name === SELLA_NAME)!;
      expect(sella.ai, "a resume AT the village pre-rescued Sella — her beat is gone").toBe(
        "captive",
      );
    }
  });

  /**
   * Sella's post: the gate she stops at, derived test-side from the same
   * declaration the sim derives it from — so moving the ash line moves both
   * together, and no assertion here can quietly end up pointing at the wrong
   * gate (this suite's named failure mode, in its index-keyed form).
   */
  const holdPost = (): { stage: number; x: number; z: number } => {
    const captive = STAGES.find((st) => st.captive)?.captive;
    expect(captive, "the chapter declares no captive").toBeDefined();
    const hs = captiveHoldStage(STAGES, captive!);
    expect(hs, "the companion declares no hold biome — the ash line is unauthored").toBeGreaterThan(
      0,
    );
    const gate = STAGES[hs - 1]!.exit;
    return { stage: hs, x: gate.x, z: gate.z };
  };

  it("the valve is conditional and finite — it opens late, feeds, and stops (R5)", () => {
    // The required-mix discriminator, as a rule rather than as an outcome.
    // Three claims, each of which the mechanic would be wrong without: it
    // cannot fire early, it cannot fire while the pack is beaten down, and it
    // cannot fire forever. The last is the one that must be true BY
    // CONSTRUCTION — "endless" is the failure mode that turns a structural
    // discriminator into an unwinnable fight.
    const [w, s] = road();
    const gulch = STAGES.findIndex((st) => st.id === "s6");
    const decl = STAGES[gulch]!.markers[0]!.reinforce;
    expect(decl, "the gulch declares no valve — this test measures nothing").toBeDefined();
    applyResume(s, gulch, foundBitsThroughStage(gulch));
    const m = s.markers.find((k) => k.stage === gulch)!;
    // Stand the hero on the trigger and let the fight open.
    s.hero.x = m.x;
    s.hero.z = m.z;
    let arrivals = 0;
    let firstAt = -1;
    for (let t = 0; t < 900; t++) {
      const ev = rtStep(w, s, []);
      // Keep the pack at strength and the hero upright: this test is about the
      // VALVE, not about who wins.
      for (const f of s.foes) if (f.alive) f.hp = f.maxHp;
      s.hero.hp = s.hero.maxHp;
      if (ev.reinforced.length > 0 && firstAt < 0) firstAt = m.fightTicks;
      arrivals += ev.reinforced.length;
    }
    expect(m.triggered, "the fight never woke — nothing to reinforce").toBe(true);
    expect(firstAt, "an arrival landed before the gate").toBeGreaterThanOrEqual(decl!.after);
    expect(arrivals, "the valve did not spend its budget").toBe(decl!.budget);
    expect(m.reinforceLeft, "the budget did not run out").toBe(0);
    // And it is spent for good: nine hundred more ticks buy nothing.
    let after = 0;
    for (let t = 0; t < 900; t++) {
      const ev = rtStep(w, s, []);
      for (const f of s.foes) if (f.alive) f.hp = f.maxHp;
      s.hero.hp = s.hero.maxHp;
      after += ev.reinforced.length;
    }
    expect(after, "the valve refilled — the fight is endless").toBe(0);
  });

  it("casting a MIX exempts the fight from arrivals, permanently (R5)", () => {
    // The discriminator, as a predicate on player action rather than on any
    // measured quantity. Every threshold shape this replaced was defeated by
    // the spread of the population it had to survive — a pack level, a burst
    // size, a gate tick — and a predicate on "did you compose" has no
    // distribution to be wrong about. It is also what makes the lesson
    // legible: the tide stops the instant you mix.
    const [w, s] = road();
    const gulch = STAGES.findIndex((st) => st.id === "s6");
    const decl = STAGES[gulch]!.markers[0]!.reinforce!;
    applyResume(s, gulch, foundBitsThroughStage(gulch));
    const m = s.markers.find((k) => k.stage === gulch)!;
    s.hero.x = m.x;
    s.hero.z = m.z;
    rtStep(w, s, []);
    expect(m.triggered).toBe(true);
    expect(m.composed, "the fight started already exempt").toBe(false);

    // One mix, cast at the pack. Nothing else about the fight changes: the
    // pack is kept at full strength and the hero upright, so the ONLY thing
    // this test varies is whether a mix was cast.
    rtStep(w, s, [{ type: "queue", element: "water" }]);
    rtStep(w, s, [{ type: "queue", element: "lightning" }]);
    rtStep(w, s, [{ type: "cast", form: "aimed", aimX: m.x, aimZ: m.z + 4 }]);
    let arrivals = 0;
    for (let t = 0; t < 900; t++) {
      const ev = rtStep(w, s, []);
      for (const f of s.foes) if (f.alive) f.hp = f.maxHp;
      s.hero.hp = s.hero.maxHp;
      arrivals += ev.reinforced.length;
    }
    expect(m.composed, "casting a mix did not exempt the fight").toBe(true);
    expect(m.fightTicks, "the fight never reached the gate — nothing to be exempt from").
      toBeGreaterThan(decl.after);
    expect(arrivals, "a composing player was sent reinforcements").toBe(0);
  });

  it("laying the mix BEFORE the fight counts as composing (R5, fun's catch)", () => {
    // The smartest reading of a dry streambed is to lay Conduction into it and
    // let the pack walk into the water. `composed` is marker state set at cast
    // launch, so a mix cast before the trigger had nothing to write to — and
    // the player who solved the stage best was classified a refuser and fed
    // twelve bodies for it. Neither scripted pilot can produce this: both
    // start casting after the trigger. Same shape as the find-skip soft-lock —
    // individually correct rules composing into a trap only off-golden-path
    // play can see.
    const [w, s] = road();
    const gulch = STAGES.findIndex((st) => st.id === "s6");
    applyResume(s, gulch, foundBitsThroughStage(gulch));
    const m = s.markers.find((k) => k.stage === gulch)!;
    // Stand OUTSIDE the trigger, up the road, and compose into the hollow.
    const d = Math.hypot(m.x - s.hero.x, m.z - s.hero.z);
    expect(d, "the resume point is already inside the trigger — no run-up to cast from")
      .toBeGreaterThan(m.radius);
    rtStep(w, s, [{ type: "queue", element: "water" }]);
    rtStep(w, s, [{ type: "queue", element: "lightning" }]);
    rtStep(w, s, [{ type: "cast", form: "aimed", aimX: m.x, aimZ: m.z }]);
    for (let t = 0; t < 20; t++) rtStep(w, s, []);
    expect(m.triggered, "the fight woke early — this measures the pre-cast, not the fight").toBe(
      false,
    );
    // Now walk in.
    s.hero.x = m.x;
    s.hero.z = m.z;
    rtStep(w, s, []);
    expect(m.triggered).toBe(true);
    expect(m.composed, "a player who composed before the trigger was booked as a refuser").toBe(
      true,
    );
  });

  it("an arrival enters from the far side, never into the player's lap (R5, gfx's catch)", () => {
    // gfx drove the cue and found a body gathering INSIDE the pack, two metres
    // from the hero: the entry point was exactly on the ring edge as authored,
    // but the fight had drifted to that edge. Points fixed relative to the
    // MARKER cannot stay away from a fight that moves — and a body appearing
    // in the melee reads as "spawned on top of me" whatever the cue looks
    // like, which defeats the readability condition independently of the art.
    const [w, s] = road();
    const gulch = STAGES.findIndex((st) => st.id === "s6");
    const decl = STAGES[gulch]!.markers[0]!.reinforce!;
    applyResume(s, gulch, foundBitsThroughStage(gulch));
    const m = s.markers.find((k) => k.stage === gulch)!;
    s.hero.x = m.x;
    s.hero.z = m.z;
    rtStep(w, s, []);
    expect(m.triggered).toBe(true);
    // Park the hero hard against one rim, where gfx found the fight had gone.
    let worst = Infinity;
    let arrivals = 0;
    for (let t = 0; t < 900; t++) {
      s.hero.x = m.x + 7;
      s.hero.z = m.z;
      s.hero.hp = s.hero.maxHp;
      const ev = rtStep(w, s, []);
      for (const f of s.foes) if (f.alive) f.hp = f.maxHp;
      for (const a of ev.reinforced) {
        arrivals++;
        worst = Math.min(worst, Math.hypot(a.x - s.hero.x, a.z - s.hero.z));
      }
    }
    expect(arrivals, "no arrival landed — nothing to measure").toBe(decl.budget);
    // Across a ring of this size the far side is always available; the bar is
    // simply that nothing gathers within a body-length or two of the player.
    expect(worst, `an arrival gathered ${worst.toFixed(1)} m from the hero`).toBeGreaterThan(6);
  });

  it("mashing ONE element is not composing (R5, fun's live blocker)", () => {
    // The two-slot queue turns impatience into a spell: pressing one element
    // twice fills it with [spore, spore], which launches as a two-element cast.
    // Crediting that exempted the fight for six presses of one key — and it is
    // the MODAL refuser, because a player who has not learned to compose does
    // not cast neatly-spaced singles, they mash their favourite element. The
    // scripted refuser casts with clean spacing so its queue never doubles,
    // which is exactly why 82 phase samples came back green over this.
    //
    // Composition means COMBINATION. Two distinct elements, or it is not the
    // lesson this fight requires.
    const [w, s] = road();
    const gulch = STAGES.findIndex((st) => st.id === "s6");
    const decl = STAGES[gulch]!.markers[0]!.reinforce!;
    applyResume(s, gulch, foundBitsThroughStage(gulch));
    const m = s.markers.find((k) => k.stage === gulch)!;
    s.hero.x = m.x;
    s.hero.z = m.z;
    rtStep(w, s, []);
    expect(m.triggered).toBe(true);

    // Mash one element, exactly as fun drove it.
    let arrivals = 0;
    for (let t = 0; t < 900; t++) {
      const cmds: RtCommand[] = [];
      if (t % 4 === 0) cmds.push({ type: "queue", element: "spore" });
      if (t % 4 === 1) cmds.push({ type: "cast", form: "aimed", aimX: m.x, aimZ: m.z + 3 });
      const ev = rtStep(w, s, cmds);
      for (const f of s.foes) if (f.alive) f.hp = f.maxHp;
      s.hero.hp = s.hero.maxHp;
      arrivals += ev.reinforced.length;
    }
    expect(m.composed, "mashing one element was credited as composing").toBe(false);
    expect(arrivals, "the masher of a single element was never reinforced").toBe(decl.budget);
  });

  it("a retry re-arms the FLOOR too — attempt two is not fought on attempt one's ground (R5)", () => {
    // fun's live ship-blocker. The retry handler re-arms the marker — foes,
    // `composed`, the clock, the budget — and clears projectiles, and never
    // touches `s.patches`. So the fight comes back as the fight and the GROUND
    // comes back as the aftermath: a water pool laid in the last seconds of a
    // failed attempt is still burning when the retried fight triggers, and one
    // SPARK single into it fires Chain! and exempts the whole attempt.
    //
    // The window is wide, not a knife-edge: water lives ~285 ticks and the walk
    // from the stage entry to the trigger is ~63, so anything laid in the last
    // seven seconds of the previous attempt survives. And it lands on exactly
    // the population the row is about — the player who dies here is by
    // construction the player who was trying things, and water is one of three
    // buttons they have.
    //
    // Asserted as the CLAIM (composed stays false), not as a patch count: the
    // count is not what the row promises.
    const [w, s] = road();
    const gulch = STAGES.findIndex((st) => st.id === "s6");
    applyResume(s, gulch, foundBitsThroughStage(gulch));
    const m = s.markers.find((k) => k.stage === gulch)!;
    s.hero.x = m.x;
    s.hero.z = m.z;
    rtStep(w, s, []);
    expect(m.triggered).toBe(true);

    // Attempt one: lay water on the fight's ground, exactly as a player
    // reaching for one of their three buttons would.
    rtStep(w, s, [{ type: "queue", element: "water" }]);
    rtStep(w, s, [{ type: "cast", form: "aimed", aimX: m.x, aimZ: m.z + 3 }]);
    for (let t = 0; t < 40; t++) rtStep(w, s, []);
    const laid = s.patches.filter(
      (p) => p.kind === "water" && Math.hypot(p.x - m.x, p.z - m.z) <= m.arena + p.r,
    );
    expect(laid.length, "no pool was laid — the repro has nothing to inherit").toBeGreaterThan(0);

    // Die, and take the seam's retry.
    rtStep(w, s, [{ type: "restartStage", x: m.x, z: m.z - 12 }]);
    expect(m.composed, "premise: the retry did not re-arm the exemption").toBe(false);

    // Attempt two: walk back in and refuse — SPARK singles only, never a
    // second element, never a double.
    s.hero.x = m.x;
    s.hero.z = m.z;
    rtStep(w, s, []);
    expect(m.triggered, "the retried fight never woke").toBe(true);
    for (let t = 0; t < 120; t++) {
      const cmds: RtCommand[] = [];
      if (t % 12 === 0) cmds.push({ type: "queue", element: "lightning" });
      if (t % 12 === 1) cmds.push({ type: "cast", form: "aimed", aimX: m.x, aimZ: m.z + 3 });
      rtStep(w, s, cmds);
      s.hero.hp = s.hero.maxHp;
    }
    expect(
      m.composed,
      "a spark single chained through the PREVIOUS attempt's pool and exempted the retry",
    ).toBe(false);
  });

  it("a retry re-arms the valve — attempt two is not silently different (R5)", () => {
    // fun's binding rider. The retry path reset `triggered` and `cleared` and
    // nothing else, so a latch tripped on attempt one stayed tripped, the
    // arrival budget stayed spent, and the gate stayed passed. Attempt two
    // would then be quietly easier than attempt one with no way for the player
    // to know why — which is the worst thing a retry can do, and invisible
    // unless something checks it.
    const [w, s] = road();
    const gulch = STAGES.findIndex((st) => st.id === "s6");
    applyResume(s, gulch, foundBitsThroughStage(gulch));
    const m = s.markers.find((k) => k.stage === gulch)!;
    s.hero.x = m.x;
    s.hero.z = m.z;
    rtStep(w, s, []);
    rtStep(w, s, []);
    // Dirty every field the valve carries, exactly as a real attempt would.
    m.composed = true;
    m.fightTicks = 500;
    m.reinforceLeft = 0;

    rtStep(w, s, [{ type: "restartStage", x: m.x, z: m.z + 12 }]);

    expect(m.composed, "the exemption survived a retry — attempt two starts exempt").toBe(false);
    expect(m.fightTicks, "the clock survived a retry — attempt two starts past the gate").toBe(0);
    expect(m.reinforceLeft, "the budget survived a retry — attempt two starts spent").toBe(
      STAGES[gulch]!.markers[0]!.reinforce!.budget,
    );

  });

  it("a mid-chapter reload never strands the companion (R4.5, fun's ship-blocker)", () => {
    // MEASURED on the pre-fix tree, from this exact construction: `applyResume`
    // freed Sella but left her BODY at the captive point, so every mid-chapter
    // reload started her 12–78 m behind the hero with nothing but a naive seek
    // to close it. Resuming into s9 wedged her at (3.1, 62.2) — 30.5 m from the
    // hero and not one centimetre nearer after 60 s of simulation; resuming
    // into the boss stage wedged her at (19.7, 70.7), 40.0 m out. The road is
    // ONE-WAY, so no walk in the rest of that run can ever recover her: the
    // companion, her voice and every line she still owes are gone.
    //
    // There is no autosave inside `startStage`, so the repro cannot be driven
    // from the debug handle — it is the SAVE that is the repro, and
    // `applyResume` is what `main.ts` boots a resumed campaign with.
    const post = holdPost();
    const captiveAt = STAGES.find((st) => st.captive)!.captive!.at;
    let longHaul = 0;
    for (let i = 1; i < STAGES.length; i++) {
      const [w, s] = road();
      applyResume(s, i, foundBitsThroughStage(i));
      const sella = s.bystanders.find((b) => b.name === SELLA_NAME)!;
      // Resumes before the rescue leave her captive on her road — a different
      // (and already pinned) rule.
      if (sella.ai !== "following") continue;
      if (Math.hypot(s.hero.x - captiveAt[0], s.hero.z - captiveAt[1]) > 40) longHaul++;
      // The hero stands still: this measures HER, not a chase. Sixty seconds
      // is four times the walk she would ever need — and the ONE-SECOND
      // reading is the one that measures the placement rule rather than her
      // legs (comp's R4.5 audit: a 60 s window is long enough for the fen
      // resumes to walk in from the captive point, so the late reading alone
      // was a guard, not a repro). A resume that placed her wrong cannot make
      // this up in thirty ticks.
      for (let t = 0; t < 30; t++) rtStep(w, s, []);
      const dArrived = Math.hypot(sella.x - s.hero.x, sella.z - s.hero.z);
      for (let t = 0; t < 570; t++) rtStep(w, s, []);
      const dHero = Math.hypot(sella.x - s.hero.x, sella.z - s.hero.z);
      const dPost = Math.hypot(sella.x - post.x, sella.z - post.z);
      const where = `resume at ${STAGES[i]!.id}: Sella settled ${dHero.toFixed(1)} m from the hero, ${dPost.toFixed(1)} m from her post, at (${sella.x.toFixed(1)}, ${sella.z.toFixed(1)})`;
      if (i >= post.stage) {
        // Past the ash line she belongs at her post, not at heel.
        expect(dPost, `${where} — the companion is not at her post`).toBeLessThanOrEqual(2.5);
      } else {
        expect(dArrived, `${where} — the resume did not put her at the hero`).toBeLessThanOrEqual(
          3.0,
        );
        expect(dHero, `${where} — the companion is stranded`).toBeLessThanOrEqual(3.0);
      }
    }
    // Without a resume that is a genuine long haul from the captive point, the
    // loop above could pass by measuring nothing (the named failure mode).
    expect(longHaul, "no resume tested the long haul — the repro is vacuous").toBeGreaterThan(0);
  });

  it("a resume stands the companion only where that resume itself proved standable", () => {
    // The placement rule, stated as the assertion: past the ash line she is at
    // her post — a stage EXIT, standable by construction and validated as such
    // (V5) at build; before it she is at the hero's own resume spot, which the
    // resume has just proved standable by putting the hero on it. No third
    // case, and no world query inside `applyResume` — it has no world.
    const post = holdPost();
    for (let i = 1; i < STAGES.length; i++) {
      const [w, s] = road();
      applyResume(s, i, foundBitsThroughStage(i));
      const sella = s.bystanders.find((b) => b.name === SELLA_NAME)!;
      if (sella.ai !== "following") continue;
      const at = `${STAGES[i]!.id}: (${sella.x.toFixed(1)}, ${sella.z.toFixed(1)})`;
      // At the BODY's own clearance, which is the claim: a body fits and can
      // walk out of it. Not the 0.9 m placement margin — the s4 gate stands
      // 0.41 m off a hut wall and the hero resumes on it anyway, so demanding
      // the placement margin here would be asserting something neither she nor
      // the hero has ever needed.
      expect(standable(w, sella.x, sella.z, HERO_RADIUS), `${at} has no room for a body`).toBe(true);
      if (i >= post.stage) {
        expect(Math.hypot(sella.x - post.x, sella.z - post.z), `${at} is not her post`).toBeLessThan(
          0.01,
        );
      } else {
        expect(Math.hypot(sella.x - s.hero.x, sella.z - s.hero.z), `${at} is not at the hero`)
          .toBeLessThan(0.01);
      }
      expect(sella.vx === 0 && sella.vz === 0, `${at} arrived with velocity`).toBe(true);
    }
  });

  it("Sella stops at the ash line — the boss's stage is never diluted (R4.5, fun's ruling)", () => {
    // fun's binding R4 ruling, and STORY.md beat 5 agreeing with it: Tidecaps
    // stop at the ash. The hold point is the last fen gate — which is also
    // exactly where her follow AI was measured wedging — so the ruling and the
    // bug fix are the same authored point.
    const [w, s] = road();
    const post = holdPost();
    const fen = post.stage - 1;
    applyResume(s, fen, foundBitsThroughStage(fen));
    const sella = s.bystanders.find((b) => b.name === SELLA_NAME)!;
    expect(sella.ai).toBe("following");
    // Every fight from here to the boss, already won, and every find taken:
    // this test is about where the COMPANION goes over the whole ash country,
    // and the ash fights (and the gate's own untaken-find refusal, R4) would
    // otherwise turn it into a five-stage combat test that measures her by
    // accident. The road is left exactly as it is.
    for (const m of s.markers) {
      if (m.stage >= fen) {
        m.triggered = true;
        m.cleared = true;
      }
    }
    for (const p of s.pickups) p.taken = true;
    const gi = w.gateIndices[fen]!;
    const nearestIdx = (x: number, z: number): number => {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < w.roadPath.length; i++) {
        const p = w.roadPath[i]!;
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };
    // Waypoints: the road itself, from a little before the gate to the end of
    // the chapter — the walk a player takes from the last fen gate to the
    // boss's shore.
    const wps: { x: number; z: number }[] = [];
    for (let i = Math.max(0, gi - 6); i < w.roadPath.length; i += 2) {
      const p = w.roadPath[i]!;
      wps.push({ x: p.x, z: p.z });
    }
    // The walk, with the seam driven the way the app drives it — `driveAlong`
    // issues moves only, and `stageIndex` advances on a COMMAND, so without
    // this the hero clears the gate and the chapter never turns the page.
    let deepest = -Infinity;
    let wp = 0;
    for (let t = 0; t < 2400 && wp < wps.length; t++) {
      const g = wps[wp]!;
      const dx = g.x - s.hero.x;
      const dz = g.z - s.hero.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.9) {
        wp++;
        continue;
      }
      const ev = rtStep(w, s, [{ type: "move", dx: dx / d, dz: dz / d }]);
      if (ev.stageCleared >= 0) rtStep(w, s, [{ type: "advanceStage" }]);
      deepest = Math.max(deepest, nearestIdx(sella.x, sella.z) - gi);
    }
    // The vacuity guards: the hero really did walk the ash country, under his
    // own steering, and ended standing in the boss's own stage.
    expect(s.stageIndex, "the hero never reached the boss's stage").toBe(STAGES.length - 1);
    expect(
      nearestIdx(s.hero.x, s.hero.z) - gi,
      "the hero never got clear of the gate — nothing to leave her behind at",
    ).toBeGreaterThan(40);
    expect(s.foes.length, "a fight woke — the drive measured a lock, not a companion").toBe(0);
    // And she stayed at the gate, on the fen side of it, the whole way.
    expect(deepest, "Sella walked into the ash behind the hero").toBeLessThanOrEqual(2);
    expect(
      Math.hypot(sella.x - post.x, sella.z - post.z),
      "Sella did not take up her post at the gate",
    ).toBeLessThanOrEqual(2.5);
  });

  it("walking it again puts Sella back on her road — a second run has its rescue", () => {
    // `newRun` made every captive captive again but never moved them back, so
    // run 2's rescue fired wherever run 1 happened to leave the body. The ash
    // line makes that fatal rather than untidy: she would stand captive at the
    // fen/ash gate and the village — her ask, her thanks, the question the
    // pool answers — would open with nobody on the road to say them.
    const [w, s] = road();
    const post = holdPost();
    const sella = s.bystanders.find((b) => b.name === SELLA_NAME)!;
    const home = { x: sella.x, z: sella.z };
    // Run 1, ended: freed, and standing at her post at the ash line. Set
    // directly rather than walked, so this measures `newRun` and nothing else.
    sella.ai = "following";
    sella.x = post.x;
    sella.z = post.z;
    expect(
      Math.hypot(sella.x - home.x, sella.z - home.z),
      "run 1 never moved her — nothing to restore",
    ).toBeGreaterThan(20);
    rtStep(w, s, [{ type: "newRun", x: 0, z: 0 }]);
    expect(sella.ai).toBe("captive");
    expect(
      Math.hypot(sella.x - home.x, sella.z - home.z),
      "run 2 opens with Sella standing where run 1 left her",
    ).toBeLessThan(0.01);
  });

  it("a rescue never fires under fire — the join waits for calm (R4, fun's Q5)", () => {
    // fun's R3 run: s2's live pack chased them through Sella's radius, the
    // join fired mid-combat, and freed-Sella followed straight into the
    // fight (and later ate a chain). The intro was already calm-gated; the
    // JOIN now is too: deferred while any live, unleashed foe is aggro'd.
    // Leashed foes walking home do NOT defer — a pack that gave up must
    // never hold a rescue hostage forever.
    const [w, s] = road();
    const sella = s.bystanders.find((b) => b.name === SELLA_NAME)!;
    expect(sella.ai).toBe("captive");
    // A live aggro'd foe, anywhere: the join must not fire even in radius.
    spawnFoe(s, "rotling", sella.x + 20, sella.z + 20);
    s.hero.x = sella.x;
    s.hero.z = sella.z;
    for (let i = 0; i < 30; i++) rtStep(w, s, []);
    expect(sella.ai, "the rescue fired mid-combat").toBe("captive");
    // The fight ends: the same position joins on the next beat.
    s.foes.length = 0;
    for (let i = 0; i < 10; i++) rtStep(w, s, []);
    expect(sella.ai, "the calm join never fired").toBe("following");
  });

  it("walking it again arrives RUNNING — newRun restores the opening autorun", () => {
    // R4 (fun's R3 note): the second run used to open on a hero standing
    // dead still at the lake. Sim-side so it replays; restartStage must NOT
    // set it — a stage retry resumes player control, not the intro script.
    const [w, s] = road();
    expect(s.autorun).toBe(false);
    rtStep(w, s, [{ type: "newRun", x: 0, z: 0 }]);
    expect(s.autorun, "the second run opens standing still").toBe(true);
    s.autorun = false;
    rtStep(w, s, [{ type: "restartStage", x: 0, z: 0 }]);
    expect(s.autorun, "a stage retry hijacked the player into the intro run").toBe(false);
  });

  it("resume never duplicates and never loses a find", () => {
    // The save-soundness argument for physical pickups, § the applyResume doc:
    // resume at stage j+1 means the finds of stages ≤ j−1 were provably walked
    // over and stage j's provably NOT — it stands ahead of the resume point.
    const w = createSimWorld({
      seed: 1337,
      waterLevel: -1.2,
      heightfield: scenarioHeightfieldOptions(),
    });
    const s = createRtState(1337, { unlocked: ["spore"], queueMax: 1 });
    setupEncounters(w, s);
    setupVillage(w, s);
    setupRoad(w, s);

    // Resume entering the Dry Gulch (s6) with the bitmask a contact-era save
    // would have derived: WATER (s1) and SPARK (s3) in hand; THE WEAVE (s5's
    // find, the last cleared stage's) stands back up on the road ahead.
    const gulch = STAGES.findIndex((st) => st.id === "s6");
    applyResume(s, gulch, foundBitsThroughStage(gulch));
    expect(s.unlocked).toContain("water");
    expect(s.unlocked).toContain("lightning");
    expect(s.unlocked).not.toContain("fire");
    expect(s.queueMax, "resume granted a weave the player has not walked over").toBe(1);
    const weave = s.pickups.find((p) => p.kind === "weave")!;
    expect(weave.taken).toBe(false);
    for (const p of s.pickups) {
      if (p.stage < gulch - 1) expect(p.taken, `${String(p.kind)} find not re-derived`).toBe(true);
    }
    // The find stands within reach of the resume point: the hero wakes at the
    // gate it belongs to, and the walk out crosses it.
    expect(Math.hypot(weave.x - s.hero.x, weave.z - s.hero.z)).toBeLessThan(6);

    // TAKING it grants exactly once — and standing on it without the press
    // grants NOTHING (third playtest: found means taken, not brushed).
    s.hero.x = weave.x;
    s.hero.z = weave.z;
    const brushed = rtStep(w, s, []);
    expect(brushed.wove, "contact alone collected a find").toBe(false);
    expect(weave.taken).toBe(false);
    const ev = rtStep(w, s, [{ type: "take" }]);
    expect(ev.wove).toBe(true);
    expect(ev.pickedUp.length).toBe(1);
    expect(s.queueMax).toBe(QUEUE_MAX);
    expect(weave.taken).toBe(true);
    const again = rtStep(w, s, [{ type: "take" }]);
    expect(again.wove).toBe(false);
    expect(again.pickedUp.length).toBe(0);
  });

  it("a skipped find stays skipped across a resume — the bitmask is the truth", () => {
    const w = createSimWorld({
      seed: 1337,
      waterLevel: -1.2,
      heightfield: scenarioHeightfieldOptions(),
    });
    const s = createRtState(1337, { unlocked: ["spore"], queueMax: 1 });
    setupEncounters(w, s);
    setupVillage(w, s);
    setupRoad(w, s);
    // A player who cleared through to the gulch but deliberately left WATER:
    // the save records lightning only, and resume must NOT invent the water.
    const gulch = STAGES.findIndex((st) => st.id === "s6");
    applyResume(s, gulch, encodeFound(["spore", "lightning"], false));
    expect(s.unlocked).not.toContain("water");
    const water = s.pickups.find((p) => p.kind === "water")!;
    expect(water.taken, "resume flattened a find the player never took").toBe(false);
  });

  it("lines the road with a treeline, and never at the cost of the road itself", () => {
    const [w, s] = road();
    // The fence exists: distinct blockers stand in the wall band — the road
    // flanks plus the glade rings (the verge the felling pass had emptied),
    // in numbers no natural scatter left there. Census at authoring: 229.
    // The full list, not `near()` — the grid's reach is shorter than a ring.
    let walls = 0;
    for (const o of w.obstacles.list) {
      if (o.kind === "hut") continue;
      let d2 = Infinity;
      for (const p of w.roadPath) d2 = Math.min(d2, (o.x - p.x) ** 2 + (o.z - p.z) ** 2);
      const d = Math.sqrt(d2);
      if (d > 3 && d < 11) walls++;
    }
    expect(walls).toBeGreaterThan(150);
    // And the road stays a road: no blocker overlaps the corridor the felling
    // pass cleared — a wall that blocks play is worse than a gap.
    for (const p of w.roadPath) {
      for (const o of w.obstacles.near(p.x, p.z)) {
        if (o.kind === "hut") continue;
        expect(
          Math.hypot(o.x - p.x, o.z - p.z),
          `a wall stands in the road at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`,
        ).toBeGreaterThan(o.radius + 2.4 - 1e-9);
      }
    }
    // Fights, gates and finds keep their clearances.
    for (const m of s.markers) {
      for (const o of w.obstacles.near(m.x, m.z)) {
        if (o.kind === "hut") continue;
        expect(Math.hypot(o.x - m.x, o.z - m.z)).toBeGreaterThan(3);
      }
    }
  });

  it("clamps the hero to the corridor — and yields to the arena lock", () => {
    const [w, s] = road();
    // Drive hard perpendicular off-road for ten seconds. The treeline stops
    // most of it; the clamp is the guarantee for whatever the jitter left.
    for (let t = 0; t < 300; t++) rtStep(w, s, [{ type: "move", dx: 1, dz: 0 }]);
    let d2 = Infinity;
    for (const p of w.roadPath) {
      d2 = Math.min(d2, (s.hero.x - p.x) ** 2 + (s.hero.z - p.z) ** 2);
    }
    expect(Math.sqrt(d2), "the corridor did not hold").toBeLessThanOrEqual(CORRIDOR_HALF + 0.05);

    // Under a lock the corridor yields: a brawl parked wider than the corridor
    // must not have two clamps fighting over one body.
    s.lock = { x: s.hero.x + 6, z: s.hero.z, r: 8 };
    s.hero.x += 9; // inside the lock, beyond the corridor
    s.hero.vx = 0;
    s.hero.vz = 0;
    const heldX = s.hero.x;
    rtStep(w, s, []);
    expect(Math.abs(s.hero.x - heldX), "the corridor clamp fought the lock").toBeLessThan(
      CORRIDOR_PULL / 2,
    );
  });

  it("cannot be taken from the road side of a gate that has not opened", () => {
    // A runner who slips past a fight must not hold power the seam never
    // announced: even the take press collects nothing before the clear.
    const [w, s] = road();
    const water = s.pickups.find((p) => p.kind === "water")!;
    s.hero.x = water.x;
    s.hero.z = water.z;
    const ev = rtStep(w, s, [{ type: "take" }]);
    expect(ev.granted).toEqual([]);
    expect(water.taken).toBe(false);
  });

  /**
   * THE UNSKIPPABILITY GUARANTEE DOES NOT EXIST (R6 — fun found it, the PM
   * verified it, and this is what replaced it).
   *
   * The assertion that stood here was `expect(PICKUP_RADIUS).toBeGreaterThan(2.4)`
   * against `PICKUP_RADIUS = 2.6`. **That is `2.6 > 2.4`.** It compares two
   * constants, it cannot fail for any gameplay reason, and it sat under a
   * comment claiming *"the corridor cannot thread past a find"* — in the one
   * place in the suite that most looked like the question was covered. The
   * project's named failure mode, in a check named for the property it did not
   * measure.
   *
   * The claim was true when contact collected finds. The third playtest made
   * collection a PRESS and the sentence outlived its mechanism (METHOD law 3).
   * So the two things below are what is actually true, and both can fail:
   *
   *   1. POSSESSION NEEDS A PRESS. A pilot that walks the whole corridor over
   *      a find and never presses take does not end up holding it.
   *   2. THE PROMPT IS REACHABLE FROM THE ROAD SURFACE. Every find sits within
   *      `PICKUP_RADIUS` of the road at its own arc, so a player walking the
   *      road is offered it. This is the real guarantee the constant buys, and
   *      it reds if a find drifts off the road or the radius shrinks.
   *
   * ⚠️ AND A MEASURED GAP, RECORDED RATHER THAN ASSERTED, because closing it is
   * a feel decision and not mine: **the road surface is 2.4 m and the corridor
   * clamp grants 4.5.** Measured over all four chapter-1 finds at 3.5 m off the
   * centreline, the prompt never appears for three of them; at 4.4 m it never
   * appears for seven of the eight side/find combinations. So a verge walk —
   * which the clamp explicitly permits — passes every find in the chapter
   * without so much as the chip. This is the third symptom of R1's hole: the
   * gate disc got the arc-order crossing and Sella's rescue got its span, and
   * the finds were skipped precisely BECAUSE the sentence above said they were
   * safe. Not asserted here, because an assertion that the gap persists would
   * red the day someone fixes it.
   *
   * ── CURRENT STATE ── passing. REGRESSION GUARD on 1 and 2; the gap in the
   * warning is open and belongs to fun.
   */
  it("walking over a find does not collect it — possession needs the press", () => {
    const [w, s] = road();
    for (const st of s.stages) st.cleared = true; // gating out of the way: geometry is the subject
    const gem = s.pickups.find((p) => p.kind === "weave")!;
    s.stageIndex = gem.stage + 1;
    // `road()` builds a feel-harness state with the whole arc already in hand,
    // so the grant would be a no-op and `queueMax` would read 2 either way.
    // Put the hero in the campaign's pre-weave condition, and the queue width
    // becomes a live witness to whether the walk granted anything.
    s.queueMax = 1;
    // Walk the road THROUGH the gem, never pressing take.
    const near = nearestRoadIndex(w, gem.x, gem.z);
    const wps = vergeAround(w, near, 1, 8, 8, 0);
    // Start ON the approach. Driven from the world origin the hero spends the
    // whole 900-tick budget walking fifty metres of road and never arrives —
    // which the vacuity guard below caught, and which is exactly the silent
    // no-op class the corridor's one-way boundary produces for a rig.
    s.hero.x = wps[0]!.x;
    s.hero.z = wps[0]!.z;
    let closest = Infinity;
    driveAlong(w, s, wps, () => {
      closest = Math.min(closest, Math.hypot(s.hero.x - gem.x, s.hero.z - gem.z));
    });
    // The walk provably passed within reach — otherwise a green below would
    // mean "never went near it", which measures nothing.
    expect(closest, "the walk never came within take range — probe is vacuous").toBeLessThan(
      PICKUP_RADIUS,
    );
    expect(gem.taken, "walking over a find collected it — take is no longer a press").toBe(false);
    expect(s.queueMax, "the weave was granted without a press").toBe(1);
    // And one press from where it ended still works, so the refusal above is
    // about the PRESS and not about an out-of-range hero or a closed gate.
    s.hero.x = gem.x;
    s.hero.z = gem.z;
    rtStep(w, s, [{ type: "take" }]);
    expect(gem.taken, "the take press itself is broken — the probe proves nothing").toBe(true);
  });

  it("every find is within take range of its own road arc — the real guarantee", () => {
    const [w, s] = road();
    for (const p of s.pickups) {
      const i = nearestRoadIndex(w, p.x, p.z);
      const d = Math.hypot(w.roadPath[i]!.x - p.x, w.roadPath[i]!.z - p.z);
      expect(
        d,
        `the ${String(p.kind)} find sits ${d.toFixed(2)} m off the road — a player walking the ` +
          `road is never offered it`,
      ).toBeLessThan(PICKUP_RADIUS);
    }
  });
});

describe("event attribution — what hurt the hero", () => {
  /**
   * ⚠️ WHY THIS EXISTS. A seat read `heroDamage: 9` co-occurring with
   * `detonations: 1` in its own event log after casting Conduction and
   * concluded the spell was taxing the caster — a quarter of a taught clear's
   * damage, filed as a balance item with a proposed dial. **Every one of
   * those hits was a rotling bite.** `FOES.rotling.damage` is 9, and a melee
   * bite detonates at its victim's centre through the same `detonate`/`land`
   * path a spell does, so *being eaten and hitting yourself produce the same
   * signature* in a sampled stream.
   *
   * The discriminator was already in the payload and simply was not read:
   * `detonations[].fromHero` and `impacts[].onHero`. This makes the recipe
   * executable so the next reader inherits it instead of re-deriving it.
   *
   * ── CURRENT STATE ── PASSES. REGRESSION GUARD, both directions.
   */
  const gulch = (): [ReturnType<typeof createSimWorld>, ReturnType<typeof createRtState>, number] => {
    const { world: w, state: st } = buildScenario(STAGES);
    const gi = STAGES.findIndex((x) => x.id === "s6");
    applyResume(st, gi, foundBitsThroughStage(gi));
    const m = st.markers.find((k) => k.stage === gi)!;
    st.hero.x = m.x;
    st.hero.z = m.z;
    return [w, st, gi];
  };

  it("a BITE is a detonation the hero never fired — no cast, real damage", () => {
    const [w, st] = gulch();
    let damaged = 0;
    let fromHero = 0;
    let onHero = 0;
    let casts = 0;
    for (let t = 0; t < 120; t++) {
      const ev = rtStep(w, st, []);
      casts += ev.casts.length;
      if (ev.heroDamage <= 0) continue;
      damaged++;
      fromHero += ev.detonations.filter((d) => d.fromHero).length;
      onHero += ev.impacts.filter((i) => i.onHero).length;
    }
    // The vacuity guard: a control in which nothing bites proves nothing.
    expect(damaged, "the hero was never hit — this measures nothing").toBeGreaterThan(0);
    expect(casts, "the pilot cast something — it is not a no-cast control").toBe(0);
    expect(onHero, "damage landed with no impact marked onHero").toBeGreaterThan(0);
    // The claim: zero of it is the hero's own.
    expect(fromHero, "a hero-fired detonation in a run with no casts").toBe(0);
  });

  it("a SELF-HIT is the same damage with fromHero set — the positive control", () => {
    // Law 20: without this the test above passes on a build where `fromHero`
    // is never set at all, and would be measuring a constant rather than an
    // attribution.
    //
    // An AIMED cast at the caster's own feet, not the `self` form — measured:
    // the self form never reaches its own caster (the no-self-chip rule), so
    // it makes no positive control at all. Spore because it is the one
    // element the hero holds from stage 1.
    const [w, st] = gulch();
    st.selfDamage = 1;
    let selfTicks = 0;
    for (let t = 0; t < 60 && selfTicks === 0; t++) {
      const cmds: RtCommand[] =
        t === 5
          ? [
              { type: "queue", element: "spore" },
              { type: "cast", form: "aimed", aimX: st.hero.x, aimZ: st.hero.z },
            ]
          : [];
      const ev = rtStep(w, st, cmds);
      if (ev.detonations.some((d) => d.fromHero) && ev.impacts.some((i) => i.onHero)) selfTicks++;
    }
    expect(selfTicks, "no hero-fired detonation ever reached the hero").toBeGreaterThan(0);
  });
});

