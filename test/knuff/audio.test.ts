import { describe, expect, it } from "vitest";
import { createAudio, type Cue } from "../../lib/knuff/audio/audio";
import { createEars, flashStarts } from "../../lib/knuff/audio/events";
import { player, runNight } from "../../lib/knuff/bots/driver";
import { DEFAULT_TUNE } from "../../lib/knuff/content/tune";
import type { SimEvent } from "../../lib/knuff/sim/types";

/**
 * The sound, against a fake AudioContext that is as strict as a real one
 * where a real one throws: a ramp to zero or below, a time before zero, a
 * value that is not a number, a source started twice or stopped before it
 * started. No context may be made before the first touch or key; muted,
 * nothing is played; disposed, the context is closed and the scheduler
 * stopped.
 */

class FakeParam {
  value = 0;
  readonly calls: string[] = [];
  private check(v: number, t: number, what: string) {
    if (!Number.isFinite(v) || !Number.isFinite(t)) throw new TypeError(`${what}: not a finite number (${v}, ${t})`);
    if (t < 0) throw new RangeError(`${what}: a time before zero`);
  }
  setValueAtTime(v: number, t: number) {
    this.check(v, t, "setValueAtTime");
    this.value = v;
    this.calls.push(`set ${v}`);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.check(v, t, "linearRamp");
    this.value = v;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.check(v, t, "exponentialRamp");
    if (v <= 0) throw new RangeError("exponentialRamp: the value must be above zero");
    this.value = v;
  }
  setTargetAtTime(v: number, t: number, c: number) {
    this.check(v, t, "setTargetAtTime");
    if (!(c > 0)) throw new RangeError("setTargetAtTime: the time constant must be above zero");
    this.value = v;
    this.calls.push(`target ${v}`);
  }
}

class FakeNode {
  readonly out: FakeNode[] = [];
  constructor(readonly ctx: FakeContext, readonly kind: string) {
    ctx.made[kind] = (ctx.made[kind] ?? 0) + 1;
  }
  connect(n: FakeNode) {
    if (this.ctx.state === "closed") throw new Error("connect on a closed context");
    this.out.push(n);
    return n;
  }
  disconnect() {
    this.out.length = 0;
  }
}

class FakeSource extends FakeNode {
  type = "sine";
  buffer: unknown = null;
  readonly frequency = new FakeParam();
  onended: (() => void) | null = null;
  started = -1;
  start(t = 0, offset = 0) {
    if (this.started >= 0) throw new Error("started twice");
    if (t < 0 || offset < 0 || !Number.isFinite(t)) throw new RangeError("start: a bad time");
    this.started = t;
    this.ctx.sources.push(this);
  }
  stop(t = 0) {
    if (this.started < 0) throw new Error("stopped before it started");
    if (t < 0 || !Number.isFinite(t)) throw new RangeError("stop: a bad time");
  }
}

class FakeContext {
  state: "suspended" | "running" | "closed";
  currentTime = 1;
  readonly sampleRate = 48000;
  readonly made: Record<string, number> = {};
  readonly sources: FakeSource[] = [];
  readonly gains: { gain: FakeParam }[] = [];
  readonly destination: FakeNode;
  resumes = 0;
  constructor(state: "suspended" | "running" = "running") {
    this.state = state;
    this.destination = new FakeNode(this, "destination");
  }
  private live() {
    if (this.state === "closed") throw new Error("a node made on a closed context");
  }
  createGain() {
    this.live();
    const g = Object.assign(new FakeNode(this, "gain"), { gain: new FakeParam() });
    this.gains.push(g);
    return g;
  }
  createOscillator() {
    this.live();
    return new FakeSource(this, "oscillator");
  }
  createBufferSource() {
    this.live();
    return new FakeSource(this, "bufferSource");
  }
  createBiquadFilter() {
    this.live();
    return Object.assign(new FakeNode(this, "filter"), { type: "lowpass", frequency: new FakeParam() });
  }
  createDynamicsCompressor() {
    this.live();
    return new FakeNode(this, "compressor");
  }
  createBuffer(channels: number, length: number, rate: number) {
    this.live();
    if (length < 1 || rate <= 0) throw new RangeError("a bad buffer");
    const data = new Float32Array(length);
    return { length, sampleRate: rate, numberOfChannels: channels, getChannelData: () => data };
  }
  resume() {
    this.resumes++;
    if (this.state !== "closed") this.state = "running";
    return Promise.resolve();
  }
  suspend() {
    if (this.state !== "closed") this.state = "suspended";
    return Promise.resolve();
  }
  close() {
    this.state = "closed";
    return Promise.resolve();
  }
}

