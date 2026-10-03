/* YGO Drafter duel table: EDOPro's rules engine (ocgcore, WebAssembly) under our own table, GOAT rules.
   Solo (both sides on one screen) or online with a friend through Firebase, with spectators and chat. */
import createCore, { OcgDuelMode, OcgProcessResult, cardMatchesOpcode } from './engine/index.js';
import { LOC, T, makeCardMap, createDuel, toGoat, isExtra, freeZones, SELECT_TYPES, autoAnswer as legalAnswer } from './glue.js';

const V = 13;
const FORMATS = { goat: { label: 'GOAT', year: '2005', db: 'goat-db.json', errata: 'errata-goat.json', samples: 'sample-decks.json', rules: 'GOAT rules (April 2005)' }, edison: { label: 'Edison', year: '2010', db: 'edison-db.json', errata: 'errata-edison.json', samples: 'sample-decks-edison.json', rules: 'Edison rules (April 2010, Master Rule 1)' } };
const FCACHE = {};
const DA = (typeof window !== 'undefined' && window.YGO_DUEL_ASSETS) || '';      // duel data folder ('' = this folder)
const IMGB = (typeof window !== 'undefined' && window.YGO_IMG) || '../img/';    // card pictures
const FAST = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fast');   // testing only: the computer answers instantly
const FB_VERSION = '12.19.0';
const FB_CONFIG = { apiKey: 'AIzaSyAto8uv4bsHkhDGkhiCFa-PuILGZS9Hf08', authDomain: 'goat-draft-796f7.firebaseapp.com', databaseURL: 'https://goat-draft-796f7-default-rtdb.firebaseio.com', projectId: 'goat-draft-796f7', storageBucket: 'goat-draft-796f7.firebasestorage.app', messagingSenderId: '906831006037', appId: '1:906831006037:web:80e372d9ca72e53073c7dc' };
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const QFLAGS = 1 | 2 | 4 | 16 | 32 | 256 | 512 | 1024 | 2048 | 65536 | 131072;
const phaseName = ph => (ph >= 8 && ph <= 128 ? 'Battle' : ({ 1: 'Draw', 2: 'Standby', 4: 'Main 1', 256: 'Main 2', 512: 'End' })[ph] || '');
const PHASES = ['Draw', 'Standby', 'Main 1', 'Battle', 'Main 2', 'End'];
const LOCNAME = { 1: 'Deck', 2: 'hand', 4: 'Monster Zone', 8: 'Spell & Trap Zone', 16: 'GY', 32: 'banished', 64: 'Extra Deck', 128: 'material' };
const POSNAME = { 1: 'Face-up Attack', 2: 'Face-down Attack', 4: 'Face-up Defense', 8: 'Face-down Defense' };
const RACES = ['Warrior', 'Spellcaster', 'Fairy', 'Fiend', 'Zombie', 'Machine', 'Aqua', 'Pyro', 'Rock', 'Winged Beast', 'Plant', 'Insect', 'Thunder', 'Dragon', 'Beast', 'Beast-Warrior', 'Dinosaur', 'Fish', 'Sea Serpent', 'Reptile', 'Psychic', 'Divine-Beast', 'Creator God', 'Wyrm'];
const ATTRS = ['EARTH', 'WATER', 'FIRE', 'WIND', 'LIGHT', 'DARK', 'DIVINE'];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const enc = r => JSON.stringify(r, (k, v) => typeof v === 'bigint' ? { $b: v.toString() } : v);
const dec = s => JSON.parse(s, (k, v) => v && typeof v === 'object' && '$b' in v ? BigInt(v.$b) : v);
const store = { get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} } };
const myName = () => (store.get('ygo-drafter-name') || '').trim().slice(0, 24) || 'Duelist';

const S = {
  lib: null, db: null, cards: null, strings: null, index: null, cache: new Map(), samples: [],
  mode: null, code: null, room: null, F: null, mySeat: -1, unsub: null, keys: [],
  seatNames: ['Player 1', 'Player 2'], seatDecks: [null, null], first: 0, seed: 0, gameNo: 1,
  h: null, applied: [], prompt: null, lastPrompt: null, title: '', retry: false,
  field: null, chain: [], winner: null, turn: 0, phase: 0, turnPlayer: 0, lp: [8000, 8000],
  sel: [], menu: null, focusCode: null, pickerClosed: false, viewer: null, info: null,
  chainMode: ['auto', 'auto'], handOrder: [[], []], log: [], tab: 'log', chatSeen: 0, fx: [], quiet: false, sending: null, shuffleFx: false,
  ai: true, aiTimer: null, aiActs: 0, aiTried: new Set(), aiTurn: -1, pop: null, lpShown: [8000, 8000],
  popPos: (typeof localStorage !== 'undefined' && localStorage.getItem('ygo-duel-poppos')) || 'cursor'
};

/* ================= loading ================= */
async function boot() {
  try {
    const [lib, strings, index] = await Promise.all([createCore({ sync: true }), fetch(`${DA}strings.json?v=${V}`).then(r => r.json()), fetch(`${DA}scripts/index.json?v=${V}`).then(r => r.json())]);
    Object.assign(S, { lib, strings, index: new Set(index) });
    const q = new URLSearchParams(location.search);
    await loadFormat(FORMATS[q.get('f')] ? q.get('f') : FORMATS[store.get('ygo-drafter:duel-format')] ? store.get('ygo-drafter:duel-format') : 'goat');
    if (q.get('room')) return enterRoom(q.get('room').toUpperCase());
    if (q.get('match')) return openMatch(q.get('match'));
    renderSetup(q.get('invite') ? 'online' : 'solo');
  } catch (e) { console.error(e); $('#app').innerHTML = '<p class="loading">The duel engine didn’t load. Refresh the page to try again.</p>'; }
}
async function loadFormat(f) {
  if (!FORMATS[f]) f = 'goat';
  if (!FCACHE[f]) { const [db, samples, errata] = await Promise.all([fetch(`${DA}${FORMATS[f].db}?v=${V}`).then(r => r.json()), fetch(`${DA}${FORMATS[f].samples}?v=${V}`).then(r => r.json()), fetch(`${DA}${FORMATS[f].errata}?v=${V}`).then(r => r.json()).catch(() => ({}))]); FCACHE[f] = { db, samples, errata, cards: makeCardMap(db) }; }
  Object.assign(S, { format: f, db: FCACHE[f].db, samples: FCACHE[f].samples, cards: FCACHE[f].cards, errata: FCACHE[f].errata });
}
function toFormat(ids) { if (S.format === 'goat') return toGoat(S.db, ids); const v = S.db.variants || {}; return ids.map(i => (v[i] ? +v[i] : i)); }
function readScript(name) {
  if (S.cache.has(name)) return S.cache.get(name);
  let text = '';
  if (S.index.has(name)) { const x = new XMLHttpRequest(); x.open('GET', `${DA}scripts/${name}?v=${V}`, false); try { x.send(null); if (x.status === 200) text = x.responseText; } catch (_) {} }
  S.cache.set(name, text); return text;
}
async function preload(decks) {
  const want = new Set([...S.index].filter(n => !/^c\d+\.lua$/.test(n)));
  for (const d of decks) for (const code of d.main.concat(d.extra)) { want.add(`c${code}.lua`); const c = S.cards.get(code); if (c && c.alias) want.add(`c${c.alias}.lua`); }
  await Promise.all([...want].filter(n => S.index.has(n) && !S.cache.has(n)).map(n => fetch(`${DA}scripts/${n}?v=${V}`).then(r => r.ok ? r.text() : '').then(t => S.cache.set(n, t)).catch(() => {})));
}
let FB = null;
async function fb() {
  if (FB) return FB;
  const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
  const [A, Au, D] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-database.js')]);
  const app = A.initializeApp(FB_CONFIG); const auth = Au.getAuth(app); const db = D.getDatabase(app);
  const user = await new Promise(res => { const off = Au.onAuthStateChanged(auth, u => { off(); res(u); }); });
  const u = user || (await Au.signInAnonymously(auth)).user;
  FB = { ...D, db, uid: u.uid }; return FB;
}
const rref = (F, p = '') => F.ref(F.db, `rooms/${S.code}${p}`);

/* ================= cards and seats ================= */
const card = code => S.cards.get(code) || null;
const cname = code => (card(code) || {}).name || 'a card';
function imgFor(code) { const c = card(code); const base = c && c.alias && (code >= 100000000 || Math.abs(code - c.alias) < 20) ? c.alias : code; return `${IMGB}${base}.webp`; }
const BACK = `${IMGB}back.webp`;
function descText(desc) {
  if (desc === undefined || desc === null) return '';
  const d = BigInt(desc);
  if (d > 0xfffffn) { const code = Number(d >> 20n), i = Number(d & 0xfffffn); const c = card(code); return (c && c.str && c.str[i]) || (c ? `Use ${c.name}` : ''); }
  return (S.strings.system || {})[String(Number(d))] || '';
}
const seatOf = e => (e === 0 ? S.first : 1 - S.first);
const engOf = seat => (seat === S.first ? 0 : 1);
const P = e => S.seatNames[seatOf(e)] || `Player ${seatOf(e) + 1}`;
const meE = () => (S.mySeat >= 0 ? engOf(S.mySeat) : -1);
const bottomE = () => (S.mode === 'online' && S.mySeat >= 0 ? engOf(S.mySeat) : engOf(0));
const humanE = () => engOf(0);
const isAI = e => S.mode === 'solo' && S.ai && e !== humanE();
const decides = e => S.mode === 'solo' ? (S.ai ? e === humanE() : true) : meE() === e;
const visibleTo = e => S.mode === 'solo' ? (S.ai ? e === humanE() : true) : meE() === e;
function at(loc) {
  const f = S.field && S.field[loc.controller]; if (!f) return null;
  const list = { 2: f.hand, 4: f.m, 8: f.s, 16: f.grave, 32: f.removed, 64: f.extra }[loc.location];
  return list ? list[loc.sequence] : null;
}

