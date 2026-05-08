// Sift's parser + analyser. Drop a CSV/TSV/JSON-array, get back a
// shape we can render: typed columns, parsed rows, per-column stats.
//
// All work is synchronous and capped at MAX_ROWS so the UI stays
// responsive on big files. Anything larger truncates with a warning.

import Papa from "papaparse";

export type ColumnType = "number" | "text" | "date" | "boolean" | "id";

export type Column = {
  name: string;
  type: ColumnType;
};

export type Row = Record<string, unknown>;

export type ParsedTable = {
  columns: Column[];
  rows: Row[];
  totalRows: number; // before truncation
  truncatedTo: number | null; // null if not truncated
  source: "csv" | "tsv" | "json" | "paste";
  warnings: string[];
};

export const MAX_ROWS = 100_000;

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function parseCsvLike(
  text: string,
  fileName?: string,
): ParsedTable {
  const isTsv = fileName?.toLowerCase().endsWith(".tsv") || text.includes("\t");
  const result = Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: "greedy",
    dynamicTyping: false, // we do our own type detection
    delimiter: isTsv ? "\t" : "",
    transformHeader: (h) => h.trim(),
  });
  const warnings: string[] = [];
  for (const err of result.errors.slice(0, 3)) {
    warnings.push(`Row ${err.row ?? "?"}: ${err.message}`);
  }
  const rawRows = (result.data as Row[]).filter(
    (r) => Object.keys(r).length > 0,
  );
  const totalRows = rawRows.length;
  const truncated = rawRows.length > MAX_ROWS;
  const rows = truncated ? rawRows.slice(0, MAX_ROWS) : rawRows;
  if (truncated) {
    warnings.unshift(
      `Showing the first ${MAX_ROWS.toLocaleString("en-US")} of ${totalRows.toLocaleString("en-US")} rows.`,
    );
  }
  const columnNames =
    (result.meta.fields ?? []).map((f) => f.trim()).filter((f) => f.length > 0);
  const columns = columnNames.map((name) => ({
    name,
    type: detectType(rows, name),
  }));
  return {
    columns,
    rows,
    totalRows,
    truncatedTo: truncated ? MAX_ROWS : null,
    source: isTsv ? "tsv" : "csv",
    warnings,
  };
}

export function parseJsonArray(text: string): ParsedTable {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) {
    throw new Error("JSON must be an array of objects.");
  }
  if (data.length > 0 && (typeof data[0] !== "object" || data[0] === null)) {
    throw new Error("JSON array items must be flat objects.");
  }
  const totalRows = data.length;
  const truncated = totalRows > MAX_ROWS;
  const rows = (truncated ? data.slice(0, MAX_ROWS) : data) as Row[];
  // Collect the union of keys across the first 1000 rows — pragmatic for
  // unevenly shaped JSON without scanning the whole file.
  const seen = new Set<string>();
  for (const r of rows.slice(0, 1000)) {
    for (const k of Object.keys(r ?? {})) seen.add(k);
  }
  const columns = [...seen].map((name) => ({
    name,
    type: detectType(rows, name),
  }));
  const warnings: string[] = [];
  if (truncated) {
    warnings.push(
      `Showing the first ${MAX_ROWS.toLocaleString("en-US")} of ${totalRows.toLocaleString("en-US")} rows.`,
    );
  }
  return {
    columns,
    rows,
    totalRows,
    truncatedTo: truncated ? MAX_ROWS : null,
    source: "json",
    warnings,
  };
}

/** Returns the parsed cell value coerced for sort/filter/stats. */
export function coerce(value: unknown, type: ColumnType): unknown {
  if (value === null || value === undefined || value === "") return null;
  const s = String(value).trim();
  if (s === "") return null;
  switch (type) {
    case "number":
      return parseNumber(s);
    case "date": {
      const t = parseDate(s);
      return t === null ? null : t; // ms since epoch
    }
    case "boolean": {
      const b = parseBoolean(s);
      return b;
    }
    case "id":
    case "text":
    default:
      return s;
  }
}

/* ------------------------------------------------------------------ */
/* Type detection                                                      */
/* ------------------------------------------------------------------ */

