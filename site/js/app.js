import { createEngine, nextTurn, pickOrder } from './engine.js';
import { rangeLabel } from './plan.js';

// ---------- Constants ----------

const RANKED_MODES = ['gemGrab', 'brawlBall', 'heist', 'bounty', 'hotZone', 'knockout'];
const CLASSES = ['Tank', 'Assassin', 'Damage Dealer', 'Marksman', 'Controller', 'Artillery', 'Support'];
const CLASS_SHORT = { 'Damage Dealer': 'Damage', Artillery: 'Thrower' };
const STORE = 'brawl-draft:v1';
const QUICK_TILES = 18; // likely picks shown as one-tap tiles: covers ~2 of every 3 real picks
const ICON = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
};

// ---------- State ----------

const S = {
  meta: null,
  stats: null,
  rotation: null,
  engine: null,
  view: 'maps',
  mode: 'gemGrab',
  mapQuery: '',
  allMaps: false,    // show non-ranked maps of the mode too
  draft: null,
  history: [],
  gridQuery: '',
  mineQuery: '',
  gridClass: 'all',
  showAll: false,
  sheet: null,
  mine: null,        // Set of brawler ids I play, or null = all
  recent: [],        // recently drafted map ids
};

const $app = document.getElementById('app');
const byId = new Map();
const mapById = new Map();
const modeById = new Map();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
    if (saved.draft) S.draft = saved.draft;
    if (saved.view === 'draft' && saved.draft) S.view = 'draft';
    if (RANKED_MODES.includes(saved.mode)) S.mode = saved.mode;
    if (Array.isArray(saved.mine)) S.mine = new Set(saved.mine);
    if (Array.isArray(saved.recent)) S.recent = saved.recent;
  } catch { /* private mode or corrupt storage: start fresh */ }
}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      draft: S.draft, view: S.view, mode: S.mode, recent: S.recent,
      mine: S.mine ? [...S.mine] : null,
    }));
  } catch { /* storage unavailable */ }
}

