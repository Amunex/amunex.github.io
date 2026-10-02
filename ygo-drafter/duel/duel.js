/* YGO Drafter duel test: EDOPro's rules engine (ocgcore, WebAssembly) under our own table, GOAT rules, hot-seat, with undo. */
import createCore, { OcgDuelMode, OcgProcessResult, cardMatchesOpcode } from './engine/index.js';
import { LOC, T, makeCardMap, createDuel, toGoat, isExtra, freeZones, SELECT_TYPES } from './glue.js';

const V = 2;
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const QFLAGS = 1 | 2 | 4 | 16 | 32 | 256 | 512 | 65536 | 131072;   // code, position, alias, level, rank, atk, def, overlays, counters (TYPE is not parsed by the wrapper)
const PHASE = { 1: 'Draw', 2: 'Standby', 4: 'Main 1', 8: 'Battle', 16: 'Battle', 32: 'Battle', 64: 'Battle', 128: 'Battle', 256: 'Main 2', 512: 'End' };
const PHASE_ORDER = ['Draw', 'Standby', 'Main 1', 'Battle', 'Main 2', 'End'];
const LOCNAME = { 1: 'Deck', 2: 'Hand', 4: 'Monster Zone', 8: 'Spell & Trap Zone', 16: 'GY', 32: 'Banished', 64: 'Extra Deck', 128: 'Material' };
const POSNAME = { 1: 'Face-up Attack', 2: 'Face-down Attack', 4: 'Face-up Defense', 8: 'Face-down Defense' };
const RACES = ['Warrior', 'Spellcaster', 'Fairy', 'Fiend', 'Zombie', 'Machine', 'Aqua', 'Pyro', 'Rock', 'Winged Beast', 'Plant', 'Insect', 'Thunder', 'Dragon', 'Beast', 'Beast-Warrior', 'Dinosaur', 'Fish', 'Sea Serpent', 'Reptile', 'Psychic', 'Divine-Beast', 'Creator God', 'Wyrm'];
const ATTRS = ['EARTH', 'WATER', 'FIRE', 'WIND', 'LIGHT', 'DARK', 'DIVINE'];

const S = {
  lib: null, db: null, cards: null, strings: null, index: null, cache: new Map(), samples: [],
  decks: null, names: ['Player 1', 'Player 2'], seed: 0, h: null,
  responses: [], log: [], prompt: null, lastPrompt: null, title: '', field: null, chain: [], winner: null,
  turn: 0, phase: 0, turnPlayer: 0, lp: [8000, 8000], sel: [], menu: null, focus: null, retry: false, handOrder: [[], []]
};

/* ---------- loading ---------- */
async function boot() {
  try {
    const [lib, db, strings, index, samples] = await Promise.all([
      createCore({ sync: true }),
      fetch(`goat-db.json?v=${V}`).then(r => r.json()),
      fetch(`strings.json?v=${V}`).then(r => r.json()),
      fetch(`scripts/index.json?v=${V}`).then(r => r.json()),
      fetch(`sample-decks.json?v=${V}`).then(r => r.json())
    ]);
    Object.assign(S, { lib, db, strings, index: new Set(index), samples, cards: makeCardMap(db) });
    renderSetup();
  } catch (e) {
    console.error(e);
    $('#app').innerHTML = '<p class="loading">The duel engine didn’t load. Refresh the page to try again.</p>';
  }
}
function readScript(name) {
  if (S.cache.has(name)) return S.cache.get(name);
  let text = '';
  if (S.index.has(name)) {
    const x = new XMLHttpRequest(); x.open('GET', `scripts/${name}?v=${V}`, false);
    try { x.send(null); if (x.status === 200) text = x.responseText; } catch (_) {}
  }
  S.cache.set(name, text); return text;
}
async function preload(decks) {
  const want = new Set([...S.index].filter(n => !/^c\d+\.lua$/.test(n)));
  for (const d of decks) for (const code of d.main.concat(d.extra)) {
    want.add(`c${code}.lua`); const c = S.cards.get(code); if (c && c.alias) want.add(`c${c.alias}.lua`);
  }
  await Promise.all([...want].filter(n => S.index.has(n) && !S.cache.has(n)).map(n =>
    fetch(`scripts/${n}?v=${V}`).then(r => r.ok ? r.text() : '').then(t => S.cache.set(n, t)).catch(() => {})));
}

/* ---------- card helpers ---------- */
const card = code => S.cards.get(code) || null;
const cname = code => (card(code) || {}).name || 'a card';
function imgFor(code) { const c = card(code); const base = c && c.alias && (code >= 100000000 || Math.abs(code - c.alias) < 20) ? c.alias : code; return `../img/${base}.webp`; }
function descText(desc) {
  if (desc === undefined || desc === null) return '';
  const d = BigInt(desc);
  if (d > 0xfffffn) { const code = Number(d >> 20n), i = Number(d & 0xfffffn); const c = card(code); return (c && c.str && c.str[i]) || (c ? `Use ${c.name}` : ''); }
  return (S.strings.system || {})[String(Number(d))] || '';
}
const P = p => S.names[p] || `Player ${p + 1}`;
function at(loc) { // look up a card on the current board by location
  const f = S.field && S.field[loc.controller]; if (!f) return null;
  const list = loc.location === LOC.HAND ? f.hand : loc.location === LOC.MZONE ? f.m : loc.location === LOC.SZONE ? f.s : loc.location === LOC.GRAVE ? f.grave : loc.location === LOC.REMOVED ? f.removed : loc.location === LOC.EXTRA ? f.extra : null;
  return list ? list[loc.sequence] : null;
}

