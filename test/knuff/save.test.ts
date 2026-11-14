import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_TUNE, mergeTune } from "../../lib/knuff/content/tune";
import { createKnuff, type KnuffHandle, type KnuffView } from "../../lib/knuff/game";
import { KEY, NO_SAVE, RUN_V, browserStorages, createStore, tuneFingerprint } from "../../lib/knuff/save";
import { cloneState, createState, type StartOptions } from "../../lib/knuff/sim/state";
import { step } from "../../lib/knuff/sim/step";
import type { SimEvent, State } from "../../lib/knuff/sim/types";
import { FONTS, MemoryStorage, ThrowingStorage, installBrowser, pull, type Browser } from "./browser";

/**
 * What the game keeps on the device (§11): the five keys, behind
 * lib/knuff/save.ts, and when the game writes, reads and deletes the night
 * of a browser session (§3.11). The first half holds the store alone, over
 * storages handed in; the second makes the whole game in a stand-in for
 * the browser and holds what it does with them.
 */

const FIVE = [KEY.save, KEY.muted, KEY.motion, KEY.pull, KEY.run];

describe("the five keys", () => {
  it("are the game's own, under the site's namespace", () => {
    expect(FIVE).toEqual([
      "hugoslekstuga:knuff:save",
      "hugoslekstuga:knuff:muted",
      "hugoslekstuga:knuff:motion",
      "hugoslekstuga:knuff:pull",
      "hugoslekstuga:knuff:run",
    ]);
  });
});

describe("the record", () => {
  it("is { v: 1, best, bestClock, bestShot, runs, mornings } and nothing else", () => {
    const local = new MemoryStorage();
    const store = createStore(local, new MemoryStorage());
    expect(store.readSave()).toEqual(NO_SAVE);
    store.nightBegan();
    store.nightEnded({ score: 4200, clock: 3, bestShot: 900, morning: false });
    const raw = JSON.parse(local.getItem(KEY.save) as string);
    expect(raw).toEqual({ v: 1, best: 4200, bestClock: 3, bestShot: 900, runs: 1, mornings: 0 });
    expect(Object.keys(raw).sort()).toEqual(["best", "bestClock", "bestShot", "mornings", "runs", "v"]);
    expect(local.keys()).toEqual([KEY.save]);
  });

  it("keeps the best of each, counts nights begun and mornings, and says when a score beats the best", () => {
    const local = new MemoryStorage();
    const store = createStore(local, null);
    store.nightBegan();
    expect(store.nightEnded({ score: 5000, clock: 6, bestShot: 1200, morning: false }).newBest).toBe(true);
    store.nightBegan();
    const lower = store.nightEnded({ score: 3000, clock: 2, bestShot: 1500, morning: false });
    expect(lower.newBest).toBe(false);
    expect(lower.save).toEqual({ v: 1, best: 5000, bestClock: 6, bestShot: 1500, runs: 2, mornings: 0 });
    store.nightBegan();
    const morning = store.nightEnded({ score: 9000, clock: 12, bestShot: 800, morning: true });
    expect(morning.newBest).toBe(true);
    expect(morning.save).toEqual({ v: 1, best: 9000, bestClock: 12, bestShot: 1500, runs: 3, mornings: 1 });
    // A score equal to the best is not a new one.
    expect(store.nightEnded({ score: 9000, clock: 1, bestShot: 0, morning: false }).newBest).toBe(false);
  });

  it("reads another tab's nights before it writes, so neither tab's are lost", () => {
    const local = new MemoryStorage();
    const a = createStore(local, null);
    const b = createStore(local, null);
    a.readSave();
    b.readSave();
    a.nightBegan();
    b.nightBegan();
    a.nightEnded({ score: 100, clock: 0, bestShot: 100, morning: false });
    b.nightEnded({ score: 50, clock: 4, bestShot: 40, morning: true });
    expect(createStore(local, null).readSave()).toEqual({ v: 1, best: 100, bestClock: 4, bestShot: 100, runs: 2, mornings: 1 });
  });

  it("reads what it cannot make sense of as nothing, field by field", () => {
    const local = new MemoryStorage();
    const read = (raw: string) => {
      local.setItem(KEY.save, raw);
      return createStore(local, null).readSave();
    };
    expect(read("not json")).toEqual(NO_SAVE);
    expect(read("null")).toEqual(NO_SAVE);
    expect(read('{"v":2,"best":10}')).toEqual(NO_SAVE);
    expect(read('{"v":1,"best":"lots","bestClock":40,"bestShot":-3,"runs":2.7,"mornings":null}')).toEqual({
      v: 1,
      best: 0,
      bestClock: 12,
      bestShot: 0,
      runs: 2,
      mornings: 0,
    });
  });
});