// ---------- Data ----------

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function init() {
  load();
  try {
    S.meta = await getJson('data/meta.json');
  } catch {
    $app.innerHTML = `<div class="boot"><div class="boot-logo">Brawl Draft</div>
      <div class="boot-sub">Couldn't load the brawler list. Check your connection and try again.</div>
      <p><button class="text-btn" onclick="location.reload()">Try again</button></p></div>`;
    return;
  }
  [S.stats, S.rotation] = await Promise.all([
    // ?stats=mock loads the local dev dataset (scripts/mock-stats.mjs).
    getJson(new URLSearchParams(location.search).get('stats') === 'mock' ? 'data/stats.mock.json' : 'data/stats.json').catch(() => null),
    getJson('data/rotation.json').catch(() => null),
  ]);
  for (const b of S.meta.brawlers) byId.set(b.id, b);
  // Brawlify lists reworked maps twice under the same name; keep the newest version.
  const latest = new Map();
  for (const m of S.meta.maps) {
    const key = `${m.mode}|${m.name.toLowerCase()}`;
    const prev = latest.get(key);
    if (!prev || (m.active && !prev.active) || (m.active === prev.active && m.id > prev.id)) latest.set(key, m);
  }
  for (const m of latest.values()) mapById.set(m.id, m);
  // Keep old ids resolvable (saved drafts, stats) but hidden from the lists.
  for (const m of S.meta.maps) if (!mapById.has(m.id)) mapById.set(m.id, { ...m, hidden: true });
  for (const m of S.meta.modes) modeById.set(m.id, m);
  // Maps seen in ranked data but missing from Brawlify (brand new maps).
  for (const [id, m] of Object.entries(S.stats?.m || {})) {
    if (!mapById.has(Number(id))) mapById.set(Number(id), { id: Number(id), name: m.name || 'Unknown map', mode: m.mode, img: null, active: true });
  }
  S.engine = createEngine(S.meta, S.stats);
  if (S.draft && !mapById.has(S.draft.mapId)) { S.draft = null; S.view = 'maps'; }
  render();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// ---------- Helpers ----------

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = v => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%`;
const name = id => byId.get(id)?.name || '?';
const img = (id, cls = '') => {
  const b = byId.get(id);
  return b ? `<img class="${cls}" src="${esc(b.img)}" alt="${esc(b.name)}" loading="lazy" decoding="async" onerror="__noPic(this)" data-initial="${esc(b.name[0])}" style="--rarity:${esc(b.color)}">` : '';
};
// Brand new brawlers sometimes have no picture on the CDN yet: show their initial instead.
window.__noPic = el => {
  const ph = document.createElement('span');
  ph.className = 'ph';
  ph.textContent = el.dataset.initial;
  ph.style.cssText = el.style.cssText;
  el.replaceWith(ph);
};
const modeIcon = id => {
  const m = modeById.get(id);
  return m?.img ? `<img src="${esc(m.img)}" alt="" loading="lazy">` : '';
};
const modeName = id => modeById.get(id)?.name || id;

function ago(iso) {
  const h = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (h < 1) return 'just now';
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

function liveMapIds() {
  const now = Date.now();
  const ids = new Set();
  for (const e of S.rotation?.events || []) {
    const end = e.end ? Date.parse(e.end.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2}).*$/, '$1-$2-$3T$4:$5:$6Z')) : NaN;
    if (!Number.isFinite(end) || end > now) ids.add(e.mapId);
  }
  return ids;
}

let toastTimer;
function toast(msg, action) {
  const t = document.getElementById('toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button data-toast>${esc(action.label)}</button>` : ''}`;
  t.hidden = false;
  t.onclick = e => { if (e.target.closest('[data-toast]')) { action.run(); t.hidden = true; } };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

// ---------- Draft logic ----------

function newDraft(mapId) {
  const map = mapById.get(mapId);
  const firstTeam = S.draft?.firstTeam || 'blue';
  S.draft = { mapId, mode: map.mode, bans: [], blue: [], red: [], firstTeam, bansDone: false };
  S.history = [];
  S.gridQuery = '';
  S.gridClass = 'all';
  S.showAll = false;
  S.recent = [mapId, ...S.recent.filter(id => id !== mapId)].slice(0, 6);
  if (RANKED_MODES.includes(map.mode)) S.mode = map.mode;
  S.view = 'draft';
  viewChangedAt = Date.now();
  save();
  render();
  window.scrollTo(0, 0);
}

// The tap that opens a draft can land on the search box that appears under the finger,
// which would pop up the iPhone keyboard. Ignore focus that arrives right after a screen change.
let viewChangedAt = 0;
document.addEventListener('focusin', e => {
  if (e.target.tagName === 'INPUT' && Date.now() - viewChangedAt < 500) { e.target.blur(); return; }
  // The keyboard covers the bottom half of the phone: lift the brawler search up under the header
  // so its results show above the keyboard.
  if (e.target.id === 'gridq') {
    setTimeout(() => {
      const header = document.querySelector('.top')?.offsetHeight || 0;
      window.scrollTo({ top: e.target.getBoundingClientRect().top + window.scrollY - header - 8 });
    }, 250);
  }
});

function snapshot() {
  S.history.push(JSON.stringify(S.draft));
  if (S.history.length > 40) S.history.shift();
}

function undo() {
  const prev = S.history.pop();
  if (!prev) return;
  S.draft = JSON.parse(prev);
  save();
  render();
}

// What a tap on a brawler does right now.
function currentStep() {
  const d = S.draft;
  if (!d) return null;
  if (!d.bansDone && d.bans.length < 6 && d.blue.length === 0 && d.red.length === 0) return { kind: 'ban' };
  const turn = nextTurn(d.firstTeam, d.blue.length, d.red.length);
  return turn ? { kind: 'pick', ...turn } : { kind: 'done' };
}

function choose(id) {
  const d = S.draft;
  const step = currentStep();
  if (!step || step.kind === 'done') return;
  if ([...d.bans, ...d.blue, ...d.red].includes(id)) return;
  snapshot();
  if (step.kind === 'ban') {
    d.bans.push(id);
    if (d.bans.length === 6) d.bansDone = true;
  } else {
    d[step.team].push(id);
    d.bansDone = true;
  }
  S.gridQuery = '';
  S.showAll = false;
  save();
  // Close the keyboard and jump back to the top: the next suggestions are right there.
  document.activeElement?.blur?.();
  render();
  window.scrollTo(0, 0);
  const label = step.kind === 'ban' ? 'Banned' : step.team === 'blue' ? 'You picked' : 'Enemy picked';
  toast(`${label} ${name(id)}`, { label: 'Undo', run: undo });
}

function removeFrom(list, id) {
  const d = S.draft;
  snapshot();
  d[list] = d[list].filter(x => x !== id);
  if (list === 'bans' && !d.blue.length && !d.red.length) d.bansDone = false;
  save();
  render();
  toast(`Removed ${name(id)}`, { label: 'Undo', run: undo });
}

// ---------- Views ----------

// Re-render only one region, leaving inputs (and the iPhone keyboard) alone.
function refresh(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html(); else render();
}

function render() {
  if (!S.meta) return;
  const y = window.scrollY;
  const focused = document.activeElement?.id;
  const caret = document.activeElement?.selectionStart;
  const sheetY = document.querySelector('.sheet')?.scrollTop;
  $app.innerHTML = S.view === 'draft' && S.draft ? draftView() : mapsView();
  if (S.sheet) {
    $app.insertAdjacentHTML('beforeend', sheetView());
    if (sheetY) document.querySelector('.sheet').scrollTop = sheetY;
  }
  if (focused) {
    const el = document.getElementById(focused);
    if (el) { el.focus(); if (caret != null && el.setSelectionRange) el.setSelectionRange(caret, caret); }
  }
  window.scrollTo(0, y);
}

function statusBar() {
  const st = S.stats;
  if (!S.engine.hasData) {
    return `<button class="status est" data-sheet="about"><span class="dot"></span>
      <span><b>Estimated picks</b> · live match stats aren't connected yet</span><span class="chev">›</span></button>`;
  }
  const old = Date.now() - Date.parse(st.generatedAt) > 24 * 36e5;
  return `<button class="status ${old ? 'old' : ''}" data-sheet="about"><span class="dot"></span>
    <span><b>${st.battles.ranked.toLocaleString()} ranked games</b> · updated ${ago(st.generatedAt)}${old ? ' · updates may be failing' : ''}</span><span class="chev">›</span></button>`;
}

