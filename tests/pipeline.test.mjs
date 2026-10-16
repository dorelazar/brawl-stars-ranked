import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyAgg, addBattle, mergeAgg, normalizeBattle, battleKey } from '../scripts/lib/aggregate.mjs';
import { buildStats } from '../scripts/build-stats.mjs';
import { trimMeta } from '../scripts/fetch-meta.mjs';
import { battle } from './fixtures.mjs';

test('normalizeBattle picks the winning team from the log owner\'s result', () => {
  const e = battle({ time: 't1', teamA: [1, 2, 3], teamB: [4, 5, 6], ownerWon: false });
  const nb = normalizeBattle(e, '#A0t1');
  assert.deepEqual(nb.winners, [4, 5, 6]);
  assert.deepEqual(nb.losers, [1, 2, 3]);
  assert.equal(nb.ranked, true);

  // The same "defeat" read from a team B player's log means team A won.
  const fromOtherSide = normalizeBattle(e, '#B0t1');
  assert.deepEqual(fromOtherSide.winners, [1, 2, 3]);
});

test('normalizeBattle skips showdown, draws and unknown owners', () => {
  assert.equal(normalizeBattle(battle({ time: 't', mode: 'soloShowdown', teamA: [1, 2, 3], teamB: [4, 5, 6] }), '#A0t'), null);
  const draw = battle({ time: 't', teamA: [1, 2, 3], teamB: [4, 5, 6] });
  draw.battle.result = 'draw';
  assert.equal(normalizeBattle(draw, '#A0t'), null);
  assert.equal(normalizeBattle(battle({ time: 't', teamA: [1, 2, 3], teamB: [4, 5, 6] }), '#nobody'), null);
});

test('battleKey is the same from both teams\' logs', () => {
  const e = battle({ time: 't9', teamA: [1, 2, 3], teamB: [4, 5, 6] });
  assert.equal(battleKey(e), battleKey(structuredClone(e)));
});

test('addBattle counts wins, matchups and teammates', () => {
  const agg = emptyAgg();
  addBattle(agg, normalizeBattle(battle({ time: 'a', teamA: [1, 2, 3], teamB: [4, 5, 6] }), '#A0a'));
  addBattle(agg, normalizeBattle(battle({ time: 'b', type: 'ranked', teamA: [1, 7, 8], teamB: [4, 5, 6] }), '#A0b'));

  assert.deepEqual(agg.battles, { ranked: 1, all: 2 });
  assert.deepEqual(agg.b[1], [1, 1, 2, 2]);       // won both, one of them ranked
  assert.deepEqual(agg.b[4], [0, 1, 0, 2]);
  assert.deepEqual(agg.vs[1][4], [1, 1, 2, 2]);
  assert.deepEqual(agg.vs[4][1], [0, 1, 0, 2]);
  assert.deepEqual(agg.w[1][2], [1, 1, 1, 1]);
  assert.equal(agg.w[1][1], undefined);
  assert.deepEqual(agg.m[100].n, [1, 2]);
  assert.deepEqual(agg.mo.gemGrab[8], [0, 0, 1, 1]);
});

test('mergeAgg and buildStats sum days and list ranked maps', () => {
  const day = () => {
    const agg = emptyAgg();
    for (let i = 0; i < 12; i++) addBattle(agg, normalizeBattle(battle({ time: `d${i}`, teamA: [1, 2, 3], teamB: [4, 5, 6] }), `#A0d${i}`));
    return agg;
  };
  const stats = buildStats([day(), day()], new Date('2026-01-01'));
  assert.equal(stats.battles.all, 24);
  assert.deepEqual(stats.b[1], [24, 24, 24, 24]);
  assert.deepEqual(stats.rankedMaps, [100]);
  assert.equal(stats.generatedAt, '2026-01-01T00:00:00.000Z');

  const merged = mergeAgg(emptyAgg(), day());
  assert.equal(merged.battles.ranked, 12);
});

test('trimMeta keeps released brawlers and 3v3 maps only', () => {
  const meta = trimMeta(
    [
      { id: 1, name: 'Shelly', released: true, class: { name: 'Damage Dealer' }, rarity: { name: 'Starting', color: '#fff' }, imageUrl2: 'x.png' },
      { id: 2, name: 'Future', released: false, class: { name: 'Tank' } },
    ],
    [
      { id: 10, name: 'Gem Map', disabled: false, gameMode: { scId: 48000000 }, imageUrl: 'm.png' },
      { id: 11, name: 'SD Map', disabled: false, gameMode: { scId: 48000006 } },
    ],
    [
      { scId: 48000000, scHash: 'gemGrab', name: 'Gem Grab', color: '#d852ff', imageUrl: 'g.png' },
      { scId: 48000006, scHash: 'soloShowdown', name: 'Solo Showdown' },
    ],
  );
  assert.deepEqual(meta.brawlers.map(b => b.name), ['Shelly']);
  assert.deepEqual(meta.maps.map(m => m.id), [10]);
  assert.deepEqual(meta.modes.map(m => m.id), ['gemGrab']);
});
