"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import PixelIcon from "@/components/PixelIcon";
import Dialog from "@/components/ui/Dialog";
import Keycap from "@/components/ui/Keycap";
import ScrollRegion from "@/components/ui/ScrollRegion";
import { accentVars } from "@/lib/colors";
import { clamp } from "@/lib/math";
import { findTool, type ToolColor } from "@/lib/tools";
import {
  getEnergyHistory,
  type HugoMood,
  useHugoState,
} from "@/lib/hugo-state";

/**
 * Hugo's room — a small dialog that peeks into the brand dot's inner
 * state. Opened by shift+click on the corner mascot. Shows live readouts
 * (BPM, mood, energy) and persisted memory (streak, visits, naps,
 * tantrums, somersaults, favourite tool, first-seen date), plus a
 * 60-minute energy chart sampled once per minute by the state tick.
 *
 * Pure visualisation — nothing is editable. The brand rule "Hugo
 * never appears in user copy" is bent here only inside the room
 * itself, where the metaphor is the point.
 *
 * Built on the kit. The kit's Dialog is the overlay (the flat scrim,
 * Escape, a click outside, the focus trap, the scroll lock, the portal
 * to <body>); the readouts are stepped wells (`plate-chunk`) on the
 * panel; the close key is a Keycap.
 */

const MOOD_LABEL: Record<HugoMood, string> = {
  sleepy: "Sleepy",
  calm: "Calm",
  curious: "Curious",
  excited: "Excited",
  grumpy: "Grumpy",
};

/**
 * The room takes the colour of his mood: `--accent-soft` fills the panel.
 * Calm is the plain raised panel; the other four are an accent's dark
 * tint. (The chart is drawn in his own colour, not his mood's.)
 */
const MOOD_SKIN: Record<HugoMood, string> = {
  sleepy: "[--accent:var(--color-blue)] [--accent-soft:var(--color-blue-soft)]",
  calm: "[--accent:var(--color-ink)] [--accent-soft:var(--color-panel)]",
  curious:
    "[--accent:var(--color-yellow)] [--accent-soft:var(--color-yellow-soft)]",
  excited:
    "[--accent:var(--color-pink)] [--accent-soft:var(--color-pink-soft)]",
  grumpy:
    "[--accent:var(--color-tomato)] [--accent-soft:var(--color-tomato-soft)]",
};

/**
 * The panel. 440px wide at most, and never taller than the screen: on a
 * phone held sideways the readouts scroll under the title. Its fill is
 * the mood's soft colour (Dialog's `surface`); Dialog itself keeps the
 * panel on whole pixels and gives it its frame in forced colours.
 */
const PANEL = "flex w-full max-w-[440px] flex-col max-h-[calc(100dvh-3rem)]";

/**
 * Three readouts across. A third of the panel is rarely a whole number
 * of pixels, and a frame that starts on a fraction smears the same way,
 * so where round() exists the outer two columns take the nearest whole
 * pixel and the middle one takes what is left. (Nearest, not down: a
 * third that should come to exactly 120px arrives as 119.99997, and
 * rounding that down costs a whole pixel on each side.) Under 360px a
 * mood word no longer fits a third, and the tiles wrap two-and-one.
 */
const READOUTS = [
  "grid gap-2 grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))]",
  "min-[360px]:supports-[width:round(1px,1px)]:grid-cols-[round(calc((100%-1rem)/3),1px)_minmax(0,1fr)_round(calc((100%-1rem)/3),1px)]",
].join(" ");

