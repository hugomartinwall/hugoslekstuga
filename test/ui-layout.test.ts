import { describe, expect, it } from "vitest";
import { NO_INSETS } from "../lib/overrun/render/camera";
import {
  computeUiLayout,
  heartsExtent,
  hitAnyChrome,
  hitHelpCard,
  hitMapScreen,
  hitOverlayButton,
  hitPauseMenu,
  hitSettingsMenu,
  hitShopMenu,
  hitUiButton,
  interactiveRects,
  MIN_TAP,
  PAUSE_ACTIONS,
  reservedInsets,
  scopeForChrome,
  type Rect,
} from "../lib/overrun/render/ui-layout";
import { notched, VIEWPORTS } from "./viewports";

const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Approximate rendered width of a HUD string, in CSS px.
 *
 * There is no canvas here, and that is exactly how the bug this models got in:
 * every other assertion in this file compares `Rect`s, so nothing knew how wide
 * anything actually *drew*. The "N RIVALS LEFT" readout was therefore silently
 * dropped on every portrait phone — along with BEST and the streak counter —
 * and the suite stayed green.
 *
 * 0.62em per glyph for bold system-ui caps and digits, 0.55em for regular. It
 * is an approximation, deliberately a slight OVER-estimate, because the failure
 * mode we care about is "wider than its slot" — erring wide makes the test
 * pessimistic rather than blind. Verified against Chrome's measureText for the
 * strings used below to within ~6%.
 */
const approxTextW = (text: string, px: number, bold = true): number =>
  text.length * px * (bold ? 0.62 : 0.55);