/* ---------- duel lifecycle ---------- */
function newDuel(seed) {
  if (S.h) { try { S.lib.destroyDuel(S.h); } catch (_) {} }
  if (!S.keepHand) S.handOrder = [[], []]; S.keepHand = false;
  Object.assign(S, { seed, responses: [], log: [], prompt: null, lastPrompt: null, title: '', field: null, chain: [], winner: null, turn: 0, phase: 0, turnPlayer: 0, lp: [8000, 8000], sel: [], menu: null, retry: false });
  S.h = createDuel(S.lib, { seed, decks: S.decks, cards: S.cards, scriptReader: readScript, flags: OcgDuelMode.MODE_GOAT, onError: (t, x) => console.warn('engine:', x) });
}
function pump(feed) {
  let k = 0;
  for (let guard = 0; guard < 200000; guard++) {
    const status = S.lib.duelProcess(S.h);
    const msgs = S.lib.duelGetMessage(S.h);
    for (const m of msgs) onMsg(m);
    if (S.retry) { S.retry = false; S.responses.pop(); S.prompt = S.lastPrompt; if (!feed) toast('That choice isn’t allowed. Try another.'); }
    if (S.winner || status === OcgProcessResult.END) { S.prompt = null; break; }
    if (status === OcgProcessResult.WAITING) {
      if (feed && k < feed.length) { const r = feed[k++]; S.responses.push(r); S.lib.duelSetResponse(S.h, r.r); continue; }
      if (S.prompt) { const auto = autoAnswer(S.prompt); if (auto) { S.responses.push({ r: auto, auto: true }); S.lib.duelSetResponse(S.h, auto); S.prompt = null; continue; } }
      break;
    }
  }
  refreshField();
  render();
}
function answer(r) {
  S.responses.push({ r, auto: false });
  S.lib.duelSetResponse(S.h, r);
  S.prompt = null; S.sel = []; S.menu = null; S.title = '';
  closePicker();
  pump(null);
}
function undo() {
  if (!S.responses.some(x => !x.auto)) { toast('Nothing to undo yet.'); return; }
  const keep = S.responses.slice();
  while (keep.length && keep[keep.length - 1].auto) keep.pop();
  keep.pop();
  while (keep.length && keep[keep.length - 1].auto) keep.pop();
  S.keepHand = true; newDuel(S.seed); closePicker();
  pump(keep);
  toast('Undone.');
}
function autoAnswer(m) {
  if (m.type === 18 || m.type === 24) { const z = freeZones(m.player, m.field_mask).filter(p => p.player === m.player || m.type === 24); const pick = (z.length ? z : freeZones(m.player, m.field_mask)).slice(0, m.count); return { type: m.type === 18 ? 10 : 9, places: pick }; }
  if (m.type === 21 || m.type === 25) return { type: 15, order: null };
  if (m.type === 22) { const out = m.cards.map(() => 0); let left = m.count; m.cards.forEach((c, i) => { const t = Math.min(c.count, left); out[i] = t; left -= t; }); return { type: 13, counters: out }; }
  if (m.type === 132) return { type: 20, value: 1 + ((Math.random() * 3) | 0) };
  return null;
}
function onMsg(m) {
  const t = m.type;
  if (SELECT_TYPES.has(t)) { S.prompt = m; S.lastPrompt = m; return; }
  switch (t) {
    case 1: S.retry = true; break;
    case 2: if (m.hint_type === 3) S.title = descText(m.hint); else if (m.hint_type === 2) log(descText(m.hint)); break;
    case 5: S.winner = m; log(m.player === 2 ? 'The duel is a draw.' : `${P(m.player)} wins the duel.`, 'win'); break;
    case 40: S.turn++; S.turnPlayer = m.player; log(`Turn ${S.turn}: ${P(m.player)}`, 'turn'); break;
    case 41: S.phase = m.phase; break;
    case 60: log(`${P(m.controller)} Normal Summons ${cname(m.code)}.`); break;
    case 62: log(`${P(m.controller)} Special Summons ${cname(m.code)}.`); break;
    case 64: log(`${P(m.controller)} Flip Summons ${cname(m.code)}.`); break;
    case 54: log(`${P(m.controller)} sets a card.`); break;
    case 70: log(`${P(m.controller)} activates ${cname(m.code)} (chain link ${m.chain_size}).`, 'chain'); break;
    case 75: log('An activation was negated.'); break;
    case 90: log(`${P(m.player)} draws ${m.drawn.length === 1 ? 'a card' : m.drawn.length + ' cards'}.`); break;
    case 91: log(`${P(m.player)} takes ${m.amount} damage.`, 'dmg'); break;
    case 92: log(`${P(m.player)} gains ${m.amount} LP.`); break;
    case 100: log(`${P(m.player)} pays ${m.amount} LP.`); break;
    case 110: { const a = at(m.card), d = m.target && at(m.target); log(`${a ? cname(a.code) : 'A monster'} attacks ${d ? (d.position & 10 ? 'a face-down monster' : cname(d.code)) : 'directly'}.`); break; }
    case 31: if (m.cards.length) log(`Revealed: ${m.cards.map(c => cname(c.code)).join(', ')}.`); break;
    case 50: { if (m.to.location === LOC.GRAVE && m.from.location === LOC.MZONE) log(`${cname(m.card)} goes to the GY.`); if (m.to.location === LOC.REMOVED) log(`${cname(m.card)} is banished.`); break; }
  }
}
function log(text, kind = '') { if (text) S.log.push({ text, kind }); }
function refreshField() {
  try {
    const F = S.lib.duelQueryField(S.h);
    S.lp = F.players.map(p => p.lp); S.chain = F.chain || [];
    const q = (p, loc) => S.lib.duelQueryLocation(S.h, { flags: QFLAGS, controller: p, location: loc });
    S.field = [0, 1].map(p => ({ hand: q(p, LOC.HAND), m: q(p, LOC.MZONE), s: q(p, LOC.SZONE), grave: q(p, LOC.GRAVE), removed: q(p, LOC.REMOVED), extra: q(p, LOC.EXTRA), deck: F.players[p].deck_size }));
  } catch (e) { console.error(e); }
}

