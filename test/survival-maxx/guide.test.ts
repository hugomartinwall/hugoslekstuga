import { test } from "vitest";
import assert from "node:assert/strict";
import {
  BAG_CAPACITY,
  BAG_SLOT_COST,
  BOSS_INTERVAL,
  BOSS_NAMES,
  CAMPAIGN_WAVES,
  ENEMY_STATS,
  FAMILIES,
  FAMILY_ORDER,
  HERO_ORDER,
  HINTS,
  ITEMS,
  MAP_ORDER,
  RANKS,
  REPAIR_HEAL,
  SELL_RATE,
  WEAPONS,
  rerollCost,
  type FamilyId,
} from "../../lib/survival-maxx/content";
import {
  GUIDE_TABS,
  bossGuideRows,
  completesSetTier,
  deployHelp,
  enemyGuideRows,
  guideDetailLines,
  guideEntries,
  howToSections,
  renderGuideTab,
  setGuideRows,
  type GuideTab,
} from "../../lib/survival-maxx/guide";

const escape = (value: string) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const view = {
  icon: (id: string, className = "") => `<i class="icon ${id} ${className}"></i>`,
  escape,
  rankBadge: (level: number) => `<b class="rank">${level}</b>`,
  familyChip: (id: FamilyId) => `<em class="family">${FAMILIES[id].name}</em>`,
};

const FAMILY_FILTERS: (FamilyId | "all")[] = ["all", ...FAMILY_ORDER];
const GEAR_TABS: GuideTab[] = ["weapons", "items", "drones", "mods"];
const FORBIDDEN = ["undefined", "NaN", "[object Object]"];

test("every weapon and item lives in exactly one gear tab", () => {
  const seen = new Map<string, GuideTab>();
  for (const tab of GEAR_TABS)
    for (const entry of guideEntries(tab, "all")) {
      assert.equal(seen.has(entry.id), false, `${entry.id} appears twice`);
      seen.set(entry.id, tab);
    }
  for (const id of Object.keys(WEAPONS)) assert.equal(seen.get(id), "weapons", id);
  for (const item of Object.values(ITEMS)) {
    const expected = item.category === "passive" ? "items" : item.category === "drone" ? "drones" : "mods";
    assert.equal(seen.get(item.id), expected, item.id);
  }
  assert.equal(seen.size, Object.keys(WEAPONS).length + Object.keys(ITEMS).length);
  for (const weapon of Object.values(WEAPONS)) {
    const entry = guideEntries("weapons", "all").find((e) => e.id === weapon.id)!;
    assert.equal(!!entry.insane, !!weapon.unique, `${weapon.id} insane flag`);
    if (weapon.minWave && weapon.minWave > 1) assert.equal(entry.minWave, weapon.minWave);
  }
});

test("maps and heroes follow MAP_ORDER and HERO_ORDER", () => {
  assert.deepEqual(guideEntries("maps", "all").map((entry) => Number(entry.id)), MAP_ORDER);
  assert.deepEqual(guideEntries("heroes", "all").map((entry) => entry.id), HERO_ORDER);
  for (const family of FAMILY_ORDER) {
    assert.equal(guideEntries("maps", family).length, MAP_ORDER.length);
    assert.equal(guideEntries("heroes", family).length, HERO_ORDER.length);
  }
  for (const tab of ["sets", "enemies", "howto"] as GuideTab[])
    assert.deepEqual(guideEntries(tab, "all"), []);
});

test("enemy and boss rows cover the whole roster", () => {
  const rows = enemyGuideRows();
  assert.equal(rows[0].kind, "grunt");
  assert.equal(rows[0].firstWave, 1);
  assert.equal(rows[rows.length - 1].kind, "boss");
  const kinds = rows.map((row) => row.kind);
  for (const kind of Object.keys(ENEMY_STATS)) assert.ok(kinds.includes(kind as never), kind);
  assert.equal(new Set(kinds).size, kinds.length);
  for (const row of rows) {
    assert.ok(row.name && row.tip);
    for (const value of [row.hp, row.speed, row.damage, row.salvage, row.firstWave])
      assert.ok(Number.isFinite(value));
  }
  const bosses = bossGuideRows();
  assert.equal(bosses.length, CAMPAIGN_WAVES / BOSS_INTERVAL);
  bosses.forEach((boss, index) => {
    assert.equal(boss.wave, (index + 1) * BOSS_INTERVAL);
    assert.ok(BOSS_NAMES.includes(boss.name), boss.name);
  });
});

