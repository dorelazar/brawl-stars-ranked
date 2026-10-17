# Brawl Draft

A ranked draft helper for Brawl Stars that runs as a web app on your iPhone home screen.
Pick the map, tap the bans and picks as they happen, and it suggests the best next brawler,
with the reasons ("Strong on this map", "Beats Mortis", "Good with Poco", "Crow can counter").

**First time? Follow [SETUP.md](SETUP.md).**

## How it works

```
Every 4 hours (GitHub Actions)
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

Using it during a draft (every step is one tap):

1. **Map**: pick the mode, then one of its ranked maps.
2. **Bans**: the strongest brawlers on the map are shown as tiles; tap the banned ones, or skip.
3. **Your turn**: the best picks for that exact moment, with reasons. Tap one to lock it in.
4. **Their turn**: their 18 most likely picks as tiles (about 2 of every 3 real picks are in there). Tap what they took.

Anything else is two letters + Enter in the search box. Every tap can be undone.

Scoring, per candidate brawler (all values are win-rate changes):

- **Map**: win rate on this map in ranked, shrunk toward the brawler's mode and overall win rate
- **Counters**: head-to-head results against each enemy pick
- **Synergy**: results next to each teammate already picked
- **Team fit**: what the team is missing (frontline, range, control) and answers to the enemy's picks
- **Risk**: if the enemy still picks after you, their best realistic counter to this brawler is subtracted

Every number is shrunk toward the level above it with a prior strength calibrated on live ranked data
(counters and synergies really move win rates by about 2%, so a dozen lucky games can't create a "+20% counter").
Non-ranked games barely predict ranked results (they're mostly top players beating weaker lobbies), so they count
at a tenth of a ranked game. With no data at all, class-vs-mode estimates keep the app usable.

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
