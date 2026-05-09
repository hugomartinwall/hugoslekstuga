"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";
import { clamp } from "@/lib/math";
import {
  centroidOf,
  radiusForMass,
  totalMassOf,
  viewportHalfFor,
  WORLD_SIZE,
  type CellView,
  type ClientMsg,
  type FoodView,
  type LeaderboardEntry,
  type PlayerView,
  type ServerMsg,
} from "@/lib/munch/protocol";

type Phase = "lobby" | "connecting" | "playing" | "dead" | "disconnected";

type Snapshot = {
  receivedAt: number;
  you: { cells: CellView[]; alive: boolean };
  players: PlayerView[];
  food: FoodView[];
  leaderboard: LeaderboardEntry[];
};

type Self = { id: string; color: string; name: string };

/** A brief expanding ring rendered when a food or cell disappears,
 *  indicating something just got eaten at that spot. */
type Pulse = {
  x: number;
  y: number;
  baseR: number;
  color: string;
  bornAt: number;
};

const PULSE_DURATION_MS = 420;

const WS_URL =
  process.env.NEXT_PUBLIC_MUNCH_WS_URL ?? "ws://localhost:8080";

const NAME_KEY = "hugoslekstuga:munch:name";

export default function MunchPage() {
  const tool = findTool("munch")!;
  const [name, setName] = useLocalStorageState<string>(NAME_KEY, "");
  const [phase, setPhase] = useState<Phase>("lobby");
  const [error, setError] = useState<string>("");
  const [deadInfo, setDeadInfo] = useState<{ score: number; killer: string | null } | null>(
    null,
  );
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [myMass, setMyMass] = useState<number>(20);
  const [copied, setCopied] = useState(false);

  // The actual game state lives in refs because the canvas render loop
  // reads from them every frame and we don't want a re-render per tick.
  const wsRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prevSnapRef = useRef<Snapshot | null>(null);
  const curSnapRef = useRef<Snapshot | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const splitFlagRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const intentRef = useRef<"connected" | "leaving">("connected");
  const selfRef = useRef<Self | null>(null);
  // Visual pulses queued when food/cells disappear. Drained by the
  // render loop.
  const pulsesRef = useRef<Pulse[]>([]);
  // For light auto-reconnect: one retry on an unexpected close before
  // we surface the disconnected screen.
  const retriedRef = useRef(false);
  // Lets ws.onclose call connect() despite the closure capturing the
  // first definition; we set this on every render so the timeout
  // reaches the latest connect.
  const connectRef = useRef<((name: string) => void) | null>(null);

  /* -------------------- connect / disconnect -------------------- */

  const connect = useCallback((chosenName: string) => {
    setError("");
    setDeadInfo(null);
    setPhase("connecting");
    intentRef.current = "connected";
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({ type: "join", name: chosenName } satisfies ClientMsg),
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
        retriedRef.current = false; // reset retry budget on success
        setPhase("playing");
      } else if (msg.type === "state") {
        const prev = curSnapRef.current;
        // Detect things that disappeared from view since the last
        // snapshot. Anything that vanished while still inside the
        // current viewport was almost certainly eaten — emit a pulse.
        if (prev) {
          const myCenter = centroidOf(
            msg.you.cells.length > 0 ? msg.you.cells : prev.you.cells,
          );
          const totalMass = Math.max(20, totalMassOf(msg.you.cells));
          const view = viewportHalfFor(totalMass);
          const stillInView = (x: number, y: number) =>
            Math.abs(x - myCenter.x) < view.hx + 40 &&
            Math.abs(y - myCenter.y) < view.hy + 40;
          const now = performance.now();
          // Food
          const curFoodIds = new Set(msg.food.map((f) => f.id));
          for (const f of prev.food) {
            if (!curFoodIds.has(f.id) && stillInView(f.x, f.y)) {
              pulsesRef.current.push({
                x: f.x,
                y: f.y,
                baseR: 8,
                color: f.color,
                bornAt: now,
              });
            }
          }
          // Other players' cells
          const curOtherCellIds = new Set<number>();
          for (const p of msg.players) for (const c of p.cells) curOtherCellIds.add(c.id);
          for (const p of prev.players) {
            for (const c of p.cells) {
              if (!curOtherCellIds.has(c.id) && stillInView(c.x, c.y)) {
                pulsesRef.current.push({
                  x: c.x,
                  y: c.y,
                  baseR: radiusForMass(c.mass) + 4,
                  color: p.color,
                  bornAt: now,
                });
              }
            }
          }
          // Your own cells (death or partial cell-loss)
          const curOwnIds = new Set(msg.you.cells.map((c) => c.id));
          for (const c of prev.you.cells) {
            if (!curOwnIds.has(c.id) && stillInView(c.x, c.y)) {
              pulsesRef.current.push({
                x: c.x,
                y: c.y,
                baseR: radiusForMass(c.mass) + 6,
                color: selfRef.current?.color ?? "#9333ea",
                bornAt: now,
              });
            }
          }
          // Cap the queue so a chaotic moment doesn't allocate forever.
          if (pulsesRef.current.length > 80) {
            pulsesRef.current = pulsesRef.current.slice(-80);
          }
        }
        prevSnapRef.current = prev;
        curSnapRef.current = {
          receivedAt: performance.now(),
          you: msg.you,
          players: msg.players,
          food: msg.food,
          leaderboard: msg.leaderboard,
        };
        setLeaderboard(msg.leaderboard);
        setMyMass(Math.floor(totalMassOf(msg.you.cells)));
        if (msg.you.alive) {
          setPhase((prev) => (prev === "dead" ? "playing" : prev));
        }
      } else if (msg.type === "dead") {
        setDeadInfo({ score: msg.finalScore, killer: msg.killer });
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
      // Light auto-reconnect: try once before showing the disconnected
      // screen. The retry is cheap, the pause hides a single transient
      // network blip without the user having to click anything.
      if (!retriedRef.current) {
        retriedRef.current = true;
        window.setTimeout(() => {
          // Only retry if the user hasn't intentionally left in the
          // meantime.
          if (intentRef.current !== "leaving") connectRef.current?.(chosenName);
        }, 1500);
        return;
      }
      setPhase("disconnected");
    };
    ws.onerror = () => {
      // In dev the suffix is a useful nudge. In prod it reads as a malfunction
      // the user is meant to fix, so we soften it.
      const inDev = process.env.NODE_ENV === "development";
      setError(
        inDev
          ? "Couldn't reach the server. Is it running?"
          : "Couldn't reach the server. Try again in a minute.",
      );
    };
  }, []);

  // Keep the ref pointing at the current connect closure so the
  // ws.onclose retry timeout can reach it.
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
    pulsesRef.current = [];
    retriedRef.current = false;
  }, []);

  // Cleanup socket on unmount.
  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  /* -------------------- input + render loop --------------------- */

  // Track held keys (for movement) and edge-trigger split.
  // preventDefault on EVERY relevant keydown (including auto-repeat) so
  // the page itself never scrolls while playing.
  // Esc returns to the lobby — same as clicking Leave.
  useEffect(() => {
    if (phase !== "playing" && phase !== "dead") return;
    const onDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        disconnect();
        return;
      }
      const key = normaliseKey(e.key);
      if (key === null) return;
      e.preventDefault();
      if (e.repeat) return; // already added to set; just keep the page from scrolling
      keysRef.current.add(key);
      if (key === "Space") splitFlagRef.current = true;
    };
    const onUp = (e: KeyboardEvent) => {
      const key = normaliseKey(e.key);
      if (key === null) return;
      e.preventDefault();
      keysRef.current.delete(key);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [phase, disconnect]);

  // Lock body scroll while in-game so even non-arrow accidents (mouse
  // wheel, trackpad) don't shift the page out from under the canvas.
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
      const keys = keysRef.current;
      let dx = 0;
      let dy = 0;
      if (keys.has("ArrowUp")) dy -= 1;
      if (keys.has("ArrowDown")) dy += 1;
      if (keys.has("ArrowLeft")) dx -= 1;
      if (keys.has("ArrowRight")) dx += 1;
      const split = splitFlagRef.current;
      splitFlagRef.current = false;
      const msg: ClientMsg = {
        type: "input",
        dir: { x: dx, y: dy },
        split,
      };
      ws.send(JSON.stringify(msg));
    }, 33);
    return () => window.clearInterval(id);
  }, [phase]);

  // Render loop. Reads from refs so it's not coupled to React re-renders.
  useEffect(() => {
    if (phase !== "playing" && phase !== "dead") return;
    const draw = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        drawScene(
          canvas,
          prevSnapRef.current,
          curSnapRef.current,
          selfRef.current,
          pulsesRef.current,
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
    ws.send(
      JSON.stringify({
        type: "input",
        dir: { x: 0, y: 0 },
        split: true,
      } satisfies ClientMsg),
    );
    setPhase("playing");
    setDeadInfo(null);
  }, [connect, name]);

  const shareScore = useCallback(async () => {
    if (!deadInfo) return;
    const text = `I got ${deadInfo.score} on hugoslekstuga.se/games/munch — beat me?`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignored
    }
  }, [deadInfo]);

  /* -------------------- render ----------------------------------- */

  // Lobby and disconnected screens still live inside ToolFrame; the
  // playing/dead phases break out into a fullscreen overlay so arrow
  // keys don't fight with the page chrome.
  if (phase === "playing" || phase === "dead") {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-cream-deep">
        <canvas
          ref={canvasRef}
          className="block h-full w-full bg-cream"
          tabIndex={0}
        />
        <Leaderboard
          entries={leaderboard}
          myMass={myMass}
          onLeave={disconnect}
        />
        {phase === "dead" && deadInfo && (
          <DeadOverlay
            score={deadInfo.score}
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

  return (
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
            …connecting to the map…
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
      <p className="font-display text-2xl font-extrabold">The bigger the better.</p>
      <p className="text-sm text-ink-soft">
        Eat the dots. Eat the smaller players. Avoid the bigger ones.
        Press <Kbd>Space</Kbd> to fire half of yourself forward as an
        attack — gravity drags it back toward you, and after about 30
        seconds it can merge again. Bigger means slower; smaller pieces
        of a split cluster trail in the water behind you.
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
        className="btn-chunk self-start rounded-[var(--radius-button)] bg-purple px-6 py-3 font-display text-base font-extrabold text-cream"
      >
        Join the map
      </button>
      {error && (
        <p className="rounded-[var(--radius-card)] border-2 border-tomato bg-tomato-soft p-3 text-sm font-medium">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-1 text-xs text-ink-muted">
        <p>
          Controls: <Kbd>↑</Kbd> <Kbd>↓</Kbd> <Kbd>←</Kbd> <Kbd>→</Kbd> to move.{" "}
          <Kbd>Space</Kbd> to split.
        </p>
        <p>
          Bigger = slower, but you see further. Splitting halves your largest
          cell and shoots the new half forward — gravity pulls it back, and
          after 30 seconds it can merge again on contact.
        </p>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Leaderboard                                                          */
/* ------------------------------------------------------------------ */

function Leaderboard({
  entries,
  myMass,
  onLeave,
}: {
  entries: LeaderboardEntry[];
  myMass: number;
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
                {e.mass}
              </span>
            </li>
          ))}
          {entries.length === 0 && (
            <li className="text-ink-muted">no one yet</li>
          )}
        </ol>
      </div>
      <div className="pointer-events-auto rounded-full border-2 border-ink bg-cream px-3 py-1 font-mono text-xs">
        you: <span className="font-bold tabular-nums">{myMass}</span>
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
/* Dead overlay                                                         */
/* ------------------------------------------------------------------ */

function DeadOverlay({
  score,
  killer,
  onRespawn,
  onShare,
  onLeave,
  copied,
}: {
  score: number;
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
          Eaten
          {killer ? ` by ${killer}` : ""}
        </p>
        <p className="font-display text-5xl font-extrabold tabular-nums">
          {score}
        </p>
        <p className="text-sm text-ink-soft">peak mass</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onRespawn}
            className="btn-chunk rounded-[var(--radius-button)] bg-purple px-5 py-2 font-display text-sm font-extrabold text-cream"
          >
            Play again
          </button>
          <button
            type="button"
            onClick={onShare}
            className="rounded-full border-2 border-ink bg-cream px-4 py-2 text-sm font-bold transition-colors hover:bg-purple-soft"
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
        <p className="mt-1 text-xs text-ink-muted">
          or press <Kbd>Space</Kbd> to play again, <Kbd>Esc</Kbd> to leave
        </p>
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

function normaliseKey(k: string): string | null {
  if (k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight") {
    return k;
  }
  if (k === " " || k === "Spacebar" || k === "Space") return "Space";
  if (k === "w" || k === "W") return "ArrowUp";
  if (k === "s" || k === "S") return "ArrowDown";
  if (k === "a" || k === "A") return "ArrowLeft";
  if (k === "d" || k === "D") return "ArrowRight";
  return null;
}

/* ------------------------------------------------------------------ */
/* Canvas drawing                                                       */
/* ------------------------------------------------------------------ */

function drawScene(
  canvas: HTMLCanvasElement,
  prev: Snapshot | null,
  cur: Snapshot | null,
  self: Self | null,
  pulses: Pulse[],
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

  // Interpolation: blend between prev and cur snapshots.
  const SNAP_GAP = 50;
  const now = performance.now();
  const t = prev ? Math.min(1, (now - cur.receivedAt) / SNAP_GAP) : 1;
  const lerp = (a: number, b: number) => a + (b - a) * t;

  // Camera centroid: interpolate between previous and current centroid.
  const myCenter = centroidOf(cur.you.cells);
  const prevCenter = prev ? centroidOf(prev.you.cells) : myCenter;
  const myCx = lerp(prevCenter.x, myCenter.x);
  const myCy = lerp(prevCenter.y, myCenter.y);

  const myMass = Math.max(20, totalMassOf(cur.you.cells));
  const { hx } = viewportHalfFor(myMass);
  const scale = Math.min(w, h * (16 / 9)) / (2 * hx);

  const toScreen = (wx: number, wy: number) => ({
    sx: (wx - myCx) * scale + w / 2,
    sy: (wy - myCy) * scale + h / 2,
  });

  // World grid lines.
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

  // Food. We use a fixed world radius (not radiusForMass(1) which is
  // tiny) so pellets stay readable, and we let them genuinely shrink on
  // screen as the camera zooms out — that's the "you're huge now" cue.
  const FOOD_WORLD_R = 9;
  for (const f of cur.food) {
    const { sx, sy } = toScreen(f.x, f.y);
    if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(1.5, FOOD_WORLD_R * scale), 0, Math.PI * 2);
    ctx.fill();
  }

  // Other players: each one has a list of cells; interpolate per cell id.
  // Build a prev-cell lookup: cellId → prev position.
  const prevCellMap = new Map<number, CellView>();
  if (prev) {
    for (const p of prev.players) {
      for (const c of p.cells) prevCellMap.set(c.id, c);
    }
  }
  for (const p of cur.players) {
    for (const cell of p.cells) {
      const prevCell = prevCellMap.get(cell.id);
      const cx = prevCell ? lerp(prevCell.x, cell.x) : cell.x;
      const cy = prevCell ? lerp(prevCell.y, cell.y) : cell.y;
      const { sx, sy } = toScreen(cx, cy);
      const r = radiusForMass(cell.mass) * scale;
      drawCell(ctx, sx, sy, r, p.color, p.name, false, cell.cd, cell.prot);
    }
  }

  // Self last so own cells render on top of others overlapping. Color &
  // name come from the welcome message.
  const myColor = self?.color ?? "#9333ea";
  const myName = self?.name ?? "you";
  // Per-cell interpolation for self too.
  const prevSelfCellMap = new Map<number, CellView>();
  if (prev) {
    for (const c of prev.you.cells) prevSelfCellMap.set(c.id, c);
  }
  for (const cell of cur.you.cells) {
    const prevCell = prevSelfCellMap.get(cell.id);
    const cx = prevCell ? lerp(prevCell.x, cell.x) : cell.x;
    const cy = prevCell ? lerp(prevCell.y, cell.y) : cell.y;
    const { sx, sy } = toScreen(cx, cy);
    const r = radiusForMass(cell.mass) * scale;
    drawCell(ctx, sx, sy, r, myColor, myName, true, cell.cd, cell.prot);
  }

  // Pulses on top — expanding rings where food/cells just disappeared.
  // Prune in place so the array doesn't grow forever.
  if (pulses.length > 0) {
    const tNow = performance.now();
    let writeIdx = 0;
    for (let i = 0; i < pulses.length; i++) {
      const pulse = pulses[i];
      const age = tNow - pulse.bornAt;
      if (age >= PULSE_DURATION_MS) continue; // drop expired
      pulses[writeIdx++] = pulse;
      const t = age / PULSE_DURATION_MS;
      const alpha = 1 - t;
      const radius = (pulse.baseR * (1 + t * 1.6)) * scale;
      const { sx, sy } = toScreen(pulse.x, pulse.y);
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(2, radius), 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1.5, 3 * (1 - t * 0.5));
      ctx.strokeStyle = withAlpha(pulse.color, alpha * 0.8);
      ctx.stroke();
    }
    pulses.length = writeIdx;
  }
}

/** Mix an existing 6-digit hex colour with a 0..1 alpha into rgba(). */
function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#") && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  }
  return color;
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  label: string,
  isSelf = false,
  cooldown = 0,
  protected_ = false,
): void {
  if (r < 1) r = 1;

  // Spawn-protection halo — drawn UNDER the cell so it reads as
  // ambient glow rather than chrome. A slow 1Hz pulse signals "you
  // can't eat or be eaten right now".
  if (protected_ && r > 4) {
    const phase = (performance.now() / 1000) % 1; // 0..1 over a second
    const pulse = 0.35 + 0.45 * Math.abs(Math.sin(phase * Math.PI * 2));
    ctx.beginPath();
    ctx.arc(x, y, r * 1.45, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(3, r * 0.18);
    ctx.strokeStyle = `rgba(255, 255, 255, ${pulse.toFixed(3)})`;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = isSelf ? 3 : 2;
  ctx.strokeStyle = "#1a1812";
  ctx.stroke();

  // Cooldown arc — drawn just outside the cell border, depleting from
  // a full ring at split-time to nothing when the cell can re-merge.
  if (cooldown > 0 && r > 6) {
    const ringR = r + Math.max(2, Math.min(5, r * 0.12));
    ctx.beginPath();
    // Start at top (-pi/2) and sweep clockwise through `cooldown × 2π`.
    ctx.arc(x, y, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cooldown);
    ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.strokeStyle = "rgba(26, 24, 18, 0.55)";
    ctx.stroke();
  }

  if (label && r >= 10) {
    // Font size grows with the cell radius so the name visibly scales
    // as you grow. The shrink-to-fit pass below also tightens it down
    // so long names never poke past the cell edge.
    let font = clamp(r * 0.7, 10, 36);
    ctx.font = makeFont(font);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // If the text is wider than the cell, shrink the font until it
    // does fit (or hits the floor), with horizontal padding for the
    // cell's stroke and a tiny bit of breathing room.
    const maxWidth = r * 1.7;
    while (font > 10 && ctx.measureText(label).width > maxWidth) {
      font -= 1;
      ctx.font = makeFont(font);
    }
    ctx.lineWidth = Math.max(2, font * 0.18);
    ctx.strokeStyle = "#1a1812";
    ctx.fillStyle = "#fbf6ee";
    ctx.strokeText(label, x, y);
    ctx.fillText(label, x, y);
  }
}

function makeFont(px: number): string {
  return `${px.toFixed(1)}px ui-sans-serif, system-ui, -apple-system, "Inter", sans-serif`;
}
