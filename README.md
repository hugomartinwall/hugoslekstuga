# hugoslekstuga

A small playhouse of useful, friendly browser tools.

Each tool tries to do one thing well, without asking anything of you. No
accounts. No uploads. No analytics.

Live at https://hugoslekstuga.com

## Run locally

```sh
npm install
npm run dev          # Next dev on :3000
npm run munch        # WebSocket server for the multiplayer games on :8080
```

`munch` only needs to run if you want to play `/games/munch` or
`/games/noodle` (they share one server process). Everything else works
without it.

## Stack

- Next.js 16 + React 19 + Tailwind v4 + TypeScript
- 18 single-purpose tools at `app/tools/<slug>/page.tsx`
- Two real-time multiplayer games at `app/games/{munch,noodle}/page.tsx`,
  sharing one WebSocket server at `server/index.ts` (routes `/munch` +
  `/noodle` to per-game handlers under `server/munch/` and `server/noodle/`)
- Source of truth for the catalogue: `lib/tools.ts` (registry) +
  `lib/clusters.ts` (`pathFor()` / `GAME_SLUGS`)
- Single source of truth for accent colours: `lib/colors.ts`

## Principles

1. **One thing, well.** If a tool grows, it splits.
2. **Your device, your data.** No uploads, no accounts, no analytics.
3. **Open a tab, use it, close it.** No onboarding, no settings.
4. **A bit of personality.** Bold colours, chunky shadows, a small wink.

The one exception to (2) is the multiplayer games (Munch + Noodle), which
connect to a small WebSocket server so other players can see your blob /
snake. The server keeps no logs, no DB, no third-party connections.

## Contributing

This is a personal project. The bar for adding a tool is "(a) it beats the
alternatives, (b) it's genuinely useful, (c) it feels cool." Most pitches
don't clear it; that's the point.
