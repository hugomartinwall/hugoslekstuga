import { test } from "vitest";
import assert from "node:assert/strict";
import {
  Platform,
  freshSave,
  parseSave,
  SAVE_KEY,
} from "../../lib/survival-maxx/platform";
import {
  HERO_ORDER,
  CAMPAIGN_WAVES,
  MAP_COUNT,
  type HeroId,
} from "../../lib/survival-maxx/content";
import {
  getUnlockedHeroes,
  getClearedHeroes,
  getUnlockedMaps,
  canPlay,
  recordClear,
  recordProgress,
} from "../../lib/survival-maxx/progression";

/**
 * The CrazyGames build's platform suite covered SDK negotiation, cloud reads
 * and platform mute. None of that exists on the site: progress is a single
 * localStorage key. What survives is the part that was always pure — save
 * parsing and the unlock chain — plus the small local seam itself.
 */

function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

test("an empty browser starts a fresh save under the site's namespaced key", async () => {
  const storage = memoryStorage();
  const platform = new Platform(storage);
  await platform.init();
  assert.deepEqual(platform.save, freshSave());
  assert.equal(platform.warning, "");
  platform.save.totalRuns = 1;
  platform.persist();
  assert.equal(SAVE_KEY, "hugoslekstuga:survival-maxx:save");
  assert.deepEqual([...storage.store.keys()], [SAVE_KEY]);
  assert.deepEqual(parseSave(storage.store.get(SAVE_KEY)!), platform.save);
});

test("progress round-trips through storage and initialization is deduplicated", async () => {
  const storage = memoryStorage({
    [SAVE_KEY]: JSON.stringify({
      ...freshSave(),
      version: 2,
      bestWave: 12,
      totalRuns: 4,
      clearedHeroes: ["ember"],
      heroRecords: { ember: 30, volt: 12 },
    }),
  });
  const platform = new Platform(storage);
  await Promise.all([platform.init(), platform.init()]);
  assert.deepEqual(getUnlockedHeroes(platform.save), ["ember", "volt"]);
  assert.equal(platform.save.bestWave, 30);
  assert.equal(platform.save.heroRecords.volt, 12);
});

test("blocked storage keeps the run in memory and reports the failure once", async () => {
  const throwing = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("SecurityError");
    },
  };
  const platform = new Platform(throwing);
  await platform.init();
  assert.deepEqual(platform.save, freshSave());
  assert.equal(platform.warning, "Progress won't be saved.");
  platform.save.bestWave = 7;
  platform.persist();
  assert.equal(platform.save.bestWave, 7, "memory progress survives");

  const quota = memoryStorage();
  quota.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  const full = new Platform(quota);
  await full.init();
  full.save.bestWave = 3;
  full.persist();
  assert.equal(full.warning, "Progress not saved.");
  assert.equal(full.save.bestWave, 3);
});

test("initializing without a window is harmless, which is what server rendering needs", async () => {
  assert.equal(typeof window, "undefined", "this suite runs in Node");
  const platform = new Platform();
  await platform.init();
  assert.deepEqual(platform.save, freshSave());
  assert.equal(platform.warning, "");
  platform.persist();
  platform.dispose();
});

test("untrusted save records cannot introduce invalid settings or counters", () => {
  for (const malformed of ["{", "null", "[]", "0", '{"version":99}']) {
    assert.deepEqual(parseSave(malformed), freshSave());
  }
  const save = parseSave(
    JSON.stringify({
      version: 2,
      muted: "true",
      music: false,
      reducedMotion: true,
      bestWave: -3,
      totalRuns: 2.9,
      victories: 99,
    }),
  );
  assert.deepEqual(save, {
    ...freshSave(),
    music: false,
    reducedMotion: true,
    totalRuns: 2,
    victories: 0,
  });
  assert.equal(parseSave('{"version":2,"bestWave":"9"}').bestWave, 0);
});

test("operators unlock in order, only after the previous campaign clears", () => {
  const save = freshSave();
  assert.deepEqual(getUnlockedHeroes(save), ["ember"]);
  recordProgress(save, "ember", 1, CAMPAIGN_WAVES);
  assert.deepEqual(
    getUnlockedHeroes(save),
    ["ember"],
    "reaching the final wave is not a clear",
  );
  assert.deepEqual(
    recordClear(save, "volt", 1),
    { hero: null, map: null },
    "a locked operator cannot skip the chain",
  );
  for (let index = 0; index < HERO_ORDER.length; index++) {
    const hero = HERO_ORDER[index];
    assert.deepEqual(recordClear(save, hero, 1), {
      hero: HERO_ORDER[index + 1] ?? null,
      map: 2,
    });
    assert.deepEqual(
      getUnlockedHeroes(save),
      HERO_ORDER.slice(0, Math.min(HERO_ORDER.length, index + 2)),
    );
    assert.equal(save.victories, index + 1);
    assert.equal(save.heroRecords[hero], CAMPAIGN_WAVES);
    assert.deepEqual(save.mapRecords[hero], [CAMPAIGN_WAVES]);
  }
  assert.deepEqual(getClearedHeroes(save), HERO_ORDER);
});

