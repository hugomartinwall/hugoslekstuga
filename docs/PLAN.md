# hugoslekstuga — execution plan

This plan tackles every finding in `REVIEW.md`. It is structured to be executed across three iteration cycles ("Now / Next / Later") and is **self-contained**: a fresh Claude session should be able to pick this up cold and execute. Read `REVIEW.md` first if you want the *why*; this file is the *what + how*.

---

## 0. Working context (read once, then begin)

**The project.** A personal "playhouse" of single-purpose, browser-only tools at `~/Projects/hugoslekstuga`. Stack: Next.js 16 (Turbopack) + React 19 + Tailwind v4 + TypeScript. One non-static surface: `server/munch/` — a WebSocket multiplayer game the rest of the site does not depend on.

**Four principles** (from `app/about/page.tsx`):
1. One thing, well — if a tool grows, it splits.
2. Your device, your data — no uploads, no accounts, no analytics.
3. Open a tab, use it, close it.
4. A bit of personality.

**Catalogue (current).** 43 tools at `app/tools/<slug>/page.tsx` + 1 game at `app/games/munch/page.tsx`. Source of truth: `lib/tools.ts` (registry), `lib/clusters.ts` (cluster id per slug), `lib/links.ts` (graph edges).

**Identity tokens** (`app/globals.css`):
- cream `#fbf6ee`, ink `#1a1812`
- Eight accents: tomato `#ff5a3c`, blue `#4f66f2`, yellow `#ffc233`, pink `#ff7ab2`, green `#3fa66e`, purple `#9333ea`, orange `#f97316`, teal `#0d9488`
- Each accent has a `-soft` variant
- Bricolage Grotesque (display) + Geist (sans)
- `card-chunk` and `btn-chunk` shadow language

**The crucial colour rule**: yellow and pink need ink text on top; the other six accents take cream. This rule is currently encoded by hand in 4+ places and must be folded into one helper.

**Ground rules for any change in this plan:**
- Zero ESLint warnings + zero TypeScript errors after each chapter.
- `rm -rf .next && npm run build` must pass clean (Next caches stale routes between rebuilds).
- Privacy promise must stay intact at runtime. Re-run the audit at end of each chapter:
  ```sh
  rg -n 'fetch\(|gtag|analytics|googletagmanager|cdn\.|XMLHttpRequest' \
    --glob '!node_modules' --glob '!.next' --glob '!public/vendor' app components lib server
  ```
  Should match only `app/tools/strip/page.tsx:154` (re-reading a local blob URL).
- Don't rename slugs. URL stability matters more than copy stability. Title and tagline can change; the URL the user bookmarks cannot.
- Don't add new tools to `lib/tools.ts` outside of explicit "Add" steps in this plan.
- Don't touch the four principles' copy — they're load-bearing.
- Don't add analytics, auth, third-party scripts, or live network calls at runtime. The pdfjs worker is vendored at `/public/vendor/pdf.worker.min.mjs` for this reason.

**Run scripts:**
- `npm run dev` — Next dev on http://localhost:3000
- `npm run munch` — WebSocket server on ws://localhost:8080 (runs separately; only needed for `/games/munch`)
- `npm run lint`, `npm run build`

**Both servers are kept stopped between sessions.** Start them when the user asks to test; stop them on `/compact` or session end. Use `lsof -i :3000 -t | xargs kill` and the same for `:8080` to clear ports.

---

## Chapter 1 — Now: promise drift + truth duplication

**Theme.** The site has gradually accumulated *encoded copies* of the catalogue (tool list, theme count, colour mappings) in places other than `lib/tools.ts` + `lib/clusters.ts`. The OG image is stale, About lies about the server count, and the same colour-to-class map is hand-rolled in six files. Fix all of it in one chapter — the dependencies pull through.

**Estimated size.** One sitting (~3–4 hours). Two PRs.

### 1.1 Create `lib/colors.ts` — single source of truth

**File to create:** `/Users/hugomartinwall/Projects/hugoslekstuga/lib/colors.ts`

**Required exports:**

```ts
import type { ToolColor } from "./tools";

/** Raw hex codes. Mirrors the @theme tokens in app/globals.css. */
export const COLOR_HEX: Record<ToolColor, string> = {
  tomato: "#ff5a3c",
  blue:   "#4f66f2",
  yellow: "#ffc233",
  pink:   "#ff7ab2",
  green:  "#3fa66e",
  purple: "#9333ea",
  orange: "#f97316",
  teal:   "#0d9488",
};

export const COLOR_HEX_SOFT: Record<ToolColor, string> = {
  tomato: "#ffd5cc",
  blue:   "#d6dcfc",
  yellow: "#ffeec2",
  pink:   "#ffd6e7",
  green:  "#cce8d8",
  purple: "#ead8fc",
  orange: "#fed7aa",
  teal:   "#b8f0e7",
};

/** Yellow and pink want ink text on them; the other six want cream. */
const NEEDS_INK = new Set<ToolColor>(["yellow", "pink"]);

export function preferredTextHex(c: ToolColor): "#1a1812" | "#fbf6ee" {
  return NEEDS_INK.has(c) ? "#1a1812" : "#fbf6ee";
}

export function preferredTextClass(c: ToolColor): "text-ink" | "text-cream" {
  return NEEDS_INK.has(c) ? "text-ink" : "text-cream";
}

/** Tailwind class helpers. Tailwind needs the literal class strings to be
 *  visible at build time, so each branch returns a string literal — not
 *  template-interpolated — to keep the JIT scanner happy. */
export function bgClass(c: ToolColor): string {
  return ({
    tomato: "bg-tomato",   blue: "bg-blue",     yellow: "bg-yellow",
    pink:   "bg-pink",     green: "bg-green",   purple: "bg-purple",
    orange: "bg-orange",   teal:  "bg-teal",
  } satisfies Record<ToolColor, string>)[c];
}

export function bgSoftClass(c: ToolColor): string {
  return ({
    tomato: "bg-tomato-soft",   blue: "bg-blue-soft",     yellow: "bg-yellow-soft",
    pink:   "bg-pink-soft",     green: "bg-green-soft",   purple: "bg-purple-soft",
    orange: "bg-orange-soft",   teal:  "bg-teal-soft",
  } satisfies Record<ToolColor, string>)[c];
}

export function textClass(c: ToolColor): string {
  return ({
    tomato: "text-tomato",   blue: "text-blue",     yellow: "text-yellow",
    pink:   "text-pink",     green: "text-green",   purple: "text-purple",
    orange: "text-orange",   teal:  "text-teal",
  } satisfies Record<ToolColor, string>)[c];
}

export function ringClass(c: ToolColor): string {
  return ({
    tomato: "ring-tomato",   blue: "ring-blue",     yellow: "ring-yellow",
    pink:   "ring-pink",     green: "ring-green",   purple: "ring-purple",
    orange: "ring-orange",   teal:  "ring-teal",
  } satisfies Record<ToolColor, string>)[c];
}

/** Convenience: full-fill button (bg + text on top). */
export function fillClasses(c: ToolColor): string {
  return `${bgClass(c)} ${preferredTextClass(c)}`;
}
```

