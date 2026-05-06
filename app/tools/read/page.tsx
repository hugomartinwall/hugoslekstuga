"use client";

import { useMemo, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import {
  computeReadStats,
  gradeForFleschEase,
  type ReadStats,
} from "@/lib/read";

const SAMPLE = `Most things you're worried about will not happen. Plan for the ones that might.

Boring habits beat exciting plans. The smaller you make the next step, the more reliably you'll take it. When you don't know where to start, start with what's in front of you.`;

export default function ReadPage() {
  const tool = findTool("read")!;
  const [text, setText] = useState("");

  const stats = useMemo(() => computeReadStats(text), [text]);
  const isEmpty = text.trim().length === 0;

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="read-text"
              className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
            >
              Paste your text
            </label>
            <button
              type="button"
              onClick={() => setText(SAMPLE)}
              className="text-xs font-semibold text-purple underline-offset-2 hover:underline"
            >
              try a sample
            </button>
          </div>
          <textarea
            id="read-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="A blog post, an email, a chapter — paste anything and see what's in it."
            rows={10}
            className="card-chunk min-h-[14rem] rounded-[var(--radius-card)] bg-cream px-4 py-3 text-base leading-relaxed text-ink placeholder:text-ink-muted focus:outline-none"
          />
        </div>

        {isEmpty ? (
          <EmptyState />
        ) : (
          <Stats stats={stats} />
        )}
      </div>
    </ToolFrame>
  );
}

function EmptyState() {
  return (
    <p className="rounded-[var(--radius-card)] border-2 border-dashed border-ink-muted bg-cream-deep p-5 text-center text-sm text-ink-soft">
      Stats will appear here as soon as you paste anything in.
    </p>
  );
}

function Stats({ stats }: { stats: ReadStats }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Words"
          value={fmt(stats.words)}
          accent="bg-purple-soft"
        />
        <StatTile
          label="Characters"
          value={fmt(stats.characters)}
          sub={`${fmt(stats.charactersNoSpaces)} without spaces`}
          accent="bg-cream"
        />
        <StatTile
          label="Sentences"
          value={fmt(stats.sentences)}
          sub={
            stats.averageWordsPerSentence
              ? `${stats.averageWordsPerSentence.toFixed(1)} words avg`
              : undefined
          }
          accent="bg-cream"
        />
        <StatTile
          label="Paragraphs"
          value={fmt(stats.paragraphs)}
          accent="bg-cream"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="How long it takes">
          <Row label="To read silently">
            <span className="font-display text-2xl font-extrabold tabular-nums">
              {formatMinutes(stats.readingMinutes)}
            </span>
          </Row>
          <Row label="To read aloud">
            <span className="font-display text-2xl font-extrabold tabular-nums">
              {formatMinutes(stats.speakingMinutes)}
            </span>
          </Row>
          <p className="mt-2 text-xs text-ink-muted">
            Based on 240 words/min reading and 130 words/min speaking.
          </p>
        </Card>

        <Card title="Readability">
          <Row label="Flesch reading ease">
            <span className="font-display text-2xl font-extrabold tabular-nums">
              {stats.fleschReadingEase !== null
                ? stats.fleschReadingEase.toFixed(0)
                : "—"}
            </span>
          </Row>
          <Row label="Grade level">
            <span className="font-display text-2xl font-extrabold tabular-nums">
              {stats.fleschKincaidGrade !== null
                ? `${Math.max(0, stats.fleschKincaidGrade).toFixed(1)}`
                : "—"}
            </span>
          </Row>
          <p className="mt-2 text-xs text-ink-muted">
            {gradeForFleschEase(stats.fleschReadingEase)}
          </p>
        </Card>
      </div>

      {stats.topWords.length > 0 && (
        <Card title="Words you lean on">
          <ul className="flex flex-wrap gap-2 pt-1">
            {stats.topWords.map(({ word, count }) => (
              <li
                key={word}
                className="flex items-center gap-2 rounded-full border-2 border-ink bg-cream px-3 py-1 text-sm"
              >
                <span className="font-bold">{word}</span>
                <span className="text-xs text-ink-muted">×{count}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div
      className={`card-chunk flex flex-col gap-1 rounded-[var(--radius-card)] ${accent} p-4`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <p className="font-display text-3xl font-extrabold leading-none tabular-nums">
        {value}
      </p>
      {sub && <p className="text-xs text-ink-soft">{sub}</p>}
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card-chunk flex flex-col gap-2 rounded-[var(--radius-card)] bg-cream p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {title}
      </p>
      {children}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-ink-soft">{label}</span>
      {children}
    </div>
  );
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function formatMinutes(min: number): string {
  if (min < 1 / 60) return "0s";
  if (min < 1) return `${Math.round(min * 60)}s`;
  const m = Math.floor(min);
  const s = Math.round((min - m) * 60);
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}
