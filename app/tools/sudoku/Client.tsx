"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";
import { localISODate } from "@/lib/dates";
import {
  generatePuzzle,
  mulberry32,
  PEERS_OF,
  seedFromDate,
  type Difficulty,
} from "./generator";

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
  /** The unique solution to this puzzle — used for mistake detection,
   *  hint reveals, and win check. The user never sees it directly. */
  solution: number[];
  difficulty: Difficulty;
  /** Epoch ms when the puzzle was started. Timer renders elapsed time
   *  as `now - startedAt`. When the puzzle is paused and resumed,
   *  startedAt is shifted forward by the pause duration — so elapsed
   *  always equals `now - startedAt` without any additional bookkeeping. */
  startedAt: number;
  /** Epoch ms when the user paused (set on pause, cleared on resume).
   *  While set, the board is overlaid with a "Paused" panel so the
   *  player can take a break without staring at the puzzle. */
  pausedAt: number | null;
  /** Set to `now` when the user fills the final correct cell. While
   *  set, the board is read-only and the win panel is shown. */
  finishedAt: number | null;
  /** Wrong-fill counter. Increments any time a user-filled value
   *  doesn't match the solution. */
  mistakes: number;
  /** Number of times the player used the Hint button. Shown in the
   *  win panel as a small "honest record" of how much help they
   *  needed. */
  hintsUsed: number;
  /** YYYY-MM-DD if this puzzle came from the "Today's puzzle" picker.
   *  Same date → same puzzle, deterministically seeded on the client.
   *  Absent on regular generated puzzles. */
  daily?: string;
  /** True if the puzzle was started in strict mode. In strict mode,
   *  reaching STRICT_MISTAKE_CAP mistakes ends the run with a loss
   *  panel instead of a win panel. Absent / false = lenient (current
   *  default) — mistakes are just a counter, never fatal. */
  strict?: boolean;
  /** Set when strict mode reaches its mistake cap. Distinct from
   *  finishedAt (which means "solved correctly") so the renderer can
   *  pick the right end panel. Absent on lenient and on running games. */
  lostAt?: number | null;
};

const GAME_KEY = "hugoslekstuga:sudoku:game";
const NOTES_MODE_KEY = "hugoslekstuga:sudoku:notes-mode";
const BEST_TIMES_KEY = "hugoslekstuga:sudoku:best-times";
const DAILY_SOLVED_KEY = "hugoslekstuga:sudoku:daily-solved";
const STRICT_PREF_KEY = "hugoslekstuga:sudoku:strict-pref";
const PICKER_DEFAULT: Difficulty = "medium";
/** Strict mode tolerates this many mistakes before ending the run.
 *  Tunable; 3 lines up with classic Minesweeper / Lights Out style
 *  "you've used your lives" pacing. */
const STRICT_MISTAKE_CAP = 3;
/** Difficulty of the daily puzzle. Pinned to medium so the daily is
 *  approachable but not trivial — beating it should feel like an
 *  accomplishment without being a chore. */
const DAILY_DIFFICULTY: Difficulty = "medium";

/** Map of YYYY-MM-DD → true once the daily puzzle for that date has
 *  been solved. Persisted across sessions so the picker can show a
 *  "solved ✓" mark on today's puzzle if the player already finished. */
type DailySolved = Record<string, true>;
const DEFAULT_DAILY_SOLVED: DailySolved = {};

/** Maximum entries kept on the undo stack. Each entry is a shallow
 *  snapshot of the 81-cell array — tiny. 50 is generous; almost no
 *  player ever undoes that deep. */
const UNDO_LIMIT = 50;

type BestTimes = Partial<Record<Difficulty, number>>;

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

/* Completion detection — a row/col/box is "complete" when every cell
 * in it holds the solution's value. The board fires a brief green
 * flash on those nine cells and dispatches `hugoslekstuga:hugo-happy`
 * once per placement, so the player gets a small win moment for
 * progress (not just for solving the whole puzzle). */
function rowComplete(cells: Cell[], solution: number[], r: number): boolean {
  for (let c = 0; c < 9; c++) {
    const i = r * 9 + c;
    if (cells[i].v !== solution[i]) return false;
  }
  return true;
}
function colComplete(cells: Cell[], solution: number[], c: number): boolean {
  for (let r = 0; r < 9; r++) {
    const i = r * 9 + c;
    if (cells[i].v !== solution[i]) return false;
  }
  return true;
}
function boxComplete(cells: Cell[], solution: number[], b: number): boolean {
  const br = Math.floor(b / 3) * 3;
  const bc = (b % 3) * 3;
  for (let dr = 0; dr < 3; dr++) {
    for (let dc = 0; dc < 3; dc++) {
      const i = (br + dr) * 9 + bc + dc;
      if (cells[i].v !== solution[i]) return false;
    }
  }
  return true;
}

/** All 81 cell indices in a row / col / box. Used to translate a
 *  newly-completed `row-3` / `col-7` / `box-2` key into the set of
 *  cells that should briefly flash. */
function cellsInSet(key: string): number[] {
  const [kind, nStr] = key.split("-");
  const n = Number(nStr);
  if (kind === "row") {
    return Array.from({ length: 9 }, (_, c) => n * 9 + c);
  }
  if (kind === "col") {
    return Array.from({ length: 9 }, (_, r) => r * 9 + n);
  }
  // box
  const br = Math.floor(n / 3) * 3;
  const bc = (n % 3) * 3;
  const out: number[] = [];
  for (let dr = 0; dr < 3; dr++) {
    for (let dc = 0; dc < 3; dc++) {
      out.push((br + dr) * 9 + bc + dc);
    }
  }
  return out;
}

/** Which of the placed cell's row, column, or 3×3 box just transitioned
 *  from incomplete to all-correct as a result of this placement?
 *  Local-diff: a single-cell placement can only affect those three
 *  sets, so we don't need to recheck all 27. */
function placedSetCompletions(
  before: Cell[],
  after: Cell[],
  solution: number[],
  idx: number,
): string[] {
  const r = rowOf(idx);
  const c = colOf(idx);
  const b = boxOf(idx);
  const out: string[] = [];
  if (
    !rowComplete(before, solution, r) &&
    rowComplete(after, solution, r)
  ) {
    out.push(`row-${r}`);
  }
  if (
    !colComplete(before, solution, c) &&
    colComplete(after, solution, c)
  ) {
    out.push(`col-${c}`);
  }
  if (
    !boxComplete(before, solution, b) &&
    boxComplete(after, solution, b)
  ) {
    out.push(`box-${b}`);
  }
  return out;
}

