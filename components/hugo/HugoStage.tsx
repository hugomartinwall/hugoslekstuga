"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { COLOR_HEX, CREAM_HEX, INK_HEX } from "@/lib/colors";
import type { ToolColor } from "@/lib/tools";
import { useHugoState } from "@/lib/hugo-state";

/**
 * Stage Hugo — the character at full size, as a 16×16 pixel sprite
 * (the Nattöppet player-character form), canvas-rendered with
 * nearest-neighbour crispness.
 *
 * This is Hugo's first page-level embodiment: where a page mounts a
 * stage, the corner BrandDot yields (via the `hugoslekstuga:hugo-stage`
 * event) so there's one Hugo on screen at a time. The Advice page is
 * his home; other pages may host him later.
 *
 * The sprite wears the same persisted colour as the nav dot
 * (`hugoslekstuga:dot-color`) — it's the same character, bigger.
 * Mood (from lib/hugo-state) shapes blink cadence and bob speed;
 * the `pose` prop lets the host page direct him (thinking before an
 * advice draw, delivering after, declining when over-asked).
 */

export type HugoPose =
  | "idle"
  | "thinking"
  | "delivering"
  | "declining"
  | "celebrating";

const DOT_KEY = "hugoslekstuga:dot-color";
/** Same order BrandDot cycles through — index-compatible. */
const COLOR_ORDER: ToolColor[] = [
  "tomato",
  "blue",
  "yellow",
  "pink",
  "green",
  "purple",
  "orange",
  "teal",
];

/* 16×16 body mask. '.' empty, 'X' body, 's' shade, 'f' feet. */
const BODY_ROWS = [
  "................",
  ".....XXXXXX.....",
  "...XXXXXXXXXX...",
  "..XXXXXXXXXXXX..",
  "..XXXXXXXXXXXX..",
  ".XXXXXXXXXXXXXX.",
  ".XXXXXXXXXXXXXX.",
  ".XXXXXXXXXXXXXX.",
  ".XXXXXXXXXXXXXX.",
  ".XXXXXXXXXXXXXX.",
  "..XXXXXXXXXXss..",
  "..XXXXXXXXXsss..",
  "...XXXXXXXsss...",
  "....XXXXXXss....",
  "....ff....ff....",
  "................",
];

/** Blend a hex colour toward black by `amount` (0..1) for the shade pixels. */
function darken(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `rgb(${r} ${g} ${b})`;
}

type EyeState = {
  open: boolean;
  wide: boolean;
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
};

/** The nav dot's persisted colour — same character, bigger. */
function readAccent(): string {
  try {
    const idx = Number(window.localStorage.getItem(DOT_KEY) ?? "0");
    const color =
      COLOR_ORDER[
        Number.isFinite(idx) && idx >= 0 && idx < COLOR_ORDER.length ? idx : 0
      ];
    return COLOR_HEX[color];
  } catch {
    return COLOR_HEX.tomato;
  }
}

