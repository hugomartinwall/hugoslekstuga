# hugoslekstuga — review, May 9 2026

A read-only audit of the live state of the site. No code was changed in this pass; this is the briefing for the next iteration cycle.

## 1. Headline take

The site has earned its tone. Tokens (`app/globals.css`), `ToolFrame`, `useLocalStorageState`, the force-directed Map, and the ⌘K palette are doing real work. Forty-three tools and one game now sit on `lib/tools.ts` and most of them deliver what their tagline promises. The privacy promise survives runtime scrutiny: the only `fetch` in user-facing code is `strip/page.tsx:154` (re-reading a local blob), and `pdf.worker.min.mjs` is vendored on purpose.

What isn't working is **truth duplication**. The tool list, the cluster count, the colour ↔ Tailwind mapping, and the colour ↔ hex mapping are encoded in at least six places (`lib/tools.ts` plus `ToolFrame`, `ToolCard`, `Search`, `ToolMap`, `app/not-found.tsx`). The OG image hard-codes 40 slugs and silently lies about the catalogue (no `sum`, `sift`, `shot`, `munch`). `app/about/page.tsx:54` claims `0 servers` while `/games/munch` connects to one, and its tool grid links every entry as `/tools/${slug}` so the Munch chip 404s.

**Single biggest leverage point right now: derive the catalogue facts from `lib/tools.ts` + `lib/clusters.ts` once, and stop hand-maintaining them in components, the OG image, and the About page.** That same pass fixes the staleness, the privacy drift, the double maintenance, and clears about 250 lines.

## 2. Tool-by-tool inventory

Forty-four entries (43 tools + Munch). Quality grades are A (ship-as-is, distinctive), B (solid, room to sharpen), C (works, but earns its slot only on vibes), D (kill or merge candidate). "Promise kept?" checks tagline-vs-behaviour and the privacy/no-upload rule.

| slug | cluster | quality | promise kept? | one-line verdict | recommended action |
|---|---|---|---|---|---|
| advice | wellness | A | ✓ | The reference for tone — Hugo's voice in 250 lines. | keep |
| feeling | wellness | A | ✓ | Just deepened to 16 feelings × 5–6 tips, advice-voice. | keep |
| three | wellness | A | ✓ | Streak + history + entry shape; Seligman framing earns it. | keep |
| breathe | wellness | A | ✓ | 4 patterns, big calm circle, parasympathetic copy lands. | keep |
| sleep | wellness | A | ✓ | Just iterated: nap mode, custom fall-asleep, wind-down. | keep |
| stretch | wellness | A | ✓ | Just iterated: 4 routines + completion counter. | keep |
| tally | wellness | A | ✓ | Multi-counter, long-press reset, soft click. | keep |
| noise | wellness | A | ✓ | Live-generated white/pink/brown + drone, auto-stop. | keep |
| typing | wellness | B | ✓ | Solid 1-min test; corpus is six paragraphs (could grow). | polish |
| focus | time | A | ✓ | Intention + presets + wake-lock + chime + notification. | keep |
| talk | time | A | ✓ | Milestone chimes, over-by counter — earns its slot. | keep |
| until | time | A | ✓ | Multi-event countdown, sorts past at the bottom. | keep |
| zones | time | A | ✓ | Working-hours tone, draggable order, real daily utility. | keep |
| convert | files | A | ✓ | Five families, all in-browser, falls back gracefully. | keep |
| pdf | files | A | ✓ | Merge + extract + vendored worker = privacy intact. | keep |
| squeeze | files | A | ✓ | Debounced live compress, format auto, real savings. | keep |
| qr | files | A | ✓ | Three modes (text/url/wifi), L/M/Q/H ECC, PNG + SVG. | keep |
| strip | files | A | ✓ | EXIF audit + canvas-rebake; PNG/JPEG paths separate. | keep |
| trace | files | A | ✓ | Lazy-loads `imagetracerjs`, four detail tiers. | keep |
| ascii | files | B | ✓ | Mono + colour, four ramps; novelty more than utility. | polish |
| base64 | files | B | ✓ | Image-only by design; "or text" would double the value. | iterate |
| favicon | files | A | ✓ | Seven sizes + manifest snippet — earns its slot. | keep |
| sift | files | A | ✓ | Recent: virtualised table, type detection, summaries. | keep |
| read | writing | A | ✓ | Flesch + grade + long-sentences + top words; Swedish stop-words too. | keep |
| markdown | writing | A | ✓ | Just iterated: templates, outline, ⌘B/I/E/K, view modes. | keep |
| diff | writing | A | ✓ | Word/line/char + counts, lazy-loads `diff`. | keep |
| slug | writing | A | ✓ | Ten cases, all live, click-to-copy. | keep |
| case | writing | B | ✓ | Wonky-cases sister to slug; vibe tool, fine. | polish |
| cleantext | writing | A | ✓ | Real audit: smart quotes, BOM, zero-width, NBSP. | keep |
| lorem | writing | B | ✓ | Six flavours; charming but rarely reached for. | polish |
| sum | writing | A | ✓ | Recent: notepad calc with mathjs + currency snapshot. | keep |
| palette | creative | A | ✓ | Four harmonies + WCAG ratio chips; daily-driver. | keep |
| sketch | creative | B | ✓ | Drawing canvas; **doesn't persist** strokes — refresh wipes work. | iterate |
| idea | creative | A | ✓ | Lock + reroll per part; locked feel earns the spark. | keep |
| roll | creative | A | ✓ | Wheel — title was renamed to "Spin the Wheel" but slug stays `roll`. | polish |
| picker | creative | C | ✓ | Functional duplicate of `roll`; pulls a name from a list. | merge-with-roll |
| tip | creative | A | ✓ | Solid bill-splitter, four currencies, nearest-N rounding. | keep |
| mash | creative | B | ✓ | Naming brainstorm; small daily-driver pull. | polish |
| gradient | code | A | ✓ | Linear/radial/conic, stop UI, copyable CSS. | keep |
| contrast | code | A | ✓ | Tier breakdown + commentary, swap button. | keep |
| shadow | code | A | ✓ | Layered shadows + presets — neumorph included. | keep |
| easing | code | A | ✓ | Newton-Raphson for time-curve solving; rare polish. | keep |
| regex | code | A | ✓ | Cheatsheet, captures, honours `g` flag honestly. | keep |
| shot | code | B | ⚠ partial | iPhone is listed in `FRAMES` but never renders a bezel. | polish |
| munch | games | A | ⚠ caveat | Real WS server; not yet covered honestly on /about. | keep + disclose |

