/**
 * The exploration HUD.
 *
 * DOM, not canvas (`CLAUDE.md` §11): authored in CSS pixels, inside the
 * safe-area-padded `#ui` layer, touch targets ≥ 44 px.
 *
 * Deliberately almost empty. Walking around is not a mode that needs a
 * dashboard — it needs to look like a place. Everything the player acts on
 * lives in the combat HUD (`combat-hud.ts`), which takes the screen for the
 * duration of a fight and gives it back afterwards.
 *
 * The STRIKE button, hero HP bar, world-projected enemy bars and the
 * two-option equip panel that used to live here belonged to the retired
 * real-time design and went with it.
 */

import { UI } from "../render/art";

const STYLE = /* css */ `
  /*
   * Spores carried. Sits BELOW the spell HUD's health bar, which owns the same
   * corner — measured in a browser at 1280x800, where the two were drawn
   * exactly on top of each other and the count was invisible. Two HUD objects
   * sharing a root need their anchors checked, not assumed.
   */
  .hud-loot {
    position: absolute;
    left: 22px;
    top: 40px;
    color: ${UI.text};
    font: 600 ${UI.type.sm}px/1 system-ui, sans-serif;
    letter-spacing: 0.04em;
    text-shadow: 0 1px 3px #000c;
    pointer-events: none;
  }

  /* Mute. ≥44px, top-right, clear of the safe area and of the queue. */
  .hud-mute {
    position: absolute;
    /*
     * The one #ui descendant that has to ask for its own hit-testing. Every
     * other interactive element in the HUD already declared auto; this one was
     * living on the blanket "#ui > *" rule that index.html carried, and that
     * rule was shielding the whole canvas (comp, R6). Deleting it costs exactly
     * this line.
     */
    pointer-events: auto;
    right: 16px;
    top: 14px;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 1px solid ${UI.panelBorder};
    background: ${UI.panelBg};
    color: ${UI.text};
    font: 400 18px/1 system-ui, sans-serif;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    touch-action: manipulation;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity ${UI.motionMs}ms ease-out;
  }
  .hud-mute[data-muted="true"] { opacity: 0.45; }

  /*
   * Motion. Sits under the mute button and follows all of its rules, including
   * the one that matters: its own pointer-events: auto.
   *
   * Three states, not two — "auto" follows the OS, and the two explicit ones
   * override it in either direction. A player on a machine set to reduce
   * motion can still ask for the full thing.
   */
  .hud-motion {
    position: absolute;
    pointer-events: auto;
    right: 16px;
    top: 66px;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 1px solid ${UI.panelBorder};
    background: ${UI.panelBg};
    color: ${UI.text};
    font: 400 15px/1 system-ui, sans-serif;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    touch-action: manipulation;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity ${UI.motionMs}ms ease-out;
  }
  .hud-motion[data-pref="on"] { opacity: 0.45; }

  .hud-banner {
    position: absolute;
    left: 50%;
    top: 18%;
    transform: translateX(-50%);
    padding: 14px 34px;
    border-radius: 10px;
    background: ${UI.panelBg};
    border: 1px solid ${UI.panelBorder};
    color: ${UI.text};
    font: 700 ${UI.type.lg}px/1.3 system-ui, sans-serif;
    letter-spacing: 0.08em;
    text-align: center;
    text-shadow: 0 1px 3px #000c;
    animation: hud-banner 4s ease-in-out forwards;
    pointer-events: none;
    max-width: calc(100% - 48px);
  }
  .hud-banner .sub2 {
    display: block;
    font-size: ${UI.type.xs}px;
    font-weight: 400;
    color: ${UI.textDim};
    letter-spacing: 0.04em;
    margin-top: 4px;
  }
  /*
   * The SLOT (R4.5). Every banner is appended to the DOM on arrival, but only
   * the one holding the slot is visible — data-state is the whole queue.
   *
   * Membership is deliberately NOT the queue. beats-check.mjs reads
   * querySelectorAll(".hud-banner") and takes the LAST element, synchronously,
   * inside the same evaluated block as the action that fired it ("the banner's
   * removal timer cannot have fired"). A queue that withheld the element from
   * the DOM until a timer fired would have reddened the beats gate while
   * looking like a tidy fix. Visibility is the state; membership is not.
   */
  .hud-banner[data-state="queued"] { opacity: 0; animation: none; }
  .hud-banner[data-state="live"] { animation: hud-banner 4s ease-in-out forwards; }
  .hud-banner[data-state="gone"] {
    opacity: 0;
    animation: none;
    transition: opacity ${UI.motionMs}ms ease-out;
  }
  @keyframes hud-banner {
    0% { opacity: 0; transform: translateX(-50%) translateY(-8px); }
    10%, 80% { opacity: 1; transform: translateX(-50%) translateY(0); }
    100% { opacity: 0; transform: translateX(-50%) translateY(-6px); }
  }
  /* NOTE (R4): at 800x450 an active banner can graze a BOSS-height body at
   * fight framing (capture: the phase flare behind the pyre toast). Not
   * fixed with a height query — 450px has no free top band that clears both
   * the objective chip (9%) and a 2.15 m subject, and the one real-world
   * collision dies with mech's stage −1 pyre-banner filter. If a future
   * boss-room banner appears, revisit placement rather than resurrecting
   * the max-height pin that collided with the chip. */

  /*
   * The objective chip — a PERSISTENT line under the banner slot, for the one
   * thing standing between the player and the gate ("2 huts still burn").
   * Persistent because it is an objective, not a moment: a toast that
   * self-removes reads as flavour, and the gate's refusal then reads as a
   * bug. Non-interactive, so no 44 px floor applies.
   */
  .hud-objective {
    position: absolute;
    left: 50%;
    top: 9%;
    transform: translateX(-50%);
    padding: 8px 18px;
    border-radius: 8px;
    background: ${UI.panelBg};
    border: 1px solid ${UI.panelBorder};
    color: ${UI.text};
    font: 600 ${UI.type.sm}px/1.2 system-ui, sans-serif;
    letter-spacing: 0.06em;
    text-align: center;
    text-shadow: 0 1px 3px #000c;
    pointer-events: none;
    max-width: calc(100% - 48px);
    transition: opacity ${UI.motionMs}ms ease-out;
  }
  .hud-objective[data-shown="false"] { opacity: 0; }
`;

