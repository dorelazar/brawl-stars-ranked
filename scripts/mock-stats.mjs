// Dev only: writes site/data/stats.mock.json with random but realistic-looking
// stats, so the app can be tried with "live" data before the API key exists.
// Open http://localhost:5173/?stats=mock to use it. Never deployed (gitignored).

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { emptyAgg, addBattle } from './lib/aggregate.mjs';
import { buildStats } from './build-stats.mjs';

const DATA = fileURLToPath(new URL('../site/data/', import.meta.url));
const meta = JSON.parse(await readFile(DATA + 'meta.json', 'utf8'));

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const ids = meta.brawlers.map(b => b.id);
const power = new Map(ids.map(id => [id, (rnd() - 0.5) * 0.5]));
const popularity = new Map(ids.map(id => [id, rnd() ** 3]));
const pair = new Map();
const edge = (a, b) => {
  const k = `${a}|${b}`;
  if (!pair.has(k)) { const v = (rnd() - 0.5) * 0.6; pair.set(k, v); pair.set(`${b}|${a}`, -v); }
  return pair.get(k);
};
const pickTeam = exclude => {
  const team = [];
  while (team.length < 3) {
    const id = ids[Math.floor(rnd() * ids.length)];
    if (!exclude.has(id) && rnd() < popularity.get(id) + 0.05) { team.push(id); exclude.add(id); }
  }
  return team;
};

const maps = meta.maps.filter(m => m.active && ['gemGrab', 'brawlBall', 'heist', 'bounty', 'hotZone', 'knockout'].includes(m.mode));
const rankedPool = maps.filter((_, i) => i % 4 === 0).slice(0, 24);
const mapPower = new Map();

const agg = emptyAgg();
for (let i = 0; i < 60000; i++) {
  const ranked = rnd() < 0.6;
  const map = ranked ? rankedPool[Math.floor(rnd() * rankedPool.length)] : maps[Math.floor(rnd() * maps.length)];
  const used = new Set();
  const A = pickTeam(used), B = pickTeam(used);
  const mp = id => {
    const k = `${map.id}|${id}`;
    if (!mapPower.has(k)) mapPower.set(k, (rnd() - 0.5) * 0.8);
    return mapPower.get(k);
  };
  let s = 0;
  for (const a of A) s += power.get(a) + mp(a);
  for (const b of B) s -= power.get(b) + mp(b);
  for (const a of A) for (const b of B) s += edge(a, b) / 3;
  const aWins = rnd() < 1 / (1 + Math.exp(-s));
  addBattle(agg, {
    ranked, mode: map.mode, mapId: map.id, mapName: map.name,
    winners: aWins ? A : B, losers: aWins ? B : A,
  });
}
const stats = buildStats([agg]);
stats.days = 14;
await writeFile(DATA + 'stats.mock.json', JSON.stringify(stats));
console.log(`stats.mock.json: ${stats.battles.all} battles, ${stats.rankedMaps.length} ranked maps`);
