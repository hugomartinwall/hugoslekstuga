"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { COLOR_HEX } from "@/lib/colors";
import { useHugoState } from "@/lib/hugo-state";
import {
  DEFAULT_EYE_STATE,
  drawHugoSprite,
  readAccent,
  spriteCanvasSize,
  subscribeAccent,
  withAlpha,
  type EyeState,
} from "@/lib/hugo/sprite";

/**
 * Stage Hugo — the character at full size, drawn from the shared
 * sprite (lib/hugo/sprite.ts) so he is pixel-identical to the corner
 * dot and the flight renderer, just bigger.
 *
 * Where a page mounts a stage, the corner BrandDot yields (via the
 * `hugoslekstuga:hugo-stage` event) so there's one Hugo on screen at
 * a time. The Advice page is his home; other pages may host him later.
 *
 * Mood (from lib/hugo-state) shapes blink cadence and bob speed; the
 * `pose` prop lets the host page direct him (thinking before an advice
 * draw, delivering after, declining when over-asked).
 */

export type HugoPose =
  | "idle"
  | "thinking"
  | "delivering"
  | "declining"
  | "celebrating";

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
  const eyeRef = useRef<EyeState>({ ...DEFAULT_EYE_STATE });
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

    const px = Math.max(1, Math.floor(canvas.width / 16));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;

    const p = poseRef.current;
    const e = eyeRef.current;
    drawHugoSprite(ctx, {
      x: canvas.width / 2,
      y: canvas.height / 2,
      px,
      accent: accentRef.current,
      eye: {
        ...e,
        open: p === "declining" ? false : e.open,
        wide: e.wide || p === "celebrating",
      },
      // A little shuffle when he hands the line over.
      feet: p === "delivering" ? ((bobRef.current % 2) as 0 | 1) : null,
      bobY:
        reducedRef.current || p === "declining"
          ? p === "declining"
            ? 1
            : 0
          : bobRef.current,
      sparklePhase: p === "celebrating" ? sparkleRef.current : null,
    });
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
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const target = spriteCanvasSize(size, dpr);
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
          filter: `drop-shadow(0 0 14px ${withAlpha(accent, 0.27)}) drop-shadow(0 0 36px ${withAlpha(accent, 0.13)})`,
        }}
      />
    </button>
  );
}
