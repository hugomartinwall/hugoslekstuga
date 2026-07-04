"use client";

import { useEffect, useRef, useState } from "react";
import { drawHugoSprite, readAccent } from "@/lib/hugo/sprite";
import {
  createPlayer,
  stepPlayer,
  updateCamera,
  JUMP_BUFFER_STEPS,
  MAX_SIM_STEPS,
  PLAYER_HALF,
  STEP_MS,
  type InputState,
  type Surface,
} from "@/lib/hugo/parkour/physics";
import {
  buildLevel,
  moverSurfaces,
  type Level,
} from "@/lib/hugo/parkour/level";
import {
  drawBeam,
  drawDoor,
  drawTerrain,
  BEAM_STEPS,
  DOOR_H,
  DOOR_W,
} from "@/lib/hugo/parkour/render";
import { getWordmarkLetters } from "@/lib/wordmark-bridge";

/**
 * Hugo's parkour — the homepage's hidden game.
 *
 * Long-press the corner Hugo and the room grows gravity: he drops to
 * the floor of the arcade and the drifting tool orbs become moving
 * platforms. Arrow keys (or WASD) run and jump. Somewhere near the
 * ceiling hangs a glowing door — chain jumps across the swarm to
 * reach it. The prize behind the door is the honest one: a link to
 * Legacies, Hugo's day job.
 *
 * The platforms are read straight from the live swarm each step
 * (ToolMap tags every node <g> with data-slug/data-r), so the level
 * IS the homepage — drifting, explodable, never the same twice.
 * ToolMap suppresses click-navigation and idle fetches while the
 * game owns the room; the corner dot yields via hugo-stage.
 *
 * The simulation itself lives in lib/hugo/parkour/physics.ts; the
 * canvas painters in lib/hugo/parkour/render.ts. This component is
 * the shell: events, input, the fixed-timestep loop, DOM reads, and
 * the win overlay.
 */

const SPRITE_PX = 2; // canvas px per sprite cell (crisp at DPR)
// Spawn = where the corner Hugo lives; the beam drops him in there.
const SPAWN_X = 46;
const SPAWN_Y = 46;
/** The marquee's letters are solid ground too — mid-room terrain the
 *  swarm's repel zone keeps clear of orbs. Flip off to defer if a
 *  playtest says the level reads worse with them. */
const LETTER_PLATFORMS = true;
/** Synthetic surface-id prefix for standing on a wordmark letter. */
const LETTER_SLUG = "#L";

type Platform = { x: number; y: number; r: number; slug: string };

function readPlatforms(): Platform[] {
  const out: Platform[] = [];
  const gs = document.querySelectorAll<SVGGElement>("svg g[data-slug]");
  const svg = gs[0]?.ownerSVGElement;
  const off = svg?.getBoundingClientRect();
  const ox = off?.left ?? 0;
  const oy = off?.top ?? 0;
  for (const g of gs) {
    const t = g.getAttribute("transform") || "";
    const m = t.match(/translate\(([-\d.]+)[,\s]+([-\d.]+)\)/);
    if (!m) continue;
    out.push({
      x: ox + Number(m[1]),
      y: oy + Number(m[2]),
      r: Number(g.getAttribute("data-r") || 26),
      slug: g.getAttribute("data-slug") || "",
    });
  }
  return out;
}

/** Everything Hugo can stand on this step, in landing-priority order:
 *  swarm orbs, wordmark letters, patrolling movers, then the authored
 *  level (floors, ledges, cabinet tops). */
function collectSurfaces(level: Level, tick: number): Surface[] {
  const out: Surface[] = [];
  for (const p of readPlatforms()) {
    out.push({ kind: "orb", id: p.slug, x: p.x, y: p.y, r: p.r });
  }
  if (LETTER_PLATFORMS) {
    for (const l of getWordmarkLetters()) {
      out.push({
        kind: "rect",
        id: `${LETTER_SLUG}${l.index}`,
        x: l.x,
        y: l.y,
        w: l.w,
      });
    }
  }
  out.push(...moverSurfaces(level, tick));
  out.push(...level.surfaces);
  return out;
}

