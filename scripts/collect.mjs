// Daily collector: downloads recent battle logs of high-level players from the
// official Brawl Stars API and adds them to today's counters.
//
// Env:
//   BS_API_KEY    required, from developer.brawlstars.com
//   BS_API_BASE   optional, defaults to the RoyaleAPI proxy (key must allow IP 45.79.218.79)
//   MAX_PLAYERS   optional, how many battle logs to fetch per run (default 2500)
//
// Usage: node scripts/collect.mjs [stateDir]   (default: ./state)

import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyAgg, addBattle, mergeAgg, normalizeBattle } from './lib/aggregate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = process.argv[2] || join(ROOT, 'state');
const KEY = process.env.BS_API_KEY;
const BASE = (process.env.BS_API_BASE || 'https://bsproxy.royaleapi.dev/v1').replace(/\/$/, '');
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 2500);
const CONCURRENCY = 8;
const COUNTRIES = ['global', 'US', 'BR', 'MX', 'DE', 'FR', 'ES', 'IT', 'GB', 'KR', 'JP', 'IL', 'TR', 'PL', 'CA', 'AU'];
const KEEP_DAILY_DAYS = 30;
const KEEP_SEEN_DAYS = 3;
const POOL_SIZE = 6000;

const today = new Date().toISOString().slice(0, 10);

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

async function api(path, attempt = 0) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  }).catch(err => ({ ok: false, status: 0, err }));
  if (res.ok) return res.json();
  if ((res.status === 429 || res.status >= 500 || res.status === 0) && attempt < 4) {
    await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
    return api(path, attempt + 1);
  }
  const text = res.text ? await res.text().catch(() => '') : String(res.err?.cause?.code || res.err?.message || '');
  if (res.status === 403) {
    let body = {};
    try { body = JSON.parse(text); } catch { /* not JSON, e.g. a firewall page */ }
    fail(`API key rejected (403 ${body.reason || ''}: ${body.message || text.slice(0, 200)}). ` +
      'Check that the key allows IP 45.79.218.79 when using the RoyaleAPI proxy.');
  }
  // 404 (player gone) and other one-off failures are skipped, but counted so a broken
  // connection can't look like a successful run.
  const k = String(res.status);
  failures[k] = (failures[k] || 0) + 1;
  if (!firstFailure[k]) firstFailure[k] = `${path} -> ${res.status}: ${text.replace(/\s+/g, ' ').slice(0, 300)}`;
  return null;
}

const failures = {};     // HTTP status -> count
const firstFailure = {}; // HTTP status -> example

// Prints a GitHub Actions error annotation (visible on the run page) and stops.
function fail(msg) {
  console.log(`::error title=Battle collection failed::${msg}`);
  throw new Error(msg);
}

const enc = tag => encodeURIComponent(tag.startsWith('#') ? tag : `#${tag}`);

async function seedTags() {
  const tags = [];
  for (const c of COUNTRIES) {
    const body = await api(`/rankings/${c}/players?limit=200`);
    for (const p of body?.items || []) tags.push(p.tag);
  }
  return tags;
}

async function main() {
  if (!KEY) {
    console.log('BS_API_KEY is not set, skipping battle collection. The app will use estimated stats.');
    return;
  }
  await mkdir(join(STATE, 'daily'), { recursive: true });

  // Current map rotation for the app's home screen.
  const rotation = await api('/events/rotation');
  if (!Array.isArray(rotation)) {
    fail(`Could not reach the Brawl Stars API (${JSON.stringify(firstFailure)}). Nothing was collected.`);
  }
  {
    const slim = rotation.map(e => ({
      start: e.startTime, end: e.endTime, mode: e.event?.mode, mapId: e.event?.id, map: e.event?.map,
    }));
    // Saved with the collected data; build-stats copies it into the site.
    await writeFile(join(STATE, 'rotation.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), events: slim }));
  }

  const pool = await readJson(join(STATE, 'players.json'), {});   // tag -> last date seen in ranked
  const seen = await readJson(join(STATE, 'seen.json'), {});      // battle key -> date
  const seenKeys = new Set(Object.keys(seen));

  // Ranked players we met recently go first, then the leaderboards.
  const queue = [];
  const queued = new Set();
  const enqueue = tag => {
    if (!tag || queued.has(tag) || queue.length >= MAX_PLAYERS) return;
    queued.add(tag);
    queue.push(tag);
  };
  Object.entries(pool).sort((a, b) => b[1].localeCompare(a[1])).forEach(([t]) => enqueue(t));
  (await seedTags()).forEach(enqueue);
  console.log(`Starting with ${queue.length} players (max ${MAX_PLAYERS}) via ${BASE}`);
  if (!queue.length) fail(`Could not load any leaderboard players (${JSON.stringify(firstFailure)}).`);

  const agg = emptyAgg();
  let fetched = 0, added = 0, usable = 0, next = 0;
  const types = {}; // battle.type -> count, printed to help spot API changes

  async function worker() {
    while (next < queue.length) {
      const tag = queue[next++];
      const log = await api(`/players/${enc(tag)}/battlelog`);
      fetched++;
      for (const entry of log?.items || []) {
        const type = entry?.battle?.type || 'none';
        types[type] = (types[type] || 0) + 1;
        const nb = normalizeBattle(entry, tag);
        if (!nb) continue;
        usable++;
        if (nb.ranked) {
          // Snowball: other ranked players are good sources for tomorrow too.
          for (const t of nb.tags) { pool[t] = today; enqueue(t); }
        }
        if (seenKeys.has(nb.key)) continue;
        seenKeys.add(nb.key);
        seen[nb.key] = today;
        addBattle(agg, nb);
        added++;
      }
      if (fetched % 250 === 0) console.log(`  ${fetched} logs, ${added} new battles`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const dailyPath = join(STATE, 'daily', `${today}.json`);
  const merged = mergeAgg(await readJson(dailyPath, emptyAgg()), agg);
  await writeFile(dailyPath, JSON.stringify(merged));
  console.log(`Battle types seen: ${JSON.stringify(types)}`);
  console.log(`Failed requests: ${JSON.stringify(failures)} ${JSON.stringify(firstFailure)}`);
  if (fetched > 0 && usable === 0) {
    fail(`Fetched ${fetched} battle logs but found no usable 3v3 battles. Failed requests: ${JSON.stringify(failures)}. Types seen: ${JSON.stringify(types)}`);
  }
  console.log(`Done: ${fetched} logs, ${added} new battles (${agg.battles.ranked} ranked). Today total: ${merged.battles.all}`);

  // Housekeeping so the state stays small.
  const cutoff = d => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
  for (const [k, d] of Object.entries(seen)) if (d < cutoff(KEEP_SEEN_DAYS)) delete seen[k];
  const trimmedPool = Object.fromEntries(Object.entries(pool).sort((a, b) => b[1].localeCompare(a[1])).slice(0, POOL_SIZE));
  for (const f of await readdir(join(STATE, 'daily'))) {
    if (f.replace('.json', '') < cutoff(KEEP_DAILY_DAYS)) await rm(join(STATE, 'daily', f));
  }
  await writeFile(join(STATE, 'seen.json'), JSON.stringify(seen));
  await writeFile(join(STATE, 'players.json'), JSON.stringify(trimmedPool));
}

main().catch(err => {
  console.error(err.message);
  process.exitCode = 1;
});
