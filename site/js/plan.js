// Team-composition layer: what does a team still need, and what do the enemy's
// picks threaten? Works from each brawler's class (from Brawlify), so it applies
// to new brawlers automatically. Values are win-rate deltas, like the rest of the engine.

export const ROLE = {
  Tank:            { range: 'short', label: 'Tank',       tags: ['frontline'] },
  Assassin:        { range: 'short', label: 'Assassin',   tags: ['frontline', 'dive'] },
  'Damage Dealer': { range: 'mid',   label: 'Damage',     tags: ['damage', 'antiTank', 'antiDive'] },
  Marksman:        { range: 'long',  label: 'Marksman',   tags: ['long', 'sniper'] },
  Artillery:       { range: 'long',  label: 'Thrower',    tags: ['long', 'thrower'] },
  Controller:      { range: 'mid',   label: 'Controller', tags: ['control', 'antiTank', 'antiDive'] },
  Support:         { range: 'mid',   label: 'Support',    tags: ['sustain'] },
};
const RANGE_LABEL = { short: 'short range', mid: 'mid range', long: 'long range' };
export const rangeLabel = cls => RANGE_LABEL[ROLE[cls]?.range] || '';

const has = (cls, tag) => !!ROLE[cls]?.tags.includes(tag);
const LONG_MODES = new Set(['bounty', 'knockout', 'wipeout']);
const BALL_MODES = new Set(['brawlBall', 'brawlHockey', 'basketBrawl']);
const CONTROL_MODES = new Set(['gemGrab', 'hotZone']);

const list = names => names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/**
 * What `allies` still needs against `enemies` in `mode`.
 * Each need: { key, title, why, w, fills(cls) → bool, short(cls) → chip text }.
 */
export function teamNeeds(allyClasses, enemies, mode) {
  // enemies: [{ name, cls }]
  const needs = [];
  const count = tag => allyClasses.filter(c => has(c, tag)).length;
  const enemyWith = tag => enemies.filter(e => has(e.cls, tag));

  // --- Team shape ---
  if (!LONG_MODES.has(mode) && count('frontline') === 0) {
    needs.push({
      key: 'frontline', w: BALL_MODES.has(mode) ? .025 : .015,
      title: 'No frontline yet',
      why: BALL_MODES.has(mode) ? 'Ball modes need a tank or assassin to push and carry the ball.' : 'Someone has to take space and soak damage.',
      fills: c => has(c, 'frontline'), short: () => 'Adds frontline',
    });
  }
  const reach = allyClasses.filter(c => has(c, 'long') || has(c, 'control')).length;
  if (reach === 0) {
    needs.push({
      key: 'range', w: LONG_MODES.has(mode) ? .03 : .015,
      title: 'No long range yet',
      why: LONG_MODES.has(mode) ? 'Open maps like this reward brawlers who hit from far away.' : 'Without range your team can be poked down from safety.',
      fills: c => has(c, 'long') || has(c, 'control'), short: () => 'Adds range',
    });
  } else if (LONG_MODES.has(mode) && count('long') < 2) {
    needs.push({
      key: 'range2', w: .012,
      title: 'Could use more range',
      why: 'In this mode most top teams run two long-range brawlers.',
      fills: c => has(c, 'long'), short: () => 'More range',
    });
  }
  if (CONTROL_MODES.has(mode) && count('control') + count('sustain') === 0) {
    needs.push({
      key: 'control', w: .012,
      title: 'No control or healing',
      why: mode === 'hotZone' ? 'Holding the zone needs area damage or healing.' : 'Holding gems mid needs area control or healing.',
      fills: c => has(c, 'control') || has(c, 'sustain'), short: () => mode === 'hotZone' ? 'Holds the zone' : 'Holds mid',
    });
  }
  if (mode === 'heist' && count('damage') + count('thrower') === 0) {
    needs.push({
      key: 'safe-dmg', w: .015,
      title: 'Low safe damage',
      why: 'Heist is won by damage on the safe.',
      fills: c => has(c, 'damage') || has(c, 'thrower'), short: () => 'Damages the safe',
    });
  }

  // --- Answers to the enemy ---
  const tanks = enemies.filter(e => e.cls === 'Tank');
  if (tanks.length) {
    needs.push({
      key: 'antiTank', w: .015 * tanks.length,
      title: `Enemy ${list(tanks.map(e => e.name))} ${tanks.length > 1 ? 'are tanks' : 'is a tank'}`,
      why: 'High damage and control shut tanks down before they reach you.',
      fills: c => has(c, 'antiTank'), short: () => `Answers ${tanks[0].name}`,
    });
  }
  const snipers = enemyWith('sniper');
  if (snipers.length) {
    needs.push({
      key: 'vsLong', w: .015 * snipers.length,
      title: `Enemy ${list(snipers.map(e => e.name))} ${snipers.length > 1 ? 'hit' : 'hits'} from long range`,
      why: 'Match their range so you can trade back, or dive them with an assassin.',
      fills: c => has(c, 'sniper') || has(c, 'dive'),
      short: c => has(c, 'dive') ? `Dives ${snipers[0].name}` : `Trades with ${snipers[0].name}`,
    });
  }
  const throwers = enemyWith('thrower');
  if (throwers.length) {
    needs.push({
      key: 'vsThrower', w: .018 * throwers.length,
      title: `Enemy ${list(throwers.map(e => e.name))} ${throwers.length > 1 ? 'throw' : 'throws'} over walls`,
      why: 'Throwers are weak up close: send a tank or assassin at them.',
      fills: c => has(c, 'frontline'), short: () => `Dives ${throwers[0].name}`,
    });
  }
  const divers = enemyWith('dive');
  if (divers.length) {
    needs.push({
      key: 'vsDive', w: .015 * divers.length,
      title: `Enemy ${list(divers.map(e => e.name))} ${divers.length > 1 ? 'dive' : 'dives'} your backline`,
      why: 'Close-range damage and control punish assassins that jump in.',
      fills: c => has(c, 'antiDive'), short: () => `Stops ${divers[0].name}`,
    });
  }
  const healers = enemies.filter(e => has(e.cls, 'sustain'));
  if (healers.length) {
    needs.push({
      key: 'vsSustain', w: .01 * healers.length,
      title: `Enemy ${list(healers.map(e => e.name))} ${healers.length > 1 ? 'heal' : 'heals'} their team`,
      why: 'Burst damage and dives beat healing over time.',
      fills: c => has(c, 'dive') || has(c, 'damage'), short: () => `Beats ${healers[0].name}'s healing`,
    });
  }
  return needs.sort((a, b) => b.w - a.w);
}