test("family filters partition gear without losing anything", () => {
  for (const tab of GEAR_TABS) {
    const all = guideEntries(tab, "all");
    const union = new Set<string>();
    for (const family of FAMILY_ORDER)
      for (const entry of guideEntries(tab, family)) {
        assert.ok(entry.families.includes(family));
        union.add(entry.id);
      }
    const withFamily = all.filter((entry) => entry.families.length);
    assert.equal(union.size, withFamily.length, tab);
    for (const entry of withFamily) assert.ok(union.has(entry.id), entry.id);
  }
});

test("set rows are one per family with three tiers and real members", () => {
  const rows = setGuideRows();
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.map((row) => row.family.id), FAMILY_ORDER);
  const known = new Set([...Object.keys(WEAPONS), ...Object.keys(ITEMS)]);
  for (const row of rows) {
    assert.deepEqual(row.tiers.map((tier) => tier.size), [2, 4, 6]);
    for (const tier of row.tiers) assert.ok(tier.text.trim().length > 0);
    assert.ok(row.members.length > 0, row.family.id);
    for (const member of row.members) {
      assert.ok(known.has(member.id), member.id);
      assert.ok(member.families.includes(row.family.id));
    }
    for (const hero of row.heroes) assert.ok(HERO_ORDER.includes(hero));
  }
  assert.ok(rows.find((row) => row.family.id === "storm")!.heroes.includes("volt"));
});

test("every tab renders for every family and rank without junk", () => {
  for (const tab of GUIDE_TABS)
    for (const family of FAMILY_FILTERS)
      for (const rank of RANKS.map((r) => r.level)) {
        const html = renderGuideTab(tab.id, { family, rank, selected: null }, view);
        assert.ok(html.length > 0, `${tab.id}/${family}/${rank}`);
        for (const word of FORBIDDEN)
          assert.ok(!html.includes(word), `${tab.id}/${family}/${rank} contains ${word}`);
        if (tab.layout === "catalog") {
          assert.ok(html.includes('data-scroll-key="catalog-grid"'));
          const entries = guideEntries(tab.id, tab.usesFamily ? family : "all");
          for (const entry of entries) {
            assert.ok(html.includes(escape(entry.name)), `${tab.id}: ${entry.name}`);
            assert.ok(html.includes(`data-focus-key="catalog:${escape(entry.id)}"`));
          }
          if (entries.length) {
            assert.ok(html.includes('data-scroll-key="catalog-detail"'));
            assert.ok(html.includes("is-selected"));
          } else assert.ok(html.includes("rz-catalog-empty"));
        } else assert.ok(html.includes('data-scroll-key="guide-panel"'));
      }
});

test("selection, escaping and per-tab markup", () => {
  const last = guideEntries("weapons", "all").at(-1)!;
  const html = renderGuideTab("weapons", { family: "all", rank: 3, selected: last.id }, view);
  assert.ok(html.includes(`data-value="${last.id}" data-focus-key="catalog:${last.id}" aria-pressed="true"`));
  assert.ok(html.includes("rz-rank-3"));
  const sets = renderGuideTab("sets", { family: "frost", rank: 1, selected: null }, view);
  assert.equal((sets.match(/class="rz-set-row"/g) ?? []).length, 1);
  assert.ok(sets.includes("rz-set-tier") && sets.includes("rz-set-members"));
  const enemies = renderGuideTab("enemies", { family: "all", rank: 1, selected: null }, view);
  assert.ok(enemies.includes("rz-guide-table"));
  for (const row of enemyGuideRows()) assert.ok(enemies.includes(escape(row.name)));
  for (const boss of bossGuideRows()) assert.ok(enemies.includes(escape(boss.name)));
  const howto = renderGuideTab("howto", { family: "all", rank: 1, selected: null }, view);
  assert.ok(howto.includes("rz-howto-grid"));
  assert.equal((howto.match(/rz-howto-section/g) ?? []).length, howToSections().length);
  const maps = renderGuideTab("maps", { family: "all", rank: 1, selected: "3" }, view);
  assert.ok(maps.includes("is-map") && maps.includes("Clear map 2 first"));
  const heroes = renderGuideTab(
    "heroes",
    { family: "all", rank: 1, selected: "volt" },
    { ...view, heroRecords: { volt: 7 } },
  );
  assert.ok(heroes.includes("is-hero") && heroes.includes("Best wave 07"));
  const cleared = renderGuideTab(
    "maps",
    { family: "all", rank: 1, selected: "1" },
    { ...view, clearedBy: { 1: ["ember", "volt"] } },
  );
  assert.ok(cleared.includes("Cleared by Rook, Volt."));
  const art = renderGuideTab(
    "weapons",
    { family: "all", rank: 1, selected: "pistol" },
    { ...view, art: { pistol: 'x.png"<' } },
  );
  assert.ok(art.includes('src="x.png&quot;&lt;"'));
});

