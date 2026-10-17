// Draft recommendation engine. Pure functions, shared by the app and the tests.
//
// All values are "win-rate deltas": +0.03 means roughly +3% win chance.
// Real match data (stats.json) is used when available. Each number is shrunk
// toward a prior so tiny samples don't produce wild picks, and the prior comes
// from class-based estimates, so the app still gives sensible advice before
// any data has been collected.

import { teamNeeds, fit, teamReport, teamScore } from './plan.js';

// ---------- Draft order (Ranked: bans, then picks 1-2-2-1) ----------

export function pickOrder(firstTeam) {
  const f = firstTeam, s = firstTeam === 'blue' ? 'red' : 'blue';
  return [f, s, s, f, f, s];
}

// Which team picks next, given how many each side has locked in.
export function nextTurn(firstTeam, blueCount, redCount) {
  const order = pickOrder(firstTeam);
  const done = { blue: 0, red: 0 };
  for (let i = 0; i < order.length; i++) {
    const t = order[i];
    done[t]++;
    const have = t === 'blue' ? blueCount : redCount;
    if (have < done[t]) {
      const after = order.slice(i + 1);
      let picksNow = 1;
      while (order[i + picksNow] === t) picksNow++;
      return {
        index: i,
        team: t,
        // How many picks the other side still gets after this one (they can counter us).
        opponentPicksAfter: after.filter(x => x !== t).length,
        // How many picks in a row this team makes right now (1 or 2).
        picksNow,
      };
    }
  }
  return null;
}

// ---------- Class-based estimates (used as priors) ----------

const CLASS_MODE = {
  gemGrab:   { Controller: .02, Support: .015, 'Damage Dealer': .01, Artillery: .005, Tank: 0, Marksman: 0, Assassin: -.01 },
  heist:     { 'Damage Dealer': .025, Assassin: .01, Marksman: .005, Tank: .005, Artillery: 0, Controller: -.005, Support: -.01 },
  bounty:    { Marksman: .03, Artillery: .01, 'Damage Dealer': .005, Support: 0, Controller: 0, Assassin: -.01, Tank: -.025 },
  knockout:  { Marksman: .03, Artillery: .015, 'Damage Dealer': .005, Support: 0, Controller: 0, Assassin: -.01, Tank: -.02 },
  brawlBall: { Tank: .02, Assassin: .015, 'Damage Dealer': .01, Support: .005, Controller: 0, Artillery: -.01, Marksman: -.015 },
  hotZone:   { Controller: .025, Tank: .015, Artillery: .01, Support: .005, 'Damage Dealer': 0, Assassin: -.01, Marksman: -.01 },
};
CLASS_MODE.brawlHockey = CLASS_MODE.brawlBall;
CLASS_MODE.basketBrawl = CLASS_MODE.brawlBall;
CLASS_MODE.wipeout = CLASS_MODE.knockout;

const CLASS_SYN = [
  ['Support', 'Tank', .01], ['Support', 'Assassin', .005], ['Tank', 'Artillery', .005],
  ['Controller', 'Marksman', .005], ['Support', 'Damage Dealer', .005],
];
const CLASS_SYN_MAP = new Map();
for (const [a, b, d] of CLASS_SYN) { CLASS_SYN_MAP.set(`${a}|${b}`, d); CLASS_SYN_MAP.set(`${b}|${a}`, d); }
const SAME_CLASS_PENALTY = -.01;

// ---------- Engine ----------

// Prior strength, in games: how many games of evidence it takes before the data
// outweighs the estimate one level up. Calibrated on live ranked data as
// p(1-p)/τ², where τ is the real spread of the effect once sampling noise is
// removed (counters and synergies swing win rates by ~2%, not 20%).
const K = { overall: 300, mode: 400, map: 500, vs: 500, syn: 500 };
// Non-ranked games come from top players stomping weaker lobbies: their win rates barely
// track ranked ones (correlation ~0.3), so they only break ties where ranked data is thin.
const OTHER_WEIGHT = 0.1;
// Ranked data shows class-vs-mode effects at about half the size of the hand-made table above
// (regression slope 0.54), and the team-fit layer in plan.js already rewards the class too.
const CLASS_PRIOR_SCALE = 0.5;
const RISK_WEIGHT = 0.6;  // how much a likely enemy counter-pick costs us
const RISK_POOL = 30;     // the enemy answers with brawlers that are viable on the map, not any brawler
const MIN_REASON = 0.004;