/* ================= engine ================= */
function newEngine() {
  if (S.h) { try { S.lib.destroyDuel(S.h); } catch (_) {} }
  clearTimeout(S.aiTimer); closePop();
  Object.assign(S, { applied: [], prompt: null, lastPrompt: null, title: '', field: null, chain: [], winner: null, turn: 0, phase: 0, turnPlayer: 0, lp: [8000, 8000], lpShown: [8000, 8000], sel: [], menu: null, log: [], fx: [], aiTurn: -1 });
  const decks = [0, 1].map(e => S.seatDecks[seatOf(e)]);
  S.h = createDuel(S.lib, { seed: S.seed, decks, cards: S.cards, scriptReader: readScript, flags: S.format === 'edison' ? OcgDuelMode.MODE_MR1 : OcgDuelMode.MODE_GOAT, onError: (t, x) => console.warn('engine:', x) });
}
// Runs the engine. feed: responses to apply in order. Stops when someone has to decide.
function pump(feed = [], live = true) {
  let k = 0; S.quiet = !live;
  for (let guard = 0; guard < 400000; guard++) {
    const status = S.lib.duelProcess(S.h);
    for (const m of S.lib.duelGetMessage(S.h)) onMsg(m);
    if (S.retry) { S.retry = false; const bad = S.mode === 'online' ? S.applied[S.applied.length - 1] : S.applied.pop(); if (bad && S.mode === 'online') bad.bad = true; S.prompt = S.lastPrompt; if (bad && !bad.a && live) toast('That choice isn’t allowed. Try another.'); }
    if (S.winner || status === OcgProcessResult.END) { S.prompt = null; break; }
    if (status !== OcgProcessResult.WAITING) continue;
    if (k < feed.length) { apply(feed[k++]); continue; }
    const m = S.prompt; if (!m || !decides(m.player)) break;
    const auto = autoAnswer(m); if (!auto) break;
    if (S.mode === 'online') { send(auto, m.player, true); break; }
    apply({ r: auto, e: m.player, a: 1 });
  }
  S.quiet = false;
  refreshField(); syncHandOrder();
  if (!live) S.lpShown = S.lp.slice();
}
function apply(x) { S.applied.push(x); S.lib.duelSetResponse(S.h, x.r); S.prompt = null; S.title = ''; }
function scheduleAI() {
  clearTimeout(S.aiTimer); const m = S.prompt; if (!m || !isAI(m.player) || S.winner) return;
  const quick = m.type === 16 || m.type === 18 || m.type === 24 || m.type === 21 || m.type === 25 || m.type === 22;
  S.aiTimer = setTimeout(() => {
    const cur = S.prompt; if (cur !== m) return;
    const r = aiAnswer(m) || autoAnswer(m) || legalFallback(m); if (!r) return;
    apply({ r, e: m.player, a: 0, ai: 1 }); pump([], true); render();
  }, FAST ? 15 : quick ? 260 : 650);
}
function chainModeFor(e) { return S.mode === 'solo' ? S.chainMode[e] : S.chainMode[0]; }
function autoAnswer(m) {
  if (m.type === 16) {   // EDOPro's rule: skip unless the engine flags this moment (spe_count) or you chose "Always"
    const mode = chainModeFor(m.player), count = m.selects.length, spe = m.spe_count, trig = spe === 0x7f;
    if (!trig && !m.forced && (mode === 'never' || ((count === 0 || spe === 0) && mode !== 'always'))) return { type: 8, index: null };
    return null;
  }
  if (m.type === 18 || m.type === 24) { const all = freeZones(m.player, m.field_mask); const own = all.filter(z => z.player === m.player); return { type: m.type === 18 ? 10 : 9, places: (own.length >= m.count ? own : all).slice(0, m.count) }; }
  if (m.type === 21 || m.type === 25) return { type: 15, order: null };
  if (m.type === 22) { const out = m.cards.map(() => 0); let left = m.count; m.cards.forEach((c, i) => { const t = Math.min(c.count, left); out[i] = t; left -= t; }); return { type: 13, counters: out }; }
  if (m.type === 132) return { type: 20, value: 1 + ((Math.random() * 3) | 0) };
  return null;
}
function onMsg(m) {
  const t = m.type;
  if (SELECT_TYPES.has(t)) { if (t === 10 || t === 11 || t === 16) S.expect = null; S.prompt = m; S.lastPrompt = m; S.promptSeq = (S.promptSeq || 0) + 1; return; }
  const fx = S.quiet ? null : S.fx;
  switch (t) {
    case 1: S.retry = true; break;
    case 2: if (m.hint_type === 3) S.title = descText(m.hint); else if (m.hint_type === 2 && !S.quiet) log(descText(m.hint)); break;
    case 5: S.winner = m; log(m.player === 2 ? 'The duel is a draw.' : `${P(m.player)} wins the duel.`, 'win'); break;
    case 40: S.turn++; S.turnPlayer = m.player; log(`Turn ${S.turn}: ${P(m.player)}`, 'turn', m.player); if (fx) fx.push({ k: 'banner', text: `Turn ${S.turn}`, sub: P(m.player), e: m.player }); break;
    case 41: S.phase = m.phase; if (fx && [4, 8, 256, 512].includes(m.phase)) fx.push({ k: 'banner', text: phaseName(m.phase) + ' Phase', small: true }); break;
    case 60: checkPlayed(m.code); log(`${P(m.controller)} Normal Summons ${cname(m.code)}.`, '', m.controller); break;
    case 62: checkPlayed(m.code); log(`${P(m.controller)} Special Summons ${cname(m.code)}.`, '', m.controller); break;
    case 64: checkPlayed(m.code); log(`${P(m.controller)} Flip Summons ${cname(m.code)}.`, '', m.controller); break;
    case 54: checkPlayed(m.code); log(`${P(m.controller)} sets a card.`, '', m.controller); break;
    case 70: checkPlayed(m.code); log(`${P(m.controller)} activates ${cname(m.code)} (chain link ${m.chain_size}).`, 'chain', m.controller); if (fx) fx.push({ k: 'chain', loc: { controller: m.controller, location: m.location, sequence: m.sequence }, n: m.chain_size, code: m.code }); break;
    case 73: if (fx) fx.push({ k: 'resolve', n: m.chain_size }); break;
    case 75: log('The activation was negated.', 'chain'); break;
    case 90: log(`${P(m.player)} draws ${m.drawn.length === 1 ? 'a card' : m.drawn.length + ' cards'}.`, '', m.player); break;
    case 91: if (S.curBattle) S.curBattle.dmg[m.player] += m.amount; else log(`${P(m.player)} takes ${m.amount} damage.`, 'dmg', m.player); if (fx) fx.push({ k: 'lp', e: m.player, amount: -m.amount, battle: !!S.curBattle }); break;
    case 92: log(`${P(m.player)} gains ${m.amount} LP.`, 'heal', m.player); if (fx) fx.push({ k: 'lp', e: m.player, amount: m.amount }); break;
    case 100: log(`${P(m.player)} pays ${m.amount} LP.`, '', m.player); if (fx) fx.push({ k: 'lp', e: m.player, amount: -m.amount }); break;
    case 110: { if (S.expect && S.expect.kind === 'attack') { const a = at(m.card); if (a && a.code !== S.expect.code) console.error(`Card check failed: attacked with ${a.code}, chose ${S.expect.code}`); S.expect = null; } S.attacking = null; const a = at(m.card), d = m.target && at(m.target); log(`${a ? cname(a.code) : 'A monster'} attacks ${d ? (d.position & 10 ? 'a face-down monster' : cname(d.code)) : 'directly'}.`, '', m.card.controller); if (fx) fx.push({ k: 'attack', from: m.card, to: m.target }); break; }
    case 111: { const direct = !m.target || !m.target.location; const a = at(m.card), d = direct ? null : at(m.target); S.curBattle = { a: { ...m.card, code: a ? a.code : 0 }, d: direct ? null : { ...m.target, code: d ? d.code : 0 }, dmg: [0, 0] }; break; }
    case 114: if (S.curBattle) { const b = S.curBattle; S.curBattle = null; log(battleText(b), 'battle', b.a.controller); if (fx) fx.push({ k: 'battle', b }); } break;
    case 53: if (fx && (m.prev_position & 10) && !(m.position & 10)) fx.push({ k: 'flip', loc: { controller: m.controller, location: m.location, sequence: m.sequence } }); break;
    case 31: if (m.cards.length) log(`Revealed: ${m.cards.map(c => cname(c.code)).join(', ')}.`); break;
    case 32: if (fx) fx.push({ k: 'shuffle', e: m.player }); if (!S.quiet) log(`${P(m.player)}’s Deck was shuffled.`, 'muted', m.player); break;
    case 50: {
      if (m.to.location === LOC.GRAVE && (m.from.location & (LOC.MZONE | LOC.SZONE))) log(`${cname(m.card)} goes to the GY.`, 'muted');
      if (m.to.location === LOC.REMOVED) log(`${cname(m.card)} is banished.`, 'muted');
      if (fx) fx.push({ k: 'move', code: m.card, from: m.from, to: m.to });
      break;
    }
  }
}
function battleText(b) {
  const an = cname(b.a.code);
  if (!b.d) return `${an} attacks directly: ${P(1 - b.a.controller)} takes ${b.dmg[1 - b.a.controller]} damage.`;
  const dn = cname(b.d.code), def = (b.d.position & 12) !== 0, dv = def ? b.d.defense : b.d.attack;
  const res = [];
  if (b.a.destroyed && b.d.destroyed) res.push('both are destroyed');
  else if (b.d.destroyed) res.push(`${dn} is destroyed`);
  else if (b.a.destroyed) res.push(`${an} is destroyed`);
  else if (def) res.push(b.a.attack < dv ? `${an} bounces off` : 'nothing is destroyed');
  else res.push('nothing is destroyed');
  [0, 1].forEach(p => { if (b.dmg[p]) res.push(`${P(p)} takes ${b.dmg[p]} battle damage`); });
  if (!b.dmg[0] && !b.dmg[1]) res.push('no damage');
  return `Battle: ${an} (${b.a.attack} ATK) vs ${dn} (${dv} ${def ? 'DEF' : 'ATK'}): ${res.join(', ')}.`;
}
// What would happen if your monster attacks this one (shown when you pick a target)
function predict(atk, c) {
  const q = at(c); if (!q) return '';
  if (q.position & 10) return 'Face-down: it flips up first, then the result depends on its DEF.';
  if (q.position & 4) return atk > q.defense ? `Destroys it (DEF ${q.defense}). No damage.` : atk < q.defense ? `Bounces off (DEF ${q.defense}): you take ${q.defense - atk}.` : `Nothing happens (DEF ${q.defense}).`;
  return atk > q.attack ? `Destroys it: they take ${atk - q.attack}.` : atk < q.attack ? `Your monster is destroyed: you take ${q.attack - atk}.` : 'Both are destroyed. No damage.';
}
function checkPlayed(code) {
  if (!S.expect || S.expect.kind !== 'play') return;
  const want = S.expect.code; S.expect = null;
  const same = code === want || (card(code) && card(code).alias === want) || (card(want) && card(want).alias === code);
  if (!same && code) { console.error(`Card check failed: chose ${cname(want)} (${want}) but the engine played ${cname(code)} (${code})`); log(`Warning: you chose ${cname(want)}, but ${cname(code)} was played. Please report this.`, 'dmg'); }
}
function log(text, kind = '', e = -1) { if (text) S.log.push({ text, kind, e }); }
function refreshField() {
  if (!S.h) return;
  try {
    const F = S.lib.duelQueryField(S.h);
    S.lp = F.players.map(p => Math.max(0, p.lp | 0)); S.chain = F.chain || [];   // the engine reports LP unsigned; below 0 shows as 0
    const q = (p, loc) => S.lib.duelQueryLocation(S.h, { flags: QFLAGS, controller: p, location: loc });
    S.field = [0, 1].map(p => ({ hand: q(p, LOC.HAND), m: q(p, LOC.MZONE), s: q(p, LOC.SZONE), grave: q(p, LOC.GRAVE), removed: q(p, LOC.REMOVED), extra: q(p, LOC.EXTRA), deck: F.players[p].deck_size }));
  } catch (e) { console.error(e); }
}

/* ================= answering ================= */
function expectedCard(m, r) {
  if (m.type === 11 && r.type === 1 && r.action <= 5 && r.action !== 2) return ([m.summons, m.special_summons, m.pos_changes, m.monster_sets, m.spell_sets, m.activates][r.action][r.index] || {}).code;
  if (m.type === 10 && r.type === 0 && r.action <= 1) return ([m.chains, m.attacks][r.action][r.index] || {}).code;
  if (m.type === 16 && r.type === 8 && r.index != null) return (m.selects[r.index] || {}).code;
  return 0;
}
function answer(r, chosenCode = 0) {
  const m = S.prompt; if (!m || !decides(m.player)) return;
  const exp = expectedCard(m, r);
  if (chosenCode && exp && exp !== chosenCode) { console.error(`Card check failed before sending: chose ${chosenCode}, action is for ${exp}`); toast('That action belongs to another card. Tap the card again.'); closePop(); render(); return; }
  S.expect = exp ? { code: exp, kind: m.type === 10 && r.action === 1 ? 'attack' : 'play' } : null;
  if (m.type === 10 && r.type === 0 && r.action === 1 && m.attacks[r.index]) { const a = m.attacks[r.index]; S.attacking = { atk: fieldAtk(a), code: a.code }; }
  S.sel = []; S.menu = null; S.pickerClosed = false; closeModal('#picker'); closePop();
  if (S.mode === 'online') { send(r, m.player, false); render(); return; }
  apply({ r, e: m.player, a: 0 });
  pump([], true); render();
}
async function send(r, e, auto) {
  if (S.sending && S.sending.n === S.applied.length) return;
  S.sending = { n: S.applied.length };
  try { const F = await fb(); await F.push(rref(F, '/responses'), { r: enc(r), e, a: auto ? 1 : 0, by: F.uid }); }
  catch (err) { S.sending = null; toast('Couldn’t send your move. Check your connection.'); }
}
function lastDecisionIdx(pred) { for (let i = S.applied.length - 1; i >= 0; i--) if (!S.applied[i].a && !S.applied[i].bad && !S.applied[i].ai && pred(S.applied[i].e)) return i; return -1; }
function undo() {
  if (S.mode === 'solo') {
    clearTimeout(S.aiTimer);
    const i = lastDecisionIdx(e => !S.ai || e === humanE()); if (i < 0) { toast('Nothing to undo yet.'); return; }
    const keep = S.applied.slice(0, i); newEngine(); pump(keep, false); S.lpShown = S.lp.slice(); render(); toast('Undone.'); return;
  }
  if (S.mySeat < 0) return;
  const me = meE(); const i = lastDecisionIdx(e => e === me);
  if (i < 0) { toast('You haven’t made a move to undo yet.'); return; }
  const oppAfter = S.applied.slice(i + 1).some(x => !x.a && x.e !== me);
  if (!oppAfter) truncate(i); else askUndo();
}
async function truncate(i) { const F = await fb(); const upd = {}; S.keys.slice(i).forEach(k => { upd[`responses/${k}`] = null; }); upd.undo = null; await F.update(rref(F), upd); }
async function askUndo() { const F = await fb(); await F.set(rref(F, '/undo'), { seat: S.mySeat, t: Date.now() }); toast('Asked your opponent to let you take it back.'); }
async function answerUndo(ok) {
  const F = await fb(); const req = S.room && S.room.undo; if (!req) return;
  if (!ok) { await F.set(rref(F, '/undo'), null); return; }
  const e = engOf(req.seat); const i = lastDecisionIdx(x => x === e); if (i >= 0) await truncate(i); else await F.set(rref(F, '/undo'), null);
}