Why the `satisfies Record<...>` shape rather than a single big record literal: future-you might wire only one helper into a component. Keeping the helpers separate lets the unused tables tree-shake.

**Done when:** `npx tsc --noEmit` passes with the new file in place and nothing imports it yet (the migration happens in 1.2).

### 1.2 Migrate every consumer to `lib/colors.ts`

**Order — small files first, so any breakage is local before you touch the big ones:**

1. **`app/not-found.tsx`** — replace `TOOL_COLOR_HEX` (line 6) with `COLOR_HEX`. Replace the inline ternary at line 80–83 with `preferredTextHex(t.color)`. Replace the hard-coded "5 themes" wording (the cluster-strip section, around line 105) — see step 1.3 for the exact line.

2. **`components/ToolCard.tsx`** — delete the local `colorBg` / `colorAccent` records (lines 5–25). Use `bgSoftClass(tool.color)` for the card surface, `bgClass(tool.color)` for the emoji ball.

3. **`components/ToolFrame.tsx`** — same as `ToolCard`. Delete lines 5–25; use `bgSoftClass(tool.color)` and `bgClass(tool.color)`.

4. **`components/Search.tsx`** — delete `accentSoft` / `accentBg` records (lines 90–109). The active-row needs `bgSoftClass`; the emoji ball needs `bgClass` + `preferredTextClass`. Replace the inline ternary at line 225–228 with `preferredTextClass(t.color)`.

5. **`app/tools/feeling/page.tsx`** — delete `softBg`, `accentBg`, `numberBg` records (lines 9–40). Three migration sites:
   - Picker buttons (line 77): `bgSoftClass(f.color)` plus the hover variant. Tailwind hover variants don't tree-shake from helpers, so this one needs a one-off composition: ``${bgSoftClass(f.color)} hover:${bgClass(f.color)}``. **Test the hover** — Tailwind JIT may not see the `hover:bg-X` literal. If it doesn't, fall back to a `softBgWithHover(c)` helper that returns the literal pair.
   - Tip card background (line 118–121): `bgSoftClass(feeling.color)`. Drop the `style={{ background: var(--color-...) }}` workaround — it was only there because the hover-soft string `${accentBg[feeling.color] + "/10"}` was wrong.
   - Numbered chip (line 140): `${bgClass(feeling.color)} ${preferredTextClass(feeling.color)}`.

6. **`components/ToolMap.tsx`** — delete `COLOR_HEX` (lines 22–31) and `COLOR_TEXT` (lines 33–42). Import from `lib/colors.ts`. Replace the legend ternary at line 756 (`id === "time" || id === "creative" ? "#1a1812" : "#fbf6ee"`) with the cluster colour's preferred text. **Note:** this ternary is a *cluster*-color decision (yellow for time, pink for creative), not a tool-color one. Solve it by adding to `lib/clusters.ts`:

   ```ts
   import { preferredTextHex } from "./colors";
   export function preferredTextOnCluster(id: ClusterId): "#1a1812" | "#fbf6ee" {
     // Time = yellow, Creative = pink → ink. Others → cream.
     return id === "time" || id === "creative" ? "#1a1812" : "#fbf6ee";
   }
   ```

   The cluster mapping is enumerated by hand in `CLUSTERS`; a third helper isn't needed unless we ever want to derive cluster colour from a token name.

7. **`lib/tools.ts`** — delete the `colorClasses` export (lines 479–531). Anyone who needed it now uses the helpers directly.

**Done when:**
- `rg -n 'colorBg|colorAccent|accentSoft|accentBg|numberBg|softBg|TOOL_COLOR_HEX|COLOR_HEX|COLOR_TEXT|colorClasses' --glob '!node_modules' --glob '!.next' app components lib` returns only `lib/colors.ts` definitions and `components/ToolMap.tsx` imports.
- All tool pages render with their existing colours unchanged.
- The Tailwind JIT output still includes every `bg-{color}`, `bg-{color}-soft`, `text-cream`, `text-ink` class. (Quick check: load Search palette — yellow/pink emoji balls should still have ink text.)
- Lint + typecheck + build all clean.

