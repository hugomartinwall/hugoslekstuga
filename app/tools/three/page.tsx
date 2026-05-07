"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

const STORAGE_KEY = "hugoslekstuga:three:entries";

type Entry = {
  things: [string, string, string];
  whys: [string, string, string];
};

type Entries = Record<string, Entry>;

function emptyEntry(): Entry {
  return {
    things: ["", "", ""],
    whys: ["", "", ""],
  };
}

const THREE_DEFAULT: Entries = {};

export default function ThreePage() {
  const tool = findTool("three")!;
  const [entries, setEntries] = useLocalStorageState<Entries>(STORAGE_KEY, THREE_DEFAULT);
  const [draft, setDraft] = useState<Entry>(emptyEntry());
  const [editing, setEditing] = useState(false);

  const today = useMemo(() => localISODate(new Date()), []);
  const todayEntry = entries[today];

  // Sync draft with stored entry when editing toggles or entries change.
  useEffect(() => {
    if (editing && todayEntry) {
      setDraft({
        things: [...todayEntry.things] as [string, string, string],
        whys: [...todayEntry.whys] as [string, string, string],
      });
    } else if (!todayEntry) {
      // No entry yet for today — start fresh.
      setDraft((d) =>
        d.things.some(Boolean) || d.whys.some(Boolean) ? d : emptyEntry(),
      );
    }
  }, [editing, todayEntry]);

  // The hook handles persistence — keeping the helper for the rest of the
  // file so we don't have to touch every call site.
  const persist = useCallback(
    (next: Entries) => {
      setEntries(next);
    },
    [setEntries],
  );

  const save = useCallback(() => {
    const cleaned: Entry = {
      things: draft.things.map((t) => t.trim()) as [string, string, string],
      whys: draft.whys.map((w) => w.trim()) as [string, string, string],
    };
    if (cleaned.things.every((t) => !t)) return;
    persist({ ...entries, [today]: cleaned });
    setEditing(false);
    if (!todayEntry) setDraft(emptyEntry());
  }, [draft, entries, today, todayEntry, persist]);

  const removeEntry = useCallback(
    (date: string) => {
      const next = { ...entries };
      delete next[date];
      persist(next);
    },
    [entries, persist],
  );

  const streak = useMemo(() => computeStreak(entries, today), [entries, today]);

  const history = useMemo(
    () =>
      Object.keys(entries)
        .sort()
        .reverse()
        .filter((d) => d !== today),
    [entries, today],
  );

  const showForm = !todayEntry || editing;

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-7">
        <Header streak={streak} hasToday={Boolean(todayEntry)} />

        {showForm ? (
          <ThreeForm
            draft={draft}
            setDraft={setDraft}
            onSave={save}
            onCancel={
              editing
                ? () => {
                    setEditing(false);
                    setDraft(emptyEntry());
                  }
                : null
            }
          />
        ) : (
          <TodayView
            entry={todayEntry!}
            onEdit={() => setEditing(true)}
          />
        )}

        {history.length > 0 && (
          <History
            entries={entries}
            keys={history}
            onDelete={removeEntry}
          />
        )}

        <Footer />
      </div>
    </ToolFrame>
  );
}

function Header({ streak, hasToday }: { streak: number; hasToday: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink-soft">
        {longDate(new Date())} · {hasToday ? "saved" : "not yet"}
      </p>
      {streak > 0 && (
        <p className="font-display text-lg font-bold">
          🔥 {streak}-day streak
          {!hasToday && (
            <span className="ml-2 text-sm font-normal text-ink-soft">
              — write today&rsquo;s to keep it going
            </span>
          )}
        </p>
      )}
    </div>
  );
}