## 3. Cross-cutting findings

### Information architecture

- **The map is still the right primary surface.** With 44 nodes plus Munch, a force-directed graph still reads at desktop sizes. On mobile (320–400 px) the legend wraps onto three lines and tooltips clip — see `ToolMap.tsx:480` `MIN_W = 320`. The simulation is O(n²) in `step()` (line 817) — at 44 nodes, ~1k pair checks per frame, fine, but the page is now within striking distance of needing a quadtree or a spatial grid (the same one Munch uses on the server).
- **Cluster taxonomy is healthy.** Seven clusters since `games` was added. Each row in `lib/clusters.ts` has a tagline; only `code` ("Pixels, CSS, patterns") could read sharper.
- **Edge curation in `lib/links.ts` is good** — 80+ undirected edges, with comments explaining bridges. One small risk: the file rewards manual curation, so adding a tool without remembering to add edges produces an orphan node. A cluster-default edge (every tool gets at least one same-cluster bridge) would be a cheap floor.
- **Re-cluster + Surprise duo lives in the top-right corner.** Both are pleasing, both use `pathFor(slug)` correctly. The "shake the layout" affordance is undiscoverable without the title attribute (`HomeShell.tsx:74`) — a tiny `↻` label or a tooltip on hover could fix that without weight.
- **The /about cluster mirror is broken in two ways.** `app/about/page.tsx:54` hard-codes `<Stat value="5" label="themes" />` (now 7). `app/about/page.tsx:93` builds tool links as `href={\`/tools/${t.slug}\`}` instead of `pathFor(t.slug)`, so the Munch chip 404s.

### Visual & interaction system

