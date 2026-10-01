// Draft engine shared by practice and online rooms (same model as YGO Drafter):
// era card pools, booster packs, racial deck stacks, picks, bots and pick-and-pass.
import { DB, T } from './data.js';
import { PACK_ART } from './packs.js';

// Eras = the official blocks. Each era drafts only from its own booster sets.
export const ERAS = [
  { key: 'pe', code: 'PE', name: 'Primera Era', big: 'PRIMERA ERA' },
  { key: 'pb', code: 'PB', name: 'Primer Bloque', big: 'PRIMER BLOQUE' },
  { key: '2b', code: '2B', name: 'Segundo Bloque', big: 'SEGUNDO BLOQUE' },
  { key: 'bf', code: 'BF', name: 'Bloque Furia', big: 'FURIA' },
  { key: 'fx', code: 'FX', name: 'Furia Extendido', big: 'FURIA EXTENDIDO' },
  { key: 'imp', code: 'IMP', name: 'Imperio', big: 'IMPERIO' },
];
export const eraOf = key => ERAS.find(e => e.key === key) || ERAS[1];
// settings.eras is a list (Firebase may hand it back as an object); old rooms had a single settings.era
export function erasOf(st) {
  const raw = st && st.eras != null ? (Array.isArray(st.eras) ? st.eras : Object.values(st.eras)) : [st && st.era];
  const keys = ERAS.map(e => e.key).filter(k => raw.includes(k));
  return keys.length ? keys : ['pb'];
}
export const erasLabel = eras => { const n = erasOf({ eras }).map(k => eraOf(k).name); return n.length > 3 ? `${n.length} eras` : n.join(' + '); };

// Pack tiers: 0 vasallo, 1 cortesano, 2 real, 3 mega/ultra real, 4 legendaria, milenaria, secreta, set paralelo
export const TIER_NAMES = ['Vasallo', 'Cortesano', 'Real', 'Ultra Real', 'Legendaria'];
const TIER_OF = { 6: 0, 5: 1, 4: 2, 3: 3, 2: 3, 1: 4, 8: 4, 9: 4, 11: 4, 7: 0 };
export const tierOf = c => TIER_OF[c.rarity] ?? 0;
// promos, tokens and unnumbered prints are never in packs
const packable = c => c.rarity !== 0 && c.rarity !== 10 && c.rarity !== -1;

export const PACK_SIZE = 11;
export const STACK = 20;
export const MAX_SEATS = 8;
export const MAX_COPIES = 3;
export const DEFAULTS = { eras: ['pb'], mode: 'booster', contents: 'sets', bonus: 'on', bots: 3, packs: 4, atOnce: 1, perPick: 1, odds: 'booster', tour: 'rr', bestOf: 1 };
export const keyOf = e => String(e).split('~')[0];

const rnd = n => (Math.random() * n) | 0;
export function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ------------------------------------------------------------------ era pools
const POOLS = new Map();
function bucket(list) {
  const b = { t: [[], [], [], [], []], g: [], size: list.length };
  for (const c of list) (c.type === T.ORO ? b.g : b.t[tierOf(c)]).push(c);
  return b;
}
export const eraPool = key => poolFor([key]);
export function poolFor(erasIn) {
  const eras = erasOf({ eras: erasIn });
  const key = eras.join('+');
  if (POOLS.has(key)) return POOLS.get(key);
  const era = eraOf(eras[0]);
  const codes = new Map(eras.map(k => [eraOf(k).code, k]));
  const eds = DB.editions.filter(e => codes.has(e.block));
  const by = new Map(eds.map(e => [e.id, []]));
  for (const c of DB.cards) { const l = by.get(c.ed); if (l && packable(c)) l.push(c); }
  const sets = [];
  for (const e of eds) {
    const list = by.get(e.id);
    const b = bucket(list);
    // a real booster set: big enough, with vasallos and cortesanos (premium and racial products have neither)
    if (list.length >= 60 && b.t[0].length + b.t[1].length >= 20 && b.t[0].length + b.t[1].length + b.t[2].length >= 40) sets.push({ id: e.id, name: e.title, img: e.img || '', era: codes.get(e.block), art: PACK_ART[e.id] || 0, ...b });
  }
  const seen = new Set(), all = [];
  for (const s of sets) for (const c of [...s.t.flat(), ...s.g]) { if (seen.has(c.nn)) continue; seen.add(c.nn); all.push(c); }
  const whole = bucket(all);
  const plain = whole.g.filter(c => !c.text);
  const allies = new Map();
  for (const c of all) if (c.type === T.ALIADO && c.race > 0) allies.set(c.race, (allies.get(c.race) || 0) + 1);
  const races = [...allies].filter(([, n]) => n >= 14).map(([r]) => r);
  const dates = eds.map(e => e.date).filter(d => d && d > '2000');
  const pool = { era, eras, sets, whole, plainGolds: plain.length ? plain : whole.g, races, cards: all.length, from: dates.length ? dates.sort()[0].slice(0, 4) : '' };
  POOLS.set(key, pool);
  return pool;
}