describe("the three settings", () => {
  it("are kept as the spec spells them", () => {
    const local = new MemoryStorage();
    const store = createStore(local, null);
    expect([store.readMuted(), store.readMotion(), store.readPull()]).toEqual([false, "auto", "back"]);
    store.writeMuted(true);
    store.writeMotion("on");
    store.writePull("push");
    expect([local.getItem(KEY.muted), local.getItem(KEY.motion), local.getItem(KEY.pull)]).toEqual(["1", "on", "push"]);
    const again = createStore(local, null);
    expect([again.readMuted(), again.readMotion(), again.readPull()]).toEqual([true, "on", "push"]);
    again.writeMuted(false);
    again.writeMotion("off");
    expect([local.getItem(KEY.muted), local.getItem(KEY.motion)]).toEqual(["0", "off"]);
  });

  it("read a value that is not theirs as the default", () => {
    const local = new MemoryStorage();
    local.setItem(KEY.muted, "yes");
    local.setItem(KEY.motion, "reduce");
    local.setItem(KEY.pull, "forward");
    const store = createStore(local, null);
    expect([store.readMuted(), store.readMotion(), store.readPull()]).toEqual([false, "auto", "back"]);
  });
});

describe("blocked storage", () => {
  for (const [name, local, session] of [
    ["storage that throws", new ThrowingStorage(), new ThrowingStorage()],
    ["no storage at all", null, null],
  ] as const) {
    it(`${name}: nothing throws, and the game plays from memory`, () => {
      const store = createStore(local, session);
      expect(store.readSave()).toEqual(NO_SAVE);
      store.nightBegan();
      expect(store.nightEnded({ score: 70, clock: 1, bestShot: 70, morning: false })).toEqual({
        save: { v: 1, best: 70, bestClock: 1, bestShot: 70, runs: 1, mornings: 0 },
        newBest: true,
      });
      expect(store.readSave().best).toBe(70);
      store.writeMuted(true);
      store.writeMotion("off");
      store.writePull("push");
      expect([store.readMuted(), store.readMotion(), store.readPull()]).toEqual([true, "off", "push"]);
      const night = midNight(5);
      store.writeRun(DEFAULT_TUNE, night);
      expect(store.readRun(DEFAULT_TUNE)).toBeNull();
      store.deleteRun();
      if (local instanceof ThrowingStorage) expect(local.calls).toBeGreaterThan(0);
    });
  }

  it("a window whose storages cannot even be reached gives none, and does not throw", () => {
    const b = installBrowser({ local: "throw", session: "throw" });
    try {
      expect(browserStorages()).toEqual({ local: null, session: null });
    } finally {
      b.restore();
    }
  });
});

/** A night in progress: one launch straight up through the rack, and a few seconds of it. */
function midNight(seed: number, start: StartOptions = {}, ticks = 240): State {
  const s = createState(seed, DEFAULT_TUNE, start);
  const events: SimEvent[] = [];
  step(s, { launch: { dx: 0, dy: -1, power: 1 }, pullHeld: false }, DEFAULT_TUNE, events);
  for (let i = 0; i < ticks && s.phase !== "over"; i++) step(s, { launch: null, pullHeld: false }, DEFAULT_TUNE, events);
  return s;
}

