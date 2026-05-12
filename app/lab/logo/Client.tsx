"use client";

import { useEffect, useRef, useState } from "react";

/* ----------------------------------------------------------------------------
   Shared
   ---------------------------------------------------------------------------- */

const DOT_COLOR_VARS = [
  "var(--color-tomato)",
  "var(--color-blue)",
  "var(--color-yellow)",
  "var(--color-pink)",
  "var(--color-green)",
  "var(--color-purple)",
  "var(--color-orange)",
  "var(--color-teal)",
];

const DOT_COLOR_NAMES = [
  "tomato",
  "blue",
  "yellow",
  "pink",
  "green",
  "purple",
  "orange",
  "teal",
];

/* ----------------------------------------------------------------------------
   Direction 1 — dot-as-character
   ---------------------------------------------------------------------------- */

/**
 * A coloured disc that:
 *   - sits like a period at the end of the wordmark (the size prop
 *     lets a parent fit it to wordmark x-height)
 *   - cycles colour on click (touch parity with the existing nav dot)
 *   - opens two tiny cream eyes when the cursor passes within
 *     `proximityPx` pixels of its centre; on touch, the eyes pop on
 *     tap and stay until next tap
 *   - bounces on click with the spring easing the existing nav dot
 *     already uses
 *
 * This is the prototype for "dot-as-character". The shipped version
 * would integrate with `lib/use-local-storage-state` so colour stays in
 * sync with the nav + footer, but for the lab page each instance owns
 * its own colour so the two prototypes don't pull on each other.
 */
function CharacterDot({
  size = 18,
  proximityPx = 60,
  initialColorIdx = 0,
  ariaLabel = "Cycle accent colour",
}: {
  size?: number;
  proximityPx?: number;
  initialColorIdx?: number;
  ariaLabel?: string;
}) {
  const [colorIdx, setColorIdx] = useState(initialColorIdx);
  const [eyesVisible, setEyesVisible] = useState(false);
  const [bouncing, setBouncing] = useState(false);
  const dotRef = useRef<HTMLButtonElement>(null);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onMove = (e: MouseEvent) => {
      const node = dotRef.current;
      if (!node) return;
      const r = node.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.hypot(e.clientX - cx, e.clientY - cy);
      if (d < proximityPx) {
        setEyesVisible(true);
        if (hideTimerRef.current) {
          window.clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
      } else {
        if (hideTimerRef.current) return;
        hideTimerRef.current = window.setTimeout(() => {
          setEyesVisible(false);
          hideTimerRef.current = null;
        }, 600);
      }
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [proximityPx]);

  const onClick = () => {
    // Tap-to-toggle-eyes on touch; cycle colour on every interaction
    // so the existing colour-cycling behaviour stays.
    setColorIdx((i) => (i + 1) % DOT_COLOR_VARS.length);
    setEyesVisible((v) => !v);
    setBouncing(true);
    window.setTimeout(() => setBouncing(false), 280);
  };

  return (
    <button
      type="button"
      ref={dotRef}
      onClick={onClick}
      aria-label={ariaLabel}
      style={{
        position: "relative",
        display: "inline-block",
        width: size,
        height: size,
        background: DOT_COLOR_VARS[colorIdx],
        borderRadius: "9999px",
        border: "none",
        padding: 0,
        cursor: "pointer",
        transform: bouncing ? "scale(1.4)" : undefined,
        transition: bouncing
          ? "transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1), background 220ms ease"
          : "transform 180ms ease, background 220ms ease",
        verticalAlign: "baseline",
        animation: bouncing
          ? "none"
          : "brand-dot-breathe 3.4s ease-in-out infinite",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: size * 0.16,
          opacity: eyesVisible ? 1 : 0,
          transition: "opacity 220ms ease",
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: size * 0.2,
            height: size * 0.2,
            borderRadius: "9999px",
            background: "var(--color-cream)",
          }}
        />
        <span
          style={{
            display: "inline-block",
            width: size * 0.2,
            height: size * 0.2,
            borderRadius: "9999px",
            background: "var(--color-cream)",
          }}
        />
      </span>
    </button>
  );
}

/* ----------------------------------------------------------------------------
   Direction 2 — evolved mark
   ---------------------------------------------------------------------------- */

/**
 * The same coloured-disc base, but with a small cream window cut into
 * the lower-right quadrant. Reads as "object with a window" — gestures
 * at the *lekstuga* / playhouse meaning without being a literal house.
 *
 *   - cycles colour on click (same as the character dot)
 *   - no proximity behaviour, no breathing — the *shape* carries the
 *     identity load
 *   - the window stays cream regardless of the disc colour, so the
 *     mark reads at 16px in a tab without losing its silhouette
 */
function EvolvedMark({
  size = 22,
  initialColorIdx = 0,
  ariaLabel = "Cycle accent colour",
}: {
  size?: number;
  initialColorIdx?: number;
  ariaLabel?: string;
}) {
  const [colorIdx, setColorIdx] = useState(initialColorIdx);
  const [bouncing, setBouncing] = useState(false);

  const onClick = () => {
    setColorIdx((i) => (i + 1) % DOT_COLOR_VARS.length);
    setBouncing(true);
    window.setTimeout(() => setBouncing(false), 280);
  };

  // The window is a square positioned in the lower-right quadrant.
  // Size scales with disc so it stays proportional at any rendering.
  const win = size * 0.26;
  const winOffset = size * 0.2;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      style={{
        position: "relative",
        display: "inline-block",
        width: size,
        height: size,
        background: DOT_COLOR_VARS[colorIdx],
        borderRadius: "9999px",
        border: "none",
        padding: 0,
        cursor: "pointer",
        transform: bouncing ? "scale(1.25)" : undefined,
        transition: bouncing
          ? "transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1), background 220ms ease"
          : "transform 180ms ease, background 220ms ease",
        verticalAlign: "baseline",
        overflow: "hidden",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          right: winOffset,
          bottom: winOffset,
          width: win,
          height: win,
          background: "var(--color-cream)",
          borderRadius: 2,
        }}
      />
    </button>
  );
}

