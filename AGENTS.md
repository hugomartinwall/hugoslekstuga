<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Working on hugoslekstuga

A small playhouse of single-purpose, browser-only tools. This file is the
short orientation for whoever — human or agent — is about to write code in
this repo.

## Stack

Next 16 (Turbopack) + React 19 + Tailwind v4 + TypeScript.

## The skin — Nattöppet

The whole site wears **Nattöppet** ("open at night"): a phosphor arcade
that never closes. Warm phosphor text on room-dark surfaces, stepped
pixel corners, dithered panels. It shipped 2026-07-02 by **re-valuing
the existing tokens**, so the old names survive with new meanings:

- `--color-cream` = `#0b0c14` — "cream" is historical; it means *the
  page surface*, whatever the skin says that is. Today: room dark.
- `--color-ink` = `#e8f2e9` — *the text on that surface*. Today: phosphor.
- 8 phosphor accents keep their registry names but read differently:
  tomato=coral, blue=cyan, yellow=acid, pink=magenta, green=mint,
  purple=violet, orange=amber, teal=ice. Soft variants are dark
  accent-tinted surfaces.
- New surface tokens: `--color-panel` (raised panel), `--color-line`
  (hairline frames).
- Corners are stepped, not rounded: radii are zeroed; `.notch` /
  `.notch-sm` clip-paths do the pixel corners (8px steps for cards,
  4px for buttons/chips). A Bayer `--dither` tile whispers over panels.
- `btn-chunk` = arcade keycap (bevelled inset shadows). `card-chunk` =
  cabinet panel (hairline frame + inward dusk). Same class names as the
  old skin — the shadow language was re-skinned, not renamed.
- `.crt-on` = the homepage power-on animation; `.scanlines` = the
  whisper overlay. Both respect `prefers-reduced-motion`.

**Fonts** (loaded in `app/layout.tsx`): Jersey 15 (`--font-display`,
big display only — it ships weight 400 only, `globals.css` normalizes
bold rendering), Chivo Mono (`--font-sans`, all body copy), Silkscreen
(`--font-pixel`, micro-labels and badges).

**Exception:** Sjökort's on-map colors are pinned map-anchored values
(a nautical chart is dark-on-light) — don't re-skin them.

## The three house rules (internal — not displayed, still load-bearing)

These aren't shown on `/about` anymore (Hugo trimmed it to a hero +
"things you won't find here" — sparse on purpose). They still hold as
the working constraints when you build:

1. **One thing, sharply** — if a tool grows past one thing, it splits.
2. **Quiet by default** — no analytics, no accounts, no third-party
   scripts, no cookie banner.
3. **Open a tab, use it, close it** — no onboarding, no settings buried
   in menus.

The one exception to (2) is the multiplayer games (Munch, Noodle), which
share a small WebSocket server for game state. The server keeps no logs,
no DB, no third-party connections. That's the only network round-trip in
the whole site.

**Critical multiplayer constraint** — the Fly.io app
(`hugoslekstuga-munch`, both games share one process at `/munch` and
`/noodle` paths) must run **exactly one machine**. The game state lives
in-memory; two machines = two `Game` singletons = players split across
sessions. Set with `flyctl scale count 1`. Documented in `fly.toml`.
Don't scale up unless we move state out of process (Redis, etc).

The on-`/about` brand voice was rewritten 2026-07-04 (Hugo asked for
sharper wit, then asked for lekstuga over arcade). It now lives in
three pieces in `app/about/Client.tsx`: the **dictionary-entry hero**
("lekstuga · noun · Swedish — 1. a small house where children play
2. this"), Hugo's own subhead ("potentially useful stuff." — his
line, echoing the footer), and the *Things you won't find here*
**dust silhouettes** — eight dashed pixel outlines on a toy shelf,
the spots the absent things would occupy (labels + taped notes, e.g.
VENTURE CAPITAL / "didn't fit through the door"). Hover one and it
dimly tries to materialize in its would-have-been accent, then
dissolves. The silhouette glyphs are page art and deliberately do
NOT reuse the map's cabinet motif — this page stays visually unique.
All three pieces carry the wink — treat them the same way as the
rules: don't quietly reword without asking.

