"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";
import { generatePuzzle, type Difficulty } from "./generator";

/* -------------------------------------------------------------------------
 * Types + persistence
 * ---------------------------------------------------------------------- */

type Cell = {
  /** 0 = empty, 1–9 = filled. */
  v: number;
  /** True if this cell was part of the generated puzzle (can't be edited). */
  given: boolean;
  /** Bitmask of pencil-marked digits. Bit 0 = note "1", bit 1 = "2", … */
  notes: number;
};

type Game = {
  cells: Cell[];
  /** The unique solution to this puzzle — used for mistake detection
   *  and win check. The user never sees it directly. */
  solution: number[];
  difficulty: Difficulty;
  /** Epoch ms when the puzzle was started. Timer renders elapsed time
   *  as `now - startedAt`. */
  startedAt: number;
  /** Set to `now` when the user fills the final correct cell. While
   *  set, the board is read-only and the win panel is shown. */
  finishedAt: number | null;
  /** Wrong-fill counter. Increments any time a user-filled value
   *  doesn't match the solution. */
  mistakes: number;
};

const GAME_KEY = "hugoslekstuga:sudoku:game";
const NOTES_MODE_KEY = "hugoslekstuga:sudoku:notes-mode";
const PICKER_DEFAULT: Difficulty = "medium";

/* -------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------- */

function rowOf(i: number): number {
  return Math.floor(i / 9);
}
function colOf(i: number): number {
  return i % 9;
}
function boxOf(i: number): number {
  return Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);
}

/** Bit helpers for the notes bitmask. */
function noteBit(v: number): number {
  return 1 << (v - 1);
}
function hasNote(notes: number, v: number): boolean {
  return (notes & noteBit(v)) !== 0;
}
function toggleNote(notes: number, v: number): number {
  return notes ^ noteBit(v);
}

/** True if any cell that shares a row, column, or box with `i` holds
 *  the same value as the cell at `i`. Used for conflict highlighting
 *  on the board. Treats 0 (empty) as never conflicting. */
function isConflict(cells: Cell[], i: number): boolean {
  const v = cells[i].v;
  if (v === 0) return false;
  const r = rowOf(i),
    c = colOf(i),
    b = boxOf(i);
  for (let j = 0; j < 81; j++) {
    if (j === i) continue;
    if (cells[j].v !== v) continue;
    if (rowOf(j) === r || colOf(j) === c || boxOf(j) === b) return true;
  }
  return false;
}

/** Pad a duration in ms to `m:ss` (or `mm:ss` past 10 minutes). */
function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function freshGame(difficulty: Difficulty): Game {
  const { puzzle, solution } = generatePuzzle(difficulty);
  const cells: Cell[] = puzzle.map((v) => ({
    v,
    given: v !== 0,
    notes: 0,
  }));
  return {
    cells,
    solution,
    difficulty,
    startedAt: Date.now(),
    finishedAt: null,
    mistakes: 0,
  };
}

/* -------------------------------------------------------------------------
 * The component
 * ---------------------------------------------------------------------- */

const DEFAULT_GAME_VALUE: Game | null = null;

