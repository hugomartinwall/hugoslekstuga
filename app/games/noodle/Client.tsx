"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";
import { clamp } from "@/lib/math";
import {
  HEAD_RADIUS,
  SEGMENT_RADIUS,
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

const WS_BASE = process.env.NEXT_PUBLIC_MUNCH_WS_URL ?? "ws://localhost:8080";
const WS_URL = `${WS_BASE.replace(/\/+$/, "")}/noodle`;
const NAME_KEY = "hugoslekstuga:noodle:name";
/** ms to lerp between two snapshots — matches the server's ~50ms snapshot
 *  cadence, so playback is one snapshot behind realtime but smooth. */
const SNAP_GAP = 50;

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
  /** Aim direction in canvas-relative pixels (mouse → head vector).
   *  The server normalises so this can be raw delta. */
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
      if (canvas) {
        drawScene(canvas, prevSnapRef.current, curSnapRef.current, selfRef.current);
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

  // Snapshot interpolation factor.
  const now = performance.now();
  const t = prev ? Math.min(1, (now - cur.receivedAt) / SNAP_GAP) : 1;
  const lerp = (a: number, b: number) => a + (b - a) * t;

  // Camera centred on own head. Interpolate position.
  const myHead = cur.you.head ?? { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
  const prevHead = prev?.you.head ?? myHead;
  const myCx = lerp(prevHead.x, myHead.x);
  const myCy = lerp(prevHead.y, myHead.y);

  const aspect = w > 0 && h > 0 ? w / h : undefined;
  const { hx, hy } = viewportHalfFor(Math.max(8, cur.you.length), aspect);
  const scale = Math.min(w / (2 * hx), h / (2 * hy));

  const toScreen = (wx: number, wy: number) => ({
    sx: (wx - myCx) * scale + w / 2,
    sy: (wy - myCy) * scale + h / 2,
  });

  // World grid.
  ctx.strokeStyle = "#1a181210";
  ctx.lineWidth = 1;
  const gridStep = 100;
  const left = myCx - w / 2 / scale;
  const right = myCx + w / 2 / scale;
  const top = myCy - h / 2 / scale;
  const bottom = myCy + h / 2 / scale;
  const gx0 = Math.floor(left / gridStep) * gridStep;
  const gy0 = Math.floor(top / gridStep) * gridStep;
  for (let gx = gx0; gx < right; gx += gridStep) {
    const { sx } = toScreen(gx, 0);
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
    ctx.stroke();
  }
  for (let gy = gy0; gy < bottom; gy += gridStep) {
    const { sy } = toScreen(0, gy);
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
    ctx.stroke();
  }

  // World bounds.
  ctx.strokeStyle = "#1a1812";
  ctx.lineWidth = 4;
  const tl = toScreen(0, 0);
  const br = toScreen(WORLD_SIZE, WORLD_SIZE);
  ctx.strokeRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);

  // Food.
  for (const f of cur.food) {
    const { sx, sy } = toScreen(f.x, f.y);
    if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(2, f.r * scale), 0, Math.PI * 2);
    ctx.fill();
  }

  // Build prev-snake map for interpolation.
  const prevSnakeMap = new Map<string, SnakeView>();
  if (prev) for (const s of prev.snakes) prevSnakeMap.set(s.id, s);

  // Other snakes.
  for (const s of cur.snakes) {
    const prevS = prevSnakeMap.get(s.id);
    drawSnake(ctx, s, prevS, t, toScreen, scale);
  }

  // Self snake — synthesize a SnakeView from cur.you for the self
  // segments. The server only sends `head` for self in `you`, not the
  // body — clients can't know their own body until the server sends
  // it. To paint the self snake, reuse the prev/cur head positions
  // and length, drawing the head + a colored trail behind it that
  // interpolates from the previous snapshot.
  // For simplicity in v1, draw a single big head circle for self.
  if (cur.you.head && self) {
    const { sx, sy } = toScreen(myCx, myCy);
    drawSelfHead(ctx, sx, sy, scale, self.color, cur.you.protUntil > Date.now(), cur.you.boosting);
  }
}

function drawSnake(
  ctx: CanvasRenderingContext2D,
  snake: SnakeView,
  prev: SnakeView | undefined,
  t: number,
  toScreen: (wx: number, wy: number) => { sx: number; sy: number },
  scale: number,
): void {
  const segs = snake.segments;
  if (segs.length === 0) return;
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const interp = (i: number) => {
    const cur = segs[i];
    if (!prev || !prev.segments[i]) return cur;
    const p = prev.segments[i];
    return { x: lerp(p.x, cur.x), y: lerp(p.y, cur.y) };
  };

  // Body as a thick stroked path with chunky outline.
  // Walk tail → head so the head is drawn last (on top).
  ctx.beginPath();
  for (let i = segs.length - 1; i >= 0; i--) {
    const { sx, sy } = toScreen(...interpToTuple(interp(i)));
    if (i === segs.length - 1) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = (SEGMENT_RADIUS + 2) * 2 * scale;
  ctx.strokeStyle = "#1a1812";
  ctx.stroke();
  ctx.lineWidth = SEGMENT_RADIUS * 2 * scale;
  ctx.strokeStyle = snake.color;
  ctx.stroke();

  // Head circle, slightly bigger.
  const head = interp(0);
  const { sx, sy } = toScreen(head.x, head.y);
  drawHead(ctx, sx, sy, scale, snake.color, snake.prot, snake.boosting, snake.name);
}

function drawSelfHead(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  scale: number,
  color: string,
  prot: boolean,
  boosting: boolean,
): void {
  drawHead(ctx, sx, sy, scale, color, prot, boosting, null);
}

function drawHead(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  scale: number,
  color: string,
  prot: boolean,
  boosting: boolean,
  label: string | null,
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
  // Boost glow — soft outer ring while sprinting.
  if (boosting && r > 4) {
    ctx.beginPath();
    ctx.arc(sx, sy, r * 1.3, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.strokeStyle = withAlpha(color, 0.55);
    ctx.stroke();
  }
  // Head circle.
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#1a1812";
  ctx.stroke();

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
    ctx.strokeText(label, sx, sy - r - 4);
    ctx.fillText(label, sx, sy - r - 4);
  }
}

function interpToTuple(p: { x: number; y: number }): [number, number] {
  return [p.x, p.y];
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