const WRONG_SHAKE_MS = 360;
const COMPLETED_FLASH_MS = 900;
const HINT_PULSE_MS = 700;
// Board-wide flash on win. Matches the per-set flash duration so the
// WinPanel fades in over a board that's actively returning to its
// resting state.
const BOARD_WIDE_FLASH_MS = 900;
/** Below this many empty user cells, surface an "almost there"
 *  acknowledgement in the status bar. Tuned so the cue appears at
 *  what feels like the home stretch, not too early. */
const ALMOST_THERE_THRESHOLD = 5;

/** Pad a duration in ms to `m:ss` (or `mm:ss` past 10 minutes). */
function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type FreshGameOptions = {
  /** Today's-puzzle mode. When set, the puzzle is generated from a
   *  deterministic seed derived from `daily` (the YYYY-MM-DD key) so
   *  every client on that date sees the same board. */
  daily?: string;
  /** Strict mode — three mistakes and you're out. */
  strict?: boolean;
};

function freshGame(
  difficulty: Difficulty,
  options: FreshGameOptions = {},
): Game {
  const rng = options.daily
    ? mulberry32(seedFromDate(options.daily))
    : Math.random;
  const { puzzle, solution } = generatePuzzle(difficulty, rng);
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
    pausedAt: null,
    finishedAt: null,
    mistakes: 0,
    hintsUsed: 0,
    daily: options.daily,
    strict: options.strict,
    lostAt: null,
  };
}

/** Strip `digit` from the notes of every cell that shares a row,
 *  column, or 3×3 box with `i`. Returns a new cells array so React
 *  state stays immutable; if no peer notes change, returns the
 *  original cells unchanged so a no-op doesn't trigger a re-render. */
function clearPeerNotes(
  cells: Cell[],
  i: number,
  digit: number,
): Cell[] {
  const bit = noteBit(digit);
  let next: Cell[] | null = null;
  for (const p of PEERS_OF[i]) {
    const c = cells[p];
    if ((c.notes & bit) === 0) continue;
    if (!next) next = cells.slice();
    next[p] = { ...c, notes: c.notes & ~bit };
  }
  return next ?? cells;
}

/* -------------------------------------------------------------------------
 * The component
 * ---------------------------------------------------------------------- */

const DEFAULT_GAME_VALUE: Game | null = null;

