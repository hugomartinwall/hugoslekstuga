/**
 * Sudoku generator + solver.
 *
 * The board is a flat array of 81 numbers; 0 means empty, 1–9 means
 * filled. Rows, columns, and 3×3 boxes are derived from index.
 *
 * The solver uses MRV (minimum-remaining-values) backtracking with
 * bitmask candidates. It can either find the first solution
 * (`solveOne`) or count solutions up to a limit (`solveCount`), used
 * to verify uniqueness during puzzle generation.
 *
 * Puzzle generation:
 *   1. Build a complete solved board via randomised backtracking.
 *   2. Remove cells one at a time (in shuffled order), checking after
 *      each removal that the puzzle still has a unique solution. If
 *      removing a cell would produce multiple solutions, put it back.
 *   3. Stop when the clue count drops to the difficulty target.
 *
 * Difficulty is approximated by clue count. Real difficulty depends
 * on which solving techniques are required, but clue count is a
 * reasonable first-pass proxy.
 */

export type Difficulty = "easy" | "medium" | "hard";

const SIZE = 81;
const ALL_BITS = (1 << 9) - 1; // 0b111111111 — every digit 1–9 available

function bit(v: number): number {
  return 1 << (v - 1);
}

function popcount(mask: number): number {
  let c = 0;
  while (mask) {
    mask &= mask - 1;
    c++;
  }
  return c;
}

function bitsToValues(mask: number): number[] {
  const out: number[] = [];
  for (let v = 1; v <= 9; v++) if (mask & bit(v)) out.push(v);
  return out;
}

function rowOf(i: number): number {
  return Math.floor(i / 9);
}

function colOf(i: number): number {
  return i % 9;
}

function boxOf(i: number): number {
  return Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);
}

/**
 * Indices of every other cell that shares a row, column, or box with
 * the given index. Computed once at module load — a 81×20 lookup is
 * tiny and saves O(81) work on every candidate computation.
 */
const PEERS: number[][] = (() => {
  const arr: number[][] = [];
  for (let i = 0; i < SIZE; i++) {
    const r = rowOf(i);
    const c = colOf(i);
    const b = boxOf(i);
    const peers: number[] = [];
    for (let j = 0; j < SIZE; j++) {
      if (j === i) continue;
      if (rowOf(j) === r || colOf(j) === c || boxOf(j) === b) peers.push(j);
    }
    arr.push(peers);
  }
  return arr;
})();

function candidatesFor(board: number[], i: number): number {
  let mask = ALL_BITS;
  for (const p of PEERS[i]) {
    const v = board[p];
    if (v !== 0) mask &= ~bit(v);
  }
  return mask;
}

/**
 * Find the empty cell with the fewest candidates (MRV). Returns null
 * if no empty cells remain; returns {idx, cands: 0} if the board is
 * unsolvable.
 */
function findMrv(board: number[]): { idx: number; cands: number } | null {
  let best: { idx: number; cands: number; count: number } | null = null;
  for (let i = 0; i < SIZE; i++) {
    if (board[i] !== 0) continue;
    const c = candidatesFor(board, i);
    const count = popcount(c);
    if (count === 0) return { idx: i, cands: 0 };
    if (!best || count < best.count) {
      best = { idx: i, cands: c, count };
      if (count === 1) break; // can't do better than a forced move
    }
  }
  return best ? { idx: best.idx, cands: best.cands } : null;
}

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * Solve a board in place, returning true if a solution exists. Tries
 * digits in random order so we get a different solved grid each time
 * (used by the puzzle generator to produce variety).
 */
function solveOne(board: number[]): boolean {
  const cell = findMrv(board);
  if (!cell) return true;
  if (cell.cands === 0) return false;
  const values = shuffle(bitsToValues(cell.cands));
  for (const v of values) {
    board[cell.idx] = v;
    if (solveOne(board)) return true;
    board[cell.idx] = 0;
  }
  return false;
}

/**
 * Count solutions of a board up to `limit`. Early-exits the moment
 * `limit` is reached; we only ever care about "exactly one" vs "more
 * than one". Mutates the board during recursion but restores it.
 */
function solveCount(board: number[], limit: number): number {
  const cell = findMrv(board);
  if (!cell) return 1;
  if (cell.cands === 0) return 0;
  let count = 0;
  for (const v of bitsToValues(cell.cands)) {
    board[cell.idx] = v;
    count += solveCount(board, limit - count);
    board[cell.idx] = 0;
    if (count >= limit) return count;
  }
  return count;
}

/** Public: count solutions up to a limit. Doesn't mutate input. */
export function countSolutions(board: number[], limit: number = 2): number {
  const copy = board.slice();
  return solveCount(copy, limit);
}

/** Public: solve a board, returning the solution (or null if none). */
export function solve(board: number[]): number[] | null {
  const copy = board.slice();
  return solveOne(copy) ? copy : null;
}

/** Generate a complete solved 9×9 board. */
function generateSolved(): number[] {
  const board = new Array<number>(SIZE).fill(0);
  // Seed the three diagonal 3×3 boxes first — they don't interact, so
  // we can fill each one with a random permutation of 1–9 and the
  // backtracker will fan out from there. Skipping this still works
  // but tends to produce boards that look similar to each other.
  for (let box = 0; box < 3; box++) {
    const perm = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    let p = 0;
    const startRow = box * 3;
    const startCol = box * 3;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        board[(startRow + r) * 9 + (startCol + c)] = perm[p++];
      }
    }
  }
  solveOne(board);
  return board;
}

/**
 * Target clue count per difficulty. Real difficulty is also a function
 * of which solving techniques the puzzle requires; clue count is an
 * approximate proxy. These numbers feel right for the brand: easy is
 * truly easy (mostly direct deductions), medium asks for some
 * candidate-tracking, hard requires real notes work.
 */
const TARGET_CLUES: Record<Difficulty, number> = {
  easy: 42,
  medium: 32,
  hard: 26,
};

/**
 * Generate a puzzle by removing cells from a solved board while
 * maintaining a unique solution. Removes cells in randomised order
 * until the clue count hits the difficulty target, or until no more
 * removable cells remain.
 */
export function generatePuzzle(difficulty: Difficulty): {
  puzzle: number[];
  solution: number[];
} {
  const solution = generateSolved();
  const puzzle = solution.slice();
  const target = TARGET_CLUES[difficulty];

  const order = shuffle(Array.from({ length: SIZE }, (_, i) => i));
  let clues = SIZE;
  for (const i of order) {
    if (clues <= target) break;
    const saved = puzzle[i];
    puzzle[i] = 0;
    // solveCount mutates the board during recursion but restores it,
    // so we can pass `puzzle` directly without copying.
    if (solveCount(puzzle, 2) === 1) {
      clues--;
    } else {
      puzzle[i] = saved;
    }
  }

  return { puzzle, solution };
}
