"use client";

import { useEffect, useRef, useState } from "react";
import { COLOR_HEX } from "@/lib/colors";
import {
  drawHugoSprite,
  readAccent,
  withAlpha,
} from "@/lib/hugo/sprite";

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
 * The platforms are read straight from the live swarm each frame
 * (ToolMap tags every node <g> with data-slug/data-r), so the level
 * IS the homepage — drifting, explodable, never the same twice.
 * ToolMap suppresses click-navigation and idle fetches while the
 * game owns the room; the corner dot yields via hugo-stage.
 */

const GRAVITY = 0.55;
const RUN_ACCEL = 0.5;
const AIR_ACCEL = 0.3;
const MAX_RUN = 3.4;
const FRICTION = 0.82;
const JUMP_V = -12;
/** The second (air) jump is a touch softer than the first. */
const AIR_JUMP_SCALE = 0.92;
const COYOTE_FRAMES = 7;
const JUMP_BUFFER_FRAMES = 7;
const PLAYER_HALF = 14; // half-width of the ~28px sprite body
const SPRITE_PX = 2; // canvas px per sprite cell (crisp at DPR)
const DOOR_W = 26;
const DOOR_H = 34;
// Spawn = where the corner Hugo lives; the beam drops him in there.
const SPAWN_X = 46;
const SPAWN_Y = 46;
const BEAM_FRAMES = 26;

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

  // The run itself — physics, input, drawing. Restarts per run seed.
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
      placeDoor();
    };
    layout();
    window.addEventListener("resize", layout);

    // Spawn where the corner Hugo lives; gravity does the intro.
    const player = {
      x: SPAWN_X,
      y: SPAWN_Y,
      vx: 0,
      vy: 0,
      facing: 1,
      grounded: false,
      coyote: 0,
      jumpBuffer: 0,
      airJump: true,
      squash: 0,
      stand: null as null | { slug: string; lastX: number; lastY: number },
    };
    const input = { left: false, right: false, upHeld: false };

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
        if (!input.upHeld) player.jumpBuffer = JUMP_BUFFER_FRAMES;
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
        // Variable jump height: let go early, jump shorter.
        if (player.vy < -3) player.vy *= 0.5;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    let raf = 0;
    let frame = 0;

    const stepAndDraw = () => {
      frame += 1;
      const platforms = readPlatforms();

      if (respawnRef.current) {
        respawnRef.current = false;
        player.x = SPAWN_X;
        player.y = SPAWN_Y;
        player.vx = 0;
        player.vy = 0;
        player.stand = null;
        player.grounded = false;
        player.airJump = true;
        frame = 0; // replay the spawn beam
      }

      if (!wonRef.current) {
        // Ride the platform we're standing on (they drift).
        if (player.stand) {
          const p = platforms.find((q) => q.slug === player.stand!.slug);
          if (p) {
            player.x += p.x - player.stand.lastX;
            player.y += p.y - player.stand.lastY;
            player.stand.lastX = p.x;
            player.stand.lastY = p.y;
            const dx = player.x - p.x;
            if (Math.abs(dx) > p.r * 0.95) {
              player.stand = null;
              player.grounded = false;
            } else {
              player.y = p.y - Math.sqrt(Math.max(0, p.r * p.r - dx * dx)) - 16;
            }
          } else {
            player.stand = null;
            player.grounded = false;
          }
        }

        // Horizontal control.
        const accel = player.grounded ? RUN_ACCEL : AIR_ACCEL;
        if (input.left) {
          player.vx = Math.max(-MAX_RUN, player.vx - accel);
          player.facing = -1;
        } else if (input.right) {
          player.vx = Math.min(MAX_RUN, player.vx + accel);
          player.facing = 1;
        } else if (player.grounded) {
          player.vx *= FRICTION;
        }

        // Jumping — buffered, with coyote frames off ledges, plus one
        // air jump (recharged on landing) so a mistimed orb isn't fatal.
        if (player.grounded) {
          player.coyote = COYOTE_FRAMES;
          player.airJump = true;
        } else if (player.coyote > 0) player.coyote -= 1;
        if (player.jumpBuffer > 0) {
          player.jumpBuffer -= 1;
          const fromGround = player.coyote > 0;
          if (fromGround || player.airJump) {
            if (!fromGround) player.airJump = false;
            player.vy = fromGround ? JUMP_V : JUMP_V * AIR_JUMP_SCALE;
            player.grounded = false;
            player.stand = null;
            player.coyote = 0;
            player.jumpBuffer = 0;
            player.squash = -6; // stretch up
          }
        }

        // Gravity + integrate.
        if (!player.stand) {
          player.vy = Math.min(14, player.vy + GRAVITY);
          const prevY = player.y;
          player.x += player.vx;
          player.y += player.vy;

          // One-way landings on the top arc of any orb/cabinet.
          if (player.vy > 0) {
            for (const p of platforms) {
              const dx = player.x - p.x;
              if (Math.abs(dx) > p.r * 0.95) continue;
              const surface =
                p.y - Math.sqrt(Math.max(0, p.r * p.r - dx * dx)) - 16;
              if (prevY <= surface && player.y >= surface) {
                player.y = surface;
                player.vy = 0;
                player.grounded = true;
                player.squash = 6;
                player.stand = { slug: p.slug, lastX: p.x, lastY: p.y };
                break;
              }
            }
          }

          // Floor + walls.
          if (player.y >= floorY - 16) {
            player.y = floorY - 16;
            if (player.vy > 2) player.squash = 6;
            player.vy = 0;
            player.grounded = true;
          } else if (!player.stand) {
            player.grounded = false;
          }
          player.x = Math.max(PLAYER_HALF, Math.min(w - PLAYER_HALF, player.x));
        } else {
          player.x += player.vx;
          player.x = Math.max(PLAYER_HALF, Math.min(w - PLAYER_HALF, player.x));
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

      // ---- draw ----
      ctx.clearRect(0, 0, w, h);

      // Door: magenta frame, dark glass, mint knob, phosphor halo.
      const doorGlow = ctx.createRadialGradient(
        doorX,
        doorY + DOOR_H / 2,
        2,
        doorX,
        doorY + DOOR_H / 2,
        70,
      );
      doorGlow.addColorStop(0, withAlpha(COLOR_HEX.pink, 0.35));
      doorGlow.addColorStop(1, withAlpha(COLOR_HEX.pink, 0));
      ctx.fillStyle = doorGlow;
      ctx.fillRect(doorX - 70, doorY + DOOR_H / 2 - 70, 140, 140);
      ctx.fillStyle = COLOR_HEX.pink;
      ctx.fillRect(doorX - DOOR_W / 2, doorY, DOOR_W, DOOR_H);
      ctx.fillStyle = "#07080f";
      ctx.fillRect(doorX - DOOR_W / 2 + 4, doorY + 4, DOOR_W - 8, DOOR_H - 8);
      ctx.fillStyle = COLOR_HEX.green;
      ctx.fillRect(doorX + DOOR_W / 2 - 9, doorY + DOOR_H / 2 - 2, 4, 4);
      ctx.fillStyle = INKISH;
      ctx.font = "9px var(--font-pixel), monospace";
      ctx.textAlign = "center";
      ctx.fillText("THE EXIT", doorX, doorY + DOOR_H + 14);

      // Spawn beam — Hugo is beamed into the room: a thin phosphor
      // column over the spawn point that flickers and fades while he
      // drops out of it. Skipped under reduced motion.
      if (!reducedMotion && frame <= BEAM_FRAMES && !wonRef.current) {
        const fade = 1 - frame / BEAM_FRAMES;
        const flicker = frame % 4 < 2 ? 1 : 0.55;
        const a = 0.4 * fade * flicker;
        const bottom = Math.min(player.y + 16, floorY);
        ctx.fillStyle = withAlpha(accent, a);
        ctx.fillRect(SPAWN_X - 3, 0, 6, bottom);
        ctx.fillStyle = withAlpha(accent, a * 0.4);
        ctx.fillRect(SPAWN_X - 7, 0, 4, bottom);
        ctx.fillRect(SPAWN_X + 3, 0, 4, bottom);
      }

      // Hugo.
      const running =
        player.grounded && Math.abs(player.vx) > 0.6 && !wonRef.current;
      const squashY = 1 - player.squash * 0.02;
      drawHugoSprite(ctx, {
        x: player.x,
        y: player.y,
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
            ? (((frame >> 3) % 2) as 0 | 1)
            : 0
          : 1,
        scaleX: player.facing * (2 - squashY),
        scaleY: squashY,
        sparklePhase: wonRef.current ? frame >> 3 : null,
      });

      raf = requestAnimationFrame(stepAndDraw);
    };
    raf = requestAnimationFrame(stepAndDraw);

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
              The room was practice. The real quest is Hugo&rsquo;s day job.
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

/** Label ink for the door caption — matches the map labels. */
const INKISH = "#e8f2e9";