// ------------------------------------------------------------------ packs
function rareSlot() { const x = Math.random(); if (x < 1 / 24) return 4; if (x < 1 / 24 + 1 / 7) return 3; return 2; }
function arenaSlot() {
  const w = [50, 30, 15, 5]; let x = Math.random() * 100;
  for (let i = 0; i < w.length; i++) { if (x < w[i]) return i === 3 && Math.random() < .25 ? 4 : i; x -= w[i]; }
  return 0;
}
function draw(src, t, used) {
  const order = [t]; for (let k = t - 1; k >= 0; k--) order.push(k); for (let k = t + 1; k < 5; k++) order.push(k);
  for (const k of order) { const opts = src.t[k].filter(c => !used.has(c.nn)); if (opts.length) { const c = opts[rnd(opts.length)]; used.add(c.nn); return c; } }
  return null;
}
function drawGold(src, pool, used) {
  for (const list of [src.g, pool.whole.g]) { const opts = list.filter(c => !used.has(c.nn)); if (opts.length) { const c = opts[rnd(opts.length)]; used.add(c.nn); return c; } }
  return draw(src, 0, used);
}
// Clásico: 6 vasallos, 3 cortesanos, 1 real (a veces mejor) y 1 oro. Arena: 10 cartas que tiran 50/30/15/5 y 1 oro.
function makePack(pool, src, odds, used) {
  const slots = odds === 'arena' ? Array.from({ length: PACK_SIZE - 1 }, arenaSlot).sort((a, b) => a - b) : [0, 0, 0, 0, 0, 0, 1, 1, 1, rareSlot()];
  const out = slots.map(t => draw(src, t, used));
  out.splice(out.length - 1, 0, drawGold(src, pool, used));
  return out.filter(Boolean).map(c => c.key);
}
function pickSets(pool, n) {
  const out = [], all = pool.sets.map((_, i) => i);
  for (let k = 0; k < n; k++) {
    const cand = all.filter(i => !out.includes(i)); const list = cand.length ? cand : all;
    let x = Math.random() * list.reduce((a, i) => a + pool.sets[i].size, 0), pick = list[0];
    for (const i of list) { x -= pool.sets[i].size; if (x < 0) { pick = i; break; } }
    out.push(pick);
  }
  return out;
}
function openBatch(g) {
  const pool = poolFor(g.settings.eras);
  const n = Math.max(1, Math.min(g.settings.atOnce, g.settings.packs - g.opened));
  if (g.settings.contents !== 'pool' && pool.sets.length) {
    g.opens = g.seats.map(() => pickSets(pool, n));
    g.packs = g.opens.map(idx => { const used = new Set(); let ids = []; idx.forEach(si => { ids = ids.concat(makePack(pool, pool.sets[si], g.settings.odds, used)); }); return ids; });
  } else {
    g.opens = g.seats.map(() => []);
    g.packs = g.seats.map(() => { const used = new Set(); let ids = []; for (let k = 0; k < n; k++) ids = ids.concat(makePack(pool, pool.whole, g.settings.odds, used)); return ids; });
  }
  g.opened += n; g.batch = n;
}

