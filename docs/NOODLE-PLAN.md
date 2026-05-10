# Noodle — slither.io polish plan

A six-phase plan to take Noodle from "playable" to "feels like
slither.io with hugoslekstuga's voice". Prepared just before a
context compact so the plan survives whatever fits in the next
session.

## Goal

Get Noodle as close to slither.io as possible in mechanics + polish,
while keeping hugoslekstuga's distinct visual identity (cream
background, ink outlines, bold colours, dotted "garden" texture, eyes
on heads, pasta bots).

## State at plan time

- Last commit: `7aeebd3` — client-side prediction landed
- /games/noodle is live in production at hugoslekstuga.com
- Munch + Noodle share one Fly server (`hugoslekstuga-munch.fly.dev`)
  via `server/index.ts` shell, `mountMunch` / `mountNoodle` per game
- Server tick 30Hz, snapshot 30Hz, client local prediction + 1.5×
  extrapolation for others

## What works

- Snake physics: head + trail buffer, body sampled at SEGMENT_GAP
  intervals along the trail polyline
- Wall = death (slither-classic), head-vs-body = death,
  self-collision allowed
- Boost: sprints at BOOST_SPEED, drains 1 length/sec, drops the
  drained mass as small food at the tail
- Pasta-named bots with personality (sightFactor 0.7-1.3,
  decisionMs 150-280, jitterAmp 0-0.15) plus wall + body avoidance
  and foraging
- Smooth quadratic-Bezier body, eyes facing heading, dotted "garden"
  background, rounded-square death-drop food
- Client-side prediction for own snake (camera, head, body all
  locally simulated; server is authoritative for length and alive,
  reconciles drift via 8 %/snapshot blend)

## What's not good enough

- Body design is plain — uniform width, no taper, no texture
- Bots are dumb — no hunting, no encirclement, no boost-on-chase
- No eat / death / kill feedback (no pop, flash, particle burst)
- Mechanics tunings are guesses — turn rate, food, world size
- Mobile feel needs verification

## Execution rules

- Auto mode through all phases — don't pause for approval between
  phases unless something genuinely risky comes up
- One commit per phase, push each, lowercase commit subject in the
  hugoslekstuga voice (dry, glimten i ögat, no emoji, no
  exclamation marks)
- Quality checks after EVERY phase (see below)
- Final phase deploys via `flyctl deploy --remote-only` IF server
  files changed (Hugo pre-authorised this deploy for the session)
- STOP and ask before:
  - breaking the wire protocol non-backwards-compat
  - removing a shipped feature
  - adding cost (a second Fly app, etc)

## Quality checks (after every phase)

Run in order. If any fails, fix before moving on.

```sh
npm run lint                                           # 1
npx tsc --noEmit -p tsconfig.json                      # 2
rm -rf .next && npm run build                          # 3
pkill -f "tsx server" 2>&1; sleep 1
npm run munch &                                        # 4 (bg)
sleep 4
curl -s http://localhost:8080/health                   # expect floors stable
pkill -f "tsx server"
git diff                                               # 5 — sanity read
```

## Six phases

### Phase 1 — Body design polish (client-only)

- Tapered body: render the body as a series of circles with radius
  decreasing from `HEAD_RADIUS` at the head to `SEGMENT_RADIUS × 0.5`
  at the tail. Replace the single stroked-path approach with circle
  draws (or stroke with stepped widths if cheaper).
- Scale pattern: every ~3 segments, a slightly darker tone for
  visible body texture without fighting the colour palette.
- Eye polish: smaller pupils relative to whites, occasional blink
  (every ~5s, 100ms close).

### Phase 2 — Mechanics tuning (server)

- `TURN_RATE` 4 → 5 — snappier turning
- `BOOST_SPEED` 480 → 540 — bigger sprint differential
- `WORLD_SIZE` 4000 → 5000 — more room as snakes grow
- `SPAWN_PROTECT_MS` 1500 → 2200 — more breathing room on respawn
- `FOOD_TARGET` — proportional to new world area (≈ 940 if linear)
- Verify bot AI's wall lookahead still works at the new world size

### Phase 3 — Bot AI: hunting + boost (server)

- Hunting state: when a bot is bigger than a smaller snake by
  `EAT_RATIO` and within ~600 units, project the prey's path 1.5s
  ahead using its current heading and aim ahead of them
- Bots boost when actively chasing prey within ~300 units
- Wider wall lookahead (250 → 350) so bots commit to turns earlier
  with the bigger world

### Phase 4 — Eat + death feedback (client + maybe server)

- Client, eating food: briefly scale the head 1.15× for 100ms
- Client, another snake dies in viewport: small particle burst at
  the last head position in the dead snake's colour
- Client, own death: brief 400ms camera zoom to ~1.4× scale, white
  flash overlay, then the dead UI fades in
- Server (if needed): include the killed snake's last head position
  in the dead message so the client can target the burst (currently
  the dead message just has finalLength + killer name)

### Phase 5 — Performance + mobile (client)

- Profile `drawScene`; consolidate redundant canvas state changes
  if any
- Mobile: verify the boost button is finger-sized, the canvas
  responds correctly to drag, no zoom-to-text on double-tap, viewport
  scales sanely on small screens

### Phase 6 — Polish + ship

- Review lobby copy and dead-overlay copy for voice (lowercase
  drift, no exclamation marks, dry)
- Final round of lint + build + type-check
- If any server file changed in phases 2-4, deploy:
  `flyctl deploy --remote-only`
- Confirm production `/health` shows the new image
- Closing recap: list all 6 commit SHAs with one-line summaries

## File map (where things live)

- `lib/noodle/protocol.ts` — types, tuning constants
- `server/noodle/game.ts` — snake physics, food, collision, snapshots
- `server/noodle/bots.ts` — BotManager + AI
- `server/noodle/handler.ts` — connection handler + tick loop
- `server/index.ts` — shared shell (HTTP, WSS, routing)
- `app/games/noodle/page.tsx` + `Client.tsx` — client renderer + UI
- `lib/tools.ts` — tool registry (noodle is registered)
- `lib/clusters.ts` — `GAME_SLUGS` includes `"noodle"`
- `components/ToolMap.tsx` — `isGame` check for game-tile treatment

## Tuning constants snapshot (current)

```
WORLD_SIZE          4000
TICK_HZ             30
SNAPSHOT_HZ         30
HEAD_SPEED          280 px/sec
BOOST_SPEED         480 px/sec
BOOST_LENGTH_DRAIN  1 segment/sec
TURN_RATE           4 rad/sec
SEGMENT_GAP         12
HEAD_RADIUS         14
SEGMENT_RADIUS      12
INITIAL_LENGTH      8
FOOD_TARGET         600
FOOD_RADIUS         6 (regular) / 10 (death-drop)
GROW_PER_FOOD       1
GROW_PER_DEATH_FOOD 3
SPAWN_PROTECT_MS    1500
BOT_FLOOR           8
MAX_PLAYERS         80
```
