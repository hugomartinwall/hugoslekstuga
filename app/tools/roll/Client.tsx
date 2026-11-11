"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import ToolFrame from "@/components/ToolFrame";
import PixelIcon from "@/components/PixelIcon";
import { Chip } from "@/components/ui/Chip";
import { TextArea, TextField } from "@/components/ui/Field";
import Keycap from "@/components/ui/Keycap";
import Panel from "@/components/ui/Panel";
import { isPressable, isTextEntry } from "@/lib/keyboard";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";
import { fileToWheelThumbnail } from "@/lib/roll/image";
import { COLOR_HEX, CREAM_HEX, INK_HEX, preferredTextHex } from "@/lib/colors";

const STORAGE_KEY = "hugoslekstuga:roll:options";
const RECENT_KEY = "hugoslekstuga:roll:recent";

/**
 * The page's three text buttons ("try a sample", "paste a list", "clear").
 * They read as quiet links, but the box a finger lands on is 44px tall and
 * 14px wider than the words on each side (the negative margin keeps the
 * words where they were). The focus outline is pulled in by 10px so it
 * hugs the words instead of boxing the whole target.
 */
const TEXT_BUTTON =
  "-mx-3.5 inline-flex min-h-11 cursor-pointer items-center px-3.5 text-xs font-semibold underline-offset-2 -outline-offset-[10px] hover:underline";

const SLICE_COLORS = (
  ["tomato", "yellow", "blue", "pink", "green", "purple", "orange", "teal"] as const
).map((c) => ({ fill: COLOR_HEX[c], text: preferredTextHex(c) }));

const SAMPLE_LABELS = ["Indian", "Italian", "Sushi", "Tacos", "Cook at home"];

/**
 * An entry on the wheel. Used to be a plain string in a textarea;
 * now carries an optional picture so a "pick a restaurant" wheel
 * shows the logos, a "pick a dish" wheel shows the food, etc.
 *
 * `id` is a stable React key (UUID at creation time). `image` is
 * a base64-encoded JPEG data URL (center-cropped, 256×256 max) —
 * see `lib/roll/image.ts` for the encoding. `null` means no image.
 */
type Entry = {
  id: string;
  label: string;
  image: string | null;
};

const EMPTY_ENTRIES: Entry[] = [];
const EMPTY_RECENT: string[] = [];

/**
 * Take whatever's currently sitting in `hugoslekstuga:roll:options`
 * and return Entry[]. Two legacy shapes:
 *
 *   - string: the original textarea contents, newline-delimited.
 *     Each non-empty trimmed line becomes a label-only entry.
 *   - array:  already the new shape — pass through (filtered to
 *     defensive-shape items so a corrupt entry can't crash render).
 *
 * After first save, the array path is the only one taken.
 */
