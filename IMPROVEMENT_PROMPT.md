# hugoslekstuga — improvement cycle for Claude Code (1M context)

Paste everything below the divider into a fresh Claude Code session.
You have a 1M-context model — load the project broadly before answering
the first question.

This prompt supersedes `REVIEW_PROMPT.md`; that earlier prompt was a
read-only audit. This one is the real implementation cycle.

---

You are taking the next pass on **hugoslekstuga**
(<https://hugoslekstuga.com>) — the playhouse is live. I'm Hugo. I've
lived with the site and decided most tools don't earn their place. Your
job is to help me cut, deepen, and ship a tighter, more lovable
version, plus add bots to the `munch` game.

**This is not a review.** You will be writing code. But you will check
in with me before each meaningful change — see "Operating instructions"
below.

## The loved twelve

These are the tools I want to keep and deepen:

| slug      | tool                | route                  |
|-----------|---------------------|------------------------|
| `advice`  | Advice              | `/tools/advice`        |
| `roll`    | Spin the Wheel      | `/tools/roll`          |
| `convert` | Document Converter  | `/tools/convert`       |
| `focus`   | Focus               | `/tools/focus`         |
| `qr`      | QR Code             | `/tools/qr`            |
| `breathe` | Breathe             | `/tools/breathe`       |
| `stretch` | Stretch             | `/tools/stretch`       |
| `pdf`     | PDF                 | `/tools/pdf`           |
| `strip`   | Strip               | `/tools/strip`         |
| `lorem`   | Lorem               | `/tools/lorem`         |
| `typing`  | Typing              | `/tools/typing`        |
| `munch`   | Munch (game)        | `/games/munch`         |

The rest of the tools in `lib/tools.ts` are on probation. I think they
can go, but I want a defense round first (see Phase 1).

## Phase 0 — Read first

Before anything: load the repo widely (you have the context for it).

- `AGENTS.md`, `README.md`, `package.json`, `next.config.ts`,
  `tsconfig.json`, `app/globals.css`
- `app/layout.tsx`, `app/page.tsx`, `app/about/page.tsx`,
  `app/not-found.tsx`, `app/opengraph-image.tsx`, `app/apple-icon.tsx`
- Every `app/tools/<slug>/page.tsx` and `app/games/<slug>/page.tsx`
- Every file in `components/` and `lib/` (incl. `lib/convert/*`,
  `lib/munch/protocol.ts`)
- `server/munch/*` — the multiplayer server
- The Next 16 docs under `node_modules/next/dist/docs/` for any
  framework API you're about to use. Per `AGENTS.md`: this is **not**
  the Next.js you remember from training.

When you're done reading, list the loved twelve back to me with the
current state of each in one sentence (so I know you actually loaded
them) and confirm you're ready to start Phase 1.

## Phase 1 — Defense round on the probation tools

The probation list is every tool in `lib/tools.ts` whose slug is **not**
in the loved-twelve table. Roughly 33 tools.

For **each** probation tool, in the order they appear in `lib/tools.ts`:

1. Read the tool's page, any helpers it uses in `lib/`, and the
   description in `lib/tools.ts`.
2. Decide honestly between two options:
   - **Cut.** Give me a one-line reason it doesn't earn its place
     (boring, redundant, half-baked, niche, drifts from the four
     principles, etc.).
   - **Save.** Propose a concrete improvement plan — what would
     change, what new shape the tool would take, why that shape would
     make me love it. Be specific. Don't propose generic polish.
3. Present your verdict to me as: `slug — VERDICT — one paragraph`.
4. **Wait for my call** on each verdict before moving on. Don't batch
   33 of these and dump them on me; do them in groups of 5 so I can
   keep up. After I respond to a group, take the next group.

Only after every probation tool has a final ruling (cut or save), you
will:

- Remove the cut tools (delete the page directory, drop entries from
  `lib/tools.ts`, `lib/clusters.ts`, `lib/links.ts`; remove edges that
  referenced them; clean any `lib/<slug>.ts` helpers; update the
  search index implicitly via `lib/tools.ts`).
- Update the `Stat` count on `/about` and the footer copy
  ("X tools and counting") to match the new total.
- Let removed routes 404 honestly — **do not** add redirects from
  `/tools/<old-slug>` to `/`. Bulk-redirecting removed pages to home
  is treated by Google as a soft 404 and confuses users (they
  clicked a tool; they land on a graph of dots). 404 is the right
  answer when there is no successor tool to redirect to.
- Polish `app/not-found.tsx` so the dead end feels like part of the
  playhouse, not a stumble:
  - Update the hard-coded `SUGGESTED` slug list so it only references
    tools that survive Phase 1. Today it points at `feeling` and
    `palette`, which are probably gone after this cycle. Pull from
    the loved-twelve.
  - Confirm the `{tools.length}` and `CLUSTER_ORDER.length`
    references still read sensibly with the smaller set; rewrite
    the surrounding copy if the numbers stop carrying their weight.
  - Tighten the supporting copy under the headline so the page
    sounds warm and dry, not apologetic. "That page got lost in the
    playhouse" is good — keep that energy.
  - Ask me before changing the visual treatment (the tomato pill,
    the cluster ribbon at the bottom). Those are deliberate.

Show me the diff summary before merging this phase.

## Phase 2 — Deepen each loved tool

For each tool in the loved twelve, in this exact order:

1. **Audit.** Open the page and helpers. List what's there today.
2. **Critique.** What is currently boring, fiddly, or half-promised?
   What would make me actively recommend this tool to someone?
3. **Plan.** A concrete, scoped improvement plan: features to add,
   features to cut, copy to rewrite, motion to introduce, defaults to
   change. Keep the four principles intact:
   - One thing, well
   - Your device, your data
   - Open a tab, use it, close it
   - A bit of personality
4. **Ask.** Whatever is conceptually unclear — voice, scope, default
   behaviour, edge cases, naming, whether to add a feature or stay
   small — **ask me directly** before coding. Don't guess on direction.
   Specifically expect to ask about:
   - `advice` — source/curation of advice strings, do we want themes,
     daily seed?
   - `roll` — visual treatment, weights, history?
   - `convert` — which format pairs are essential vs. fluff, file size
     ceilings, the "drop here" UX
   - `focus` — ambient mode? sound? interruption-blocking copy?
   - `qr` — error correction default, logo overlay, batch?
   - `breathe` — preset list, ambient audio, screen-dim?
   - `stretch` — illustration vs. text-only, voice prompts?
   - `pdf` — merge UI, page-picker UX, max file size?
   - `strip` — preview before/after, batch?
   - `lorem` — flavour list, length presets, copy-as-formatted vs. plain?
   - `typing` — text source, difficulty, leaderboard (local), keyboard
     heatmap?
   - `munch` — wait until Phase 4 (bots are the headline change there).
5. **Build.** Implement after I sign off on the plan. Group changes
   per tool into a single, well-scoped commit.
6. **Recap.** End with a 3-line summary: what changed, what I should
   try, anything I should reject if it doesn't feel right.

Don't move to the next loved tool until the previous one is shipped
and I've nodded.

## Phase 3 — Home retune for the smaller set

Keep the map. The force-directed graph stays the primary surface — it
should just feel intentional with ~12 dots instead of sparse.

- Retune `TARGET_DIST`, `SPRING_K`, `REPEL`, and `CENTER_PULL` in
  `components/ToolMap.tsx` so the smaller graph holds a comfortable
  shape without bunching or floating to corners.
- Re-evaluate the cluster legend: with the smaller set, ask me
  whether to collapse it (no clusters), keep a slimmed legend, or
  drop the legend entirely.
- Reconsider the re-cluster button. If motion no longer earns the
  pixel space, propose retiring it — but ask first.
- Update `lib/clusters.ts` so the remaining clusters reflect what's
  actually there. Empty clusters should be removed, not kept.
- Update edges in `lib/links.ts` to a hand-curated minimum that makes
  the smaller graph readable. Aim for 1.5–2.5 edges per node on
  average — fewer than today.

Ship Phase 3 only after Phases 1 and 2 are merged.

## Phase 4 — Munch bots

Add bot players to the Munch multiplayer game.

**The rule.** Maintain a floor of **10 total players** in the room.
- If humans < 10: bots fill the gap until population = 10.
- When a human joins: evict one bot (oldest first, ties broken by
  smallest mass) so each human takes a bot's slot.
- When a human leaves: spawn a bot to restore the floor.
- Hard cap: **300 total players** (humans + bots). Refuse new joins
  beyond that — return a friendly "room is full" to the joining
  client. The cap is a guardrail, not a target.

**Bot behaviour (default — open to your override after you read
`server/munch/game.ts`).**
- Seek the nearest pellet within sight radius.
- Avoid players whose mass is meaningfully larger than the bot's
  (chase if smaller).
- Occasionally split-fire (the space-bar weapon) when an aggressive
  shot would land — low frequency, not constant.
- Wander when nothing interesting is in range, with mild noise so
  movement looks alive, not Brownian.
- Bots respawn after being eaten, on a short cooldown.

**Visibility.** Bots should look identical to humans on the wire — no
"BOT" labels — but their names should be drawn from a curated list
that reads as friendly and obviously playful (e.g. mushroom-themed,
baby-animal-themed — propose a list and let me pick the flavour).
This keeps the room feeling alive without being deceptive about who's
human; ask me if you want to mark them differently.

**Where the code goes.**
- New: `server/munch/bots.ts` — bot AI, spawn/despawn, eviction queue.
- Edit: `server/munch/game.ts` — hook bot tick into the main loop;
  enforce the 300 cap; honour the floor on join/leave events.
- Edit (if needed): `server/munch/index.ts` — startup wiring.
- Edit (if needed): `lib/munch/protocol.ts` — only if the protocol
  needs a flag to differentiate bot/human (default: don't add one).

**Tuning to ask me about before you commit.**
- Sight radius
- Aggression (how readily bots fire)
- Floor number (10 is the proposed default — tell me if play-testing
  suggests 6 or 12 feels better)
- Whether to disable bots entirely on `?nobots` in the URL for solo
  testing
- Bot name flavour

Test the bot loop locally with `npm run munch` and walk me through
what you observed.

## Operating instructions (apply to every phase)

- **Ask, don't guess.** For any conceptual choice — naming, scope,
  copy voice, default behaviour, whether to add or remove a feature —
  ask me directly. Better to pause for a sentence of clarification
  than to commit a full direction I'd reverse.
- **Don't bulk-delete.** No probation tool gets removed before I rule
  on its verdict. No "while I was in there" deletions of unrelated
  files. If you find dead code outside the current phase, name it in
  your recap — don't act on it.
- **Match the voice.** Warm, dry, confident, lowercase. No emoji. No
  exclamation marks. Microcopy is part of the product.
- **Keep the visual language.** Cream / ink / eight accents,
  `card-chunk` / `btn-chunk`, Bricolage Grotesque + Geist, chunky
  shadow with no soft blur. Don't introduce new design tokens
  without asking.
- **Honour `prefers-reduced-motion`.** Already wired in `ToolMap.tsx`
  via `reduceMotionRef`; respect it everywhere new motion is added.
- **Privacy promise is load-bearing.** Nothing leaves the device
  except the `munch` game's own server traffic. No new fonts, CDNs,
  analytics, or telemetry. If a feature would require a server,
  surface that as a question, don't quietly add one.
- **Next 16 is not your training data.** Read the relevant guide in
  `node_modules/next/dist/docs/` before using any framework API.
  Heed deprecation notices.
- **Build before claiming done.** `npm run build` and `npm run lint`
  must pass on each phase before you call it shipped.
- **Commits are scoped.** One tool, one commit. Phase boundaries are
  obvious in `git log`.
- **Recaps are short.** When a phase or tool is done, give me three
  lines: what changed, what to try, what to reject if it feels off.

When you're ready, start with Phase 0 and confirm. Then begin Phase 1,
five tools at a time.
