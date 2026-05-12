"use client";

import { useEffect, useRef, useState } from "react";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

const DOT_COLORS = [
  "var(--color-tomato)",
  "var(--color-blue)",
  "var(--color-yellow)",
  "var(--color-pink)",
  "var(--color-green)",
  "var(--color-purple)",
  "var(--color-orange)",
  "var(--color-teal)",
];

const DOT_KEY = "hugoslekstuga:dot-color";
/**
 * Proximity threshold scales with the rendered dot size — bigger dot,
 * more breathing room around it that triggers the eyes; smaller dot,
 * tighter trigger area so the eyes don't pop on every cursor move.
 * 4× the dot diameter feels right across mobile (14px → 56px reach)
 * and desktop (17px → 68px reach). Floored at 40 so a vanishingly
 * small dot still has some catchment.
 */
const PROXIMITY_RATIO = 4;
const PROXIMITY_FLOOR_PX = 40;
const EYES_HIDE_DELAY_MS = 600;

/**
 * The brand dot. Internally we call him **Hugo** — a small coloured
 * disc that lives in the wordmark, in the nav corner of every tool
 * page, and (when a tool is clicked) travels up from the swarm into
 * the nav. The character of the brand carried by behaviour, not shape.
 *
 *   - Form: a circle sized at 0.7em so it scales with the wordmark's
 *     font-size. Sits next to the last letter like a period that
 *     learned to draw itself.
 *   - Behaviour: two tiny cream eyes appear when the cursor passes
 *     close (interactive variant only). On touch, tapping the dot
 *     toggles the eyes *and* cycles colour together — same atom, two
 *     affordances. Idle breathing stays.
 *   - State: the chosen colour persists in `hugoslekstuga:dot-color`
 *     so the nav, footer, tool-page corner dot, and back-link dot
 *     all stay in sync.
 *   - `data-brand-dot` is set so the TravelingDot in the root layout
 *     can find the nav dot to fly the swarm hand-off into.
 *   - `data-name="hugo"` is set for the same Easter-egg reason a code
 *     character would have a name: the dot is Hugo. Never surfaced in
 *     user copy, only in DevTools for anyone curious enough to look.
 */