function formatDate(epoch: number): string {
  if (!epoch) return "—";
  const d = new Date(epoch);
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function HugoRoom({
  color,
  onClose,
}: {
  /** His own colour, the one he wears in the corner (BrandDot's). */
  color: ToolColor;
  onClose: () => void;
}) {
  const bpm = useHugoState((s) => s.bpm);
  const mood = useHugoState((s) => s.mood);
  const energy = useHugoState((s) => s.energy);
  const memory = useHugoState((s) => s.memory);

  // Pull energy history when the room opens (and every 30s while it is
  // open) so the chart stays current as the buffer fills.
  const [history, setHistory] = useState<{ t: number; energy: number }[]>(
    [],
  );
  useEffect(() => {
    // Initial pull (the buffer is module-scope and already populated
    // by the state tick before the room opens). One-shot setState in
    // an effect for transient mount state is the right pattern here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory(getEnergyHistory());
    const id = window.setInterval(
      () => setHistory(getEnergyHistory()),
      30_000,
    );
    return () => window.clearInterval(id);
  }, []);

  // Favourite tool — look up the display title from the registry.
  const favSlug = memory.favoriteToolSlug;
  const favTool = favSlug ? findTool(favSlug) : null;

  // Capture "now" once at open via useState's lazy initializer
  // (the React 19 purity rule blocks Date.now() during render).
  const [openedAt] = useState(() => Date.now());
  const titleId = useId();
  const ageDays = memory.firstSeen
    ? Math.max(1, Math.floor((openedAt - memory.firstSeen) / 86_400_000))
    : 0;

  // This component is only mounted while the room is open (BrandDot
  // decides that), so the dialog is simply open. Escape and a click on
  // the scrim are the Dialog's. Every other key passes through to the
  // page (`passKeys`): there is nothing to type into here, and the
  // konami code is meant to work with the room open, where its
  // somersault shows up in the count.
  return (
    <Dialog
      open
      onClose={onClose}
      label="Hugo's room"
      surface="bg-(--accent-soft)"
      passKeys
      className={`${PANEL} ${MOOD_SKIN[mood]}`}
    >
      <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-5 sm:px-8 sm:pt-7">
        <div className="min-w-0">
          <h2 id={titleId} className="font-display text-3xl leading-none">
            Hugo&rsquo;s room
          </h2>
          <p className="mt-1 text-xs text-ink-soft">
            Press Esc or click outside to close.
          </p>
        </div>
        <Keycap
          tone="quiet"
          size="icon"
          aria-label="Close"
          onClick={onClose}
          className="shrink-0"
        >
          <PixelIcon name="close" size={12} />
        </Keycap>
      </header>

      {/* The title stays put; on a screen too short for the room, this
          part scrolls under it, and then the keyboard can stop on it and
          scroll it too. */}
      <ScrollRegion labelledBy={titleId} className="px-5 pb-5 sm:px-8 sm:pb-7">
        {/* Live readouts */}
        <section className={READOUTS}>
          <Stat label="Heart" value={`${Math.round(bpm)}`} unit="BPM" />
          <Stat label="Mood" value={MOOD_LABEL[mood]} />
          <Stat label="Energy" value={`${Math.round(energy)}`} unit="%" />
        </section>

        {/* Energy chart. He is sampled once a minute from the page's
            first moment, so a first visit has one sample at most: no
            line yet, and the label says so instead of a flat line that
            would read as data. */}
        <section className="plate-chunk mt-2 bg-cream-deep px-2.5 py-2.5 sm:px-3">
          <p className="label-pixel">
            {history.length < 2
              ? "Energy — no history yet"
              : "Energy — last hour"}
          </p>
          <EnergyChart history={history} color={color} />
        </section>

        {/* Memory counters. Two across (one, where a column could not
            hold "Total visits" and a four-figure count); the favourite
            tool is a name, not a number, so it gets a full row, and the
            row after it moves up into the gap beside the somersaults. */}
        <dl className="mt-5 grid grid-flow-row-dense grid-cols-1 gap-x-4 gap-y-2 text-sm min-[375px]:grid-cols-2">
          <Pair label="Day streak" value={`${memory.streakDays}`} />
          <Pair label="Total visits" value={`${memory.visitCount}`} />
          <Pair label="Naps" value={`${memory.naps}`} />
          <Pair label="Tantrums" value={`${memory.tantrums}`} />
          <Pair label="Somersaults" value={`${memory.flips}`} />
          <Pair
            wide
            label="Favourite tool"
            value={favTool ? favTool.title : "—"}
          />
          <Pair
            keys
            label="Search"
            value={
              // align-top: centred on the text (the class's own setting)
              // the key's box pushes its 20px line a fraction taller,
              // and the whole panel off the pixel grid with it.
              <kbd className="kbd-chunk align-top whitespace-nowrap">
                {typeof navigator !== "undefined" &&
                /mac/i.test(navigator.platform)
                  ? "⌘K"
                  : "Ctrl K"}
              </kbd>
            }
          />
        </dl>

        {/* 1px of hairline + 11px of padding: the rhythm stays on 4s and
            the panel's height stays even. */}
        <footer className="mt-5 border-t border-line pt-[11px] text-xs text-ink-soft">
          Hugo since {formatDate(memory.firstSeen)} (
          {ageDays} day{ageDays === 1 ? "" : "s"})
        </footer>
      </ScrollRegion>
    </Dialog>
  );
}

/** A live readout: a stepped well, a pixel label, one big figure. */
function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="plate-chunk min-w-0 bg-cream-deep px-2.5 py-2.5 sm:px-3">
      <p className="label-pixel">{label}</p>
      {/* 30px is twice the display face's 15px grid, so each of its
          pixels is a whole 2px. On a phone a mood word would not fit
          a third of the panel at that size, so it steps down there. */}
      <p className="mt-0.5 flex items-baseline gap-1 font-display text-2xl leading-none sm:text-3xl">
        {value}
        {unit ? <span className="label-pixel">{unit}</span> : null}
      </p>
    </div>
  );
}