## The catalogue

**9 tools + 2 games**: advice, breathe, focus, lorem, pixla, roll,
sjokort, strip, sudoku + munch, noodle. (8 tools survived the
2026-07-02 curation cull; pixla joined 2026-07-03.)
The retired slugs (case, cleantext, convert, diff, pdf, qr, read,
typing, stretch) 308-redirect to `/?retired=<slug>` in `next.config.ts`
— HomeShell greets the broken bookmark with a quip. Don't reuse a
retired slug for something new.

## Source-of-truth files

- `lib/tools.ts` — tool registry (slug, title, tagline, description, color, emoji)
- `lib/clusters.ts` — `pathFor()` resolver for /tools vs /games routing.
  The file is named after the old cluster system — visible categories
  on the homepage map were retired. Only the path helper remains.
  `lib/links.ts` is also gone (was the inter-tool edge map for the
  old clustered homepage); the swarm doesn't need it.
- `lib/colors.ts` — single source for the 8 accent colours (+ `INK_HEX`
  / `CREAM_HEX` literals for canvas code that can't read CSS variables)
- `lib/hugo/sprite.ts` — the canonical Hugo pixel sprite (see below)
- `lib/hugo-state.ts` — Hugo's shared mood/memory store
- `lib/advice-engine.ts` — the Advice draw logic (see below)
- `lib/use-local-storage-state.ts` — canonical persistence hook
- `lib/format.ts`, `lib/dates.ts`, `lib/math.ts` — shared helpers
  (`formatBytes`, `localISODate`, `clamp`)

Adding a tool means: register in `lib/tools.ts`, decide if it's a game
(then add its slug to the `GAME_SLUGS` set in `lib/clusters.ts`), and
ship its page. Use the helpers in `lib/colors.ts` — never hand-roll a
`Record<ToolColor, string>` again.

## Colour rules

1. **Every accent takes room-dark text.** All 8 phosphor accents are
   bright, so `preferredTextHex()` / `preferredTextClass()` in
   `lib/colors.ts` return the page-surface colour ("cream" = room dark)
   for every accent. The `NEEDS_INK` set is kept but empty so a future
   skin can flip individual accents back. Use the helpers — never
   hardcode the choice.
2. **Colour = category.** Registry colours are categorical, not
   decorative: games are magenta (munch, noodle = pink), brainy tools
   are violet/ice (sudoku = purple, sjokort = teal), calm tools are
   mint/cyan (focus = green, breathe = blue), quick warm utilities take
   the warm range (roll = orange/amber, strip = tomato/coral, lorem +
   advice = yellow/acid). A new tool picks its colour by family first.

## Tool page shape

Every tool is three files:

- `app/tools/<slug>/Client.tsx` — `"use client"`, the actual UI
- `app/tools/<slug>/page.tsx` — server-component wrapper that exports
  `metadata = { title, description }` from the registry and renders `<Client />`
- `app/tools/<slug>/opengraph-image.tsx` — one-line wrapper around
  `renderToolOG("<slug>")` from `lib/og.tsx`

Same shape for the games at `app/games/munch/` and `app/games/noodle/`.
The split is so each page ships its own `<title>` and `<meta description>`
— client components can't export `metadata`.

## Shared components (use, don't reinvent)

- `components/ToolFrame.tsx` — page chrome (back link, header, panel card)
- `components/HomeShell.tsx` — the homepage room (CRT power-on, scanlines,
  hints, retired-slug quip); renders ToolMap + HugoParkour
- `components/ToolMap.tsx` — the attract-mode swarm on / (see below)
- `components/Slider.tsx` — labelled range input
- `components/CustomMinutes.tsx` — "Custom — N min" pill (focus)
- `components/Search.tsx` — ⌘K palette (mounted in the root layout)
- `components/BrandDot.tsx` / `BrandCorner.tsx` — corner Hugo (see below)
- `components/TravelingDot.tsx` — flight-layer Hugo (root layout)
- `components/HugoRoom.tsx` — Hugo's room overlay (shift+click him)
- `components/hugo/HugoStage.tsx` — Advice-page Hugo with poses
- `components/hugo/HugoParkour.tsx` — the homepage platformer

`ToolCard.tsx` and `DropZone.tsx` are orphaned since the cull — nothing
imports them. Don't build on them without checking they still fit.

## Hugo — the character

The brand dot is a character. Internal name: **Hugo** — never surfaced
in user copy; only in code comments and `data-name="hugo"` attributes
for the curious DevTools visitor. Use the name in code conversation so
"the dot" and "Hugo" mean the same thing. The top nav is gone — Hugo
is the brand.

**`lib/hugo/sprite.ts` is the canonical renderer.** Hugo is a 16×16
pixel sprite drawn on canvas everywhere he appears: `drawHugoSprite`
(pure painter — painted-lid blinks, quantized pupils, feet frames,
squash), `drawCabinet` (the arcade-cabinet orb the games use on the
map), `pixelDisc`, `readAccent`/`subscribeAccent` (his persisted colour,
`hugoslekstuga:dot-color`), `spriteCanvasSize`. Never draw Hugo with
CSS circles or a second sprite sheet — extend the one module.

**`lib/hugo-state.ts` is his brain**: mood (sleepy/calm/curious/
excited/grumpy), energy, visit streaks, `firstSeen` — persisted at
`hugoslekstuga:hugo`, read via the `useHugoState` hook. Tools feed it
moments (`hugoMoodEvent`, `hugoSawTool`); renderers read it.

**Where he renders:**

- `BrandDot` (inside `BrandCorner`, root layout — every page) — 36px
  sprite canvas. Behaviours: persisted colour cycling on click,
  proximity lifts his eyelids, idle blinks, swarm-hover gaze tracking,
  drag-and-spring with sparkle puff, spam-click play-dead with
  whole-page tantrum, Konami-code somersault, shift+click opens
  HugoRoom, tab-hidden sleep, and on `/` a **long-press starts
  Hugo's Parkour**. (The old long-press leash is deleted.)
- `TravelingDot` (root layout) — canvas Hugo who flies out of the
  corner when you click a swarm tool, fetches it, returns. He flips
  horizontally to face travel direction — never rotates.
- `HugoStage` (Advice page) — big Hugo with poses: idle / thinking /
  delivering / declining / celebrating.
- `HugoParkour` (homepage) — playable Hugo (see below).

Only one Hugo exists on screen at a time: page-level Hugos announce
themselves via `hugo-stage` / `hugo-traveling` events and the corner
yields.

## Hugo's event surface

All `window` CustomEvents, prefixed `hugoslekstuga:`:

| Event | Payload | Meaning |
|---|---|---|
| `hugo-happy` | — | Celebrate (eyes wide + sparkle puff). Fired by Sudoku win, natural Focus completion, parkour win. Keep the bar high — it should mean something each time. |
| `hugo-stage` | `{ present: boolean }` | A page-level Hugo (HugoStage, HugoParkour) exists; BrandDot hides its corner sprite while `present`. |
| `dot-travel` | `{ fromX, fromY, toX, toY, color, navColor, duration }` | Make TravelingDot fly between two screen points. ToolMap uses it for the swarm→corner fetch-and-return. |
| `hugo-traveling` | `{ traveling: boolean }` | Fired by TravelingDot mid-trip; BrandDot + ToolMap listen so there's one Hugo on screen. |
| `dot-arrived` | — | TravelingDot landed on a tool page; ToolFrame times its entrance off it. |
| `dot-nudge-target` | `{ x, y } \| null` | ToolMap tells TravelingDot where the clicked orb's landing spot is. |
| `tool-hover` | `{ x, y, slug, tagline } \| null` (rAF-rate) | ToolMap broadcasts the hovered orb; BrandDot's eyes track x/y, HomeShell whispers the tagline along the bottom edge. |
| `wordmark-layout` | `{ bottom } \| null` | PixelWordmark published a fresh layout; HomeShell parks the attract hint just under the marquee. |
| `parkour-start` / `parkour-end` | — | A parkour run begins/ends. BrandDot dispatches start on long-press; ToolMap suppresses click-nav + idle fetch during a run; HomeShell swaps the bottom hint. |
| `open-search` | — | Opens the ⌘K palette. |
| `storage-write` | (internal) | Fired by `use-local-storage-state` for same-tab sync. Not a Hugo event — don't dispatch it yourself. |

## Hugo's Parkour

Long-press the corner Hugo on `/` and the room grows gravity:
`components/hugo/HugoParkour.tsx` is a full-viewport canvas platformer
where the drifting swarm orbs are moving platforms. It reads orb
positions per-frame from the DOM (`data-slug` / `data-r` attributes
ToolMap puts on each `<g>`) — a read-only bridge, no shared state.
Physics: gravity, run/air control, variable-height jump, coyote time,
jump buffering; standing on an orb carries you with its drift. THE
EXIT door hangs from the top edge at the midpoint of the widest gap
between the `$search` / `$about` anchors (read live at run start and
on resize), so it never parks on a nav label. A short spawn beam
drops Hugo in (skipped under reduced motion). The win panel's keycap
links to **https://getlegacies.com/beta** (Hugo's day job — a plain
outbound `<a>`, the only external link the game adds; privacy rules
intact). Esc quits.

