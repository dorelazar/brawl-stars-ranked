// Sums the last WINDOW_DAYS of daily counters into site/data/stats.json,
// the single file the app downloads.
//
// Usage: node scripts/build-stats.mjs [stateDir]   (default: ./state)

import { readFile, writeFile, readdir, mkdir, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyAgg, mergeAgg } from './lib/aggregate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = process.argv[2] || join(ROOT, 'state');
const OUT = join(ROOT, 'site', 'data', 'stats.json');
export const WINDOW_DAYS = 14;
const MIN_RANKED_GAMES_FOR_POOL = 20;
const POOL_DAYS = 3;

export function buildStats(dailies, now = new Date()) {
  const total = emptyAgg();
  for (const d of dailies) mergeAgg(total, d);

  // The ranked map pool changes with each season: judge it on the last few days only,
  // so maps that left the pool drop off the app's list right away.
  const recent = emptyAgg();
  for (const d of dailies.slice(-POOL_DAYS)) mergeAgg(recent, d);
  const poolFrom = agg => Object.entries(agg.m)
    .filter(([, m]) => m.n[0] >= MIN_RANKED_GAMES_FOR_POOL)
    .sort((a, b) => b[1].n[0] - a[1].n[0])
    .map(([id]) => Number(id));
  const recentPool = poolFrom(recent);
  const rankedMaps = recentPool.length ? recentPool : poolFrom(total);

  return {
    generatedAt: now.toISOString(),
    days: dailies.length,
    battles: total.battles,
    rankedMaps,
    b: total.b,
    mo: total.mo,
    m: total.m,
    vs: total.vs,
    w: total.w,
  };
}

async function main() {
  await mkdir(dirname(OUT), { recursive: true });
  await copyFile(join(STATE, 'rotation.json'), join(dirname(OUT), 'rotation.json')).catch(() => {});
  const dir = join(STATE, 'daily');
  let files = [];
  try { files = (await readdir(dir)).filter(f => f.endsWith('.json')).sort().slice(-WINDOW_DAYS); } catch { /* no state yet */ }
  if (!files.length) {
    console.log('No collected battles yet, leaving stats.json untouched (app uses estimated stats).');
    return;
  }
  const dailies = await Promise.all(files.map(async f => JSON.parse(await readFile(join(dir, f), 'utf8'))));
  const stats = buildStats(dailies);
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(stats));
  console.log(`stats.json: ${stats.battles.all} battles (${stats.battles.ranked} ranked) over ${files.length} days, ` +
    `${stats.rankedMaps.length} ranked maps`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
