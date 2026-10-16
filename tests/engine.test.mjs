import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, nextTurn, pickOrder } from '../site/js/engine.js';
import { emptyAgg, addBattle, normalizeBattle } from '../scripts/lib/aggregate.mjs';
import { buildStats } from '../scripts/build-stats.mjs';
import { meta, battle } from './fixtures.mjs';

const draft = (extra = {}) => ({ mapId: 100, mode: 'gemGrab', bans: [], blue: [], red: [], firstTeam: 'blue', ...extra });

test('pick order is 1-2-2-1', () => {
  assert.deepEqual(pickOrder('blue'), ['blue', 'red', 'red', 'blue', 'blue', 'red']);
  assert.deepEqual(pickOrder('red'), ['red', 'blue', 'blue', 'red', 'red', 'blue']);
});

test('nextTurn follows the order and counts the opponent\'s answers', () => {
  assert.deepEqual(nextTurn('blue', 0, 0), { index: 0, team: 'blue', opponentPicksAfter: 3, picksNow: 1 });
  assert.equal(nextTurn('blue', 1, 0).team, 'red');
  assert.equal(nextTurn('blue', 1, 0).picksNow, 2);
  assert.equal(nextTurn('blue', 1, 1).picksNow, 1);
  assert.equal(nextTurn('blue', 1, 2).team, 'blue');
  assert.equal(nextTurn('blue', 1, 2).picksNow, 2);
  assert.equal(nextTurn('blue', 3, 2).team, 'red');
  assert.equal(nextTurn('blue', 3, 2).opponentPicksAfter, 0);
  assert.equal(nextTurn('blue', 3, 3), null);
});

test('without data the engine still ranks using class estimates', () => {
  const e = createEngine(meta, null);
  assert.equal(e.hasData, false);
  const recs = e.recommend(draft());
  assert.equal(recs.length, 8);
  // Gem Grab favours controllers over assassins.
  const pos = id => recs.findIndex(r => r.id === id);
  assert.ok(pos(8) < pos(5), 'Gene should rank above Mortis in Gem Grab');
});

test('banned and picked brawlers are never recommended', () => {
  const e = createEngine(meta, null);
  const recs = e.recommend(draft({ bans: [1], blue: [2], red: [3] }));
  const ids = recs.map(r => r.id);
  assert.ok(!ids.includes(1) && !ids.includes(2) && !ids.includes(3));
});

// Piper (4) and Mortis (5) both win half their games overall,
// but Piper wins every game against Mortis: a pure counter.
function statsWhere(winsFor) {
  const agg = emptyAgg();
  let n = 0;
  const play = (teamA, teamB) => {
    const time = `g${n++}`;
    addBattle(agg, normalizeBattle(battle({ time, teamA, teamB }), `#A0${time}`));
  };
  for (let i = 0; i < 200; i++) {
    play([winsFor, 6, 7], [5, 2, 3]); // Piper beats Mortis
    play([1, 2, 3], [winsFor, 6, 7]); // Piper loses elsewhere
    play([5, 1, 8], [2, 3, 6]);       // Mortis wins elsewhere
  }
  return buildStats([agg]);
}

test('real data overrides estimates: a proven counter rises to the top', () => {
  const e = createEngine(meta, statsWhere(4)); // Piper keeps beating Mortis
  assert.equal(e.hasData, true);
  assert.ok(e.counter(4, 5) > 0.05, 'Piper should counter Mortis in the data');
  const before = e.recommend(draft()).find(r => r.id === 4);
  const after = e.recommend(draft({ red: [5], firstTeam: 'red' })).find(r => r.id === 4);
  assert.ok(after.score - before.score > 0.1, 'Piper\'s score should jump once Mortis is picked');
  assert.ok(after.reasons.some(r => r.type === 'counter' && r.target === 5));
  // And Mortis' teammates in the data don't get that boost.
  const bull = e.recommend(draft({ red: [5], firstTeam: 'red' })).find(r => r.id === 3);
  assert.ok(after.score > bull.score);
});

test('last pick has no counter-pick risk, first pick does', () => {
  const e = createEngine(meta, statsWhere(4));
  const first = e.recommend(draft()).find(r => r.id === 5);
  assert.ok(first.reasons.some(r => r.type === 'risk'), 'Mortis first pick is risky: Piper counters it');
  const last = e.recommend(draft({ blue: [1, 2], red: [3, 4, 6] })).find(r => r.id === 5);
  assert.ok(!last.reasons.some(r => r.type === 'risk'));
});

test('ban suggestions and draft edge stay in sane ranges', () => {
  const e = createEngine(meta, statsWhere(4));
  const bans = e.banSuggestions(draft());
  assert.equal(bans.length, 8);
  assert.ok(bans[0].score >= bans[bans.length - 1].score);
  const edge = e.draftEdge(draft({ blue: [4, 6, 7], red: [5, 2, 3] }));
  assert.ok(edge > 0.5 && edge <= 0.8, `edge ${edge}`);
  assert.equal(e.draftEdge(draft()), 0.5);
});