/**
 * How long a banner holds the slot before a newer one may take it. Long enough
 * to read a short title at 800×450; short enough that the queue's worst-case
 * lag on the measured opening stays under a second.
 */
const MIN_DWELL_MS = 1200;
/** Total time a banner is visible, once it HAS the slot. */
const BANNER_LIFE_MS = 4200;
/** Identical title+sub inside this window is the same beat firing twice. */
const DEDUPE_MS = 2500;

export class Hud {
  private root: HTMLElement;
  private lootEl: HTMLDivElement;
  private muteBtn: HTMLButtonElement;
  private motionBtn!: HTMLButtonElement;
  private objectiveEl: HTMLDivElement;

  /* -------------------------------------------------- the banner slot */
  /** The banner currently holding the slot, or null when it is free. */
  private liveBanner: HTMLElement | null = null;
  private liveSince = 0;
  /** Appended, not yet shown. Newest last; at most two (see showBanner). */
  private waiting: HTMLElement[] = [];
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Cancel the banner pump.
   *
   * The queue drains on chained timers, so an unmount mid-backlog leaves one
   * pending that would call back into a detached DOM.
   */
  destroy(): void {
    if (this.pumpTimer) clearTimeout(this.pumpTimer);
    this.pumpTimer = null;
  }
  private lastBannerKey = "";
  private lastBannerAt = -1e9;

  constructor(root: HTMLElement) {
    this.root = root;

    const style = document.createElement("style");
    style.textContent = STYLE;
    root.appendChild(style);

    this.lootEl = document.createElement("div");
    this.lootEl.className = "hud-loot";
    root.appendChild(this.lootEl);

    this.objectiveEl = document.createElement("div");
    this.objectiveEl.className = "hud-objective";
    this.objectiveEl.dataset.shown = "false";
    root.appendChild(this.objectiveEl);

    // The mute button stays visible in BOTH modes. A player who wants silence
    // wants it now, not after the fight — and CrazyGames plays in a browser
    // tab alongside whatever else is making noise.
    this.motionBtn = document.createElement("button");
    this.motionBtn.className = "hud-motion";
    root.appendChild(this.motionBtn);

    this.muteBtn = document.createElement("button");
    this.muteBtn.className = "hud-mute";
    this.muteBtn.textContent = "\u266A";
    this.muteBtn.setAttribute("aria-label", "Mute");
    root.appendChild(this.muteBtn);
  }