/* ---------- actions available right now, keyed by card location ---------- */
function actionMap() {
  const m = S.prompt, map = new Map(); if (!m) return map;
  const add = (c, label, r) => { const k = `${c.controller}:${c.location}:${c.sequence}`; if (!map.has(k)) map.set(k, []); map.get(k).push({ label, r }); };
  if (m.type === 11) {
    m.summons.forEach((c, i) => add(c, 'Normal Summon', { type: 1, action: 0, index: i }));
    m.special_summons.forEach((c, i) => add(c, 'Special Summon', { type: 1, action: 1, index: i }));
    m.pos_changes.forEach((c, i) => add(c, 'Change position', { type: 1, action: 2, index: i }));
    m.monster_sets.forEach((c, i) => add(c, 'Set', { type: 1, action: 3, index: i }));
    m.spell_sets.forEach((c, i) => add(c, 'Set', { type: 1, action: 4, index: i }));
    m.activates.forEach((c, i) => add(c, descText(c.description) || 'Activate', { type: 1, action: 5, index: i }));
  } else if (m.type === 10) {
    m.chains.forEach((c, i) => add(c, descText(c.description) || 'Activate', { type: 0, action: 0, index: i }));
    m.attacks.forEach((c, i) => add(c, c.can_direct ? 'Attack (can attack directly)' : 'Attack', { type: 0, action: 1, index: i }));
  } else if (m.type === 16) {
    m.selects.forEach((c, i) => add(c, descText(c.description) || 'Activate', { type: 8, index: i }));
  }
  return map;
}

