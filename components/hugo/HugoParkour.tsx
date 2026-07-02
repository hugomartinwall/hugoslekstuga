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
const MAX_RUN = 4.2;
const FRICTION = 0.82;
const JUMP_V = -10.5;
const COYOTE_FRAMES = 7;
const JUMP_BUFFER_FRAMES = 7;
const PLAYER_HALF = 14; // half-width of the ~28px sprite body
const SPRITE_PX = 2; // canvas px per sprite cell (crisp at DPR)
const DOOR_W = 26;
const DOOR_H = 34;

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
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    const accent = readAccent();
    const floorY = h - 10;
    // The door hangs high, off-center — reachable only by chaining
    // jumps across whatever the swarm happens to offer on the way up.
    const doorX = Math.round(w * 0.62);
    const doorY = Math.max(72, h * 0.12);

    // Spawn where the corner Hugo lives; gravity does the intro.
    const player = {
      x: 46,
      y: 46,
      vx: 0,
      vy: 0,
      facing: 1,
      grounded: false,
      coyote: 0,
      jumpBuffer: 0,
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
        player.x = 46;
        player.y = 46;
        player.vx = 0;
        player.vy = 0;
        player.stand = null;
        player.grounded = false;
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

        // Jumping — buffered, with coyote frames off ledges.
        if (player.grounded) player.coyote = COYOTE_FRAMES;
        else if (player.coyote > 0) player.coyote -= 1;
        if (player.jumpBuffer > 0) {
          player.jumpBuffer -= 1;
          if (player.coyote > 0) {
            player.vy = JUMP_V;
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