  /** Wire the mute button. The callback returns the new muted state. */
  onMuteToggle(fn: () => boolean): void {
    this.muteBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.setMuted(fn());
    });
  }

  /**
   * Wire the motion button. The callback advances the preference and returns
   * the new one, so the HUD never owns the policy — same shape as onMuteToggle.
   */
  onMotionToggle(fn: () => "auto" | "on" | "off"): void {
    this.motionBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.setMotionPref(fn());
    });
  }

  setMotionPref(pref: "auto" | "on" | "off"): void {
    this.motionBtn.dataset.pref = pref;
    this.motionBtn.textContent = pref === "auto" ? "\u25CE" : pref === "on" ? "\u25CB" : "\u25C9";
    this.motionBtn.setAttribute(
      "aria-label",
      pref === "auto" ? "Motion: follow system" : pref === "on" ? "Motion: reduced" : "Motion: full",
    );
  }

  setMuted(muted: boolean): void {
    this.muteBtn.dataset.muted = String(muted);
    this.muteBtn.textContent = muted ? "\u2715" : "\u266A";
  }

  /**
   * Show or hide the exploration furniture.
   *
   * A turn-based fight gets the combat HUD and nothing else — leaving roaming
   * chrome on screen muddles which of the two modes the player is in.
   */
  setVisible(visible: boolean): void {
    this.lootEl.style.display = visible ? "" : "none";
  }

  /** Spores carried. The only persistent number exploration shows. */
  setLoot(n: number): void {
    this.lootEl.textContent = n > 0 ? `✦ ${n}` : "";
  }

  /**
   * The persistent objective line ("2 huts still burn — cast WATER"), or null
   * to hide it. Driven per frame from live state, so it counts down on its
   * own and vanishes the moment the last condition clears.
   */
  setObjective(text: string | null): void {
    if (text) this.objectiveEl.textContent = text;
    this.objectiveEl.dataset.shown = String(text !== null);
  }

  /**
   * A transient centre banner (quest beats, joins). Removes itself.
   *
   * **One at a time, and each one readable.** The anchor is fixed
   * (`left:50%; top:18%`) and `UI.panelBg` is 85% opaque, so two live banners
   * superimpose and ghost through one another. comp measured the shipped
   * opening: "The grey gives way" → "The Rot Road — clear" 0.70 s later →
   * "WATER found" 0.83 s after that, three elements alive at tick 194, all at
   * the same `top`, both at full opacity for ~2.4 s of the overlap — inside the
   * window §9 says the 80% conversion bar is decided in.
   *
   * Neither pure policy is right, which is why this is a slot rather than a
   * switch. **Replace** would give those first two beats 0.70 s and 0.83 s of
   * screen time — below reading time, so the opening's content is simply lost.
   * **Defer** would queue 3 × 4.2 s and run ~7 s behind reality, so "WATER
   * found" would announce itself at the pool — and a reward that arrives
   * detached from its cause misattributes itself, which is the same reasoning
   * that anchored R1's restoration wave at the kill rather than at the gate.
   *
   * So: a minimum readable dwell, then the newest waiting banner takes the
   * slot. On the measured opening every beat gets its {@link MIN_DWELL_MS} and
   * the last one is ~0.87 s late — bounded, because the queue is one deep and
   * the newest wins.
   *
   * Two behaviours worth knowing before driving this headlessly:
   *  - An arriving banner takes a FREE slot synchronously, so a step-driven
   *    capture still sees the common case lit without waiting on a timer
   *    (`CLAUDE.md` §6: timers do not fire inside one synchronous driving
   *    loop). Only a rapid second banner waits.
   *  - Identical title+sub inside {@link DEDUPE_MS} is dropped. `main.ts`
   *    carries a bespoke 2.5 s guard on the pyre-douse banner, added in R4
   *    after fun measured five stacked copies; that was one call site out of
   *    nine, and this subsumes it.
   */
  showBanner(title: string, sub?: string): void {
    const now = performance.now();
    // ⚠️ `\x1f`, THE ESCAPE — NOT A RAW NUL. This separator was a literal
    // U+0000 byte, which made `file(1)` report the whole module as `data` and
    // made **plain grep return zero matches on a file full of the words being
    // searched for** (BSD grep suppresses matches in binary files when piped).
    // It was the only such file in the repo, so every grep-based audit had
    // been silently skipping `hud.ts` — and comp lost real time applying an
    // edit twice because the edit that HAD landed looked like it had not.
    // Unit separator is the right character for the job and is plain text.
    const key = `${title}\x1f${sub ?? ""}`;
    if (key === this.lastBannerKey && now - this.lastBannerAt < DEDUPE_MS) return;
    this.lastBannerKey = key;
    this.lastBannerAt = now;

    const el = document.createElement("div");
    el.className = "hud-banner";
    el.dataset.state = "queued";
    el.textContent = title;
    if (sub) {
      const s2 = document.createElement("span");
      s2.className = "sub2";
      s2.textContent = sub;
      el.appendChild(s2);
    }
    // Appended NOW, whatever the slot is doing — see the note in the stylesheet
    // about why membership is not the queue.
    this.root.appendChild(el);
    // One deep: a third waiting banner drops the oldest waiter rather than
    // letting the backlog grow a lag the player would read as a bug.
    this.waiting.push(el);
    while (this.waiting.length > 2) this.retire(this.waiting.shift()!);
    this.pumpBanners();
  }

  /** Hide and remove one banner element, wherever it is in its life. */
  private retire(el: HTMLElement): void {
    el.dataset.state = "gone";
    setTimeout(() => el.remove(), UI.motionMs + 40);
  }

  /**
   * Hand the slot to the OLDEST waiting banner once the live one has held its
   * minimum dwell. Re-arms itself; never runs two timers for one slot.
   *
   * **FIFO, deliberately.** The first cut of this method took `waiting.pop()`
   * — the NEWEST — and retired everything behind it, which is LIFO, and which
   * silently deleted the middle beat of any burst of three: comp measured the
   * shipped opening showing "The grey gives way" and "WATER found" while
   * **"The Rot Road — clear" was never displayed at all**, and that toast is a
   * measured §9 beat. Dropping a line is a design change and needs fun's
   * verdict; it must never arrive as a side effect of a queue.
   *
   * The ordering also has to be FIFO for the lag arithmetic this class
   * promises to hold: A at 0–1.2 s, B at 1.2–2.4 s, C created at 1.53 s and
   * live at 2.4 s — 0.87 s late, bounded, and nothing lost. `showBanner`'s
   * one-deep cap is what stops a genuine flood from growing that lag.
   */
  private pumpBanners(): void {
    if (this.pumpTimer !== null) return;
    if (this.waiting.length === 0) return;
    const live = this.liveBanner;
    if (live) {
      const held = performance.now() - this.liveSince;
      // While anything is waiting, the live banner's turn ends at the DWELL,
      // not at its full life — otherwise the backlog runs on 4.2 s apiece and
      // accumulates exactly the ~7 s lag this design exists to avoid.
      if (held < MIN_DWELL_MS) {
        this.pumpTimer = setTimeout(() => {
          this.pumpTimer = null;
          this.pumpBanners();
        }, MIN_DWELL_MS - held);
        return;
      }
    }
    const next = this.waiting.shift();
    if (!next) return;
    if (live) this.retire(live);
    next.dataset.state = "live";
    this.liveBanner = next;
    this.liveSince = performance.now();
    // The lifetime starts when the banner is SEEN, not when it was created —
    // a promoted-late banner otherwise inherits a spent clock.
    setTimeout(() => {
      if (this.liveBanner === next) {
        this.liveBanner = null;
        this.pumpBanners();
      }
      next.remove();
    }, BANNER_LIFE_MS);
  }
}
