import { describe, expect, it } from "vitest";
import { SpellInput } from "../../lib/greyrot/input/spell-input";

/**
 * The input layer's device-detection rule. R1 (fun's baseline, promoted from
 * a passing trace observation to a finding): pressing a HUD control with a
 * MOUSE must not flip the scheme into touch mode. `touchMode` gates the
 * "F · " prefix on the take chip, so one stray chip click on desktop
 * permanently hid the interact key's name — exactly the kind of
 * stranger-playtest bug nobody can reproduce afterwards. Touch mode's one
 * honest source is a real touch pointer on the canvas; a DOM button cannot
 * tell a mouse from a finger and must not guess.
 *
 * SpellInput binds listeners on `window` and on the canvas at construction;
 * node has neither, so the test provides inert ones — the paths under test
 * (`pressTake`/`pressElement`/`castDown`/`castUp`/`drain`) never touch them.
 * `removeEventListener` is stubbed too, so `detach()` stays exercisable.
 */
const inertTarget = (extra: Record<string, unknown> = {}): unknown => ({
  addEventListener: (): void => {},
  removeEventListener: (): void => {},
  ...extra,
});

const construct = (): SpellInput => {
  (globalThis as { window?: unknown }).window ??= inertTarget();
  const canvas = inertTarget({
    clientWidth: 800,
    clientHeight: 450,
  }) as HTMLCanvasElement;
  return new SpellInput(canvas);
};

describe("device detection", () => {
  it("does not enter touch mode from HUD button presses", () => {
    const input = construct();
    expect(input.touchMode).toBe(false);
    input.pressTake();
    input.pressElement("fire");
    input.castDown(5); // nonzero: 0 is the "not held" sentinel
    input.castUp(1000); // past any hold threshold — the self-cast path too
    input.clearQueue();
    expect(input.touchMode, "a mouse press on a HUD control flipped the scheme to touch").toBe(
      false,
    );
  });

  it("still queues the events those buttons exist to produce", () => {
    // The guard against fixing the flip by gutting the buttons: the presses
    // must still drain as real events.
    const input = construct();
    input.pressTake();
    input.pressElement("fire");
    input.castDown(5); // nonzero: 0 is the "not held" sentinel
    input.castUp(1000);
    const drained = input.drain();
    expect(drained.some((e) => e.type === "take")).toBe(true);
    expect(drained.some((e) => e.type === "queue" && e.element === "fire")).toBe(true);
    expect(drained.some((e) => e.type === "cast" && e.form === "self")).toBe(true);
  });
});