function ThreeForm({
  draft,
  setDraft,
  onSave,
  onCancel,
}: {
  draft: Entry;
  setDraft: (e: Entry) => void;
  onSave: () => void;
  onCancel: (() => void) | null;
}) {
  const setThing = (i: 0 | 1 | 2, v: string) => {
    const next: Entry = {
      things: [...draft.things] as [string, string, string],
      whys: [...draft.whys] as [string, string, string],
    };
    next.things[i] = v;
    setDraft(next);
  };
  const setWhy = (i: 0 | 1 | 2, v: string) => {
    const next: Entry = {
      things: [...draft.things] as [string, string, string],
      whys: [...draft.whys] as [string, string, string],
    };
    next.whys[i] = v;
    setDraft(next);
  };

  const canSave = draft.things.some((t) => t.trim().length > 0);

  return (
    <div className="flex flex-col gap-5">
      <p className="font-display text-2xl font-bold leading-snug sm:text-3xl">
        What three good things happened today?
      </p>

      <ol className="flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <li
            key={i}
            className="card-chunk flex flex-col gap-3 rounded-[var(--radius-card)] bg-cream p-4 sm:p-5"
          >
            <div className="flex items-center gap-3">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-green text-cream font-display text-sm font-extrabold"
                aria-hidden
              >
                {i + 1}
              </span>
              <input
                type="text"
                value={draft.things[i]}
                onChange={(e) => setThing(i as 0 | 1 | 2, e.target.value)}
                placeholder="Something that went well…"
                className="flex-1 rounded-[10px] border-2 border-ink bg-cream px-3 py-2 text-base font-medium focus:outline-none"
              />
            </div>
            <textarea
              value={draft.whys[i]}
              onChange={(e) => setWhy(i as 0 | 1 | 2, e.target.value)}
              rows={2}
              placeholder="Why did it happen? (optional, but the reflection is the point)"
              className="rounded-[10px] border-2 border-dashed border-ink-muted bg-cream-deep px-3 py-2 text-sm leading-relaxed text-ink-soft focus:outline-none focus:border-ink"
            />
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          className="btn-chunk rounded-[var(--radius-button)] bg-green px-7 py-3 font-display text-base font-extrabold text-cream disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save today
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border-2 border-ink bg-cream px-4 py-2 text-sm font-semibold transition-colors hover:bg-cream-deep"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function TodayView({
  entry,
  onEdit,
}: {
  entry: Entry;
  onEdit: () => void;
}) {
  return (
    <div className="card-chunk flex flex-col gap-4 rounded-[var(--radius-card)] bg-green-soft p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Today
        </p>
        <button
          type="button"
          onClick={onEdit}
          className="rounded-full border-2 border-ink bg-cream px-3 py-1 text-xs font-semibold transition-colors hover:bg-cream-deep"
        >
          Edit
        </button>
      </div>
      <ol className="flex flex-col gap-3">
        {entry.things.map((t, i) =>
          t.trim() ? (
            <li key={i} className="flex flex-col gap-1">
              <p className="font-display text-lg font-bold leading-snug">
                {i + 1}. {t}
              </p>
              {entry.whys[i]?.trim() && (
                <p className="pl-4 text-sm leading-relaxed text-ink-soft">
                  → {entry.whys[i]}
                </p>
              )}
            </li>
          ) : null,
        )}
      </ol>
    </div>
  );
}

function History({
  entries,
  keys,
  onDelete,
}: {
  entries: Entries;
  keys: string[];
  onDelete: (date: string) => void;
}) {
  if (keys.length === 0) return null;
  return (
    <details className="rounded-[var(--radius-card)] border-2 border-ink bg-cream p-4">
      <summary className="cursor-pointer font-display text-base font-bold">
        Past days
        <span className="ml-2 text-sm font-normal text-ink-muted">
          ({keys.length})
        </span>
      </summary>
      <ol className="mt-4 flex flex-col gap-4">
        {keys.map((date) => (
          <li
            key={date}
            className="rounded-[var(--radius-card)] border-2 border-ink bg-cream-deep p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink">
                {longDate(parseLocalISODate(date))}
              </p>
              <button
                type="button"
                onClick={() => {
                  if (
                    typeof window !== "undefined" &&
                    window.confirm(`Delete ${date}?`)
                  ) {
                    onDelete(date);
                  }
                }}
                className="text-xs font-semibold text-ink-muted hover:text-tomato"
              >
                delete
              </button>
            </div>
            <ol className="mt-2 flex flex-col gap-1">
              {entries[date].things.map((t, i) =>
                t.trim() ? (
                  <li key={i} className="text-sm">
                    <span className="font-semibold">{i + 1}.</span> {t}
                    {entries[date].whys[i]?.trim() && (
                      <span className="block pl-4 text-xs text-ink-soft">
                        → {entries[date].whys[i]}
                      </span>
                    )}
                  </li>
                ) : null,
              )}
            </ol>
          </li>
        ))}
      </ol>
    </details>
  );
}

function Footer() {
  return (
    <p className="text-xs text-ink-muted">
      Based on Martin Seligman&rsquo;s &ldquo;Three Good Things&rdquo; exercise
      — repeated nightly for a week, it has been associated with measurable
      improvements in mood and reductions in symptoms of depression. Your
      entries stay on this device.
    </p>
  );
}

function localISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseLocalISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function longDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function computeStreak(entries: Entries, todayISO: string): number {
  let streak = 0;
  const cursor = parseLocalISODate(todayISO);
  // If today isn't recorded yet, start from yesterday so we still encourage continuing.
  if (!entries[localISODate(cursor)]) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (entries[localISODate(cursor)]) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
