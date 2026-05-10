"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

const STORAGE_KEY = "hugoslekstuga:roll:options";
const RECENT_KEY = "hugoslekstuga:roll:recent";

const SLICE_COLORS = [
  { fill: "#ff5a3c", text: "#fbf6ee" }, // tomato
  { fill: "#ffc233", text: "#1a1812" }, // yellow
  { fill: "#4f66f2", text: "#fbf6ee" }, // blue
  { fill: "#ff7ab2", text: "#1a1812" }, // pink
  { fill: "#2bb37c", text: "#fbf6ee" }, // green
  { fill: "#9333ea", text: "#fbf6ee" }, // purple
  { fill: "#fb923c", text: "#fbf6ee" }, // orange
  { fill: "#14b8a6", text: "#fbf6ee" }, // teal
];

const SAMPLE_OPTIONS = `Indian
Italian
Sushi
Tacos
Cook at home`;

const EMPTY_RECENT: string[] = [];

/* -------------------------------------------------------------------------
 * Confetti — lightweight RAF-driven particles rendered inside the wheel SVG.
 * Emitted from just below the pointer when the wheel lands; gravity pulls
 * them down and they fade out. Honours prefers-reduced-motion (skipped).
 * -----------------------------------------------------------------------*/

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
};

const PARTICLE_COUNT = 18;
const PARTICLE_FRICTION = 0.93;
const PARTICLE_GRAVITY = 0.18;
const PARTICLE_LIFE_DECAY = 0.022;