/** How well a brawler of class `cls` fits the team: needs it fills, and balance penalties. */
export function fit(cls, allyClasses, needs, mode) {
  const reasons = [];
  let v = 0;
  for (const n of needs) {
    if (n.fills(cls)) {
      v += n.w;
      reasons.push({ type: 'need', key: n.key, label: n.short(cls), v: n.w });
    }
  }
  const range = ROLE[cls]?.range;
  const sameRange = allyClasses.filter(c => ROLE[c]?.range === range).length;
  if (range === 'short' && sameRange >= 2 && !BALL_MODES.has(mode)) {
    v -= .025; reasons.push({ type: 'need', key: 'tooShort', label: 'Team gets too short-ranged', v: -.025 });
  } else if (range === 'long' && sameRange >= 2 && !LONG_MODES.has(mode)) {
    v -= .02; reasons.push({ type: 'need', key: 'tooLong', label: 'Nobody would take space', v: -.02 });
  } else if (sameRange >= 2) {
    v -= .008; reasons.push({ type: 'need', key: 'sameRange', label: `Third ${RANGE_LABEL[range]}`, v: -.008 });
  }
  return { v, reasons };
}

/** Check-list for a team's finished (or partial) draft, for the UI. */
export function teamReport(allyClasses, enemies, mode) {
  const items = [];
  const count = tag => allyClasses.filter(c => has(c, tag)).length;
  if (!LONG_MODES.has(mode)) items.push({ ok: count('frontline') > 0, text: 'Frontline' });
  items.push({ ok: allyClasses.some(c => has(c, 'long') || has(c, 'control')), text: 'Range' });
  if (CONTROL_MODES.has(mode)) items.push({ ok: count('control') + count('sustain') > 0, text: 'Control or healing' });
  const threats = teamNeeds([], enemies, mode).filter(n => !['frontline', 'range', 'range2', 'control', 'safe-dmg'].includes(n.key));
  for (const t of threats) items.push({ ok: allyClasses.some(c => t.fills(c)), text: t.short(allyClasses.find(c => t.fills(c)) || '') });
  return items;
}

/** Composition score of a whole team: positive = well rounded and answers the enemy. */
export function teamScore(allyClasses, enemies, mode) {
  let s = 0;
  for (const it of teamReport(allyClasses, enemies, mode)) s += it.ok ? .01 : -.01;
  const ranges = allyClasses.map(c => ROLE[c]?.range);
  for (const r of ['short', 'long']) if (ranges.filter(x => x === r).length >= 3) s -= .02;
  return s;
}
