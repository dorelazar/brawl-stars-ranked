// Downloads the brawler list, maps and game modes from Brawlify's public API
// and writes a trimmed copy to site/data/meta.json for the app.
// If Brawlify is down, the previous meta.json is kept as is.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRACKED_MODES } from './lib/aggregate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'site', 'data', 'meta.json');
const API = 'https://api.brawlapi.com/v1';
// Brawlify blocks requests without a descriptive user agent.
const HEADERS = { 'User-Agent': 'brawl-stars-draft-helper/1.0 (personal fan project)', Accept: 'application/json' };

async function get(path) {
  const res = await fetch(`${API}/${path}`, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body?.list)) throw new Error(`${path}: unexpected response`);
  return body.list;
}

export function trimMeta(brawlers, maps, modes) {
  const modeById = new Map(modes.map(m => [m.scId, m]));
  const outModes = modes
    .filter(m => TRACKED_MODES.has(m.scHash))
    .map(m => ({ id: m.scHash, name: m.name, color: m.color, img: m.imageUrl }));

  const outMaps = maps
    .map(m => ({ map: m, mode: modeById.get(m.gameMode?.scId) }))
    .filter(({ mode }) => mode && TRACKED_MODES.has(mode.scHash))
    .map(({ map, mode }) => ({
      id: map.id,
      name: map.name,
      mode: mode.scHash,
      img: map.imageUrl,
      active: !map.disabled,
    }));

  const outBrawlers = brawlers
    .filter(b => b.released)
    .map(b => ({
      id: b.id,
      name: b.name,
      cls: b.class?.name || 'Unknown',
      rarity: b.rarity?.name || '',
      color: b.rarity?.color || '#888',
      img: b.imageUrl2 || b.imageUrl,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { updatedAt: new Date().toISOString(), brawlers: outBrawlers, modes: outModes, maps: outMaps };
}

async function main() {
  try {
    const [brawlers, maps, modes] = await Promise.all([get('brawlers'), get('maps'), get('gamemodes')]);
    const meta = trimMeta(brawlers, maps, modes);
    if (meta.brawlers.length < 50) throw new Error(`only ${meta.brawlers.length} brawlers, refusing to overwrite`);
    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify(meta));
    console.log(`meta.json: ${meta.brawlers.length} brawlers, ${meta.maps.length} maps, ${meta.modes.length} modes`);
  } catch (err) {
    console.warn(`Could not refresh meta from Brawlify (${err.message}). Keeping the previous meta.json.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
