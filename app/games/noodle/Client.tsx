"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";
import { clamp } from "@/lib/math";
import {
  BOOST_SPEED,
  HEAD_RADIUS,
  HEAD_SPEED,
  INITIAL_LENGTH,
  SEGMENT_GAP,
  SEGMENT_RADIUS,
  WORLD_SIZE,
  radiusMultiplierFor,
  turnRateFor,
  viewportHalfFor,
  type ClientMsg,
  type FoodView,
  type LeaderboardEntry,
  type ServerMsg,
  type SnakeView,
} from "@/lib/noodle/protocol";

/* ------------------------------------------------------------------ */
/* Types + constants                                                   */
/* ------------------------------------------------------------------ */

type Phase = "lobby" | "connecting" | "playing" | "dead" | "disconnected";

type Snapshot = {
  receivedAt: number;
  you: {
    head: { x: number; y: number } | null;
    segments: { x: number; y: number }[];
    length: number;
    alive: boolean;
    boosting: boolean;
    protUntil: number;
  };
  snakes: SnakeView[];
  food: FoodView[];
  leaderboard: LeaderboardEntry[];
};

type Self = { id: string; color: string; name: string };

/** A short-lived spark in world coordinates. Used for eat anims and
 *  other-snake death bursts. Ticked from drawScene with the same dt
 *  as the local self prediction. */
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  /** Total lifespan, ms. */
  max: number;
  /** Remaining lifespan, ms. */
  life: number;
  /** Visual radius in world units. */
  r: number;
};

/** Locally-predicted state of the player's own snake. Updated every
 *  render frame from the same physics rules the server uses, so input
 *  feels zero-latency. The server is still authoritative for length,
 *  alive, and reconciling drift — corrections are blended in over a
 *  few snapshots so the player never sees a snap. */
type LocalSelf = {
  head: { x: number; y: number };
  /** Heading angle (radians, atan2 convention). */
  heading: number;
  length: number;
  /** Recent head positions, head first — same shape as the server's
   *  trail buffer. The body is sampled at SEGMENT_GAP intervals along
   *  this when rendering. */
  trail: { x: number; y: number }[];
  alive: boolean;
  boosting: boolean;
  /** Last frame's wall-clock timestamp; per-frame dt comes from
   *  performance.now() - lastFrameAt. */
  lastFrameAt: number;
};

const WS_BASE = process.env.NEXT_PUBLIC_MUNCH_WS_URL ?? "ws://localhost:8080";
const WS_URL = `${WS_BASE.replace(/\/+$/, "")}/noodle`;
const NAME_KEY = "hugoslekstuga:noodle:name";
/** ms to lerp between two snapshots — matches the server's ~33ms snapshot
 *  cadence (SNAPSHOT_HZ = 30). Other snakes are interpolated. We allow
 *  extrapolation slightly past 1.0 so a late snapshot doesn't freeze
 *  the world — see EXTRAP_LIMIT below. */
const SNAP_GAP = 33;
/** How many snapshots we shift the rendering forward for non-self
 *  snakes. Default Valve-style interp would render at "1 snap behind"
 *  for smoothness — fine on a wide camera, but with the close camera
 *  introduced in phase 7 that ~33 ms lag was visible. Adding 1 snap
 *  to the t base means we render at cur (no built-in lag) and
 *  extrapolate forward when the next snap is late. */
const INTERP_LEAD = 1;
/** Maximum t value when interpolating + extrapolating. With INTERP_LEAD
 *  = 1 and this = 1.5, we render between cur (t=1) and ~0.5 snaps past
 *  cur (t=1.5). Lowered from 2.2 so remote snakes overshoot less when
 *  snapshots arrive late under multi-player load — the visible
 *  trade-off is bots feel ~16ms less snappy, gained in exchange for no
 *  jerky snap-back. */
const EXTRAP_LIMIT = 1.5;
/** Trail buffer cap for the local self. Long enough for any plausible
 *  snake length at boost speed. Same value the server uses. */
const LOCAL_TRAIL_MAX = 1200;
/** Per-snapshot drift below which we blend the local head toward the
 *  server head (smooth correction). Above this, we snap (means the
 *  server killed/teleported us — no point pretending). */
const RECONCILE_SNAP_DIST = 120;
/** How much of the server-vs-local drift we close per snapshot. 0.08
 *  = 8% per snapshot ≈ converges over ~10 snapshots (~330ms). Smooth
 *  enough that a player never sees a correction. */
const RECONCILE_BLEND = 0.08;
/** Eat-pulse: own head briefly scales up on growing. ms is the total
 *  window; PEAK is the multiplier at the apex (half-window). */
const HEAD_PULSE_MS = 130;
const HEAD_PULSE_PEAK = 1.18;
/** Own-death camera + flash window — quick zoom-in + fade. */
const DEATH_FLASH_MS = 380;
const DEATH_ZOOM_MAX = 1.4;
/** Fixed-size pool for particle bursts AND boost trails. Roomy
 *  enough that a chaotic moment (several deaths + a few boosters)
 *  doesn't starve the trails. */
const PARTICLE_BUDGET = 380;
/** Per-snake-per-second boost-trail emission rate. Frame-rate
 *  independent: at 60 fps that's ~0.7 particles per frame, so
 *  ~half the frames spawn one. Visible without flooding. */
const BOOST_TRAIL_RATE = 42;
/** A disappeared snake's last head must sit within this fraction of
 *  the local viewport half-extent for us to treat it as a death
 *  (vs walked off the side). 0.78 catches deep kills, ignores
 *  edge-walkers. */
const DEATH_VIEW_INSET = 0.78;
/** Half-life (seconds) for the viewport-length ease. ~0.45 means a
 *  pellet's worth of zoom-out resolves over roughly half a second —
 *  visible enough to feel like growth, gentle enough to not jolt. */
const ZOOM_HALF_LIFE = 0.45;
/** Threshold for snapping viewLength instead of easing. Pellet eats
 *  produce +1..+3 length, kills add many. Above this, we snap so a
 *  respawn or a big kill doesn't drag a stale zoom across seconds. */
const ZOOM_SNAP_DELTA = 18;
/** While boosting, the viewport quietly widens by this factor —
 *  speed feels faster when the world breathes out a bit. */
const BOOST_ZOOM_OUT = 1.12;
const BOOST_ZOOM_HALF_LIFE = 0.22;

/* ---- dark-world palette ---- */

/** Game canvas background. A deep ink-derived navy — close to the
 *  brand's warm ink (#1a1812) but cooler, so the colorful snakes
 *  read as lit objects against a night sky. */
const BG_COLOR = "#15131c";
/** Faint cream alpha for the dotted "garden" texture so the world
 *  has presence without competing with anything. */
const BG_DOT_COLOR = "rgba(251, 246, 238, 0.06)";
/** Cream-soft tint for the world border. Visible enough to read
 *  "edge of the world" without dominating the frame. */
const BORDER_COLOR = "rgba(251, 246, 238, 0.32)";
/** Each snake's outline is rendered as the body colour darkened by
 *  this fraction — a soft inset rim that lets the body read as a
 *  lit bead against the dark, rather than a hard black-outlined
 *  cartoon shape. */
const OUTLINE_DARKEN = 0.38;
/** Glow halo behind each food pellet. Multiplier on radius and the
 *  alpha for the fill pass. Replaces slither's additive glow with
 *  something close enough on plain canvas. */
