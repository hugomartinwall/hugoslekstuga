import { vi } from "vitest";
import type { StorageLike } from "../../lib/knuff/save";

/**
 * A stand-in for the browser, just enough to make and drive the whole
 * game (lib/knuff/game.ts) under Node: a window and a document that are
 * plain EventTargets, a root and a canvas whose drawing calls do nothing,
 * two storages, a frame clock the test turns by hand, and `performance.now`
 * on the same clock. Events are plain Events with the fields a pointer or a
 * key event carries.
 *
 * What a real browser adds on top (real touches, real keys, the picture)
 * is checked in Chromium through the one-file builds.
 */

/** A storage that keeps what it is given, as the browser's does. */
export class MemoryStorage implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  keys(): string[] {
    return [...this.map.keys()].sort();
  }
}

/** A storage that refuses everything, as a private window's or a sandboxed frame's can. */
export class ThrowingStorage implements StorageLike {
  calls = 0;
  getItem(): string | null {
    this.calls++;
    throw new Error("SecurityError: storage is blocked");
  }
  setItem(): void {
    this.calls++;
    throw new Error("QuotaExceededError");
  }
  removeItem(): void {
    this.calls++;
    throw new Error("SecurityError: storage is blocked");
  }
}

/** A 2D context that takes every call and draws nothing. */
function fakeContext(canvas: unknown): CanvasRenderingContext2D {
  const props: Record<string | symbol, unknown> = { canvas, globalAlpha: 1, lineWidth: 1, font: "10px sans-serif", fillStyle: "#000", strokeStyle: "#000" };
  const noop = () => undefined;
  return new Proxy(props, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "measureText") return (text: string) => ({ width: String(text).length * 8 });
      if (key === "createPattern") return () => ({});
      if (key === "getImageData") return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)) });
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop: noop });
      return noop;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function fakeCanvas(): HTMLCanvasElement {
  const c: Record<string, unknown> = { width: 300, height: 150 };
  const ctx = fakeContext(c);
  c.getContext = () => ctx;
  c.getBoundingClientRect = () => ({ left: 0, top: 0, right: c.width, bottom: c.height, width: c.width, height: c.height });
  return c as unknown as HTMLCanvasElement;
}

/** The game's root: a plain EventTarget with a size, the focus and pointer capture. */
export class FakeRoot extends EventTarget {
  clientWidth: number;
  clientHeight: number;
  focused = 0;
  constructor(w: number, h: number) {
    super();
    this.clientWidth = w;
    this.clientHeight = h;
  }
  focus(): void {
    this.focused++;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight, x: 0, y: 0 };
  }
  setPointerCapture(): void {}
  releasePointerCapture(): void {}
}

export type Browser = {
  win: EventTarget & Record<string, unknown>;
  doc: EventTarget & Record<string, unknown>;
  root: FakeRoot;
  canvas: HTMLCanvasElement;
  local: StorageLike | null;
  session: StorageLike | null;
  /** The frame clock, ms; `performance.now` reads it. */
  now(): number;
  /** Let `ms` pass and draw one frame, if one was asked for. */
  frame(ms?: number): void;
  /** Draw `n` frames, `ms` apart. */
  frames(n: number, ms?: number): void;
  /** Let time pass with no frame (a timer may fire). */
  wait(ms: number): void;
  /** A pointer event on the root. */
  pointer(type: string, init: Partial<PointerEventInit> & { clientX: number; clientY: number }): Event;
  /** A key event on `target` (the root by default). */
  key(type: "keydown" | "keyup", init: { key: string; code: string; repeat?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }, target?: EventTarget): Event;
  /** The window events the game sent, by type. */
  sent: string[];
  /** Take the stand-in away. */
  restore(): void;
};

/**
 * Put a browser in place. `local` and `session` are the storages the
 * window answers with; "throw" makes reaching them throw, as a sandboxed
 * frame does. `coarse` is a phone.
 */
