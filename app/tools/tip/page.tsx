"use client";

import { useEffect, useMemo, useState } from "react";
import ToolFrame from "@/components/ToolFrame";
import { findTool } from "@/lib/tools";

const STORAGE_KEY = "hugoslekstuga:tip:state";

const CURRENCIES: { id: Currency; symbol: string; locale: string }[] = [
  { id: "SEK", symbol: "kr", locale: "sv-SE" },
  { id: "EUR", symbol: "€", locale: "en-IE" },
  { id: "USD", symbol: "$", locale: "en-US" },
  { id: "GBP", symbol: "£", locale: "en-GB" },
];

type Currency = "SEK" | "EUR" | "USD" | "GBP";

type Stored = {
  bill: string;
  tip: number;
  people: number;
  round: 0 | 1 | 5 | 10;
  currency: Currency;
};

const TIP_PRESETS = [0, 10, 12, 15, 18, 20];

export default function TipPage() {
  const tool = findTool("tip")!;
  const [bill, setBill] = useState<string>("");
  const [tip, setTip] = useState<number>(15);
  const [people, setPeople] = useState<number>(2);
  const [round, setRound] = useState<0 | 1 | 5 | 10>(0);
  const [currency, setCurrency] = useState<Currency>("SEK");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<Stored>;
        if (typeof s.bill === "string") setBill(s.bill);
        if (typeof s.tip === "number") setTip(s.tip);
        if (typeof s.people === "number" && s.people >= 1)
          setPeople(s.people);
        if (s.round === 0 || s.round === 1 || s.round === 5 || s.round === 10)
          setRound(s.round);
        if (s.currency && CURRENCIES.some((c) => c.id === s.currency))
          setCurrency(s.currency);
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const next: Stored = { bill, tip, people, round, currency };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }, [bill, tip, people, round, currency, hydrated]);

  const billNum = useMemo(() => {
    const n = Number(bill.replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [bill]);

  const tipAmount = useMemo(() => billNum * (tip / 100), [billNum, tip]);
  const totalRaw = billNum + tipAmount;
  const totalRounded = useMemo(() => {
    if (round === 0) return totalRaw;
    return Math.ceil(totalRaw / round) * round;
  }, [totalRaw, round]);
  const tipAfterRound = totalRounded - billNum;
  const perPerson = people > 0 ? totalRounded / people : 0;

  const c = CURRENCIES.find((x) => x.id === currency)!;
  const fmt = (n: number) =>
    new Intl.NumberFormat(c.locale, {
      style: "currency",
      currency: c.id,
      maximumFractionDigits: 2,
    }).format(n);

  return (
    <ToolFrame tool={tool}>
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="bill"
              className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
            >
              Bill total
            </label>
            <div className="card-chunk flex items-center gap-2 rounded-[var(--radius-card)] bg-cream px-4 py-3">
              <input
                id="bill"
                type="text"
                inputMode="decimal"
                value={bill}
                onChange={(e) => setBill(e.target.value.replace(/[^0-9.,]/g, ""))}
                placeholder="0"
                className="w-full bg-transparent font-display text-3xl font-extrabold tabular-nums text-ink placeholder:text-ink-muted focus:outline-none sm:text-4xl"
              />
              <span className="font-display text-xl font-bold text-ink-muted">
                {c.symbol}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Currency
            </p>
            <div className="flex flex-wrap gap-2">
              {CURRENCIES.map((cu) => (
                <button
                  key={cu.id}
                  type="button"
                  onClick={() => setCurrency(cu.id)}
                  className={`rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold transition-colors ${
                    currency === cu.id
                      ? "bg-yellow text-ink"
                      : "bg-cream hover:bg-yellow-soft"
                  }`}
                >
                  {cu.id}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Tip
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {TIP_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setTip(p)}
                className={`rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold transition-colors ${
                  tip === p ? "bg-yellow text-ink" : "bg-cream hover:bg-yellow-soft"
                }`}
              >
                {p === 0 ? "0" : `${p}%`}
              </button>
            ))}
            <label className="flex items-center gap-2 rounded-full border-2 border-ink bg-cream px-3 py-1.5 text-sm font-bold">
              <span>custom</span>
              <input
                type="number"
                min={0}
                max={100}
                value={tip}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n >= 0 && n <= 100) setTip(n);
                }}
                className="w-12 bg-transparent text-center outline-none"
              />
              <span>%</span>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              People
            </p>
            <div className="card-chunk flex items-center justify-between rounded-[var(--radius-card)] bg-cream px-4 py-3">
              <button
                type="button"
                onClick={() => setPeople((n) => Math.max(1, n - 1))}
                className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-cream font-display text-xl font-extrabold transition-colors hover:bg-yellow-soft"
              >
                −
              </button>
              <span className="font-display text-3xl font-extrabold tabular-nums">
                {people}
              </span>
              <button
                type="button"
                onClick={() => setPeople((n) => Math.min(99, n + 1))}
                className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-cream font-display text-xl font-extrabold transition-colors hover:bg-yellow-soft"
              >
                +
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Round total up to
            </p>
            <div className="flex flex-wrap gap-2">
              {[0, 1, 5, 10].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRound(r as 0 | 1 | 5 | 10)}
                  className={`rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold transition-colors ${
                    round === r
                      ? "bg-yellow text-ink"
                      : "bg-cream hover:bg-yellow-soft"
                  }`}
                >
                  {r === 0 ? "no round" : `nearest ${r}`}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="card-chunk flex flex-col gap-2 rounded-[var(--radius-card)] bg-yellow p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Each person pays
          </p>
          <p className="font-display text-5xl font-extrabold tracking-tight tabular-nums sm:text-6xl">
            {billNum > 0 ? fmt(perPerson) : `${c.symbol}—`}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-soft">
            <span>
              Total{" "}
              <span className="font-bold tabular-nums text-ink">
                {fmt(totalRounded)}
              </span>
            </span>
            <span>
              Tip{" "}
              <span className="font-bold tabular-nums text-ink">
                {fmt(tipAfterRound)}
              </span>
              {round > 0 && totalRounded !== totalRaw && (
                <span className="ml-1 text-xs text-ink-muted">
                  (rounded from {fmt(tipAmount)})
                </span>
              )}
            </span>
          </div>
        </div>
      </div>
    </ToolFrame>
  );
}
