import { card, T } from './data.js';

export const ZONES = ['castillo', 'mano', 'defensa', 'ataque', 'apoyo', 'reserva', 'pagado', 'cementerio', 'destierro', 'armas'];
export const ZN = {
  castillo: 'Castillo', mano: 'Mano', defensa: 'Línea de defensa', ataque: 'Línea de ataque', apoyo: 'Línea de apoyo',
  reserva: 'Reserva de oro', pagado: 'Oro pagado', cementerio: 'Cementerio', destierro: 'Destierro', armas: 'Equipada',
};
// "a la línea de defensa", "al cementerio"…
export const ZTO = {
  castillo: 'al castillo', mano: 'a la mano', defensa: 'a la línea de defensa', ataque: 'a la línea de ataque', apoyo: 'a la línea de apoyo',
  reserva: 'a la reserva de oro', pagado: 'al oro pagado', cementerio: 'al cementerio', destierro: 'al destierro', armas: 'equipada',
};
export const LINES = ['defensa', 'ataque', 'apoyo'];
export const IN_PLAY = new Set(['defensa', 'ataque', 'apoyo', 'reserva', 'pagado', 'armas']);
export const PUBLIC = new Set(['defensa', 'ataque', 'apoyo', 'reserva', 'pagado', 'cementerio', 'destierro', 'armas']);
export const PHASES = ['Agrupación', 'Vigilia', 'Batalla', 'Final', 'Robar'];
export const PH = { AGRUP: 0, VIGILIA: 1, BATALLA: 2, FINAL: 3, ROBAR: 4 };
export const other = seat => (seat === 'p1' ? 'p2' : 'p1');

export function emptySide() {
  const z = {}; for (const k of ZONES) z[k] = [];
  return { name: '', deck: '', z, c: {}, g: 0, st: '', au: '', seq: 0 };
}

// Realtime Database drops empty arrays and can return arrays as objects; normalise.
export function fixSide(s) {
  const out = emptySide();
  if (!s) return out;
  Object.assign(out, { name: s.name || '', deck: s.deck || '', g: s.g || 0, st: s.st || '', au: s.au || '', seq: s.seq || 0, mull: s.mull || 0 });
  for (const k of ZONES) {
    const v = s.z && s.z[k];
    out.z[k] = Array.isArray(v) ? v.filter(Boolean) : v ? Object.keys(v).sort((a, b) => a - b).map(i => v[i]).filter(Boolean) : [];
  }
  out.c = s.c ? { ...s.c } : {};
  for (const id of Object.keys(out.c)) out.c[id] = { ...out.c[id] };
  return out;
}
export const clone = s => (typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s)));

export function zoneOf(side, iid) {
  for (const k of ZONES) if (side.z[k].includes(iid)) return k;
  return null;
}
export const attachedTo = (side, host) => side.z.armas.filter(w => side.c[w] && side.c[w].at === host);

