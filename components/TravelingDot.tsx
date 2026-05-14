"use client";

import { useEffect, useRef } from "react";

/**
 * The traveling dot — Hugo. Lives at the nav, leaves his post when
 * you click a tool on the homepage swarm, swoops down to fetch the
 * tool, comes back. The new page's header card expands from his
 * landing position as he settles.
 *
 * Mounted once in the root layout. Renders a full-viewport canvas
 * (pointer-events: none, opacity 0 when no journey). rAF loop runs
 * only while Hugo is mid-trip.
 *
 * Events:
 *   - listens for `hugoslekstuga:dot-travel` (fired by ToolMap on
 *     click) with detail { fromX, fromY, toX, toY, color, navColor,
 *     duration } — all positions frozen at click time so the swarm's
 *     physics doesn't yank Hugo's destination mid-flight
 *   - dispatches `hugoslekstuga:hugo-traveling` { traveling: true }
 *     at journey start, `{ traveling: false }` at settle complete.
 *     BrandDot subscribes and hides its nav dot during the trip so
 *     there's only ever one dot on screen
 *   - dispatches `hugoslekstuga:dot-arrived` { x, y } at the start
 *     of the settle phase so ToolFrame can pin its header-card
 *     expansion to Hugo's landing position
 *
 * Honours `prefers-reduced-motion` — when set, doesn't render at
 * all; the route just changes.
 */

type Journey = {
  // The clicked tool's position in viewport coords
  toolX: number;
  toolY: number;
  // The nav dot's position in viewport coords (read at click time)
  navX: number;
  navY: number;
  // The tool's accent colour (Hugo tints toward this during scoop + early return)
  toolColor: string;
  // The user's chosen nav-dot colour (Hugo's "true" colour)
  navColor: string;
  // Total journey duration. 720ms desktop, 560ms mobile.
  duration: number;
  startedAt: number;
  // "fetch" (default) — Hugo flies out, looks down, carries the tool
  // home; ToolMap fires the route push at start-of-return.
  // "nudge" — ambient idle play. Hugo flies out, taps the tool
  // (dispatches dot-nudge-target so the swarm gives the dot a small
  // impulse), flies home. No route push, no looking-down scoop pose.
  mode: "fetch" | "nudge";
  // Slug of the target tool — only needed for "nudge" so the impulse
  // can be addressed by name.
  slug: string | null;
};

// Phase splits as fractions of total duration (desktop 720ms).
//
//   anticipation  0    → 80ms     (11%)
//   outbound      80   → 340ms    (36%)
//   scoop         340  → 400ms    (8%)
//   return        400  → 660ms    (36%)
//   settle        660  → 720ms    (9%)
const PHASE = {
  anticipationEnd: 80 / 720,
  outboundEnd: 340 / 720,
  scoopEnd: 400 / 720,
  returnEnd: 660 / 720,
  // settleEnd is 1.0
};

const DOT_RADIUS_PX = 14;
const ANTICIPATION_LEAN_PX = 4;
const SETTLE_OVERSHOOT_PX = 3;
const STREAK_BUFFER_MS = 120;
const STREAK_HEAD_WIDTH = 6;