### 1.3 Fix `app/about/page.tsx`'s stale literals + broken Munch link

**File:** `/Users/hugomartinwall/Projects/hugoslekstuga/app/about/page.tsx`

Three changes:

**(a) Themes count.** Line 53:
```diff
-        <Stat value="5" label="themes" accent="bg-pink" />
+        <Stat value={String(CLUSTER_ORDER.length)} label="themes" accent="bg-pink" />
```

**(b) Servers count + tone.** Line 54 currently says `<Stat value="0" label="servers" accent="bg-blue" />`. This is now false — Munch has a server. Replace with:
```tsx
<Stat value="1" label="server (munch)" accent="bg-blue" />
```
(`1` is honest. The Stat label is small enough that "(munch)" reads as parenthetical, not crowded.) Future-proof: if a second server-backed tool ever ships, change to a count derived from `tools.filter(t => /* needs-server flag */)`. We don't need that today.

Update the closing block at lines 138–146 ("The site itself runs as a single static page bundle. There's no database, no telemetry, no third-party scripts.") so it stays honest. Suggested rewrite — final paragraph only, keeping voice:

```tsx
<p className="mt-3 text-sm text-ink-soft">
  Almost everything runs as a static page bundle. The one exception is{" "}
  <Link href="/games/munch" className="font-bold underline">Munch</Link>
  , which connects to a tiny WebSocket server so other players can see
  your blob. No database, no telemetry, no third-party scripts.
</p>
```

**(c) Broken Munch link in the cluster grid.** Line 93:
```diff
-                      <Link
-                        href={`/tools/${t.slug}`}
+                      <Link
+                        href={pathFor(t.slug)}
```

Add `pathFor` to the imports at line 4:
```diff
-import { CLUSTER_ORDER, CLUSTERS, TOOL_CLUSTER } from "@/lib/clusters";
+import { CLUSTER_ORDER, CLUSTERS, TOOL_CLUSTER, pathFor } from "@/lib/clusters";
```

**Done when:** `/about` loads, shows `7 themes` and `1 server (munch)`, the closing paragraph reads as above, and the Munch chip in the Games cluster card navigates to `/games/munch` instead of 404ing.

### 1.4 Fix `app/not-found.tsx`'s "5 themes" + dual purpose

**File:** `/Users/hugomartinwall/Projects/hugoslekstuga/app/not-found.tsx`

Already covered the colour-map cleanup in 1.2 step 1. Remaining: the literal "5 themes" in the closing dashed-border section (line ~106 currently, `<p>The 5 themes:</p>`). Replace with:

```tsx
<p>
  The {CLUSTER_ORDER.length} themes:{" "}
  {CLUSTER_ORDER.map((id, i) => { /* unchanged */ })}
</p>
```

**Done when:** 404 page shows `The 7 themes:`.

### 1.5 Rewire `app/opengraph-image.tsx` to derive from `lib/tools.ts`

**File:** `/Users/hugomartinwall/Projects/hugoslekstuga/app/opengraph-image.tsx`

The current implementation hard-codes 40 `{ c, t }` tile entries (lines 100–146). Missing tools: `sum`, `sift`, `shot`, `munch`. Plus it includes some old slugs that are now removed. The fix is to derive the tile array.

Replace the inline array with:

```ts
import { tools } from "@/lib/tools";
import { COLOR_HEX, preferredTextHex } from "@/lib/colors";
// (...existing imports...)

// Inside the JSX, where the inline array used to be:
{tools.map((t) => (
  <div
    key={t.slug}
    style={{
      display: "flex",
      alignItems: "center",
      padding: "8px 18px",
      background: COLOR_HEX[t.color],
      border: "3px solid #1a1812",
      borderRadius: "9999px",
      fontSize: "22px",
      fontWeight: 800,
      color: preferredTextHex(t.color),
    }}
  >
    {t.slug}
  </div>
))}
```

Two small care points:

- **OG image bundle does not run client code.** It's a server-rendered Edge image. `lib/tools.ts` and `lib/colors.ts` must remain free of any browser-only imports — they currently are (no `window`, no `localStorage`). Confirm with: `rg -n 'window\\.|document\\.|localStorage' lib/tools.ts lib/colors.ts` — should be empty.
- **44 chips at 22px font may overflow** the bottom of the 1200×630 frame. The flex-wrap container should handle it, but render the image (`/opengraph-image.png` — Next renders this on demand) and inspect. If chips overflow, knock the font from 22 → 18 and the padding from 8/18 to 6/14.

**Done when:**
- `app/opengraph-image.tsx` no longer contains any inline `{ c, t }` tiles.
- Visiting http://localhost:3000/opengraph-image.png renders a card containing every current tool slug, in colour, no overflow.
- Removing or adding a tool to `lib/tools.ts` next time updates the OG image without manual editing.

### 1.6 Munch error tone — gate dev-only suffix

**File:** `/Users/hugomartinwall/Projects/hugoslekstuga/app/games/munch/page.tsx`

Line 224 currently:
```ts
setError("Couldn't reach the server. Is it running?");
```

In production, "Is it running?" reads as a malfunction the user is meant to fix. Gate it:
```ts
const inDev = process.env.NODE_ENV === "development";
setError(
  inDev
    ? "Couldn't reach the server. Is it running?"
    : "Couldn't reach the server. Try again in a minute."
);
```

`process.env.NODE_ENV` is statically replaced at build time by Next, so this branches at compile time and tree-shakes the unused branch.

**Done when:** development mode still shows the dev hint; a production build (`npm run build` followed by `npm start`) shows the friendlier message.

