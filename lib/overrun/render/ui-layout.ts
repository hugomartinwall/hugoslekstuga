import type { Insets } from "./camera";

/**
 * Screen-space UI layout, in CSS pixels.
 *
 * Chrome used to be authored in *world* units and drawn inside the board
 * transform, which anchored it to the board rect rather than the screen. On a
 * portrait phone that painted the HUD directly on top of the playfield — and
 * the old uiScale() compensation, which grew the glyphs, made the collision
 * worse rather than better because it was correcting in the wrong space.
 *
 * Here the layout depends only on the viewport, and the camera then fits the
 * board into whatever the layout did not claim (see reservedInsets). Clean
 * one-way dependency, no cycle.
 *
 * Pure and DOM-free so every tap target can be asserted directly.
 */

/** Minimum interactive target — the 44 CSS px mobile tap-target floor. */
export const MIN_TAP = 44;

/** Gutter between chrome and the screen edge (before safe-area insets). */
const PAD = 12;

/** Widest a centred panel is allowed to get on a big screen. */
const PANEL_MAX_W = 460;

const BOTTOM_BAR_H = 8;

/**
 * Below this height the HUD folds to a single row and menus go two-column.
 * A landscape phone is ~375 tall: six stacked 44 px rows plus panel chrome
 * needs ~390, so stacking is not merely cramped there, it is impossible.
 */
const SHORT_H = 560;
/** Below this width there is no room for a second HUD row. Phone territory. */
const NARROW_W = 480;
/** Share-bar thickness. */
const BAR_H = 10;
/**
 * Height of the ROW an own-row share bar sits in.
 *
 * Deliberately a constant rather than `BAR_H + 10`, which is what it used to
 * be. barRowH feeds hudBandH, which feeds reservedInsets, which is what the
 * camera fits the board around — so growing the bar by 4 px would have taken
 * ~0.36 px off worst-case node diameter, against a margin of 0.7 px in
 * camera.test.ts, and forced a full sprite re-bake on every resize. The bar
 * grows inside the row it already had; the band does not move.
 */
const BAR_ROW_H = 16;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface UiLayout {
  cssW: number;
  cssH: number;
  /** Text scale, 1 on desktop; small screens get slightly chunkier type. */
  fontScale: number;
  /** Short viewport: HUD folds to one row, menus may go two-column. */
  compact: boolean;
  /** Height of the HUD band, in CSS px. Scales with the type. */
  hudBandH: number;

  /** Top-left run readout. */
  levelLabel: { x: number; y: number };
  livesRow: { x: number; y: number };
  /**
   * Width the lives / BEST / streak cluster may use before it would run into
   * the cores readout. In compact mode that cluster shares row one with the
   * level label and the cores, so the renderer drops the optional parts rather
   * than overlapping.
   */
  livesMaxW: number;
  /**
   * Dedicated slot for the objective readout ("N RIVALS LEFT"), or null when
   * the row-one cluster has room for it.
   *
   * Non-null exactly on compact screens, where the cluster provably does not:
   * the hearts alone overrun `livesMaxW` on a 375px phone, so the readout that
   * satisfies "clear goals visible at all times" was being dropped on every
   * portrait device. This slot sits in the left gutter of the share bar's own
   * row, which compact screens already reserve.
   */
  objective: Rect | null;
  /** Centred territory-share bar. */
  shareBar: Rect;
  /** Top-right cluster. */
  cores: { x: number; y: number };
  /**
   * The cores readout's tap target — tapping ◈ opens the shop mid-play.
   * UPGRADES used to live only behind pause and on the win screen; the one
   * readout that pulses "you can afford something" was not the thing you
   * could tap to spend it.
   */
  shopButton: Rect;
  pause: Rect;
  mute: Rect;
  /** Event ticker anchor (right-aligned, below the HUD rows). */
  ticker: { x: number; y: number };
  /** Height the ticker may occupy below its anchor, in CSS px. */
  tickerH: number;
  /** How many ticker lines fit in the reserved band. */
  tickerLines: number;

  /**
   * Onboarding banner and its skip control, along the bottom edge.
   *
   * Bottom rather than top: the top band is already the busiest chrome on the
   * screen, and coach text belongs next to the thing being coached rather than
   * above the HUD. Like the ticker it draws OVER the board behind a scrim
   * instead of reserving a band — an onboarding that permanently shrank the
   * playfield would be paying for four steps with the whole game.
   */
  coachBanner: Rect;
  coachSkip: Rect;
  /**
   * Send-ratio toggle (ALL / ½), bottom-left corner. Bottom-anchored like the
   * coach banner and, like it, drawn OVER the board rather than reserving a
   * band — reservedInsets must not know it exists, or every phone pays board
   * area for a control that costs none. The coach banner starts to its right.
   */
  ratioToggle: Rect;
  /**
   * Ability buttons, a vertical stack anchored bottom-RIGHT, sitting above
   * the coach-banner/ratio row. Drawn over the board like the ratio toggle
   * (reservedInsets must not know them), and hit only in the "playing" scope
   * gated by how many the app says are live (`abilityCount` in hitUiButton).
   *
   * Geometry note: the stack ends 8 px above the coach banner's row, so the
   * rects can never overlap coachSkip even though both surfaces exist in the
   * layout at once. In PLAY they cannot co-occur anyway — abilities cost
   * 120+ cores, which lands at L6+ where the coach has retired — but the
   * sweep tests every rect pair regardless, so the geometry has to hold.
   */
  abilityButtons: Rect[];

  pauseMenu: {
    panel: Rect;
    /**
     * The same rects as the named fields below, in PAUSE_ACTIONS order.
     *
     * Row order used to be written out three times — here, in the hit test, and
     * in the draw call — so keyboard order, visual order and hit order could
     * silently disagree. Indexing one array is the fix.
     */
    rows: Rect[];
    resume: Rect;
    restart: Rect;
    shop: Rect;
    daily: Rect;
    /** The level map — the journey so far and the road ahead. */
    progress: Rect;
    /** Reference card for anyone who skipped, or forgot, the onboarding. */
    help: Rect;
    settings: Rect;
    /** BACK TO PLAYHOUSE — the site seam's way out of the embedded game. */
    exit: Rect;
    columns: number;
  };
  shop: {
    panel: Rect;
    /**
     * Row rects for the LARGEST tab (SHOP_ROWS_MAX). The panel is computed
     * once for that maximum, never per tab — the help/map panel sharing below
     * is load-bearing (there is a test), and a panel that resized on a tab
     * switch would move CLOSE under the player's finger.
     */
    rows: Rect[];
    /** One chip per SHOP_TABS entry, inside the (taller) header band. */
    tabs: Rect[];
    close: Rect;
    columns: number;
  };
  /** Volume + motion, in their own panel so the pause menu stays six rows. */
  settings: {
    panel: Rect;
    rows: Rect[];
    close: Rect;
    columns: number;
  };
  /** The help card borrows the shop panel — see `helpPanelIsShopPanel` below. */
  help: {
    panel: Rect;
    close: Rect;
  };
  /** The level-map screen borrows the shop panel too, like help does. */
  map: {
    panel: Rect;
    close: Rect;
  };
  overlay: {
    shop: Rect;
    daily: Rect;
    /** Centred variant of `shop`, used while the daily is still locked. */
    solo: Rect;
    /**
     * The progress strip — a tappable window of the level path, sitting
     * between the result text and the buttons. Null on short screens, where
     * the overlay body cannot spare the height; the map stays reachable
     * through the pause menu there.
     */
    progress: Rect | null;
    /**
     * The band the result text may occupy: below the title, above the buttons.
     *
     * Every line in drawOverlay used to be a hard-coded offset from centre
     * (cy+4, cy+38, cy+68, cy+98, cy+120) with nothing bounding them, and on a
     * notched 812x375 the checkpoint line landed 24 px inside the UPGRADES
     * button. Giving the body a rect makes that a layout question, which this
     * module's test suite already sweeps on every viewport.
     */
    body: Rect;
  };
}

