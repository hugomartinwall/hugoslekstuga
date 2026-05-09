"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import {
  filterAndSort,
  parseCsvLike,
  parseJsonArray,
  rowsToCsv,
  statsFor,
  type Column,
  type ColumnStats,
  type FilterMap,
  type ParsedTable,
  type SortKey,
} from "@/lib/sift/parse";

const ROW_HEIGHT = 36; // px — tightly coupled to the row CSS below
const VIEWPORT_HEIGHT = 480; // px
const OVERSCAN = 8;

export default function SiftPage() {
  const tool = findTool("sift")!;
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [sort, setSort] = useState<SortKey>(null);
  const [filters, setFilters] = useState<FilterMap>({});
  const [search, setSearch] = useState("");

  const handleFile = useCallback(async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const text = await file.text();
      const t = file.name.toLowerCase().endsWith(".json")
        ? parseJsonArray(text)
        : parseCsvLike(text, file.name);
      setTable(t);
      setSort(null);
      setFilters({});
      setSearch("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that file.");
    } finally {
      setBusy(false);
    }
  }, []);

  const handlePaste = useCallback(() => {
    setBusy(true);
    setError("");
    try {
      const text = pasteValue.trim();
      if (text === "") {
        setError("Paste a CSV or a JSON array.");
        setBusy(false);
        return;
      }
      const t =
        text.startsWith("[") || text.startsWith("{")
          ? parseJsonArray(text)
          : parseCsvLike(text);
      setTable(t);
      setSort(null);
      setFilters({});
      setSearch("");
      setPasteOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that paste.");
    } finally {
      setBusy(false);
    }
  }, [pasteValue]);

  const reset = () => {
    setTable(null);
    setError("");
    setSort(null);
    setFilters({});
    setSearch("");
    setPasteValue("");
  };

  const visibleIndices = useMemo(() => {
    if (!table) return [] as number[];
    return filterAndSort(table.rows, table.columns, filters, search, sort);
  }, [table, filters, search, sort]);

  const stats = useMemo(() => {
    if (!table) return new Map<string, ColumnStats>();
    // Stats run on the FILTERED rows so they update as the user explores.
    const sub = visibleIndices.map((i) => table.rows[i]);
    const out = new Map<string, ColumnStats>();
    for (const c of table.columns) {
      out.set(c.name, statsFor(sub, c));
    }
    return out;
  }, [table, visibleIndices]);

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        {!table ? (
          <Welcome
            onFile={handleFile}
            onOpenPaste={() => setPasteOpen(true)}
            pasteOpen={pasteOpen}
            pasteValue={pasteValue}
            setPasteValue={setPasteValue}
            onPasteApply={handlePaste}
            onPasteCancel={() => {
              setPasteOpen(false);
              setError("");
            }}
            busy={busy}
            error={error}
          />
        ) : (
          <Loaded
            table={table}
            visibleIndices={visibleIndices}
            stats={stats}
            sort={sort}
            setSort={setSort}
            filters={filters}
            setFilters={setFilters}
            search={search}
            setSearch={setSearch}
            onReset={reset}
            error={error}
          />
        )}

        <p className="text-xs text-ink-muted">
          Drop a CSV, TSV, or JSON-array. Files are parsed in your browser
          and never uploaded — what you see lives only on this device.
        </p>
      </div>
    </ToolFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Welcome (drop zone)                                                 */
/* ------------------------------------------------------------------ */