### 1.7 Render or remove the iPhone bezel in `shot`

**File:** `/Users/hugomartinwall/Projects/hugoslekstuga/app/tools/shot/page.tsx`

The `FRAMES` array at `lib/shot/presets.ts:82` lists `iphone` but `FramedContent` (line 542) only renders chrome for `macos` and `browser`. Picking iPhone in the UI today produces a frameless rounded box.

**Recommendation: render it.** It's a small win. The iPhone bezel is a roughly 20px-wide rounded outer frame with a notch. Implementation sketch (inside `FramedContent`, below the `frame === "macos"` and `frame === "browser"` cases):

```tsx
{frame === "iphone" && (
  <div
    style={{
      padding: "20px 16px 28px",
      background: "#1a1812",
      borderRadius: `${radius + 18}px`,
    }}
  >
    {/* Notch */}
    <div
      style={{
        margin: "0 auto 10px",
        width: "32%",
        height: "16px",
        background: "#1a1812",
        borderRadius: "0 0 14px 14px",
      }}
    />
    <div style={{ borderRadius: `${radius}px`, overflow: "hidden", background: themeBg }}>
      {children}
    </div>
  </div>
)}
```

This nests the existing inner content inside a phone-shaped wrapper. Quick visual test: pick iPhone with a code snippet inside; the snippet should sit inside a black bezel with a notch on top.

**Fallback (simpler, ~30% as good):** remove `iphone` from `FRAMES` entirely. Acceptable but admits defeat on a feature already promised in the description ("iPhone bezel" is in the tool description in `lib/tools.ts:457`).

**Done when:** the iPhone option in Shot's frame picker actually renders an iPhone-shaped bezel; the export PNG includes the bezel.

### 1.8 Rewrite README.md

**File:** `/Users/hugomartinwall/Projects/hugoslekstuga/README.md`

Currently it's the create-next-app default. Replace with something honest and short. Suggested content (~50 lines max — README, not marketing):

```md
# hugoslekstuga

A small playhouse of useful, friendly browser tools.

Each tool tries to do one thing well, without asking anything of you. No accounts. No uploads. No analytics.

Live at https://hugoslekstuga.se

## Run locally

```sh
npm install
npm run dev          # Next dev on :3000
npm run munch        # WebSocket server for the multiplayer game on :8080
```

`munch` only needs to run if you want to play the game at /games/munch. Everything else works without it.

## Stack

- Next.js 16 + React 19 + Tailwind v4 + TypeScript
- 43 single-purpose tools at `app/tools/<slug>/page.tsx`
- One real-time multiplayer game at `app/games/munch/page.tsx` + `server/munch/`
- Source of truth for the catalogue: `lib/tools.ts`, `lib/clusters.ts`, `lib/links.ts`

## Principles

1. **One thing, well.** If a tool grows, it splits.
2. **Your device, your data.** No uploads, no accounts, no analytics.
3. **Open a tab, use it, close it.** No onboarding, no settings.
4. **A bit of personality.** Bold colours, chunky shadows, a small wink.

The one exception to (2) is Munch, which connects to a small WebSocket server so other players can see your blob.

## Contributing

This is a personal project. The bar for adding a tool is "(a) it beats the alternatives, (b) it's genuinely useful, (c) it feels cool." Most pitches don't clear it; that's the point.
```

**Done when:** `cat README.md` shows the new content; no remnants of `create-next-app` boilerplate; the four principles are quoted accurately.

### 1.9 Footer — kill the "no servers" claim

**File:** `/Users/hugomartinwall/Projects/hugoslekstuga/components/Footer.tsx`

Line 32 currently:
```tsx
<p className="text-sm text-ink-soft">uploads · no servers</p>
```

Change to:
```tsx
<p className="text-sm text-ink-soft">uploads · no analytics</p>
```

We *do* have a server (munch). We don't have analytics. Fix the lie.

**Done when:** footer reads "no tracking · no accounts" and "no uploads · no analytics".

### 1.10 Verification protocol for Chapter 1

Run these in order. None should produce output beyond the listed expectations.

```sh
# 1. Truth-duplication grep — should be empty.
rg -n 'colorBg|colorAccent|accentSoft|accentBg|numberBg|softBg|TOOL_COLOR_HEX|colorClasses' \
  --glob '!node_modules' --glob '!.next' app components

# 2. Dead literal grep — should be empty.
rg -n 'value="5" label="themes"|value="0" label="servers"|"5 themes"' --glob '!node_modules'

# 3. OG image staleness check — should be empty (no inline tiles).
rg -n '\\{ c: "#' app/opengraph-image.tsx

# 4. Privacy audit — should match only strip/page.tsx:154.
rg -n 'fetch\\(|gtag|analytics|googletagmanager|cdn\\.|XMLHttpRequest' \
  --glob '!node_modules' --glob '!.next' --glob '!public/vendor' app components lib server

# 5. Lint + typecheck.
npm run lint
npx tsc --noEmit

# 6. Production build (clears stale Next cache).
rm -rf .next && npm run build
```

**Smoke checks (manual):**
- Visit `/` — map paints; legend shows seven clusters; cluster-filter buttons toggle correctly.
- Visit `/about` — shows "7 themes", "1 server (munch)", honest closing paragraph; click the Munch chip in Games cluster → lands on `/games/munch`, not 404.
- Visit `/blip-that-does-not-exist` (anything 404-ing) — shows "The 7 themes:" footer.
- Visit `/opengraph-image.png` — wraps every current slug in a chip, in colour, no overflow.
- Visit each "soft-bg + emoji-ball" surface (any tool page) — colours unchanged from before the refactor.

