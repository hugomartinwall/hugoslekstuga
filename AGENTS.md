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

## The kit — one set of shapes (v2, 2026-11)

The July re-skin changed the colours and kept the old shapes, so round
white-ringed pills sat next to stepped panels and every card's hairline
broke at its corners. v2 fixed the shapes. **Everything framed is
stepped; nothing is rounded, ringed in white, or dashed.** The rules
live in `app/globals.css` under "The kit" (in `@layer components`, so a
Tailwind utility on the same element still wins) and in `components/ui/`.
The rule is about framed page elements. Inside Knuff's canvas the white
ring is the game's one signal (he is fast: a weapon), and what is
announced is drawn as a broken outline: that is play, not a frame.

**How a frame works.** The element is clipped to the notch polygon and a
`::after` overlay draws the hairline as a *ring that follows the steps*.
A plain `border` cannot do this: the clip that makes the corners also
cuts the border away there. The same ring is the keyboard-focus
indicator (an outline would be clipped too): `--ring-w` goes 1px → 2px
and `--ring-c` goes hairline → cyan. Never add `border-*` or `outline`
to a chunk; set `--ring-c` if a frame needs another colour.

| Class | What it is | Component |
|---|---|---|
| `btn-chunk` | keycap: bevel, presses down; with `aria-pressed="true"` it stays down | `components/ui/Keycap` (`tone` accent/neutral/quiet/danger, `size` sm/md/lg/icon, `href` makes it a link) |
| `chip-chunk` | a choice: flat, fills with the accent when on (`aria-pressed`, `aria-checked`, or a checked radio inside) | `components/ui/Chip` — `Chip` (toggle/action) and `ChipGroup` (one of several, real radios underneath; name it with `labelledBy` when a visible label sits beside it) |
| `plate-chunk` | the bare small frame (stepped corners + hairline) for housings, tags and tiles: anything that is not a control | `components/ui/Tag` (a small label: `tone` neutral/accent/danger/solid; its spacing and surfaces are the kit rules `.tag-chunk` / `.tag-*`, so a utility in `className` always wins) |
| `field-chunk` | a well around an `<input>`/`<textarea>` — the wrapper carries the frame, pseudo-elements do not exist on inputs | `components/ui/Field` — `TextField`, `TextArea` |
| `card-chunk` | cabinet panel, the big 8px steps. Lifts on hover only when it is an `<a>`, `<button>` or `<label>` | `components/ui/Panel` (`tone` well/raised/page/soft/danger) |
| `range-chunk` | a native range re-dressed; set `--fill` to the value's percentage | `components/Slider` (under a finger the strip around the input handles the touch: a sideways drag or a tap moves it, a scroll that starts on it changes nothing) |
| `switch-chunk` | the track of an on/off switch, framed by the stepped ring like the other chunks | `components/ui/Switch` |
| `label-pixel` | the one micro-label (Silkscreen, tracked, muted) | — |
| `kbd-chunk` | a key legend (⌘K, esc) | — |
| `scrim-chunk` | what sits behind a dialog: dark and flat, no blur | `components/ui/Dialog` (focus trap, Esc, scroll lock, portalled; plain keydowns stop at the dialog so page shortcuts and games do not hear what is typed in it; focus goes back to the opener without scrolling, unless `returnFocus` says this closing is a leaving; closed by a press, it swallows presses for a moment). `components/ui/ScrollRegion` is a dialog body that scrolls: a Tab stop while it overflows, so the keyboard can scroll it |
| `page-col` | a centred column that lands on a whole pixel (`--col` sets its width) | — |

Also: `components/ui/Dropzone` (drop / click / keyboard; `size` roomy
or slim; it tells `onFiles` whether the files were dropped or picked,
because the picker filters by `accept` and a drop does not), and
`components/PixelIcon` + `lib/pixel-icons.ts` — 12×12 bitmap icons, one
per tool and one per game, plus a few for the chrome (search, about,
back, forward, up, close, plus, play, settings, locate, and the burst on
the homepage's forbidden key). A new icon goes in
that file, never in a page. They replace the Unicode symbols (◴ ⊚ ▦),
which every OS drew with a different fallback font. The registry's
`emoji` field stays for old call sites; new UI uses
`<PixelIcon name={iconForSlug(...)} />`, or `components/ui/IconTile`
for the icon on its stepped accent tile (two sizes only: 36px and 48px).
On the homepage a game is a cabinet, so a game's icon is for lists (the
search palette, the 404 page); a game without one gets the shared
`game` cabinet.

**Accent.** Controls read `--accent` / `--accent-soft`. `ToolFrame` sets
both from the tool's registry colour (`accentVars()` in `lib/colors.ts`),
so a chip or slider inside a tool page wears the tool's colour without
being told. Text on an accent fill is always room-dark (`text-cream`).

