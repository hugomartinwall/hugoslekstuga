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
  SEGMENT_GAP,
  SEGMENT_RADIUS,
  TURN_RATE,
  WORLD_SIZE,
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
/** Maximum extrapolation factor for OTHER snakes' interpolation. Past
 *  this, motion clamps. 1.0 = no extrapolation (freeze on cur), 1.5 =
 *  extrapolate up to 50% of a snap gap forward. Keeps motion smooth
 *  through small network jitter. */
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
        setLeaderboard(msg.leaderboard);
        setMyLength(Math.floor(msg.you.length));
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
  }, []);

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
      // Advance the locally-predicted self snake before drawing so
      // the rendered head reflects the player's most recent input.
      if (localSelfRef.current) {
        advanceLocalSelf(localSelfRef.current, aimRef.current, boostRef.current);
      }
      if (canvas) {
        drawScene(
          canvas,
          prevSnapRef.current,
          curSnapRef.current,
          selfRef.current,
          localSelfRef.current,
        );
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
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
      <div className="fixed inset-0 z-50 flex flex-col bg-cream-deep">
        <canvas
          ref={canvasRef}
          className="block h-full w-full bg-cream"
          style={{ touchAction: "none" }}
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
        You&rsquo;re a snake. You move forward at all times — aim with the
        mouse (or drag a finger). Eat dots to grow longer. If your head
        touches another snake&rsquo;s body, you die. Hold{" "}
        <Kbd>Space</Kbd> (or the Boost button on phones) to sprint —
        costs length. Hit a wall and you die. Top the leaderboard.
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
          Boost burns length; longer snake survives a longer sprint.
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
      style={{ touchAction: "none" }}
      className="btn-chunk absolute bottom-6 right-6 flex h-20 w-20 items-center justify-center rounded-full bg-green font-display text-base font-extrabold uppercase tracking-wide text-cream sm:bottom-8 sm:right-8"
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
            {copied ? "Copied!" : "Share score"}
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
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#fbf6ee";
  ctx.fillRect(0, 0, w, h);

  if (!cur) return;

  // Snapshot interpolation factor for OTHER snakes. Allowed to go past
  // 1.0 up to EXTRAP_LIMIT so a late snapshot doesn't freeze the world.
  const now = performance.now();
  const tOther = prev
    ? Math.max(0, Math.min(EXTRAP_LIMIT, (now - cur.receivedAt) / SNAP_GAP))
    : 1;

  // Camera centred on own head. With local prediction, the camera
  // tracks the locally-simulated head — feels zero-latency.
  const myHead = localSelf?.alive
    ? localSelf.head
    : cur.you.head ?? { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
  const myCx = myHead.x;
  const myCy = myHead.y;

  const aspect = w > 0 && h > 0 ? w / h : undefined;
  const { hx, hy } = viewportHalfFor(Math.max(8, cur.you.length), aspect);
  const scale = Math.min(w / (2 * hx), h / (2 * hy));

  const toScreen = (wx: number, wy: number) => ({
    sx: (wx - myCx) * scale + w / 2,
    sy: (wy - myCy) * scale + h / 2,
  });

  // World — dotted "garden" texture. Distinct from munch's plain
  // line grid so noodle reads as a different sandbox at a glance.
  drawDottedBackground(ctx, w, h, myCx, myCy, scale, toScreen);

  // World bounds — bold ink rectangle. Walls kill, so the boundary
  // earns a heavy stroke.
  ctx.strokeStyle = "#1a1812";
  ctx.lineWidth = 4;
  const tl = toScreen(0, 0);
  const br = toScreen(WORLD_SIZE, WORLD_SIZE);
  ctx.strokeRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);

  // Food. Two visual languages: regular pellets are colored circles
  // (same as munch), death-drop food is a colored rounded square so
  // a "feast" reads as something different from natural pellets.
  for (const f of cur.food) {
    const { sx, sy } = toScreen(f.x, f.y);
    if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;
    const r = Math.max(2, f.r * scale);
    if (f.r > 7) {
      // Death-drop food — rounded square, slight outline.
      drawRoundedSquare(ctx, sx, sy, r * 1.7, r * 0.4, f.color);
    } else {
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
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
    );
  }

  // Self snake — drawn from LOCAL state. The local trail is updated
  // every frame, so the rendered worm tracks the player's input with
  // no perceived latency. The body is sampled from the local trail
  // at SEGMENT_GAP intervals (same algorithm as the server).
  if (self && localSelf && localSelf.alive) {
    const segments = sampleBodyFromTrail(localSelf.trail, localSelf.length);
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
    );
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
  // through, reading as subtle scale banding.
  const headR = HEAD_RADIUS * scale;
  const tailR = SEGMENT_RADIUS * 0.6 * scale;
  const radiusAt = (i: number): number => {
    if (N <= 1) return headR;
    const t01 = i / (N - 1);
    return headR + (tailR - headR) * t01;
  };
  const dark = darkenHex(color, 0.13);
  const shell = Math.max(2, scale * 2);

  for (let i = N - 1; i >= 0; i--) {
    const p = points[i];
    const r = radiusAt(i);
    if (r < 0.5) continue;
    // Ink shell.
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, r + shell, 0, Math.PI * 2);
    ctx.fillStyle = "#1a1812";
    ctx.fill();
    // Coloured fill — every third segment slightly darker.
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
    ctx.fillStyle = i % 3 === 0 ? dark : color;
    ctx.fill();
  }

  // Boost stripe — a thin cream highlight running along the spine.
  // Subtle signal that this snake is sprinting.
  if (boosting && N >= 2) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const tailFirst: { sx: number; sy: number }[] = new Array(N);
    for (let i = 0; i < N; i++) tailFirst[i] = points[N - 1 - i];
    ctx.beginPath();
    pathThroughPoints(ctx, tailFirst);
    ctx.lineWidth = Math.max(1.5, SEGMENT_RADIUS * 0.45 * scale);
    ctx.strokeStyle = withAlpha("#fbf6ee", 0.55);
    ctx.stroke();
  }

  // Head — halo, boost glow, eyes (with occasional blink), name label.
  // The head circle itself was drawn by the body loop (segment 0).
  const head = points[0];
  const next = points[1] ?? head;
  const dx = head.sx - next.sx;
  const dy = head.sy - next.sy;
  const heading = Math.atan2(dy, dx) || 0;
  drawHead(ctx, head.sx, head.sy, scale, color, prot, boosting, heading, label, seed);
}

