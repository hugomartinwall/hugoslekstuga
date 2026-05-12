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

The on-`/about` brand voice now lives in two pieces: the hero sentence
("…where I release things I made for fun.") and the *Things you won't
find here* strikethrough list. Both carry the wink — treat them the
same way as the rules: don't quietly reword without asking.

## Source-of-truth files

- `lib/tools.ts` — tool registry (slug, title, tagline, description, color, emoji)
- `lib/clusters.ts` — `pathFor()` resolver for /tools vs /games routing.
  The file is named after the old cluster system — visible categories
  on the homepage map were retired. Only the path helper remains.
- `lib/colors.ts` — single source for the 8 accent colours
- `lib/use-local-storage-state.ts` — canonical persistence hook
- `lib/format.ts`, `lib/dates.ts`, `lib/math.ts` — shared helpers
  (`formatBytes`, `localISODate`, `clamp`)

Adding a tool means: register in `lib/tools.ts`, decide if it's a game
(then add its slug to the `GAME_SLUGS` set in `lib/clusters.ts`), and
ship its page. Use the helpers in `lib/colors.ts` — never hand-roll a
`Record<ToolColor, string>` again.

The homepage map (components/ToolMap.tsx) is a free-floating swarm:
no clusters, no edges between dots, names visible under each. Physics
is centre pull + cursor pull (interactive gravity) + mutual repel.

## Colour rule

Yellow + pink want **ink** text on top; the other six accents want **cream**.
Encoded in `preferredTextHex()` / `preferredTextClass()` in `lib/colors.ts`.
Use those.

## Tool page shape

Every tool is two files:

- `app/tools/<slug>/Client.tsx` — `"use client"`, the actual UI
- `app/tools/<slug>/page.tsx` — server-component wrapper that exports
  `metadata = { title, description }` from the registry and renders `<Client />`

Same shape for the one game at `app/games/munch/`. The split is so each page
ships its own `<title>` and `<meta description>` — client components can't
export `metadata`.

## Shared components (use, don't reinvent)

- `components/ToolFrame.tsx` — page chrome (back link, header, soft-tinted card)
- `components/ToolCard.tsx` — homepage card surface
- `components/DropZone.tsx` — drag-and-drop file picker
- `components/Slider.tsx` — labelled range input
- `components/CustomMinutes.tsx` — "Custom — N min" pill (focus, talk)
- `components/Search.tsx` — ⌘K palette
- `components/ToolMap.tsx` — force-directed map on /

## Things NOT to do

1. **Don't rename slugs.** URL stability beats copy precision. Title and
   tagline can change; the URL the user bookmarked cannot.
2. **Don't add analytics.** No GA, Plausible, Posthog, Sentry. The promise
   is the brand.
3. **Don't add auth or cloud sync.** Persistent state lives in `localStorage`
   keyed `hugoslekstuga:*`.
4. **Don't fetch live data at runtime.** Currency rates in Sum are a
   deliberate static snapshot. If a feature needs live data, the feature
   doesn't ship.
5. **Don't quietly reword the brand voice on `/about`** — the hero
   sentence and the "things you won't find here" list. Change either
   only when explicitly asked.
6. **Don't introduce another CSS framework.** Tailwind + the `card-chunk` /
   `btn-chunk` shadow language is the system.
7. **Don't add new server features.** Munch is the one server-backed tool —
   resist leaderboards, accounts, friends lists.

## Privacy audit (run before any network-adjacent commit)

```sh
rg -n 'fetch\(|gtag|analytics|googletagmanager|cdn\.|XMLHttpRequest' \
  --glob '!node_modules' --glob '!.next' --glob '!public/vendor' \
  app components lib server
```

Only legitimate hit: `app/tools/strip/Client.tsx` reading a local
`URL.createObjectURL` blob. Honest "no analytics" copy in Footer + About
also matches the grep — those are documentation, not network calls.

## Hooks + state conventions

- Persist state with `useLocalStorageState(key, initial)`. `initial` must be
  referentially stable — define at module scope, not inline.
- localStorage keys must be namespaced `hugoslekstuga:*`.
- The React 19 compiler memoises automatically — **drop manual `useCallback`
  in new code**. Older tools still use it; they pass lint but new code
  doesn't need to follow that pattern.

## Run scripts

```sh
npm run dev      # Next dev on :3000
npm run munch    # WebSocket server on :8080 (only needed for /games/munch)
npm run lint
npm run build    # rm -rf .next first if Next caches stale routes
```

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
0–3 entries at any given time.

**The dot character — internal naming**: the brand dot in the nav and
the traveling dot that flies from the swarm to the nav share a name
internally — **Hugo**. Never surfaced in user copy; only present in
code comments and `data-name="hugo"` attributes on the dot elements
for the curious DevTools visitor. Use the name in code conversation so
"the dot" and "Hugo" mean the same thing.

## When adding a new tool

The bar from `README.md`: it (a) beats the alternatives, (b) is genuinely
useful, (c) feels cool. Most pitches don't clear it; that's the point.

Mechanical steps once it's earned a slot:

1. Add an entry to `lib/tools.ts` (slug, title, tagline, description, color, emoji)
2. Map it to a cluster in `lib/clusters.ts`
3. Add at least one edge in `lib/links.ts` so it isn't an orphan on the map
4. Create `app/tools/<slug>/Client.tsx` (`"use client"`) and the server wrapper
   `page.tsx` exporting `metadata`
5. Use the shared components and helpers — don't reinvent