/* ================= computer opponent ================= */
const ATK = code => { const c = card(code); return c && (c.type & 1) ? Math.max(0, c.attack) : 0; };
function fieldAtk(loc) { const q = at(loc); return q && q.attack != null ? q.attack : ATK(loc.code); }
const bestIdx = (list, f) => list.reduce((b, x, i) => (f(x) > f(list[b]) ? i : b), 0);
function legalFallback(m) { return legalAnswer(m, S.cards, { allowBattle: true, announceCandidates: mm => [...S.cards.values()].filter(c => !(c.type & T.TOKEN) && cardMatchesOpcode(c, mm.opcodes)).map(c => c.code) }); }
function canAttack(me) { return (S.field[me].m || []).some(x => x && !(x.position & 10) && (x.position & 1) && x.attack > 0); }
function aiAnswer(m) {
  const me = m.player, opp = 1 - me;
  if (S.aiTurn !== S.turn) { S.aiTurn = S.turn; S.aiActs = 0; S.aiTried = new Set(); S.aiSets = 0; }
  const k = c => `${c.controller}:${c.location}:${c.sequence}:${c.code}`;
  const oppMons = () => (S.field[opp].m || []).filter(Boolean);
  switch (m.type) {
    case 11: {
      S.aiActs++;
      if (S.aiActs > 16) return m.to_bp && canAttack(me) && !S.aiTried.has('bp') ? (S.aiTried.add('bp'), { type: 1, action: 6, index: 0 }) : m.to_ep ? { type: 1, action: 7, index: 0 } : null;
      const ai = m.activates.findIndex(c => !S.aiTried.has('a' + k(c)));
      if (ai >= 0) { S.aiTried.add('a' + k(m.activates[ai])); return { type: 1, action: 5, index: ai }; }
      if (m.special_summons.length) { const i = bestIdx(m.special_summons, c => ATK(c.code)); if (!S.aiTried.has('s' + k(m.special_summons[i]))) { S.aiTried.add('s' + k(m.special_summons[i])); return { type: 1, action: 1, index: i }; } }
      if (m.summons.length) {
        const i = bestIdx(m.summons, c => ATK(c.code)); const c = m.summons[i];
        const threat = oppMons().some(x => !(x.position & 10) && (x.position & 1) && x.attack > ATK(c.code));
        const si = m.monster_sets.findIndex(x => x.code === c.code && x.location === c.location && x.sequence === c.sequence);
        if ((ATK(c.code) < 1300 || threat) && si >= 0) return { type: 1, action: 3, index: si };
        return { type: 1, action: 0, index: i };
      }
      const ti = m.spell_sets.findIndex(c => { const cd = card(c.code); return cd && (cd.type & T.TRAP || cd.type & 0x10000) && !S.aiTried.has('t' + k(c)); });
      if (ti >= 0 && (S.aiSets || 0) < 3) { S.aiTried.add('t' + k(m.spell_sets[ti])); S.aiSets = (S.aiSets || 0) + 1; return { type: 1, action: 4, index: ti }; }
      if (m.to_bp && canAttack(me) && !S.aiTried.has('bp')) { S.aiTried.add('bp'); return { type: 1, action: 6, index: 0 }; }
      return m.to_ep ? { type: 1, action: 7, index: 0 } : null;
    }
    case 10: {
      S.aiActs++;
      const opps = oppMons(); let best = -1, score = -1;
      if (S.aiActs < 30) m.attacks.forEach((a, i) => {
        const atk = fieldAtk(a); let s = -1;
        if (!opps.length || a.can_direct) s = 10000 + atk;
        else if (opps.some(o => (o.position & 10) ? atk >= 1500 : (o.position & 4) ? atk > o.defense : atk > o.attack)) s = atk;
        if (s > score) { score = s; best = i; }
      });
      if (best >= 0) { S.aiAttackAtk = fieldAtk(m.attacks[best]); return { type: 0, action: 1, index: best }; }
      return m.to_m2 ? { type: 0, action: 2, index: 0 } : { type: 0, action: 3, index: 0 };
    }
    case 16: {
      if (!m.selects.length) return { type: 8, index: null };
      if (m.forced) return { type: 8, index: 0 };
      const last = S.chain[S.chain.length - 1]; const vsOpp = last && last.controller !== me;
      const timing = (m.hint_timing || 0) | (m.hint_timing_other || 0);
      const hot = vsOpp || (timing & (0x1000 | 64 | 128 | 256 | 0x2000));
      if (m.spe_count > 0 && (hot ? Math.random() < .85 : Math.random() < .2)) return { type: 8, index: (Math.random() * m.selects.length) | 0 };
      return { type: 8, index: null };
    }
    case 12: return { type: 2, yes: true };
    case 13: return { type: 3, yes: true };
    case 14: return { type: 4, index: 0 };
    case 19: { const c = card(m.code); const want = c && c.attack >= c.defense ? 1 : 4; return { type: 11, position: [want, 1, 4, 8, 2].find(p => m.positions & p) }; }
    case 15: {
      const n = Math.max(1, m.min);
      const allOppMons = m.selects.length && m.selects.every(c => c.controller !== me && c.location === LOC.MZONE);
      if (allOppMons && S.aiAttackAtk != null) {
        const atk = S.aiAttackAtk; S.aiAttackAtk = null;
        const val = c => { const q = at(c); if (!q) return -1; if (q.position & 10) return atk >= 1500 ? 500 : -1; const v = q.position & 4 ? q.defense : q.attack; return atk > v ? 1000 + v : -1; };
        const order = m.selects.map((c, i) => [i, val(c)]).sort((a, b) => b[1] - a[1]);
        return { type: 5, indicies: order.slice(0, n).map(x => x[0]) };
      }
      const sc = c => { const v = c.location === LOC.MZONE ? fieldAtk(c) : ATK(c.code); return c.controller === me ? -v : v + 5000; };
      return { type: 5, indicies: m.selects.map((c, i) => [i, sc(c)]).sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]) };
    }
    case 20: { const order = m.selects.map((c, i) => [i, fieldAtk(c)]).sort((a, b) => a[1] - b[1]).map(x => x[0]); let need = m.min; const pick = []; for (const i of order) { if (need <= 0) break; pick.push(i); need -= (m.selects[i].release_param || 1); } return { type: 12, indicies: pick }; }
    case 26: { if (m.can_finish && m.unselect_cards.length >= Math.max(1, m.min)) return { type: 7, index: null }; return { type: 7, index: m.select_cards.length ? 0 : null }; }
    default: return null;
  }
}

/* ================= actions available now ================= */
function actionMap() {
  const m = S.prompt, map = new Map(); if (!m || !decides(m.player)) return map;
  const add = (c, label, r, ss) => { const k = `${c.controller}:${c.location}:${c.sequence}`; if (!map.has(k)) map.set(k, []); map.get(k).push({ label, r, ss: !!ss }); };
  if (m.type === 11) {
    m.summons.forEach((c, i) => add(c, 'Normal Summon', { type: 1, action: 0, index: i }));
    m.special_summons.forEach((c, i) => add(c, 'Special Summon', { type: 1, action: 1, index: i }, true));
    m.pos_changes.forEach((c, i) => add(c, 'Change battle position', { type: 1, action: 2, index: i }));
    m.monster_sets.forEach((c, i) => add(c, 'Set', { type: 1, action: 3, index: i }));
    m.spell_sets.forEach((c, i) => add(c, 'Set', { type: 1, action: 4, index: i }));
    m.activates.forEach((c, i) => add(c, descText(c.description) || 'Activate', { type: 1, action: 5, index: i }));
  } else if (m.type === 10) {
    m.chains.forEach((c, i) => add(c, descText(c.description) || 'Activate', { type: 0, action: 0, index: i }));
    m.attacks.forEach((c, i) => add(c, `Attack (${fieldAtk(c)} ATK)${c.can_direct ? ', can attack directly' : ''}`, { type: 0, action: 1, index: i }));
  } else if (m.type === 16) m.selects.forEach((c, i) => add(c, descText(c.description) || 'Activate', { type: 8, index: i }));
  return map;
}
const glow = (acts, key) => !acts.has(key) ? '' : acts.get(key).some(a => a.ss) ? 'act act-ss' : 'act';
const pileHasAction = (e, loc, acts) => [...acts.keys()].some(k => { const [p, l] = k.split(':').map(Number); return p === e && l === loc; });

