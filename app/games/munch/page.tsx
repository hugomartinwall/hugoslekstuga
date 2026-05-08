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
import {
  radiusForMass,
  viewportHalfFor,
  WORLD_SIZE,
  type ClientMsg,
  type FoodView,
  type LeaderboardEntry,
  type PlayerView,
  type ProjectileView,
  type ServerMsg,
} from "@/lib/munch/protocol";

type Phase = "lobby" | "connecting" | "playing" | "dead" | "disconnected";

type Snapshot = {
  receivedAt: number;
  you: { x: number; y: number; mass: number; alive: boolean };
  players: PlayerView[];
  food: FoodView[];
  projectiles: ProjectileView[];
  leaderboard: LeaderboardEntry[];
};

type Self = { id: string; color: string; name: string };

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
  // Tracks whether a close event was triggered by the user clicking
  // Leave (so we should land on the lobby, not the disconnected screen).
  const intentRef = useRef<"connected" | "leaving">("connected");
  // Filled by the welcome message — color & name are server-assigned.
  const selfRef = useRef<Self | null>(null);

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
        setPhase("playing");
      } else if (msg.type === "state") {
        prevSnapRef.current = curSnapRef.current;
        curSnapRef.current = {
          receivedAt: performance.now(),
          you: msg.you,
          players: msg.players,
          food: msg.food,
          projectiles: msg.projectiles,
          leaderboard: msg.leaderboard,
        };
        setLeaderboard(msg.leaderboard);
        setMyMass(msg.you.mass);
        // If we just respawned, server says alive=true; flip back to playing.
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
      // If the user clicked Leave we already routed to the lobby.
      // Anything else is unexpected.
      if (intentRef.current === "leaving") {
        setPhase("lobby");
      } else {
        setPhase("disconnected");
      }
    };
    ws.onerror = () => {
      setError("Couldn't reach the server. Is it running?");
    };
  }, []);

  const disconnect = useCallback(() => {
    intentRef.current = "leaving";
    if (wsRef.current) {
      wsRef.current.close();
    }
    setPhase("lobby");
    setDeadInfo(null);
    prevSnapRef.current = null;
    curSnapRef.current = null;
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
  useEffect(() => {
    if (phase !== "playing" && phase !== "dead") return;
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const key = normaliseKey(e.key);
      if (key === null) return;
      e.preventDefault();
      keysRef.current.add(key);
      if (key === "Space") splitFlagRef.current = true;
    };
    const onUp = (e: KeyboardEvent) => {
      const key = normaliseKey(e.key);
      if (key === null) return;
      keysRef.current.delete(key);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
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
      // Reconnect from scratch
      connect(name);
      return;
    }
    // Server treats split-while-dead as a respawn intent.
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

        {(phase === "playing" || phase === "dead") && (
          <>
            <div className="relative">
              <canvas
                ref={canvasRef}
                className="card-chunk block h-[60vh] w-full rounded-[var(--radius-card)] bg-cream"
                tabIndex={0}
              />
              <Leaderboard
                entries={leaderboard}
                myMass={Math.floor(myMass)}
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
            <Help />
          </>
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
      <p className="font-display text-2xl font-extrabold">A small map. Smaller blobs.</p>
      <p className="text-sm text-ink-soft">
        Eat the dots. Eat the smaller players. Avoid the bigger ones.
        Press <Kbd>Space</Kbd> to fire half of yourself forward as a weapon.
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
          Bigger = slower, but you see further. Splitting halves you and shoots
          one half forward — a desperate move with a real cost.
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
    <div className="absolute inset-0 flex items-center justify-center rounded-[var(--radius-card)] bg-ink/70 p-4">
      <div className="card-chunk flex max-w-md flex-col items-center gap-3 rounded-[var(--radius-card)] bg-cream p-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Eaten
          {killer ? ` by ${killer}` : ""}
        </p>
        <p className="font-display text-5xl font-extrabold tabular-nums">
          {score}
        </p>
        <p className="text-sm text-ink-soft">final mass</p>
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
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Help / footer                                                        */
/* ------------------------------------------------------------------ */

function Help() {
  return (
    <p className="text-xs text-ink-muted">
      Multiplayer in real-time on a single shared map. The server is
      authoritative — what you see is what everyone sees, give or take a
      tick. No accounts, no chat. Beating the high score on the
      leaderboard is the only thing being recorded, and even that resets
      when the room empties.
    </p>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-ink-muted bg-cream-deep px-1.5 py-0.5 font-mono text-[11px] uppercase">
      {children}
    </kbd>
  );
}

/* ------------------------------------------------------------------ */
/* Render utilities                                                     */
/* ------------------------------------------------------------------ */

function normaliseKey(k: string): string | null {
  if (k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight") {
    return k;
  }
  if (k === " " || k === "Spacebar" || k === "Space") return "Space";
  // WASD as a polite alternative.
  if (k === "w" || k === "W") return "ArrowUp";
  if (k === "s" || k === "S") return "ArrowDown";
  if (k === "a" || k === "A") return "ArrowLeft";
  if (k === "d" || k === "D") return "ArrowRight";
  return null;
}

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
  // Background grid for depth perception.
  ctx.fillStyle = "#fbf6ee";
  ctx.fillRect(0, 0, w, h);

  if (!cur) return;

  // Interpolation: blend between prev and cur snapshots based on time
  // since cur arrived. Server snapshots ~50ms apart, so we lag rendering
  // by ~50ms to interpolate cleanly.
  const SNAP_GAP = 50;
  const now = performance.now();
  const t = prev ? Math.min(1, (now - cur.receivedAt) / SNAP_GAP) : 1;
  const lerp = (a: number, b: number) => a + (b - a) * t;

  const myCx = prev ? lerp(prev.you.x, cur.you.x) : cur.you.x;
  const myCy = prev ? lerp(prev.you.y, cur.you.y) : cur.you.y;

  // Camera & zoom from current mass.
  const { hx } = viewportHalfFor(cur.you.mass);
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

  // World bounds (a thick border to show map edges).
  ctx.strokeStyle = "#1a1812";
  ctx.lineWidth = 4;
  const tl = toScreen(0, 0);
  const br = toScreen(WORLD_SIZE, WORLD_SIZE);
  ctx.strokeRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);

  // Food — minimum visual radius so dots are obviously edible.
  for (const f of cur.food) {
    const { sx, sy } = toScreen(f.x, f.y);
    if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(4, radiusForMass(1) * scale), 0, Math.PI * 2);
    ctx.fill();
  }

  // Projectiles (interpolated by id if present in prev).
  const prevProjMap = new Map<number, ProjectileView>();
  if (prev) {
    for (const p of prev.projectiles) prevProjMap.set(p.id, p);
  }
  for (const proj of cur.projectiles) {
    const pPrev = prevProjMap.get(proj.id);
    const px = pPrev ? lerp(pPrev.x, proj.x) : proj.x;
    const py = pPrev ? lerp(pPrev.y, proj.y) : proj.y;
    const { sx, sy } = toScreen(px, py);
    const r = radiusForMass(proj.mass) * scale;
    drawCell(ctx, sx, sy, r, proj.color, "");
  }

  // Other players (interpolated by id).
  const prevPlayerMap = new Map<string, PlayerView>();
  if (prev) {
    for (const p of prev.players) prevPlayerMap.set(p.id, p);
  }
  for (const p of cur.players) {
    const pPrev = prevPlayerMap.get(p.id);
    const px = pPrev ? lerp(pPrev.x, p.x) : p.x;
    const py = pPrev ? lerp(pPrev.y, p.y) : p.y;
    const { sx, sy } = toScreen(px, py);
    const r = radiusForMass(p.mass) * scale;
    drawCell(ctx, sx, sy, r, p.color, p.name);
  }

  // Self last so the name draws on top. Color & name come from the
  // welcome message, not the snapshot (which excludes self).
  const r = radiusForMass(cur.you.mass) * scale;
  const { sx, sy } = toScreen(myCx, myCy);
  drawCell(
    ctx,
    sx,
    sy,
    r,
    self?.color ?? "#9333ea",
    self?.name ?? "you",
    true,
  );
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  label: string,
  isSelf = false,
): void {
  if (r < 1) r = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = isSelf ? 3 : 2;
  ctx.strokeStyle = "#1a1812";
  ctx.stroke();
  if (label && r > 14) {
    ctx.fillStyle = "#fbf6ee";
    ctx.strokeStyle = "#1a1812";
    ctx.lineWidth = 3;
    ctx.font = `${Math.min(20, Math.max(11, r / 2.2))}px ui-sans-serif, system-ui, -apple-system, "Inter", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeText(label, x, y);
    ctx.fillText(label, x, y);
  }
}