function mapCard(m, badge) {
  const pic = m.img ? `<img src="${esc(m.img)}" alt="" loading="lazy" decoding="async">` : `<div class="no-img">?</div>`;
  return `<button class="map-card" data-map="${m.id}">
    ${pic}
    ${badge ? `<span class="badge ${badge.cls}">${badge.text}</span>` : ''}
    <span class="meta"><b>${esc(m.name)}</b><small>${modeIcon(m.mode)}${esc(modeName(m.mode))}</small></span>
  </button>`;
}

function mapsView() {
  const modes = RANKED_MODES.filter(id => modeById.has(id)).map(id => {
    const m = modeById.get(id);
    return `<button class="mode ${S.mode === id ? 'on' : ''}" style="--c:${esc(m.color || '#ffc93c')}" data-mode="${id}" aria-pressed="${S.mode === id}">
      ${modeIcon(id)}<span>${esc(m.name)}</span></button>`;
  }).join('');
  const recent = S.recent.map(id => mapById.get(id)).filter(m => m && !m.hidden).slice(0, 4);
  const recentRow = recent.length
    ? `<div class="recent"><span>Recent</span>${recent.map(m => `<button class="chip small" data-map="${m.id}">${modeIcon(m.mode)}${esc(m.name)}</button>`).join('')}</div>`
    : '';
  const resume = S.draft && (S.draft.blue.length || S.draft.red.length || S.draft.bans.length) && currentStep()?.kind !== 'done'
    ? `<button class="resume" data-action="resume"><span>Continue draft</span><b>${esc(mapById.get(S.draft.mapId)?.name)}</b><span class="chev">›</span></button>`
    : '';

  return `
    <header class="top">
      <h1>Brawl Draft</h1>
      <button class="icon-btn" data-sheet="mine" aria-label="My brawlers">${ICON.user}</button>
      <button class="icon-btn" data-sheet="about" aria-label="About and data">${ICON.info}</button>
    </header>
    ${statusBar()}
    ${resume}
    <p class="lead">Which map is your ranked game on?</p>
    <div class="modes" role="group" aria-label="Game mode">${modes}</div>
    ${recentRow}
    <div class="search">${ICON.search}<input id="mapq" type="search" placeholder="Or search any map" value="${esc(S.mapQuery)}" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search">${clearBtn('map', S.mapQuery)}</div>
    <div id="r-map">${mapsBody()}</div>`;
}