/** Draws a smooth quadratic-Bezier path through the points. The
 *  curve passes through the midpoints of each consecutive pair and
 *  uses each point as a control point — classic "smooth a polyline"
 *  trick. Looks fluid; cheaper than Catmull-Rom for our needs. */
function pathThroughPoints(
  ctx: CanvasRenderingContext2D,
  pts: { sx: number; sy: number }[],
): void {
  if (pts.length === 0) return;
  if (pts.length === 1) {
    ctx.moveTo(pts[0].sx, pts[0].sy);
    return;
  }
  ctx.moveTo(pts[0].sx, pts[0].sy);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].sx, pts[1].sy);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const xm = (pts[i].sx + pts[i + 1].sx) / 2;
    const ym = (pts[i].sy + pts[i + 1].sy) / 2;
    ctx.quadraticCurveTo(pts[i].sx, pts[i].sy, xm, ym);
  }
  // Last segment to the final point.
  ctx.lineTo(pts[pts.length - 1].sx, pts[pts.length - 1].sy);
}

function drawHead(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  scale: number,
  color: string,
  prot: boolean,
  boosting: boolean,
  heading: number,
  label: string | null,
  seed: string,
): void {
  const r = HEAD_RADIUS * scale;
  // Spawn-protection halo.
  if (prot && r > 4) {
    const phase = (performance.now() / 1000) % 1;
    const pulse = 0.35 + 0.45 * Math.abs(Math.sin(phase * Math.PI * 2));
    ctx.beginPath();
    ctx.arc(sx, sy, r * 1.45, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(3, r * 0.18);
    ctx.strokeStyle = `rgba(255, 255, 255, ${pulse.toFixed(3)})`;
    ctx.stroke();
  }
  // Boost glow.
  if (boosting && r > 4) {
    ctx.beginPath();
    ctx.arc(sx, sy, r * 1.35, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, r * 0.14);
    ctx.strokeStyle = withAlpha(color, 0.55);
    ctx.stroke();
  }
  // The head circle itself was drawn by the body loop (segment 0).
  // This function only adds halo, glow, eyes, and the name label.

  // Eyes — only big enough to read at scale.
  if (r >= 6) {
    drawEyes(ctx, sx, sy, r, heading, eyeOpenness(seed));
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
    ctx.lineWidth = Math.max(2, font * 0.18);
    ctx.strokeStyle = "#1a1812";
    ctx.fillStyle = "#fbf6ee";
    ctx.strokeText(label, sx, sy - r - 6);
    ctx.fillText(label, sx, sy - r - 6);
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
): void {
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
    // Fully closed — short ink slit perpendicular to the heading.
    ctx.strokeStyle = "#1a1812";
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
  ctx.strokeStyle = "#1a1812";
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
 *  without being noisy. */
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
  ctx.fillStyle = "rgba(26, 24, 18, 0.10)";
  const dotR = Math.max(1, scale * 1.6);
  for (let gx = gx0; gx < right + step; gx += step) {
    for (let gy = gy0; gy < bottom + step; gy += step) {
      const { sx, sy } = toScreen(gx, gy);
      if (sx < -dotR || sx > w + dotR || sy < -dotR || sy > h + dotR) continue;
      ctx.beginPath();
      ctx.arc(sx, sy, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** A solid rounded-square food pellet for death-drop food. Visually
 *  distinguishes a "feast" from natural pellets. */
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
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#1a1812";
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

  // Steer heading toward aim (capped at TURN_RATE).
  const aimMag = Math.hypot(aim.x, aim.y);
  if (aimMag > 0.001) {
    const targetAngle = Math.atan2(aim.y, aim.x);
    let diff = targetAngle - local.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = TURN_RATE * dt;
    if (diff > maxTurn) diff = maxTurn;
    else if (diff < -maxTurn) diff = -maxTurn;
    local.heading += diff;
  }

  // Boost only when the snake has length to spare.
  local.boosting = boost && local.length > 4;

  // Move head forward.
  const speed = local.boosting ? BOOST_SPEED : HEAD_SPEED;
  local.head.x += Math.cos(local.heading) * speed * dt;
  local.head.y += Math.sin(local.heading) * speed * dt;

  // Soft wall — clamp so the predicted head doesn't skate off-screen
  // visually if the server lags behind on death detection.
  if (local.head.x < HEAD_RADIUS) local.head.x = HEAD_RADIUS;
  else if (local.head.x > WORLD_SIZE - HEAD_RADIUS) local.head.x = WORLD_SIZE - HEAD_RADIUS;
  if (local.head.y < HEAD_RADIUS) local.head.y = HEAD_RADIUS;
  else if (local.head.y > WORLD_SIZE - HEAD_RADIUS) local.head.y = WORLD_SIZE - HEAD_RADIUS;

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
