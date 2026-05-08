// Sum's evaluator: a thin grammar on top of mathjs.
//
// Each session is a list of lines. Lines evaluate top-down with a shared
// scope. We accept a few natural-language conveniences that mathjs alone
// doesn't (line references, percentages-as-words, trailing `+ X%`) and we
// register a curated set of currencies as custom units so `1000 SEK in EUR`
// just works.
//
// The behaviour we want to feel like Soulver:
//
//   x = 5                  → 5
//   y = x * 3              → 15
//   last + 100             → 115
//   30% of 250             → 75
//   100 + 30%              → 130            (= 100 + 30)
//   20% off 75             → 60
//   2h 30m + 45m           → 3 h 15 min
//   1000 SEK in EUR        → 84.21 EUR
//   // anything after // is a comment

import { create, all, type MathJsInstance } from "mathjs";

/* ------------------------------------------------------------------ */
/* Currencies (snapshot rates)                                         */
/* ------------------------------------------------------------------ */

// 1 USD = N units of the currency. Sourced from approximate mid-market
// rates and intentionally treated as a static snapshot — fetching live
// rates would break the "stays on your device" promise the rest of the
// site keeps. The exact numbers will drift; we surface the date so the
// user can decide whether they care.
export const RATES_DATE = "January 2025";

const CURRENCIES: Record<string, { perUSD: number; aliases: string[] }> = {
  EUR: { perUSD: 0.92, aliases: ["€", "eur"] },
  GBP: { perUSD: 0.79, aliases: ["£", "gbp"] },
  SEK: { perUSD: 11.0, aliases: ["kr", "sek"] },
  NOK: { perUSD: 11.2, aliases: ["nok"] },
  DKK: { perUSD: 6.9, aliases: ["dkk"] },
  CHF: { perUSD: 0.91, aliases: ["chf"] },
  JPY: { perUSD: 156, aliases: ["¥", "jpy"] },
  CNY: { perUSD: 7.25, aliases: ["cny", "rmb"] },
  CAD: { perUSD: 1.43, aliases: ["cad"] },
  AUD: { perUSD: 1.55, aliases: ["aud"] },
  NZD: { perUSD: 1.71, aliases: ["nzd"] },
  INR: { perUSD: 84.5, aliases: ["inr"] },
  BRL: { perUSD: 6.0, aliases: ["brl"] },
  MXN: { perUSD: 20.5, aliases: ["mxn"] },
  ZAR: { perUSD: 18.5, aliases: ["zar"] },
  PLN: { perUSD: 3.95, aliases: ["pln"] },
};

/* ------------------------------------------------------------------ */
/* Math instance                                                       */
/* ------------------------------------------------------------------ */

let mathInstance: MathJsInstance | null = null;

function getMath(): MathJsInstance {
  if (mathInstance) return mathInstance;
  // Plain JS number is enough — Soulver-style accuracy, not arbitrary precision.
  // BigNumber breaks unit conversion in subtle ways we don't want to debug.
  const m = create(all, {});

  // USD is the base; everything else is defined relative to it. mathjs
  // requires a unique `definition` per unit, so we feed it the inverse of
  // each rate.
  m.createUnit("USD", { aliases: ["usd"] });
  // Note: $ is a tricky alias because it visually clashes with mathjs'
  // own currency-style behaviour and complicates parsing of `$50`. We
  // expose it via preprocessing instead (see `expandSymbols`).
  for (const [code, { perUSD, aliases }] of Object.entries(CURRENCIES)) {
    m.createUnit(code, {
      definition: `${1 / perUSD} USD`,
      aliases,
    });
  }

  mathInstance = m;
  return m;
}

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

export type LineResult = {
  index: number; // 1-based line number
  raw: string;
  preprocessed: string;
  formatted: string;
  error: string | null;
  isComment: boolean;
  isEmpty: boolean;
  assignedName: string | null;
};

/* ------------------------------------------------------------------ */
/* Top-level evaluate                                                  */
/* ------------------------------------------------------------------ */