/** A sound system with a fake context and a hand-driven scheduler timer. */
function rig(state: "suspended" | "running" = "running") {
  const contexts: FakeContext[] = [];
  const timers = new Map<number, () => void>();
  const stopped: number[] = [];
  let nextId = 1;
  const audio = createAudio({
    make: () => {
      const c = new FakeContext(state);
      contexts.push(c);
      return c as unknown as AudioContext;
    },
    every: (fn) => {
      const id = nextId++;
      timers.set(id, fn);
      return id;
    },
    stop: (id) => {
      stopped.push(id);
      timers.delete(id);
    },
  });
  const wakeScheduler = () => {
    for (const fn of timers.values()) fn();
  };
  return { audio, contexts, timers, stopped, wakeScheduler };
}

/** One of every cue there is. */
const EVERY_CUE: Cue[] = [
  { k: "launch", power: 1 },
  { k: "launch", power: 0.5 },
  { k: "pop", n: 1 },
  { k: "pop", n: 14 },
  { k: "cushion", speed: 1 },
  { k: "cushion", speed: 0 },
  ...["bumper", "pip", "spark", "bell", "coin", "heavy"].map((charm): Cue => ({ k: "plate", charm })),
  { k: "land" },
  { k: "pip" },
  { k: "nope" },
  { k: "announce" },
  { k: "patter", n: 9 },
  { k: "hurt" },
  { k: "battery", late: false },
  { k: "battery", late: true },
  { k: "blast" },
  { k: "chime" },
  { k: "hour" },
  { k: "morning" },
  { k: "lights" },
  { k: "flick" },
  { k: "hit", kind: "polisher" },
  { k: "hit", kind: "gum" },
  { k: "hit", kind: "bag" },
  { k: "knock" },
  { k: "down" },
  { k: "throw" },
];

const sounded = (c: FakeContext) => c.sources.length;

describe("the sound starts with the first touch or key", () => {
  it("makes no context until unlock(), and plays nothing before it", () => {
    const { audio, contexts } = rig();
    expect(audio.started).toBe(false);
    for (const c of EVERY_CUE) audio.play(c);
    audio.setLoop(true);
    expect(contexts.length).toBe(0);
    audio.unlock();
    expect(contexts.length).toBe(1);
    expect(audio.started).toBe(true);
  });

  it("makes one context however many touches follow, and wakes one the browser put to sleep", () => {
    const { audio, contexts } = rig("suspended");
    audio.unlock();
    audio.unlock();
    audio.unlock();
    expect(contexts.length).toBe(1);
    expect(contexts[0].resumes).toBeGreaterThan(0);
    expect(contexts[0].state).toBe("running");
    audio.sleep();
    expect(contexts[0].state).toBe("suspended");
    audio.wake();
    expect(contexts[0].state).toBe("running");
  });

  it("plays on in silence where there is no sound to be had", () => {
    const none = createAudio({ make: () => null, every: () => 1, stop: () => {} });
    none.unlock();
    expect(none.started).toBe(false);
    expect(() => EVERY_CUE.forEach((c) => none.play(c))).not.toThrow();
    const broken = createAudio({
      make: () => {
        throw new Error("no audio here");
      },
      every: () => 1,
      stop: () => {},
    });
    expect(() => broken.unlock()).not.toThrow();
    expect(broken.started).toBe(false);
  });
});