describe("the stored night", () => {
  it("is { v, tune, state }, with the State whole", () => {
    const session = new MemoryStorage();
    const store = createStore(null, session);
    const night = midNight(11);
    store.writeRun(DEFAULT_TUNE, night);
    const raw = JSON.parse(session.getItem(KEY.run) as string);
    expect(Object.keys(raw).sort()).toEqual(["state", "tune", "v"]);
    expect(raw.v).toBe(RUN_V);
    expect(raw.tune).toBe(tuneFingerprint(DEFAULT_TUNE));
    expect(raw.state).toEqual(JSON.parse(JSON.stringify(night)));
    expect(session.keys()).toEqual([KEY.run]);
  });

  it("is read and left in place: read twice, it is there twice", () => {
    const session = new MemoryStorage();
    const store = createStore(null, session);
    const night = midNight(12);
    store.writeRun(DEFAULT_TUNE, night);
    const first = store.readRun(DEFAULT_TUNE);
    expect(first).toEqual(JSON.parse(JSON.stringify(night)));
    expect(session.getItem(KEY.run)).not.toBeNull();
    expect(createStore(null, session).readRun(DEFAULT_TUNE)).toEqual(first);
  });

  it("of another version is thrown away unread, and its key deleted", () => {
    const session = new MemoryStorage();
    const night = midNight(13);
    session.setItem(KEY.run, JSON.stringify({ v: RUN_V + 1, tune: tuneFingerprint(DEFAULT_TUNE), state: night }));
    expect(createStore(null, session).readRun(DEFAULT_TUNE)).toBeNull();
    expect(session.getItem(KEY.run)).toBeNull();
  });

  it("of another tune is thrown away unread, and its key deleted", () => {
    const session = new MemoryStorage();
    const other = mergeTune(DEFAULT_TUNE, { paceTokens: 6 });
    createStore(null, session).writeRun(other, midNight(14));
    expect(createStore(null, session).readRun(DEFAULT_TUNE)).toBeNull();
    expect(session.getItem(KEY.run)).toBeNull();
  });

  it("does not care which way the pull goes: that is a setting, not a rule", () => {
    const session = new MemoryStorage();
    createStore(null, session).writeRun({ ...DEFAULT_TUNE, pullDir: "push" }, midNight(15));
    expect(createStore(null, session).readRun({ ...DEFAULT_TUNE, pullDir: "back" })).not.toBeNull();
    expect(tuneFingerprint({ ...DEFAULT_TUNE, pullDir: "push" })).toBe(tuneFingerprint(DEFAULT_TUNE));
    expect(tuneFingerprint(mergeTune(DEFAULT_TUNE, { bossHits: 7 }))).not.toBe(tuneFingerprint(DEFAULT_TUNE));
  });

  it("that is broken, or not a night in progress, is thrown away and its key deleted", () => {
    const session = new MemoryStorage();
    const fp = tuneFingerprint(DEFAULT_TUNE);
    const waiting = createState(16, DEFAULT_TUNE);
    const over = midNight(17, {}, 60);
    over.phase = "over";
    for (const raw of [
      "{not json",
      "null",
      JSON.stringify({ v: RUN_V, tune: fp }),
      JSON.stringify({ v: RUN_V, tune: fp, state: waiting }),
      JSON.stringify({ v: RUN_V, tune: fp, state: over }),
      JSON.stringify({ v: RUN_V, tune: fp, state: { phase: "night" } }),
    ]) {
      session.setItem(KEY.run, raw);
      expect(createStore(null, session).readRun(DEFAULT_TUNE), raw.slice(0, 40)).toBeNull();
      expect(session.getItem(KEY.run), raw.slice(0, 40)).toBeNull();
    }
  });
});

// ── The game, in a stand-in for the browser ────────────────────────────