// ------------------------------------------------------------------ deck draft: one racial deck per seat
function eraDeck(pool, race) {
  const flat = pool.whole.t.flat();
  const allies = flat.filter(c => c.type === T.ALIADO && c.race === race);
  const support = flat.filter(c => [T.TALISMAN, T.ARMA, T.TOTEM, T.MONUMENTO].includes(c.type));
  const golds = pool.plainGolds.length ? pool.plainGolds : pool.whole.g;
  const out = [];
  const take = (list, n, max) => {
    const cnt = {}; let guard = 0;
    while (n > 0 && list.length && guard++ < 800) { const c = list[rnd(list.length)]; if ((cnt[c.key] || 0) >= max) continue; cnt[c.key] = (cnt[c.key] || 0) + 1; out.push(c.key); n--; }
  };
  take(allies, 20, 2); take(support, 14, 2); take(golds, 16, 4);
  return out;
}
function dealStacks(g) {
  const n = g.seats.length, rem = g.pile.length;
  if (rem >= n * STACK) g.packs = g.seats.map(() => g.pile.splice(0, STACK));
  else { const per = Math.floor(rem / n), extra = rem % n; g.packs = g.seats.map((_, i) => g.pile.splice(0, per + (i < extra ? 1 : 0))); }
  g.batch = 1;
}
export const deckRounds = g => Math.max(1, Math.ceil((g.totalCards || 0) / (g.seats.length * STACK)));
export const roundsOf = st => Math.ceil(st.packs / (st.atOnce || 1));

// ------------------------------------------------------------------ game state
const toArr = x => Array.isArray(x) ? x.filter(v => v !== null && v !== undefined)
  : (x && typeof x === 'object' ? Object.keys(x).sort((a, b) => a - b).map(k => x[k]).filter(v => v != null) : []);
// Firebase drops empty arrays and turns sparse ones into objects; put the shape back.
export function norm(g) {
  if (!g) return g;
  const seats = toArr(g.seats); const n = seats.length;
  g.seats = seats.map((s, i) => ({ uid: s.uid || '', name: s.name || `Asiento ${i + 1}`, bot: !!s.bot }));
  const Pk = g.packs || {}, K = g.picks || {}, D = g.done || {}, O = g.opens || {};
  g.packs = Array.from({ length: n }, (_, i) => toArr(Pk[i]).map(String));
  g.opens = Array.from({ length: n }, (_, i) => toArr(O[i]).map(Number));
  g.picks = Array.from({ length: n }, (_, i) => toArr(K[i]).map(String));
  g.done = Array.from({ length: n }, (_, i) => !!D[i]);
  g.pile = toArr(g.pile).map(String);
  g.decksUsed = toArr(g.decksUsed);
  g.round = g.round || 0; g.turn = g.turn || 0; g.finished = !!g.finished;
  g.settings = Object.assign({}, DEFAULTS, g.settings || {});
  g.settings.eras = erasOf(g.settings);
  if (g.opened == null) g.opened = Math.min(g.settings.packs, (g.round + 1) * g.settings.atOnce);
  g.batch = g.batch || 1;
  return g;
}

