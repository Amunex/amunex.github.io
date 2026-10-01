// Small tournaments for the players of a draft: pairings, match scores and standings.
// Pure functions over a plain object that lives in the draft room (rooms/myl-XXXXX/tour).
export const FORMATS = { rr: 'Todos contra todos', swiss: 'Suizo', se: 'Eliminación directa' };

const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const toArr = x => Array.isArray(x) ? x.filter(v => v != null)
  : (x && typeof x === 'object' ? Object.keys(x).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map(k => x[k]).filter(v => v != null) : []);
const numArr = x => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.keys(x).sort((a, b) => a - b).map(k => x[k]) : []);

// Firebase turns arrays into objects and drops nulls and empty lists; put the shape back.
export function normTour(t) {
  if (!t) return null;
  t.order = numArr(t.order).filter(Boolean);
  t.players = t.players || {};
  t.rounds = numArr(t.rounds).map(r => ({ matches: numArr(r && r.matches).map(m => ({ a: m.a, b: m.b || null, table: m.table || null, games: m.games || {} })) }));
  t.round = t.round || 0; t.done = !!t.done; t.bestOf = t.bestOf === 3 ? 3 : 1;
  t.total = t.total || totalRounds(t.format, t.order.length);
  return t;
}

export function totalRounds(format, n) {
  if (format === 'rr') return Math.max(1, n % 2 ? n : n - 1);
  if (format === 'se') return Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));
  return Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));
}

function roundRobin(uids) {
  const list = uids.slice(); if (list.length % 2) list.push(null);
  const n = list.length, rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const matches = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i], b = list[n - 1 - i];
      if (a == null && b == null) continue;
      matches.push(a == null ? { a: b, b: null } : { a, b });
    }
    // byes last, so the real games are on top
    matches.sort((x, y) => (x.b ? 0 : 1) - (y.b ? 0 : 1));
    rounds.push({ matches });
    list.splice(1, 0, list.pop());
  }
  return rounds;
}

// standard bracket order so that the best seeds only meet late: 8 -> 1,8,4,5,2,7,3,6
function seedOrder(size) { let s = [1]; while (s.length < size) { const m = s.length * 2 + 1; s = s.flatMap(x => [x, m - x]); } return s; }
function bracketFirst(uids) {
  const size = 2 ** Math.ceil(Math.log2(Math.max(2, uids.length)));
  const ord = seedOrder(size); const matches = [];
  for (let k = 0; k < size / 2; k++) {
    const a = uids[ord[2 * k] - 1] ?? null, b = uids[ord[2 * k + 1] - 1] ?? null;
    if (a == null && b == null) continue;
    matches.push(a == null ? { a: b, b: null } : { a, b });
  }
  return { matches };
}

export function makeTour({ id, format, bestOf, players }) {
  const order = shuffle(players.map(p => p.uid));
  const t = {
    id, format: FORMATS[format] ? format : 'rr', bestOf: bestOf === 3 ? 3 : 1, created: Date.now(), round: 0, done: false,
    players: Object.fromEntries(players.map(p => [p.uid, { name: p.name, deck: p.deck || null }])), order,
  };
  t.total = totalRounds(t.format, order.length);
  if (t.format === 'rr') t.rounds = roundRobin(order);
  else if (t.format === 'se') t.rounds = [bracketFirst(order)];
  else t.rounds = [swissPairs(t, order)];
  return t;
}

export const need = t => (t.bestOf === 3 ? 2 : 1);
export function result(t, m) {
  const n = need(t);
  if (!m.b) return { done: true, winner: m.a, wa: n, wb: 0, bye: true };
  const g = toArr(m.games);
  const wa = g.filter(x => x === m.a).length, wb = g.filter(x => x === m.b).length;
  const winner = wa >= n ? m.a : wb >= n ? m.b : null;
  return { done: !!winner, winner, wa, wb, bye: false };
}
export const roundDone = (t, r = t.round) => !!t.rounds[r] && t.rounds[r].matches.every(m => result(t, m).done);

