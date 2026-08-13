import { describe, expect, it } from "vitest";
import { cycleFocus, stepFocus, stepMenu, type NavCandidate } from "../lib/overrun/input/keyboard-nav";
import { BINDINGS, CONTROL_LINES, matches } from "../lib/overrun/input/bindings";

/** A KeyboardEvent stand-in; `matches` only reads code, key and shiftKey. */
const ev = (init: { code?: string; key?: string }) =>
  ({ code: init.code ?? "", key: init.key ?? "" }) as KeyboardEvent;

// Screen space, y down. A cross with the origin in the middle.
const CROSS: NavCandidate[] = [
  { id: 0, sx: 100, sy: 100 }, // centre
  { id: 1, sx: 100, sy: 20 }, // above
  { id: 2, sx: 100, sy: 180 }, // below
  { id: 3, sx: 20, sy: 100 }, // left
  { id: 4, sx: 180, sy: 100 }, // right
];
const centre = { sx: 100, sy: 100 };

describe("spatial navigation", () => {
  it("moves the way the player sees, in each direction", () => {
    expect(stepFocus(centre, CROSS, "up")).toBe(1);
    expect(stepFocus(centre, CROSS, "down")).toBe(2);
    expect(stepFocus(centre, CROSS, "left")).toBe(3);
    expect(stepFocus(centre, CROSS, "right")).toBe(4);
  });

  it("prefers straight ahead over nearer but off to the side", () => {
    // The lateral penalty is what makes "press right" mean what a player
    // expects rather than "nearest node that happens to be rightish".
    const cands: NavCandidate[] = [
      { id: 0, sx: 0, sy: 0 },
      { id: 1, sx: 60, sy: 0 }, // straight ahead, further
      { id: 2, sx: 30, sy: 40 }, // nearer in raw distance, well off-axis
    ];
    expect(stepFocus({ sx: 0, sy: 0 }, cands, "right")).toBe(1);
  });

  it("wraps to the far side rather than dead-ending", () => {
    // Standing on the rightmost node and pressing right must go somewhere, or
    // a keyboard player can get stuck against an edge of the board.
    const from = { sx: 180, sy: 100 };
    const got = stepFocus(from, CROSS, "right");
    expect(got).not.toBeNull();
    expect(got).toBe(3); // the furthest node in the opposite direction
  });

  it("never returns the node it started on", () => {
    for (const dir of ["up", "down", "left", "right"] as const) {
      for (const c of CROSS) {
        expect(stepFocus({ sx: c.sx, sy: c.sy }, CROSS, dir), `${c.id} ${dir}`).not.toBe(c.id);
      }
    }
  });

  it("is deterministic when two candidates tie", () => {
    const tie: NavCandidate[] = [
      { id: 7, sx: 50, sy: 0 },
      { id: 3, sx: 50, sy: 0 },
    ];
    expect(stepFocus({ sx: 0, sy: 0 }, tie, "right")).toBe(3);
    expect(stepFocus({ sx: 0, sy: 0 }, [...tie].reverse(), "right")).toBe(3);
  });

  it("handles an empty board and a null start", () => {
    expect(stepFocus(centre, [], "up")).toBeNull();
    expect(stepFocus(null, CROSS, "up")).toBe(0);
  });
});

describe("cycling", () => {
  it("walks the ring in both directions and wraps", () => {
    const ids = [3, 1, 2];
    expect(cycleFocus(1, ids, 1)).toBe(2);
    expect(cycleFocus(3, ids, 1)).toBe(1); // wraps
    expect(cycleFocus(1, ids, -1)).toBe(3); // wraps backwards
  });

  it("starts somewhere sensible from nothing", () => {
    expect(cycleFocus(null, [5, 2, 9], 1)).toBe(2);
    expect(cycleFocus(null, [5, 2, 9], -1)).toBe(9);
    expect(cycleFocus(null, [], 1)).toBeNull();
  });

  it("recovers if the current id has vanished (its node was captured)", () => {
    expect(cycleFocus(99, [1, 2], 1)).toBe(1);
  });
});

