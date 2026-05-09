# Deployment runbook

The site went live on 2026-05-09. This file captures *where* things run,
*how* to update them, and what's still outstanding. Read AGENTS.md for
the development conventions; this file is strictly the operational view.

## Where things live

| Surface | Host | URL |
|---|---|---|
| Static site (43 tools + lobby) | Vercel | https://hugoslekstuga.vercel.app |
| Munch WebSocket server | Fly.io (Stockholm `arn`) | https://hugoslekstuga-munch.fly.dev |
| Source | GitHub (public) | https://github.com/hugomartinwall/hugoslekstuga |

Domain **hugoslekstuga.com** is bought at Loopia. **Not yet pointing at
Vercel** — DNS is still on Loopia's parking page. See "Outstanding" below.

## Deploys, in two flavours

### Vercel — auto-deploys on push to `main`

```sh
git push origin main
```

That's it. Vercel detects the push, builds (~60s), promotes the new
deployment to production. Watch progress at
https://vercel.com/hugo-7734s-projects/hugoslekstuga.

Env vars set on Vercel:

- `NEXT_PUBLIC_MUNCH_WS_URL = wss://hugoslekstuga-munch.fly.dev` —
  baked into the client bundle at build time. Used by
  `app/games/munch/Client.tsx`.

If you change an env var, **trigger a redeploy** — Vercel doesn't
auto-rebuild on env changes. Either click Redeploy in the dashboard or
push an empty commit:

```sh
git commit --allow-empty -m "chore: trigger redeploy"
git push
```

### Fly.io — explicit deploy with `flyctl`

The munch server lives at `server/munch/`, with `Dockerfile` +
`fly.toml` at the repo root. Deploy is one command:

```sh
flyctl deploy --remote-only
```

`--remote-only` builds on Fly's builder so you don't need Docker running
locally. Takes ~3 minutes. The current setup runs **2 machines**, both
in Stockholm, both `auto_stop_machines = "stop"` so they sleep when no
players are online. First connection after idle takes ~5 seconds while
Fly wakes a machine.

Useful commands:

```sh
flyctl status -a hugoslekstuga-munch   # machine state, health
flyctl logs -a hugoslekstuga-munch     # tail real-time logs (Ctrl-C to stop)
flyctl ssh console -a hugoslekstuga-munch  # shell into a machine
flyctl scale count 1 -a hugoslekstuga-munch  # drop to 1 machine if costs grow
```

Fly dashboard: https://fly.io/apps/hugoslekstuga-munch

## Health checks

```sh
# Static site
curl -fsS https://hugoslekstuga.vercel.app/sitemap.xml >/dev/null && echo OK

# Munch HTTP /health (live JSON with player + socket count)
curl -s https://hugoslekstuga-munch.fly.dev/health
```

If `/health` fails, run `flyctl status` first — both machines may be
stopped (auto-stop). A real client connection wakes them; if they
won't wake, `flyctl machine restart <id>` per machine.

## Outstanding

These were flagged during launch but not done:

1. **Point hugoslekstuga.com at Vercel.** Loopia → DNS → A record on
   apex to Vercel's IP, CNAME on `www.` to `cname.vercel-dns.com`.
   Then add the domain in Vercel Settings → Domains. Vercel will
   verify and issue a TLS cert in a few minutes.
2. **Set a Fly.io spend cap.** https://fly.io/dashboard/personal/billing
   → Spending alerts. Recommend $5/month. Cost at idle is ~$0.40/mo
   but a runaway loop or someone keeping the game open 24/7 would push
   it up; the cap is the safety belt.
3. **Final pre-domain QA pass.**
   - Visit `/opengraph-image.png` in production — confirm 44 chips
     fit cleanly in 1200×630 (this hasn't been verified visually yet).
   - Walk every cluster on the homepage map at 375px viewport
     (iPhone SE size) and ~5 popular tools. Mobile inputs (sift CSV
     drop, sketch drawing, etc.) need a real-touch sanity check.
   - Run Lighthouse on `/`, `/tools/sum`, `/tools/sift`,
     `/games/munch`. Target ≥90 a11y, ≥90 perf.

## When something breaks

- **Munch lobby says "Couldn't reach the server. Try again in a
  minute."** First check `flyctl status`. If both machines are
  stopped, that's expected; the next real connection should wake one.
  If `started` but `/health` fails, look at `flyctl logs` for stack
  traces. The server has a try/catch around every connection handler
  so one bad client can't take everyone down.
- **`/games/munch` page itself 404s or is blank.** Vercel deploy
  problem, not Fly. Check the latest deployment in the Vercel
  dashboard.
- **A tool page shows the wrong title in the browser tab.** Check
  `lib/tools.ts` — that's the single source of truth for every tool's
  title and description, propagated to per-page metadata via the
  `Client.tsx + page.tsx` wrapper pattern.
- **Site is slow.** First check Fly machine state — if you're
  navigating during a cold start, the Munch fetch can pause briefly.
  Otherwise inspect Network tab; nothing in the static site should
  exceed a couple hundred ms on a warm cache.

## Cost expectations (rough)

- Vercel: $0/mo on the Hobby plan as long as bandwidth and build
  minutes stay modest. The four free-tier limits the site is
  remotely close to are: 100 GB bandwidth/mo, 100 build minutes/mo,
  1000 image transforms/mo, 100k function invocations/mo — none
  realistic to exceed for a personal site without going viral.
- Fly.io: ~$0.40/mo idle, ~$2-3/mo if a machine stays warm constantly.
  Set the $5 alert and forget it.
- Domain: ~150 SEK/year for the .com renewal at Loopia.

## Identity

Vercel team: `hugo-7734's projects` (Hobby plan)
Fly.io: signed in via GitHub (hugomartinwall) as hugo@oogywawa.se
GitHub: hugomartinwall, public repo
