import { describe, expect, it } from "vitest";
import { MIX_COUNT, MIX_KEYS, encodeFound, foundHas, mixIndex, mixKey, type Element } from "../../lib/greyrot/content";
import {
  CHAPTERS,
  STAGES,
  chapterOfStage,
  foundBitsThroughStage,
  isChapterEnd,
} from "../../lib/greyrot/content/stages";
import {
  SAVE_VERSION,
  defaultCampaign,
  defaultMeta,
  discover,
  discoveredCount,
  isDiscovered,
  isStageCleared,
  markStageCleared,
  migrateSave,
  saveBytes,
  type CampaignSave,
} from "../../lib/greyrot/app/save";
import { Economy } from "../../lib/greyrot/app/economy";

/**
 * The save (`CLAUDE.md` §7) and the economy (§8).
 *
 * Both are app-side rather than sim-side, so neither is covered by the
 * determinism oracle — and both are exactly the kind of code that looks obvious
 * and is wrong at the edges. The two things being pinned here are the SIZE
 * (against a 1 MB platform cap we never want to think about again) and the
 * CAPS, which are the difference between a rewarded economy and a farm.
 */

/* ------------------------------------------------------------- the grimoire */

describe("the mix index", () => {
  it("numbers every distinct mix up to the queue cap", () => {
    // 6 singles + 21 pairs-with-repeats = 27, derived from QUEUE_MAX = 2. If a
    // future Act unbolts the reserved third slot this becomes 83 on its own —
    // which resizes the grimoire and is a save-version bump, not a shrug.
    expect(MIX_COUNT).toBe(27);
    expect(new Set(MIX_KEYS).size, "two mixes share a slot").toBe(MIX_COUNT);
  });

  it("treats a mix as a set with repeats, not a sequence", () => {
    // FIRE+OIL and OIL+FIRE are one discovery — `resolveMix` already refuses to
    // let queue order change the outcome, so the grimoire must agree.
    expect(mixKey(["fire", "oil"])).toBe(mixKey(["oil", "fire"]));
    expect(mixIndex(["water", "frost"])).toBe(mixIndex(["frost", "water"]));
    expect(mixIndex(["fire", "fire"])).not.toBe(mixIndex(["fire", "water"]));
  });

  it("has no slot for an empty queue", () => {
    expect(mixIndex([])).toBe(-1);
  });
});

describe("grimoire flags", () => {
  it("records a discovery once and reports it thereafter", () => {
    const s = defaultCampaign();
    expect(discover(s, ["fire", "oil"])).toBe(true);
    expect(discover(s, ["oil", "fire"]), "the same mix counted twice").toBe(false);
    expect(isDiscovered(s, ["fire", "oil"])).toBe(true);
    expect(isDiscovered(s, ["frost", "spore"])).toBe(false);
    expect(discoveredCount(s)).toBe(1);
  });

  it("holds all 27 without collisions", () => {
    // Filling every slot is the cheapest way to catch an indexing off-by-one.
    const s = defaultCampaign();
    const elems = ["water", "fire", "frost", "lightning", "oil", "spore"] as const;
    for (const a of elems) {
      discover(s, [a]);
      for (const b of elems) discover(s, [a, b]);
    }
    expect(discoveredCount(s)).toBe(MIX_COUNT);
  });
});

/* ------------------------------------------------------------- stage flags */

describe("the cleared-stage bitset", () => {
  it("sets and reads independent stages", () => {
    const s = defaultCampaign();
    markStageCleared(s, 0);
    markStageCleared(s, 5);
    expect(isStageCleared(s, 0)).toBe(true);
    expect(isStageCleared(s, 5)).toBe(true);
    expect(isStageCleared(s, 1)).toBe(false);
  });

  it("covers Act 1 in one number", () => {
    // §7 stores progress as a bitset; ~25 stages per Act has to fit in the 31
    // bits a JS bitwise op gives before the sign bit bites.
    expect(STAGES.length).toBeLessThan(31);
  });
});

/* --------------------------------------------------------------- migration */