function Pair({
  label,
  value,
  wide = false,
  keys = false,
}: {
  label: string;
  value: ReactNode;
  wide?: boolean;
  /** A shortcut, not a memory: help for a keyboard, so where the main
   *  pointer is a finger the row is not shown (as the search palette's
   *  key legends are not). */
  keys?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-2 ${
        wide ? "min-[375px]:col-span-2" : ""
      } ${keys ? "pointer-coarse:hidden" : ""}`}
    >
      <dt className="text-ink-soft">{label}</dt>
      <dd className="text-right font-bold">{value}</dd>
    </div>
  );
}

/**
 * The plot's grid: 176 × 32 cells. At the panel's full width a cell is
 * 2px square: the module of the figures above it and of the frames'
 * steps.
 */
const COLS = 176;
const ROWS = 32;

const cells = (x: number, y: number, w: number, h: number) =>
  `M${x} ${y}h${w}v${h}h${-w}z`;

function EnergyChart({
  history,
  color,
}: {
  history: { t: number; energy: number }[];
  color: ToolColor;
}) {
  // What it plots is what it always plotted: the samples spread from
  // edge to edge and joined by straight lines, 100 at the top and 0 on
  // the floor. With fewer than two samples there is nothing to join:
  // the plot stays empty (and keeps its height, so the room does not
  // jump when the line arrives). The line is read off at each column
  // and dropped onto the grid, so it moves in steps instead of curving.
  const empty = history.length < 2;
  const rowAt = (col: number): number => {
    const at = (col / (COLS - 1)) * (history.length - 1);
    const i = Math.min(history.length - 2, Math.floor(at));
    const from = history[i].energy;
    const to = history[i + 1].energy;
    const energy = from + (to - from) * (at - i);
    return Math.round(((100 - clamp(energy, 0, 100)) / 100) * (ROWS - 1));
  };

  // Walk the columns in runs of one level. Each run is a stretch of
  // line with the area under it; where the level jumps by more than a
  // cell, a riser joins the two stretches so the line never breaks.
  let line = "";
  let area = "";
  let start = 0;
  let level = empty ? 0 : rowAt(0);
  for (let col = 1; !empty && col <= COLS; col++) {
    const next = col < COLS ? rowAt(col) : -1;
    if (next === level) continue;
    line += cells(start, level, col - start, 1);
    if (level < ROWS - 1) {
      area += cells(start, level + 1, col - start, ROWS - 1 - level);
    }
    if (col < COLS) {
      const top = Math.min(level, next) + 1;
      const bottom = Math.max(level, next);
      if (bottom > top) line += cells(col, top, 1, bottom - top);
    }
    start = col;
    level = next;
  }

  // His colour draws the line and its dark tint (the kit's soft variant
  // of it) fills the area under it.
  return (
    <svg
      viewBox={`0 0 ${COLS} ${ROWS}`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      role={empty ? undefined : "img"}
      aria-label={empty ? undefined : "Hugo's energy over the past hour"}
      aria-hidden={empty ? true : undefined}
      style={accentVars(color)}
      // In forced colours an SVG keeps the fills it is given, and a
      // phosphor line on a white page is no line at all: take the
      // system's text colour there, as the kit's frames do.
      className="mt-1.5 block h-16 w-full fill-(--accent) forced-colors:fill-[CanvasText]"
    >
      <path
        d={area}
        className="fill-(--accent-soft) forced-colors:fill-[CanvasText] forced-colors:[fill-opacity:0.14]"
      />
      <path d={line} />
    </svg>
  );
}