Commit suggested as a single commit titled something like `chore: consolidate truth duplication; honest about/footer`.

---

## Chapter 2 — Next: honesty + reach

**Theme.** Once Chapter 1 lands, the codebase is clean of stale literals. Chapter 2 closes the remaining gaps — accessibility, SEO, the privacy-promise page, persistent state, small visual fixes.

**Estimated size.** Two sittings. Two-three PRs.

### 2.1 Honour `prefers-reduced-motion` for named keyframes

**File:** `/Users/hugomartinwall/Projects/hugoslekstuga/app/globals.css`

Append at the bottom:

```css
@media (prefers-reduced-motion: reduce) {
  .fade-rise,
  .featured-in,
  .pulse-dot {
    animation: none !important;
  }
  .btn-chunk,
  .card-chunk {
    transition: none !important;
  }
}
```

**Done when:** with macOS "Reduce Motion" enabled in System Settings → Accessibility → Display, no fade-rise / pulse-dot / featured-in animations play. The map's wobble is already gated by `reduceMotionRef` in `ToolMap.tsx:201–209`, so this rule completes the coverage.

### 2.2 Per-tool metadata exports

**The challenge.** Every `app/tools/<slug>/page.tsx` starts with `"use client"` because it uses hooks. Client components cannot export `metadata`. Solution: split each page into a server-component wrapper that exports `metadata` and a client-component that does the work.

**Pattern.** For each tool slug:

1. Rename the existing `app/tools/<slug>/page.tsx` to `app/tools/<slug>/Client.tsx`.
2. Strip the file extension wrapper around the client component but keep all its content. Add `export default` if not already.
3. Create a new `app/tools/<slug>/page.tsx`:
   ```tsx
   import type { Metadata } from "next";
   import { findTool } from "@/lib/tools";
   import Client from "./Client";

   const tool = findTool("<slug>")!;
   export const metadata: Metadata = {
     title: tool.title,
     description: tool.description,
   };

   export default function Page() {
     return <Client />;
   }
   ```

**Mechanical, ~44 files.** A script can do it; review by eye before committing.

**Done when:**
- Every tool page returns its own title + description in `<head>`.
- `view-source:http://localhost:3000/tools/squeeze` shows `<title>Squeeze — hugoslekstuga</title>` (the title template in `app/layout.tsx:21` adds the suffix).
- Same pattern applies to `app/games/munch/page.tsx`.

**Risk to watch:** the client component imports were assumed to start at the page module boundary. If any tool's page imported something only when running on the server, this split would break. None of them do today (every tool is `"use client"` already), so this is mechanical.

### 2.3 The `/promise` page

**File to create:** `/Users/hugomartinwall/Projects/hugoslekstuga/app/promise/page.tsx`

This is the single-page honest disclosure. Three sections, the playhouse voice, no marketing puff.

```tsx
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Promise",
  description: "What hugoslekstuga does and doesn't do with your data.",
};

export default function PromisePage() {
  return (
    <article className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
      <header className="flex flex-col gap-4">
        <span className="inline-flex w-fit items-center gap-2 rounded-full border-2 border-ink bg-yellow px-3 py-1 text-xs font-bold uppercase tracking-wide">
          The promise
        </span>
        <h1 className="font-display text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl">
          What we do, and don&rsquo;t, with your data.
        </h1>
      </header>

      <Section title="The 43 tools">
        <p>
          Files, text, images, code — everything you drop into the toolbox is
          read, processed, and rendered by JavaScript running on this device.
          Nothing gets uploaded. The downloads come from your own browser.
        </p>
        <p>
          Tools persist your in-progress work to <code>localStorage</code>{" "}
          when it makes sense (a session in Sum, a tally count, a sketch
          would be nice — that one isn&rsquo;t persisted yet). Storage keys
          are namespaced <code>hugoslekstuga:*</code> and stay on this device.
          Clearing your site data wipes them.
        </p>
      </Section>

      <Section title="Munch">
        <p>
          Munch is the one tool that needs a server. It&rsquo;s a real-time
          multiplayer game; for other players to see your blob, your name and
          your moves have to be sent somewhere. That somewhere is a small
          Node process running in {/* TODO: Stockholm region */} eu-north.
        </p>
        <p>
          The server keeps no logs, no database, no third-party connections.
          When the last player disconnects, it idles. We don&rsquo;t track
          who plays. The room is shared globally; the only persistent state
          is what&rsquo;s currently on screen.
        </p>
      </Section>

      <Section title="Fonts and assets">
        <p>
          Geist and Bricolage Grotesque are downloaded from Google Fonts at{" "}
          <em>build time</em> and bundled with the site. After your page
          loads, no requests go to Google. The pdf.js worker that powers the
          PDF tool is vendored at <code>/vendor/pdf.worker.min.mjs</code>{" "}
          for the same reason.
        </p>
      </Section>

      <Section title="What we&rsquo;d need to add to break this">
        <p>
          Analytics. Ad networks. Live currency rates. A cloud sync. A
          login. None of those are here, and none of them are coming. If a
          feature can&rsquo;t be built without one of them, we don&rsquo;t
          ship the feature.
        </p>
      </Section>

      <div className="mt-12">
        <Link
          href="/"
          className="btn-chunk rounded-[var(--radius-button)] bg-tomato px-5 py-2 font-display text-sm font-extrabold text-cream"
        >
          Back to the tools
        </Link>
      </div>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12 flex flex-col gap-3">
      <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
        {title}
      </h2>
      <div className="flex flex-col gap-3 text-base leading-relaxed text-ink-soft sm:text-lg">
        {children}
      </div>
    </section>
  );
}
```

