import type { GameState, LevelCfg, Node } from "./sim/state";
import { hashState, PLAYER, WORLD_H, WORLD_W } from "./sim/state";

/** The level's board half-extents, for the renderer's content clamp. */
const worldHalfOf = (cfg: LevelCfg) => ({
  rx: cfg.worldHx ?? WORLD_W / 2,
  ry: cfg.worldHy ?? WORLD_H / 2,
});
import { tick } from "./sim/tick";
import { BOSS_EVERY, createDailyLevel, createLevel, isBossLevel } from "./sim/level";
import { DEV_HANDLES } from "./dev";
import { screenLevel, seedSequence } from "./sim/screen";
import type { Command } from "./sim/commands";
import { createLoop } from "./loop";
import {
  Renderer,
  type DragView,
  type GameFonts,
  type OverlayView,
  type ShopView,
} from "./render/renderer";
import { attachInput, hitNode, type HotView } from "./input/input";
import { AudioSystem, LEVEL_STEPS } from "./audio/audio";
import { createTickEvents, diffTick } from "./audio/events";
import { biomeIndexForLevel, hitChevron } from "./render/fx";
import { NODE_R } from "./sim/constants";
import {
  ABILITIES,
  applyDailyClear,
  applyDefeat,
  applyWin,
  boostsFor,
  buyAbility,
  buyUpgrade,
  CHECKPOINT_EVERY,
  coresForWin,
  dailyRewardFor,
  dailyUnlocked,
  DAILY_UNLOCK_CLEARED,
  dailySeed,
  livesFor,
  migrateSave,
  isCheckpoint,
  newRun,
  progressPath,
  todayUTC,
  totalStars,
  TRACKS,
  starMilestoneBonus,
  type AbilityKey,
  type SaveV4,
  type TrackKey,
} from "./app/run";
import { allPlayerNodesCapped, pickUpgradeNudgeNode } from "./app/nudge";
import { motionPref, nextMotionPref, reducedMotion, setMotionPref } from "./render/motion";
import {
  PAUSE_ACTIONS,
  SETTINGS_ACTIONS,
  SHOP_TABS,
  type PauseAction,
  type SettingsAction,
  type ShopHit,
} from "./render/ui-layout";
import { BINDINGS, isPauseKey, matches } from "./input/bindings";
import { stepMenu } from "./input/keyboard-nav";
import { COACH_STEPS, coachAdvance, coachView, type CoachView } from "./app/coach";
import { loadRaw, persistSave } from "./save";

/** How long RESTART RUN stays armed after the first press. */
const RESTART_CONFIRM_MS = 2500;

/** Cap-stall nudge: 5 s of all-capped passivity before speaking… */
const STALL_NUDGE_TICKS = 150;
/** …and at most one line per 15 s while the stall persists. */
const STALL_REPEAT_TICKS = 450;

/** Every screen the app can be on. */
type AppState = "start" | "playing" | "paused" | "over" | "shop" | "help" | "settings" | "map";

/**
 * 3★ par: clean AND brisk.
 *
 * Calibrated against measured play, replacing a `45 + 15·L` guess. Bot win
 * times on screened boards are essentially FLAT across levels (p50 16–63 s
 * over L1–30, fitted slope ≈ 0): a winnable board falls fast once cracked,
 * whatever the level. The old par therefore grew 5× while real wins didn't,
 * making 3★ automatic for any clean win past ~L3 — a rating that can't be
 * missed can't be a goal. 90 s + 2 s/level sits at roughly 2× the bot's p50
 * with gentle growth for board size, so a human has to play with intent.
 */
function parTicks(level: number): number {
  return 30 * (90 + 2 * level);
}

/**
 * The forward-looking goal line for the result overlays — the cheapest "one
 * more level" hook there is: the decision the player makes on that screen is
 * about the NEXT level, and nothing on it used to mention the future at all.
 * Nearest of the two structural promises wins; ties go to the boss (rarer).
 */
function nextGoalLine(fromLevel: number): string | undefined {
  const nextCheckpoint = Math.ceil(fromLevel / CHECKPOINT_EVERY) * CHECKPOINT_EVERY;
  // Bosses run every BOSS_EVERY from FIRST_BOSS_LEVEL until BOSS_KINDS runs
  // out; isBossLevel already encodes the whole schedule, so just walk one
  // cadence-length of levels.
  let nextBoss: number | null = null;
  for (let l = fromLevel; l < fromLevel + BOSS_EVERY; l++) {
    if (isBossLevel(l)) {
      nextBoss = l;
      break;
    }
  }
  if (nextBoss !== null && nextBoss <= nextCheckpoint) {
    return nextBoss === fromLevel
      ? "NEXT: A BOSS AWAITS"
      : `BOSS AT LEVEL ${nextBoss} · NEW BALL TYPE`;
  }
  if (nextCheckpoint >= fromLevel) {
    const away = nextCheckpoint - fromLevel + 1;
    return away === 1
      ? `NEXT LEVEL BANKS A CHECKPOINT`
      : `CHECKPOINT AT LEVEL ${nextCheckpoint}`;
  }
  return undefined;
}

export interface OverrunOptions {
  /** "BACK TO PLAYHOUSE" in the pause menu — the host navigates away. */
  onExit: () => void;
  fonts?: GameFonts;
}

export interface OverrunHandle {
  destroy(): void;
}

/**
 * App layer: owns the run/level lifecycle around the sim.
 *
 * The game lives inside a React page, so everything registered here —
 * listeners, timers, the rAF loop, the ResizeObserver, the AudioContext and
 * the music scheduler — is collected into disposers and torn down by
 * destroy(). StrictMode runs mount → cleanup → mount, and the second boot
 * must find a clean slate.
 *
 * Upstream's equivalent (src/main.ts in the game1 repo) self-executes, grabs
 * a canvas by document id and talks to the CrazyGames SDK. None of that
 * survives here: this is a factory, and the only "platform" is ./save.
 */
