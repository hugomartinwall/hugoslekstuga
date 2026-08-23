import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CASTABLES,
  DEFAULT_ARENA,
  FOES,
  INTERACTIONS,
  NOTABLE,
  PRECEDENCE,
  QUEUE_MAX,
  STAGES,
  STATUSES,
  STATUS_IDS,
  ELEMENT_PROFILE,
  foeKind,
  type Element,
} from "../../lib/greyrot/content";

/**
 * Referential integrity over the content graph (`CLAUDE.md` §6).
 *
 * The point is that a dangling id fails HERE, at build time, rather than at
 * runtime in Act 3 when somebody finally walks into the encounter that
 * references it.
 *
 * Rewritten when the turn engine was deleted. `ABILITIES`, `HEROES` and
 * `ENEMIES` are gone: the hero has no class and no ability list, and a spell is
 * COMPOSED at cast time rather than looked up, so what needs checking changed
 * shape. The status matrix is the one table that survived both pivots intact,
 * and it is now the centre of the game rather than one system among five.
 */

describe("content graph", () => {
  it("has content to check", () => {
    // Guards against the whole suite passing on empty tables.
    expect(CASTABLES.length).toBeGreaterThan(0);
    expect(Object.keys(FOES).length).toBeGreaterThan(0);
    expect(NOTABLE.length).toBeGreaterThan(0);
  });

  it("offers exactly one castable per element, each on its own key", () => {
    const elements = new Set(CASTABLES.map((c) => c.element));
    expect(elements.size).toBe(CASTABLES.length);
    const codes = new Set(CASTABLES.map((c) => c.code));
    expect(codes.size, "two elements share a key").toBe(CASTABLES.length);
    // Matched on KeyboardEvent.code so the physical positions survive AZERTY
    // (§1). A layout-dependent `key` here would silently break for French
    // players and pass every test.
    for (const c of CASTABLES) expect(c.code, c.element).toMatch(/^(Key[A-Z]|Digit[1-9])$/);
  });

  it("gives the precedence order every element, exactly once", () => {
    // The deterministic tie-break when a mix has no authored pair. A missing
    // element here is a mix that resolves differently depending on input order.
    const all = CASTABLES.map((c) => c.element).sort();
    expect([...PRECEDENCE].sort()).toEqual(all);
    expect(new Set(PRECEDENCE).size).toBe(PRECEDENCE.length);
  });

  it("profiles every element, and references only statuses that exist", () => {
    for (const c of CASTABLES) {
      const p = ELEMENT_PROFILE[c.element];
      expect(p, `no profile for ${c.element}`).toBeTruthy();
      if (p.status) expect(STATUS_IDS, c.element).toContain(p.status);
    }
  });

  it("every authored mix references live elements and live statuses", () => {
    const elements = new Set<Element>(CASTABLES.map((c) => c.element));
    const seen = new Set<string>();
    for (const n of NOTABLE) {
      for (const e of n.pair) expect(elements, `${n.name} uses a dead element`).toContain(e);
      if (n.status) expect(STATUS_IDS, n.name).toContain(n.status);
      // Keyed by UNORDERED pair, so two entries for the same pair means one of
      // them silently never fires.
      const key = [...n.pair].sort().join("+");
      expect(seen.has(key), `${n.name} duplicates the pair ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("authors an identity for every one of the fifteen pairs", () => {
    // Cancellation is retired and the queue holds two, so NOTABLE is the whole
    // pair-spell list. 15 = C(6,2); a missing pair is a mix with no job.
    expect(NOTABLE.length).toBe(15);
  });

  it("keeps the queue short enough to compose under pressure", () => {
    // 6 elements and a queue of 2 — the owner's cap ("mixing 2 should be max
    // for now"). The reserved third slot is a future Act's power spike; raising
    // this resizes the grimoire and the save, so it is a decision, not a tweak.
    expect(QUEUE_MAX).toBe(2);
    expect(CASTABLES.length).toBe(6);
  });

  it("every foe id matches its key and names a real archetype", () => {
    for (const [key, f] of Object.entries(FOES)) {
      expect(f.id).toBe(key);
      expect(["charger", "spitter", "weeper", "flanker"]).toContain(f.ai);
      expect(f.maxHp).toBeGreaterThan(0);
      expect(f.radius).toBeGreaterThan(0);
      // A telegraph you cannot see is a hit you cannot dodge (§10).
      expect(f.windupTicks, `${f.id} telegraph`).toBeGreaterThanOrEqual(10);
      expect(f.loot).toBeGreaterThan(0);
    }
  });

  it("the flanker's readability contract is content, not hope", () => {
    // R2's binding contract (fun): a sim-enforced stalk phase precedes every
    // commit, and wu12 is the floor — wu10 is reachable ONLY behind
    // circling-as-pre-tell verified + gfx's windup-ease dial + an eyes-off
    // tell. When those conditions are met, THIS assertion is what changes,
    // deliberately, in the same commit as the evidence.
    const flankers = Object.values(FOES).filter((f) => f.ai === "flanker");
    expect(flankers.length, "the roster fields a flanker").toBeGreaterThan(0);
    for (const f of flankers) {
      expect(f.windupTicks, `${f.id} wu12 floor (three-condition contract)`).toBeGreaterThanOrEqual(
        12,
      );
      expect(f.flankTicks, `${f.id} needs a sim-enforced stalk phase`).toBeGreaterThan(0);
    }
    // Nobody else stalks: flankTicks on a non-flanker would gate nothing.
    for (const f of Object.values(FOES)) {
      if (f.ai !== "flanker") expect(f.flankTicks, `${f.id} has flankTicks`).toBeUndefined();
    }
  });

  it("the rimecap's countable difference holds: fire answers frost one hit sooner", () => {
    // The sopling/cinderling trick, fourth verse — the elemental weakness is
    // a WHOLE hit, which is what makes it legible rather than a stat
    // footnote. Two fire bolts kill it; two spore puffs do not and three do.
    const rime = FOES["rimecap"]!;
    const fire = ELEMENT_PROFILE.fire.damage;
    const spore = ELEMENT_PROFILE.spore.damage;
    expect(2 * fire).toBeGreaterThanOrEqual(rime.maxHp);
    expect(2 * spore).toBeLessThan(rime.maxHp);
    expect(3 * spore).toBeGreaterThanOrEqual(rime.maxHp);
  });

  it("a bolt that lays ground lays its OWN element's ground", () => {
    // The drip-honesty rule extended to projectiles (R2): the rimecap's ice
    // under a frost bolt tells one story; a water patch under a fire bolt
    // would teach the matrix a lie.
    const ground: Record<string, string> = {
      ice: "frost",
      water: "water",
      oil: "oil",
      fire: "fire",
    };
    for (const f of Object.values(FOES)) {
      if (!f.attackPatch) continue;
      expect(ground[f.attackPatch], `${f.id} lays ${f.attackPatch}`).toBe(f.attackElement);
      expect(f.ai, `${f.id}: only spitters have projectiles to carry a patch`).toBe("spitter");
    }
  });

  it("a dripping foe tells one story: the trail, the telegraph, the bite", () => {
    // The honesty rule behind elemental foe identity (round 5): whatever a
    // foe sheds is what it is MADE of — a water trail under an oil-coloured
    // telegraph would teach the matrix a lie.
    const family: Record<string, string> = { oil: "oil", water: "water" };
    for (const f of Object.values(FOES)) {
      if (!f.drip) continue;
      expect(family[f.drip.kind], `${f.id} drips ${f.drip.kind}`).toBe(f.attackElement);
      expect(f.drip.ticks).toBeGreaterThan(0);
      expect(f.drip.r).toBeGreaterThan(0);
    }
  });

  it("every status referenced by the interaction matrix exists", () => {
    for (const byStatus of Object.values(INTERACTIONS)) {
      for (const [statusId, inter] of Object.entries(byStatus ?? {})) {
        expect(STATUS_IDS).toContain(statusId);
        for (const r of inter.removes ?? []) expect(STATUS_IDS).toContain(r);
        if (inter.applies) expect(STATUS_IDS).toContain(inter.applies);
        if (inter.chainOn) expect(STATUS_IDS).toContain(inter.chainOn);
        expect(inter.label.length, "combos need a player-facing label").toBeGreaterThan(0);
      }
    }
  });

  it("every status id matches its key", () => {
    for (const [key, s] of Object.entries(STATUSES)) expect(s.id).toBe(key);
  });

  it("names everything in words that fit on a button", () => {
    // §9's opening is one lit control with one word on it. A label that needs
    // two lines is a label that breaks the funnel at 800×450.
    for (const c of CASTABLES) {
      expect(c.label, c.element).toMatch(/^[A-Z]{3,9}$/);
      expect(c.legend.length, `${c.element} legend`).toBeLessThanOrEqual(2);
    }
    for (const n of NOTABLE) expect(n.name.length, n.name).toBeLessThanOrEqual(16);
  });

  it("has no text walls — the whole vocabulary fits on one screen", () => {
    // §9 bans text walls, and the honest test is the TOTAL a player must read
    // to know what everything does, not the length of any one string.
    let chars = 0;
    for (const c of CASTABLES) chars += c.label.length + c.legend.length;
    for (const n of NOTABLE) chars += n.name.length;
    for (const s of Object.values(STATUSES)) chars += s.name.length;
    expect(chars).toBeLessThanOrEqual(900);
  });

  it("spawns every fight's foes fully inside its own arena ring", () => {
    // The lock clamps foes to the ring (step.ts 5c); a spawn outside it would
    // snap inward on the trigger tick. Fully inside — offset plus body radius —
    // because the ring is drawn on the terrain and a body straddling it reads
    // as outside at 800×450.
    for (const stage of STAGES) {
      for (const m of stage.markers) {
        const arena = m.arena ?? DEFAULT_ARENA;
        for (const f of m.foes) {
          expect(
            Math.hypot(f.dx, f.dz) + foeKind(f.kindId).radius,
            `${stage.id}: ${f.kindId} at (${f.dx}, ${f.dz}) spawns outside its ${arena} m ring`,
          ).toBeLessThanOrEqual(arena);
        }
      }
    }
  });

  it("the Burning + Wet anti-synergy is present", () => {
    // The one interaction that makes combos DECISIONS rather than free wins
    // (`CLAUDE.md` §10.1). If this ever silently becomes a bonus, the whole
    // status system loses its tension.
    expect(INTERACTIONS.fire?.wet?.removes).toContain("wet");
    expect(INTERACTIONS.fire?.wet?.damageMultiplier).toBeLessThan(1);
    expect(INTERACTIONS.water?.burning?.removes).toContain("burning");
  });
});

/* ------------------------------------------------------------------------- */

const SRC = new URL("../../lib/greyrot", import.meta.url).pathname;

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

describe("difficulty comes from design, not from stat inflation", () => {
  it("no global enemy stat multiplier exists anywhere in sim or content", () => {
    // CLAUDE.md §10, verbatim: "Banned: any global enemy stat multiplier on
    // the difficulty path." This is game1's scar — material asymmetry there
    // produced unwinnable opening rushes. The rule only survives if it is
    // enforced rather than remembered.
    const files = [...filesUnder(join(SRC, "sim")), ...filesUnder(join(SRC, "content"))];
    const banned =
      /\b(difficultyMultiplier|statMultiplier|enemyScale|hpScale|damageScale|difficultyScal\w*)\b/i;
    const offenders = files.filter((f) => banned.test(code(readFileSync(f, "utf8"))));
    expect(
      offenders.map((f) => f.slice(SRC.length + 1)),
      "difficulty comes from composition, AI, telegraphs and placement",
    ).toEqual([]);
  });

  it("content is pure data — no randomness, no clock, no DOM", () => {
    // The simulation imports content, so §4's determinism guarantees have to
    // extend here or they are worthless.
    const files = filesUnder(join(SRC, "content"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = code(readFileSync(f, "utf8"));
      const rel = f.slice(SRC.length + 1);
      expect(/Math\s*\.\s*random/.test(src), `${rel} uses Math.random`).toBe(false);
      expect(/performance\s*\.\s*now|Date\s*\.\s*now/.test(src), `${rel} reads a clock`).toBe(
        false,
      );
      expect(/\b(window|document|localStorage)\b/.test(src), `${rel} touches the DOM`).toBe(
        false,
      );
      expect(/from\s+["']three["']/.test(src), `${rel} imports three`).toBe(false);
    }
  });
});