Wire from the footer at `components/Footer.tsx` — replace the text "uploads · no analytics" (after the 1.9 fix) with a Link version, or add a third `<p>` linking to `/promise` directly. Suggested: add a small "Read the full promise →" link below the bullet list.

**Done when:** `/promise` loads, four honest sections, footer links to it.

### 2.4 Persist `sketch` strokes

**File:** `/Users/hugomartinwall/Projects/hugoslekstuga/app/tools/sketch/page.tsx`

Currently the canvas wipes on refresh because `strokes` is in `useState`. Persist using the existing hook:

```ts
const [strokes, setStrokes] = useLocalStorageState<Stroke[]>(
  "hugoslekstuga:sketch:strokes",
  [],
);
```

**Watch out for two things:**
1. The default `[]` value must be referentially stable (per the hook's docstring). Define it at module scope:
   ```ts
   const SKETCH_DEFAULT: Stroke[] = [];
   // ... and use SKETCH_DEFAULT in the hook call.
   ```
2. Strokes can grow unbounded. After a 30-minute scribble session this is megabytes. Cap at a reasonable size — when stroking up to a new value, if the resulting JSON would be over ~1 MB, drop the oldest. A simple rule: cap at 500 strokes; older drops off the front. Add a small UI hint ("oldest strokes drop after 500") in the empty state.

**Done when:** draw something, refresh the page, the drawing reappears. Clear button still works.

### 2.5 Accessibility micro-fixes

**(a) `regex/page.tsx`** — lines 175, 184. Drop `focus:outline-none` from the pattern, flags, and text inputs (or replace with `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue` if you want a softer look). The global `:focus-visible` rule will then take over.

**(b) `sift/page.tsx`** — line 391 (global search) and lines 668, 256 (filter row, paste textarea) — same fix.

**(c) `ToolMap.tsx`** — cluster legend buttons at line 746 need `aria-pressed`:
```diff
 <button
   key={id}
   type="button"
+  aria-pressed={active}
   onClick={() =>
     setActiveCluster((cur) => (cur === id ? null : id))
   }
```

**Done when:** Tab-cycling through any of the listed inputs shows the blue focus ring; screen readers announce the cluster legend buttons' pressed state.

### 2.6 `app/sitemap.ts`

**File to create:** `/Users/hugomartinwall/Projects/hugoslekstuga/app/sitemap.ts`

Next 16 supports a sitemap as a route. Derive from the catalogue:

```ts
import type { MetadataRoute } from "next";
import { tools } from "@/lib/tools";
import { pathFor } from "@/lib/clusters";

const BASE = "https://hugoslekstuga.se";
const NOW = new Date();

export default function sitemap(): MetadataRoute.Sitemap {
  const roots: MetadataRoute.Sitemap = [
    { url: `${BASE}/`,        lastModified: NOW, changeFrequency: "weekly",  priority: 1.0 },
    { url: `${BASE}/about`,   lastModified: NOW, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/promise`, lastModified: NOW, changeFrequency: "yearly",  priority: 0.5 },
  ];
  const toolRoutes = tools.map((t) => ({
    url: `${BASE}${pathFor(t.slug)}`,
    lastModified: NOW,
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));
  return [...roots, ...toolRoutes];
}
```

**Also create** `app/robots.ts` for symmetry:

```ts
import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: "https://hugoslekstuga.se/sitemap.xml",
  };
}
```

**Done when:** `/sitemap.xml` and `/robots.txt` both render at the dev URL.

### 2.7 Cluster button keyboard discoverability

**File:** `components/HomeShell.tsx`

The pink ⥁ ball at line 70 has `aria-label="Re-cluster the map"` and `title="Shake the map"`. Some users won't hover. Add a small caption below the legend at the bottom of the page (`ToolMap.tsx:741`) on first visit only — gated by a localStorage flag.

This is small enough to defer to Chapter 3 if Chapter 2 is getting long. Skip if you're rushing.

### 2.8 Verification protocol for Chapter 2

```sh
# Per-tool metadata — should match exactly 44.
rg -l 'export const metadata' app/tools app/games | wc -l   # expect 44

# Sitemap derives.
curl -s http://localhost:3000/sitemap.xml | grep -c '<url>'   # expect 47 (3 roots + 44 tools)

# Reduced motion CSS rule present.
rg -n 'prefers-reduced-motion' app/globals.css

# Promise page exists.
curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/promise   # expect 200