describe("migrateSave — written BEFORE the second schema change (§7)", () => {
  it("passes a current save through unchanged", () => {
    const s = defaultCampaign();
    s.spores = 42;
    discover(s, ["lightning", "water"]);
    const out = migrateSave(structuredClone(s) as unknown, defaultCampaign());
    expect(out).toEqual(s);
  });

  it("fills in a field the stored save has never heard of", () => {
    // The actual shape of every future migration: a v1 save meeting a v2 build.
    const old = { v: 1, chapter: 0, stage: 2, cleared: 3, grimoire: [7], spores: 90 };
    const out = migrateSave(old as unknown, defaultCampaign());
    expect(out.stage).toBe(2);
    expect(out.spores).toBe(90);
    expect(out.crateCount, "a missing field did not take its default").toBe(0);
    expect(out.v).toBe(SAVE_VERSION);
  });

  it("repairs a grimoire array of the wrong length", () => {
    // The one wrong shape that type-checks and still breaks indexing. A
    // CURRENT-version save with a truncated array is repaired in place.
    const out = migrateSave({ v: 2, grimoire: [1, 9] } as unknown, defaultCampaign());
    expect(out.grimoire).toHaveLength(defaultCampaign().grimoire.length);
    expect(out.grimoire[0]).toBe(1);
  });

  it("v1 → v2: the grimoire is ZEROED, everything else carries over", () => {
    // v1 numbered 83 mixes over a queue of three; v2 numbers 27 over a queue
    // of two, so every v1 bit points at the wrong spell. Half-reading it would
    // fill the book with discoveries that never happened.
    const old = { v: 1, stage: 3, spores: 120, grimoire: [0xfffffff, 0xfffffff, 0x7ffffff] };
    const out = migrateSave(old as unknown, defaultCampaign());
    expect(out.stage).toBe(3);
    expect(out.spores).toBe(120);
    expect(discoveredCount(out), "v1 grimoire bits leaked into v2 numbering").toBe(0);
    expect(out.v).toBe(SAVE_VERSION);
  });

  it("v2 → v3: `found` is DERIVED from the stages walked, because contact collected", () => {
    // v2 builds collected finds by contact, so a v2 save at stage j provably
    // crossed every find of stages < j−1 — the round-2 soundness argument,
    // frozen here as the migration. A v3 save never derives: `found` is a
    // recorded decision (finds are takeable and therefore skippable).
    const gulch = STAGES.findIndex((st) => st.id === "s6");
    const old = { v: 2, stage: gulch, spores: 7, cleared: 31, grimoire: [0] };
    const out = migrateSave(old as unknown, defaultCampaign());
    expect(out.found).toBe(foundBitsThroughStage(gulch));
    expect(foundHas(out.found, "water")).toBe(true);
    expect(foundHas(out.found, "lightning")).toBe(true);
    // s5's find (THE WEAVE) is the LAST cleared stage's — it stands ahead of
    // the resume point and must NOT be granted by migration.
    expect(foundHas(out.found, "weave")).toBe(false);
    expect(foundHas(out.found, "fire")).toBe(false);
  });

  it("v3 round-trips `found` verbatim — a skipped find stays skipped", () => {
    const s = defaultCampaign();
    s.stage = 5;
    s.found = encodeFound(["spore", "lightning"], false); // WATER deliberately left
    const out = migrateSave(structuredClone(s) as unknown, defaultCampaign());
    expect(out.found).toBe(s.found);
    expect(foundHas(out.found, "water"), "migration re-granted a skipped find").toBe(false);
  });

  it("masks stray grimoire bits a corrupt save could carry", () => {
    // 27 is not a multiple of 28, so the word has a spare bit `discover` can
    // never set. A hand-edited save can, and the symptom would be a grimoire
    // reading "28 / 27".
    const out = migrateSave({ v: 2, grimoire: [0xfffffff] } as unknown, defaultCampaign());
    expect(discoveredCount(out)).toBe(MIX_COUNT);
  });

  it("refuses a save from the future rather than half-reading it", () => {
    const out = migrateSave({ v: 99, spores: 1e9 } as unknown, defaultCampaign());
    expect(out.spores, "loaded fields from a schema we do not know").toBe(0);
  });

  it("gives a usable save back from junk instead of throwing", () => {
    // A player whose save we cannot read gets a new game, not a black screen.
    for (const junk of [null, undefined, 7, "corrupt", [], { v: "one" }]) {
      expect(() => migrateSave(junk as unknown, defaultCampaign())).not.toThrow();
      expect(migrateSave(junk as unknown, defaultCampaign()).v).toBe(SAVE_VERSION);
    }
    expect(migrateSave({ spores: "lots" } as unknown, defaultCampaign()).spores).toBe(0);
  });

  it("keeps the two keys independent", () => {
    // §7's reason for two keys: a corrupt campaign must not destroy settings.
    const meta = defaultMeta();
    meta.muted = true;
    const survived = migrateSave(structuredClone(meta) as unknown, defaultMeta());
    const wrecked = migrateSave("garbage" as unknown, defaultCampaign());
    expect(survived.muted).toBe(true);
    expect(wrecked.stage).toBe(0);
  });
});