- **Colour-map sprawl is the headline cost.** Every page imports `Tool` and re-defines its own colour↔class map:
  - `lib/tools.ts:479` — `colorClasses: { bg, bgSoft, text, ring }`
  - `components/ToolFrame.tsx:5` — `colorBg` (soft) and `colorAccent`
  - `components/ToolCard.tsx:5` — same `colorBg` + `colorAccent`
  - `components/Search.tsx:90` — `accentSoft` + `accentBg`
  - `components/ToolMap.tsx:22` — `COLOR_HEX` (raw hex) + `COLOR_TEXT` (cream/ink ternary)
  - `app/not-found.tsx:6` — `TOOL_COLOR_HEX` (duplicate of the above)
  - `app/tools/feeling/page.tsx:9` — `softBg` + `accentBg` + `numberBg` (third copy, with `text-cream/ink` ternary baked in)
  - `app/tools/sleep/page.tsx`, `app/tools/three/page.tsx`, etc. each use ad-hoc one-offs for the "yellow & pink need ink, the rest take cream" rule
  
  A single `lib/colors.ts` exporting `colorClassesFor(c: ToolColor)`, `colorHexFor(c)`, `preferredTextOn(c)` would replace ~120 lines and stop the next edit-cycle drift.

- **`card-chunk` and `btn-chunk` are consistent across tool pages**, with one quirk: `Idle` in `stretch/page.tsx:412` uses `btn-chunk` on a non-button container (the routine picker tile), which gives it the hover lift but the chunk shadow is meant for buttons, not card grids. Choose one or the other per surface.

- **`ToolFrame` header** is a nice anchor: emoji ball + title + tagline on a soft tinted card. The "← Back to all tools" link is consistent. The header doesn't have a tool-color stripe, which is fine, but the page below loses the colour cue once you scroll past the header. Some tools compensate (Tally's big orange button, Sum's yellow result column) — others don't (Sleep, Markdown). Worth a stylistic decision either way.

- **Hover/active/focus.** `:focus-visible` is global at `app/globals.css:122` (3px blue outline, 3px offset, 4px radius) — solid baseline. `card-chunk:hover` lifts 2px, `btn-chunk:hover` lifts 1px — the relationship reads. `btn-chunk:active` collapses to 0 shadow — playful and clear.

- **Motion.** `prefers-reduced-motion` is respected only in `ToolMap.tsx:201` (`reduceMotionRef` zeros wobble). `breathe`, `tally`, `picker`, `idea` all run RAF or CSS animations regardless. Accessibility findings, not visual ones — flagging here because the motion *is* the design.

### Copy & voice

- **Tool names — clever vs. opaque.** Most slugs are great (`focus`, `breathe`, `talk`, `until`, `zones`, `tally`, `noise`, `palette`, `sketch`, `gradient`, `regex`, `tip`, `roll` post-rename). Borderline: `mash`, `idea`, `picker`. **Genuinely opaque without the tagline:** `sift` (CSV explorer? Sift through? Could be many things), `shot` (screenshot? Photo? Bullet?), `squeeze` (oranges? Compression?), `cleantext` (ok-but-wordy). The site's vibe forgives more than most, but `shot` and `sift` are both new and both still test on first read.

- **Title vs slug drift.** `roll` was renamed to "Spin the Wheel" in `lib/tools.ts:77` but the slug stays `roll` (correct call — URL stability) and the OG image still chips it as "roll" (`app/opengraph-image.tsx:107`). Pick one — either rename the OG label too, or leave both as-is and accept the chip-vs-title divergence on the marketing image.

- **Empty/error states.** Most tools have considered empties (`Stats` empty in `read`, "drop a CSV" in `sift`, "Add at least two options" in `roll`). One miss: `convert` in error state shows a banner under a fresh drop zone, but the OS-level error from a refused conversion bubbles up as a raw library message ("Cannot convert image to docx" etc.) — these are technically true but visibly mid-pipeline. A helper that cleans those is a single function.

- **Error tone.** Lobby for Munch ends on "Couldn't reach the server. Is it running?" — it reads well in dev, looks broken in prod. Worth gating the "Is it running?" half on `process.env.NODE_ENV === 'development'`.

- **About page voice problem.** "0 servers" (`app/about/page.tsx:54`) was true the day before Munch shipped. Now there's a real WebSocket server doing real work. Either rephrase ("0 trackers") or split the principle into "servers (almost none)". This is the only place the site's honesty has slipped.

### Accessibility