**Round is allowed only where round is the function**: Breathe's
breathing circle, Focus's timer ring, the Spin wheel and its slices,
Sjökort's on-map markers, and inside Knuff's canvas its rings (hot, the
thump, a blast's reach) and its round intruders. Not for buttons,
badges, avatars or dots.

**Sizes.** Anything a finger presses is 44px (`min-h-11`); chips grow to
44px by themselves on `pointer: coarse`. Text inside an `<input>` is 16px
(the `field-chunk` default) — iPhones zoom the page on anything smaller.

**Keys that swap in.** When one key takes another's place (Start becomes
Pause or Stop), the second tap of a double tap lands on the newcomer.
Put `press-guard` on what swaps in: it ignores the pointer for its first
400ms. If it is ONE element changing role in place, swap between
`press-guard` and `press-guard-alt` (a change of animation name restarts
the guard). Do not give the two roles separate React keys: that replaces
the element and throws keyboard focus away. The same goes for anything
that lands under the finger: a panel that appears or leaves and moves
the keys below it (Sudoku guards its keypad column), a list that opens
where the key was (the search palette's rows), a row that slides up when
the one above is removed (Advice's kept lines). The guard works by
ignoring the pointer, so the tap falls through to whatever is behind:
put it on a thing with a harmless background, never on a panel floating
over a map.

**Keys that close.** The opposite case: a key closes its panel and what
lay underneath is now under the finger (Sjökort's chart under the
planner's close key). The press guard is no use there, because the thing
to protect is the thing behind. Call `swallowPresses()` from
`lib/pointer.ts` in the handler that closes: an invisible sheet takes
every press for 0.4 s. Dialog does this itself when it is closed by a
press.

**Page scroll.** A dialog locks the page with a class on `<html>`
(`dialog-open`), counted across open dialogs. Do not save and restore
`html.style.overflow` in new code: the older game routes still do, and
two owners of one inline value write each other's stale copy back. A
game route locks the page the way Knuff's does: `game-open` on `<html>`
(`html.game-open` in `app/globals.css`, beside `html.dialog-open`), put
on when the route mounts and taken off when it unmounts, with nothing
saved or restored. That is the pattern for a new game route.

**Page shortcuts.** A shortcut on `window` hears every key, including
the ones meant for whatever has focus. `lib/keyboard.ts` answers whose
key it is. For a Space shortcut call `claimSpace(e)` and act when it
says yes: it stands down for text fields and for a control the visitor
*walked to with the keyboard* (Space presses that), and takes the key
back from a button that only kept the focus from a mouse click (click
"Worth keeping", press Space, the next line comes). It also ignores
links: the footer's links stay focused across page changes. For any
other key, and for paste listeners, `isTextEntry(e.target)` is the one
test: it is true for text fields only, not for chips, sliders or the
dropzone, which are inputs too. Dialog already keeps plain keydowns
from reaching the page (pass `passKeys` for a dialog with nothing to
type into), and its focus trap counts a radio group as one Tab stop.

**Forced colours.** The frames, the lit state and the focus ring are
drawn as backgrounds, which Windows High Contrast repaints. The kit has
one `@media (forced-colors: active)` block that gives each back as a
real outline in the system colours. A new chunk needs a line there.
The focus band is drawn 2px outside a chunk, on the page. The homepage
room is the exception: its floor is canvases, which this mode leaves
dark, and Highlight on near-black cannot be seen in a light theme, so a
key in the room (`[data-home="room"]`) draws the band inside itself.

**Dev trap.** After editing `app/globals.css`, check the stylesheet the
dev server actually serves (curl the css chunk and grep for the rule).
Turbopack sometimes misses a write; a second write fixes it.

**Gone, do not bring back**: `rounded-full` / `rounded-md` / `rounded-[12px]`
on controls, `border-2 border-ink`, `border-dashed`, `shadow-chunk`,
`bg-ink/50` scrims, `backdrop-blur`, and `rounded-[var(--radius-card)]` /
`rounded-[var(--radius-button)]` (the two tokens were 0px, so the
utilities were no-ops; the tokens are deleted now).

A dev-only bench at `/lab/kit` shows every piece in every accent.

**Fonts** (loaded in `app/layout.tsx`): Jersey 15 (`--font-display`,
big display only — it ships weight 400 only, `globals.css` normalizes
bold rendering), Chivo Mono (`--font-sans`, all body copy), Silkscreen
(`--font-pixel`, micro-labels and badges).

**Two exceptions**, both sanctioned and both for the same reason — the
colour is doing a job the skin cannot do:

- **Sjökort's** on-map colors are pinned map-anchored values (a nautical
  chart is dark-on-light) — don't re-skin them.
- **Greyrot's** world inside its canvas is warm and saturated, and that is
  mechanical, not leftover. The game's antagonist IS desaturation: enemies
  read as ashen against a warm world with no outlines or nameplates, and
  winning literally pushes colour back into the frame through `post.ts`'s
  saturation uniform. Phosphor-on-dark would delete the game's primary
  feedback loop. Nattöppet still owns everything around the canvas.

## The three house rules (internal — not displayed, still load-bearing)

These aren't shown on `/about` anymore (Hugo trimmed it to a hero +
"things you won't find here" — sparse on purpose). They still hold as
the working constraints when you build:

1. **One thing, sharply** — if a tool grows past one thing, it splits.
2. **Quiet by default** — no analytics, no accounts, no third-party
   scripts, no cookie banner.
3. **Open a tab, use it, close it** — no onboarding, no settings buried
   in menus.

There are no exceptions to (2) anymore: the multiplayer games (Munch,
Noodle) and their shared WebSocket server were retired 2026-08, so the
whole site runs client-side (sjökort's sanctioned tile fetches aside —
see rule 4). Overrun, the surviving game, is single-player and needs no
server.

The on-`/about` brand voice was rewritten 2026-07-04 (Hugo's notes,
two rounds). It lives in three pieces in `app/about/Client.tsx`: the
**dictionary-entry hero** ("about" eyebrow → "lekstuga" → "noun ·
swedish · [lek·stoo·ga]", no definitions — the word stands alone),
the **"potentially useful." keycap** (Hugo's line, echoing the
footer: "potentially" is a pressable btn-chunk that blips through
HEDGES — occasionally/technically/allegedly/… — while "useful."
stays put), and the *Things you won't find here* **dust
silhouettes** — eight dashed pixel outlines on a toy shelf, the
spots the absent things would occupy (labels + taped notes, e.g.
VENTURE CAPITAL / "didn't fit through the door"). Hover one and it
dimly tries to materialize in its would-have-been accent, then
dissolves. The silhouettes and the keycap are page art — they
deliberately do NOT reuse the map's motifs; this page stays
visually unique. All three pieces carry the wink — treat them the
same way as the rules: don't quietly reword without asking.

## The catalogue

**9 tools + 5 games**: advice, breathe, focus, lorem, pixla, roll,
sjokort, strip, sudoku + overrun + adventure + greyrot +
survival-maxx + knuff. (8 tools survived the
2026-07-02 curation cull; pixla joined 2026-07-03; overrun — the
single-player RTS, ported from Hugo's separate CrazyGames project —
joined 2026-08-05. Its engine lives in `lib/overrun/`; the upstream
game repo keeps evolving separately for CrazyGames, so don't try to
sync them. **Adventure** — the top-down ten-world action adventure
starring Hugo himself — joined 2026-08-13; its engine lives in
`lib/adventure/` (pure 60 Hz sim + canvas renderer, all content
authored data in `lib/adventure/content/`, suites in
`test/adventure/`), and it follows every Overrun platform pattern:
fixed-timestep loop, all-synth WebAudio, keyboard + touch, reduced
motion changes presentation but never timings.
**Greyrot** — a real-time action adventure in low-poly 3D, and the only
3D thing on the site — joined 2026-08-23, ported from Hugo's second
abandoned CrazyGames project (`~/Claude/Projects/game2`). See its own
section below; that repo is cold, so unlike Overrun there is no upstream
to sync with.
**Survival Maxx** — an arena survivor in 3D (the second three.js game)
— joined 2026-09-09, ported from Hugo's third CrazyGames project
(`~/Documents/ChatGPT/Crazy games - Game 1`, which keeps evolving for
CrazyGames on its own; the site copy is its own line — don't sync). See
its own section below.
**Knuff** — a one-thumb arcade game in 2D: you pull Hugo back on a band
and let go — joined 2026-11-14. It was written for the site from a spec
and a feel toy the owner tuned by hand, so there is no upstream. Its
engine lives in `lib/knuff/`; see its own section below.
The multiplayer games munch + noodle were shut down 2026-08 — not fun
enough — taking the WebSocket server and the Fly.io app with them.)
The retired tool slugs (case, cleantext, convert, diff, pdf, qr, read,
typing, stretch) 308-redirect to `/?retired=<slug>` in `next.config.ts`,
and the retired game slugs (munch, noodle) do the same from
`/games/<slug>` — HomeShell greets the broken bookmark with a quip.
Don't reuse a retired slug for something new.

## Source-of-truth files

- `lib/tools.ts` — tool registry (slug, title, tagline, description, color, emoji)
- `lib/clusters.ts` — `pathFor()` resolver for /tools vs /games routing.
  The file is named after the old cluster system — visible categories
  on the homepage map were retired. Only the path helper remains.
  `lib/links.ts` is also gone (was the inter-tool edge map for the
  old clustered homepage); the swarm doesn't need it.
- `lib/colors.ts` — single source for the 8 accent colours (+ `INK_HEX`
  / `CREAM_HEX` literals for canvas code that can't read CSS variables)
- `lib/site.ts` — the site's address, name and tagline, and
  `toolMetadata()` / `pageMetadata()`: what a page says about itself in
  its `<head>` (see "Tool page shape")
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
   decorative: games are magenta (overrun = pink), brainy tools
   are violet/ice (sudoku = purple, sjokort = teal), calm tools are
   mint/cyan (focus = green, breathe = blue), quick warm utilities take
   the warm range (roll = orange/amber, strip = tomato/coral, lorem +
   advice = yellow/acid). A new tool picks its colour by family first.

## Tool page shape

Every tool is three files:

- `app/tools/<slug>/Client.tsx` — `"use client"`, the actual UI
- `app/tools/<slug>/page.tsx` — server-component wrapper that exports
  `metadata = toolMetadata("<slug>")` (from `lib/site.ts`) and renders
  `<Client />`
- `app/tools/<slug>/opengraph-image.tsx` — one-line wrapper around
  `renderToolOG("<slug>")` from `lib/og.tsx`, under a first line that
  carries the card's fingerprint (see "The card's address" below)

Same shape for the games at `app/games/<slug>/`.
The split is so each page ships its own `<title>` and `<meta description>`
— client components can't export `metadata`.

**What a page says about itself.** `toolMetadata` builds the page's
whole share block from its registry entry: the canonical link and
og:url are the page's own address (spelled as `app/sitemap.ts` spells
it), and the title and description are the same text in `<title>`, the
og: tags and the twitter: tags. It has to say all of it, because Next
merges a page's metadata into its layout's one level deep: a page that
sets `openGraph` replaces the layout's whole object. For the same reason
the root layout says only what is true of every page. Never put a
canonical link or an og:url there: it carried the homepage's until
2026-11, and every tool, the 404 and the lab said they were the
homepage. The homepage sets its own in `app/page.tsx`. A page outside
the registry uses `pageMetadata({ title, description, path })`. Those
are the only places an address is written: under `app/`, a canonical
link or a share block by hand, anywhere but the layout, the homepage
and `/about`, fails `test/site/page-head.test.ts`.

The share image is not set by hand: Next adds the folder's
opengraph-image file to the page's share block. A page that sets
`openGraph` and has no image file of its own gets no picture at all, so
`/about`, which shows the site's, hands the layout's image on
(`app/about/page.tsx` is the pattern).

**The card's address.** The `?…` on an og:image address is a hash of
the wrapper file alone, not of `lib/og.tsx`, where the picture is drawn,
and caches keyed on the address go on showing the old card. So each
wrapper's first line carries the fingerprint of the picture it draws
(`// Picture 1a2b3c4d: …`). When a card's picture changes (a change in
`lib/og.tsx`, or a tool's title, tagline, colour or icon),
`test/site/share-image-address.test.ts` fails and says the new
fingerprint; writing it into the wrapper is what gives the card its new
address. The site image (`app/opengraph-image.tsx`) is held the same
way. Its fingerprint is still kept in that suite and not in its file,
because its address had to stay when the cards got theirs; it moves
into the file the next time its picture changes (the suite says how).

**The words on a card** are set in a hand-drawn face (GLYPHS in
`lib/og.tsx`: capitals, figures and a few marks). A character it does
not have is drawn as a solid block, and a letter it has only without
its accent is set without it, so draw the glyph: rows of `X` and `.`,
all as wide, seven from the cap line to the baseline.

`test/site/` holds all of this: what each page says about itself
(`page-head`), that an image's file follows its picture
(`share-image-address`), every word the images set and the glyphs they
are set in (`share-image-words`), and the mascot's copies in the icons
and the share images against the real painter (`mascot-copies`).

## Shared components (use, don't reinvent)

- `components/ToolFrame.tsx` — tool page chrome: one slim title row
  (back key, icon tile, name, tagline) and the page's `--accent`
- `components/ui/*` — the kit (see "The kit" above): Keycap, Chip /
  ChipGroup, Panel, Tag, IconTile, TextField / TextArea, Switch, Dialog,
  Dropzone
- `components/PixelIcon.tsx` — the 12×12 icons
- `components/Footer.tsx` / `ConditionalFooter.tsx` — the index footer
  (see below)
- `components/HomeShell.tsx` — the homepage: the room in a window at
  least 48rem by 35rem, the list in anything smaller (CRT power-on,
  scanlines, hints, the corner keys, retired-slug quip)
- `components/ToolMap.tsx` — the room's swarm and arcade row (see below)
- `components/HomeList.tsx` — the list homepage: phones, and any window
  too small for the room (cabinet cards, keycap pad)
- `components/CabinetCanvas.tsx` — one arcade cabinet with its screen
  playing, as a standalone canvas. It paints one picture at mount and
  then plays only while it is near the window, so the list's cabinets
  draw nothing while the room shows
- `components/Slider.tsx` — labelled range (pixel label, big value,
  accent-filled track)
- `components/CustomMinutes.tsx` — "Custom — N min" chip (focus)
- `components/Search.tsx` — ⌘K palette (mounted in the root layout).
  Built on Dialog. It matches a query against title, tagline,
  description, the address (`/roll`) and the kind (`game`, `tool`),
  ignoring diacritics, so "sjokort" finds Sjökort. Rows select on mouse
  *move*, not enter: a pointer resting on the list must not steal the
  selection from the arrow keys.
- `components/BrandDot.tsx` / `BrandCorner.tsx` — corner Hugo (see below)
- `components/TravelingDot.tsx` — flight-layer Hugo (root layout)
- `components/HugoRoom.tsx` — Hugo's room overlay (shift+click him)
- `components/hugo/HugoStage.tsx` — Advice-page Hugo with poses
- `components/hugo/HugoParkour.tsx` — the homepage platformer


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

Two files cannot import it and carry a copy of him in coral:
`app/apple-icon.tsx` (kept import-free, its comment says why) and
`app/icon.svg`. The share images (`lib/og.tsx`) import his rows, his
palette and `RESTING_PUPILS`, and place the boxes themselves.
`test/site/mascot-copies.test.ts` has the real painter draw him at rest
and fails when any of the three stops matching it, cell for cell: change
the sprite and the copies have to follow.

One more drawing of him is deliberate and is not a copy: Knuff's icon in
`lib/pixel-icons.ts` is a simplified 12×12 Hugo on a band (his body is
14×12 and does not fit an icon). It is not held to the painter.

**`lib/hugo-state.ts` is his brain**: mood (sleepy/calm/curious/
excited/grumpy), energy, visit streaks, `firstSeen` — persisted at
`hugoslekstuga:hugo:state:v1`, read via the `useHugoState` hook. The
write is a 2s throttle plus one on `pagehide` and when the tab is
hidden. Keep it a throttle: his tick changes the state four times a
second, and as a debounce the write never fired, so nothing he
remembered survived an ordinary visit (fixed 2026-11). Tools feed it
moments (`hugoMoodEvent`, `hugoSawTool`); renderers read it.

**Where he renders:**

- `BrandDot` (inside `BrandCorner`, root layout — every page) — 36px
  sprite canvas. Behaviours: persisted colour cycling on click,
  proximity lifts his eyelids, idle blinks, swarm-hover gaze tracking,
  drag-and-spring with sparkle puff, spam-click play-dead with
  whole-page tantrum, Konami-code somersault, shift+click opens
  HugoRoom, tab-hidden sleep, and on `/` a **long-press starts
  Hugo's Parkour**. (The old long-press leash is deleted.) From the
  keyboard, Enter or Space is a tap and Shift+Enter is a shift+click;
  a click that did not come from a pointer (a screen reader's
  "activate", voice control) is a tap too.
  While a page-level Hugo has the stage, or a full-screen game is
  drawn over him (any `/games/` route), he is out of the Tab order,
  aria-hidden and deaf to keys. His memory is shared between open
  tabs (a tab folds another tab's counters into its own before it
  writes).
- `TravelingDot` (root layout) — canvas Hugo who flies out of the
  corner when you click a swarm tool, fetches it, returns. He flips
  horizontally to face travel direction — never rotates.
- `HugoStage` (Advice page) — big Hugo with poses: idle / thinking /
  delivering / declining / celebrating.
- `HugoParkour` (homepage) — playable Hugo (see below).
- Knuff (`/games/knuff`) — the game's Hugo, drawn by `drawHugoSprite`
  in the visitor's colour. The sprite's `outline` option (the body
  cells with an empty neighbour, and the eyes) is his look while
  nothing can hurt him; the game's rings are its own drawing.

Only one Hugo exists on screen at a time: page-level Hugos announce
themselves via `hugo-stage` / `hugo-traveling` events and the corner
yields.

## Hugo's event surface

All `window` CustomEvents, prefixed `hugoslekstuga:`:

| Event | Payload | Meaning |
|---|---|---|
| `hugo-happy` | — | Celebrate (eyes wide + sparkle puff). Fired by Sudoku win, natural Focus completion, parkour win, a Knuff night that reaches morning (not a new best score alone). Keep the bar high — it should mean something each time. |
| `hugo-stage` | `{ present: boolean }` | A page-level Hugo (HugoStage, HugoParkour, Knuff's route) exists; BrandDot hides its corner sprite while `present`. |
| `dot-travel` | `{ fromX, fromY, toX, toY, color, navColor, duration }` | Make TravelingDot fly between two screen points. ToolMap uses it for the swarm→corner fetch-and-return. |
| `hugo-traveling` | `{ traveling: boolean }` | Fired by TravelingDot mid-trip; BrandDot + ToolMap listen so there's one Hugo on screen. |
| `dot-arrived` | — | TravelingDot landed on a tool page; ToolFrame times its entrance off it. |
| `dot-nudge-target` | `{ x, y } \| null` | ToolMap tells TravelingDot where the clicked orb's landing spot is. |
| `tool-hover` | `{ x, y, slug, tagline } \| null` (rAF-rate) | ToolMap broadcasts the hovered orb or cabinet; BrandDot's eyes track x/y, HomeShell swaps the hint under the marquee for the tagline. |
| `wordmark-layout` | `{ bottom } \| null` | PixelWordmark published a fresh layout; HomeShell parks the attract hint just under the marquee. |
| `parkour-start` / `parkour-end` | — | A parkour run begins/ends. BrandDot dispatches start on long-press; ToolMap suppresses click-nav + idle fetch during a run; HomeShell swaps the hint for the controls (along the top) and quiets the corner keys. HugoParkour sends `parkour-end` (and `hugo-stage` `{ present: false }`) once per run, also when it is unmounted mid-run: the window left the room's size, or the visitor went Back. |
| `open-search` | — | Opens the ⌘K palette. The homepage's Search key dispatches it. |
| `storage-write` | (internal) | Fired by `use-local-storage-state` for same-tab sync. Not a Hugo event — don't dispatch it yourself. |

## Hugo's Parkour

Long-press the corner Hugo on `/` and the room grows gravity — and
since 2026-07-04 the homepage is only the **first screen** of a
two-level adventure. Level 1 on foot ("closing time at the arcade"),
level 2 on a **moped** ("the ride home"). Five modules:

- `components/hugo/HugoParkour.tsx` — the React shell: events, input,
  the fixed-timestep loop, DOM reads, level switching, the NEXT LEVEL
  transition, the win overlay.
- `lib/hugo/parkour/physics.ts` — the simulation. Pure step functions
  over a unified `Surface` type (orb = curved drifting top, rect =
  flat top, ramp = sloped top that launches `vy = -k·vx` off its
  lip). Two sibling steppers: `stepPlayer` (on foot) and `stepMoped`
  (momentum: slow throttle to 7.5px/step, 125px braking distance,
  ONE fixed-height jump, no air jump, drive-onto mounting).
  **Everything is tuned at 60 steps/sec**; the loop simulates on that
  fixed clock (accumulator, catch-up capped, render interpolated
  between steps) so a 120Hz display gets the same game — never step
  physics per rAF.
- `lib/hugo/parkour/level.ts` — level 1, floor-anchored px baked
  against the live viewport at run start. Zones: behind the marquee →
  cabinet graveyard → the vents → neon rooftop, ending at **NEXT
  LEVEL** (magenta monument, `goal.final: false`). On-foot guardrails
  in the header (single gap ≤135px, double ≤240px, step-up ≤110px).
- `lib/hugo/parkour/level2.ts` — level 2, the phosphor city at night:
  the alley → full-throttle boulevard canals → the brake-early
  construction site → the big kicker onto the highway (safe lower
  lane with its own kicker) → the harbor (barge, pontoon, and the
  pier where **YOU'RE INVITED** hums, `final: true`). Fully authored —
  no DOM reads, no homepage handover. Moped guardrails in the header
  (jump reach 117→285px by speed tier, kicker carry ~340 at full vs
  ~200 at half — gaps are authored per speed tier; min platform 60px).
- `lib/hugo/parkour/render.ts` — canvas painters: terrain, decos, a
  hand-rolled 3×5 pixel font (caps + the digit 2), the beam, the
  parameterized goal monument, the LEVEL 2 card, the headlight cone.

Hugo rides via `drawMopedHugo` in `lib/hugo/sprite.ts` (the one
sprite module — pitch is whole-cell offsets, never rotation).

Screen 0 still reads the room per-step from the DOM — the drifting
orbs (`data-slug` / `data-r` on ToolMap's `<g>`s, circles) and the
arcade row's cabinets (the same `<g>`s with `data-w` / `data-h`: their
flat top is a one-way platform) — and the wordmark letters
from `lib/wordmark-bridge.ts` — the level IS the homepage until you
leave it (camera latched, 220px crossfade handover to canvas
replicas at identical coords, reversible). Touching NEXT LEVEL plays
a reverse beam + title card, then sets Hugo down astride the moped
at street level; ticks reset per level entry so movers and the beam
replay deterministically.

**Death rule: dying restarts the current level — reaching the city
is the game's only checkpoint.** Keep every hazard readable. YOU'RE
INVITED (end of level 2) is the only thing that wins: it fires
`hugo-happy` (still rare) and the panel's keycap links to
**https://getlegacies.com/beta** (Hugo's day job — a plain outbound
`<a>`, the only external link the game adds; privacy rules intact).
"again" restarts from level 1. Reduced motion: no beams, snap
camera, instant backdrop, the LEVEL 2 card holds as a static frame
then cuts. Esc quits from anywhere, including mid-transition.

**Desktop-only, deliberately.** The trigger is gated to
`(hover: hover) and (pointer: fine)` — the game has no touch controls
and Esc is the only exit. It also only exists in the homepage's room
layout: in a window smaller than the room (48rem by 35rem) HugoParkour
is not mounted, so a long-press in a narrow or short desktop window
starts nothing, and a run that is on when the window shrinks past that
size ends. Any future affordance that hints at it
(e.g. a "hold me" whisper) must share that gate so touch users are
never teased with a game they can't play.

## Advice — Hugo's flagship

`/tools/advice` is where Hugo has the most personality. The page asks
`lib/advice-engine.ts` for "the next line Hugo hands over":

- a recency window so lines don't echo
- a deterministic "one for today" first draw per calendar day
- tone bias from Hugo's live mood (grumpy leans blunt, sleepy warm)
- told-you-this-before memory, the decline (he refuses after enough
  draws in one sitting), and a kept list

Advice data lives in `lib/advice.ts` as `{ id, tone }` entries.
All engine persistence is one key: `hugoslekstuga:advice:memory`.
HugoStage performs the draw (thinking → delivering → …). Treat the
engine as the only draw path — don't sample `adviceEntries` directly.

## The homepage — a room and a list

The homepage is built twice from the same parts, and the window's size
picks which: the room needs 48rem by 35rem (768 by 560px at the usual
text size, and never less than that in px, because the room's parts are
drawn in px). One question, asked in two places that must agree:
`ROOM_MEDIA` in `lib/home-layout.ts` (HomeShell reads it with
matchMedia and mounts the swarm) and the stylesheet's `room:` / `list:`
variants in `app/globals.css` (they show one wrapper and hide the
other). The two numbers and the reason for 35rem live beside
`ROOM_MIN_HEIGHT_REM`; the stylesheet carries a copy of the query, and
`test/home/room-media.test.ts` fails when the copy drifts. Use `room:`
and `list:` wherever the two layouts differ, never `md:`, which knows
the width only (a phone held sideways is wide enough and far too short).

**In a window at least 48rem by 35rem: the room** — one screen, no
scrolling, styled as an arcade attract screen. `components/ToolMap.tsx`
draws two kinds of thing that behave differently on purpose:

- **Tools are orbs.** A swarm above the floor: a pull toward the middle
  of the free band, a mutual repel, a slow wander, drag-to-fling,
  click-to-open. The repel is *derived* from the room's size
  (`repelFor`), so the swarm fills the same share of the room on a
  tablet and on a 1080p monitor. Orbs are clamped by their **label**
  width, not their radius, and are kept out of the title, the hint
  under it, the corner mascot and the top-right keys (`Zone`s). Each
  wears its 12×12 pixel icon.
- **Games are furniture.** They stand in a row along the floor at about
  twice the size and stay put (`cabinet: true` nodes: no physics, no
  drag; the forbidden button makes them hop). `drawArcadeCabinet` in
  `lib/hugo/sprite.ts` draws the machine on a 38×42 grid, and each
  screen plays a small scene from its own game — painters in
  `lib/hugo/cabinet-screens.ts`, pure `(put, t)` functions on a 30×16
  grid. **A new game needs a painter there**, or it shows the idle
  screen. Where the row stands comes from `cabinetRow()` in
  `lib/home-layout.ts`; the title and the hints read the same numbers.

Every orb and every cabinet is a real SVG link (`<a href>`) around the
`<g>` the parkour reads, so the room works with a keyboard, a screen
reader and a middle click. Besides the soft `Zone`s there are hard
keep-out boxes (`Keep`s: the title, the hint, the keys, the mascot): an
orb put down or flung into one is walked out. The swarm takes one step
a frame, as it always did; only that walk keeps wall-clock pace, so a
slow machine still clears the title. Under reduced motion the swarm is
shown at rest and its frame loop stops. During a parkour run the
controls hint is found by `data-parkour-hint` and measured by layout
offsets, and no orb rests across it.

Two layers, as before: a **trail canvas** under the SVG (each orb
leaves phosphor smears: a `rgba(7,8,15,0.5)` decay wash per frame) and
the **SVG** on top with transparent hit targets, names and the NEW tag.
Clicking an orb or a cabinet dispatches `dot-travel` (Hugo fetches it).

Search and About are **keys in the top-right corner**, next to the
square DO-NOT-PRESS keycap. They used to be two more orbs in the swarm,
which made doors look like toys. HomeShell also adds the
once-per-session CRT power-on (`sessionStorage` `hugoslekstuga:crt-on`)
and `.scanlines`.

**In anything smaller: the list** — `components/HomeList.tsx`, a short
scrolling page: the title as a banner, games as cabinet cards
(`components/CabinetCanvas.tsx`, the same machine with its screen
playing), tools as a three-by-three pad of keycaps in their own
colours, then the keys and the footer's small print. It is real links
in the server-rendered HTML. **No swarm and no parkour are mounted on the
list**: ToolMap, the room's PixelWordmark and HugoParkour only exist
when the room is on screen. The list itself is in the page in both
layouts (it is the server-rendered HTML), so nothing in it may work
unseen: its banner stops its loop and its cabinets stop playing while
the room shows. The two one-shot animations (the power-on's class, the
forbidden key's flicker overlay) are taken off when they have played: a
wrapper that is hidden and shown again would play them again.

**The marquee** — `components/PixelWordmark.tsx` draws HUGOS LEKSTUGA
as quantized phosphor pixels (Jersey 15 sampled once to an offscreen
canvas — `ctx.font` can't read CSS vars, so the concrete family is
resolved off a `font-display` probe span, gated on `document.fonts`).
In the room it is centred in the band above the arcade row
(`bottomInset`); in the list it is a `banner` that centres in its own
box and publishes nothing. Letters ignite left→right after power-on,
shimmer at rest, flicker like a tired neon sign, shove aside near the
cursor (snapped to the grid), and blip when clicked. The canvas is
pointer-transparent; it listens on `window` and hit-tests itself.
Base cell rects never animate — they're published through
`lib/wordmark-bridge.ts` (viewport coords, setter + read-only
getters): ToolMap reads the block rect to keep orbs off the title,
HugoParkour reads the per-letter rects as flat one-way platforms
(behind its `LETTER_PLATFORMS` const). The blinking "press any tool"
hint sits under the marquee (positioned via the `wordmark-layout`
event); hovering a tool or a cabinet swaps the hint for that thing's
tagline. Reduced motion = one static, fully-lit draw, and every
cabinet screen holds one still frame.

**Measurement rule:** ToolMap, HomeShell and PixelWordmark measure
with `offsetWidth`/`offsetHeight`, **never** `getBoundingClientRect` —
the `.crt-on` scaleY animation squashes gBCR mid-power-on and poisons
the whole layout.

## The footer — an index

`components/Footer.tsx` is a compact index of the whole site: a Games
row and a Tools row with a link to every registry entry (it reads
`lib/tools.ts`, so a new entry shows up by itself), an About link, the
line "No tracking, no accounts.", the year, and "potentially useful".
That last phrase is brand voice (the About page's keycap echoes it):
leave it exactly as it is.

- It sits on the page column (`page-col`, 48rem), so its left edge is
  the left edge of the tool or About page above it.
- The link for the current page carries `aria-current="page"`. Links
  are 44px tall under a finger and 28px under a mouse, and they do not
  prefetch (with the whole index in view, every page would otherwise
  pull every other route in the background).
- `components/ConditionalFooter.tsx` decides where it shows. Never on a
  full-screen route (sjökort and every game: the list comes from the
  registry). On the homepage: nothing where the room shows (it is one
  screen), and only the small print on the list, because the list is
  itself the index. It is hidden with `room:hidden`, the same variant
  HomeShell's two layouts use.

## Greyrot — the 3D one

`/games/greyrot`, ported 2026-08-23 from `~/Claude/Projects/game2`. A
real-time action adventure: you are **Pim**, the smallest sporeling in
Hollowstump, and the Greyrot is a grey mould that drains colour rather
than killing. Reference points were *Magicka 2* for the combat and
*Murloc RPG* for the shape.

**What ships is Chapter 1** — 12 stages, 9 foe kinds, one boss
(`thornback`), ~15–25 minutes, ending at the camp gate with "the road
ends here, for now". Chapters 2+ exist only in `game2`'s docs. The
original repo is cold: there is **no upstream to sync with**, unlike
Overrun. Fix things here.

**The engine** lives in `lib/greyrot/`, and the layout is game2's, not
the site's usual: `main.ts` (the campaign, ~1800 lines, the app layer),
`loop.ts`, `sim/` (pure, 30 Hz), `render/` (three.js), `ui/` (real DOM),
`content/` (typed authored tables), `audio/`, `input/`, `app/`,
`platform/`.

Things that make it unlike the other two games:

- **It is 3D.** `three` is the site's only 3D dependency, imported
  through a dynamic `import()` inside `Client.tsx`'s effect so the
  ~119 KB gz chunk never reaches the initial payload — not even on the
  game's own page. Post-processing and orbit controls are hand-rolled;
  nothing from `three/examples/jsm` is used, so no `transpilePackages`.
- **Zero assets.** Every mesh, texture, sound and particle is generated
  at runtime. Meshes come from a DSL in `render/mesh/dsl.ts` with a
  hash-based regression fixture.
- **Its HUD is real DOM, not canvas.** Four classes (`Hud`, `SpellHud`,
  `Seam`, `Dialogue`) append into the `#ui` root and inject their own
  prefixed stylesheets there. Which is why the route renders a
  `<canvas>` **and** a sibling `#ui` div.
- **`#ui` has `pointer-events: none` and no blanket rule giving it
  back.** Do not "tidy" this. A `#ui > * { pointer-events: auto }` has
  specificity (1,0,1), beats `.sp-root`'s (0,1,0), and — because
  `.sp-root` is full-viewport — shields the entire canvas. Measured
  when it existed: the virtual stick moved the hero 0.0000 m over 40
  held ticks, touch mode never latched, and a touch pilot stood still
  for 1,865 ticks. It never looked wrong in a screenshot. Every
  interactive HUD element declares its own `pointer-events: auto`.
- **It must stay full-bleed.** Six world→screen projection sites read
  `innerWidth`/`innerHeight`. Correct while the canvas is the viewport;
  wrong the moment anyone letterboxes it.
- **Its palette is a sanctioned exception** — see "The skin" above.

**What the port changed**, all of it because a CrazyGames page never
unmounts and a Next route does, twice under StrictMode:

- `boot()` → `createGreyrot(canvas, uiRoot, opts)` returning a handle
  with `destroy()`. The site's factory shape.
- **A teardown path, which did not exist.** `loop.stop()` (there was no
  `cancelAnimationFrame` anywhere in game2), `SpellInput.detach()`,
  `AudioSystem.dispose()`, `renderer.forceContextLoss()`, and a
  `disposers` list every listener registers through.
- The CrazyGames SDK wrapper is **gone**, replaced by
  `platform/local.ts` — the same `Platform` interface over localStorage.
  `getPlatform()` is lazy so nothing runs at import time.
  `architecture.test.ts` now asserts the SDK is nowhere at all.
- `browser-quirks.ts` scoped its `wheel`/`keydown`/`contextmenu`
  preventDefaults from `window` to the **canvas** — on a real site the
  originals killed page scroll and right-click everywhere.
- **Escape quits** (game2 left it unbound; CrazyGames owned it for
  fullscreen), and the seam panels carry a BACK TO PLAYHOUSE action.
- **Reduced motion, which game2 had none of.** `render/motion.ts` is
  Adventure's module with Greyrot's key. It suppresses camera shake,
  snaps the traversal↔combat framing transition, and drops the
  resaturation *sweep* — but NOT the resaturation itself, because
  colour returning is the game's primary feedback, not an ornament.
  Sim timings never change; `sim/` is structurally barred from
  importing `render/`.
- Fonts: game2 declared none. `fonts.ts` resolves Chivo Mono +
  Silkscreen off probe spans, as Overrun and Adventure do.
- **A fullscreen button** — the site's first, so this is the pattern.
  Third in the top-right stack under mute and motion. It fullscreens
  `document.documentElement`, NOT the game's wrapper: fullscreening an
  element makes it the containing block for its `position: fixed`
  descendants, and the entire HUD is fixed inside `#ui`. It hides itself
  where `document.fullscreenEnabled` is false (iPhone Safari gives
  fullscreen to `<video>` only) rather than sitting there inert, and it
  reads its glyph off `fullscreenchange` so F11 and Escape keep it
  honest. No resize plumbing: `resize()` already runs every frame and
  no-ops unless the backing size changed.
  **Escape is guarded** — in fullscreen it leaves fullscreen and does
  NOT also quit, because the browser exits fullscreen on that press
  regardless of `preventDefault`, and spending two intentions on one
  keystroke is a bug. The next Escape quits.
- The ad economy is inert — `ADS_ENABLED` in `app/economy.ts` was
  already `false`, so no offer ever renders. `economy.ts` is kept
  rather than surgically removed from `main.ts`'s six call sites.

**Tests**: `test/greyrot/` — 17 suites from game2 plus `port.test.ts`
for the four seams above. All pure-sim, node environment, no jsdom. The
dev handle is `window.__greyrot`, dev-only, with `step(n)`, `render()`,
`teleport()`, `spawn()`, `setAutopause()` — note the game **pauses on
blur**, so headless driving wants `setAutopause(false)`, and a hidden
tab gets no rAF at all (drive it with interleaved `step(1)`/`render(0)`
or the camera lags the hero).

## Survival Maxx — the arena survivor

`/games/survival-maxx`, ported 2026-09-09 from
`~/Documents/ChatGPT/Crazy games - Game 1` at that repo's 0.8.0. You move
and dash; weapons aim and fire on their own; between waves a shop sells
weapons, items and drones, and two matching pieces at the same rank
merge into the next rank. Thirty waves, a boss every third; ten
characters unlock in order by clearing the campaign; a cleared character
also gets an **Endless** option on the roster (a fresh wave-1 run with
no finish line). Everything is procedural: meshes, portraits, particles
and audio are generated at runtime, so there are no assets and no
fetches.

**The engine** lives in `lib/survival-maxx/`, flat, in the upstream
layout: `model.ts` (the run, a fixed 60 Hz sim with its own seeded
random), `content.ts` (every table), `progression.ts` (unlocks),
`review.ts` (the diagnostic pilot the tests and
`scripts/survival-maxx-balance.ts` drive), `scene.ts` + `meshes.ts` +
`hero-rigs.ts` + `equipment-art.ts` + `geometry.ts` + `weapon-pose.ts`
(three.js), `ui.ts` + `style.css` (the interface is real DOM, a
1280×720 stage scaled to fit), `audio.ts`, `controls.ts`, `motion.ts`,
`platform.ts` (localStorage) and `main.ts` (the factory).

Things that make it unlike the other games:

- **Its interface is a stylesheet, not injected strings.** `style.css`
  is 3.9k lines and every selector is `.rz-` prefixed; the route's
  `Client.tsx` imports it as a global stylesheet (the sjökort route does
  the same for maplibre's). Only the old page-shell rules were rewritten,
  as the `.sm-` block in `main.ts`.
- **It keeps its own typography and palette inside the stage** — a
  sanctioned exception in the Greyrot sense. Nattöppet owns the route
  chrome around it, which on this route is nothing: the game is
  full-bleed.
- **Keyboard input is bound on `window`** for the life of the mount (the
  route is full-bleed and the interface takes focus), and removed on
  destroy. Escape pauses in play, backs out of menus, and on the home
  screen leaves for the playhouse; `P` also pauses.
- **Equipment portraits are rendered once per page** into data URLs by a
  second, short-lived WebGL context (`equipment-art.ts`), cached at module
  scope in `scene.ts`.

**What the port changed**, all of it because a CrazyGames page never
unmounts and a Next route does, twice under StrictMode:

- The page-level script became `createSurvivalMaxx(root, { onExit })`
  returning `{ destroy() }`. It builds the arena, splash and touch
  joystick under `root`, and `destroy()` cancels the frame, unbinds every
  listener through a `disposers` list, persists progress, and disposes
  interface, renderer (`forceContextLoss`), audio and platform.
- The CrazyGames SDK wrapper is gone. `platform.ts` is localStorage under
  `hugoslekstuga:survival-maxx:save`, keeps the same method names as
  no-ops, and tolerates blocked storage by playing in memory with a
  notice. `test/survival-maxx/architecture.test.ts` asserts the SDK is
  nowhere, that the sim files never import three or touch the DOM, and
  that importing `main.ts` under Node is side-effect free.
- The global `bootstrap.css` (`html, body { overflow: hidden;
  touch-action: none }`, `*`, `#app`) became the scoped `.sm-` shell
  block; the touch joystick is positioned inside `root` instead of
  fixed to the viewport.
- BACK TO PLAYHOUSE actions on the home screen and the pause menu.
- The dev-only review tooling (`review-art/media/video.ts`, the Vite
  middleware) stayed behind; `review.ts` came along because the tests
  and the balance script drive its pilot.

**0.9 re-sync, 2026-09-09 (later the same day).** The site copy was
re-synced to the upstream 0.9.0 release, which folded the site's harder
curve into its own map-1 baseline and went further: every wave spawns a
fixed enemy budget shown as a countdown (the timer still ends it),
enemies arrive anywhere near the player after a telegraph ring with
hordes and elites, 24 weapons (12 new plus the unique Eclipse), 45
items (8 mods, 5 economy items, 10 drones), six-piece Set capstones,
bag slots for 2000 emeralds, a signature and downside per character,
ten maps as a per-character ladder (clearing map 1 still unlocks the
next character), and a nine-tab Game guide (`guide.ts`, pure). Saves are
version 3 under the same key; a version-2 site save migrates its cleared
characters as map-1 clears. New engine files: `guide.ts`,
`gear-icons.ts`, `equipment-parts.ts`, `*-art-expansion.ts`. The
site-only tweaks (factory `main.ts`, localStorage `platform.ts`,
`canExit` buttons, gear behaviour titles, the shared portrait cache,
`forceContextLoss`) were re-applied on top; the earlier hand-tuned
balance deltas are gone because upstream now ships a harder curve
(`ENEMY_CURVE` in `content.ts`). Balance evidence lives upstream in
`release/qa/0.9/BALANCE.md`; `scripts/survival-maxx-balance.ts` takes
`--map=all` and `--policy=weave,camper`. A re-sync from upstream is:
copy every `src/survival/*.ts` except `main.ts`/`platform.ts`, re-apply
the tweaks above, copy `tests/*.test.ts` with vitest imports and
`../../lib/survival-maxx/` paths, and rebuild `platform.test.ts` from
the site seam tests plus the upstream chain tests.

**0.9.1 re-sync, 2026-09-09 (evening).** Upstream 0.9.1 added a
projectile renderer (`projectile-art.ts`, `projectiles.ts`: per-weapon
bodies, trails, glows, hand-muzzle origin), a signature effect layer in
`scene.ts` for every weapon, drone and hero (new events `bounce`,
`burst`, `crush`, `strike`, `barrier`; `sounds()` in the factory
`main.ts` was re-copied from upstream), and a steadier difficulty curve
(58 s late waves, chapter health term, more elites, ranged groups, drone
stacking with diminishing returns). Same re-sync recipe as above; the
upstream dev review panel (weapon/drone selects) is not part of the
factory and was not ported. Balance gates live upstream in
`release/qa/0.9.1/BALANCE.md`.

**Tests** in `test/survival-maxx/`: the upstream suites copied with
vitest imports (simulation, economy, all ten earned campaigns into
Endless, hero and equipment surface audits, weapon poses, motion,
controls, layout), a local-platform suite, and the architecture suite.
The ten-campaign test carries its own four-minute budget; the config's
30 s `testTimeout` is for the geometry sweeps.

## Knuff — the one-thumb one

`/games/knuff`. Pull him back, let go. While he is fast (a white ring)
he pops what he touches; the moment he is not, he lands, and what
touches him takes a heart. One night of eleven hours (19:00 to 05:00)
and a boss at 06:00, the floor polisher; one score. Built for a phone
held upright; a mouse and keys also work.

**The engine** lives in `lib/knuff/`, in the shape of Adventure's:
`game.ts` (the factory: `createKnuff(root, canvas, opts)` returns a
handle with `destroy()`), `loop.ts`, `save.ts`, `sim/` (pure, 60 Hz),
`content/` (the night's timetable, the kinds, the charms, the tune, the
words), `bots/` (the scripted players and the balance table),
`render/`, `audio/`, `input/`.

Things that make it unlike the other games:

- **Its motion was tuned by hand in a toy.** `content/tune.ts` has two
  halves: `TOY`, copied from that toy, and `GAME`. Do not retype the
  toy's numbers. `test/knuff/feel-lock.test.ts` runs the toy's own
  simulation (copied untouched to `test/fixtures/knuff/toy-sim.ts`,
  which eslint leaves out) beside the game's: five scripted launches
  and the other flights beside them, the same position and speed to
  the last bit for every tick he is hot, and every motion knob of the
  copied half, changed either way, makes the two part. Where he stops
  being hot they part on purpose: the toy slides on, the game lands.
- **Slow motion is inside the simulation**, counted in ticks, so a bot
  and a thumb play the same game: the loop only asks `wouldSlow` how
  fast to feed ticks. Every rule time is in ticks.
- **The aim line is the real step run on a copy of the State.** There
  is no second motion loop to keep in step. If you add something that
  bends his path, the line follows by itself.
- **The whole page is the touch surface.** The canvas fills a root that
  carries the browser protections (no panning, no selection, no
  callout). The top bar and, on a phone, the thumb deck are drawn in
  the canvas; a pull may begin anywhere on the root.
- **Its panels are the kit's** (`Dialog`, `Keycap`, `Switch`,
  `ChipGroup`), rendered by `Client.tsx` from one view object
  (`KnuffView`, which `game.ts` reports when it changes, never per
  frame). Only the pause key is hit-tested on the canvas.
- **Its page lock is a class** (`game-open` on `<html>`), not saved
  and restored inline styles. New game routes should do the same.
- **He is drawn by `lib/hugo/sprite.ts`**, in the visitor's colour.
  The white ring is the game's; the sprite gained one option,
  `outline`.
- **The night is data, dealt at a pace.** `content/night.ts` is a
  timetable, one row for each group of things that arrive together.
  `pace` in `content/tune.ts` says how it is dealt: a row is called
  early when the room is nearly clear, and extra bunches follow until
  the hour's last call. `pace` and the numbers it gives (`PACE`:
  `paceTokens`, `paceLastCall` and the rest) are the difficulty dial,
  and the timetable's token rows after them. Tune those, not rules,
  with `npx tsx scripts/knuff-balance.ts`, which runs the scripted
  players through the real step and prints their table with pass or
  FAIL beside each floor and ceiling (`--whole` is the whole night,
  the table that gates; it exits 1 when a bound fails). Two rows are
  accepted red on the shipped game by the lead's decision, and
  `--whole` and `--boss` exit 1 when they fail: the Expert alive when
  05:00 ends (ceiling 85 in 100; 82 to 95 on fresh samples) and the
  boss check's median win (floor 1,200 ticks; 1,050 to 1,140). Any
  other FAIL is a regression.
- **It yields to the corner mascot's rule**: it announces itself with
  `hugo-stage`, and fires `hugo-happy` once, at morning. It fires no
  other site event and listens to none.

Keys: `hugoslekstuga:knuff:{save,muted,motion,pull}`, and for the
browser session only `hugoslekstuga:knuff:run` (a night that was paused
or left, offered as RESUME until it is answered). All five go through
`lib/knuff/save.ts`.

**Tests**: `test/knuff/`. All pure, node environment; the shell's
pieces (the pull, the keys, the loop, the layout) are driven with
stand-ins for the browser, and `save` and `keyboard` make the whole
game in one (`test/knuff/browser.ts`: a window, a document, a canvas
that draws nothing, two storages and a frame clock turned by hand).
`pixels` makes it with a canvas that keeps every rectangle it is asked
for: every one lands on whole device pixels (him grown by Wide or
squashed is stamped from a canvas of his own, nearest neighbour), and
a token the thump turns shows its new way. `wiring` holds its place on
the site: the registry entry, the icon and the cabinet's painter. The
dev handle is `window.__knuff`, development only.

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
   dictionary-entry hero, the "potentially useful." keycap (and its
   HEDGES rotation), and the dust-silhouette labels/notes. Change
   any of them only when explicitly asked.
6. **Don't introduce another CSS framework.** Tailwind + the `card-chunk` /
   `btn-chunk` shadow language is the system.
7. **Don't add server features.** The site is fully serverless since
   the multiplayer games retired (2026-08) — resist leaderboards,
   accounts, friends lists, persistent ranks, and anything else that
   would need a backend.

## Privacy audit (run before any network-adjacent commit)

```sh
rg -n 'fetch\(|gtag|analytics|googletagmanager|cdn\.|XMLHttpRequest' \
  --glob '!node_modules' --glob '!.next' --glob '!public/vendor' \
  app components lib
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

Honest "no analytics" copy also matches the grep (the site description
in `app/layout.tsx` and the homepage's screen-reader intro in
`components/HomeShell.tsx`): words, not network calls. The footer's
line is "No tracking, no accounts." and does not match. When auditing,
exclude the
sjökort tool and its lib: append `--glob '!app/tools/sjokort/**'
--glob '!lib/sjokort/**' --glob '!scripts/**'` to scope the grep to the
tools that are supposed to be fetchless.

## Hooks + state conventions

- Persist state with `useLocalStorageState(key, initial)`. `initial` must be
  referentially stable — define at module scope, not inline.
- localStorage keys must be namespaced `hugoslekstuga:*`. Hugo's own
  keys: `hugoslekstuga:hugo:state:v1` (mood/memory), `hugoslekstuga:dot-color`
  (his colour), `hugoslekstuga:advice:memory` (the Advice engine).
  Overrun's keys: `hugoslekstuga:overrun:{save,muted,music,sfx,motion}`.
  Adventure's keys: `hugoslekstuga:adventure:{save,muted,music,sfx,motion}`.
  Greyrot's keys: `hugoslekstuga:greyrot:{save,meta,muted,motion}` — no
  separate music/sfx split, and `meta` (settings + lifetime totals) is
  read independently of `save` so a corrupt campaign can't take the
  settings down with it.
  Knuff's keys: `hugoslekstuga:knuff:{save,muted,motion,pull}`, and in
  `sessionStorage` `hugoslekstuga:knuff:run` (the night that was paused
  or left). All five are read and written through `lib/knuff/save.ts`
  and nowhere else.
- The React 19 compiler memoises automatically — **drop manual `useCallback`
  in new code**. Older tools still use it; they pass lint but new code
  doesn't need to follow that pattern.

## Run scripts

```sh
npm run dev           # Next dev on :3000
npm run lint
npm run test          # vitest — Overrun's suites + Adventure's + Greyrot's
                      # + Knuff's (test/knuff)
                      # + the site's own (test/site: head tags, share images)
npm run build         # rm -rf .next first if Next caches stale routes —
                      # NOTE: that rm kills a running dev server; restart it
npm run bake:sjokort  # rebake the sjökort routing graph (author-time only)
```

The flat suites in `test/*.ts` are copied **verbatim** from the upstream
Overrun repo and are excluded from eslint for that reason — fix the
engine, not the test. `tsc` still typechecks them. The suites in
`test/adventure/`, `test/greyrot/` and `test/knuff/` have no upstream:
they are linted normally and may be edited freely.

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
   routes it to `/games/<slug>`, and give its cabinet a screen: a
   painter in `lib/hugo/cabinet-screens.ts`. Every entry, tool or game,
   gets a 12×12 icon in `lib/pixel-icons.ts` under its slug. The footer
   index and the search palette pick the new entry up from the registry.
2. Create `app/tools/<slug>/Client.tsx` (`"use client"`) and the server
   wrapper `page.tsx` exporting `metadata = toolMetadata("<slug>")`.
3. Create `app/tools/<slug>/opengraph-image.tsx` — a one-line wrapper
   around `renderToolOG("<slug>")` from `lib/og.tsx`. Copy any existing
   tool's OG file as the template and update the slug, the alt string
   and the fingerprint in its first line (step 5 says which).
   Skipping this leaves the tool's share preview with no picture at
   all (its page sets its own share block, and nothing puts the site
   image back).
4. Use the shared components and helpers — don't reinvent.
5. `npm run test`: `test/site/` fails if the page or the image route
   names another tool's slug, if the title or tagline has a character
   the share image cannot draw, and until the wrapper's first line
   carries the new card's fingerprint (the failure prints it).

That's it. The cluster system is retired and there's no `lib/links.ts`
to update — the homepage swarm picks up the new tool automatically
from the `tools` array.