export function rngInt(n) {
  if (n <= 1) return 0;
  const a = new Uint32Array(1);
  const lim = Math.floor(0x100000000 / n) * n;
  do { crypto.getRandomValues(a); } while (a[0] >= lim);
  return a[0] % n;
}
export function shuffleArr(arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = rngInt(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

export function buildSide(seat, name, deckName, keys, game) {
  const s = emptySide();
  const L = seat === 'p1' ? 'A' : 'B';
  s.name = name; s.deck = deckName; s.g = game || 1; s.st = 'setup';
  keys.forEach((k, i) => { const id = L + i; s.c[id] = { k }; s.z.castillo.push(id); });
  return s;
}

export function strength(side, iid) {
  const inst = side.c[iid]; if (!inst) return 0;
  const c = card(inst.k);
  return Math.max(0, c.str > 0 ? c.str : 0) + (inst.x || 0);
}

// Core move. Returns the zone the card came from (or null).
export function move(side, iid, to, opt = {}) {
  const from = zoneOf(side, iid);
  if (!from || !side.c[iid]) return null;
  const src = side.z[from];
  src.splice(src.indexOf(iid), 1);
  const inst = side.c[iid];
  const dest = side.z[to];
  if (to === 'castillo') { if (opt.bottom) dest.push(iid); else dest.unshift(iid); }
  else if (opt.index == null || opt.index >= dest.length) dest.push(iid);
  else dest.splice(Math.max(0, opt.index), 0, iid);

  if (to !== 'armas') delete inst.at;
  if (to !== 'defensa') delete inst.bl;
  if (from === 'mano' || to !== 'mano') delete inst.rv;
  if (!IN_PLAY.has(to)) { delete inst.fd; delete inst.r; delete inst.x; delete inst.nw; }
  if (opt.fd != null) { if (opt.fd) inst.fd = 1; else delete inst.fd; }
  const c = card(inst.k);
  if (to === 'defensa' && c.type === T.ALIADO && !IN_PLAY.has(from)) inst.nw = 1;
  if (to === 'reserva' || to === 'pagado') delete inst.nw;

  // weapons travel with their ally between lines; leaving play drops them in the cementerio
  if (from !== to && side.c[iid]) {
    const att = attachedTo(side, iid);
    if (att.length && !LINES.includes(to)) for (const w of att) move(side, w, 'cementerio');
  }
  return from;
}

export function attach(side, iid, host) {
  if (iid === host) return null;
  const from = move(side, iid, 'armas');
  if (!from) return null;
  side.c[iid].at = host;
  delete side.c[iid].fd;
  return from;
}

export function drawN(side, n) {
  let k = 0;
  for (; k < n && side.z.castillo.length; k++) move(side, side.z.castillo[0], 'mano');
  return k;
}
export function millN(side, n, to = 'cementerio') {
  let k = 0;
  for (; k < n && side.z.castillo.length; k++) move(side, side.z.castillo[0], to);
  return k;
}
export function shuffleCastle(side) { shuffleArr(side.z.castillo); }

// Fase de agrupación: oro pagado vuelve a la reserva, la línea de ataque vuelve a defensa.
export function agrupar(side) {
  let gold = 0, back = 0;
  for (const id of [...side.z.pagado]) { move(side, id, 'reserva'); gold++; }
  for (const id of [...side.z.ataque]) { move(side, id, 'defensa'); back++; }
  for (const id of Object.keys(side.c)) delete side.c[id].nw;
  return { gold, back };
}

// Pay n gold: plain golds first, newest-in-reserve last.
export function payGold(side, n) {
  const order = [...side.z.reserva].sort((a, b) => (card(side.c[a].k).text ? 1 : 0) - (card(side.c[b].k).text ? 1 : 0));
  let k = 0;
  for (const id of order) { if (k >= n) break; move(side, id, 'pagado'); k++; }
  return k;
}

// Initial setup: optional oro inicial into the reserve, shuffle, draw the opening hand.
export function setupSide(side, { oroInicial = null, hand = 8 } = {}) {
  if (oroInicial && side.z.castillo.includes(oroInicial)) move(side, oroInicial, 'reserva');
  shuffleCastle(side);
  drawN(side, hand);
  side.st = 'mull';
  side.mull = 0;
}
export function mulligan(side) {
  const n = side.z.mano.length;
  for (const id of [...side.z.mano]) move(side, id, 'castillo', { bottom: true });
  shuffleCastle(side);
  const k = Math.max(0, n - 1);
  drawN(side, k);
  side.mull = (side.mull || 0) + 1;
  return k;
}

// Pick a sensible oro inicial: one that says "Oro Inicial", else a gold without text, else any gold.
export function suggestOroInicial(side) {
  const golds = side.z.castillo.filter(id => card(side.c[id].k).type === T.ORO);
  const by = f => golds.find(id => f(card(side.c[id].k)));
  return by(c => /oro inicial/i.test(c.text)) || by(c => !c.text) || golds[0] || null;
}

// Battle math from the manual: unblocked attackers hit the castle; blocked ones compare strength.
export function computeBattle(att, def, mods = {}) {
  const val = (side, id) => strength(side, id) + (mods[id] || 0);
  const pairs = att.z.ataque.filter(id => att.c[id]).map(a => {
    const blockers = def.z.defensa.filter(b => def.c[b] && def.c[b].bl === a);
    const sa = val(att, a);
    const sb = blockers.reduce((s, b) => s + val(def, b), 0);
    let dmg = 0; let aDead = false; let bDead = false;
    if (!blockers.length) dmg = sa;
    else if (sa > sb) { bDead = true; dmg = sa - sb; }
    else if (sa === sb) { aDead = true; bDead = true; }
    else aDead = true;
    return { a, blockers, sa, sb, dmg, aDead, bDead };
  });
  return { pairs, dmg: pairs.reduce((s, p) => s + p.dmg, 0) };
}

export function handLimitExceeded(side) { return side.z.mano.length > 8; }