function normaliseEntries(raw: unknown): Entry[] {
  if (Array.isArray(raw)) {
    return raw
      .filter(
        (e): e is Entry =>
          e !== null &&
          typeof e === "object" &&
          typeof (e as Entry).id === "string" &&
          typeof (e as Entry).label === "string",
      )
      .map((e) => ({
        id: e.id,
        label: e.label,
        image: typeof e.image === "string" ? e.image : null,
      }));
  }
  if (typeof raw === "string") {
    return raw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((label) => ({ id: makeId(), label, image: null }));
  }
  return [];
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `e-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

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
  // Read as `unknown` so the migration helper can inspect the raw shape
  // (legacy string vs new Entry[]). Writes always go through setStored
  // with Entry[] — see `setEntries` below.
  const [stored, setStored] = useLocalStorageState<unknown>(
    STORAGE_KEY,
    EMPTY_ENTRIES,
  );
  const [recent, setRecent] = useLocalStorageState<string[]>(
    RECENT_KEY,
    EMPTY_RECENT,
  );
  const entries = useMemo(() => normaliseEntries(stored), [stored]);

  const setEntries = useCallback(
    (next: Entry[] | ((prev: Entry[]) => Entry[])) => {
      if (typeof next === "function") {
        setStored((prev: unknown) => next(normaliseEntries(prev)));
      } else {
        setStored(next);
      }
    },
    [setStored],
  );

  // One-time migration: if storage holds the legacy string format on
  // mount, write back the normalised Entry[] so subsequent reads hit
  // the fast path. Runs once per page-load when the shape needs it.
  useEffect(() => {
    if (typeof stored === "string" && stored.length > 0) {
      setEntries(normaliseEntries(stored));
    }
    // We only want this to compare the *initial* shape — depending on
    // `stored` would re-fire on every keystroke. The hook reads the
    // current snapshot synchronously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Spinnable entries: those with either a non-empty label or an image.
  // Empty editor rows (still being typed) are shown in the editor list
  // but excluded from the wheel until they hold something.
  const validEntries = useMemo(
    () => entries.filter((e) => e.label.trim().length > 0 || e.image !== null),
    [entries],
  );

  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<number | null>(null);
  const [bulkPasteOpen, setBulkPasteOpen] = useState(false);
  const [bulkPasteText, setBulkPasteText] = useState("");
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

  const canSpin = validEntries.length >= 2;

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
    const n = validEntries.length;
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
      const winningEntry = validEntries[idx];
      const winningColor = SLICE_COLORS[idx % SLICE_COLORS.length].fill;
      burstConfetti(winningColor);
      // Recent stores labels only — images don't follow into the log.
      const displayLabel = winningEntry.label.trim() || "(no label)";
      setRecent((prev) => [displayLabel, ...prev].slice(0, 5));
    }, 4100);
  }, [canSpin, spinning, validEntries, rotation, burstConfetti, setRecent]);

  // Spacebar to spin, unless the key belongs to what has focus: text in a
  // field, or a button that Space is about to press ("+ Add option", a
  // remove key). It used to spin the wheel instead of pressing them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (isTextEntry(e.target) || isPressable(e.target)) return;
      e.preventDefault();
      spin();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spin]);

  /* ---------- Editor handlers ---------- */

  const addEntry = useCallback(() => {
    setEntries((prev) => [...prev, { id: makeId(), label: "", image: null }]);
  }, [setEntries]);

  const removeEntry = useCallback(
    (id: string) => {
      setEntries((prev) => prev.filter((e) => e.id !== id));
    },
    [setEntries],
  );

  const setLabel = useCallback(
    (id: string, label: string) => {
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, label } : e)),
      );
    },
    [setEntries],
  );

  const setImage = useCallback(
    (id: string, image: string | null) => {
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, image } : e)),
      );
    },
    [setEntries],
  );

  /**
   * Multi-line paste from the textarea era: when a user pastes text
   * containing newlines into a label input, splice the lines into
   * the list — the focused row gets the first line, additional lines
   * insert as new rows immediately below.
   */
  const splitPaste = useCallback(
    (id: string, text: string) => {
      const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
      if (lines.length <= 1) return;
      setEntries((prev) => {
        const idx = prev.findIndex((e) => e.id === id);
        if (idx === -1) return prev;
        const head = prev.slice(0, idx);
        const tail = prev.slice(idx + 1);
        const updatedFocused = { ...prev[idx], label: lines[0] };
        const newRows = lines.slice(1).map((label) => ({
          id: makeId(),
          label,
          image: null,
        }));
        return [...head, updatedFocused, ...newRows, ...tail];
      });
    },
    [setEntries],
  );

  /** Append all non-empty lines from the bulk-paste textarea as new rows. */
  const applyBulkPaste = useCallback(() => {
    const lines = bulkPasteText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    setEntries((prev) => [
      ...prev,
      ...lines.map((label) => ({ id: makeId(), label, image: null })),
    ]);
    setBulkPasteText("");
    setBulkPasteOpen(false);
  }, [bulkPasteText, setEntries]);

  const loadSample = useCallback(() => {
    setEntries(
      SAMPLE_LABELS.map((label) => ({ id: makeId(), label, image: null })),
    );
  }, [setEntries]);

  /* ---------- Render ---------- */

  // Once any row carries a picture, every row's image cell is as wide as
  // a thumbnail plus its "Clear image" key, so the text fields stay in
  // one column.
  const anyImage = entries.some((e) => e.image !== null);

  // The winner panel's room. It opens when Spin is pressed and stays open
  // while a result shows, so whatever sits below (the recent list; on a
  // phone the whole editor) is pushed down once, at the press, instead of
  // jumping up and down on every spin. It is as tall as the panel will be:
  // 82px for a name, 214px when every option carries a picture. (A wheel
  // that mixes the two keeps the short room; a picture then pushes past it.)
  const shownWinner =
    winner !== null && !spinning ? validEntries[winner] : undefined;
  const winnerRoomOpen = spinning || shownWinner !== undefined;
  const winnerRoom =
    validEntries.length > 0 && validEntries.every((e) => e.image !== null)
      ? "min-h-53.5"
      : "min-h-20.5";

  return (
    <ToolFrame tool={tool}>
      {/* Two columns from md up: the editor on the left, the wheel on the
          right. On a phone the wheel and Spin come first (order-*), so the
          main action is on the first screen; the editor follows. */}
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:gap-10">
        <div className="order-2 flex min-w-0 flex-col md:order-1">
          <div className="flex min-h-11 items-center justify-between gap-3">
            <p className="label-pixel">Options</p>
            <button
              type="button"
              onClick={loadSample}
              className={`${TEXT_BUTTON} text-(--accent)`}
            >
              try a sample
            </button>
          </div>

          <ul className="flex flex-col">
            {entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                reserveClear={anyImage}
                onLabelChange={(label) => setLabel(entry.id, label)}
                onSetImage={(image) => setImage(entry.id, image)}
                onClearImage={() => setImage(entry.id, null)}
                onDelete={() => removeEntry(entry.id)}
                onPasteSplit={(text) => splitPaste(entry.id, text)}
              />
            ))}
          </ul>

          {/* Add one, or add many: the bulk-paste disclosure recovers the
              old textarea's "paste 10 lines from a doc" superpower. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4">
            <Keycap onClick={addEntry}>+ Add option</Keycap>
            <button
              type="button"
              onClick={() => setBulkPasteOpen((o) => !o)}
              className={`${TEXT_BUTTON} text-ink-muted hover:text-ink`}
              aria-expanded={bulkPasteOpen}
            >
              {bulkPasteOpen ? "hide bulk paste" : "paste a list"}
            </button>
          </div>
          {bulkPasteOpen && (
            <div className="mt-2 flex flex-col items-start gap-2">
              <TextArea
                label="Paste one option per line and click Add all."
                hideLabel
                className="w-full"
                value={bulkPasteText}
                onChange={(e) => setBulkPasteText(e.target.value)}
                rows={5}
                placeholder="Paste one option per line and click Add all."
              />
              <Keycap
                onClick={applyBulkPaste}
                disabled={bulkPasteText.trim() === ""}
              >
                Add all
              </Keycap>
            </div>
          )}

          <p className="mt-3 text-xs text-ink-muted">
            {validEntries.length === 0
              ? "Add at least two options to spin."
              : validEntries.length === 1
                ? "Add one more option to spin."
                : `${validEntries.length} option${validEntries.length === 1 ? "" : "s"} ready.`}
          </p>
        </div>

        <div className="order-1 flex min-w-0 flex-col items-center gap-5 md:order-2">
          <div className="relative aspect-square w-full max-w-sm">
            <svg
              viewBox="0 0 400 400"
              className="h-full w-full"
              role="img"
              aria-label="Decision wheel"
            >
              {/* Rim — one thin line. The 6px ring it replaces was the
                  old skin's ink outline. */}
              <circle
                cx="200"
                cy="200"
                r="186"
                fill="none"
                className="stroke-ink-muted"
                strokeWidth="2"
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
                {validEntries.length === 0 && (
                  <circle
                    cx="200"
                    cy="200"
                    r="180"
                    className="fill-cream-deep"
                  />
                )}
                {validEntries.map((entry, i) => (
                  <Slice
                    key={entry.id}
                    cx={200}
                    cy={200}
                    r={180}
                    total={validEntries.length}
                    index={i}
                    label={entry.label}
                    image={entry.image}
                    color={SLICE_COLORS[i % SLICE_COLORS.length]}
                  />
                ))}
              </g>
              {/* Pointer */}
              <polygon
                points="200,8 184,40 216,40"
                fill={INK_HEX}
                stroke={CREAM_HEX}
                strokeWidth="2"
                strokeLinejoin="round"
              />
              {/* Center cap */}
              <circle
                cx="200"
                cy="200"
                r="22"
                fill={CREAM_HEX}
                className="stroke-ink-muted"
                strokeWidth="2"
              />
              {/* Confetti — square pixels, drawn over everything. The
                  ref holds an animation buffer that mutates each RAF tick;
                  re-renders are gated by tickParticles. Reading the ref in
                  render is intentional and matches the project's particle
                  pattern (see eslint.config.mjs comment on react-hooks/refs). */}
              {/* eslint-disable react-hooks/refs */}
              <g pointerEvents="none" shapeRendering="crispEdges">
                {particlesRef.current.map((p, i) => {
                  const side = p.size * 1.75 * Math.max(0, p.life);
                  return (
                    <rect
                      key={i}
                      x={p.x - side / 2}
                      y={p.y - side / 2}
                      width={side}
                      height={side}
                      fill={p.color}
                      stroke={CREAM_HEX}
                      strokeWidth={1}
                      opacity={Math.max(0, p.life)}
                    />
                  );
                })}
              </g>
              {/* eslint-enable react-hooks/refs */}
            </svg>
          </div>

          <div className="flex flex-col items-center gap-2">
            <Keycap
              tone="accent"
              size="lg"
              onClick={spin}
              disabled={!canSpin || spinning}
              className="min-w-40"
            >
              {spinning ? "Spinning…" : "Spin!"}
            </Keycap>
            <span className="hidden items-center gap-1.5 text-xs text-ink-muted sm:inline-flex">
              or press
              <kbd className="kbd-chunk">Space</kbd>
            </span>
          </div>

          {/* Winner, empty-state line, recent list. With none of them the
              block is gone, so on a phone the editor sits right under Spin. */}
          <div className="flex w-full flex-col items-center gap-3 text-center empty:hidden">
            {winnerRoomOpen && (
              <div className={`flex w-full flex-col items-center ${winnerRoom}`}>
                {shownWinner && <WinnerCard entry={shownWinner} />}
              </div>
            )}
            {validEntries.length === 0 && (
              <p className="text-sm text-ink-muted">
                The wheel awaits options.
              </p>
            )}
            {recent.length > 1 && (
              <div className="flex max-w-full flex-col items-center gap-1.5">
                <p className="label-pixel">Recent</p>
                <ol className="flex max-w-full flex-wrap justify-center gap-1.5">
                  {recent.slice(1).map((w, i) => (
                    // A record, not a control: the bare stepped frame,
                    // with none of what makes a chip pressable.
                    <li
                      key={`${w}-${i}`}
                      className="plate-chunk inline-flex max-w-full items-center bg-cream-deep px-2.5 py-1.5 text-xs font-bold wrap-anywhere select-text"
                    >
                      {w}
                    </li>
                  ))}
                </ol>
                <button
                  type="button"
                  onClick={() => setRecent(EMPTY_RECENT)}
                  className={`${TEXT_BUTTON} -mt-1.5 text-ink-muted hover:text-ink`}
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

/* -------------------------------------------------------------------------
 * EntryRow — one row in the editor list. Holds the image cell, label
 * input, and delete button. Handles file picker, drag-and-drop, paste-
 * splitting, and image errors.
 *
 * Every control in the row is a 44px-tall stepped shape from the kit:
 * the image slot and its clear key are flat chips (they belong to the
 * row), the label sits in a field well, and the one raised keycap removes
 * the row. With `reserveClear` an empty slot stretches over the cell the
 * clear key would take, so a list that mixes rows with and without
 * pictures still lines up in columns.
 * -----------------------------------------------------------------------*/

function EntryRow({
  entry,
  reserveClear,
  onLabelChange,
  onSetImage,
  onClearImage,
  onDelete,
  onPasteSplit,
}: {
  entry: Entry;
  reserveClear: boolean;
  onLabelChange: (label: string) => void;
  onSetImage: (image: string) => void;
  onClearImage: () => void;
  onDelete: () => void;
  onPasteSplit: (text: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      setImageError(null);
      setBusy(true);
      try {
        const dataUrl = await fileToWheelThumbnail(file);
        onSetImage(dataUrl);
      } catch {
        setImageError("Couldn't read that image.");
      } finally {
        setBusy(false);
      }
    },
    [onSetImage],
  );

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Allow picking the same file twice in a row.
    e.target.value = "";
  };

  const handleDragOver = (e: DragEvent<HTMLLIElement>) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      setDragOver(true);
    }
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: DragEvent<HTMLLIElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) handleFile(file);
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\n")) return;
    e.preventDefault();
    onPasteSplit(text);
  };

  const hasImage = entry.image !== null;

  return (
    // While a file hangs over the row it becomes a lit panel, the same
    // way the kit's Dropzone answers a drag. The 6px of padding keeps the
    // row's controls clear of that frame; the negative margin puts them
    // back on the column's edges.
    <li
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`-mx-1.5 flex flex-col gap-1 p-1.5 ${
        dragOver ? "card-chunk is-on bg-(--accent-soft)" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        {/* Image cell — the slot (44px, doubles as the drop hint), then
            the key that empties it. */}
        <div className="flex shrink-0 items-center gap-1">
          <Chip
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            aria-label={hasImage ? "Change image" : "Add image"}
            className={`h-11 p-1 text-ink-muted ${
              !hasImage && reserveClear ? "w-23" : "w-11"
            }`}
          >
            {hasImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={entry.image!}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <PixelIcon name="plus" size={12} />
            )}
          </Chip>
          {hasImage && (
            <Chip
              onClick={onClearImage}
              aria-label="Clear image"
              className="h-11 w-11 p-0 text-ink-muted"
            >
              <PixelIcon name="close" size={12} />
            </Chip>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleFileInput}
            className="hidden"
          />
        </div>

        <TextField
          label="An option"
          hideLabel
          className="min-w-0 flex-1"
          value={entry.label}
          onChange={(e) => onLabelChange(e.target.value)}
          onPaste={handlePaste}
          placeholder="An option"
        />

        {/* Remove is a neutral key with a coral mark, not a solid coral
            key: there is one per row, and a column of red would outshout
            Spin. */}
        <Keycap
          size="icon"
          onClick={onDelete}
          aria-label="Remove option"
          className="shrink-0"
        >
          <PixelIcon name="close" size={12} className="text-tomato" />
        </Keycap>
      </div>
      {imageError && <p className="text-xs text-tomato">{imageError}</p>}
    </li>
  );
}

