# Deployment runbook

The site went live on 2026-05-09 at `hugoslekstuga.vercel.app` and was
moved behind the custom domain `hugoslekstuga.com` on 2026-05-10. This
file captures *where* things run, *how* to update them, and what's still
outstanding. Read AGENTS.md for the development conventions; this file
is strictly the operational view.

## Where things live

| Surface | Host | URL |
|---|---|---|
| Static site (9 tools + 1 game + about) | Vercel | https://hugoslekstuga.com |
| Source | GitHub (public) | https://github.com/hugomartinwall/hugoslekstuga |

The multiplayer games (Munch + Noodle) and their Fly.io WebSocket server
(`hugoslekstuga-munch`) were shut down 2026-08 — the app was destroyed,
`fly.toml`/`Dockerfile` deleted, and `/games/munch` + `/games/noodle`
now 308-redirect to the homepage. Everything below is Vercel-only.

`hugoslekstuga.vercel.app` still works as a fallback (Vercel keeps the
auto-generated subdomain alive forever) but the canonical URL is the
apex `.com`. The codebase advertises that everywhere — `metadataBase`,
`sitemap.xml`, and `robots.txt` all use it.

DNS is hosted at Loopia (registrar: Ascio backend). Apex points to
Vercel via a single A record (`@ → 216.198.79.1`). `www` resolves to
the same IP via Loopia's "synkronisera" option and is configured in
Vercel as a 308 permanent redirect to the apex. To change DNS, log
into customerzone.loopia.com → DNS-redigerare. To change the redirect
or add subdomains, use Vercel's Domains panel.

## Deploys

### Vercel — auto-deploys on push to `main`

```sh
git push origin main
```

That's it. Vercel detects the push, builds (~60s), promotes the new
deployment to production. Watch progress at
https://vercel.com/hugo-7734s-projects/hugoslekstuga.

No env vars are required anymore. (`NEXT_PUBLIC_MUNCH_WS_URL` served the
retired multiplayer games — delete it from the Vercel project settings
if it's still there.)

If you ever change an env var, **trigger a redeploy** — Vercel doesn't
auto-rebuild on env changes. Either click Redeploy in the dashboard or
push an empty commit:

```sh
git commit --allow-empty -m "chore: trigger redeploy"
git push
```

## Health checks

```sh
# Static site
curl -fsS https://hugoslekstuga.com/sitemap.xml >/dev/null && echo OK
```

## Outstanding

1. **Final QA pass.**
   - Walk the homepage swarm at 375px viewport (iPhone SE size) and
     ~5 of the kept tools. Mobile inputs (Strip image drop, Roll
     entry editor, etc.) need a real-touch sanity check.
   - Run Lighthouse on `/`, `/tools/strip`, `/tools/sudoku`,
     `/games/overrun`. Target ≥90 a11y, ≥90 perf.

## When something breaks

- **A page 404s or is blank.** Vercel deploy problem. Check the latest
  deployment in the Vercel dashboard.
- **A tool page shows the wrong title in the browser tab.** Check
  `lib/tools.ts` — that's the single source of truth for every tool's
  title and description, propagated to per-page metadata via the
  `Client.tsx + page.tsx` wrapper pattern.
- **Site is slow.** Inspect the Network tab; nothing in the static site
  should exceed a couple hundred ms on a warm cache.

## Cost expectations (rough)

- Vercel: $0/mo on the Hobby plan as long as bandwidth and build
  minutes stay modest. The four free-tier limits the site is
  remotely close to are: 100 GB bandwidth/mo, 100 build minutes/mo,
  1000 image transforms/mo, 100k function invocations/mo — none
  realistic to exceed for a personal site without going viral.
- Domain: ~150 SEK/year for the .com renewal at Loopia.

## Identity

Vercel team: `hugo-7734's projects` (Hobby plan)
GitHub: hugomartinwall, public repo