export function newGame(settings, humans) {
  const st = Object.assign({}, DEFAULTS, settings || {});
  st.eras = erasOf(settings || {});
  const bots = Math.max(0, Math.min(MAX_SEATS - humans.length, typeof st.bots === 'number' ? st.bots : 3));
  let b = 0;
  const seats = shuffle(Array.from({ length: humans.length + bots }, (_, i) => i < humans.length
    ? { uid: humans[i].uid, name: humans[i].name, bot: false } : { uid: '', name: `Bot ${++b}`, bot: true }));
  const g = {
    id: Math.random().toString(36).slice(2, 10), seats, round: 0, turn: 0, opened: 0, finished: false,
    settings: { eras: st.eras, mode: 'booster', contents: st.contents === 'pool' ? 'pool' : 'sets', packs: Math.max(1, Math.min(10, st.packs | 0 || 4)), atOnce: st.atOnce === 2 ? 2 : 1, odds: st.odds === 'arena' ? 'arena' : 'booster', perPick: st.perPick === 2 ? 2 : 1, bonus: st.bonus === 'off' ? 'off' : 'on' },
  };
  const pool = poolFor(st.eras);
  if (st.mode === 'deck' && pool.races.length) {
    const races = shuffle(pool.races.slice());
    const used = seats.map((_, k) => races[k % races.length]);
    let serial = 0; const pile = [];
    used.forEach(r => eraDeck(pool, r).forEach(k => pile.push(`${k}~${serial++}`)));
    g.bonusPacks = 0;
    if (st.bonus !== 'off') {
      g.bonusPacks = Math.ceil(seats.length / 2);
      shuffle([...pool.whole.t[2], ...pool.whole.t[3], ...pool.whole.t[4]]).slice(0, g.bonusPacks * 10).forEach(c => pile.push(`${c.key}~${serial++}`));
    }
    g.settings.mode = 'deck'; g.pile = shuffle(pile); g.totalCards = pile.length; g.decksUsed = used.map(r => DB.races[r] || 'Mazo');
    dealStacks(g);
  } else openBatch(g);
  g.picks = seats.map(() => []); g.done = seats.map(() => false);
  botsPick(g); advance(g);
  return g;
}

export const need = (g, i) => Math.min(g.settings.perPick, g.packs[i].length);
export function applyPick(g, i, ids) {
  if (g.finished || g.done[i] || !g.seats[i]) return false;
  const pack = g.packs[i];
  if (ids.length !== need(g, i) || new Set(ids).size !== ids.length || !ids.every(id => pack.includes(id))) return false;
  ids.forEach(id => { pack.splice(pack.indexOf(id), 1); g.picks[i].push(keyOf(id)); });
  g.done[i] = true; return true;
}
// Bots like rarity and efficient allies, and leave golds for later.
function botChoose(g, pack, picks) {
  let best = null, bs = -1e9;
  for (const e of pack) {
    const c = DB.byKey.get(keyOf(e)); if (!c) continue;
    let s = tierOf(c) * .55 + Math.random() * .9;
    if (c.type === T.ORO) s -= 1.1;
    else if (c.type === T.ALIADO) s += .35 + Math.max(-.5, Math.min(.6, ((c.str > 0 ? c.str : 0) - (c.cost > 0 ? c.cost : 0)) * .2));
    else s += .15;
    if (picks.reduce((n, k) => n + (DB.byKey.get(k)?.nn === c.nn), 0) >= MAX_COPIES) s -= 3;
    if (s > bs) { bs = s; best = e; }
  }
  return best ?? pack[0];
}
export function botsPick(g) {
  g.seats.forEach((s, i) => {
    if (!s.bot || g.done[i]) return;
    const n = need(g, i);
    for (let k = 0; k < n; k++) { const e = botChoose(g, g.packs[i], g.picks[i]); g.packs[i].splice(g.packs[i].indexOf(e), 1); g.picks[i].push(keyOf(e)); }
    g.done[i] = true;
  });
}
export function advance(g) {
  let guard = 0;
  while (!g.finished && g.done.every(Boolean) && guard++ < 600) {
    if (g.packs.every(p => p.length === 0)) {
      if (g.settings.mode === 'deck') { if (!g.pile.length) { g.finished = true; break; } g.round++; g.turn = 0; dealStacks(g); }
      else { if (g.opened >= g.settings.packs) { g.finished = true; break; } g.round++; g.turn = 0; openBatch(g); }
    } else {
      const n = g.seats.length, d = g.round % 2 === 0 ? 1 : -1, next = new Array(n);
      for (let i = 0; i < n; i++) next[(i + d + n) % n] = g.packs[i];
      g.packs = next; g.turn++;
    }
    g.done = g.seats.map((s, i) => g.packs[i].length === 0);
    botsPick(g);
  }
}
