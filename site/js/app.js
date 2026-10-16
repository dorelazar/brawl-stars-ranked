import { createEngine, nextTurn, pickOrder } from './engine.js';
import { rangeLabel } from './plan.js';

// ---------- Constants ----------

const RANKED_MODES = ['gemGrab', 'brawlBall', 'heist', 'bounty', 'hotZone', 'knockout'];
const CLASSES = ['Tank', 'Assassin', 'Damage Dealer', 'Marksman', 'Controller', 'Artillery', 'Support'];
const STORE = 'brawl-draft:v1';
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
    if (saved.mode) S.mode = saved.mode;
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
  S.showAll = false;
  S.recent = [mapId, ...S.recent.filter(id => id !== mapId)].slice(0, 6);
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
  if (e.target.tagName === 'INPUT' && Date.now() - viewChangedAt < 500) e.target.blur();
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
  render();
  const after = currentStep();
  const label = step.kind === 'ban' ? 'Banned' : step.team === 'blue' ? 'You picked' : 'Enemy picked';
  toast(`${label} ${name(id)}`, { label: 'Undo', run: undo });
  if (after?.kind === 'pick' && after.team !== step.team) {
    document.querySelector('.turn')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

function removeFrom(list, id) {
  const d = S.draft;
  snapshot();
  d[list] = d[list].filter(x => x !== id);
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
  const old = Date.now() - Date.parse(st.generatedAt) > 48 * 36e5;
  return `<button class="status ${old ? 'old' : ''}" data-sheet="about"><span class="dot"></span>
    <span><b>${st.battles.ranked.toLocaleString()} ranked games</b> · updated ${ago(st.generatedAt)}${old ? ' · daily update may be failing' : ''}</span><span class="chev">›</span></button>`;
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
  const modes = [...RANKED_MODES.filter(id => modeById.has(id)), 'other'];
  const chips = modes.map(id => {
    const m = modeById.get(id);
    const color = m?.color || '#ffc93c';
    const label = id === 'other' ? 'Other modes' : m.name;
    return `<button class="chip ${S.mode === id ? 'on' : ''}" style="--chip-color:${esc(color)}" data-mode="${id}">${id === 'other' ? '' : modeIcon(id)}${esc(label)}</button>`;
  }).join('');

  return `
    <header class="top">
      <h1>Brawl Draft</h1>
      <button class="icon-btn" data-sheet="mine" aria-label="My brawlers">${ICON.user}</button>
      <button class="icon-btn" data-sheet="about" aria-label="About and data">${ICON.info}</button>
    </header>
    ${statusBar()}
    <div class="search">${ICON.search}<input id="mapq" type="search" placeholder="Search maps" value="${esc(S.mapQuery)}" autocomplete="off" enterkeyhint="search">${clearBtn('map', S.mapQuery)}</div>
    <div class="chips">${chips}</div>
    <div id="r-map">${mapsBody()}</div>`;
}

// The part of the maps screen that changes while typing (the search box itself is never re-created,
// so the iPhone keyboard stays open).
function mapsBody() {
  const ranked = new Set(S.stats?.rankedMaps || []);
  const live = liveMapIds();
  const badge = m => ranked.has(m.id) ? { cls: '', text: 'Ranked' } : live.has(m.id) ? { cls: 'live', text: 'Live' } : null;
  const order = m => (ranked.has(m.id) ? 0 : live.has(m.id) ? 1 : 2);
  const sortMaps = list => list.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  const otherModes = S.meta.modes.filter(m => !RANKED_MODES.includes(m.id)).map(m => m.id);

  const q = S.mapQuery.trim().toLowerCase();
  let body;
  if (q) {
    const found = sortMaps([...mapById.values()].filter(m => m.name.toLowerCase().includes(q) && ((m.active && !m.hidden) || ranked.has(m.id))));
    body = `<div class="section-title"><h2>Search</h2><span>${found.length} map${found.length === 1 ? '' : 's'}</span></div>` +
      (found.length ? `<div class="maps">${found.slice(0, 60).map(m => mapCard(m, badge(m))).join('')}</div>` : `<div class="empty">No map called “${esc(S.mapQuery)}”.</div>`);
  } else {
    const inMode = id => (S.mode === 'other' ? otherModes.includes(id) : id === S.mode);
    const list = sortMaps([...mapById.values()].filter(m => inMode(m.mode) && ((m.active && !m.hidden) || ranked.has(m.id))));
    const recent = S.recent.map(id => mapById.get(id)).filter(Boolean);
    body = '';
    if (recent.length) {
      body += `<div class="section-title"><h2>Recent</h2></div><div class="maps">${recent.slice(0, 3).map(m => mapCard(m, badge(m))).join('')}</div>`;
    }
    const title = S.mode === 'other' ? 'Other modes' : modeName(S.mode);
    const nRanked = list.filter(m => ranked.has(m.id)).length;
    body += `<div class="section-title"><h2>${esc(title)}</h2><span>${nRanked ? `${nRanked} in ranked now · ` : ''}${list.length} maps</span></div>`;
    body += list.length ? `<div class="maps">${list.map(m => mapCard(m, badge(m))).join('')}</div>` : `<div class="empty">No maps for this mode right now.</div>`;
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
      return `<button class="slot filled" data-remove="${team}" data-id="${id}" aria-label="Remove ${esc(name(id))}">
        ${img(id)}<span class="x">×</span><span class="slot-name">${esc(name(id))}</span></button>`;
    }
    const isNext = step?.kind === 'pick' && step.team === team && i === picks.length;
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
  return `<div class="bans"><div class="team-label">Bans</div><div class="ban-slots">${cells.join('')}</div></div>`;
}

function turnBanner(step) {
  const d = S.draft;
  if (step.kind === 'ban') {
    return `<div class="turn"><div class="what"><b>Bans · ${d.bans.length}/6</b><span>Tap each banned brawler, or skip.</span></div>
      <button class="text-btn" data-action="skip-bans">${d.bans.length ? 'Done' : 'Skip'}</button></div>`;
  }
  if (step.kind === 'done') {
    return `<div class="turn done"><div class="what"><b>Draft complete</b><span>${esc(edgeWords(S.engine.draftEdge(d)))} Good luck!</span></div>
      <button class="text-btn" data-action="again">New draft</button></div>`;
  }
  const mine = step.team === 'blue';
  const left = step.picksNow === 2 ? '2 picks' : '1 pick';
  const title = mine ? `Your turn · ${left}` : `Enemy's turn · ${left}`;
  const sub = mine
    ? (step.opponentPicksAfter === 0 ? 'Last pick — counter freely, nobody can answer.' : `They get ${step.opponentPicksAfter} more pick${step.opponentPicksAfter > 1 ? 's' : ''} after this, so avoid easy counters.`)
    : 'Tap what they lock in.';
  return `<div class="turn ${step.team}"><div class="what"><b>${title}</b><span>${sub}</span></div></div>`;
}

function reasonChip(r, rec, team) {
  const cls = r.v >= 0 ? 'pos' : 'neg';
  let text;
  // Without enough real games the map number is only a class-vs-mode estimate: say so.
  const estimated = (rec?.games?.all ?? 0) < 30;
  const mode = modeName(S.draft.mode);
  if (r.type === 'map' && estimated) text = r.v >= 0 ? `Good fit for ${mode}` : `Poor fit for ${mode}`;
  else if (r.type === 'map') text = r.v >= 0 ? 'Strong on this map' : 'Weak on this map';
  else if (r.type === 'need') text = r.label;
  else if (r.type === 'counter') text = r.v >= 0 ? `Beats ${name(r.target)}` : `Struggles vs ${name(r.target)}`;
  else if (r.type === 'synergy') text = r.v >= 0 ? `Good with ${name(r.target)}` : `Awkward with ${name(r.target)}`;
  // For enemy predictions the "risk" is our chance to answer their pick.
  else if (r.type === 'risk') text = team === 'red' ? `You can answer with ${name(r.target)}` : `${name(r.target)} can counter`;
  return `<span class="reason ${cls}">${esc(text)} ${pct(r.v)}</span>`;
}

function recCard(r, i, sub, team) {
  const b = byId.get(r.id);
  return `<button class="rec ${i === 0 ? 'best' : ''}" data-pick="${r.id}">
    <span class="pic"><span class="rank">${i + 1}</span>${img(r.id)}</span>
    <span class="info"><span class="name">${esc(b.name)} <small>${esc(b.cls)} · ${esc(rangeLabel(b.cls))}</small></span>
      <span class="reasons">${r.reasons.map(x => reasonChip(x, r, team)).join('') || '<span class="reason">Solid all-round</span>'}</span></span>
    <span class="score"><b class="${r.score >= 0 ? 'pos' : 'neg'}">${pct(r.score)}</b><span>${sub}</span></span>
  </button>`;
}

function recommendations(step) {
  const d = S.draft;
  if (step.kind === 'done') return '';
  let list, title, hint;
  if (step.kind === 'ban') {
    list = S.engine.banSuggestions(d);
    title = 'Worth banning';
    hint = 'strongest here';
  } else if (step.team === 'blue') {
    list = S.engine.recommend(d, 'blue');
    if (S.mine) list = list.filter(r => S.mine.has(r.id));
    title = 'Best picks for you';
    hint = S.mine ? `from your ${S.mine.size} brawlers` : 'tap to lock in';
  } else {
    list = S.engine.recommend(d, 'red');
    title = 'They might pick';
    hint = 'tap their pick';
  }
  const n = S.showAll ? 12 : 5;
  const sub = step.kind === 'ban' ? 'map edge' : step.team === 'red' ? 'their edge' : 'your edge';
  const cards = list.slice(0, n).map((r, i) => recCard(r, i, sub, step.team)).join('');
  const note = S.engine.hasData ? '' : `<button class="status est" data-sheet="about" style="margin:0 0 10px"><span class="dot"></span>
    <span>Rough estimates by brawler type. Real ranked results switch on once live stats are connected.</span><span class="chev">›</span></button>`;
  return `<div class="section-title"><h2>${title}</h2><span>${hint}</span></div>${note}
    <div class="recs">${cards || `<div class="empty">${S.mine && step.team === 'blue' ? 'None of your brawlers are left. <button class="text-btn" data-sheet="mine">Edit my brawlers</button>' : 'No brawlers left to suggest.'}</div>`}</div>
    ${list.length > 5 ? `<button class="more" data-action="more">${S.showAll ? 'Show fewer' : 'Show more'}</button>` : ''}`;
}

function tilesHtml(step, list) {
  const d = S.draft;
  const taken = new Set([...d.bans, ...d.blue, ...d.red]);
  const scores = new Map();
  if (step.kind === 'pick') for (const r of S.engine.recommend(d, step.team)) scores.set(r.id, r.score);
  return list.map(b => {
    const off = taken.has(b.id);
    const s = scores.get(b.id);
    const tag = s != null && !off ? `<span class="tag ${s >= 0 ? 'pos' : 'neg'}">${s >= 0 ? '+' : '−'}${Math.abs(s * 100).toFixed(0)}</span>` : '';
    return `<button class="tile ${off ? 'off' : ''}" data-pick="${b.id}" ${off ? 'disabled' : ''}>${img(b.id)}<span>${esc(b.name)}</span>${tag}</button>`;
  }).join('');
}

const verbFor = step => step.kind === 'ban' ? 'ban' : step.team === 'blue' ? 'pick' : 'mark their pick';

// Name search sits right under the turn banner: type 2 letters + Enter during the draft timer.
function quickSearch(step) {
  const placeholder = step.kind === 'ban' ? 'Find a brawler to ban' : step.team === 'blue' ? 'Find your pick' : 'Find their pick';
  return `<div class="search quick">${ICON.search}<input id="gridq" type="search" placeholder="${placeholder} — type 2 letters" value="${esc(S.gridQuery)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done">${clearBtn('grid', S.gridQuery)}</div>`;
}

function searchResults(step) {
  const q = S.gridQuery.trim().toLowerCase();
  const starts = S.meta.brawlers.filter(b => b.name.toLowerCase().startsWith(q));
  const contains = S.meta.brawlers.filter(b => !b.name.toLowerCase().startsWith(q) && b.name.toLowerCase().includes(q));
  const tiles = tilesHtml(step, [...starts, ...contains]);
  return `<div class="section-title"><h2>Matches</h2><span>tap to ${verbFor(step)} · Enter picks the first</span></div>
    <div class="grid">${tiles || '<div class="empty" style="grid-column:1/-1">No brawler matches.</div>'}</div>`;
}

function brawlerGrid(step) {
  const list = S.meta.brawlers.filter(b => S.gridClass === 'all' || b.cls === S.gridClass);
  const tiles = tilesHtml(step, list);
  const classChips = ['all', ...CLASSES].map(c => `<button class="chip small ${S.gridClass === c ? 'on' : ''}" data-class="${esc(c)}">${c === 'all' ? 'All' : esc(c)}</button>`).join('');
  return `<div class="section-title"><h2>All brawlers</h2><span>tap to ${verbFor(step)}</span></div>
    <div class="chips">${classChips}</div>
    <div class="grid">${tiles || '<div class="empty" style="grid-column:1/-1">No brawler matches.</div>'}</div>`;
}

function draftView() {
  const d = S.draft;
  const map = mapById.get(d.mapId);
  const step = currentStep();
  const started = d.blue.length + d.red.length > 0;
  const edge = d.blue.length && d.red.length ? S.engine.draftEdge(d) : null;

  return `
    <header class="top">
      <button class="icon-btn" data-action="home" aria-label="Back to maps">${ICON.back}</button>
      <div class="title"><b>${esc(map.name)}</b><small>${modeIcon(map.mode)}${esc(modeName(map.mode))}</small></div>
      <button class="icon-btn" data-action="undo" aria-label="Undo" ${S.history.length ? '' : 'disabled style="opacity:.4"'}>${ICON.undo}</button>
      <button class="text-btn" data-action="reset">Reset</button>
    </header>
    <div class="first-pick"><span>First pick</span>
      <div class="seg" role="group" aria-label="Who picks first">
        <button class="${d.firstTeam === 'blue' ? 'on' : ''}" data-first="blue" ${started ? 'disabled' : ''}>Us</button>
        <button class="${d.firstTeam === 'red' ? 'on' : ''}" data-first="red" ${started ? 'disabled' : ''}>Them</button>
      </div>
    </div>
    <div class="board">
      <div class="team blue"><div class="team-label">You</div><div class="slots">${slotsFor('blue')}</div></div>
      <div class="team red"><div class="team-label">Enemy</div><div class="slots">${slotsFor('red')}</div></div>
      ${bansRow()}
    </div>
    ${turnBanner(step)}
    ${edge != null ? edgeMeter(edge) : ''}
    ${step.kind === 'done' ? teamChecks() : `${planCard(step)}${quickSearch(step)}<div id="r-draft">${draftBody(step)}</div>`}`;
}

// Drafts move win chance by a few percent; skill decides the rest. Say it in words.
function edgeWords(edge) {
  const p = Math.round(edge * 100);
  const est = S.engine.hasData ? '' : ' (estimate)';
  if (p >= 58) return `Your draft is clearly better: about ${p}% to win${est}.`;
  if (p >= 53) return `Your draft has the edge: about ${p}% to win${est}.`;
  if (p > 47) return `Even draft: about ${p}% — it's down to how you play${est}.`;
  if (p > 42) return `Their draft has the edge: about ${p}% for you${est}.`;
  return `Their draft is clearly better: about ${p}% for you${est}.`;
}

function edgeMeter(edge) {
  const p = Math.round(edge * 100);
  const label = p >= 58 ? 'Clearly ahead' : p >= 53 ? 'Ahead' : p > 47 ? 'Even' : p > 42 ? 'Behind' : 'Clearly behind';
  return `<button class="edge" data-sheet="about" aria-label="What the draft edge means">
    <div class="edge-row"><span>Draft edge${S.engine.hasData ? '' : ' · estimate'} <span class="q">?</span></span><b>${label} · You ${p}% – ${100 - p}% Them</b></div>
    <div class="edge-bar"><i style="width:${edge * 100}%"></i></div></button>`;
}

// What the team on the clock still needs, in plain words.
function planCard(step) {
  if (step.kind !== 'pick') return '';
  const mine = step.team === 'blue';
  const { needs } = S.engine.plan(S.draft, step.team);
  const top = needs.slice(0, 3);
  const body = top.length
    ? top.map(n => `<li><b>${esc(n.title)}</b><span>${esc(n.why)}</span></li>`).join('')
    : `<li><b>${mine ? 'Your team is well rounded' : 'Their team is well rounded'}</b><span>${mine ? 'Pick for counters and map strength.' : 'Expect them to pick for counters.'}</span></li>`;
  return `<div class="plan ${step.team}"><h3>${mine ? 'Game plan' : 'What they need'}</h3><ul>${body}</ul></div>`;
}

// Final checklist for both teams.
function teamChecks() {
  const row = (team, label) => {
    const items = S.engine.plan(S.draft, team).report;
    return `<div class="check ${team}"><b>${label}</b><div>${items.map(i => `<span class="${i.ok ? 'ok' : 'miss'}">${i.ok ? '✓' : '✗'} ${esc(i.text)}</span>`).join('')}</div></div>`;
  };
  return `<div class="plan"><h3>Team check</h3>${row('blue', 'You')}${row('red', 'Enemy')}</div>`;
}

function draftBody(step) {
  return S.gridQuery.trim() ? searchResults(step) : recommendations(step) + brawlerGrid(step);
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
          <dt>All 3v3 games</dt><dd>${st.battles.all.toLocaleString()}</dd>
          <dt>Days covered</dt><dd>${st.days}</dd>
          <dt>Ranked maps found</dt><dd>${st.rankedMaps.length}</dd>
          <dt>Updated</dt><dd>${ago(st.generatedAt)}</dd>
        </dl>`
      : `<p><b>Live match stats aren't connected yet.</b> Until they are, picks are estimated from each brawler's class and the game mode (for example: marksmen in Knockout, tanks in Brawl Ball). Once the daily update is set up, everything switches to real ranked results automatically.</p>`;
    inner = `<h2>How it works</h2>
      <p>Pick the map, tap the bans and picks as they happen, and the list shows the best next brawler for that exact moment.</p>
      <h3>Data</h3>${data}
      <h3>What the numbers mean</h3>
      <ul>
        <li><b>Edge</b> is roughly how much the pick changes your win chance, e.g. <b>+3.0%</b>.</li>
        <li><b>Strong on this map</b>: win rate on this map in ranked games.</li>
        <li><b>Beats / Struggles vs</b>: head-to-head results against the enemy's picks.</li>
        <li><b>Good with</b>: how well it does next to your teammates.</li>
        <li><b>Can counter</b>: if the enemy still picks after you, the app warns you about an easy answer to your pick.</li>
        <li><b>Adds frontline / Adds range / Answers Bull…</b>: the team check. The app looks at what your team is missing and what the enemy's picks threaten (tanks, throwers, assassins, snipers, healers), and favours picks that cover it.</li>
      </ul>
      <h3>Why is the draft edge close to 50%?</h3>
      <p>Because that's how Brawl Stars works: even a great draft only moves your win chance by a few percent, usually <b>45–60%</b>. Aim and teamwork decide the rest. "Ahead" at 54% means you'd win about 5 more games out of 100 than with an even draft.</p>
      <p>${S.engine.hasData ? 'The numbers come from real ranked results.' : '<b>Right now the numbers are estimates</b> from brawler types only, so they stay close to 50%. They get sharper once real match stats arrive.'}</p>
      <p>Stats come from the official Brawl Stars API (recent battles of top players) and refresh every day. Brawler and map info is from Brawlify.</p>
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
  if (ds.mode) { S.mode = ds.mode; S.mapQuery = ''; save(); render(); return; }
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
    case 'undo': undo(); break;
    case 'reset': {
      snapshot();
      const d = S.draft;
      S.draft = { ...d, bans: [], blue: [], red: [], bansDone: false };
      save(); render();
      toast('Draft cleared', { label: 'Undo', run: undo });
      break;
    }
    case 'again': newDraft(S.draft.mapId); break;
    case 'skip-bans': snapshot(); S.draft.bansDone = true; save(); render(); break;
    case 'more': S.showAll = !S.showAll; render(); break;
  }
});

$app.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'mapq') { S.mapQuery = t.value; refresh('r-map', mapsBody); }
  if (t.id === 'gridq') { S.gridQuery = t.value; refresh('r-draft', () => draftBody(currentStep())); }
  if (t.id === 'mineq') { S.mineQuery = t.value; refresh('r-mine', mineTiles); }
  t.parentElement.querySelector('.clear')?.toggleAttribute('hidden', !t.value);
});

// Enter in the brawler search picks the only (or first) match: fast during the draft timer.
$app.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.target.id !== 'gridq') return;
  const first = document.querySelector('.grid .tile:not(.off)');
  if (first) { e.preventDefault(); e.target.blur(); choose(Number(first.dataset.pick)); }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.sheet) { S.sheet = null; render(); }
});

init();