test("maps unlock per character, one at a time, and only clearing map 1 unlocks a character", () => {
  const save = freshSave();
  assert.deepEqual(getUnlockedMaps(save, "ember"), [1]);
  assert.deepEqual(getUnlockedMaps(save, "volt"), []);
  assert.equal(canPlay(save, "ember", 2), false);
  assert.equal(canPlay(save, "ember", 1, true), false, "endless needs a clear");
  assert.deepEqual(recordClear(save, "ember", 2), { hero: null, map: null });
  assert.deepEqual(recordClear(save, "ember", 1), { hero: "volt", map: 2 });
  assert.deepEqual(getUnlockedMaps(save, "ember"), [1, 2]);
  assert.equal(canPlay(save, "ember", 1, true), true);
  assert.equal(canPlay(save, "ember", 2, true), false);
  assert.deepEqual(recordClear(save, "ember", 2), { hero: null, map: 3 });
  assert.deepEqual(
    recordClear(save, "volt", 3),
    { hero: null, map: null },
    "only the next uncleared map counts",
  );
  assert.deepEqual(recordClear(save, "volt", 1), { hero: "bastion", map: 2 });
  for (let map = 3; map <= MAP_COUNT; map++)
    assert.deepEqual(recordClear(save, "ember", map), {
      hero: null,
      map: map < MAP_COUNT ? map + 1 : null,
    });
  assert.equal(save.mapClears.ember, MAP_COUNT);
  assert.equal(getUnlockedMaps(save, "ember").length, MAP_COUNT);
  assert.equal(save.victories, MAP_COUNT + 1);
  recordProgress(save, "ember", 2, 90);
  assert.equal(save.mapRecords.ember![1], 90);
  assert.equal(save.bestWave, 90);
  assert.deepEqual(getUnlockedHeroes(save), ["ember", "volt", "bastion"]);
});

test("repeated clears and endless records never grant additional operator unlocks", () => {
  const save = freshSave();
  assert.deepEqual(recordClear(save, "ember", 1), { hero: "volt", map: 2 });
  assert.deepEqual(recordClear(save, "ember", 1), { hero: null, map: null });
  recordProgress(save, "ember", 1, 117);
  assert.deepEqual(recordClear(save, "ember", 1), { hero: null, map: null });
  assert.deepEqual(getUnlockedHeroes(save), ["ember", "volt"]);
  assert.equal(save.bestWave, 117);
  assert.equal(save.heroRecords.ember, 117);
  assert.equal(save.victories, 1);
  const restored = parseSave(JSON.stringify(save));
  assert.deepEqual(restored, save);
  assert.deepEqual(recordClear(restored, "ember", 1), { hero: null, map: null });
  assert.deepEqual(recordClear(restored, "volt", 1), {
    hero: "bastion",
    map: 2,
  });
});

test("wave records are monotonic, bounded and cannot unlock a locked operator", () => {
  const save = freshSave();
  recordProgress(save, "ember", 1, 15);
  recordProgress(save, "ember", 1, 4);
  recordProgress(save, "ember", 1, NaN);
  recordProgress(save, "ember", 1, Infinity);
  recordProgress(save, "ember", 1, -5);
  recordProgress(save, "ember", 2, 12);
  recordProgress(save, "ember", 0, 12);
  recordProgress(save, "ember", 1.5, 12);
  recordProgress(save, "prism" as HeroId, 1, 30);
  assert.equal(save.bestWave, 15);
  assert.equal(save.heroRecords.ember, 15);
  assert.deepEqual(save.mapRecords.ember, [15]);
  assert.equal(save.heroRecords["prism" as HeroId], undefined);
  assert.deepEqual(getUnlockedHeroes(save), ["ember"]);
  recordProgress(save, "ember", 1, 1e12);
  assert.equal(save.bestWave, 1_000_000);
});