describe("what the game does with the stored night (§3.11)", () => {
  let b: Browser | null = null;
  let game: KnuffHandle | null = null;
  let views: KnuffView[] = [];
  afterEach(() => {
    game?.destroy();
    game = null;
    b?.restore();
    b = null;
    views = [];
  });

  const open = (local = new MemoryStorage(), session = new MemoryStorage()) => {
    b = installBrowser({ local, session });
    views = [];
    game = createKnuff(b.root as unknown as HTMLElement, b.canvas, { fonts: FONTS, onChange: (v) => views.push(v) });
    return { local, session, b: b as Browser, game: game as KnuffHandle };
  };
  /** Make the game again in the same storages, as a page that is left and come back to does. */
  const reopen = (local: MemoryStorage, session: MemoryStorage) => {
    game?.destroy();
    game = null;
    b?.restore();
    return open(local, session);
  };
  const view = () => views[views.length - 1];
  /** The first launch, and a second of the night. */
  const begin = (br: Browser) => {
    pull(br, 195, 400, 0, 90);
    br.frames(60);
  };

  it("nothing is written on the start screen: a pause, a self-pause or leaving there keeps nothing", () => {
    const { session, b: br, game: g } = open();
    br.frames(5);
    g.pause();
    br.win.dispatchEvent(new Event("blur"));
    br.win.dispatchEvent(new Event("pagehide"));
    expect(session.getItem(KEY.run)).toBeNull();
    g.destroy();
    expect(session.getItem(KEY.run)).toBeNull();
    expect(view().screen).toBe("start");
  });

  it("is written at every pause of a night in progress, whoever caused it", () => {
    const { session, b: br, game: g } = open();
    begin(br);
    expect(view().screen).toBe("play");
    g.pause();
    expect(view().screen).toBe("paused");
    const kept = JSON.parse(session.getItem(KEY.run) as string);
    expect(kept.state.phase).toBe("night");
    // RESUME: it goes on, and the key goes.
    g.resume();
    expect(session.getItem(KEY.run)).toBeNull();
    br.wait(600);
    br.frames(30);
    // A self-pause: the window loses focus.
    br.win.dispatchEvent(new Event("blur"));
    expect(view().screen).toBe("paused");
    expect(session.getItem(KEY.run)).not.toBeNull();
  });

  it("is written when the page becomes too small in the middle of a night; Escape does nothing there, and big again it is paused", () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    b = installBrowser({ coarse: false, w: 1280, h: 800, local, session });
    views = [];
    game = createKnuff(b.root as unknown as HTMLElement, b.canvas, { fonts: FONTS, onChange: (v) => views.push(v) });
    const br = b as Browser;
    pull(br, 640, 500, 0, 90, "mouse");
    br.frames(60);
    expect(view().screen).toBe("play");
    expect(session.getItem(KEY.run)).toBeNull();
    // A laptop window under 436 px tall is too small (§9.1).
    br.root.clientHeight = 400;
    br.win.dispatchEvent(new Event("resize"));
    expect(view().screen).toBe("tooSmall");
    const kept = JSON.parse(session.getItem(KEY.run) as string);
    expect(kept.state.phase).toBe("night");
    // The night stands still under the panel, and Escape there neither resumes it nor deletes it.
    br.frames(30);
    br.key("keydown", { key: "Escape", code: "Escape" });
    br.key("keyup", { key: "Escape", code: "Escape" }, br.win);
    (game as KnuffHandle).resume();
    expect(view().screen).toBe("tooSmall");
    expect(JSON.parse(session.getItem(KEY.run) as string).state.tick).toBe(kept.state.tick);
    // Big again: the pause panel, the night still kept.
    br.root.clientHeight = 800;
    br.win.dispatchEvent(new Event("resize"));
    expect(view().screen).toBe("paused");
    expect(session.getItem(KEY.run)).not.toBeNull();
  });

  it("is written when the page unmounts in the middle of a night, and offered when it opens again", () => {
    const { local, session, b: br } = open();
    begin(br);
    expect(view().screen).toBe("play");
    // Left without a pause (the Back button, a row of the search palette).
    (game as KnuffHandle).destroy();
    const raw = session.getItem(KEY.run);
    expect(raw).not.toBeNull();
    const hour = JSON.parse(raw as string).state.night.hour;
    reopen(local, session);
    expect(view().screen).toBe("start");
    expect(view().waiting).toBe(["19:00", "20:00", "21:00"][hour]);
  });

  it("is read and left in place: StrictMode's mount, clean-up and second mount still find it", () => {
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    createStore(local, session).writeRun({ ...DEFAULT_TUNE }, midNight(21, { hour: 4 }));
    const before = session.getItem(KEY.run);
    open(local, session);
    expect(view().waiting).toBe("23:00");
    expect(session.getItem(KEY.run)).toBe(before);
    // The first clean-up has no night in progress: it writes nothing and deletes nothing.
    reopen(local, session);
    expect(session.getItem(KEY.run)).toBe(before);
    expect(view().waiting).toBe("23:00");
    // While the panel is up nothing is played: a pull launches nothing, and a pause writes nothing.
    pull(b as Browser, 195, 400, 0, 90);
    (b as Browser).frames(30);
    (game as KnuffHandle).pause();
    expect(view().screen).toBe("start");
    expect(session.getItem(KEY.run)).toBe(before);
  });

  it("is deleted when the Resume panel is answered with NEW NIGHT", () => {
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    createStore(local, session).writeRun({ ...DEFAULT_TUNE }, midNight(22, { hour: 2 }));
    const { game: g } = open(local, session);
    expect(view().waiting).toBe("21:00");
    g.restart();
    expect(session.getItem(KEY.run)).toBeNull();
    expect(view().waiting).toBeNull();
    expect(view().screen).toBe("start");
  });

  it("is deleted when the Resume panel is answered with RESUME, and the night it read goes on from where it stopped", () => {
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    const night = midNight(23, { hour: 3 });
    createStore(local, session).writeRun({ ...DEFAULT_TUNE }, night);
    const { b: br, game: g } = open(local, session);
    expect(view().waiting).toBe("22:00");
    // The key is changed behind the engine's back, to another night that could be played: RESUME loads
    // the copy it read when it was made, not the key a second time.
    createStore(local, session).writeRun({ ...DEFAULT_TUNE }, midNight(99, { hour: 7 }));
    g.resumeStored();
    expect(session.getItem(KEY.run)).toBeNull();
    expect(view().waiting).toBeNull();
    expect(view().screen).toBe("play");
    // The room stays frozen for 500 ms after RESUME, then the night goes on from its own tick.
    g.pause();
    const paused = JSON.parse(session.getItem(KEY.run) as string).state as State;
    expect(paused.tick).toBe(night.tick);
    expect(paused.night.hour).toBe(3);
    g.resume();
    br.frames(10);
    g.pause();
    expect((JSON.parse(session.getItem(KEY.run) as string).state as State).tick).toBe(night.tick);
    g.resume();
    br.wait(500);
    br.frames(10);
    g.pause();
    expect((JSON.parse(session.getItem(KEY.run) as string).state as State).tick).toBeGreaterThan(night.tick);
  });

  it("is deleted at BACK TO PLAYHOUSE, and the unmount that follows writes nothing", () => {
    const { session, b: br, game: g } = open();
    begin(br);
    g.pause();
    expect(session.getItem(KEY.run)).not.toBeNull();
    g.abandon();
    expect(session.getItem(KEY.run)).toBeNull();
    g.destroy();
    expect(session.getItem(KEY.run)).toBeNull();
  });

  it("is deleted at the end of a night, and the record is written when it begins and when it ends", () => {
    // Make a night that ends on its next tick: stand still from the first launch until he falls, and keep the tick before.
    const fell = midNight(31, {}, 20000);
    expect(fell.phase).toBe("over");
    // It scored: so with nothing kept before it, it is a new best.
    expect(fell.score).toBeGreaterThan(0);
    const before = midNight(31, {}, 0);
    while (before.tick < fell.tick - 1) step(before, { launch: null, pullHeld: false }, DEFAULT_TUNE, []);
    expect(before.phase).not.toBe("over");
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    createStore(local, session).writeRun({ ...DEFAULT_TUNE }, before);
    const { b: br, game: g } = open(local, session);
    g.resumeStored();
    // Something wrote the key again; the end of the night deletes it whatever is in it.
    createStore(local, session).writeRun({ ...DEFAULT_TUNE }, before);
    br.wait(600);
    br.frames(5);
    expect(session.getItem(KEY.run)).toBeNull();
    // He fell: nobody is told to be happy about that.
    expect(br.sent).not.toContain("hugoslekstuga:hugo-happy");
    const record = JSON.parse(local.getItem(KEY.save) as string);
    // A resumed night was counted when it began, in the session that began it.
    expect(record.runs).toBe(0);
    expect(record.best).toBe(fell.score);
    expect(record.bestShot).toBe(fell.bestShot);
    expect(record.bestClock).toBe(fell.lastHurtHour >= 0 ? fell.lastHurtHour : fell.night.hour);
    expect(record.mornings).toBe(0);
    // The end panel, 800 ms later, shows the best from the record.
    br.wait(800);
    br.frames(1);
    expect(view().screen).toBe("over");
    expect(view().over?.best).toBe(fell.score);
    expect(view().over?.newBest).toBe(true);
    // AGAIN, and the next night's first launch is counted.
    g.restart();
    begin(br);
    expect(JSON.parse(local.getItem(KEY.save) as string).runs).toBe(1);
  });

  it("NEW BEST is against the best kept on the device, and BEST shows that one", () => {
    const fell = midNight(31, {}, 20000);
    const before = midNight(31, {}, 0);
    while (before.tick < fell.tick - 1) step(before, { launch: null, pullHeld: false }, DEFAULT_TUNE, []);
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    local.setItem(KEY.save, JSON.stringify({ v: 1, best: fell.score + 1000, bestClock: 9, bestShot: 5000, runs: 7, mornings: 2 }));
    createStore(local, session).writeRun({ ...DEFAULT_TUNE }, before);
    const { b: br, game: g } = open(local, session);
    g.resumeStored();
    br.wait(600);
    br.frames(5);
    br.wait(800);
    br.frames(1);
    expect(view().screen).toBe("over");
    expect(view().over?.newBest).toBe(false);
    expect(view().over?.best).toBe(fell.score + 1000);
    // This night's own best shot, not the record's.
    expect(view().over?.bestShot).toBe(fell.bestShot);
    expect(JSON.parse(local.getItem(KEY.save) as string)).toEqual({ v: 1, best: fell.score + 1000, bestClock: 9, bestShot: 5000, runs: 7, mornings: 2 });
  });

  it("a first night that ends with nothing scored is no NEW BEST", () => {
    // The night that ends on its next tick, as above, with its score taken away: nothing scored.
    const fell = midNight(31, {}, 20000);
    const before = midNight(31, {}, 0);
    while (before.tick < fell.tick - 1) step(before, { launch: null, pullHeld: false }, DEFAULT_TUNE, []);
    before.score = 0;
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    createStore(local, session).writeRun({ ...DEFAULT_TUNE }, before);
    const { b: br, game: g } = open(local, session);
    g.resumeStored();
    br.wait(600);
    br.frames(5);
    br.wait(800);
    br.frames(1);
    expect(view().screen).toBe("over");
    expect(view().over?.score).toBe(0);
    expect(view().over?.newBest).toBe(false);
    expect(view().over?.best).toBe(0);
  });

  it("MORNING sends hugo-happy once; another ending sends nothing", () => {
    // A night without the polisher ends as morning when 05:00 ends: an empty 05:00, played out.
    const morningFrom = (seed: number) => {
      const s = createState(seed, DEFAULT_TUNE, { hour: 10, empty: true, kinds: [] });
      step(s, { launch: { dx: 0, dy: -1, power: 1 }, pullHeld: false }, DEFAULT_TUNE, []);
      return s;
    };
    const whole = morningFrom(41);
    for (let i = 0; i < 20000 && whole.phase !== "over"; i++) step(whole, { launch: null, pullHeld: false }, DEFAULT_TUNE, []);
    expect(whole.ended).toBe("morning");
    const before = morningFrom(41);
    while (before.tick < whole.tick - 2) step(before, { launch: null, pullHeld: false }, DEFAULT_TUNE, []);
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    createStore(local, session).writeRun({ ...DEFAULT_TUNE }, cloneState(before));
    const { b: br, game: g } = open(local, session);
    g.resumeStored();
    br.wait(600);
    br.frames(120);
    expect(br.sent.filter((t) => t === "hugoslekstuga:hugo-happy")).toHaveLength(1);
    expect(JSON.parse(local.getItem(KEY.save) as string)).toMatchObject({ bestClock: 12, mornings: 1 });
    br.wait(1000);
    br.frames(120);
    expect(br.sent.filter((t) => t === "hugoslekstuga:hugo-happy")).toHaveLength(1);
    expect(view().over?.night).toBe("MORNING");
  });

  it("the settings are read when the game is made and written when they change, M included", () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    local.setItem(KEY.muted, "1");
    local.setItem(KEY.motion, "on");
    local.setItem(KEY.pull, "push");
    const { b: br, game: g } = open(local, session);
    expect(view()).toMatchObject({ muted: true, motion: "on", pull: "push" });
    g.setMuted(false);
    g.setMotion("off");
    g.setPull("back");
    expect([local.getItem(KEY.muted), local.getItem(KEY.motion), local.getItem(KEY.pull)]).toEqual(["0", "off", "back"]);
    br.key("keydown", { key: "m", code: "KeyM" });
    expect(local.getItem(KEY.muted)).toBe("1");
    expect(view().muted).toBe(true);
    // Held, M is one press.
    br.key("keydown", { key: "m", code: "KeyM", repeat: true });
    expect(local.getItem(KEY.muted)).toBe("1");
    reopen(local, session);
    expect(view()).toMatchObject({ muted: true, motion: "off", pull: "back" });
  });

  it("after a night, no key is kept but the five", () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    const { b: br, game: g } = open(local, session);
    begin(br);
    g.setMuted(true);
    g.setMotion("on");
    g.setPull("push");
    g.pause();
    g.resume();
    br.wait(600);
    br.frames(60 * 10);
    g.pause();
    for (const key of [...local.keys(), ...session.keys()]) expect(FIVE, key).toContain(key);
    expect(local.keys()).toEqual([KEY.motion, KEY.muted, KEY.pull, KEY.save].sort());
  });

  it("in a frame whose storage throws, the game is made, played and paused without a word", () => {
    b = installBrowser({ local: "throw", session: "throw" });
    views = [];
    game = createKnuff(b.root as unknown as HTMLElement, b.canvas, { fonts: FONTS, onChange: (v) => views.push(v) });
    begin(b);
    game.setMuted(true);
    game.pause();
    expect(view().screen).toBe("paused");
    expect(view().muted).toBe(true);
    game.resume();
    game.destroy();
    game = null;
  });
});