// The part of the maps screen that changes while typing (the search box itself is never re-created,
// so the iPhone keyboard stays open).
function mapsBody() {
  const ranked = new Set(S.stats?.rankedMaps || []);
  const live = liveMapIds();
  const badge = m => ranked.has(m.id) ? null : live.has(m.id) ? { cls: 'live', text: 'Live' } : null;
  const order = m => (ranked.has(m.id) ? 0 : live.has(m.id) ? 1 : 2);
  const sortMaps = list => list.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  const visible = m => (m.active && !m.hidden) || ranked.has(m.id);

  const q = S.mapQuery.trim().toLowerCase();
  if (q) {
    const found = sortMaps([...mapById.values()].filter(m => visible(m) && m.name.toLowerCase().includes(q)));
    return `<div class="section-title"><h2>Search</h2><span>${found.length} map${found.length === 1 ? '' : 's'}</span></div>` +
      (found.length ? `<div class="maps">${found.slice(0, 60).map(m => mapCard(m, ranked.has(m.id) ? { cls: '', text: 'Ranked' } : badge(m))).join('')}</div>` : `<div class="empty">No map called “${esc(S.mapQuery)}”.</div>`);
  }
  const all = sortMaps([...mapById.values()].filter(m => m.mode === S.mode && visible(m)));
  const inRanked = all.filter(m => ranked.has(m.id));
  // Before any ranked data exists, every map of the mode is a candidate.
  const shown = inRanked.length && !S.allMaps ? inRanked : all;
  const title = inRanked.length && !S.allMaps ? 'Ranked maps' : `All ${modeName(S.mode)} maps`;
  let body = `<div class="section-title"><h2>${esc(title)}</h2><span>tap your map</span></div>`;
  body += shown.length ? `<div class="maps">${shown.map(m => mapCard(m, badge(m))).join('')}</div>` : `<div class="empty">No maps for this mode right now.</div>`;
  if (inRanked.length && all.length > inRanked.length) {
    body += `<button class="more" data-action="all-maps">${S.allMaps ? 'Only ranked maps' : `Not here? Show all ${all.length} maps`}</button>`;
  }
  return body;
}

const clearBtn = (which, value) => `<button class="clear" data-clear="${which}" aria-label="Clear" ${value ? '' : 'hidden'}>×</button>`;

function slotsFor(team) {
  const d = S.draft;
  const order = pickOrder(d.firstTeam);
  const positions = order.map((t, i) => (t === team ? i + 1 : null)).filter(Boolean);
  const step = currentStep();
  const picks = d[team];
  return positions.map((pos, i) => {
    const id = picks[i];
    if (id != null) {
      return `<button class="slot filled" data-remove="${team}" data-id="${id}" aria-label="Remove ${esc(name(id))}">${img(id)}</button>`;
    }
    const isNext = step?.kind === 'pick' && step.team === team && i < picks.length + step.picksNow;
    return `<div class="slot ${isNext ? 'next' : ''}"><span>${pos}</span></div>`;
  }).join('');
}

function bansRow() {
  const d = S.draft;
  const step = currentStep();
  const cells = [];
  for (let i = 0; i < 6; i++) {
    const id = d.bans[i];
    if (id != null) cells.push(`<button class="ban filled" data-remove="bans" data-id="${id}" aria-label="Unban ${esc(name(id))}">${img(id)}</button>`);
    else cells.push(`<div class="ban ${step?.kind === 'ban' && i === d.bans.length ? 'next' : ''}"></div>`);
  }
  return `<div class="bans"><span>Bans</span><div class="ban-slots">${cells.join('')}</div></div>`;
}

function board() {
  return `<div class="board">
    <div class="side blue"><b>You</b><div class="slots">${slotsFor('blue')}</div></div>
    <div class="vs">VS</div>
    <div class="side red"><b>Enemy</b><div class="slots">${slotsFor('red')}</div></div>
    ${bansRow()}
  </div>`;
}

// Who picks first decides the whole order, so it's asked right in the banner until the first pick.
function firstPickToggle() {
  const d = S.draft;
  return `<div class="first-pick"><span>First pick:</span>
    <div class="seg" role="group" aria-label="Who picks first">
      <button class="${d.firstTeam === 'blue' ? 'on' : ''}" data-first="blue" aria-pressed="${d.firstTeam === 'blue'}">Us</button>
      <button class="${d.firstTeam === 'red' ? 'on' : ''}" data-first="red" aria-pressed="${d.firstTeam === 'red'}">Them</button>
    </div></div>`;
}

function turnBanner(step) {
  const d = S.draft;
  const started = d.blue.length + d.red.length > 0;
  if (step.kind === 'ban') {
    return `<div class="turn"><div class="what"><b>Bans · ${d.bans.length}/6</b><span>Tap the banned brawlers, or skip.</span>${firstPickToggle()}</div>
      <button class="go-btn" data-action="skip-bans">${d.bans.length ? 'Picks' : 'Skip'} ›</button></div>`;
  }
  if (step.kind === 'done') {
    return `<div class="turn done"><div class="what"><b>Draft complete</b><span>Good luck! Here's how the two teams compare.</span></div></div>`;
  }
  const mine = step.team === 'blue';
  const n = step.picksNow === 2 ? '2 picks' : '1 pick';
  const title = mine ? `Your turn · ${n}` : `Enemy's turn · ${n}`;
  const sub = mine
    ? (step.opponentPicksAfter === 0 ? 'Last pick: counter freely, nobody can answer.' : `They pick ${step.opponentPicksAfter} more after you, so avoid easy counters.`)
    : `Tap what they lock in${step.picksNow === 2 ? ' (both picks)' : ''}.`;
  return `<div class="turn ${step.team}"><div class="what"><b>${title}</b><span>${sub}</span>${started ? '' : firstPickToggle()}</div></div>`;
}

