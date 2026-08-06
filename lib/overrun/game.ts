import type { GameState, Node } from "./sim/state";
import { PLAYER } from "./sim/state";
import { NODE_R } from "./sim/constants";
import { tick } from "./sim/tick";
import { createDailyLevel, createLevel } from "./sim/level";
import type { Command } from "./sim/commands";
import { createLoop } from "./loop";
import {
  Renderer,
  type DragView,
  type GameFonts,
  type OverlayView,
  type RestartView,
  type ShopView,
} from "./render/renderer";
import { attachInput } from "./input/input";
import { AudioSystem } from "./audio/audio";
import { createTickEvents, diffTick } from "./audio/events";
import {
  hitChevron,
  hitOverlayButton,
  hitPauseMenu,
  hitRestartMenu,
  hitRunOverButton,
  hitShopMenu,
  hitUiButton,
} from "./render/fx";
import {
  applyDailyClear,
  applyDefeat,
  applyWin,
  boostsFor,
  buyUpgrade,
  checkpointLevel,
  coresForWin,
  dailySeed,
  livesFor,
  migrateSave,
  runFrom,
  todayUTC,
  TRACKS,
  type SaveV3,
} from "./app/run";
import { pickUpgradeNudgeNode } from "./app/nudge";
import { loadRaw, persistSave } from "./save";

/**
 * App layer: owns the run/level lifecycle around the sim.
 * appState: "playing" | "paused" | "over" | "shop" | "restart";
 * mode: "run" | "daily".
 *
 * The game lives inside a React page, so everything registered here —
 * listeners, timers, the rAF loop, the AudioContext — is collected into
 * disposers and torn down by destroy(). StrictMode runs mount → cleanup →
 * mount, and the second boot must find a clean slate.
 *
 * Upstream's equivalent (src/main.ts in the game1 repo) self-executes and
 * talks to the CrazyGames SDK. Neither survives here: this is a factory, and
 * the only "platform" is ./save.
 */

/** 3★ par times until real calibration pars land: 45 + 15·L seconds. */
function parTicks(level: number): number {
  return 30 * (45 + 15 * level);
}

export interface OverrunOptions {
  /** "BACK TO PLAYHOUSE" in the pause menu — the host navigates away. */
  onExit: () => void;
  fonts?: GameFonts;
}

export interface OverrunHandle {
  destroy(): void;
}