test("untrusted hero IDs, duplicate clears and gaps cannot bypass the unlock chain", () => {
  const save = parseSave(
    JSON.stringify({
      ...freshSave(),
      version: 2,
      clearedHeroes: ["ember", "ember", "prism", "unknown"],
      heroRecords: { ember: 2, volt: "80", prism: 1e12, unknown: 700 },
      victories: 999,
      totalRuns: -1,
    }),
  );
  assert.deepEqual(getClearedHeroes(save), ["ember"]);
  assert.deepEqual(save.mapClears, { ember: 1 });
  assert.deepEqual(getUnlockedHeroes(save), ["ember", "volt"]);
  assert.equal(save.heroRecords.ember, 30);
  assert.equal(save.heroRecords.volt, undefined);
  assert.equal(save.heroRecords.prism, undefined, "locked heroes keep no records");
  assert.equal(Object.hasOwn(save.heroRecords, "unknown"), false);
  assert.equal(save.victories, 1);
  assert.equal(save.totalRuns, 1);
  assert.equal(
    parseSave('{"version":2,"bestWave":1e400,"totalRuns":1e400}').bestWave,
    0,
  );
  const tampered = parseSave(
    JSON.stringify({
      ...freshSave(),
      mapClears: { ember: 3, volt: 0, bastion: 5, prism: 99 },
      mapRecords: {
        ember: [10, 10, 10, 10, 10, 10],
        volt: "nope",
        bastion: [40, 40],
        cinder: [NaN, 1e400, 7],
      },
      hints: ["move", "move", 7, "x".repeat(80)],
    }),
  );
  assert.deepEqual(tampered.mapClears, { ember: 3 });
  assert.deepEqual(tampered.mapRecords, { ember: [30, 30, 30, 10] });
  assert.deepEqual(tampered.hints, ["move"]);
  assert.deepEqual(getUnlockedHeroes(tampered), ["ember", "volt"]);
  assert.deepEqual(getUnlockedMaps(tampered, "ember"), [1, 2, 3, 4]);
  assert.equal(
    parseSave(JSON.stringify({ ...freshSave(), mapClears: { ember: 99 } }))
      .mapClears.ember,
    MAP_COUNT,
  );
});

test("0.8 saves migrate: cleared heroes have map 1 done and endless records stay", () => {
  const restored = parseSave(
    JSON.stringify({
      version: 2,
      muted: false,
      music: true,
      reducedMotion: false,
      bestWave: 40,
      clearedHeroes: ["ember", "volt"],
      heroRecords: { ember: 40, volt: 30, bastion: 12 },
      totalRuns: 3,
      victories: 2,
    }),
  );
  assert.equal(restored.version, 3);
  assert.deepEqual(restored.mapClears, { ember: 1, volt: 1 });
  assert.deepEqual(restored.mapRecords, {
    ember: [40],
    volt: [30],
    bastion: [12],
  });
  assert.deepEqual(restored.heroRecords, { ember: 40, volt: 30, bastion: 12 });
  assert.equal(restored.victories, 2);
  assert.equal(restored.bestWave, 40);
  assert.deepEqual(getUnlockedHeroes(restored), ["ember", "volt", "bastion"]);
  assert.deepEqual(getUnlockedMaps(restored, "ember"), [1, 2]);
  assert.deepEqual(getUnlockedMaps(restored, "bastion"), [1]);
  assert.deepEqual(recordClear(restored, "bastion", 1), {
    hero: "cinder",
    map: 2,
  });
  assert.equal(restored.mapRecords.bastion![0], CAMPAIGN_WAVES);
  assert.equal(JSON.parse(JSON.stringify(restored)).version, 3);
});


test("a version 2 site save (the 0.8 port) migrates and a newer one is left alone", async () => {
  const storage = memoryStorage({
    [SAVE_KEY]: JSON.stringify({
      version: 2,
      muted: false,
      music: true,
      reducedMotion: false,
      bestWave: 26,
      totalRuns: 4,
      victories: 1,
      clearedHeroes: ["ember"],
      heroRecords: { ember: 30, volt: 26 },
    }),
  });
  const platform = new Platform(storage);
  await platform.init();
  assert.equal(platform.warning, "");
  assert.deepEqual(platform.save.mapClears, { ember: 1 });
  assert.deepEqual(getUnlockedMaps(platform.save, "ember"), [1, 2]);
  platform.persist();
  assert.equal(JSON.parse(storage.store.get(SAVE_KEY)!).version, 3);
  const future = memoryStorage({ [SAVE_KEY]: '{"version":4}' });
  const guarded = new Platform(future);
  await guarded.init();
  guarded.persist();
  assert.ok(guarded.warning);
  assert.equal(future.store.get(SAVE_KEY), '{"version":4}');
});