function reasonChip(r, rec, team) {
  const cls = r.v >= 0 ? 'pos' : 'neg';
  let text;
  // Without enough real games the map number is only a class-vs-mode estimate: say so.
  const estimated = (rec?.games?.ranked ?? 0) < 30;
  const mode = modeName(S.draft.mode);
  if (r.type === 'map' && estimated) text = r.v >= 0 ? `Good in ${mode}` : `Weak in ${mode}`;
  else if (r.type === 'map') text = r.v >= 0 ? 'Strong on this map' : 'Weak on this map';
  else if (r.type === 'need') text = r.label;
  else if (r.type === 'counter') text = r.v >= 0 ? `Beats ${name(r.target)}` : `Weak vs ${name(r.target)}`;
  else if (r.type === 'synergy') text = r.v >= 0 ? `Good with ${name(r.target)}` : `Awkward with ${name(r.target)}`;
  // For enemy predictions the "risk" is our chance to answer their pick.
  else if (r.type === 'risk') text = team === 'red' ? `You can answer with ${name(r.target)}` : `${name(r.target)} counters it`;
  return `<span class="reason ${cls}" title="${pct(r.v)}">${esc(text)}</span>`;
}

function recCard(r, i) {
  const b = byId.get(r.id);
  return `<button class="rec ${i === 0 ? 'best' : ''}" data-pick="${r.id}">
    <span class="pic"><span class="rank">${i + 1}</span>${img(r.id)}</span>
    <span class="info"><span class="name">${esc(b.name)} <small>${esc(CLASS_SHORT[b.cls] || b.cls)} · ${esc(rangeLabel(b.cls))}</small></span>
      <span class="reasons">${r.reasons.map(x => reasonChip(x, r, 'blue')).join('') || '<span class="reason">Solid all-round</span>'}</span></span>
    <span class="score"><b class="${r.score >= 0 ? 'pos' : 'neg'}">${pct(r.score)}</b><span>edge</span></span>
  </button>`;
}

// One brawler button. rank: small number badge (best picks / bans); tag: small corner value.
function tile(id, { off = false, rank = 0, tag = '' } = {}) {
  const b = byId.get(id);
  return `<button class="tile ${off ? 'off' : ''} ${rank && rank <= 3 ? 'hot' : ''}" data-pick="${id}" ${off ? 'disabled' : ''} aria-label="${esc(b.name)}">
    ${img(id)}<span>${esc(b.name)}</span>${rank ? `<i class="rk">${rank}</i>` : ''}${tag}</button>`;
}

// Your turn: the best picks first, with the reasons.
function yourPicks() {
  const d = S.draft;
  let list = S.engine.recommend(d, 'blue');
  if (S.mine) list = list.filter(r => S.mine.has(r.id));
  const n = S.showAll ? 10 : 4;
  const cards = list.slice(0, n).map(recCard).join('');
  const note = S.engine.hasData ? '' : `<p class="note">Rough estimates by brawler type until live stats are connected.</p>`;
  return `<div class="section-title"><h2>Best picks for you</h2><span>${S.mine ? `from your ${S.mine.size} brawlers · ` : ''}tap to lock in</span></div>${note}
    <div class="recs">${cards || `<div class="empty">None of your brawlers are left. <button class="text-btn" data-sheet="mine">Edit my brawlers</button></div>`}</div>
    ${list.length > 4 ? `<button class="more" data-action="more">${S.showAll ? 'Show fewer' : 'Show more picks'}</button>` : ''}
    ${planCard()}`;
}

// Enemy turn / bans: the most likely brawlers as one-tap tiles.
function quickTiles(step) {
  const d = S.draft;
  if (step.kind === 'ban') {
    const list = S.engine.banSuggestions(d).slice(0, QUICK_TILES);
    const best = list[0];
    const tiles = list.map((r, i) => tile(r.id, {
      rank: i < 3 ? i + 1 : 0,
      tag: `<em class="tag ${r.map >= 0 ? 'pos' : 'neg'}">${r.map >= 0 ? '+' : '−'}${Math.abs(r.map * 100).toFixed(0)}%</em>`,
    })).join('');
    return `<div class="section-title"><h2>Strongest here</h2><span>ban one of the top 3</span></div>
      ${best ? `<p class="note">Best ban: <b>${esc(name(best.id))}</b>, ${pct(best.map)} win rate on this map.</p>` : ''}
      <div class="grid quick">${tiles}</div>`;
  }
  const list = S.engine.likelyPicks(d, 'red').slice(0, QUICK_TILES);
  return `<div class="section-title"><h2>Their likely picks</h2><span>tap what they lock in</span></div>
    <div class="grid quick">${list.map(r => tile(r.id)).join('')}</div>`;
}