/* -------------------------------------------------------------- the size */

describe("save size", () => {
  it("stays far under 32 KB on a maxed save", () => {
    // §7 targets < 32 KB against a 1 MB cap so the cap never has to be thought
    // about. The pivot made this smaller, not larger: a party of three with
    // talent trees and four gear slots each was what used to push toward it.
    const c: CampaignSave = defaultCampaign();
    for (const w of c.grimoire.keys()) c.grimoire[w] = 0xfffffff;
    c.cleared = 0x7fffffff;
    c.spores = 999_999_999;
    c.stage = STAGES.length - 1;
    c.chapter = CHAPTERS.length - 1;
    c.crateDay = 20_000;
    c.crateCount = 5;
    const m = defaultMeta();
    m.lifetime = { runs: 99_999, kills: 9_999_999, spores: 999_999_999, defeats: 99_999 };

    const bytes = saveBytes(c, m);
    console.log(`[save] maxed campaign + meta = ${bytes} bytes`);
    expect(bytes).toBeLessThan(32 * 1024);
  });
});

/* ------------------------------------------------------------ the chapters */

describe("the stage chain", () => {
  it("puts every stage in exactly one chapter", () => {
    let n = 0;
    for (const c of CHAPTERS) n += c.stages.length;
    expect(n).toBe(STAGES.length);
    for (let i = 0; i < STAGES.length; i++) {
      const c = chapterOfStage(i);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(CHAPTERS.length);
    }
  });

  it("marks exactly one chapter end per chapter — that is where the camp is", () => {
    const ends = STAGES.map((_, i) => i).filter(isChapterEnd);
    expect(ends).toHaveLength(CHAPTERS.length);
  });

  it("gives every stage an exit and at least one fight", () => {
    for (const s of STAGES) {
      expect(s.exit.r, `${s.id} has no reachable gate`).toBeGreaterThan(0);
      expect(s.markers.length, `${s.id} has nothing in it`).toBeGreaterThan(0);
    }
  });
});

/* --------------------------------------------------------------- the ads */

describe("the ad economy (§8)", () => {
  const econ = (adblock = false): Economy => {
    let t = 0;
    return new Economy({ now: () => (t += 1000), adblock });
  };

  it("offers nothing at all while ads are dormant", () => {
    // Basic Launch: ads are OFF and exactly one SDK call is made. Nothing here
    // may render, and `disabled` rather than `capped` is the honest reason.
    const e = econ();
    const s = defaultCampaign();
    expect(e.offer("stageDouble", s).available).toBe(false);
    expect(e.offer("stageDouble", s).reason).toBe("disabled");
  });

  it("never renders an offer to an adblock user", async () => {
    // §8: adblock users play normally, and are never punished. The rule that
    // matters is that no button appears — a visible button that cannot pay is
    // worse than no button.
    const e = econ(true);
    const s = defaultCampaign();
    for (const slot of ["stageDouble", "revive", "campCrate"] as const) {
      expect(e.offer(slot, s).available).toBe(false);
    }
    expect(await e.claim("revive", s, 0)).toBe(false);
  });

  it("scales the grimoire hint to how full the grimoire already is", () => {
    // §8 is explicit that this one is scaled, never flat. An early hint is
    // nearly worthless because everything is a discovery anyway.
    const e = econ();
    const empty = defaultCampaign();
    const nearlyFull = defaultCampaign();
    const elems = ["water", "fire", "frost", "lightning", "oil", "spore"] as const;
    for (const a of elems) {
      for (const b of elems) discover(nearlyFull, [a, b] as Element[]);
    }
    expect(e.hintValue(empty)).toBeGreaterThan(e.hintValue(nearlyFull));
    expect(e.hintValue(nearlyFull)).toBeGreaterThanOrEqual(1);
  });

  it("stops offering a hint once nothing is left to find", () => {
    const e = econ();
    const full = defaultCampaign();
    for (const w of full.grimoire.keys()) full.grimoire[w] = 0xfffffff;
    expect(e.hintValue(full)).toBe(0);
  });
});