export function createOverrun(canvas: HTMLCanvasElement, opts: OverrunOptions): OverrunHandle {
  const disposers: Array<() => void> = [];
  const listen = <E extends Event>(
    target: EventTarget,
    type: string,
    fn: (e: E) => void,
    options?: AddEventListenerOptions,
  ): void => {
    const l = fn as EventListener;
    target.addEventListener(type, l, options);
    disposers.push(() => target.removeEventListener(type, l, options));
  };

  /**
   * Tracked timers. The win path schedules callbacks ~900ms out that end up
   * writing the save; if the player navigates away inside that window an
   * untracked timer would fire on a dead closure and clobber whatever the
   * next mount has already written.
   */
  const timers = new Set<number>();
  const after = (ms: number, fn: () => void): void => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };
  disposers.push(() => {
    for (const id of timers) clearTimeout(id);
    timers.clear();
  });

  let save: SaveV4 = migrateSave(loadRaw());
  const persist = (): void => persistSave(save);
  persist(); // write back the migrated shape immediately

  /**
   * Cache of the board chosen for one (level, attempt).
   *
   * Three call sites want the same board — the boot state, the start-card
   * backdrop, and the level the player actually plays — and without this each
   * would run its own screen. Same answer three times over, but it would also
   * mean the board behind the title card was not the board you got when you
   * tapped it.
   *
   * Not keyed on boosts. Buying an upgrade between the screen and the start only
   * ever makes the board easier, so a board verified without it stays verified.
   */
  let boardCache: { level: number; attempt: number; seed: number } | null = null;

  /**
   * The board for a level: screened, not merely generated.
   *
   * `screenLevel` plays candidate boards with the reference bot and returns one
   * a competent player has demonstrably won. `save.run.attempt` is what makes a
   * retry different — attempt 0 is the level's historic board, and every later
   * attempt is a different verified board.
   */
  const boardFor = (level: number): GameState => {
    const attempt = save.run.attempt;
    if (boardCache === null || boardCache.level !== level || boardCache.attempt !== attempt) {
      const picked = screenLevel(level, boostsFor(save), seedSequence(level, attempt));
      boardCache = { level, attempt, seed: picked.seed };
    }
    return createLevel(level, boostsFor(save), boardCache.seed);
  };

  const game = {
    state: boardFor(save.run.level),
    prevState: null as GameState | null,
  };
  game.prevState = structuredClone(game.state);

  const commandQueue: Command[] = [];
  let appState: AppState = "start";
  let shopReturn: "paused" | "over" | "playing" = "paused";
  /** Settings are only reachable from pause today. A const until that changes;
   *  a `let` nothing assigns just looks like a missing code path. */
  const settingsReturn = "paused" as const;
  /** Where closing the map goes back to — it opens from pause AND overlays. */
  let mapReturn: "paused" | "over" = "paused";
  let mode: "run" | "daily" = "run";
  let dailyMutator = "";
  let overlay: OverlayView | null = null;
  let overlayShownAt = 0;
  let streak = 0;
  let levelLosses = 0; // player nodes lost this level (2★ requires 0)
  let levelRivalsDown = 0; // Warlord Bounty
  let levelPeakNodes = 0; // most nodes held at once — the loss postmortem's "you got this far"
  let nudgeNodeId: number | null = null; // node spotlit by the upgrade nudge
  let nudgeActive = false; // nudge live this level
  let stallSince: number | null = null; // sim tick the all-capped standoff began
  let stallSaidAt = -1e9; // sim tick of the last cap-stall ticker line
  let gauntletFails = 0; // consecutive failures on the CURRENT gauntlet level
  let gauntletFailLevel = -1; // which level the counter is counting
  let shopTab = 0; // active SHOP_TABS index; survives close/reopen on purpose
  /**
   * The ability awaiting a target — app state, NEVER sim state: arming is
   * aiming. Only overcharge/stasis can hold this (recall fires immediately);
   * cleared on every level handover and consumed by the next world tap.
   */
  let armedAbility: AbilityKey | null = null;

  const audio = new AudioSystem();
  const tickEvents = createTickEvents();

  // Capture phase, deliberately: input.ts stops immediate propagation on
  // chrome-button taps (one event, one router), and a bubble-phase listener
  // here would never see those — leaving the AudioContext suspended when the
  // player's first gesture after an iOS interruption is the mute or pause
  // icon. Capture runs before any target listener can stop anything.
  listen(window, "pointerdown", () => audio.unlock(), { capture: true });
  listen(window, "keydown", () => audio.unlock(), { capture: true });
  listen(document, "visibilitychange", () => {
    if (document.visibilityState === "visible") {
      audio.unlock();
    } else {
      // Site seam: tab-out auto-pauses. The hidden tab freezes the sim anyway
      // (rAF stops and the loop clamps catch-up) — surface that state honestly
      // when the player returns. No-ops outside "playing".
      pauseGame();
    }
  });

  let getDrag: () => DragView | null = () => null;
  let syncDrag: () => void = () => {};
  let getHot: () => HotView = () => ({ hot: null, pressed: null });
  const renderer = new Renderer(
    canvas,
    () => getDrag(),
    () => audio.isUserMuted(),
    () => getHot(),
    opts.fonts,
  );
  // Frame the board that already exists before the first render.
  renderer.setContent(game.state.nodes, worldHalfOf(game.state.cfg));
  audio.setMusicMood(biomeIndexForLevel(save.run.level));

  /** The selected player node currently eligible for the upgrade chevron. */
  const chevronNode = (): Node | null => {
    if (appState !== "playing") return null;
    for (const n of game.state.nodes) {
      if (!n.selected || n.owner !== PLAYER || n.size >= 2 || n.upgrading !== 0) continue;
      if (n.units < game.state.cfg.playerUpgradeCost[n.size as 0 | 1]) continue;
      return n;
    }
    return null;
  };

  /**
   * One-time upgrade teaching nudge: fires at most once per save, the first
   * time a safe rich eligible node exists on L5+ (L5's map stages one). The
   * flag persists at fire time; the spotlight stays until the lesson lands
   * (any player upgrade starts) or the level ends.
   */
  const nudgeNode = (): number | null => {
    if (appState !== "playing" || mode !== "run") return null;
    if (nudgeActive) {
      if (game.state.nodes.some((n) => n.owner === PLAYER && n.upgrading !== 0)) {
        nudgeActive = false;
        nudgeNodeId = null;
        return null;
      }
      nudgeNodeId = pickUpgradeNudgeNode(game.state, nudgeNodeId);
      return nudgeNodeId;
    }
    if (save.flags.upgradeNudgeShown || game.state.cfg.level < 5) return null;
    const id = pickUpgradeNudgeNode(game.state);
    if (id === null) return null;
    nudgeActive = true;
    nudgeNodeId = id;
    save = { ...save, flags: { ...save.flags, upgradeNudgeShown: true } };
    persist();
    return id;
  };

  /**
   * The live onboarding step.
   *
   * Only during real play in run mode: the daily is not where anyone learns
   * the game, and coaching over the start card would compete with "TAP TO
   * PLAY" for the same tap.
   */
  const coach = (): CoachView | null => {
    if (appState !== "playing" || mode !== "run") return null;
    return coachView(game.state, save.flags.coachProgress);
  };

  const skipCoach = (): void => {
    if (save.flags.coachProgress >= COACH_STEPS.length) return;
    save = {
      ...save,
      flags: { ...save.flags, coachProgress: COACH_STEPS.length },
    };
    persist();
    audio.uiTap();
  };

  /*
   * One implementation per menu action, called by BOTH the pointer handler and
   * the keyboard handler. They used to live inline in the pointer listener,
   * which meant a keyboard path would have been a second copy free to drift.
   */
  /**
   * RESTART RUN destroys the run, and it sits 44 px below RESUME on a phone
   * with nothing between a mis-tap and losing everything. First press arms it
   * for 2.5 s; any other press, or the timeout, disarms.
   */
  // -Infinity, not 0: performance.now() is milliseconds since navigation, so
  // `now - 0 < 2500` is TRUE for the first 2.5 s of page life — the row shipped
  // armed, and the very confirmation this exists to provide was skipped.
  let restartArmedAt = -Infinity;
  const restartArmed = (): boolean => performance.now() - restartArmedAt < RESTART_CONFIRM_MS;

  const doPauseAction = (action: PauseAction | "panel" | "outside"): void => {
    if (action === "panel") return;
    const wasArmed = restartArmed();
    if (action !== "restart") restartArmedAt = -Infinity;
    audio.uiTap();
    if (action === "settings") appState = "settings";
    else if (action === "restart") {
      if (!wasArmed) {
        restartArmedAt = performance.now();
        return;
      }
      restartArmedAt = -Infinity;
      restartRun();
    } else if (action === "shop") openShop("paused");
    else if (action === "daily") {
      loop.resume();
      startDaily();
    } else if (action === "progress") openMap("paused");
    else if (action === "help") appState = "help";
    else if (action === "exit") {
      // BACK TO PLAYHOUSE — the host navigates away; unmount runs destroy().
      opts.onExit();
    } else resumeGame(); // "resume" or a tap outside the panel
  };

  /** The active tab's shop rows — one builder for the view AND the router,
   *  so what is drawn at index i is exactly what a tap on index i buys. */
  const shopRows = () =>
    shopTab === 0
      ? TRACKS.map((t) => {
          const tier = save.upgrades[t.key];
          const cost = tier < t.costs.length ? t.costs[tier]! : null;
          return {
            key: t.key as string,
            name: t.name,
            desc: t.describe(tier < t.costs.length ? tier + 1 : tier),
            cost,
            tier,
            maxTier: t.costs.length,
            affordable: cost !== null && save.cores >= cost,
          };
        })
      : ABILITIES.map((a) => {
          const tier = save.abilities[a.key];
          const cost = tier < a.costs.length ? a.costs[tier]! : null;
          return {
            key: a.key as string,
            name: a.name,
            desc: a.describe(tier < a.costs.length ? tier + 1 : tier),
            cost,
            tier,
            maxTier: a.costs.length,
            affordable: cost !== null && save.cores >= cost,
          };
        });

  const doShopAction = (hit: ShopHit): void => {
    if (hit === "panel") return;
    if (typeof hit === "object" && hit.kind === "tab") {
      if (shopTab !== hit.index) {
        shopTab = hit.index;
        menuCursor = 0; // a cursor from the other tab points at a different row
      }
      audio.uiTap();
      return;
    }
    if (typeof hit === "object") {
      const row = shopRows()[hit.index];
      if (!row) return;
      const bought =
        shopTab === 0
          ? buyUpgrade(save, row.key as TrackKey)
          : buyAbility(save, row.key as AbilityKey);
      if (bought) {
        persist();
        // A purchase deserves more than the generic tap the whole UI uses —
        // spending cores is the meta-economy's one moment of payoff.
        audio.purchase();
        renderer.flashShopRow(hit.index, true);
        // Lives may have grown (Second Wind) mid-run: top up immediately.
        if (row.key === "secondWind" && save.run.lives < livesFor(save)) {
          save = { ...save, run: { ...save.run, lives: save.run.lives + 1 } };
          persist();
        }
        // Ability tiers grant charges at LEVEL START (cfg.abilities is level
        // config); the current board keeps the charges it was dealt. Say so,
        // or the first purchase mid-level reads as a shop that sold nothing.
        if (shopTab === 1 && shopReturn === "playing") {
          renderer.say("CHARGES ARRIVE WITH THE NEXT LEVEL");
        }
      } else {
        // An unaffordable tap used to produce literally nothing, which is the
        // clearest "is this thing broken?" moment in the game.
        audio.uiTap();
        renderer.flashShopRow(hit.index, false);
      }
      return;
    }
    audio.uiTap();
    closeShop();
  };

  const doSettingsAction = (hit: SettingsAction | "close" | "panel" | "outside"): void => {
    if (hit === "panel") return;
    audio.uiTap();
    if (hit === "close" || hit === "outside") appState = settingsReturn;
    else cycleSetting(hit);
  };

  const doOverlayAction = (btn: "shop" | "daily" | "progress" | "continue"): void => {
    const dailyResult = overlay?.kind === "daily-won" || overlay?.kind === "daily-lost";
    audio.uiTap();
    // Gauntlet mercy: the daily slot is SKIP PUZZLE on a third-plus failure.
    // Skipping advances the run without a win — no cores, no stars — and
    // counts the level as faced (clearedMax) so no future checkpoint can
    // resume a player back INTO the wall they just escaped.
    if (btn === "daily" && overlay?.kind === "lost" && overlay.skipPuzzle) {
      // The level actually played, from the sim — save.run.level matches it
      // in every real flow, but a dev-handle level jump leaves the save
      // behind (the applyWin trap, same family).
      const skipped = game.state.cfg.level;
      save = {
        ...save,
        clearedMax: Math.max(save.clearedMax, skipped),
        run: { level: skipped + 1, lives: save.run.lives, attempt: 0 },
      };
      persist();
      startLevel(skipped + 1);
      return;
    }
    if (btn === "shop" && !dailyResult) {
      openShop("over");
      return;
    }
    if (btn === "daily" && !dailyResult) {
      startDaily();
      return;
    }
    if (btn === "progress" && !dailyResult) {
      openMap("over");
      return;
    }
    startLevel(save.run.level); // applyWin/applyDefeat already set the level
  };

  /*
   * Menu keyboard navigation.
   *
   * `menuCursor` is only DRAWN once the player has used a key (menuCursorSeen),
   * so a mouse player never sees a stray highlight sitting on a row they did
   * not choose. Every screen the game can be on is reachable and dismissable
   * from here — keyboard is a first-class input, and a player who could open
   * the shop but not leave it would be worse off than one who could not open
   * it.
   */
  let menuCursor = 0;
  let menuCursorSeen = false;
  /**
   * Which screen the cursor index belongs to.
   *
   * Without this the index survives a screen change: leaving HOW TO PLAY with
   * the cursor on row 4 and opening SETTINGS starts you on row 4 of a
   * three-row panel. Comparing against appState resets it wherever the state
   * changed, rather than needing a reset at every assignment site.
   */
  let menuCursorState: AppState | null = null;
  const menuRowCount = (): number =>
    appState === "paused"
      ? PAUSE_ACTIONS.length
      : appState === "settings"
        ? SETTINGS_ACTIONS.length + 1 // + BACK
        : appState === "shop"
          ? (shopTab === 0 ? TRACKS.length : ABILITIES.length) + 1 // + CLOSE
          : appState === "over"
            ? // The cursor must only visit buttons that are actually drawn.
              // A daily result draws none (drawOverlay only buttons the
              // won/runover/lost kinds), so it is a single row — the cursor
              // used to walk two invisible ones. Otherwise: continue, upgrades,
              // and daily only once it has unlocked.
              overlay?.kind === "daily-won" || overlay?.kind === "daily-lost"
              ? 1
              : (overlay?.dailyLocked ?? true)
                ? 2
                : 3
            : 1;

  const handleMenuKey = (e: KeyboardEvent): boolean => {
    /**
     * No menu is up — the caller only routed here because a panel is still
     * ANIMATING closed (`worldInputBlocked` includes `chromeBusy()`).
     *
     * Returning true here is what created a 150 ms keyboard dead zone after
     * every panel close: input.ts preventDefaults whatever this claims to have
     * handled, so Space, the arrows, U and C were all swallowed while the game
     * was visibly playable. renderer.ts's own note calls a blanket input gate
     * "the exact 'feels broken' complaint this pass exists to fix", and the
     * keyboard path was doing precisely that. Decline, and the key falls
     * through to the board.
     */
    if (appState === "playing") return false;
    // Before any early return, so that leaving a screen and coming back starts
    // at the top rather than wherever the previous screen's cursor happened to
    // be — help and the start card both return early below.
    if (menuCursorState !== appState) {
      menuCursor = 0;
      menuCursorState = appState;
    }
    if (appState === "start") {
      beginPlay();
      return true;
    }
    if (appState === "help") {
      if (matches(e, BINDINGS.confirm) || matches(e, BINDINGS.cancel)) {
        audio.uiTap();
        appState = "paused";
        return true;
      }
      return false;
    }
    if (appState === "map") {
      if (matches(e, BINDINGS.confirm) || matches(e, BINDINGS.cancel)) {
        audio.uiTap();
        closeMap();
        return true;
      }
      return false;
    }
    // Shop tabs ride Left/Right (Up/Down walks rows, so the axes cannot
    // collide). Cursor resets — row i of the other tab is a different thing.
    if (appState === "shop" && (matches(e, BINDINGS.left) || matches(e, BINDINGS.right))) {
      shopTab = (shopTab + (matches(e, BINDINGS.left) ? SHOP_TABS.length - 1 : 1)) % SHOP_TABS.length;
      menuCursor = 0;
      menuCursorSeen = true;
      audio.uiTap();
      return true;
    }
    const count = menuRowCount();
    if (matches(e, BINDINGS.up) || matches(e, BINDINGS.down)) {
      menuCursor = stepMenu(menuCursor, count, matches(e, BINDINGS.up) ? -1 : 1);
      menuCursorSeen = true;
      audio.uiTap();
      return true;
    }
    if (matches(e, BINDINGS.cycleNext)) {
      menuCursor = stepMenu(menuCursor, count, e.shiftKey ? -1 : 1);
      menuCursorSeen = true;
      return true;
    }
    if (matches(e, BINDINGS.cancel)) {
      togglePause();
      return true;
    }
    if (!matches(e, BINDINGS.confirm)) return false;

    if (appState === "paused") {
      doPauseAction(PAUSE_ACTIONS[menuCursor] ?? "resume");
    } else if (appState === "settings") {
      if (menuCursor >= SETTINGS_ACTIONS.length) doSettingsAction("close");
      else doSettingsAction(SETTINGS_ACTIONS[menuCursor]!);
    } else if (appState === "shop") {
      if (menuCursor >= menuRowCount() - 1) doShopAction("close");
      else doShopAction({ kind: "row", index: menuCursor });
    } else if (appState === "over") {
      // Same guard the pointer path has: an in-flight keypress must not blow
      // straight past the result screen.
      if (performance.now() - overlayShownAt < 500) return true;
      doOverlayAction(menuCursor === 1 ? "shop" : menuCursor === 2 ? "daily" : "continue");
    }
    return true;
  };

  /** Settings rows cycle forward and wrap — one tap target, no drag handling. */
  const cycleSetting = (which: SettingsAction): void => {
    if (which === "music") audio.setMusicLevel((audio.musicLevel() + 1) % LEVEL_STEPS);
    else if (which === "sfx") audio.setSfxLevel((audio.sfxLevel() + 1) % LEVEL_STEPS);
    else setMotionPref(nextMotionPref(motionPref()));
  };

  /** Something in the shop is buyable right now — the meta-economy's payoff
   *  moment, previously invisible unless the player happened to open the shop.
   *  Both tabs count: an affordable POWER lights the ◈ exactly like a track. */
  const anythingAffordable = (): boolean =>
    TRACKS.some((t) => {
      const tier = save.upgrades[t.key];
      return tier < t.costs.length && save.cores >= t.costs[tier]!;
    }) ||
    ABILITIES.some((a) => {
      const tier = save.abilities[a.key];
      return tier < a.costs.length && save.cores >= a.costs[tier]!;
    });

  /* ------------------------------------------------------------- abilities */

  /** The abilities the player OWNS, in ABILITIES order — the button list. */
  const ownedAbilities = () => ABILITIES.filter((a) => save.abilities[a.key] > 0);

  /**
   * The in-level ability buttons: one per OWNED ability, live charge counts
   * from the sim. Null when nothing is owned — an L1-5 player never sees the
   * stack, and the renderer's hit gate (abilityCount) follows the same list.
   */
  const abilitiesView = (): Array<{ key: AbilityKey; charges: number }> | null => {
    if (appState !== "playing" && appState !== "paused") return null;
    const owned = ownedAbilities();
    if (owned.length === 0) return null;
    return owned.map((a) => ({
      key: a.key,
      charges: game.state.abilityCharges?.[a.key] ?? 0,
    }));
  };

  const disarmAbility = (): boolean => {
    if (armedAbility === null) return false;
    armedAbility = null;
    return true;
  };

  /** Ability button i (tap or digit key): arm a targeted power, fire recall. */
  const abilityTap = (index: number): void => {
    if (appState !== "playing" || overPending) return;
    const def = ownedAbilities()[index];
    if (!def) return;
    const charges = game.state.abilityCharges?.[def.key] ?? 0;
    if (charges <= 0) {
      // A control that does nothing and says nothing reads as broken — the
      // startDaily refusal rule, applied here.
      renderer.say("POWER SPENT — CHARGES RETURN NEXT LEVEL");
      audio.uiTap();
      disarmAbility();
      return;
    }
    audio.uiTap();
    if (def.key === "recall") {
      // No target to pick: fires on the spot. Validation still lives in the
      // sim (charge check, at-least-one-own-ball), so a hopeless recall is a
      // sim-side no-op that keeps its charge.
      commandQueue.push({ type: "useAbility", ability: "recall" });
      disarmAbility();
      return;
    }
    // Toggle: tapping the armed button again stands down.
    armedAbility = armedAbility === def.key ? null : def.key;
  };

  /**
   * Send ratio, session-local on purpose: it is a tactical stance, not a
   * preference, and persisting it would hand a returning player a half-power
   * opening send with no memory of why. (Settings persistence as a whole is
   * deliberately deferred — see the plan.)
   */
  let sendFraction: 0.5 | 1 = 1;
  const toggleSendRatio = (): void => {
    sendFraction = sendFraction === 1 ? 0.5 : 1;
    audio.uiTap();
  };

  const hud = () => ({
    lives: save.run.lives,
    maxLives: livesFor(save),
    bestLevel: save.bestLevel,
    streak,
    cores: save.cores,
    canAfford: anythingAffordable(),
    paused:
      appState === "paused" ||
      appState === "help" ||
      appState === "settings" ||
      appState === "map",
    dailyName: mode === "daily" ? `DAILY · ${dailyMutator}` : undefined,
    chevronNodeId: chevronNode()?.id ?? null,
    nudgeNodeId: nudgeNode(),
    showDimChevrons: save.flags.upgradeNudgeShown,
    startCard: appState === "start",
    help: appState === "help",
    map: appState === "map",
    // Path windows, computed only when the surface that shows them is up —
    // the renderer displays these and derives nothing (its own contract).
    mapPath: appState === "map" ? progressPath(save, save.run.level, 18) : undefined,
    startPath:
      appState === "start" && save.bestLevel > 1
        ? progressPath(save, save.run.level, 7)
        : undefined,
    settings: appState === "settings",
    musicLevel: audio.musicLevel(),
    sfxLevel: audio.sfxLevel(),
    motionPref: motionPref(),
    // Only drawn once a key has been used, so a mouse player never sees a
    // highlight sitting on a row they did not choose.
    menuCursor: menuCursorSeen && menuCursorState === appState ? menuCursor : null,
    restartArmed: restartArmed(),
    coach: coach(),
    sendFraction,
    objective: objectiveLine(),
    abilities: abilitiesView(),
    // Only honored while actually playing — a stale armed state must not dim
    // the board under a menu.
    armedAbility: appState === "playing" ? armedAbility : null,
  });

  /**
   * The objective banner line: what to do, and how close it is to done — the
   * "clear reachable goals" bar, kept to one line. Null on annihilation (the
   * start card already taught "eat every other color"), and while the coach
   * banner owns the slot (both draw in the same place; the lesson wins).
   */
  const objectiveLine = (): string | null => {
    if (appState !== "playing" && appState !== "paused") return null;
    const obj = game.state.cfg.objective;
    if (!obj || coach()) return null;
    const s = game.state;
    switch (obj.type) {
      case "crown":
        return "TAKE THE CROWNED BALL — DON'T LOSE YOURS";
      case "hold": {
        const left = Math.max(0, Math.ceil(((obj.requiredTicks ?? 0) - s.holdTicks) / 30));
        const hill = obj.targetNodeId !== undefined ? s.nodes[obj.targetNodeId] : undefined;
        return hill?.owner === PLAYER
          ? `HOLD THE MARKED BALL · ${left}S TO GO`
          : `TAKE AND HOLD THE MARKED BALL · ${left}S OF HOLD LEFT`;
      }
      case "outlast": {
        const left = Math.max(0, Math.ceil(((obj.requiredTicks ?? 0) - s.tick) / 30));
        return `SURVIVE · ${left}S`;
      }
      case "claim": {
        let own = 0;
        for (const n of s.nodes) if (n.owner === PLAYER) own++;
        return `OWN ${obj.quota} BALLS · ${own}/${obj.quota}`;
      }
      case "gauntlet": {
        const left = Math.max(0, (obj.sendBudget ?? 0) - s.sendsUsed);
        const goal = obj.targetNodeId !== undefined ? "TAKE THE MARKED BALL" : "CLEAR THE BOARD";
        return `${goal} · ${left} SEND${left === 1 ? "" : "S"} LEFT`;
      }
    }
  };

  const shopView = (): ShopView | null => {
    if (appState !== "shop") return null;
    return {
      cores: save.cores,
      tab: shopTab,
      menuCursor: menuCursorSeen && menuCursorState === appState ? menuCursor : null,
      rows: shopRows(),
    };
  };

  /**
   * Drive the music bed from the board state.
   *
   * "Heat" is how contested things are, not how well the player is doing: it
   * peaks when the two largest forces are evenly matched and falls away once
   * someone is clearly winning. A runaway lead should sound calm, and so
   * should being crushed — the tense mix belongs to the close fight.
   */
  const updateMusic = (): void => {
    audio.duckMusic(appState !== "playing");
    const totals = [0, 0, 0, 0, 0];
    for (const n of game.state.nodes) if (n.owner !== 0) totals[n.owner]! += n.units;
    const mine = totals[1]!;
    const rival = Math.max(totals[2]!, totals[3]!, totals[4]!);
    const both = mine + rival;
    if (both <= 0) {
      audio.setMusicHeat(0);
      return;
    }
    // 1 when evenly matched, 0 when one side holds everything.
    const balance = 1 - Math.abs(mine - rival) / both;
    // Scaled by how much is actually committed, so an empty opening board is
    // quiet even though its two starting nodes are perfectly matched.
    const engaged = Math.min(1, both / 60);
    audio.setMusicHeat(balance * engaged);
  };

  const simTick = (): void => {
    /**
     * The start card's board is a live demo, but it must not DIVERGE.
     *
     * Tapping the card starts the real level from a fresh board, so anything
     * the AI captured while the player read the title snaps back at the moment
     * of the tap — which reads as a graphical fault, not as a transition. Hold
     * the demo just short of the first AI move and that can never happen: the
     * board stays alive (garrisons tick up, the scene breathes) and the only
     * difference across the tap is a few unit counts.
     *
     * Per-level rather than a constant, because `aiFirstMoveTick` is itself a
     * difficulty knob — 450 ticks on L1, the floor of 45 later on.
     *
     * Scripted openings fire BEFORE the first wake (that is their point), so
     * the freeze must respect whichever comes first — an L1 demo that ran the
     * 8 s opening would snap the captured neutral back on the tap, the exact
     * divergence this hold exists to prevent.
     */
    const firstAiActionTick = Math.min(
      game.state.cfg.aiFirstMoveTick,
      ...(game.state.cfg.openings?.map((o) => o.tick) ?? []),
    );
    if (appState === "start" && game.state.tick >= firstAiActionTick - 1) {
      commandQueue.length = 0;
      return;
    }
    game.prevState = structuredClone(game.state);
    // On the start card the player's commands are dropped but the sim still
    // runs, so the title sits over a live AI-vs-AI board instead of a freeze
    // frame. Nothing is scored: dismissing the card restarts the level.
    if (appState === "start") commandQueue.length = 0;
    // Input feedback, before the tick consumes the queue. Selecting a node —
    // the most frequent action in the game — and cancelling a stream (a send
    // to self) had no sound at all; the visual half lives in the renderer
    // (ring settle, lane fade), this is the audible half. One tap per tick at
    // most, or a drag across several nodes machine-guns it.
    if (appState === "playing") {
      for (const c of commandQueue) {
        if (c.type === "selectNode" || (c.type === "sendUnits" && c.from === c.to)) {
          audio.uiTap();
          break;
        }
      }
    }
    tick(game.state, commandQueue);
    commandQueue.length = 0;
    // Onboarding advances on the sim tick, so a step ends the moment the
    // player performs it rather than a frame later.
    if (appState === "playing" && mode === "run") {
      const next = coachAdvance(game.state, save.flags.coachProgress);
      if (next !== save.flags.coachProgress) {
        save = { ...save, flags: { ...save.flags, coachProgress: next } };
        persist();
      }
    }
    diffTick(game.prevState, game.state, tickEvents);
    audio.onEvents(tickEvents);
    levelLosses += tickEvents.playerLosses;
    levelRivalsDown += tickEvents.rivalsEliminated;
    if (appState === "playing") {
      let held = 0;
      for (const n of game.state.nodes) if (n.owner === PLAYER) held++;
      if (held > levelPeakNodes) levelPeakNodes = held;
    }
    // Cap-stall nudge: a totally passive player at an all-capped standoff
    // reads the game as frozen (the L1–L2 conversion killer). Speak after 5 s
    // of stall, and not more than once per 15 s while it persists — the line
    // is a hand on the shoulder, not an alarm.
    if (appState === "playing") {
      if (allPlayerNodesCapped(game.state)) {
        if (stallSince === null) stallSince = game.state.tick;
        else if (
          game.state.tick - stallSince >= STALL_NUDGE_TICKS &&
          game.state.tick - stallSaidAt >= STALL_REPEAT_TICKS
        ) {
          renderer.say("YOUR BALLS ARE FULL — SEND THEM");
          stallSaidAt = game.state.tick;
        }
      } else {
        stallSince = null;
      }
    }
  };

  /**
   * Monotone board generation. Bumped on every board handover so anything
   * scheduled against the OLD board (the 900 ms final-blow timer) can tell it
   * has been outlived and stand down instead of firing into the new one.
   */
  let boardGen = 0;

  const startLevel = (level: number): void => {
    boardGen++;
    mode = "run";
    // Gauntlet failures accumulate across retries of the SAME level only —
    // moving on (skip, win, run-over reroute) resets the mercy counter.
    if (level !== gauntletFailLevel) {
      gauntletFails = 0;
      gauntletFailLevel = level;
    }
    game.state = boardFor(level);
    renderer.setContent(game.state.nodes, worldHalfOf(game.state.cfg));
    // Bigger-than-one-screen boards open on the establishing shot: the whole
    // map under the LEVEL card, then an ease to the play zoom on the player's
    // home. Staged, not immediate — the renderer's board-swap block consumes
    // it, so ordering against the swap's own camera reset can never race.
    const home = game.state.nodes.find((n) => n.owner === PLAYER);
    if (home && (game.state.cfg.worldHx ?? WORLD_W / 2) > WORLD_W / 2) {
      renderer.stageIntroReveal(home.x, home.y);
      // One-time discovery line for the first scrolling board a player meets.
      if (!save.flags.panHintShown) {
        renderer.say("DRAG EMPTY SPACE TO LOOK · DOUBLE-TAP TO SEE IT ALL");
        save = { ...save, flags: { ...save.flags, panHintShown: true } };
        persist();
      }
    }
    audio.setMusicMood(biomeIndexForLevel(level));
    game.prevState = structuredClone(game.state);
    commandQueue.length = 0;
    overlay = null;
    levelLosses = 0;
    levelRivalsDown = 0;
    levelPeakNodes = 0;
    nudgeActive = false;
    nudgeNodeId = null;
    stallSince = null;
    stallSaidAt = -1e9; // tick resets to 0 with the board — the clock must too
    armedAbility = null; // an aim never survives a board handover
    appState = "playing";
    // Resume unconditionally, not only on the routes that remembered to. The
    // loop can arrive here paused: pause (or the ◈ shop) opened inside the
    // 900 ms final-blow window still ends at the overlay, and dismissing that
    // overlay lands here — without this the board would render forever with a
    // sim that never ticks.
    loop.resume();
    loop.setTimeScale(1);
  };

  /** Fresh board for the start-card backdrop. Never scored. */
  const startDemoBoard = (): void => {
    game.state = boardFor(save.run.level);
    renderer.setContent(game.state.nodes, worldHalfOf(game.state.cfg));
    game.prevState = structuredClone(game.state);
    commandQueue.length = 0;
  };

  const startDaily = (): void => {
    /**
     * The gate lives HERE, not only on the button, so every route is covered —
     * the result overlay, the pause menu, and the keyboard path all funnel
     * through this one function. Refusing with an explanation rather than
     * silently doing nothing: a control should tell the player how to proceed.
     */
    if (!dailyUnlocked(save)) {
      renderer.say(`DAILY UNLOCKS AFTER LEVEL ${DAILY_UNLOCK_CLEARED}`);
      audio.uiTap();
      return;
    }
    mode = "daily";
    boardGen++;
    const { state, mutator } = createDailyLevel(dailySeed(todayUTC()), boostsFor(save));
    renderer.setContent(state.nodes, worldHalfOf(state.cfg));
    audio.setMusicMood(biomeIndexForLevel(12)); // the daily is a L12-grade board
    dailyMutator = mutator;
    game.state = state;
    game.prevState = structuredClone(state);
    commandQueue.length = 0;
    overlay = null;
    levelLosses = 0;
    levelRivalsDown = 0;
    levelPeakNodes = 0;
    nudgeActive = false;
    nudgeNodeId = null;
    stallSince = null;
    stallSaidAt = -1e9;
    armedAbility = null; // same rule as startLevel
    appState = "playing";
    loop.resume(); // same reasoning as startLevel — never assume the loop runs
    loop.setTimeScale(1);
  };

  const pauseGame = (): void => {
    if (appState !== "playing") return;
    appState = "paused";
    loop.pause();
  };

  const resumeGame = (): void => {
    if (appState !== "paused") return;
    appState = "playing";
    loop.resume();
  };

  /**
   * The pause key closes whatever is open, not just the pause menu.
   *
   * It used to handle only paused <-> playing, which stranded a keyboard-only
   * player the moment they opened HOW TO PLAY or UPGRADES. The same gap exists
   * for the pointer: the shop branch below returns before the pause-icon check,
   * so tapping pause with the shop open has always done nothing.
   */
  const togglePause = (): void => {
    if (appState === "help") {
      audio.uiTap();
      appState = "paused";
    } else if (appState === "map") {
      audio.uiTap();
      closeMap();
    } else if (appState === "settings") {
      audio.uiTap();
      appState = settingsReturn;
    } else if (appState === "shop") {
      audio.uiTap();
      closeShop();
    } else if (appState === "paused") resumeGame();
    else if (appState === "playing") pauseGame();
  };

  const restartRun = (): void => {
    save = { ...save, run: newRun(save) };
    streak = 0;
    persist();
    loop.resume();
    // save.run.level, not a hardcoded 1: newRun() returns the banked checkpoint
    // now, so starting level 1 here would leave the board and the save
    // disagreeing about which level the player is on — and the save wins on the
    // next transition, teleporting them mid-run.
    startLevel(save.run.level);
  };

  const openShop = (from: "paused" | "over" | "playing"): void => {
    shopReturn = from;
    appState = "shop";
    // From live play (the ◈ tap) the shop is an exit from gameplay, exactly
    // like the pause menu: the simTick gate stops the sim on appState alone,
    // but the loop needs telling too. The other two routes arrive with the
    // loop already paused/stopped.
    if (from === "playing") {
      loop.pause();
    }
  };

  /** The one way out of the shop — both close routes must undo openShop("playing"). */
  const closeShop = (): void => {
    appState = shopReturn;
    if (shopReturn === "playing") {
      loop.resume();
    }
  };

  // The map opens from the pause menu and from the overlays' progress strip —
  // both states where the loop is already stopped, so unlike the shop it never
  // needs the pause/resume dance.
  const openMap = (from: "paused" | "over"): void => {
    mapReturn = from;
    appState = "map";
  };
  const closeMap = (): void => {
    appState = mapReturn;
  };

  const onGameOver = (): void => {
    appState = "over";
    overlayShownAt = performance.now();
    const won = game.state.status === "won";

    if (mode === "daily") {
      if (won) {
        const reward = applyDailyClear(save, todayUTC());
        persist();
        // The streak line IS the come-back-tomorrow hook: the only such
        // mechanic in the game, persisted since the daily shipped and
        // displayed nowhere.
        const day = save.daily?.dayStreak ?? 1;
        overlay = {
          kind: "daily-won",
          cores: reward,
          dailyStreak:
            reward > 0
              ? `DAY ${day} STREAK · TOMORROW PAYS ${dailyRewardFor(day + 1)}`
              : `DAY ${day} · COME BACK TOMORROW`,
        };
        audio.victory();
      } else {
        overlay = { kind: "daily-lost" };
        audio.defeat();
      }
      // Daily overlays draw no buttons, but keep the invariant below true for
      // them too — a future consumer of dailyLocked must not read undefined.
      overlay.dailyLocked = !dailyUnlocked(save);
      return;
    }

    if (won) {
      streak += 1;
      const level = game.state.cfg.level;
      // 3★ = clean AND brisk, 2★ = clean — except OUTLAST, where conceding
      // ground is the design (an unfair start you survive), so "clean" would
      // rate the archetype's intended play 1★ forever. There, stars grade how
      // much ground the siege actually cost.
      const stars: 1 | 2 | 3 =
        game.state.cfg.objective?.type === "outlast"
          ? levelLosses <= 2
            ? 3
            : levelLosses <= 5
              ? 2
              : 1
          : levelLosses === 0
            ? game.state.tick <= parTicks(level)
              ? 3
              : 2
            : 1;
      const cores = coresForWin(save, {
        level,
        stars,
        streak,
        rivalsEliminatedByPlayer: levelRivalsDown,
      });
      // Read BEFORE applyWin advances clearedMax, so "did this win bank a new
      // checkpoint" is a question about this level rather than about the state
      // it just produced. Replaying an already-cleared checkpoint must not
      // re-announce it.
      const banked = isCheckpoint(level) && level > save.clearedMax;
      const starsBefore = totalStars(save);
      const dailyWasLocked = !dailyUnlocked(save);
      save = applyWin(save, { level, stars, streak, rivalsEliminatedByPlayer: levelRivalsDown });
      persist();
      const starsAfter = totalStars(save);
      overlay = {
        kind: "won",
        cores,
        stars,
        checkpointBanked: banked,
        totalStars: starsAfter,
        starBonus: starMilestoneBonus(starsBefore, starsAfter) || undefined,
        // One-shot by construction: true only on the win that flipped the gate.
        dailyUnlockedNow: dailyWasLocked && dailyUnlocked(save),
        nextGoal: nextGoalLine(level + 1),
        // AFTER applyWin, so the level just beaten shows its fresh stars.
        progress: progressPath(save, level + 1, 7),
      };
      audio.victory();
    } else if (game.state.cfg.objective?.type === "gauntlet") {
      // A gauntlet loss costs NOTHING — no life, no streak, no board re-roll.
      // Puzzles must feel like puzzles: failure is information, and a gated
      // retry converts "one more try" into tedium. From the third failure the
      // overlay offers SKIP PUZZLE — free losses mean a stuck player has no
      // other path forward (even a run-over would resume onto this same
      // board), and an inescapable level is a softlock wearing a puzzle
      // costume.
      streak = 0;
      gauntletFails += 1;
      const offerSkip = gauntletFails >= 3;
      overlay = {
        kind: "lost",
        lives: save.run.lives,
        postmortem: offerSkip
          ? "OUT OF SENDS — RETRY FREE, OR SKIP"
          : "OUT OF SENDS — SAME PUZZLE, FREE RETRY",
        newBoardOnRetry: false,
        skipPuzzle: offerSkip,
        progress: progressPath(save, save.run.level, 7),
      };
      audio.defeat();
    } else {
      streak = 0;
      const result = applyDefeat(save);
      save = result.save;
      persist();
      // The postmortem: what the attempt looked like from the inside. A loss
      // that explains itself invites another try; a bare DEFEATED is a wall.
      const seconds = Math.round(game.state.tick / 30);
      const postmortem = `HELD ${levelPeakNodes} OF ${game.state.nodes.length} BALLS · ${seconds}S`;
      overlay = result.runOver
        ? {
            kind: "runover",
            reachedLevel: result.reachedLevel,
            bestLevel: save.bestLevel,
            resumeLevel: result.resumeLevel,
            nextGoal: nextGoalLine(result.resumeLevel),
            // Centred on where the run RESUMES — the strip answers "how much
            // ground did that cost me", which is the run-over question.
            progress: progressPath(save, result.resumeLevel, 7),
          }
        : {
            kind: "lost",
            lives: save.run.lives,
            postmortem,
            // Always true on a loss — applyDefeat bumped run.attempt, and the
            // next boardFor() will screen a different seed sequence.
            newBoardOnRetry: true,
            progress: progressPath(save, save.run.level, 7),
          };
      audio.defeat();
    }
    // Set once, after every branch, so a new overlay kind cannot forget it and
    // quietly re-open the trapdoor.
    overlay.dailyLocked = !dailyUnlocked(save);
  };

  /** Final-blow slow-mo: dilate time briefly the moment the win registers. */
  const finalBlow = (): void => {
    // Focus on the last node that changed hands (the killing capture).
    let focus: Node | null = null;
    for (const n of game.state.nodes) {
      if (game.prevState && game.prevState.nodes[n.id]!.owner !== n.owner) focus = n;
    }
    if (focus) renderer.setFinalBlowFocus(focus.x, focus.y);
    renderer.finalBlow();
    // The whole board decelerating and zooming at once is the strongest
    // vestibular trigger in the game, so reduced motion skips it. The 900 ms
    // wait stays either way: that is pacing, letting the final capture read
    // before the overlay covers it, not a time-scale effect.
    if (!reducedMotion()) loop.setTimeScale(0.25);
    after(900, () => loop.setTimeScale(1));
  };

  let overPending = false;
  const loop = createLoop({
    simTick() {
      // The start card runs the board as an AI-only demo so the title sits over
      // motion. Nothing is scored and the level never ends: dismissing the card
      // throws this board away and starts a fresh one.
      if (appState === "start") {
        if (game.state.status === "playing") simTick();
        else startDemoBoard();
        return;
      }
      if (appState !== "playing" || overPending) return;
      simTick();
      if (game.state.status !== "playing") {
        if (game.state.status === "won") {
          // Slow-mo moment breathes before the overlay lands; sim is frozen
          // (status ≠ playing) so nothing advances underneath it.
          overPending = true;
          finalBlow();
          const gen = boardGen;
          after(900, () => {
            overPending = false;
            // The pause menu stays reachable during this window, and RESTART
            // RUN or DAILY can swap the board under the timer — firing
            // onGameOver() onto that fresh board would read its un-won status
            // as a defeat, dock a life, and bury a level that just started.
            // A board swap bumps boardGen; a stale timer just stands down.
            if (gen !== boardGen) return;
            onGameOver();
          });
        } else {
          onGameOver();
        }
      }
    },
    render(alpha) {
      updateMusic();
      // Drop any drag (keyboard aim or held pointer) whose endpoints went
      // stale — changed hands, or a board swap invalidated the ids.
      syncDrag();
      renderer.render(
        game.prevState ?? game.state,
        game.state,
        alpha,
        overlay
          ? {
              ...overlay,
              menuCursor:
                menuCursorSeen && menuCursorState === appState ? menuCursor : null,
            }
          : null,
        hud(),
        shopView(),
      );
    },
  });

  const handle = attachInput(canvas, renderer, () => game.state, commandQueue, {
    onMuteToggle: () => audio.toggleUserMuted(),
    onPauseToggle: togglePause,
    coachVisible: () => coach() !== null,
    onCoachSkip: skipCoach,
    onSourceAdded: () => audio.uiTap(),
    getSendFraction: () => sendFraction,
    onRatioToggle: toggleSendRatio,
    onShopTap: () => {
      // Not during the final-blow slow-mo: appState is still "playing" there,
      // but the level is decided and the overlay is already scheduled — a shop
      // that opens now gets ripped away by it within a second.
      if (overPending) return;
      audio.uiTap();
      openShop("playing");
    },
    onAbilityTap: abilityTap,
    onAbilityCancel: disarmAbility,
    onMenuKey: (e) => handleMenuKey(e),
    chromeScope: () => appState,
    // Also blocked while a chrome layer is still fading out: appState is
    // already "playing" during the fade, so without this a tap under the
    // still-visible panel would reach the board and fire a send.
    worldInputBlocked: () => appState !== "playing" || renderer.chromeBusy(),
    onWorldTap: (x, y) => {
      /*
       * Armed ability first: the next world tap belongs to the power. A tap
       * on a legal target fires it; any other tap stands down. CONSUMED
       * either way (return true), which is what keeps the disarming tap from
       * becoming a pan candidate, a selection, or a send — input.ts returns
       * before any of that when onWorldTap claims the tap.
       */
      if (armedAbility !== null) {
        const key = armedAbility;
        armedAbility = null;
        const n = hitNode(game.state, x, y, 1.8, renderer.cssScale);
        const legal =
          n !== null && (key === "overcharge" ? n.owner === PLAYER : n.owner !== PLAYER);
        if (n && legal) {
          commandQueue.push({ type: "useAbility", ability: key, nodeId: n.id });
          audio.uiTap();
        }
        return true;
      }
      // Nudge chevron next: the teaching moment is tappable without selection.
      if (nudgeActive && nudgeNodeId !== null) {
        const n = game.state.nodes[nudgeNodeId];
        if (n && hitChevron(x, y, n.x, n.y, NODE_R[n.size], renderer.cssScale, renderer.down)) {
          commandQueue.push({ type: "upgradeNode", nodeId: n.id });
          audio.uiTap();
          return true;
        }
      }
      // Chevron upgrade button, hit-tested before world commands.
      const c = chevronNode();
      if (c && hitChevron(x, y, c.x, c.y, NODE_R[c.size], renderer.cssScale, renderer.down)) {
        commandQueue.push({ type: "upgradeNode", nodeId: c.id });
        audio.uiTap();
        return true;
      }
      return false;
    },
  });
  getDrag = handle.getDrag;
  syncDrag = handle.syncDrag;
  getHot = handle.getHot;
  disposers.push(handle.detach);

  // Menus, overlays, shop — canvas-space button routing. Registered AFTER
  // attachInput on purpose: input.ts stops immediate propagation on chrome
  // taps, so a state-changing ◈ tap is never re-resolved here under the new
  // state (the tap that opened the shop must not also close it).
  listen<PointerEvent>(canvas, "pointerdown", (e) => {
    // Chrome lives in CSS-pixel screen space, so route menu taps there
    // directly rather than round-tripping through the board transform.
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // A pointer has taken over; stop drawing the keyboard highlight.
    menuCursorSeen = false;

    if (appState === "shop") {
      if (renderer.hitUiButton(x, y)) return; // mute/pause are live here too
      doShopAction(renderer.hitShopMenu(x, y));
      return;
    }
    if (appState === "settings") {
      if (renderer.hitUiButton(x, y)) return; // mute/pause are live here too
      doSettingsAction(renderer.hitSettingsMenu(x, y));
      return;
    }
    if (appState === "help") {
      if (renderer.hitUiButton(x, y)) return; // mute/pause are live here too
      const hit = renderer.hitHelpCard(x, y);
      if (hit === "close" || hit === "outside") {
        audio.uiTap();
        appState = "paused";
      }
      return;
    }
    if (appState === "map") {
      if (renderer.hitUiButton(x, y)) return; // mute/pause are live here too
      const hit = renderer.hitMapScreen(x, y);
      // Same rule as the help card: a tap on the map's own content does
      // nothing — the player is reading it, not dismissing it.
      if (hit === "close" || hit === "outside") {
        audio.uiTap();
        closeMap();
      }
      return;
    }
    if (appState === "paused") {
      if (renderer.hitUiButton(x, y)) return; // handled by input.ts
      doPauseAction(renderer.hitPauseMenu(x, y));
      return;
    }

    if (appState !== "over" || performance.now() - overlayShownAt < 500) return;
    if (renderer.hitUiButton(x, y)) return;
    // skipPuzzle repurposes the daily slot, so its rect must be live even
    // while the daily itself is still locked.
    const lockedForHit = (overlay?.dailyLocked ?? false) && !overlay?.skipPuzzle;
    const btn = renderer.hitOverlayButton(x, y, lockedForHit);
    doOverlayAction(btn ?? "continue");
  });

  // Dev-only inspection handle; step(n) pumps the sim directly — rAF doesn't
  // fire in hidden tabs. startLevel/enqueue exist for automation. Statically
  // gated (see ./dev) so it is absent from production bundles; the disposer
  // keeps a StrictMode remount from reading a dead closure's handle.
  if (DEV_HANDLES) {
    (window as unknown as Record<string, unknown>).__game = {
      game,
      loop,
      renderer,
      audio,
      getSave: () => save,
      // Additive only: external tooling depends on this object's shape, so
      // fields may be added here but never renamed or removed.
      appState: () => appState,
      hashState: () => hashState(game.state),
      startLevel,
      startDaily,
      enqueue: (cmd: Command) => commandQueue.push(cmd),
      step: (n: number) => {
        for (let i = 0; i < n; i++) {
          if (appState !== "playing") break;
          simTick();
          if (game.state.status !== "playing") onGameOver();
        }
        renderer.render(game.prevState ?? game.state, game.state, 1, overlay, hud(), shopView());
      },
      skipOverlay: () => {
        overlayShownAt = 0;
        canvas.dispatchEvent(new PointerEvent("pointerdown"));
      },
    };
    disposers.push(() => {
      delete (window as unknown as Record<string, unknown>).__game;
    });
  }

  /**
   * Dismiss the start card and begin the run for real.
   *
   * The same tap unlocks WebAudio, which is the only way a browser will let
   * the music start.
   */
  const beginPlay = (): void => {
    if (appState !== "start") return;
    audio.unlock();
    startLevel(save.run.level); // fresh board — the demo behind the card is scrap
    audio.uiTap();
  };

  listen<PointerEvent>(canvas, "pointerdown", (e) => {
    if (appState !== "start") return;
    // The mute and pause icons are live on the start card too — tapping one
    // should do that, not silently start the run underneath it.
    const rect = canvas.getBoundingClientRect();
    if (renderer.hitUiButton(e.clientX - rect.left, e.clientY - rect.top)) return;
    beginPlay();
  });
  listen<KeyboardEvent>(window, "keydown", (e) => {
    // Any key starts, except the pause binding, which input.ts owns.
    if (appState !== "start" || e.repeat) return;
    // Mute is handled by input.ts and must not also start the run — someone
    // silencing the title music should not find themselves mid-level.
    if (isPauseKey(e) || matches(e, BINDINGS.mute)) return;
    beginPlay();
  });

  loop.start();

  return {
    destroy() {
      loop.stop(); // cancelAnimationFrame — no further simTick/render
      // A win decided inside the 900 ms final-blow window hasn't been banked
      // yet (applyWin lives in the deferred overlay timer, which the disposers
      // below are about to clear) — and the pause menu's BACK TO PLAYHOUSE is
      // reachable inside that window. Flush it now or the just-earned win is
      // silently lost. The status check is load-bearing, not defensive:
      // RESTART RUN or DAILY inside the window swaps in a fresh "playing"
      // board without resetting overPending, and flushing THAT board would
      // score it as a defeat and dock a life.
      if (overPending && game.state.status === "won") {
        overPending = false;
        onGameOver();
      }
      renderer.destroy(); // disconnect the ResizeObserver
      for (const dispose of disposers) dispose();
      // ^ removes every listener (window unlock ×2, visibilitychange, the
      //   canvas routers, the any-key start), clears tracked timers, runs
      //   input.detach(), deletes the dev handle.
      audio.dispose(); // music scheduler + AudioContext, last
    },
  };
}