export default function HugoParkour() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(false);
  const [won, setWon] = useState(false);
  const wonRef = useRef(false);
  const respawnRef = useRef(false);
  const runSeedRef = useRef(0);

  useEffect(() => {
    const onStart = () => {
      wonRef.current = false;
      setWon(false);
      runSeedRef.current += 1;
      setActive(true);
      window.dispatchEvent(
        new CustomEvent("hugoslekstuga:hugo-stage", {
          detail: { present: true },
        }),
      );
    };
    window.addEventListener("hugoslekstuga:parkour-start", onStart);
    return () =>
      window.removeEventListener("hugoslekstuga:parkour-start", onStart);
  }, []);

  const quit = () => {
    setActive(false);
    setWon(false);
    wonRef.current = false;
    window.dispatchEvent(new CustomEvent("hugoslekstuga:parkour-end"));
    window.dispatchEvent(
      new CustomEvent("hugoslekstuga:hugo-stage", {
        detail: { present: false },
      }),
    );
  };

  // The run itself — input, the loop, drawing. Restarts per run seed.
  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const accent = readAccent();
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let w = 0;
    let h = 0;
    let floorY = 0;
    let doorX = 0;
    let doorY = 0;
    // The authored world extends past screen 0's right edge; worldW
    // comes from the baked level.
    let worldW = 0;
    let level: Level = buildLevel(1, 1); // replaced in layout()
    const camera = { x: 0 };

    // The door hangs high, wherever the ceiling has room. Search and
    // About are anchored up there (swarm nodes tagged $search/$about),
    // so the run reads their live positions and hangs the door at the
    // midpoint of the widest clear gap — also keeping clear of the
    // corner Hugo (left) and the DO-NOT-PRESS button (right). The old
    // fixed 62% spot sat on the About label whenever the swarm and the
    // constant disagreed about whose stretch of ceiling it was.
    const placeDoor = () => {
      const xs = readPlatforms()
        .filter((p) => p.slug.startsWith("$"))
        .map((p) => p.x)
        .filter((x) => x > 0 && x < w)
        .sort((a, b) => a - b);
      const edges = [90, ...xs, w - 110];
      let mid = w * 0.5;
      let best = 0;
      for (let i = 1; i < edges.length; i++) {
        const gap = edges[i] - edges[i - 1];
        if (gap > best) {
          best = gap;
          mid = (edges[i] + edges[i - 1]) / 2;
        }
      }
      doorX = Math.round(mid);
      doorY = Math.max(72, h * 0.12);
    };

    // Sized against the live viewport — resizing mid-run re-lays the
    // room (canvas backing store, floor, door) instead of stretching
    // a stale frame.
    const layout = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      floorY = h - 10;
      level = buildLevel(w, floorY);
      worldW = level.worldW;
      camera.x = Math.max(0, Math.min(worldW - w, camera.x));
      placeDoor();
    };
    layout();
    window.addEventListener("resize", layout);

    // Spawn where the corner Hugo lives; gravity does the intro.
    const player = createPlayer(SPAWN_X, SPAWN_Y);
    const input: InputState = {
      left: false,
      right: false,
      upHeld: false,
      jumpCut: false,
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        quit();
        return;
      }
      if (wonRef.current) return;
      if (e.key === "ArrowLeft" || e.key === "a") input.left = true;
      else if (e.key === "ArrowRight" || e.key === "d") input.right = true;
      else if (e.key === "ArrowUp" || e.key === "w" || e.key === " ") {
        if (!input.upHeld) player.jumpBuffer = JUMP_BUFFER_STEPS;
        input.upHeld = true;
      } else {
        return;
      }
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "a") input.left = false;
      else if (e.key === "ArrowRight" || e.key === "d") input.right = false;
      else if (e.key === "ArrowUp" || e.key === "w" || e.key === " ") {
        input.upHeld = false;
        // Variable jump height: let go early, jump shorter. Consumed
        // by the next simulation step so the cut is the same strength
        // wherever inside a frame the keyup lands.
        input.jumpCut = true;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    let raf = 0;
    let tick = 0;
    // Where the player was at the previous simulation step — the draw
    // interpolates between this and the live position so displays
    // faster than the 60Hz sim still get one-frame-smooth motion.
    // Only position interpolates; squash/facing/feet are pixel-art
    // states and look better stepped.
    const prevPos = { x: player.x, y: player.y, camX: camera.x };

    const simulate = () => {
      tick += 1;
      const surfaces = collectSurfaces(level, tick);

      if (respawnRef.current) {
        respawnRef.current = false;
        player.x = SPAWN_X;
        player.y = SPAWN_Y;
        player.vx = 0;
        player.vy = 0;
        player.stand = null;
        player.grounded = false;
        player.airJump = true;
        tick = 0; // replay the spawn beam
        camera.x = 0;
        // A respawn is a teleport — don't sweep the sprite across the
        // room interpolating from where he died.
        prevPos.x = player.x;
        prevPos.y = player.y;
        prevPos.camX = camera.x;
      }

      if (!wonRef.current) {
        stepPlayer(player, input, surfaces, {
          // The floor is level surfaces now (its gaps are the pits);
          // the old catch-all clamp must never fire.
          floorY: Number.POSITIVE_INFINITY,
          minX: PLAYER_HALF,
          maxX: worldW - PLAYER_HALF,
        });
        updateCamera(camera, player.x, w, worldW, reducedMotion);

        // The pit rule: fall past the kill line and the run is over —
        // no checkpoints, LIVE FOREVER is earned. The respawn beam
        // replays from the very start.
        if (player.y > level.killY) {
          respawnRef.current = true;
        }

        // The door.
        if (
          Math.abs(player.x - doorX) < DOOR_W / 2 + 8 &&
          player.y > doorY - 10 &&
          player.y < doorY + DOOR_H
        ) {
          wonRef.current = true;
          setWon(true);
          window.dispatchEvent(new CustomEvent("hugoslekstuga:hugo-happy"));
        }
      }

      if (player.squash !== 0) {
        player.squash += player.squash > 0 ? -1 : 1;
      }
    };

    const draw = (rx: number, ry: number, camX: number) => {
      ctx.clearRect(0, 0, w, h);

      // World → screen: everything below draws in world coordinates.
      // Rounded so pixel art never lands on half pixels.
      ctx.save();
      ctx.translate(-Math.round(camX), 0);

      drawTerrain(ctx, level, tick, camX, w, h, !reducedMotion);

      drawDoor(ctx, doorX, doorY);

      if (!reducedMotion && tick <= BEAM_STEPS && !wonRef.current) {
        drawBeam(ctx, SPAWN_X, Math.min(ry + 16, floorY), accent, tick);
      }

      // Hugo.
      const running =
        player.grounded && Math.abs(player.vx) > 0.6 && !wonRef.current;
      const squashY = 1 - player.squash * 0.02;
      drawHugoSprite(ctx, {
        x: rx,
        y: ry,
        px: SPRITE_PX,
        accent,
        eye: {
          open: true,
          wide: wonRef.current,
          dx: player.facing === 1 ? 1 : -1,
          dy: player.vy < -1 ? -1 : player.vy > 3 ? 1 : 0,
        },
        feet: player.grounded
          ? running
            ? (((tick >> 3) % 2) as 0 | 1)
            : 0
          : 1,
        scaleX: player.facing * (2 - squashY),
        scaleY: squashY,
        sparklePhase: wonRef.current ? tick >> 3 : null,
      });

      ctx.restore();
    };

    // Fixed-timestep loop — physics advances in 60Hz steps however
    // often the display asks for frames, so a 120Hz panel gets the
    // same game as a 60Hz one (just drawn more often).
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      acc = Math.min(acc + (now - last), STEP_MS * MAX_SIM_STEPS);
      last = now;
      while (acc >= STEP_MS) {
        prevPos.x = player.x;
        prevPos.y = player.y;
        prevPos.camX = camera.x;
        simulate();
        acc -= STEP_MS;
      }
      const a = acc / STEP_MS;
      draw(
        prevPos.x + (player.x - prevPos.x) * a,
        prevPos.y + (player.y - prevPos.y) * a,
        prevPos.camX + (camera.x - prevPos.camX) * a,
      );
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", layout);
    };

  }, [active]);

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-40" style={{ pointerEvents: "none" }}>
      <canvas
        ref={canvasRef}
        aria-hidden
        className="absolute inset-0 h-full w-full"
        style={{ imageRendering: "pixelated" }}
      />
      {won && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ pointerEvents: "auto", background: "rgba(7, 8, 15, 0.72)" }}
        >
          <div className="notch flex max-w-sm flex-col items-center gap-4 border border-line bg-cream-deep px-8 py-8 text-center">
            <p className="text-glow font-display text-4xl text-green">
              YOU MADE IT.
            </p>
            <p className="text-sm leading-relaxed text-ink-soft">
              Enjoy early access to Legacies.
            </p>
            <a
              href="https://getlegacies.com/beta"
              target="_blank"
              rel="noopener"
              className="btn-chunk bg-green px-6 py-3 font-pixel text-[11px] uppercase tracking-[0.14em] text-cream"
            >
              enter Legacies beta →
            </a>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  respawnRef.current = true;
                  wonRef.current = false;
                  setWon(false);
                }}
                className="btn-chunk bg-cream-deep px-4 py-2 font-pixel text-[10px] uppercase tracking-[0.14em] text-ink"
              >
                again
              </button>
              <button
                type="button"
                onClick={quit}
                className="font-pixel text-[10px] uppercase tracking-[0.14em] text-ink-muted"
              >
                esc leaves
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