export type UiButton =
  | "mute"
  | "pause"
  | "coachSkip"
  | "ratio"
  | "shop"
  | "ability0"
  | "ability1"
  | "ability2";

/**
 * Shop tabs: passives and actives. STYLE/cosmetics is deliberately CUT for
 * this submission — do not add a third tab without content behind it.
 * DOCTRINE shows the five TRACKS rows, POWERS the three ABILITIES rows; the
 * panel is sized for the larger of the two (SHOP_ROWS_MAX).
 */
export const SHOP_TABS = ["DOCTRINE", "POWERS"] as const;
/** Max rows any tab shows — the row-rect count the panel reserves. */
export const SHOP_ROWS_MAX = 5;

/** What a point over the shop panel resolves to. */
export type ShopHit =
  | { kind: "tab"; index: number }
  | { kind: "row"; index: number }
  | "close"
  | "panel"
  | "outside";
export type PauseAction =
  | "resume"
  | "restart"
  | "shop"
  | "daily"
  | "progress"
  | "help"
  | "settings"
  | "exit";
export type SettingsAction = "music" | "sfx" | "motion";

/**
 * Pause rows, in display order. The single source for the menu's order:
 * `pauseRects` maps it to geometry, `hitPauseMenu` loops over it, the renderer
 * draws it, and keyboard navigation walks it.
 *
 * RESUME first because the pause menu is the screen you hit mid-run to get back
 * to playing. SETTINGS last because it is the only row that is not a
 * destination — except EXIT below it, the site seam: a game embedded in a page
 * needs a way out that isn't the browser back button (BACK TO PLAYHOUSE).
 */
export const PAUSE_ACTIONS: readonly PauseAction[] = [
  "resume",
  "restart",
  "shop",
  "daily",
  "progress",
  "help",
  "settings",
  "exit",
];

export const SETTINGS_ACTIONS: readonly SettingsAction[] = ["music", "sfx", "motion"];

const inRect = (r: Rect, x: number, y: number) =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** Heart glyph size in CSS px at fontScale 1. One constant, two consumers. */
const HEART_PX = 15;

/**
 * Centre and size of each lives heart. The renderer draws at EXACTLY these
 * points, and the layout tests measure overlap against them — the hearts used
 * to be free-hand math inside drawHud, which is how a share bar could paint
 * straight over them on a 430 px phone while every geometry test stayed green:
 * nothing the tests could see knew where the hearts were.
 */