# Sketch persists — manual: draw, refresh, drawing returns.
```

---

## Chapter 3 — Later: extractions and one new tool

**Theme.** With the catalogue honest and the surfaces clean, this is the housekeeping pass. Lower urgency, higher style payoff. Each item is independently shippable.

### 3.1 Extract `<DropZone>` component

**Files affected:** `convert`, `squeeze`, `pdf` (×2), `strip`, `trace`, `ascii`, `base64`, `favicon`, `sift`, `shot`. Eight to ten near-identical drop zones.

**Target API:**

```tsx
// components/DropZone.tsx
type DropZoneProps = {
  color: ToolColor;
  acceptMime?: string;       // optional MIME filter for the file input
  acceptExt?: string[];      // optional extension filter for the drop event
  onFile: (file: File) => void;
  primary: string;           // big text, e.g. "Drop a CSV"
  secondary?: string;        // small text under the button, e.g. "stays in your browser"
  buttonLabel?: string;      // default "Choose a file"
  /** Render extra controls below the button (e.g. "paste instead"). */
  extra?: React.ReactNode;
};
```

Re-using `bgClass`, `bgSoftClass`, `preferredTextClass` from `lib/colors.ts`. Replace each tool's hand-rolled drop zone with `<DropZone {...} />`.

**Watch:** some drop zones have multi-file logic (PDF merge accepts many files at once). The component should support `multiple={true}` and forward an array.

**Done when:**
- `wc -l components/DropZone.tsx` shows ~80 lines.
- Each migrated tool's drop zone visually identical to before.
- `rg -n 'card-chunk flex.*items-center.*p-(8|10).*text-center' app/tools` returns no matches (the old pattern).

### 3.2 Extract `<Slider>` component

Used by: `trace`, `ascii`, `easing`, `shadow`, `noise`, `shot`, `until` (slider for cycle count? actually no, `sleep` has the fall-asleep slider). Similar shape, varying colour and unit suffix.

```tsx
// components/Slider.tsx
type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  hint?: string;
  unit?: string;
  accentColor: ToolColor;
};
```

The `accent-{color}` Tailwind class on the native range input controls the thumb colour; pull from `bgClass` family. Note Tailwind doesn't ship `accent-{color}` utilities by default, so this might need an inline `style={{ accentColor: COLOR_HEX[c] }}` instead.

### 3.3 Extract `<CustomMinutes>` from focus + talk

`app/tools/focus/page.tsx:227` and `app/tools/talk/page.tsx:189` are duplicate components. Extract to `components/CustomMinutes.tsx` and import from both.

### 3.4 Dedup helpers

Three duplications worth folding:
- `formatBytes` — defined in `convert/page.tsx:374`, `squeeze/page.tsx:493`, `pdf/page.tsx:496`. Extract to `lib/format.ts`.
- `localISODate` — in `stretch/page.tsx:210`, `three/page.tsx:362`, `until/page.tsx:225`. Extract to `lib/dates.ts`.
- `clamp` — used in `ToolMap.tsx:907`, `sleep/page.tsx:578`, `munch/page.tsx:914`. Extract to `lib/math.ts`.

Each is a one-liner at most; the extraction is mechanical.

### 3.5 Merge `picker` into `roll`

Both pull a random item from a typed list. The wheel is more visual; the picker has a "remove and pick next" mode that the wheel doesn't. **Plan:**

1. Add a "without replacement" toggle to `roll/page.tsx` — when on, the winning slice is dimmed/struck-out and excluded from the next spin until reset.
2. Add a "Removed (N)" pill that shows on the page when there are excluded options, with a "put everyone back" action.
3. Delete `app/tools/picker/page.tsx`.
4. Remove `picker` from `lib/tools.ts`, `lib/clusters.ts`, `lib/links.ts`.
5. Add a 301 redirect: `next.config.ts` async `redirects()` returning `{ source: '/tools/picker', destination: '/tools/roll', permanent: true }`.

**Done when:** picker URL forwards to roll; roll has the optional without-replacement mode; the registry and link graph are picker-free.

### 3.6 `tsconfig.json` ES2017 → ES2022

Single line change at line 3:
```diff
-    "target": "ES2017",
+    "target": "ES2022",
```

No user-visible value; do it the next time you're already touching the file.

### 3.7 Pick one new tool from the "Add" list (only if you want to)

The five candidates from `REVIEW.md` §4 in priority order:
1. **`crop`** — image cropper with aspect lock. Smallest scope; fills a clear Files-cluster gap (the only image transform missing).
2. **`vibe`** — mood-stamp from text or image. Strongest "playhouse" energy.
3. **`paste`** — universal clipboard router. Most ambitious; touches every other tool.
4. **`palette` extract feature** — siblings palette but inside as a tab; doesn't truly "earn a slot."
5. **`bench`** — code snippet benchmark. Useful for devs.

**Recommendation if shipping one: `crop`.** It's the smallest and the cleanest principle-1 fit.

**`crop` scope:**
- Drop image; show preview with a draggable rectangle overlay
- Aspect ratio lock (free, 1:1, 16:9, 9:16, 4:3, 3:2, 2:3, 3:4)
- Preset crop buttons for "Twitter banner", "OG image", "Square", "Story"
- Output: cropped image as PNG/JPG/WebP, at 1×/2×/3× device pixel ratio
- ~400 lines, similar shape to Squeeze
- Cluster: `files`. Color: pick green (free; greens are well-represented but earned).
- Slug: `crop`.
- Tagline: "Crop a picture, keep the right bit."

Wire links: `crop` ↔ `squeeze`, `crop` ↔ `strip`, `crop` ↔ `shot`, `crop` ↔ `trace`.

### 3.8 Verification protocol for Chapter 3

```sh
# DropZone reuse — should be just one definition.
rg -l 'function DropZone' app components
# expect: only components/DropZone.tsx

# Helpers no longer duplicated.
rg -c 'function formatBytes\\(' app components lib
# expect: 1

