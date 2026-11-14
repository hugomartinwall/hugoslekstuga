/**
 * The keys (§4.3): a whole night can be played without a pointer.
 *
 *   Left, Right, or A, D   turn the aim. A tap turns 3 degrees; held, it
 *                          turns at 150 degrees a second for the first
 *                          150 ms and at 420 after.
 *   Up or W                point at the nearest intruder; pressed again,
 *                          the next nearest. With no intruder in the room
 *                          it steps through the offered things.
 *   Space or Enter         launch at full power, at once.
 *
 * Esc, P and M are game.ts's. Keys are read by their place on the keyboard
 * (`code`), and only while the root has the focus: game.ts hears them on
 * the root and hands them here. Nothing here decides an outcome in the
 * simulation: a launch is handed over through `onLaunch`, like a release.
 * The one shell time that reaches the simulation is the 300 ms tail of
 * `held()`, which feeds `Input.pullHeld` (slow motion), as a thumb's pull
 * does.
 *
 * Times are the caller's clock, in ms (performance.now in the game).
 */
import { KINDS } from "../content/kinds";
import { boxOf } from "../sim/boss";
import { plateMiddle } from "../sim/charms";
import type { Launch, State } from "../sim/types";

/** A tap turns this far, degrees. */
export const TAP_DEG = 3;
/** Held, the aim turns this fast for the first `TURN_SLOW_MS`, degrees a second... */
export const TURN_SLOW_DEG_S = 150;
export const TURN_SLOW_MS = 150;
/** ...and this fast after. */
export const TURN_FAST_DEG_S = 420;
/** `held()` stays true this long after the last aim key comes up, ms. */
export const HELD_TAIL_MS = 300;

/** What a key does, by its place on the keyboard. */
export function keyRole(code: string): "left" | "right" | "point" | "launch" | null {
  switch (code) {
    case "ArrowLeft":
    case "KeyA":
      return "left";
    case "ArrowRight":
    case "KeyD":
      return "right";
    case "ArrowUp":
    case "KeyW":
      return "point";
    case "Space":
    case "Enter":
    case "NumpadEnter":
      return "launch";
    default:
      return null;
  }
}

/**
 * How far a key held for `ms` has turned the aim, degrees. A tap is 3
 * degrees however short; held, the turn is 150 degrees a second for 150
 * ms (that reaches the tap's 3 degrees at 20 ms) and 420 after.
 */
export function turnedBy(ms: number, tap = true): number {
  const t = Math.max(0, ms);
  const slow = (TURN_SLOW_DEG_S * Math.min(t, TURN_SLOW_MS)) / 1000;
  const fast = (TURN_FAST_DEG_S * Math.max(0, t - TURN_SLOW_MS)) / 1000;
  return tap ? Math.max(TAP_DEG, slow + fast) : slow + fast;
}

/** Something Up can point at: a thing in the room, an offered plate, or the polisher's plug. */
type Target = { kind: "thing"; id: number } | { kind: "plate"; plate: number } | { kind: "plug" };

/** Where a target is now, or null if it has gone. */
function whereIs(s: State, t: Target): { x: number; y: number } | null {
  if (t.kind === "thing") {
    const d = s.things.find((x) => x.id === t.id);
    return d && d.hp > 0 ? { x: d.x, y: d.y } : null;
  }
  if (t.kind === "plate") {
    return s.offer.open && s.offer.items.some((i) => i.kind === "plate" && i.plate === t.plate) ? plateMiddle(s, t.plate) : null;
  }
  const b = s.boss;
  if (!b.present || b.mode === "arriving" || b.mode === "down") return null;
  // The plug is the middle of its trailing end.
  const box = boxOf(b);
  return { x: b.dir > 0 ? box.x0 : box.x1, y: b.y };
}

/**
 * What Up steps through, nearest first: the intruders in the room (landed,
 * not yet popped); with none, the offered things (plates and pickups);
 * with none of those either, the polisher's plug. (The spec names the
 * first two; the plug is this build's, so a night's last hour can be
 * aimed on the keys too.)
 */
export function pointOrder(s: State): Target[] {
  const hx = s.him.x;
  const hy = s.him.y;
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - hx, a.y - hy) - Math.hypot(b.x - hx, b.y - hy);
  const intruders = s.things.filter((d) => d.hp > 0 && s.tick >= d.landTick && KINDS[d.kind]?.intruder === true);
  if (intruders.length > 0) return [...intruders].sort(near).map((d) => ({ kind: "thing", id: d.id }));
  if (s.offer.open) {
    const offered: Array<{ t: Target; x: number; y: number }> = [];
    for (const item of s.offer.items) {
      if (item.kind === "plate") offered.push({ t: { kind: "plate", plate: item.plate }, ...plateMiddle(s, item.plate) });
      else {
        const d = s.things.find((x) => x.id === item.thingId);
        if (d && d.hp > 0) offered.push({ t: { kind: "thing", id: d.id }, x: d.x, y: d.y });
      }
    }
    if (offered.length > 0) return offered.sort(near).map((o) => o.t);
  }
  return whereIs(s, { kind: "plug" }) ? [{ kind: "plug" }] : [];
}