export function createEngine(meta, stats) {
  const brawlers = new Map(meta.brawlers.map(b => [b.id, b]));
  const cls = id => brawlers.get(id)?.cls || 'Unknown';
  const hasData = !!(stats && stats.battles && stats.battles.all > 0);
  const S = hasData ? stats : { b: {}, mo: {}, m: {}, vs: {}, w: {}, battles: { all: 0, ranked: 0 }, rankedMaps: [] };

  // Win rate shrunk toward `prior`. c = [rankedWins, rankedGames, allWins, allGames]; "all" includes ranked.
  const rate = (c, prior, k) => {
    if (!c) return prior;
    const wins = c[0] + OTHER_WEIGHT * (c[2] - c[0]);
    const games = c[1] + OTHER_WEIGHT * (c[3] - c[1]);
    return (wins + k * prior) / (games + k);
  };

  const cache = new Map();
  const memo = (key, fn) => {
    if (!cache.has(key)) cache.set(key, fn());
    return cache.get(key);
  };

  const overall = id => memo(`o${id}`, () => rate(S.b[id], 0.5, K.overall));

  function mapDelta(id, mapId, mode) {
    return memo(`m${id}|${mapId}|${mode}`, () => {
      const modePrior = overall(id) + CLASS_PRIOR_SCALE * (CLASS_MODE[mode]?.[cls(id)] ?? 0);
      const modeR = rate(S.mo[mode]?.[id], modePrior, K.mode);
      const mapR = rate(S.m[mapId]?.b?.[id], modeR, K.map);
      return mapR - 0.5;
    });
  }

  // How much better `a` does when facing `b` than their overall strength predicts.
  function counter(a, b) {
    return memo(`v${a}|${b}`, () => {
      const expected = 0.5 + overall(a) - overall(b);
      // No class-based prior here: type matchups (tank vs damage, assassin vs thrower...) are
      // handled by the team check in plan.js, so "Beats X" only ever comes from real results.
      return rate(S.vs[a]?.[b], expected, K.vs) - expected;
    });
  }

  function synergy(a, b) {
    return memo(`s${a}|${b}`, () => {
      const expected = overall(a) + overall(b) - 0.5;
      let bonus = CLASS_SYN_MAP.get(`${cls(a)}|${cls(b)}`) ?? 0;
      if (cls(a) === cls(b)) bonus += SAME_CLASS_PENALTY;
      return rate(S.w[a]?.[b], expected + bonus, K.syn) - expected;
    });
  }

  function mapGames(id, mapId) {
    const c = S.m[mapId]?.b?.[id];
    return c ? { ranked: c[1], all: c[3] } : { ranked: 0, all: 0 };
  }

  function pickRate(id, mapId) {
    // Share of this map's battles the brawler appeared in. m.n = [rankedBattles, allBattles].
    const m = S.m[mapId];
    const c = m?.b?.[id];
    if (!c) return 0;
    if (m.n[0] >= 50) return c[1] / m.n[0];
    return m.n[1] ? c[3] / m.n[1] : 0;
  }

  /**
   * Ranks every available brawler for `team`.
   * draft = { mapId, mode, bans: [], blue: [], red: [], firstTeam }
   * Results are cached per draft state: the app asks several times per screen.
   */
  const recCache = new Map();
  function recommend(draft, team = 'blue') {
    const key = `${team}|${draft.mapId}|${draft.mode}|${draft.firstTeam}|${draft.bans}|${draft.blue}|${draft.red}`;
    if (!recCache.has(key)) {
      if (recCache.size > 200) recCache.clear();
      recCache.set(key, computeRecommend(draft, team));
    }
    return recCache.get(key);
  }

  function computeRecommend(draft, team) {
    const allies = team === 'blue' ? draft.blue : draft.red;
    const enemies = team === 'blue' ? draft.red : draft.blue;
    const taken = new Set([...draft.bans, ...draft.blue, ...draft.red]);
    const available = meta.brawlers.filter(b => !taken.has(b.id)).map(b => b.id);

    const turn = nextTurn(draft.firstTeam, draft.blue.length, draft.red.length);
    const opponentPicksLeft = turn && turn.team === team ? turn.opponentPicksAfter : (3 - enemies.length);
    const allyClasses = allies.map(cls);
    const needs = teamNeeds(allyClasses, enemies.map(e => ({ name: brawlers.get(e)?.name || '?', cls: cls(e) })), draft.mode);
    // Brawlers the other side would realistically answer with: the strongest ones left on this map.
    const answerPool = opponentPicksLeft > 0
      ? [...available].sort((a, b) => mapDelta(b, draft.mapId, draft.mode) - mapDelta(a, draft.mapId, draft.mode)).slice(0, RISK_POOL + 1)
      : [];

    const results = available.map(id => {
      const reasons = [];
      const m = mapDelta(id, draft.mapId, draft.mode);
      reasons.push({ type: 'map', v: m });

      let total = m;
      for (const e of enemies) {
        const v = counter(id, e);
        total += v;
        reasons.push({ type: 'counter', target: e, v });
      }
      for (const a of allies) {
        const v = synergy(id, a);
        total += v;
        reasons.push({ type: 'synergy', target: a, v });
      }

      // Team shape and answers to the enemy's picks (see plan.js).
      const f = fit(cls(id), allyClasses, needs, draft.mode);
      total += f.v;
      reasons.push(...f.reasons);

      // If the other side still picks after us, they can answer this brawler with a counter.
      if (opponentPicksLeft > 0) {
        let worst = 0, worstId = null;
        for (const c of answerPool) {
          if (c === id) continue;
          const threat = counter(c, id);
          if (threat > worst) { worst = threat; worstId = c; }
        }
        const risk = worst * RISK_WEIGHT * Math.min(opponentPicksLeft, 2) / 2;
        if (worstId != null) reasons.push({ type: 'risk', target: worstId, v: -risk });
        total -= risk;
      }

      return {
        id,
        score: total,
        map: m,
        games: mapGames(id, draft.mapId),
        reasons: summarize(reasons),
        allReasons: reasons,
      };
    });

    results.sort((a, b) => b.score - a.score || brawlers.get(a.id).name.localeCompare(brawlers.get(b.id).name));
    return results;
  }

  // What the enemy will most likely lock in, so their pick is one tap away.
  // Top players mostly pick the map's meta, so popularity leads and fit to the draft adjusts it.
  function likelyPicks(draft, team = 'red') {
    return recommend(draft, team)
      .map(r => ({ ...r, likely: pickRate(r.id, draft.mapId) + 2 * r.score }))
      .sort((a, b) => b.likely - a.likely);
  }

  function banSuggestions(draft) {
    const taken = new Set([...draft.bans, ...draft.blue, ...draft.red]);
    return meta.brawlers
      .filter(b => !taken.has(b.id))
      .map(b => {
        const m = mapDelta(b.id, draft.mapId, draft.mode);
        const pr = pickRate(b.id, draft.mapId);
        return { id: b.id, score: m + 0.05 * pr, map: m, pickRate: pr, games: mapGames(b.id, draft.mapId), reasons: summarize([{ type: 'map', v: m }]) };
      })
      .sort((a, b) => b.score - a.score);
  }

  // Rough win chance for the current draft from blue's side.
  function draftEdge(draft) {
    let edge = 0;
    for (const b of draft.blue) edge += mapDelta(b, draft.mapId, draft.mode) / 1.5;
    for (const r of draft.red) edge -= mapDelta(r, draft.mapId, draft.mode) / 1.5;
    for (const b of draft.blue) for (const r of draft.red) edge += counter(b, r) / 3;
    const pairs = t => { let s = 0; for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) s += synergy(t[i], t[j]); return s; };
    edge += (pairs(draft.blue) - pairs(draft.red)) / 1.5;
    edge += composition(draft.blue, draft.red, draft.mode) - composition(draft.red, draft.blue, draft.mode);
    return Math.max(0.2, Math.min(0.8, 0.5 + edge));
  }

  const asEnemies = ids => ids.map(e => ({ name: brawlers.get(e)?.name || '?', cls: cls(e) }));
  const composition = (team, other, mode) => teamScore(team.map(cls), asEnemies(other), mode);

  // What `team` still needs right now, and a checklist of its draft so far (for the game plan card).
  function plan(draft, team = 'blue') {
    const allies = team === 'blue' ? draft.blue : draft.red;
    const enemies = team === 'blue' ? draft.red : draft.blue;
    return {
      needs: teamNeeds(allies.map(cls), asEnemies(enemies), draft.mode).map(({ key, title, why, w }) => ({ key, title, why, w })),
      report: teamReport(allies.map(cls), asEnemies(enemies), draft.mode),
    };
  }

  return { hasData, stats: S, mapDelta, counter, synergy, recommend, likelyPicks, banSuggestions, draftEdge, plan, mapGames, pickRate };
}

// Keep the clearest few reasons: best positives first, then the worst negative.
function summarize(reasons) {
  // A counter-pick warning under 1% isn't worth the user's attention mid-draft.
  const strong = reasons.filter(r => Math.abs(r.v) >= (r.type === 'risk' ? 0.01 : MIN_REASON));
  const pos = strong.filter(r => r.v > 0).sort((a, b) => b.v - a.v).slice(0, 3);
  const neg = strong.filter(r => r.v < 0).sort((a, b) => a.v - b.v).slice(0, 1);
  return [...pos, ...neg];
}