export default function TravelingDot() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const journeyRef = useRef<Journey | null>(null);
  const rafRef = useRef<number>(0);
  const reduceMotionRef = useRef(false);
  // Trail history — { x, y, t } samples from the rAF loop. Kept
  // short (~120ms) so the streak is "thin line behind a moving dot",
  // not a comet tail.
  const trailRef = useRef<{ x: number; y: number; t: number }[]>([]);

  // Reduced motion subscription
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceMotionRef.current = mq.matches;
    const listener = (e: MediaQueryListEvent) => {
      reduceMotionRef.current = e.matches;
    };
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  // The rAF loop. Drives every frame of the journey, draws Hugo +
  // the tapered streak + eyes during the scoop pause. Self-cleans
  // when the journey completes. Declared before the travel-event
  // subscription that calls it so the React 19 compiler's "accessed
  // before declared" rule is satisfied.
  const kickRaf = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let arrivedDispatched = false;
    let travelingDoneDispatched = false;
    let nudgeDispatched = false;

    const tick = (now: number) => {
      const j = journeyRef.current;
      if (!j) return;
      const t = Math.min(1, (now - j.startedAt) / j.duration);

      // Nudge contact — at the apex of outbound, dispatch the impulse
      // back to ToolMap so the swarm tool visibly bobs. Fires once per
      // journey, only in "nudge" mode. Impulse direction is the bezier
      // tangent at t = 1 (Hugo's arrival velocity), normalized to a
      // fixed magnitude so the bonk is consistent regardless of how
      // far he flew.
      if (j.mode === "nudge" && !nudgeDispatched && t >= PHASE.outboundEnd) {
        nudgeDispatched = true;
        if (j.slug) {
          const [vx, vy] = velocityAtT(1, j.navX, j.navY, j.toolX, j.toolY);
          const speed = Math.hypot(vx, vy) || 1;
          const IMPULSE_MAG = 8;
          window.dispatchEvent(
            new CustomEvent("hugoslekstuga:dot-nudge-target", {
              detail: {
                slug: j.slug,
                vx: (vx / speed) * IMPULSE_MAG,
                vy: (vy / speed) * IMPULSE_MAG,
              },
            }),
          );
        }
      }

      // Clear the whole canvas each frame. Hugo's movement is fast
      // enough that fade-style "ghost trails" via composite-over
      // alpha-clear feel muddy; we redraw the streak from the trail
      // buffer each frame for crispness.
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      // Resolve current position + state based on phase
      const state = resolveState(t, j);

      // Record the trail sample (only during flight phases, not
      // anticipation/scoop/settle where Hugo barely moves). The
      // pruning cutoff stays at the full STREAK_BUFFER_MS even
      // during non-flight, so when Hugo finishes a flight phase the
      // streak doesn't snap empty — it ages out naturally over the
      // next ~120ms behind him as he comes to rest.
      if (state.inFlight) {
        trailRef.current.push({ x: state.x, y: state.y, t: now });
      }
      const cutoff = now - STREAK_BUFFER_MS;
      while (
        trailRef.current.length > 0 &&
        trailRef.current[0].t < cutoff
      ) {
        trailRef.current.shift();
      }

      // Draw the tapered streak first so the dot renders on top
      drawStreak(ctx, trailRef.current, state.color, now);

      // Draw the dot
      drawHugo(ctx, state);

      // Dispatch dot-arrived once, at the start of settle
      if (!arrivedDispatched && t >= PHASE.returnEnd) {
        arrivedDispatched = true;
        window.dispatchEvent(
          new CustomEvent("hugoslekstuga:dot-arrived", {
            detail: { x: j.navX, y: j.navY },
          }),
        );
      }

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        // Journey complete. Clear the canvas, announce arrival, stop.
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        trailRef.current = [];
        journeyRef.current = null;
        rafRef.current = 0;
        if (!travelingDoneDispatched) {
          travelingDoneDispatched = true;
          window.dispatchEvent(
            new CustomEvent("hugoslekstuga:hugo-traveling", {
              detail: { traveling: false },
            }),
          );
        }
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  };

  // Travel-event subscription. Calls kickRaf (declared above) when a
  // new journey starts. Cleans up any in-flight rAF on unmount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onTravel = (e: Event) => {
      if (reduceMotionRef.current) return;
      const detail = (
        e as CustomEvent<{
          fromX: number;
          fromY: number;
          toX: number;
          toY: number;
          color: string;
          navColor: string;
          duration: number;
          mode?: "fetch" | "nudge";
          slug?: string;
        }>
      ).detail;
      if (!detail) return;

      // Cancel any in-flight journey cleanly — second click trumps first.
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      trailRef.current = [];

      journeyRef.current = {
        // event uses fromX/fromY for the tool position (where Hugo is going TO);
        // toX/toY = the nav position (where Hugo starts FROM and RETURNS TO)
        toolX: detail.fromX,
        toolY: detail.fromY,
        navX: detail.toX,
        navY: detail.toY,
        toolColor: detail.color,
        navColor: detail.navColor,
        duration: detail.duration,
        startedAt: performance.now(),
        mode: detail.mode ?? "fetch",
        slug: detail.slug ?? null,
      };

      // Announce departure so BrandDot hides its nav dot
      window.dispatchEvent(
        new CustomEvent("hugoslekstuga:hugo-traveling", {
          detail: { traveling: true },
        }),
      );

      kickRaf();
    };
    window.addEventListener("hugoslekstuga:dot-travel", onTravel);
    const captureRaf = rafRef;
    return () => {
      window.removeEventListener("hugoslekstuga:dot-travel", onTravel);
      if (captureRaf.current) cancelAnimationFrame(captureRaf.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 50,
      }}
    />
  );
}

/* -------------------------------------------------------------------------
 * Per-frame state computation
 * -----------------------------------------------------------------------*/

type FrameState = {
  x: number;
  y: number;
  // Hugo's current radius (modulated by horizontal-compression at peak velocity)
  rx: number;
  ry: number;
  // Direction vector for compression rotation
  angle: number;
  // Current colour (lerped between nav and tool colours over the trip)
  color: string;
  // Whether to draw eyes
  drawEyes: boolean;
  // Eye offset within the dot — both eyes shift together so Hugo's
  // gaze can point somewhere (downward at the tool during scoop, etc.)
  // Defaults to (0, 0) = neutral forward stare.
  eyeOffsetX: number;
  eyeOffsetY: number;
  // Whether we're currently in one of the two flight phases (drives streak sampling)
  inFlight: boolean;
};

