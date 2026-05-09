"use client";

import { useCallback, useEffect, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";
import {
  EMPTY_LOCKS,
  generatePrompt,
  rerollPart,
  type Locks,
  type Prompt,
  type PromptKey,
} from "@/lib/idea";

const KEYS: PromptKey[] = ["character", "setting", "twist", "tone"];

const LABELS: Record<PromptKey, string> = {
  character: "Character",
  setting: "Setting",
  twist: "Twist",
  tone: "Tone",
};

export default function IdeaPage() {
  const tool = findTool("idea")!;
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [locks, setLocks] = useState<Locks>(EMPTY_LOCKS);
  const [animKey, setAnimKey] = useState(0);

  const spark = useCallback(() => {
    setPrompt((prev) => generatePrompt(prev ?? undefined, locks));
    setAnimKey((k) => k + 1);
  }, [locks]);

  const rerollOne = useCallback((key: PromptKey) => {
    setPrompt((prev) => (prev ? rerollPart(prev, key) : null));
  }, []);

  const toggleLock = useCallback((key: PromptKey) => {
    setLocks((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Spacebar sparks (respecting locks).
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
      spark();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spark]);

  const lockedCount = KEYS.filter((k) => locks[k]).length;
  const allLocked = lockedCount === KEYS.length;

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col items-stretch gap-7">
        {prompt === null ? (
          <p className="text-center font-display text-xl font-medium leading-snug text-ink-soft sm:text-2xl">
            A short prompt to get the page moving.{" "}
            <span className="text-pink">Press Spark.</span>
          </p>
        ) : (
          <div
            key={animKey}
            className="card-chunk flex flex-col gap-2 rounded-[var(--radius-card)] bg-pink-soft p-3 sm:p-4"
          >
            {KEYS.map((k) => (
              <PromptRow
                key={k}
                label={LABELS[k]}
                value={prompt[k]}
                locked={locks[k]}
                onToggleLock={() => toggleLock(k)}
                onReroll={() => rerollOne(k)}
              />
            ))}
          </div>
        )}

        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={spark}
            disabled={allLocked && prompt !== null}
            className="btn-chunk rounded-[var(--radius-button)] bg-pink px-7 py-3 font-display text-lg font-extrabold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {prompt === null ? "Spark a prompt" : allLocked ? "All four locked" : "Spark another"}
          </button>
          <span className="hidden text-xs text-ink-muted sm:inline-flex sm:items-center sm:gap-1">
            or press{" "}
            <kbd className="rounded border border-ink-muted bg-cream-deep px-1.5 py-0.5 font-mono text-[11px] uppercase">
              Space
            </kbd>
            {lockedCount > 0 && (
              <span>· {lockedCount} locked, the rest will reroll</span>
            )}
          </span>
        </div>

        <p className="text-xs text-ink-muted">
          Lock the parts you like; spark the rest. Or click any single line to
          reroll just that one.
        </p>
      </div>
    </ToolFrame>
  );
}

function PromptRow({
  label,
  value,
  locked,
  onToggleLock,
  onReroll,
}: {
  label: string;
  value: string;
  locked: boolean;
  onToggleLock: () => void;
  onReroll: () => void;
}) {
  return (
    <div
      className={`group flex items-start gap-3 rounded-[12px] border-2 border-ink p-3 transition-colors sm:p-4 ${
        locked ? "bg-cream" : "bg-pink-soft"
      }`}
    >
      <button
        type="button"
        onClick={onToggleLock}
        aria-label={locked ? `Unlock ${label}` : `Lock ${label}`}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-ink text-base transition-colors ${
          locked ? "bg-pink text-ink" : "bg-cream hover:bg-pink-soft"
        }`}
      >
        {locked ? "🔒" : "🔓"}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          {label}
          {locked && (
            <span className="ml-2 text-[10px] text-ink-soft">locked</span>
          )}
        </p>
        <p className="font-display text-lg font-extrabold leading-snug tracking-tight sm:text-xl">
          {value}
        </p>
      </div>
      <button
        type="button"
        onClick={onReroll}
        disabled={locked}
        aria-label={`Reroll ${label}`}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-cream text-base font-bold transition-colors hover:bg-pink disabled:cursor-not-allowed disabled:opacity-30"
      >
        ↻
      </button>
    </div>
  );
}
