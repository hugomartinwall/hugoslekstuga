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
  type HeroId,
} from "../../lib/survival-maxx/content";
import {
  getUnlockedHeroes,
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

test("characters unlock in order, only after the previous campaign clears", () => {
  const save = freshSave();
  assert.deepEqual(getUnlockedHeroes(save), ["ember"]);
  recordProgress(save, "ember", CAMPAIGN_WAVES);
  assert.deepEqual(
    getUnlockedHeroes(save),
    ["ember"],
    "reaching the final wave is not a clear",
  );
  assert.equal(
    recordClear(save, "volt"),
    null,
    "a locked character cannot skip the chain",
  );
  for (let index = 0; index < HERO_ORDER.length; index++) {
    const hero = HERO_ORDER[index];
    assert.equal(recordClear(save, hero), HERO_ORDER[index + 1] ?? null);
    assert.deepEqual(
      getUnlockedHeroes(save),
      HERO_ORDER.slice(0, Math.min(HERO_ORDER.length, index + 2)),
    );
    assert.equal(save.victories, index + 1);
    assert.equal(save.heroRecords[hero], CAMPAIGN_WAVES);
  }
});

test("repeated clears and endless records never grant additional unlocks", () => {
  const save = freshSave();
  assert.equal(recordClear(save, "ember"), "volt");
  assert.equal(recordClear(save, "ember"), null);
  recordProgress(save, "ember", 117);
  assert.equal(recordClear(save, "ember"), null);
  assert.deepEqual(getUnlockedHeroes(save), ["ember", "volt"]);
  assert.equal(save.bestWave, 117);
  assert.equal(save.heroRecords.ember, 117);
  assert.equal(save.victories, 1);
  const restored = parseSave(JSON.stringify(save));
  assert.deepEqual(restored, save);
  assert.equal(recordClear(restored, "ember"), null);
  assert.equal(recordClear(restored, "volt"), "bastion");
});

test("wave records are monotonic, bounded and cannot unlock a locked character", () => {
  const save = freshSave();
  recordProgress(save, "ember", 15);
  recordProgress(save, "ember", 4);
  recordProgress(save, "ember", NaN);
  recordProgress(save, "ember", Infinity);
  recordProgress(save, "ember", -5);
  recordProgress(save, "prism" as HeroId, 30);
  assert.equal(save.bestWave, 15);
  assert.equal(save.heroRecords.ember, 15);
  assert.equal(save.heroRecords["prism" as HeroId], undefined);
  assert.deepEqual(getUnlockedHeroes(save), ["ember"]);
  recordProgress(save, "ember", 1e12);
  assert.equal(save.bestWave, 1_000_000);
});

test("untrusted hero IDs, duplicate clears and gaps cannot bypass the unlock chain", () => {
  const save = parseSave(
    JSON.stringify({
      ...freshSave(),
      clearedHeroes: ["ember", "ember", "prism", "unknown"],
      heroRecords: { ember: 2, volt: "80", prism: 1e12, unknown: 700 },
      victories: 999,
      totalRuns: -1,
    }),
  );
  assert.deepEqual(save.clearedHeroes, ["ember"]);
  assert.deepEqual(getUnlockedHeroes(save), ["ember", "volt"]);
  assert.equal(save.heroRecords.ember, 30);
  assert.equal(save.heroRecords.volt, undefined);
  assert.equal(Object.hasOwn(save.heroRecords, "unknown"), false);
  assert.equal(save.victories, 1);
  assert.equal(save.totalRuns, 1);
  assert.equal(
    parseSave('{"version":2,"bestWave":1e400,"totalRuns":1e400}').bestWave,
    0,
  );
});

test("records above the campaign length survive as best waves without inventing clears", () => {
  const restored = parseSave(
    JSON.stringify({
      ...freshSave(),
      bestWave: 40,
      clearedHeroes: ["ember"],
      heroRecords: { ember: 40, volt: 18 },
      totalRuns: 3,
    }),
  );
  assert.deepEqual(getUnlockedHeroes(restored), ["ember", "volt"]);
  assert.equal(restored.heroRecords.ember, 40);
  assert.equal(restored.heroRecords.volt, 18);
  assert.equal(restored.bestWave, 40);
  assert.equal(recordClear(restored, "volt"), "bastion");
  assert.equal(restored.heroRecords.volt, CAMPAIGN_WAVES);
});