function resolveState(t: number, j: Journey): FrameState {
  const navColor = j.navColor;
  const toolColor = j.toolColor;

  if (t < PHASE.anticipationEnd) {
    // Anticipation lean — Hugo at nav, pulls 4px toward the tool direction
    const local = t / PHASE.anticipationEnd; // 0..1 within phase
    const eased = easeOutCubic(local);
    const lean = eased * ANTICIPATION_LEAN_PX;
    const dx = j.toolX - j.navX;
    const dy = j.toolY - j.navY;
    const dist = Math.hypot(dx, dy) || 1;
    return {
      x: j.navX + (dx / dist) * -lean, // pull AWAY from tool (anticipation)
      y: j.navY + (dy / dist) * -lean,
      rx: DOT_RADIUS_PX,
      ry: DOT_RADIUS_PX,
      angle: 0,
      color: navColor,
      drawEyes: false,
      eyeOffsetX: 0,
      eyeOffsetY: 0,
      inFlight: false,
    };
  }

  if (t < PHASE.outboundEnd) {
    // Outbound flight — bezier arc from nav to tool
    const local =
      (t - PHASE.anticipationEnd) /
      (PHASE.outboundEnd - PHASE.anticipationEnd);
    const eased = easeInOutCubic(local);
    const pt = quadBezierArc(eased, j.navX, j.navY, j.toolX, j.toolY);
    const [vx, vy] = velocityAtT(eased, j.navX, j.navY, j.toolX, j.toolY);
    const speed = Math.hypot(vx, vy);
    // Subtle compression at peak velocity: 1.08 long axis, 0.92 short axis.
    // Speed peak is at eased ~ 0.5; we taper it with a triangle window.
    const peak = 1 - Math.abs(eased - 0.5) * 2; // 0..1..0
    const stretch = 1 + peak * 0.08;
    const squeeze = 1 - peak * 0.08;
    return {
      x: pt.x,
      y: pt.y,
      rx: DOT_RADIUS_PX * stretch,
      ry: DOT_RADIUS_PX * squeeze,
      angle: speed > 0.01 ? Math.atan2(vy, vx) : 0,
      color: navColor,
      drawEyes: false,
      eyeOffsetX: 0,
      eyeOffsetY: 0,
      inFlight: true,
    };
  }

  if (t < PHASE.scoopEnd) {
    // Scoop pause — Hugo at the tool dot, eyes open. In fetch mode he
    // looks down at the thing he's about to carry; in nudge mode he
    // looks forward (he isn't carrying anything, just tapping it).
    const isNudge = j.mode === "nudge";
    return {
      x: j.toolX,
      y: j.toolY,
      rx: DOT_RADIUS_PX,
      ry: DOT_RADIUS_PX,
      angle: 0,
      color: navColor, // hasn't picked up the tint yet — that happens during return
      drawEyes: true,
      eyeOffsetX: 0,
      eyeOffsetY: isNudge ? 0 : DOT_RADIUS_PX * 0.28,
      inFlight: false,
    };
  }

  if (t < PHASE.returnEnd) {
    // Return flight — bezier arc back to nav
    const local =
      (t - PHASE.scoopEnd) / (PHASE.returnEnd - PHASE.scoopEnd);
    const eased = easeInOutCubic(local);
    // Mirror the outbound bezier — same control point math, swap endpoints
    const pt = quadBezierArc(eased, j.toolX, j.toolY, j.navX, j.navY);
    const [vx, vy] = velocityAtT(eased, j.toolX, j.toolY, j.navX, j.navY);
    const speed = Math.hypot(vx, vy);
    const peak = 1 - Math.abs(eased - 0.5) * 2;
    const stretch = 1 + peak * 0.08;
    const squeeze = 1 - peak * 0.08;
    // Tool tint blends back to nav colour over the last 30% of the return
    const tintBlend = local < 0.7 ? 1 : 1 - (local - 0.7) / 0.3;
    const color = lerpColor(navColor, toolColor, tintBlend * 0.55);
    return {
      x: pt.x,
      y: pt.y,
      rx: DOT_RADIUS_PX * stretch,
      ry: DOT_RADIUS_PX * squeeze,
      angle: speed > 0.01 ? Math.atan2(vy, vx) : 0,
      color,
      drawEyes: false,
      eyeOffsetX: 0,
      eyeOffsetY: 0,
      inFlight: true,
    };
  }

  // Settle — Hugo at nav, one small damped overshoot in the direction
  // he was just coming from
  const local = (t - PHASE.returnEnd) / (1 - PHASE.returnEnd);
  // Overshoot is in the direction OPPOSITE to the return-flight velocity
  // (i.e., past the nav slot, then back). Damped sinusoid.
  const overshoot =
    Math.sin(local * Math.PI * 2) * SETTLE_OVERSHOOT_PX * (1 - local);
  const dx = j.navX - j.toolX;
  const dy = j.navY - j.toolY;
  const dist = Math.hypot(dx, dy) || 1;
  return {
    x: j.navX + (dx / dist) * overshoot,
    y: j.navY + (dy / dist) * overshoot,
    rx: DOT_RADIUS_PX,
    ry: DOT_RADIUS_PX,
    angle: 0,
    color: navColor,
    drawEyes: false,
    eyeOffsetX: 0,
    eyeOffsetY: 0,
    inFlight: false,
  };
}

