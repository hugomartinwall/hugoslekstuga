/**
 * A speech bubble anchored to a body in the world — Sella's introduction, and
 * the first dialogue surface in the game.
 *
 * Design constraints, all §9-shaped: the game KEEPS RUNNING (a conversation
 * is not a mode, same law as everything since the pivot), every line is one
 * short sentence, and the whole thing is skippable to zero — a player who
 * wants to walk simply walks, and the caller ends the intro when they drift
 * away.
 *
 * THE READER TURNS THE PAGE (round 5). The first contract was "any input
 * advances", and that was the bug: movement is hold-left-mouse (a
 * pointerdown) and the elements are QWEASD, so walking or composing blew
 * through three lines in under a second — the player never read a word they
 * didn't race. Only three things advance now:
 *
 *   1. tapping/clicking the BUBBLE itself (its own DOM target, so the same
 *      press cannot also move or cast — SpellInput's pointer listeners are
 *      canvas-scoped),
 *   2. the "▸ more" affordance beside "▸ skip" ("▸ done" on the last line),
 *   3. Enter (document capture, no preventDefault; verified unbound
 *      everywhere else, and Escape stays untouched — §1).
 *
 * The auto-advance timer survives only as an idle rescue (LINE_SECONDS), so
 * an abandoned bubble still ends itself.
 *
 * DOM in CSS pixels inside the safe-area-padded UI layer (§11). The bubble is
 * positioned by the CALLER each frame via `place()` — anchoring needs a
 * camera projection, and this module keeps no reference to the renderer.
 */

import { UI } from "../render/art";

const STYLE = /* css */ `
  .dlg-bubble {
    position: absolute;
    max-width: min(300px, calc(100vw - 32px));
    padding: 10px 14px 8px;
    border-radius: 12px;
    background: ${UI.panelBg};
    border: 1px solid ${UI.panelBorder};
    color: ${UI.text};
    font: 400 ${UI.type.md}px/1.35 system-ui, sans-serif;
    text-align: center;
    text-shadow: 0 1px 3px #000c;
    transform: translate(-50%, -100%);
    /* The bubble is its own touch target: tapping it turns the page, and
       because the press lands on DOM it cannot also move or cast. */
    pointer-events: auto;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    touch-action: manipulation;
    transition: opacity 160ms ease-out;
    z-index: 5;
  }
  .dlg-bubble[data-hidden="true"] { pointer-events: none; }
  .dlg-bubble[data-hidden="true"] { opacity: 0; }
  /* The tail: a small notch pointing down at the speaker. */
  .dlg-bubble::after {
    content: "";
    position: absolute;
    left: 50%;
    bottom: -7px;
    width: 12px;
    height: 12px;
    background: ${UI.panelBg};
    border-right: 1px solid ${UI.panelBorder};
    border-bottom: 1px solid ${UI.panelBorder};
    transform: translateX(-50%) rotate(45deg);
  }
  .dlg-name {
    display: block;
    font: 700 ${UI.type.xs}px/1 system-ui, sans-serif;
    letter-spacing: 0.1em;
    color: ${UI.textDim};
    margin-bottom: 5px;
    text-transform: uppercase;
  }
  /* ≥44px-wide touch targets (§11), 12px apart so a thumb cannot straddle
     them. "more" is the primary action and reads brighter than "skip". */
  .dlg-skip, .dlg-more {
    display: inline-flex;
    align-items: center;
    margin-top: 6px;
    min-width: 44px;
    /*
     * 44, not 24 (comp, R6). CLAUDE.md §11 is "touch targets >= 44 px at every
     * viewport, from day one — not as a pre-submission patch", and this one
     * measured **64x28 at all three**. The bubble itself advances on
     * pointerdown and gives the primary action a 170x95 target, so only the
     * SKIP control was under the bar — which is the kind of exception that
     * survives an audit by looking like it has already been checked.
     *
     * inline-flex with centred items rather than more padding: padding would
     * push the glyph off the bubble's baseline grid, and the bubble re-wraps
     * when a narrower safe area changes its height.
     */
    min-height: 44px;
    padding: 2px 10px;
    font: 600 ${UI.type.xs}px/1.4 system-ui, sans-serif;
    letter-spacing: 0.06em;
    cursor: pointer;
    pointer-events: auto;
    user-select: none;
    -webkit-user-select: none;
    touch-action: manipulation;
  }
  .dlg-skip { color: ${UI.textDim}; }
  .dlg-more { color: ${UI.text}; margin-left: 12px; }
`;