test("how to play prints live constants and every hint", () => {
  const text = howToSections().flatMap((section) => section.lines).join("\n");
  const ids = howToSections().map((section) => section.id);
  assert.deepEqual(ids, ["controls", "waves", "shop", "ranks", "sets", "mods", "maps", "tips"]);
  for (const needle of [
    String(BAG_CAPACITY),
    String(CAMPAIGN_WAVES),
    String(rerollCost(1, 0)),
    `${REPAIR_HEAL * 100}%`,
    `${SELL_RATE * 100}%`,
    String(BAG_SLOT_COST),
    ...RANKS.map((rank) => rank.name),
    ...HINTS.map((hint) => hint.text),
  ])
    assert.ok(text.includes(needle), needle);
  for (const word of FORBIDDEN) assert.ok(!text.includes(word), word);
});

test("detail lines change between rank 1 and rank 6 for scaling gear", () => {
  for (const tab of GEAR_TABS)
    for (const entry of guideEntries(tab, "all")) {
      const low = guideDetailLines(entry, 1).map((l) => l.text),
        high = guideDetailLines(entry, 6).map((l) => l.text);
      assert.ok(low.length > 0, entry.id);
      for (const l of [...low, ...high]) {
        for (const word of FORBIDDEN) assert.ok(!l.includes(word), `${entry.id}: ${l}`);
      }
      const unique = entry.category === "weapon" && WEAPONS[entry.id as keyof typeof WEAPONS]?.unique;
      if (unique) assert.deepEqual(low, high, `${entry.id} should not scale`);
      else assert.notDeepEqual(low, high, `${entry.id} should scale`);
      assert.ok(low.some((l) => /emeralds at wave \d+/.test(l)), `${entry.id} price`);
    }
  const pistol = guideDetailLines(guideEntries("weapons", "all").find((e) => e.id === "pistol")!, 1);
  assert.ok(pistol.some((l) => l.text === `Range ${WEAPONS.pistol.range}`));
  for (const entry of guideEntries("maps", "all")) assert.ok(guideDetailLines(entry, 1).length >= 3);
  for (const entry of guideEntries("heroes", "all")) {
    const lines = guideDetailLines(entry, 1).map((l) => l.text);
    assert.ok(lines.some((l) => l.startsWith("Role:")));
    assert.ok(lines.some((l) => /hands?$/.test(l)));
  }
  assert.ok(
    guideDetailLines(guideEntries("heroes", "all")[1], 1).some((l) =>
      l.text.startsWith("Complete map 1 with"),
    ),
  );
});

test("completesSetTier reports the tiers a new piece would reach", () => {
  assert.deepEqual(completesSetTier(["kinetic"], { kinetic: 1 }, true), [{ family: "kinetic", size: 2 }]);
  assert.deepEqual(completesSetTier(["kinetic", "storm"], { kinetic: 3, storm: 5 }, true), [
    { family: "kinetic", size: 4 },
    { family: "storm", size: 6 },
  ]);
  assert.deepEqual(completesSetTier(["kinetic"], { kinetic: 2 }, true), []);
  assert.deepEqual(completesSetTier(["kinetic"], {}, true), []);
  assert.deepEqual(completesSetTier(["kinetic"], { kinetic: 1 }, false), []);
  assert.deepEqual(completesSetTier(["thermal", "thermal"], { thermal: 1 }, true), [{ family: "thermal", size: 2 }]);
});

test("deployHelp explains locks, endless and the controls", () => {
  const base = {
    heroName: "Volt",
    previousHeroName: "Rook",
    heroUnlocked: true,
    mapIndex: 1,
    mapUnlocked: true,
    cleared: false,
    bestWave: 0,
    endless: false,
  };
  assert.equal(deployHelp({ ...base, heroUnlocked: false }), "Complete map 1 with Rook to unlock Volt");
  assert.equal(deployHelp({ ...base, mapIndex: 4, mapUnlocked: false }), "Clear map 3 with Volt first");
  assert.equal(
    deployHelp({ ...base, cleared: true, endless: true, bestWave: 12 }),
    "Endless has no finish line. Best wave 12 on this map.",
  );
  assert.equal(deployHelp({ ...base, endless: true }), "Endless has no finish line. Best wave counts.");
  const fallback = deployHelp(base);
  assert.ok(/dash/i.test(fallback) && /move/i.test(fallback));
  for (const word of FORBIDDEN) assert.ok(!fallback.includes(word));
});