/* -------------------------------------------------------------------------
 * WinnerCard — shown after a spin lands. Renders the image prominently
 * if the winning entry has one, falls back to the text-only original
 * shape otherwise.
 * -----------------------------------------------------------------------*/

function WinnerCard({ entry }: { entry: Entry }) {
  const label = entry.label.trim() || "(no label)";
  return (
    // A fixed 288px (or the column, if that is narrower) rather than the
    // width of the name: the panel then sits on whole pixels when centred,
    // so its 1px ring stays crisp, and it does not resize from spin to spin.
    <Panel
      tone="soft"
      className="fade-rise flex w-full max-w-72 flex-col items-center gap-3 px-6 py-4"
    >
      {entry.image && (
        // A framed picture: the panel's stepped ring sits over the image.
        <Panel tone="page" className="h-30 w-30 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={entry.image}
            alt=""
            className="h-full w-full object-cover"
          />
        </Panel>
      )}
      <div className="flex max-w-full flex-col items-center gap-1">
        <p className="label-pixel">And the winner is</p>
        <p className="font-display text-3xl leading-none wrap-anywhere">
          {label}
        </p>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------
 * Slice — one pie segment on the wheel. When the entry carries an image
 * the image fills the wedge (clipped to the slice's path) instead of a
 * solid colour; a room-dark seam stays on top so the slice still
 * reads as a "slice". Text overlays the image with a thick halo
 * (paintOrder: stroke) so it stays legible against any photo.
 *
 * Image rotation matches the text's flip rule (rotate by midAngle, with
 * a 180° flip on the bottom half so content reads right-side-up while
 * the wheel sits at rest).
 * -----------------------------------------------------------------------*/

function Slice({
  cx,
  cy,
  r,
  total,
  index,
  label,
  image,
  color,
}: {
  cx: number;
  cy: number;
  r: number;
  total: number;
  index: number;
  label: string;
  image: string | null;
  color: { fill: string; text: string };
}) {
  const hasImage = image !== null;
  // Text position is consistent regardless of image. Same font/char
  // ramp as the pre-image era — image-bearing slices just get a stroke
  // for legibility, not a different layout.
  const labelR = r * 0.62;
  const fontSize = total <= 4 ? 22 : total <= 6 ? 18 : total <= 9 ? 14 : 11;
  const maxChars = total <= 4 ? 14 : total <= 6 ? 12 : total <= 9 ? 10 : 8;
  // Text stroke for legibility against photos. Slightly lighter for
  // very narrow wedges so the outline doesn't swallow the glyphs.
  const labelStrokeWidth = total > 12 ? 2.5 : 4;
  // Opacity of the slice-colour overlay on top of an image. Just
  // enough hue to keep slice identity, not so much that the photo
  // gets washed out.
  const TINT_OPACITY = 0.22;

  // Single-entry wheel: full circle (no wedge arcs). Image fills it
  // edge-to-edge; the text sits above the hub, at the radius every other
  // label uses (dead centre it was hidden under the cap).
  if (total === 1) {
    const clipId = `roll-slice-${total}-${index}`;
    return (
      <g>
        {!hasImage && <circle cx={cx} cy={cy} r={r} fill={color.fill} />}
        {hasImage && (
          <>
            <defs>
              <clipPath id={clipId}>
                <circle cx={cx} cy={cy} r={r} />
              </clipPath>
            </defs>
            {/* Wrap the image in a g that owns the clip-path. clip-path
                on a g clips its children in parent (wheel) space —
                applying it directly to the <image> alongside a transform
                made SVG clip-after-rotate, which let the rotated image
                escape the clip region. */}
            <g clipPath={`url(#${clipId})`}>
              <image
                href={image!}
                x={cx - r}
                y={cy - r}
                width={2 * r}
                height={2 * r}
                preserveAspectRatio="xMidYMid slice"
              />
            </g>
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill={color.fill}
              opacity={TINT_OPACITY}
            />
          </>
        )}
        {label.trim().length > 0 && (
          <text
            x={cx}
            y={cy - labelR + 6}
            fontFamily="var(--font-display)"
            fontWeight="400"
            fontSize="22"
            fill={hasImage ? CREAM_HEX : color.text}
            stroke={hasImage ? INK_HEX : undefined}
            strokeWidth={hasImage ? labelStrokeWidth : undefined}
            strokeLinejoin="round"
            paintOrder={hasImage ? "stroke" : undefined}
            textAnchor="middle"
          >
            {truncate(label, 18)}
          </text>
        )}
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

  // Label / image rotate along the slice radius. Slices on the bottom
  // half flip 180° so content stays right-side-up at rest.
  const midAngle = startAngle + step / 2;
  const flip = midAngle > 90 && midAngle < 270;
  const contentRotation = flip ? midAngle + 180 : midAngle;
  const labelPos = polar(cx, cy, labelR, midAngle);

  // Image sizing tiered by slice count. Wide wedges (few slices) need a
  // larger image so the visible crop centres on subject pixels; narrow
  // wedges shrink the image so it stays inside the wedge with enough
  // density at the visible scale. Radial centre shifts the same way —
  // wider wedges pull the centroid inward, narrower wedges push it out.
  const imageSize =
    total <= 2  ? r * 2.0 :
    total <= 4  ? r * 1.7 :
    total <= 8  ? r * 1.4 :
    total <= 12 ? r * 1.2 :
                  r * 1.05;
  const imageRadialFactor =
    total <= 2  ? 0.45 :
    total <= 4  ? 0.50 :
    total <= 8  ? 0.55 :
                  0.60;
  const clipId = `roll-slice-${total}-${index}`;
  const imageCenter = polar(cx, cy, r * imageRadialFactor, midAngle);

  return (
    <g>
      {!hasImage && (
        <path d={path} fill={color.fill} stroke={CREAM_HEX} strokeWidth="2" />
      )}
      {hasImage && (
        <>
          <defs>
            <clipPath id={clipId}>
              <path d={path} />
            </clipPath>
          </defs>
          {/* clip-path on the wrapper g, transform on the inner image
              — applying both to the same <image> made SVG clip
              after-rotate, which let the rotated image overflow the
              wheel. The wrapper clips in wheel space; the image
              rotates inside the clipped region. */}
          <g clipPath={`url(#${clipId})`}>
            <image
              href={image!}
              x={imageCenter.x - imageSize / 2}
              y={imageCenter.y - imageSize / 2}
              width={imageSize}
              height={imageSize}
              preserveAspectRatio="xMidYMid slice"
              transform={`rotate(${contentRotation} ${imageCenter.x} ${imageCenter.y})`}
            />
          </g>
          {/* Slice-colour tint over the image so the wheel still
              reads as a coloured spinner. Sits between image and
              outline so the dark seam stays crisp on top. */}
          <path d={path} fill={color.fill} opacity={TINT_OPACITY} />
          <path d={path} fill="none" stroke={CREAM_HEX} strokeWidth="2" />
        </>
      )}
      {label.trim().length > 0 && (
        <text
          x={labelPos.x}
          y={labelPos.y}
          fontFamily="var(--font-display)"
          fontWeight="400"
          fontSize={fontSize}
          fill={hasImage ? CREAM_HEX : color.text}
          stroke={hasImage ? INK_HEX : undefined}
          strokeWidth={hasImage ? labelStrokeWidth : undefined}
          strokeLinejoin="round"
          paintOrder={hasImage ? "stroke" : undefined}
          textAnchor="middle"
          dominantBaseline="middle"
          transform={`rotate(${contentRotation} ${labelPos.x} ${labelPos.y})`}
        >
          {truncate(label, maxChars)}
        </text>
      )}
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