/* -------------------------------------------------------------------------
 * Drawing
 * -----------------------------------------------------------------------*/

function drawHugo(ctx: CanvasRenderingContext2D, s: FrameState) {
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.angle);
  ctx.fillStyle = s.color;
  ctx.beginPath();
  ctx.ellipse(0, 0, s.rx, s.ry, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eyes — drawn only during scoop pause
  if (s.drawEyes) {
    ctx.fillStyle = "#fbf6ee"; // cream
    const eyeR = DOT_RADIUS_PX * 0.22;
    const eyeGap = DOT_RADIUS_PX * 0.32;
    // Rotate back to upright for the eyes (face-forward, regardless of body angle)
    ctx.rotate(-s.angle);
    // Both eyes shift together by eyeOffsetX/eyeOffsetY so Hugo can
    // direct his gaze — e.g. look down at the tool during the scoop.
    const ex = s.eyeOffsetX;
    const ey = s.eyeOffsetY;
    ctx.beginPath();
    ctx.arc(-eyeGap + ex, ey, eyeR, 0, Math.PI * 2);
    ctx.arc(eyeGap + ex, ey, eyeR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawStreak(
  ctx: CanvasRenderingContext2D,
  trail: { x: number; y: number; t: number }[],
  color: string,
  now: number,
) {
  if (trail.length < 2) return;

  // Draw the streak as a series of overlapping segments. Each segment
  // is stroked with line-width and alpha tapering by age. Result: a
  // thin line behind the dot that fades into nothing.
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;

  for (let i = trail.length - 1; i > 0; i--) {
    const head = trail[i];
    const prev = trail[i - 1];
    const age = (now - head.t) / STREAK_BUFFER_MS; // 0 = just now, 1 = oldest in buffer
    const alpha = Math.max(0, 1 - age) * 0.85;
    const width = Math.max(0.6, STREAK_HEAD_WIDTH * (1 - age));
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(head.x, head.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/* -------------------------------------------------------------------------
 * Quadratic-bezier path with a downward-biased perpendicular offset
 * -----------------------------------------------------------------------*/

function controlPoint(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { x: number; y: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.hypot(dx, dy) || 1;
  // Perpendicular offset (rotates the direction vector 90° clockwise)
  // Magnitude = 18% of distance. Plus a downward bias of 10% of distance
  // so the arc bows toward gravity — Hugo dips down to fetch.
  const perpX = -dy * 0.18;
  const perpY = dx * 0.18 + dist * 0.1;
  return {
    x: (ax + bx) / 2 + perpX,
    y: (ay + by) / 2 + perpY,
  };
}

function quadBezierArc(
  t: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { x: number; y: number } {
  const cp = controlPoint(ax, ay, bx, by);
  const u = 1 - t;
  return {
    x: u * u * ax + 2 * u * t * cp.x + t * t * bx,
    y: u * u * ay + 2 * u * t * cp.y + t * t * by,
  };
}

function velocityAtT(
  t: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): [number, number] {
  // dP/dt for quadratic bezier
  const cp = controlPoint(ax, ay, bx, by);
  const u = 1 - t;
  return [
    2 * u * (cp.x - ax) + 2 * t * (bx - cp.x),
    2 * u * (cp.y - ay) + 2 * t * (by - cp.y),
  ];
}

/* -------------------------------------------------------------------------
 * Easing + color helpers
 * -----------------------------------------------------------------------*/

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Lerp two colours in RGB space. Accepts #rrggbb or rgb(...) inputs. */
function lerpColor(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return a;
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function parseColor(c: string): [number, number, number] | null {
  if (!c) return null;
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    if (hex.length === 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
      ];
    }
  }
  const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
  }
  return null;
}
