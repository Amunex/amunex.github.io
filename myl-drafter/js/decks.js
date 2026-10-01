import { DB, card, norm, T, edition } from './data.js';

const LS = 'myl.decks.v1';
const LS_SEL = 'myl.deck.sel';

export function loadDecks() {
  try { const v = JSON.parse(localStorage.getItem(LS)); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function saveDecks(list) {
  try { localStorage.setItem(LS, JSON.stringify(list)); return true; } catch { return false; }
}
export function getSelectedId() { try { return localStorage.getItem(LS_SEL) || ''; } catch { return ''; } }
export function setSelectedId(id) { try { localStorage.setItem(LS_SEL, id); } catch { /* storage off */ } }

export const uid = () => Math.random().toString(36).slice(2, 10);
export const deckSize = d => Object.values(d.cards || {}).reduce((a, b) => a + b, 0);

export function newDeck(name = 'Mazo nuevo', cards = {}) {
  return { id: uid(), name, cards: { ...cards }, updated: Date.now() };
}

export function upsertDeck(deck) {
  const list = loadDecks();
  const i = list.findIndex(d => d.id === deck.id);
  deck.updated = Date.now();
  if (i >= 0) list[i] = deck; else list.unshift(deck);
  saveDecks(list);
  return deck;
}
export function removeDeck(id) { saveDecks(loadDecks().filter(d => d.id !== id)); }

// ---- share codes: MYL1.<ed>.<num>x<n>_<ed>.<num>  (URL safe, readable)
export function encodeDeck(cards) {
  const parts = Object.entries(cards).filter(([, n]) => n > 0).map(([k, n]) => k.replace('/', '.') + (n > 1 ? 'x' + n : ''));
  return 'MYL1.' + parts.join('_');
}
export function decodeDeck(code) {
  const s = (code || '').trim();
  const m = s.match(/MYL1\.([0-9._x]+)/);
  if (!m) return null;
  const cards = {};
  for (const p of m[1].split('_')) {
    const mm = p.match(/^(\d+)\.(\d+)(?:x(\d+))?$/);
    if (!mm) continue;
    const k = `${mm[1]}/${mm[2]}`;
    cards[k] = (cards[k] || 0) + (mm[3] ? +mm[3] : 1);
  }
  return Object.keys(cards).length ? cards : null;
}

export function deckToText(d) {
  const lines = [];
  for (const [k, n] of sortedEntries(d.cards)) {
    const c = card(k); const e = edition(c);
    lines.push(`${n} ${c.name} (${e ? e.title : '?'}) [${k}]`);
  }
  return lines.join('\n');
}

// accepts a code, or lines like "3 Rey Arturo Pendragón (Espada Sagrada)", "3x Nombre", "Nombre x3", "[19/001]"
export function parseDeckInput(text) {
  const fromCode = decodeDeck(text);
  if (fromCode) return { cards: fromCode, missing: [] };
  const cards = {}; const missing = [];
  const byName = new Map();
  for (const c of DB.cards) { if (!byName.has(c.nn)) byName.set(c.nn, []); byName.get(c.nn).push(c); }
  for (let raw of (text || '').split(/\r?\n/)) {
    raw = raw.trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('//')) continue;
    let n = 1;
    let m = raw.match(/^(\d+)\s*x?\s+(.+)$/i);
    if (m) { n = +m[1]; raw = m[2]; } else if ((m = raw.match(/^(.+?)\s+x\s*(\d+)$/i))) { n = +m[2]; raw = m[1]; }
    const km = raw.match(/\[(\d+\/\d+)\]/);
    if (km && DB.byKey.has(km[1])) { cards[km[1]] = (cards[km[1]] || 0) + n; continue; }
    let edHint = '';
    const em = raw.match(/\(([^)]+)\)\s*$/);
    if (em) { edHint = norm(em[1]); raw = raw.slice(0, em.index).trim(); }
    const opts = byName.get(norm(raw));
    if (!opts) { missing.push(raw); continue; }
    const pick = (edHint && opts.find(c => norm(edition(c)?.title || '') === edHint)) || opts[0];
    cards[pick.key] = (cards[pick.key] || 0) + n;
  }
  return { cards, missing };
}

const TYPE_ORDER = [T.ALIADO, T.TALISMAN, T.TOTEM, T.ARMA, T.MONUMENTO, T.ORO];
export function sortedEntries(cards) {
  return Object.entries(cards).filter(([, n]) => n > 0).sort(([a], [b]) => {
    const A = card(a), B = card(b);
    return (TYPE_ORDER.indexOf(A.type) - TYPE_ORDER.indexOf(B.type)) || (A.cost - B.cost) || A.name.localeCompare(B.name, 'es');
  });
}

export function deckKeys(cards) {
  const out = [];
  for (const [k, n] of Object.entries(cards || {})) for (let i = 0; i < n; i++) out.push(k);
  return out;
}

const rnd = n => Math.floor(Math.random() * n);
// Random 50-card deck from a pool of editions (or a block). Good for quick tests.
export function randomDeck({ edIds = null, block = '', size = 50, golds = 16 } = {}) {
  let pool = DB.cards;
  if (edIds && edIds.length) { const s = new Set(edIds); pool = pool.filter(c => s.has(c.ed)); }
  else if (block) { const s = new Set(DB.editions.filter(e => e.block === block).map(e => e.id)); pool = pool.filter(c => s.has(c.ed)); }
  const by = t => pool.filter(c => c.type === t);
  let oros = by(T.ORO);
  if (!oros.length) oros = DB.cards.filter(c => c.type === T.ORO);
  const plainOros = oros.filter(c => !c.text);
  const allies = by(T.ALIADO);
  const support = pool.filter(c => [T.TALISMAN, T.TOTEM, T.ARMA, T.MONUMENTO].includes(c.type));
  const cards = {};
  const add = (c, max = 3) => { if ((cards[c.key] || 0) >= max) return false; cards[c.key] = (cards[c.key] || 0) + 1; return true; };
  for (let i = 0; i < golds; i++) add(plainOros.length && i < golds - 4 ? plainOros[rnd(plainOros.length)] : oros[rnd(oros.length)], 99);
  const nAllies = Math.min(allies.length * 3, Math.round((size - golds) * .58));
  let guard = 0;
  while (deckSize({ cards }) < golds + nAllies && guard++ < 4000) allies.length && add(allies[rnd(allies.length)]);
  const rest = support.length ? support : allies;
  guard = 0;
  while (deckSize({ cards }) < size && guard++ < 4000) rest.length && add(rest[rnd(rest.length)]);
  return cards;
}