describe("every cue", () => {
  it("plays without an error a real context would raise, through the master level", () => {
    const { audio, contexts } = rig();
    audio.unlock();
    const c = contexts[0];
    for (const cue of EVERY_CUE) {
      const before = sounded(c);
      expect(() => audio.play(cue), cue.k).not.toThrow();
      expect(sounded(c), cue.k).toBeGreaterThan(before);
      // Let the voices end, as the context would, so the cap does not silence the next cue.
      for (const s of c.sources) s.onended?.();
      c.currentTime += 1;
    }
  });

  it("keeps to a cap of voices however much happens in one tick", () => {
    const { audio, contexts } = rig();
    audio.unlock();
    for (let i = 0; i < 200; i++) audio.play({ k: "pop", n: 1 + (i % 10) });
    expect(sounded(contexts[0])).toBeLessThanOrEqual(20);
  });
});

describe("M mutes", () => {
  it("muted, nothing is played and the master level goes to zero; unmuted, it comes back", () => {
    const { audio, contexts } = rig();
    audio.unlock();
    const c = contexts[0];
    audio.setMuted(true);
    expect(audio.muted).toBe(true);
    const master = c.gains[0];
    expect(master.gain.value).toBe(0);
    for (const cue of EVERY_CUE) audio.play(cue);
    expect(sounded(c)).toBe(0);
    audio.setMuted(false);
    expect(master.gain.value).toBeGreaterThan(0);
    audio.play({ k: "land" });
    expect(sounded(c)).toBeGreaterThan(0);
  });

  it("a mute before the first touch holds once the sound starts", () => {
    const { audio, contexts } = rig();
    audio.setMuted(true);
    audio.unlock();
    expect(contexts[0].gains[0].gain.value).toBe(0);
    audio.play({ k: "launch", power: 1 });
    expect(sounded(contexts[0])).toBe(0);
  });
});

describe("the polisher's loop", () => {
  it("is laid ahead on the context's clock while it is on, and stops when it is off or muted", () => {
    const { audio, contexts, wakeScheduler } = rig();
    audio.unlock();
    const c = contexts[0];
    wakeScheduler();
    expect(sounded(c)).toBe(0);
    audio.setLoop(true);
    wakeScheduler();
    const laid = sounded(c);
    expect(laid).toBeGreaterThan(0);
    // Every step is in the future, at most a quarter of a second ahead.
    for (const s of c.sources) {
      expect(s.started).toBeGreaterThanOrEqual(c.currentTime);
      expect(s.started).toBeLessThanOrEqual(c.currentTime + 0.3);
    }
    // Nothing more until the clock moves on.
    wakeScheduler();
    expect(sounded(c)).toBe(laid);
    c.currentTime += 0.5;
    wakeScheduler();
    expect(sounded(c)).toBeGreaterThan(laid);
    const on = sounded(c);
    audio.setLoop(false);
    c.currentTime += 1;
    wakeScheduler();
    expect(sounded(c)).toBe(on);
    audio.setLoop(true);
    audio.setMuted(true);
    c.currentTime += 1;
    wakeScheduler();
    expect(sounded(c)).toBe(on);
  });

  it("quickens as the machine speeds up", () => {
    const steps = (pace: number) => {
      const { audio, contexts, wakeScheduler } = rig();
      audio.unlock();
      audio.setLoop(true, pace);
      const c = contexts[0];
      for (let i = 0; i < 40; i++) {
        wakeScheduler();
        c.currentTime += 0.05;
        for (const s of c.sources) s.onended?.();
      }
      return c.sources.filter((s) => s.kind === "oscillator").length;
    };
    expect(steps(1.5)).toBeGreaterThan(steps(1));
  });
});

describe("everything is closed on destroy", () => {
  it("dispose() closes the context, stops the scheduler, and nothing plays or starts after it", () => {
    const { audio, contexts, timers, stopped } = rig();
    audio.unlock();
    expect(timers.size).toBe(1);
    audio.setLoop(true);
    audio.dispose();
    expect(contexts[0].state).toBe("closed");
    expect(stopped.length).toBe(1);
    expect(timers.size).toBe(0);
    expect(() => EVERY_CUE.forEach((c) => audio.play(c))).not.toThrow();
    audio.unlock();
    expect(contexts.length).toBe(1);
    expect(() => audio.dispose()).not.toThrow();
  });

  it("dispose() before the first touch makes nothing and leaves nothing", () => {
    const { audio, contexts, timers } = rig();
    audio.dispose();
    audio.unlock();
    expect(contexts.length).toBe(0);
    expect(timers.size).toBe(0);
  });
});

