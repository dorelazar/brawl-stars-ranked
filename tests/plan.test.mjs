import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamNeeds, fit, teamReport, teamScore } from '../site/js/plan.js';
import { createEngine } from '../site/js/engine.js';
import { meta } from './fixtures.mjs';

const draft = (extra = {}) => ({ mapId: 100, mode: 'gemGrab', bans: [], blue: [], red: [], firstTeam: 'blue', ...extra });
const rec = (e, d, id, team = 'blue') => e.recommend(d, team).find(r => r.id === id);
const hasReason = (r, key) => r.allReasons.some(x => x.key === key);

test('an empty team needs frontline and range', () => {
  const keys = teamNeeds([], [], 'brawlBall').map(n => n.key);
  assert.ok(keys.includes('frontline') && keys.includes('range'));
  // Long-range modes don't ask for a frontline.
  assert.ok(!teamNeeds([], [], 'knockout').some(n => n.key === 'frontline'));
});

test('enemy picks create answers to look for', () => {
  const needs = teamNeeds(['Tank'], [{ name: 'Bull', cls: 'Tank' }, { name: 'Barley', cls: 'Artillery' }], 'gemGrab');
  const anti = needs.find(n => n.key === 'antiTank');
  assert.ok(anti.fills('Damage Dealer') && anti.fills('Controller') && !anti.fills('Marksman'));
  assert.match(anti.title, /Bull is a tank/);
  const thrower = needs.find(n => n.key === 'vsThrower');
  assert.ok(thrower.fills('Assassin') && !thrower.fills('Marksman'));
});

test('long-range enemy: match their range or dive them (your example)', () => {
  const needs = teamNeeds([], [{ name: 'Piper', cls: 'Marksman' }], 'bounty');
  const n = needs.find(x => x.key === 'vsLong');
  assert.equal(n.short('Marksman'), 'Trades with Piper');
  assert.equal(n.short('Assassin'), 'Dives Piper');
});

test('fit penalises lopsided teams', () => {
  const tooShort = fit('Assassin', ['Tank', 'Assassin'], [], 'gemGrab');
  assert.ok(tooShort.v < 0 && tooShort.reasons[0].key === 'tooShort');
  const tooLong = fit('Marksman', ['Marksman', 'Artillery'], [], 'gemGrab');
  assert.ok(tooLong.v < 0);
  // But double range is fine in Knockout.
  assert.ok(fit('Marksman', ['Marksman', 'Artillery'], [], 'knockout').v >= -0.01);
});

test('a balanced team that answers the enemy scores higher', () => {
  const enemies = [{ name: 'Bull', cls: 'Tank' }, { name: 'Mortis', cls: 'Assassin' }, { name: 'Barley', cls: 'Artillery' }];
  const balanced = teamScore(['Tank', 'Controller', 'Damage Dealer'], enemies, 'gemGrab');
  const lopsided = teamScore(['Marksman', 'Marksman', 'Artillery'], enemies, 'gemGrab');
  assert.ok(balanced > lopsided, `${balanced} vs ${lopsided}`);
  const report = teamReport(['Marksman', 'Marksman', 'Artillery'], enemies, 'gemGrab');
  assert.ok(report.some(i => i.text === 'Frontline' && !i.ok));
});

test('engine: picks that fill gaps get the reason and a higher score', () => {
  const e = createEngine(meta, null);
  // Enemy took Bull: Shelly/Colt/Gene answer tanks, Piper doesn't.
  const d = draft({ red: [3], firstTeam: 'red' });
  assert.ok(hasReason(rec(e, d, 8), 'antiTank'));
  assert.ok(!hasReason(rec(e, d, 4), 'antiTank'));
  // Brawl Ball with no frontline: Bull gets "Adds frontline".
  assert.ok(hasReason(rec(e, draft({ mode: 'brawlBall' }), 3), 'frontline'));
});

test('engine: draft edge moves away from 50% for a clearly better composition', () => {
  const e = createEngine(meta, null);
  // Blue: Bull + Gene + Shelly (frontline, control, anti-tank). Red: Piper + Barley + Poco (no frontline).
  const edge = e.draftEdge(draft({ blue: [3, 8, 1], red: [4, 7, 6] }));
  assert.ok(edge >= 0.53, `edge ${edge}`); // "Ahead" in the app
  const p = e.plan(draft({ blue: [4], red: [3] }));
  assert.ok(p.needs.some(n => n.key === 'antiTank'));
  assert.ok(p.report.length > 0);
});
