// Turns raw battles from the official Brawl Stars API into win/game counters.
//
// Every counter is a 4-number array: [rankedWins, rankedGames, allWins, allGames].
// "all" includes ranked, so the app can fall back to the bigger sample when
// the ranked sample for a map or matchup is still small.

export const RANKED_TYPES = new Set(['soloRanked', 'teamRanked']);

// 3v3 modes worth tracking. Showdown, bosses and other event modes are ignored.
export const TRACKED_MODES = new Set([
  'gemGrab', 'heist', 'bounty', 'brawlBall', 'hotZone', 'knockout',
  'brawlHockey', 'wipeout', 'basketBrawl', 'volleyBrawl', 'payload',
  'presentPlunder', 'paintBrawl', 'tokenRun', 'treasureHunt', 'spiritWars',
  'soulCollector', 'dodgebrawl', 'safeBlast', 'superBall', 'brawlArena',
]);

export function emptyAgg() {
  return { battles: { ranked: 0, all: 0 }, b: {}, mo: {}, m: {}, vs: {}, w: {} };
}

function bump(table, key, isRanked, won) {
  const c = table[key] || (table[key] = [0, 0, 0, 0]);
  if (isRanked) { c[1]++; if (won) c[0]++; }
  c[3]++; if (won) c[2]++;
}

function nested(table, key) {
  return table[key] || (table[key] = {});
}

// Stable id for a battle so the same match seen in several players' logs is counted once.
export function battleKey(entry) {
  const tags = (entry.battle?.teams || []).flat().map(p => p.tag).sort().join(',');
  return `${entry.battleTime}|${tags}`;
}

// Returns a normalized battle or null when it isn't a usable 3v3 result.
export function normalizeBattle(entry, ownerTag) {
  const battle = entry?.battle;
  const event = entry?.event;
  if (!battle || !event) return null;
  const mode = event.mode || battle.mode;
  if (!TRACKED_MODES.has(mode)) return null;
  const teams = battle.teams;
  if (!Array.isArray(teams) || teams.length !== 2) return null;
  if (teams[0].length !== 3 || teams[1].length !== 3) return null;
  if (battle.result !== 'victory' && battle.result !== 'defeat') return null;

  const ownerTeam = teams.findIndex(t => t.some(p => p.tag === ownerTag));
  if (ownerTeam < 0) return null;
  const winner = battle.result === 'victory' ? ownerTeam : 1 - ownerTeam;

  const ids = teams.map(t => t.map(p => p.brawler?.id));
  if (ids.flat().some(id => typeof id !== 'number')) return null;

  return {
    key: battleKey(entry),
    ranked: RANKED_TYPES.has(battle.type),
    mode,
    mapId: event.id ?? null,
    mapName: event.map ?? null,
    winners: ids[winner],
    losers: ids[1 - winner],
    tags: teams.flat().map(p => p.tag),
  };
}

export function addBattle(agg, nb) {
  const r = nb.ranked;
  agg.battles.all++;
  if (r) agg.battles.ranked++;

  const mode = nested(agg.mo, nb.mode);
  let map = null;
  if (nb.mapId != null) {
    map = agg.m[nb.mapId] || (agg.m[nb.mapId] = { mode: nb.mode, name: nb.mapName, n: [0, 0], b: {} });
    map.n[1]++;
    if (r) map.n[0]++;
  }

  for (const [team, won] of [[nb.winners, true], [nb.losers, false]]) {
    for (const id of team) {
      bump(agg.b, id, r, won);
      bump(mode, id, r, won);
      if (map) bump(map.b, id, r, won);
    }
    // Teammate pairs (both directions so lookups stay simple).
    for (const a of team) {
      for (const b of team) {
        if (a !== b) bump(nested(agg.w, a), b, r, won);
      }
    }
  }

  // Head-to-head: every winner beat every loser.
  for (const a of nb.winners) {
    for (const b of nb.losers) {
      bump(nested(agg.vs, a), b, r, true);
      bump(nested(agg.vs, b), a, r, false);
    }
  }
}

function addCounter(into, from) {
  for (let i = 0; i < 4; i++) into[i] += from[i];
}

function mergeTable(into, from) {
  for (const [k, v] of Object.entries(from)) {
    if (!into[k]) into[k] = [0, 0, 0, 0];
    addCounter(into[k], v);
  }
}

function mergeNested(into, from) {
  for (const [k, v] of Object.entries(from)) mergeTable(nested(into, k), v);
}

export function mergeAgg(into, from) {
  into.battles.ranked += from.battles.ranked;
  into.battles.all += from.battles.all;
  mergeTable(into.b, from.b);
  mergeNested(into.mo, from.mo);
  mergeNested(into.vs, from.vs);
  mergeNested(into.w, from.w);
  for (const [id, map] of Object.entries(from.m)) {
    const t = into.m[id] || (into.m[id] = { mode: map.mode, name: map.name, n: [0, 0], b: {} });
    t.n[0] += map.n[0];
    t.n[1] += map.n[1];
    mergeTable(t.b, map.b);
  }
  return into;
}