export type KeysHooks = {
  /** The State the aim is taken against. */
  state(): State;
  /** Is the game taking a launch now? */
  enabled(): boolean;
  /** A launch at full power, handed over as a release is. */
  onLaunch(launch: Launch): void;
};

export type Keys = {
  /** A keydown on the root, with no Ctrl, Cmd or Alt. True if it is one of these keys (its default is then prevented). */
  down(e: { code: string; repeat: boolean }, now: number): boolean;
  /** A keyup anywhere on the page. */
  up(e: { code: string }, now: number): void;
  /** Once a frame: turn the aim for a turn key held. */
  frame(now: number): void;
  /** Is a pull held from the keys: an aim key down, or one up for less than 300 ms? */
  held(now: number): boolean;
  /** Where the keys aim, as a unit vector; null until an aim key is used, and again after a touch or a mouse press. */
  aim(): { dx: number; dy: number } | null;
  /** The aim in degrees: 0 is straight up the room, clockwise positive. */
  readonly deg: number;
  /** A touch or a mouse press: the line is hidden until an aim key is used again. */
  pressed(): void;
  /** Forget the keys that are down (the window lost focus; a pause). */
  release(now: number): void;
  /** A new night: the aim points straight up again. */
  reset(): void;
};

export function createKeys(hooks: KeysHooks): Keys {
  /** 0 is straight up the room. */
  let deg = 0;
  /** An aim key has been used since the last touch or mouse press: the line shows. */
  let shown = false;
  /** Aim keys down, by code. */
  const down = new Set<string>();
  /** When the last aim key came up; -Infinity for never. */
  let upAt = -Infinity;
  /** The turn key now turning the aim, when it began, how far it has turned, and whether its tap counts. */
  let turn: { code: string; dir: -1 | 1; since: number; done: number; tap: boolean } | null = null;
  /** What Up steps through, worked out at its first press; and the launch it belongs to. */
  let order: Target[] = [];
  let orderLaunch = -1;
  let at = -1;

  const startTurn = (code: string, dir: -1 | 1, now: number, tap: boolean) => {
    turn = { code, dir, since: now, done: 0, tap };
    advance(now);
  };
  const advance = (now: number) => {
    if (!turn) return;
    const want = turnedBy(now - turn.since, turn.tap);
    deg += turn.dir * (want - turn.done);
    turn.done = want;
    deg = ((deg % 360) + 540) % 360 - 180;
  };

  const point = () => {
    const s = hooks.state();
    // Worked out at the first press, and again after any launch.
    if (order.length === 0 || orderLaunch !== s.launch.id) {
      order = pointOrder(s);
      orderLaunch = s.launch.id;
      at = -1;
    }
    for (let tries = 0; tries < order.length; tries++) {
      at = (at + 1) % order.length;
      const p = whereIs(s, order[at]);
      if (!p) continue;
      const dx = p.x - s.him.x;
      const dy = p.y - s.him.y;
      if (Math.hypot(dx, dy) < 1e-6) continue;
      deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
      return;
    }
  };

  return {
    down(e, now) {
      const role = keyRole(e.code);
      if (role === null) return false;
      if (role === "launch") {
        // One press is one launch: a held Space spends one pip, not three.
        if (!e.repeat && hooks.enabled()) {
          const r = (deg * Math.PI) / 180;
          hooks.onLaunch({ dx: Math.sin(r), dy: -Math.cos(r), power: 1 });
        }
        return true;
      }
      // The aim keys repeat by their own rule, not the system's.
      if (e.repeat) return true;
      if (!hooks.enabled()) return true;
      down.add(e.code);
      shown = true;
      if (role === "point") point();
      else {
        advance(now);
        startTurn(e.code, role === "left" ? -1 : 1, now, true);
      }
      return true;
    },
    up(e, now) {
      if (!down.delete(e.code)) return;
      upAt = now;
      if (turn && turn.code === e.code) {
        advance(now);
        turn = null;
        // Another turn key still held takes over, without a tap of its own.
        for (const code of down) {
          const role = keyRole(code);
          if (role === "left" || role === "right") startTurn(code, role === "left" ? -1 : 1, now, false);
        }
      }
    },
    frame(now) {
      advance(now);
    },
    held(now) {
      return down.size > 0 || now - upAt < HELD_TAIL_MS;
    },
    aim() {
      if (!shown) return null;
      const r = (deg * Math.PI) / 180;
      return { dx: Math.sin(r), dy: -Math.cos(r) };
    },
    get deg() {
      return deg;
    },
    pressed() {
      shown = false;
    },
    release(now) {
      if (down.size > 0) upAt = now;
      advance(now);
      down.clear();
      turn = null;
    },
    reset() {
      deg = 0;
      order = [];
      orderLaunch = -1;
      at = -1;
      turn = null;
      down.clear();
      upAt = -Infinity;
    },
  };
}