describe("what a night sounds like", () => {
  it("a played night from 22:00 to its end is heard without an error, and sounds most of the table", () => {
    const { audio, contexts } = rig();
    audio.unlock();
    const c = contexts[0];
    const ears = createEars();
    const cues: Cue[] = [];
    const heard = new Set<string>();
    const tune = DEFAULT_TUNE;
    runNight(4242, player("expert-takes"), tune, { hour: 3 }, (events: readonly SimEvent[], s) => {
      for (const cue of ears.hear(events, s, tune, cues)) {
        heard.add(cue.k === "plate" ? `plate ${cue.charm}` : cue.k);
        audio.play(cue);
      }
      c.currentTime += 1 / 60;
      for (const src of c.sources) src.onended?.();
      c.sources.length = 0;
    });
    for (const k of ["launch", "pop", "cushion", "land", "pip", "announce", "patter", "hour", "battery", "blast", "chime"]) {
      expect([...heard], k).toContain(k);
    }
    expect([...heard].some((k) => k.startsWith("plate "))).toBe(true);
  });

  it("hears each event of the table as its cue", () => {
    const ears = createEars();
    const out: Cue[] = [];
    const s = { phase: "night", tick: 100, things: [] } as unknown as Parameters<typeof ears.hear>[1];
    const ev = (e: object) => ({ tick: 100, x: 0, y: 0, ...e }) as SimEvent;
    const hear = (e: object) => ears.hear([ev(e)], s, DEFAULT_TUNE, out).map((c) => c.k);
    expect(hear({ type: "launch", power: 1, carry: 0 })).toEqual(["launch"]);
    expect(hear({ type: "refused" })).toEqual(["nope"]);
    expect(hear({ type: "cushion", side: "top", speed: 900, plate: 0, charm: "bumper" })).toEqual(["cushion", "plate"]);
    expect(hear({ type: "cushion", side: "top", speed: 900, plate: 1, charm: "" })).toEqual(["cushion"]);
    expect(hear({ type: "pop", n: 3, source: "body" })).toEqual(["pop"]);
    expect(hear({ type: "pop", n: 0, source: "blast" })).toEqual([]);
    expect(hear({ type: "land", dazed: 0 })).toEqual(["land"]);
    expect(hear({ type: "pip", pips: 3, why: "timer" })).toEqual(["pip"]);
    expect(hear({ type: "row", hour: 1, row: 0, how: "tick", n: 3, cut: 0 })).toEqual(["announce"]);
    expect(hear({ type: "row", hour: 1, row: 0, how: "tick", n: 0, cut: 3 })).toEqual([]);
    expect(hear({ type: "arrive", id: 1, kind: "bunny", dist: 200, dazed: false })).toEqual(["patter"]);
    expect(hear({ type: "hurt", by: "bunny", id: 1, hearts: 2, blast: false })).toEqual(["hurt"]);
    expect(hear({ type: "burst", mine: true })).toEqual(["blast"]);
    expect(hear({ type: "offerTaken", item: 0, kind: "plate", charm: "pip", plate: 3, items: [] })).toEqual(["chime"]);
    expect(hear({ type: "hour", hour: 4 })).toEqual(["hour"]);
    expect(hear({ type: "over", how: "morning", score: 1, bonus: 1 })).toEqual(["morning"]);
    expect(hear({ type: "over", how: "hearts", score: 1, bonus: 0 })).toEqual([]);
    expect(hear({ type: "tokenTurned", id: 2, vx: 1, vy: 0 })).toEqual(["flick"]);
  });

  it("a battery ticks as each flash comes on: every 20 ticks, then every 6 in its last 120", () => {
    const at: number[] = [];
    for (let left = 300; left > 0; left--) if (flashStarts(left)) at.push(left);
    const early = at.filter((l) => l > 120);
    const late = at.filter((l) => l <= 120);
    for (let i = 1; i < early.length; i++) expect(early[i - 1] - early[i]).toBe(40);
    for (let i = 1; i < late.length; i++) expect(late[i - 1] - late[i]).toBe(12);
    expect(late.length).toBeGreaterThanOrEqual(9);
  });
});
