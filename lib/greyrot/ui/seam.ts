/**
 * The seam panels: defeat, stage clear, and camp.
 *
 * A "seam" is `CLAUDE.md` §8's word for the moments between play — the places
 * an offer is allowed to exist at all, and the whole reason the campaign is a
 * chain of short authored stages rather than free-roam. There are three shapes
 * and they share one implementation, because they share every rule that
 * matters:
 *
 * - **A rewarded offer needs an equally prominent decline** — same size, same
 *   font, same colour. Not a grey "no thanks" under a gold button. This is a
 *   submission requirement, and it is enforced structurally: every action in a
 *   panel is built by the same loop from the same `.seam-btn` rule, and there
 *   is deliberately no modifier class that could make one louder than another.
 * - **A non-ad path to the same goal must exist.** Defeat offers a revive AND a
 *   restart; the restart is always present, including when ads are off, when
 *   the player has an adblocker, and when the session cap is spent.
 * - **Never leave a rewarded button clickable with no effect.** The offer is
 *   asked before the button is built, so an unavailable slot renders nothing
 *   rather than rendering a disappointment (§8: never punish adblock users).
 * - **Between states only.** The panel is modal and covers the canvas; while it
 *   is up the game is at a seam by definition.
 *
 * ## Layout
 *
 * CSS pixels, never world units (§11). Every button is ≥ 44 px tall at every
 * viewport. The panel is `position: fixed` with safe-area padding, because the
 * CrazyGames App renders edge-to-edge and a notch will otherwise eat the
 * decline button — which is exactly the button that must never be hard to hit.
 *
 * It sits ABOVE `Hud` and `SpellHud` and deliberately covers them. That is not
 * the anchor collision §11 warns about — those two share a root and both draw
 * at once — but the scrim is `pointer-events: auto` precisely so nothing
 * underneath can be pressed through it.
 */

import { UI } from "../render/art";

export interface SeamAction {
  label: string;
  /** A second line, e.g. "watch an ad". Kept small; never a wall of text. */
  note?: string | undefined;
  onPick: () => void;
}

export interface SeamPanel {
  title: string;
  subtitle?: string | undefined;
  /** Lines of "label / value" — spores earned, mixes found. Never prose. */
  rows?: { label: string; value: string }[] | undefined;
  actions: SeamAction[];
  /**
   * Show a big number, updated by `setCountdown`.
   *
   * Deliberately NOT a `setInterval` owned by this class. The only countdown
   * in the game is the defeat window, and the sim already owns it as
   * `hero.downTicks` — a second wall-clock timer counting the same five
   * seconds would drift against it at any refresh rate, and would keep
   * counting while the loop was paused. One clock (§4), and this is a display
   * of it.
   */
  countdown?: boolean | undefined;
}

