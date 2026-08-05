import type { GameState } from "./sim/state";
import { tick } from "./sim/tick";
import { createLevel } from "./sim/level";
import type { Command } from "./sim/commands";
import { createLoop } from "./loop";
import { Renderer, type DragView, type GameFonts, type OverlayView } from "./render/renderer";
import { attachInput } from "./input/input";
import { AudioSystem } from "./audio/audio";
import { createTickEvents, diffTick } from "./audio/events";
import { hitPauseMenu, hitUiButton } from "./render/fx";
import { applyDefeat, applyWin, LIVES_PER_RUN, migrateSave, newRun, type SaveV2 } from "./app/run";
import { loadRaw, persistSave } from "./save";

/**
 * App layer: owns the run/level lifecycle around the sim.
 * appState: "playing" → sim runs; "paused" → settings panel; "over" → overlay.
 *
 * The game lives inside a React page now, so everything registered here is
 * collected into disposers and torn down by destroy() — StrictMode runs
 * mount → cleanup → mount, and the second boot must find a clean slate.
 */

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

  let save: SaveV2 = migrateSave(loadRaw());
  const persist = (): void => persistSave(save);
  persist(); // write back migrated shape immediately

  // Mutable holder: input/render/debug closures read through this so level
  // swaps don't strand them on a dead state object.
  const game = {
    state: createLevel(save.run.level),
    prevState: null as GameState | null,
  };
  game.prevState = structuredClone(game.state);

  const commandQueue: Command[] = [];
  let appState: "playing" | "paused" | "over" = "playing";
  let overlay: OverlayView | null = null;
  let overlayShownAt = 0; // input swallow so the killing tap doesn't skip the screen

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

  const hud = () => ({
    lives: save.run.lives,
    maxLives: LIVES_PER_RUN,
    bestLevel: save.bestLevel,
    paused: appState === "paused",
  });

  const startLevel = (level: number): void => {
    game.state = createLevel(level);
    game.prevState = structuredClone(game.state);
    commandQueue.length = 0;
    overlay = null;
    appState = "playing";
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
    if (appState === "paused") resumeGame();
    else if (appState === "playing") pauseGame();
  };

  const restartRun = (): void => {
    save = { v: 2, bestLevel: save.bestLevel, run: newRun() };
    persist();
    loop.resume();
    startLevel(1);
  };

  const handle = attachInput(canvas, renderer, () => game.state, commandQueue, {
    onMuteToggle: () => audio.toggleUserMuted(),
    onPauseToggle: togglePause,
    worldInputBlocked: () => appState !== "playing",
  });
  getDrag = handle.getDrag;
  disposers.push(handle.detach);

  const simTick = (): void => {
    game.prevState = structuredClone(game.state);
    tick(game.state, commandQueue);
    commandQueue.length = 0;
    diffTick(game.prevState, game.state, tickEvents);
    audio.onEvents(tickEvents);
  };

  const onGameOver = (): void => {
    appState = "over";
    overlayShownAt = performance.now();
    if (game.state.status === "won") {
      save = applyWin(save);
      persist();
      overlay = { kind: "won" };
      audio.victory();
    } else {
      const result = applyDefeat(save);
      save = result.save;
      persist();
      overlay = result.runOver
        ? { kind: "runover", reachedLevel: result.reachedLevel, bestLevel: save.bestLevel }
        : { kind: "lost", lives: save.run.lives };
      audio.defeat();
    }
  };

  const loop = createLoop({
    simTick() {
      if (appState !== "playing") return;
      simTick();
      if (game.state.status !== "playing") onGameOver();
    },
    render(alpha) {
      renderer.render(game.prevState ?? game.state, game.state, alpha, overlay, hud());
    },
  });

  // Pause-menu buttons + overlay dismissal.
  listen(canvas, "pointerdown", (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const { x, y } = renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

    if (appState === "paused") {
      if (hitUiButton(x, y)) return; // top-right buttons already handled by input.ts
      const action = hitPauseMenu(x, y);
      if (action === "mute") audio.toggleUserMuted();
      else if (action === "restart") {
        audio.uiTap();
        restartRun();
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
    audio.uiTap();
    startLevel(save.run.level); // applyWin/applyDefeat already set the right level
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
      enqueue: (cmd: Command) => commandQueue.push(cmd),
      step: (n: number) => {
        for (let i = 0; i < n; i++) {
          if (appState !== "playing") break;
          simTick();
          if (game.state.status !== "playing") onGameOver();
        }
        renderer.render(game.prevState ?? game.state, game.state, 1, overlay, hud());
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