/* ----------------------------------------------------------------------------
   Lockup previews — the wordmark + the dot/mark, at three sizes
   ---------------------------------------------------------------------------- */

function LockupRow({
  mark,
  label,
}: {
  mark: (size: number) => React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-6">
        <div className="flex items-baseline gap-1 font-display text-5xl font-extrabold tracking-tight">
          <span>hugoslekstuga</span>
          {mark(18)}
        </div>
        <div className="flex items-baseline gap-1 font-display text-2xl font-extrabold tracking-tight">
          <span>hugoslekstuga</span>
          {mark(10)}
        </div>
        <div className="flex items-baseline gap-1 font-display text-base font-extrabold tracking-tight">
          <span>hugoslekstuga</span>
          {mark(7)}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Icon previews — favicon-sized samples on cream + on ink
   ---------------------------------------------------------------------------- */

function IconRow({
  mark,
  label,
}: {
  mark: (size: number) => React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <div className="flex items-center gap-3">
        {[16, 32, 64, 128].map((s) => (
          <div
            key={`light-${s}`}
            className="flex items-center justify-center rounded-md border-2 border-ink bg-cream"
            style={{ width: s + 16, height: s + 16 }}
          >
            {mark(s)}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        {[16, 32, 64, 128].map((s) => (
          <div
            key={`dark-${s}`}
            className="flex items-center justify-center rounded-md border-2 border-ink bg-ink"
            style={{ width: s + 16, height: s + 16 }}
          >
            {mark(s)}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   OG image preview — a representation of the share card
   ---------------------------------------------------------------------------- */

function OGCardPreview({
  mark,
}: {
  mark: (size: number) => React.ReactNode;
}) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-[var(--radius-card)] border-2 border-ink bg-cream"
      style={{ aspectRatio: "1200 / 630" }}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex items-end font-display text-[clamp(2rem,8vw,7rem)] font-extrabold leading-none tracking-tight">
          <span>hugoslekstuga</span>
          <span className="ml-2">{mark(28)}</span>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   The page
   ---------------------------------------------------------------------------- */

export default function Client() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
      <header className="flex flex-col gap-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Lab · logo directions
        </p>
        <h1 className="font-display text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl">
          Two ways the dot levels up.
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-ink-soft sm:text-lg">
          Direction 1 keeps the dot a coloured period but gives it{" "}
          <span className="font-semibold text-ink">behaviour</span> — it
          opens eyes when you mouse near it, it breathes idle, and (later)
          it&rsquo;ll travel to the nav when you click a tool on the swarm.
          Direction 2 trades behaviour for{" "}
          <span className="font-semibold text-ink">shape</span> — the dot
          becomes a coloured disc with a small cream window cut out, more
          obviously a mark. Click any dot or mark to cycle its colour.
        </p>
      </header>

      <div className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* ----------------------------------------------------------------
            Direction 1
            ---------------------------------------------------------------- */}
        <section className="card-chunk flex flex-col gap-10 rounded-[var(--radius-card)] bg-cream p-7 sm:p-9">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Direction 1 · recommended
            </p>
            <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
              Dot-as-character
            </h2>
            <p className="text-sm leading-relaxed text-ink-soft">
              Form unchanged. The dot earns its identity by{" "}
              <span className="font-semibold text-ink">how it acts</span>{" "}
              across the site — proximity eyes, idle breathing, travel
              between routes. Reads as a period at a glance and as a
              resident on second look.
            </p>
          </div>

          <LockupRow
            label="Wordmark lockup"
            mark={(s) => <CharacterDot size={s} initialColorIdx={0} />}
          />

          <IconRow
            label="Favicon · 16 / 32 / 64 / 128 px"
            mark={(s) => <CharacterDot size={s} initialColorIdx={0} />}
          />

          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Share card
            </p>
            <OGCardPreview
              mark={(s) => <CharacterDot size={s} initialColorIdx={0} />}
            />
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Try it
            </p>
            <div className="rounded-[var(--radius-card)] border-2 border-dashed border-ink bg-cream-deep p-6 sm:p-8">
              <p className="mb-5 text-sm leading-relaxed text-ink-soft">
                Move your cursor near the dot below. Click it to cycle
                colour. On touch, tap to toggle the eyes and cycle colour
                together.
              </p>
              <div className="flex items-baseline gap-2 font-display text-5xl font-extrabold tracking-tight">
                <span>hugoslekstuga</span>
                <CharacterDot size={22} initialColorIdx={0} />
              </div>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------------------
            Direction 2
            ---------------------------------------------------------------- */}
        <section className="card-chunk flex flex-col gap-10 rounded-[var(--radius-card)] bg-cream p-7 sm:p-9">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Direction 2 · foil
            </p>
            <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
              Evolved mark
            </h2>
            <p className="text-sm leading-relaxed text-ink-soft">
              The dot becomes a coloured disc with a small cream window.
              Reads as an{" "}
              <span className="font-semibold text-ink">object</span> rather
              than punctuation — a tiny architectural cue at the *lekstuga*
              meaning without being a literal house.
            </p>
          </div>

          <LockupRow
            label="Wordmark lockup"
            mark={(s) => <EvolvedMark size={s} initialColorIdx={0} />}
          />

          <IconRow
            label="Favicon · 16 / 32 / 64 / 128 px"
            mark={(s) => <EvolvedMark size={s} initialColorIdx={0} />}
          />

          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Share card
            </p>
            <OGCardPreview
              mark={(s) => <EvolvedMark size={s} initialColorIdx={0} />}
            />
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Try it
            </p>
            <div className="rounded-[var(--radius-card)] border-2 border-dashed border-ink bg-cream-deep p-6 sm:p-8">
              <p className="mb-5 text-sm leading-relaxed text-ink-soft">
                Click to cycle through all eight accent colours. The
                window stays cream so the silhouette holds at any scale.
              </p>
              <div className="flex items-baseline gap-2 font-display text-5xl font-extrabold tracking-tight">
                <span>hugoslekstuga</span>
                <EvolvedMark size={26} initialColorIdx={0} />
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Palette swatches — all eight accents on both directions, so
          we can see how each mark holds across colours. */}
      <section className="mt-12 card-chunk rounded-[var(--radius-card)] bg-cream p-7 sm:p-9">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Across the palette
          </p>
          <h2 className="font-display text-2xl font-extrabold tracking-tight">
            Same wordmark, eight colours.
          </h2>
          <p className="text-sm leading-relaxed text-ink-soft">
            The colour-cycling behaviour is preserved in both directions.
            Here&rsquo;s every accent for each, so we can compare how the
            mark reads at the full range.
          </p>
        </div>
        <div className="mt-7 grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Direction 1
            </p>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-3">
              {DOT_COLOR_NAMES.map((_, i) => (
                <div
                  key={i}
                  className="flex items-baseline gap-1 font-display text-2xl font-extrabold tracking-tight"
                >
                  <span>hugoslekstuga</span>
                  <CharacterDot size={11} initialColorIdx={i} />
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Direction 2
            </p>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-3">
              {DOT_COLOR_NAMES.map((_, i) => (
                <div
                  key={i}
                  className="flex items-baseline gap-1 font-display text-2xl font-extrabold tracking-tight"
                >
                  <span>hugoslekstuga</span>
                  <EvolvedMark size={13} initialColorIdx={i} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