const DEFAULT_BEST_TIMES: BestTimes = {};

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
  const [bestTimes, setBestTimes] = useLocalStorageState<BestTimes>(
    BEST_TIMES_KEY,
    DEFAULT_BEST_TIMES,
  );
  // Persisted YYYY-MM-DD → solved-flag map for daily puzzles. Read by
  // the picker so it can show a small ✓ on "Today's puzzle" when the
  // player already finished today's, and by the win panel so a daily
  // solve writes the entry.
  const [dailySolved, setDailySolved] = useLocalStorageState<DailySolved>(
    DAILY_SOLVED_KEY,
    DEFAULT_DAILY_SOLVED,
  );
  // Player's strict-mode preference. Persisted so the toggle stays
  // sticky between sessions for players who like the harder ruleset.
  const [strictPref, setStrictPref] = useLocalStorageState<boolean>(
    STRICT_PREF_KEY,
    false,
  );
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [pickerDifficulty, setPickerDifficulty] =
    useState<Difficulty>(PICKER_DEFAULT);
  // Undo stack — local to this session (not persisted). Each entry is
  // a snapshot of the cells array taken BEFORE the mutation that
  // produced the current state. Pop on undo and restore. `historyLen`
  // mirrors `historyRef.current.length` as React state so the render
  // can derive `canUndo` without reading the ref during render.
  const historyRef = useRef<Cell[][]>([]);
  const [historyLen, setHistoryLen] = useState(0);
  // `lastNewBest` flags a fresh personal best so the win panel can
  // celebrate it. Cleared when a new game starts.
  const [lastNewBest, setLastNewBest] = useState<boolean>(false);

  // Transient visual flags driven by placements.
  //
  //  - `wrongPlacedIdx` — the cell the player just placed a wrong
  //    digit into. Cleared after WRONG_SHAKE_MS so the shake plays
  //    once. Strong "that move was a mistake" signal in addition to
  //    the static conflict styling.
  //
  //  - `completedFlashIndices` — the cells in any row/col/box that
  //    just transitioned from incomplete to all-correct as a result
  //    of the most recent placement. Cleared after COMPLETED_FLASH_MS.
  //    Detected via a local before/after diff in applyEntry/hint, so
  //    undo cleanly "un-completes" a set and a re-placement re-flashes.
  const [wrongPlacedIdx, setWrongPlacedIdx] = useState<number | null>(null);
  const [completedFlashIndices, setCompletedFlashIndices] = useState<number[]>(
    [],
  );
  // `hintRevealedIdx` — the cell the hint button just revealed. Drives
  // a short ring-pulse animation so the player's eye lands on what
  // changed without scanning the whole grid. Cleared after
  // HINT_PULSE_MS.
  const [hintRevealedIdx, setHintRevealedIdx] = useState<number | null>(null);
  // `boardWideFlash` — on the winning placement, every cell briefly
  // tints green-soft. Reuses the per-set flash keyframe; cleared after
  // BOARD_WIDE_FLASH_MS so the WinPanel arrives over a cooling board.
  const [boardWideFlash, setBoardWideFlash] = useState(false);
  const wrongTimerRef = useRef<number | null>(null);
  const completedTimerRef = useRef<number | null>(null);
  const hintTimerRef = useRef<number | null>(null);
  const boardWideFlashTimerRef = useRef<number | null>(null);

  // Tick-driven timer — `now` updates each second while a game is
  // active, unfinished, and not paused. The displayed elapsed time
  // stays live without re-rendering the whole game tree on every rAF.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!game || game.finishedAt !== null || game.pausedAt !== null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [game]);

  // Reset session-local state whenever the game id changes (new
  // puzzle, restart). Looks at startedAt as a proxy for "this is a
  // different game now". The setState calls here are one-shot edge
  // resets, not cascading renders — suppressing the lint accordingly.
  const gameStartedAt = game?.startedAt;
  useEffect(() => {
    historyRef.current = [];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistoryLen(0);
    setLastNewBest(false);
    // Clear any in-flight transient visuals from the previous game.
    setWrongPlacedIdx(null);
    setCompletedFlashIndices([]);
    setHintRevealedIdx(null);
    setBoardWideFlash(false);
  }, [gameStartedAt]);

  // Cleanup transient-flash timers on unmount so a navigation away
  // mid-flash doesn't leak.
  useEffect(() => {
    return () => {
      if (wrongTimerRef.current) window.clearTimeout(wrongTimerRef.current);
      if (completedTimerRef.current)
        window.clearTimeout(completedTimerRef.current);
      if (hintTimerRef.current) window.clearTimeout(hintTimerRef.current);
      if (boardWideFlashTimerRef.current)
        window.clearTimeout(boardWideFlashTimerRef.current);
    };
  }, []);

  /** Push the current cells snapshot onto the undo stack before a
   *  mutation. Caps the stack to UNDO_LIMIT entries. */
  const pushHistory = useCallback((cells: Cell[]) => {
    historyRef.current.push(cells);
    if (historyRef.current.length > UNDO_LIMIT) historyRef.current.shift();
    setHistoryLen(historyRef.current.length);
  }, []);

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
      if (game.lostAt) return;
      if (game.pausedAt !== null) return;
      const cell = game.cells[selectedIdx];
      if (cell.given) return;

      pushHistory(game.cells);

      let cells = game.cells.slice();
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
      // pencil marks for THIS cell stop mattering. *And* auto-eliminates
      // that digit from peer cells' notes — the single biggest QoL
      // win for serious Sudoku players (saves manual notes hygiene).
      const isCorrect = digit === game.solution[selectedIdx];
      const isPlacementChange = cell.v !== digit;
      const mistakeBump = !isCorrect && isPlacementChange ? 1 : 0;
      cells[selectedIdx] = { ...cell, v: digit, notes: 0 };
      cells = clearPeerNotes(cells, selectedIdx, digit);

      const allFilled = cells.every((c) => c.v !== 0);
      const allCorrect =
        allFilled && cells.every((c, i) => c.v === game.solution[i]);

      // Wrong-placement shake — fires once on the just-placed cell so
      // the mistake reads physically, not just through the small
      // mistake counter in the status bar. Skipped when the user is
      // re-affirming a value they already had.
      if (!isCorrect && isPlacementChange) {
        const placedIdx = selectedIdx;
        setWrongPlacedIdx(placedIdx);
        if (wrongTimerRef.current) window.clearTimeout(wrongTimerRef.current);
        wrongTimerRef.current = window.setTimeout(() => {
          setWrongPlacedIdx((current) =>
            current === placedIdx ? null : current,
          );
          wrongTimerRef.current = null;
        }, WRONG_SHAKE_MS);
      }

      // Row / col / box completion detection. Local diff: a placement
      // can only complete the placed cell's row, column, or box.
      // Flash those cells green and dispatch hugo-happy once.
      // Suppressed when the whole puzzle just solved — the full-solve
      // path below fires its own Hugo cheer and dominates the moment.
      const newlyCompleted = placedSetCompletions(
        game.cells,
        cells,
        game.solution,
        selectedIdx,
      );
      if (newlyCompleted.length > 0 && !allCorrect) {
        const flashed = new Set<number>();
        for (const key of newlyCompleted) {
          for (const i of cellsInSet(key)) flashed.add(i);
        }
        setCompletedFlashIndices([...flashed]);
        if (completedTimerRef.current)
          window.clearTimeout(completedTimerRef.current);
        completedTimerRef.current = window.setTimeout(() => {
          setCompletedFlashIndices([]);
          completedTimerRef.current = null;
        }, COMPLETED_FLASH_MS);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("hugoslekstuga:hugo-happy"));
        }
      }

      const nextMistakes = game.mistakes + mistakeBump;

      // Strict-mode loss check. Hitting the mistake cap ends the run
      // immediately with a loss-panel render path, distinct from the
      // win path. Lenient (default) games never set lostAt, so the
      // mistake counter is just a counter there.
      const strict = game.strict === true;
      let lostAt: number | null = null;
      if (strict && nextMistakes >= STRICT_MISTAKE_CAP && !allCorrect) {
        lostAt = Date.now();
      }

      let finishedAt: number | null = null;
      if (allCorrect) {
        finishedAt = Date.now();
        const elapsed = finishedAt - game.startedAt;
        // Track best time per difficulty. Don't count puzzles with
        // hints used toward best times — that'd let players game the
        // leaderboard by spamming hints. Mistakes are still allowed
        // since they don't strictly help solve.
        if (game.hintsUsed === 0) {
          const prev = bestTimes[game.difficulty];
          if (prev === undefined || elapsed < prev) {
            setBestTimes({ ...bestTimes, [game.difficulty]: elapsed });
            setLastNewBest(true);
          }
        }
        // Daily-puzzle bookkeeping. Once solved, mark the date so the
        // picker can show a ✓ and the player can't replay it for "first
        // solve today" credit — re-attempts still play normally.
        if (game.daily && !dailySolved[game.daily]) {
          setDailySolved({ ...dailySolved, [game.daily]: true });
        }
        // Tell Hugo to be happy. The BrandDot in the nav listens and
        // bursts coloured sparkles above his head.
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("hugoslekstuga:hugo-happy"));
        }
        // Board-wide green sweep on the winning placement. Every cell
        // briefly tints green-soft so the board itself acknowledges
        // the solve, before the WinPanel rises into view above it.
        setBoardWideFlash(true);
        if (boardWideFlashTimerRef.current)
          window.clearTimeout(boardWideFlashTimerRef.current);
        boardWideFlashTimerRef.current = window.setTimeout(() => {
          setBoardWideFlash(false);
          boardWideFlashTimerRef.current = null;
        }, BOARD_WIDE_FLASH_MS);
      }

      setGame({
        ...game,
        cells,
        mistakes: nextMistakes,
        finishedAt,
        lostAt,
      });
    },
    [
      game,
      selectedIdx,
      notesMode,
      setGame,
      pushHistory,
      bestTimes,
      setBestTimes,
      dailySolved,
      setDailySolved,
    ],
  );

  const clearSelected = useCallback(() => {
    if (!game) return;
    if (selectedIdx === null) return;
    if (game.finishedAt !== null) return;
    if (game.lostAt) return;
    if (game.pausedAt !== null) return;
    const cell = game.cells[selectedIdx];
    if (cell.given) return;
    if (cell.v === 0 && cell.notes === 0) return;
    pushHistory(game.cells);
    const cells = game.cells.slice();
    cells[selectedIdx] = { ...cell, v: 0, notes: 0 };
    setGame({ ...game, cells });
  }, [game, selectedIdx, setGame, pushHistory]);

  const undo = useCallback(() => {
    if (!game) return;
    if (game.finishedAt !== null) return;
    if (game.lostAt) return;
    if (game.pausedAt !== null) return;
    const prev = historyRef.current.pop();
    if (!prev) return;
    setHistoryLen(historyRef.current.length);
    setGame({ ...game, cells: prev });
  }, [game, setGame]);

  /** Hint reveals the solution value for one cell. Prefers the
   *  currently selected empty cell (so the user can ask "what goes
   *  here?"); otherwise picks the first empty cell. Bumps hintsUsed
   *  and disqualifies the puzzle from the best-time leaderboard. */
  const hint = useCallback(() => {
    if (!game) return;
    if (game.finishedAt !== null) return;
    if (game.lostAt) return;
    if (game.pausedAt !== null) return;
    let target = -1;
    if (
      selectedIdx !== null &&
      !game.cells[selectedIdx].given &&
      game.cells[selectedIdx].v === 0
    ) {
      target = selectedIdx;
    } else {
      // First empty cell, in reading order. Predictable rather than
      // random — easier to debug, and the player can request hints
      // for specific cells via selection if they want surgical help.
      target = game.cells.findIndex((c) => c.v === 0 && !c.given);
    }
    if (target < 0) return;
    pushHistory(game.cells);
    const correct = game.solution[target];
    let cells = game.cells.slice();
    cells[target] = { v: correct, given: false, notes: 0 };
    cells = clearPeerNotes(cells, target, correct);
    setSelectedIdx(target);

    // Pulse-highlight the revealed cell so the eye lands on what just
    // changed. Cleared after HINT_PULSE_MS; multiple rapid hints just
    // re-target the same animation.
    setHintRevealedIdx(target);
    if (hintTimerRef.current) window.clearTimeout(hintTimerRef.current);
    hintTimerRef.current = window.setTimeout(() => {
      setHintRevealedIdx(null);
      hintTimerRef.current = null;
    }, HINT_PULSE_MS);

    const allFilled = cells.every((c) => c.v !== 0);
    const allCorrect =
      allFilled && cells.every((c, i) => c.v === game.solution[i]);

    // Same completion-flash + Hugo-cheer wiring as applyEntry. A hint
    // can finish a row/col/box too, and the player should feel that
    // even when the digit came from a hint.
    const newlyCompleted = placedSetCompletions(
      game.cells,
      cells,
      game.solution,
      target,
    );
    if (newlyCompleted.length > 0 && !allCorrect) {
      const flashed = new Set<number>();
      for (const key of newlyCompleted) {
        for (const i of cellsInSet(key)) flashed.add(i);
      }
      setCompletedFlashIndices([...flashed]);
      if (completedTimerRef.current)
        window.clearTimeout(completedTimerRef.current);
      completedTimerRef.current = window.setTimeout(() => {
        setCompletedFlashIndices([]);
        completedTimerRef.current = null;
      }, COMPLETED_FLASH_MS);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("hugoslekstuga:hugo-happy"));
      }
    }

    let finishedAt: number | null = null;
    if (allCorrect) {
      finishedAt = Date.now();
      // Daily-solved bookkeeping mirrors the applyEntry path — a hint
      // can complete the final cell, and the daily ✓ should land
      // either way.
      if (game.daily && !dailySolved[game.daily]) {
        setDailySolved({ ...dailySolved, [game.daily]: true });
      }
      // Hints in this puzzle → no best-time eligibility, but Hugo
      // still gets to celebrate.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("hugoslekstuga:hugo-happy"));
      }
      // Board-wide green sweep on the winning hint, same as applyEntry.
      setBoardWideFlash(true);
      if (boardWideFlashTimerRef.current)
        window.clearTimeout(boardWideFlashTimerRef.current);
      boardWideFlashTimerRef.current = window.setTimeout(() => {
        setBoardWideFlash(false);
        boardWideFlashTimerRef.current = null;
      }, BOARD_WIDE_FLASH_MS);
    }

    setGame({
      ...game,
      cells,
      hintsUsed: game.hintsUsed + 1,
      finishedAt,
    });
  }, [game, selectedIdx, setGame, pushHistory, dailySolved, setDailySolved]);

  /** Pause toggle. While paused, the timer stops (we shift startedAt
   *  forward by the pause duration on resume) and a "Paused" overlay
   *  hides the board so the player can step away without staring at
   *  the puzzle. */
  const togglePause = useCallback(() => {
    if (!game) return;
    if (game.finishedAt !== null) return;
    if (game.lostAt) return;
    if (game.pausedAt === null) {
      setGame({ ...game, pausedAt: Date.now() });
    } else {
      const pauseMs = Date.now() - game.pausedAt;
      setGame({
        ...game,
        pausedAt: null,
        startedAt: game.startedAt + pauseMs,
      });
    }
  }, [game, setGame]);

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
      if (game.lostAt) return;
      const k = e.key;
      // Pause toggle works while paused too (so the user can resume).
      if (k === "p" || k === "P") {
        togglePause();
        return;
      }
      // Other actions are blocked while paused — the board is hidden.
      if (game.pausedAt !== null) return;
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
      if (k === "h" || k === "H") {
        hint();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (k === "z" || k === "Z")) {
        e.preventDefault();
        undo();
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
  }, [
    game,
    selectedIdx,
    applyEntry,
    clearSelected,
    setNotesMode,
    undo,
    hint,
    togglePause,
  ]);

  /* ------------------------------------------------------------------
   * Render
   * ---------------------------------------------------------------- */

  if (!game) {
    const todayKey = localISODate(new Date());
    const todaySolved = Boolean(dailySolved[todayKey]);
    return (
      <ToolFrame tool={tool}>
        <DifficultyPicker
          chosen={pickerDifficulty}
          onChoose={setPickerDifficulty}
          strict={strictPref}
          onChangeStrict={setStrictPref}
          todayKey={todayKey}
          todaySolved={todaySolved}
          onStartDaily={() => {
            setSelectedIdx(null);
            setGame(
              freshGame(DAILY_DIFFICULTY, {
                daily: todayKey,
                strict: strictPref,
              }),
            );
          }}
          onStart={(d) => {
            setSelectedIdx(null);
            setGame(freshGame(d, { strict: strictPref }));
          }}
        />
      </ToolFrame>
    );
  }

  // While paused, elapsed = how long it had been at the moment of
  // pause. (After resume, startedAt is shifted forward so live
  // elapsed still equals `now - startedAt`.)
  const elapsed =
    game.pausedAt !== null
      ? game.pausedAt - game.startedAt
      : (game.finishedAt ?? now) - game.startedAt;

  const paused = game.pausedAt !== null;
  const finished = game.finishedAt !== null;
  const lost = Boolean(game.lostAt);
  // Empty user cells left to fill — drives the "almost there" hint
  // in the status bar. Doesn't count given clues (already correct).
  const emptyUserCells = game.cells.reduce(
    (n, c) => (!c.given && c.v === 0 ? n + 1 : n),
    0,
  );
  const canUndo = historyLen > 0;
  const hasEmptyCell = emptyUserCells > 0;

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col items-stretch gap-5">
        <StatusBar
          elapsed={elapsed}
          difficulty={game.difficulty}
          mistakes={game.mistakes}
          hintsUsed={game.hintsUsed}
          paused={paused}
          daily={game.daily}
          strict={game.strict === true}
          strictCap={STRICT_MISTAKE_CAP}
          almostThere={
            !finished && !lost && !paused && emptyUserCells > 0 &&
            emptyUserCells <= ALMOST_THERE_THRESHOLD
          }
          emptyUserCells={emptyUserCells}
        />

        <div className="relative">
          <Board
            cells={game.cells}
            selectedIdx={selectedIdx}
            conflictMask={conflictMask}
            selectedValue={selectedValue}
            wrongPlacedIdx={wrongPlacedIdx}
            completedFlashIndices={completedFlashIndices}
            hintRevealedIdx={hintRevealedIdx}
            boardWideFlash={boardWideFlash}
            onSelect={(i) => setSelectedIdx(i)}
            finished={finished || paused || lost}
            hidden={paused}
          />
          {paused && (
            <button
              type="button"
              onClick={togglePause}
              className="card-chunk absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] bg-pink-soft text-center"
              aria-label="Resume"
            >
              <p className="font-display text-3xl font-extrabold tracking-tight">
                Paused
              </p>
              <p className="text-sm text-ink-soft">
                Tap to resume
              </p>
            </button>
          )}
        </div>

        <NumberPad
          notesMode={notesMode}
          onSetNotesMode={setNotesMode}
          remainingByValue={remainingByValue}
          onDigit={applyEntry}
          onErase={clearSelected}
          onUndo={undo}
          onHint={hint}
          onPause={togglePause}
          canUndo={canUndo}
          canHint={hasEmptyCell}
          paused={paused}
          disabled={finished || paused || lost}
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
              hintsUsed: 0,
              startedAt: Date.now(),
              pausedAt: null,
              finishedAt: null,
              lostAt: null,
            });
            historyRef.current = [];
            setSelectedIdx(null);
          }}
        />

        {finished && (
          <WinPanel
            elapsed={elapsed}
            difficulty={game.difficulty}
            mistakes={game.mistakes}
            hintsUsed={game.hintsUsed}
            bestTime={bestTimes[game.difficulty]}
            isNewBest={lastNewBest}
            daily={game.daily}
            onNewGame={() => {
              setSelectedIdx(null);
              setGame(null);
            }}
          />
        )}

        {lost && (
          <LossPanel
            mistakes={game.mistakes}
            cap={STRICT_MISTAKE_CAP}
            onRestart={() => {
              if (!game) return;
              const cells = game.cells.map((c) =>
                c.given ? c : { ...c, v: 0, notes: 0 },
              );
              setGame({
                ...game,
                cells,
                mistakes: 0,
                hintsUsed: 0,
                startedAt: Date.now(),
                pausedAt: null,
                finishedAt: null,
                lostAt: null,
              });
              historyRef.current = [];
              setSelectedIdx(null);
            }}
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
  strict,
  onChangeStrict,
  todayKey,
  todaySolved,
  onStartDaily,
}: {
  chosen: Difficulty;
  onChoose: (d: Difficulty) => void;
  onStart: (d: Difficulty) => void;
  strict: boolean;
  onChangeStrict: (next: boolean) => void;
  todayKey: string;
  todaySolved: boolean;
  onStartDaily: () => void;
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

      {/* Today's puzzle — same board for everyone on this date,
          generated locally from a seed (no server round-trip). The
          solved-state mark persists in localStorage. */}
      <button
        type="button"
        onClick={onStartDaily}
        className="card-chunk flex items-center justify-between gap-4 rounded-[var(--radius-card)] bg-yellow px-5 py-4 text-left text-cream"
      >
        <div className="flex flex-col">
          <span className="flex items-center gap-2 font-display text-lg font-extrabold tracking-tight text-cream">
            Today&rsquo;s puzzle
            {todaySolved && (
              <span
                aria-label="Solved today"
                title="You already solved today's puzzle"
                className="rounded-full border-2 border-ink bg-cream px-2 py-0.5 font-pixel text-[10px] uppercase tracking-wide text-ink"
              >
                Solved ✓
              </span>
            )}
          </span>
          <span className="text-xs text-cream/80">
            Same medium puzzle for everyone today · {todayKey}
          </span>
        </div>
        <span aria-hidden className="font-display text-2xl font-extrabold text-cream">
          →
        </span>
      </button>

      <div className="flex flex-col gap-2">
        {opts.map((o) => {
          const active = chosen === o.d;
          return (
            <button
              key={o.d}
              type="button"
              onClick={() => onChoose(o.d)}
              className={`card-chunk flex items-center justify-between gap-4 rounded-[var(--radius-card)] px-5 py-4 text-left transition-colors ${
                active
                  ? "bg-pink text-cream"
                  : "bg-cream-deep text-ink hover:bg-pink-soft"
              }`}
            >
              <div className="flex flex-col">
                <span className="font-display text-lg font-extrabold tracking-tight">
                  {o.label}
                </span>
                <span
                  className={`text-xs ${active ? "text-cream/80" : "text-ink-soft"}`}
                >
                  {o.sub}
                </span>
              </div>
              <span
                aria-hidden
                className={`h-4 w-4 rounded-full border-2 ${
                  active
                    ? "border-cream bg-cream"
                    : "border-ink bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>

      {/* Strict-mode toggle. Applies to both today's puzzle and the
          standard-difficulty options. Sticky across sessions. */}
      <button
        type="button"
        onClick={() => onChangeStrict(!strict)}
        aria-pressed={strict}
        className={`flex items-center justify-between gap-3 rounded-full border-2 border-dashed border-ink-muted px-4 py-2.5 text-left transition-colors ${
          strict ? "bg-tomato-soft" : "bg-cream-deep hover:bg-panel"
        }`}
      >
        <div className="flex flex-col">
          <span className="text-sm font-display font-extrabold tracking-tight">
            Strict mode
          </span>
          <span className="text-[11px] text-ink-soft">
            {strict
              ? `Three mistakes and the run ends. Wrong moves matter.`
              : `Off — mistakes are just a counter. Toggle for stakes.`}
          </span>
        </div>
        <span
          aria-hidden
          className={`flex h-6 w-12 items-center rounded-full border-2 border-ink p-0.5 ${strict ? "justify-end bg-tomato" : "justify-start bg-cream"}`}
        >
          <span className="h-4 w-4 rounded-full bg-cream-deep border border-ink" />
        </span>
      </button>

      <button
        type="button"
        onClick={() => onStart(chosen)}
        className="btn-chunk self-start rounded-[var(--radius-button)] bg-pink px-6 py-3 font-display text-base font-extrabold text-cream"
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
  hintsUsed,
  paused,
  daily,
  strict,
  strictCap,
  almostThere,
  emptyUserCells,
}: {
  elapsed: number;
  difficulty: Difficulty;
  mistakes: number;
  hintsUsed: number;
  paused: boolean;
  /** YYYY-MM-DD if this is the daily puzzle; renders an alt label. */
  daily?: string;
  /** Strict-mode flag — switches the mistake stat to read X/CAP. */
  strict: boolean;
  strictCap: number;
  /** True when the player is in the home stretch (few empty cells left). */
  almostThere: boolean;
  /** Empty user cells remaining; surfaced inside the almost-there pill. */
  emptyUserCells: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <Stat
          label="Difficulty"
          value={daily ? "Today" : titleCase(difficulty)}
        />
        <Stat
          label={paused ? "Paused" : "Time"}
          value={formatDuration(elapsed)}
          mono
          muted={paused}
        />
        <Stat
          label="Mistakes"
          value={strict ? `${mistakes}/${strictCap}` : String(mistakes)}
          mono
          muted={mistakes === 0}
        />
        {hintsUsed > 0 && (
          <Stat label="Hints" value={String(hintsUsed)} mono />
        )}
      </div>
      {almostThere && (
        <p className="self-end rounded-full border-2 border-dashed border-yellow bg-yellow-soft px-3 py-0.5 text-[11px] font-bold tracking-wide text-ink">
          almost there — {emptyUserCells}{" "}
          {emptyUserCells === 1 ? "cell" : "cells"} to go
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
  muted,
  onAccent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
  /** True when the stat sits on a bright accent surface (the win
   *  panel's magenta card) — every accent wants room-dark text, so
   *  the ink/phosphor palette flips to cream. */
  onAccent?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className={`font-pixel text-[10px] uppercase tracking-wider ${
          onAccent ? "text-cream/70" : "text-ink-muted"
        }`}
      >
        {label}
      </span>
      <span
        className={`font-display text-lg font-extrabold tracking-tight ${
          mono ? "tabular-nums" : ""
        } ${
          muted
            ? onAccent
              ? "text-cream/70"
              : "text-ink-muted"
            : onAccent
              ? "text-cream"
              : "text-ink"
        }`}
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
  wrongPlacedIdx,
  completedFlashIndices,
  hintRevealedIdx,
  boardWideFlash,
  onSelect,
  finished,
  hidden,
}: {
  cells: Cell[];
  selectedIdx: number | null;
  conflictMask: boolean[];
  selectedValue: number;
  /** Cell index that just received a wrong placement; gets a brief
   *  shake. Null when no recent mistake is mid-animation. */
  wrongPlacedIdx: number | null;
  /** Cell indices belonging to a row/col/box that just completed;
   *  get a brief green-soft flash. Empty when nothing flashing. */
  completedFlashIndices: number[];
  /** Cell index the hint button just revealed; gets a yellow ring
   *  pulse so the player's eye lands on what changed. */
  hintRevealedIdx: number | null;
  /** True for ~900ms on the winning placement — every cell tints
   *  green-soft so the board itself acknowledges the solve. */
  boardWideFlash: boolean;
  onSelect: (i: number) => void;
  finished: boolean;
  hidden?: boolean;
}) {
  const selRow = selectedIdx === null ? -1 : rowOf(selectedIdx);
  const selCol = selectedIdx === null ? -1 : colOf(selectedIdx);
  const selBox = selectedIdx === null ? -1 : boxOf(selectedIdx);
  // Set form for O(1) lookup during the 81-cell render loop.
  const completedFlashSet = useMemo(
    () => new Set(completedFlashIndices),
    [completedFlashIndices],
  );

  return (
    <div
      role="grid"
      aria-label="Sudoku board"
      className="card-chunk mx-auto grid w-full max-w-[min(100%,32rem)] grid-cols-9 overflow-hidden rounded-[var(--radius-card)] border-2 border-ink bg-cream"
      style={{
        aspectRatio: "1 / 1",
        // Equal-1fr rows are non-negotiable. Without an explicit row
        // template the grid falls back to auto-rows: each row sizes to
        // its cells' content, and an all-empty row collapses to ~3px
        // because empty cells render `null` (no line-box). Today's
        // puzzle had no clues in row 0 and the row vanished. This
        // makes the row heights independent of content.
        gridTemplateRows: "repeat(9, 1fr)",
        // Hidden during pause so the player can step away without
        // staring at the puzzle. visibility: hidden keeps layout.
        visibility: hidden ? "hidden" : "visible",
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
        // Notes-highlight: empty cells whose pencil notes include the
        // selected digit. Same intent as sameValue ("where this digit
        // is relevant") but weaker — these are considerations, not
        // placements. Tinted slightly stronger than the row/col/box
        // peer-highlight so a noted cell stands out even inside the
        // selected cell's row.
        const noteHighlight =
          selectedValue !== 0 &&
          cell.v === 0 &&
          hasNote(cell.notes, selectedValue);
        const conflict = conflictMask[i];

        // Background priority (each line may overwrite the previous):
        //   base → peer-highlight → noteHighlight → sameValue → selected → conflict
        // Given cells get a slightly darker base so they read as
        // "fixed by the puzzle".
        //
        // A subtle but real bug used to live here: when you selected
        // an empty cell, bg-pink + text-pink rendered placed digits
        // as pink-on-pink (camouflaged) until you clicked elsewhere.
        // The fix is the `holdsUserValue` branch — once the focused
        // cell holds a user-placed digit, the bg flips to ink and the
        // text to cream so placement is impossible to miss.
        const holdsUserValue = cell.v !== 0 && !cell.given;
        let bg = cell.given ? "bg-cream-deep" : "bg-cream";
        if (inHighlight) bg = cell.given ? "bg-pink-soft/60" : "bg-pink-soft/50";
        if (noteHighlight) bg = "bg-pink-soft/70";
        if (sameValue) bg = "bg-pink-soft";
        if (isSelected) bg = holdsUserValue ? "bg-ink" : "bg-pink";
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

        // Text colour: ink for the puzzle's given clues, pink for the
        // player's marks (so they read as "I placed this"). Conflict
        // beats pink — a bright tomato digit on tomato-soft makes the
        // wrong cell loud, even unselected. When the cell is the
        // focused one AND holds a user-placed digit, the background
        // went to ink (phosphor) — flip the digit to cream (room dark)
        // so it pops. A selected GIVEN cell sits on bright bg-pink, so
        // its clue flips to cream too (accents want dark text); the
        // conflict guard keeps it ink on the tomato-soft override.
        const textCol = cell.given
          ? isSelected && !conflict
            ? "text-cream"
            : "text-ink"
          : conflict
            ? "text-tomato"
            : isSelected && holdsUserValue
              ? "text-cream"
              : "text-pink";

        // Inset ink ring marks the selected cell. Layered as a ring
        // (not a border) so it sits on top of the grid's per-cell
        // border lines without disturbing layout. relative + z makes
        // sure neighbour cells' borders sit behind it.
        const selectedRing = isSelected
          ? "relative z-10 ring-[3px] ring-inset ring-ink"
          : "";

        // Transient animation classes. Mutually compatible — a cell
        // could in principle be the just-placed wrong AND a member of
        // a newly-completed set (unlikely but cheap to support).
        // boardWideFlash piggybacks on the per-set flash keyframe so
        // the entire board pulses green-soft once on the winning
        // placement.
        const isWrongPlaced = i === wrongPlacedIdx;
        const isCompletedFlash = completedFlashSet.has(i);
        const isHintRevealed = i === hintRevealedIdx;
        const flashClass =
          isCompletedFlash || boardWideFlash ? "sudoku-completed-flash" : "";
        const shakeClass = isWrongPlaced ? "sudoku-wrong-shake" : "";
        const hintClass = isHintRevealed ? "sudoku-hint-pulse" : "";

        return (
          <button
            key={i}
            type="button"
            role="gridcell"
            aria-label={`row ${r + 1}, column ${c + 1}${cell.v ? `, value ${cell.v}` : ", empty"}`}
            aria-selected={isSelected}
            onClick={() => onSelect(i)}
            disabled={finished}
            className={`flex items-center justify-center font-display font-extrabold leading-none transition-colors ${bg} ${textCol} ${borderRight} ${borderBottom} ${selectedRing} ${flashClass} ${shakeClass} ${hintClass}`}
            style={{
              fontSize: "clamp(1.1rem, 4vw, 1.7rem)",
              cursor: finished ? "default" : "pointer",
            }}
          >
            {cell.v !== 0 ? (
              // Key on the digit so a replacement remounts the span
              // and the pop animation re-fires. Skipped for given
              // cells — the puzzle's clues shouldn't pulse.
              <span
                key={`v-${cell.v}`}
                className={cell.given ? "" : "sudoku-placed inline-block"}
              >
                {cell.v}
              </span>
            ) : cell.notes !== 0 ? (
              <NotesGrid
                notes={cell.notes}
                highlight={selectedValue || undefined}
                onAccent={isSelected}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function NotesGrid({
  notes,
  highlight,
  onAccent,
}: {
  notes: number;
  /** If set, render the matching digit in pink so the eye finds it
   *  inside the 3×3 pencil grid. Companion to the same-digit
   *  background tint on the cell itself. */
  highlight?: number;
  /** True when the host cell is selected — its background is bright
   *  bg-pink, so the pencil marks flip to room-dark cream (light
   *  ink-soft and bright pink both vanish against the magenta). */
  onAccent?: boolean;
}) {
  return (
    <span
      className={`grid h-full w-full ${onAccent ? "text-cream/80" : "text-ink-soft"}`}
      style={{
        gridTemplateColumns: "repeat(3, 1fr)",
        gridTemplateRows: "repeat(3, 1fr)",
        // Scale with the cell — at 375px viewport each cell is ~37px
        // and 0.55rem renders barely-readable pencil marks. clamp
        // ramps it up to tablet+ without bloating phones.
        fontSize: "clamp(0.45rem, 1.4vw, 0.65rem)",
        lineHeight: 1,
        padding: "2px",
      }}
    >
      {Array.from({ length: 9 }, (_, k) => {
        const v = k + 1;
        const present = hasNote(notes, v);
        const isHighlight = present && highlight === v;
        return (
          <span
            key={v}
            className={`flex items-center justify-center font-display font-bold ${
              isHighlight ? (onAccent ? "text-cream" : "text-pink") : ""
            }`}
          >
            {present ? v : ""}
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
  onUndo,
  onHint,
  onPause,
  canUndo,
  canHint,
  paused,
  disabled,
}: {
  notesMode: boolean;
  onSetNotesMode: (v: boolean | ((p: boolean) => boolean)) => void;
  remainingByValue: number[];
  onDigit: (d: number) => void;
  onErase: () => void;
  onUndo: () => void;
  onHint: () => void;
  onPause: () => void;
  canUndo: boolean;
  canHint: boolean;
  paused: boolean;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-9 gap-1.5">
        {Array.from({ length: 9 }, (_, i) => {
          const v = i + 1;
          const remaining = remainingByValue[v];
          const done = remaining <= 0;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onDigit(v)}
              disabled={disabled || done}
              className={`btn-chunk relative flex aspect-square items-center justify-center rounded-[var(--radius-button)] font-display text-xl font-extrabold transition-opacity ${
                done
                  ? "bg-cream-deep text-ink-muted opacity-50"
                  : notesMode
                    ? "bg-pink-soft text-ink"
                    : "bg-pink text-cream"
              }`}
              aria-label={
                done
                  ? `${v}, all placed`
                  : `Place ${v}, ${remaining} remaining`
              }
            >
              {v}
              {/* Remaining-count badge. Tiny pip in the top-right of
                  the button — meta-info that doesn't compete with the
                  digit itself. Follows the key's text colour: dark
                  cream on the bright magenta key, light ink on the
                  dark pink-soft notes-mode key. Hidden when done (the
                  greyed-out button already says "all placed"). */}
              {!done && (
                <span
                  aria-hidden
                  className={`pointer-events-none absolute right-1 top-1 text-[10px] font-bold leading-none tabular-nums ${
                    notesMode ? "text-ink/60" : "text-cream/60"
                  }`}
                >
                  {remaining}
                </span>
              )}
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
            notesMode ? "bg-ink text-cream" : "bg-cream-deep text-ink"
          }`}
        >
          {notesMode ? "Notes: on" : "Notes: off"}
        </button>
        <button
          type="button"
          onClick={onErase}
          disabled={disabled}
          className="btn-chunk rounded-[var(--radius-button)] bg-cream-deep px-4 py-2 text-sm font-display font-extrabold text-ink disabled:opacity-50"
        >
          Erase
        </button>
        <button
          type="button"
          onClick={onUndo}
          disabled={disabled || !canUndo}
          className="btn-chunk rounded-[var(--radius-button)] bg-cream-deep px-4 py-2 text-sm font-display font-extrabold text-ink disabled:opacity-40"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={onHint}
          disabled={disabled || !canHint}
          className="btn-chunk rounded-[var(--radius-button)] bg-cream-deep px-4 py-2 text-sm font-display font-extrabold text-ink disabled:opacity-40"
        >
          Hint
        </button>
        <button
          type="button"
          onClick={onPause}
          aria-pressed={paused}
          className={`btn-chunk rounded-[var(--radius-button)] px-4 py-2 text-sm font-display font-extrabold ${
            paused ? "bg-ink text-cream" : "bg-cream-deep text-ink"
          }`}
        >
          {paused ? "Resume" : "Pause"}
        </button>
      </div>
      <p className="text-[11px] text-ink-muted">
        1–9 place · arrow keys move · N notes · H hint · P pause · ⌘Z undo · backspace erase
      </p>
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
        className="btn-chunk rounded-[var(--radius-button)] bg-cream-deep px-4 py-2 text-sm font-display font-extrabold text-ink"
      >
        New puzzle
      </button>
      <button
        type="button"
        onClick={onRestart}
        className="btn-chunk rounded-[var(--radius-button)] bg-cream-deep px-4 py-2 text-sm font-display font-extrabold text-ink"
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
  hintsUsed,
  bestTime,
  isNewBest,
  daily,
  onNewGame,
}: {
  elapsed: number;
  difficulty: Difficulty;
  mistakes: number;
  hintsUsed: number;
  bestTime: number | undefined;
  isNewBest: boolean;
  /** When set, this was the daily puzzle for the given YYYY-MM-DD —
   *  the win panel acknowledges it as "Today's puzzle" instead of the
   *  generic "Solved." */
  daily?: string;
  onNewGame: () => void;
}) {
  return (
    <div className="card-chunk fade-rise relative flex flex-col items-center gap-4 rounded-[var(--radius-card)] bg-pink p-6 text-center">
      <p className="font-display text-3xl font-extrabold tracking-tight text-cream">
        {daily ? "Today, done." : "Solved."}
      </p>
      {daily && (
        <p className="rounded-full border-2 border-ink bg-cream px-3 py-1 font-pixel text-xs uppercase tracking-wider text-ink">
          Today&rsquo;s puzzle · {daily}
        </p>
      )}
      {isNewBest && (
        <p className="rounded-full border-2 border-ink bg-cream px-3 py-1 font-pixel text-xs uppercase tracking-wider text-ink">
          New personal best
        </p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
        <Stat
          label="Difficulty"
          value={daily ? "Today" : titleCase(difficulty)}
          onAccent
        />
        <Stat label="Time" value={formatDuration(elapsed)} mono onAccent />
        <Stat
          label="Mistakes"
          value={String(mistakes)}
          mono
          muted={mistakes === 0}
          onAccent
        />
        {hintsUsed > 0 && (
          <Stat label="Hints" value={String(hintsUsed)} mono onAccent />
        )}
        {bestTime !== undefined && !isNewBest && !daily && (
          <Stat
            label="Best"
            value={formatDuration(bestTime)}
            mono
            muted
            onAccent
          />
        )}
      </div>
      {hintsUsed > 0 && (
        <p className="max-w-xs text-[11px] text-cream/70">
          Best-time records are reserved for runs with no hints — keep
          trying.
        </p>
      )}
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

function LossPanel({
  mistakes,
  cap,
  onRestart,
  onNewGame,
}: {
  mistakes: number;
  cap: number;
  onRestart: () => void;
  onNewGame: () => void;
}) {
  return (
    <div className="card-chunk relative flex flex-col items-center gap-4 rounded-[var(--radius-card)] bg-tomato-soft p-6 text-center">
      <p className="font-display text-3xl font-extrabold tracking-tight text-ink">
        Out of mistakes.
      </p>
      <p className="max-w-xs text-sm text-ink-soft">
        Strict mode caps you at {cap} wrong moves. You used {mistakes}.
        The board is paused — start over or pick a fresh puzzle.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onRestart}
          className="btn-chunk rounded-[var(--radius-button)] bg-ink px-5 py-2 text-sm font-display font-extrabold text-cream"
        >
          Start over
        </button>
        <button
          type="button"
          onClick={onNewGame}
          className="btn-chunk rounded-[var(--radius-button)] bg-cream-deep px-5 py-2 text-sm font-display font-extrabold text-ink"
        >
          New puzzle
        </button>
      </div>
    </div>
  );
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