export function standings(t) {
  const P = {};
  for (const uid of t.order) P[uid] = { uid, name: (t.players[uid] && t.players[uid].name) || 'Jugador', mw: 0, ml: 0, gw: 0, gl: 0, pts: 0, opps: [], byes: 0, out: null };
  t.rounds.forEach((r, ri) => r.matches.forEach(m => {
    const res = result(t, m); if (!res.done || !P[m.a]) return;
    if (res.bye) { P[m.a].mw++; P[m.a].pts += 3; P[m.a].byes++; P[m.a].gw += res.wa; return; }
    if (!P[m.b]) return;
    P[m.a].opps.push(m.b); P[m.b].opps.push(m.a);
    P[m.a].gw += res.wa; P[m.a].gl += res.wb; P[m.b].gw += res.wb; P[m.b].gl += res.wa;
    const w = P[res.winner], l = P[res.winner === m.a ? m.b : m.a];
    w.mw++; w.pts += 3; l.ml++;
    if (t.format === 'se') l.out = ri;
  }));
  const mwp = p => Math.max(1 / 3, p.mw / Math.max(1, p.mw + p.ml));
  const list = Object.values(P);
  for (const p of list) p.omw = p.opps.length ? p.opps.reduce((a, o) => a + mwp(P[o]), 0) / p.opps.length : 0;
  const alive = p => (p.out == null ? 99 : p.out);
  list.sort((a, b) => (t.format === 'se' ? alive(b) - alive(a) : 0) || b.pts - a.pts || b.omw - a.omw || (b.gw - b.gl) - (a.gw - a.gl) || a.name.localeCompare(b.name, 'es'));
  return list;
}

function swissPairs(t, order) {
  const st = t.rounds && t.rounds.length ? standings(t) : order.map(uid => ({ uid, pts: 0, byes: 0 }));
  const ids = st.map(p => p.uid);
  const played = new Set();
  (t.rounds || []).forEach(r => r.matches.forEach(m => { if (m.b) { played.add(`${m.a}|${m.b}`); played.add(`${m.b}|${m.a}`); } }));
  const matches = [];
  let pool = ids.slice();
  if (pool.length % 2) {
    // bye for the lowest-ranked player who hasn't had one yet
    const byes = new Map(st.map(p => [p.uid, p.byes || 0]));
    let k = pool.length - 1; while (k > 0 && byes.get(pool[k]) > 0) k--;
    const [bye] = pool.splice(k, 1);
    matches.push({ a: bye, b: null });
  }
  // pair top-down by rank, backtracking so nobody meets the same opponent twice when that can be avoided
  const solve = list => {
    if (!list.length) return [];
    const [a, ...rest] = list;
    for (let j = 0; j < rest.length; j++) {
      if (played.has(`${a}|${rest[j]}`)) continue;
      const sub = solve(rest.filter((_, k) => k !== j));
      if (sub) return [{ a, b: rest[j] }, ...sub];
    }
    return null;
  };
  let pairs = pool.length <= 12 ? solve(pool) : null;
  if (!pairs) { pairs = []; for (let k = 0; k < pool.length; k += 2) pairs.push({ a: pool[k], b: pool[k + 1] }); }
  matches.unshift(...pairs);
  return { matches: matches.sort((x, y) => (x.b ? 0 : 1) - (y.b ? 0 : 1)) };
}

// Called when every match of the round has a winner. Returns false if there is nothing to do.
export function advance(t) {
  if (t.done || !roundDone(t)) return false;
  if (t.format === 'rr') {
    if (t.round + 1 < t.rounds.length) t.round++; else t.done = true;
    return true;
  }
  if (t.format === 'se') {
    const winners = t.rounds[t.round].matches.map(m => result(t, m).winner);
    if (winners.length <= 1) { t.done = true; return true; }
    const matches = [];
    for (let k = 0; k < winners.length; k += 2) matches.push(winners[k + 1] ? { a: winners[k], b: winners[k + 1] } : { a: winners[k], b: null });
    t.rounds.push({ matches }); t.round++;
    return true;
  }
  if (t.round + 1 >= t.total) { t.done = true; return true; }
  t.rounds.push(swissPairs(t, t.order)); t.round++;
  return true;
}

export function champion(t) {
  if (!t.done) return null;
  if (t.format === 'se') { const last = t.rounds[t.rounds.length - 1]; const m = last && last.matches[0]; return m ? result(t, m).winner : null; }
  const st = standings(t); return st.length ? st[0].uid : null;
}

export const roundName = (t, r) => {
  if (t.format !== 'se') return `Ronda ${r + 1}`;
  const left = t.total - r;
  return left === 1 ? 'Final' : left === 2 ? 'Semifinal' : left === 3 ? 'Cuartos de final' : `Ronda ${r + 1}`;
};