**Desktop-only, deliberately.** The trigger is gated to
`(hover: hover) and (pointer: fine)` — the game has no touch controls
and Esc is the only exit. Any future affordance that hints at it
(e.g. a "hold me" whisper) must share that gate so touch users are
never teased with a game they can't play.

## Advice — Hugo's flagship

`/tools/advice` is where Hugo has the most personality. The page asks
`lib/advice-engine.ts` for "the next line Hugo hands over":

- a recency window so lines don't echo
- a deterministic "one for today" first draw per calendar day
- tone bias from Hugo's live mood (grumpy leans blunt, sleepy warm)
- a rare pool unlocked by the relationship (streak ≥ 7, visits ≥ 25,
  or his "birthday" — the `firstSeen` anniversary)
- told-you-this-before memory, the decline (he refuses after enough
  draws in one sitting), and a kept list

Advice data lives in `lib/advice.ts` as `{ id, tone, rarity }` entries.
All engine persistence is one key: `hugoslekstuga:advice:memory`.
HugoStage performs the draw (thinking → delivering → …). Treat the
engine as the only draw path — don't sample `adviceEntries` directly.

## The homepage — attract mode

`components/ToolMap.tsx` is a free-floating swarm styled as an arcade
attract screen. Two layers:

- a **trail canvas** under the SVG: each orb leaves phosphor smears
  (a `rgba(7,8,15,0.5)` decay wash per frame), drawn as radial glow +
  `pixelDisc` cores — except the games, which render as magenta
  arcade **cabinets** via `drawCabinet`.