function detectType(rows: Row[], column: string): ColumnType {
  // Sample up to 200 rows — enough to be confident, fast on big files.
  const sample: string[] = [];
  for (let i = 0; i < rows.length && sample.length < 200; i++) {
    const v = rows[i][column];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s === "") continue;
    sample.push(s);
  }
  if (sample.length === 0) return "text";

  // Boolean wins if every sample is in the canonical set.
  if (sample.every((s) => isBooleanish(s))) return "boolean";

  // Number: every sample parses cleanly. We accept thousand separators
  // and currency-prefix `$` / `€` / `£` to handle real-world exports.
  if (sample.every((s) => parseNumber(s) !== null)) {
    // Distinguish "ID-like numbers" (most are unique, all integer, length
    // looks like an identifier) from real numbers. Heuristic: if every
    // value is integer AND >= 1e6 AND uniqueness > 90%, treat as id.
    const allInt = sample.every((s) => /^[+-]?\d+$/.test(s));
    const allLarge = allInt && sample.every((s) => Math.abs(Number(s)) >= 1e6);
    const unique = new Set(sample).size / sample.length;
    if (allLarge && unique > 0.9) return "id";
    return "number";
  }

  // Date: every sample parses to a sane year.
  if (sample.every((s) => parseDate(s) !== null)) return "date";

  // ID-shaped text: structurally identifier-y AND mostly unique. We
  // accept UUIDs, slugs/hashes that contain at least one digit, and
  // all-uppercase-or-digits codes. Plain names like "Fred" — short,
  // unique, no spaces but no digits and mixed case — fall through to
  // text instead.
  const unique = new Set(sample).size / sample.length;
  const isUuid = (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  const idShaped = sample.every(
    (s) =>
      s.length <= 64 &&
      (isUuid(s) ||
        /^[A-Z0-9_-]{2,}$/.test(s) ||
        (/^[A-Za-z0-9_-]+$/.test(s) && /\d/.test(s))),
  );
  if (idShaped && unique > 0.95) return "id";

  return "text";
}

function isBooleanish(s: string): boolean {
  return /^(true|false|yes|no|y|n)$/i.test(s);
}

function parseBoolean(s: string): boolean | null {
  const t = s.toLowerCase();
  if (t === "true" || t === "yes" || t === "y") return true;
  if (t === "false" || t === "no" || t === "n") return false;
  return null;
}

function parseNumber(s: string): number | null {
  // Strip common ornamentation: currency prefix, thousands separators,
  // trailing percent. We're tolerant because real CSVs are.
  let cleaned = s.replace(/[\s,]/g, "").replace(/^[$€£¥]/, "");
  let scale = 1;
  if (cleaned.endsWith("%")) {
    cleaned = cleaned.slice(0, -1);
    scale = 1 / 100;
  }
  if (cleaned === "" || cleaned === "-" || cleaned === "+") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n * scale;
}

