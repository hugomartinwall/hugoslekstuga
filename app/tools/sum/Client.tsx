"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";
import {
  evaluateSession,
  RATES_DATE,
  type LineResult,
} from "@/lib/sum/evaluate";

const STORAGE_KEY = "hugoslekstuga:sum:state";

type Session = {
  id: string;
  name: string;
  text: string;
};

type State = {
  sessions: Session[];
  activeId: string;
};

function newId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const FIRST_ID = "s-first";

const STARTER = `// welcome to sum — a notepad calculator
// type math one line at a time, see each answer pinned right →

budget = 30000
rent = 12500
food = 4500
total = rent + food
left = budget - total

// references work — last, above, or line N
last + 100

// percentages
30% of 250
100 + 30%
20% off 75

// units & currency (rates from January 2025)
5 km in mi
2h 30m in min
1000 SEK in EUR
$50 in EUR
`;

const DEFAULT: State = {
  sessions: [{ id: FIRST_ID, name: "Scratch", text: STARTER }],
  activeId: FIRST_ID,
};

export default function SumPage() {
  const tool = findTool("sum")!;
  const [state, setState] = useLocalStorageState<State>(STORAGE_KEY, DEFAULT);

  // Defensive coercion in case localStorage holds an older shape or empty
  // state — same pattern as Tally.
  const safe: State = useMemo(() => {
    const sessions =
      Array.isArray(state.sessions) && state.sessions.length > 0
        ? state.sessions
        : DEFAULT.sessions;
    const activeId = sessions.some((s) => s.id === state.activeId)
      ? state.activeId
      : sessions[0].id;
    return { sessions, activeId };
  }, [state]);

  const active =
    safe.sessions.find((s) => s.id === safe.activeId) ?? safe.sessions[0];

  const results = useMemo(
    () => evaluateSession(active.text),
    [active.text],
  );

  // ---- session ops -------------------------------------------------

  const updateActive = useCallback(
    (patch: Partial<Session> | ((s: Session) => Session)) => {
      setState((s) => ({
        ...s,
        sessions: s.sessions.map((x) =>
          x.id === s.activeId
            ? typeof patch === "function"
              ? patch(x)
              : { ...x, ...patch }
            : x,
        ),
      }));
    },
    [setState],
  );

  const switchTo = (id: string) => {
    setState((s) => ({ ...s, activeId: id }));
  };

  const addSession = () => {
    const id = newId();
    setState((s) => ({
      sessions: [
        ...s.sessions,
        { id, name: `Session ${s.sessions.length + 1}`, text: "" },
      ],
      activeId: id,
    }));
  };

  const removeSession = (id: string) => {
    setState((s) => {
      if (s.sessions.length <= 1) return s; // keep at least one
      const sessions = s.sessions.filter((x) => x.id !== id);
      const activeId = s.activeId === id ? sessions[0].id : s.activeId;
      return { sessions, activeId };
    });
  };

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-4">
        {/* Session tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {safe.sessions.map((s) => {
            const isActive = s.id === safe.activeId;
            return (
              <div key={s.id} className="flex items-center">
                <button
                  type="button"
                  onClick={() => switchTo(s.id)}
                  className={`flex items-center gap-2 rounded-l-full border-2 border-r-0 border-ink px-3 py-1 text-xs font-bold transition-colors ${
                    isActive
                      ? "bg-yellow text-ink"
                      : "bg-cream hover:bg-yellow-soft"
                  }`}
                >
                  <span className="max-w-[140px] truncate">{s.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => removeSession(s.id)}
                  disabled={safe.sessions.length <= 1}
                  aria-label={`Remove ${s.name}`}
                  className={`rounded-r-full border-2 border-ink px-2 py-1 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    isActive
                      ? "bg-yellow text-ink hover:bg-tomato hover:text-cream"
                      : "bg-cream hover:bg-tomato hover:text-cream"
                  }`}
                  title="Remove session"
                >
                  ×
                </button>
              </div>
            );
          })}
          <button
            type="button"
            onClick={addSession}
            className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-bold transition-colors hover:bg-yellow-soft"
          >
            + new
          </button>
        </div>

        {/* Active session name */}
        <input
          type="text"
          value={active.name}
          onChange={(e) => updateActive({ name: e.target.value })}
          maxLength={32}
          placeholder="Session name"
          className="card-chunk rounded-[var(--radius-card)] bg-cream px-4 py-2 font-display text-base font-bold focus:outline-none"
        />

        {/* The notepad */}
        <Notepad
          text={active.text}
          onChange={(text) => updateActive({ text })}
          results={results}
        />

        {/* Quick stats */}
        <Stats results={results} />

        {/* Syntax help */}
        <details className="rounded-[var(--radius-card)] border-2 border-ink bg-cream-deep p-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-ink-muted">
            What can I type?
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Hint
              title="Variables"
              lines={["x = 5", "rent = 12500", "total revenue = 1000"]}
            />
            <Hint
              title="References"
              lines={["last + 100", "above * 2", "line 3"]}
            />
            <Hint
              title="Percentages"
              lines={["30% of 250", "100 + 30%", "20% off 75"]}
            />
            <Hint
              title="Units"
              lines={["5 km in mi", "2h 30m in min", "1.8 m in cm"]}
            />
            <Hint
              title="Currency"
              lines={["1000 SEK in EUR", "$50 in EUR", "€100 in GBP"]}
            />
            <Hint
              title="Comments"
              lines={["// notes after // are ignored", "# also works"]}
            />
          </div>
          <p className="mt-3 text-[11px] text-ink-muted">
            Currency rates are a static snapshot from {RATES_DATE} — they
            don&apos;t update live. Calculations stay on your device.
          </p>
        </details>
      </div>
    </ToolFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Notepad                                                             */
/* ------------------------------------------------------------------ */

function Notepad({
  text,
  onChange,
  results,
}: {
  text: string;
  onChange: (next: string) => void;
  results: LineResult[];
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Sync scroll between the textarea and the results column so a long
  // session keeps its lines aligned with their answers.
  useEffect(() => {
    const ta = taRef.current;
    const rs = resultsRef.current;
    if (!ta || !rs) return;
    const onTaScroll = () => {
      rs.scrollTop = ta.scrollTop;
    };
    ta.addEventListener("scroll", onTaScroll);
    return () => ta.removeEventListener("scroll", onTaScroll);
  }, []);

  return (
    <div className="card-chunk grid grid-cols-[1fr_140px] overflow-hidden rounded-[var(--radius-card)] bg-cream sm:grid-cols-[1fr_180px]">
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        wrap="off"
        placeholder="Type math, one line at a time…"
        className="h-[460px] resize-none overflow-auto whitespace-pre border-r-2 border-ink bg-cream p-4 font-mono text-base leading-7 focus:outline-none"
      />
      <div
        ref={resultsRef}
        className="h-[460px] overflow-y-auto bg-yellow-soft p-4 font-mono text-base leading-7"
        aria-label="Per-line results"
      >
        {results.length === 0 ? (
          <span className="text-ink-muted">&nbsp;</span>
        ) : (
          results.map((r) => (
            <div
              key={r.index}
              className="flex justify-end overflow-hidden whitespace-nowrap"
              title={r.error ?? r.preprocessed}
            >
              {r.isEmpty ? (
                <span>&nbsp;</span>
              ) : r.isComment ? (
                <span className="text-ink-muted">—</span>
              ) : r.error ? (
                <span className="font-bold text-tomato">!</span>
              ) : (
                <span className="font-bold tabular-nums">{r.formatted}</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

function Stats({ results }: { results: LineResult[] }) {
  const valueLines = results.filter(
    (r) => !r.isComment && !r.isEmpty && r.error === null,
  );
  const errors = results.filter((r) => r.error !== null);
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <span className="rounded-full border-2 border-ink bg-cream px-3 py-1 font-bold tabular-nums">
        {valueLines.length} answer{valueLines.length === 1 ? "" : "s"}
      </span>
      {errors.length > 0 && (
        <span
          className="rounded-full border-2 border-ink bg-tomato-soft px-3 py-1 font-bold tabular-nums"
          title={errors.map((e) => `line ${e.index}: ${e.error}`).join("\n")}
        >
          {errors.length} error{errors.length === 1 ? "" : "s"}
        </span>
      )}
      <span className="text-ink-muted">
        Answers update as you type. Sessions and content stay on this device.
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hint card                                                           */
/* ------------------------------------------------------------------ */

function Hint({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-md border-2 border-ink bg-cream p-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        {title}
      </p>
      <ul className="mt-1 space-y-0.5">
        {lines.map((l) => (
          <li key={l} className="font-mono text-[11px]">
            {l}
          </li>
        ))}
      </ul>
    </div>
  );
}