# Picker is dead.
ls app/tools/picker 2>/dev/null   # expect: directory does not exist
curl -s -o /dev/null -w '%{http_code}\\n' http://localhost:3000/tools/picker
# expect: 308 (permanent redirect) followed by 200 at /tools/roll
```

---

## Per-tool polish punch-list (touch when you're already in the file)

These are smaller-than-a-chapter improvements I called out tool-by-tool. None block the chapters above. Knock them out opportunistically.

- **`typing`** — corpus is six paragraphs. Add eight more (Hugo's voice, varied register). Same file, `PASSAGES` constant at line 10.
- **`ascii`** — consider a "reset" button (resets density, mode, contrast). Currently no easy way back to defaults.
- **`base64`** — currently image-only. Add a third tab "Text → base64" that handles UTF-8 strings both directions. Modest scope, expands the tool's reach.
- **`case`** — works as-is. If it ever feels filler, fold into `slug` as a "playful" tab and free a slot.
- **`lorem`** — fine. The pirate flavour is the strongest; consider adding a "fairy tale" variant or "haiku" rhythm.
- **`mash`** — fine. The smush mode is the only differentiator; lean into it (more vowel-aware merging).
- **`feeling`** — already iterated. Watch the colour-helper migration in 1.2 for the inline ternary remnants.
- **`sleep`** — already iterated. The `WindDown` text uses curly quotes — make sure the colour migration doesn't rip them.
- **`stretch`** — already iterated.
- **`markdown`** — already iterated.
- **`shot`** — fix the iPhone bezel (1.7). Consider adding a code-language inference from pasted code (e.g., starts with `<` → HTML, contains `def ` → Python). Modest stretch goal.
- **`sum`** — currency rates date is hard-coded as "January 2025". Bump in `lib/sum/evaluate.ts:32` next time rates clearly drift. Don't fetch live — the static snapshot is the privacy story.
- **`squeeze`** — solid. If you ever want batch mode, the architecture supports it.
- **`pdf`** — solid.
- **`strip`** — solid.
- **`trace`** — the `max` detail mode produces SVGs that can be 2+ MB. Add a warning when result is over 500 KB.
- **`favicon`** — solid.
- **`convert`** — error tone. Wrap the raw library messages in a friendlier shell.
- **`sift`** — solid.
- **`tip`** — solid.
- **`tally`** — long counter labels truncate awkwardly in the tab bar; consider a tooltip on hover showing the full name.
- **`focus`** — uses `Notification.requestPermission()` on `start` (line 91). Some browsers consider that intrusive. Move to a one-time gentle ask via a small banner above the timer instead.
- **`talk`** — solid.
- **`until`** — solid.
- **`zones`** — could surface DST transitions on the home zone (rare but useful).
- **`feeling`** — keep growing the catalogue when content quality stays high.

---

## Things NOT to do (guardrails)

These are commitments the site has earned, not arbitrary preferences. Breaking them costs the brand.

1. **Don't add analytics.** No GA, Plausible, Posthog, Sentry, error reporting. Even "privacy-friendly" analytics break the promise. If you genuinely need to debug a production issue, ask the user.
2. **Don't add auth.** No login, no accounts, no "save to cloud", no sync. Every tool's persistent state lives in `localStorage` keyed `hugoslekstuga:*`.
3. **Don't fetch live data at runtime.** Currency rates in Sum are deliberately a static snapshot. Live rates would require a backend or a third-party API; both break principle 2. Same logic applies to anything you'd want to auto-update.
4. **Don't rename slugs.** URL stability is more valuable than copy precision. If a tool's name evolves, change the title and tagline; leave the URL.
5. **Don't add server features.** Munch is the one server-backed tool; resist adding "leaderboard", "saved games", "friends list" — those would creep the server into being a real backend.
6. **Don't pad the README.** Keep it factual and short. The site itself is the marketing.
7. **Don't change the four principles' wording on `/about`.** They're load-bearing for the brand. Add new sections; leave the principles alone.
8. **Don't introduce a CSS framework other than Tailwind.** `card-chunk` and `btn-chunk` plus the colour tokens are the system; resist Radix, shadcn, MUI, etc.
9. **Don't skip the privacy audit grep.** Before any commit that touches network-adjacent code, re-run:
   ```sh
   rg -n 'fetch\\(|gtag|analytics|googletagmanager|cdn\\.|XMLHttpRequest' \
     --glob '!node_modules' --glob '!.next' --glob '!public/vendor' app components lib server
   ```
10. **Don't break Munch's name filter.** `server/munch/index.ts:174–183` lists profanity tokens. The list is intentionally short and unambiguous; expanding it is a moderation problem, not a code problem. If you need a real moderation system, ship one as a separate task — don't bolt it onto the existing list.

---

## Suggested commit cadence

This is one Hugo-style commit cadence — short messages, one concern per commit.

**Chapter 1:**
- `chore: add lib/colors.ts as single colour source`
- `refactor: route all components through lib/colors.ts`
- `fix: about page — themes count, server count, munch link`
- `fix: not-found page — themes count`
- `fix: opengraph image derives from tools registry`
- `fix: munch error tone gate dev-only suffix`
- `feat: shot — render iPhone bezel`
- `docs: rewrite README; honest footer`

**Chapter 2:**
- `feat: prefers-reduced-motion for named keyframes`
- `refactor: per-tool metadata via server-component wrappers`
- `feat: /promise page; footer link`
- `feat: sketch persists strokes`
- `fix: a11y micro-fixes (focus-visible, aria-pressed)`
- `feat: app/sitemap.ts and app/robots.ts`

**Chapter 3:**
- `refactor: extract DropZone, Slider, CustomMinutes`
- `refactor: dedupe formatBytes, localISODate, clamp`
- `feat: roll absorbs picker; redirect old slug`
- `chore: bump tsconfig target to ES2022`
- `feat: crop tool` (if shipping a new one)

---

## When you're done

- All three chapters complete: ~25 commits, no new dependencies, ~400 lines net deletion (consolidations) + ~400 lines net addition (new tool, /promise, per-tool metadata wrappers).
- Site state at the end: 44 tools (or 43 if `picker` was merged) + 1 game; `/about`, `/promise`, `/sitemap.xml`, `/robots.txt` all live; build clean; lint clean; privacy audit clean.
- Then push to GitHub, hook to Vercel, deploy Munch to Fly.io (Stockholm region, auto-stop), buy the domain at a Swedish registrar, attach in Vercel.

The plan is the chapter list. Do them in order.

— end —