const FOOD_GLOW_SCALE = 2.4;
const FOOD_GLOW_ALPHA = 0.32;

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function NoodleClient() {
  const tool = findTool("noodle");
  const [name, setName] = useLocalStorageState<string>(NAME_KEY, "");
  const [phase, setPhase] = useState<Phase>("lobby");
  const [error, setError] = useState<string>("");
  const [deadInfo, setDeadInfo] = useState<{ length: number; killer: string | null } | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [myLength, setMyLength] = useState<number>(8);
  const [copied, setCopied] = useState(false);
  // Live RTT in ms, updated each snapshot from the server's `tEcho`
  // echo of our latest input timestamp. Only rendered when
  // `?debug=1` is in the URL — the overlay is opt-in, no perf cost
  // for normal users.
  const [rtt, setRtt] = useState<number | null>(null);
  // `?debug=1` toggles the RTT overlay + any future in-game telemetry.
  // Computed once at mount; URL changes mid-session don't flip it.
  const isDebug = useState<boolean>(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("debug"),
  )[0];

  // Mutable game state — refs so the render loop doesn't trigger re-renders.
  const wsRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prevSnapRef = useRef<Snapshot | null>(null);
  const curSnapRef = useRef<Snapshot | null>(null);
  /** Locally-predicted own snake — initialised on first state with
   *  head data, advanced every render frame, reconciled on each
   *  state message. The render uses this for self instead of the
   *  server-sent segments so input is zero-latency. */
  const localSelfRef = useRef<LocalSelf | null>(null);
  /** Aim direction (unit vector). Mouse → head vector. The server
   *  normalises so raw delta also works. */
  const aimRef = useRef<{ x: number; y: number }>({ x: 0, y: -1 });
  const boostRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const intentRef = useRef<"connected" | "leaving">("connected");
  const selfRef = useRef<Self | null>(null);
  /** Active steering pointer id (touch only) — second finger or stray
   *  click can't hijack the aim. */
  const steeringPointerIdRef = useRef<number | null>(null);
  /** One auto-reconnect on unexpected close before showing the
   *  disconnected screen. */
  const retriedRef = useRef(false);
  const connectRef = useRef<((name: string) => void) | null>(null);
  /** Wall-clock of the last eat — drives the head pulse. 0 = no
   *  pulse active. */
  const eatAtRef = useRef<number>(0);
  /** Wall-clock of own death — drives the zoom + flash overlay. */
  const deathAtRef = useRef<number>(0);
  /** Live particles, ticked + rendered per frame. */
  const particlesRef = useRef<Particle[]>([]);
  /** Last-seen head position per other-snake id. Used to spawn a
   *  burst when a snake disappears from snapshots while still inside
   *  the viewport. */
  const otherHeadRef = useRef<Map<string, { x: number; y: number; color: string }>>(
    new Map(),
  );
  /** Last `myLength` so we can detect growth (eat) without depending
   *  on the throttled myLength state update. */
  const lastMyLengthRef = useRef<number>(INITIAL_LENGTH);
  /** performance.now() at the last frame, so we can tick particles
   *  with a real dt regardless of frame cadence. */
  const lastDrawAtRef = useRef<number>(0);
  /** Eased copy of `you.length` for viewport sizing. Lerps toward the
   *  real length so eating a pellet zooms out a hair instead of
   *  snapping. Snaps on big jumps (respawn, reconnect) where lerping
   *  would feel like the camera "remembers" a dead snake. */
  const viewLengthRef = useRef<number>(INITIAL_LENGTH);
  /** Eased boost-zoom factor. 1 = not boosting, BOOST_ZOOM_OUT while
   *  boosting. Lerps with a short half-life so the world breathes
   *  with the sprint, not snaps. */
  const boostZoomRef = useRef<number>(1);

  /* -------------------- connect / disconnect -------------------- */

  const connect = useCallback((chosenName: string) => {
    setError("");
    setDeadInfo(null);
    setPhase("connecting");
    intentRef.current = "connected";
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    const nobots =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("nobots");

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "join",
          name: chosenName,
          ...(nobots ? { nobots: true } : {}),
        } satisfies ClientMsg),
      );
    };

    ws.onmessage = (e) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === "welcome") {
        selfRef.current = {
          id: msg.playerId,
          color: msg.color,
          name: msg.name,
        };
        retriedRef.current = false;
        setPhase("playing");
      } else if (msg.type === "state") {
        prevSnapRef.current = curSnapRef.current;
        curSnapRef.current = {
          receivedAt: performance.now(),
          you: msg.you,
          snakes: msg.snakes,
          food: msg.food,
          leaderboard: msg.leaderboard,
        };
        // RTT update — server echoed our most recent input's `t` back
        // in `tEcho`. Only setState in debug mode so we don't trigger
        // 30 re-renders per second for normal users.
        if (isDebug && typeof msg.tEcho === "number") {
          setRtt(Date.now() - msg.tEcho);
        }
        setLeaderboard(msg.leaderboard);
        // ---- eat detection (own length grew) ----
        const newLen = Math.floor(msg.you.length);
        if (msg.you.alive && newLen > lastMyLengthRef.current) {
          eatAtRef.current = performance.now();
        }
        lastMyLengthRef.current = newLen;
        setMyLength(newLen);
        // ---- other-snake death detection ----
        // A snake that was visible last frame and isn't this frame
        // either died or walked off-screen. Cull edge-walkers by
        // requiring the last head to sit comfortably inside our own
        // viewport. The rest get a burst at the last seen position.
        if (msg.you.head && msg.you.alive) {
          const aspect =
            canvasRef.current && canvasRef.current.clientHeight > 0
              ? canvasRef.current.clientWidth / canvasRef.current.clientHeight
              : undefined;
          const { hx, hy } = viewportHalfFor(Math.max(8, msg.you.length), aspect);
          const camX = msg.you.head.x;
          const camY = msg.you.head.y;
          const seen = otherHeadRef.current;
          const nextSeen = new Map<string, { x: number; y: number; color: string }>();
          for (const s of msg.snakes) {
            if (s.segments.length === 0) continue;
            nextSeen.set(s.id, {
              x: s.segments[0].x,
              y: s.segments[0].y,
              color: s.color,
            });
          }
          for (const [id, last] of seen) {
            if (nextSeen.has(id)) continue;
            // Disappeared this snapshot.
            const dx = last.x - camX;
            const dy = last.y - camY;
            if (Math.abs(dx) < hx * DEATH_VIEW_INSET && Math.abs(dy) < hy * DEATH_VIEW_INSET) {
              spawnBurst(particlesRef.current, last.x, last.y, last.color);
            }
          }
          otherHeadRef.current = nextSeen;
        }
        // ---- reconcile local self with server truth ----
        if (msg.you.head && msg.you.alive) {
          const local = localSelfRef.current;
          if (!local) {
            // First state with a head — initialise local prediction.
            // Heading derived from the first two segments if available;
            // otherwise default to "up" (server will reconcile).
            const initHeading = headingFromSegments(msg.you.segments) ?? -Math.PI / 2;
            localSelfRef.current = {
              head: { ...msg.you.head },
              heading: initHeading,
              length: msg.you.length,
              trail: msg.you.segments.length > 0
                ? msg.you.segments.map((s) => ({ ...s }))
                : [{ ...msg.you.head }],
              alive: true,
              boosting: msg.you.boosting,
              lastFrameAt: performance.now(),
            };
          } else {
            // Server is authoritative for length + alive.
            local.length = msg.you.length;
            if (!local.alive) {
              // Just respawned — snap to server.
              local.alive = true;
              local.head = { ...msg.you.head };
              local.heading = headingFromSegments(msg.you.segments) ?? local.heading;
              local.trail = msg.you.segments.length > 0
                ? msg.you.segments.map((s) => ({ ...s }))
                : [{ ...msg.you.head }];
            } else {
              // Drift reconciliation. Big drift = snap (server killed,
              // teleported, or we got way out of sync). Small drift =
              // blend, invisible to the player.
              const dx = msg.you.head.x - local.head.x;
              const dy = msg.you.head.y - local.head.y;
              const drift = Math.hypot(dx, dy);
              if (drift > RECONCILE_SNAP_DIST) {
                local.head = { ...msg.you.head };
                local.heading = headingFromSegments(msg.you.segments) ?? local.heading;
                local.trail = msg.you.segments.length > 0
                  ? msg.you.segments.map((s) => ({ ...s }))
                  : [{ ...msg.you.head }];
              } else {
                local.head.x += dx * RECONCILE_BLEND;
                local.head.y += dy * RECONCILE_BLEND;
              }
            }
          }
        } else if (!msg.you.alive && localSelfRef.current) {
          // Server says dead.
          localSelfRef.current.alive = false;
        }
        if (msg.you.alive) {
          setPhase((prev) => (prev === "dead" ? "playing" : prev));
        }
      } else if (msg.type === "dead") {
        deathAtRef.current = performance.now();
        setDeadInfo({ length: msg.finalLength, killer: msg.killer });
        setPhase("dead");
      } else if (msg.type === "error") {
        setError(msg.reason);
        intentRef.current = "leaving";
        ws.close();
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (intentRef.current === "leaving") {
        setPhase("lobby");
        return;
      }
      if (!retriedRef.current) {
        retriedRef.current = true;
        window.setTimeout(() => {
          if (intentRef.current !== "leaving") connectRef.current?.(chosenName);
        }, 1500);
        return;
      }
      setPhase("disconnected");
    };

    ws.onerror = () => {
      const inDev = process.env.NODE_ENV === "development";
      setError(
        inDev
          ? "Couldn't reach the server. Is it running?"
          : "Couldn't reach the server. Try again in a minute.",
      );
    };
  }, [isDebug]);

  // Keep the ref pointing at the current connect closure so onclose
  // retry can reach it.
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const disconnect = useCallback(() => {
    intentRef.current = "leaving";
    if (wsRef.current) {
      wsRef.current.close();
    }
    setPhase("lobby");
    setDeadInfo(null);
    prevSnapRef.current = null;
    curSnapRef.current = null;
    localSelfRef.current = null;
    retriedRef.current = false;
    eatAtRef.current = 0;
    deathAtRef.current = 0;
    particlesRef.current = [];
    otherHeadRef.current.clear();
    lastMyLengthRef.current = INITIAL_LENGTH;
    viewLengthRef.current = INITIAL_LENGTH;
    boostZoomRef.current = 1;
  }, []);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  /* -------------------- input ----------------------------------- */

  // Track Space for boost; Esc to leave.
  useEffect(() => {
    if (phase !== "playing" && phase !== "dead") return;
    const onDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        disconnect();
        return;
      }
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        boostRef.current = true;
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        boostRef.current = false;
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [phase, disconnect]);

  // Lock body scroll while in-game.
  useEffect(() => {
    if (phase !== "playing" && phase !== "dead") return;
    const prevHtml = document.documentElement.style.overflow;
    const prevBody = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
    };
  }, [phase]);

  // Send input ~30Hz.
  useEffect(() => {
    if (phase !== "playing" && phase !== "dead") return;
    const id = window.setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const aim = aimRef.current;
      const canvas = canvasRef.current;
      let aspect: number | undefined;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          aspect = rect.width / rect.height;
        }
      }
      const msg: ClientMsg = {
        type: "input",
        aim: { x: aim.x, y: aim.y },
        boost: boostRef.current,
        ...(aspect !== undefined ? { aspect } : {}),
        // Stamp client time so the server's `tEcho` lets us compute RTT.
        // Pure telemetry; server ignores it for gameplay.
        t: Date.now(),
      };
      ws.send(JSON.stringify(msg));
    }, 33);
    return () => window.clearInterval(id);
  }, [phase]);

  /* -------------------- render loop ----------------------------- */

  useEffect(() => {
    if (phase !== "playing" && phase !== "dead") return;
    const draw = () => {
      const canvas = canvasRef.current;
      const now = performance.now();
      // Advance the locally-predicted self snake before drawing so
      // the rendered head reflects the player's most recent input.
      if (localSelfRef.current) {
        advanceLocalSelf(localSelfRef.current, aimRef.current, boostRef.current);
      }
      // Tick particles (eat anims, death bursts) with real dt.
      const dt =
        lastDrawAtRef.current === 0
          ? 0
          : Math.min(0.05, (now - lastDrawAtRef.current) / 1000);
      lastDrawAtRef.current = now;
      if (dt > 0 && particlesRef.current.length > 0) {
        tickParticles(particlesRef.current, dt);
      }
      // Spit boost-trail particles off every boosting snake's tail.
      // Run after the tick so this frame's particles start fresh.
      if (dt > 0 && curSnapRef.current) {
        spawnBoostTrails(
          particlesRef.current,
          curSnapRef.current,
          selfRef.current,
          localSelfRef.current,
          dt,
        );
      }
      // Smooth the zoom — ease viewLengthRef toward the snake's true
      // length so a single pellet doesn't yank the world. Big deltas
      // (respawn, kill) snap.
      const cur = curSnapRef.current;
      if (cur) {
        const target = Math.max(INITIAL_LENGTH, cur.you.length);
        const diff = target - viewLengthRef.current;
        if (Math.abs(diff) > ZOOM_SNAP_DELTA) {
          viewLengthRef.current = target;
        } else if (dt > 0) {
          const blend = 1 - Math.pow(0.5, dt / ZOOM_HALF_LIFE);
          viewLengthRef.current += diff * blend;
        }
      }
      // Boost zoom — eases out while sprinting, back in when not.
      const targetBoost = localSelfRef.current?.boosting ? BOOST_ZOOM_OUT : 1;
      if (dt > 0) {
        const boostBlend = 1 - Math.pow(0.5, dt / BOOST_ZOOM_HALF_LIFE);
        boostZoomRef.current += (targetBoost - boostZoomRef.current) * boostBlend;
      } else {
        boostZoomRef.current = targetBoost;
      }
      if (canvas) {
        drawScene(
          canvas,
          prevSnapRef.current,
          curSnapRef.current,
          selfRef.current,
          localSelfRef.current,
          particlesRef.current,
          eatAtRef.current,
          deathAtRef.current,
          viewLengthRef.current,
          boostZoomRef.current,
        );
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      lastDrawAtRef.current = 0;
    };
  }, [phase]);

  /* -------------------- canvas auto-size ------------------------ */

  useEffect(() => {
    if (phase !== "playing" && phase !== "dead") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [phase]);

  /* -------------------- canvas pointer handlers ------------------ */

  const updateAimFromPointer = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const dx = x - rect.width / 2;
      const dy = y - rect.height / 2;
      const mag = Math.sqrt(dx * dx + dy * dy);
      if (mag < 4) {
        aimRef.current = { x: 0, y: -1 }; // tiny dead zone, default up
      } else {
        aimRef.current = { x: dx / mag, y: dy / mag };
      }
    },
    [],
  );

  const onCanvasPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.pointerType !== "touch") {
        // Mouse click toggles boost on desktop, in addition to Space.
        boostRef.current = true;
      } else {
        if (steeringPointerIdRef.current !== null) return;
        steeringPointerIdRef.current = e.pointerId;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {}
        updateAimFromPointer(e);
      }
    },
    [updateAimFromPointer],
  );

  const onCanvasPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.pointerType === "touch") {
        if (e.pointerId !== steeringPointerIdRef.current) return;
      }
      updateAimFromPointer(e);
    },
    [updateAimFromPointer],
  );

  const onCanvasPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.pointerType !== "touch") {
        boostRef.current = false;
      } else if (e.pointerId === steeringPointerIdRef.current) {
        steeringPointerIdRef.current = null;
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {}
      }
    },
    [],
  );

  /** Touch-only Boost button (pointerdown) — boost while held. */
  const onBoostPress = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    boostRef.current = true;
  }, []);
  const onBoostRelease = useCallback(() => {
    boostRef.current = false;
  }, []);

  /* -------------------- handlers --------------------------------- */

  const onSubmitLobby = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = (name ?? "").trim().slice(0, 16);
    const final = trimmed === "" ? `anon-${Math.floor(Math.random() * 9999)}` : trimmed;
    setName(final);
    connect(final);
  };

  const respawn = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connect(name);
      return;
    }
    ws.send(JSON.stringify({ type: "respawn" } satisfies ClientMsg));
    setPhase("playing");
    setDeadInfo(null);
    deathAtRef.current = 0;
    eatAtRef.current = 0;
    lastMyLengthRef.current = INITIAL_LENGTH;
  }, [connect, name]);

  const shareScore = useCallback(async () => {
    if (!deadInfo) return;
    const text = `I grew to ${deadInfo.length} on hugoslekstuga.com/games/noodle — beat me?`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignored
    }
  }, [deadInfo]);

  /* -------------------- render ----------------------------------- */

  if (phase === "playing" || phase === "dead") {
    return (
      <div
        className="fixed inset-0 z-50 flex select-none flex-col"
        style={{ backgroundColor: BG_COLOR }}
      >
        <canvas
          ref={canvasRef}
          className="block h-full w-full"
          style={{
            backgroundColor: BG_COLOR,
            touchAction: "none",
            WebkitUserSelect: "none",
            WebkitTouchCallout: "none",
          }}
          tabIndex={0}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onPointerCancel={onCanvasPointerUp}
        />
        <Hud
          entries={leaderboard}
          myLength={myLength}
          onLeave={disconnect}
        />
        {phase === "playing" && (
          <BoostButton onPress={onBoostPress} onRelease={onBoostRelease} />
        )}
        {phase === "dead" && deadInfo && (
          <DeadOverlay
            length={deadInfo.length}
            killer={deadInfo.killer}
            onRespawn={respawn}
            onShare={shareScore}
            onLeave={disconnect}
            copied={copied}
          />
        )}
        {isDebug && (
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-3 left-3 rounded bg-ink/80 px-2 py-1 font-mono text-[11px] text-cream"
          >
            rtt {rtt == null ? "—" : `${rtt}ms`}
          </div>
        )}
      </div>
    );
  }

  return tool ? (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-4">
        {phase === "lobby" && (
          <Lobby
            name={name}
            setName={setName}
            error={error}
            onSubmit={onSubmitLobby}
          />
        )}
        {phase === "connecting" && (
          <p className="card-chunk rounded-[var(--radius-card)] bg-cream p-6 text-center font-display text-lg font-bold">
            …connecting to the noodle…
          </p>
        )}
        {phase === "disconnected" && (
          <div className="card-chunk flex flex-col items-center gap-3 rounded-[var(--radius-card)] bg-tomato-soft p-6 text-center">
            <p className="font-display text-xl font-extrabold">Disconnected</p>
            {error && <p className="text-sm text-ink-soft">{error}</p>}
            <button
              type="button"
              onClick={() => setPhase("lobby")}
              className="btn-chunk rounded-[var(--radius-button)] bg-tomato px-5 py-2 font-display text-sm font-extrabold text-cream"
            >
              Back to lobby
            </button>
          </div>
        )}
      </div>
    </ToolFrame>
  ) : (
    <div className="mx-auto w-full max-w-3xl px-5 py-14">
      {phase === "lobby" && (
        <Lobby
          name={name}
          setName={setName}
          error={error}
          onSubmit={onSubmitLobby}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lobby                                                                */
/* ------------------------------------------------------------------ */

function Lobby({
  name,
  setName,
  error,
  onSubmit,
}: {
  name: string;
  setName: (s: string) => void;
  error: string;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="card-chunk flex flex-col gap-4 rounded-[var(--radius-card)] bg-cream p-6"
    >
      <p className="font-display text-2xl font-extrabold">Eat dots. Don&rsquo;t get bumped.</p>
      <p className="text-sm text-ink-soft">
        You&rsquo;re a snake. Aim with the mouse (or drag a finger). Eat
        dots to grow. Touch another snake&rsquo;s body — or a wall —
        and you&rsquo;re done. Hold <Kbd>Space</Kbd> (or the Boost
        button on phones) to sprint — costs a little length, drops
        the rest as crumbs.
      </p>
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-semibold uppercase tracking-wide text-ink-muted">
          Your name
        </span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="anon-3792"
          maxLength={16}
          className="card-chunk rounded-[var(--radius-card)] bg-cream-deep px-4 py-2 font-display text-lg font-bold focus:outline-none"
          autoFocus
        />
      </label>
      <button
        type="submit"
        className="btn-chunk self-start rounded-[var(--radius-button)] bg-green px-6 py-3 font-display text-base font-extrabold text-cream"
      >
        Wiggle in
      </button>
      {error && (
        <p className="rounded-[var(--radius-card)] border-2 border-tomato bg-tomato-soft p-3 text-sm font-medium">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-1 text-xs text-ink-muted">
        <p>
          Desktop: aim with the <span className="font-bold text-ink">mouse</span>,
          hold <Kbd>Space</Kbd> or <Kbd>click</Kbd> to boost.
        </p>
        <p>
          Phone: drag your thumb anywhere on the map to aim, hold the{" "}
          <span className="font-bold text-green">Boost</span> button to
          sprint.
        </p>
        <p>
          Spawn protection is brief; it lifts on first boost.
        </p>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* HUD (leaderboard + length pill + leave)                             */
/* ------------------------------------------------------------------ */

function Hud({
  entries,
  myLength,
  onLeave,
}: {
  entries: LeaderboardEntry[];
  myLength: number;
  onLeave: () => void;
}) {
  return (
    <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-2">
      <div className="pointer-events-auto card-chunk min-w-[160px] rounded-[var(--radius-card)] bg-cream/95 p-2 text-xs">
        <p className="mb-1 font-semibold uppercase tracking-wide text-ink-muted">
          Top
        </p>
        <ol className="flex flex-col gap-0.5">
          {entries.map((e, i) => (
            <li key={e.id} className="flex items-baseline justify-between gap-2">
              <span className="truncate font-bold">
                {i + 1}. {e.name}
              </span>
              <span className="font-mono tabular-nums text-ink-muted">
                {e.length}
              </span>
            </li>
          ))}
          {entries.length === 0 && (
            <li className="text-ink-muted">no one yet</li>
          )}
        </ol>
      </div>
      <div className="pointer-events-auto rounded-full border-2 border-ink bg-cream px-3 py-1 font-mono text-xs">
        you: <span className="font-bold tabular-nums">{myLength}</span>
      </div>
      <button
        type="button"
        onClick={onLeave}
        className="pointer-events-auto rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors hover:bg-tomato-soft"
      >
        Leave
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Boost button (touch)                                                 */
/* ------------------------------------------------------------------ */

function BoostButton({
  onPress,
  onRelease,
}: {
  onPress: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onRelease: () => void;
}) {
  return (
    <button
      type="button"
      aria-label="Boost"
      onPointerDown={onPress}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
      onPointerLeave={onRelease}
      style={{
        touchAction: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
      }}
      className="btn-chunk absolute bottom-6 right-6 flex h-20 w-20 select-none items-center justify-center rounded-full bg-green font-display text-base font-extrabold uppercase tracking-wide text-cream sm:bottom-8 sm:right-8"
    >
      Boost
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Dead overlay                                                         */
/* ------------------------------------------------------------------ */

function DeadOverlay({
  length,
  killer,
  onRespawn,
  onShare,
  onLeave,
  copied,
}: {
  length: number;
  killer: string | null;
  onRespawn: () => void;
  onShare: () => void;
  onLeave: () => void;
  copied: boolean;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-ink/70 p-4">
      <div className="card-chunk flex max-w-md flex-col items-center gap-3 rounded-[var(--radius-card)] bg-cream p-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Bumped{killer ? ` by ${killer}` : ""}
        </p>
        <p className="font-display text-5xl font-extrabold tabular-nums">
          {length}
        </p>
        <p className="text-sm text-ink-soft">final length</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onRespawn}
            className="btn-chunk rounded-[var(--radius-button)] bg-green px-5 py-2 font-display text-sm font-extrabold text-cream"
          >
            Wiggle again
          </button>
          <button
            type="button"
            onClick={onShare}
            className="rounded-full border-2 border-ink bg-cream px-4 py-2 text-sm font-bold transition-colors hover:bg-green-soft"
          >
            {copied ? "Copied" : "Share score"}
          </button>
          <button
            type="button"
            onClick={onLeave}
            className="rounded-full border-2 border-ink bg-cream px-4 py-2 text-sm font-bold transition-colors hover:bg-cream-deep"
          >
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Misc                                                                 */
/* ------------------------------------------------------------------ */

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-ink-muted bg-cream-deep px-1.5 py-0.5 font-mono text-[11px] uppercase">
      {children}
    </kbd>
  );
}

/* ------------------------------------------------------------------ */
/* Canvas drawing                                                       */
/* ------------------------------------------------------------------ */

function drawScene(
  canvas: HTMLCanvasElement,
  prev: Snapshot | null,
  cur: Snapshot | null,
  self: Self | null,
  localSelf: LocalSelf | null,
  particles: Particle[],
  eatAt: number,
  deathAt: number,
  viewLength: number,
  boostZoom: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, w, h);

  if (!cur) return;

  // Snapshot interpolation factor for OTHER snakes. Shifted by
  // INTERP_LEAD so we render at cur (not at the lagged prev) and
  // extrapolate forward up to EXTRAP_LIMIT when snaps are late.
  // Reduces the visible "bot is slow to respond" delay introduced
  // by the closer camera.
  const now = performance.now();
  const tOther = prev
    ? Math.max(
        0,
        Math.min(EXTRAP_LIMIT, (now - cur.receivedAt) / SNAP_GAP + INTERP_LEAD),
      )
    : 1;

  // Camera centred on own head. With local prediction, the camera
  // tracks the locally-simulated head — feels zero-latency.
  const myHead = localSelf?.alive
    ? localSelf.head
    : cur.you.head ?? { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
  const myCx = myHead.x;
  const myCy = myHead.y;

  // Viewport. Sized from the eased viewLength so per-pellet growth
  // doesn't jolt the camera. Death zoom shrinks the effective half-
  // extents (zoom in) for a brief moment after own death; boostZoom
  // widens them slightly while sprinting.
  const aspect = w > 0 && h > 0 ? w / h : undefined;
  const { hx, hy } = viewportHalfFor(viewLength, aspect);
  const deathZoom = computeDeathZoom(deathAt, now);
  const ehx = (hx / deathZoom) * boostZoom;
  const ehy = (hy / deathZoom) * boostZoom;
  const scale = Math.min(w / (2 * ehx), h / (2 * ehy));

  const toScreen = (wx: number, wy: number) => ({
    sx: (wx - myCx) * scale + w / 2,
    sy: (wy - myCy) * scale + h / 2,
  });

  // World — dotted "garden" texture. Distinct from munch's plain
  // line grid so noodle reads as a different sandbox at a glance.
  drawDottedBackground(ctx, w, h, myCx, myCy, scale, toScreen);

  // World bounds — a soft cream rectangle that just barely reads.
  // On the dark world a chunky ink stroke would vanish; the walls
  // earn their menace from the death rule, not the line weight.
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = 3;
  const tl = toScreen(0, 0);
  const br = toScreen(WORLD_SIZE, WORLD_SIZE);
  ctx.strokeRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);

  // Food. Two visual languages: regular pellets are colored circles
  // (same as munch), death-drop food is a colored rounded square so
  // a "feast" reads as something different from natural pellets.
  // Regular pellets are batched by colour into one path per group so
  // the canvas pipeline sees a handful of fills per frame instead of
  // ~50. Each colour group is drawn in three passes: glow halo →
  // solid pellet → bright core, so each pellet reads as a small lit
  // object against the dark world.
  const pelletGroups = new Map<string, { sx: number; sy: number; r: number }[]>();
  const deathDrops: { sx: number; sy: number; r: number; color: string }[] = [];
  for (const f of cur.food) {
    const { sx, sy } = toScreen(f.x, f.y);
    if (sx < -40 || sx > w + 40 || sy < -40 || sy > h + 40) continue;
    const r = Math.max(2, f.r * scale);
    if (f.r > 7) {
      deathDrops.push({ sx, sy, r, color: f.color });
    } else {
      let arr = pelletGroups.get(f.color);
      if (!arr) {
        arr = [];
        pelletGroups.set(f.color, arr);
      }
      arr.push({ sx, sy, r });
    }
  }
  // Pass 1 — soft glow halo for every regular pellet.
  ctx.globalAlpha = FOOD_GLOW_ALPHA;
  for (const [color, arr] of pelletGroups) {
    ctx.beginPath();
    for (const p of arr) {
      const gr = p.r * FOOD_GLOW_SCALE;
      ctx.moveTo(p.sx + gr, p.sy);
      ctx.arc(p.sx, p.sy, gr, 0, Math.PI * 2);
    }
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Pass 2 — solid pellet.
  for (const [color, arr] of pelletGroups) {
    ctx.beginPath();
    for (const p of arr) {
      ctx.moveTo(p.sx + p.r, p.sy);
      ctx.arc(p.sx, p.sy, p.r, 0, Math.PI * 2);
    }
    ctx.fillStyle = color;
    ctx.fill();
  }
  // Pass 3 — tiny cream core for the "lit pellet" look. Batched into
  // a single path since the core colour is the same regardless of
  // pellet colour.
  if (pelletGroups.size > 0) {
    ctx.beginPath();
    for (const arr of pelletGroups.values()) {
      for (const p of arr) {
        const cr = Math.max(1, p.r * 0.35);
        ctx.moveTo(p.sx + cr, p.sy);
        ctx.arc(p.sx, p.sy, cr, 0, Math.PI * 2);
      }
    }
    ctx.fillStyle = "rgba(251, 246, 238, 0.55)";
    ctx.fill();
  }
  // Death-drop food: same halo treatment plus the rounded-square
  // body so a feast is still visually distinct from natural pellets.
  if (deathDrops.length > 0) {
    ctx.globalAlpha = FOOD_GLOW_ALPHA;
    for (const d of deathDrops) {
      const gr = d.r * FOOD_GLOW_SCALE;
      ctx.beginPath();
      ctx.arc(d.sx, d.sy, gr, 0, Math.PI * 2);
      ctx.fillStyle = d.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const d of deathDrops) {
      drawRoundedSquare(ctx, d.sx, d.sy, d.r * 1.7, d.r * 0.4, d.color);
    }
  }

  // Build prev-snake map for interpolation.
  const prevSnakeMap = new Map<string, SnakeView>();
  if (prev) for (const s of prev.snakes) prevSnakeMap.set(s.id, s);

  // Other snakes (under self so own body draws on top of overlapping
  // strangers — useful for legibility during close encounters).
  for (const s of cur.snakes) {
    const prevS = prevSnakeMap.get(s.id);
    drawSnake(
      ctx,
      s.segments,
      prevS?.segments,
      tOther,
      toScreen,
      scale,
      s.color,
      s.prot,
      s.boosting,
      s.name,
      s.id,
      1, // no eat-pulse for others
      s.totalLength,
    );
  }

  // Self snake — drawn from LOCAL state. The local trail is updated
  // every frame, so the rendered worm tracks the player's input with
  // no perceived latency. The body is sampled from the local trail
  // at SEGMENT_GAP intervals (same algorithm as the server).
  if (self && localSelf && localSelf.alive) {
    const segments = sampleBodyFromTrail(localSelf.trail, localSelf.length);
    const pulse = computeHeadPulse(eatAt, now);
    drawSnake(
      ctx,
      segments,
      undefined, // no interpolation needed; local is already smooth
      1,
      toScreen,
      scale,
      self.color,
      cur.you.protUntil > Date.now(),
      localSelf.boosting,
      null, // no label for self
      self.id,
      pulse,
      localSelf.length,
    );
  }

  // Particles — eat anims + other-snake death bursts. World-anchored
  // so they scroll with the camera.
  if (particles.length > 0) {
    drawParticles(ctx, particles, toScreen, scale);
  }

  // Minimap — screen-space overlay in the bottom-left. Shows the
  // whole world, top-10 leaderboard positions, your position, and a
  // rectangle for your current viewport so you can read where you
  // are in the world.
  drawMinimap(ctx, w, h, cur, localSelf, self, ehx, ehy);

  // Own-death white flash — drawn in screen space last so it covers
  // everything except the dead UI (which overlays the canvas).
  const flash = computeDeathFlash(deathAt, now);
  if (flash > 0) {
    ctx.fillStyle = `rgba(251, 246, 238, ${flash.toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
  }
}

/* ---- snake rendering ---- */

function drawSnake(
  ctx: CanvasRenderingContext2D,
  segments: { x: number; y: number }[],
  prevSegments: { x: number; y: number }[] | undefined,
  t: number,
  toScreen: (wx: number, wy: number) => { sx: number; sy: number },
  scale: number,
  color: string,
  prot: boolean,
  boosting: boolean,
  label: string | null,
  seed: string,
  headPulseScale: number,
  /** Total length of the snake. Drives the per-snake width
   *  multiplier (radiusMultiplierFor) so longer snakes render
   *  thicker. */
  totalLength: number,
): void {
  if (segments.length === 0) return;
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const interp = (i: number) => {
    const c = segments[i];
    if (!prevSegments || !prevSegments[i]) return c;
    const p = prevSegments[i];
    return { x: lerp(p.x, c.x), y: lerp(p.y, c.y) };
  };

  // Build the screen-space points list, head first.
  const N = segments.length;
  const points: { sx: number; sy: number }[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const w = interp(i);
    const { sx, sy } = toScreen(w.x, w.y);
    points[i] = { sx, sy };
  }

  // Tapered body — each segment is a circle whose radius linearly
  // decreases from HEAD_RADIUS at the head to SEGMENT_RADIUS × 0.6 at
  // the tail. The 0.6 floor (rather than 0.5) keeps adjacent circles
  // overlapping at SEGMENT_GAP=12 so the silhouette never pinches.
  // Walking tail → head and drawing ink shell + colored fill per
  // segment yields a continuous ink outline (the union of shells) and
  // a continuous coloured silhouette (the union of fills). Every third
  // segment fills slightly darker — only the tail-side crescent shows
  // through, reading as subtle scale banding. Both head + tail radius
  // are scaled by the per-length width multiplier so longer snakes
  // look noticeably thicker.
  const widthScale = radiusMultiplierFor(totalLength);
  const headR = HEAD_RADIUS * widthScale * scale;
  const tailR = SEGMENT_RADIUS * 0.6 * widthScale * scale;
  const radiusAt = (i: number): number => {
    const base = N <= 1 ? headR : headR + (tailR - headR) * (i / (N - 1));
    // Only segment 0 (the head) pulses on eat — the rest of the body
    // would jitter visibly if every segment scaled.
    return i === 0 ? base * headPulseScale : base;
  };
  const dark = darkenHex(color, 0.13);
  const rim = darkenHex(color, OUTLINE_DARKEN);
  const shell = Math.max(2, scale * 2);

  // Boost glow — drawn FIRST so the body fills on top and the glow
  // only shows as an aura outside the silhouette. Oversized colored
  // discs at low alpha, batched into one path so the whole worm
  // shares one soft halo in its own colour.
  if (boosting) {
    ctx.globalAlpha = 0.42;
    ctx.beginPath();
    for (let i = N - 1; i >= 0; i--) {
      const p = points[i];
      const r = radiusAt(i);
      if (r < 0.5) continue;
      const glowR = r * 1.85 + shell;
      ctx.moveTo(p.sx + glowR, p.sy);
      ctx.arc(p.sx, p.sy, glowR, 0, Math.PI * 2);
    }
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Pass 1 — all outline shells in a single batched path. Coloured as
  // a darker tint of the body, so on the dark world the snake reads
  // as a lit bead with a soft inset rim rather than a cartoon outline.
  // One fill per snake instead of N.
  ctx.beginPath();
  for (let i = N - 1; i >= 0; i--) {
    const p = points[i];
    const r = radiusAt(i);
    if (r < 0.5) continue;
    const R = r + shell;
    ctx.moveTo(p.sx + R, p.sy);
    ctx.arc(p.sx, p.sy, R, 0, Math.PI * 2);
  }
  ctx.fillStyle = rim;
  ctx.fill();
  // Pass 2 — coloured fills, walked tail → head so each segment's
  // exposed crescent gets the right shade. Banding lives here; this
  // pass must stay per-segment to preserve the scale look.
  for (let i = N - 1; i >= 0; i--) {
    const p = points[i];
    const r = radiusAt(i);
    if (r < 0.5) continue;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
    ctx.fillStyle = i % 3 === 0 ? dark : color;
    ctx.fill();
  }

  // Head — halo (spawn-protect only), eyes, name label. Boost is
  // signalled by the body-wide glow above, not by a head ring or
  // cream spine.
  // The head circle itself was drawn by the body loop (segment 0).
  const head = points[0];
  const next = points[1] ?? head;
  const dx = head.sx - next.sx;
  const dy = head.sy - next.sy;
  const heading = Math.atan2(dy, dx) || 0;
  drawHead(
    ctx,
    head.sx,
    head.sy,
    scale,
    color,
    prot,
    heading,
    label,
    seed,
    headPulseScale,
    widthScale,
  );
}

function drawHead(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  scale: number,
  color: string,
  prot: boolean,
  heading: number,
  label: string | null,
  seed: string,
  pulse: number,
  widthScale: number,
): void {
  const r = HEAD_RADIUS * scale * pulse * widthScale;
  // Spawn-protection halo.
  if (prot && r > 4) {
    const phase = (performance.now() / 1000) % 1;
    const pulsePhase = 0.35 + 0.45 * Math.abs(Math.sin(phase * Math.PI * 2));
    ctx.beginPath();
    ctx.arc(sx, sy, r * 1.45, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(3, r * 0.18);
    ctx.strokeStyle = `rgba(255, 255, 255, ${pulsePhase.toFixed(3)})`;
    ctx.stroke();
  }
  // Boost is signalled by the body-wide glow drawn in drawSnake,
  // not by a head ring. The head circle itself was drawn by the
  // body loop (segment 0). drawHead only adds the halo (spawn
  // protection), eyes, and name label.

  // Eyes — only big enough to read at scale.
  if (r >= 6) {
    drawEyes(ctx, sx, sy, r, heading, eyeOpenness(seed), color);
  }

  if (label && r >= 6) {
    let font = clamp(r * 0.7, 10, 24);
    ctx.font = `${font.toFixed(1)}px ui-sans-serif, system-ui, -apple-system, "Inter", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const maxWidth = r * 4;
    while (font > 9 && ctx.measureText(label).width > maxWidth) {
      font -= 1;
      ctx.font = `${font.toFixed(1)}px ui-sans-serif, system-ui, -apple-system, "Inter", sans-serif`;
    }
    // Soft dark drop-shadow so cream text reads against any body
    // colour underneath. Faster than a real stroke and more legible
    // on the dark world.
    ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
    ctx.shadowBlur = 4;
    ctx.fillStyle = "#fbf6ee";
    ctx.fillText(label, sx, sy - r - 6);
    ctx.shadowBlur = 0;
  }
}

/** Two beady eyes, oriented along the heading. White whites with
 *  ink pupils. Pupils sit slightly forward of the centre so the
 *  snake looks like it's looking where it's going. The whole eye
 *  squishes vertically (perpendicular to the heading) for blinks —
 *  openness ∈ [0, 1] where 0 is fully closed and 1 fully open. */
function drawEyes(
  ctx: CanvasRenderingContext2D,
  hx: number,
  hy: number,
  headR: number,
  heading: number,
  openness: number,
  bodyColor: string,
): void {
  // Tint outlines slightly darker than the head fill so the eye rims
  // read on the dark world without falling back to a hard ink line.
  const rim = darkenHex(bodyColor, OUTLINE_DARKEN);
  const eyeR = Math.max(1.6, headR * 0.32);
  // Smaller pupils relative to whites — reads more "snake-like" than
  // the previous 0.55, less googly-eyed.
  const pupilR = Math.max(0.8, eyeR * 0.45);
  const offset = headR * 0.42;
  const fwd = headR * 0.28;
  // Heading basis vectors.
  const fx = Math.cos(heading);
  const fy = Math.sin(heading);
  const px = -Math.sin(heading);
  const py = Math.cos(heading);
  // Eye centres.
  const lx = hx + fx * fwd + px * offset;
  const ly = hy + fy * fwd + py * offset;
  const rx = hx + fx * fwd - px * offset;
  const ry = hy + fy * fwd - py * offset;

  if (openness <= 0.04) {
    // Fully closed — short rim-coloured slit perpendicular to the
    // heading. Reads as a darker crease on the lit head.
    ctx.strokeStyle = rim;
    ctx.lineWidth = Math.max(1, eyeR * 0.45);
    ctx.lineCap = "round";
    const slitLen = eyeR * 0.85;
    ctx.beginPath();
    ctx.moveTo(lx - px * slitLen, ly - py * slitLen);
    ctx.lineTo(lx + px * slitLen, ly + py * slitLen);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rx - px * slitLen, ry - py * slitLen);
    ctx.lineTo(rx + px * slitLen, ry + py * slitLen);
    ctx.stroke();
    return;
  }

  // Whites — ellipse whose perpendicular-to-heading radius scales
  // with openness. Major axis (eyeR) lies along the heading.
  ctx.fillStyle = "#fbf6ee";
  ctx.strokeStyle = rim;
  ctx.lineWidth = 1;
  const eyeRy = eyeR * openness;
  ctx.beginPath();
  ctx.ellipse(lx, ly, eyeR, eyeRy, heading, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(rx, ry, eyeR, eyeRy, heading, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Pupils — pushed forward in the heading direction so the gaze
  // tracks where the snake is going. Squish with the lid.
  const pFwd = eyeR * 0.4;
  const pupilRy = pupilR * openness;
  ctx.fillStyle = "#1a1812";
  ctx.beginPath();
  ctx.ellipse(lx + fx * pFwd, ly + fy * pFwd, pupilR, pupilRy, heading, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(rx + fx * pFwd, ry + fy * pFwd, pupilR, pupilRy, heading, 0, Math.PI * 2);
  ctx.fill();
}

/** Subtle dotted "garden" texture, world-anchored so the dots scroll
 *  with the camera. Distinct visual identity from munch's line grid
 *  without being noisy. All dots batched into one path so we pay one
 *  fill per frame, not one per dot. */
function drawDottedBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cx: number,
  cy: number,
  scale: number,
  toScreen: (wx: number, wy: number) => { sx: number; sy: number },
): void {
  const step = 60; // world units between dots
  const left = cx - w / 2 / scale;
  const right = cx + w / 2 / scale;
  const top = cy - h / 2 / scale;
  const bottom = cy + h / 2 / scale;
  const gx0 = Math.floor(left / step) * step;
  const gy0 = Math.floor(top / step) * step;
  const dotR = Math.max(1, scale * 1.6);
  ctx.beginPath();
  for (let gx = gx0; gx < right + step; gx += step) {
    for (let gy = gy0; gy < bottom + step; gy += step) {
      const { sx, sy } = toScreen(gx, gy);
      if (sx < -dotR || sx > w + dotR || sy < -dotR || sy > h + dotR) continue;
      ctx.moveTo(sx + dotR, sy);
      ctx.arc(sx, sy, dotR, 0, Math.PI * 2);
    }
  }
  ctx.fillStyle = BG_DOT_COLOR;
  ctx.fill();
}

/** Top-left … erm, bottom-left minimap. Screen-space overlay drawn
 *  after the world but before the death flash. Shows the whole 5000²
 *  world, top-10 leaderboard snakes as small coloured dots, your own
 *  position as a slightly larger dot in your colour, and a cream
 *  rectangle showing what your camera currently sees. */
function drawMinimap(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cur: Snapshot,
  localSelf: LocalSelf | null,
  self: Self | null,
  ehx: number,
  ehy: number,
): void {
  // Adaptive size — 22% of the smaller canvas dimension, clamped
  // 80-150. On a phone (~375 wide) that's about 82px; on a desktop
  // canvas (~1200 wide on a typical viewport) it caps at 150.
  const size = Math.min(150, Math.max(80, Math.min(w, h) * 0.22));
  const margin = 16;
  const left = margin;
  const top = h - margin - size;
  const worldScale = size / WORLD_SIZE;

  ctx.save();
  // Background panel.
  ctx.fillStyle = "rgba(21, 19, 28, 0.85)";
  ctx.fillRect(left, top, size, size);
  ctx.strokeStyle = "rgba(251, 246, 238, 0.45)";
  ctx.lineWidth = 2;
  ctx.strokeRect(left, top, size, size);

  // Leaderboard dots (other snakes only — self handled below in its
  // own colour at a larger size).
  const selfId = self?.id ?? null;
  for (const e of cur.leaderboard) {
    if (e.id === selfId) continue;
    const mx = left + e.x * worldScale;
    const my = top + e.y * worldScale;
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(mx, my, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Viewport rectangle — what the camera currently shows.
  const cam = localSelf?.alive
    ? localSelf.head
    : cur.you.head ?? { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
  const rectX = left + (cam.x - ehx) * worldScale;
  const rectY = top + (cam.y - ehy) * worldScale;
  const rectW = 2 * ehx * worldScale;
  const rectH = 2 * ehy * worldScale;
  ctx.strokeStyle = "rgba(251, 246, 238, 0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(rectX, rectY, rectW, rectH);

  // Self dot — bigger, in own colour, with a cream rim so it pops.
  if (self && localSelf && localSelf.alive) {
    const mx = left + localSelf.head.x * worldScale;
    const my = top + localSelf.head.y * worldScale;
    ctx.fillStyle = self.color;
    ctx.beginPath();
    ctx.arc(mx, my, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fbf6ee";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
}

/** A solid rounded-square food pellet for death-drop food. Visually
 *  distinguishes a "feast" from natural pellets. Outlined with a
 *  darker tint of its own colour so it reads on the dark world. */
function drawRoundedSquare(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  radius: number,
  color: string,
): void {
  const x = cx - size / 2;
  const y = cy - size / 2;
  const r = Math.min(radius, size / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + size - r, y);
  ctx.quadraticCurveTo(x + size, y, x + size, y + r);
  ctx.lineTo(x + size, y + size - r);
  ctx.quadraticCurveTo(x + size, y + size, x + size - r, y + size);
  ctx.lineTo(x + r, y + size);
  ctx.quadraticCurveTo(x, y + size, x, y + size - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = darkenHex(color, OUTLINE_DARKEN);
  ctx.stroke();
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#") && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  }
  return color;
}

/** Multiply each RGB channel by (1 - amount). amount=0.13 ≈ 13% darker.
 *  Used for the every-third-segment scale banding on the body. */
function darkenHex(hex: string, amount: number): string {
  if (!hex.startsWith("#") || hex.length !== 7) return hex;
  const k = 1 - amount;
  const r = Math.max(0, Math.round(parseInt(hex.slice(1, 3), 16) * k));
  const g = Math.max(0, Math.round(parseInt(hex.slice(3, 5), 16) * k));
  const b = Math.max(0, Math.round(parseInt(hex.slice(5, 7), 16) * k));
  const hh = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hh(r)}${hh(g)}${hh(b)}`;
}

/* ---- blink scheduling ---- */

const BLINK_PERIOD_MS = 5000;
const BLINK_CLOSED_MS = 80;
const BLINK_EASE_MS = 60;

/** Stable hash → [0, 1). Used to offset each snake's blink phase so
 *  the whole board doesn't blink in unison. */
function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Eye openness ∈ [0, 1] for the given seed at the current wall-clock
 *  moment. Each cycle eases open (BLINK_EASE_MS), stays wide, eases
 *  closed (BLINK_EASE_MS), then fully shuts for BLINK_CLOSED_MS. The
 *  per-snake phase offset means blinks scatter across the lobby. */
function eyeOpenness(seed: string): number {
  const phaseOffset = (hashSeed(seed) % 1000) / 1000;
  const period = BLINK_PERIOD_MS;
  const closeStart = period - BLINK_CLOSED_MS - BLINK_EASE_MS;
  const closeEnd = period - BLINK_CLOSED_MS;
  const t = (performance.now() + phaseOffset * period) % period;
  if (t < BLINK_EASE_MS) return t / BLINK_EASE_MS;
  if (t < closeStart) return 1;
  if (t < closeEnd) return (closeEnd - t) / BLINK_EASE_MS;
  return 0;
}

/* ---- particles + animation pulses ---- */

/** Drop boost-trail particles from the tail of every boosting snake.
 *  Stateless and dt-aware so the rate per second stays constant
 *  across frame rates. The tail position is derived from the local
 *  trail for self (zero-latency) and from the snapshot for other
 *  snakes (visible tail is the last culled segment, which is fine
 *  for a visual effect — the trail still reads as coming off the
 *  back of the snake). */
function spawnBoostTrails(
  particles: Particle[],
  cur: Snapshot,
  self: Self | null,
  localSelf: LocalSelf | null,
  dt: number,
): void {
  // Self.
  if (self && localSelf && localSelf.alive && localSelf.boosting) {
    const segs = sampleBodyFromTrail(localSelf.trail, localSelf.length);
    if (segs.length >= 2) {
      const tail = segs[segs.length - 1];
      // Backward angle = opposite of heading.
      const back = localSelf.heading + Math.PI;
      emitBoostParticle(particles, tail.x, tail.y, back, self.color, dt);
    }
  }
  // Other snakes — derive the "backward" angle from the last two
  // visible segments (segments[N-2] → segments[N-1] is the head→tail
  // direction = backward direction).
  for (const s of cur.snakes) {
    if (!s.boosting || s.segments.length < 2) continue;
    const tail = s.segments[s.segments.length - 1];
    const prev = s.segments[s.segments.length - 2];
    const back = Math.atan2(tail.y - prev.y, tail.x - prev.x);
    emitBoostParticle(particles, tail.x, tail.y, back, s.color, dt);
  }
}

/** Maybe-spawn a single boost-trail particle. Stochastic on the dt
 *  remainder so the rate per second stays at BOOST_TRAIL_RATE
 *  regardless of frame rate. */
function emitBoostParticle(
  particles: Particle[],
  x: number,
  y: number,
  back: number,
  color: string,
  dt: number,
): void {
  const expected = BOOST_TRAIL_RATE * dt;
  let count = Math.floor(expected);
  if (Math.random() < expected - count) count++;
  for (let i = 0; i < count; i++) {
    if (particles.length >= PARTICLE_BUDGET) {
      // Drop a handful of the oldest to make room.
      particles.splice(0, 12);
    }
    const speed = 55 + Math.random() * 80;
    const spread = (Math.random() - 0.5) * 0.85;
    const angle = back + spread;
    const life = 240 + Math.random() * 200;
    particles.push({
      x: x + (Math.random() - 0.5) * 5,
      y: y + (Math.random() - 0.5) * 5,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      life,
      max: life,
      r: 2 + Math.random() * 1.4,
    });
  }
}

/** Push a small fan of particles outward from (x, y) in `color`. The
 *  array mutates in place. Drops the oldest if the budget is hit so a
 *  busy moment doesn't leak particles into eternity. */
function spawnBurst(particles: Particle[], x: number, y: number, color: string): void {
  if (particles.length > PARTICLE_BUDGET - 16) {
    particles.splice(0, particles.length - (PARTICLE_BUDGET - 16));
  }
  const count = 14;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 90 + Math.random() * 180;
    const life = 480 + Math.random() * 220;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      life,
      max: life,
      r: 3 + Math.random() * 2,
    });
  }
}

/** Advance every particle by `dt` seconds. Integrates velocity, applies
 *  exponential drag, drops dead particles. */
function tickParticles(particles: Particle[], dt: number): void {
  // dragPerSec ≈ 0.6 — fast initial spread, then drift to a halt.
  const drag = Math.pow(0.6, dt);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt * 1000;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= drag;
    p.vy *= drag;
  }
}

/** Render every particle as a colored disc, alpha-faded with remaining
 *  life. */
function drawParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  toScreen: (wx: number, wy: number) => { sx: number; sy: number },
  scale: number,
): void {
  for (const p of particles) {
    const a = Math.max(0, Math.min(1, p.life / p.max));
    if (a <= 0) continue;
    const { sx, sy } = toScreen(p.x, p.y);
    ctx.fillStyle = withAlpha(p.color, a);
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(1.2, p.r * scale), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Eat-pulse: 1 → PEAK → 1 over HEAD_PULSE_MS using a half-sine so the
 *  rise and fall are smooth. Returns 1 when no pulse is active. */
function computeHeadPulse(eatAt: number, now: number): number {
  if (eatAt === 0) return 1;
  const t = now - eatAt;
  if (t < 0 || t > HEAD_PULSE_MS) return 1;
  const u = t / HEAD_PULSE_MS;
  return 1 + (HEAD_PULSE_PEAK - 1) * Math.sin(u * Math.PI);
}

/** Death zoom: ramps 1 → MAX over 100 ms, holds until the dead UI
 *  overlays the canvas. */
function computeDeathZoom(deathAt: number, now: number): number {
  if (deathAt === 0) return 1;
  const t = now - deathAt;
  if (t < 0) return 1;
  if (t < 100) return 1 + (DEATH_ZOOM_MAX - 1) * (t / 100);
  if (t < DEATH_FLASH_MS) return DEATH_ZOOM_MAX;
  return 1;
}

/** Death flash: peaks instantly, fades to 0 over DEATH_FLASH_MS. */
function computeDeathFlash(deathAt: number, now: number): number {
  if (deathAt === 0) return 0;
  const t = now - deathAt;
  if (t < 0 || t >= DEATH_FLASH_MS) return 0;
  return 0.78 * (1 - t / DEATH_FLASH_MS);
}

/* ------------------------------------------------------------------ */
/* Client-side prediction                                               */
/* ------------------------------------------------------------------ */

/** Advance the local-self state by one render frame using the same
 *  physics rules the server runs at TICK_HZ. Frame dt is per-frame
 *  so motion is consistent regardless of frame rate. */
function advanceLocalSelf(
  local: LocalSelf,
  aim: { x: number; y: number },
  boost: boolean,
): void {
  if (!local.alive) {
    local.lastFrameAt = performance.now();
    return;
  }
  const now = performance.now();
  const dt = Math.min(0.05, (now - local.lastFrameAt) / 1000); // cap dt at 50ms
  local.lastFrameAt = now;
  if (dt <= 0) return;

  // Steer heading toward aim. The cap scales down with length so
  // big snakes commit to turns and small ones can dart — matches the
  // server's turnRateFor.
  const aimMag = Math.hypot(aim.x, aim.y);
  if (aimMag > 0.001) {
    const targetAngle = Math.atan2(aim.y, aim.x);
    let diff = targetAngle - local.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = turnRateFor(local.length) * dt;
    if (diff > maxTurn) diff = maxTurn;
    else if (diff < -maxTurn) diff = -maxTurn;
    local.heading += diff;
  }

  // Boost gated to keep the snake from boosting while at the length
  // floor — matches the server's MIN_LENGTH check.
  local.boosting = boost && local.length > 4;

  // Move head forward.
  const speed = local.boosting ? BOOST_SPEED : HEAD_SPEED;
  local.head.x += Math.cos(local.heading) * speed * dt;
  local.head.y += Math.sin(local.heading) * speed * dt;

  // Soft wall — clamp using the per-length head radius so the
  // predicted head doesn't skate off-screen visually if the server
  // lags behind on death detection.
  const myHeadR = HEAD_RADIUS * radiusMultiplierFor(local.length);
  if (local.head.x < myHeadR) local.head.x = myHeadR;
  else if (local.head.x > WORLD_SIZE - myHeadR) local.head.x = WORLD_SIZE - myHeadR;
  if (local.head.y < myHeadR) local.head.y = myHeadR;
  else if (local.head.y > WORLD_SIZE - myHeadR) local.head.y = WORLD_SIZE - myHeadR;

  // Push to trail.
  local.trail.unshift({ x: local.head.x, y: local.head.y });
  if (local.trail.length > LOCAL_TRAIL_MAX) local.trail.length = LOCAL_TRAIL_MAX;
}

/** Sample body segments at SEGMENT_GAP distance intervals along the
 *  trail polyline. Same algorithm as the server's computeBody —
 *  duplicated here for client-side prediction. */
function sampleBodyFromTrail(
  trail: { x: number; y: number }[],
  length: number,
): { x: number; y: number }[] {
  if (trail.length === 0) return [];
  const segments: { x: number; y: number }[] = [];
  segments.push({ x: trail[0].x, y: trail[0].y });
  if (length <= 1) return segments;

  let cumDist = 0;
  let trailIdx = 0;
  for (let k = 1; k < length; k++) {
    const targetDist = k * SEGMENT_GAP;
    while (trailIdx + 1 < trail.length) {
      const a = trail[trailIdx];
      const b = trail[trailIdx + 1];
      const segLen = Math.hypot(a.x - b.x, a.y - b.y);
      if (cumDist + segLen >= targetDist) break;
      cumDist += segLen;
      trailIdx++;
    }
    if (trailIdx + 1 >= trail.length) {
      const last = trail[trail.length - 1];
      segments.push({ x: last.x, y: last.y });
      continue;
    }
    const a = trail[trailIdx];
    const b = trail[trailIdx + 1];
    const segLen = Math.hypot(a.x - b.x, a.y - b.y);
    const tt = segLen > 0 ? (targetDist - cumDist) / segLen : 0;
    segments.push({
      x: a.x + (b.x - a.x) * tt,
      y: a.y + (b.y - a.y) * tt,
    });
  }
  return segments;
}

/** Derive a heading angle from the first two segments. Returns null
 *  if the snake is too short or segments are coincident. */
function headingFromSegments(
  segments: { x: number; y: number }[],
): number | null {
  if (segments.length < 2) return null;
  const dx = segments[0].x - segments[1].x;
  const dy = segments[0].y - segments[1].y;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return null;
  return Math.atan2(dy, dx);
}