- the **SVG swarm** on top: transparent hit-circles, always-visible
  names, hover bloom. Physics is centre pull + cursor pull + mutual
  repel + drift wander. No clusters, no edges.

Clicking an orb dispatches `dot-travel` (Hugo fetches the tool).
HomeShell adds the once-per-session CRT power-on (`sessionStorage`
`hugoslekstuga:crt-on`), `.scanlines`, and the square DO-NOT-PRESS
keycap (the explode button).

**The marquee** — `components/PixelWordmark.tsx` draws HUGOS LEKSTUGA
centred in the swarm as quantized phosphor pixels (Jersey 15 sampled
once to an offscreen canvas — `ctx.font` can't read CSS vars, so the
concrete family is resolved off a `font-display` probe span, gated on
`document.fonts`). Letters ignite left→right after power-on, shimmer
at rest, flicker like a tired neon sign, shove aside near the cursor
(snapped to the grid), and blip when clicked. The canvas is
pointer-transparent; it listens on `window` and hit-tests itself.
Base cell rects never animate — they're published through
`lib/wordmark-bridge.ts` (viewport coords, setter + read-only
getters): ToolMap's `step()` reads the block rect to drift orbs out
of the title, HugoParkour reads the per-letter rects as flat one-way
platforms (behind its `LETTER_PLATFORMS` const). The blinking "press
any tool" hint sits under the marquee (positioned via the
`wordmark-layout` event); the hovered orb's tagline whispers along
the bottom edge. Reduced motion = one static, fully-lit draw.