describe("HUD text actually fits where it is drawn", () => {
  /**
   * The gap this closes: every other assertion in this file compares `Rect`s,
   * so the suite could not tell "the readout renders" from "the readout is
   * silently skipped". It was being skipped on every portrait phone.
   */

  it("gives the objective readout somewhere to go, on every viewport", () => {
    const failures: string[] = [];
    for (const v of VIEWPORTS) {
      for (const safe of [NO_INSETS, notched(v.cssH)]) {
        const L = computeUiLayout(v.cssW, v.cssH, safe);
        const need = approxTextW("3 RIVALS LEFT", 12 * L.fontScale);
        if (L.objective) {
          // fitText shrinks into the slot, so the bar is legibility, not fit.
          if (L.objective.w < 70) {
            failures.push(`${v.name}: slot only ${L.objective.w.toFixed(0)}px wide`);
          }
          continue;
        }
        // No dedicated slot means the row-one cluster must have real room for
        // it AFTER the hearts — which is exactly what it did not have.
        const sideX = L.livesRow.x + 3 * 15 * L.fontScale * 1.15 + 8;
        const clusterEnd = L.livesRow.x + L.livesMaxW;
        if (sideX + need > clusterEnd) {
          failures.push(
            `${v.name}: no slot, and cluster is ${(sideX + need - clusterEnd).toFixed(0)}px short`,
          );
        }
      }
    }
    expect(failures, `the objective would not render: ${failures.join("; ")}`).toEqual([]);
  });

  it("keeps the objective slot clear of the share bar and inside the HUD band", () => {
    for (const v of VIEWPORTS) {
      for (const safe of [NO_INSETS, notched(v.cssH)]) {
        const L = computeUiLayout(v.cssW, v.cssH, safe);
        if (!L.objective) continue;
        expect(overlaps(L.objective, L.shareBar), `${v.name} overlaps the share bar`).toBe(false);
        const band = reservedInsets(L, safe);
        expect(L.objective.y + L.objective.h, `${v.name} spills onto the board`).toBeLessThanOrEqual(
          band.top + 1,
        );
      }
    }
  });

  it("fits the level label, hearts and cores on one row at LEVEL 100", () => {
    // `livesRow.x` is a multiple of the label height standing in for the label's
    // rendered width. At 5.2 it was tuned for two digits and three-digit levels
    // ran under the first heart; nothing caught that, because nothing here knew
    // how wide "LEVEL 100" draws.
    const failures: string[] = [];
    for (const v of VIEWPORTS) {
      for (const safe of [NO_INSETS, notched(v.cssH)]) {
        const L = computeUiLayout(v.cssW, v.cssH, safe);
        if (!L.compact) continue; // only compact folds all three onto row one
        const labelRight = L.levelLabel.x + approxTextW("LEVEL 100", 17 * L.fontScale);
        const heartsRight = L.livesRow.x + 3 * 15 * L.fontScale * 1.15;
        const coresLeft = L.cores.x - approxTextW("◈ 9999", 14 * L.fontScale);
        if (labelRight > L.livesRow.x) {
          failures.push(`${v.name}: label over hearts by ${(labelRight - L.livesRow.x).toFixed(0)}`);
        }
        // Hearts-vs-cores only on the sizes the game promises to be legible at.
        // A notched 375x500 (split-screen, or the on-screen keyboard up) has
        // 94px of side inset and simply cannot seat label + hearts + cores on
        // one row — measured overflow there is ~74px, so it is a real overlap,
        // not a rounding artifact. Those sizes are excluded from the legibility
        // bars throughout this file for the same reason; recorded rather than
        // hidden.
        if (!v.belowSupportedFloor && heartsRight > coresLeft) {
          failures.push(`${v.name}: hearts over cores by ${(heartsRight - coresLeft).toFixed(0)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("touch targets", () => {
  it("are at least 44×44 CSS px everywhere", () => {
    const failures: string[] = [];
    for (const v of VIEWPORTS) {
      for (const safe of [NO_INSETS, notched(v.cssH)]) {
        const layout = computeUiLayout(v.cssW, v.cssH, safe);
        for (const { name, rect } of interactiveRects(layout)) {
          if (rect.w < MIN_TAP || rect.h < MIN_TAP) {
            failures.push(`${v.name} ${name}: ${rect.w.toFixed(0)}×${rect.h.toFixed(0)}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("stay inside the safe area", () => {
    const failures: string[] = [];
    for (const v of VIEWPORTS) {
      const layout = computeUiLayout(v.cssW, v.cssH, notched(v.cssH));
      for (const { name, rect } of interactiveRects(layout)) {
        const outside =
          rect.x < notched(v.cssH).left - 0.5 ||
          rect.y < notched(v.cssH).top - 0.5 ||
          rect.x + rect.w > v.cssW - notched(v.cssH).right + 0.5 ||
          rect.y + rect.h > v.cssH - notched(v.cssH).bottom + 0.5;
        if (outside) failures.push(`${v.name} ${name}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("HUD chrome", () => {
  it("does not overlap itself", () => {
    for (const v of VIEWPORTS) {
      const l = computeUiLayout(v.cssW, v.cssH, notched(v.cssH));
      expect(overlaps(l.pause, l.mute), v.name).toBe(false);
      // The ◈ shop button shares row one with the icons; the ratio toggle
      // shares the bottom edge with the coach banner's skip chip. All four
      // are live simultaneously during onboarding.
      expect(overlaps(l.shopButton, l.pause), v.name).toBe(false);
      expect(overlaps(l.shopButton, l.mute), v.name).toBe(false);
      expect(overlaps(l.ratioToggle, l.coachSkip), v.name).toBe(false);
      // The ability stack shares the bottom-right region with the coach
      // banner's skip chip. They are never LIVE together (abilities land at
      // L6+, the coach retires by L5) but both rects always exist, and a
      // stale overlap would let one surface eat the other's taps.
      for (const [i, r] of l.abilityButtons.entries()) {
        expect(overlaps(r, l.coachSkip), `${v.name} ability${i} vs coachSkip`).toBe(false);
        expect(overlaps(r, l.ratioToggle), `${v.name} ability${i} vs ratio`).toBe(false);
        expect(overlaps(r, l.coachBanner), `${v.name} ability${i} vs coach banner`).toBe(false);
      }
      // The share bar must clear the hearts at the WORST lives count (Second
      // Wind = 3). This is the assertion that was missing while the bar
      // painted over the hearts on every 428-479 px phone: the hearts were
      // free-hand math in drawHud, invisible to every Rect comparison here.
      // heartsExtent is the drawn geometry — same helper the renderer uses.
      expect(overlaps(l.shareBar, heartsExtent(l, 3)), `${v.name} bar vs hearts`).toBe(false);
      expect(overlaps(l.shareBar, heartsExtent(l, 2)), `${v.name} bar vs hearts (2)`).toBe(false);
      // The share bar never runs under the cores readout (right-aligned at
      // l.cores.x) or the level label. On narrow screens it drops to its own
      // row instead of being crushed into the gap.
      const ownRow = l.shareBar.y > l.pause.y + l.pause.h;
      if (ownRow) {
        // Its own row, so it may start at the left margin.
        expect(l.shareBar.x + l.shareBar.w, v.name).toBeLessThanOrEqual(v.cssW);
        expect(l.shareBar.w, v.name).toBeGreaterThanOrEqual(60);
      } else {
        expect(l.shareBar.x, v.name).toBeGreaterThan(l.levelLabel.x);
        expect(l.shareBar.x + l.shareBar.w, v.name).toBeLessThanOrEqual(l.cores.x - 60);
        expect(l.shareBar.w, v.name).toBeGreaterThanOrEqual(90);
      }
    }
  });

  it("reserves a band the board can be kept clear of", () => {
    for (const v of VIEWPORTS) {
      const l = computeUiLayout(v.cssW, v.cssH, notched(v.cssH));
      const ins = reservedInsets(l, notched(v.cssH));
      // Everything in the top bar must fall inside the reserved band.
      expect(l.pause.y + l.pause.h, v.name).toBeLessThanOrEqual(ins.top);
      expect(l.mute.y + l.mute.h, v.name).toBeLessThanOrEqual(ins.top);
      expect(l.livesRow.y, v.name).toBeLessThanOrEqual(ins.top);
      // The share bar is chrome too. It drops to its own row on narrow screens,
      // which used to push it 4 px past the band and onto the playfield — and
      // widening `compact` to cover narrow-but-tall phones would have made that
      // fire at 375×812, the single most common viewport there is. The band now
      // sums the rows it actually contains, so this holds by construction.
      expect(l.shareBar.y + l.shareBar.h, v.name).toBeLessThanOrEqual(ins.top);
      /*
       * ...and the band must leave a usable board behind.
       *
       * What this measures is `cssH - insets` — the height LEFT OVER after
       * chrome, not the board itself. It could not have caught the rejection
       * (a thin board strip with the HUD painted over it still leaves plenty
       * of leftover height); the board-share assertions live in
       * camera.test.ts, which measures the actual fitted board. This one
       * guards the chrome side: the worst case in this matrix measures 73.4%
       * (1280x720 with notch insets), so there is ~7pp of headroom, and
       * anything that eats into it is a real regression rather than noise.
       */
      expect(v.cssH - ins.top - ins.bottom, v.name).toBeGreaterThan(v.cssH * 0.66);
    }
  });

  it("lets the ticker overlay the board instead of reserving space for it", () => {
    // Deliberate, and the opposite of what this asserted before. Reserving a
    // permanent band for a message that lives three seconds cost a portrait
    // phone 38 CSS px of playfield forever; the ticker now draws over the board
    // behind a scrim (Ticker.draw in fx.ts). What still has to hold is that it
    // starts below the chrome — overlapping the *board* is the design, over-
    // lapping the pause button is a bug — and that it stays in the top region
    // rather than floating into the middle of play.
    for (const v of VIEWPORTS) {
      const l = computeUiLayout(v.cssW, v.cssH, notched(v.cssH));
      const ins = reservedInsets(l, notched(v.cssH));
      expect(l.ticker.y, v.name).toBeGreaterThanOrEqual(l.pause.y + l.pause.h);
      expect(l.ticker.y + l.tickerH, v.name).toBeGreaterThan(ins.top);
      expect(l.ticker.y + l.tickerH, v.name).toBeLessThan(v.cssH * 0.45);
    }
  });

  it("gives a phone back the board space the old two-row HUD took", () => {
    // The measured regression this whole pass exists to fix: 172 CSS px of
    // reserved top band on a 375×812, and 27% of a 360×640, before the board
    // got a pixel. `compact` keyed on height alone, so a narrow-but-tall phone
    // was treated as a desktop.
    for (const v of VIEWPORTS.filter((x) => x.cssW < 480)) {
      const l = computeUiLayout(v.cssW, v.cssH, notched(v.cssH));
      expect(l.compact, v.name).toBe(true);
      const ins = reservedInsets(l, notched(v.cssH));
      expect(ins.top, v.name).toBeLessThanOrEqual(130);
    }
    // A desktop still gets the roomier two-row treatment.
    const desk = computeUiLayout(1920, 1080, { top: 0, right: 0, bottom: 0, left: 0 });
    expect(desk.compact).toBe(false);
  });
});

describe("panels", () => {
  it("fit on screen in every viewport", () => {
    for (const v of VIEWPORTS) {
      for (const safe of [NO_INSETS, notched(v.cssH)]) {
        const l = computeUiLayout(v.cssW, v.cssH, safe);
        for (const [name, p] of [
          ["pause", l.pauseMenu.panel],
          ["shop", l.shop.panel],
          ["settings", l.settings.panel],
          ["help", l.help.panel],
        ] as const) {
          const where = `${v.name} ${name}`;
          expect(p.x, where).toBeGreaterThanOrEqual(safe.left);
          expect(p.y, where).toBeGreaterThanOrEqual(safe.top);
          expect(p.x + p.w, where).toBeLessThanOrEqual(v.cssW - safe.right);
          expect(p.y + p.h, where).toBeLessThanOrEqual(v.cssH - safe.bottom);
        }
      }
    }
  });

  it("keeps shop rows inside the shop panel and clear of close", () => {
    for (const v of VIEWPORTS) {
      const l = computeUiLayout(v.cssW, v.cssH, notched(v.cssH));
      for (const row of l.shop.rows) {
        expect(row.x, v.name).toBeGreaterThanOrEqual(l.shop.panel.x);
        expect(row.x + row.w, v.name).toBeLessThanOrEqual(l.shop.panel.x + l.shop.panel.w);
      }
      const last = l.shop.rows[l.shop.rows.length - 1]!;
      expect(overlaps(last, l.shop.close), v.name).toBe(false);
    }
  });

  it("keeps the shop tabs in the header: inside the panel, clear of every row", () => {
    // The tab strip lives between the title and row 0. A tab that overlapped
    // a row would resolve taps by hit order rather than by what is drawn —
    // hitShopMenu checks tabs first, so the ROW would silently lose.
    for (const v of VIEWPORTS) {
      for (const safe of [NO_INSETS, notched(v.cssH)]) {
        const l = computeUiLayout(v.cssW, v.cssH, safe);
        expect(l.shop.tabs.length).toBe(2);
        for (const [i, tab] of l.shop.tabs.entries()) {
          const where = `${v.name} tab ${i}`;
          expect(tab.x, where).toBeGreaterThanOrEqual(l.shop.panel.x);
          expect(tab.x + tab.w, where).toBeLessThanOrEqual(l.shop.panel.x + l.shop.panel.w);
          expect(tab.y, where).toBeGreaterThanOrEqual(l.shop.panel.y);
          for (const [j, row] of l.shop.rows.entries()) {
            expect(overlaps(tab, row), `${where} vs row ${j}`).toBe(false);
          }
        }
        expect(overlaps(l.shop.tabs[0]!, l.shop.tabs[1]!), v.name).toBe(false);
      }
    }
  });

  it("keeps pause rows from overlapping each other", () => {
    for (const v of VIEWPORTS) {
      const l = computeUiLayout(v.cssW, v.cssH, notched(v.cssH));
      // Iterate the array rather than hand-listing: a seventh row used to mean
      // editing three places, and this test was one of the places that could
      // silently keep passing while checking only the first six.
      // No length assertion here: panelGrid is CALLED with PAUSE_ACTIONS.length
      // and pushes exactly that many rows, so comparing the two is a tautology.
      // The identity check against the named fields, below, is the real guard.
      const rows = l.pauseMenu.rows;
      for (let i = 1; i < rows.length; i++) {
        expect(overlaps(rows[i - 1]!, rows[i]!), `${v.name} row ${i}`).toBe(false);
      }
    }
  });

  it("keeps the named pause fields identical to their indexed slots", () => {
    // The named fields are a convenience over `rows`. If they ever drift, the
    // menu draws one order and hit-tests another.
    const l = computeUiLayout(1280, 720, NO_INSETS);
    const byName: Record<string, Rect> = {
      resume: l.pauseMenu.resume,
      restart: l.pauseMenu.restart,
      shop: l.pauseMenu.shop,
      daily: l.pauseMenu.daily,
      progress: l.pauseMenu.progress,
      help: l.pauseMenu.help,
      settings: l.pauseMenu.settings,
      exit: l.pauseMenu.exit, // site seam: the BACK TO PLAYHOUSE row
    };
    PAUSE_ACTIONS.forEach((a, i) => {
      expect(byName[a], a).toBe(l.pauseMenu.rows[i]!);
    });
  });

  it("keeps settings rows inside their panel and clear of close", () => {
    for (const v of VIEWPORTS) {
      const l = computeUiLayout(v.cssW, v.cssH, notched(v.cssH));
      for (const row of l.settings.rows) {
        expect(row.x, v.name).toBeGreaterThanOrEqual(l.settings.panel.x);
        expect(row.x + row.w, v.name).toBeLessThanOrEqual(l.settings.panel.x + l.settings.panel.w);
        expect(overlaps(row, l.settings.close), v.name).toBe(false);
      }
    }
  });

  it("keeps the help card's CLOSE inside the panel it is drawn on", () => {
    // The regression that prompted this: drawHelpCard drew into
    // pauseMenu.panel but placed CLOSE at shop.close — two different
    // panelGrid calls — so the button hung 11-16 px below the card on every
    // single viewport, and nothing ever caught it.
    for (const v of VIEWPORTS) {
      for (const safe of [NO_INSETS, notched(v.cssH)]) {
        const l = computeUiLayout(v.cssW, v.cssH, safe);
        const p = l.help.panel;
        const c = l.help.close;
        expect(c.y, `${v.name} top`).toBeGreaterThanOrEqual(p.y);
        expect(c.y + c.h, `${v.name} bottom`).toBeLessThanOrEqual(p.y + p.h);
        expect(c.x, `${v.name} left`).toBeGreaterThanOrEqual(p.x);
        expect(c.x + c.w, `${v.name} right`).toBeLessThanOrEqual(p.x + p.w);
      }
    }
  });

  it("keeps the two overlay buttons apart", () => {
    for (const v of VIEWPORTS) {
      const l = computeUiLayout(v.cssW, v.cssH, notched(v.cssH));
      expect(overlaps(l.overlay.shop, l.overlay.daily), v.name).toBe(false);
    }
  });

  it("gives the overlay body a band clear of the buttons, on every viewport", () => {
    // The live bug this replaces: the banked-checkpoint line was drawn at a
    // hard-coded cy+120 and landed 24 px inside the UPGRADES button on a
    // notched 812x375. Nothing bounded those offsets, and nothing renders in
    // tests — so the body gets a rect and the rect gets swept.
    for (const v of VIEWPORTS) {
      for (const safe of [NO_INSETS, notched(v.cssH)]) {
        const l = computeUiLayout(v.cssW, v.cssH, safe);
        const b = l.overlay.body;
        expect(overlaps(b, l.overlay.shop), `${v.name} vs shop`).toBe(false);
        expect(overlaps(b, l.overlay.daily), `${v.name} vs daily`).toBe(false);
        expect(b.y, v.name).toBeGreaterThan(v.cssH / 2 - 54);
        // The heaviest stack is stars + cores + badge + tap prompt. If a
        // viewport cannot hold it, drawOverlay must drop the star row — this
        // asserts there is at least room for the three mandatory ones.
        const fs = l.fontScale;
        const mandatory = 17 * fs * 1.1 + 34 * fs + 17 * fs * 1.1;
        expect(b.h, `${v.name} body height`).toBeGreaterThanOrEqual(mandatory);
      }
    }
  });
});

describe("hit testing", () => {
  it("resolves the centre of every rect to its own action", () => {
    for (const v of VIEWPORTS) {
      const l = computeUiLayout(v.cssW, v.cssH, notched(v.cssH));
      const c = (r: Rect) => centre(r);

      expect(hitUiButton(l, c(l.pause).x, c(l.pause).y), v.name).toBe("pause");
      expect(hitUiButton(l, c(l.mute).x, c(l.mute).y), v.name).toBe("mute");

      PAUSE_ACTIONS.forEach((a, i) => {
        const p = c(l.pauseMenu.rows[i]!);
        expect(hitPauseMenu(l, p.x, p.y), `${v.name} ${a}`).toBe(a);
      });

      // The onboarding skip is gated on the banner being visible, because its
      // box sits over the playfield: once the onboarding is done, a tap there
      // must reach the board rather than a control that is no longer drawn.
      const s = c(l.coachSkip);
      expect(hitUiButton(l, s.x, s.y, true), v.name).toBe("coachSkip");
      expect(hitUiButton(l, s.x, s.y, false), v.name).not.toBe("coachSkip");

      // Ratio toggle and ◈ shop button live in the "playing" scope ONLY. The
      // round-trip sweep proves the positive half; this is the negative half:
      // on the start card (or under a menu) both rects must be dead, or the
      // one control that starts the game loses its bottom-left corner and a
      // menu tap near the cores readout opens a second panel.
      const rt = c(l.ratioToggle);
      const sb = c(l.shopButton);
      expect(hitUiButton(l, rt.x, rt.y, false, true, true), v.name).toBe("ratio");
      expect(hitUiButton(l, rt.x, rt.y, false, true, false), v.name).toBe(null);
      expect(hitUiButton(l, sb.x, sb.y, false, true, true), v.name).toBe("shop");
      expect(hitUiButton(l, sb.x, sb.y, false, true, false), v.name).toBe(null);

      for (let i = 0; i < l.shop.rows.length; i++) {
        const p = c(l.shop.rows[i]!);
        expect(hitShopMenu(l, p.x, p.y), `${v.name} row ${i}`).toEqual({ kind: "row", index: i });
      }
      for (let i = 0; i < l.shop.tabs.length; i++) {
        const p = c(l.shop.tabs[i]!);
        expect(hitShopMenu(l, p.x, p.y), `${v.name} tab ${i}`).toEqual({ kind: "tab", index: i });
      }
      expect(hitShopMenu(l, c(l.shop.close).x, c(l.shop.close).y), v.name).toBe("close");

      expect(hitOverlayButton(l, c(l.overlay.shop).x, c(l.overlay.shop).y)).toBe("shop");
      expect(hitOverlayButton(l, c(l.overlay.daily).x, c(l.overlay.daily).y)).toBe("daily");

      expect(hitSettingsMenu(l, c(l.settings.rows[0]!).x, c(l.settings.rows[0]!).y)).toBe("music");
      expect(hitSettingsMenu(l, c(l.settings.close).x, c(l.settings.close).y)).toBe("close");
      expect(hitHelpCard(l, c(l.help.close).x, c(l.help.close).y)).toBe("close");
    }
  });

  it("resolves hover to exactly the control click would fire", () => {
    // The mechanical guarantee that hover, press and click cannot disagree:
    // they all go through hitAnyChrome, and every rect the game exposes
    // round-trips to its own id on every viewport.
    const failures: string[] = [];
    for (const v of VIEWPORTS) {
      for (const safe of [NO_INSETS, notched(v.cssH)]) {
        const l = computeUiLayout(v.cssW, v.cssH, safe);
        for (const { name, rect } of interactiveRects(l)) {
          const p = centre(rect);
          const got = hitAnyChrome(l, p.x, p.y, scopeForChrome(name), true);
          if (got !== name) failures.push(`${v.name} ${safe === NO_INSETS ? "" : "notched "}${name} -> ${got}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("reports nothing under a point that is on no control", () => {
    const l = computeUiLayout(375, 812, notched(812));
    // Mid-board, with the onboarding live: must not claim the coach skip.
    expect(hitAnyChrome(l, 180, 400, "playing", true)).toBe(null);
    // A tap on the help card's own text is not its CLOSE button.
    expect(hitAnyChrome(l, l.help.panel.x + 20, l.help.panel.y + 20, "help")).toBe(null);
    // Same rule for the map: a reader tapping the path is not dismissing.
    expect(hitMapScreen(l, l.map.panel.x + 20, l.map.panel.y + 20)).toBe("panel");
    expect(hitAnyChrome(l, l.map.panel.x + 20, l.map.panel.y + 20, "map")).toBe(null);
  });

  it("offers the progress strip on every tall viewport, and only there", () => {
    // SHORT_H is 560 in ui-layout.ts; the strip yields below it so the
    // overlay body keeps the result rows, and the map stays reachable
    // through the pause menu. Presence is the half a deleted feature would
    // break — absence alone passes with the strip removed entirely.
    for (const v of VIEWPORTS) {
      const l = computeUiLayout(v.cssW, v.cssH, NO_INSETS);
      if (v.cssH >= 560) {
        expect(l.overlay.progress, v.name).not.toBeNull();
      } else {
        expect(l.overlay.progress, v.name).toBeNull();
      }
    }
  });

  it("routes a strip tap to the map even when the daily is locked, and never without strip data", () => {
    const l = computeUiLayout(430, 932, NO_INSETS);
    const s = l.overlay.progress!;
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    // dailyLocked reroutes the button row, but the strip must still win —
    // a locked-daily overlay falling through to "continue" would start a
    // level under the finger that wanted the map.
    expect(hitOverlayButton(l, cx, cy, true)).toBe("progress");
    // Daily overlays carry no path data: the same rect must not hit-test,
    // or the empty band becomes a phantom affordance.
    expect(hitOverlayButton(l, cx, cy, false, false)).toBe(null);
    expect(hitOverlayButton(l, cx, cy, true, false)).toBe(null);
  });

  it("treats a tap well outside a panel as outside", () => {
    const l = computeUiLayout(375, 812, notched(812));
    expect(hitPauseMenu(l, 4, 806)).toBe("outside");
    expect(hitShopMenu(l, 4, 806)).toBe("outside");
    expect(hitSettingsMenu(l, 4, 806)).toBe("outside");
    expect(hitHelpCard(l, 4, 806)).toBe("outside");
    expect(hitOverlayButton(l, 4, 60)).toBe(null);
    expect(hitUiButton(l, 4, 400)).toBe(null);
  });
});