export function installBrowser(
  opts: { w?: number; h?: number; coarse?: boolean; local?: StorageLike | "throw" | null; session?: StorageLike | "throw" | null } = {},
): Browser {
  const w = opts.w ?? 390;
  const h = opts.h ?? 664;
  const coarse = opts.coarse ?? true;
  let clock = 1000;
  let pending: FrameRequestCallback | null = null;
  let rafId = 0;
  const timers: Array<{ id: number; at: number; fn: () => void; every: number }> = [];
  let timerId = 0;
  const sent: string[] = [];

  const win = new EventTarget() as EventTarget & Record<string, unknown>;
  const reach = (s: StorageLike | "throw" | null | undefined) => () => {
    if (s === "throw") throw new Error("SecurityError: the frame has no storage");
    return s ?? null;
  };
  Object.defineProperty(win, "localStorage", { get: reach(opts.local) });
  Object.defineProperty(win, "sessionStorage", { get: reach(opts.session) });
  win.devicePixelRatio = 2;
  win.innerWidth = w;
  win.innerHeight = h;
  const media = (query: string) => ({
    matches: query.includes("coarse") ? coarse : query.includes("fine") ? !coarse : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  });
  win.matchMedia = media;
  const addTimer = (fn: () => void, ms: number, every: boolean) => {
    const id = ++timerId;
    timers.push({ id, at: clock + Math.max(0, ms), fn, every: every ? Math.max(1, ms) : 0 });
    return id;
  };
  const dropTimer = (id: number) => {
    const i = timers.findIndex((t) => t.id === id);
    if (i >= 0) timers.splice(i, 1);
  };
  win.setTimeout = (fn: () => void, ms = 0) => addTimer(fn, ms, false);
  win.clearTimeout = dropTimer;
  win.setInterval = (fn: () => void, ms = 0) => addTimer(fn, ms, true);
  win.clearInterval = dropTimer;
  const dispatch = win.dispatchEvent.bind(win);
  win.dispatchEvent = (e: Event) => {
    sent.push(e.type);
    return dispatch(e);
  };

  const doc = new EventTarget() as EventTarget & Record<string, unknown>;
  doc.hidden = false;
  doc.visibilityState = "visible";
  doc.documentElement = {};
  doc.createElement = () => fakeCanvas();

  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "", fontFamily: "" }));
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    pending = cb;
    return ++rafId;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    pending = null;
  });
  const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);

  const runTimers = () => {
    for (;;) {
      const due = timers.filter((t) => t.at <= clock).sort((a, b) => a.at - b.at)[0];
      if (!due) return;
      if (due.every) due.at += due.every;
      else dropTimer(due.id);
      due.fn();
    }
  };

  const root = new FakeRoot(w, h);
  const canvas = fakeCanvas();

  const b: Browser = {
    win,
    doc,
    root,
    canvas,
    local: opts.local === "throw" ? null : (opts.local ?? null),
    session: opts.session === "throw" ? null : (opts.session ?? null),
    now: () => clock,
    frame(ms = 1000 / 60) {
      clock += ms;
      runTimers();
      const cb = pending;
      pending = null;
      cb?.(clock);
    },
    frames(n, ms = 1000 / 60) {
      for (let i = 0; i < n; i++) b.frame(ms);
    },
    wait(ms) {
      clock += ms;
      runTimers();
    },
    pointer(type, init) {
      const e = new Event(type, { cancelable: true, bubbles: true });
      Object.assign(e, { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1, ...init });
      root.dispatchEvent(e);
      return e;
    },
    key(type, init, target = root) {
      const e = new Event(type, { cancelable: true, bubbles: true });
      Object.assign(e, { repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init });
      target.dispatchEvent(e);
      return e;
    },
    sent,
    restore() {
      nowSpy.mockRestore();
      vi.unstubAllGlobals();
    },
  };
  return b;
}

/** The fonts the game is handed: any three names do under Node. */
export const FONTS = { display: "display", pixel: "pixel", sans: "sans" };

/** A pull on the root: down at (x, y), back by (dx, dy) over a few moves, and up. */
export function pull(b: Browser, x: number, y: number, dx: number, dy: number, pointerType = "touch"): void {
  b.pointer("pointerdown", { clientX: x, clientY: y, pointerType });
  for (let i = 1; i <= 4; i++) {
    b.wait(16);
    b.pointer("pointermove", { clientX: x + (dx * i) / 4, clientY: y + (dy * i) / 4, pointerType });
  }
  b.pointer("pointerup", { clientX: x + dx, clientY: y + dy, pointerType });
}