// Every brawler, A–Z, for anything the shortcuts above don't cover.
function brawlerGrid(step) {
  const d = S.draft;
  const taken = new Set([...d.bans, ...d.blue, ...d.red]);
  const rank = new Map();
  if (step.kind === 'pick' && step.team === 'blue') S.engine.recommend(d, 'blue').slice(0, 10).forEach((r, i) => rank.set(r.id, i + 1));
  const list = S.meta.brawlers.filter(b => S.gridClass === 'all' || b.cls === S.gridClass);
  const classChips = ['all', ...CLASSES].map(c => `<button class="chip small ${S.gridClass === c ? 'on' : ''}" data-class="${esc(c)}">${c === 'all' ? 'All' : esc(CLASS_SHORT[c] || c)}</button>`).join('');
  const title = step.kind === 'ban' ? 'All brawlers' : step.team === 'blue' ? 'Picking someone else?' : 'All brawlers';
  return `<div class="section-title"><h2>${title}</h2><span>A–Z</span></div>
    <div class="chips">${classChips}</div>
    <div class="grid">${list.map(b => tile(b.id, { off: taken.has(b.id), rank: rank.get(b.id) || 0 })).join('') || '<div class="empty" style="grid-column:1/-1">No brawler matches.</div>'}</div>`;
}

// Name search sits right under the turn banner: type 2 letters + Enter during the draft timer.
function quickSearch(step) {
  const placeholder = step.kind === 'ban' ? 'Search a ban' : step.team === 'blue' ? 'Search your pick' : 'Search their pick';
  return `<div class="search quick">${ICON.search}<input id="gridq" type="search" placeholder="${placeholder} (2 letters + Enter)" value="${esc(S.gridQuery)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done">${clearBtn('grid', S.gridQuery)}</div>`;
}

function searchResults(step) {
  const d = S.draft;
  const taken = new Set([...d.bans, ...d.blue, ...d.red]);
  const q = S.gridQuery.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = b => b.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const starts = S.meta.brawlers.filter(b => key(b).startsWith(q));
  const contains = S.meta.brawlers.filter(b => !key(b).startsWith(q) && key(b).includes(q));
  // Free brawlers first, so Enter always takes a brawler that can still be chosen.
  const list = [...starts, ...contains].sort((a, b) => taken.has(a.id) - taken.has(b.id));
  const verb = step.kind === 'ban' ? 'ban' : step.team === 'blue' ? 'pick' : 'mark their pick';
  return `<div class="section-title"><h2>Matches</h2><span>tap to ${verb} · Enter takes the first</span></div>
    <div class="grid">${list.map(b => tile(b.id, { off: taken.has(b.id) })).join('') || '<div class="empty" style="grid-column:1/-1">No brawler matches.</div>'}</div>`;
}

function draftBody(step) {
  if (S.gridQuery.trim()) return searchResults(step);
  const top = step.kind === 'pick' && step.team === 'blue' ? yourPicks() : quickTiles(step);
  return top + brawlerGrid(step);
}

function draftView() {
  const d = S.draft;
  const map = mapById.get(d.mapId);
  const step = currentStep();

  return `
    <header class="top">
      <button class="icon-btn" data-action="home" aria-label="Back to maps">${ICON.back}</button>
      <div class="title"><b>${esc(map.name)}</b><small>${modeIcon(map.mode)}${esc(modeName(map.mode))}</small></div>
      <button class="icon-btn" data-action="undo" aria-label="Undo" ${S.history.length ? '' : 'disabled'}>${ICON.undo}</button>
      <button class="text-btn" data-action="reset">Reset</button>
    </header>
    ${board()}
    ${turnBanner(step)}
    ${step.kind === 'done' ? doneView() : `${quickSearch(step)}<div id="r-draft">${draftBody(step)}</div>`}`;
}

function doneView() {
  return `${edgeMeter(S.engine.draftEdge(S.draft))}${teamChecks()}
    <div class="row-btns"><button class="go-btn" data-action="again">Same map again</button><button class="text-btn" data-action="home">Change map</button></div>`;
}

