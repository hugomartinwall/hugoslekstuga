# Deployment runbook

The site went live on 2026-05-09 at `hugoslekstuga.vercel.app` and was
moved behind the custom domain `hugoslekstuga.com` on 2026-05-10. This
file captures *where* things run, *how* to update them, and what's still
outstanding. Read AGENTS.md for the development conventions; this file
is strictly the operational view.

## Where things live

| Surface | Host | URL |
|---|---|---|
| Static site (16 tools + 2 games + about) | Vercel | https://hugoslekstuga.com |
| Munch + Noodle WebSocket server | Fly.io (Stockholm `arn`) | https://hugoslekstuga-munch.fly.dev |
| Source | GitHub (public) | https://github.com/hugomartinwall/hugoslekstuga |

`hugoslekstuga.vercel.app` still works as a fallback (Vercel keeps the
auto-generated subdomain alive forever) but the canonical URL is the
apex `.com`. The codebase advertises that everywhere — `metadataBase`,
`sitemap.xml`, `robots.txt`, and the munch share text all use it.

DNS is hosted at Loopia (registrar: Ascio backend). Apex points to
Vercel via a single A record (`@ → 216.198.79.1`). `www` resolves to
the same IP via Loopia's "synkronisera" option and is configured in
Vercel as a 308 permanent redirect to the apex. To change DNS, log
into customerzone.loopia.com → DNS-redigerare. To change the redirect
or add subdomains, use Vercel's Domains panel.

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
locally. Takes ~3 minutes. The setup runs **exactly one machine** in
Stockholm — a hard rule, since both games hold state in-memory and
scaling past 1 would split players across sessions. See AGENTS.md and
`fly.toml`. `auto_stop_machines = "stop"` so the machine sleeps when no
players are online; first connection after idle takes ~5 seconds while
Fly wakes it.

Useful commands:

```sh
flyctl status -a hugoslekstuga-munch   # machine state, health
flyctl logs -a hugoslekstuga-munch     # tail real-time logs (Ctrl-C to stop)
flyctl ssh console -a hugoslekstuga-munch  # shell into a machine
flyctl scale count 1 -a hugoslekstuga-munch  # enforce single-machine (the hard rule)
```

Fly dashboard: https://fly.io/apps/hugoslekstuga-munch

## Health checks

```sh
# Static site
curl -fsS https://hugoslekstuga.com/sitemap.xml >/dev/null && echo OK

# Munch HTTP /health (live JSON with player + socket count)
curl -s https://hugoslekstuga-munch.fly.dev/health
```

If `/health` fails, run `flyctl status` first — the machine may be
stopped (auto-stop). A real client connection wakes it; if it won't
wake, `flyctl machine restart <id>`.

## Outstanding

1. **Set a Fly.io spend cap** *(if/when Fly exposes the UI for it on
   this account — currently not available)*. Practically: bookmark
   https://fly.io/dashboard/hugo-oogywawa-se/billing/cost-explorer and
   glance at it weekly for the first month. Realistic monthly spend at
   1–10 active players/week is $0.10–$0.50; nothing in the current
   `fly.toml` (1× shared-cpu-1x@256MB, no volumes, auto-stop on idle)
   has a path to a scary invoice. The Fly invoice email at
   `hugo@oogywawa.se` is the actual safety net.
2. **Final QA pass.**
   - Walk the homepage swarm at 375px viewport (iPhone SE size) and
     ~5 of the kept tools. Mobile inputs (Convert drop zone, Strip
     image drop, PDF picker, etc.) need a real-touch sanity check.
   - Run Lighthouse on `/`, `/tools/convert`, `/tools/pdf`,
     `/games/munch`. Target ≥90 a11y, ≥90 perf.

## When something breaks

- **Munch lobby says "Couldn't reach the server. Try again in a
  minute."** First check `flyctl status`. If the machine is stopped,
  that's expected; the next real connection should wake it. If
  `started` but `/health` fails, look at `flyctl logs` for stack
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
