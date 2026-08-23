/**
 * The composition HUD.
 *
 * DOM, in CSS pixels, inside the safe-area-padded `#ui` layer, every control
 * ≥ 44 px (`CLAUDE.md` §11 and §1). No world units anywhere — game1's
 * world-unit UI broke on phones and that lesson is not relearned.
 *
 * ## The queue strip is the teaching device
 *
 * `PEDAGOGY.md` bans prose tutorials, and Magicka shipped a spellbook we are
 * not allowed to copy. So composition teaches itself by being *legible before
 * it is spent*: the strip shows the elements you have queued AND the name of
 * what they will produce, live, from the same `resolveMix` the simulation
 * calls. There is exactly one implementation, so the preview can never promise
 * a spell the cast does not deliver.
 *
 * ## The arc grows
 *
 * Power is found, not chosen (`GAME_DESIGN.md` §3.1): the campaign starts with
 * ONE lit button and the rest arrive as the road grants them. Hiding a locked
 * button here is presentation — the SIM enforces the rule (`rt/step.ts` drops
 * a queue command for a locked element) — but it is the presentation that
 * carries the first minute: one button and a cast key is the whole opening
 * screen, which is what the conversion bar wants. A found element enters with
 * a ceremony flash; the queue strip shows one slot until THE WEAVE is found.
 */

import { CASTABLES, QUEUE_MAX, type Element } from "../content";
import { ELEMENT_COLOUR, FX, UI } from "../render/art";
import { resolveMix } from "../sim/rt/spell";

/**
 * Button colours, derived from the ONE element vocabulary in `render/art.ts`.
 *
 * Previously a hand-written copy, and it had already drifted: SPORE's button
 * was dust-brown while its particles were pale yellow. A player learns "this
 * button throws that colour" in the first ten seconds.
 */
const ELEMENT_COLOUR_CSS: Record<Element, string> = Object.fromEntries(
  Object.entries(ELEMENT_COLOUR).map(([k, v]) => [k, rgb(v)]),
) as Record<Element, string>;

