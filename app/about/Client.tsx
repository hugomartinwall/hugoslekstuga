"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { COLOR_HEX } from "@/lib/colors";
import type { ToolColor } from "@/lib/tools";
import { tools } from "@/lib/tools";
import { drawCabinet } from "@/lib/hugo/sprite";

/**
 * The back room of the arcade.
 *
 * "Things you won't find here" isn't a list — it's a row of dark,
 * unpowered cabinets: machines this arcade could have installed and
 * pointedly didn't. Hover one and its screen tries to wake in the
 * colour it would have glowed, then dies again. The joke lives in
 * the room, not in the copy.
 */

type Machine = {
  label: string;
  note: string;
  /** The accent this machine would have glowed in, had it been let in. */
  color: ToolColor;
};

const MACHINES: Machine[] = [
  { label: "newsletters", note: "never installed", color: "yellow" },
  { label: "venture capital", note: "didn't fit through the door", color: "green" },
  { label: "your data", note: "not in the back room either", color: "blue" },
  { label: "cookie banner", note: "nothing to consent to", color: "orange" },
  { label: "the algorithm", note: "it never learned anything", color: "purple" },
  { label: "five-year plan", note: "out of order since 2021", color: "teal" },
  { label: "accounts", note: "the door doesn't lock", color: "tomato" },
  { label: "the love of your life", note: "try the door near the ceiling", color: "pink" },
];

/** Cabinet painter scale — 19×21 cells. */
const CAB_CELL = 6;
const CAB_W = 19 * CAB_CELL;
const CAB_H = 21 * CAB_CELL;

/** The wake-attempt: hard-stepped power states, ends dead. */
const FLICKER_STEPS: { on: boolean; ms: number }[] = [
  { on: true, ms: 90 },
  { on: false, ms: 70 },
  { on: true, ms: 160 },
  { on: false, ms: 0 },
];

function DeadCabinet({ machine, lean }: { machine: Machine; lean: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<number | null>(null);
  const flickeringRef = useRef(false);

  const paint = (powered: boolean) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== CAB_W * dpr) {
      canvas.width = CAB_W * dpr;
      canvas.height = CAB_H * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, CAB_W, CAB_H);
    drawCabinet(
      ctx,
      CAB_W / 2,
      CAB_H / 2,
      CAB_CELL,
      COLOR_HEX[machine.color],
      powered,
    );
  };

  useEffect(() => {
    paint(false);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flicker = () => {
    if (flickeringRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    flickeringRef.current = true;
    let i = 0;
    const step = () => {
      const s = FLICKER_STEPS[i];
      paint(s.on);
      i += 1;
      if (i < FLICKER_STEPS.length) {
        timerRef.current = window.setTimeout(step, s.ms);
      } else {
        flickeringRef.current = false;
      }
    };
    step();
  };

  return (
    <li
      className="card-chunk notch flex flex-col items-center gap-3 bg-cream-deep px-3 pb-4 pt-5 text-center"
      onPointerEnter={flicker}
      onPointerDown={flicker}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        width={CAB_W}
        height={CAB_H}
        className="h-auto w-full max-w-[114px]"
        style={{ imageRendering: "pixelated" }}
      />
      <p className="font-pixel text-[10px] uppercase tracking-[0.14em] text-ink-soft">
        {machine.label}
      </p>
      {/* The taped-on note — a slight alternating lean, like it was
          stuck on by hand. */}
      <p
        className="notch-sm border border-line bg-cream px-2 py-1 font-mono text-[11px] lowercase text-ink-muted"
        style={{ transform: `rotate(${lean * 1.6}deg)` }}
      >
        {machine.note}
      </p>
    </li>
  );
}

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
      {/* Hero */}
      <header className="flex flex-col gap-4">
        <h1 className="text-glow font-display text-5xl leading-[0.95] sm:text-6xl lg:text-7xl">
          An arcade with no <span className="text-tomato">coin slot</span>.
        </h1>
        <p className="max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">
          Hugo builds small browser toys in the off-hours. The ones worth
          keeping end up here —{" "}
          <span className="font-semibold text-ink">plugged in, open all
          night</span>.
        </p>
      </header>

      {/* The back room */}
      <section className="mt-14">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-2xl sm:text-3xl">
            Things you won&rsquo;t find here
          </h2>
          <p className="font-pixel text-[9px] uppercase tracking-[0.2em] text-ink-muted">
            never installed · not coming soon
          </p>
        </div>
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {MACHINES.map((m, i) => (
            <DeadCabinet key={m.label} machine={m} lean={i % 2 === 0 ? -1 : 1} />
          ))}
        </ul>
        <p className="mt-8 text-sm text-ink-muted">
          The floor space went to the {tools.length} machines out front{" "}
          <Link
            href="/"
            className="font-semibold text-ink underline decoration-line underline-offset-4 hover:text-tomato"
          >
            →
          </Link>
        </p>
      </section>
    </div>
  );
}