export function heartCenters(
  layout: UiLayout,
  maxLives: number,
): Array<{ x: number; y: number; size: number }> {
  const size = HEART_PX * layout.fontScale;
  return Array.from({ length: maxLives }, (_, i) => ({
    x: layout.livesRow.x + i * size * 1.15 + size * 0.45,
    y: layout.livesRow.y,
    size,
  }));
}

/**
 * Bounding box of the whole hearts row, for overlap assertions. The heart
 * path's true extents are ±0.402·size horizontally and −0.284..+0.478·size
 * vertically (see drawHeartIcon); this box rounds outward slightly.
 */
export function heartsExtent(layout: UiLayout, maxLives: number): Rect {
  const hearts = heartCenters(layout, maxLives);
  const first = hearts[0]!;
  const last = hearts[hearts.length - 1]!;
  const half = first.size * 0.45;
  return {
    x: first.x - half,
    y: first.y - first.size * 0.32,
    w: last.x + half - (first.x - half),
    h: first.size * 0.82,
  };
}

/** Grow a rect about its centre until it is at least MIN_TAP in both axes. */
function tappable(r: Rect): Rect {
  const w = Math.max(MIN_TAP, r.w);
  const h = Math.max(MIN_TAP, r.h);
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

/**
 * Lay out `count` rows inside a centred panel, choosing one or two columns by
 * what actually fits. Rows are never smaller than MIN_TAP; if even that will
 * not fit stacked, the grid goes wide instead of shrinking the targets.
 */
function panelGrid(
  cssW: number,
  cssH: number,
  safe: Insets,
  count: number,
  opts: { headerH: number; footerH: number; sideInset: number; maxRowH: number },
): { panel: Rect; rows: Rect[]; columns: number } {
  const availW = Math.max(120, cssW - safe.left - safe.right - 2 * PAD);
  const availH = Math.max(120, cssH - safe.top - safe.bottom - 2 * PAD);
  const chrome = opts.headerH + opts.footerH;

  // How many rows must stack, for a given column count.
  const stacked = (cols: number) => Math.ceil(count / cols);
  const fits = (cols: number, gap: number) =>
    chrome + stacked(cols) * MIN_TAP + (stacked(cols) - 1) * gap <= availH;

  let columns = 1;
  let gap = 10;
  if (!fits(1, gap)) {
    gap = 6;
    // Two columns need width for two targets plus gutters, AND must actually
    // fit vertically — falling to two columns without checking let the footer
    // ride up over the rows on very short viewports.
    const wideEnough = availW >= 2 * (MIN_TAP + 40) + opts.sideInset * 2 + gap;
    if (wideEnough && fits(2, gap)) columns = 2;
  }

  const perColumn = stacked(columns);
  const maxPanelW = columns === 2 ? Math.min(availW, PANEL_MAX_W * 1.6) : PANEL_MAX_W;
  const w = Math.min(maxPanelW, availW);

  const rowSpace = Math.max(MIN_TAP, (availH - chrome - (perColumn - 1) * gap) / perColumn);
  const rowH = Math.max(MIN_TAP, Math.min(opts.maxRowH, rowSpace));
  // Never clamp below the content: the footer is positioned from panel.y + h,
  // so a clipped panel drags the close button up on top of the last row.
  const h = chrome + perColumn * rowH + (perColumn - 1) * gap;

  const panel: Rect = {
    x: safe.left + PAD + (availW - w) / 2,
    y: safe.top + PAD + (availH - h) / 2,
    w,
    h,
  };

  const colGap = 12;
  const usableW = w - 2 * opts.sideInset;
  const colW = columns === 2 ? (usableW - colGap) / 2 : usableW;
  const rows: Rect[] = [];
  for (let i = 0; i < count; i++) {
    const col = columns === 2 ? Math.floor(i / perColumn) : 0;
    const row = columns === 2 ? i % perColumn : i;
    rows.push({
      x: panel.x + opts.sideInset + col * (colW + colGap),
      y: panel.y + opts.headerH + row * (rowH + gap),
      w: colW,
      h: rowH,
    });
  }
  return { panel, rows, columns };
}

export function computeUiLayout(cssW: number, cssH: number, safe: Insets): UiLayout {
  // Chrome used to be authored in world units, so it grew with the board and
  // filled a 1080p screen properly. In CSS pixels that has to be explicit:
  // scale with the viewport, with a floor on small screens where the board is
  // apparently further away and thumbs cover more of it.
  // Continuous in cssW: an earlier version stepped 0.95 → 1.15 at exactly 480,
  // and because fontScale feeds the HUD band height it moved the camera fit
  // too — a visible pop for a one-pixel window drag.
  const narrowBoost = 1.15 - 0.2 * Math.max(0, Math.min(1, (cssW - 380) / 100));
  const fontScale = Math.max(narrowBoost, Math.min(1.9, cssW / 760));
  // Compact is "this is a phone", not just "this is short". Keying it on height
  // alone gave a 360×640 Android the full two-row desktop HUD: 172 CSS px of
  // reserved top band, 27% of the screen, before the board got a single pixel.
  // Width is the better signal — a narrow screen has no room for a second row
  // whatever its height.
  const compact = cssH < SHORT_H || cssW < NARROW_W;

  const top = safe.top + PAD;
  const right = cssW - safe.right - PAD;
  const left = safe.left + PAD;

  // Never below the tap minimum; larger than it on a big screen so the cluster
  // does not look lost in a corner.
  const icon = Math.max(MIN_TAP, Math.round(30 * fontScale));
  const iconR = icon / 2;
  const mute: Rect = { x: right - icon, y: top, w: icon, h: icon };
  const pause: Rect = { x: mute.x - icon - 4, y: top, w: icon, h: icon };

  // Row metrics follow the type, not fixed pixels — the label and the hearts
  // both scale, so a constant row height collides on a large screen.
  const labelPx = 17 * fontScale;
  const heartPx = 15 * fontScale;
  const row1H = Math.max(icon, labelPx + 6);
  // Compact folds the hearts up onto the label row; otherwise they get row two.
  const row2H = compact ? 0 : heartPx + 8;
  // The ticker is chrome too: anchoring it exactly at the band's lower edge put
  // its text straight onto the playfield. One line on short screens — two would
  // cost a landscape phone a tenth of its height for a message that shows for
  // three seconds.
  const tickerLines = compact ? 1 : 2;
  const tickerH = Math.ceil(tickerLines * 13 * fontScale * 1.25);

  // Cores readout, right-aligned just left of the icon cluster.
  const coresX = pause.x - 14;
  // Reserve room for its widest realistic value ("◈ 99999") so the share bar
  // shrinks instead of running underneath it.
  const coresW = 72 * fontScale;
  // The readout doubles as the shop button. Its rect is the reserved width at
  // icon height, ending 14 px left of pause so it cannot overlap the icons —
  // asserted pairwise in ui-layout.test.ts ("does not overlap itself"), and
  // the interactiveRects sweep covers its size, safe-area fit and hit
  // round-trip on every viewport.
  const shopButton: Rect = { x: coresX - coresW, y: top, w: coresW, h: icon };

  // The share bar wants to sit between the level label and the cores readout.
  // On a narrow phone that gap is too small to be readable, so rather than
  // crush it (or run it under the cores) it drops to its own row underneath —
  // where it is wider and easier to read than it ever was inline.
  const labelW = 110 * fontScale;
  const barMaxW = Math.min(240, cssW * 0.36);
  const MIN_INLINE_BAR = 90;
  /**
   * Where row 1's left-hand occupants END — which is where an inline bar may
   * begin. Non-compact that is just the level label (hearts live on row 2).
   * Compact folds the hearts AND the objective text onto row 1, and `room`
   * used to ignore both: it measured from the label alone, so on a 428-479 px
   * phone (the Pro Max band — wide enough to stay inline, narrow enough to be
   * compact) the "roomy" gap it found was sitting exactly under the hearts,
   * and the bar painted over them on every such device. The reserve uses the
   * WORST lives count (3, Second Wind) and the objective slot's own width, so
   * inline now means "genuinely clear of everything row 1 can hold".
   */
  const objectiveReserve = Math.min(124, cssW * 0.34);
  const clusterRight = compact
    ? left + labelPx * 5.6 + HEART_PX * fontScale * 3.2 + 8 + objectiveReserve
    : left + labelW;
  const room = coresX - coresW - clusterRight - 16;
  const barOwnRow = room < MIN_INLINE_BAR;

  // When the bar drops to its own row it needs its own band height, or it draws
  // below the reserved area and onto the board. That used to be masked by the
  // hearts' row happening to be there to absorb it — which broke the moment
  // `compact` (which zeroes that row) and `barOwnRow` were both true. Making
  // the band the sum of the rows it actually contains fixes it by construction
  // instead of by coincidence.
  const barRowH = barOwnRow && compact ? BAR_ROW_H : 0;
  const hudBandH = row1H + row2H + barRowH;

  /**
   * Left gutter on the bar's own row.
   *
   * Non-compact: room for the hearts, which live on that row.
   *
   * Compact: room for the OBJECTIVE readout, because row 1 has none. Measured
   * on a 375x812 phone with 3 lives: the hearts alone end at x=171 against a
   * cluster allowance ending at x=164, so `sideX > clusterEnd` before the label
   * is even measured and "N RIVALS LEFT" — plus BEST and the streak counter —
   * were silently dropped on every portrait phone. Row 1 cannot be widened
   * (label + hearts + cores already fill it) and a new row would cost band
   * height on exactly the devices where board area is scarcest, which is the
   * regression the 172px -> 125px work existed to fix.
   *
   * The bar row is the answer: it already exists whenever `compact` is true
   * (that is what `barOwnRow` means on a narrow screen), and the bar has width
   * to spare.
   */
  const objectiveW = compact && barOwnRow ? objectiveReserve : 0;
  const livesAllowance = compact ? objectiveW : 96 * fontScale;
  const shareBar: Rect = barOwnRow
    ? {
        x: left + livesAllowance,
        y: top + row1H + (compact ? 4 : row2H / 2 - 3),
        w: Math.max(60, right - (left + livesAllowance)),
        h: BAR_H,
      }
    : {
        // Centre in the free gap, not on the screen — the two ends are not
        // symmetric, and `clusterRight` is what makes the gap actually free
        // (in compact it starts after the hearts and the objective's room).
        x: (clusterRight + (coresX - coresW)) / 2 - Math.min(barMaxW, room) / 2,
        y: top + iconR - BAR_H / 2,
        w: Math.min(barMaxW, room),
        h: BAR_H,
      };

  // Pause menu: eight actions (see PAUSE_ACTIONS) — upstream's seven plus the
  // site's EXIT row. RESUME stays first for the same reason settings still
  // live in their own panel — burying it turns a two-second interruption into
  // a menu. panelGrid already goes two-column on short viewports, and the
  // sweeps in test/ui-layout.test.ts verify the fit at eight.
  const pm = panelGrid(cssW, cssH, safe, PAUSE_ACTIONS.length, {
    headerH: 62,
    footerH: 18,
    sideInset: 20,
    maxRowH: 52,
  });

  // Shop: sized ONCE for the largest tab (DOCTRINE's five rows) with a header
  // tall enough for the title row plus a MIN_TAP tab strip. Never re-derived
  // per tab: the help/map panel sharing below hangs off this rect, and CLOSE
  // must not move when the player switches tabs.
  // 100, not a round 106: on a notched 640×360 the two-column fit has 315 px
  // of height and 106 of header put the panel at 316 — one pixel over, which
  // panelGrid answers by falling back to a single column that overflows the
  // screen by 50. The title band gives up the 6 px instead.
  const SHOP_HEADER_H = 50 + MIN_TAP + 6; // title band + tab strip + gap
  const sh = panelGrid(cssW, cssH, safe, SHOP_ROWS_MAX, {
    headerH: SHOP_HEADER_H,
    footerH: MIN_TAP + 22,
    sideInset: 16,
    maxRowH: 54,
  });
  // Tab chips split the strip under the title. Both are ≥ MIN_TAP tall by
  // construction and ≥ MIN_TAP wide on the narrowest panel (availW floors at
  // 120... in practice ≥257 on the matrix); tappable() guards the invariant.
  const tabGap = 8;
  const tabW = (sh.panel.w - 32 - tabGap) / SHOP_TABS.length;
  const shopTabs: Rect[] = SHOP_TABS.map((_, i) =>
    tappable({
      x: sh.panel.x + 16 + i * (tabW + tabGap),
      y: sh.panel.y + 50,
      w: tabW,
      h: MIN_TAP,
    }),
  );
  const footerButton = (panel: Rect): Rect => ({
    x: panel.x + 16,
    y: panel.y + panel.h - MIN_TAP - 11,
    w: panel.w - 32,
    h: MIN_TAP,
  });
  const shClose = footerButton(sh.panel);

  // Settings: music, SFX, motion — plus the same footer button.
  const st = panelGrid(cssW, cssH, safe, SETTINGS_ACTIONS.length, {
    headerH: 56,
    footerH: MIN_TAP + 22,
    sideInset: 16,
    maxRowH: 54,
  });

  // Overlay secondary buttons, side by side above the bottom safe area.
  const ovW = Math.min(180, (cssW - safe.left - safe.right - 3 * PAD) / 2);
  const ovY = cssH - safe.bottom - PAD - MIN_TAP - BOTTOM_BAR_H;
  const ovGap = 12;

  // The progress strip sits between the result text and the buttons — the
  // between-levels moment is where a "where am I on the journey" glance
  // belongs. Only on screens tall enough to spare its band: on a landscape
  // phone the body barely holds the result rows, so the strip yields and the
  // map stays reachable through the pause menu.
  const ovProgressH = 52;
  const ovProgressW = Math.min(430, cssW - safe.left - safe.right - 2 * PAD);
  const ovProgress: Rect | null =
    cssH >= SHORT_H
      ? {
          x: safe.left + PAD + (cssW - safe.left - safe.right - 2 * PAD - ovProgressW) / 2,
          y: ovY - ovProgressH - 10,
          w: ovProgressW,
          h: ovProgressH,
        }
      : null;

  // Result text lives between the title's descender and the buttons (or the
  // progress strip, when one is present). The title is drawn centred at
  // cy - 54 at up to 0.13*cssW, so half its box clears it.
  const ovBodyTop = cssH / 2 - 54 + Math.min(58, cssW * 0.13) * 0.5 + 10;
  const ovBody: Rect = {
    x: safe.left + PAD,
    y: ovBodyTop,
    w: Math.max(0, cssW - safe.left - safe.right - 2 * PAD),
    h: Math.max(0, (ovProgress ? ovProgress.y : ovY) - 10 - ovBodyTop),
  };

  // Send-ratio toggle, bottom-left. Fixed width: its label is "ALL" or "½",
  // so it never needs to grow, and a fixed box keeps the coach banner's start
  // stable across steps.
  const ratioToggle: Rect = {
    x: left,
    y: cssH - safe.bottom - BOTTOM_BAR_H - PAD - MIN_TAP,
    w: Math.max(MIN_TAP, 56),
    h: MIN_TAP,
  };

  // Coach banner along the bottom, starting right of the ratio toggle (both
  // are live at once during onboarding), with the skip chip inset at its right
  // end. The chip keeps a full MIN_TAP box even though it draws smaller —
  // "skip the tutorial" is exactly the control a frustrated player stabs at.
  const coachH = Math.round(MIN_TAP * 0.86);
  const coachLeft = ratioToggle.x + ratioToggle.w + 8;
  const coachBanner: Rect = {
    x: coachLeft,
    y: cssH - safe.bottom - BOTTOM_BAR_H - PAD - coachH,
    w: Math.max(0, right - coachLeft),
    h: coachH,
  };
  const skipW = Math.min(96, Math.max(72, coachBanner.w * 0.28));
  const coachSkip: Rect = tappable({
    x: coachBanner.x + coachBanner.w - skipW - 6,
    y: coachBanner.y + (coachH - MIN_TAP) / 2,
    w: skipW,
    h: MIN_TAP,
  });

  // Ability buttons: three fixed slots stacked bottom-right, key order top to
  // bottom (1/2/3). Anchored to the coach banner's TOP minus the skip chip's
  // 3 px tappable overhang, so the stack clears coachSkip on every viewport —
  // see the abilityButtons doc above for why they must not collide even
  // though they are never live at the same time.
  const abilityBtn = 48; // > MIN_TAP for icon + charge pips
  const abilityGap = 8;
  const abilityStackH = 3 * abilityBtn + 2 * abilityGap;
  const abilityTop = coachBanner.y - 11 - abilityStackH;
  const abilityButtons: Rect[] = Array.from({ length: 3 }, (_, i) => ({
    x: right - abilityBtn,
    y: abilityTop + i * (abilityBtn + abilityGap),
    w: abilityBtn,
    h: abilityBtn,
  }));

  return {
    cssW,
    cssH,
    fontScale,
    compact,
    hudBandH,
    levelLabel: { x: left, y: top + (row1H - labelPx) / 2 },
    // When short, lives sit inline after the level label instead of below it.
    // The 5.6 reserves room for the widest label a real run reaches: "LEVEL 100"
    // is 9 glyphs at ~0.62em of bold system-ui, i.e. 5.58 label-heights. It was
    // 5.2, tuned by eye for two digits, which let three-digit levels run under
    // the first heart — asserted now in ui-layout.test.ts, which models rendered
    // text width rather than only comparing rects. Four digits would still
    // overlap; that is level 1000, past any real session, and widening further
    // collides with the cores readout on a 375px phone.
    livesRow: compact
      ? { x: left + labelPx * 5.6, y: top + row1H / 2 }
      : { x: left, y: top + row1H + row2H / 2 },
    // In compact+inline the cluster's runway ends at the BAR, not at the
    // cores: the old bound let BEST and the streak glyph draw straight
    // through the bar fill on any phone wide enough to keep the bar inline.
    livesMaxW: compact
      ? Math.max(
          0,
          (barOwnRow ? coresX - coresW - 12 : shareBar.x - 10) - (left + labelPx * 5.6),
        )
      : Math.max(0, right - left),
    /**
     * Where the objective readout goes when the row-1 cluster has no room.
     * Null means "the cluster has room, draw it there" — see the renderer.
     */
    objective: objectiveW > 0 ? { x: left, y: shareBar.y - 1, w: objectiveW, h: BAR_H + 2 } : null,
    shareBar,
    cores: { x: coresX, y: top + iconR },
    shopButton,
    pause,
    mute,
    ticker: { x: right, y: top + hudBandH + 6 },
    tickerH,
    tickerLines,
    coachBanner,
    coachSkip,
    ratioToggle,
    abilityButtons,
    pauseMenu: {
      panel: pm.panel,
      rows: pm.rows,
      resume: pm.rows[0]!,
      restart: pm.rows[1]!,
      shop: pm.rows[2]!,
      daily: pm.rows[3]!,
      progress: pm.rows[4]!,
      help: pm.rows[5]!,
      settings: pm.rows[6]!,
      exit: pm.rows[7]!,
      columns: pm.columns,
    },
    shop: { panel: sh.panel, rows: sh.rows, tabs: shopTabs, close: shClose, columns: sh.columns },
    settings: {
      panel: st.panel,
      rows: st.rows,
      close: footerButton(st.panel),
      columns: st.columns,
    },
    // The help card reuses the shop panel on purpose. It used to draw into the
    // pause panel while placing its CLOSE at shop.close — two different
    // panelGrid calls — so the button hung 11-16 px below the card on every
    // viewport, and nothing hit-tested it. The shop panel already reserves
    // footerH for exactly this button and is already asserted to fit.
    help: { panel: sh.panel, close: shClose },
    // The map screen reuses the shop panel for the same reason help does: the
    // panel already reserves its footer for exactly this CLOSE button, and it
    // is already asserted to fit on every viewport.
    map: { panel: sh.panel, close: shClose },
    overlay: {
      shop: { x: cssW / 2 - ovW - ovGap / 2, y: ovY, w: ovW, h: MIN_TAP },
      daily: { x: cssW / 2 + ovGap / 2, y: ovY, w: ovW, h: MIN_TAP },
      // Centred single button, for before the daily unlocks. Drawing UPGRADES
      // in its two-up slot with nothing beside it reads as a missing button.
      solo: { x: cssW / 2 - ovW / 2, y: ovY, w: ovW, h: MIN_TAP },
      progress: ovProgress,
      body: ovBody,
    },
  };
}

/**
 * Screen bands the board must not be drawn under. Only the HUD rows are
 * reserved — menus and overlays sit on top of a paused board on purpose.
 */
export function reservedInsets(layout: UiLayout, safe: Insets): Insets {
  return {
    // The ticker is deliberately NOT reserved. It is transient — three seconds
    // of "WARLORD ATTACKS YOU" — and reserving a permanent band for it cost a
    // portrait phone 38 CSS px of playfield forever. It draws over the board
    // instead, behind a scrim so it stays readable on top of a node. An earlier
    // pass reserved it because the un-scrimmed text was unreadable over the
    // playfield; the scrim is the actual fix, and it is free.
    top: safe.top + PAD + layout.hudBandH + 6,
    right: safe.right,
    bottom: safe.bottom + BOTTOM_BAR_H,
    left: safe.left,
  };
}

/**
 * Which chrome control a screen-space point hits, if any.
 *
 * `coachSkip` is tested FIRST and the caller only offers it while the
 * onboarding is live, so it cannot swallow board taps once it is gone. It sits
 * over the playfield, so a stale hit here would eat a send.
 */
export function hitUiButton(
  layout: UiLayout,
  x: number,
  y: number,
  coachVisible = false,
  pauseAvailable = true,
  playingControls = false,
  abilityCount = 0,
): UiButton | null {
  if (coachVisible && inRect(layout.coachSkip, x, y)) return "coachSkip";
  if (inRect(layout.mute, x, y)) return "mute";
  // `togglePause` handles neither the start card nor the result overlay, so on
  // those two screens the icon was drawn, hover-highlighted, hit-tested — and
  // did nothing. On the start card it was worse than nothing: the hit consumed
  // the tap, so the one control on screen ("TAP TO PLAY") failed there too.
  // Mute stays live on both; silencing the title music is a real thing to want.
  if (pauseAvailable && inRect(layout.pause, x, y)) return "pause";
  // Playing-scope controls: on the start card a bottom-left tap must start
  // the game and a top-right tap must not open a menu over the card; under a
  // menu both are scenery, not controls.
  if (playingControls && inRect(layout.ratioToggle, x, y)) return "ratio";
  if (playingControls && inRect(layout.shopButton, x, y)) return "shop";
  // Ability buttons: only the first `abilityCount` slots are live — the app
  // passes how many buttons it actually drew (the coachSkip rule again: a hit
  // box that outlives its button eats board taps forever).
  if (playingControls) {
    for (let i = 0; i < abilityCount && i < layout.abilityButtons.length; i++) {
      if (inRect(layout.abilityButtons[i]!, x, y)) return `ability${i as 0 | 1 | 2}`;
    }
  }
  return null;
}

export function hitPauseMenu(
  layout: UiLayout,
  x: number,
  y: number,
): PauseAction | "panel" | "outside" {
  const m = layout.pauseMenu;
  for (let i = 0; i < PAUSE_ACTIONS.length; i++) {
    if (inRect(tappable(m.rows[i]!), x, y)) return PAUSE_ACTIONS[i]!;
  }
  if (inRect(m.panel, x, y)) return "panel";
  return "outside"; // tap outside = resume
}

export function hitSettingsMenu(
  layout: UiLayout,
  x: number,
  y: number,
): SettingsAction | "close" | "panel" | "outside" {
  if (inRect(tappable(layout.settings.close), x, y)) return "close";
  for (let i = 0; i < SETTINGS_ACTIONS.length; i++) {
    if (inRect(tappable(layout.settings.rows[i]!), x, y)) return SETTINGS_ACTIONS[i]!;
  }
  if (inRect(layout.settings.panel, x, y)) return "panel";
  return "outside";
}

/**
 * The help card has one control, and it used to be decorative — any tap
 * anywhere dismissed the card, including a tap on the text someone had opened
 * it to read. "panel" is the case that must do nothing.
 */
export function hitHelpCard(
  layout: UiLayout,
  x: number,
  y: number,
): "close" | "panel" | "outside" {
  if (inRect(tappable(layout.help.close), x, y)) return "close";
  if (inRect(layout.help.panel, x, y)) return "panel";
  return "outside";
}

export function hitShopMenu(layout: UiLayout, x: number, y: number): ShopHit {
  if (inRect(tappable(layout.shop.close), x, y)) return "close";
  // Tabs before rows: the strip sits directly above row 0 and its tappable
  // box must win the boundary, or a tab tap on a short panel buys something.
  for (let i = 0; i < layout.shop.tabs.length; i++) {
    if (inRect(tappable(layout.shop.tabs[i]!), x, y)) return { kind: "tab", index: i };
  }
  for (let i = 0; i < layout.shop.rows.length; i++) {
    if (inRect(tappable(layout.shop.rows[i]!), x, y)) return { kind: "row", index: i };
  }
  if (inRect(layout.shop.panel, x, y)) return "panel";
  return "outside";
}

export function hitOverlayButton(
  layout: UiLayout,
  x: number,
  y: number,
  dailyLocked = false,
  hasStrip = true,
): "shop" | "daily" | "progress" | null {
  // The strip is checked FIRST: everywhere else on the overlay a tap means
  // "continue", so a strip that lost the hit-order race would start the next
  // level under the finger that wanted the map. `hasStrip` is the caller's
  // knowledge of the overlay DATA — daily overlays carry no path, and a rect
  // that hit-tests while nothing is drawn is a phantom affordance.
  if (hasStrip && layout.overlay.progress && inRect(layout.overlay.progress, x, y))
    return "progress";
  // Locked: one centred button, and DAILY's rect must not be live — a hit on
  // empty space that silently starts a level-12 board is worse than no button.
  if (dailyLocked) return inRect(tappable(layout.overlay.solo), x, y) ? "shop" : null;
  if (inRect(tappable(layout.overlay.shop), x, y)) return "shop";
  if (inRect(tappable(layout.overlay.daily), x, y)) return "daily";
  return null;
}

/**
 * The map screen has one control, exactly like the help card — and the same
 * rule applies: a tap on the map's own content must do nothing, or the screen
 * dismisses under a player who is looking at it.
 */
export function hitMapScreen(
  layout: UiLayout,
  x: number,
  y: number,
): "close" | "panel" | "outside" {
  if (inRect(tappable(layout.map.close), x, y)) return "close";
  if (inRect(layout.map.panel, x, y)) return "panel";
  return "outside";
}

/**
 * Which app state a chrome id belongs to. `hitAnyChrome` needs it to know which
 * panel is on screen, and the test suite needs it to know which scope to ask a
 * given rect about.
 */
export type ChromeScope =
  | "start"
  | "playing"
  | "paused"
  | "over"
  | "shop"
  | "help"
  | "settings"
  | "map";

/** The scope each interactiveRects entry is reachable in. */
export function scopeForChrome(name: string): ChromeScope {
  if (name.startsWith("pause.")) return "paused";
  if (name.startsWith("shop.")) return "shop";
  if (name.startsWith("settings.")) return "settings";
  if (name.startsWith("help.")) return "help";
  if (name.startsWith("map.")) return "map";
  if (name.startsWith("overlay.")) return "over";
  return "playing";
}

/**
 * Whatever chrome control sits under a point, as a stable id.
 *
 * Composed from the hit functions above, in the app's own priority order, so
 * hover, press and click can never resolve a point differently — which is the
 * whole reason this exists rather than a second set of rect tests. Action
 * routing still goes through the individual hit functions; this is for paint.
 */
export function hitAnyChrome(
  layout: UiLayout,
  x: number,
  y: number,
  scope: ChromeScope,
  coachVisible = false,
  overlayHasStrip = true,
  // Defaults to ALL slots live so the interactiveRects sweep exercises them;
  // the renderer passes the real count it drew this frame.
  abilityCount = 3,
): string | null {
  const btn = hitUiButton(
    layout,
    x,
    y,
    coachVisible && (scope === "playing" || scope === "start"),
    true,
    scope === "playing",
    scope === "playing" ? abilityCount : 0,
  );
  if (btn) return btn;

  if (scope === "paused") {
    const a = hitPauseMenu(layout, x, y);
    return a === "panel" || a === "outside" ? null : `pause.${a}`;
  }
  if (scope === "shop") {
    const h = hitShopMenu(layout, x, y);
    if (typeof h === "object") return h.kind === "tab" ? `shop.tab${h.index}` : `shop.row${h.index}`;
    return h === "close" ? "shop.close" : null;
  }
  if (scope === "settings") {
    const h = hitSettingsMenu(layout, x, y);
    if (h === "panel" || h === "outside") return null;
    return h === "close" ? "settings.close" : `settings.${h}`;
  }
  if (scope === "help") {
    return hitHelpCard(layout, x, y) === "close" ? "help.close" : null;
  }
  if (scope === "map") {
    return hitMapScreen(layout, x, y) === "close" ? "map.close" : null;
  }
  if (scope === "over") {
    const b = hitOverlayButton(layout, x, y, false, overlayHasStrip);
    return b ? `overlay.${b}` : null;
  }
  return null;
}

/** Every interactive rect, for tests and for a debug overlay. */
export function interactiveRects(layout: UiLayout): Array<{ name: string; rect: Rect }> {
  return [
    { name: "pause", rect: layout.pause },
    { name: "mute", rect: layout.mute },
    ...PAUSE_ACTIONS.map((a, i) => ({
      name: `pause.${a}`,
      rect: tappable(layout.pauseMenu.rows[i]!),
    })),
    // The onboarding skip lives over the playfield rather than in a panel, so
    // it is the one control that can be pushed off a notched screen entirely.
    { name: "coachSkip", rect: layout.coachSkip },
    { name: "ratio", rect: layout.ratioToggle },
    { name: "shop", rect: layout.shopButton },
    // Over the playfield like coachSkip, and gated the same way at hit time
    // (abilityCount); the sweep enforces geometry for all three slots.
    ...layout.abilityButtons.map((rect, i) => ({ name: `ability${i}`, rect })),
    ...layout.shop.tabs.map((rect, i) => ({ name: `shop.tab${i}`, rect: tappable(rect) })),
    ...layout.shop.rows.map((rect, i) => ({ name: `shop.row${i}`, rect: tappable(rect) })),
    { name: "shop.close", rect: tappable(layout.shop.close) },
    // Same rect as shop.close by construction (the card reuses that panel), but
    // a distinct control in a distinct scope — so it gets swept too.
    { name: "help.close", rect: tappable(layout.help.close) },
    { name: "map.close", rect: tappable(layout.map.close) },
    ...SETTINGS_ACTIONS.map((a, i) => ({
      name: `settings.${a}`,
      rect: tappable(layout.settings.rows[i]!),
    })),
    { name: "settings.close", rect: tappable(layout.settings.close) },
    { name: "overlay.shop", rect: tappable(layout.overlay.shop) },
    { name: "overlay.daily", rect: tappable(layout.overlay.daily) },
    // Present only on viewports tall enough to carry it — the sweeps cover it
    // exactly where the game offers it.
    ...(layout.overlay.progress
      ? [{ name: "overlay.progress", rect: layout.overlay.progress }]
      : []),
  ];
}
