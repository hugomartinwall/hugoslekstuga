"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

const STORAGE_KEY = "hugoslekstuga:until:events";

type Event = {
  id: string;
  title: string;
  iso: string; // YYYY-MM-DD
};

const UNTIL_DEFAULT: Event[] = [];

export default function UntilPage() {
  const tool = findTool("until")!;
  const [events, setEvents] = useLocalStorageState<Event[]>(STORAGE_KEY, UNTIL_DEFAULT);
  const safeEvents = Array.isArray(events) ? events : UNTIL_DEFAULT;
  const [now, setNow] = useState<number>(() => Date.now());
  const [title, setTitle] = useState("");
  const [iso, setIso] = useState("");

  // Tick the clock once a second so countdowns update.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const sorted = useMemo(() => {
    return [...safeEvents].sort((a, b) => {
      const ta = parseTarget(a.iso).getTime();
      const tb = parseTarget(b.iso).getTime();
      const fa = ta - now;
      const fb = tb - now;
      // Future first (soonest first); past at the bottom (most recent first).
      if (fa >= 0 && fb < 0) return -1;
      if (fa < 0 && fb >= 0) return 1;
      if (fa >= 0 && fb >= 0) return fa - fb;
      return tb - ta;
    });
  }, [safeEvents, now]);

  const addEvent = useCallback(() => {
    if (!title.trim() || !iso) return;
    setEvents((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        title: title.trim(),
        iso,
      },
    ]);
    setTitle("");
    setIso("");
  }, [title, iso]);

  const removeEvent = useCallback((id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const todayISO = useMemo(() => localISODate(new Date()), []);

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-6">
        <AddForm
          title={title}
          setTitle={setTitle}
          iso={iso}
          setIso={setIso}
          minISO={todayISO}
          onAdd={addEvent}
        />

        {safeEvents.length === 0 && (
          <div className="rounded-[var(--radius-card)] border-2 border-dashed border-ink-muted bg-cream-deep p-6 text-center">
            <p className="font-display text-lg font-bold">Nothing on the horizon yet.</p>
            <p className="mt-2 text-sm text-ink-soft">
              Add a date above — a birthday, deadline, trip, anything you&rsquo;re
              waiting for.
            </p>
          </div>
        )}

        <ol className="flex flex-col gap-3">
          {sorted.map((e) => (
            <li key={e.id}>
              <EventCard event={e} now={now} onDelete={() => removeEvent(e.id)} />
            </li>
          ))}
        </ol>
      </div>
    </ToolFrame>
  );
}

function AddForm({
  title,
  setTitle,
  iso,
  setIso,
  minISO,
  onAdd,
}: {
  title: string;
  setTitle: (s: string) => void;
  iso: string;
  setIso: (s: string) => void;
  minISO: string;
  onAdd: () => void;
}) {
  const ready = Boolean(title.trim() && iso);
  return (
    <div className="card-chunk flex flex-col gap-3 rounded-[var(--radius-card)] bg-cream p-4 sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Add a date
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="My birthday, the trip to Paris, the deadline…"
          onKeyDown={(e) => {
            if (e.key === "Enter") onAdd();
          }}
          className="card-chunk flex-1 rounded-[var(--radius-card)] bg-cream px-3 py-2 text-base focus:outline-none"
        />
        <input
          type="date"
          value={iso}
          min={minISO}
          onChange={(e) => setIso(e.target.value)}
          className="card-chunk rounded-[var(--radius-card)] bg-cream px-3 py-2 font-mono text-base focus:outline-none"
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={!ready}
          className="btn-chunk rounded-[var(--radius-button)] bg-purple px-5 py-2 font-display text-base font-extrabold text-cream disabled:cursor-not-allowed disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function EventCard({
  event,
  now,
  onDelete,
}: {
  event: Event;
  now: number;
  onDelete: () => void;
}) {
  const target = parseTarget(event.iso);
  const diffMs = target.getTime() - now;
  const isPast = diffMs < 0;
  const absMs = Math.abs(diffMs);
  const days = Math.floor(absMs / (24 * 3600 * 1000));
  const hours = Math.floor((absMs % (24 * 3600 * 1000)) / (3600 * 1000));
  const minutes = Math.floor((absMs % (3600 * 1000)) / (60 * 1000));
  const seconds = Math.floor((absMs % (60 * 1000)) / 1000);

  return (
    <div
      className={`card-chunk flex flex-col gap-2 rounded-[var(--radius-card)] p-4 sm:p-5 ${
        isPast ? "bg-cream-deep opacity-90" : "bg-purple-soft"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <p className="font-display text-xl font-extrabold leading-tight tracking-tight sm:text-2xl">
            {event.title}
          </p>
          <p className="text-sm text-ink-soft">{longDate(target)}</p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="text-xs font-semibold text-ink-muted hover:text-tomato"
        >
          delete
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Cell value={days} label="days" />
        <Cell value={hours} label="hrs" />
        <Cell value={minutes} label="min" />
        <Cell value={seconds} label="sec" />
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {isPast ? `${humanRel(absMs)} ago` : `in ${humanRel(absMs)}`}
      </p>
    </div>
  );
}

function Cell({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center rounded-[12px] border-2 border-ink bg-cream py-2">
      <span className="font-display text-2xl font-extrabold tabular-nums sm:text-3xl">
        {String(value).padStart(2, "0")}
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </span>
    </div>
  );
}

function parseTarget(iso: string): Date {
  // Treat the input as local midnight on that calendar day.
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

function localISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function longDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function humanRel(ms: number): string {
  const days = Math.floor(ms / (24 * 3600 * 1000));
  if (days >= 365) {
    const y = Math.floor(days / 365);
    const rem = days % 365;
    return rem > 0 ? `${y} yr ${rem} day${rem === 1 ? "" : "s"}` : `${y} yr`;
  }
  if (days >= 30) {
    const months = Math.floor(days / 30);
    const rem = days - months * 30;
    return rem > 0 ? `${months} mo ${rem} day${rem === 1 ? "" : "s"}` : `${months} mo`;
  }
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.floor(ms / (3600 * 1000));
  if (hours >= 1) return `${hours} hr${hours === 1 ? "" : "s"}`;
  const minutes = Math.floor(ms / (60 * 1000));
  if (minutes >= 1) return `${minutes} min`;
  return "moments";
}