/* ---------- rendering ---------- */
function setBar() {
  $('#barActions').innerHTML = S.h ? `<button class="ghost" type="button" data-act="undo" ${S.responses.some(x => !x.auto) ? '' : 'disabled'}>Undo</button><button class="ghost" type="button" data-act="rematch">Rematch</button><button class="ghost" type="button" data-act="setup">New duel</button>` : '';
}
function cardEl(c, p, loc, seq, acts) {
  if (!c) return `<div class="zone empty"></div>`;
  const down = (c.position & 10) !== 0, def = (c.position & 12) !== 0 && (loc === LOC.MZONE);
  const key = `${p}:${loc}:${seq}`; const has = acts && acts.has(key);
  const stats = loc === LOC.MZONE && !down ? `<span class="stat">${c.attack ?? '?'}<i>/</i>${c.defense ?? '?'}</span>` : '';
  const img = down && loc !== LOC.HAND ? '../img/back.webp' : imgFor(c.code);
  return `<button class="dcard ${down ? 'fd' : ''} ${def ? 'def' : ''} ${has ? 'act' : ''} ${S.focus === key ? 'focus' : ''}" type="button" data-key="${key}" data-code="${c.code}" aria-label="${esc(down && loc !== LOC.HAND ? 'Face-down card' : cname(c.code))}">
    <img src="${img}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'tname',textContent:${JSON.stringify(cname(c.code))}}))">${stats}</button>`;
}
function orderedHand(p) {
  const ord = S.handOrder[p] || []; const used = ord.map(() => false);
  return S.field[p].hand.map((c, i) => {
    let k = ord.findIndex((code, j) => !used[j] && code === c.code); if (k >= 0) used[k] = true; else k = 1e6 + i;
    return { c, i, k };
  }).sort((a, b) => a.k - b.k);
}
function pile(label, n, act) { return `<button class="pile" type="button" ${act ? `data-pile="${act}"` : 'disabled'}><b>${n}</b><span>${label}</span></button>`; }
function sideHTML(p, top) {
  const f = S.field[p], acts = actionMap();
  const mz = [0, 1, 2, 3, 4].map(i => cardEl(f.m[i], p, LOC.MZONE, i, acts)).join('');
  const sz = [0, 1, 2, 3, 4].map(i => cardEl(f.s[i], p, LOC.SZONE, i, acts)).join('');
  const fz = cardEl(f.s[5], p, LOC.SZONE, 5, acts);
  const hand = orderedHand(p).map(({ c, i }) => cardEl(c, p, LOC.HAND, i, acts)).join('');
  const info = `<div class="pinfo ${S.turnPlayer === p ? 'turn' : ''}"><span class="pname">${esc(P(p))}</span><span class="lp">${S.lp[p]} LP</span>
    <span class="piles">${pile('Deck', f.deck)}${pile('Extra', f.extra.length, `${p}:64`)}${pile('GY', f.grave.length, `${p}:16`)}${pile('Banished', f.removed.length, `${p}:32`)}</span></div>`;
  const rows = [`<div class="row hand">${hand || '<span class="emptyhand">No cards in hand</span>'}</div>`, `<div class="row st">${fz}${sz}</div>`, `<div class="row mon"><div class="zone spacer"></div>${mz}</div>`];
  return `<div class="side ${top ? 'top' : 'bottom'}">${top ? info + rows.join('') : rows.reverse().join('') + info}</div>`;
}
function promptHTML() {
  if (S.winner) return `<div class="prompt done"><h2>${S.winner.player === 2 ? 'It’s a draw' : `${esc(P(S.winner.player))} wins`}</h2><div class="row-btns"><button class="cta" data-act="rematch">Rematch</button><button class="ghost" data-act="undo">Undo the last move</button></div></div>`;
  const m = S.prompt; if (!m) return `<div class="prompt"><p class="hint">Working…</p></div>`;
  const who = `<p class="who">${esc(P(m.player))} decides</p>`;
  const title = S.title ? `<h2>${esc(S.title)}</h2>` : '';
  const btn = (label, r, cls = 'ghost') => `<button class="${cls}" type="button" data-r='${JSON.stringify(r, (k, v) => typeof v === 'bigint' ? v.toString() + 'n' : v)}'>${esc(label)}</button>`;
  if (m.type === 11) return `<div class="prompt">${who}<h2>${PHASE[S.phase] || 'Main Phase'}: your move</h2><p class="hint">Glowing cards can do something. Tap one to see its options.</p>
    <div class="row-btns">${m.to_bp ? btn('Go to Battle Phase', { type: 1, action: 6, index: 0 }, 'cta') : ''}${m.to_ep ? btn('End turn', { type: 1, action: 7, index: 0 }) : ''}</div>${menuHTML()}</div>`;
  if (m.type === 10) return `<div class="prompt">${who}<h2>Battle Phase</h2><p class="hint">Tap a glowing monster to attack, or a card to activate it.</p>
    <div class="row-btns">${m.to_m2 ? btn('Go to Main Phase 2', { type: 0, action: 2, index: 0 }, 'cta') : ''}${m.to_ep ? btn('End turn', { type: 0, action: 3, index: 0 }) : ''}</div>${menuHTML()}</div>`;
  if (m.type === 16) return `<div class="prompt">${who}<h2>${m.selects.length ? 'Respond with a card?' : 'Chain'}</h2><p class="hint">${m.selects.length ? 'Tap a glowing card to chain it.' : ''}</p>
    <div class="row-btns">${m.forced ? '' : btn('No response', { type: 8, index: null }, 'cta')}</div>${menuHTML()}${m.selects.length && !S.menu ? `<div class="list">${m.selects.map((c, i) => btn(`${cname(c.code)}: ${descText(c.description) || 'Activate'}`, { type: 8, index: i })).join('')}</div>` : ''}</div>`;
  if (m.type === 12) return `<div class="prompt">${who}<h2>Use ${esc(cname(m.code))}?</h2><p class="hint">${esc(descText(m.description))}</p><div class="row-btns">${btn('Yes', { type: 2, yes: true }, 'cta')}${btn('No', { type: 2, yes: false })}</div></div>`;
  if (m.type === 13) return `<div class="prompt">${who}<h2>${esc(descText(m.description) || 'Yes or no?')}</h2><div class="row-btns">${btn('Yes', { type: 3, yes: true }, 'cta')}${btn('No', { type: 3, yes: false })}</div></div>`;
  if (m.type === 14) return `<div class="prompt">${who}${title || '<h2>Choose an option</h2>'}<div class="list">${m.options.map((o, i) => btn(descText(o) || `Option ${i + 1}`, { type: 4, index: i })).join('')}</div></div>`;
  if (m.type === 19) return `<div class="prompt">${who}<h2>Choose a position for ${esc(cname(m.code))}</h2><div class="list">${[1, 2, 4, 8].filter(p => m.positions & p).map(p => btn(POSNAME[p], { type: 11, position: p })).join('')}</div></div>`;
  if (m.type === 140) return `<div class="prompt">${who}<h2>${esc(S.title || 'Declare a Type')}</h2><div class="list">${RACES.map((r, i) => (m.available & (1n << BigInt(i))) ? btn(r, { type: 16, races: [(1n << BigInt(i))] }) : '').join('')}</div></div>`;
  if (m.type === 141) return `<div class="prompt">${who}<h2>${esc(S.title || 'Declare an Attribute')}</h2><div class="list">${ATTRS.map((a, i) => (m.available & (1 << i)) ? btn(a, { type: 17, attributes: [1 << i] }) : '').join('')}</div></div>`;
  if (m.type === 143) return `<div class="prompt">${who}<h2>${esc(S.title || 'Declare a number')}</h2><div class="list">${m.options.map((o, i) => btn(String(Number(o)), { type: 19, value: i })).join('')}</div></div>`;
  if (m.type === 142) return `<div class="prompt">${who}<h2>${esc(S.title || 'Declare a card name')}</h2><input class="text" id="announceIn" placeholder="Type a card name" autocomplete="off"><div class="list" id="announceList"></div></div>`;
  if ([15, 20, 23, 26].includes(m.type)) return `<div class="prompt">${who}${title || '<h2>Choose cards</h2>'}<p class="hint">Make your choice in the window.</p><div class="row-btns"><button class="ghost" data-act="reopen">Show the choices</button></div></div>`;
  return `<div class="prompt">${who}<h2>Waiting</h2></div>`;
}
function menuHTML() {
  if (!S.menu) return '';
  const acts = actionMap().get(S.menu) || []; if (!acts.length) return '';
  const c = keyCard(S.menu);
  return `<div class="menu"><p class="menu-title">${esc(c ? cname(c.code) : 'Card')}</p>${acts.map(a => `<button class="cta" type="button" data-r='${JSON.stringify(a.r)}'>${esc(a.label)}</button>`).join('')}<button class="linkish" type="button" data-act="closemenu">Cancel</button></div>`;
}
function keyCard(key) { const [p, l, s] = key.split(':').map(Number); return at({ controller: p, location: l, sequence: s }); }
function detailHTML() {
  const code = S.focusCode; if (!code) return '<p class="hint">Tap or hover a card to read it.</p>';
  const c = card(code); if (!c) return '';
  const stats = c.type & 1 ? `<p class="d-stats">${c.type & 0x800000 ? 'Rank' : 'Level'} ${c.level} &nbsp; ATK ${c.attack < 0 ? '?' : c.attack} / DEF ${c.defense < 0 ? '?' : c.defense}</p>` : '';
  return `<img class="d-img" src="${imgFor(code)}" alt="" onerror="this.remove()"><h3>${esc(c.name)}</h3>${stats}<p class="d-text">${esc(c.desc)}</p>`;
}
function render() {
  setBar();
  if (!S.field) return;
  const chain = S.chain.length ? `<div class="chainbar">Chain: ${S.chain.map((l, i) => `<span>${i + 1}. ${esc(cname(l.code))}</span>`).join('')}</div>` : '';
  const phases = PHASE_ORDER.map(n => `<span class="${(PHASE[S.phase] || '') === n ? 'on' : ''}">${n}</span>`).join('');
  $('#status').innerHTML = `<span>Turn ${S.turn}, ${esc(P(S.turnPlayer))}</span>`;
  $('#app').innerHTML = `<section class="duel">
    <div class="board">${sideHTML(1, true)}<div class="midline"><div class="phases">${phases}</div>${chain}</div>${sideHTML(0, false)}</div>
    <aside class="panel">${promptHTML()}<div class="cdetail">${detailHTML()}</div><div class="log" id="log">${S.log.slice(-80).map(l => `<p class="${l.kind}">${esc(l.text)}</p>`).join('')}</div></aside>
  </section>`;
  const lg = $('#log'); if (lg) lg.scrollTop = lg.scrollHeight;
  const m = S.prompt;
  if (m && [15, 20, 23, 26].includes(m.type) && !S.pickerClosed) openPicker();
  if (m && m.type === 142) bindAnnounce(m);
}

