"use client";

import { useEffect, useRef, useState } from "react";
import {
  drawHugoSprite,
  drawMopedHugo,
  readAccent,
  withAlpha,
} from "@/lib/hugo/sprite";
import { COLOR_HEX } from "@/lib/colors";
import {
  createPlayer,
  stepMoped,
  stepPlayer,
  updateCamera,
  JUMP_BUFFER_STEPS,
  MAX_SIM_STEPS,
  MOPED_CAM_ANCHOR,
  MOPED_MAX,
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
import { buildLevel2 } from "@/lib/hugo/parkour/level2";
import {
  drawBackdrop,
  drawBeam,
  drawGoal,
  drawHeadlight,
  drawHomeReplicas,
  drawLevelCard,
  drawSizzle,
  drawTerrain,
  makeBackdrop,
  makeDither,
  BEAM_STEPS,
  type OrbSnapshot,
} from "@/lib/hugo/parkour/render";
import { getWordmarkLetters } from "@/lib/wordmark-bridge";

/**
 * Hugo's parkour — the homepage's hidden game.
 *
 * Long-press the corner Hugo and the room grows gravity: he drops to
 * the floor of the arcade and the drifting tool orbs become moving
 * platforms. Arrow keys (or WASD) run and jump — and the homepage is
 * only the first screen. Past the right edge the arcade's back rooms
 * continue for several authored screens (see lib/hugo/parkour/
 * level.ts) until the prize at the end of the world: YOU'RE INVITED,
 * a humming neon monument that doubles as the honest pitch — a link
 * to Legacies, Hugo's day job. Falling into a pit restarts the whole
 * run; the ending is earned.
 *
 * Screen 0's platforms are read straight from the live swarm each
 * step (ToolMap tags every node <g> with data-slug/data-r), so the
 * level IS the homepage — drifting, explodable, never the same
 * twice. ToolMap suppresses click-navigation and idle fetches while
 * the game owns the room; the corner dot yields via hugo-stage.
 *
 * The simulation lives in lib/hugo/parkour/physics.ts, the authored
 * world in level.ts, the canvas painters in render.ts. This
 * component is the shell: events, input, the fixed-timestep loop,
 * DOM reads, and the win overlay.
 */

const SPRITE_PX = 2; // canvas px per sprite cell (crisp at DPR)
/** The marquee's letters are solid ground too — mid-room terrain the
 *  swarm's repel zone keeps clear of orbs. Flip off to defer if a
 *  playtest says the level reads worse with them. */
const LETTER_PLATFORMS = true;
/** Synthetic surface-id prefix for standing on a wordmark letter. */
const LETTER_SLUG = "#L";
/** The last stretch of screen 0: entering it fades the canvas
 *  backdrop over the live homepage; crossing the edge frees the
 *  camera. Walking back reverses the whole handover. */
const FADE_ZONE = 220;
/** The NEXT LEVEL transition timeline, in simulation steps: beam-out
 *  and fade to black, the LEVEL 2 card, swap, fade back in. Reduced
 *  motion holds the card as a static frame, then cuts. */
const TRANS_FADE_IN = 30;
const TRANS_SWAP = 120;
const TRANS_END = 150;
const TRANS_RM_END = 60;
/** The lava/water death beat, in simulation steps: Hugo vanishes at
 *  the sink point, the sizzle burst plays, then the respawn beam.
 *  Reduced motion skips the burst and cuts almost straight back. */
const DEATH_STEPS = 36;
const DEATH_RM_STEPS = 8;

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
function collectSurfaces(
  orbs: Platform[],
  level: Level,
  tick: number,
): Surface[] {
  const out: Surface[] = [];
  for (const p of orbs) {
    out.push({ kind: "orb", id: p.slug, x: p.x, y: p.y, r: p.r });
  }
  if (LETTER_PLATFORMS && level.homeScreen) {
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
  /** Which level the run is in. A ref — the loop reads it, and only
   *  the win panel needs React state. */
  const levelIdRef = useRef<1 | 2>(1);

  useEffect(() => {
    const onStart = () => {
      wonRef.current = false;
      setWon(false);
      levelIdRef.current = 1;
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
    const dither = makeDither(ctx);
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let w = 0;
    let h = 0;
    let floorY = 0;
    // The authored world extends past screen 0's right edge; worldW
    // comes from the baked level.
    let worldW = 0;
    let level: Level = buildLevel(1, 1); // replaced in layout()
    const camera = { x: 0 };
    // Screen-0 handover state — see FADE_ZONE.
    let homeLatch = true;
    let backdropAlpha = 0;
    // The static backdrop, pre-rendered once per layout (see makeBackdrop):
    // blitted every frame instead of re-filling the viewport twice.
    let backdropCache: HTMLCanvasElement | null = null;
    let lastOrbs: OrbSnapshot[] = [];
    // The NEXT LEVEL transition — see the TRANS_* timeline.
    let phase: "play" | "transition" | "death" = "play";
    let transStep = 0;
    // The death beat — where Hugo sank and into what.
    let deathStep = 0;
    const deathPos = { x: 0, y: 0 };
    let deathKind: "lava" | "water" = "lava";

    const rebuild = () => {
      level =
        levelIdRef.current === 1 ? buildLevel(w, floorY) : buildLevel2(w, floorY);
      worldW = level.worldW;
      homeLatch = level.homeScreen;
      backdropAlpha = level.homeScreen ? 0 : 1;
    };

    // Sized against the live viewport — resizing mid-run re-lays the
    // room (canvas backing store, floor, level bake) instead of
    // stretching a stale frame.
    const layout = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      floorY = h - 10;
      backdropCache = makeBackdrop(w, h, floorY, dpr);
      const keepFade = backdropAlpha;
      rebuild();
      // A mid-run resize shouldn't reset the handover fade.
      if (level.homeScreen) backdropAlpha = keepFade;
      camera.x = Math.max(0, Math.min(worldW - w, camera.x));
    };
    layout();
    window.addEventListener("resize", layout);

    // The level owns its spawn (level 1: where the corner Hugo
    // lives; gravity does the intro).
    const player = createPlayer(level.spawn.x, level.spawn.y);
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

    /** Teleport to the current level's spawn with everything reset —
     *  used by death respawns, "again", and the level swap. */
    const spawnIntoLevel = () => {
      rebuild();
      player.x = level.spawn.x;
      player.y = level.spawn.y;
      player.vx = 0;
      player.vy = 0;
      player.stand = null;
      player.grounded = false;
      player.airJump = true;
      tick = 0; // replay the spawn beam; movers restart deterministically
      camera.x = 0;
      // A spawn is a teleport — don't sweep the sprite across the
      // room interpolating from wherever he was.
      prevPos.x = player.x;
      prevPos.y = player.y;
      prevPos.camX = camera.x;
    };

    const simulate = () => {
      // The NEXT LEVEL card owns time while it plays; the world
      // stands still underneath (tick frozen, no physics).
      if (phase === "transition") {
        transStep += 1;
        const swapAt = reducedMotion ? TRANS_RM_END : TRANS_SWAP;
        const endAt = reducedMotion ? TRANS_RM_END : TRANS_END;
        if (transStep === swapAt) {
          levelIdRef.current = 2;
          spawnIntoLevel();
        }
        if (transStep >= endAt) phase = "play";
        return;
      }

      // The death beat mirrors the transition: world frozen (tick not
      // advanced) while the sizzle plays, then the respawn — which
      // resets tick to 0, so movers and lava replay deterministically.
      if (phase === "death") {
        deathStep += 1;
        if (deathStep >= (reducedMotion ? DEATH_RM_STEPS : DEATH_STEPS)) {
          spawnIntoLevel();
          phase = "play";
        }
        return;
      }

      tick += 1;
      const orbs = level.homeScreen ? readPlatforms() : [];
      lastOrbs = orbs;
      const surfaces = collectSurfaces(orbs, level, tick);

      if (respawnRef.current) {
        respawnRef.current = false;
        spawnIntoLevel();
      }

      if (!wonRef.current) {
        const world = {
          // The floor is level surfaces now (its gaps are the pits);
          // the old catch-all clamp must never fire.
          floorY: Number.POSITIVE_INFINITY,
          minX: PLAYER_HALF,
          maxX: worldW - PLAYER_HALF,
        };
        if (level.mechanic === "moped") {
          stepMoped(player, input, surfaces, world);
        } else {
          stepPlayer(player, input, surfaces, world);
        }

        // The screen-0 handover (level 1 only). While latched the
        // camera is pinned home and the backdrop tracks Hugo's
        // approach to the edge; crossing it frees the camera (the
        // catch-up ease reads as "leaving home"). Walking back
        // reverses everything once the camera has come home too.
        if (!level.homeScreen) {
          backdropAlpha = 1;
          updateCamera(
            camera,
            player.x,
            w,
            worldW,
            reducedMotion,
            level.mechanic === "moped" ? MOPED_CAM_ANCHOR : undefined,
          );
        } else if (homeLatch) {
          camera.x = 0;
          backdropAlpha = reducedMotion
            ? player.x >= w
              ? 1
              : 0
            : Math.max(0, Math.min(1, (player.x - (w - FADE_ZONE)) / FADE_ZONE));
          if (player.x >= w) homeLatch = false;
        } else {
          backdropAlpha = 1;
          updateCamera(camera, player.x, w, worldW, reducedMotion);
          if (player.x < w - FADE_ZONE && camera.x < 1) homeLatch = true;
        }

        // The pit rule: sink into a hazard past the kill line and this
        // level's run is over — NEXT LEVEL is the game's only
        // checkpoint. The sizzle plays where he sank, then the respawn
        // beam replays from the level's start.
        if (player.y > level.killY) {
          phase = "death";
          deathStep = 0;
          deathPos.x = player.x;
          deathPos.y = player.y;
          deathKind =
            level.hazards.find(
              (z) => player.x >= z.x && player.x <= z.x + z.w,
            )?.kind ?? "lava";
          player.vx = 0;
          player.vy = 0;
        }

        // The monument. Final goal (YOU'RE INVITED) wins the game;
        // otherwise (NEXT LEVEL) the card takes over and the city
        // waits on the other side.
        const g = level.goal;
        if (
          player.x > g.x - 6 &&
          player.x < g.x + g.w + 6 &&
          player.y > g.y - 6 &&
          player.y < g.y + g.h + 10
        ) {
          if (g.final) {
            wonRef.current = true;
            setWon(true);
            window.dispatchEvent(new CustomEvent("hugoslekstuga:hugo-happy"));
          } else {
            phase = "transition";
            transStep = 0;
            player.vx = 0;
            player.vy = 0;
          }
        }
      }

      if (player.squash !== 0) {
        player.squash += player.squash > 0 ? -1 : 1;
      }
    };

    const draw = (rx: number, ry: number, camX: number) => {
      ctx.clearRect(0, 0, w, h);

      // Screen-space cover over the homepage DOM (see FADE_ZONE).
      drawBackdrop(ctx, backdropAlpha, w, h, floorY, dither, backdropCache);

      // World → screen: everything below draws in world coordinates.
      // Rounded so pixel art never lands on half pixels.
      ctx.save();
      ctx.translate(-Math.round(camX), 0);

      // Hugo shares the camera's integer lattice: the world scrolls in
      // whole pixels (rounded camera), so the sprite must too, or it
      // drifts sub-pixel against the terrain and reads as stutter at
      // moped speed. Collision still uses the unrounded player.x/y.
      const drawX = Math.round(rx);
      const drawY = Math.round(ry);

      // Screen 0's terrain replicas — same coords as the collision,
      // so the DOM→canvas handover has no seam.
      if (level.homeScreen) {
        drawHomeReplicas(ctx, backdropAlpha, lastOrbs, getWordmarkLetters());
      }

      drawTerrain(ctx, level, tick, camX, w, h, !reducedMotion);

      drawGoal(ctx, level.goal, tick, !reducedMotion, camX, w);

      if (!reducedMotion && tick <= BEAM_STEPS && !wonRef.current) {
        drawBeam(ctx, level.spawn.x, Math.min(drawY + 16, floorY), accent, tick);
      }

      // Beam-out: the reverse beam swallows Hugo as the card fades in.
      if (!reducedMotion && phase === "transition" && transStep < TRANS_FADE_IN) {
        const t = Math.max(
          1,
          BEAM_STEPS - Math.floor((transStep / TRANS_FADE_IN) * BEAM_STEPS),
        );
        drawBeam(ctx, drawX, Math.min(drawY + 16, floorY), accent, t);
      }

      // The death beat: Hugo is gone; the hazard spits embers where
      // he sank. (Reduced motion skips it — the cut is near-instant.)
      if (phase === "death") {
        drawSizzle(
          ctx,
          deathPos.x,
          deathPos.y,
          deathStep,
          deathKind,
          !reducedMotion,
        );
        ctx.restore();
        if (!reducedMotion && deathStep < 4) {
          ctx.fillStyle = withAlpha(
            deathKind === "lava" ? COLOR_HEX.tomato : COLOR_HEX.blue,
            0.25,
          );
          ctx.fillRect(0, 0, w, h);
        }
        return;
      }

      // Hugo — on foot or in the saddle.
      const squashY = 1 - player.squash * 0.02;
      const eye = {
        open: true,
        wide: wonRef.current,
        dx: (player.facing === 1 ? 1 : -1) as 1 | -1,
        dy: (player.vy < -1 ? -1 : player.vy > 3 ? 1 : 0) as -1 | 0 | 1,
      };
      if (level.mechanic === "moped") {
        drawHeadlight(
          ctx,
          drawX + 15 * player.facing,
          drawY + 6,
          player.facing,
          reducedMotion ? 4 : Math.abs(player.vx),
        );
        const pitch = !player.grounded
          ? 0
          : input.right && player.vx < MOPED_MAX - 0.05
            ? 1
            : input.left && player.vx > 0.3
              ? -1
              : 0;
        drawMopedHugo(ctx, {
          x: drawX,
          y: drawY,
          px: SPRITE_PX,
          accent,
          facing: player.facing,
          wheelPhase: ((Math.abs(player.vx) > 0.5 ? (tick >> 2) % 2 : 0) as
            | 0
            | 1),
          pitch: pitch as -1 | 0 | 1,
          eye,
          scaleX: 2 - squashY,
          scaleY: squashY,
          sparklePhase: wonRef.current ? tick >> 3 : null,
        });
      } else {
        const running =
          player.grounded && Math.abs(player.vx) > 0.6 && !wonRef.current;
        drawHugoSprite(ctx, {
          x: drawX,
          y: drawY,
          px: SPRITE_PX,
          accent,
          eye,
          feet: player.grounded
            ? running
              ? (((tick >> 3) % 2) as 0 | 1)
              : 0
            : 1,
          scaleX: player.facing * (2 - squashY),
          scaleY: squashY,
          sparklePhase: wonRef.current ? tick >> 3 : null,
        });
      }

      ctx.restore();

      // The between-levels card, over everything, in screen space.
      if (phase === "transition") {
        const overlay = reducedMotion
          ? 1
          : transStep < TRANS_FADE_IN
            ? transStep / TRANS_FADE_IN
            : transStep <= TRANS_SWAP
              ? 1
              : Math.max(
                  0,
                  1 - (transStep - TRANS_SWAP) / (TRANS_END - TRANS_SWAP),
                );
        drawLevelCard(
          ctx,
          w,
          h,
          overlay,
          reducedMotion || transStep >= TRANS_FADE_IN,
          transStep,
          !reducedMotion,
        );
      }
    };

    // Fixed-timestep loop — physics advances in 60Hz steps however
    // often the display asks for frames, so a 120Hz panel gets the
    // same game as a 60Hz one (just drawn more often).
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      // Clamped both ways: a stall can't teleport (max), and a
      // non-monotonic timestamp can't push acc negative and wedge
      // the sim into a long apparent freeze (min).
      acc = Math.max(0, Math.min(acc + (now - last), STEP_MS * MAX_SIM_STEPS));
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
              YOU&apos;RE INVITED.
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
                  levelIdRef.current = 1; // a fresh run starts at home
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