export default function RollPage() {
  const tool = findTool("roll")!;
  const [raw, setRaw] = useLocalStorageState<string>(STORAGE_KEY, "");
  const [recent, setRecent] = useLocalStorageState<string[]>(RECENT_KEY, EMPTY_RECENT);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<number | null>(null);
  const wheelRef = useRef<SVGGElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);
  const [, tickParticles] = useState(0);
  const reduceMotionRef = useRef(false);

  // Detect prefers-reduced-motion once and on changes — skip confetti when set.
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

  const options = useMemo(
    () =>
      raw
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    [raw],
  );

  const canSpin = options.length >= 2;

  const startConfettiLoop = useCallback(() => {
    if (rafRef.current !== null) return;
    const loop = () => {
      const ps = particlesRef.current;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= PARTICLE_FRICTION;
        p.vy = p.vy * PARTICLE_FRICTION + PARTICLE_GRAVITY;
        p.life -= PARTICLE_LIFE_DECAY;
        if (p.life <= 0) ps.splice(i, 1);
      }
      tickParticles((c) => c + 1);
      if (ps.length > 0) {
        rafRef.current = requestAnimationFrame(loop);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const burstConfetti = useCallback(
    (color: string) => {
      if (reduceMotionRef.current) return;
      // Origin: just below the pointer (200, 8) where the winner sits.
      const ox = 200;
      const oy = 36;
      const ps = particlesRef.current;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const angle =
          (i / PARTICLE_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
        const speed = 2.5 + Math.random() * 4;
        ps.push({
          x: ox,
          y: oy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 2.4,
          life: 1,
          color,
          size: 3 + Math.random() * 4,
        });
      }
      startConfettiLoop();
    },
    [startConfettiLoop],
  );

  // Cleanup the RAF on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const spin = useCallback(() => {
    if (!canSpin || spinning) return;
    const n = options.length;
    const step = 360 / n;
    const idx = Math.floor(Math.random() * n);
    const winnerCenter = (idx + 0.5) * step;
    const targetMod = ((360 - winnerCenter) % 360 + 360) % 360;
    const currentMod = ((rotation % 360) + 360) % 360;
    let delta = targetMod - currentMod;
    if (delta <= 0) delta += 360;
    const finalRotation = rotation + 360 * 5 + delta;
    setRotation(finalRotation);
    setSpinning(true);
    setWinner(null);
    window.setTimeout(() => {
      setWinner(idx);
      setSpinning(false);
      const winningOption = options[idx];
      const winningColor = SLICE_COLORS[idx % SLICE_COLORS.length].fill;
      burstConfetti(winningColor);
      setRecent((prev) => [winningOption, ...prev].slice(0, 5));
    }, 4100);
  }, [canSpin, spinning, options, rotation, burstConfetti, setRecent]);

  // Spacebar to spin (when not focused on the textarea).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      spin();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spin]);

  return (
    <ToolFrame tool={tool}>
      <div className="grid grid-cols-1 gap-8 md:grid-cols-[1fr_1fr] md:gap-10">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <label
              htmlFor="roll-options"
              className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
            >
              Options (one per line)
            </label>
            <button
              type="button"
              onClick={() => setRaw(SAMPLE_OPTIONS)}
              className="text-xs font-semibold text-orange underline-offset-2 hover:underline"
            >
              try a sample
            </button>
          </div>
          <textarea
            id="roll-options"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={8}
            placeholder="Pizza&#10;Sushi&#10;Tacos&#10;Cook at home"
            className="card-chunk min-h-[12rem] rounded-[var(--radius-card)] bg-cream px-4 py-3 font-mono text-sm leading-relaxed text-ink placeholder:text-ink-muted focus:outline-none"
          />
          <p className="text-xs text-ink-muted">
            {options.length === 0
              ? "Add at least two options to spin."
              : options.length === 1
                ? "Add one more option to spin."
                : `${options.length} option${options.length === 1 ? "" : "s"} ready.`}
          </p>
        </div>

        <div className="flex flex-col items-center gap-5">
          <div className="relative aspect-square w-full max-w-sm">
            <svg
              viewBox="0 0 400 400"
              className="h-full w-full"
              role="img"
              aria-label="Decision wheel"
            >
              <circle
                cx="200"
                cy="200"
                r="186"
                fill="none"
                stroke="#1a1812"
                strokeWidth="6"
              />
              <g
                ref={wheelRef}
                style={{
                  transformOrigin: "200px 200px",
                  transform: `rotate(${rotation}deg)`,
                  transition: spinning
                    ? "transform 4s cubic-bezier(0.18, 0.65, 0.18, 1)"
                    : "none",
                }}
              >
                {options.length === 0 && (
                  <circle cx="200" cy="200" r="180" fill="#fbf6ee" />
                )}
                {options.map((opt, i) => (
                  <Slice
                    key={`${opt}-${i}`}
                    cx={200}
                    cy={200}
                    r={180}
                    total={options.length}
                    index={i}
                    label={opt}
                    color={SLICE_COLORS[i % SLICE_COLORS.length]}
                  />
                ))}
              </g>
              {/* Pointer */}
              <polygon
                points="200,8 184,40 216,40"
                fill="#1a1812"
                stroke="#fbf6ee"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              {/* Center cap */}
              <circle
                cx="200"
                cy="200"
                r="22"
                fill="#fbf6ee"
                stroke="#1a1812"
                strokeWidth="4"
              />
              {/* Confetti — drawn over everything except the cap. The
                  ref holds an animation buffer that mutates each RAF tick;
                  re-renders are gated by tickParticles. Reading the ref in
                  render is intentional and matches the project's particle
                  pattern (see eslint.config.mjs comment on react-hooks/refs). */}
              {/* eslint-disable react-hooks/refs */}
              <g pointerEvents="none">
                {particlesRef.current.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={p.size * Math.max(0, p.life)}
                    fill={p.color}
                    stroke="#1a1812"
                    strokeWidth={1}
                    opacity={Math.max(0, p.life)}
                  />
                ))}
              </g>
              {/* eslint-enable react-hooks/refs */}
            </svg>
          </div>

          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={spin}
              disabled={!canSpin || spinning}
              className="btn-chunk rounded-[var(--radius-button)] bg-orange px-7 py-3 font-display text-lg font-extrabold text-cream disabled:cursor-not-allowed disabled:opacity-50"
            >
              {spinning ? "Spinning…" : "Spin!"}
            </button>
            <span className="hidden items-center gap-1 text-xs text-ink-muted sm:inline-flex">
              or press
              <kbd className="rounded border border-ink-muted bg-cream-deep px-1.5 py-0.5 font-mono text-[11px] uppercase">
                Space
              </kbd>
            </span>
          </div>

          <div className="flex min-h-[3rem] flex-col items-center gap-3 text-center">
            {winner !== null && !spinning && (
              <div className="fade-rise rounded-[var(--radius-card)] border-2 border-ink bg-orange-soft px-4 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  And the winner is
                </p>
                <p className="font-display text-2xl font-extrabold tracking-tight">
                  {options[winner]}
                </p>
              </div>
            )}
            {options.length === 0 && (
              <p className="text-sm text-ink-muted">
                The wheel awaits options.
              </p>
            )}
            {recent.length > 1 && (
              <div className="flex flex-col items-center gap-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  Recent
                </p>
                <ol className="flex flex-wrap justify-center gap-1.5">
                  {recent.slice(1).map((w, i) => (
                    <li
                      key={`${w}-${i}`}
                      className="rounded-full border-2 border-ink bg-cream px-2 py-0.5 text-xs font-semibold"
                    >
                      {w}
                    </li>
                  ))}
                </ol>
                <button
                  type="button"
                  onClick={() => setRecent(EMPTY_RECENT)}
                  className="text-[11px] font-semibold text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                >
                  clear
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </ToolFrame>
  );
}