export function createOverrun(canvas: HTMLCanvasElement, opts: OverrunOptions): OverrunHandle {
  const disposers: Array<() => void> = [];
  const listen = <E extends Event>(target: EventTarget, type: string, fn: (e: E) => void): void => {
    const l = fn as EventListener;
    target.addEventListener(type, l);
    disposers.push(() => target.removeEventListener(type, l));
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

  // Migrated in memory only. The older shape stays on disk until the player
  // actually changes something, which keeps a rollback path open.
  let save: SaveV3 = migrateSave(loadRaw());
  const persist = (): void => persistSave(save);

  // Mutable holder: input/render/debug closures read through this so level
  // swaps don't strand them on a dead state object.
  const game = {
    state: createLevel(save.run.level, boostsFor(save)),
    prevState: null as GameState | null,
  };
  game.prevState = structuredClone(game.state);

  const commandQueue: Command[] = [];
  let appState: "playing" | "paused" | "over" | "shop" | "restart" = "playing";
  let shopReturn: "paused" | "over" = "paused";
  let mode: "run" | "daily" = "run";
  let dailyMutator = "";
  let overlay: OverlayView | null = null;
  let overlayShownAt = 0; // input swallow so the killing tap doesn't skip the screen
  let streak = 0;
  let levelLosses = 0; // player nodes lost this level (2★ requires 0)
  let levelRivalsDown = 0; // Warlord Bounty
  let nudgeNodeId: number | null = null; // node spotlit by the upgrade nudge
  let nudgeActive = false; // nudge live this level

  const audio = new AudioSystem();
  const tickEvents = createTickEvents();

  // Autoplay policy: the context can only start inside a user gesture, and
  // iOS suspends it after interruptions — so unlock opportunistically, always.
  listen(window, "pointerdown", () => audio.unlock());
  listen(window, "keydown", () => audio.unlock());
  listen(document, "visibilitychange", () => {
    if (document.visibilityState === "visible") {
      audio.unlock();
    } else {
      // Auto-pause: coming back to the tab should land on the menu, not
      // mid-battle (rAF freezes the sim anyway; this makes it explicit).
      pauseGame();
    }
  });

  let getDrag: () => DragView | null = () => null;
  const renderer = new Renderer(
    canvas,
    () => getDrag(),
    () => audio.isUserMuted(),
    opts.fonts,
  );

  /** The selected player node currently eligible for the upgrade chevron. */
  const chevronNode = (): Node | null => {
    if (appState !== "playing") return null;
    for (const n of game.state.nodes) {
      if (!n.selected || n.owner !== PLAYER || n.size >= 2 || n.upgrading !== 0) continue;
      if (n.units < game.state.cfg.playerUpgradeCost[n.size as 0 | 1]!) continue;
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

  const hud = () => ({
    lives: save.run.lives,
    maxLives: livesFor(save),
    bestLevel: save.bestLevel,
    checkpoint: checkpointLevel(save),
    streak,
    cores: save.cores,
    paused: appState === "paused",
    dailyName: mode === "daily" ? `DAILY · ${dailyMutator}` : undefined,
    chevronNodeId: chevronNode()?.id ?? null,
    nudgeNodeId: nudgeNode(),
    showDimChevrons: save.flags.upgradeNudgeShown,
  });

  const shopView = (): ShopView | null => {
    if (appState !== "shop") return null;
    return {
      cores: save.cores,
      rows: TRACKS.map((t) => {
        const tier = save.upgrades[t.key];
        const cost = tier < t.costs.length ? t.costs[tier]! : null;
        return {
          name: t.name,
          desc: t.describe(tier < t.costs.length ? tier + 1 : tier),
          cost,
          tier,
          maxTier: t.costs.length,
          affordable: cost !== null && save.cores >= cost,
        };
      }),
    };
  };

  const restartView = (): RestartView | null =>
    appState === "restart" ? { checkpointLevel: checkpointLevel(save) } : null;

  const simTick = (): void => {
    game.prevState = structuredClone(game.state);
    tick(game.state, commandQueue);
    commandQueue.length = 0;
    diffTick(game.prevState, game.state, tickEvents);
    audio.onEvents(tickEvents);
    levelLosses += tickEvents.playerLosses;
    levelRivalsDown += tickEvents.rivalsEliminated;
  };

  const resetLevelCounters = (): void => {
    commandQueue.length = 0;
    overlay = null;
    levelLosses = 0;
    levelRivalsDown = 0;
    nudgeActive = false;
    nudgeNodeId = null;
    appState = "playing";
    loop.setTimeScale(1);
  };

  const startLevel = (level: number): void => {
    mode = "run";
    game.state = createLevel(level, boostsFor(save));
    game.prevState = structuredClone(game.state);
    resetLevelCounters();
  };

  const startDaily = (): void => {
    mode = "daily";
    const { state, mutator } = createDailyLevel(dailySeed(todayUTC()), boostsFor(save));
    dailyMutator = mutator;
    game.state = state;
    game.prevState = structuredClone(state);
    resetLevelCounters();
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

  const togglePause = (): void => {
    // Esc backs out of the restart choice rather than doing nothing.
    if (appState === "restart") appState = "paused";
    else if (appState === "paused") resumeGame();
    else if (appState === "playing") pauseGame();
  };

  /** Begin a fresh run at `level` with full lives (checkpoint or level 1). */
  const beginRun = (level: number): void => {
    save = { ...save, run: runFrom(save, level) };
    streak = 0;
    persist();
    loop.resume();
    startLevel(save.run.level);
  };

  const openShop = (from: "paused" | "over"): void => {
    shopReturn = from;
    appState = "shop";
  };

  const onGameOver = (): void => {
    appState = "over";
    overlayShownAt = performance.now();
    const won = game.state.status === "won";

    if (mode === "daily") {
      if (won) {
        const reward = applyDailyClear(save, todayUTC());
        persist(); // applyDailyClear mutates in place
        overlay = { kind: "daily-won", cores: reward };
        audio.victory();
      } else {
        overlay = { kind: "daily-lost" };
        audio.defeat();
      }
      return;
    }

    if (won) {
      streak += 1;
      const level = game.state.cfg.level;
      const stars: 1 | 2 | 3 =
        levelLosses === 0 ? (game.state.tick <= parTicks(level) ? 3 : 2) : 1;
      const ctx = { level, stars, streak, rivalsEliminatedByPlayer: levelRivalsDown };
      const cores = coresForWin(save, ctx);
      const cpBefore = checkpointLevel(save);
      save = applyWin(save, ctx);
      persist();
      const cpAfter = checkpointLevel(save);
      overlay = { kind: "won", cores, stars, checkpoint: cpAfter > cpBefore ? cpAfter : undefined };
      audio.victory();
    } else {
      streak = 0;
      const result = applyDefeat(save);
      save = result.save;
      persist();
      overlay = result.runOver
        ? {
            kind: "runover",
            reachedLevel: result.reachedLevel,
            bestLevel: save.bestLevel,
            checkpointLevel: checkpointLevel(save),
          }
        : { kind: "lost", lives: save.run.lives };
      audio.defeat();
    }
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
    loop.setTimeScale(0.25);
    after(900, () => loop.setTimeScale(1));
  };

  let overPending = false;
  const loop = createLoop({
    simTick() {
      if (appState !== "playing" || overPending) return;
      simTick();
      if (game.state.status !== "playing") {
        if (game.state.status === "won") {
          // Slow-mo moment breathes before the overlay lands; sim is frozen
          // (status ≠ playing) so nothing advances underneath it.
          overPending = true;
          finalBlow();
          after(900, () => {
            overPending = false;
            onGameOver();
          });
        } else {
          onGameOver();
        }
      }
    },
    render(alpha) {
      renderer.render(
        game.prevState ?? game.state,
        game.state,
        alpha,
        overlay,
        hud(),
        shopView(),
        restartView(),
      );
    },
  });

  const handle = attachInput(canvas, renderer, () => game.state, commandQueue, {
    onMuteToggle: () => audio.toggleUserMuted(),
    onPauseToggle: togglePause,
    worldInputBlocked: () => appState !== "playing",
    onWorldTap: (x, y) => {
      // Nudge chevron first: the teaching moment is tappable without selection.
      if (nudgeActive && nudgeNodeId !== null) {
        const n = game.state.nodes[nudgeNodeId];
        if (n && hitChevron(x, y, n.x, n.y, NODE_R[n.size]!)) {
          commandQueue.push({ type: "upgradeNode", nodeId: n.id });
          audio.uiTap();
          return true;
        }
      }
      // Chevron upgrade button, hit-tested before world commands.
      const c = chevronNode();
      if (c && hitChevron(x, y, c.x, c.y, NODE_R[c.size]!)) {
        commandQueue.push({ type: "upgradeNode", nodeId: c.id });
        audio.uiTap();
        return true;
      }
      return false;
    },
  });
  getDrag = handle.getDrag;
  disposers.push(handle.detach);

  // Menus, overlays, shop — canvas-space button routing.
  listen(canvas, "pointerdown", (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const { x, y } = renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

    if (appState === "shop") {
      const hit = hitShopMenu(x, y);
      if (typeof hit === "number") {
        const track = TRACKS[hit]!;
        if (buyUpgrade(save, track.key)) {
          persist(); // buyUpgrade mutates in place
          audio.uiTap();
          // Lives may have grown (Second Wind) mid-run: top up immediately.
          if (track.key === "secondWind" && save.run.lives < livesFor(save)) {
            save = { ...save, run: { ...save.run, lives: save.run.lives + 1 } };
            persist();
          }
        }
      } else if (hit === "close" || hit === "outside") {
        audio.uiTap();
        appState = shopReturn;
      }
      return;
    }

    if (appState === "restart") {
      const hit = hitRestartMenu(x, y);
      if (hit === "checkpoint") {
        audio.uiTap();
        beginRun(checkpointLevel(save));
      } else if (hit === "fresh") {
        audio.uiTap();
        beginRun(1);
      } else if (hit === "cancel" || hit === "outside") {
        audio.uiTap();
        appState = "paused";
      }
      return;
    }

    if (appState === "paused") {
      if (hitUiButton(x, y)) return; // top-right buttons already handled by input.ts
      const action = hitPauseMenu(x, y);
      if (action === "mute") audio.toggleUserMuted();
      else if (action === "restart") {
        audio.uiTap();
        // With nothing banked both branches are level 1 — skip the choice.
        if (checkpointLevel(save) > 1) appState = "restart";
        else beginRun(1);
      } else if (action === "shop") {
        audio.uiTap();
        openShop("paused");
      } else if (action === "daily") {
        audio.uiTap();
        loop.resume();
        startDaily();
      } else if (action === "exit") {
        audio.uiTap();
        opts.onExit();
      } else if (action === "resume" || action === "outside") {
        audio.uiTap();
        resumeGame();
      }
      return;
    }

    if (appState !== "over" || performance.now() - overlayShownAt < 500) return;
    // A mute/pause toggle on the overlay must not also advance the level.
    if (hitUiButton(x, y)) return;
    const btn = hitOverlayButton(x, y);
    const runOverlay = overlay && overlay.kind !== "daily-won" && overlay.kind !== "daily-lost";
    if (btn === "shop" && runOverlay) {
      audio.uiTap();
      openShop("over");
      return;
    }
    if (btn === "daily" && runOverlay) {
      audio.uiTap();
      startDaily();
      return;
    }
    // Run over with a checkpoint banked: the start is an explicit choice, so a
    // tap anywhere else does nothing rather than silently picking a branch.
    if (overlay?.kind === "runover" && checkpointLevel(save) > 1) {
      const choice = hitRunOverButton(x, y);
      if (choice === null) return;
      audio.uiTap();
      beginRun(choice === "checkpoint" ? checkpointLevel(save) : 1);
      return;
    }
    audio.uiTap();
    // applyWin/applyDefeat already set the right level; dailies never touch
    // run lives, so both paths resume the run where it left off.
    startLevel(save.run.level);
  });

  // Dev-only inspection handle; step(n) pumps the sim directly — rAF doesn't
  // fire in hidden tabs.
  if (process.env.NODE_ENV === "development") {
    (window as unknown as Record<string, unknown>).__game = {
      game,
      loop,
      renderer,
      audio,
      getSave: () => save,
      startLevel,
      startDaily,
      shopView,
      enqueue: (cmd: Command) => commandQueue.push(cmd),
      step: (n: number) => {
        for (let i = 0; i < n; i++) {
          if (appState !== "playing") break;
          simTick();
          if (game.state.status !== "playing") onGameOver();
        }
        renderer.render(
          game.prevState ?? game.state,
          game.state,
          1,
          overlay,
          hud(),
          shopView(),
          restartView(),
        );
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

  loop.start();

  return {
    destroy() {
      loop.stop();
      renderer.destroy();
      for (const dispose of disposers) dispose();
      audio.dispose();
    },
  };
}
