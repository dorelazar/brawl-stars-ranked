# Brawl Draft

A ranked draft helper for Brawl Stars that runs as a web app on your iPhone home screen.
Pick the map, tap the bans and picks as they happen, and it suggests the best next brawler,
with the reasons ("Strong on this map", "Beats Mortis", "Good with Poco", "Crow can counter").

**First time? Follow [SETUP.md](SETUP.md).**

## How it works

```
Every night (GitHub Actions)
  fetch-meta.mjs   → brawlers, maps, modes          (Brawlify public API)
  collect.mjs      → recent battles of top players  (official Brawl Stars API)
  build-stats.mjs  → last 14 days → site/data/stats.json
  deploy           → GitHub Pages
          │
          ▼
site/ (the app, no build step)
  engine.js  → scores every brawler for the current draft
  app.js     → screens: map picker, live draft board
```

Scoring, per candidate brawler (all values are win-rate changes):

- **Map**: win rate on this map in ranked, shrunk toward the mode and overall win rate when the sample is small
- **Counters**: head-to-head results against each enemy pick
- **Synergy**: results next to each teammate already picked
- **Risk**: if the enemy still picks after you, the best answer they could pick is subtracted

Small samples lean on class-based estimates (e.g. marksmen in Knockout), so the app is usable from day one
and becomes fully data-driven as battles accumulate. Ranked games count most; other 3v3 games fill gaps.

Collected counters live on the `data` branch as a single squashed commit, so the repo doesn't grow.

## Run it locally

```bash
npm run serve
```

Then open http://localhost:5173. Add `?stats=mock` to try it with fake stats
(create them first with `node scripts/mock-stats.mjs`).

Other commands:

| Command | What it does |
|---|---|
| `npm test` | Unit tests for the data pipeline and the engine |
| `npm run meta` | Refresh brawlers and maps from Brawlify |
| `BS_API_KEY=… npm run collect` | Collect battles into `state/` |
| `npm run stats` | Rebuild `site/data/stats.json` from `state/` |
| `node scripts/make-icons.mjs` | Redraw the app icons |

Config for the collector (env vars): `BS_API_KEY` (required), `BS_API_BASE` (defaults to the RoyaleAPI proxy),
`MAX_PLAYERS` (battle logs per run, default 2500).

## Notes

Unofficial fan project, not endorsed by Supercell. The app never touches the game: you tap the picks yourself,
which keeps it within Supercell's Fan Content Policy. Brawler and map art is from Brawlify's CDN.