**Measurement rule:** ToolMap must measure its box with
`offsetWidth`/`offsetHeight`, **never** `getBoundingClientRect` — the
`.crt-on` scaleY animation squashes gBCR mid-power-on and poisons the
whole layout.

## Things NOT to do

1. **Don't rename slugs.** URL stability beats copy precision. Title and
   tagline can change; the URL the user bookmarked cannot.
2. **Don't add analytics.** No GA, Plausible, Posthog, Sentry. The promise
   is the brand.
3. **Don't add auth or cloud sync.** Persistent state lives in `localStorage`
   keyed `hugoslekstuga:*`.
4. **Don't fetch live data at runtime.** If a feature needs live data,
   the feature doesn't ship. **One sanctioned exception:** the Sjökort tool
   (`app/tools/sjokort/`) fetches map tiles from OpenStreetMap and
   OpenSeaMap — a nautical chart can't be a static snapshot. The tile
   servers see an anonymous `give me tile XYZ` request, never the user;
   GPS position is read via the browser Geolocation API and **never
   leaves the device** (no upload, no logging). The autorouter adds no
   server: the routing graph is **baked offline** (`scripts/bake-sjokort-graph.ts`,
   from free OSM water + seamark-hazard data) and shipped as **static assets**
   (`public/sjokort/graph.v1.bin` + `grund.v1.geojson`); a Web Worker
   (`lib/sjokort/routing.worker.ts`) loads that own same-origin graph and runs
   A* in the browser, so the start/destination you pick never leave the device
   either. Grund (hazards) are best-effort from OpenStreetMap — incomplete,
   labelled "not for navigation." Don't rip out
   these fetches thinking they violate the promise — they're reviewed and
   documented. Don't add *more* runtime fetches to other tools.
   (The parkour win panel's outbound link to getlegacies.com/beta is an
   `<a>`, not a fetch — also sanctioned.)
5. **Don't quietly reword the brand voice on `/about`** — the
   dictionary-entry hero, the "potentially useful stuff." subhead,
   and the dust-silhouette labels/notes. Change any of them only
   when explicitly asked.
6. **Don't introduce another CSS framework.** Tailwind + the `card-chunk` /
   `btn-chunk` shadow language is the system.
7. **Don't add new server features.** Munch + Noodle are the only
   server-backed experiences — resist leaderboards, accounts,
   friends lists, persistent ranks. The room is capped at 10 humans
   (a queue takes overflow).
8. **Don't scale the multiplayer Fly.io app past one machine.** See
   the multiplayer constraint above — in-memory state would split.

## Privacy audit (run before any network-adjacent commit)

```sh
rg -n 'fetch\(|gtag|analytics|googletagmanager|cdn\.|XMLHttpRequest' \
  --glob '!node_modules' --glob '!.next' --glob '!public/vendor' \
  app components lib server
```

Legitimate hits:
- `app/tools/strip/Client.tsx` reading a local `URL.createObjectURL` blob.
- `app/tools/sjokort/**` — map-tile fetches (OSM + OpenSeaMap) and the
  browser Geolocation calls. The one sanctioned runtime-fetch tool; see
  rule 4 above. GPS never leaves the device.
- `lib/sjokort/routing.worker.ts` — `fetch('/sjokort/graph.v1.bin')`, the
  Web Worker loading our **own same-origin** baked routing graph. Not a
  third-party call.
- `scripts/bake-sjokort-graph.ts` — fetches OSM water + seamark-hazard data,
  but at **author time** only (build tool, never shipped). Not a runtime fetch.

Honest "no analytics" copy in Footer + About also matches the grep —
those are documentation, not network calls. When auditing, exclude the
sjökort tool and its lib: append `--glob '!app/tools/sjokort/**'
--glob '!lib/sjokort/**' --glob '!scripts/**'` to scope the grep to the
tools that are supposed to be fetchless.

## Hooks + state conventions