/* ---------- card picker (select card, tribute, sum, select/unselect) ---------- */
function pickItems(m) {
  if (m.type === 23) return m.selects_must.map(c => ({ ...c, must: true })).concat(m.selects);
  if (m.type === 26) return m.select_cards.map(c => ({ ...c })).concat(m.unselect_cards.map(c => ({ ...c, chosen: true })));
  return m.selects;
}
function openPicker() {
  const m = S.prompt; const items = pickItems(m);
  const owner = c => c.controller === m.player ? 'Your' : 'Opponent’s';
  $('#pickTitle').textContent = S.title || (m.type === 20 ? 'Choose monsters to Tribute' : 'Choose cards');
  const range = m.type === 26 ? 'Tap a card to add or remove it.' : m.type === 23 ? `Their values must add up to ${m.amount & 0xffff}.` : `Choose ${m.min === m.max ? m.min : `${m.min} to ${m.max}`}.`;
  $('#pickCount').textContent = `${P(m.player)}: ${range}`;
  $('#pickBody').innerHTML = `<div class="pgrid">${items.map((c, i) => {
    const on = S.sel.includes(i) || c.must || c.chosen; const down = c.position && (c.position & 10) && c.location !== LOC.HAND && c.controller !== m.player;
    return `<button class="pcard ${on ? 'on' : ''} ${c.must ? 'must' : ''}" type="button" data-pi="${i}" data-code="${down ? '' : c.code}"><img src="${down ? '../img/back.webp' : imgFor(c.code)}" alt="" onerror="this.remove()"><span>${esc(down ? 'Face-down card' : cname(c.code))}</span><small>${owner(c)} ${LOCNAME[c.location] || ''}</small></button>`;
  }).join('')}</div>`;
  const can = canConfirm(m, items);
  $('#pickActions').innerHTML = m.type === 26
    ? `${m.can_finish ? '<button class="cta" type="button" data-pick="finish">Done</button>' : ''}${m.can_cancel ? '<button class="ghost" type="button" data-pick="cancel">Cancel</button>' : ''}<button class="linkish" type="button" data-pick="hide">Look at the board</button>`
    : `<button class="cta" type="button" data-pick="ok" ${can ? '' : 'disabled'}>Confirm</button>${m.can_cancel ? '<button class="ghost" type="button" data-pick="cancel">Cancel</button>' : ''}<button class="linkish" type="button" data-pick="hide">Look at the board</button>`;
  $('#picker').hidden = false;
}
function canConfirm(m, items) {
  const n = S.sel.length;
  if (m.type === 15) return n >= m.min && n <= m.max;
  if (m.type === 20) { const sum = S.sel.reduce((a, i) => a + (items[i].release_param || 1), 0); return sum >= m.min && n <= m.max && n > 0; }
  if (m.type === 23) { const vals = S.sel.map(i => items[i].amount & 0xffff).concat(m.selects_must.map(c => c.amount & 0xffff)); const sum = vals.reduce((a, b) => a + b, 0); return sum === (m.amount & 0xffff) || (m.select_max === 0 && sum >= (m.amount & 0xffff)); }
  return false;
}
function closePicker() { $('#picker').hidden = true; S.pickerClosed = false; }
function pickClick(i) {
  const m = S.prompt; if (!m) return;
  if (m.type === 26) { const n = m.select_cards.length; answer({ type: 7, index: i }); return; }
  const items = pickItems(m); if (items[i] && items[i].must) return;
  const k = S.sel.indexOf(i); if (k >= 0) S.sel.splice(k, 1); else { if (m.type === 15 && m.max === 1) S.sel = [i]; else S.sel.push(i); }
  openPicker();
}
function pickConfirm(kind) {
  const m = S.prompt; if (!m) return;
  if (kind === 'hide') { $('#picker').hidden = true; S.pickerClosed = true; return; }
  if (kind === 'cancel') { answer(m.type === 26 ? { type: 7, index: null } : { type: m.type === 20 ? 12 : m.type === 23 ? 14 : 5 }); return; }
  if (kind === 'finish') { answer({ type: 7, index: null }); return; }
  if (m.type === 15) answer({ type: 5, indicies: S.sel.slice() });
  else if (m.type === 20) answer({ type: 12, indicies: S.sel.slice() });
  else if (m.type === 23) answer({ type: 14, indicies: m.selects_must.map((_, i) => i).concat(S.sel.map(i => i)) });
}
function bindAnnounce(m) {
  const input = $('#announceIn'); if (!input) return;
  const pool = [...S.cards.values()].filter(c => !(c.type & T.TOKEN) && cardMatchesOpcode(c, m.opcodes));
  const draw = () => { const q = input.value.trim().toLowerCase(); const list = pool.filter(c => !q || c.name.toLowerCase().includes(q)).slice(0, 40);
    $('#announceList').innerHTML = list.map(c => `<button class="ghost" type="button" data-r='${JSON.stringify({ type: 18, card: c.code })}'>${esc(c.name)}</button>`).join(''); };
  input.addEventListener('input', draw); draw(); input.focus();
}

