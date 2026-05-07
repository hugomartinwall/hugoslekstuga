"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

const STORAGE_KEY = "hugoslekstuga:eight:question";

type Tone = "yes" | "no" | "maybe";

const ANSWERS: { text: string; tone: Tone }[] = [
  { text: "It is certain.", tone: "yes" },
  { text: "Without a doubt.", tone: "yes" },
  { text: "Yes — definitely.", tone: "yes" },
  { text: "You may rely on it.", tone: "yes" },
  { text: "As I see it, yes.", tone: "yes" },
  { text: "Most likely.", tone: "yes" },
  { text: "Outlook good.", tone: "yes" },
  { text: "Signs point to yes.", tone: "yes" },
  { text: "Reply hazy, try again.", tone: "maybe" },
  { text: "Ask again later.", tone: "maybe" },
  { text: "Better not tell you now.", tone: "maybe" },
  { text: "Cannot predict now.", tone: "maybe" },
  { text: "Concentrate and ask again.", tone: "maybe" },
  { text: "Don't count on it.", tone: "no" },
  { text: "My reply is no.", tone: "no" },
  { text: "My sources say no.", tone: "no" },
  { text: "Outlook not so good.", tone: "no" },
  { text: "Very doubtful.", tone: "no" },
  { text: "Absolutely not.", tone: "no" },
  { text: "I would not, in your place.", tone: "no" },
];

const TONE_BG: Record<Tone, string> = {
  yes: "#3fa66e",
  maybe: "#ffc233",
  no: "#ff5a3c",
};

const SHAKE_MS = 1100;

export default function EightPage() {
  const tool = findTool("eight")!;
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ text: string; tone: Tone } | null>(null);
  const [shaking, setShaking] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const lastIndexRef = useRef<number>(-1);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) setQuestion(saved);
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (question) localStorage.setItem(STORAGE_KEY, question);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, [question, hydrated]);

  const ask = useCallback(() => {
    if (shaking) return;
    setShaking(true);
    setAnswer(null);
    let idx;
    do {
      idx = Math.floor(Math.random() * ANSWERS.length);
    } while (ANSWERS.length > 1 && idx === lastIndexRef.current);
    lastIndexRef.current = idx;
    window.setTimeout(() => {
      setAnswer(ANSWERS[idx]);
      setShaking(false);
    }, SHAKE_MS);
  }, [shaking]);

  const tone: Tone = answer?.tone ?? "maybe";

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label
            htmlFor="eight-q"
            className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
          >
            Ask a yes-or-no question
          </label>
          <input
            id="eight-q"
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Should I take the long way home?"
            className="card-chunk rounded-[var(--radius-card)] bg-cream px-4 py-3 font-display text-lg font-bold tracking-tight focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter") ask();
            }}
          />
        </div>

        <div className="card-chunk relative flex aspect-square w-full max-w-md items-center justify-center self-center overflow-hidden rounded-full border-4 border-ink bg-purple">
          <div
            className={`absolute inset-0 ${shaking ? "animate-[wobble_120ms_linear_infinite]" : ""}`}
            style={{
              animationName: shaking ? "wobble" : undefined,
            }}
          />
          {/* Inner triangle window */}
          <div
            className="relative flex h-2/5 w-2/5 items-center justify-center rounded-full border-2 border-ink"
            style={{
              background: answer ? TONE_BG[tone] : "#1a1812",
              transition: "background 600ms ease",
              transform: shaking
                ? `translate(${Math.sin(Date.now() / 30) * 4}px, ${Math.cos(Date.now() / 25) * 4}px)`
                : "none",
            }}
          >
            {!answer && !shaking && (
              <span className="select-none font-display text-7xl font-extrabold text-cream">
                8
              </span>
            )}
            {shaking && (
              <span className="font-display text-3xl font-extrabold text-cream">
                …
              </span>
            )}
            {answer && (
              <p
                key={answer.text}
                className="fade-rise px-3 text-center font-display text-base font-extrabold leading-tight text-cream sm:text-lg"
              >
                {answer.text}
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={ask}
          disabled={shaking}
          className="btn-chunk mx-auto rounded-[var(--radius-button)] bg-purple px-7 py-3 font-display text-lg font-extrabold text-cream disabled:cursor-progress disabled:opacity-80"
        >
          {shaking ? "…shaking…" : answer ? "Ask again" : "Shake"}
        </button>

        <p className="text-center text-xs text-ink-muted">
          The classic 20 answers. Take it as seriously as you like.
        </p>
      </div>

      <style jsx global>{`
        @keyframes wobble {
          0% { transform: translate(0, 0) rotate(0deg); }
          25% { transform: translate(-4px, 2px) rotate(-2deg); }
          50% { transform: translate(3px, -2px) rotate(2deg); }
          75% { transform: translate(-2px, 3px) rotate(-1deg); }
          100% { transform: translate(0, 0) rotate(0deg); }
        }
      `}</style>
    </ToolFrame>
  );
}
