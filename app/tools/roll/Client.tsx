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
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";
import { fileToWheelThumbnail } from "@/lib/roll/image";
import { COLOR_HEX, CREAM_HEX, INK_HEX, preferredTextHex } from "@/lib/colors";

const STORAGE_KEY = "hugoslekstuga:roll:options";
const RECENT_KEY = "hugoslekstuga:roll:recent";

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

  // Spacebar to spin (when not focused on an input/textarea/contentEditable).
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

  return (
    <ToolFrame tool={tool}>
      <div className="grid grid-cols-1 gap-8 md:grid-cols-[1fr_1fr] md:gap-10">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Options
            </p>
            <button
              type="button"
              onClick={loadSample}
              className="text-xs font-semibold text-orange underline-offset-2 hover:underline"
            >
              try a sample
            </button>
          </div>

          <ul className="flex flex-col gap-2">
            {entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                onLabelChange={(label) => setLabel(entry.id, label)}
                onSetImage={(image) => setImage(entry.id, image)}
                onClearImage={() => setImage(entry.id, null)}
                onDelete={() => removeEntry(entry.id)}
                onPasteSplit={(text) => splitPaste(entry.id, text)}
              />
            ))}
          </ul>

          <button
            type="button"
            onClick={addEntry}
            className="btn-chunk self-start rounded-[var(--radius-button)] bg-cream px-4 py-2 text-sm font-display font-extrabold text-ink"
          >
            + Add option
          </button>

          {/* Bulk-paste disclosure — recovers the old textarea's
              "paste 10 lines from a doc" superpower. */}
          <div className="flex flex-col gap-2 text-xs">
            <button
              type="button"
              onClick={() => setBulkPasteOpen((o) => !o)}
              className="self-start text-xs font-semibold text-ink-muted underline-offset-2 hover:text-ink hover:underline"
              aria-expanded={bulkPasteOpen}
            >
              {bulkPasteOpen ? "hide bulk paste" : "paste a list"}
            </button>
            {bulkPasteOpen && (
              <div className="flex flex-col gap-2">
                <textarea
                  value={bulkPasteText}
                  onChange={(e) => setBulkPasteText(e.target.value)}
                  rows={5}
                  placeholder="Paste one option per line and click Add all."
                  className="card-chunk min-h-[8rem] rounded-[var(--radius-card)] bg-cream px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-muted focus:outline-none"
                />
                <button
                  type="button"
                  onClick={applyBulkPaste}
                  disabled={bulkPasteText.trim() === ""}
                  className="btn-chunk self-start rounded-[var(--radius-button)] bg-cream px-4 py-2 text-sm font-display font-extrabold text-ink disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Add all
                </button>
              </div>
            )}
          </div>

          <p className="text-xs text-ink-muted">
            {validEntries.length === 0
              ? "Add at least two options to spin."
              : validEntries.length === 1
                ? "Add one more option to spin."
                : `${validEntries.length} option${validEntries.length === 1 ? "" : "s"} ready.`}
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
                stroke={INK_HEX}
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
                {validEntries.length === 0 && (
                  <circle cx="200" cy="200" r="180" fill={CREAM_HEX} />
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
                stroke={INK_HEX}
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
                    stroke={INK_HEX}
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
            {winner !== null && !spinning && validEntries[winner] && (
              <WinnerCard entry={validEntries[winner]} />
            )}
            {validEntries.length === 0 && (
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

/* -------------------------------------------------------------------------
 * EntryRow — one row in the editor list. Holds the image cell, label
 * input, and delete button. Handles file picker, drag-and-drop, paste-
 * splitting, and image errors.
 * -----------------------------------------------------------------------*/

function EntryRow({
  entry,
  onLabelChange,
  onSetImage,
  onClearImage,
  onDelete,
  onPasteSplit,
}: {
  entry: Entry;
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
    <li
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex flex-col gap-1 rounded-[var(--radius-card)] p-1 transition-colors ${
        dragOver ? "bg-blue-soft" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        {/* Image cell — 44px tap target, doubles as drop hint */}
        <div className="relative h-11 w-11 shrink-0">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            aria-label={hasImage ? "Change image" : "Add image"}
            className={`relative h-11 w-11 overflow-hidden rounded-full border-2 ${
              hasImage
                ? "border-ink bg-cream"
                : "border-dashed border-ink-muted bg-cream-deep"
            } transition-colors hover:border-ink disabled:opacity-50`}
          >
            {hasImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={entry.image!}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span
                aria-hidden
                className="flex h-full w-full items-center justify-center text-lg font-bold leading-none text-ink-muted"
              >
                +
              </span>
            )}
          </button>
          {hasImage && (
            <button
              type="button"
              onClick={onClearImage}
              aria-label="Clear image"
              className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-ink bg-cream text-[10px] font-bold leading-none text-ink hover:bg-tomato-soft"
            >
              ×
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleFileInput}
            className="hidden"
          />
        </div>

        <input
          type="text"
          value={entry.label}
          onChange={(e) => onLabelChange(e.target.value)}
          onPaste={handlePaste}
          placeholder="An option"
          className="card-chunk min-w-0 flex-1 rounded-[var(--radius-card)] bg-cream px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-muted focus:outline-none"
        />

        <button
          type="button"
          onClick={onDelete}
          aria-label="Remove option"
          className="shrink-0 rounded-full border-2 border-ink bg-cream px-2 py-1 text-xs font-bold hover:bg-tomato-soft"
        >
          ✕
        </button>
      </div>
      {imageError && (
        <p className="ml-13 text-[11px] text-tomato">{imageError}</p>
      )}
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
    <div className="fade-rise flex flex-col items-center gap-2 rounded-[var(--radius-card)] border-2 border-ink bg-orange-soft px-4 py-3">
      {entry.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={entry.image}
          alt=""
          className="h-30 w-30 rounded-full border-2 border-ink object-cover"
          style={{ width: 120, height: 120 }}
        />
      )}
      <div className="flex flex-col items-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          And the winner is
        </p>
        <p className="font-display text-2xl font-extrabold tracking-tight">
          {label}
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Slice — one pie segment on the wheel. When the entry carries an image
 * the image fills the wedge (clipped to the slice's path) instead of a
 * solid colour; the chunky ink border stays on top so the slice still
 * reads as a "slice". Text overlays the image with a thick ink stroke
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
  // edge-to-edge, text overlays at centre.
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
            y={cy + 6}
            fontFamily="var(--font-display)"
            fontWeight="800"
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
        <path d={path} fill={color.fill} stroke={INK_HEX} strokeWidth="2" />
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
              outline so the ink border stays crisp on top. */}
          <path d={path} fill={color.fill} opacity={TINT_OPACITY} />
          <path d={path} fill="none" stroke={INK_HEX} strokeWidth="2" />
        </>
      )}
      {label.trim().length > 0 && (
        <text
          x={labelPos.x}
          y={labelPos.y}
          fontFamily="var(--font-display)"
          fontWeight="800"
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