// Drafts move win chance by a few percent; skill decides the rest.
function edgeMeter(edge) {
  const p = Math.round(edge * 100);
  const label = p >= 58 ? 'Clearly ahead' : p >= 53 ? 'Ahead' : p > 47 ? 'Even' : p > 42 ? 'Behind' : 'Clearly behind';
  return `<button class="edge" data-sheet="about" aria-label="What the draft edge means">
    <div class="edge-row"><span>Draft edge${S.engine.hasData ? '' : ' · estimate'} <span class="q">?</span></span><b>${label} · You ${p}% – ${100 - p}% Them</b></div>
    <div class="edge-bar"><i style="width:${edge * 100}%"></i></div></button>`;
}

// What your team still needs, in plain words. Hidden on an empty draft, where it would say everything.
function planCard() {
  const d = S.draft;
  if (!d.blue.length && !d.red.length) return '';
  const { needs } = S.engine.plan(d, 'blue');
  if (!needs.length) return '';
  const body = needs.slice(0, 3).map(n => `<li><b>${esc(n.title)}</b><span>${esc(n.why)}</span></li>`).join('');
  return `<div class="plan"><h3>Your team needs</h3><ul>${body}</ul></div>`;
}

// Final checklist for both teams.
function teamChecks() {
  const row = (team, label) => {
    const items = S.engine.plan(S.draft, team).report;
    return `<div class="check ${team}"><b>${label}</b><div>${items.map(i => `<span class="${i.ok ? 'ok' : 'miss'}">${i.ok ? '✓' : '✗'} ${esc(i.text)}</span>`).join('')}</div></div>`;
  };
  return `<div class="plan"><h3>Team check</h3>${row('blue', 'You')}${row('red', 'Enemy')}</div>`;
}

function mineTiles() {
  const q = S.mineQuery.trim().toLowerCase();
  return S.meta.brawlers.filter(b => !q || b.name.toLowerCase().includes(q)).map(b => {
    const on = !S.mine || S.mine.has(b.id);
    return `<button class="tile ${on ? 'mine-on' : 'mine-off'}" data-mine="${b.id}" aria-pressed="${on}">${img(b.id)}<span>${esc(b.name)}</span></button>`;
  }).join('') || '<div class="empty" style="grid-column:1/-1">No brawler matches.</div>';
}

function sheetView() {
  let inner = '';
  if (S.sheet === 'about') {
    const st = S.stats;
    const data = S.engine.hasData
      ? `<dl class="kv">
          <dt>Ranked games</dt><dd>${st.battles.ranked.toLocaleString()}</dd>
          <dt>Days covered</dt><dd>${st.days}</dd>
          <dt>Ranked maps found</dt><dd>${st.rankedMaps.length}</dd>
          <dt>Updated</dt><dd>${ago(st.generatedAt)}</dd>
        </dl>`
      : `<p><b>Live match stats aren't connected yet.</b> Until they are, picks are estimated from each brawler's class and the game mode (for example: marksmen in Knockout, tanks in Brawl Ball). Once the update job is set up, everything switches to real ranked results automatically.</p>`;
    inner = `<h2>How it works</h2>
      <ol class="steps">
        <li><b>Pick the map</b> your ranked game is on.</li>
        <li><b>Bans:</b> tap the banned brawlers, or skip.</li>
        <li><b>Your turn:</b> tap one of the suggested picks to lock it in.</li>
        <li><b>Their turn:</b> tap what they picked. Their most likely picks are at the top.</li>
      </ol>
      <p>Tap a picked brawler on the board to remove it. Every tap can be undone.</p>
      <h3>Data</h3>${data}
      <h3>What the numbers mean</h3>
      <ul>
        <li><b>Edge</b> is roughly how much the pick changes your win chance, e.g. <b>+3.0%</b>.</li>
        <li><b>Strong on this map</b>: win rate on this map in ranked games. <b>Good in Gem Grab</b> means there aren't enough games on this map yet, so it uses the whole mode.</li>
        <li><b>Beats / Weak vs</b>: head-to-head results against the enemy's picks.</li>
        <li><b>Good with</b>: how well it does next to your teammates.</li>
        <li><b>… counters it</b>: if the enemy still picks after you, the app warns you about an easy answer to your pick.</li>
        <li><b>Adds frontline / Adds range / Answers Bull…</b>: the team check. The app looks at what your team is missing and what the enemy's picks threaten, and favours picks that cover it.</li>
      </ul>
      <h3>Why is the draft edge close to 50%?</h3>
      <p>Because that's how Brawl Stars works: even a great draft only moves your win chance by a few percent, usually <b>45–60%</b>. Aim and teamwork decide the rest. "Ahead" at 54% means you'd win about 4 more games out of 100 than with an even draft.</p>
      <p>Small samples are pulled toward safer estimates, so a brawler doesn't jump to the top after a few lucky games.</p>
      <p>Stats come from the official Brawl Stars API (recent ranked battles of top players) and refresh every 4 hours. Brawler and map info is from Brawlify.</p>
      <p style="font-size:12px;color:var(--faint)">Unofficial fan project. Not endorsed by Supercell. This app doesn't touch the game itself; you tap the picks.</p>
      <div class="row"><button class="text-btn" data-sheet="">Close</button></div>`;
  } else if (S.sheet === 'mine') {
    const mine = S.mine;
    const tiles = mineTiles();
    inner = `<h2>My brawlers</h2>
      <p>Turn off brawlers you don't have or don't play. Your suggestions only use the ones that stay on. Enemy predictions still use everyone.</p>
      <div class="row"><button class="text-btn" data-mine-all="on">All on</button><button class="text-btn" data-mine-all="off">All off</button><button class="text-btn" data-sheet="">Done</button></div>
      <p style="margin:6px 0 10px"><b>${mine ? mine.size : S.meta.brawlers.length}</b> of ${S.meta.brawlers.length} on</p>
      <div class="search">${ICON.search}<input id="mineq" type="search" placeholder="Search brawlers" value="${esc(S.mineQuery)}" autocomplete="off" autocorrect="off" spellcheck="false">${clearBtn('mine', S.mineQuery)}</div>
      <div class="grid" id="r-mine">${tiles}</div>`;
  }
  return `<div class="sheet-bg" data-sheet=""></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${inner}</div>`;
}