- **Keyboard reach to every tool.** Map nodes are reachable via `tabIndex={0}` (`ToolMap.tsx:631`), with Enter/Space activating. Good. Surprise + Re-cluster are keyboard-focusable. ⌘K from anywhere is solid. Nav links have native focus. The cluster legend in the map (`ToolMap.tsx:741`) is a row of `<button>` elements, so each is reachable — but they have no aria-pressed state. A screen-reader user can't tell which cluster filter is active.
- **Contrast on coloured chips.** Every accent colour was paired with cream or ink based on `preferredText` logic — but multiple components hand-code that ternary inline (e.g., `ToolMap.tsx:756` `id === "time" || id === "creative" ? "#1a1812" : "#fbf6ee"`). When yellow becomes more saturated tomorrow, both places drift apart. Fold into the `colors.ts` consolidation.
- **Tooltips.** ToolMap renders them as `<text>` inside the SVG (`ToolMap.tsx:670`). They're not in the accessibility tree — sighted users see the title + tagline, screen readers don't. The node's `aria-label` is "Open Title" only.
- **Focus-visible coverage.** Two notable misses:
  1. `app/tools/regex/page.tsx:178` — the inline pattern input has `focus:outline-none` and no replacement focus ring. Its sibling fields too (`flags`, `text`).
  2. `app/tools/sift/page.tsx:391` — the global search has `focus:outline-none` with no replacement.
  These violate the global focus-visible rule because `focus:outline-none` overrides it.
- **Motion sensitivity.** Most tool pages don't honour `prefers-reduced-motion`. `featured-in`, `fade-rise`, `pulse-dot` keyframes in globals.css all run regardless. The map honours it in JS for wobble; the CSS animations don't. A single `@media (prefers-reduced-motion: reduce)` block could neutralise the four named keyframes site-wide.

### Performance & bundle

- **Heavy deps** are correctly behind `await import(...)`:
  - `pdf-lib` only loaded by `pdf` page (line 81)
  - `pdfjs-dist` only loaded by `convert/pdf.ts` (line 13) — worker vendored, not CDN
  - `mammoth` only by `convert/docx.ts`
  - `xlsx` only by `convert/tabular.ts`
  - `imagetracerjs` only by `trace/page.tsx:77`
  - `marked` + `dompurify` only by `markdown/page.tsx` and `convert/markdown.ts`
  - `shiki` only by `lib/shot/highlight.ts`
  - `html-to-image` only by `shot/page.tsx:107`
  - `diff` only by `diff/page.tsx:55`
  - `qrcode` only by `qr/page.tsx:63`
  - `papaparse` only by `lib/sift/parse.ts`
  - `mathjs` only by `lib/sum/evaluate.ts`
  
  Excellent dynamic-import discipline. The home bundle should be lean.

- **Map RAF cost.** O(n²) repulsion in `step()` runs every animation frame at 44 nodes — 946 pair iterations × 60fps = ~57k/sec. Fine on desktop, observable on a 2018 MacBook Air. At 60 nodes (the next phase) it's 1770/frame, still fine. Quadtree is overkill for now; revisit if you ever exceed ~80.

- **SVG node count.** Map renders 44 nodes (dot + emoji + optional tooltip group + cooldown arc on edges) plus 80+ edges plus particles plus ripples. Ballpark 250 SVG elements at idle, more during click effects. Fine on modern browsers; could matter on mobile Safari with low memory.

- **Load order on the map page.** `ToolMap` is dynamically imported with `ssr: false` (`HomeShell.tsx:7`) — so the page paints the floating hero card and re-cluster ball, then the map renders client-side. The 280ms "Ready in" budget is the dev-server figure; a production build is faster. The hero card backdrop-blurs (`HomeShell.tsx:31`) — fine, but `backdrop-filter` is the kind of thing that throws iOS Safari into composite layers people debug at 2 AM.

### Privacy promise

Audited. Held at runtime.

- No `fetch()` to a network destination in `app/`, `components/`, or `lib/` other than `app/tools/strip/page.tsx:154`, which fetches a local `URL.createObjectURL(file)` blob — i.e., reads the user's own dropped image into a different decode path. **Not a network call.**
- No `<script>` tags inserted dynamically.
- No analytics (no GA, Plausible, Posthog, Sentry, anything).
- No CDN. The pdf.js worker is vendored at `/public/vendor/pdf.worker.min.mjs` per a deliberate comment in `convert/pdf.ts:14–17`.
- Fonts come from `next/font/google` (Geist + Bricolage Grotesque). Build-time download, self-hosted at runtime. Privacy-clean.
- localStorage usage is comprehensive — 32+ tools persist state. All keys are namespaced `hugoslekstuga:*`. Nothing is uploaded.
- Munch DOES use a server (`server/munch/index.ts`). It receives `name` (truncated to 16 chars, profanity-filtered) and `dir + split` inputs. It does not log; it does not persist; it sends nothing to third parties. But the user's chosen name is broadcast to other live players.