function Welcome({
  onFile,
  onOpenPaste,
  pasteOpen,
  pasteValue,
  setPasteValue,
  onPasteApply,
  onPasteCancel,
  busy,
  error,
}: {
  onFile: (f: File) => void;
  onOpenPaste: () => void;
  pasteOpen: boolean;
  pasteValue: string;
  setPasteValue: (s: string) => void;
  onPasteApply: () => void;
  onPasteCancel: () => void;
  busy: boolean;
  error: string;
}) {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        className={`card-chunk flex flex-col items-center gap-3 rounded-[var(--radius-card)] p-10 text-center transition-colors ${
          dragActive ? "bg-purple-soft" : "bg-cream"
        }`}
      >
        <div
          aria-hidden
          className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-ink bg-purple text-2xl text-cream"
        >
          ⌗
        </div>
        <p className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          Drop a CSV, TSV, or JSON
        </p>
        <p className="max-w-md text-sm text-ink-soft">
          See what&apos;s inside. Sortable, filterable, with a per-column
          summary. {busy ? "Reading…" : ""}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="btn-chunk rounded-[var(--radius-button)] bg-purple px-5 py-2 font-display text-sm font-extrabold text-cream disabled:cursor-progress disabled:opacity-80"
          >
            Choose a file
          </button>
          <button
            type="button"
            onClick={onOpenPaste}
            className="rounded-full border-2 border-ink bg-cream px-4 py-2 text-sm font-bold transition-colors hover:bg-purple-soft"
          >
            Paste instead
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.json,text/csv,text/tab-separated-values,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
      </div>

      {pasteOpen && (
        <div className="card-chunk flex flex-col gap-3 rounded-[var(--radius-card)] bg-cream p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Paste CSV / TSV / JSON
          </p>
          <textarea
            value={pasteValue}
            onChange={(e) => setPasteValue(e.target.value)}
            placeholder={`name,age,city\nFred,29,Stockholm\nIda,42,Göteborg`}
            spellCheck={false}
            className="h-40 resize-y rounded-md border-2 border-ink bg-cream-deep p-3 font-mono text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onPasteApply}
              disabled={busy}
              className="btn-chunk rounded-[var(--radius-button)] bg-purple px-5 py-2 font-display text-sm font-extrabold text-cream disabled:cursor-progress disabled:opacity-80"
            >
              {busy ? "Reading…" : "Read it"}
            </button>
            <button
              type="button"
              onClick={onPasteCancel}
              className="rounded-full border-2 border-ink bg-cream px-4 py-2 text-sm font-bold transition-colors hover:bg-cream-deep"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-[var(--radius-card)] border-2 border-tomato bg-tomato-soft p-3 text-sm font-medium">
          {error}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Loaded view                                                          */
/* ------------------------------------------------------------------ */

function Loaded({
  table,
  visibleIndices,
  stats,
  sort,
  setSort,
  filters,
  setFilters,
  search,
  setSearch,
  onReset,
  error,
}: {
  table: ParsedTable;
  visibleIndices: number[];
  stats: Map<string, ColumnStats>;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  filters: FilterMap;
  setFilters: (next: FilterMap | ((prev: FilterMap) => FilterMap)) => void;
  search: string;
  setSearch: (s: string) => void;
  onReset: () => void;
  error: string;
}) {
  const cycleSort = (column: string) => {
    if (!sort || sort.column !== column) {
      setSort({ column, dir: "asc" });
    } else if (sort.dir === "asc") {
      setSort({ column, dir: "desc" });
    } else {
      setSort(null);
    }
  };

  const exportFiltered = () => {
    const subset = visibleIndices.map((i) => table.rows[i]);
    const csv = rowsToCsv(subset, table.columns);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sift-export.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="card-chunk flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] bg-cream p-4">
        <div className="flex flex-col">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {table.source.toUpperCase()} loaded
          </p>
          <p className="font-display text-base font-bold">
            {table.columns.length} column{table.columns.length === 1 ? "" : "s"}{" "}
            · {visibleIndices.length.toLocaleString("en-US")}
            {visibleIndices.length !== table.totalRows
              ? ` of ${table.totalRows.toLocaleString("en-US")}`
              : ""}{" "}
            row{table.totalRows === 1 ? "" : "s"}
            {table.truncatedTo !== null && (
              <span className="ml-2 rounded-full border-2 border-ink bg-yellow-soft px-2 py-0.5 text-xs font-bold">
                truncated
              </span>
            )}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportFiltered}
            className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors hover:bg-purple-soft"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={onReset}
            className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors hover:bg-cream-deep"
          >
            Pick another
          </button>
        </div>
      </div>

      {table.warnings.length > 0 && (
        <div className="rounded-[var(--radius-card)] border-2 border-ink bg-yellow-soft p-3 text-xs">
          {table.warnings.map((w, i) => (
            <p key={i} className="font-medium">
              {w}
            </p>
          ))}
        </div>
      )}

      {error && (
        <p className="rounded-[var(--radius-card)] border-2 border-tomato bg-tomato-soft p-3 text-sm font-medium">
          {error}
        </p>
      )}

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search every cell…"
        className="card-chunk rounded-[var(--radius-card)] bg-cream px-4 py-2 font-mono text-sm"
      />

      {/* Column summary cards — horizontal scroll */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {table.columns.map((c) => (
          <SummaryCard key={c.name} column={c} stats={stats.get(c.name)} />
        ))}
      </div>

      {/* Table */}
      <DataTable
        table={table}
        visibleIndices={visibleIndices}
        sort={sort}
        cycleSort={cycleSort}
        filters={filters}
        setFilters={setFilters}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Summary card                                                         */
/* ------------------------------------------------------------------ */

function SummaryCard({
  column,
  stats,
}: {
  column: Column;
  stats: ColumnStats | undefined;
}) {
  const tone =
    column.type === "number"
      ? "bg-yellow-soft"
      : column.type === "date"
        ? "bg-blue-soft"
        : column.type === "boolean"
          ? "bg-pink-soft"
          : column.type === "id"
            ? "bg-cream-deep"
            : "bg-purple-soft";
  return (
    <div
      className={`card-chunk flex w-56 shrink-0 flex-col gap-2 rounded-[var(--radius-card)] ${tone} p-3`}
    >
      <div className="flex items-center justify-between gap-2">
        <p
          className="truncate font-display text-base font-bold"
          title={column.name}
        >
          {column.name}
        </p>
        <span className="rounded-full border-2 border-ink bg-cream px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
          {column.type}
        </span>
      </div>
      {stats ? <SummaryBody stats={stats} /> : null}
    </div>
  );
}

function SummaryBody({ stats }: { stats: ColumnStats }) {
  switch (stats.kind) {
    case "number":
      return (
        <div className="flex flex-col gap-2">
          <Sparkline counts={stats.histogram} />
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <Pair label="min" value={fmtNum(stats.min)} />
            <Pair label="max" value={fmtNum(stats.max)} />
            <Pair label="mean" value={fmtNum(stats.mean)} />
            <Pair label="median" value={fmtNum(stats.median)} />
            <Pair label="σ" value={fmtNum(stats.stdev)} />
            <Pair
              label="rows"
              value={`${stats.count.toLocaleString("en-US")}${stats.missing > 0 ? ` (${stats.missing}∅)` : ""}`}
            />
          </div>
        </div>
      );
    case "date":
      return (
        <div className="flex flex-col gap-2">
          <Sparkline counts={stats.histogram} />
          <div className="grid grid-cols-1 gap-y-1 text-xs">
            <Pair label="earliest" value={fmtDate(stats.earliest)} />
            <Pair label="latest" value={fmtDate(stats.latest)} />
            <Pair
              label="rows"
              value={`${stats.count.toLocaleString("en-US")}${stats.missing > 0 ? ` (${stats.missing}∅)` : ""}`}
            />
          </div>
        </div>
      );
    case "boolean": {
      const total = stats.trueCount + stats.falseCount;
      const tPct = total > 0 ? Math.round((stats.trueCount / total) * 100) : 0;
      return (
        <div className="flex flex-col gap-2">
          <div className="flex h-3 w-full overflow-hidden rounded-full border-2 border-ink">
            <div className="bg-pink" style={{ width: `${tPct}%` }} />
            <div className="bg-cream" style={{ width: `${100 - tPct}%` }} />
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <Pair label="true" value={stats.trueCount.toLocaleString("en-US")} />
            <Pair
              label="false"
              value={stats.falseCount.toLocaleString("en-US")}
            />
          </div>
        </div>
      );
    }
    case "id":
      return (
        <div className="flex flex-col gap-1 text-xs">
          <Pair label="unique" value={stats.unique.toLocaleString("en-US")} />
          <Pair label="rows" value={stats.count.toLocaleString("en-US")} />
          <ul className="mt-1 max-h-16 overflow-hidden text-[10px] text-ink-muted">
            {stats.sample.map((s, i) => (
              <li key={i} className="truncate font-mono">
                {s}
              </li>
            ))}
          </ul>
        </div>
      );
    case "text":
    default:
      return (
        <div className="flex flex-col gap-1 text-xs">
          <Pair label="unique" value={stats.unique.toLocaleString("en-US")} />
          <Pair label="rows" value={stats.count.toLocaleString("en-US")} />
          <ul className="mt-1 flex flex-col gap-0.5">
            {stats.topValues.slice(0, 5).map((v, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-2 text-[10px]"
                title={v.value}
              >
                <span className="truncate font-medium">{v.value || "∅"}</span>
                <span className="font-mono tabular-nums text-ink-muted">
                  {v.count}
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
  }
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <span className="text-[10px] uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

function Sparkline({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts);
  return (
    <div className="flex h-10 items-end gap-0.5 rounded border-2 border-ink bg-cream p-1">
      {counts.map((c, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm bg-ink"
          style={{ height: `${(c / max) * 100}%` }}
          title={`${c} rows`}
        />
      ))}
    </div>
  );
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Number.isInteger(n)) return n.toLocaleString("en-US");
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function fmtDate(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Table with virtualization                                           */
/* ------------------------------------------------------------------ */

function DataTable({
  table,
  visibleIndices,
  sort,
  cycleSort,
  filters,
  setFilters,
}: {
  table: ParsedTable;
  visibleIndices: number[];
  sort: SortKey;
  cycleSort: (column: string) => void;
  filters: FilterMap;
  setFilters: (next: FilterMap | ((prev: FilterMap) => FilterMap)) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const totalHeight = visibleIndices.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2;
  const endIndex = Math.min(
    visibleIndices.length,
    startIndex + visibleCount,
  );

  const colWidth = 180;
  const totalWidth = table.columns.length * colWidth;

  return (
    <div className="card-chunk overflow-hidden rounded-[var(--radius-card)] bg-cream">
      {/* Header (sticky) */}
      <div
        className="grid border-b-2 border-ink bg-cream-deep"
        style={{ gridTemplateColumns: `repeat(${table.columns.length}, ${colWidth}px)`, width: `${totalWidth}px` }}
      >
        {table.columns.map((c) => {
          const isSorted = sort?.column === c.name;
          const arrow = !isSorted ? "↕" : sort?.dir === "asc" ? "↑" : "↓";
          return (
            <button
              key={c.name}
              type="button"
              onClick={() => cycleSort(c.name)}
              className="flex h-9 items-center justify-between gap-1 border-r-2 border-ink px-2 text-left text-xs font-bold uppercase tracking-wide transition-colors hover:bg-purple-soft"
              title={`Sort by ${c.name}`}
            >
              <span className="truncate">{c.name}</span>
              <span className="text-ink-muted">{arrow}</span>
            </button>
          );
        })}
      </div>
      {/* Filter row */}
      <div
        className="grid border-b-2 border-ink bg-cream"
        style={{ gridTemplateColumns: `repeat(${table.columns.length}, ${colWidth}px)`, width: `${totalWidth}px` }}
      >
        {table.columns.map((c) => (
          <input
            key={c.name}
            type="text"
            value={filters[c.name] ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setFilters((prev: FilterMap) => ({ ...prev, [c.name]: v }));
            }}
            placeholder="filter…"
            className="h-9 w-full border-r-2 border-ink bg-cream-deep px-2 font-mono text-xs focus:bg-purple-soft"
          />
        ))}
      </div>
      {/* Body — virtualized scroll */}
      <div
        ref={scrollRef}
        className="overflow-auto"
        style={{ height: VIEWPORT_HEIGHT, width: "100%" }}
      >
        {visibleIndices.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-muted">
            No rows match.
          </div>
        ) : (
          <div
            style={{
              height: totalHeight,
              width: totalWidth,
              position: "relative",
            }}
          >
            {Array.from({ length: endIndex - startIndex }, (_, k) => {
              const rowIdx = startIndex + k;
              const dataIdx = visibleIndices[rowIdx];
              const row = table.rows[dataIdx];
              return (
                <div
                  key={rowIdx}
                  className="grid border-b border-ink/10 hover:bg-purple-soft/40"
                  style={{
                    position: "absolute",
                    top: rowIdx * ROW_HEIGHT,
                    height: ROW_HEIGHT,
                    width: totalWidth,
                    gridTemplateColumns: `repeat(${table.columns.length}, ${colWidth}px)`,
                  }}
                >
                  {table.columns.map((c) => (
                    <div
                      key={c.name}
                      className="truncate border-r border-ink/10 px-2 py-2 font-mono text-xs"
                      title={String(row[c.name] ?? "")}
                    >
                      {formatCell(row[c.name])}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  return String(value);
}