function rgb(c: readonly [number, number, number]): string {
  const b = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${b(c[0])},${b(c[1])},${b(c[2])})`;
}

const STYLE = /* css */ `
  .sp-root { position: absolute; inset: 0; pointer-events: none; }

  /* ---- health, top left ---- */
  .sp-hp {
    position: absolute; left: 18px; top: 16px;
    width: 190px; height: 14px; border-radius: 7px;
    background: #0006; border: 1px solid ${UI.panelBorder}; overflow: hidden;
  }
  .sp-hp i {
    display: block; height: 100%; background: linear-gradient(90deg,#8fbf5a,#d8e08a);
    transition: width 90ms linear;
  }
  .sp-stats {
    position: absolute; left: 18px; top: 36px;
    color: ${UI.textDim}; font: 500 ${UI.type.xs}px/1.5 system-ui, sans-serif;
    text-shadow: 0 1px 3px #000c; white-space: pre;
  }

  /* ---- status pips, under the health bar ---- */
  .sp-status { position: absolute; left: 18px; top: 76px; display: flex; gap: 6px; }
  .sp-pip {
    width: 22px; height: 22px; border-radius: 50%;
    border: 1px solid #0008; font: 700 9px/22px system-ui, sans-serif;
    text-align: center; color: #0b0d10;
  }

  /* ---- the queue strip: the centre of the whole design ---- */
  .sp-queue {
    position: absolute; left: 50%; bottom: 148px; transform: translateX(-50%);
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    pointer-events: none;
  }
  /* 148px is tuned for tall viewports; at 450px tall it lands the strip
   * mid-frame, on top of whatever the fight is doing (R4, fun's find). */
  @media (max-height: 560px) { .sp-queue { bottom: 96px; } }
  .sp-pips { display: flex; gap: 10px; }
  .sp-slot {
    width: 34px; height: 34px; border-radius: 9px;
    border: 2px solid #ffffff26; background: #00000059;
    transition: transform ${UI.motionMs}ms ease-out, opacity ${UI.motionMs}ms ease-out,
      background ${UI.motionMs}ms ease-out, border-color ${UI.motionMs}ms ease-out;
  }
  /* EMPTY slots go near-invisible (R4, fun's find): at 800x450 the strip
   * sits over the action and two solid dark chips read as floating world
   * artifacts — they were mistaken for a broken occluder fade in a binding
   * playtest. The affordance survives: a faint outline holds the spot, and
   * the slot snaps to full weight the moment it is filled. */
  .sp-slot:not([data-filled="true"]) { background: #00000014; border-color: #ffffff12; }
  .sp-slot[data-filled="true"] { transform: scale(1.06); }
  /* An element that will be annihilated shows as cancelled BEFORE the cast. */
  .sp-slot[data-cancelled="true"] { opacity: 0.28; filter: grayscale(1); }
  .sp-name {
    padding: 4px 14px; border-radius: 7px;
    background: ${UI.panelBg}; border: 1px solid ${UI.panelBorder};
    color: ${UI.text}; font: 700 ${UI.type.sm}px/1.2 system-ui, sans-serif;
    letter-spacing: 0.1em; text-transform: uppercase; white-space: nowrap;
  }
  .sp-name[data-fizzle="true"] { color: #9aa4b2; border-color: #ffffff22; }
  .sp-name .dmg { color: ${UI.textDim}; font-weight: 500; letter-spacing: 0.04em; }

  /* The TAKE chip: world-anchored over a find in range (main projects and
   * places it per frame). One control for both schemes — desktop reads it
   * ("F · take WATER"), touch taps it, so it is a real ≥44px button. */
  .sp-take {
    position: absolute;
    transform: translate(-50%, -100%);
    min-height: 44px;
    padding: 10px 18px;
    border-radius: 22px;
    background: ${UI.panelBg};
    border: 1px solid ${UI.panelBorder};
    color: ${UI.text};
    font: 700 ${UI.type.sm}px/1.2 system-ui, sans-serif;
    letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap;
    pointer-events: auto; cursor: pointer; touch-action: manipulation;
    user-select: none; -webkit-user-select: none;
    animation: sp-take-breathe 1.6s ease-in-out infinite;
  }
  @keyframes sp-take-breathe {
    0%, 100% { box-shadow: 0 0 0 0 #ffffff00; }
    50% { box-shadow: 0 0 14px 2px #ffffff33; }
  }

  /* The recharge track: the health-bar idiom, thin, under the queue. Visible
   * only while recharging — a full bar that never moves is noise. */
  .sp-cd {
    width: 120px; height: 5px; border-radius: 3px;
    background: #0006; border: 1px solid ${UI.panelBorder}; overflow: hidden;
    opacity: 0; transition: opacity ${UI.motionMs}ms ease-out;
  }
  .sp-cd[data-active="true"] { opacity: 1; }
  .sp-cd i { display: block; height: 100%; background: ${UI.text}; }

  /* ---- the element arc, bottom right ----
   *
   * ⚠️ THE CONTAINER IS TRANSPARENT TO POINTERS AND EACH BUTTON OPTS BACK IN.
   * "pointer-events: auto" on the GRID absorbs the grid's whole rect, and the
   * grid is three 52px columns however many buttons are lit. At boot on the
   * campaign entry only SPORE is lit, so TWO EMPTY COLUMNS AND THE GAPS ATE
   * 6032 px2 — 67% of the arc's own rect — at 1280x800, 800x450 and 390x844
   * alike (comp, R6). That area sits exactly where a right thumb rests, and a
   * touch landing a few px off a button fell into nothing instead of falling
   * through to the movement stick.
   *
   * It is the "#ui > *" blanket's defect one size down: a container claiming
   * input for space it does not draw. The arc GROWS as elements are found, so
   * the dead area is LARGEST in the opening seconds, when the player is still
   * learning where to press.
   *
   * ⚠️ AND THE COMMENT ITSELF HAD TO BE RE-TYPED: this block lives inside a
   * template literal, so the backticks the first draft used for code spans
   * ENDED THE STRING and produced seven syntax errors two lines below. Code
   * spans in here are quoted, never backticked. */
  .sp-arc {
    position: absolute; right: 14px; bottom: 14px;
    display: grid; grid-template-columns: repeat(3, 52px); gap: 8px;
    pointer-events: none;
  }
  .sp-el {
    pointer-events: auto;
    width: 52px; height: 52px; border-radius: 12px;
    border: 2px solid #ffffff2e; background: ${UI.panelBg};
    color: #0b0d10; font: 800 10px/1.1 system-ui, sans-serif;
    letter-spacing: 0.04em; cursor: pointer; touch-action: manipulation;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 2px; user-select: none; -webkit-user-select: none;
    transition: transform 70ms ease-out;
  }
  .sp-el:active { transform: scale(0.92); }
  .sp-el b { font-size: 9px; opacity: 0.55; font-weight: 700; }
  /* A found element enters with a flash — the ceremony half of the grant. */
  .sp-el-new { animation: sp-el-new 900ms ease-out; }
  @keyframes sp-el-new {
    0%   { transform: scale(0.2); box-shadow: 0 0 0 0 #ffffffcc; }
    45%  { transform: scale(1.22); box-shadow: 0 0 26px 8px #ffffff88; }
    100% { transform: scale(1); box-shadow: 0 0 0 0 #ffffff00; }
  }

  /* ---- cast, bottom right of the arc ---- */
  .sp-cast {
    position: absolute; right: 14px; bottom: 190px;
    width: 84px; height: 84px; border-radius: 50%;
    border: 2px solid ${UI.panelBorder}; background: #1b2230e0;
    color: ${UI.text}; font: 800 ${UI.type.sm}px/1.1 system-ui, sans-serif;
    letter-spacing: 0.06em; cursor: pointer; touch-action: manipulation;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    pointer-events: auto; user-select: none; -webkit-user-select: none;
    transition: transform 70ms ease-out, background ${UI.motionMs}ms ease-out;
  }
  .sp-cast:active { transform: scale(0.94); }
  .sp-cast[data-self="true"] { background: #3a2a4ee0; border-color: #c9a6ff88; }
  /* Recharging: the button says "not yet" without moving anything. */
  .sp-cast[data-cd="true"] { opacity: 0.55; }
  .sp-cast small { font-size: 9px; font-weight: 600; color: ${UI.textDim}; margin-top: 2px; }

  /*
   * Clear. Kept a full button-width clear of the arc: at 176px it clipped the
   * bottom-left element button by 10px, which on a phone is a thumb landing on
   * SPARK and wiping the queue instead.
   */
  .sp-clear {
    position: absolute; right: 232px; bottom: 14px;
    width: 44px; height: 44px; border-radius: 10px;
    border: 1px solid #ffffff22; background: ${UI.panelBg}; color: ${UI.textDim};
    font: 700 14px/1 system-ui, sans-serif; cursor: pointer;
    touch-action: manipulation; pointer-events: auto;
    user-select: none; -webkit-user-select: none;
  }

  /* ---- virtual stick, drawn where the thumb landed ---- */
  .sp-stick, .sp-knob {
    position: absolute; border-radius: 50%; pointer-events: none;
    border: 2px solid #ffffff3a;
  }
  .sp-stick { width: 108px; height: 108px; margin: -54px 0 0 -54px; }
  .sp-knob { width: 46px; height: 46px; margin: -23px 0 0 -23px; background: #ffffff2e; }

  /* ---- keyboard legend, desktop only ---- */
  .sp-legend {
    position: absolute; left: 18px; bottom: 16px;
    color: ${UI.textDim}; font: 500 ${UI.type.xs}px/1.6 system-ui, sans-serif;
    text-shadow: 0 1px 3px #000c; pointer-events: none; white-space: pre;
  }

  /* ---- foe HP bars ---- */
  /* World-anchored over each damaged foe (the caller projects and places
   * them per frame, the placeTake idiom). Shown only once hurt — a full bar
   * is noise, and the bar appearing IS hit feedback. Fill is the enemy's own
   * rot violet-grey (ART_DIRECTION §7): no status colour can be mistaken for
   * it, and red would say "blood", which belongs to Bleeding forever. */
  .sp-foehp {
    position: absolute; width: 44px; height: 5px; margin-left: -22px;
    border-radius: 3px; background: #000a; border: 1px solid #ffffff22;
    overflow: hidden; pointer-events: none;
  }
  /* The BOSS bar (fun's R4 boss-pass finding): at 44×5 the fill/track read
   * was misjudged twice at 800×450 — 249/300 read as near-empty. A boss
   * deserves a bar that cannot be misread: wider, taller, a solid track and
   * a brighter rim. Same fill colour — size and contrast carry it, not a
   * new vocabulary. */
  .sp-foehp.sp-boss {
    width: 92px; height: 9px; margin-left: -46px;
    border-radius: 4px; background: #000d; border: 1px solid #ffffff55;
  }
  .sp-foehp i {
    display: block; height: 100%;
    background: ${rgb(FX.rotSpore)};
    transition: width 90ms linear;
  }
  /* The soak-heal pulse (R4, ev.bossSoaked): the bar flashes Wet-cyan as
   * the fill jumps — a heal the bar does not announce is an invisible heal
   * (fun's binding watch-item). Wet's colour, because the heal IS water:
   * §6's one-colour-per-meaning rule says only FX.wet may claim it. */
  .sp-foehp.sp-heal { animation: sp-heal 550ms ease-out; }
  .sp-foehp.sp-heal i { animation: sp-heal-fill 550ms ease-out; }
  @keyframes sp-heal {
    0% { box-shadow: 0 0 10px 3px ${rgb(FX.wet)}; border-color: ${rgb(FX.wet)}; }
    100% { box-shadow: 0 0 0 0 transparent; }
  }
  @keyframes sp-heal-fill {
    0% { background: ${rgb(FX.wet)}; }
    100% { background: ${rgb(FX.rotSpore)}; }
  }

  /* ---- damage numbers ---- */
  /* Neutral text, never element-tinted — the impact particles already say
   * the element in the same instant at the same spot, and §6's status
   * vocabulary must not be diluted. Emphasis is SIZE: combo/chain hits step
   * up one type stop (ART_DIRECTION §7). */
  .sp-dmg {
    position: absolute; transform: translate(-50%, -100%);
    color: ${UI.text}; font: 800 ${UI.type.md}px/1 system-ui, sans-serif;
    text-shadow: 0 1px 3px #000c; pointer-events: none;
    animation: sp-dmg 900ms ease-out forwards;
  }
  .sp-dmg[data-big="true"] { font-size: ${UI.type.lg}px; }
  @keyframes sp-dmg {
    0%   { opacity: 0; margin-top: 0; }
    18%  { opacity: 1; }
    100% { opacity: 0; margin-top: -26px; }
  }

  /* ---- combo flash ---- */
  /* ---- the combo flash ----
   *
   * ⚠️ BOTTOM-ANCHORED, ABOVE THE QUEUE STRIP — it used to sit at top 24%
   * (R6, fun's binding ruling, and the anchor is the SECOND half of it; the
   * first was suppressing this flash at grants entirely, in main.ts).
   *
   * Two reasons it lives here rather than anywhere with room:
   *  - THE FLASH DESCRIBES THE QUEUE'S OUTPUT, SO IT BELONGS BESIDE THE QUEUE.
   *    The player's composition attention is already on the strip. The top band
   *    is owned (objective chip at 9%, banner reaching 33% at 800x450) and the
   *    middle band is the fight — a centre-anchored flash at ~38% lands on the
   *    foes, checked against a real 800x450 gulch frame.
   *  - bottom-anchoring INHERITS the strip's own responsive rules instead of
   *    needing a third set. Each offset below is the matching ".sp-queue"
   *    bottom plus the strip's measured height, so the two move together.
   *
   * The stack offset is marginBottom, not marginTop: a second live flash has
   * to go UP from a bottom anchor, and marginTop would have driven it down
   * into the strip it is standing on. */
  .sp-combo {
    position: absolute; left: 50%; bottom: 220px; transform: translateX(-50%);
    color: ${UI.text}; font: 800 ${UI.type.xl}px/1 system-ui, sans-serif;
    letter-spacing: 0.12em; text-shadow: 0 2px 10px #000, 0 0 24px currentColor;
    animation: sp-combo 900ms ease-out forwards; pointer-events: none;
  }
  @keyframes sp-combo {
    0%   { opacity: 0; transform: translateX(-50%) scale(0.8); }
    18%  { opacity: 1; transform: translateX(-50%) scale(1.06); }
    100% { opacity: 0; transform: translateX(-50%) scale(1.12) translateY(-18px); }
  }
  /* Tracks ".sp-queue"'s own short-viewport rule (96px) — see the note above. */
  @media (max-height: 560px) { .sp-combo { bottom: 168px; } }

  /* Portrait phones: the arc keeps its size, everything else gets out of
     the way. 6 x 52px + gaps = 180px against a 390px viewport. */
  @media (max-width: 520px) {
    .sp-legend { display: none; }
    .sp-queue { bottom: 210px; }
    .sp-combo { bottom: 282px; }
    .sp-cast { bottom: 200px; width: 76px; height: 76px; }
    /* Above the arc rather than beside it — 390px has no room to the left. */
    .sp-clear { right: 18px; bottom: 290px; }
  }
`;

export interface SpellHudHandlers {
  onElement(e: Element): void;
  onCastDown(): void;
  onCastUp(): void;
  onClear(): void;
  /** The world-anchored TAKE chip was tapped (touch's press-F). */
  onTake(): void;
}

export class SpellHud {
  private root: HTMLDivElement;
  private hpFill: HTMLElement;
  private statsEl: HTMLElement;
  private statusEl: HTMLElement;
  private pipsEl: HTMLElement;
  private nameEl: HTMLElement;
  private cdEl: HTMLElement;
  private cdFill: HTMLElement;
  private lastRecharge = 1;
  private takeEl!: HTMLButtonElement;
  private lastTake: string | null = null;
  private castBtn: HTMLButtonElement;
  private stickEl: HTMLElement;
  private knobEl: HTMLElement;
  private slots: HTMLElement[] = [];
  private elementBtns = new Map<Element, HTMLButtonElement>();
  private shown = new Set<Element>();
  /** Foe HP bars, keyed by foe id, with the last values for the early-out. */
  private foeBars = new Map<number, { el: HTMLElement; fill: HTMLElement; x: number; y: number; frac: number }>();
  /** Fixed pool of damage-number spans, reused round-robin. */
  private dmgPool: HTMLElement[] = [];
  private dmgIdx = 0;

  constructor(parent: HTMLElement, handlers: SpellHudHandlers) {
    const style = document.createElement("style");
    style.textContent = STYLE;
    parent.appendChild(style);

    this.root = document.createElement("div");
    this.root.className = "sp-root";
    parent.appendChild(this.root);

    const hp = document.createElement("div");
    hp.className = "sp-hp";
    this.hpFill = document.createElement("i");
    hp.appendChild(this.hpFill);
    this.root.appendChild(hp);

    this.statsEl = document.createElement("div");
    this.statsEl.className = "sp-stats";
    this.root.appendChild(this.statsEl);

    this.statusEl = document.createElement("div");
    this.statusEl.className = "sp-status";
    this.root.appendChild(this.statusEl);

    /* ------------------------------------------------------- queue strip */
    const queue = document.createElement("div");
    queue.className = "sp-queue";
    this.pipsEl = document.createElement("div");
    this.pipsEl.className = "sp-pips";
    for (let i = 0; i < QUEUE_MAX; i++) {
      const slot = document.createElement("div");
      slot.className = "sp-slot";
      this.slots.push(slot);
      this.pipsEl.appendChild(slot);
    }
    this.nameEl = document.createElement("div");
    this.nameEl.className = "sp-name";
    this.cdEl = document.createElement("div");
    this.cdEl.className = "sp-cd";
    this.cdFill = document.createElement("i");
    this.cdEl.appendChild(this.cdFill);
    queue.appendChild(this.pipsEl);
    queue.appendChild(this.nameEl);
    queue.appendChild(this.cdEl);
    this.root.appendChild(queue);

    /* -------------------------------------------------------- element arc */
    const arc = document.createElement("div");
    arc.className = "sp-arc";
    for (const c of CASTABLES) {
      const b = document.createElement("button");
      b.className = "sp-el";
      b.style.background = ELEMENT_COLOUR_CSS[c.element];
      b.innerHTML = `<span>${c.label}</span><b>${c.legend}</b>`;
      b.setAttribute("aria-label", c.label);
      // pointerdown, not click: an element must queue on press. Waiting for
      // the release costs ~80 ms of a system whose whole point is speed.
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        handlers.onElement(c.element);
      });
      // Hidden at construction, inline — not via setUnlocked([]), whose
      // no-change early-out matches the initial empty set and does nothing.
      // Without this the full arc flashes on screen for the whole quality
      // probe before the first frame reveals the real unlock state.
      b.style.display = "none";
      this.elementBtns.set(c.element, b);
      arc.appendChild(b);
    }
    this.root.appendChild(arc);

    this.castBtn = document.createElement("button");
    this.castBtn.className = "sp-cast";
    this.castBtn.innerHTML = `CAST<small>hold = self</small>`;
    this.castBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      handlers.onCastDown();
    });
    for (const evt of ["pointerup", "pointercancel", "pointerleave"] as const) {
      this.castBtn.addEventListener(evt, () => handlers.onCastUp());
    }
    this.root.appendChild(this.castBtn);

    this.takeEl = document.createElement("button");
    this.takeEl.className = "sp-take";
    this.takeEl.style.display = "none";
    this.takeEl.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      handlers.onTake();
    });
    this.root.appendChild(this.takeEl);

    const clear = document.createElement("button");
    clear.className = "sp-clear";
    clear.textContent = "✕";
    clear.setAttribute("aria-label", "Clear queue");
    clear.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      handlers.onClear();
    });
    this.root.appendChild(clear);

    /* ------------------------------------------------------ virtual stick */
    this.stickEl = document.createElement("div");
    this.stickEl.className = "sp-stick";
    this.knobEl = document.createElement("div");
    this.knobEl.className = "sp-knob";
    this.stickEl.style.display = "none";
    this.knobEl.style.display = "none";
    this.root.appendChild(this.stickEl);
    this.root.appendChild(this.knobEl);

    const legend = document.createElement("div");
    legend.className = "sp-legend";
    legend.textContent =
      "Q W E / A S D  compose      SPACE  cast ahead      SHIFT+SPACE  self\n" +
      "hold LEFT MOUSE  move       X  clear      F  take";
    this.root.appendChild(legend);
  }

  /** Rebuild the queue preview. Called only when the queue actually changed. */
  setQueue(queue: readonly Element[]): void {
    // No greyed pips any more: cancellation is retired, every mix is a spell,
    // and the strip's whole job is naming what THIS hand will produce.
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      const el = queue[i];
      if (!el) {
        // No inline colour: the stylesheet's near-invisible empty style
        // applies (R4, fun's find — an inline "#0000005a" here was
        // overriding it and kept the empty chip solid mid-frame).
        slot.style.background = "";
        slot.dataset.filled = "false";
        continue;
      }
      slot.style.background = ELEMENT_COLOUR_CSS[el];
      slot.dataset.filled = "true";
    }

    if (queue.length === 0) {
      this.nameEl.textContent = "";
      this.nameEl.style.visibility = "hidden";
      return;
    }
    const spell = resolveMix(queue, "aimed");
    this.nameEl.style.visibility = "visible";
    this.nameEl.innerHTML = `${spell.name} <span class='dmg'>${spell.damage}</span>`;
  }

  setHealth(hp: number, maxHp: number): void {
    this.hpFill.style.width = `${Math.max(0, (hp / maxHp) * 100)}%`;
  }

  /**
   * The TAKE chip: `null` hides it, a label shows it. The caller anchors it
   * with `placeTake` each frame — the chip belongs to a world position.
   */
  setTake(label: string | null): void {
    if (label === this.lastTake) return;
    this.lastTake = label;
    this.takeEl.style.display = label === null ? "none" : "";
    if (label !== null) this.takeEl.textContent = label;
  }

  /** Anchor the TAKE chip at a screen position (CSS px), safe-area clamped. */
  placeTake(x: number, y: number): void {
    if (this.lastTake === null) return;
    const w = this.takeEl.offsetWidth;
    const h = this.takeEl.offsetHeight;
    const cx = Math.max(16 + w / 2, Math.min(window.innerWidth - 16 - w / 2, x));
    const cy = Math.max(16 + h, Math.min(window.innerHeight - 16, y));
    this.takeEl.style.left = `${cx}px`;
    this.takeEl.style.top = `${cy}px`;
  }

  /**
   * The cast recharge, 0..1 where 1 is ready. The track only shows while
   * recharging; the CAST button dims with it. Early-outs on no change so the
   * per-frame call is free when idle.
   */
  setRecharge(frac: number): void {
    const active = frac < 1;
    if (frac === this.lastRecharge) return;
    this.lastRecharge = frac;
    this.cdEl.dataset.active = String(active);
    this.castBtn.dataset.cd = String(active);
    this.cdFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  }

  setStatuses(ids: readonly string[]): void {
    if (this.statusEl.childElementCount === ids.length &&
        this.statusEl.dataset.ids === ids.join(",")) {
      return;
    }
    this.statusEl.dataset.ids = ids.join(",");
    this.statusEl.replaceChildren();
    for (const id of ids) {
      const pip = document.createElement("div");
      pip.className = "sp-pip";
      pip.textContent = id.slice(0, 2).toUpperCase();
      pip.style.background = ELEMENT_COLOUR_CSS[statusColourKey(id)] ?? "#888";
      this.statusEl.appendChild(pip);
    }
  }

  setStats(text: string): void {
    this.statsEl.textContent = text;
  }

  /**
   * Show exactly the elements the player has FOUND, and ceremony in the new.
   *
   * Called every frame with `state.unlocked`; cheap because it early-outs on
   * an unchanged set. A button appearing IS the reward moment (§11: juice for
   * the player's successes), so a newly shown element flashes.
   */
  setUnlocked(unlocked: readonly Element[]): void {
    if (unlocked.length === this.shown.size && unlocked.every((e) => this.shown.has(e))) {
      return;
    }
    for (const [element, btn] of this.elementBtns) {
      const on = unlocked.includes(element);
      const wasOn = this.shown.has(element);
      btn.style.display = on ? "" : "none";
      if (on && !wasOn && this.shown.size > 0) {
        // `shown.size > 0` guard: the boot call that reveals the starting
        // element (or the sandbox's all six) is state, not a ceremony.
        btn.classList.remove("sp-el-new");
        void btn.offsetWidth; // restart the animation
        btn.classList.add("sp-el-new");
      }
    }
    this.shown = new Set(unlocked);
  }

  /** How many elements one cast may hold — 1 until THE WEAVE is found. */
  setQueueMax(n: number): void {
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i]!.style.display = i < n ? "" : "none";
    }
  }

  /** Highlight CAST while a hold has passed the self-cast threshold. */
  setCastSelf(self: boolean): void {
    this.castBtn.dataset.self = String(self);
  }

  setStick(v: { ox: number; oy: number; kx: number; ky: number } | null): void {
    if (!v) {
      this.stickEl.style.display = "none";
      this.knobEl.style.display = "none";
      return;
    }
    this.stickEl.style.display = "";
    this.knobEl.style.display = "";
    this.stickEl.style.left = `${v.ox}px`;
    this.stickEl.style.top = `${v.oy}px`;
    this.knobEl.style.left = `${v.kx}px`;
    this.knobEl.style.top = `${v.ky}px`;
  }

  /**
   * Foe HP bars — screen-space CSS px in, exactly like `placeTake`, so the
   * HUD stays camera-free and three-free (the retired turn-build version
   * imported Vector3 into the UI layer; this one does not). Pool keyed by
   * foe id; show only when hurt; reap ids that vanished; per-bar early-out
   * on unchanged values so the per-frame call is free when nothing moves.
   */
  updateFoeBars(
    bars: readonly { id: number; x: number; y: number; frac: number; boss?: boolean }[],
  ): void {
    for (const b of bars) {
      let e = this.foeBars.get(b.id);
      if (!e) {
        const el = document.createElement("div");
        el.className = b.boss ? "sp-foehp sp-boss" : "sp-foehp";
        const fill = document.createElement("i");
        el.appendChild(fill);
        this.root.appendChild(el);
        e = { el, fill, x: NaN, y: NaN, frac: NaN };
        this.foeBars.set(b.id, e);
      }
      if (b.x !== e.x || b.y !== e.y) {
        e.el.style.left = `${b.x}px`;
        e.el.style.top = `${b.y}px`;
        e.x = b.x;
        e.y = b.y;
      }
      if (b.frac !== e.frac) {
        e.fill.style.width = `${Math.max(0, Math.min(1, b.frac)) * 100}%`;
        e.frac = b.frac;
      }
    }
    for (const [id, e] of this.foeBars) {
      if (!bars.some((b) => b.id === id)) {
        e.el.remove();
        this.foeBars.delete(id);
      }
    }
  }

  /**
   * Flash one foe's bar with the Wet heal pulse (`ev.bossSoaked`, R4). The
   * fill jump alone is ambiguous with projection jitter at 44 px; the cyan
   * flash names the cause. No-op while the foe is unhurt (a full-hp beat
   * heals nothing and shows no bar).
   */
  pulseFoeBar(id: number): void {
    const e = this.foeBars.get(id);
    if (!e) return;
    e.el.classList.remove("sp-heal");
    void e.el.offsetWidth; // restart the animation — the sp-el-new idiom
    e.el.classList.add("sp-heal");
  }

  /**
   * A damage number, at a screen position projected ONCE by the caller — a
   * 900 ms transient does not need to track a body. `big` is the combo/chain
   * emphasis (size, never colour — ART_DIRECTION §7). Fixed pool, restarted
   * via the `sp-el-new` idiom; ±6 px jitter so a chain's burst doesn't stack
   * into one unreadable glyph (presentation-side randomness is legal here).
   */
  spawnDamage(x: number, y: number, amount: number, big: boolean): void {
    let el = this.dmgPool[this.dmgIdx];
    if (!el) {
      el = document.createElement("div");
      this.dmgPool[this.dmgIdx] = el;
      this.root.appendChild(el);
    }
    this.dmgIdx = (this.dmgIdx + 1) % 16;
    el.className = "";
    void el.offsetWidth; // restart the animation
    el.className = "sp-dmg";
    el.dataset.big = String(big);
    el.textContent = String(Math.round(amount));
    el.style.left = `${x + (Math.random() * 12 - 6)}px`;
    el.style.top = `${y}px`;
  }

  /**
   * A combo landed. Big, brief, and gone. Concurrent flashes stack downward
   * — "NEW MIX" and "Chain!" can land on the same tick, and overlapped they
   * read as neither (seen in the round-5 well capture as "NChain!X").
   */
  flashCombo(label: string, colour: string): void {
    const el = document.createElement("div");
    el.className = "sp-combo";
    el.textContent = label;
    el.style.color = colour;
    const live = this.root.querySelectorAll(".sp-combo").length;
    // UP, not down: the element is bottom-anchored now, so a second live flash
    // stacks away from the queue strip rather than onto it.
    el.style.marginBottom = `${live * 34}px`;
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }
}

/** Map a status id onto the element whose colour it shares. */
function statusColourKey(id: string): Element {
  switch (id) {
    case "burning":
      return "fire";
    case "wet":
      return "water";
    case "frozen":
      return "frost";
    case "shocked":
      return "lightning";
    case "oiled":
      return "oil";
    default:
      return "spore";
  }
}