export default function SudokuClient() {
  const tool = findTool("sudoku")!;
  const [game, setGame] = useLocalStorageState<Game | null>(
    GAME_KEY,
    DEFAULT_GAME_VALUE,
  );
  const [notesMode, setNotesMode] = useLocalStorageState<boolean>(
    NOTES_MODE_KEY,
    false,
  );
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [pickerDifficulty, setPickerDifficulty] =
    useState<Difficulty>(PICKER_DEFAULT);

  // Tick-driven timer — `now` updates each second while a game is
  // active and unfinished, so the displayed elapsed time stays live
  // without re-rendering the whole game tree on every animation frame.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!game || game.finishedAt !== null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [game]);

  /* ------------------------------------------------------------------
   * Derived state
   * ---------------------------------------------------------------- */

  // For each cell, whether it conflicts with any peer. Precomputed
  // once per render so the board doesn't recompute it 81 times.
  const conflictMask = useMemo<boolean[]>(() => {
    if (!game) return [];
    return game.cells.map((_, i) => isConflict(game.cells, i));
  }, [game]);

  const selectedValue = useMemo<number>(() => {
    if (!game || selectedIdx === null) return 0;
    return game.cells[selectedIdx].v;
  }, [game, selectedIdx]);

  // Per-digit remaining count — number of cells with that value still
  // unplaced. When it reaches 0 the number pad shows the button as
  // "complete" (faded).
  const remainingByValue = useMemo<number[]>(() => {
    const counts = new Array<number>(10).fill(0);
    if (!game) return counts;
    for (let v = 1; v <= 9; v++) counts[v] = 9;
    for (const c of game.cells) {
      if (c.v !== 0) counts[c.v]--;
    }
    return counts;
  }, [game]);

  /* ------------------------------------------------------------------
   * Mutations
   * ---------------------------------------------------------------- */

  /** Apply a value or note to the currently selected cell. */
  const applyEntry = useCallback(
    (digit: number) => {
      if (!game) return;
      if (selectedIdx === null) return;
      if (game.finishedAt !== null) return;
      const cell = game.cells[selectedIdx];
      if (cell.given) return;

      const cells = game.cells.slice();
      if (notesMode) {
        // Notes only apply to empty cells — once a value is committed,
        // notes for that cell are cleared anyway.
        if (cell.v !== 0) {
          // Clear the value first so notes can be edited.
          cells[selectedIdx] = { ...cell, v: 0, notes: toggleNote(0, digit) };
        } else {
          cells[selectedIdx] = {
            ...cell,
            notes: toggleNote(cell.notes, digit),
          };
        }
        setGame({ ...game, cells });
        return;
      }

      // Value entry. Always clears the cell's notes — once you commit,
      // pencil marks for THIS cell stop mattering. (Peer notes are
      // intentionally NOT auto-cleared; many Sudoku enthusiasts manage
      // their own notes hygiene.)
      const isCorrect = digit === game.solution[selectedIdx];
      const mistakeBump = !isCorrect && cell.v !== digit ? 1 : 0;
      cells[selectedIdx] = { ...cell, v: digit, notes: 0 };

      const allFilled = cells.every((c) => c.v !== 0);
      const allCorrect =
        allFilled && cells.every((c, i) => c.v === game.solution[i]);

      setGame({
        ...game,
        cells,
        mistakes: game.mistakes + mistakeBump,
        finishedAt: allCorrect ? Date.now() : null,
      });
    },
    [game, selectedIdx, notesMode, setGame],
  );

  const clearSelected = useCallback(() => {
    if (!game) return;
    if (selectedIdx === null) return;
    if (game.finishedAt !== null) return;
    const cell = game.cells[selectedIdx];
    if (cell.given) return;
    if (cell.v === 0 && cell.notes === 0) return;
    const cells = game.cells.slice();
    cells[selectedIdx] = { ...cell, v: 0, notes: 0 };
    setGame({ ...game, cells });
  }, [game, selectedIdx, setGame]);

  /* ------------------------------------------------------------------
   * Keyboard
   * ---------------------------------------------------------------- */

  useEffect(() => {
    if (!game) return;
    const onKey = (e: KeyboardEvent) => {
      // Don't fight inputs / typing-aware UI.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (game.finishedAt !== null) return;
      const k = e.key;
      if (k >= "1" && k <= "9") {
        applyEntry(Number(k));
        return;
      }
      if (k === "Backspace" || k === "Delete" || k === "0") {
        clearSelected();
        return;
      }
      if (k === "n" || k === "N") {
        setNotesMode((n) => !n);
        return;
      }
      if (k === "Escape") {
        setSelectedIdx(null);
        return;
      }
      // Arrow-key navigation. Wraps within the row/col, which feels
      // natural for a 9×9.
      if (
        k === "ArrowUp" ||
        k === "ArrowDown" ||
        k === "ArrowLeft" ||
        k === "ArrowRight"
      ) {
        e.preventDefault();
        const cur = selectedIdx ?? 0;
        let next = cur;
        if (k === "ArrowUp") next = cur >= 9 ? cur - 9 : cur + 72;
        if (k === "ArrowDown") next = cur < 72 ? cur + 9 : cur - 72;
        if (k === "ArrowLeft") next = colOf(cur) > 0 ? cur - 1 : cur + 8;
        if (k === "ArrowRight") next = colOf(cur) < 8 ? cur + 1 : cur - 8;
        setSelectedIdx(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [game, selectedIdx, applyEntry, clearSelected, setNotesMode]);

  /* ------------------------------------------------------------------
   * Render
   * ---------------------------------------------------------------- */

  if (!game) {
    return (
      <ToolFrame tool={tool}>
        <DifficultyPicker
          chosen={pickerDifficulty}
          onChoose={setPickerDifficulty}
          onStart={(d) => {
            setSelectedIdx(null);
            setGame(freshGame(d));
          }}
        />
      </ToolFrame>
    );
  }

  const elapsed = (game.finishedAt ?? now) - game.startedAt;

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col items-stretch gap-5">
        <StatusBar
          elapsed={elapsed}
          difficulty={game.difficulty}
          mistakes={game.mistakes}
        />

        <Board
          cells={game.cells}
          selectedIdx={selectedIdx}
          conflictMask={conflictMask}
          selectedValue={selectedValue}
          onSelect={(i) => setSelectedIdx(i)}
          finished={game.finishedAt !== null}
        />

        <NumberPad
          notesMode={notesMode}
          onSetNotesMode={setNotesMode}
          remainingByValue={remainingByValue}
          onDigit={applyEntry}
          onErase={clearSelected}
          disabled={game.finishedAt !== null}
        />

        <Controls
          onNewGame={() => {
            setSelectedIdx(null);
            setGame(null);
          }}
          onRestart={() => {
            if (!game) return;
            // Restart = clear all user fills, keep the same puzzle.
            const cells = game.cells.map((c) =>
              c.given ? c : { ...c, v: 0, notes: 0 },
            );
            setGame({
              ...game,
              cells,
              mistakes: 0,
              startedAt: Date.now(),
              finishedAt: null,
            });
            setSelectedIdx(null);
          }}
        />

        {game.finishedAt !== null && (
          <WinPanel
            elapsed={elapsed}
            difficulty={game.difficulty}
            mistakes={game.mistakes}
            onNewGame={() => {
              setSelectedIdx(null);
              setGame(null);
            }}
          />
        )}
      </div>
    </ToolFrame>
  );
}

/* -------------------------------------------------------------------------
 * Subcomponents
 * ---------------------------------------------------------------------- */

function DifficultyPicker({
  chosen,
  onChoose,
  onStart,
}: {
  chosen: Difficulty;
  onChoose: (d: Difficulty) => void;
  onStart: (d: Difficulty) => void;
}) {
  const opts: { d: Difficulty; label: string; sub: string }[] = [
    { d: "easy", label: "Easy", sub: "ish 42 clues — mostly forced moves" },
    { d: "medium", label: "Medium", sub: "ish 32 clues — some notes needed" },
    {
      d: "hard",
      label: "Hard",
      sub: "ish 26 clues — bring your pencil marks",
    },
  ];
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="font-display text-2xl font-extrabold tracking-tight">
          Pick a difficulty.
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          Each puzzle is generated fresh and has exactly one solution.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {opts.map((o) => {
          const active = chosen === o.d;
          return (
            <button
              key={o.d}
              type="button"
              onClick={() => onChoose(o.d)}
              className={`card-chunk flex items-center justify-between gap-4 rounded-[var(--radius-card)] px-5 py-4 text-left transition-colors ${
                active ? "bg-pink" : "bg-cream hover:bg-pink-soft"
              }`}
            >
              <div className="flex flex-col">
                <span className="font-display text-lg font-extrabold tracking-tight">
                  {o.label}
                </span>
                <span
                  className={`text-xs ${active ? "text-ink/80" : "text-ink-soft"}`}
                >
                  {o.sub}
                </span>
              </div>
              <span
                aria-hidden
                className={`h-4 w-4 rounded-full border-2 border-ink ${
                  active ? "bg-cream" : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onStart(chosen)}
        className="btn-chunk self-start rounded-[var(--radius-button)] bg-pink px-6 py-3 font-display text-base font-extrabold text-ink"
      >
        Start
      </button>
    </div>
  );
}

function StatusBar({
  elapsed,
  difficulty,
  mistakes,
}: {
  elapsed: number;
  difficulty: Difficulty;
  mistakes: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <Stat label="Difficulty" value={titleCase(difficulty)} />
      <Stat label="Time" value={formatDuration(elapsed)} mono />
      <Stat
        label="Mistakes"
        value={String(mistakes)}
        mono
        muted={mistakes === 0}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
  muted,
}: {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </span>
      <span
        className={`font-display text-lg font-extrabold tracking-tight ${
          mono ? "tabular-nums" : ""
        } ${muted ? "text-ink-muted" : "text-ink"}`}
      >
        {value}
      </span>
    </div>
  );
}

function Board({
  cells,
  selectedIdx,
  conflictMask,
  selectedValue,
  onSelect,
  finished,
}: {
  cells: Cell[];
  selectedIdx: number | null;
  conflictMask: boolean[];
  selectedValue: number;
  onSelect: (i: number) => void;
  finished: boolean;
}) {
  const selRow = selectedIdx === null ? -1 : rowOf(selectedIdx);
  const selCol = selectedIdx === null ? -1 : colOf(selectedIdx);
  const selBox = selectedIdx === null ? -1 : boxOf(selectedIdx);

  return (
    <div
      role="grid"
      aria-label="Sudoku board"
      className="card-chunk mx-auto grid w-full max-w-[min(100%,32rem)] grid-cols-9 overflow-hidden rounded-[var(--radius-card)] border-2 border-ink bg-cream"
      style={{
        aspectRatio: "1 / 1",
      }}
    >
      {cells.map((cell, i) => {
        const r = rowOf(i);
        const c = colOf(i);
        const isSelected = i === selectedIdx;
        const sameRow = r === selRow;
        const sameCol = c === selCol;
        const sameBox = boxOf(i) === selBox;
        const inHighlight = sameRow || sameCol || sameBox;
        const sameValue =
          selectedValue !== 0 && cell.v === selectedValue && !isSelected;
        const conflict = conflictMask[i];

        // Background priority: conflict > selected > sameValue >
        // peer-highlight > base. Given cells get a slightly darker
        // base so they read as "fixed by the puzzle".
        let bg = cell.given ? "bg-cream-deep" : "bg-cream";
        if (inHighlight) bg = cell.given ? "bg-pink-soft/60" : "bg-pink-soft/50";
        if (sameValue) bg = "bg-pink-soft";
        if (isSelected) bg = "bg-pink";
        if (conflict) bg = "bg-tomato-soft";

        // Borders: a uniform 2px reservation per cell so widths stay
        // exactly equal. Colour-only contrast distinguishes the heavy
        // 3×3 box dividers (full ink) from the thin cell dividers
        // (faint ink). Cells in col 8 / row 8 get no right/bottom
        // border — the outer container's border handles those edges.
        const heavyRight = c === 2 || c === 5;
        const heavyBottom = r === 2 || r === 5;
        const showRight = c < 8;
        const showBottom = r < 8;
        const borderRight = !showRight
          ? "border-r-0"
          : heavyRight
            ? "border-r-2 border-r-ink"
            : "border-r-2 border-r-ink/15";
        const borderBottom = !showBottom
          ? "border-b-0"
          : heavyBottom
            ? "border-b-2 border-b-ink"
            : "border-b-2 border-b-ink/15";

        const textCol = cell.given ? "text-ink" : "text-pink";

        return (
          <button
            key={i}
            type="button"
            role="gridcell"
            aria-label={`row ${r + 1}, column ${c + 1}${cell.v ? `, value ${cell.v}` : ", empty"}`}
            aria-selected={isSelected}
            onClick={() => onSelect(i)}
            disabled={finished}
            className={`flex items-center justify-center font-display font-extrabold leading-none transition-colors ${bg} ${textCol} ${borderRight} ${borderBottom}`}
            style={{
              fontSize: "clamp(1.1rem, 4vw, 1.7rem)",
              cursor: finished ? "default" : "pointer",
            }}
          >
            {cell.v !== 0 ? (
              <span>{cell.v}</span>
            ) : cell.notes !== 0 ? (
              <NotesGrid notes={cell.notes} />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function NotesGrid({ notes }: { notes: number }) {
  return (
    <span
      className="grid h-full w-full text-ink-soft"
      style={{
        gridTemplateColumns: "repeat(3, 1fr)",
        gridTemplateRows: "repeat(3, 1fr)",
        fontSize: "0.55rem",
        lineHeight: 1,
        padding: "2px",
      }}
    >
      {Array.from({ length: 9 }, (_, k) => {
        const v = k + 1;
        return (
          <span
            key={v}
            className="flex items-center justify-center font-display font-bold"
          >
            {hasNote(notes, v) ? v : ""}
          </span>
        );
      })}
    </span>
  );
}

function NumberPad({
  notesMode,
  onSetNotesMode,
  remainingByValue,
  onDigit,
  onErase,
  disabled,
}: {
  notesMode: boolean;
  onSetNotesMode: (v: boolean | ((p: boolean) => boolean)) => void;
  remainingByValue: number[];
  onDigit: (d: number) => void;
  onErase: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-9 gap-1.5">
        {Array.from({ length: 9 }, (_, i) => {
          const v = i + 1;
          const done = remainingByValue[v] <= 0;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onDigit(v)}
              disabled={disabled || done}
              className={`btn-chunk flex aspect-square items-center justify-center rounded-[var(--radius-button)] font-display text-xl font-extrabold transition-opacity ${
                done
                  ? "bg-cream-deep text-ink-muted opacity-50"
                  : notesMode
                    ? "bg-pink-soft text-ink"
                    : "bg-pink text-ink"
              }`}
              aria-label={`Place ${v}`}
            >
              {v}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onSetNotesMode((n) => !n)}
          disabled={disabled}
          aria-pressed={notesMode}
          className={`btn-chunk rounded-[var(--radius-button)] px-4 py-2 text-sm font-display font-extrabold ${
            notesMode ? "bg-ink text-cream" : "bg-cream text-ink"
          }`}
        >
          {notesMode ? "Notes: on" : "Notes: off"}
        </button>
        <button
          type="button"
          onClick={onErase}
          disabled={disabled}
          className="btn-chunk rounded-[var(--radius-button)] bg-cream px-4 py-2 text-sm font-display font-extrabold text-ink"
        >
          Erase
        </button>
        <p className="ml-auto self-center text-[11px] text-ink-muted">
          1–9 to place · N for notes · backspace to erase
        </p>
      </div>
    </div>
  );
}

function Controls({
  onNewGame,
  onRestart,
}: {
  onNewGame: () => void;
  onRestart: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t-2 border-dashed border-ink/15 pt-4">
      <button
        type="button"
        onClick={onNewGame}
        className="btn-chunk rounded-[var(--radius-button)] bg-cream px-4 py-2 text-sm font-display font-extrabold text-ink"
      >
        New puzzle
      </button>
      <button
        type="button"
        onClick={onRestart}
        className="btn-chunk rounded-[var(--radius-button)] bg-cream px-4 py-2 text-sm font-display font-extrabold text-ink"
      >
        Restart this one
      </button>
    </div>
  );
}

function WinPanel({
  elapsed,
  difficulty,
  mistakes,
  onNewGame,
}: {
  elapsed: number;
  difficulty: Difficulty;
  mistakes: number;
  onNewGame: () => void;
}) {
  return (
    <div className="card-chunk relative flex flex-col items-center gap-4 rounded-[var(--radius-card)] bg-pink p-6 text-center">
      <p className="font-display text-3xl font-extrabold tracking-tight text-ink">
        Solved.
      </p>
      <div className="flex items-center justify-center gap-6">
        <Stat label="Difficulty" value={titleCase(difficulty)} />
        <Stat label="Time" value={formatDuration(elapsed)} mono />
        <Stat
          label="Mistakes"
          value={String(mistakes)}
          mono
          muted={mistakes === 0}
        />
      </div>
      <button
        type="button"
        onClick={onNewGame}
        className="btn-chunk rounded-[var(--radius-button)] bg-ink px-5 py-2 text-sm font-display font-extrabold text-cream"
      >
        Another one
      </button>
    </div>
  );
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