function Slice({
  cx,
  cy,
  r,
  total,
  index,
  label,
  color,
}: {
  cx: number;
  cy: number;
  r: number;
  total: number;
  index: number;
  label: string;
  color: { fill: string; text: string };
}) {
  if (total === 1) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={r} fill={color.fill} />
        <text
          x={cx}
          y={cy + 6}
          fontFamily="var(--font-display)"
          fontWeight="800"
          fontSize="22"
          fill={color.text}
          textAnchor="middle"
        >
          {truncate(label, 18)}
        </text>
      </g>
    );
  }

  const step = 360 / total;
  const startAngle = index * step;
  const endAngle = (index + 1) * step;
  const start = polar(cx, cy, r, startAngle);
  const end = polar(cx, cy, r, endAngle);
  const largeArc = step > 180 ? 1 : 0;
  const path = `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;

  // Label sits along the slice radius, rotated to read outward.
  // Slices on the bottom half flip 180° so the text stays right-side up.
  const midAngle = startAngle + step / 2;
  const flip = midAngle > 90 && midAngle < 270;
  const textRotation = flip ? midAngle + 180 : midAngle;
  const labelR = r * 0.62;
  const labelPos = polar(cx, cy, labelR, midAngle);
  const fontSize = total <= 4 ? 22 : total <= 6 ? 18 : total <= 9 ? 14 : 11;
  const maxChars = total <= 4 ? 14 : total <= 6 ? 12 : total <= 9 ? 10 : 8;

  return (
    <g>
      <path d={path} fill={color.fill} stroke="#1a1812" strokeWidth="2" />
      <text
        x={labelPos.x}
        y={labelPos.y}
        fontFamily="var(--font-display)"
        fontWeight="800"
        fontSize={fontSize}
        fill={color.text}
        textAnchor="middle"
        dominantBaseline="middle"
        transform={`rotate(${textRotation} ${labelPos.x} ${labelPos.y})`}
      >
        {truncate(label, maxChars)}
      </text>
    </g>
  );
}

function polar(
  cx: number,
  cy: number,
  r: number,
  angleDeg: number,
): { x: number; y: number } {
  // angleDeg=0 points up; clockwise increasing.
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