/**
 * Seconds a line holds before auto-advancing. Nine, not four: the reader
 * paces the conversation now (round 5 — "make the messages way slower so I
 * have time to read"), so this timer is only the rescue for an idle bubble
 * nobody is turning, not the pace anyone is expected to read at.
 */
const LINE_SECONDS = 9.0;

export class Dialogue {
  private el: HTMLDivElement;
  private nameEl: HTMLSpanElement;
  private textEl: HTMLSpanElement;
  private moreEl: HTMLSpanElement;
  private lines: string[] = [];
  private index = 0;
  private lineT = 0;
  private onDone: (() => void) | null = null;

  constructor(root: HTMLElement) {
    const style = document.createElement("style");
    style.textContent = STYLE;
    root.appendChild(style);

    this.el = document.createElement("div");
    this.el.className = "dlg-bubble";
    this.el.dataset.hidden = "true";
    this.nameEl = document.createElement("span");
    this.nameEl.className = "dlg-name";
    this.textEl = document.createElement("span");
    const skip = document.createElement("span");
    skip.className = "dlg-skip";
    skip.textContent = "▸ skip";
    // `pointerdown`, never `click` — synthetic-event drives and the rest of
    // the UI both settled on it. Stop it so the bubble's own advance handler
    // underneath does not ALSO fire.
    skip.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this.end();
    });
    this.moreEl = document.createElement("span");
    this.moreEl.className = "dlg-more";
    this.moreEl.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this.advance();
    });
    // A press anywhere on the bubble also turns the page — the whole bubble
    // is the target a reader's thumb is already resting near.
    this.el.addEventListener("pointerdown", () => this.advance());
    this.el.append(this.nameEl, this.textEl, document.createElement("br"), skip, this.moreEl);
    root.appendChild(this.el);

    // Enter turns the page — the ONE key that composes nothing, casts
    // nothing and moves nobody (verified unbound across input/). Capture
    // phase but no preventDefault/stopPropagation: dialogue reads the key,
    // it never owns it. Escape stays unbound (§1).
    document.addEventListener("keydown", this.onKey, true);
  }

  /**
   * Release the one listener this class puts outside its own root.
   *
   * Everything else Dialogue owns lives under the UI root and goes when the
   * route unmounts it — but this keydown is on `document`, so without this a
   * second mount would advance the dialogue twice per Enter.
   */
  destroy(): void {
    document.removeEventListener("keydown", this.onKey, true);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.active || e.repeat) return;
    if (e.code === "Enter" || e.code === "NumpadEnter") this.advance();
  };

  /** "▸ more" while pages remain, "▸ done" on the last one. */
  private syncMore(): void {
    this.moreEl.textContent = this.index >= this.lines.length - 1 ? "▸ done" : "▸ more";
  }

  get active(): boolean {
    return this.onDone !== null;
  }

  /** Begin a sequence. `onDone` fires exactly once, however the intro ends. */
  start(speaker: string, lines: string[], onDone: () => void): void {
    this.end();
    if (lines.length === 0) {
      onDone();
      return;
    }
    this.lines = lines;
    this.index = 0;
    this.lineT = 0;
    this.onDone = onDone;
    this.nameEl.textContent = speaker;
    this.textEl.textContent = lines[0]!;
    this.syncMore();
    this.el.dataset.hidden = "false";
  }

  /** Next line, or the end of the sequence. */
  advance(): void {
    if (!this.active) return;
    this.index++;
    this.lineT = 0;
    if (this.index >= this.lines.length) {
      this.end();
      return;
    }
    this.textEl.textContent = this.lines[this.index]!;
    this.syncMore();
  }

  /** End the whole sequence now. Safe to call when inactive. */
  end(): void {
    if (!this.active) return;
    const done = this.onDone;
    this.onDone = null;
    this.el.dataset.hidden = "true";
    done?.();
  }

  /**
   * Advance the auto-page clock. Driven by the caller's frame time so a
   * paused loop pauses the conversation with it.
   */
  tick(dt: number): void {
    if (!this.active) return;
    this.lineT += dt;
    if (this.lineT >= LINE_SECONDS) this.advance();
  }

  /**
   * Anchor the bubble at a screen position (CSS pixels, the speaker's head).
   * Clamped so the bubble never leaves the safe area.
   *
   * **The clamp is in the CONTAINING BLOCK's coordinates, not the window's.**
   * `left`/`top` on an absolutely-positioned child resolve against the padding
   * box of its offset parent — here `#ui`, whose padding IS the
   * `env(safe-area-inset-*)` band (`CLAUDE.md` §1). Clamping to
   * `window.innerWidth/Height` mixed the two spaces: the margin was measured
   * from the WINDOW edge while the box it was applied to started at the SAFE
   * edge, so on a notched viewport the bubble sat `inset − 16` px outside the
   * safe area — measured at **28.2 px over** on a 390×844 portrait with a
   * 44 px inset, and 15.8 px *inside* on the same drive at a zero inset, which
   * is what proved the clamp was window-relative rather than simply absent.
   *
   * So the bounds come from the parent's own box: `clientWidth/Height` include
   * the padding, and subtracting it on each side leaves exactly the safe
   * content area, in the same space `left`/`top` are written in.
   */
  place(x: number, y: number): void {
    if (!this.active) return;
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    // The offset parent is the positioned ancestor `left`/`top` resolve
    // against; fall back to the window only if the bubble is somehow unparented.
    const box = (this.el.offsetParent as HTMLElement | null) ?? this.el.parentElement;
    let left = 0;
    let top = 0;
    let right = window.innerWidth;
    let bottom = window.innerHeight;
    if (box) {
      const cs = getComputedStyle(box);
      const pl = parseFloat(cs.paddingLeft) || 0;
      const pt = parseFloat(cs.paddingTop) || 0;
      const pr = parseFloat(cs.paddingRight) || 0;
      const pb = parseFloat(cs.paddingBottom) || 0;
      // clientWidth/Height are content + padding, measured from the padding
      // box's origin — the same origin `left`/`top` use.
      left = pl;
      top = pt;
      right = box.clientWidth - pr;
      bottom = box.clientHeight - pb;
    }
    // `top` is the bubble's BOTTOM edge (it is translated up by its own
    // height), which is why the vertical low bound carries `h` and the high
    // bound does not.
    const cx = Math.max(left + 16 + w / 2, Math.min(right - 16 - w / 2, x));
    const cy = Math.max(top + 16 + h, Math.min(bottom - 16, y));
    this.el.style.left = `${cx}px`;
    this.el.style.top = `${cy}px`;

    // ---- second pass: correct against the RENDERED box ----
    //
    // `offsetWidth/Height` above are last frame's. The bubble re-wraps
    // whenever the line changes — and a narrower safe area makes it wrap
    // harder — so on the frame a new line appears the modelled height is the
    // OLD one and the clamp lands short by exactly the growth. That is not
    // hypothetical: the first cut of this fix clamped to `paddingTop + 16 + h`
    // and produced a bubble whose top sat at y=4 against a safe top of 44,
    // because `h` was 114 while the rendered bubble was 170 tall.
    //
    // Modelling the layout a second way would just add a second thing to get
    // stale, so measure it instead. `#ui` is `position: fixed; inset: 0`, so
    // its padding-box origin IS the viewport origin and `left`/`top` are in
    // the same coordinates `getBoundingClientRect()` reports — the correction
    // is a straight delta with no space conversion.
    const r = this.el.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (r.left < left + 16) dx = left + 16 - r.left;
    else if (r.right > right - 16) dx = right - 16 - r.right;
    if (r.top < top + 16) dy = top + 16 - r.top;
    else if (r.bottom > bottom - 16) dy = bottom - 16 - r.bottom;
    if (dx !== 0 || dy !== 0) {
      this.el.style.left = `${cx + dx}px`;
      this.el.style.top = `${cy + dy}px`;
    }
  }
}
