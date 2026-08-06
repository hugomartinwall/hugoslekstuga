# hugoslekstuga

A small playhouse of useful, friendly browser tools.

Each tool tries to do one thing well, without asking anything of you. No
accounts. No uploads. No analytics.

Live at https://hugoslekstuga.com

## Run locally

```sh
npm install
npm run dev          # Next dev on :3000
```

## Stack

- Next.js 16 + React 19 + Tailwind v4 + TypeScript
- 9 single-purpose tools at `app/tools/<slug>/page.tsx` and one
  single-player game at `app/games/overrun/page.tsx` — everything runs
  in the browser, no server
- Source of truth for the catalogue: `lib/tools.ts` (registry) +
  `lib/clusters.ts` (`pathFor()` / `GAME_SLUGS`)
- Single source of truth for accent colours: `lib/colors.ts`

## Principles

1. **One thing, well.** If a tool grows, it splits.
2. **Your device, your data.** No uploads, no accounts, no analytics.
3. **Open a tab, use it, close it.** No onboarding, no settings.
4. **A bit of personality.** Phosphor colours, pixel corners, a small wink.

(The multiplayer games Munch + Noodle — the one exception to (2), with
their small WebSocket server — were retired 2026-08. The site is fully
serverless again.)

## Contributing

This is a personal project. The bar for adding a tool is "(a) it beats the
alternatives, (b) it's genuinely useful, (c) it feels cool." Most pitches
don't clear it; that's the point.