/* ---------- setup screen ---------- */
function parseYdk(text) {
  const main = [], extra = []; let sec = 'main';
  for (const line of String(text).split(/\r?\n/)) {
    const l = line.trim(); if (l.startsWith('#main')) { sec = 'main'; continue; } if (l.startsWith('#extra')) { sec = 'extra'; continue; } if (l.startsWith('!side')) { sec = 'side'; continue; }
    if (/^\d+$/.test(l) && sec !== 'side') (sec === 'main' ? main : extra).push(+l);
  }
  const all = toGoat(S.db, main.concat(extra)); const known = all.filter(c => S.cards.has(c)); const unknown = all.length - known.length;
  return { main: known.filter(c => !isExtra(card(c))), extra: known.filter(c => isExtra(card(c))), unknown };
}
function deckFromChoice(v, text) {
  if (v === 'drafted') return parseYdk(localStorage.getItem('ygo-drafter:duel-ydk') || '');
  if (v === 'paste') return parseYdk(text || '');
  const d = S.samples[+v]; return d ? { main: d.main.slice(), extra: d.extra.slice(), unknown: 0, n: d.n } : { main: [], extra: [], unknown: 0 };
}
function renderSetup() {
  if (S.h) { try { S.lib.destroyDuel(S.h); } catch (_) {} S.h = null; }
  setBar();
  $('#status').innerHTML = '<span>Duel test, GOAT rules</span>';
  const hasDraft = !!localStorage.getItem('ygo-drafter:duel-ydk');
  const opts = (sel) => `${hasDraft ? `<option value="drafted" ${sel === 'drafted' ? 'selected' : ''}>Your drafted deck</option>` : ''}<option value="paste">Paste a .ydk</option>
    <optgroup label="Tournament decks">${S.samples.map((d, i) => d.n.includes(', ') ? `<option value="${i}" ${String(sel) === String(i) ? 'selected' : ''}>${esc(d.n)}</option>` : '').join('')}</optgroup>
    <optgroup label="Starter and structure decks">${S.samples.map((d, i) => !d.n.includes(', ') ? `<option value="${i}">${esc(d.n)}</option>` : '').join('')}</optgroup>`;
  const side = (p, def) => `<div class="block"><h3><label for="deck${p}">${p === 0 ? 'Player 1 (bottom)' : 'Player 2 (top)'}</label></h3>
    <select class="text" id="deck${p}">${opts(def)}</select><textarea class="text ydk" id="ydk${p}" placeholder="#main&#10;12345678&#10;…" hidden></textarea></div>`;
  $('#app').innerHTML = `<section class="home"><div class="hero-pack"><img class="setup-back" src="../img/back.webp" alt=""></div><div>
    <h2>Duel test</h2><p class="lede">EDOPro’s rules engine running inside the drafter, with GOAT rulings. You play both sides on this screen, and Undo takes back the last decision.</p>
    ${side(0, hasDraft ? 'drafted' : 0)}${side(1, 1)}
    <div class="row" style="margin-top:18px"><button class="cta" type="button" data-act="start">Start the duel</button></div>
    <p class="note">Only Duelist Kingdom and GOAT cards work here for now. Cards from other eras are left out of the deck.</p></div></section>`;
  for (const p of [0, 1]) $(`#deck${p}`).addEventListener('change', e => { $(`#ydk${p}`).hidden = e.target.value !== 'paste'; });
}
async function start() {
  const decks = [0, 1].map(p => deckFromChoice($(`#deck${p}`).value, $(`#ydk${p}`).value));
  if (decks.some(d => d.main.length < 20)) { toast('Each deck needs at least 20 Main Deck cards that work in GOAT.'); return; }
  const dropped = decks.reduce((a, d) => a + d.unknown, 0);
  $('#app').innerHTML = '<p class="loading">Shuffling up…</p>';
  S.decks = decks.map(d => ({ main: d.main, extra: d.extra }));
  await preload(S.decks);
  newDuel((Math.random() * 2 ** 31) | 0);
  pump(null);
  if (dropped) toast(`${dropped} card${dropped === 1 ? '' : 's'} from outside GOAT ${dropped === 1 ? 'was' : 'were'} left out.`);
}