**Recommended single-page promise:** create `/promise` (or fold into `/about`) with three honest sections:
1. *On 43 tools (Files / Writing / Time / Wellness / Creative / Code):* nothing leaves your browser. Files are read by JavaScript on this device; results are computed on this device; downloads come from this device.
2. *On Munch:* it's a real-time multiplayer game on a shared map. To play, your chosen name and your moves are sent to a small Node server (geographic location: TBD) so other players can see your blob. No accounts; no logs; no third parties; the server runs only when someone is playing.
3. *Fonts:* downloaded at build time from Google Fonts and self-hosted afterward. After the page loads, no Google connection happens.

That's the page to link from the footer "Your device, your data" claim.

### SEO & metadata

- `app/layout.tsx:19` defines title template, description, `metadataBase`, OG, Twitter card. Solid base.
- Per-tool pages **do not export `metadata`.** Every `app/tools/<slug>/page.tsx` starts `"use client"` and there's no `generateMetadata` either. So every tool page inherits the default title `hugoslekstuga — a small playhouse for tools`. For SEO, "Squeeze — image compression in your browser" beats "hugoslekstuga — a small playhouse for tools" every time. Adding `metadata` exports requires a server component wrapper since the pages are client. Doable but a non-trivial restructure.
- **`opengraph-image.tsx` is stale and brittle.** Forty inline `{ c, t }` tile entries (lines 100–146). Missing the round-3 + round-4 tools (`sum`, `sift`, `shot`, `munch`). Includes long-removed text. Will drift again. Solution: derive the tile array from `tools` + `colorHexFor` (the consolidated colour map).
- **No `robots.txt`.** Default Vercel behaviour serves an empty one — fine for now, but explicit is better.
- **No `sitemap.xml`.** Adding `app/sitemap.ts` (Next 16 supports it as a route) that emits `/`, `/about`, and one row per `tools.map(t => pathFor(t.slug))` would unlock indexing. Cheap.
- **No canonical URLs per tool.** Single-domain site, so the risk is low; still polite to add.
- **`apple-icon.tsx` and `app/icon.svg`** both render the same four-tile mark in literal hex. Same drift risk as the colour maps; same one-pass cleanup.
- **`not-found.tsx`** uses a `SUGGESTED` array of slugs (`advice`, `feeling`, `convert`, `qr`, `focus`, `palette`). Good. Hard-codes "5 themes" in the closing block — same fix as About.

### Codebase health

- **Dead exports.** `lib/clusters.ts:140` exports `clusterFor` and `:144` `sameCluster` — neither is referenced outside the file. `lib/palette.ts:152` `randomBaseHex` is used; `:139` `preferredText` is used; the rest of the file is hot. `lib/links.ts:138` `neighbourCounts` is exported but unreferenced. Small.
- **Type-safety gaps.** `as unknown as { … }` casts appear in `convert/docx.ts:8` and `convert/markdown.ts:23` where ESM/CJS interop is awkward. Acceptable but worth a comment so the next reader doesn't unwind them.
- **`react-hooks/preserve-manual-memoization` lint rule** caught me on `stretch/page.tsx` during recent work. The convention is now "drop manual `useCallback` and let the React 19 compiler memoize." Some older tools still use `useCallback` extensively (`tally`, `noise`, `qr`, `palette`, `talk`, `convert`) and pass lint. New work should follow the new convention to keep style consistent.
- **Naming inconsistencies.** `colorBg` (ToolCard, ToolFrame) vs `accentBg` (Search) vs `accentSoft`/`softBg` (Feeling) vs `COLOR_HEX` (ToolMap) vs `TOOL_COLOR_HEX` (not-found) — six names for variants of the same thing.
- **Patterns ripe for extraction.**
  - **`useToolColor()` or `lib/colors.ts`** — the consolidation discussed above.
  - **`<DropZone>` component** — `convert`, `squeeze`, `pdf`, `strip`, `trace`, `ascii`, `base64`, `favicon`, `sift`, `shot` all build a near-identical drop zone. Eight of them have hover-tint variations on the same colour scheme. One reusable component with a colour prop would replace ~250 lines.
  - **`<Slider>` component** — `trace`, `ascii`, `easing`, `shadow`, `noise`, `shot` each ship their own. Same shape.
  - **`<CustomMinutes>`** — duplicated verbatim between `focus` (line 227) and `talk` (line 189).
  - **`useDebounced(value, ms)`** — `squeeze` does it inline (line 77). `read`'s stats compute on every keystroke, which is fine because `computeReadStats` is fast, but a hook would centralise the rule.
  - **`formatBytes`** — defined three times (`convert`, `squeeze`, `pdf`).
  - **`localISODate`** — defined twice (`stretch`, `three`, `until`).