/* ================= rendering ================= */
function slotHTML(e, loc, seq, kind, label, acts, chainNo) {
  const list = loc === LOC.MZONE ? S.field[e].m : S.field[e].s; const c = list[seq]; const key = `${e}:${loc}:${seq}`;
  if (!c) return `<div class="slot ${kind}" data-key="${key}"><span class="zl">${label}</span></div>`;
  const down = (c.position & 10) !== 0, def = (c.position & 12) !== 0 && loc === LOC.MZONE;
  const peek = down && visibleTo(e);
  const img = down && !peek ? BACK : imgFor(c.code);
  let stat = '';
  if (loc === LOC.MZONE && !down) { const up = (v, b) => v > b ? 'up' : v < b ? 'down' : ''; stat = `<span class="stat"><b class="${up(c.attack, c.baseAttack)}">${c.attack ?? '?'}</b><i>/</i><b class="${up(c.defense, c.baseDefense)}">${c.defense ?? '?'}</b></span>`; }
  const ch = chainNo.get(key);
  return `<div class="slot ${kind} filled" data-key="${key}"><button class="dcard ${down ? 'fd' : ''} ${peek ? 'peek' : ''} ${def ? 'def' : ''} ${glow(acts, key)}" type="button" data-key="${key}" data-code="${down && !peek ? '' : c.code}" aria-label="${esc(down && !peek ? 'Face-down card' : cname(c.code))}">
    <img src="${img}" alt="" draggable="false" data-alt="${esc(cname(c.code))}">${peek ? '<span class="settag">Set</span>' : ''}${stat}${(c.counters && Object.keys(c.counters).length) ? `<span class="ctr">${Object.values(c.counters).reduce((a, b) => a + b, 0)}</span>` : ''}${ch ? `<span class="chainno">${ch}</span>` : ''}</button></div>`;
}
function pileHTML(e, loc, label, list, acts) {
  const n = Array.isArray(list) ? list.length : list; const top = Array.isArray(list) && list.length ? list[list.length - 1] : null;
  const faceUp = top && (loc === LOC.GRAVE || loc === LOC.REMOVED || (loc === LOC.EXTRA && visibleTo(e)));
  const img = n ? (faceUp ? imgFor(top.code) : BACK) : '';
  const glow = acts && pileHasAction(e, loc, acts) ? 'act' : '';
  return `<button class="slot pile ${glow}" type="button" data-pile="${e}:${loc}" data-kind="${label}" aria-label="${esc(label)}, ${n} cards">${n ? `<img src="${img}" alt="" draggable="false" onerror="this.remove()">` : ''}<span class="pl">${label}</span><span class="pn">${n}</span></button>`;
}
function syncHandOrder() {
  if (!S.field) return;
  [0, 1].forEach(e => {
    const left = new Map(); S.field[e].hand.forEach(c => left.set(c.code, (left.get(c.code) || 0) + 1));
    const keep = [];
    for (const code of S.handOrder[e] || []) if (left.get(code) > 0) { keep.push(code); left.set(code, left.get(code) - 1); }
    for (const c of S.field[e].hand) if (left.get(c.code) > 0) { keep.push(c.code); left.set(c.code, left.get(c.code) - 1); }
    S.handOrder[e] = keep;
  });
}
function orderedHand(e) {
  const ord = S.handOrder[e] || []; const used = ord.map(() => false);
  return S.field[e].hand.map((c, i) => { let k = ord.findIndex((code, j) => !used[j] && code === c.code); if (k >= 0) used[k] = true; else k = 1e6 + i; return { c, i, k }; }).sort((a, b) => a.k - b.k);
}
function handHTML(e, acts) {
  const vis = visibleTo(e);
  const cards = orderedHand(e).map(({ c, i }) => { const key = `${e}:2:${i}`; return `<button class="dcard hc ${glow(acts, key)}" type="button" data-key="${key}" data-code="${vis ? c.code : ''}" aria-label="${esc(vis ? cname(c.code) : 'Card in hand')}"><img src="${vis ? imgFor(c.code) : BACK}" alt="" draggable="false" data-alt="${esc(vis ? cname(c.code) : '')}"></button>`; }).join('');
  return `<div class="hand ${vis ? 'mine' : 'hidden'}" data-hand="${e}">${cards || '<span class="emptyhand">No cards in hand</span>'}</div>`;
}
function chainBadges() { const m = new Map(); S.chain.forEach((l, i) => { if (l.location === LOC.MZONE || l.location === LOC.SZONE) m.set(`${l.controller}:${l.location}:${l.sequence}`, i + 1); }); return m; }
function sideHTML(e, top) {
  const f = S.field[e], acts = actionMap(), ch = chainBadges();
  const z = (loc, seq, kind, label) => slotHTML(e, loc, seq, kind, label, acts, ch);
  let r1 = [z(LOC.SZONE, 5, 'field', 'Field'), ...[0, 1, 2, 3, 4].map(i => z(LOC.MZONE, i, 'mon', 'Monster')), pileHTML(e, LOC.GRAVE, 'GY', f.grave, acts), pileHTML(e, LOC.REMOVED, 'Banished', f.removed, acts)];
  let r2 = [pileHTML(e, LOC.EXTRA, 'Extra', f.extra, acts), ...[0, 1, 2, 3, 4].map(i => z(LOC.SZONE, i, 'st', 'Spell / Trap')), pileHTML(e, LOC.DECK, 'Deck', f.deck), '<div class="slot blank"></div>'];
  if (top) { r1 = r1.reverse(); r2 = r2.reverse(); }
  const rows = top ? [r2, r1] : [r1, r2];
  return `<div class="side ${top ? 'top' : 'bottom'} ${S.turnPlayer === e ? 'turn' : ''}" data-e="${e}">${rows.map(r => `<div class="frow">${r.join('')}</div>`).join('')}</div>`;
}
function lpHTML(e) {
  const shown = S.lpShown[e]; const pct = Math.max(0, Math.min(100, shown / 80));
  return `<div class="lpbox ${e === bottomE() ? 'me' : 'opp'} ${S.turnPlayer === e ? 'turn' : ''}" data-lp="${e}"><span class="nm">${esc(P(e))}${S.turnPlayer === e ? ' <i>• turn</i>' : ''}</span><span class="lpl">LP</span><span class="lpv">${shown}</span><span class="lpbar"><span style="width:${pct}%"></span></span></div>`;
}
function phaseBarHTML() {
  const m = S.prompt; const mineNow = m && decides(m.player);
  const go = { Battle: mineNow && m.type === 11 && m.to_bp ? { type: 1, action: 6, index: 0 } : null, 'Main 2': mineNow && m.type === 10 && m.to_m2 ? { type: 0, action: 2, index: 0 } : null,
    End: mineNow && ((m.type === 11 && m.to_ep) || (m.type === 10 && m.to_ep)) ? (m.type === 11 ? { type: 1, action: 7, index: 0 } : { type: 0, action: 3, index: 0 }) : null };
  const cur = phaseName(S.phase);
  return `<div class="phasebar">${PHASES.map(n => go[n] ? `<button class="ph go" type="button" data-r='${enc(go[n])}'>${n}</button>` : `<span class="ph ${cur === n ? 'on' : ''}">${n}</span>`).join('')}</div>`;
}
function promptHTML() {
  if (S.winner || (S.room && S.room.result)) {
    const res = S.room && S.room.result; const wE = res ? engOf(res.seat) : S.winner.player;
    const txt = res && res.why === 'surrender' ? `${esc(S.seatNames[1 - res.seat])} surrendered.` : '';
    const iWon = S.mode === 'online' && meE() === wE;
    return `<div class="decide done"><h2>${wE === 2 ? 'It’s a draw' : S.mode === 'online' && S.mySeat >= 0 ? (iWon ? 'You win!' : 'You lose') : `${esc(P(wE))} wins`}</h2>${txt ? `<p class="hint">${txt}</p>` : ''}
      <div class="row-btns">${S.mode === 'solo' || S.mySeat >= 0 ? '<button class="cta" type="button" data-act="rematch">Rematch</button>' : ''}${S.mode === 'solo' ? '<button class="ghost" type="button" data-act="undo">Undo the last move</button>' : ''}</div></div>`;
  }
  const m = S.prompt;
  if (!m) return `<div class="decide"><p class="hint">Working…</p></div>`;
  if (S.sending && decides(m.player)) return `<div class="decide waiting"><p class="who">Your move</p><p class="hint">Sending…</p></div>`;
  if (!decides(m.player)) return `<div class="decide waiting"><p class="who">${isAI(m.player) ? 'The computer is thinking…' : `${esc(P(m.player))} is deciding…`}</p><p class="hint">${esc(waitingText(m))}</p></div>`;
  const who = S.mode === 'solo' ? `<p class="who">${esc(P(m.player))} decides</p>` : `<p class="who">Your move</p>`;
  const title = S.title ? `<h2>${esc(S.title)}</h2>` : '';
  const btn = (label, r, cls = 'ghost') => `<button class="${cls}" type="button" data-r='${enc(r)}'>${esc(label)}</button>`;
  if (m.type === 11) return `<div class="decide">${who}<h2>${phaseName(S.phase) || 'Main Phase'}</h2><p class="hint">Gold: playable. Gold and blue: can be Special Summoned.</p><div class="row-btns">${m.to_bp ? btn('Battle Phase', { type: 1, action: 6, index: 0 }, 'cta') : ''}${m.to_ep ? btn('End turn', { type: 1, action: 7, index: 0 }) : ''}</div></div>`;
  if (m.type === 10) return `<div class="decide">${who}<h2>Battle Phase</h2><p class="hint">Tap a monster to attack with it.</p><div class="row-btns">${m.to_m2 ? btn('Main Phase 2', { type: 0, action: 2, index: 0 }, 'cta') : ''}${m.to_ep ? btn('End turn', { type: 0, action: 3, index: 0 }) : ''}</div></div>`;
  if (m.type === 16) return `<div class="decide">${who}<h2>${S.chain.length ? `Chain ${S.chain.length}: respond?` : 'Activate a card?'}</h2><p class="hint">${S.chain.length ? `In response to ${esc(cname(S.chain[S.chain.length - 1].code))}.` : 'You can activate a card now.'}</p>
    <div class="list">${m.selects.map((c, i) => btn(`${cname(c.code)}: ${descText(c.description) || 'Activate'}`, { type: 8, index: i })).join('')}</div><div class="row-btns">${m.forced ? '' : btn('Pass', { type: 8, index: null }, 'cta')}</div></div>`;
  if (m.type === 12) return `<div class="decide">${who}<h2>Use ${esc(cname(m.code))}?</h2><p class="hint">${esc(descText(m.description))}</p><div class="row-btns">${btn('Yes', { type: 2, yes: true }, 'cta')}${btn('No', { type: 2, yes: false })}</div></div>`;
  if (m.type === 13) return `<div class="decide">${who}<h2>${esc(descText(m.description) || 'Yes or no?')}</h2><div class="row-btns">${btn('Yes', { type: 3, yes: true }, 'cta')}${btn('No', { type: 3, yes: false })}</div></div>`;
  if (m.type === 14) return `<div class="decide">${who}${title || '<h2>Choose an effect</h2>'}<div class="list">${m.options.map((o, i) => btn(descText(o) || `Option ${i + 1}`, { type: 4, index: i })).join('')}</div></div>`;
  if (m.type === 19) return `<div class="decide">${who}<h2>Position for ${esc(cname(m.code))}</h2><div class="list">${[1, 2, 4, 8].filter(p => m.positions & p).map(p => btn(POSNAME[p], { type: 11, position: p })).join('')}</div></div>`;
  if (m.type === 140) return `<div class="decide">${who}<h2>${esc(S.title || 'Declare a Type')}</h2><div class="list cols">${RACES.map((r, i) => (m.available & (1n << BigInt(i))) ? btn(r, { type: 16, races: [1n << BigInt(i)] }) : '').join('')}</div></div>`;
  if (m.type === 141) return `<div class="decide">${who}<h2>${esc(S.title || 'Declare an Attribute')}</h2><div class="list cols">${ATTRS.map((a, i) => (m.available & (1 << i)) ? btn(a, { type: 17, attributes: [1 << i] }) : '').join('')}</div></div>`;
  if (m.type === 143) return `<div class="decide">${who}<h2>${esc(S.title || 'Declare a number')}</h2><div class="list cols">${m.options.map((o, i) => btn(String(Number(o)), { type: 19, value: i })).join('')}</div></div>`;
  if (m.type === 142) return `<div class="decide">${who}<h2>${esc(S.title || 'Declare a card name')}</h2><input class="text" id="announceIn" placeholder="Type a card name" autocomplete="off"><div class="list" id="announceList"></div></div>`;
  if ([15, 20, 23, 26].includes(m.type)) return `<div class="decide">${who}${title || '<h2>Choose cards</h2>'}<p class="hint">Pick in the window that opened.</p><div class="row-btns"><button class="ghost" type="button" data-act="reopen">Show the choices</button></div></div>`;
  if (m.type === 132) return `<div class="decide">${who}<h2>Rock, paper, scissors</h2><div class="row-btns">${btn('Rock', { type: 20, value: 2 })}${btn('Paper', { type: 20, value: 3 })}${btn('Scissors', { type: 20, value: 1 })}</div></div>`;
  return `<div class="decide">${who}<h2>Waiting</h2></div>`;
}
function waitingText(m) { return { 11: 'Main Phase', 10: 'Battle Phase', 16: 'Deciding whether to respond', 15: 'Choosing cards', 20: 'Choosing Tributes', 12: 'Deciding on an effect', 13: 'Deciding', 14: 'Choosing an effect', 19: 'Choosing a position' }[m.type] || 'Thinking'; }
function menuHTML() {
  if (!S.menu) return '';
  if (S.menuSeq !== undefined && S.menuSeq !== S.promptSeq) { S.menu = null; return ''; }
  if (S.menuCode) { const c0 = cardAt(S.menu); if (!c0 || c0.code !== S.menuCode) { S.menu = null; return ''; } }
  const acts = actionMap().get(S.menu) || []; if (!acts.length) return '';
  const [p, l, s] = S.menu.split(':').map(Number); const c = at({ controller: p, location: l, sequence: s });
  return `<div class="menu"><p class="menu-title">${esc(c ? cname(c.code) : 'Card')}</p>${acts.map(a => `<button class="cta" type="button" data-r='${enc(a.r)}'>${esc(a.label)}</button>`).join('')}<button class="linkish" type="button" data-act="closemenu">Cancel</button></div>`;
}
function cardAt(key) { const [p, l, s] = key.split(':').map(Number); return at({ controller: p, location: l, sequence: s }); }
function popStillValid() { if (!S.pop) return false; const c = cardAt(S.pop.key); return S.pop.seq === S.promptSeq && !!c && (!S.pop.code || c.code === S.pop.code); }
const actKind = r => r.type === 1 ? ['summon', 'spsummon', 'position', 'mset', 'sset', 'activate'][r.action] || 'phase' : r.type === 0 ? (r.action === 1 ? 'attack' : r.action === 0 ? 'activate' : 'phase') : r.type === 8 ? 'activate' : 'other';
function renderPop() {
  let el = $('#pop'); if (!el) { el = document.createElement('div'); el.id = 'pop'; el.className = 'pop'; el.setAttribute('role', 'menu'); document.body.appendChild(el); }
  if (S.pop && !popStillValid()) S.pop = null;          // the game moved on, or that spot now holds another card
  const acts = S.pop ? (actionMap().get(S.pop.key) || []) : [];
  if (!S.pop || !acts.length) { el.hidden = true; S.pop = null; return; }
  const c = cardAt(S.pop.key);
  el.innerHTML = `<p class="pop-title">${esc(c ? cname(c.code) : 'Card')}</p>${acts.map(a => `<button class="${a.ss ? 'ss' : ''}" type="button" role="menuitem" data-kind="${actKind(a.r)}" data-r='${enc(a.r)}'>${esc(a.label)}</button>`).join('')}<button class="linkish" type="button" data-act="closepop">Cancel</button>`;
  el.hidden = false; placePop();
}
function placePop() {
  const el = $('#pop'); if (!el || el.hidden || !S.pop) return;
  const w = el.offsetWidth, h = el.offsetHeight; let x, y;
  el.classList.toggle('docked', S.popPos === 'corner');
  el.classList.remove('below');
  if (S.popPos === 'corner') { const b = $('#board'); const r = b ? b.getBoundingClientRect() : { left: 8, top: 8 }; x = r.left + 12; y = Math.max(8, r.top + 12); }
  else {
    let px = S.pop.x, py = S.pop.y;
    if (px == null) { const a = document.querySelector(`#board .dcard[data-key="${S.pop.key}"]`); if (a) { const r = a.getBoundingClientRect(); px = r.left + r.width / 2; py = r.top; } else { px = innerWidth / 2; py = innerHeight / 2; } }
    x = px - w / 2; y = py - h - 16;                 // hover just above the cursor, centred on it
    if (y < 8) { el.classList.add('below'); y = py + 24; }   // no room above: just below instead
  }
  x = Math.min(innerWidth - w - 8, Math.max(8, x)); y = Math.min(innerHeight - h - 8, Math.max(8, y));
  el.style.left = x + 'px'; el.style.top = y + 'px';
}
function closePop() { S.pop = null; const el = $('#pop'); if (el) el.hidden = true; }
function animateLP() {
  [0, 1].forEach(e => {
    const from = S.lpShown[e], to = S.lp[e]; if (from === to) return;
    S.lpShown[e] = to; const el = document.querySelector(`[data-lp="${e}"]`); if (!el) return;
    const v = el.querySelector('.lpv'), bar = el.querySelector('.lpbar span'); const t0 = performance.now(), dur = reduce ? 1 : 1000;
    const tick = now => { const k = Math.min(1, (now - t0) / dur); const val = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))); if (v.isConnected) { v.textContent = val; bar.style.width = Math.max(0, Math.min(100, val / 80)) + '%'; } if (k < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
}
function chainListHTML() {
  if (!S.chain.length) return '';
  return `<div class="chainlist"><p class="lbl">Chain</p><ol>${S.chain.map((l, i) => `<li class="${l.controller === bottomE() ? 'me' : 'opp'}"><b>${i + 1}</b>${esc(cname(l.code))}<small>${esc(P(l.controller))}</small></li>`).reverse().join('')}</ol></div>`;
}
function controlsHTML() {
  const solo = S.mode === 'solo'; const both = solo && !S.ai;
  const modes = e => `<div class="seg tiny" role="radiogroup" aria-label="Chain prompts">${[['auto', 'Auto'], ['always', 'Always'], ['never', 'Never']].map(([v, l]) => `<label><input type="radio" name="cm-${e}" value="${v}" ${S.chainMode[e] === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
  const chainBox = S.mode === 'online' && S.mySeat < 0 ? '' : `<div class="chainmode"><p class="lbl">Chain prompts${both ? ` (${esc(P(bottomE()))})` : ''}</p>${modes(solo ? bottomE() : 0)}${both ? `<p class="lbl">Chain prompts (${esc(P(1 - bottomE()))})</p>${modes(1 - bottomE())}` : ''}<p class="tiny-note">Auto stops only when it matters. Always also stops in the Draw and Standby Phase.</p></div>`;
  const undoBtn = solo ? `<button class="ghost" type="button" data-act="undo" ${S.applied.some(x => !x.a && !x.ai) ? '' : 'disabled'}>Undo</button>` : S.mySeat >= 0 ? `<button class="ghost" type="button" data-act="undo">Undo</button>` : '';
  const sur = S.mode === 'online' && S.mySeat >= 0 && !S.winner && !(S.room && S.room.result) ? '<button class="ghost" type="button" data-act="surrender">Surrender</button>' : '';
  const req = S.room && S.room.undo && S.mySeat >= 0 && S.room.undo.seat !== S.mySeat ? `<div class="undoask"><p><b>${esc(S.seatNames[S.room.undo.seat])}</b> asks to take back their last move.</p><div class="row-btns"><button class="cta" type="button" data-act="undo-yes">Allow</button><button class="ghost" type="button" data-act="undo-no">Decline</button></div></div>` : '';
  const popBox = S.mode === 'online' && S.mySeat < 0 ? '' : `<div class="chainmode"><p class="lbl">Action menu</p><div class="seg tiny" role="radiogroup" aria-label="Where the action menu opens">${[['cursor', 'Above the cursor'], ['corner', 'Top left']].map(([v, l]) => `<label><input type="radio" name="poppos" value="${v}" ${S.popPos === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>`;
  return `${req}${chainBox}${popBox}<div class="row-btns">${undoBtn}${sur}<button class="ghost" type="button" data-act="${solo ? 'setup' : 'leave'}">${solo ? 'New duel' : 'Leave'}</button></div>`;
}
// Card text: the version in force in this format's year, plus today's text if an errata changed it since
function textBlock(code) {
  const c = card(code); if (!c) return '';
  const base = c.alias && (code >= 100000000 || Math.abs(code - c.alias) < 20) ? c.alias : code;
  const e = (S.errata || {})[code] || (S.errata || {})[base];
  const variant = code >= 100000000 || / \((GOAT|Pre-Errata)\)$/.test(c.name);
  const yr = FORMATS[S.format].year;
  const engine = variant ? `The duel plays this card by its ${yr} version.` : S.format === 'goat' ? 'The duel plays this card the way EDOPro’s GOAT list does.' : 'The duel plays this card by today’s script.';
  if (!e) return `<p class="d-text">${esc(c.desc)}</p>`;
  return `<div class="errata"><p class="e-lbl">Text in ${esc(FORMATS[S.format].label)} (${yr}) <small>as printed in ${esc(e.from)}</small></p><p class="d-text">${esc(e.era)}</p>
    <details class="e-now"><summary>Today’s text (changed by errata since)</summary><p class="d-text">${esc(e.now)}</p></details><p class="e-eng">${engine}</p></div>`;
}
function detailHTML() {
  const code = S.focusCode; if (!code) return '<p class="hint">Hover a card, or right-click it, to read it.</p>';
  const c = card(code); if (!c) return '';
  const stats = c.type & 1 ? `<p class="d-stats">${c.type & 0x800000 ? 'Rank' : 'Level'} ${c.level} · ATK ${c.attack < 0 ? '?' : c.attack} / DEF ${c.defense < 0 ? '?' : c.defense}</p>` : '';
  return `<img class="d-img" src="${imgFor(code)}" alt="" onerror="this.remove()"><h3>${esc(c.name.replace(/ \((GOAT|Pre-Errata)\)$/, ''))}</h3>${stats}${textBlock(code)}`;
}
function sidePanelHTML() {
  const online = S.mode === 'online'; const chat = (S.room && S.room.chatList) || [];
  const unread = online && S.tab !== 'chat' ? Math.max(0, chat.length - S.chatSeen) : 0;
  const tabs = online ? `<div class="ptabs"><button type="button" data-act="tab-log" aria-selected="${S.tab === 'log'}">Log</button><button type="button" data-act="tab-chat" aria-selected="${S.tab === 'chat'}">Chat${unread ? ` <b>${unread}</b>` : ''}</button></div>` : '';
  const body = online && S.tab === 'chat'
    ? `<div class="chat" id="chatBox">${chat.map(x => `<p class="${x.seat === 0 ? 's0' : x.seat === 1 ? 's1' : 'sw'}"><b>${esc(x.name)}:</b> ${esc(x.text)}</p>`).join('') || '<p class="hint">Say hi.</p>'}</div><form class="chatform" data-form="chat"><input class="text" id="chatIn" maxlength="200" placeholder="Message" autocomplete="off"><button class="cta" type="submit">Send</button></form>`
    : `<div class="log" id="log" data-n="${S.log.length}">${S.log.slice(-120).map(l => `<p class="${l.kind} ${l.e >= 0 ? (l.e === bottomE() ? 'me' : 'opp') : ''}">${esc(l.text)}</p>`).join('')}</div>`;
  const watchers = online && S.room && S.room.watchers ? Object.values(S.room.watchers).length : 0;
  return `<div class="cdetail" id="cdetail">${detailHTML()}</div><div class="logchat">${tabs}${body}</div>${online ? `<p class="tiny-note">${watchers ? `${watchers} watching. ` : ''}Spectator link: <button class="linkish" type="button" data-act="copy-watch">copy</button></p>` : ''}`;
}
function render() {
  if (!S.field) return;
  const before = snapRects();
  const b = bottomE(), tp = 1 - b;
  $('#status').innerHTML = `<span>${FORMATS[S.format].label}: ${S.mode === 'online' ? `duel ${esc(S.code)}${S.mySeat < 0 ? ', watching' : ''}` : S.ai ? 'solo vs computer' : 'solo, both sides'}, turn ${S.turn}</span>`;
  $('#barActions').innerHTML = '';
  const acts = actionMap();
  $('#app').innerHTML = `<section class="duel">
    <aside class="left">${promptHTML()}${chainListHTML()}${controlsHTML()}</aside>
    <div class="board" id="board"><div class="pline top">${lpHTML(tp)}${handHTML(tp, acts)}</div>${sideHTML(tp, true)}<div class="midline" id="midline">${phaseBarHTML()}</div>${sideHTML(b, false)}<div class="pline bottom">${lpHTML(b)}${handHTML(b, acts)}</div></div>
    <aside class="right">${sidePanelHTML()}</aside></section>`;
  const lg = $('#log'); if (lg) lg.scrollTop = lg.scrollHeight;
  const cb = $('#chatBox'); if (cb) { cb.scrollTop = cb.scrollHeight; S.chatSeen = ((S.room && S.room.chatList) || []).length; }
  const m = S.prompt;
  if (m && decides(m.player) && [15, 20, 23, 26].includes(m.type) && !S.pickerClosed) openPicker(); else closeModal('#picker');
  if (m && decides(m.player) && m.type === 142) bindAnnounce(m);
  if (S.viewer) openViewer(S.viewer.e, S.viewer.loc);
  playFx(before); animateLP(); renderPop();
  scheduleAI();
}

/* ================= animations ================= */
function snapRects() {
  const out = new Map();
  document.querySelectorAll('#board .dcard[data-key], #board [data-pile], #board [data-hand]').forEach(el => out.set(el.dataset.key || (el.dataset.pile ? 'pile:' + el.dataset.pile : 'hand:' + el.dataset.hand), el.getBoundingClientRect()));
  document.querySelectorAll('[data-lp]').forEach(el => out.set('lp:' + el.dataset.lp, el.getBoundingClientRect()));
  return out;
}
const PILES = new Set([LOC.DECK, LOC.GRAVE, LOC.REMOVED, LOC.EXTRA]);
function locKey(l) { return PILES.has(l.location) ? `pile:${l.controller}:${l.location}` : `${l.controller}:${l.location}:${l.sequence}`; }
function rectAfter(l) {
  if (PILES.has(l.location)) { const el = document.querySelector(`[data-pile="${l.controller}:${l.location}"]`); return el && el.getBoundingClientRect(); }
  const el = document.querySelector(`#board .dcard[data-key="${l.controller}:${l.location}:${l.sequence}"]`) || document.querySelector(`#board [data-key="${l.controller}:${l.location}:${l.sequence}"]`) || document.querySelector(`[data-hand="${l.controller}"]`);
  return el && el.getBoundingClientRect();
}
function ghost(src, r) { const g = document.createElement('img'); g.className = 'fxghost'; g.src = src; Object.assign(g.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.width * 306 / 210 + 'px' }); document.body.appendChild(g); return g; }
function playFx(before) {
  const fx = S.fx; S.fx = []; if (!fx.length || reduce) return;
  let delay = 0; const moves = fx.filter(f => f.k === 'move').slice(-10);
  for (const f of moves) {
    const from = before.get(locKey(f.from)) || (f.from.location === LOC.HAND ? before.get('hand:' + f.from.controller) : null);
    const to = rectAfter(f.to); if (!from || !to || (from.width === 0)) continue;
    const pub = (f.to.location & (LOC.GRAVE | LOC.REMOVED)) || ((f.to.location & (LOC.MZONE | LOC.SZONE)) && !(f.to.position & 10)) || (f.to.location === LOC.HAND && visibleTo(f.to.controller));
    const dest = f.to.location & (LOC.MZONE | LOC.SZONE | LOC.HAND) ? document.querySelector(`#board .dcard[data-key="${f.to.controller}:${f.to.location}:${f.to.sequence}"]`) : null;
    const g = ghost(pub ? imgFor(f.code) : BACK, from);
    if (dest) dest.style.opacity = '0';
    const dx = to.left - from.left + (to.width - from.width) / 2, dy = to.top - from.top + (to.height - from.height) / 2, sc = Math.max(.5, Math.min(1.6, to.width / Math.max(1, from.width)));
    const toField = f.to.location & (LOC.MZONE | LOC.SZONE);
    const rot = f.to.location === LOC.MZONE && (f.to.position & 12) ? 90 : 0; const fin = rot ? sc * .82 : sc;
    const a = g.animate([{ transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 }, { transform: `translate(${dx * .5}px,${dy * .5 - 40}px) scale(${toField ? 1.35 : 1.1}) rotate(${rot * .4}deg)`, opacity: 1, offset: .55 }, { transform: `translate(${dx}px,${dy}px) scale(${fin}) rotate(${rot}deg)`, opacity: f.to.location & (LOC.DECK | LOC.EXTRA) ? .2 : 1 }], { duration: rot ? 640 : 520, delay, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' });
    a.onfinish = () => { g.remove(); if (dest) { dest.style.opacity = ''; if (toField) dest.animate([{ filter: 'brightness(1.9)' }, { filter: 'brightness(1)' }], { duration: 380, easing: 'ease-out' }); } };
    setTimeout(() => { if (g.isConnected) { g.remove(); if (dest) dest.style.opacity = ''; } }, delay + 1500);
    delay += 90;
  }
  for (const f of fx) {
    if (f.k === 'attack') {
      const a = document.querySelector(`#board .dcard[data-key="${f.from.controller}:4:${f.from.sequence}"]`); if (!a) continue;
      const ar = a.getBoundingClientRect(); const tEl = f.to ? document.querySelector(`#board .dcard[data-key="${f.to.controller}:4:${f.to.sequence}"]`) : document.querySelector(`[data-lp="${1 - f.from.controller}"]`);
      const tr = tEl ? tEl.getBoundingClientRect() : ar; const dx = (tr.left + tr.width / 2 - ar.left - ar.width / 2) * .6, dy = (tr.top + tr.height / 2 - ar.top - ar.height / 2) * .6;
      a.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${dx}px,${dy}px) scale(1.15)`, offset: .45 }, { transform: 'translate(0,0)' }], { duration: 560, delay, easing: 'cubic-bezier(.5,0,.3,1)' });
      if (tEl) tEl.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(2.2) saturate(1.6)', offset: .45 }, { filter: 'brightness(1)' }], { duration: 560, delay });
    }
    if (f.k === 'lp') {
      const el = document.querySelector(`[data-lp="${f.e}"]`); if (!el) continue;
      const pop = document.createElement('span'); pop.className = `lppop ${f.amount < 0 ? 'neg' : 'pos'}`; pop.textContent = (f.amount > 0 ? '+' : '') + f.amount; el.appendChild(pop);
      pop.animate([{ transform: 'translateY(6px) scale(.7)', opacity: 0 }, { transform: 'translateY(-10px) scale(1.15)', opacity: 1, offset: .25 }, { transform: 'translateY(-30px) scale(1)', opacity: 0 }], { duration: 1500, easing: 'ease-out', fill: 'forwards' }).onfinish = () => pop.remove();
      el.animate([{ background: f.amount < 0 ? 'rgba(220,60,60,.35)' : 'rgba(60,200,120,.3)' }, { background: 'transparent' }], { duration: 900 });
    }
    if (f.k === 'chain') {
      const el = document.querySelector(`#board .dcard[data-key="${f.loc.controller}:${f.loc.location}:${f.loc.sequence}"]`);
      if (el) el.animate([{ boxShadow: '0 0 0 0 rgba(255,214,102,.9)', transform: 'scale(1)' }, { boxShadow: '0 0 0 14px rgba(255,214,102,0)', transform: 'scale(1.12)', offset: .5 }, { boxShadow: '0 0 0 0 rgba(255,214,102,0)', transform: 'scale(1)' }], { duration: 800 });
    }
    if (f.k === 'shuffle') { const el = document.querySelector(`[data-pile="${f.e}:1"]`); if (el) el.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-8deg) translateX(-4px)' }, { transform: 'rotate(7deg) translateX(4px)' }, { transform: 'rotate(-5deg)' }, { transform: 'rotate(0)' }], { duration: 650 }); }
    if (f.k === 'banner') banner(f.text, f.sub, f.small, f.e);
    if (f.k === 'battle') battleCard(f.b);
    if (f.k === 'flip') { const el = document.querySelector(`#board .dcard[data-key="${f.loc.controller}:${f.loc.location}:${f.loc.sequence}"]`); if (el) el.animate([{ transform: `${el.classList.contains('def') ? 'rotate(90deg) scale(.82) ' : ''}rotateY(180deg)`, filter: 'brightness(.3)' }, { transform: `${el.classList.contains('def') ? 'rotate(90deg) scale(.82) ' : ''}rotateY(0deg)`, filter: 'brightness(1.6)', offset: .7 }, { transform: `${el.classList.contains('def') ? 'rotate(90deg) scale(.82) ' : ''}rotateY(0deg)`, filter: 'brightness(1)' }], { duration: 700, easing: 'ease-out' }); }
  }
  if (S.shuffleFx) { S.shuffleFx = false; shuffleIntro(); }
}
let battleT = 0;
function battleCard(b) {
  const board = $('#board'); if (!board) return;
  const side = (x, role) => { if (!x) return `<div class="bc-side direct"><span class="bc-dir">Direct attack</span></div>`; const def = role === 'd' && (x.position & 12); const v = def ? x.defense : x.attack; return `<div class="bc-side ${x.destroyed ? 'gone' : ''} ${x.controller === bottomE() ? 'me' : 'opp'}"><img src="${imgFor(x.code)}" alt="" onerror="this.remove()"><b>${v}</b><span>${def ? 'DEF' : 'ATK'}</span>${x.destroyed ? '<i>Destroyed</i>' : ''}</div>`; };
  const dmg = [0, 1].filter(p => b.dmg[p]).map(p => `<p class="bc-dmg">${esc(P(p))} takes ${b.dmg[p]} damage</p>`).join('') || '<p class="bc-none">No damage</p>';
  const el = document.createElement('div'); el.className = 'battlecard';
  el.innerHTML = `<div class="bc-row">${side(b.a, 'a')}<span class="bc-vs">⚔</span>${side(b.d, 'd')}</div>${dmg}`;
  const now = performance.now(); const wait = Math.max(0, battleT - now); battleT = now + wait + 2300;
  setTimeout(() => { if (!board.isConnected) return; board.appendChild(el); el.animate([{ opacity: 0, transform: 'translate(-50%,-50%) scale(.85)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1.04)', offset: .12 }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: .85 }, { opacity: 0, transform: 'translate(-50%,-50%) scale(.96)' }], { duration: reduce ? 1600 : 2200, fill: 'forwards' }).onfinish = () => el.remove(); }, wait);
}
let bannerT = 0;
function banner(text, sub, small, e) {
  const mid = $('#midline'); if (!mid) return;
  const b = document.createElement('div'); b.className = `banner ${small ? 'small' : ''} ${e === bottomE() ? 'me' : e >= 0 ? 'opp' : ''}`; b.innerHTML = `<b>${esc(text)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`;
  const now = performance.now(); const d = Math.max(0, bannerT - now); bannerT = now + d + (small ? 700 : 1100);
  setTimeout(() => { if (!mid.isConnected) return; mid.appendChild(b); b.animate([{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'scale(1.05)', offset: .2 }, { opacity: 1, transform: 'scale(1)', offset: .75 }, { opacity: 0, transform: 'scale(1)' }], { duration: small ? 900 : 1500, fill: 'forwards' }).onfinish = () => b.remove(); }, d);
}
function shuffleIntro() {
  for (const e of [0, 1]) {
    const pile = document.querySelector(`[data-pile="${e}:1"]`); if (!pile) continue; const r = pile.getBoundingClientRect();
    for (let k = 0; k < 6; k++) {
      const g = ghost(BACK, r); const side = k % 2 ? 1 : -1;
      g.animate([{ transform: 'translate(0,0) rotate(0)' }, { transform: `translate(${side * (r.width * .7)}px, ${-k * 3}px) rotate(${side * 10}deg)`, offset: .35 }, { transform: `translate(${side * (r.width * .2)}px, ${-k * 2}px) rotate(${side * -4}deg)`, offset: .7 }, { transform: 'translate(0,0) rotate(0)', opacity: .9 }], { duration: 1100, delay: k * 70, easing: 'ease-in-out', fill: 'both' }).onfinish = () => g.remove();
    }
  }
  banner('Shuffling the decks', '', true, -1);
}

/* ================= picker, pile viewer, card info ================= */
function pickItems(m) {
  if (m.type === 23) return m.selects_must.map(c => ({ ...c, must: true })).concat(m.selects);
  if (m.type === 26) return m.select_cards.map(c => ({ ...c })).concat(m.unselect_cards.map(c => ({ ...c, chosen: true })));
  return m.selects;
}
function openPicker() {
  const m = S.prompt; const items = pickItems(m);
  $('#pickTitle').textContent = S.attacking ? `Attack with ${cname(S.attacking.code)} (${S.attacking.atk} ATK): choose a target` : S.title || (m.type === 20 ? 'Choose monsters to Tribute' : 'Choose cards');
  const range = m.type === 26 ? 'Tap a card to add or remove it.' : m.type === 23 ? (m.select_max ? `Their Levels must add up to at least ${m.amount & 0xffff}, with no extra card.` : `Their values must add up to exactly ${m.amount & 0xffff}.`) : `Choose ${m.min === m.max ? m.min : `${m.min} to ${m.max}`}.`;
  $('#pickCount').textContent = range;
  $('#pickBody').innerHTML = `<div class="pgrid">${items.map((c, i) => {
    const on = S.sel.includes(i) || c.must || c.chosen; const hidden = (c.position & 10) && c.location !== LOC.HAND && !visibleTo(c.controller);
    const handHidden = c.location === LOC.HAND && !visibleTo(c.controller);
    const show = !(hidden || handHidden);
    const q = c.location === LOC.MZONE ? at(c) : null; const stats = q && !(q.position & 10) ? `<small class="pstat">${q.position & 4 ? `DEF ${q.defense}` : `ATK ${q.attack}`} · ${q.position & 4 ? 'Defense' : 'Attack'}</small>` : '';
    const guess = S.attacking && c.location === LOC.MZONE && c.controller !== m.player ? `<small class="guess">${esc(predict(S.attacking.atk, c))}</small>` : '';
    return `<button class="pcard ${on ? 'on' : ''} ${c.must ? 'must' : ''} ${c.controller === bottomE() ? 'me' : 'opp'}" type="button" data-pi="${i}" data-code="${show ? c.code : ''}"><img src="${show ? imgFor(c.code) : BACK}" alt="" onerror="this.remove()"><span>${esc(show ? cname(c.code) : 'Face-down card')}</span><small>${c.controller === bottomE() ? 'Your' : `${esc(P(c.controller))}’s`} ${LOCNAME[c.location] || ''}</small>${stats}${guess}</button>`;
  }).join('')}</div>`;
  const ok = canConfirm(m, items);
  $('#pickActions').innerHTML = m.type === 26
    ? `${m.can_finish ? '<button class="cta" type="button" data-pick="finish">Done</button>' : ''}${m.can_cancel ? '<button class="ghost" type="button" data-pick="cancel">Cancel</button>' : ''}<button class="linkish" type="button" data-pick="hide">Look at the board</button>`
    : `<button class="cta" type="button" data-pick="ok" ${ok ? '' : 'disabled'}>Confirm</button>${m.can_cancel ? '<button class="ghost" type="button" data-pick="cancel">Cancel</button>' : ''}<button class="linkish" type="button" data-pick="hide">Look at the board</button>`;
  $('#picker').hidden = false;
}
function canConfirm(m, items) {
  const n = S.sel.length;
  if (m.type === 15) return n >= m.min && n <= m.max;
  if (m.type === 20) { const sum = S.sel.reduce((a, i) => a + (items[i].release_param || 1), 0); return sum >= m.min && n <= m.max && n > 0; }
  if (m.type === 23) {
    const amt = m.amount & 0xffff; const v = i => items[i].amount & 0xffff; const must = m.selects_must.reduce((a, c) => a + (c.amount & 0xffff), 0);
    const chosen = S.sel.filter(i => !items[i].must); const sum = must + chosen.reduce((a, i) => a + v(i), 0);
    if (m.select_max) return sum >= amt && chosen.every(i => sum - v(i) < amt);   // rituals: at least the Level, with no extra card
    return sum === amt;
  }
  return false;
}
function closeModal(sel) { const el = $(sel); if (el) el.hidden = true; }
function pickClick(i) {
  const m = S.prompt; if (!m) return;
  if (m.type === 26) { answer({ type: 7, index: i }); return; }
  const items = pickItems(m); if (items[i] && items[i].must) return;
  const k = S.sel.indexOf(i); if (k >= 0) S.sel.splice(k, 1); else { if (m.type === 15 && m.max === 1) S.sel = [i]; else S.sel.push(i); }
  openPicker();
}
function pickConfirm(kind) {
  const m = S.prompt; if (!m) return;
  if (kind === 'hide') { closeModal('#picker'); S.pickerClosed = true; return; }
  if (kind === 'cancel') { answer(m.type === 26 ? { type: 7, index: null } : { type: m.type === 20 ? 12 : m.type === 23 ? 14 : 5 }); return; }
  if (kind === 'finish') { answer({ type: 7, index: null }); return; }
  if (m.type === 15) answer({ type: 5, indicies: S.sel.slice() });
  else if (m.type === 20) answer({ type: 12, indicies: S.sel.slice() });
  else if (m.type === 23) answer({ type: 14, indicies: m.selects_must.map((_, i) => i).concat(S.sel.filter(i => !pickItems(m)[i].must)) });
}
function openViewer(e, loc) {
  S.viewer = { e, loc }; const f = S.field[e]; const list = { 16: f.grave, 32: f.removed, 64: f.extra }[loc];
  if (loc === LOC.DECK) { toast(`${P(e)}’s Deck: ${f.deck} cards.`); S.viewer = null; return; }
  const acts = actionMap(); const show = c => loc !== LOC.EXTRA || visibleTo(e) || !(c.position & 10);
  $('#viewTitle').textContent = `${e === bottomE() ? 'Your' : `${P(e)}’s`} ${loc === LOC.GRAVE ? 'Graveyard' : loc === LOC.REMOVED ? 'banished cards' : 'Extra Deck'}`;
  $('#viewCount').textContent = `${list.length} card${list.length === 1 ? '' : 's'}${loc === LOC.GRAVE ? ', newest last' : ''}`;
  const menu = S.menu && S.menu.startsWith(`${e}:${loc}:`) ? menuHTML() : '';
  $('#viewBody').innerHTML = `${menu}<div class="pgrid">${list.map((c, i) => { const key = `${e}:${loc}:${i}`; const vis = show(c); return `<button class="pcard ${acts.has(key) ? 'act' : ''}" type="button" data-vkey="${key}" data-code="${vis ? c.code : ''}"><img src="${vis ? imgFor(c.code) : BACK}" alt="" onerror="this.remove()"><span>${esc(vis ? cname(c.code) : 'Face-down')}</span></button>`; }).join('') || '<p class="hint">Empty.</p>'}</div>`;
  $('#viewer').hidden = false;
}
function openInfo(key, code) {
  const c = card(code); if (!c) return;
  let live = '';
  if (key) { const [p, l, s] = key.split(':').map(Number); const q = at({ controller: p, location: l, sequence: s }); if (q && l === LOC.MZONE) live = `<p class="d-stats">Now: ATK ${q.attack} / DEF ${q.defense}, ${POSNAME[q.position] || ''}${q.position & 10 ? '' : ''}</p>`; if (q) live += `<p class="d-stats">${p === bottomE() ? 'Yours' : `${esc(P(p))}’s`}, ${LOCNAME[l] || ''}</p>`; }
  $('#infoBody').innerHTML = `<img class="i-img" src="${imgFor(code)}" alt="" onerror="this.remove()"><div><h2>${esc(c.name.replace(/ \((GOAT|Pre-Errata)\)$/, ''))}</h2>${c.type & 1 ? `<p class="d-stats">${c.type & 0x800000 ? 'Rank' : 'Level'} ${c.level} · ATK ${c.attack < 0 ? '?' : c.attack} / DEF ${c.defense < 0 ? '?' : c.defense}</p>` : ''}${live}${textBlock(code)}</div>`;
  $('#info').hidden = false;
}
function bindAnnounce(m) {
  const input = $('#announceIn'); if (!input) return;
  const pool = [...S.cards.values()].filter(c => !(c.type & T.TOKEN) && cardMatchesOpcode(c, m.opcodes));
  const draw = () => { const q = input.value.trim().toLowerCase(); $('#announceList').innerHTML = pool.filter(c => !q || c.name.toLowerCase().includes(q)).slice(0, 40).map(c => `<button class="ghost" type="button" data-r='${enc({ type: 18, card: c.code })}'>${esc(c.name)}</button>`).join(''); };
  input.addEventListener('input', draw); draw(); input.focus();
}

/* ================= decks for the setup ================= */
function parseYdk(text) {
  const main = [], extra = []; let sec = 'main';
  for (const line of String(text || '').split(/\r?\n/)) { const l = line.trim(); if (l.startsWith('#main')) { sec = 'main'; continue; } if (l.startsWith('#extra')) { sec = 'extra'; continue; } if (l.startsWith('!side')) { sec = 'side'; continue; } if (/^\d+$/.test(l) && sec !== 'side') (sec === 'main' ? main : extra).push(+l); }
  const all = toFormat(main.concat(extra)); const known = all.filter(c => S.cards.has(c));
  return { main: known.filter(c => !isExtra(card(c))), extra: known.filter(c => isExtra(card(c))), unknown: all.length - known.length };
}
function savedDecks() { try { return JSON.parse(store.get('ygo-drafter:decks') || '[]'); } catch (_) { return []; } }
function deckOptions(sel) {
  const drafted = store.get('ygo-drafter:duel-ydk'); const saved = savedDecks();
  return `${drafted ? `<option value="drafted" ${sel === 'drafted' ? 'selected' : ''}>Your last drafted deck</option>` : ''}
    ${saved.length ? `<optgroup label="My saved decks">${saved.map((d, i) => `<option value="saved:${i}" ${sel === 'saved:' + i ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</optgroup>` : ''}
    <option value="paste" ${sel === 'paste' ? 'selected' : ''}>Paste a .ydk</option>
    <optgroup label="Tournament decks">${S.samples.map((d, i) => d.n.includes(', ') ? `<option value="${i}" ${String(sel) === String(i) ? 'selected' : ''}>${esc(d.n)}</option>` : '').join('')}</optgroup>
    <optgroup label="Starter and structure decks">${S.samples.map((d, i) => !d.n.includes(', ') ? `<option value="${i}" ${String(sel) === String(i) ? 'selected' : ''}>${esc(d.n)}</option>` : '').join('')}</optgroup>`;
}
function deckFrom(v, text) {
  if (v === 'drafted') return { ...parseYdk(store.get('ygo-drafter:duel-ydk')), name: store.get('ygo-drafter:duel-ydk-name') || 'Drafted deck' };
  if (v.startsWith('saved:')) { const d = savedDecks()[+v.slice(6)]; return d ? { ...parseYdk(d.ydk), name: d.name } : { main: [], extra: [], unknown: 0 }; }
  if (v === 'paste') return { ...parseYdk(text), name: 'Pasted deck' };
  const d = S.samples[+v]; return d ? { main: d.main.slice(), extra: d.extra.slice(), unknown: 0, name: d.n } : { main: [], extra: [], unknown: 0 };
}
const deckField = (id, label, def) => `<div class="block"><h3><label for="${id}">${label}</label></h3><select class="text" id="${id}">${deckOptions(def)}</select><textarea class="text ydk" id="${id}-ydk" placeholder="#main&#10;12345678&#10;…" hidden></textarea></div>`;
function renderSetup(tab = 'solo') {
  stopRoom();
  if (S.h) { try { S.lib.destroyDuel(S.h); } catch (_) {} S.h = null; }
  S.mode = null; S.field = null;
  $('#status').innerHTML = `<span>Duel table, ${esc(FORMATS[S.format].rules)}</span>`; $('#barActions').innerHTML = '';
  const def = store.get('ygo-drafter:duel-ydk') ? 'drafted' : 0;
  $('#app').innerHTML = `<section class="home setup"><div class="hero-pack"><img class="setup-back" src="${BACK}" alt=""></div><div>
    <h2>Duel table</h2><p class="lede">Test a deck against the computer, or duel a friend online.</p>
    <div class="block"><h3>Format</h3><div class="seg" role="radiogroup" aria-label="Format">${Object.entries(FORMATS).map(([k, f]) => `<label><input type="radio" name="fmt" value="${k}" ${S.format === k ? 'checked' : ''}><span>${f.label}</span></label>`).join('')}</div><p class="note" style="margin-top:6px">${esc(FORMATS[S.format].rules)}. ${S.format === 'goat' ? 'Uses EDOPro’s GOAT card list, with GOAT and pre-errata card versions. Duelist Kingdom decks play here too.' : 'Every card released by April 2010, with pre-errata texts for cards changed after that.'}</p></div>
    <div class="ttabs" role="tablist"><button type="button" role="tab" aria-selected="${tab === 'solo'}" data-act="tab-solo">Test solo</button><button type="button" role="tab" aria-selected="${tab === 'online'}" data-act="tab-online">Duel a friend</button></div>
    ${tab === 'solo' ? `<div class="block"><h3>Opponent</h3><div class="seg" role="radiogroup"><label><input type="radio" name="oppmode" value="computer" ${S.ai ? 'checked' : ''}><span>Computer</span></label><label><input type="radio" name="oppmode" value="both" ${S.ai ? '' : 'checked'}><span>Me (play both sides)</span></label></div><p class="note" style="margin-top:6px">Against the computer you only see your own hand and control only your own cards.</p></div>
      ${deckField('deck0', 'Your deck', def)}${deckField('deck1', 'Opponent’s deck', 1)}
      <div class="row" style="margin-top:16px"><button class="cta" type="button" data-act="start-solo">Start the duel</button></div>`
    : `${deckField('deck0', 'Your deck', def)}<div class="row" style="margin-top:16px"><button class="cta" type="button" data-act="create-invite">Create an invite link</button></div>
      <p class="note">You’ll get a link to send. Your friend opens it, picks their deck, and the duel starts.</p>`}
    <p class="note">Cards from outside the chosen format are left out of the deck. Decks are shuffled at the start of every duel.</p></div></section>`;
  bindDeckSelects();
}
function bindDeckSelects() { document.querySelectorAll('select[id^="deck"]').forEach(s => { const ta = $(`#${s.id}-ydk`); const f = () => { if (ta) ta.hidden = s.value !== 'paste'; }; s.addEventListener('change', f); f(); }); }
function pickedDeck(id) { const d = deckFrom($(`#${id}`).value, ($(`#${id}-ydk`) || {}).value); if (d.main.length < 20) { toast(`A deck needs at least 20 Main Deck cards that work in ${FORMATS[S.format].label}.`); return null; } return d; }
async function startSolo() {
  const d0 = pickedDeck('deck0'), d1 = d0 && pickedDeck('deck1'); if (!d0 || !d1) return;
  $('#app').innerHTML = '<p class="loading">Shuffling up…</p>';
  S.ai = (document.querySelector('input[name="oppmode"]:checked') || {}).value !== 'both';
  S.mode = 'solo'; S.mySeat = 0; S.seatNames = S.ai ? [myName(), 'Computer'] : ['Player 1', 'Player 2']; S.seatDecks = [d0, d1].map(d => ({ main: d.main, extra: d.extra }));
  await preload(S.seatDecks); startGame((Math.random() * 2 ** 31) | 0);
  const dropped = d0.unknown + d1.unknown; if (dropped) toast(`${dropped} card${dropped === 1 ? '' : 's'} from outside ${FORMATS[S.format].label} ${dropped === 1 ? 'was' : 'were'} left out.`);
}
function goesFirst(seat) { return S.mode === 'online' && seat === S.mySeat ? 'You go first' : `${String(S.seatNames[seat]).replace(' (you)', '')} goes first`; }
function startGame(seed, first) {
  S.seed = seed; S.first = first ?? (seed % 2); S.handOrder = [[], []]; S.chainMode = S.mode === 'solo' ? ['auto', 'auto'] : [S.chainMode[0] || 'auto', 'auto'];
  newEngine(); S.shuffleFx = true;
  S.fx = [{ k: 'banner', text: goesFirst(S.first), small: false, e: engOf(S.first) }];
  log(`${goesFirst(S.first)} (coin toss).`, 'turn');
  pump([], true); render();
}

/* ================= online rooms ================= */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
async function createInvite() {
  const d = pickedDeck('deck0'); if (!d) return;
  const F = await fb(); let code = null;
  for (let t = 0; t < 8 && !code; t++) { const c = Array.from({ length: 5 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join(''); if (!(await F.get(F.ref(F.db, `rooms/${c}`))).exists()) code = c; }
  if (!code) { toast('Couldn’t create a duel. Try again.'); return; }
  await F.set(F.ref(F.db, `rooms/${code}`), { kind: 'duel', format: S.format, created: Date.now(), host: F.uid, status: 'lobby', gameNo: 1, seats: { 0: { uid: F.uid, name: myName(), deck: { main: d.main, extra: d.extra, name: d.name || '' } } } });
  history.replaceState(null, '', `?room=${code}`);
  enterRoom(code);
}
async function enterRoom(code) {
  const F = await fb(); S.code = code; S.mode = 'online';
  $('#app').innerHTML = '<p class="loading">Joining the duel…</p>';
  stopRoom();
  S.unsub = F.onValue(F.ref(F.db, `rooms/${code}`), snap => onRoom(snap.val()));
}
function stopRoom() { if (S.unsub) { S.unsub(); S.unsub = null; } }
async function onRoom(r) {
  const F = await fb();
  if (!r || r.kind !== 'duel') { S.room = null; $('#app').innerHTML = `<section class="home"><div><h2>Duel not found</h2><p class="lede">This duel link doesn’t exist anymore.</p><div class="row"><a class="cta" href="./">Back to the duel table</a></div></div></section>`; return; }
  if ((r.format || 'goat') !== S.format) await loadFormat(r.format || 'goat');
  const prev = S.room; S.room = r;
  r.chatList = Object.keys(r.chat || {}).sort().map(k => r.chat[k]);
  const seats = r.seats || {}; S.mySeat = seats[0] && seats[0].uid === F.uid ? 0 : seats[1] && seats[1].uid === F.uid ? 1 : -1;
  S.seatNames = [0, 1].map(s => seats[s] ? (s === S.mySeat ? `${seats[s].name} (you)` : seats[s].name) : 'Waiting…');
  if (S.mySeat < 0 && r.status !== 'lobby') { try { await F.set(F.ref(F.db, `rooms/${S.code}/watchers/${F.uid}`), myName()); F.onDisconnect(F.ref(F.db, `rooms/${S.code}/watchers/${F.uid}`)).remove(); } catch (_) {} }
  if (r.status === 'lobby') { renderLobby(r); return; }
  // playing: (re)build the engine when the game changes, then apply new responses in order
  const sig = `${r.gameNo}:${r.seed}:${r.first}`;
  if (!S.h || S.sig !== sig) {
    S.sig = sig; S.seatDecks = [0, 1].map(s => ({ main: seats[s].deck.main || [], extra: seats[s].deck.extra || [] }));
    $('#app').innerHTML = '<p class="loading">Shuffling up…</p>';
    await preload(S.seatDecks);
    S.seed = r.seed; S.first = r.first; S.handOrder = [[], []]; newEngine(); S.shuffleFx = true; S.keys = [];
    log(`${goesFirst(S.first)} (coin toss).`, 'turn');
    S.fx = [{ k: 'banner', text: goesFirst(S.first), e: engOf(S.first) }];
  }
  const keys = Object.keys(r.responses || {}).sort(); const list = keys.map(k => { const x = r.responses[k]; return { r: dec(x.r), e: x.e, a: x.a, s: x.r }; });
  const sameStart = S.keys.every((k, i) => keys[i] === k);
  if (!sameStart || keys.length < S.keys.length) { newEngine(); S.keys = keys; pump(list, false); }
  else if (keys.length > S.keys.length) { const fresh = list.slice(S.keys.length); const many = fresh.length > 3; S.keys = keys; pump(fresh, !many); }
  else if (!S.field) pump([], true);
  if (S.sending && S.applied.length > S.sending.n) S.sending = null;
  if (S.sending && keys.length === 0 && S.applied.length === 0) S.sending = null;
  if (r.result && !(prev && prev.result)) log(r.result.why === 'surrender' ? `${S.seatNames[1 - r.result.seat]} surrendered.` : '', 'win');
  if ((S.winner || r.result) && r.match) reportMatch(r);
  render();
}
function renderLobby(r) {
  const seats = r.seats || {}; const link = `${location.origin}${location.pathname}?room=${S.code}`;
  $('#status').innerHTML = `<span>Duel ${esc(S.code)}</span>`;
  if (S.mySeat === 0) {
    $('#app').innerHTML = `<section class="home"><div><h2>Invite a friend</h2><p class="lede">Send this link. When your friend opens it and picks a deck, the duel starts.</p>
      <div class="invite"><input class="text" readonly value="${esc(link)}" id="inviteLink"><button class="cta" type="button" data-act="copy-invite">Copy link</button></div>
      <p class="note">Your deck: ${esc((seats[0].deck || {}).name || 'ready')}. Waiting for someone to join…</p><div class="row"><button class="ghost" type="button" data-act="setup">Cancel</button></div></div></section>`;
    return;
  }
  const def = store.get('ygo-drafter:duel-ydk') ? 'drafted' : 0;
  $('#app').innerHTML = `<section class="home"><div><h2>${esc((seats[0] || {}).name || 'Someone')} invited you to a duel</h2><p class="lede">${esc(FORMATS[S.format].rules)}. Pick your deck to start.</p>
    ${deckField('deck0', 'Your deck', def)}<div class="row" style="margin-top:16px"><button class="cta" type="button" data-act="join-duel">Join the duel</button></div></div></section>`;
  bindDeckSelects();
}
async function joinDuel() {
  const d = pickedDeck('deck0'); if (!d) return; const F = await fb();
  const seed = (Math.random() * 2 ** 31) | 0;
  const res = await F.runTransaction(F.ref(F.db, `rooms/${S.code}`), cur => {
    if (!cur || cur.status !== 'lobby' || (cur.seats && cur.seats[1])) return undefined;
    cur.seats = cur.seats || {}; cur.seats[1] = { uid: F.uid, name: myName(), deck: { main: d.main, extra: d.extra, name: d.name || '' } };
    cur.status = 'playing'; cur.seed = seed; cur.first = seed % 2; return cur;
  });
  if (!res.committed) toast('Someone else joined first. You can still watch.');
}
async function rematch() {
  if (S.mode === 'solo') { startGame((Math.random() * 2 ** 31) | 0); return; }
  const F = await fb(); const r = S.room; const res = r && r.result; const wE = res ? engOf(res.seat) : S.winner ? S.winner.player : 0;
  const loserSeat = wE === 2 ? r.first : 1 - seatOf(wE);
  await F.update(rref(F), { responses: null, undo: null, result: null, seed: (Math.random() * 2 ** 31) | 0, first: loserSeat, gameNo: (r.gameNo || 1) + 1, status: 'playing' });
}
async function surrender() { if (!confirm('Surrender this game?')) return; const F = await fb(); await F.set(rref(F, '/result'), { seat: 1 - S.mySeat, why: 'surrender' }); }
async function sendChat(text) { const t = text.trim(); if (!t) return; const F = await fb(); await F.push(rref(F, '/chat'), { uid: F.uid, name: myName(), seat: S.mySeat, text: t.slice(0, 200), t: Date.now() }); }

/* ================= tournament matches ================= */
function hashCode(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
async function openMatch(spec) {
  const [draft, r, i] = spec.split('.'); const F = await fb();
  const room = (await F.get(F.ref(F.db, `rooms/${draft}`))).val(); const t = room && room.tour;
  const arr = x => Array.isArray(x) ? x : x ? Object.keys(x).sort((a, b) => a - b).map(k => x[k]) : [];
  const m = t && arr(arr(t.rounds)[+r] && arr(t.rounds)[+r].matches)[+i];
  if (!m || !m.b) { $('#app').innerHTML = '<p class="loading">That tournament match wasn’t found.</p>'; return; }
  const pool = room.game && room.game.settings && room.game.settings.pool; await loadFormat(pool === 'edison' ? 'edison' : 'goat');
  const pl = uid => t.players[uid] || {}; const deck = uid => parseYdk(pl(uid).ydk || '');
  let n = hashCode(`${t.id}:${r}:${i}`); let code = 'T'; for (let k = 0; k < 4; k++) { code += CODE_CHARS[n % CODE_CHARS.length]; n = Math.floor(n / CODE_CHARS.length); }
  const seed = (Math.random() * 2 ** 31) | 0;
  await F.runTransaction(F.ref(F.db, `rooms/${code}`), cur => cur ? undefined : { kind: 'duel', format: S.format, created: Date.now(), host: m.a, status: 'playing', gameNo: 1, seed, first: seed % 2,
    seats: { 0: { uid: m.a, name: pl(m.a).name || 'Player', deck: { ...deck(m.a), name: 'Tournament deck' } }, 1: { uid: m.b, name: pl(m.b).name || 'Player', deck: { ...deck(m.b), name: 'Tournament deck' } } },
    match: { draft, r: +r, i: +i, tid: t.id } });
  history.replaceState(null, '', `?room=${code}`);
  enterRoom(code);
}
async function reportMatch(r) {
  if (S.mySeat < 0) return; const F = await fb();
  const res = r.result; const wSeat = res ? res.seat : S.winner && S.winner.player !== 2 ? seatOf(S.winner.player) : -1; if (wSeat < 0) return;
  const flag = `reported/${r.gameNo || 1}`;
  const tx = await F.runTransaction(rref(F, '/' + flag), cur => cur ? undefined : true);
  if (!tx.committed) return;
  const uid = r.seats[wSeat].uid;
  await F.push(F.ref(F.db, `rooms/${r.match.draft}/tour/rounds/${r.match.r}/matches/${r.match.i}/games`), uid);
  log('Result sent to the tournament.', 'muted');
}

/* ================= events ================= */
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3200); }
document.addEventListener('click', async e => {
  const t = e.target;
  const r = t.closest('[data-r]'); if (r) { if (r.closest('#pop') && !popStillValid()) { closePop(); toast('The game moved on. Tap the card again.'); return; } answer(dec(r.dataset.r), r.closest('#pop') && S.pop ? S.pop.code : 0); return; }
  const a = t.closest('[data-act]')?.dataset.act;
  if (a) {
    if (a === 'start-solo') return startSolo();
    if (a === 'create-invite') return createInvite();
    if (a === 'join-duel') return joinDuel();
    if (a === 'tab-solo') return renderSetup('solo');
    if (a === 'tab-online') return renderSetup('online');
    if (a === 'undo') return undo();
    if (a === 'undo-yes') return answerUndo(true);
    if (a === 'undo-no') return answerUndo(false);
    if (a === 'rematch') return rematch();
    if (a === 'surrender') return surrender();
    if (a === 'setup') { history.replaceState(null, '', location.pathname); return renderSetup(); }
    if (a === 'leave') { if (S.mySeat >= 0 && !S.winner && !(S.room && S.room.result) && !confirm('Leave this duel? You can come back with the same link.')) return; history.replaceState(null, '', location.pathname); return renderSetup(); }
    if (a === 'closemenu') { S.menu = null; render(); return; }
    if (a === 'closepop') { closePop(); return; }
    if (a === 'reopen') { S.pickerClosed = false; openPicker(); return; }
    if (a === 'tab-log' || a === 'tab-chat') { S.tab = a.slice(4); render(); return; }
    if (a === 'copy-invite') { const v = $('#inviteLink').value; navigator.clipboard?.writeText(v).then(() => toast('Link copied.'), () => toast(v)); return; }
    if (a === 'copy-watch') { const v = `${location.origin}${location.pathname}?room=${S.code}`; navigator.clipboard?.writeText(v).then(() => toast('Spectator link copied.'), () => toast(v)); return; }
    if (a === 'close-viewer') { S.viewer = null; if (S.menu && S.menu.split(':')[1] !== '4' && S.menu.split(':')[1] !== '8' && S.menu.split(':')[1] !== '2') S.menu = null; closeModal('#viewer'); return; }
    if (a === 'close-info') { closeModal('#info'); return; }
  }
  const pi = t.closest('[data-pi]'); if (pi) { pickClick(+pi.dataset.pi); return; }
  const pk = t.closest('[data-pick]'); if (pk) { pickConfirm(pk.dataset.pick); return; }
  const vk = t.closest('[data-vkey]'); if (vk) { S.focusCode = +vk.dataset.code || S.focusCode; const acts = actionMap().get(vk.dataset.vkey); if (acts && acts.length) { S.menu = vk.dataset.vkey; S.menuSeq = S.promptSeq; S.menuCode = +vk.dataset.code || 0; openViewer(S.viewer.e, S.viewer.loc); } else { const d = $('#cdetail'); if (d) d.innerHTML = detailHTML(); } return; }
  const pl = t.closest('[data-pile]'); if (pl) { const [p, l] = pl.dataset.pile.split(':').map(Number); openViewer(p, l); return; }
  if (t.closest('#pop')) return;
  const dc = t.closest('#board .dcard'); if (dc) { if (dc.dataset.code) { S.focusCode = +dc.dataset.code; const d = $('#cdetail'); if (d) d.innerHTML = detailHTML(); } const acts = actionMap().get(dc.dataset.key); if (acts && acts.length) { S.pop = { key: dc.dataset.key, code: +dc.dataset.code || 0, seq: S.promptSeq, x: e.clientX || null, y: e.clientY || null }; renderPop(); } else closePop(); return; }
  if (S.pop) closePop();
  if (t.closest('.modal') && !t.closest('.sheet')) { if (t.closest('#viewer')) { S.viewer = null; closeModal('#viewer'); } if (t.closest('#info')) closeModal('#info'); }
});
document.addEventListener('submit', e => { const f = e.target.closest('[data-form="chat"]'); if (!f) return; e.preventDefault(); const i = $('#chatIn'); sendChat(i.value); i.value = ''; });
document.addEventListener('change', async e => { const n = e.target.name || ''; if (n === 'fmt') { await loadFormat(e.target.value); store.set('ygo-drafter:duel-format', S.format); const tab = $('[data-act="tab-online"][aria-selected="true"]') ? 'online' : 'solo'; renderSetup(tab); return; } if (n === 'poppos') { S.popPos = e.target.value; try { localStorage.setItem('ygo-duel-poppos', S.popPos); } catch (_) {} placePop(); toast(S.popPos === 'corner' ? 'Action menus open in the top-left corner.' : 'Action menus open just above the cursor.'); return; } if (n.startsWith('cm-')) { S.chainMode[+n.slice(3)] = e.target.value; toast(`Chain prompts: ${e.target.value === 'auto' ? 'Auto' : e.target.value === 'always' ? 'Always' : 'Never'}.`); } });
document.addEventListener('mouseover', e => { const dc = e.target.closest('.dcard,.pcard'); if (!dc || !dc.dataset.code) return; const code = +dc.dataset.code; if (S.focusCode !== code) { S.focusCode = code; const d = $('#cdetail'); if (d) d.innerHTML = detailHTML(); } });
document.addEventListener('contextmenu', e => { const dc = e.target.closest('.dcard,.pcard,[data-pile]'); if (!dc) return; e.preventDefault(); if (dc.dataset.pile) { const [p, l] = dc.dataset.pile.split(':').map(Number); openViewer(p, l); return; } if (dc.dataset.code) openInfo(dc.dataset.key, +dc.dataset.code); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closePop(); closeModal('#info'); if (!$('#viewer').hidden) { S.viewer = null; closeModal('#viewer'); } } });

/* drag and drop: reorder your hand, or drop a hand card on your field to see its options */
const DR = { el: null, ghost: null, sx: 0, sy: 0, ox: 0, oy: 0, started: false, timer: null, id: null, touch: false, swallow: false, hold: null };
function drCancel() { clearTimeout(DR.timer); clearTimeout(DR.hold); if (DR.ghost) DR.ghost.remove(); if (DR.el) DR.el.classList.remove('dragging'); document.querySelectorAll('.drop-on,.drop-before').forEach(x => x.classList.remove('drop-on', 'drop-before')); document.body.classList.remove('is-dragging'); Object.assign(DR, { el: null, ghost: null, started: false, id: null }); }
function drTarget(x, y) {
  const under = document.elementFromPoint(x, y); if (!under || !DR.el) return {}; const e = DR.el.dataset.key.split(':')[0];
  const hand = under.closest('[data-hand]'); if (hand && hand.dataset.hand === e) { const b = under.closest('.dcard'); return { hand, before: b && b !== DR.el ? b : null }; }
  const side = under.closest('.side'); if (side && side.dataset.e === e) return { field: side };
  return {};
}
function drStart(x, y) { const r = DR.el.getBoundingClientRect(); DR.ox = x - r.left; DR.oy = y - r.top; const g = DR.el.cloneNode(true); g.classList.add('drag-ghost'); g.style.width = r.width + 'px'; document.body.appendChild(g); DR.ghost = g; DR.started = true; DR.el.classList.add('dragging'); document.body.classList.add('is-dragging'); drMove(x, y); }
function drMove(x, y) { DR.ghost.style.transform = `translate(${x - DR.ox}px, ${y - DR.oy}px) rotate(4deg) scale(1.08)`; document.querySelectorAll('.drop-on,.drop-before').forEach(el => el.classList.remove('drop-on', 'drop-before')); const t = drTarget(x, y); if (t.hand) t.hand.classList.add('drop-on'); if (t.before) t.before.classList.add('drop-before'); if (t.field) t.field.classList.add('drop-on'); }
function drFinish(x, y) {
  const t = drTarget(x, y); const el = DR.el; const key = el.dataset.key; const e = +key.split(':')[0]; const code = +el.dataset.code || 0; const seq = DR.seq;
  drCancel(); DR.swallow = true; setTimeout(() => { DR.swallow = false; }, 60);
  if (t.hand) { const cards = [...t.hand.querySelectorAll('.dcard')].filter(c => c !== el); const at = t.before ? cards.indexOf(t.before) : cards.length; cards.splice(at < 0 ? cards.length : at, 0, el); S.handOrder[e] = cards.map(c => { const [p, l, s] = c.dataset.key.split(':').map(Number); return S.field[p].hand[s].code; }); render(); }
  else if (t.field) { const c = cardAt(key); if (seq !== S.promptSeq || !c || (code && c.code !== code)) { toast('The game moved on. Drag the card again.'); return; } const acts = actionMap().get(key); if (el.dataset.code) S.focusCode = +el.dataset.code; if (acts && acts.length) { S.pop = { key, code, seq, x, y }; renderPop(); } else toast('That card can’t be played right now.'); }
}
document.addEventListener('pointerdown', e => {
  if (e.button > 0) return; const c = e.target.closest('[data-hand] .dcard'); if (!c || !S.h) return;
  drCancel(); Object.assign(DR, { el: c, sx: e.clientX, sy: e.clientY, id: e.pointerId, touch: e.pointerType !== 'mouse', started: false, seq: S.promptSeq });
  if (DR.touch) { DR.timer = setTimeout(() => { if (DR.el) drStart(DR.sx, DR.sy); }, 300); }
});
document.addEventListener('pointermove', e => { if (!DR.el || e.pointerId !== DR.id) return; if (!DR.started) { const d = Math.hypot(e.clientX - DR.sx, e.clientY - DR.sy); if (DR.touch) { if (d > 10) drCancel(); return; } if (d < 6) return; drStart(e.clientX, e.clientY); } drMove(e.clientX, e.clientY); });
document.addEventListener('pointerup', e => { if (!DR.el || e.pointerId !== DR.id) return; if (DR.started) drFinish(e.clientX, e.clientY); else drCancel(); });
document.addEventListener('pointercancel', () => { if (DR.el && !DR.started) drCancel(); });
document.addEventListener('touchmove', e => { if (DR.started) e.preventDefault(); }, { passive: false });
document.addEventListener('click', e => { if (DR.swallow) { e.stopPropagation(); e.preventDefault(); DR.swallow = false; } }, true);
/* long-press any card on a touch screen to read it (the right-click of phones) */
let lp = null;
document.addEventListener('touchstart', e => { const dc = e.target.closest('.dcard,.pcard'); if (!dc || !dc.dataset.code || dc.closest('[data-hand]')) return; clearTimeout(lp); lp = setTimeout(() => openInfo(dc.dataset.key, +dc.dataset.code), 550); }, { passive: true });
['touchend', 'touchmove', 'touchcancel'].forEach(n => document.addEventListener(n, () => clearTimeout(lp), { passive: true }));
// a card picture that fails to load (tokens have none) shows the card's name instead
document.addEventListener('error', e => { const img = e.target; if (img && img.tagName === 'IMG' && img.dataset && img.dataset.alt !== undefined && img.isConnected) { const s = document.createElement('span'); s.className = 'tname'; s.textContent = img.dataset.alt; img.replaceWith(s); } }, true);

/* ---------- zoom: − / Fit / + (Fit scales the page to fill the window height) ---------- */
const ZOOM_KEY = `ygo-zoom:${location.pathname}`;
function applyZoom(z, mode) {
  z = Math.max(.6, Math.min(1.8, Math.round(z * 100) / 100));
  document.documentElement.style.setProperty('--zoom', z);
  try { localStorage.setItem(ZOOM_KEY, JSON.stringify({ z, mode: mode || 'manual' })); } catch (_) {}
  const o = document.getElementById('zoomVal'); if (o) o.textContent = `${Math.round(z * 100)}%`;
  const f = document.querySelector('[data-zoom="fit"]'); if (f) f.setAttribute('aria-pressed', mode === 'fit' ? 'true' : 'false');
}
const zoomNow = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--zoom')) || 1;
function fitZoom() {
  const app = document.getElementById('app'); const first = app && app.firstElementChild; if (!first) return;
  for (let k = 0; k < 3; k++) {                    // measure, apply, re-measure (the layout reflows at each size)
    const bar = document.querySelector('.bar'); const top = bar ? bar.getBoundingClientRect().height : 0;
    const h = first.getBoundingClientRect().height; if (!h) return;
    const avail = window.innerHeight - top - 28;
    applyZoom(zoomNow() * avail / h, 'fit');
  }
}
(function initZoom() {
  let saved = null; try { saved = JSON.parse(localStorage.getItem(ZOOM_KEY) || 'null'); } catch (_) {}
  if (saved && saved.z) applyZoom(saved.z, saved.mode); else applyZoom(1, 'manual');
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-zoom]'); if (!b) return;
    const d = b.dataset.zoom; if (d === 'fit') fitZoom(); else applyZoom(zoomNow() + (d === '+' ? .1 : -.1), 'manual');
  });
  let t = 0; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { try { if ((JSON.parse(localStorage.getItem(ZOOM_KEY) || '{}')).mode === 'fit') fitZoom(); } catch (_) {} }, 250); });
})();

boot();