/* ---------- events ---------- */
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3200); }
const reviver = (k, v) => typeof v === 'string' && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v;
document.addEventListener('click', e => {
  const t = e.target;
  const r = t.closest('[data-r]'); if (r) { answer(JSON.parse(r.dataset.r, reviver)); return; }
  const a = t.closest('[data-act]')?.dataset.act;
  if (a === 'start') { start(); return; }
  if (a === 'undo') { undo(); return; }
  if (a === 'rematch') { newDuel((Math.random() * 2 ** 31) | 0); pump(null); return; }
  if (a === 'setup') { renderSetup(); return; }
  if (a === 'closemenu') { S.menu = null; render(); return; }
  if (a === 'reopen') { S.pickerClosed = false; openPicker(); return; }
  const pi = t.closest('[data-pi]'); if (pi) { pickClick(+pi.dataset.pi); return; }
  const pk = t.closest('[data-pick]'); if (pk) { pickConfirm(pk.dataset.pick); return; }
  const pl = t.closest('[data-pile]'); if (pl) { const [p, l] = pl.dataset.pile.split(':').map(Number); const f = S.field[p]; const list = l === 16 ? f.grave : l === 32 ? f.removed : f.extra;
    S.focusCode = list.length ? list[list.length - 1].code : null; toast(list.length ? `${P(p)}’s ${LOCNAME[l]}: ${list.map(c => cname(c.code)).join(', ')}` : 'Empty.'); render(); return; }
  const dc = t.closest('.dcard'); if (dc) {
    S.focus = dc.dataset.key; S.focusCode = +dc.dataset.code;
    const acts = actionMap().get(dc.dataset.key); S.menu = acts && acts.length ? dc.dataset.key : null; render(); return;
  }
});
document.addEventListener('mouseover', e => { const dc = e.target.closest('.dcard,.pcard'); if (!dc || !dc.dataset.code) return; const code = +dc.dataset.code; if (S.focusCode !== code) { S.focusCode = code; const d = $('.cdetail'); if (d) d.innerHTML = detailHTML(); } });
/* ---------- drag and drop: reorder your hand, or drop a hand card on your field to see its options ---------- */
const DR = { el: null, ghost: null, sx: 0, sy: 0, ox: 0, oy: 0, started: false, timer: null, id: null, touch: false, swallow: false };
function drCancel() { clearTimeout(DR.timer); if (DR.ghost) DR.ghost.remove(); if (DR.el) DR.el.classList.remove('dragging'); document.querySelectorAll('.drop-on,.drop-before').forEach(x => x.classList.remove('drop-on', 'drop-before')); document.body.classList.remove('is-dragging'); Object.assign(DR, { el: null, ghost: null, started: false, id: null }); }
function drTarget(x, y) {
  const under = document.elementFromPoint(x, y); const side = DR.el && DR.el.closest('.side'); if (!under || !side) return {};
  const hand = under.closest('.row.hand'); if (hand && side.contains(hand)) { const b = under.closest('.dcard'); return { hand, before: b && b !== DR.el ? b : null }; }
  const field = under.closest('.row.mon,.row.st'); if (field && side.contains(field)) return { field };
  return {};
}
function drStart(x, y) {
  const r = DR.el.getBoundingClientRect(); DR.ox = x - r.left; DR.oy = y - r.top;
  const g = DR.el.cloneNode(true); g.classList.add('drag-ghost'); g.style.width = r.width + 'px'; document.body.appendChild(g);
  DR.ghost = g; DR.started = true; DR.el.classList.add('dragging'); document.body.classList.add('is-dragging'); drMove(x, y);
}
function drMove(x, y) {
  DR.ghost.style.transform = `translate(${x - DR.ox}px, ${y - DR.oy}px) rotate(4deg) scale(1.08)`;
  document.querySelectorAll('.drop-on,.drop-before').forEach(el => el.classList.remove('drop-on', 'drop-before'));
  const t = drTarget(x, y); if (t.hand) t.hand.classList.add('drop-on'); if (t.before) t.before.classList.add('drop-before'); if (t.field) t.field.classList.add('drop-on');
}
function drFinish(x, y) {
  const t = drTarget(x, y); const el = DR.el; const key = el.dataset.key; const p = +key.split(':')[0];
  drCancel(); DR.swallow = true; setTimeout(() => { DR.swallow = false; }, 60);
  if (t.hand) {
    const cards = [...t.hand.querySelectorAll('.dcard')].filter(c => c !== el);
    const at = t.before ? cards.indexOf(t.before) : cards.length; cards.splice(at < 0 ? cards.length : at, 0, el);
    S.handOrder[p] = cards.map(c => +c.dataset.code); render();
  } else if (t.field) {
    const acts = actionMap().get(key);
    S.focus = key; S.focusCode = +el.dataset.code;
    if (acts && acts.length) { S.menu = key; render(); } else { render(); toast('That card can’t be played right now.'); }
  }
}
document.addEventListener('pointerdown', e => {
  if (e.button > 0) return; const c = e.target.closest('.row.hand .dcard'); if (!c || !S.h) return;
  drCancel(); Object.assign(DR, { el: c, sx: e.clientX, sy: e.clientY, id: e.pointerId, touch: e.pointerType !== 'mouse', started: false });
  if (DR.touch) DR.timer = setTimeout(() => { if (DR.el) drStart(DR.sx, DR.sy); }, 300);
});
document.addEventListener('pointermove', e => {
  if (!DR.el || e.pointerId !== DR.id) return;
  if (!DR.started) { const d = Math.hypot(e.clientX - DR.sx, e.clientY - DR.sy); if (DR.touch) { if (d > 10) drCancel(); return; } if (d < 6) return; drStart(e.clientX, e.clientY); }
  drMove(e.clientX, e.clientY);
});
document.addEventListener('pointerup', e => { if (!DR.el || e.pointerId !== DR.id) return; if (DR.started) drFinish(e.clientX, e.clientY); else drCancel(); });
document.addEventListener('pointercancel', () => { if (DR.el && !DR.started) drCancel(); });
document.addEventListener('touchmove', e => { if (DR.started) e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', e => { if (DR.el && DR.touch) e.preventDefault(); });
document.addEventListener('dragstart', e => { if (e.target.closest && e.target.closest('.dcard')) e.preventDefault(); });
document.addEventListener('click', e => { if (DR.swallow) { e.stopPropagation(); e.preventDefault(); DR.swallow = false; } }, true);
boot();