describe("menu cursor", () => {
  it("wraps at both ends", () => {
    expect(stepMenu(0, 6, -1)).toBe(5);
    expect(stepMenu(5, 6, 1)).toBe(0);
  });

  it("survives an empty menu", () => {
    expect(stepMenu(3, 0, 1)).toBe(0);
  });
});

describe("bindings", () => {
  it("uses e.code for positional keys and e.key for mnemonics", () => {
    // The rule that keeps AZERTY working: position for arrows/space/tab,
    // printed letter for P/M/U/X/C.
    expect(matches(ev({ code: "ArrowLeft" }), BINDINGS.left)).toBe(true);
    expect(matches(ev({ key: "ArrowLeft" }), BINDINGS.left)).toBe(false);
    expect(matches(ev({ key: "u" }), BINDINGS.upgrade)).toBe(true);
    expect(matches(ev({ key: "U" }), BINDINGS.upgrade)).toBe(true);
    expect(matches(ev({ code: "KeyU" }), BINDINGS.upgrade)).toBe(false);
  });

  it("binds no positional letter cluster, which is the actual AZERTY hazard", () => {
    /*
     * The hazard is a LETTER key bound by `code` — KeyW/KeyA/KeyS/KeyD send an
     * AZERTY player to the wrong physical key. Mnemonics bound by `key` are
     * layout-safe by construction, which is the whole point of the split.
     *
     * The first version of this scanned `b.keys` while its failure message
     * said "positional", so it was checking the safe list and would have
     * passed a genuine `codes: ["KeyW", ...]` binding.
     */
    const codes = Object.values(BINDINGS).flatMap((b) => [
      ...((b as { codes?: readonly string[] }).codes ?? []),
    ]);
    for (const c of codes) {
      expect(c, `${c} binds a letter positionally`).not.toMatch(/^Key[A-Z]$/);
    }
  });

  it("never leaves Escape as the only way to do something", () => {
    // Escape exits fullscreen at the browser level whatever we do, which is
    // why the portal restricts it. Anything bound to it needs a second path.
    for (const [name, b] of Object.entries(BINDINGS)) {
      const usesEscape = (b as { codes?: readonly string[] }).codes?.includes("Escape") ?? false;
      if (!usesEscape) continue;
      const others =
        ((b as { keys?: readonly string[] }).keys?.length ?? 0) +
        (((b as { codes?: readonly string[] }).codes?.length ?? 0) - 1);
      expect(others, `${name} is Escape-only`).toBeGreaterThan(0);
    }
  });

  it("documents every mnemonic it binds", () => {
    /*
     * The help card renders CONTROL_LINES verbatim, so a binding missing from
     * it is a binding no player will ever discover.
     *
     * Two faults in the first version: it used a bare `toContain` on single
     * characters, so "P" was satisfied by SPACE and "M" by FROM — deleting the
     * whole "P PAUSES · M MUTES" line still passed — and the letter list was
     * hard-coded, so a newly added mnemonic was never checked at all.
     * Word-boundary matched, and derived from BINDINGS.
     */
    const doc = CONTROL_LINES.join(" ").toUpperCase();
    const mnemonics = Object.values(BINDINGS).flatMap((b) => [
      ...((b as { keys?: readonly string[] }).keys ?? []),
    ]);
    expect(mnemonics.length).toBeGreaterThan(0);
    for (const k of mnemonics) {
      const letter = k.toUpperCase();
      expect(doc, `${letter} is bound but undocumented`).toMatch(
        new RegExp(`(^|[^A-Z])${letter}([^A-Z]|$)`),
      );
    }
    expect(doc).toContain("ARROWS");
    expect(doc).toContain("SPACE");
  });
});