- **`tsconfig.json`** targets ES2017. Next 16 + React 19 + Turbopack don't need the down-level. ES2022 would let you drop a few hand-rolled iterables.

### Munch / server story

- **Deployable today?** Not without a few small additions. The server (`server/munch/index.ts`) listens on a hard-coded `MUNCH_PORT` env var (good), prints to stdout (fine for dev, useless in prod), has no health-check endpoint, no graceful shutdown, no per-IP rate limit, no exception handler around `wss.on('connection')`. AFK kick exists. Profanity filter exists.
- **Game logic** in `server/munch/game.ts` is the strongest piece of the codebase: multi-cell physics, mass-weighted centroid pull, separation pass, merge pass, eat resolution, spawn protection — every piece earns a comment that explains the *why*, not the *what*. This is the code I'd trust most under load.
- **Spatial grid** (`server/munch/spatial.ts`) is the right primitive at the right size. ~50 LOC.
- **Should `games` be its own product?** I'd say no, not yet. One game does not a games site make, and the playhouse identity has more pull when it surprises. Munch sits fine in the cluster legend. But:
  - The disclosure on `/about` needs to acknowledge it (see Privacy section).
  - The footer's "uploads · no servers" line (`Footer.tsx:32`) is now factually wrong for that one route.
  - A second game would change my mind.
- **Hosting plan** stays as the previously-recommended Fly.io single instance (Stockholm region), auto-stop when idle, hard spend cap. The client uses `process.env.NEXT_PUBLIC_MUNCH_WS_URL`, so deploying is a Vercel env var swap. The server has zero state-on-disk requirements — restarts are free.

## 4. Improve / Iterate / Remove / Redo / Add

### Improve (small wins, mostly polish)

1. Fix the `<Stat value="5" label="themes" />` in `app/about/page.tsx:54` to read from `CLUSTER_ORDER.length`. Same for "5 themes" in `app/not-found.tsx:106`. — XS
2. Replace `<Stat value="0" label="servers" />` on About with a genuine count (1, with an inline note about Munch). — XS
3. Switch About's tool grid links to `pathFor(t.slug)` so the Munch chip works (`app/about/page.tsx:93`). — XS
4. Drop `focus:outline-none` on `regex/page.tsx:178/183`, `sift/page.tsx:391`. The global `:focus-visible` rule will then take over. — XS
5. Add `aria-pressed` to the cluster legend buttons in `ToolMap.tsx:746`. — XS
6. Gate "Is it running?" half of the Munch error on `process.env.NODE_ENV === 'development'` (`app/games/munch/page.tsx:224`). — XS
7. Render the iPhone bezel in `shot` or remove it from `FRAMES`. Today it's listed but invisible. — S
8. Add `app/sitemap.ts` deriving every route from `tools` + `pathFor`. — S

### Iterate (meaningful changes to existing tools or systems)

1. **Consolidate the colour maps into `lib/colors.ts`**. Single source for `colorClassesFor`, `colorHexFor`, `preferredTextOn`. Remove six duplicates. Touches ToolCard, ToolFrame, Search, ToolMap, not-found, opengraph-image, feeling, sleep, three. — L
2. **Consolidate the OG image** to derive tiles from `tools` + the new colour map. Removes the staleness problem permanently. — S
3. **Persist `sketch`** strokes to localStorage (with a "clear" already in place). Many people draft over multiple sessions. — S
4. **Per-tool metadata.** Wrap each `app/tools/<slug>/page.tsx` in a server component that exports `metadata`, with the client component as `<Page>`. ~44 small files; mechanical. — L
5. **Extract `<DropZone>` component.** Replaces 8 near-duplicates. — M
6. **Honour `prefers-reduced-motion` for `featured-in`, `fade-rise`, `pulse-dot`.** A single CSS block in `globals.css`. — XS
7. **Update Munch disclosure on /about.** Inline note ("the only tool that needs a server") + a one-page `/promise` with the three-section explanation from the Privacy finding above. — S
8. **Make the home re-cluster discoverable.** A small "↻ shake the layout" label on the pink ball or a one-line caption beside the legend. — XS

