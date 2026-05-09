"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

const STORAGE_KEY = "hugoslekstuga:roll:options";
const WITHOUT_REPLACEMENT_KEY = "hugoslekstuga:roll:without-replacement";

const SLICE_COLORS = [
  { fill: "#ff5a3c", text: "#fbf6ee" }, // tomato
  { fill: "#ffc233", text: "#1a1812" }, // yellow
  { fill: "#4f66f2", text: "#fbf6ee" }, // blue
  { fill: "#ff7ab2", text: "#1a1812" }, // pink
  { fill: "#3fa66e", text: "#fbf6ee" }, // green
  { fill: "#9333ea", text: "#fbf6ee" }, // purple
  { fill: "#f97316", text: "#fbf6ee" }, // orange
  { fill: "#0d9488", text: "#fbf6ee" }, // teal
];

const SAMPLE_OPTIONS = `Indian
Italian
Sushi
Tacos
Cook at home`;

export default function RollPage() {
  const tool = findTool("roll")!;
  const [raw, setRaw] = useLocalStorageState<string>(STORAGE_KEY, "");
  const [withoutReplacement, setWithoutReplacement] =
    useLocalStorageState<boolean>(WITHOUT_REPLACEMENT_KEY, false);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<number | null>(null);
  /** Indices of slices already won in without-replacement mode. */
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const wheelRef = useRef<SVGGElement>(null);

  const options = useMemo(
    () =>
      raw
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    [raw],
  );

  const eligibleIdxs = useMemo(
    () =>
      withoutReplacement
        ? options.map((_, i) => i).filter((i) => !removed.has(i))
        : options.map((_, i) => i),
    [options, removed, withoutReplacement],
  );

  const canSpin = eligibleIdxs.length >= 1 && options.length >= 2;

  const spin = useCallback(() => {
    if (!canSpin || spinning) return;
    const n = options.length;
    const step = 360 / n;
    // Pick from the eligible pool (i.e. respecting without-replacement) but
    // rotate to that absolute slice index so the visual is honest.
    const eligible = eligibleIdxs;
    const idx = eligible[Math.floor(Math.random() * eligible.length)];
    const winnerCenter = (idx + 0.5) * step;
    // Rotate so winnerCenter ends at 0 (top, where the pointer sits).
    const targetMod = ((360 - winnerCenter) % 360 + 360) % 360;
    const currentMod = ((rotation % 360) + 360) % 360;
    let delta = targetMod - currentMod;
    if (delta <= 0) delta += 360;
    const finalRotation = rotation + 360 * 5 + delta;
    setRotation(finalRotation);
    setSpinning(true);
    setWinner(null);
    // Reveal winner once the transition completes.
    window.setTimeout(() => {
      setWinner(idx);
      setSpinning(false);
      if (withoutReplacement) {
        setRemoved((prev) => {
          const next = new Set(prev);
          next.add(idx);
          return next;
        });
      }
    }, 4100);
  }, [canSpin, spinning, options.length, rotation, eligibleIdxs, withoutReplacement]);

  const resetRemoved = useCallback(() => {
    setRemoved(new Set());
    setWinner(null);
  }, []);

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
                : withoutReplacement
                  ? `${eligibleIdxs.length} of ${options.length} left.`
                  : `${options.length} option${options.length === 1 ? "" : "s"} ready.`}
          </p>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={withoutReplacement}
              onChange={(e) => {
                setWithoutReplacement(e.target.checked);
                if (!e.target.checked) resetRemoved();
              }}
              className="h-4 w-4 accent-orange"
            />
            <span className="font-semibold">Remove winners as they spin</span>
          </label>

          {withoutReplacement && removed.size > 0 && (
            <button
              type="button"
              onClick={resetRemoved}
              className="self-start text-xs font-semibold text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Put everyone back ({removed.size} removed)
            </button>
          )}
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
                    dimmed={removed.has(i)}
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
            </svg>
          </div>

          <button
            type="button"
            onClick={spin}
            disabled={!canSpin || spinning}
            className="btn-chunk rounded-[var(--radius-button)] bg-orange px-7 py-3 font-display text-lg font-extrabold text-cream disabled:cursor-not-allowed disabled:opacity-50"
          >
            {spinning ? "Spinning…" : "Spin!"}
          </button>

          <div className="flex min-h-[3rem] items-center justify-center text-center">
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
  dimmed = false,
}: {
  cx: number;
  cy: number;
  r: number;
  total: number;
  index: number;
  label: string;
  color: { fill: string; text: string };
  dimmed?: boolean;
}) {
  const groupOpacity = dimmed ? 0.32 : 1;
  if (total === 1) {
    return (
      <g opacity={groupOpacity}>
        <circle cx={cx} cy={cy} r={r} fill={color.fill} />
        <text
          x={cx}
          y={cy + 6}
          fontFamily="var(--font-display)"
          fontWeight="800"
          fontSize="22"
          fill={color.text}
          textAnchor="middle"
          textDecoration={dimmed ? "line-through" : undefined}
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

  // Label sits along the slice radius, rotated to read outward (along the bisector).
  // For slices on the bottom half, flip 180° so the text stays right-side up.
  const midAngle = startAngle + step / 2;
  const flip = midAngle > 90 && midAngle < 270;
  const textRotation = flip ? midAngle + 180 : midAngle;
  const labelR = r * 0.62;
  const labelPos = polar(cx, cy, labelR, midAngle);
  const fontSize = total <= 4 ? 22 : total <= 6 ? 18 : total <= 9 ? 14 : 11;
  const maxChars = total <= 4 ? 14 : total <= 6 ? 12 : total <= 9 ? 10 : 8;

  return (
    <g opacity={groupOpacity}>
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
        textDecoration={dimmed ? "line-through" : undefined}
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
