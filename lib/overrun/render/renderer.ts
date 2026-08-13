import { COACH_STEPS, type CoachView } from "../app/coach";
import { CONTROL_LINES } from "../input/bindings";
import type { AbilityKey, ProgressEntry } from "../app/run";
import type { HotView } from "../input/input";
import type { Faction, GameState, Node, Packet } from "../sim/state";
import {
  KIND_BEACON,
  KIND_FACTORY,
  KIND_FORTRESS,
  KIND_CORRUPTER,
  KIND_NURSERY,
  KIND_RELAY,
  KIND_SIPHON,
  KIND_TURRET,
  KIND_RIFT,
  KIND_VAULT,
  KIND_VOLATILE,
  NEUTRAL,
  PLAYER,
  WORLD_W,
  WORLD_H,
} from "../sim/state";
import {
  NODE_R,
  OVERCHARGE_TICKS,
  STASIS_TICKS,
  TURRET_RANGE,
  UPGRADE_TICKS,
  VOLATILE_RADIUS,
} from "../sim/constants";
import { dist, prodInterval } from "../sim/tick";
import {
  bakeBiomeBg,
  biomeIndexForLevel,
  bakeVignette,
  biomeForLevel,
  chevronPos,
  drawCoreIcon,
  drawFlagIcon,
  drawHeartIcon,
  drawMuteIcon,
  drawSigilBadge,
  drawPauseIcon,
  drawStarIcon,
  Dust,
  fullness,
  KindSprites,
  packetHash,
  ParticlePool,
  Shake,
  SpriteCache,
  Ticker,
  KIND_NAMES,
  KIND_VERBS,
  TRACK_ICONS,
  TRACK_TINT,
  type ShopIconKey,
} from "./fx";
import { bossKindForLevel, introNoteForLevel } from "../sim/level";
import {
  applyCamera,
  computeCamera,
  contentBox,
  downVector,
  FULL_CONTENT,
  lightVector,
  NO_INSETS,
  screenRight,
  screenToWorld as camScreenToWorld,
  worldToScreen as camWorldToScreen,
  THETA_LANDSCAPE,
  THETA_PORTRAIT,
  type Camera,
  type CameraOverrides,
  type ContentBox,
  type Insets,
  type Viewport,
} from "./camera";
import {
  HOME_VIEW,
  animDone,
  clampView,
  composeView,
  maxZoom,
  panBy,
  playZoom,
  sampleAnim,
  zoomAt,
  type ViewAnim,
  type ViewState,
} from "./view";
import {
  computeUiLayout,
  heartCenters,
  hitAnyChrome,
  hitHelpCard,
  hitMapScreen,
  hitOverlayButton,
  hitPauseMenu,
  hitSettingsMenu,
  hitShopMenu,
  hitUiButton,
  PAUSE_ACTIONS,
  reservedInsets,
  SETTINGS_ACTIONS,
  SHOP_TABS,
  type ChromeScope,
  type PauseAction,
  type Rect,
  type SettingsAction,
  type ShopHit,
  type UiButton,
  type UiLayout,
} from "./ui-layout";
import {
  FACTION_COLORS,
  FACTION_DIM,
  FACTION_NAMES,
  GOLD_HEX,
  inkOn,
  inkOnAlpha,
  P_WHITE,
  P_EMBER,
  SEMANTIC,
  UI_ACCENT,
  UI_ACCENT_RGB,
  UI_INK,
  UI_PANEL,
  UI_PLAYER,
  UI_SCRIM,
} from "./palette";
import { LEVEL_STEPS } from "../audio/audio";
import { pulse as pulseAt, reducedMotion, type MotionPref } from "./motion";
import { DEV_HANDLES } from "../dev";
import { easeOut, lerp, progress } from "./ease";

/**
 * Canvas 2D renderer. Reads sim state (+ input drag state via getter), never
 * mutates either. World is a fixed 160×90 board with a subtle 2.5D tilt,
 * fit-contained with letterboxing, legible from 907×510 to 1920×1080 and on
 * mobile in both orientations.
 *
 * All animation state in here is presentation-only, keyed to wall-clock time.
 */

/**
 * Packet pips (see drawPackets). Above this many in flight the per-packet blit
 * stops being worth it and the old stroke path takes over — a wall of 900
 * additive sprites reads as a smear anyway, so nothing is lost visually.
 */
const PIP_BUDGET = 900;
/** Lateral spread of a stream, world units either side of the lane centre. */
const PIP_SPREAD = 0.85;
/** Ticks of along-lane jitter, so pips don't advance in ranks. */
const PIP_STAGGER = 1.4;
/** Trail length behind each pip, world units. */
const PIP_TRAIL = 2.2;
const PIP_TRAIL_W = 0.55;

const CROSSFADE_MS = 250;
const FLIP_POP_MS = 200;
const DEPOSIT_POP_MS = 120;
const INTRO_MS = 1400;
/** Chrome open/close duration. Short enough that input never feels held up. */
const MENU_MS = 150;
/** Coach banner slide in/out. */
const COACH_MS = 180;

/** The full-screen chrome layers. Exactly one is "current" at a time. */
type ChromeLayer =
  | "none"
  | "startCard"
  | "help"
  | "settings"
  | "shop"
  | "paused"
  | "overlay"
  | "map";

/**
 * Scrim opacity per layer, hoisted out of the individual draw functions so a
 * swap crossfades one scrim instead of stacking two.
 */
const SCRIM: Record<ChromeLayer, number> = {
  none: 0,
  startCard: 0.82,
  help: 0.86,
  settings: 0.8,
  shop: 0.8,
  paused: 0.72,
  overlay: 0.72,
  map: 0.86,
};
/**
 * Cached, and now shared with fx.ts — see render/motion.ts for why it moved
 * and how the player override interacts with the OS setting.
 */
const REDUCED_MOTION = reducedMotion;

function readCameraOverrides(): CameraOverrides {
  // Capture-pipeline affordance, not a player-facing feature: it pins the board
  // rotation so a portrait capture does not depend on which way the level
  // happens to face. Gated so a URL parameter cannot change the camera in the
  // shipped game — see src/dev.ts.
  if (!DEV_HANDLES) return {};
  const q = new URLSearchParams(window.location.search).get("theta");
  if (q === "landscape") return { theta: THETA_LANDSCAPE };
  if (q === "portrait") return { theta: THETA_PORTRAIT };
  return {};
}

/**
 * Canvas font families, resolved by the host page. next/font hashes family
 * names, so the site probes them off the DOM (lib/overrun/fonts.ts) and hands
 * them in — the renderer never guesses at CSS.
 */
export interface GameFonts {
  /** Jersey 15 — big display text only. Ships weight 400 only. */
  display: string;
  /** Silkscreen — micro-labels, HUD, buttons. */
  pixel: string;
}

export interface DragView {
  active: boolean;
  fromNodeId: number;
  /**
   * Every source the drag has collected, in recruitment order — dragging
   * through more of your own balls adds them, and release sends from all of
   * them at once. Invariant: fromNodeIds[0] === fromNodeId, so everything
   * keyed to "the" source (tap logic, hover exclusion, keyboard aim) keeps
   * reading fromNodeId untouched.
   */
  fromNodeIds: number[];
  wx: number;
  wy: number;
  hoverNodeId: number | null;
}

export interface OverlayView {
  /**
   * The Daily Challenge is not open to this player yet, so its button is not
   * drawn and UPGRADES takes the centred slot. See DAILY_UNLOCK_CLEARED.
   */
  dailyLocked?: boolean;
  /** Keyboard menu cursor: 0 continue, 1 upgrades, 2 daily (absent when locked). */
  menuCursor?: number | null;
  /**
   * Third-plus gauntlet failure: the daily slot becomes SKIP PUZZLE. The
   * anti-softlock — gauntlet losses cost nothing, so without this a player
   * who cannot crack the puzzle has NO path forward at all (a run-over
   * checkpoint would resume onto the same board).
   */
  skipPuzzle?: boolean;
  kind: "won" | "lost" | "runover" | "daily-won" | "daily-lost";
  lives?: number;
  reachedLevel?: number;
  bestLevel?: number;
  /** Cores banked (win/runover/daily overlays). */
  cores?: number;
  /** Stars earned on a won level (1–3). */
  stars?: number;
  /** Where the next run starts — the banked checkpoint, not always level 1. */
  resumeLevel?: number;
  /** Set on a win that banked a new checkpoint, so it can be called out. */
  checkpointBanked?: boolean;

  /* The retention fields below are all computed by the app layer (main.ts) —
   * the renderer displays strings and counts, it derives nothing. That keeps
   * one owner for the progression rules. */

  /** Career star total, shown small under this level's stars. */
  totalStars?: number;
  /** Cores paid by crossing a star-total threshold this win, if any. */
  starBonus?: number;
  /** Forward-looking goal ("NEXT CHECKPOINT · LEVEL 15 (2 AWAY)"). */
  nextGoal?: string;
  /** Loss postmortem ("HELD 4 OF 9 BALLS · 71S"). */
  postmortem?: string;
  /**
   * The retry board will be a different verified layout. This has been true
   * since the board screen shipped, and it read as a BUG while unannounced —
   * a player who lost and memorised the map got a different one silently.
   */
  newBoardOnRetry?: boolean;
  /** Daily streak line ("DAY 3 · TOMORROW PAYS 45"). */
  dailyStreak?: string;
  /** One-shot beat on the win that unlocks the daily. */
  dailyUnlockedNow?: boolean;
  /**
   * The progress strip's path window, centred on where the player goes next.
   * Computed by the app layer at overlay creation; tapping the strip opens
   * the full map. Absent on the daily overlays — the daily is off the path.
   */
  progress?: ProgressEntry[];
}

/** App-layer HUD data (run progression lives outside the sim). */
export interface HudView {
  lives: number;
  maxLives: number;
  bestLevel: number;
  streak: number;
  cores: number;
  /** Something in the shop is buyable — lights the cores readout + button. */
  canAfford?: boolean;
  paused: boolean;
  /** Set while playing the daily challenge ("DAILY · MUTATOR NAME"). */
  dailyName?: string;
  /** Node id currently showing the upgrade chevron, if any. */
  chevronNodeId?: number | null;
  /** One-time teaching nudge: node spotlit with pulse ring + unprompted chevron. */
  nudgeNodeId?: number | null;
  /** After the nudge has fired once, faint standing chevrons on eligible unselected nodes. */
  showDimChevrons?: boolean;
  /** Show the branded start card over a live, AI-only board. */
  startCard?: boolean;
  /** Show the how-to-play reference card (from pause). */
  help?: boolean;
  /** Show the level-map screen (from pause, or by tapping the strip). */
  map?: boolean;
  /** The map screen's path window. Computed by the app layer, like all of it. */
  mapPath?: ProgressEntry[];
  /** Returning players get a small progress strip on the start card. */
  startPath?: ProgressEntry[];
  /** Show the settings panel (from pause). */
  settings?: boolean;
  /** RESTART RUN has been pressed once and is waiting for confirmation. */
  restartArmed?: boolean;
  /** Keyboard menu cursor, or null when the player is using a pointer. */
  menuCursor?: number | null;
  /** Volume steps 0..3 and the motion preference, for the settings rows. */
  musicLevel?: number;
  sfxLevel?: number;
  motionPref?: MotionPref;
  /** Live onboarding step, or null when finished/skipped. */
  coach?: CoachView | null;
  /** Send ratio for the bottom-left toggle and the drag preview, in (0, 1]. */
  sendFraction?: number;
  /**
   * Objective banner line ("HOLD THE MARKED BALL · 12S TO GO"), or null on
   * annihilation / while the coach owns the same slot. App-built, like all of
   * HudView — the renderer displays and derives nothing.
   */
  objective?: string | null;
  /**
   * The in-level ability buttons, in display order (top to bottom, keys
   * 1/2/3). Null/empty = a player who owns no ability, and the buttons — and
   * their hit boxes — do not exist. Charges are live counts from the sim.
   */
  abilities?: Array<{ key: AbilityKey; charges: number }> | null;
  /**
   * The ability awaiting a target (overcharge/stasis only — recall fires
   * immediately). Drives the board dim + legal-target pulse. App state, never
   * sim state: arming is aiming, not acting.
   */
  armedAbility?: AbilityKey | null;
}

/** Upgrade shop view-model, built by the app layer from TRACKS/ABILITIES + save. */
export interface ShopView {
  cores: number;
  /** Active SHOP_TABS index; rows below belong to this tab. */
  tab: number;
  /**
   * `key` picks the row's tint + icon (TRACK_TINT/TRACK_ICONS in fx.ts) —
   * rows used to be resolved positionally against run.ts's TRACKS table,
   * which breaks the moment the shop shows anything that is not exactly
   * that table in that order (tabs, abilities, cosmetics).
   */
  rows: Array<{ key: string; name: string; desc: string; cost: number | null; tier: number; maxTier: number; affordable: boolean }>;
  /** RESTART RUN has been pressed once and is waiting for confirmation. */
  restartArmed?: boolean;
  /** Keyboard menu cursor, or null when the player is using a pointer. */
  menuCursor?: number | null;
}

interface FlipRecord {
  at: number;
  oldOwner: Faction;
}

interface Zap {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
  at: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  /**
   * The EFFECTIVE camera every consumer reads: the fit camera composed with
   * the pan/zoom view. At the home view this IS `fitCam`, object-identical,
   * which is what keeps every fit-era guarantee intact for a player who
   * never touches the camera.
   */
  private cam: Camera;
  /** The home framing — computeCamera's crop-nothing fit. */
  private fitCam: Camera;
  /** Pan/zoom over the fit. HOME_VIEW unless the player (or an anim) moved it. */
  private view: ViewState = { ...HOME_VIEW };
  private viewAnim: ViewAnim | null = null;
  /** Viewport + insets the view math needs; refreshed in applyCameraFit. */
  private viewVp: Viewport = { cssW: 64, cssH: 36, dpr: 1 };
  private viewInsets: Insets = NO_INSETS;
  /** Sprite bake bookkeeping: bakes happen at quantized zoom buckets. */
  private bakedScale = 0;
  private lastBakeAt = -1e9;
  /** Screen-space chrome geometry, in CSS pixels. */
  private layout: UiLayout;
  /** Device notch / home-indicator insets, read from CSS env(). */
  private safe: Insets = NO_INSETS;
  private content: ContentBox = FULL_CONTENT;
  /**
   * Pinned camera behaviour, for the video capture pipeline only. Read once
   * from the query string: `?theta=landscape|portrait` stops the framing from
   * flipping between scenes in a multi-scene clip.
   */
  private cameraOverrides: CameraOverrides = readCameraOverrides();
  /**
   * Derived from `cam`, which only changes on resize or level change. These are
   * read several times per node per frame, so recomputing (and allocating) them
   * per call is the kind of churn ParticlePool exists to avoid.
   */
  private downCache = { x: 0, y: 1 };
  private lightCache = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
  private boundsCache: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** Extent of the board along the screen-down axis — the dscale denominator. */
  private downExtent = WORLD_H;

  private flips = new Map<number, FlipRecord>();
  private lastOwners = new Map<number, Faction>();
  private lastUnits = new Map<number, number>();
  private depositPopAt = new Map<number, number>();
  private lastSizes = new Map<number, number>();
  private upgradePopAt = new Map<number, number>();
  /** node id -> wall-clock ms a volatile detonated, for the shockwave ring. */
  private blasts = new Map<number, number>();
  private lastHitKickAt = 0;
  /**
   * Which full-screen chrome layer is up, and which one is leaving.
   *
   * render() used to be an `else if` chain over these, so exactly one drew per
   * frame and a CLOSE animation had nowhere to live at all. Because the
   * outgoing and incoming layers always change on the same frame, one clock is
   * enough: close progress is simply 1 - t.
   */
  private chrome: ChromeLayer = "none";
  private chromePrev: ChromeLayer = "none";
  private chromeAt = 0;
  /**
   * Last live view-models, held so an outgoing layer can finish drawing.
   * shopView() returns null the instant appState leaves "shop" and overlay is
   * nulled in startLevel, so on the FIRST frame of a close animation the data
   * the outgoing layer needs is already gone. No cloning: main.ts allocates
   * these fresh every frame and never mutates them.
   */
  private lastShop: ShopView | null = null;
  private lastOverlay: OverlayView | null = null;
  /** Same contract as lastShop: the map's close fade outlives its data. */
  private lastMapPath: ProgressEntry[] | null = null;
  /**
   * Fade of the chrome layer currently being drawn.
   *
   * The layer draw functions set globalAlpha themselves (the overlay's
   * staggered body, the start card's breathing prompt, the shop's flash), so
   * an alpha assigned by the dispatcher would just be overwritten. They
   * multiply through this instead — see `alphaIn`.
   */
  private layerAlpha = 1;
  private coachAt = 0;
  private coachStep = -1;
  private coachOut: CoachView | null = null;
  private coachOutAt = 0;
  private shopCoresShown = 0;
  private shopCoresAt = 0;
  /** Set by the app on a buy attempt; drives the row's success/denial flash. */
  private shopFlash: { row: number; ok: boolean; at: number } | null = null;
  /** node id -> when a hostile packet last landed, for the reduced-motion flash. */
  private hitFlashAt = new Map<number, number>();
  private particles = new ParticlePool();
  private sprites = new SpriteCache();
  private kinds = new KindSprites();
  private dust = new Dust();
  private ticker = new Ticker();

  /**
   * Say something to the player on the HUD ticker.
   *
   * The app layer needs this to explain a refusal — "the daily unlocks at
   * level 5" — because a control that does nothing and says nothing is a
   * dead end; a button should always indicate how to proceed.
   */
  say(text: string): void {
    this.ticker.push(text, PLAYER);
  }
  private shake = new Shake();
  private vignette: HTMLCanvasElement | null = null;
  private biomeBg: HTMLCanvasElement | null = null;
  /** Biome INDEX the background was baked for (-1 = force rebake). */
  private biomeLevel = -1;

  /** `level:seed` of the board last drawn — a change is a level transition. */
  private lastBoardKey: string | null = null;
  private boardSwapAt = -1e9;
  /** Selection settle clocks, per node id (rising edge of `selected`). */
  private selAt = new Map<number, number>();

  /** Hover-ease clocks per chrome id — buttons transition instead of stepping. */
  private hoverClock = new Map<string, { hot: boolean; at: number }>();

  /** Death marks: a fallen faction's sigil blooming over its last node. */
  private fallenAt = new Map<Faction, { at: number; x: number; y: number }>();
  /** Last node each faction held while alive — the mark's position source. */
  private lastHeld = new Map<Faction, { x: number; y: number }>();

  /**
   * Eased hover progress for a chrome id: 0 = resting, 1 = fully hot. Records
   * the flip time on each state change, so both directions animate. ~110 ms —
   * fast enough to feel attached to the cursor, slow enough to read as motion.
   */
  private hoverEase(id: string, hot: boolean): number {
    const now = performance.now();
    let rec = this.hoverClock.get(id);
    if (!rec) {
      // First sighting: start settled in the current state, no animation.
      rec = { hot, at: -1e9 };
      this.hoverClock.set(id, rec);
    } else if (rec.hot !== hot) {
      rec.hot = hot;
      rec.at = now;
    }
    const t = progress(now, rec.at, 110, REDUCED_MOTION());
    return rec.hot ? t : 1 - t;
  }
  /** Flow-lane fade clocks: live lanes keyed by source node id. */
  private laneIn = new Map<number, { at: number; to: number }>();
  /** Lanes that just ended, fading out — the only feedback a CANCEL has. */
  private laneOut = new Map<number, { at: number; to: number; owner: Faction }>();

  private prevPackets: Packet[] = [];
  private zaps: Zap[] = [];
  private turretAim = new Map<number, number>();
  private factionAlive = [false, false, false, false, false];
  private threatAnnounced = new Set<number>();

  private hudShares: number[] = [0.5, 0.5, 0, 0, 0];
  private lastFrameAt = 0;

  private introLevel = -1;
  private introAt = 0;
  private lastTick = -1;

  private overlayAt = 0;
  private overlayKind: OverlayView["kind"] | null = null;
  private confettiWaves = 0;

  /** Final-blow zoom-punch state. */
  private winFocus: { x: number; y: number; at: number } | null = null;

  /** Rolling average render cost in ms, exposed for perf verification. */
  lastRenderMs = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private getDrag: () => DragView | null = () => null,
    private getMuted: () => boolean = () => false,
    /** Hover/press state. A getter, like getDrag — this is INPUT state, and
     *  routing it through HudView would allocate it fresh every frame. */
    private getHot: () => HotView = () => ({ hot: null, pressed: null }),
    private fonts: GameFonts = {
      display: "ui-monospace, monospace",
      pixel: "ui-monospace, monospace",
    },
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas not supported");
    this.ctx = ctx;
    // Provisional values so the fields are initialised before resize() runs.
    this.layout = computeUiLayout(64, 36, NO_INSETS);
    this.fitCam = computeCamera({ cssW: 64, cssH: 36, dpr: 1 }, NO_INSETS, FULL_CONTENT);
    this.cam = this.fitCam;
    this.resize();