export function evaluateSession(input: string): LineResult[] {
  const math = getMath();
  const rawLines = input.split(/\r?\n/);
  // Single shared scope across the session. mathjs mutates this when it
  // encounters an assignment expression.
  const scope: Record<string, unknown> = {};
  const out: LineResult[] = [];
  let lastValue: unknown = null;

  for (let i = 0; i < rawLines.length; i++) {
    const idx = i + 1;
    const raw = rawLines[i];
    const stripped = stripComment(raw);
    const trimmed = stripped.trim();

    if (raw.trim() !== stripped.trim() && trimmed === "") {
      // Pure comment line.
      out.push({
        index: idx,
        raw,
        preprocessed: "",
        formatted: "",
        error: null,
        isComment: true,
        isEmpty: false,
        assignedName: null,
      });
      continue;
    }

    if (trimmed === "") {
      out.push({
        index: idx,
        raw,
        preprocessed: "",
        formatted: "",
        error: null,
        isComment: false,
        isEmpty: true,
        assignedName: null,
      });
      continue;
    }

    try {
      const { expr, assignedName } = parseLine(trimmed);
      const preprocessed = preprocess(expr);

      // Inject implicit references for this line.
      scope._last = lastValue;

      // Evaluate. mathjs throws on syntax/unit errors.
      const result = math.evaluate(preprocessed, scope);

      // Store auto-references so `line N` and `last` keep working.
      scope[`_line${idx}`] = result;
      lastValue = result;
      if (assignedName) scope[assignedName] = result;

      out.push({
        index: idx,
        raw,
        preprocessed,
        formatted: formatResult(result),
        error: null,
        isComment: false,
        isEmpty: false,
        assignedName,
      });
    } catch (e) {
      out.push({
        index: idx,
        raw,
        preprocessed: "",
        formatted: "",
        error: e instanceof Error ? e.message : "couldn't evaluate",
        isComment: false,
        isEmpty: false,
        assignedName: null,
      });
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Parsing helpers                                                     */
/* ------------------------------------------------------------------ */

const VAR_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function stripComment(line: string): string {
  // // and # both start a line comment. Be careful not to strip inside a
  // string literal — but we don't really expect strings here, so skip the
  // edge case.
  const slash = line.indexOf("//");
  const hash = line.indexOf("#");
  const candidates = [slash, hash].filter((i) => i >= 0);
  if (candidates.length === 0) return line;
  const cut = Math.min(...candidates);
  return line.slice(0, cut);
}

function parseLine(line: string): { expr: string; assignedName: string | null } {
  // Detect `name = expression`, but NOT `==`, `<=`, `>=`, `!=`.
  const eq = findAssignmentEq(line);
  if (eq < 0) return { expr: line, assignedName: null };

  const lhs = line.slice(0, eq).trim();
  const rhs = line.slice(eq + 1).trim();
  if (lhs === "" || rhs === "") return { expr: line, assignedName: null };

  // Sluggify multi-word labels so "total revenue = 100" still works. We
  // only apply this for labels that don't already parse as identifiers.
  let name = lhs;
  if (!VAR_NAME_RE.test(name)) {
    const slug = name.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    if (!VAR_NAME_RE.test(slug)) {
      // We can't make a valid identifier — give up on the assignment.
      return { expr: line, assignedName: null };
    }
    name = slug;
  }

  return { expr: `${name} = ${rhs}`, assignedName: name };
}

function findAssignmentEq(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== "=") continue;
    const prev = line[i - 1];
    const next = line[i + 1];
    if (prev === "=" || prev === "<" || prev === ">" || prev === "!") continue;
    if (next === "=") continue;
    return i;
  }
  return -1;
}

/* ------------------------------------------------------------------ */
/* Preprocessor — natural-language flourishes                          */
/* ------------------------------------------------------------------ */

function preprocess(expr: string): string {
  let r = expr;

  // line N → _lineN  (must come before "last/above/prev" so we don't
  // accidentally capture things like "last 3 lines")
  r = r.replace(/\bline\s+(\d+)\b/gi, "_line$1");

  // last / above / prev / previous → _last
  r = r.replace(/\b(?:last|above|prev|previous)\b/gi, "_last");

  // Disambiguate unit names that clash with mathjs builtins. The classic
  // offender: `min` is both Math.min AND the alias for minutes. When it
  // appears as a unit-conversion target (`... in min` / `... to min`)
  // mathjs picks the function, which throws. Promote it to the full word.
  r = r.replace(/\b(in|to)\s+min\b/gi, "$1 minutes");

  // Compound time shorthand: `2h 30m` → `2 hours + 30 minutes`. mathjs
  // doesn't natively read juxtaposed unit-tagged numbers, but the Soulver
  // shape is part of the value here. We only treat `m` as minutes when it
  // follows an hour-tagged number — outside that context `m` stays as
  // meters.
  r = r.replace(
    /(\d+(?:\.\d+)?)\s*h\s+(\d+(?:\.\d+)?)\s*m\b/gi,
    "$1 hours + $2 minutes",
  );
  // Same idea for `Xd Yh` (days + hours) and `Xm Ys` (minutes + seconds).
  r = r.replace(
    /(\d+(?:\.\d+)?)\s*d\s+(\d+(?:\.\d+)?)\s*h\b/gi,
    "$1 days + $2 hours",
  );
  r = r.replace(
    /(\d+(?:\.\d+)?)\s*min\s+(\d+(?:\.\d+)?)\s*s\b/gi,
    "$1 minutes + $2 seconds",
  );

  // Symbol expansions ($50 → 50 USD, €10 → 10 EUR, etc.).
  r = expandSymbols(r);

  // X% of Y → ((X)/100) * (Y)
  r = r.replace(/(\d+(?:\.\d+)?)\s*%\s+of\b/gi, "(($1)/100) *");

  // X% off Y → (Y) * (1 - X/100)
  r = r.replace(
    /(\d+(?:\.\d+)?)\s*%\s+off\s+(.+)$/i,
    "($2) * (1 - ($1)/100)",
  );

  // X% on Y → (Y) * (1 + X/100)
  r = r.replace(
    /(\d+(?:\.\d+)?)\s*%\s+on\s+(.+)$/i,
    "($2) * (1 + ($1)/100)",
  );

  // Trailing `+ X%` and `- X%`. Apply rightmost match only — nested
  // percentages would need a real parser, which we intentionally don't
  // ship.
  r = applyTrailingPercent(r);

  return r;
}

const SYMBOL_TO_CODE: Array<[RegExp, string]> = [
  [/\$\s*(?=\d)/g, "USD "],
  [/€\s*(?=\d)/g, "EUR "],
  [/£\s*(?=\d)/g, "GBP "],
  [/¥\s*(?=\d)/g, "JPY "],
  // Postfix: `5kr` → `5 SEK`. `kr` only matches when not preceded by a
  // letter so we don't munge identifiers like `parker`.
  [/(\d)\s*kr\b/g, "$1 SEK"],
];

function expandSymbols(line: string): string {
  // Symbol prefixes: convert `$50` → `50 USD` so mathjs sees the unit
  // suffix it understands. We can't use `$` as an alias on mathjs because
  // `$` is fiddly in expression parsing.
  let r = line;
  // First handle `$50 in EUR` style: strip the prefix and add the unit
  // after the number it precedes. We do a two-pass approach: capture
  // prefix-num pairs and rewrite.
  r = r.replace(/(\$|€|£|¥)\s*(\d+(?:\.\d+)?)/g, (_, sym, num) => {
    const code =
      sym === "$" ? "USD" : sym === "€" ? "EUR" : sym === "£" ? "GBP" : "JPY";
    return `${num} ${code}`;
  });
  for (const [re, replacement] of SYMBOL_TO_CODE) {
    // The first three already ran above; this catches any leftover
    // symbol-only patterns and the `kr` postfix.
    r = r.replace(re, replacement);
  }
  return r;
}

function applyTrailingPercent(expr: string): string {
  // Match: anything (lazy), then last + or -, then a numeric percent at
  // the end of the expression.
  const m = /^(.+?)\s*([+\-])\s*(\d+(?:\.\d+)?)\s*%\s*$/.exec(expr);
  if (!m) return expr;
  const [, lhs, op, pct] = m;
  const sign = op === "+" ? "+" : "-";
  return `(${lhs}) * (1 ${sign} (${pct})/100)`;
}

/* ------------------------------------------------------------------ */
/* Result formatting                                                   */
/* ------------------------------------------------------------------ */

function formatResult(value: unknown): string {
  if (value === undefined || value === null) return "";

  // mathjs Unit has a `.toString()` that gives "5 km" or "1000 SEK".
  // For our purposes that's exactly what we want.
  if (isMathUnit(value)) {
    // Trim long mantissas so "84.21052631578947 EUR" becomes "84.21 EUR".
    const s = (value as { toString: () => string }).toString();
    return shortenNumber(s);
  }

  if (typeof value === "number") {
    if (!isFinite(value)) return value > 0 ? "∞" : "-∞";
    return formatNumber(value);
  }

  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";

  // Fallback: mathjs's BigNumber, ResultSet, etc. all have toString.
  if (
    value &&
    typeof (value as { toString?: () => string }).toString === "function"
  ) {
    return shortenNumber((value as { toString: () => string }).toString());
  }
  return String(value);
}

function isMathUnit(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    "type" in v &&
    (v as { type: unknown }).type === "Unit"
  );
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString("en-US");
  // Trim to a sensible precision then localise.
  const trimmed = Number(n.toFixed(6));
  // toLocaleString won't show more than the digits we keep.
  return trimmed.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function shortenNumber(s: string): string {
  // Replace "84.21052631578947 EUR" with "84.21 EUR" without harming
  // integer values like "100 USD".
  return s.replace(/(\d+\.\d{2})\d{3,}/g, "$1");
}