### Remove / merge (kill candidates)

1. **`picker` → fold into `roll`.** Both pull a random item from a typed list. Make `roll` accept a "without replacement" toggle and ship one tool. — M
2. **README.md → rewrite.** Currently the create-next-app default. Embarrassing for a polished site. — XS
3. **`.next/` from version control if it slipped in** (didn't appear in git status during the audit, but a glance at `.gitignore` is a five-second sanity check). — XS

That's it. The surgical pass already cut `plus`, `ago`, `bionic`, `scale`. The remaining 44 tools all earn their slot or have a clear improvement path. No more straight kills.

### Redo (rewrites, not tweaks)

1. **`app/opengraph-image.tsx`** — derive from `tools` rather than the inline 40-element array. Half the rewrite is the colour-map consolidation. — M

(Just one. The rest of the surface earns iteration, not rewrites.)

### Add (only where they fill a real gap)

Capping at five and arguing principle #1 for each.

1. **`paste` — universal-clipboard helper.** Drops a screenshot, a colour, a hex, a URL, a snippet — detects the type and routes to the right tool (Squeeze, Palette, Slug, QR). One thing: detect-and-route. Earns a slot because it makes the playhouse self-aware. — L
2. **`palette` extension: extract a palette from a dropped image.** Single new feature, single tool, distinct from "pick a base hex." Could be a sibling tool `extract` or fold inside `palette` as a tab. Stronger as its own slot — keeps `palette` doing one thing. — M
3. **`vibe` — Spotify-style mood stamp from text or an image.** Returns a curated palette + one font + one shadow + one easing. A "vibe brief" you can copy as CSS. Code cluster. — M
4. **`crop` — image cropper with aspect lock.** Files cluster has every other image transform; cropping is missing. Earns its slot the day someone drops a Tweet screenshot into Shot. — S
5. **`bench` — paste two snippets, see which is faster (and how confident).** Code cluster. Browser-only `performance.now()` benchmark with confidence intervals. The site doesn't have anything in the "developer measure" niche. — M

Resist all five at once. Pick one for next cycle, hold the others.

## 5. Suggested sequencing

**Now (this cycle, ~5 picks):**

1. Improve #1–#3: About + not-found staleness fixes (10 min total).
2. Iterate #1: consolidate colour maps in `lib/colors.ts`. Touches 9 files but each touch is mechanical. Single PR.
3. Iterate #2: rewire `opengraph-image.tsx` on top of the new colour map.
4. Improve #6 + #7: Munch error gate + iPhone bezel either rendered or removed.
5. Remove #2: rewrite `README.md`.

That's the "promise drift + truth duplication + small lies" chapter. Single mental theme; one or two PRs.

**Next (cycle after, ~5 picks):**

1. Iterate #6: `prefers-reduced-motion` for the named keyframes.
2. Iterate #4: per-tool metadata exports. Mechanical.
3. Iterate #7: `/promise` page + footer cleanup.
4. Iterate #3: persist `sketch`.
5. Improve #4 + #5 + #8: the small a11y + sitemap.ts.

That's the "honesty and reach" chapter — a11y, SEO, a real promise page, and the tool that loses work between sessions getting fixed.

**Later (parked):**

- Iterate #5: `<DropZone>` extraction. Useful but cosmetic; do once you find yourself touching three drop zones in the same week.
- Remove/merge #1: fold `picker` into `roll`. Real improvement; small audience overlap; defer.
- Add: pick one new tool from §4. Resist `paste` until the colour-map consolidation lands; resist `bench` until you've used it on yourself once.
- Quadtree for the map (only if node count exceeds ~80).
- The `tsconfig.json` ES2022 bump (zero user value; do it the next time you're already in `tsconfig`).

---

*One more thing.* Of the 22 295 lines this codebase is now, the part that punches above its weight is the writing — `lib/advice.ts`, `lib/feelings.ts`, every `<p className="text-xs text-ink-muted">` footer. The brand is the voice. Whatever you cut, don't cut content density. Every tool that has a small footer ("Long, slow exhales activate the parasympathetic nervous system"; "Counts five characters as one word, the standard CPM/5 measure") is doing free work for the site's identity. Keep adding them.