    // The game is a component in a page, not the whole viewport — observe the
    // canvas box itself. Also catches the mobile URL bar collapsing, which
    // resizes the container without firing a window resize on some browsers.
    // ResizeObserver batches to frame boundaries, so no rAF coalescing needed.
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
  }

  private resizeObserver: ResizeObserver | null = null;

  /** Unmount path — release the observer so remounts don't stack them. */
  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  /** Jersey 15. Ships weight 400 only — never ask canvas for synthetic bold. */
  private displayFont(size: number): string {
    return `${size}px ${this.fonts.display}`;
  }

  /** Silkscreen — the micro-label face. */
  private pixelFont(size: number, bold = false): string {
    return `${bold ? "bold " : ""}${size}px ${this.fonts.pixel}`;
  }

  /** ♥ ★ ☆ ◈ × aren't in Jersey 15 or Silkscreen; those glyphs stay on the
   *  system stack. */
  private glyphFont(size: number): string {
    return `bold ${size}px system-ui, sans-serif`;
  }

  /** The level's board half-extents; the dscale denominator keys off them. */
  private worldHalf: ContentBox = FULL_CONTENT;

  /** Re-fit the camera to a level's actual node spread. */
  setContent(nodes: readonly Node[], half: ContentBox = FULL_CONTENT): void {
    const next = contentBox(nodes, half);
    const halfChanged = half.rx !== this.worldHalf.rx || half.ry !== this.worldHalf.ry;
    this.worldHalf = half;
    if (!halfChanged && next.rx === this.content.rx && next.ry === this.content.ry) return;
    this.content = next;
    this.applyCameraFit();
  }

  /** Cached per-camera vectors — recomputed only when the camera changes. */
  private cacheCameraDerived(): void {
    this.downCache = downVector(this.cam);
    this.lightCache = lightVector(this.cam);
    this.boundsCache = null;
    // Depth shading is normalised across the board's extent along the *screen*
    // vertical, which is the world height in landscape and the world width once
    // the board is quarter-turned. Using one constant for both left half the
    // board in a flat clamped zone in portrait. Per-level extents, or a 2×
    // board's shading flattens across its middle half.
    this.downExtent =
      Math.abs(this.downCache.x) * 2 * this.worldHalf.rx +
      Math.abs(this.downCache.y) * 2 * this.worldHalf.ry;
  }

  private applyCameraFit(): void {
    const cssW = Math.max(64, this.canvas.clientWidth || window.innerWidth);
    const cssH = Math.max(36, this.canvas.clientHeight || window.innerHeight);
    const prevFit = this.fitCam;
    this.viewVp = { cssW, cssH, dpr: this.dpr };
    // Menus and overlays sit over a paused board on purpose; only the HUD
    // rows are carved out of the playfield.
    this.viewInsets = reservedInsets(this.layout, this.safe);
    this.fitCam = computeCamera(this.viewVp, this.viewInsets, this.content, prevFit, this.cameraOverrides);
    // A quarter-turn mid-level resets the view home: preserving a panned
    // focus across a rotation is disorienting, and the hysteresis makes the
    // event rare. Otherwise the view is re-clamped against the new fit (a
    // resize can shrink the pannable range out from under a deep zoom).
    if (this.fitCam.theta !== prevFit.theta) {
      this.view = { ...HOME_VIEW };
      this.viewAnim = null;
    }
    this.view = clampView(this.view, this.fitCam, this.content, this.viewVp, this.viewInsets);
    this.cam = composeView(this.fitCam, this.view);
    this.cacheCameraDerived();
    // Fit changes are rare (resize, level swap, rotation) — always land an
    // exact bake immediately. Continuous zoom rebakes are rate-limited in
    // ensureBake, called per frame.
    this.ensureBake(performance.now(), true);
  }

  /** Recompose the effective camera after a view change. */
  private applyView(): void {
    this.cam = composeView(this.fitCam, this.view);
    this.cacheCameraDerived();
  }

  /**
   * Sprite bakes at quantized zoom buckets (1.25^k over the fit scale).
   *
   * A bake rebuilds ~35 offscreen canvases; doing that per pinch frame is
   * death on the 4 GB Chromebook. Between buckets the draw paths blit the
   * stale bake scaled — they size destinations in world units by dividing by
   * the BAKED scale, so a mismatched camera scale only costs ≤ ±12% GPU
   * scaling of radial gradients, which is visually free. Gestures also rate-
   * limit bakes to one per ~150 ms; viewGestureEnd() lands the exact bucket.
   */
  private ensureBake(now: number, force = false): void {
    const ratio = this.cam.scale / this.fitCam.scale;
    const k = Math.max(0, Math.round(Math.log(ratio) / Math.log(1.25)));
    const target = this.fitCam.scale * Math.pow(1.25, k);
    if (!force) {
      if (target === this.bakedScale) return;
      if (now - this.lastBakeAt < 150) return;
    }
    this.sprites.rebuild(target, this.lightCache, this.downCache);
    this.kinds.rebuild(target);
    this.particles.setDown(this.downCache);
    this.bakedScale = target;
    this.lastBakeAt = now;
  }

  /* ------------------------------------------------------- view controls */

  /** Pan by a CSS-pixel drag delta (input's empty-space drag / camera keys). */
  panViewBy(dxCss: number, dyCss: number): void {
    this.viewAnim = null;
    this.view = panBy(this.view, dxCss, dyCss, this.fitCam, this.viewVp, this.viewInsets, this.content);
    this.applyView();
  }

  /** Zoom by `factor` about a CSS-pixel anchor (wheel, pinch). */
  zoomViewAt(sxCss: number, syCss: number, factor: number): void {
    this.viewAnim = null;
    this.view = zoomAt(this.view, sxCss, syCss, factor, this.fitCam, this.viewVp, this.viewInsets, this.content);
    this.applyView();
  }

  /** Gesture finished — land the exact bake bucket immediately. */
  viewGestureEnd(): void {
    this.ensureBake(performance.now(), true);
  }

  isViewHome(): boolean {
    return this.view.zoom <= 1.001;
  }

  private animateViewTo(target: ViewState, ms: number): void {
    const to = clampView(target, this.fitCam, this.content, this.viewVp, this.viewInsets);
    if (REDUCED_MOTION() || ms <= 0) {
      this.viewAnim = null;
      this.view = to;
      this.applyView();
      this.ensureBake(performance.now(), true);
      return;
    }
    this.viewAnim = { from: { ...this.view }, to, at: performance.now(), ms };
  }

  /** Ease home to the fit framing. */
  refitView(ms = 250): void {
    this.animateViewTo({ ...HOME_VIEW }, ms);
  }

  /**
   * Double-tap / Home toggle: home ↔ a useful close-up about the given point.
   * The close-up target is the play zoom (comfortable ball size), floored at
   * a modest 1.5× so desktop — whose fit already clears the play scale —
   * still gets a meaningful inspect zoom.
   */
  toggleViewAt(sxCss: number, syCss: number): void {
    if (!this.isViewHome()) {
      this.refitView();
      return;
    }
    const zoom = Math.min(maxZoom(this.fitCam), Math.max(playZoom(this.fitCam), 1.5));
    const w = this.screenToWorld(sxCss, syCss);
    this.animateViewTo({ zoom, fx: w.x, fy: w.y }, 250);
  }

  /**
   * Keyboard follow: if a world point sits outside the visible region, ease
   * the camera the minimal distance that brings it comfortably inside.
   * Without this, arrow-key focus can select nodes a panned camera cannot
   * see — keyboard play must survive every camera state.
   */
  focusWorld(wx: number, wy: number): void {
    if (this.isViewHome()) return; // home shows everything by construction
    const vb = this.visibleWorldBounds();
    const margin = 12; // wu — a ball's width of comfort
    let dx = 0;
    let dy = 0;
    if (wx < vb.x0 + margin) dx = wx - (vb.x0 + margin);
    else if (wx > vb.x1 - margin) dx = wx - (vb.x1 - margin);
    if (wy < vb.y0 + margin) dy = wy - (vb.y0 + margin);
    else if (wy > vb.y1 - margin) dy = wy - (vb.y1 - margin);
    if (dx === 0 && dy === 0) return;
    const cur = this.viewAnim ? this.viewAnim.to : this.view;
    this.animateViewTo({ zoom: cur.zoom, fx: cur.fx + dx, fy: cur.fy + dy }, 200);
  }

  /** Reveal staged by the app for the NEXT board swap; consumed in render(). */
  private pendingReveal: { wx: number; wy: number } | null = null;

  /**
   * Stage the establishing shot for the board about to be handed over. The
   * app calls this when it starts a level whose board deserves one; the
   * board-swap block in render() consumes it, so ordering against the swap's
   * own camera reset can never go wrong.
   */
  stageIntroReveal(wx: number, wy: number): void {
    this.pendingReveal = { wx, wy };
  }

  /**
   * The big-board establishing shot: open at the fit (the whole map under the
   * LEVEL card), hold, then ease to the play zoom on the player's start.
   * Any camera input cancels it (direct manipulation nulls viewAnim). Under
   * reduced motion animateViewTo jumps straight to the play framing.
   */
  introReveal(wx: number, wy: number): void {
    const zoom = playZoom(this.fitCam);
    if (zoom <= 1.02) return; // the fit already IS the play framing
    this.view = { ...HOME_VIEW };
    this.applyView();
    const anim: ViewAnim = {
      from: { ...HOME_VIEW },
      to: clampView({ zoom, fx: wx, fy: wy }, this.fitCam, this.content, this.viewVp, this.viewInsets),
      at: performance.now() + 700, // the hold: sampleAnim clamps t below 0
      ms: 500,
    };
    if (REDUCED_MOTION()) {
      this.view = anim.to;
      this.applyView();
      this.ensureBake(performance.now(), true);
      return;
    }
    this.viewAnim = anim;
  }

  /** Read the device's safe-area insets, published as CSS custom properties. */
  private readSafeInsets(): Insets {
    const s = getComputedStyle(document.documentElement);
    const px = (name: string) => {
      const v = parseFloat(s.getPropertyValue(name));
      return Number.isFinite(v) ? v : 0;
    };
    return {
      top: px("--sat"),
      right: px("--sar"),
      bottom: px("--sab"),
      left: px("--sal"),
    };
  }

  private resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Measure our own box, not the viewport — the page's CSS owns the canvas
    // size here, so no style.width/height writes either. Floor: a zero-sized
    // container mid-navigation must not zero the transform; the observer
    // re-fires once real dimensions exist.
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(64, Math.round(rect.width));
    const h = Math.max(36, Math.round(rect.height));
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);

    // Layout depends only on the canvas box; the camera then fits the board
    // into what the layout did not claim. One-way dependency, no cycle.
    this.safe = this.readSafeInsets();
    this.layout = computeUiLayout(w, h, this.safe);
    // applyCameraFit already rebakes the sprite caches whenever they could have
    // gone stale, and needs no help here. It compares `scale` and `theta`, and
    // `scale` is `cssScale * dpr` — so a resize that changes only the device
    // pixel ratio still moves it and still triggers a rebake.
    //
    // There used to be an `if (before === this.cam) this.rebakeSprites()` after
    // this line, guarding the case where the camera "did not move". It could
    // never fire: applyCameraFit assigns a fresh object from computeCamera every
    // time, so an identity comparison is always false. It read as a safety net
    // and was one line of nothing.
    this.applyCameraFit();
    this.vignette = bakeVignette(this.canvas.width, this.canvas.height);
    this.biomeLevel = -1; // force biome rebake at the new size
  }

  /**
   * The world transform: camera, then the final-blow zoom, then shake.
   *
   * screenToWorld inverts the *camera* only. Shake decays over ~80 ms and is
   * under 1.5 wu against 4.5 wu node radii, and the 6% win zoom runs after the
   * level is decided, so neither is worth threading through hit-testing.
   */
  private applyWorldTransform(now: number): void {
    const { ctx } = this;
    const sh = this.shake.offset();
    let zoom = 1;
    let fx = WORLD_W / 2;
    let fy = WORLD_H / 2;
    if (this.winFocus) {
      const t = (now - this.winFocus.at) / 1000;
      if (t < 1.2) {
        // Both legs eased. The raw-linear version had a visible corner at the
        // peak and a mechanical release — on the single most theatrical camera
        // move in the game.
        const inT = easeOut(Math.min(1, t / 0.12));
        const outT = easeOut(Math.max(0, Math.min(1, (t - 0.62) / 0.4)));
        zoom = 1 + 0.06 * Math.min(inT, 1 - outT);
        fx = this.winFocus.x;
        fy = this.winFocus.y;
      } else {
        this.winFocus = null;
      }
    }
    applyCamera(ctx, this.cam);
    if (zoom !== 1) {
      ctx.translate(fx, fy);
      ctx.scale(zoom, zoom);
      ctx.translate(-fx, -fy);
    }
    ctx.translate(sh.x, sh.y);
  }

  /**
   * Depth scale for sprites: things lower *on screen* read slightly larger.
   * Keyed to the screen-down axis, so it survives a quarter-turned board.
   */
  private dscale(x: number, y: number): number {
    const d = this.downCache;
    const t = ((x - WORLD_W / 2) * d.x + (y - WORLD_H / 2) * d.y) / this.downExtent + 0.5;
    return 0.95 + 0.1 * Math.max(0, Math.min(1, t));
  }

  /** CSS-pixel screen coords → world coords (for input hit-testing). */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return camScreenToWorld(this.cam, sx, sy, this.dpr);
  }

  /** World coords → CSS-pixel screen coords. */
  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return camWorldToScreen(this.cam, wx, wy, this.dpr);
  }

  /** CSS px per world unit — what chrome sizing keys off. */
  get cssScale(): number {
    return this.cam.cssScale;
  }

  /**
   * One world unit's worth of glyph, for the few marks still drawn inside the
   * board transform (the upgrade chevron). Holds a constant apparent size no
   * matter how far the camera has zoomed, so it never dwarfs a node on a phone
   * nor vanishes on a 1080p screen.
   */
  private glyphUnit(): number {
    return Math.max(0.9, Math.min(2.2, 11 / Math.max(0.001, this.cam.cssScale)));
  }

  /** World-space screen-down, for anything that must read "above" a node. */
  get down(): { x: number; y: number } {
    return this.downCache;
  }

  /**
   * World-space screen-*right*; pairs with `down` for screen-basis offsets.
   * Note the sign: perpendicular the other way points screen-left, which put
   * the chevron's cost label on top of the glyph in portrait.
   */
  get across(): { x: number; y: number } {
    return screenRight(this.downCache);
  }

  /** World-space AABB of the visible viewport, padded a little. */
  private visibleWorldBounds(): { x0: number; y0: number; x1: number; y1: number } {
    if (this.boundsCache) return this.boundsCache;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [sx, sy] of [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ] as const) {
      const c = this.screenToWorld(sx, sy);
      if (c.x < x0) x0 = c.x;
      if (c.y < y0) y0 = c.y;
      if (c.x > x1) x1 = c.x;
      if (c.y > y1) y1 = c.y;
    }
    const pad = 2;
    this.boundsCache = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    return this.boundsCache;
  }

  /* ------------------------------------------------- screen-space hit tests */

  /** Current upward offset of the ratio chip (the ball-dodge; see drawHud). */
  private ratioLift = 0;
  private ratioLiftEase = 0;

  hitUiButton(x: number, y: number, coachVisible = false, playingControls = false): UiButton | null {
    // The ratio chip's hit rect follows its ball-dodge lift. When lifted, a
    // tap at the OLD position must fall through to the board — the ball
    // being dodged is exactly what the player is aiming at.
    if (playingControls && this.ratioLift > 1) {
      const r = this.layout.ratioToggle;
      const inX = x >= r.x && x <= r.x + r.w;
      if (inX && y >= r.y - this.ratioLift && y <= r.y + r.h - this.ratioLift) return "ratio";
      if (inX && y >= r.y && y <= r.y + r.h) return null;
    }
    return hitUiButton(
      this.layout,
      x,
      y,
      coachVisible,
      this.pauseAvailable,
      playingControls,
      this.abilityCount,
    );
  }

  /**
   * Whether the pause control does anything on the screen currently drawn.
   * Set during render from the same condition that decides whether to draw it,
   * so the icon and its hit box can never disagree.
   */
  private pauseAvailable = true;

  /**
   * How many ability buttons the last frame actually drew — the same
   * draw-and-hit-agree contract as pauseAvailable. Zero for a player who owns
   * no ability, so the bottom-right corner stays plain board to them.
   */
  private abilityCount = 0;

  hitPauseMenu(x: number, y: number): PauseAction | "panel" | "outside" {
    return hitPauseMenu(this.layout, x, y);
  }

  hitShopMenu(x: number, y: number): ShopHit {
    return hitShopMenu(this.layout, x, y);
  }

  hitOverlayButton(
    x: number,
    y: number,
    dailyLocked = false,
  ): "shop" | "daily" | "progress" | null {
    return hitOverlayButton(this.layout, x, y, dailyLocked, this.overlayHasStrip());
  }

  /** Whether the overlay being shown actually carries a progress strip —
   * daily overlays never do, and their empty band must not hit-test. */
  private overlayHasStrip(): boolean {
    return this.lastOverlay?.progress != null;
  }

  hitSettingsMenu(x: number, y: number): SettingsAction | "close" | "panel" | "outside" {
    return hitSettingsMenu(this.layout, x, y);
  }

  hitMapScreen(x: number, y: number): "close" | "panel" | "outside" {
    return hitMapScreen(this.layout, x, y);
  }

  hitHelpCard(x: number, y: number): "close" | "panel" | "outside" {
    return hitHelpCard(this.layout, x, y);
  }

  /** One id for whatever chrome is under a point — hover, press and click
   *  all resolve through this, so they cannot disagree. */
  hitAnyChrome(x: number, y: number, scope: ChromeScope, coachVisible = false): string | null {
    return hitAnyChrome(
      this.layout,
      x,
      y,
      scope,
      coachVisible,
      this.overlayHasStrip(),
      this.abilityCount,
    );
  }

  /** True while the pointer is over this control (mouse only — see input.ts). */
  private isHot(id: string): boolean {
    return this.getHot().hot === id;
  }

  /**
   * Draw one chrome layer at progress `t` (1 = fully open, 0 = fully gone).
   *
   * Panels scale and fade about their own centre. Hit rects deliberately do
   * NOT animate — they read this.layout, which never moves — because a panel
   * that disagrees with its own tap targets mid-transition is worse than no
   * animation at all.
   */
  private drawChromeLayer(
    layer: ChromeLayer,
    t: number,
    curr: GameState,
    hud: HudView,
    now: number,
  ): void {
    if (layer === "none" || t <= 0.001) return;
    const { ctx } = this;
    const L = this.layout;
    const panel =
      layer === "shop" || layer === "help"
        ? L.shop.panel
        : layer === "settings"
          ? L.settings.panel
          : layer === "paused"
            ? L.pauseMenu.panel
            : layer === "map"
              ? L.map.panel
              : null;

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.layerAlpha = t;
    ctx.globalAlpha = t;
    if (panel) {
      const cx = panel.x + panel.w / 2;
      const cy = panel.y + panel.h / 2;
      const k = lerp(0.96, 1, t);
      ctx.translate(cx, cy);
      ctx.scale(k, k);
      ctx.translate(-cx, -cy);
    }
    switch (layer) {
      case "startCard":
        this.drawStartCard(now, hud);
        break;
      case "help":
        this.drawHelpCard();
        break;
      case "map":
        this.drawMapScreen(hud, now);
        break;
      case "settings":
        this.drawSettings(hud);
        break;
      case "shop":
        if (this.lastShop) this.drawShop(this.lastShop);
        break;
      case "paused":
        this.drawPauseMenu(hud.menuCursor ?? null, hud.restartArmed ?? false, hud.canAfford ?? false);
        break;
      case "overlay":
        // The overlay keeps its own staggered entrance (title scale, body
        // fade), which is better than a flat crossfade; it only borrows `t`
        // on the way out.
        if (this.lastOverlay) this.drawOverlay(this.lastOverlay, curr, now, hud.canAfford);
        break;
    }
    this.layerAlpha = 1;
    ctx.restore();
  }

  /**
   * Known and accepted: a re-toggle inside the 150 ms window (pause, unpause,
   * pause again) overwrites chromePrev with the layer that was still animating
   * and restarts the clock, so the older outgoing layer snaps rather than
   * finishing its fade. At 150 ms this is imperceptible, and a stack of
   * in-flight layers would be a lot of machinery for a case nobody can see.
   */
  private trackChrome(desired: ChromeLayer, now: number): void {
    if (desired === this.chrome) return;
    this.chromePrev = this.chrome;
    this.chrome = desired;
    this.chromeAt = now;
  }

  /**
   * True while a chrome layer is still fading out.
   *
   * Used to block WORLD taps only. A blanket input gate during the transition
   * would put a dead 150 ms on every menu button, which is the exact
   * "feels broken" complaint this pass exists to fix; the hazard being guarded
   * is narrower than that — appState is already "playing" during the fade, so
   * a tap under the still-visible panel would reach the board and fire a send.
   */
  chromeBusy(): boolean {
    return this.chromePrev !== "none" && performance.now() - this.chromeAt < MENU_MS;
  }

  /** Set globalAlpha, scaled by the current layer's open/close fade. */
  private alphaIn(a: number): void {
    this.ctx.globalAlpha = a * this.layerAlpha;
  }

  private isPressed(id: string): boolean {
    const p = this.getHot().pressed;
    return p?.id === id && (p.held || performance.now() - p.at < 90);
  }

  render(
    prev: GameState,
    curr: GameState,
    alpha: number,
    overlay: OverlayView | null,
    hud: HudView,
    shop: ShopView | null = null,
  ): void {
    const t0 = performance.now();
    const { ctx, canvas } = this;
    // Start from a known transform. Every draw path below is save/restore
    // balanced, but one throw mid-frame would otherwise corrupt every frame
    // after it — this makes that failure mode transient instead of permanent.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Same reasoning as the transform reset above: if a chrome layer throws
    // mid-draw its restore never runs, and a stale layerAlpha would dim every
    // subsequent frame rather than just the broken one.
    this.layerAlpha = 1;
    const now = t0;
    const dt = Math.min(0.05, (now - this.lastFrameAt) / 1000);
    this.lastFrameAt = now;
    const biome = biomeForLevel(curr.cfg.level);

    // Camera animation (refit ease, intro reveal) runs on the render clock.
    if (this.viewAnim) {
      const v = sampleAnim(this.viewAnim, now)!;
      this.view = clampView(v, this.fitCam, this.content, this.viewVp, this.viewInsets);
      if (animDone(this.viewAnim, now)) this.viewAnim = null;
      this.applyView();
    }
    this.ensureBake(now);

    this.trackLevelChanges(curr, now);
    this.trackDamage(prev, curr, now);
    this.trackFlips(curr, now);
    this.trackDeposits(curr, now);
    this.trackZapsAndWar(curr, now);
    this.trackOverlay(overlay, curr, now);

    /*
     * Board handover. `level:seed` names a board uniquely (the screen made the
     * seed independent of the level), so a key change IS the level transition —
     * no app-layer call needed. The swap used to be a single-frame hard cut of
     * everything at once: nodes teleport, packets vanish, camera jumps, while
     * the outgoing VICTORY card was still fading over a board the player never
     * played. The reveal below covers the first ~250 ms of the new board with
     * the biome's own board tone and lifts — a curtain, not a crossfade, so it
     * costs one fillRect and needs no offscreen composite.
     */
    const boardKey = `${curr.cfg.level}:${curr.cfg.seed}`;
    if (this.lastBoardKey !== boardKey) {
      // No curtain on the very first board — index.html's #boot owns that.
      this.boardSwapAt = this.lastBoardKey === null ? -1e9 : now;
      this.lastBoardKey = boardKey;
      // A new board never inherits the old board's camera. Either the app
      // staged an intro reveal for this board (consume it), or the view goes
      // home — setContent's early-return can skip the fit recompute when two
      // boards share a content box, so the reset lives HERE, on the one
      // signal that fires for every swap.
      if (this.pendingReveal) {
        const { wx, wy } = this.pendingReveal;
        this.pendingReveal = null;
        this.introReveal(wx, wy);
      } else {
        this.view = { ...HOME_VIEW };
        this.viewAnim = null;
        this.applyView();
      }
    }

    // Biome background with parallax drift (baked oversized, one blit).
    //
    // Keyed on the biome INDEX, not the level: biomes only change every five
    // levels, but this used to key on `cfg.level` and so re-baked a full-screen
    // canvas — gradient, signature layer, allocation, GC — on four out of five
    // level transitions, for a byte-identical result. That per-transition spike
    // is exactly the budget the board fade spends.
    // The bake pad only exists to cover the 7/5 px parallax excursion below —
    // a constant, NOT a multiple of the camera scale. Keying it off cam.scale
    // meant every zoom gesture frame re-baked a full-screen canvas.
    const biomeIdx = biomeIndexForLevel(curr.cfg.level);
    const pad = 16;
    if (this.biomeLevel !== biomeIdx) {
      this.biomeBg = bakeBiomeBg(biome, canvas.width, canvas.height, pad);
      this.biomeLevel = biomeIdx;
    }
    // The drift multiplier was 1.5/1.0 px — genuinely invisible. At 7/5 px over
    // 17/23 s periods it is still far below a pixel per frame (no motion-
    // sickness risk, no reduced-motion concern beyond the existing gate) but
    // the background now reads as a plane behind the board instead of paint on
    // it. The bake pad below must cover the excursion.
    const drift = REDUCED_MOTION()
      ? { x: 0, y: 0 }
      : { x: 7 * Math.sin(now / 17000), y: 5 * Math.sin(now / 23000) };
    ctx.drawImage(this.biomeBg!, -pad + drift.x, -pad + drift.y);

    ctx.save();
    this.applyWorldTransform(now);

    // Board tone. Covers the whole viewport, not just the 160×90 rect: the
    // camera fits *content*, so on a sparse board the world rect no longer
    // reaches the screen edges and a bare rect would read as a letterbox band.
    ctx.fillStyle = biome.board;
    const vb = this.visibleWorldBounds();
    ctx.fillRect(vb.x0, vb.y0, vb.x1 - vb.x0, vb.y1 - vb.y0);

    this.chevronId = hud.chevronNodeId ?? null;
    this.nudgeId = hud.nudgeNodeId ?? null;
    this.dimChevrons = hud.showDimChevrons ?? false;
    this.dust.draw(ctx, biome.dustColor);
    this.drawFlows(curr, now);
    // The dashed send arrow belongs to the onboarding's first step now, rather
    // than to a bare `level <= 3` check that fired whether or not the player
    // had been taught anything or had asked to be left alone.
    if (hud.coach?.arrow) this.drawHint(curr, now);
    this.drawDrag(curr, hud.sendFraction ?? 1);
    this.drawBlasts(curr, now);
    // Culling: only when zoomed — at home everything is on screen by
    // construction, and the reject test would be pure overhead. The pad
    // covers the largest node radius plus its halo bloom.
    const cull = this.view.zoom > 1.01 ? this.visibleWorldBounds() : null;
    const offscreen = (x: number, y: number, pad: number): boolean =>
      cull !== null && (x < cull.x0 - pad || x > cull.x1 + pad || y < cull.y0 - pad || y > cull.y1 + pad);
    for (const node of curr.nodes) {
      if (offscreen(node.x, node.y, 14)) continue;
      this.sprites.drawShadow(ctx, node.size, node.x, node.y);
    }
    for (const node of curr.nodes) {
      if (offscreen(node.x, node.y, 18)) continue;
      this.drawHalo(node, now);
    }
    for (const node of curr.nodes) {
      if (offscreen(node.x, node.y, 14)) continue;
      this.drawNode(node, curr, now);
    }
    this.drawObjectiveMarks(curr, now);
    this.drawAbilityEffects(curr, now);
    this.drawPackets(curr, alpha, cull);
    this.drawZaps(now);
    // Death marks (see the elimination tracker): grow slightly and fade over
    // 900 ms. World-space, so the mark stays where the faction actually died.
    for (const [f, rec] of this.fallenAt) {
      const t = progress(now, rec.at, 900, REDUCED_MOTION());
      if (t >= 1) {
        this.fallenAt.delete(f);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.8;
      drawSigilBadge(ctx, f, rec.x, rec.y, 7 + 3 * easeOut(t));
      ctx.restore();
    }
    // Not while an overlay is up OR closing: the close branch below draws them
    // once more, and compositing the same pool twice reads as a brightness pop.
    if (!overlay && !hud.paused && !this.overlayClosing()) this.particles.draw(ctx);
    // Targeting mode: dim the board and pulse the legal targets. World-space,
    // inside the transform, and last — it reads over everything below it.
    if (hud.armedAbility && (hud.armedAbility === "overcharge" || hud.armedAbility === "stasis")) {
      this.drawTargeting(curr, hud.armedAbility, now);
    }
    ctx.restore();

    // The handover curtain (see boardKey above). Drawn over the world, under
    // the chrome — the HUD and the incoming LEVEL N card stay crisp above it.
    const reveal = progress(now, this.boardSwapAt, 260, REDUCED_MOTION());
    if (reveal < 1) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1 - reveal;
      ctx.fillStyle = biome.board;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }

    // Chrome lives in CSS-pixel screen space, outside the board transform.
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawHud(curr, dt, hud, now);
    // Draw-and-hit-agree: the hit gate reads the count the frame drew.
    this.abilityCount = !hud.startCard && hud.abilities ? hud.abilities.length : 0;
    if (this.abilityCount > 0) this.drawAbilityButtons(hud, now);
    // Teaching band (L1-3): war news stays quiet, app speech still draws.
    this.ticker.draw(
      ctx,
      this.layout.ticker,
      this.layout.fontScale,
      this.layout.tickerLines,
      curr.cfg.level <= 3,
      this.fonts.pixel,
    );
    this.drawEdgeThreats(curr, now);
    this.drawIntro(curr, now, hud.dailyName);
    ctx.restore();

    if (this.vignette) ctx.drawImage(this.vignette, 0, 0);

    if (shop) this.lastShop = shop;
    if (overlay) this.lastOverlay = overlay;
    if (hud.mapPath) this.lastMapPath = hud.mapPath;
    const desired: ChromeLayer = hud.startCard
      ? "startCard"
      : hud.help
        ? "help"
        : hud.map
          ? "map"
          : hud.settings
            ? "settings"
            : shop
              ? "shop"
              : hud.paused
                ? "paused"
                : overlay
                  ? "overlay"
                  : "none";
    this.trackChrome(desired, now);
    const t = progress(now, this.chromeAt, MENU_MS, REDUCED_MOTION());
    const out: ChromeLayer = t < 1 ? this.chromePrev : "none";

    // Under the start card, over everything else — and never while paused or
    // on an overlay, where it would compete with a menu for the same taps.
    const coachLive = hud.coach && desired === "none" ? hud.coach : null;
    // Remember the last banner shown, so there is something to slide out with.
    // This used to be assigned inside the "not live" branch as
    // `hud.coach ?? this.coachOut`, which could only ever evaluate to
    // this.coachOut — hud.coach is non-null exactly when coachLive is, so the
    // exit animation was dead code and the banner always popped off.
    if (coachLive) this.coachOut = coachLive;
    if (coachLive && coachLive.index !== this.coachStep) {
      // Re-stamp on a step change too, so the text cross-fades. The box does
      // not move between steps — a banner that jumps reads as noise rather
      // than as progress.
      this.coachStep = coachLive.index;
      this.coachAt = now;
    }
    if (!coachLive && this.coachStep >= 0) {
      this.coachOutAt = now;
      this.coachStep = -1;
    }
    if (coachLive) {
      this.drawCoach(coachLive, now, progress(now, this.coachAt, COACH_MS, REDUCED_MOTION()));
    } else if (this.coachOut && now - this.coachOutAt < COACH_MS) {
      // Slide the departing banner away rather than blinking it off.
      const gone = progress(now, this.coachOutAt, COACH_MS, REDUCED_MOTION());
      this.drawCoach(this.coachOut, now, 1 - gone);
    } else if (hud.objective && desired === "none") {
      this.drawObjectiveBanner(hud.objective);
    }

    if (this.chrome !== "none" || out !== "none") {
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      // One scrim for both layers, LERPED not maxed. Each draw function used
      // to fill its own, so a swap double-darkened; and max(0.8·t, 0.72·(1−t))
      // dips to 0.4 mid-swap, which is a visible flash of the board.
      const scrim = lerp(SCRIM[out], SCRIM[this.chrome], t);
      if (scrim > 0.002) {
        ctx.fillStyle = `rgba(${UI_SCRIM},${scrim})`;
        ctx.fillRect(0, 0, this.layout.cssW, this.layout.cssH);
      }
      ctx.restore();
      if (out !== "none") this.drawChromeLayer(out, 1 - t, curr, hud, now);
      if (this.chrome !== "none") this.drawChromeLayer(this.chrome, t, curr, hud, now);
    }

    if (this.chrome === "overlay" || out === "overlay") {
      ctx.save();
      this.applyWorldTransform(now);
      this.particles.draw(ctx);
      ctx.restore();
    }

    // Mute + pause draw ABOVE the chrome scrim. They used to draw with the
    // HUD, under it — so with a menu open they sat at ~20% contrast while
    // remaining fully clickable, which reads as disabled-but-somehow-working.
    // A live control looks live.
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    drawMuteIcon(ctx, this.layout.mute, this.getMuted(), this.isHot("mute"));
    // One condition for drawing and for hit-testing — see `pauseAvailable`.
    this.pauseAvailable = !hud.startCard && overlay === null;
    if (this.pauseAvailable) drawPauseIcon(ctx, this.layout.pause, this.isHot("pause"));
    ctx.restore();

    this.lastRenderMs = this.lastRenderMs * 0.95 + (performance.now() - t0) * 0.05;
  }

  /* ------------------------------------------------------------ tracking */

  private trackLevelChanges(curr: GameState, now: number): void {
    if (curr.cfg.level !== this.introLevel || curr.tick < this.lastTick) {
      this.introLevel = curr.cfg.level;
      this.introAt = now;
      this.flips.clear();
      this.lastOwners.clear();
      this.lastUnits.clear();
      this.depositPopAt.clear();
      this.lastSizes.clear();
      this.upgradePopAt.clear();
      this.lastHitKickAt = 0;
      this.confettiWaves = 0;
      this.prevPackets = [];
      this.zaps = [];
      this.threatAnnounced.clear();
      this.winFocus = null;
      this.hudShares = [0, 0, 0, 0, 0];
      for (const n of curr.nodes) if (n.owner !== NEUTRAL) this.hudShares[n.owner] = 1;
      for (let f = 0; f <= 4; f++)
        this.factionAlive[f] = curr.nodes.some((n) => n.owner === f);
    }
    this.lastTick = curr.tick;
  }

  private trackFlips(curr: GameState, now: number): void {
    for (const n of curr.nodes) {
      const before = this.lastOwners.get(n.id);
      if (before !== undefined && before !== n.owner) {
        this.flips.set(n.id, { at: now, oldOwner: before });
        this.particles.burst(n.x, n.y, 14, n.owner === NEUTRAL ? P_WHITE : n.owner);
        if (before === PLAYER) this.shake.kick(0.8, 110); // losing ground always thumps
        // A volatile detonates on capture and damages every node in radius,
        // including the capturer's own. That has to be unmissable, or the
        // player just sees unrelated nodes lose units for no visible reason.
        if (n.kind === KIND_VOLATILE) {
          this.blasts.set(n.id, now);
          this.particles.burst(n.x, n.y, 30, P_WHITE);
          this.shake.kick(1.1, 140);
        }
      }
      this.lastOwners.set(n.id, n.owner);
    }
  }

  private trackDeposits(curr: GameState, now: number): void {
    for (const n of curr.nodes) {
      const before = this.lastUnits.get(n.id);
      if (before !== undefined && n.units > before) this.depositPopAt.set(n.id, now);
      this.lastUnits.set(n.id, n.units);
      const sizeBefore = this.lastSizes.get(n.id);
      if (sizeBefore !== undefined && n.size > sizeBefore && n.owner === PLAYER) {
        this.upgradePopAt.set(n.id, now);
        this.particles.burst(n.x, n.y, 18, PLAYER);
      }
      this.lastSizes.set(n.id, n.size);
    }
  }

  /** Shake on damage only: hostile packets landing on player nodes. Reads the
   *  pre-diff prevPackets snapshot, so it must run before trackZapsAndWar. */
  private trackDamage(prev: GameState, curr: GameState, now: number): void {
    for (const p of this.prevPackets) {
      if (p.arriveTick > curr.tick) continue; // still in flight
      if (p.owner === PLAYER) continue; // own reinforcement or return fire
      if (prev.nodes[p.to]?.owner !== PLAYER) continue; // pre-tick owner: node may flip this tick
      if (now - this.lastHitKickAt < 200) return; // tremble, not blur
      this.lastHitKickAt = now;
      // Shake is the ONLY signal that a hostile packet landed on a node the
      // eye is not already on, and a strategy game cannot drop "you are being
      // attacked". Under reduced motion it degrades to a rim flash on the
      // struck node rather than vanishing.
      if (reducedMotion()) this.hitFlashAt.set(p.to, now);
      else this.shake.kick(0.28, 70);
      return;
    }
  }

  /**
   * Edge chevrons: with a panned/zoomed camera, a hostile stream aimed at an
   * OFF-SCREEN player ball must still announce itself — "clear goals visible
   * at all times" has to survive the camera. A faction-tinted chevron sits on
   * the screen edge pointing at the threatened ball, capped at three (the
   * nearest-to-visible first would be nicer; three at once already reads as
   * "everything is on fire" and more is noise). Nothing draws at the home
   * view, where every node is on screen by construction.
   */
  private drawEdgeThreats(state: GameState, now: number): void {
    if (this.view.zoom <= 1.01) return;
    const { ctx } = this;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;

    const threatened = new Map<number, Faction>();
    for (const f of state.flows) {
      const src = state.nodes[f.from]!;
      const dst = state.nodes[f.to]!;
      if (dst.owner === PLAYER && src.owner !== PLAYER && src.owner !== NEUTRAL) {
        threatened.set(dst.id, src.owner);
      }
    }
    for (const p of state.packets) {
      if (p.owner === PLAYER || p.owner === NEUTRAL) continue;
      const dst = state.nodes[p.to];
      if (dst && dst.owner === PLAYER) threatened.set(dst.id, p.owner);
    }
    if (threatened.size === 0) return;

    // The clamp box dodges the chrome: the HUD band above, the coach/ratio
    // strip below — a chevron under a banner warns nobody.
    const insetX = 26;
    const insetTop = this.viewInsets.top + 26;
    const insetBottom = 60;
    let drawn = 0;
    for (const [nodeId, owner] of threatened) {
      if (drawn >= 3) break;
      const n = state.nodes[nodeId]!;
      const s = this.worldToScreen(n.x, n.y);
      if (s.x >= 0 && s.x <= w && s.y >= 0 && s.y <= h) continue; // on screen — the ball speaks for itself
      // Ray from the screen centre toward the node, clamped to the inset box.
      const cx = w / 2;
      const cy = h / 2;
      const dx = s.x - cx;
      const dy = s.y - cy;
      const t = Math.min(
        dx !== 0 ? Math.abs(((dx > 0 ? w - insetX : insetX) - cx) / dx) : Infinity,
        dy !== 0 ? Math.abs(((dy > 0 ? h - insetBottom : insetTop) - cy) / dy) : Infinity,
      );
      const ex = cx + dx * t;
      const ey = cy + dy * t;
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(Math.atan2(dy, dx));
      const half = 13; // 26 px tall — clears the ≥24 px visibility bar
      ctx.globalAlpha = REDUCED_MOTION() ? 0.85 : 0.65 + 0.3 * (0.5 + 0.5 * Math.sin(now / 170));
      ctx.fillStyle = FACTION_COLORS[owner]!;
      ctx.beginPath();
      ctx.moveTo(half, 0);
      ctx.lineTo(-half * 0.6, -half * 0.8);
      ctx.lineTo(-half * 0.25, 0);
      ctx.lineTo(-half * 0.6, half * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      drawn++;
    }
  }

  /** Packet diff for turret-zap visuals + faction eliminations + threats. */
  private trackZapsAndWar(curr: GameState, now: number): void {
    // Zaps: prev packets that were mid-flight and vanished.
    let ci = 0;
    for (const p of this.prevPackets) {
      if (p.arriveTick <= curr.tick - 1) continue;
      const c = curr.packets[ci];
      if (c && c.owner === p.owner && c.from === p.from && c.departTick === p.departTick) {
        ci++;
        continue;
      }
      // p was zapped mid-flight: find the turret that plausibly did it.
      const a = curr.nodes[p.from];
      const b = curr.nodes[p.to];
      if (a && b) {
        const t = Math.min(1, (curr.tick - 1 - p.departTick) / (p.arriveTick - p.departTick));
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        let turret: Node | null = null;
        let best = TURRET_RANGE * TURRET_RANGE * 1.4;
        for (const n of curr.nodes) {
          if (n.kind !== KIND_TURRET || n.owner === NEUTRAL || n.owner === p.owner) continue;
          const d2 = (n.x - x) ** 2 + (n.y - y) ** 2;
          if (d2 < best) {
            best = d2;
            turret = n;
          }
        }
        if (turret) {
          this.zaps.push({ x0: turret.x, y0: turret.y, x1: x, y1: y, color: FACTION_COLORS[turret.owner]!, at: now });
          this.turretAim.set(turret.id, Math.atan2(y - turret.y, x - turret.x));
          for (let s = 0; s < 3; s++)
            this.particles.spawn(x, y, (Math.random() - 0.5) * 24, (Math.random() - 0.5) * 24, 250, 0.5, P_WHITE);
          if (this.zaps.length > 12) this.zaps.shift();
        }
      }
    }
    this.prevPackets = curr.packets.slice();

    // Faction eliminations — announced once each. A rival dying is the
    // structural payoff of a whole level, and it used to produce a 13px
    // right-aligned toast (a comment here claimed a "gray-crumble" that never
    // existed). Now: the ticker line, the shake, AND the fallen faction's
    // sigil badge blooming over its last-held node before fading — a death
    // mark at the place it happened.
    for (let f = 2 as Faction; f <= 4; f++) {
      const held = curr.nodes.find((n) => n.owner === f);
      const alive = held !== undefined || curr.packets.some((p) => p.owner === f);
      // Remember where the faction lives while it does — by the time it is
      // dead, no node carries its owner any more, so the mark's position has
      // to come from the last frame it was alive.
      if (held) this.lastHeld.set(f, { x: held.x, y: held.y });
      if (this.factionAlive[f] && !alive) {
        this.ticker.push(`${FACTION_NAMES[f]} HAS FALLEN`, f);
        this.shake.kick(0.6, 90);
        const at = this.lastHeld.get(f);
        if (at) this.fallenAt.set(f, { at: now, x: at.x, y: at.y });
      }
      this.factionAlive[f] = alive;
    }

    // First aggression against the player, per faction.
    for (const fl of curr.flows) {
      const src = curr.nodes[fl.from]!;
      const dst = curr.nodes[fl.to]!;
      if (src.owner >= 2 && dst.owner === PLAYER && !this.threatAnnounced.has(src.owner)) {
        this.threatAnnounced.add(src.owner);
        if (curr.cfg.level > 3)
          this.ticker.push(`${FACTION_NAMES[src.owner]} ATTACKS YOU`, src.owner);
      }
    }
  }

  /** True while the overlay layer is the one fading out. */
  private overlayClosing(): boolean {
    return this.chromePrev === "overlay" && performance.now() - this.chromeAt < MENU_MS;
  }

  private trackOverlay(overlay: OverlayView | null, _curr: GameState, now: number): void {
    // Do not re-stamp while the overlay is fading out: `overlay` is already
    // null on the first frame of the close, which reset overlayAt and made the
    // outgoing layer draw at age 0 — fully transparent. The dispatcher was
    // paying for a 150 ms draw that rendered nothing at all.
    if (overlay === null && this.overlayClosing()) return;
    const kind = overlay?.kind ?? null;
    if (kind === this.overlayKind) {
      if (
        kind === "won" &&
        this.confettiWaves < 3 &&
        now - this.overlayAt > this.confettiWaves * 350
      ) {
        this.particles.confetti(34, PLAYER, P_WHITE, this.down);
        this.confettiWaves++;
      }
      return;
    }
    this.overlayKind = kind;
    this.overlayAt = now;
    this.confettiWaves = 0;
    if (kind === "lost" || kind === "runover") {
      for (let i = 0; i < 20; i++) {
        this.particles.spawn(
          WORLD_W / 2 + (Math.random() - 0.5) * 40,
          WORLD_H / 2 + (Math.random() - 0.5) * 20,
          (Math.random() - 0.5) * 6,
          8 + Math.random() * 8,
          2200,
          0.8,
          P_EMBER,
          false,
        );
      }
    }
  }

  private pendingFocus: { x: number; y: number } | null = null;
  private chevronId: number | null = null;
  private nudgeId: number | null = null;
  private dimChevrons = false;

  /**
   * A shop row was tapped. `ok` false means the player could not afford it —
   * which produced no feedback at all before this existed.
   */
  flashShopRow(row: number, ok: boolean): void {
    this.shopFlash = { row, ok, at: performance.now() };
  }

  /** App layer stores the winning capture position, then triggers the punch. */
  finalBlow(): void {
    // Guarded where winFocus is SET rather than where the zoom is applied, so
    // the branch in applyWorldTransform never arms at all.
    if (reducedMotion()) return;
    this.winFocus = this.pendingFocus
      ? { ...this.pendingFocus, at: performance.now() }
      : { x: WORLD_W / 2, y: WORLD_H / 2, at: performance.now() };
    this.shake.kick(1.5, 120);
    this.particles.burst(this.winFocus.x, this.winFocus.y, 40, PLAYER);
  }

  /* -------------------------------------------------------------- drawing */

  private drawHalo(node: Node, now: number): void {
    if (node.owner === NEUTRAL) return;
    // Per-faction pulse rhythm — identity beyond hue.
    let mult = 1;
    if (!REDUCED_MOTION()) {
      if (node.owner === 2) mult = 1 + 0.06 * Math.max(0, Math.sin((now / 700) * Math.PI * 2)) ** 2;
      else if (node.owner === 3) mult = 1 + 0.04 * Math.sin((now / 2400) * Math.PI * 2);
      else if (node.owner === 4)
        mult = 1 + 0.05 * Math.max(0, Math.sin((now / 1400) * Math.PI * 4)) * (Math.sin((now / 1400) * Math.PI * 2) > 0 ? 1 : 0);
      // The player breathes too — slowest of all, a resting heartbeat. Every
      // RIVAL's territory pulsed while the player's sat inert, which is
      // backwards for a game about your own expansion, and it left the whole
      // board static once the last rival was down. Also the cheapest life the
      // static first-impression levels can get.
      else if (node.owner === PLAYER) mult = 1 + 0.03 * Math.sin((now / 3200) * Math.PI * 2);
    }
    this.sprites.drawHalo(this.ctx, node.owner, node.size, node.x, node.y, mult);
  }

  private nodeRadius(node: Node, now: number): number {
    let r = NODE_R[node.size] * this.dscale(node.x, node.y);
    const flip = this.flips.get(node.id);
    if (flip) {
      const t = (now - flip.at) / FLIP_POP_MS;
      if (t < 1) r *= 1 + 0.15 * (1 - t) * (1 - t) * (1 - t);
      else if (now - flip.at > 600) this.flips.delete(node.id);
    }
    const dep = this.depositPopAt.get(node.id);
    if (dep !== undefined) {
      const t = (now - dep) / DEPOSIT_POP_MS;
      if (t < 1) r *= 1 + (node.kind === KIND_FACTORY ? 0.08 : 0.05) * (1 - t);
      else this.depositPopAt.delete(node.id);
    }
    return r;
  }

  private drawNodeBody(node: Node, r: number, now: number): void {
    const { ctx } = this;
    const flip = this.flips.get(node.id);
    const t = flip ? (now - flip.at) / CROSSFADE_MS : 1;
    let drawn: boolean;
    if (flip && t < 1) {
      drawn = this.sprites.drawSphere(ctx, flip.oldOwner, node.size, node.x, node.y, r);
      this.sprites.drawSphere(ctx, node.owner, node.size, node.x, node.y, r, t);
    } else {
      drawn = this.sprites.drawSphere(ctx, node.owner, node.size, node.x, node.y, r);
    }
    if (!drawn) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = FACTION_COLORS[node.owner]!;
      ctx.fill();
    }
  }

  /**
   * The six Phase 3A.3 kinds, drawn as vector overlays rather than baked
   * sprites.
   *
   * KindSprites bakes per (faction, size) — 15 canvases each — so six more
   * baked accessories would take the rebake from 30 canvases to 120, on every
   * resize. Four of the six animate (volatile's warning pulse, beacon's
   * breathing ring, siphon's inward spiral, nursery's orbiting seeds) and so
   * could not be baked anyway; relay's chevrons and vault's bands are a handful
   * of path ops. At <= 13 nodes a frame this is cheaper than the bake it avoids.
   *
   * Silhouette carries the identity, tinted by owner — the same language the
   * gear and hex already speak, so faction colour stays the primary channel.
   */
  /**
   * Expanding shockwave to VOLATILE_RADIUS, so the blast's reach is something
   * the player sees rather than infers. Drawn once per detonation, in world
   * units, under the nodes.
   */
  private drawBlasts(state: GameState, now: number): void {
    if (this.blasts.size === 0) return;
    const { ctx } = this;
    const DUR = 420;
    for (const [id, at] of this.blasts) {
      const t = (now - at) / DUR;
      if (t >= 1) {
        this.blasts.delete(id);
        continue;
      }
      const n = state.nodes[id];
      if (!n) continue;
      const ease = 1 - (1 - t) * (1 - t);
      ctx.beginPath();
      ctx.arc(n.x, n.y, VOLATILE_RADIUS * ease, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,214,140,${0.75 * (1 - t)})`;
      ctx.lineWidth = 1.4 * (1 - t) + 0.3;
      ctx.stroke();
    }
  }

  private drawBossAccessory(node: Node, r: number, now: number): void {
    const { ctx } = this;
    const tint = FACTION_COLORS[node.owner]!;
    const still = REDUCED_MOTION();
    const t = still ? 0 : now / 1000;
    ctx.save();
    ctx.translate(node.x, node.y);
    ctx.lineWidth = 0.55;
    ctx.strokeStyle = tint;

    switch (node.kind) {
      case KIND_RELAY: {
        // Two chevrons pointing outward: "things leave here fast". They sit
        // clear of the sphere on BOTH sides — everything in this method is
        // painted before the sphere, so any geometry inside r is invisible.
        ctx.globalAlpha = 0.95;
        for (const dir of [1, -1]) {
          for (let i = 0; i < 2; i++) {
            const x = dir * (r + 0.9 + i * 1.7);
            ctx.beginPath();
            ctx.moveTo(x, -r * 0.42);
            ctx.lineTo(x + dir * 1.5, 0);
            ctx.lineTo(x, r * 0.42);
            ctx.stroke();
          }
        }
        break;
      }
      case KIND_VOLATILE: {
        // Dashed warning ring that breathes — unstable, do not poke.
        const pulse = 0.5 + 0.5 * Math.sin(t * 4);
        ctx.globalAlpha = 0.5 + 0.45 * pulse;
        ctx.lineWidth = 0.7;
        ctx.setLineDash([1.5, 1.3]);
        ctx.beginPath();
        ctx.arc(0, 0, r + 2 + pulse * 0.9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      case KIND_BEACON: {
        // A steady collar plus a ring travelling outward: it pushes something
        // out. Both stay outside the sphere so the motion is what reads.
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(0, 0, r + 1.1, 0, Math.PI * 2);
        ctx.stroke();
        const phase = (t * 0.7) % 1;
        ctx.globalAlpha = 0.75 * (1 - phase);
        ctx.beginPath();
        ctx.arc(0, 0, r + 1.1 + phase * 5.5, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case KIND_SIPHON: {
        // Three arcs sweeping around the rim: it pulls something in.
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 0.8;
        for (let i = 0; i < 3; i++) {
          const a = t * 1.4 + (i * Math.PI * 2) / 3;
          ctx.beginPath();
          ctx.arc(0, 0, r + 2, a, a + 0.8);
          ctx.stroke();
        }
        break;
      }
      case KIND_VAULT: {
        // Heavy collar with four rivets — a big, slow, armoured bank.
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 1.1;
        const rr = r + 1.6;
        ctx.beginPath();
        ctx.arc(0, 0, rr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 0.7;
        for (let i = 0; i < 4; i++) {
          const a = Math.PI / 4 + (i * Math.PI) / 2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
          ctx.lineTo(Math.cos(a) * (rr + 1.6), Math.sin(a) * (rr + 1.6));
          ctx.stroke();
        }
        break;
      }
      case KIND_NURSERY: {
        // Seeds orbiting the node — visibly accumulating, even unowned.
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = tint;
        for (let i = 0; i < 3; i++) {
          const a = t * 0.9 + (i * Math.PI * 2) / 3;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * (r + 2.4), Math.sin(a) * (r + 2.4), 0.95, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case KIND_CORRUPTER: {
        // Hooks curving INWARD, against the siphon's outward-sweeping arcs —
        // both take, but this one takes what is passing rather than what is
        // parked, and the reading a player needs is "it reaches out and pulls".
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 0.85;
        for (let i = 0; i < 4; i++) {
          const a = -t * 1.1 + (i * Math.PI) / 2;
          const rr = r + 3.2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
          ctx.quadraticCurveTo(
            Math.cos(a + 0.5) * (rr - 0.8),
            Math.sin(a + 0.5) * (rr - 0.8),
            Math.cos(a + 0.35) * (r + 0.6),
            Math.sin(a + 0.35) * (r + 0.6),
          );
          ctx.stroke();
        }
        break;
      }
      case KIND_RIFT: {
        // A slit with a halo that breathes: an opening rather than a machine.
        // Drawn on the screen-vertical so a pair reads as two ends of the same
        // thing regardless of where they sit on the board.
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(0, -(r + 3));
        ctx.lineTo(0, r + 3);
        ctx.stroke();
        const breath = 0.5 + 0.5 * Math.sin(t * 2.2);
        ctx.globalAlpha = 0.25 + 0.35 * breath;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.ellipse(0, 0, 1.6 + 1.4 * breath, r + 3, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  private drawNode(node: Node, state: GameState, now: number): void {
    const { ctx } = this;
    const r = this.nodeRadius(node, now);

    // Kind accessories under the sphere.
    if (node.kind === KIND_FACTORY) {
      // A neutral factory produces nothing (produce() skips neutrals), so its
      // gear should not spin as though it were working.
      const interval = prodInterval(state, node);
      const progress = node.owner === NEUTRAL ? 0 : (state.tick % interval) / interval;
      this.kinds.drawGear(ctx, node.owner, node.size, node.x, node.y, (progress * Math.PI * 2) / 8);
    } else if (node.kind === KIND_FORTRESS) {
      this.kinds.drawHex(ctx, node.owner, node.size, node.x, node.y);
    } else if (node.kind === KIND_TURRET) {
      const aim = this.turretAim.get(node.id) ?? -Math.PI / 2;
      ctx.save();
      ctx.translate(node.x, node.y);
      ctx.rotate(aim);
      ctx.fillStyle = "rgba(20,24,33,0.9)";
      ctx.fillRect(r * 0.5, -0.45, 2.2, 0.9);
      ctx.fillStyle = FACTION_COLORS[node.owner]!;
      ctx.fillRect(r * 0.5 + 1.7, -0.45, 0.5, 0.9);
      ctx.restore();
    } else if (node.kind >= KIND_RELAY) {
      this.drawBossAccessory(node, r, now);
    }

    if (node.selected) {
      // SETTLES, then holds static. Static is deliberate — this is a STATE
      // indicator, and it used to blink at 6.7 Hz (see pulse() in motion.ts).
      // But static should mean "settles", not "teleports": the ring now closes
      // in over 140 ms from r+4 to its resting r+1.5 and then does not move.
      // The most frequent action in the game had zero arrival feedback.
      // Reduced motion snaps straight to the resting state via progress().
      if (!this.selAt.has(node.id)) this.selAt.set(node.id, now);
      const t = progress(now, this.selAt.get(node.id)!, 140, REDUCED_MOTION());
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 1.5 + (1 - easeOut(t)) * 2.5, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${UI_INK},${0.85 * (0.35 + 0.65 * t)})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    } else {
      // Deselection clears the settle clock; every node passes through here
      // each frame, so the map cannot leak.
      this.selAt.delete(node.id);
    }
    if (!node.selected && this.nudgeId === node.id) {
      // Teaching spotlight: slow cyan pulse, distinct from selection. This one
      // SHOULD move — it is a one-time "look here", not a state readout — so it
      // keeps its pulse, at the period it was always meant to have.
      const pulse = 0.5 * pulseAt(now, 1571);
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 2 + pulse, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${UI_ACCENT_RGB},0.9)`;
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }

    // Upgrade-complete payoff: one expanding ring in the owner's color.
    const up = this.upgradePopAt.get(node.id);
    if (up !== undefined) {
      const t = (now - up) / 450;
      if (t < 1) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 1 + t * 7, 0, Math.PI * 2);
        ctx.strokeStyle = FACTION_COLORS[PLAYER]!;
        ctx.globalAlpha = (1 - t) * 0.8;
        ctx.lineWidth = 1.2 - t;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Reduced-motion stand-in for the screen shake: a static rim flash on the
    // node that was actually hit. Carries strictly more information than the
    // shake did, since the shake never said WHICH node.
    const hit = this.hitFlashAt.get(node.id);
    if (hit !== undefined) {
      const t = (now - hit) / 180;
      if (t >= 1) this.hitFlashAt.delete(node.id);
      else {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 1.2, 0, Math.PI * 2);
        ctx.strokeStyle = SEMANTIC.danger;
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    const flip = this.flips.get(node.id);
    if (flip) {
      const t = (now - flip.at) / 300;
      if (t < 1) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 1 + t * 5, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${UI_INK},${(1 - t) * 0.9})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // Second, wider shockwave ring in the new owner's color.
      const t2 = (now - flip.at) / 450;
      if (t2 < 1 && flip.oldOwner !== NEUTRAL) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 1 + t2 * 8, 0, Math.PI * 2);
        ctx.strokeStyle = FACTION_COLORS[node.owner]!;
        ctx.globalAlpha = (1 - t2) * 0.7;
        ctx.lineWidth = 1.2 - t2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    this.drawNodeBody(node, r, now);

    if (node.upgrading !== 0) {
      const total = state.cfg.playerUpgradeTicks || UPGRADE_TICKS;
      const remaining = Math.max(0, node.upgrading - state.tick);
      const progress = 1 - Math.min(1, remaining / total);
      ctx.save();
      ctx.setLineDash([1.2, 1.2]);
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 1.8, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.strokeStyle = `rgba(${UI_INK},0.8)`;
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.restore();
    }

    if (node.owner !== NEUTRAL) {
      const frac = fullness(node.units, node.size, node.kind);
      ctx.beginPath();
      ctx.arc(node.x, node.y, r - 0.6, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.strokeStyle = inkOnAlpha(node.owner, 0.55);
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(node.x, node.y);
    if (this.cam.theta !== 0) ctx.rotate(-this.cam.theta);
    ctx.fillStyle = inkOn(node.owner);
    ctx.font = this.pixelFont(NODE_R[node.size] * 0.85 * this.dscale(node.x, node.y), true);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(node.units), 0, 0);
    ctx.restore();

    // Upgrade chevron: full + cost label on the selected/nudged node, faint
    // standing hint on other eligible nodes once the nudge has fired.
    if (this.chevronId === node.id || this.nudgeId === node.id) {
      const p = chevronPos(node.x, node.y, r, this.cam.cssScale, this.down);
      const pulse = reducedMotion() ? 1 : 0.6 + 0.4 * Math.abs(Math.sin(now / 350));
      const gu = this.glyphUnit();
      const a = this.across;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = UI_ACCENT;
      this.traceChevron(p.x, p.y);
      ctx.fill();
      // Cost label sits to the chevron's *screen* right, upright.
      ctx.translate(p.x + a.x * 2.4 * gu, p.y + a.y * 2.4 * gu);
      ctx.rotate(-this.cam.theta);
      ctx.font = this.pixelFont(2.4 * gu, true);
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(`-${state.cfg.playerUpgradeCost[node.size as 0 | 1]}`, 0, 0);
      ctx.restore();
    } else if (
      this.dimChevrons &&
      !node.selected &&
      node.owner === PLAYER &&
      node.size < 2 &&
      node.upgrading === 0 &&
      node.units >= state.cfg.playerUpgradeCost[node.size as 0 | 1]
    ) {
      const p = chevronPos(node.x, node.y, r, this.cam.cssScale, this.down);
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = UI_ACCENT;
      this.traceChevron(p.x, p.y);
      ctx.fill();
      ctx.restore();
    }
  }

  /**
   * Up-arrow glyph shared by the full, nudged, and dimmed chevrons. Traced
   * about the origin under a counter-rotation, so "up" means up on the screen
   * rather than up in world space — on a quarter-turned board the world-space
   * version pointed sideways.
   */
  private traceChevron(x: number, y: number): void {
    const { ctx } = this;
    const u = this.glyphUnit();
    const c = Math.cos(-this.cam.theta);
    const sn = Math.sin(-this.cam.theta);
    // Rotate each glyph vertex into world space around (x, y).
    const pt = (dx: number, dy: number): [number, number] => [
      x + dx * c - dy * sn,
      y + dx * sn + dy * c,
    ];
    ctx.beginPath();
    ctx.moveTo(...pt(0, -1.6 * u));
    ctx.lineTo(...pt(-1.8 * u, 0.6 * u));
    ctx.lineTo(...pt(-0.6 * u, 0.6 * u));
    ctx.lineTo(...pt(-0.6 * u, 1.8 * u));
    ctx.lineTo(...pt(0.6 * u, 1.8 * u));
    ctx.lineTo(...pt(0.6 * u, 0.6 * u));
    ctx.lineTo(...pt(1.8 * u, 0.6 * u));
    ctx.closePath();
  }

  private drawZaps(now: number): void {
    const { ctx } = this;
    this.zaps = this.zaps.filter((z) => now - z.at < 90);
    for (const z of this.zaps) {
      const a = 1 - (now - z.at) / 90;
      ctx.globalAlpha = a * 0.6;
      ctx.strokeStyle = z.color;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(z.x0, z.y0);
      ctx.lineTo(z.x1, z.y1);
      ctx.stroke();
      ctx.globalAlpha = a * 0.9;
      ctx.strokeStyle = "#e8f2e9";
      ctx.lineWidth = 0.35;
      ctx.beginPath();
      ctx.moveTo(z.x0, z.y0);
      ctx.lineTo(z.x1, z.y1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Packets, drawn as discrete glowing units.
   *
   * They used to be 1.6px line dashes, and at 15 emissions per second per flow
   * they merged into one solid stroke — a send looked like a line growing
   * between two circles rather than like an army moving. Three things fix that:
   * a baked pip sprite blitted additively, a short trail behind it, and a
   * deterministic lateral offset per packet so a stream reads as a *column*
   * with width instead of a queue on a rail.
   *
   * The offset is keyed off `(from, to, departTick)`, which the sim guarantees
   * is unique — one flow per source node, one packet per flow per emit tick —
   * so it is stable frame to frame without the sim having to carry a packet id.
   *
   * The old stroke path is still here as the degradation ladder: past
   * PIP_BUDGET packets the pips are too many to blit, and the existing
   * stride/rect rungs beyond that are untouched.
   */
  private drawPackets(
    state: GameState,
    alpha: number,
    cull: { x0: number; y0: number; x1: number; y1: number } | null = null,
  ): void {
    const { ctx } = this;
    const now = state.tick - 1 + alpha;
    const count = state.packets.length;
    const pips = count <= PIP_BUDGET && this.sprites.hasPips();
    const stride = count > 2000 ? 2 : 1;
    const asRects = count > 3000;
    // Packet cull pad: the trail plus lane spread. A zoomed view over a
    // MAX_PACKETS brawl is exactly where per-packet stroke work must stop
    // paying for invisible pixels.
    const PAD = 6;

    if (pips) ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = pips ? PIP_TRAIL_W : 1.6;
    ctx.lineCap = "round";

    for (let f = 0 as Faction; f <= 4; f++) {
      let styled = false;
      for (let i = 0; i < count; i += stride) {
        const p = state.packets[i]!;
        if (p.owner !== f) continue;
        const a = state.nodes[p.from]!;
        const b = state.nodes[p.to]!;
        // Recalled packets fly from a floating origin (Packet.fx/fy), not
        // their source node — same rule as turretFire in tick.ts.
        const ax = p.fx ?? a.x;
        const ay = p.fy ?? a.y;
        const span = p.arriveTick - p.departTick;
        if (!styled) {
          ctx.strokeStyle = pips ? FACTION_DIM[f]! : FACTION_COLORS[f]!;
          ctx.fillStyle = FACTION_COLORS[f]!;
          styled = true;
        }

        if (!pips) {
          const t = Math.max(0, Math.min(1, (now - p.departTick) / span));
          const x = ax + (b.x - ax) * t;
          const y = ay + (b.y - ay) * t;
          if (cull && (x < cull.x0 - PAD || x > cull.x1 + PAD || y < cull.y0 - PAD || y > cull.y1 + PAD)) {
            continue;
          }
          if (asRects) {
            ctx.fillRect(x - 0.55, y - 0.55, 1.1, 1.1);
            continue;
          }
          const tt = Math.max(0, t - 1.5 / span);
          ctx.beginPath();
          ctx.moveTo(ax + (b.x - ax) * tt, ay + (b.y - ay) * tt);
          ctx.lineTo(x, y);
          ctx.stroke();
          continue;
        }

        // Spread the column across the lane, and stagger along it so pips
        // don't march in lockstep rows.
        const h = packetHash(p.from, p.to, p.departTick);
        const dx = b.x - ax;
        const dy = b.y - ay;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const spread = ((h & 0xffff) / 0x10000 - 0.5) * 2 * PIP_SPREAD;
        const stagger = (((h >>> 16) & 0xff) / 0x100 - 0.5) * PIP_STAGGER;

        const t = Math.max(0, Math.min(1, (now - p.departTick + stagger) / span));
        const ox = nx * spread;
        const oy = ny * spread;
        const x = ax + dx * t + ox;
        const y = ay + dy * t + oy;
        if (cull && (x < cull.x0 - PAD || x > cull.x1 + PAD || y < cull.y0 - PAD || y > cull.y1 + PAD)) {
          continue;
        }

        const tt = Math.max(0, t - PIP_TRAIL / len);
        ctx.beginPath();
        ctx.moveTo(ax + dx * tt + ox, ay + dy * tt + oy);
        ctx.lineTo(x, y);
        ctx.stroke();
        this.sprites.drawPip(ctx, f, x, y);
      }
    }
    if (pips) ctx.globalCompositeOperation = "source-over";
  }

  private drawFlows(state: GameState, now: number): void {
    const { ctx } = this;

    // Lane lifecycle. A lane used to exist one frame and not the next, in both
    // directions — and the vanish is the ONLY feedback a stream CANCEL has, so
    // a player could not tell whether the input registered. In: 120 ms ease.
    // Out: 160 ms held fade of the last-known lane.
    for (const f of state.flows) {
      const rec = this.laneIn.get(f.from);
      if (!rec) {
        this.laneIn.set(f.from, { at: now, to: f.to });
        this.laneOut.delete(f.from);
      } else rec.to = f.to; // retarget without re-fading
    }
    for (const [from, rec] of this.laneIn) {
      if (!state.flows.some((f) => f.from === from)) {
        this.laneIn.delete(from);
        this.laneOut.set(from, { at: now, to: rec.to, owner: state.nodes[from]?.owner ?? NEUTRAL });
      }
    }

    ctx.save();
    ctx.setLineDash([1.5, 2.5]);
    ctx.lineWidth = 0.5;
    for (const f of state.flows) {
      const a = state.nodes[f.from]!;
      const b = state.nodes[f.to]!;
      const t = progress(now, this.laneIn.get(f.from)?.at ?? now, 120, REDUCED_MOTION());
      ctx.globalAlpha = t;
      ctx.strokeStyle = FACTION_DIM[a.owner]!;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (const [from, rec] of this.laneOut) {
      const t = progress(now, rec.at, 160, REDUCED_MOTION());
      if (t >= 1) {
        this.laneOut.delete(from);
        continue;
      }
      const a = state.nodes[from];
      const b = state.nodes[rec.to];
      if (!a || !b) {
        this.laneOut.delete(from);
        continue;
      }
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = FACTION_DIM[rec.owner]!;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawDrag(state: GameState, fraction = 1): void {
    const drag = this.getDrag();
    if (!drag?.active) return;
    const from = state.nodes[drag.fromNodeId];
    if (!from) return;
    // syncDrag prunes lost sources each frame, but a node can still change
    // hands between that call and this render — filter, don't trust.
    const sources = drag.fromNodeIds
      .map((id) => state.nodes[id])
      .filter((n): n is Node => n !== undefined && n.owner === PLAYER);
    if (sources.length === 0) return;
    const { ctx } = this;

    const tx = drag.hoverNodeId != null ? state.nodes[drag.hoverNodeId]!.x : drag.wx;
    const ty = drag.hoverNodeId != null ? state.nodes[drag.hoverNodeId]!.y : drag.wy;

    ctx.save();
    for (const s of sources) {
      ctx.strokeStyle = FACTION_DIM[PLAYER]!;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();

      const ang = Math.atan2(ty - s.y, tx - s.x);
      ctx.fillStyle = FACTION_DIM[PLAYER]!;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - 3 * Math.cos(ang - 0.5), ty - 3 * Math.sin(ang - 0.5));
      ctx.lineTo(tx - 3 * Math.cos(ang + 0.5), ty - 3 * Math.sin(ang + 0.5));
      ctx.fill();
    }

    if (sources.length > 1) {
      // Feedback that the gesture is working: each collected ball gets a ring
      // in the player's own colour the moment the drag picks it up. Only under
      // multi-collection — a plain one-ball drag keeps its familiar look.
      ctx.strokeStyle = FACTION_COLORS[PLAYER]!;
      ctx.lineWidth = 0.8;
      for (const s of sources) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, NODE_R[s.size] + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (drag.hoverNodeId != null) {
      // Static, same reasoning as the selection ring: this marks WHICH node the
      // drag — or the keyboard aim, which synthesises a DragView to reuse this
      // exact path — is pointing at. At 8.3 Hz it was the fastest thing on
      // screen.
      const h = state.nodes[drag.hoverNodeId]!;
      ctx.beginPath();
      ctx.arc(h.x, h.y, NODE_R[h.size] + 2, 0, Math.PI * 2);
      ctx.strokeStyle = "#e8f2e9";
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

    /*
     * The send preview: how many units this drag will commit.
     *
     * The genre's most common early confusion is "why did that attack fail" —
     * the answer is almost always "you sent 8 against 14", and nothing showed
     * either number at decision time (the source's count is under the player's
     * finger on touch). One pill, summed across every collected source (a send
     * drains each whole node, so the committed force is the plain sum), riding
     * the centroid→target midpoint where neither the finger nor the target
     * ring covers it.
     */
    const total = sources.reduce((sum, s) => sum + s.units, 0);
    if (total > 0) {
      const cx = sources.reduce((sum, s) => sum + s.x, 0) / sources.length;
      const cy = sources.reduce((sum, s) => sum + s.y, 0) / sources.length;
      const mx = (cx + tx) / 2;
      const my = (cy + ty) / 2;
      // At a partial ratio the pill reads "committed / garrison". Committed is
      // per-source floors summed — the same floor startFlow applies to each
      // flow — so the number is truthful by construction, not an estimate.
      const committed = sources.reduce((sum, s) => sum + Math.floor(s.units * fraction), 0);
      const label = fraction < 1 ? `${committed} / ${total}` : `${total}`;
      ctx.font = this.pixelFont(5, true);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const w = ctx.measureText(label).width + 4;
      ctx.fillStyle = "rgba(20,24,33,0.85)";
      this.roundRect(mx - w / 2, my - 3.4, w, 6.8, 3.4);
      ctx.fill();
      ctx.fillStyle = FACTION_COLORS[PLAYER]!;
      ctx.fillText(label, mx, my + 0.2);
    }
    ctx.restore();
  }

  /** Dashed arrow toward the cheapest neutral. Gated by the coach, not by level. */
  private drawHint(state: GameState, now: number): void {
    if (state.firstSendDone) return;
    let from: Node | null = null;
    for (const n of state.nodes)
      if (n.owner === PLAYER && (!from || n.units > from.units)) from = n;
    if (!from) return;
    let to: Node | null = null;
    let best = Infinity;
    for (const n of state.nodes) {
      if (n.owner !== NEUTRAL) continue;
      const cost = n.units + dist(from, n) / 4;
      if (cost < best) {
        best = cost;
        to = n;
      }
    }
    if (!to) return;

    const { ctx } = this;
    const pulse = reducedMotion() ? 0.8 : 0.45 + 0.35 * Math.sin(now / 300);
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    const r0 = NODE_R[from.size] + 2;
    const r1 = NODE_R[to.size] + 3;
    const x0 = from.x + r0 * Math.cos(ang);
    const y0 = from.y + r0 * Math.sin(ang);
    const x1 = to.x - r1 * Math.cos(ang);
    const y1 = to.y - r1 * Math.sin(ang);

    ctx.save();
    ctx.strokeStyle = `rgba(${UI_INK},${pulse})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(${UI_INK},${pulse})`;
    ctx.beginPath();
    ctx.moveTo(x1 + 2.5 * Math.cos(ang), y1 + 2.5 * Math.sin(ang));
    ctx.lineTo(x1 - 2.5 * Math.cos(ang - 0.55), y1 - 2.5 * Math.sin(ang - 0.55));
    ctx.lineTo(x1 - 2.5 * Math.cos(ang + 0.55), y1 - 2.5 * Math.sin(ang + 0.55));
    ctx.fill();

    const gt = (now % 1500) / 1500;
    ctx.beginPath();
    ctx.arc(x0 + (x1 - x0) * gt, y0 + (y1 - y0) * gt, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${UI_INK},${pulse + 0.2})`;
    ctx.fill();
    ctx.restore();
  }

  /* ------------------------------------------------- chrome (CSS px space) */

  private drawHud(state: GameState, dt: number, hud: HudView, now: number): void {
    const { ctx } = this;
    const L = this.layout;
    const fs = L.fontScale;
    ctx.save();

    ctx.fillStyle = `rgba(${UI_INK},0.7)`;
    ctx.font = this.pixelFont(17 * fs, true);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(hud.dailyName ? "DAILY" : `LEVEL ${state.cfg.level}`, L.levelLabel.x, L.levelLabel.y);

    // Cores balance, always visible next to the top-right icons. Vector glyph
    // + number, replacing the `◈ N` string whose diamond came out of a per-OS
    // symbol-font fallback (see drawCoreIcon).
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    // When something is buyable the readout breathes, slowly (0.5 Hz, well
    // under the photosensitive band, and inert under reduced motion via
    // pulseAt). The shop's payoff moment used to be invisible from out here.
    // The readout is also the shop button now, so hover/press lifts it fully.
    const shopHot = this.isHot("shop") || this.isPressed("shop");
    const affordGlow = shopHot
      ? 1
      : hud.canAfford && !hud.paused
        ? 0.85 + 0.15 * pulseAt(now, 2000)
        : hud.canAfford
          ? 1
          : 0.75;
    ctx.globalAlpha = affordGlow;
    ctx.fillStyle = UI_ACCENT;
    ctx.font = this.pixelFont(14 * fs, true);
    const coresText = `${hud.cores}`;
    ctx.fillText(coresText, L.cores.x, L.cores.y);
    drawCoreIcon(
      ctx,
      L.cores.x - ctx.measureText(coresText).width - 9 * fs,
      L.cores.y,
      13 * fs,
      UI_ACCENT,
    );
    ctx.globalAlpha = 1;

    // Lives, and the best-level marker beside them. Positions come from
    // heartCenters — the same helper the layout tests measure against, so the
    // drawn hearts and the asserted hearts cannot drift apart.
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const hearts = heartCenters(L, hud.maxLives);
    const heart = hearts[0]?.size ?? 15 * fs;
    for (let i = 0; i < hearts.length; i++) {
      drawHeartIcon(
        ctx,
        hearts[i]!.x,
        hearts[i]!.y,
        hearts[i]!.size,
        i < hud.lives ? "rgba(255,215,221,0.95)" : `rgba(${UI_INK},0.18)`,
      );
    }
    // Optional extras only if they fit — on a short, narrow screen this cluster
    // shares its row with the level label and the cores readout.
    const clusterEnd = L.livesRow.x + L.livesMaxW;
    let sideX = L.livesRow.x + hud.maxLives * heart * 1.15 + 8;

    /**
     * The objective, stated on screen.
     *
     * This is a conquest game and you win by being the last faction standing —
     * but nothing said so, and "what am I actually trying to do here" is not
     * something a player should have to infer from a level ending. The goal
     * stays visible at all times.
     *
     * Counted exactly the way `updateStatus` decides the level is over: a rival
     * that owns no nodes but still has a packet in flight is not beaten yet, so
     * a readout that ignored packets would show 0 while the game ran on.
     *
     * Drawn in its OWN slot when the layout provides one (every compact screen,
     * where the hearts alone overrun the row-one cluster), otherwise first in
     * that cluster so it still outranks BEST and the streak glyph. Those are
     * flavour; this is the rules, and it is never the thing that gets dropped.
     */
    let aliveMask = 0;
    for (const n of state.nodes) if (n.owner > PLAYER) aliveMask |= 1 << n.owner;
    for (const p of state.packets) if (p.owner > PLAYER) aliveMask |= 1 << p.owner;
    let rivals = 0;
    for (let m = aliveMask; m !== 0; m >>= 1) rivals += m & 1;
    if (rivals > 0) {
      const label = `${rivals} RIVAL${rivals === 1 ? "" : "S"} LEFT`;
      const slot = L.objective;
      if (slot) {
        // fitText shrinks to the slot rather than overflowing onto the bar.
        ctx.fillStyle = `rgba(${UI_INK},0.62)`;
        this.fitText(label, slot.x, slot.y + slot.h / 2, 12 * fs, {
          maxW: slot.w,
          weight: "bold",
          align: "left",
        });
      } else {
        ctx.font = this.pixelFont(12 * fs, true);
        const w = ctx.measureText(label).width;
        if (sideX + w <= clusterEnd) {
          ctx.fillStyle = `rgba(${UI_INK},0.55)`;
          ctx.fillText(label, sideX, L.livesRow.y);
          sideX += w + 10;
        }
      }
    }

    if (hud.bestLevel > 1) {
      ctx.font = this.pixelFont(12 * fs, true);
      const w = ctx.measureText(`BEST ${hud.bestLevel}`).width;
      if (sideX + w <= clusterEnd) {
        ctx.fillStyle = `rgba(${UI_INK},0.4)`;
        ctx.fillText(`BEST ${hud.bestLevel}`, sideX, L.livesRow.y);
        sideX += w + 10;
      }
    }

    // Win-streak fire: the streak counter burns from 3 up.
    if (hud.streak >= 3 && sideX + 34 * fs <= clusterEnd) {
      const pulse = 1 + 0.04 * pulseAt(now, 1131);
      ctx.save();
      ctx.translate(sideX, L.livesRow.y);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = GOLD_HEX;
      ctx.font = this.glyphFont(14 * fs);
      ctx.fillText(`×${hud.streak}`, 0, 0);
      ctx.restore();
      // Sparks are world-space particles, so seed them at the world point the
      // streak counter is sitting over.
      if (Math.random() < 0.12) {
        const w = this.screenToWorld(sideX + Math.random() * 14, L.livesRow.y);
        const d = this.down;
        const a = this.across;
        // Rise up the *screen*, drift sideways across it. Using only `-d.y` for
        // the impulse gave portrait sparks zero velocity, since down is (-1, 0)
        // there and they just fell straight back out of frame.
        const rise = 6 + Math.random() * 5;
        const drift = (Math.random() - 0.5) * 3;
        this.particles.spawn(w.x, w.y, -d.x * rise + a.x * drift, -d.y * rise + a.y * drift, 400, 0.5, 3);
      }
    }

    // Territory share bar, eased.
    const totals = [0, 0, 0, 0, 0];
    for (const n of state.nodes) if (n.owner !== NEUTRAL) totals[n.owner]! += n.units;
    for (const pk of state.packets) totals[pk.owner]! += 1;
    const total = totals.reduce((a, b) => a + b, 0);
    if (total > 0) {
      const ease = Math.min(1, dt * 8);
      for (let f = 0; f <= 4; f++) {
        const target = totals[f]! / total;
        this.hudShares[f] = this.hudShares[f]! + (target - this.hudShares[f]!) * ease;
      }
      const norm = this.hudShares.reduce((a, b) => a + b, 0) || 1;
      let x = L.shareBar.x;
      /*
       * The one always-on-screen readout of who is winning, and until now it
       * was four flat fills with nothing but hue to tell them apart.
       *
       * Each segment gets a texture keyed to that faction's sigil — solid /
       * clumped pairs / even comb / slanted — so the bar reads under any
       * colour-vision deficiency, and so the texture teaches the same grammar
       * the node marks use. This is the standard accessible-data-viz move, and
       * at ≤40 fillRects a frame it costs nothing.
       */
      const bar = L.shareBar;
      for (let f = 1 as Faction; f <= 4; f++) {
        const w = (this.hudShares[f]! / norm) * bar.w;
        if (w <= 0.01) continue;
        ctx.fillStyle = FACTION_COLORS[f];
        ctx.fillRect(x, bar.y, w, bar.h);

        ctx.save();
        ctx.beginPath();
        ctx.rect(x, bar.y, w, bar.h);
        ctx.clip();
        ctx.fillStyle = inkOnAlpha(f, 0.5);
        const period = f === 2 ? 13 : f === 3 ? 6 : f === 4 ? 12 : 0;
        // Skip the texture on a sliver too narrow to show one repeat: a
        // half-drawn pattern reads as an artifact, not a pattern.
        if (period > 0 && w >= period) {
          for (let p = x; p < x + w; p += period) {
            if (f === 2) {
              ctx.fillRect(p, bar.y, 2, bar.h);
              ctx.fillRect(p + 4, bar.y, 2, bar.h);
            } else if (f === 3) {
              ctx.fillRect(p, bar.y, 2, bar.h);
            } else {
              // Slanted: a parallelogram, leaning across the bar's height.
              ctx.beginPath();
              ctx.moveTo(p, bar.y + bar.h);
              ctx.lineTo(p + 3, bar.y + bar.h);
              ctx.lineTo(p + 3 + 4, bar.y);
              ctx.lineTo(p + 4, bar.y);
              ctx.closePath();
              ctx.fill();
            }
          }
        }
        ctx.restore();

        // A hard divider, so two similar-luminance neighbours never merge.
        if (x > bar.x + 0.5) {
          ctx.fillStyle = `rgba(${UI_SCRIM},0.9)`;
          ctx.fillRect(x - 0.5, bar.y, 1, bar.h);
        }
        x += w;
      }
    }

    /*
     * Send-ratio toggle, bottom-left. Drawn with the HUD — under the chrome
     * scrim when a menu is up, which is honest: the hit test only offers it
     * in the "playing" scope, so a dimmed toggle is a disabled toggle. Not on
     * the start card, where the only control should be "tap to play".
     *
     * The chip DODGES the player's own ball: on ≤~1100px widths a quad's
     * bottom-left home can sit exactly under it (the shipped-twice residual,
     * and 907×510 is the review viewport). Reserving the corner in the camera
     * fit costs node diameter everywhere (the documented hudBandH trap), so
     * the chip lifts out of the way instead — content-aware, eased, and the
     * hit test follows it (hitUiButton below).
     */
    if (!hud.startCard) {
      const base = L.ratioToggle;
      let overlapped = false;
      for (const n of state.nodes) {
        if (n.owner !== PLAYER) continue;
        const s = this.worldToScreen(n.x, n.y);
        const rad = NODE_R[n.size]! * this.cam.cssScale + 4;
        const cx = Math.max(base.x, Math.min(base.x + base.w, s.x));
        const cy = Math.max(base.y, Math.min(base.y + base.h, s.y));
        if ((s.x - cx) ** 2 + (s.y - cy) ** 2 < rad * rad) {
          overlapped = true;
          break;
        }
      }
      const target = overlapped ? 1 : 0;
      this.ratioLiftEase += (target - this.ratioLiftEase) * Math.min(1, dt * 8);
      if (Math.abs(this.ratioLiftEase - target) < 0.02) this.ratioLiftEase = target;
      this.ratioLift = this.ratioLiftEase * (base.h + 10);
      const r = { ...base, y: base.y - this.ratioLift };
      const half = (hud.sendFraction ?? 1) < 1;
      const hot = this.isHot("ratio") || this.isPressed("ratio");
      const hovT = this.hoverEase("ratio", hot);
      // While the coach's ratio step is live, the chip advertises itself — the
      // banner says "TAP ALL" and this is what makes ALL findable. Same slow
      // 0.5 Hz breath as the afford glow, inert under reduced motion.
      const coached = hud.coach?.id === "ratio";
      const coachGlow = coached ? 0.25 + 0.3 * pulseAt(now, 2000) : 0;
      ctx.fillStyle = `rgba(20,24,33,${0.62 + 0.18 * hovT})`;
      this.roundRect(r.x, r.y, r.w, r.h, 9);
      ctx.fill();
      ctx.strokeStyle = half
        ? FACTION_COLORS[PLAYER]!
        : coached
          ? `rgba(${UI_PLAYER},${0.4 + coachGlow})`
          : `rgba(${UI_INK},${0.16 + 0.24 * hovT})`;
      ctx.lineWidth = coached ? 1.6 : 1;
      this.roundRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 9);
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // "½" leans on the same per-OS symbol fallback the old ♥◈ glyphs did,
      // so the half state is drawn as "1/2" in plain digits instead.
      ctx.fillStyle = half ? FACTION_COLORS[PLAYER]! : `rgba(${UI_INK},${0.55 + 0.3 * hovT})`;
      ctx.font = this.pixelFont(13 * fs, true);
      ctx.fillText(half ? "1/2" : "ALL", r.x + r.w / 2, r.y + r.h / 2 + 0.5);
    }
    ctx.restore();
  }

  private drawIntro(state: GameState, now: number, dailyName?: string): void {
    const age = now - this.introAt;
    if (age > INTRO_MS) return;
    const { ctx } = this;
    const L = this.layout;
    const fadeIn = Math.min(1, age / 350);
    const fadeOut = Math.min(1, (INTRO_MS - age) / 350);
    const a = Math.min(fadeIn, fadeOut);
    const scale = reducedMotion() ? 1 : 1.3 - 0.3 * fadeIn * (2 - fadeIn);
    const base = Math.min(48, L.cssW * 0.11);
    const boss = bossKindForLevel(state.cfg.level);
    ctx.save();
    // A boss card carries two extra lines, and every boss level is a 4-way
    // board whose contested centre node sits dead centre of the screen — at the
    // usual 0.40 anchor the kind name lands right on top of it. Lift the whole
    // card so the extra lines clear the node instead of overprinting it.
    ctx.translate(L.cssW / 2, L.cssH * (boss !== null ? 0.3 : 0.4));
    ctx.scale(scale, scale);
    ctx.fillStyle = `rgba(${UI_INK},${0.9 * a})`;
    ctx.font = this.displayFont(base);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // The daily pins cfg.level = 12 for its knobs; "LEVEL 12" (and level 12's
    // "FIRST 3-WAY WAR" note below) would be false advertising on it.
    ctx.fillText(dailyName ? "DAILY" : `LEVEL ${state.cfg.level}`, 0, 0);
    if (state.cfg.factionCount > 2) {
      /*
       * The legend: this is the one place badge, name and colour appear
       * together, so it is where the sigil grammar gets taught.
       *
       * The player is included. The loop used to run over state.cfg.ais only,
       * which meant the card named every rival and omitted the one faction the
       * player has to recognise.
       */
      const rf = base * 0.32;
      const entries: { faction: Faction; boss: boolean }[] = [
        { faction: PLAYER, boss: false },
        ...state.cfg.ais.map((fc) => ({ faction: fc.faction, boss: fc.tier !== undefined })),
      ];
      const stacked = L.cssW < 560;
      const badgeR = rf * (stacked ? 0.62 : 0.5);
      const y0 = base * 0.78;

      if (stacked) {
        // Portrait cannot fit four badge+name pairs across; stacking also lets
        // the badge grow to a size where the marks genuinely read.
        const lineH = rf * 1.5;
        entries.forEach((e, i) => {
          const y = y0 + i * lineH;
          const label = FACTION_NAMES[e.faction];
          ctx.font = this.pixelFont(rf * (e.boss ? 1.15 : 1), true);
          const tw = ctx.measureText(label).width;
          const left = -(tw + badgeR * 3) / 2;
          ctx.globalAlpha = (e.boss ? 1 : 0.8) * a;
          drawSigilBadge(ctx, e.faction, left + badgeR, y, badgeR);
          ctx.fillStyle = FACTION_COLORS[e.faction];
          ctx.textAlign = "left";
          ctx.fillText(label, left + badgeR * 3, y);
          ctx.textAlign = "center";
        });
      } else {
        const step = Math.min(L.cssW * 0.24, rf * 6.2);
        let x = -((entries.length - 1) * step) / 2;
        for (const e of entries) {
          const label = FACTION_NAMES[e.faction];
          ctx.font = this.pixelFont(rf * (e.boss ? 1.25 : 1), true);
          ctx.fillStyle = FACTION_COLORS[e.faction];
          ctx.globalAlpha = (e.boss ? 1 : 0.75) * a;
          drawSigilBadge(ctx, e.faction, x, y0 - rf * 0.95, badgeR);
          ctx.fillText(label, x, y0);
          if (e.boss) {
            // The boss rival fights a tier above the board; on a 4-way, "one
            // of them is called out by name" has to mean exactly one.
            const w = ctx.measureText(label).width;
            ctx.fillRect(x - w / 2, y0 + rf * 0.85, w, Math.max(1, rf * 0.09));
          }
          x += step;
        }
      }
      ctx.globalAlpha = 1;
    }

    // Boss levels debut a node kind. Two short lines, only on six levels ever —
    // the rest of the game teaches by placement, and this stays in that spirit
    // by naming the thing the board is already saturated with.
    if (boss !== null) {
      const kf = base * 0.26;
      ctx.font = this.pixelFont(kf, true);
      ctx.fillStyle = `rgba(${UI_ACCENT_RGB},${0.95 * a})`;
      ctx.fillText(`NEW · ${KIND_NAMES[boss]}`, 0, base * 1.42);
      ctx.font = this.pixelFont(kf * 0.82);
      ctx.fillStyle = `rgba(${UI_INK},${0.65 * a})`;
      ctx.fillText(KIND_VERBS[boss]!, 0, base * 1.42 + kf * 1.15);
    } else {
      // Structural announcements (topology debuts, twist levels) share the
      // boss card's slot — a level is never both, so they cannot collide. The
      // daily reuses the slot for its mutator instead of level 12's note.
      const note = dailyName
        ? (dailyName.split("·")[1]?.trim() ?? null)
        : introNoteForLevel(state.cfg.level);
      if (note !== null) {
        const kf = base * 0.26;
        ctx.font = this.pixelFont(kf, true);
        ctx.fillStyle = `rgba(${UI_ACCENT_RGB},${0.95 * a})`;
        ctx.fillText(note, 0, base * 1.42);
      }
    }
    ctx.restore();
  }

  /** Rounded rect + label, the shared look for every screen-space button. */
  private uiButton(
    r: Rect,
    label: string,
    opts: {
      accent?: boolean;
      alpha?: number;
      focused?: boolean;
      danger?: boolean;
      id?: string;
    } = {},
  ): void {
    const { ctx } = this;
    const fs = this.layout.fontScale;
    const hot = opts.id !== undefined && this.isHot(opts.id);
    const down = opts.id !== undefined && this.isPressed(opts.id);
    ctx.save();
    this.alphaIn(opts.alpha ?? 1);
    // Hover and press are additive deltas, so the accent and default looks
    // both get them from one path — and they EASE now (~110 ms). Every other
    // surface in this renderer moves through a curve; the buttons stepped
    // 0 → 0.06 → 0.10 in single frames, which is precisely the difference
    // between "canvas UI" and "UI". Press stays snappier than hover on the
    // way in (it must feel immediate) and both relax on the way out.
    const hovT = opts.id !== undefined ? this.hoverEase(opts.id, hot || down) : hot || down ? 1 : 0;
    const lift = 0.06 * hovT + (down ? 0.04 : 0);
    const edge = 0.15 * hovT + (down ? 0.1 : 0);
    ctx.fillStyle = opts.danger
      ? "rgba(255,138,107,0.18)"
      : opts.accent
        ? `rgba(${UI_PLAYER},${0.16 + lift})`
        : `rgba(${UI_INK},${0.08 + lift})`;
    ctx.strokeStyle = opts.danger
      ? SEMANTIC.danger
      : opts.accent
        ? `rgba(${UI_PLAYER},${0.55 + edge})`
        : `rgba(${UI_INK},${0.25 + edge})`;
    ctx.lineWidth = 1.5 + 0.3 * hovT;
    if (down) {
      // A touch of give, about the rect's centre.
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      ctx.translate(cx, cy);
      ctx.scale(0.975, 0.975);
      ctx.translate(-cx, -cy);
    }
    if (opts.focused) {
      // The keyboard cursor. Brighter and thicker than any hover state, since
      // it is the only thing telling a keyboard player where they are.
      ctx.strokeStyle = UI_ACCENT;
      ctx.lineWidth = 2.5;
    }
    this.roundRect(r.x, r.y, r.w, r.h, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = opts.danger ? SEMANTIC.danger : `rgba(${UI_INK},0.9)`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Shrink-to-fit: uiButton never did, and at the two-column colW of ~149
    // "DAILY CHALLENGE" already measured ~150 px before the longer confirm
    // label was added.
    this.fitText(label, r.x + r.w / 2, r.y + r.h / 2, 15 * fs, { maxW: r.w - 16 });
    ctx.restore();
  }

  /** Panel chrome shared by the pause menu and the shop. */
  private uiPanel(r: Rect, title: string, rightCores?: number): void {
    const { ctx } = this;
    const fs = this.layout.fontScale;
    ctx.save();
    ctx.fillStyle = UI_PANEL;
    ctx.strokeStyle = `rgba(${UI_INK},0.15)`;
    ctx.lineWidth = 1.5;
    this.roundRect(r.x, r.y, r.w, r.h, 14);
    ctx.fill();
    ctx.stroke();

    // A 1px inner highlight along the top edge. Panels were a flat fill with
    // one border — technically fine, visually a wireframe. This is the whole
    // "lit from above" effect at the cost of one stroke; shadowBlur stays
    // banned (fx.ts) so depth has to come from lines like this.
    ctx.strokeStyle = `rgba(${UI_INK},0.06)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(r.x + 14, r.y + 1.5);
    ctx.lineTo(r.x + r.w - 14, r.y + 1.5);
    ctx.stroke();

    // Title. Capped rather than raw 20*fs: the panel header band is a FIXED
    // 62px in the layout, so on a large screen (fs 1.9) an uncapped title hit
    // 38px against a 30px baseline and crowded the panel's top edge.
    const titlePx = Math.min(20 * fs, 26);
    ctx.fillStyle = `rgba(${UI_INK},0.9)`;
    this.setTracking(titlePx);
    ctx.font = this.displayFont(titlePx);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(title, r.x + 20, r.y + 30);
    if (rightCores !== undefined) {
      ctx.textAlign = "right";
      ctx.fillStyle = UI_ACCENT;
      const t = `${rightCores}`;
      ctx.fillText(t, r.x + r.w - 20, r.y + 30);
      drawCoreIcon(
        ctx,
        r.x + r.w - 20 - ctx.measureText(t).width - 9 * fs,
        r.y + 30,
        Math.min(13 * fs, 17),
        UI_ACCENT,
      );
    }
    this.setTracking(0);

    // Rule under the header, separating title from content — the second half
    // of making the panel read as composed rather than poured.
    ctx.strokeStyle = `rgba(${UI_INK},0.08)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(r.x + 14, r.y + 54);
    ctx.lineTo(r.x + r.w - 14, r.y + 54);
    ctx.stroke();
    ctx.restore();
  }

  private drawOverlay(
    overlay: OverlayView,
    state: GameState,
    now: number,
    canAfford = false,
  ): void {
    const { ctx } = this;
    const L = this.layout;
    const fs = L.fontScale;
    const age = now - this.overlayAt;
    const titleT = Math.min(1, age / 300);
    const titleScale = 1.2 - 0.2 * titleT * (2 - titleT);
    const subA = Math.max(0, Math.min(1, (age - 500) / 250));

    ctx.save();

    const cx = L.cssW / 2;
    const cy = L.cssH / 2;

    const won = overlay.kind === "won" || overlay.kind === "daily-won";
    const title =
      overlay.kind === "won"
        ? "VICTORY"
        : overlay.kind === "lost"
          ? "DEFEATED"
          : overlay.kind === "runover"
            ? "RUN OVER"
            : overlay.kind === "daily-won"
              ? "DAILY CLEARED"
              : "DAILY FAILED";
    // Defeat gets its own danger tone rather than borrowing Warlord red —
    // losing to anyone should not paint the screen in one rival's colour.
    const titleColor = won ? FACTION_COLORS[PLAYER] : SEMANTIC.danger;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.save();
    ctx.translate(cx, cy - 54);
    ctx.scale(titleScale, titleScale);
    ctx.fillStyle = titleColor;
    this.alphaIn(titleT);
    // Shrink-to-fit for narrow portrait screens ("DAILY CLEARED").
    this.fitText(title, 0, 0, Math.min(58, L.cssW * 0.13), {
      maxW: 0.86 * L.cssW,
      face: "display",
    });
    ctx.restore();

    this.alphaIn(subA);

    /*
     * The body is a declared list of rows distributed inside L.overlay.body,
     * not eight hard-coded offsets from centre.
     *
     * Those offsets ran to cy+120 while the UPGRADES button starts at cy+103
     * on a notched 812x375 — so the banked-checkpoint line, the single most
     * valuable thing the game ever tells a player, rendered on top of a button
     * on an iPhone in landscape. Nothing bounded them and nothing renders in
     * tests, so it survived every sweep. Rows that are `optional` are dropped
     * first when a viewport cannot hold the stack.
     */
    type Row = { h: number; optional?: boolean; draw: (y: number) => void };
    const rows: Row[] = [];
    const line = (text: string, px: number, colour: string, optional = false): Row => ({
      h: px * 1.35,
      optional,
      draw: (y) => {
        ctx.fillStyle = colour;
        this.fitText(text, cx, y, px, { maxW: L.overlay.body.w });
      },
    });
    const ink = `rgba(${UI_INK},0.85)`;

    if (overlay.kind === "won") {
      if (overlay.stars) {
        // Three vector stars, landing one at a time on the checkpoint badge's
        // own reveal curve. This row used to be a "★★☆" STRING — font-fallback
        // glyphs, no animation — and it was flagged `optional`, so the most
        // rewarding element of a win was the first thing DROPPED on a landscape
        // phone. The stars are the reward; BEST and the totals are the trivia.
        const stars = overlay.stars;
        rows.push({
          h: 34 * fs,
          draw: (y) => {
            const step = 30 * fs;
            for (let i = 0; i < 3; i++) {
              const x = cx + (i - 1) * step;
              const earned = i < stars;
              // Stagger: 0/140/280ms after the body has begun to read.
              const t = progress(age, 620 + i * 140, 260, reducedMotion());
              if (t <= 0) continue;
              ctx.save();
              ctx.translate(x, y);
              const s = lerp(1.6, 1, t);
              ctx.scale(s, s);
              ctx.globalAlpha *= earned ? t : t * 0.35;
              drawStarIcon(ctx, 0, 0, 26 * fs, earned ? GOLD_HEX : `rgba(${UI_INK},0.8)`, earned);
              ctx.restore();
              // One expanding ring per EARNED landing — the badge's move.
              if (earned && !reducedMotion()) {
                const ring = progress(age, 620 + i * 140, 420, false);
                if (ring > 0 && ring < 1) {
                  ctx.save();
                  ctx.globalAlpha *= (1 - ring) * 0.6;
                  ctx.strokeStyle = GOLD_HEX;
                  ctx.lineWidth = 1.5;
                  ctx.beginPath();
                  ctx.arc(x, y, lerp(13, 24, ring) * fs, 0, Math.PI * 2);
                  ctx.stroke();
                  ctx.restore();
                }
              }
            }
          },
        });
      }
      if (overlay.cores) {
        // Count-up, pure function of overlay age — the shop's easing without
        // the shop's mutable state. Reduced motion snaps straight to the total.
        const total = overlay.cores;
        rows.push({
          h: 17 * fs * 1.35,
          draw: (y) => {
            const t = progress(age, 700, 650, reducedMotion());
            ctx.fillStyle = UI_ACCENT;
            this.fitText(`+${Math.round(total * t)} CORES`, cx, y, 17 * fs, {
              maxW: L.overlay.body.w,
            });
          },
        });
      }
      if (overlay.starBonus) {
        rows.push(line(`STAR MILESTONE +${overlay.starBonus}`, 13 * fs, GOLD_HEX));
      }
      if (overlay.totalStars) {
        // ★ isn't in the pixel face — this one row draws on the glyph stack.
        const totalStars = overlay.totalStars;
        rows.push({
          h: 12 * fs * 1.35,
          optional: true,
          draw: (y) => {
            ctx.fillStyle = `rgba(${UI_INK},0.45)`;
            ctx.font = this.glyphFont(12 * fs);
            ctx.fillText(`TOTAL ★ ${totalStars}`, cx, y);
          },
        });
      }
      // The badge carries the level number, so it replaces the two text lines
      // this used to need — which is also what pulls the stack back off the
      // buttons on a landscape phone.
      if (overlay.checkpointBanked) {
        rows.push({
          h: 40 * fs,
          draw: (y) => this.drawCheckpointBadge(cx, y, state.cfg.level, now - this.overlayAt - 700),
        });
      }
      if (overlay.dailyUnlockedNow) {
        rows.push(line("DAILY CHALLENGE UNLOCKED", 14 * fs, UI_ACCENT));
      }
      // The forward-looking goal: the cheapest "one more level" hook the game
      // has. Everything above this line is about the level just played; this
      // line is about the next one — which is the decision the player is
      // actually making on this screen.
      if (overlay.nextGoal) {
        rows.push(line(overlay.nextGoal, 13 * fs, `rgba(${UI_INK},0.6)`));
      }
      rows.push(line(`TAP FOR LEVEL ${state.cfg.level + 1}`, 17 * fs, ink));
    } else if (overlay.kind === "lost") {
      const lives = overlay.lives ?? 1;
      rows.push({
        h: 17 * fs * 1.35,
        draw: (y) => {
          // Vector heart beside the count (the old row was a ♥ font glyph).
          const label = `${lives} LEFT`;
          ctx.fillStyle = "rgba(255,215,221,0.9)";
          ctx.font = this.pixelFont(17 * fs, true);
          const w = ctx.measureText(label).width;
          ctx.fillText(label, cx + 10 * fs, y);
          drawHeartIcon(ctx, cx - w / 2 - 2 * fs, y, 16 * fs, "rgba(255,215,221,0.9)");
        },
      });
      // What actually happened — a loss that explains itself is a puzzle to
      // solve rather than a wall. Optional: the retry line matters more when a
      // short viewport forces a choice.
      if (overlay.postmortem) {
        rows.push(line(overlay.postmortem, 13 * fs, `rgba(${UI_INK},0.6)`, true));
      }
      if (overlay.newBoardOnRetry) {
        rows.push(line("NEW BATTLEFIELD ON RETRY", 13 * fs, UI_ACCENT));
      }
      rows.push(line("TAP TO RETRY", 17 * fs, ink));
    } else if (overlay.kind === "runover") {
      rows.push(
        line(
          `REACHED LEVEL ${overlay.reachedLevel ?? state.cfg.level} · BEST ${overlay.bestLevel ?? 1}`,
          17 * fs,
          ink,
        ),
      );
      // "RUN OVER" reads as "back to level 1" unless told otherwise, which for
      // anyone past level 5 is no longer true — and the reassurance is the
      // whole point of the feature, so it must survive a narrow phone.
      const resume = overlay.resumeLevel ?? 1;
      if (resume > 1) {
        rows.push({
          h: 40 * fs,
          draw: (y) => this.drawCheckpointBadge(cx, y, resume - 1, now - this.overlayAt - 700),
        });
        if (overlay.nextGoal) {
          rows.push(line(overlay.nextGoal, 13 * fs, `rgba(${UI_INK},0.6)`, true));
        }
        rows.push(line(`TAP FOR LEVEL ${resume}`, 17 * fs, ink));
      } else {
        rows.push(line("TAP FOR NEW RUN", 17 * fs, ink));
      }
    } else if (overlay.kind === "daily-won") {
      rows.push(
        overlay.cores
          ? line(`+${overlay.cores} CORES`, 17 * fs, UI_ACCENT)
          : line("ALREADY CLAIMED TODAY", 17 * fs, ink),
      );
      // The streak is the only come-back-tomorrow mechanic in the game, and it
      // was persisted but never displayed anywhere. This line IS the D1 hook.
      if (overlay.dailyStreak) {
        rows.push(line(overlay.dailyStreak, 14 * fs, GOLD_HEX));
      }
      rows.push(line("TAP TO RETURN TO YOUR RUN", 17 * fs, ink));
    } else {
      if (overlay.dailyStreak) {
        rows.push(line(overlay.dailyStreak, 14 * fs, `rgba(${UI_INK},0.6)`));
      }
      rows.push(line("TAP TO RETURN TO YOUR RUN", 17 * fs, ink));
    }

    this.layoutRows(rows, L.overlay.body);

    // The journey, between the result and the buttons — the between-levels
    // glance Candy Crush built an industry on. Tapping it opens the map.
    if (overlay.progress && L.overlay.progress) {
      ctx.save();
      this.alphaIn(subA);
      this.drawProgressStrip(
        overlay.progress,
        L.overlay.progress,
        now,
        this.isHot("overlay.progress") || this.isPressed("overlay.progress"),
      );
      ctx.restore();
    }

    if (overlay.kind === "lost" && overlay.skipPuzzle) {
      // Gauntlet mercy: UPGRADES keeps its slot, the daily slot offers the
      // way past the wall. Drawn regardless of dailyLocked — the skip must
      // never be gated behind an unrelated unlock.
      this.uiButton(L.overlay.shop, "UPGRADES", {
        alpha: subA,
        id: "overlay.shop",
        focused: overlay.menuCursor === 1,
      });
      this.uiButton(L.overlay.daily, "SKIP PUZZLE", {
        alpha: subA,
        accent: true,
        id: "overlay.daily",
        focused: overlay.menuCursor === 2,
      });
    } else if (overlay.kind === "won" || overlay.kind === "runover" || overlay.kind === "lost") {
      const shopRect = overlay.dailyLocked ? L.overlay.solo : L.overlay.shop;
      this.uiButton(shopRect, "UPGRADES", {
        alpha: subA,
        id: "overlay.shop",
        focused: overlay.menuCursor === 1,
      });
      // A buyable upgrade lights a dot on the button — live, not frozen at
      // overlay creation, so buying from the shop and returning clears it.
      if (canAfford) {
        ctx.save();
        this.alphaIn(subA);
        ctx.fillStyle = UI_ACCENT;
        ctx.beginPath();
        ctx.arc(shopRect.x + shopRect.w - 8, shopRect.y + 8, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      if (!overlay.dailyLocked) {
        this.uiButton(L.overlay.daily, "DAILY", {
          alpha: subA,
          id: "overlay.daily",
          focused: overlay.menuCursor === 2,
        });
      }
    }
    this.alphaIn(1);
    ctx.restore();
  }

  /**
   * Centre a list of rows inside a band, dropping optional ones if short.
   *
   * Optional rows go in the order they were declared, which puts the star
   * row first — it is the most decorative thing on the win screen and the
   * least costly to lose on a viewport that cannot hold everything.
   */
  private layoutRows(
    rows: { h: number; optional?: boolean; draw: (y: number) => void }[],
    band: Rect,
  ): void {
    let live = rows;
    const total = (rs: typeof rows) => rs.reduce((a, r) => a + r.h, 0);
    for (let i = 0; total(live) > band.h && i < rows.length; i++) {
      const drop = live.findIndex((r) => r.optional);
      if (drop < 0) break;
      live = live.filter((_, j) => j !== drop);
    }
    // Still over budget (a viewport shorter than the mandatory rows): compress
    // rather than overflow into the buttons.
    const squeeze = Math.min(1, band.h / Math.max(1, total(live)));
    let y = band.y + (band.h - total(live) * squeeze) / 2;
    for (const r of live) {
      const h = r.h * squeeze;
      r.draw(y + h / 2);
      y += h;
    }
  }

  /**
   * The banked-checkpoint badge.
   *
   * Reaching a checkpoint is the most valuable thing a win hands a player late
   * in a run, and it used to be announced as a cyan text line with a unicode
   * diamond, in the same type as everything around it. `t` is negative until
   * the stars and cores have had time to read.
   */
  private drawCheckpointBadge(cx: number, cy: number, level: number, age: number): void {
    const { ctx } = this;
    const fs = this.layout.fontScale;
    const t = progress(age, 0, 260, reducedMotion());
    if (t <= 0) return;
    const label = `CHECKPOINT · LEVEL ${level}`;
    const px = 13 * fs;
    ctx.font = this.pixelFont(px, true);
    const h = 32 * fs;
    const w = Math.min(this.layout.overlay.body.w, ctx.measureText(label).width + h + 34);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(lerp(1.25, 1, t), lerp(1.25, 1, t));
    ctx.globalAlpha = t;

    // One expanding ring, which is enough to sell the moment. No particles:
    // this draws in CSS-pixel space and ParticlePool is world-space.
    const ring = progress(age, 0, 420, reducedMotion());
    if (ring < 1) {
      ctx.globalAlpha = t * (1 - ring) * 0.7;
      ctx.strokeStyle = UI_ACCENT;
      ctx.lineWidth = 1.5;
      const s = lerp(1, 1.35, ring);
      this.roundRect((-w * s) / 2, (-h * s) / 2, w * s, h * s, (h * s) / 2);
      ctx.stroke();
      ctx.globalAlpha = t;
    }

    ctx.fillStyle = `rgba(${UI_ACCENT_RGB},0.14)`;
    ctx.strokeStyle = `rgba(${UI_ACCENT_RGB},0.55)`;
    ctx.lineWidth = 1.5;
    this.roundRect(-w / 2, -h / 2, w, h, h / 2);
    ctx.fill();
    ctx.stroke();

    drawFlagIcon(ctx, -w / 2 + h * 0.18, 0, h * 0.42, UI_ACCENT);
    ctx.fillStyle = UI_ACCENT;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, -w / 2 + h * 0.82, 0);
    ctx.textAlign = "center";
    ctx.restore();
  }

  /**
   * One level on the progress path — shared by the strip and the map screen
   * so a level looks like the SAME level on both surfaces.
   *
   * The vocabulary: filled = yours, outlined = ahead of you, pulsing = you
   * are here; a flag above marks a checkpoint, a dashed ring marks a boss,
   * and the stars you earned sit underneath. All vector, nothing sampled.
   */
  private drawLevelNode(e: ProgressEntry, x: number, y: number, r: number, now: number): void {
    const { ctx } = this;
    ctx.save();

    if (e.boss) {
      // A boss is a set piece; its ring says so before the number is read.
      ctx.strokeStyle = e.cleared ? `rgba(${UI_INK},0.25)` : "rgba(255,138,138,0.75)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2.5, 3]);
      ctx.beginPath();
      ctx.arc(x, y, r + 3.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (e.current) {
      // The one slow attention-getter on the path (0.5 Hz, reduced-motion
      // inert via pulseAt — same discipline as the afford glow).
      const pulse = 0.45 + 0.3 * pulseAt(now, 2000);
      ctx.strokeStyle = `rgba(${UI_PLAYER},${pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (e.current) {
      ctx.fillStyle = FACTION_COLORS[PLAYER]!;
      ctx.fill();
    } else if (e.cleared) {
      ctx.fillStyle = `rgba(${UI_PLAYER},0.22)`;
      ctx.fill();
      ctx.strokeStyle = FACTION_DIM[PLAYER]!;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    } else {
      ctx.strokeStyle = `rgba(${UI_INK},0.25)`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = e.current
      ? "#0d1420"
      : e.cleared
        ? `rgba(${UI_INK},0.9)`
        : `rgba(${UI_INK},0.38)`;
    ctx.font = this.pixelFont(Math.round(r * (e.level >= 100 ? 0.72 : 0.95)), true);
    ctx.fillText(`${e.level}`, x, y + 0.5);

    if (e.checkpoint) {
      drawFlagIcon(ctx, x - r * 0.28, y - r - 6.5, r * 0.62, e.locked ? `rgba(${UI_INK},0.3)` : UI_ACCENT);
    }

    if (e.cleared) {
      const sr = r * 0.34;
      for (let i = 0; i < 3; i++) {
        drawStarIcon(
          ctx,
          x + (i - 1) * sr * 2.4,
          y + r + sr + 3,
          sr * 2,
          i < e.stars ? GOLD_HEX : `rgba(${UI_INK},0.7)`,
          i < e.stars,
        );
      }
    }
    ctx.restore();
  }

  /**
   * The progress strip: a horizontal window of the path. Drawn on the win,
   * loss and run-over overlays (where tapping it opens the map) and, for
   * returning players, on the start card (display only there — the card's
   * one job is TAP TO PLAY, and the strip must not steal that tap).
   */
  private drawProgressStrip(entries: ProgressEntry[], rect: Rect, now: number, hot: boolean): void {
    if (entries.length < 2) return;
    const { ctx } = this;
    ctx.save();

    // A quiet chip, so the strip reads as one tappable thing rather than
    // seven floating circles. Hover lifts it like every other control.
    ctx.fillStyle = `rgba(${UI_INK},${hot ? 0.1 : 0.05})`;
    this.roundRect(rect.x, rect.y, rect.w, rect.h, 12);
    ctx.fill();

    const r = Math.min(10, rect.h * 0.2);
    const pad = r + 14;
    const step = (rect.w - 2 * pad) / (entries.length - 1);
    const cy = rect.y + rect.h * 0.52;
    const xAt = (i: number) => rect.x + pad + i * step;

    // The path first, under the nodes. Solid where you have been, dashed
    // where you have not — the road ahead is visible but not yet yours.
    for (let i = 0; i < entries.length - 1; i++) {
      const from = entries[i]!;
      const walked = from.cleared || from.current;
      ctx.strokeStyle = walked ? FACTION_DIM[PLAYER]! : `rgba(${UI_INK},0.18)`;
      ctx.lineWidth = 1.6;
      if (!walked) ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(xAt(i) + r + 2, cy);
      ctx.lineTo(xAt(i + 1) - r - 2, cy);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (let i = 0; i < entries.length; i++) this.drawLevelNode(entries[i]!, xAt(i), cy, r, now);
    ctx.restore();
  }

  /**
   * The level map — the journey, Candy Crush style: a serpentine path of
   * ~18 levels around the player, with stars, checkpoint flags and boss
   * rings. Display-only plus CLOSE, on the shop panel like the help card.
   */
  private drawMapScreen(hud: HudView, now: number): void {
    const { ctx } = this;
    const L = this.layout;
    ctx.save();
    this.uiPanel(L.map.panel, "PROGRESS");

    const entries = hud.mapPath ?? this.lastMapPath ?? [];
    const p = L.map.panel;
    const top = p.y + 58;
    const bottom = L.map.close.y - 12;
    // Landscape phones give the panel its full width but only ~170px of
    // height — 6 rows of 3 would put stars on the node below and turn
    // segments shorter than their own end insets. Rows are the scarce
    // resource, so widen instead: 6 columns when a 3-column grid cannot
    // give every row ~40px. The serpentine reads the same either way.
    let cols = 3;
    let rowsN = Math.max(1, Math.ceil(entries.length / cols));
    if ((bottom - top) / rowsN < 40) {
      cols = 6;
      rowsN = Math.max(1, Math.ceil(entries.length / cols));
    }
    const cellW = (p.w - 32) / cols;
    const cellH = (bottom - top) / rowsN;
    const r = Math.max(11, Math.min(17, cellH * 0.24, cellW * 0.2));
    const pos = (i: number) => {
      const row = Math.floor(i / cols);
      const col = row % 2 === 0 ? i % cols : cols - 1 - (i % cols); // serpentine
      return { x: p.x + 16 + (col + 0.5) * cellW, y: top + (row + 0.5) * cellH };
    };

    // Consecutive levels stay adjacent under the serpentine, so the path is
    // just centre-to-centre segments — including the turns.
    for (let i = 0; i < entries.length - 1; i++) {
      const from = entries[i]!;
      const a = pos(i);
      const b = pos(i + 1);
      const walked = from.cleared || from.current;
      ctx.strokeStyle = walked ? FACTION_DIM[PLAYER]! : `rgba(${UI_INK},0.16)`;
      ctx.lineWidth = 1.8;
      if (!walked) ctx.setLineDash([3, 4]);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      // Inset both ends, but never past the midpoint: an inset longer than
      // half the segment draws an inverted stroke back through the nodes.
      const inset = Math.min(r + 4, Math.hypot(b.x - a.x, b.y - a.y) / 2 - 1);
      ctx.beginPath();
      ctx.moveTo(a.x + Math.cos(ang) * inset, a.y + Math.sin(ang) * inset);
      ctx.lineTo(b.x - Math.cos(ang) * inset, b.y - Math.sin(ang) * inset);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (let i = 0; i < entries.length; i++) {
      const { x, y } = pos(i);
      this.drawLevelNode(entries[i]!, x, y, r, now);
    }

    this.uiButton(L.map.close, "CLOSE", { id: "map.close" });
    ctx.restore();
  }

  /** Upgrade shop panel — canvas-only, same pattern as the pause menu. */
  private drawShop(shop: ShopView): void {
    const { ctx } = this;
    const L = this.layout;
    const fs = L.fontScale;
    const now = performance.now();
    ctx.save();

    // Eased, so buying something counts up rather than snapping. ShopView is
    // rebuilt from save.cores every frame, so without this it jumps.
    const dt = Math.min(0.05, (now - this.shopCoresAt) / 1000);
    this.shopCoresAt = now;
    this.shopCoresShown += (shop.cores - this.shopCoresShown) * Math.min(1, dt * 8);
    if (Math.abs(shop.cores - this.shopCoresShown) < 1) this.shopCoresShown = shop.cores;
    this.uiPanel(L.shop.panel, "UPGRADES", Math.round(this.shopCoresShown));

    // Tab chips under the title. Active is filled and underlined in the ink
    // the rows use; inactive dims but keeps its full hit box (they are the
    // only way to reach the POWERS rows, so both must read as controls).
    SHOP_TABS.forEach((label, i) => {
      const r = L.shop.tabs[i];
      if (!r) return;
      const active = shop.tab === i;
      const id = `shop.tab${i}`;
      const hot = this.isHot(id) || this.isPressed(id);
      const hovT = this.hoverEase(id, hot);
      ctx.fillStyle = active
        ? `rgba(${UI_PLAYER},0.16)`
        : `rgba(${UI_INK},${0.04 + 0.05 * hovT})`;
      this.roundRect(r.x, r.y, r.w, r.h, 8);
      ctx.fill();
      ctx.strokeStyle = active
        ? `rgba(${UI_PLAYER},0.6)`
        : `rgba(${UI_INK},${0.15 + 0.2 * hovT})`;
      ctx.lineWidth = active ? 2 : 1.5;
      this.roundRect(r.x, r.y, r.w, r.h, 8);
      ctx.stroke();
      ctx.fillStyle = active ? `rgba(${UI_INK},0.95)` : `rgba(${UI_INK},${0.45 + 0.25 * hovT})`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      this.fitText(label, r.x + r.w / 2, r.y + r.h / 2, 13 * fs, { maxW: r.w - 14 });
    });

    shop.rows.forEach((row, i) => {
      const r = L.shop.rows[i];
      if (!r) return;
      const owned = row.cost === null;
      const focused = shop.menuCursor === i;
      const hot = this.isHot(`shop.row${i}`) || this.isPressed(`shop.row${i}`);
      const flash = this.shopFlash;
      const flashT = flash && flash.row === i ? (now - flash.at) / (flash.ok ? 300 : 180) : 1;
      const flashing = flashT < 1;

      // A denied purchase shakes. An unaffordable tap used to do literally
      // nothing, which is the clearest "is this broken?" moment in the game.
      const shakeX =
        flashing && !flash!.ok && !reducedMotion() ? Math.sin(flashT * Math.PI * 3) * 2 : 0;
      ctx.save();
      ctx.translate(shakeX, 0);

      ctx.fillStyle = owned
        ? `rgba(${UI_PLAYER},0.1)`
        : row.affordable
          ? `rgba(${UI_PLAYER},0.12)`
          : `rgba(${UI_INK},0.05)`;
      if (flashing && flash!.ok) {
        // Pulse the track's own tint on a successful buy.
        ctx.fillStyle = TRACK_TINT[row.key as ShopIconKey] ?? `rgba(${UI_PLAYER},0.5)`;
        this.alphaIn(0.28 * (1 - flashT));
      }
      ctx.strokeStyle = focused
        ? UI_ACCENT
        : hot
          ? `rgba(${UI_INK},0.45)`
          : row.affordable || owned
            ? `rgba(${UI_PLAYER},0.5)`
            : `rgba(${UI_INK},0.15)`;
      ctx.lineWidth = focused || hot ? 2.5 : 1.5;
      this.roundRect(r.x, r.y, r.w, r.h, 7);
      ctx.fill();
      this.alphaIn(1);
      if (flashing && flash!.ok) {
        this.roundRect(r.x, r.y, r.w, r.h, 7);
        ctx.fillStyle = `rgba(${UI_PLAYER},0.12)`;
        ctx.fill();
      }
      ctx.stroke();

      // Owned reads as a state, not a stat: a full row with a cyan edge,
      // rather than cyan "MAX" text inside unaffordable-grey chrome.
      if (owned) {
        ctx.fillStyle = UI_ACCENT;
        ctx.fillRect(r.x + 1.5, r.y + 8, 3, r.h - 16);
      }

      // The icon is the first thing to go on a narrow row. At 210 CSS px
      // (360x540 notched, the tightest viewport in the matrix) a 24 px icon
      // column plus the cost label leaves under 90 px for the text, which
      // would shrink the name past legibility.
      const showIcon = r.w >= 250;
      const iconW = Math.min(26, r.h * 0.5);
      // `in`-guarded: the Records are keyed by ShopIconKey, and future rows
      // (cosmetics) may carry keys those tables have never heard of.
      const icon = row.key in TRACK_ICONS ? TRACK_ICONS[row.key as ShopIconKey] : undefined;
      const textL = r.x + 12 + (showIcon && icon ? iconW + 10 : 0);
      if (showIcon && icon) {
        const tint =
          row.affordable || owned
            ? (TRACK_TINT[row.key as ShopIconKey] ?? `rgba(${UI_PLAYER},0.6)`)
            : `rgba(${UI_INK},0.28)`;
        icon(ctx, r.x + 12 + iconW / 2, r.y + r.h / 2, iconW, tint);
      }

      // Pips ride the name line, right-aligned. They used to sit left of the
      // cost with a measured back-off, which is what made the row layout
      // fragile; up here they need no arithmetic against the cost's width.
      const pip = 5;
      const pipGap = 4;
      const pipsW = row.maxTier * pip + (row.maxTier - 1) * pipGap;
      const pipX = r.x + r.w - 12 - pipsW;
      for (let t = 0; t < row.maxTier; t++) {
        ctx.fillStyle = t < row.tier ? UI_ACCENT : `rgba(${UI_INK},0.18)`;
        ctx.beginPath();
        ctx.arc(pipX + t * (pip + pipGap) + pip / 2, r.y + r.h * 0.32, pip / 2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = `rgba(${UI_INK},0.9)`;
      this.fitText(row.name, textL, r.y + r.h * 0.32, 13 * fs, {
        maxW: Math.max(40, pipX - textL - 10),
      });

      // Cost sits on the effect line, beside the thing it buys.
      ctx.textAlign = "right";
      ctx.font = this.pixelFont(13 * fs, true);
      const costLabel = owned ? "OWNED" : `${row.cost}`;
      const costInk =
        flashing && !flash!.ok
          ? SEMANTIC.danger
          : owned || row.affordable
            ? UI_ACCENT
            : `rgba(${UI_INK},0.35)`;
      ctx.fillStyle = costInk;
      ctx.fillText(costLabel, r.x + r.w - 12, r.y + r.h * 0.71);
      let costW = ctx.measureText(costLabel).width;
      if (!owned) {
        // Vector core glyph in place of the fallback-font ◈.
        const iconPx = Math.min(12 * fs, 15);
        drawCoreIcon(ctx, r.x + r.w - 12 - costW - 8 * fs, r.y + r.h * 0.71, iconPx, costInk);
        costW += 8 * fs + iconPx;
      }

      ctx.textAlign = "left";
      ctx.fillStyle = `rgba(${UI_INK},0.55)`;
      // Must shrink: at the narrowest row this line is the first thing that
      // would overrun the cost.
      this.fitText(row.desc, textL, r.y + r.h * 0.71, 12 * fs, {
        maxW: Math.max(40, r.x + r.w - 12 - costW - 12 - textL),
        weight: "",
      });

      ctx.restore();
    });

    this.uiButton(L.shop.close, "CLOSE", {
      focused: (shop.menuCursor ?? -1) >= shop.rows.length,
      id: "shop.close",
    });
    ctx.restore();
  }


  /**
   * Branded start card — the first thing anyone sees.
   *
   * Boot used to be a black canvas and then, silently, a board. This gives the
   * game a face, and the tap that dismisses it is what unlocks WebAudio (no
   * browser will start audio without a gesture). It costs one click before
   * play, and buys a title, a soundtrack and a readable control hint.
   *
   * The board is already running behind it as an AI-only demo, so the card
   * sits over motion rather than a still frame.
   */
  private drawStartCard(now: number, hud?: HudView): void {
    const { ctx } = this;
    const L = this.layout;
    const fs = L.fontScale;
    // The chrome tracker supplies the fade now — on the very first frame it
    // transitions "none" -> "startCard", which is the boot fade-in for free.
    // That is why markStartCard() and its clock are gone.
    const fade = 1;

    ctx.save();

    const cx = L.cssW / 2;
    const cy = L.cssH / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Title, shrunk to fit a narrow phone.
    ctx.save();
    this.alphaIn(fade);
    // Measure first: the baseline is a function of the size actually used.
    const titlePx = this.fitText("OVERRUN", 0, 0, Math.min(84, L.cssW * 0.19), {
      maxW: 0.82 * L.cssW,
      draw: false,
      face: "display",
    });
    ctx.fillStyle = FACTION_COLORS[PLAYER];
    ctx.fillText("OVERRUN", cx, cy - titlePx * 0.75);
    ctx.restore();

    this.alphaIn(fade);
    const subPx = 15 * fs;
    // The GOAL, on the one screen every player reads before touching anything.
    // Two lines, both load-bearing: "YOU ARE BLUE" drawn in the player's own
    // colour is the entire faction-identity lesson (the old copy never said
    // which of the five colours was you), and "EAT EVERY OTHER COLOR" states
    // the win condition in the game's physical verb — you pour units into a
    // ball until it flips. The how-to-drag line moved to coach step 1, which
    // shows it with an arrow at the moment it is actionable. fitText clamps
    // both lines (the old copy drew unclamped and could overflow a narrow
    // phone).
    //
    // Leading is font-relative, unlike the fixed cy offsets around it, so the
    // two lines cannot converge as `fontScale` shrinks on a small screen.
    const lead = subPx * 1.35;
    ctx.fillStyle = FACTION_COLORS[PLAYER];
    // Site re-skin: the player faction is cyan here, not upstream's blue.
    this.fitText("YOU ARE CYAN", cx, cy - 4, subPx, { maxW: 0.88 * L.cssW, weight: "" });
    ctx.fillStyle = `rgba(${UI_INK},0.55)`;
    this.fitText("EAT EVERY OTHER COLOR TO WIN", cx, cy - 4 + lead, subPx, {
      maxW: 0.88 * L.cssW,
      weight: "",
    });

    // Breathing prompt — the only animated thing, so the eye goes to it.
    const pulse = reducedMotion() ? 1 : 0.65 + 0.35 * Math.abs(Math.sin(now / 620));
    this.alphaIn(fade * pulse);
    ctx.fillStyle = `rgba(${UI_INK},0.95)`;
    this.setTracking(20 * fs);
    ctx.font = this.pixelFont(20 * fs, true);
    ctx.fillText("TAP TO PLAY", cx, cy + 44 + lead);

    // Returning players see where they are on the journey; new players keep
    // the clean three-line card (the conversion funnel comes first). Display
    // only — every tap on this card must start the game, so the strip is
    // deliberately NOT a control here. The bottom slot is the overlay strip's
    // rect, which the layout only provides on screens tall enough for it.
    if (hud?.startPath && L.overlay.progress) {
      this.alphaIn(fade * 0.9);
      this.drawProgressStrip(hud.startPath, L.overlay.progress, now, false);
    }

    this.alphaIn(1);
    ctx.restore();
  }

  /**
   * The onboarding banner: what to do, how far through, and a way out.
   *
   * All three parts are the feature. Before this the game taught the same
   * lessons with an unlabelled dashed arrow and an unlabelled spotlight, which
   * teach a player who is already paying attention and say nothing to one who
   * is confused. "STEP 2 OF 5" is what turns coaching into an onboarding: it
   * promises an end. SKIP is what makes the promise optional.
   */
  /**
   * The standing objective line — the coach banner's quiet sibling. Same
   * slot, no step counter, no SKIP: it is a goal, not a lesson, and it stays
   * up because "clear reachable goals visible at all times" is the exact bar
   * the quality guidelines set. The coach wins the slot while it lives.
   */
  private drawObjectiveBanner(text: string): void {
    const { ctx } = this;
    const L = this.layout;
    const b = L.coachBanner;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = `rgba(${UI_SCRIM},0.55)`;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.font = this.pixelFont(Math.round(13.5 * L.fontScale), true);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,177,61,0.95)"; // objective gold — matches the marks
    ctx.fillText(text, b.x + b.w / 2, b.y + b.h / 2);
    ctx.restore();
  }

  /**
   * World-space objective marks: the crown's gold ring (and the player's own
   * crowned ball, dash-ringed — losing it loses the level, it must never
   * read as an ordinary ball), and the hill's hold-progress ring. Line
   * widths hold a constant apparent size across camera zoom, same trick as
   * glyphUnit.
   */
  private drawObjectiveMarks(state: GameState, now: number): void {
    const obj = state.cfg.objective;
    if (!obj) return;
    const { ctx } = this;
    const GOLD = GOLD_HEX;
    const lw = Math.max(0.45, 3.2 / Math.max(0.001, this.cam.cssScale));
    const pulse = REDUCED_MOTION() ? 0.8 : 0.6 + 0.3 * (0.5 + 0.5 * Math.sin(now / 320));

    const ring = (n: Node, pad: number, alpha: number, dashed = false) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = lw;
      if (dashed) ctx.setLineDash([lw * 2.2, lw * 1.6]);
      ctx.beginPath();
      ctx.arc(n.x, n.y, NODE_R[n.size]! + pad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    };

    if ((obj.type === "crown" || obj.type === "gauntlet") && obj.targetNodeId !== undefined) {
      const target = state.nodes[obj.targetNodeId];
      if (target) {
        ring(target, 2.2, pulse);
        ring(target, 3.6, pulse * 0.45);
      }
    }
    if (obj.type === "crown" && obj.playerCrownId !== undefined) {
      const own = state.nodes[obj.playerCrownId];
      if (own) ring(own, 2.2, pulse * 0.8, true);
    }
    if (obj.type === "hold" && obj.targetNodeId !== undefined) {
      const hill = state.nodes[obj.targetNodeId];
      if (hill) {
        const r = NODE_R[hill.size]! + 2.6;
        ctx.save();
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = lw;
        ctx.globalAlpha = 0.28;
        ctx.beginPath();
        ctx.arc(hill.x, hill.y, r, 0, Math.PI * 2);
        ctx.stroke();
        const frac = Math.min(1, state.holdTicks / Math.max(1, obj.requiredTicks ?? 1));
        if (frac > 0) {
          ctx.globalAlpha = hill.owner === PLAYER ? pulse : 0.75;
          ctx.beginPath();
          ctx.arc(hill.x, hill.y, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  /**
   * World-space marks for the live ability effects: an overcharged ball wears
   * a gold surge ring, a stasised one a cyan freeze ring, each with a
   * clockwise remaining-time arc (the hold ring's grammar, reused, so the
   * "this is temporary and draining" read is already taught). Same
   * constant-apparent-width trick as drawObjectiveMarks.
   */
  private drawAbilityEffects(state: GameState, now: number): void {
    const fx = state.effects;
    if (!fx || (fx.overcharge.length === 0 && fx.stasis.length === 0)) return;
    const { ctx } = this;
    const lw = Math.max(0.45, 3.0 / Math.max(0.001, this.cam.cssScale));
    const pulse = REDUCED_MOTION() ? 0.85 : 0.65 + 0.3 * (0.5 + 0.5 * Math.sin(now / 260));

    const mark = (
      list: { node: number; until: number }[],
      total: number,
      color: string,
      dashed: boolean,
    ) => {
      for (const e of list) {
        const n = state.nodes[e.node];
        if (!n || e.until <= state.tick) continue;
        const r = NODE_R[n.size]! + 2.4;
        const frac = Math.min(1, (e.until - state.tick) / total);
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        if (dashed) ctx.setLineDash([lw * 2, lw * 1.6]);
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = pulse;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    };
    mark(fx.overcharge, OVERCHARGE_TICKS, TRACK_TINT.overcharge, false);
    mark(fx.stasis, STASIS_TICKS, TRACK_TINT.stasis, true);
  }

  /**
   * Targeting mode: a scrim over the whole board with a pulsing ring on every
   * LEGAL target — own balls for overcharge, everything else for stasis. The
   * dim is what says "the next tap is special"; the rings say where it may
   * land. Recall never arms, so it never reaches here.
   */
  private drawTargeting(state: GameState, ability: AbilityKey, now: number): void {
    const { ctx } = this;
    const vb = this.visibleWorldBounds();
    ctx.save();
    ctx.fillStyle = `rgba(${UI_SCRIM},0.30)`;
    ctx.fillRect(vb.x0, vb.y0, vb.x1 - vb.x0, vb.y1 - vb.y0);
    const lw = Math.max(0.5, 3.2 / Math.max(0.001, this.cam.cssScale));
    const pulse = REDUCED_MOTION() ? 0.9 : 0.55 + 0.4 * (0.5 + 0.5 * Math.sin(now / 220));
    ctx.strokeStyle = TRACK_TINT[ability as ShopIconKey] ?? "#e8f2e9";
    ctx.lineWidth = lw;
    for (const n of state.nodes) {
      const legal = ability === "overcharge" ? n.owner === PLAYER : n.owner !== PLAYER;
      if (!legal) continue;
      ctx.globalAlpha = pulse;
      ctx.beginPath();
      ctx.arc(n.x, n.y, NODE_R[n.size]! + 2.8, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * The bottom-right ability stack: icon, remaining-charge pips, and the
   * digit that fires it. No cooldown ring — charges are the whole economy,
   * and a spent button reads spent by dimming to the chrome's resting look.
   */
  private drawAbilityButtons(hud: HudView, now: number): void {
    const list = hud.abilities;
    if (!list || list.length === 0) return;
    const { ctx } = this;
    const L = this.layout;
    const fs = L.fontScale;
    ctx.save();
    for (let i = 0; i < list.length && i < L.abilityButtons.length; i++) {
      const r = L.abilityButtons[i]!;
      const ab = list[i]!;
      const id = `ability${i}`;
      const hot = this.isHot(id) || this.isPressed(id);
      const hovT = this.hoverEase(id, hot);
      const armed = hud.armedAbility === ab.key;
      const usable = ab.charges > 0;
      const tint = TRACK_TINT[ab.key as ShopIconKey] ?? `rgba(${UI_PLAYER},0.6)`;

      // Chip. Armed breathes in its own tint; spent rests at the dim chrome.
      const armGlow = armed ? (REDUCED_MOTION() ? 1 : 0.7 + 0.3 * pulseAt(now, 900)) : 0;
      ctx.fillStyle = `rgba(20,24,33,${0.62 + 0.18 * hovT + 0.1 * armGlow})`;
      this.roundRect(r.x, r.y, r.w, r.h, 9);
      ctx.fill();
      ctx.strokeStyle = armed
        ? tint
        : usable
          ? `rgba(${UI_INK},${0.22 + 0.3 * hovT})`
          : `rgba(${UI_INK},0.10)`;
      ctx.lineWidth = armed ? 2 : 1;
      this.roundRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 9);
      ctx.stroke();

      // Icon, tinted while usable, ghosted when out of charges.
      const icon = TRACK_ICONS[ab.key as ShopIconKey];
      icon?.(ctx, r.x + r.w / 2, r.y + r.h / 2 - 4, r.w * 0.5, usable ? tint : `rgba(${UI_INK},0.25)`);

      // Charge pips along the bottom edge.
      const pip = 4.5;
      const pipGap = 3.5;
      const pipsW = ab.charges * pip + Math.max(0, ab.charges - 1) * pipGap;
      for (let p = 0; p < ab.charges; p++) {
        ctx.fillStyle = tint;
        ctx.beginPath();
        ctx.arc(
          r.x + r.w / 2 - pipsW / 2 + p * (pip + pipGap) + pip / 2,
          r.y + r.h - 7,
          pip / 2,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      if (ab.charges === 0) {
        ctx.fillStyle = `rgba(${UI_INK},0.3)`;
        ctx.font = this.pixelFont(8 * Math.min(fs, 1.2), true);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("SPENT", r.x + r.w / 2, r.y + r.h - 7);
      }

      // The key hint, top-left, desktop-legible and touch-ignorable.
      ctx.fillStyle = `rgba(${UI_INK},${usable ? 0.5 : 0.22})`;
      ctx.font = this.pixelFont(9 * Math.min(fs, 1.2), true);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(`${i + 1}`, r.x + 5, r.y + 4);
    }
    ctx.restore();
  }

  private drawCoach(coach: CoachView, now: number, t: number): void {
    const { ctx } = this;
    const L = this.layout;
    const fs = L.fontScale;
    const b = L.coachBanner;

    // `t` is 1 when settled, ramps up on arrival and back down on departure.
    // It used to pop in and out between frames, which on level 1 is the very
    // first thing the game does after the board appears.
    const dy = lerp(14, 0, t);

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = t;
    ctx.translate(0, dy);

    // Scrim, not a reserved band — see the note on coachBanner in ui-layout.
    ctx.fillStyle = `rgba(${UI_SCRIM},0.72)`;
    this.roundRect(b.x, b.y, b.w, b.h, 10);
    ctx.fill();
    ctx.strokeStyle = `rgba(${UI_INK},0.10)`;
    ctx.lineWidth = 1;
    this.roundRect(b.x, b.y, b.w, b.h, 10);
    ctx.stroke();

    // A rule down the left edge, in the player's colour: this banner is about
    // you, and the colour says so before the words are read.
    ctx.fillStyle = FACTION_COLORS[PLAYER];
    ctx.fillRect(b.x + 6, b.y + 8, 2, b.h - 16);

    const skip = L.coachSkip;
    const textRight = skip.x - 10;
    const textLeft = b.x + 16;
    const cx = (textLeft + textRight) / 2;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = `rgba(${UI_INK},0.45)`;
    ctx.font = this.pixelFont(10 * fs, true);
    const label = `STEP ${coach.index + 1} OF ${coach.total}`;
    const labelW = ctx.measureText(label).width;
    const rowY = b.y + b.h * 0.3;

    // Segment track beside the counter. The words stay — they are the
    // documented promise that this ends, and the accessible fallback — but a
    // glanceable version of the same fact costs four rectangles.
    const segW = 9;
    const segGap = 3;
    const segsW = coach.total * segW + (coach.total - 1) * segGap;
    const groupW = labelW + 10 + segsW;
    ctx.textAlign = "left";
    ctx.fillText(label, cx - groupW / 2, rowY);
    for (let i = 0; i < coach.total; i++) {
      const x = cx - groupW / 2 + labelW + 10 + i * (segW + segGap);
      ctx.fillStyle =
        i < coach.index
          ? `rgba(${UI_PLAYER},0.9)`
          : i === coach.index
            ? FACTION_COLORS[PLAYER]
            : `rgba(${UI_INK},0.14)`;
      ctx.fillRect(x, rowY - 1.25, segW, 2.5);
    }
    ctx.textAlign = "center";

    // Breathing, like the start card's prompt — the eye should find it.
    ctx.globalAlpha = t * (reducedMotion() ? 1 : 0.78 + 0.22 * Math.abs(Math.sin(now / 700)));
    ctx.fillStyle = "#e8f2e9";
    this.fitText(coach.text, cx, b.y + b.h * 0.66, 13 * fs, {
      maxW: Math.max(40, textRight - textLeft),
    });
    ctx.globalAlpha = t;

    // Skip: quiet, but never smaller than a thumb (the rect is MIN_TAP).
    const skipHot = this.isHot("coachSkip") || this.isPressed("coachSkip");
    ctx.fillStyle = `rgba(${UI_INK},${skipHot ? 0.16 : 0.08})`;
    this.roundRect(skip.x, b.y + 5, skip.w, b.h - 10, 8);
    ctx.fill();
    ctx.fillStyle = `rgba(${UI_INK},${skipHot ? 0.9 : 0.6})`;
    ctx.font = this.pixelFont(11 * fs, true);
    ctx.fillText("SKIP", skip.x + skip.w / 2, b.y + b.h / 2);

    ctx.restore();
  }




  /**
   * The onboarding, as a card you can come back to.
   *
   * This is what makes SKIP safe. An onboarding you can decline but never
   * consult is not skippable, it is losable — and the hint arrow used to
   * disappear after level 3 with no reference anywhere in the game.
   *
   * Reads COACH_STEPS rather than restating them, so the card and the coaching
   * cannot drift apart.
   */
  private drawHelpCard(): void {
    const { ctx } = this;
    const L = this.layout;
    const fs = L.fontScale;
    ctx.save();
    // L.help.panel and L.help.close come from the SAME panelGrid call. They
    // used to come from two different ones, which put CLOSE 11-16 px below the
    // card it belonged to on every viewport in the matrix.
    const p = L.help.panel;
    this.uiPanel(p, "HOW TO PLAY");

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const x = p.x + 20;
    // Count what is actually drawn below: the steps, TWO dim goal lines, the
    // 0.4-row breath before CONTROLS, the header, and the control lines. The
    // old formula (`steps + 1 + controls + 1`) under-reserved by 1.4 rows —
    // survivable at four steps, an overflow into the CLOSE footer at five.
    const rows = COACH_STEPS.length + 2 + 0.4 + 1 + CONTROL_LINES.length;
    const top = p.y + 54;
    const lineH = Math.min(30, (p.y + p.h - 66 - top) / rows);
    let row = 0;
    const line = (y: number, n: string | null, text: string, dim = false): void => {
      if (n !== null) {
        ctx.fillStyle = FACTION_COLORS[PLAYER];
        ctx.font = this.pixelFont(13 * fs, true);
        ctx.fillText(n, x, y);
      }
      ctx.fillStyle = `rgba(${UI_INK},${dim ? 0.55 : 0.85})`;
      this.fitText(text, x + (n === null ? 0 : 18), y, 12 * fs, {
        maxW: p.w - 56,
        weight: dim ? "bold" : "",
      });
    };

    COACH_STEPS.forEach((step, i) => line(top + row++ * lineH, `${i + 1}`, step.text));
    // The one rule no step teaches, because it is the goal rather than a verb.
    //
    // This said "TAKE EVERY NODE TO WIN THE LEVEL", which is false: `updateStatus`
    // ends the level when no rival is alive (tick.ts), and grey nodes can be left
    // standing. The only written statement of the objective in the whole game
    // taught the wrong objective, and it contradicted the HUD's own rival count.
    line(top + row++ * lineH, null, "EAT EVERY RIVAL COLOR TO WIN THE LEVEL", true);
    line(top + row++ * lineH, null, "GREY BALLS ARE OPTIONAL — THEY MAKE YOU STRONGER", true);

    row += 0.4; // a breath between the two sections
    ctx.fillStyle = UI_ACCENT;
    ctx.font = this.pixelFont(11 * fs, true);
    ctx.fillText("CONTROLS", x, top + row++ * lineH);
    for (const c of CONTROL_LINES) line(top + row++ * lineH, null, c, true);

    ctx.textAlign = "center";
    this.uiButton(L.help.close, "CLOSE", { accent: true, id: "help.close" });
    ctx.restore();
  }

  private drawPauseMenu(cursor: number | null, restartArmed = false, canAfford = false): void {
    const { ctx } = this;
    const L = this.layout;
    ctx.save();
    this.uiPanel(L.pauseMenu.panel, "PAUSED");
    const labels = [
      "RESUME",
      "RESTART RUN",
      "UPGRADES",
      "DAILY CHALLENGE",
      "PROGRESS",
      "HOW TO PLAY",
      "SETTINGS",
      "BACK TO PLAYHOUSE", // site seam: the embedded game's way out
    ];
    L.pauseMenu.rows.forEach((r, i) => {
      const arming = restartArmed && PAUSE_ACTIONS[i] === "restart";
      this.uiButton(r, arming ? "TAP AGAIN TO CONFIRM" : (labels[i] ?? ""), {
        accent: i === 0,
        focused: cursor === i,
        danger: arming,
        id: `pause.${PAUSE_ACTIONS[i]}`,
      });
      // Same buyable-dot the win overlay's UPGRADES button carries — the two
      // entrances to the shop should advertise the same fact.
      if (canAfford && PAUSE_ACTIONS[i] === "shop") {
        ctx.fillStyle = UI_ACCENT;
        ctx.beginPath();
        ctx.arc(r.x + r.w - 8, r.y + 8, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.restore();
  }

  /**
   * Volume and motion.
   *
   * Steppers rather than sliders: a canvas slider needs pointermove capture, a
   * keyboard equivalent and a 44 px thumb, and buys nothing over four taps.
   * Step 0 is off, so "off" lives in the same control as every other level
   * instead of being a separate toggle.
   */
  private drawSettings(hud: HudView): void {
    const { ctx } = this;
    const L = this.layout;
    const fs = L.fontScale;
    ctx.save();
    this.uiPanel(L.settings.panel, "SETTINGS");

    const motion = hud.motionPref ?? "auto";
    const values: Record<SettingsAction, { label: string; level?: number; text?: string }> = {
      music: { label: "MUSIC", level: hud.musicLevel ?? 0 },
      sfx: { label: "SOUND FX", level: hud.sfxLevel ?? 0 },
      motion: {
        label: "MOTION",
        text: motion === "auto" ? "AUTO" : motion === "on" ? "REDUCED" : "FULL",
      },
    };

    SETTINGS_ACTIONS.forEach((key, i) => {
      const r = L.settings.rows[i];
      if (!r) return;
      const v = values[key];
      const focused = hud.menuCursor === i;
      const hotRow = this.isHot(`settings.${key}`) || this.isPressed(`settings.${key}`);
      ctx.fillStyle = `rgba(${UI_INK},0.05)`;
      ctx.strokeStyle = focused ? UI_ACCENT : hotRow ? `rgba(${UI_INK},0.45)` : `rgba(${UI_INK},0.15)`;
      ctx.lineWidth = focused || hotRow ? 2.5 : 1.5;
      this.roundRect(r.x, r.y, r.w, r.h, 7);
      ctx.fill();
      ctx.stroke();

      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = `rgba(${UI_INK},0.9)`;
      ctx.font = this.pixelFont(13 * fs, true);
      ctx.fillText(v.label, r.x + 14, r.y + r.h / 2);

      if (v.level !== undefined) {
        // Four bars of rising height — the level reads without a number.
        const barW = 7;
        const gap = 4;
        const maxH = Math.min(20, r.h * 0.45);
        const right = r.x + r.w - 14;
        for (let s = 0; s < LEVEL_STEPS; s++) {
          const h = maxH * (0.32 + (0.68 * s) / (LEVEL_STEPS - 1));
          const x = right - (LEVEL_STEPS - s) * (barW + gap) + gap;
          ctx.fillStyle = s < v.level ? UI_ACCENT : `rgba(${UI_INK},0.18)`;
          ctx.fillRect(x, r.y + r.h / 2 + maxH / 2 - h, barW, h);
        }
        if (v.level === 0) {
          ctx.textAlign = "right";
          ctx.fillStyle = `rgba(${UI_INK},0.45)`;
          ctx.font = this.pixelFont(11 * fs, true);
          ctx.fillText("OFF", right - LEVEL_STEPS * (barW + gap) - 6, r.y + r.h / 2);
        }
      } else {
        ctx.textAlign = "right";
        ctx.fillStyle = UI_ACCENT;
        ctx.font = this.pixelFont(13 * fs, true);
        ctx.fillText(v.text ?? "", r.x + r.w - 14, r.y + r.h / 2);
      }
    });

    ctx.textAlign = "center";
    this.uiButton(L.settings.close, "BACK", {
      accent: true,
      focused: (hud.menuCursor ?? -1) >= SETTINGS_ACTIONS.length,
      id: "settings.close",
    });
    ctx.restore();
  }


  /**
   * Draw centred text, shrinking the font until it fits the screen width.
   *
   * The overlay title had this and its body lines did not, which was fine only
   * for as long as every body line was short. "REACHED LEVEL 28 · BEST 28" was
   * already touching both edges at 560 CSS px, and the checkpoint line is
   * longer than that. Copy grows; screens do not.
   */
  /**
   * Proportional tracking for the UI type.
   *
   * Every string in this game is ALL CAPS, and all-caps set with zero
   * letter-spacing is the signature of `ctx.fillText` with no design pass —
   * caps need air. 0.05 em, proportional to the size actually used. The boot
   * screen in index.html already tracks its caps; the canvas that replaces it
   * didn't, which is part of why the same aesthetic read as "designed" there
   * and "default" here.
   *
   * `letterSpacing` is Chrome 99+/Safari 17.4+ (inside the platform floor) and
   * silently a no-op elsewhere. It participates in the canvas state stack, so
   * save/restore handles leaks across blocks — but fitText still resets after
   * drawing, because world-space text (node unit counts) must stay untracked
   * and not every caller is inside a save.
   */
  private setTracking(px: number): void {
    (this.ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
      px > 0 ? `${(px * 0.05).toFixed(2)}px` : "0px";
  }

  private fitText(
    text: string,
    x: number,
    y: number,
    px: number,
    opts: {
      maxW?: number;
      weight?: string;
      align?: CanvasTextAlign;
      draw?: boolean;
      face?: "display" | "pixel";
    } = {},
  ): number {
    const { ctx } = this;
    const weight = opts.weight ?? "bold";
    const maxW = opts.maxW ?? 0.9 * this.layout.cssW;
    // Only touch textAlign when asked: the four original callers rely on the
    // alignment already set by their surrounding block.
    if (opts.align !== undefined) ctx.textAlign = opts.align;
    // The display face (Jersey 15) ships weight 400 only — never synth-bold it.
    const font = (size: number) =>
      opts.face === "display"
        ? this.displayFont(size)
        : this.pixelFont(size, weight !== "");
    // Tracking scales with the size, and must be set BEFORE measuring —
    // measureText respects letterSpacing, which is what keeps shrink-to-fit
    // honest. Width stays ~proportional to size, so the one-step ratio fit
    // below remains valid.
    this.setTracking(px);
    ctx.font = font(px);
    const w = ctx.measureText(text).width;
    const used = w > maxW ? (px * maxW) / w : px;
    if (used !== px) {
      this.setTracking(used);
      ctx.font = font(used);
    }
    if (opts.draw !== false) {
      ctx.fillText(text, x, y);
      this.setTracking(0);
    }
    // Measure-only calls keep font AND tracking set — the one caller (the
    // start-card title) draws manually on the very next line with them.
    return used;
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** App layer stores the winning capture position before calling finalBlow. */
  setFinalBlowFocus(x: number, y: number): void {
    this.pendingFocus = { x, y };
  }
}