/** Storage events double as cross-tab colour sync. */
function subscribeAccent(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export default function HugoStage({
  pose,
  size = 112,
  onTap,
  ariaLabel = "Hugo",
}: {
  pose: HugoPose;
  size?: number;
  onTap?: () => void;
  ariaLabel?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mood = useHugoState((s) => s.mood);
  const accent = useSyncExternalStore(
    subscribeAccent,
    readAccent,
    () => COLOR_HEX.tomato,
  );
  const reducedRef = useRef(false);

  // Mutable render inputs — drawn on demand, no React re-render per frame.
  const eyeRef = useRef<EyeState>({ open: true, wide: false, dx: 0, dy: 0 });
  const bobRef = useRef(0);
  const sparkleRef = useRef(0);
  const poseRef = useRef<HugoPose>(pose);
  const accentRef = useRef(accent);
  const moodRef = useRef(mood);

  // Announce stage presence so the corner/footer dots yield the screen.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("hugoslekstuga:hugo-stage", {
        detail: { present: true },
      }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("hugoslekstuga:hugo-stage", {
          detail: { present: false },
        }),
      );
    };
  }, []);

  // Keep refs in sync for the draw loop.
  useEffect(() => {
    poseRef.current = pose;
    accentRef.current = accent;
    moodRef.current = mood;
    draw();
  });

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const px = Math.max(2, Math.floor(canvas.width / 16));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;

    const p = poseRef.current;
    const body = accentRef.current;
    const shade = darken(accentRef.current, 0.28);
    const bobY =
      reducedRef.current || p === "declining" ? (p === "declining" ? 1 : 0) : bobRef.current;

    // Body
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const c = BODY_ROWS[y][x];
        if (c === ".") continue;
        ctx.fillStyle = c === "X" ? body : shade;
        ctx.fillRect(x * px, (y + bobY) * px, px, px);
      }
    }

    // Eyes — whites 2×3 at (4,5) and (10,5); pupils 1×2 inside.
    const e = eyeRef.current;
    const open = p === "declining" ? false : e.open;
    const eyeTop = 5 + bobY + (e.wide || p === "celebrating" ? -1 : 0);
    const eyeH = e.wide || p === "celebrating" ? 4 : 3;
    for (const ex of [4, 10]) {
      if (!open) {
        ctx.fillStyle = CREAM_HEX;
        ctx.fillRect(ex * px, (7 + bobY) * px, 2 * px, px);
        continue;
      }
      ctx.fillStyle = INK_HEX;
      ctx.fillRect(ex * px, eyeTop * px, 2 * px, eyeH * px);
      ctx.fillStyle = CREAM_HEX;
      const pupilX = ex + (e.dx === -1 ? 0 : e.dx === 1 ? 1 : 0.5);
      const pupilY = eyeTop + 1 + (e.dy === -1 ? -1 : e.dy === 1 ? 1 : 0);
      ctx.fillRect(
        Math.round(pupilX * px),
        Math.max(eyeTop, pupilY) * px,
        px,
        2 * px,
      );
    }

    // Celebration sparkles — four accent pixels orbiting the head.
    if (p === "celebrating") {
      const phase = sparkleRef.current % 2;
      ctx.fillStyle = INK_HEX;
      const spots =
        phase === 0
          ? [
              [2, 1],
              [13, 2],
              [1, 8],
              [14, 7],
            ]
          : [
              [3, 0],
              [12, 0],
              [0, 5],
              [15, 5],
            ];
      for (const [sx, sy] of spots) {
        ctx.fillRect(sx * px, (sy + bobY) * px, px, px);
      }
    }
  }

  // Bob + blink + pose-driven eye behaviour. Interval-driven (no rAF —
  // the sprite is quantized by design); everything stops under
  // prefers-reduced-motion except pose swaps, which draw on demand.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    reducedRef.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    // Integer pixel size for crisp edges; devicePixelRatio-aware.
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const target = Math.floor((size * dpr) / 16) * 16;
    canvas.width = target;
    canvas.height = target;
    draw();

    if (reducedRef.current) return;

    let blinkTid: number | undefined;
    const tick = window.setInterval(
      () => {
        bobRef.current = bobRef.current === 0 ? 1 : 0;
        sparkleRef.current += 1;
        draw();
      },
      moodRef.current === "excited" ? 280 : 520,
    );

    const scheduleBlink = () => {
      const base = moodRef.current === "sleepy" ? 9000 : 3000;
      const spread = moodRef.current === "sleepy" ? 6000 : 5000;
      blinkTid = window.setTimeout(
        () => {
          eyeRef.current.open = false;
          draw();
          blinkTid = window.setTimeout(() => {
            eyeRef.current.open = true;
            draw();
            scheduleBlink();
          }, 120);
        },
        base + Math.random() * spread,
      );
    };
    scheduleBlink();

    return () => {
      window.clearInterval(tick);
      if (blinkTid) window.clearTimeout(blinkTid);
    };
  }, [size]);

  // Pose-directed gaze. "delivering" looks down at the advice for a
  // beat, then straight at you, a touch wide — he wants to know if it
  // landed. "thinking" drifts up-left, the universal remembering look.
  useEffect(() => {
    const e = eyeRef.current;
    let tid: number | undefined;
    if (pose === "thinking") {
      e.dx = -1;
      e.dy = -1;
      e.wide = false;
    } else if (pose === "delivering") {
      e.dx = 0;
      e.dy = 1;
      e.wide = false;
      tid = window.setTimeout(() => {
        e.dx = 0;
        e.dy = 0;
        e.wide = true;
        draw();
      }, 550);
    } else {
      e.dx = 0;
      e.dy = 0;
      e.wide = pose === "celebrating";
    }
    draw();
    return () => {
      if (tid) window.clearTimeout(tid);
    };
  }, [pose]);

  // Idle gaze follows the pointer, coarsely — a quadrant nudge, the
  // pixel version of the nav dot's proximity eyes.
  useEffect(() => {
    const onMove = (ev: PointerEvent) => {
      if (poseRef.current !== "idle") return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const r = canvas.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = ev.clientX - cx;
      const dy = ev.clientY - cy;
      const e = eyeRef.current;
      const next: EyeState = {
        ...e,
        dx: Math.abs(dx) < r.width ? 0 : dx < 0 ? -1 : 1,
        dy: Math.abs(dy) < r.height ? 0 : dy < 0 ? -1 : 1,
      };
      if (next.dx !== e.dx || next.dy !== e.dy) {
        eyeRef.current = next;
        draw();
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={ariaLabel}
      className="group relative inline-flex items-center justify-center rounded-none border-0 bg-transparent p-2 outline-offset-8"
      style={{ cursor: onTap ? "pointer" : "default" }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{
          width: size,
          height: size,
          imageRendering: "pixelated",
          filter: `drop-shadow(0 0 14px ${accent}44) drop-shadow(0 0 36px ${accent}22)`,
        }}
      />
    </button>
  );
}