- Persist state with `useLocalStorageState(key, initial)`. `initial` must be
  referentially stable — define at module scope, not inline.
- localStorage keys must be namespaced `hugoslekstuga:*`. Hugo's own
  keys: `hugoslekstuga:hugo` (mood/memory), `hugoslekstuga:dot-color`
  (his colour), `hugoslekstuga:advice:memory` (the Advice engine).
- The React 19 compiler memoises automatically — **drop manual `useCallback`
  in new code**. Older tools still use it; they pass lint but new code
  doesn't need to follow that pattern.

## Run scripts

```sh
npm run dev           # Next dev on :3000
npm run munch         # WebSocket server on :8080 (hosts BOTH /munch + /noodle,
                      # only needed if you're playing the multiplayer games)
npm run lint
npm run build         # rm -rf .next first if Next caches stale routes —
                      # NOTE: that rm kills a running dev server; restart it
npm run bake:sjokort  # rebake the sjökort routing graph (author-time only)
```

The multiplayer server is deployed via `flyctl deploy --remote-only`
to the `hugoslekstuga-munch` app (Stockholm region, `arn`). Single
machine — see the multiplayer constraint up top.

## Commit style

- Atomic — one concern per commit
- Lowercase present-tense subject, short
- Body explains the *why*, not the *what*
- Agent-authored commits include
  `Co-Authored-By: Claude ... <noreply@anthropic.com>`

## The lab (`/lab`)

`/lab` is a private prototyping surface for design + behaviour decisions
before they ship. The layout calls `notFound()` when `NODE_ENV` is
`production`, and `app/robots.ts` disallows the path — so even in the
unlikely case a prod build leaks, it returns 404 to humans and robots.
Lab routes render under the real nav + footer so prototypes are seen
in context.

**Use it for**: anything that needs an A/B before committing to it
across the site — logo directions, motion idioms, page-transition
experiments, new colour/typography sets, palette swaps, hero
treatments. Anything you'd otherwise prototype in CodePen.

**Don't use it for**: a draft of a real tool. Tools land in
`app/tools/<slug>/` from the start — the lab is for *exploring shape*,
not for hiding work-in-progress functionality.

**Adding a lab experiment**:

1. `app/lab/<slug>/page.tsx` — optional server wrapper. If you need
   `"use client"` (most do, because the lab is interactive), pair with
   `app/lab/<slug>/Client.tsx`.
2. Add an entry to the `EXPERIMENTS` array in `app/lab/page.tsx` so the
   index lists it.
3. No need to touch `lib/tools.ts`, `lib/clusters.ts`, or `app/sitemap.ts`
   — lab routes are deliberately invisible to the regular site.

**Lifecycle**: when an experiment lands in production, delete its lab
route. The lab is a workshop, not an archive. The lab index should be
0–3 entries at any given time. (The 2026 rebrand + logo experiments
were deleted after Nattöppet and sprite-Hugo shipped — recoverable
from git history.)

## When adding a new tool

The bar from `README.md`: it (a) beats the alternatives, (b) is genuinely
useful, (c) feels cool. Most pitches don't clear it; that's the point.

Mechanical steps once it's earned a slot:

1. Add an entry to `lib/tools.ts` (slug, title, tagline, description,
   color, emoji — colour by category, see the colour rules). For games,
   also add the slug to `GAME_SLUGS` in `lib/clusters.ts` so `pathFor()`
   routes it to `/games/<slug>`.
2. Create `app/tools/<slug>/Client.tsx` (`"use client"`) and the server
   wrapper `page.tsx` exporting `metadata` from the registry entry.
3. Create `app/tools/<slug>/opengraph-image.tsx` — a one-line wrapper
   around `renderToolOG("<slug>")` from `lib/og.tsx`. Copy any existing
   tool's OG file as the template and update the slug + alt string.
   Skipping this means the tool's share preview falls back to the
   generic site-wide OG.
4. Use the shared components and helpers — don't reinvent.

That's it. The cluster system is retired and there's no `lib/links.ts`
to update — the homepage swarm picks up the new tool automatically
from the `tools` array.