export default function BrandDot({
  interactive = false,
}: {
  interactive?: boolean;
}) {
  const [dotIdx, setDotIdx] = useLocalStorageState<number>(DOT_KEY, 0);
  const [bouncing, setBouncing] = useState(false);
  const [eyesVisible, setEyesVisible] = useState(false);
  // True while Hugo is on a fetch-and-return trip (initiated by clicking
  // a tool on the homepage swarm). The canvas-rendered traveling dot in
  // the root layout draws Hugo during this window; we hide the real
  // nav dot so there aren't two dots stacked on top of each other.
  const [traveling, setTraveling] = useState(false);
  // True for the ~100ms an idle blink lasts. Only fires while eyes are
  // already visible; adds a beat of life so a held-open gaze doesn't
  // feel like a statue.
  const [blinking, setBlinking] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const hideTimerRef = useRef<number | null>(null);

  const safeIdx =
    Number.isFinite(dotIdx) && dotIdx >= 0 && dotIdx < DOT_COLORS.length
      ? dotIdx
      : 0;
  const color = DOT_COLORS[safeIdx];

  // Idle-blink scheduler — runs only while eyes are visible. Every
  // 4-7s, briefly close the eyes for ~100ms then open them again.
  // Close transition is fast (60ms ease) so it reads as a snap; the
  // open transition stays at the same 220ms ease the proximity reveal
  // uses. Asymmetric on purpose — real blinks close quickly, open
  // more slowly.
  useEffect(() => {
    if (!interactive) return;
    if (!eyesVisible) {
      // One-time reset when proximity ends mid-blink so the next
      // proximity reveal doesn't start with `blinking` stuck at true.
      // Not a cascading-render risk (only fires on the boolean edge),
      // but the React 19 compiler can't tell — suppress just here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBlinking(false);
      return;
    }
    if (typeof window === "undefined") return;
    let cancelled = false;
    let scheduleTid: number | null = null;
    let openTid: number | null = null;

    const scheduleNext = () => {
      if (cancelled) return;
      const delay = 4000 + Math.random() * 3000;
      scheduleTid = window.setTimeout(() => {
        if (cancelled) return;
        setBlinking(true);
        openTid = window.setTimeout(() => {
          if (cancelled) return;
          setBlinking(false);
          scheduleNext();
        }, 100);
      }, delay);
    };
    scheduleNext();

    return () => {
      cancelled = true;
      if (scheduleTid) window.clearTimeout(scheduleTid);
      if (openTid) window.clearTimeout(openTid);
    };
  }, [interactive, eyesVisible]);

  // Subscribe to Hugo's travel state. Applies to both interactive (nav)
  // and non-interactive (footer) variants — the footer dot also hides
  // because Hugo can fly across the bottom of the viewport during a
  // tool click on long pages and the eye sees both dots otherwise.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onTraveling = (e: Event) => {
      const detail = (e as CustomEvent<{ traveling: boolean }>).detail;
      if (!detail) return;
      setTraveling(detail.traveling);
    };
    window.addEventListener("hugoslekstuga:hugo-traveling", onTraveling);
    return () =>
      window.removeEventListener(
        "hugoslekstuga:hugo-traveling",
        onTraveling,
      );
  }, []);

  // Proximity detection — interactive variant only. Mouse-only; touch
  // users get the eye reveal via the tap handler so they aren't excluded.
  useEffect(() => {
    if (!interactive) return;
    if (typeof window === "undefined") return;
    const onMove = (e: MouseEvent) => {
      const node = btnRef.current;
      if (!node) return;
      const r = node.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.hypot(e.clientX - cx, e.clientY - cy);
      const proximityPx = Math.max(
        PROXIMITY_FLOOR_PX,
        Math.max(r.width, r.height) * PROXIMITY_RATIO,
      );
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
        }, EYES_HIDE_DELAY_MS);
      }
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [interactive]);

  if (!interactive) {
    return (
      <span
        aria-hidden
        data-brand-dot
        data-name="hugo"
        style={{
          display: "inline-block",
          width: "0.7em",
          height: "0.7em",
          borderRadius: "9999px",
          background: color,
          verticalAlign: "baseline",
          opacity: traveling ? 0 : 1,
          transition: "opacity 60ms linear",
        }}
      />
    );
  }

  const cycle = () => {
    setDotIdx((i) => (i + 1) % DOT_COLORS.length);
    // Tap-toggle eyes for touch users. Mouse users get proximity-driven
    // reveal anyway, so the toggle is harmless on desktop.
    setEyesVisible((v) => !v);
    setBouncing(true);
    window.setTimeout(() => setBouncing(false), 280);
  };

  return (
    <button
      type="button"
      ref={btnRef}
      onClick={cycle}
      aria-label="Change accent colour"
      data-brand-dot
      data-name="hugo"
      style={{
        position: "relative",
        display: "inline-block",
        width: "0.7em",
        height: "0.7em",
        borderRadius: "9999px",
        border: "none",
        padding: 0,
        margin: 0,
        background: color,
        cursor: "pointer",
        verticalAlign: "baseline",
        opacity: traveling ? 0 : 1,
        transform: bouncing ? "scale(1.4)" : undefined,
        transition: bouncing
          ? "transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1), background 220ms ease, opacity 60ms linear"
          : "transform 180ms ease, background 220ms ease, opacity 60ms linear",
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
          gap: "0.12em",
          opacity: eyesVisible && !blinking ? 1 : 0,
          // Fast close (blink starting) so it reads as a snap; slow
          // open (blink ending or proximity revealing) so the gaze
          // re-engages gently. Mirrors a real blink's asymmetry.
          transition: blinking
            ? "opacity 60ms ease"
            : "opacity 220ms ease",
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: "0.22em",
            height: "0.22em",
            borderRadius: "9999px",
            background: "var(--color-cream)",
          }}
        />
        <span
          style={{
            display: "inline-block",
            width: "0.22em",
            height: "0.22em",
            borderRadius: "9999px",
            background: "var(--color-cream)",
          }}
        />
      </span>
    </button>
  );
}