function parseDate(s: string): number | null {
  // Cheap pre-filter — Date.parse accepts way too much (e.g. "1" → 2001).
  // Require at least a separator and a 4-digit year.
  if (!/\d{4}/.test(s)) return null;
  if (!/[-/.\sT:]/.test(s)) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  const year = new Date(t).getUTCFullYear();
  if (year < 1900 || year > 2100) return null;
  return t;
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

export type NumberStats = {
  kind: "number";
  count: number;
  missing: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  stdev: number;
  /** 10 bucket counts spanning [min, max]. */
  histogram: number[];
};

export type TextStats = {
  kind: "text";
  count: number;
  missing: number;
  unique: number;
  topValues: Array<{ value: string; count: number }>;
};

export type DateStats = {
  kind: "date";
  count: number;
  missing: number;
  earliest: number; // ms
  latest: number; // ms
  /** 12 bucket counts spanning [earliest, latest]. */
  histogram: number[];
};

export type BooleanStats = {
  kind: "boolean";
  count: number;
  missing: number;
  trueCount: number;
  falseCount: number;
};

export type IdStats = {
  kind: "id";
  count: number;
  missing: number;
  unique: number;
  sample: string[];
};

export type ColumnStats =
  | NumberStats
  | TextStats
  | DateStats
  | BooleanStats
  | IdStats;

export function statsFor(
  rows: Row[],
  column: Column,
): ColumnStats {
  const { name, type } = column;
  let missing = 0;
  switch (type) {
    case "number": {
      const nums: number[] = [];
      for (const r of rows) {
        const v = coerce(r[name], "number") as number | null;
        if (v === null) missing++;
        else nums.push(v);
      }
      return numberStats(nums, missing);
    }
    case "date": {
      const dates: number[] = [];
      for (const r of rows) {
        const v = coerce(r[name], "date") as number | null;
        if (v === null) missing++;
        else dates.push(v);
      }
      return dateStats(dates, missing);
    }
    case "boolean": {
      let t = 0;
      let f = 0;
      for (const r of rows) {
        const v = coerce(r[name], "boolean") as boolean | null;
        if (v === null) missing++;
        else if (v === true) t++;
        else f++;
      }
      return {
        kind: "boolean",
        count: t + f,
        missing,
        trueCount: t,
        falseCount: f,
      };
    }
    case "id": {
      const seen = new Set<string>();
      const sample: string[] = [];
      for (const r of rows) {
        const v = r[name];
        if (v === null || v === undefined || v === "") {
          missing++;
          continue;
        }
        const s = String(v);
        seen.add(s);
        if (sample.length < 5) sample.push(s);
      }
      return {
        kind: "id",
        count: rows.length - missing,
        missing,
        unique: seen.size,
        sample,
      };
    }
    case "text":
    default: {
      const counts = new Map<string, number>();
      for (const r of rows) {
        const v = r[name];
        if (v === null || v === undefined || v === "") {
          missing++;
          continue;
        }
        const s = String(v);
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
      const topValues = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([value, count]) => ({ value, count }));
      return {
        kind: "text",
        count: rows.length - missing,
        missing,
        unique: counts.size,
        topValues,
      };
    }
  }
}

function numberStats(nums: number[], missing: number): NumberStats {
  if (nums.length === 0) {
    return {
      kind: "number",
      count: 0,
      missing,
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      stdev: 0,
      histogram: new Array<number>(10).fill(0),
    };
  }
  const sorted = [...nums].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const variance =
    sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / sorted.length;
  const stdev = Math.sqrt(variance);
  const buckets = 10;
  const histogram = new Array<number>(buckets).fill(0);
  if (max > min) {
    const span = max - min;
    for (const n of nums) {
      const bi = Math.min(buckets - 1, Math.floor(((n - min) / span) * buckets));
      histogram[bi]++;
    }
  } else {
    histogram[Math.floor(buckets / 2)] = nums.length;
  }
  return {
    kind: "number",
    count: nums.length,
    missing,
    min,
    max,
    mean,
    median,
    stdev,
    histogram,
  };
}

function dateStats(dates: number[], missing: number): DateStats {
  if (dates.length === 0) {
    return {
      kind: "date",
      count: 0,
      missing,
      earliest: 0,
      latest: 0,
      histogram: new Array<number>(12).fill(0),
    };
  }
  const earliest = Math.min(...dates);
  const latest = Math.max(...dates);
  const buckets = 12;
  const histogram = new Array<number>(buckets).fill(0);
  if (latest > earliest) {
    const span = latest - earliest;
    for (const d of dates) {
      const bi = Math.min(buckets - 1, Math.floor(((d - earliest) / span) * buckets));
      histogram[bi]++;
    }
  } else {
    histogram[Math.floor(buckets / 2)] = dates.length;
  }
  return {
    kind: "date",
    count: dates.length,
    missing,
    earliest,
    latest,
    histogram,
  };
}

/* ------------------------------------------------------------------ */
/* Filtering & sorting                                                 */
/* ------------------------------------------------------------------ */

export type SortKey = { column: string; dir: "asc" | "desc" } | null;
export type FilterMap = Record<string, string>;

/**
 * Apply per-column substring filters and a global search, then sort.
 * Returns the filtered+sorted indices into `rows` so the caller can do its
 * own slicing for virtualisation.
 */
export function filterAndSort(
  rows: Row[],
  columns: Column[],
  filters: FilterMap,
  search: string,
  sort: SortKey,
): number[] {
  const filterEntries = Object.entries(filters).filter(([, v]) => v.trim() !== "");
  const searchLower = search.trim().toLowerCase();

  let indices: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let pass = true;
    for (const [col, q] of filterEntries) {
      const cell = String(row[col] ?? "").toLowerCase();
      if (!cell.includes(q.toLowerCase())) {
        pass = false;
        break;
      }
    }
    if (!pass) continue;
    if (searchLower !== "") {
      let matched = false;
      for (const c of columns) {
        const cell = String(row[c.name] ?? "").toLowerCase();
        if (cell.includes(searchLower)) {
          matched = true;
          break;
        }
      }
      if (!matched) continue;
    }
    indices.push(i);
  }

  if (sort) {
    const col = columns.find((c) => c.name === sort.column);
    if (col) {
      const dir = sort.dir === "asc" ? 1 : -1;
      indices = indices.slice().sort((a, b) => {
        const va = coerce(rows[a][col.name], col.type);
        const vb = coerce(rows[b][col.name], col.type);
        return compare(va, vb) * dir;
      });
    }
  }

  return indices;
}

function compare(a: unknown, b: unknown): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // null sorts after
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

/* ------------------------------------------------------------------ */
/* CSV export                                                          */
/* ------------------------------------------------------------------ */

export function rowsToCsv(rows: Row[], columns: Column[]): string {
  return Papa.unparse(
    {
      fields: columns.map((c) => c.name),
      data: rows.map((r) => columns.map((c) => r[c.name] ?? "")),
    },
    { quotes: true },
  );
}