const STYLE = /* css */ `
  .seam-scrim {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    /* Edge-to-edge gameplay, inset UI (§1). */
    padding:
      max(16px, env(safe-area-inset-top))
      max(16px, env(safe-area-inset-right))
      max(16px, env(safe-area-inset-bottom))
      max(16px, env(safe-area-inset-left));
    background: #05070ba8;
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
    pointer-events: auto;
    animation: seam-in ${UI.motionMs}ms ease-out;
  }
  @keyframes seam-in { from { opacity: 0; } to { opacity: 1; } }

  .seam-card {
    width: min(420px, 100%);
    max-height: 100%;
    overflow-y: auto;
    box-sizing: border-box;
    padding: 20px;
    border-radius: 12px;
    background: ${UI.panelBg};
    border: 1px solid ${UI.panelBorder};
    color: ${UI.text};
    font: 400 ${UI.type.sm}px/1.4 system-ui, sans-serif;
    text-align: center;
  }

  .seam-title {
    font: 700 ${UI.type.xl}px/1.1 system-ui, sans-serif;
    letter-spacing: 0.06em;
    margin: 0 0 4px;
  }
  .seam-sub {
    color: ${UI.textDim};
    font-size: ${UI.type.sm}px;
    margin: 0 0 14px;
  }

  .seam-rows { margin: 0 0 16px; }
  .seam-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 2px;
    border-top: 1px solid ${UI.panelBorder};
  }
  .seam-row:last-child { border-bottom: 1px solid ${UI.panelBorder}; }
  .seam-row span:first-child { color: ${UI.textDim}; }
  .seam-row span:last-child { font-weight: 600; }

  /*
   * The actions. ONE rule set for every button in the panel — there is
   * deliberately no ".seam-btn--primary". An equally prominent decline is a
   * submission requirement, and the cheapest way to keep it true through
   * future edits is to leave no way to express the opposite.
   */
  .seam-actions { display: flex; flex-direction: column; gap: 10px; }
  .seam-btn {
    min-height: ${UI.touchTarget}px;
    padding: 10px 16px;
    border-radius: 8px;
    border: 1px solid ${UI.panelBorder};
    background: #1b2129e0;
    color: ${UI.text};
    font: 600 ${UI.type.md}px/1.2 system-ui, sans-serif;
    letter-spacing: 0.04em;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    touch-action: manipulation;
    transition: background ${UI.motionMs}ms ease-out;
  }
  .seam-btn:hover { background: #232b35e0; }
  .seam-btn .seam-note {
    display: block;
    font: 400 ${UI.type.xs}px/1.2 system-ui, sans-serif;
    color: ${UI.textDim};
    margin-top: 3px;
    letter-spacing: 0.02em;
  }

  .seam-count {
    font: 700 ${UI.type.xl}px/1 system-ui, sans-serif;
    color: ${UI.text};
    margin: 0 0 12px;
    font-variant-numeric: tabular-nums;
  }

  /* 800x450 is a supported viewport, not an edge case (§1). */
  @media (max-height: 520px) {
    .seam-card { padding: 14px; }
    .seam-title { font-size: ${UI.type.lg}px; }
    .seam-rows { margin-bottom: 10px; }
  }
`;

export class Seam {
  private root: HTMLElement;
  private scrim: HTMLDivElement | null = null;
  private countEl: HTMLDivElement | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    const style = document.createElement("style");
    style.textContent = STYLE;
    root.appendChild(style);
  }

  /** Is a seam on screen? The loop reads this to know it is between states. */
  get open(): boolean {
    return this.scrim !== null;
  }

  show(panel: SeamPanel): void {
    this.close();

    const scrim = document.createElement("div");
    scrim.className = "seam-scrim";
    // Belt and braces against a click landing on the canvas underneath.
    scrim.addEventListener("pointerdown", (e) => e.stopPropagation());

    const card = document.createElement("div");
    card.className = "seam-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-live", "polite");

    const title = document.createElement("h2");
    title.className = "seam-title";
    title.textContent = panel.title;
    card.appendChild(title);

    if (panel.subtitle) {
      const sub = document.createElement("p");
      sub.className = "seam-sub";
      sub.textContent = panel.subtitle;
      card.appendChild(sub);
    }

    if (panel.countdown) {
      this.countEl = document.createElement("div");
      this.countEl.className = "seam-count";
      this.countEl.textContent = "";
      card.appendChild(this.countEl);
    }

    if (panel.rows?.length) {
      const rows = document.createElement("div");
      rows.className = "seam-rows";
      for (const r of panel.rows) {
        const row = document.createElement("div");
        row.className = "seam-row";
        const l = document.createElement("span");
        l.textContent = r.label;
        const v = document.createElement("span");
        v.textContent = r.value;
        row.append(l, v);
        rows.appendChild(row);
      }
      card.appendChild(rows);
    }

    const actions = document.createElement("div");
    actions.className = "seam-actions";
    for (const a of panel.actions) {
      const btn = document.createElement("button");
      btn.className = "seam-btn";
      btn.appendChild(document.createTextNode(a.label));
      if (a.note) {
        const note = document.createElement("span");
        note.className = "seam-note";
        note.textContent = a.note;
        btn.appendChild(note);
      }
      // `pointerdown`, not `click`: synthetic PointerEvents drive this in the
      // headless checks, and `click` is the one that does not arrive.
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.close();
        a.onPick();
      });
      actions.appendChild(btn);
    }
    card.appendChild(actions);

    scrim.appendChild(card);
    this.root.appendChild(scrim);
    this.scrim = scrim;

  }

  /** Drive the big number from the sim's own countdown. Seconds, rounded up. */
  setCountdown(seconds: number): void {
    if (this.countEl) this.countEl.textContent = String(Math.max(0, Math.ceil(seconds)));
  }

  close(): void {
    this.scrim?.remove();
    this.scrim = null;
    this.countEl = null;
  }
}