// ---------- Events ----------

$app.addEventListener('click', e => {
  const t = e.target.closest('button, [data-sheet]');
  if (!t || t.disabled) return;
  const ds = t.dataset;

  if ('sheet' in ds) { S.sheet = ds.sheet || null; render(); return; }
  if (ds.mode) { S.mode = ds.mode; S.mapQuery = ''; S.allMaps = false; save(); render(); return; }
  if (ds.map) { newDraft(Number(ds.map)); return; }
  if (ds.pick) { choose(Number(ds.pick)); return; }
  if (ds.remove) { removeFrom(ds.remove, Number(ds.id)); return; }
  if (ds.class) { S.gridClass = ds.class; render(); return; }
  if (ds.first) { S.draft.firstTeam = ds.first; save(); render(); return; }
  if (ds.clear) {
    const input = t.parentElement.querySelector('input');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    return;
  }
  if (ds.mine) {
    const id = Number(ds.mine);
    if (!S.mine) S.mine = new Set(S.meta.brawlers.map(b => b.id));
    S.mine.has(id) ? S.mine.delete(id) : S.mine.add(id);
    if (S.mine.size === S.meta.brawlers.length) S.mine = null;
    save(); render(); return;
  }
  if (ds.mineAll) {
    S.mine = ds.mineAll === 'on' ? null : new Set();
    save(); render(); return;
  }

  switch (ds.action) {
    case 'home': S.view = 'maps'; viewChangedAt = Date.now(); save(); render(); window.scrollTo(0, 0); break;
    case 'resume': S.view = 'draft'; viewChangedAt = Date.now(); save(); render(); window.scrollTo(0, 0); break;
    case 'undo': undo(); break;
    case 'reset': {
      snapshot();
      const d = S.draft;
      S.draft = { ...d, bans: [], blue: [], red: [], bansDone: false };
      S.gridQuery = '';
      save(); render(); window.scrollTo(0, 0);
      toast('Draft cleared', { label: 'Undo', run: undo });
      break;
    }
    case 'again': newDraft(S.draft.mapId); break;
    case 'skip-bans': snapshot(); S.draft.bansDone = true; save(); render(); window.scrollTo(0, 0); break;
    case 'more': S.showAll = !S.showAll; render(); break;
    case 'all-maps': S.allMaps = !S.allMaps; render(); break;
  }
});

$app.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'mapq') { S.mapQuery = t.value; refresh('r-map', mapsBody); }
  if (t.id === 'gridq') { S.gridQuery = t.value; refresh('r-draft', () => draftBody(currentStep())); }
  if (t.id === 'mineq') { S.mineQuery = t.value; refresh('r-mine', mineTiles); }
  t.parentElement.querySelector('.clear')?.toggleAttribute('hidden', !t.value);
});

// Enter in the brawler search picks the first free match: fast during the draft timer.
$app.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.target.id !== 'gridq') return;
  e.preventDefault();
  const first = document.querySelector('#r-draft .tile:not(.off)');
  if (first && S.gridQuery.trim()) choose(Number(first.dataset.pick));
  else e.target.blur();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.sheet) { S.sheet = null; render(); }
});

init();
