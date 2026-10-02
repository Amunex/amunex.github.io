// Shared helpers around EDOPro's ocgcore (WebAssembly build): card reader, duel setup, zone decoding, auto-answers.
export const LOC = { DECK: 1, HAND: 2, MZONE: 4, SZONE: 8, GRAVE: 16, REMOVED: 32, EXTRA: 64, OVERLAY: 128, FZONE: 256, PZONE: 512 };
export const POS = { FACEUP_ATTACK: 1, FACEDOWN_ATTACK: 2, FACEUP_DEFENSE: 4, FACEDOWN_DEFENSE: 8 };
export const T = { MONSTER: 1, SPELL: 2, TRAP: 4, NORMAL: 16, EFFECT: 32, FUSION: 64, RITUAL: 128, TOKEN: 0x4000, SYNCHRO: 0x2000, XYZ: 0x800000, LINK: 0x4000000 };
export function makeCardMap(db) {
  const m = new Map();
  for (const c of db.cards) m.set(c.code, { ...c, race: BigInt(c.race) });
  return m;
}
export function toGoat(db, ids) {
  const wl = db._wl || (db._wl = new Set(Object.keys(db.whitelist).map(Number)));
  if (!db._variant) { db._variant = new Map(); for (const c of db.cards) if (wl.has(c.code) && c.alias && c.alias !== c.code && !db._variant.has(c.alias)) db._variant.set(c.alias, c.code); }
  return ids.map(i => wl.has(i) ? i : (db._variant.get(i) ?? i));
}
export function isExtra(card) { return !!card && (card.type & (T.FUSION | T.SYNCHRO | T.XYZ | T.LINK)) !== 0; }
// Mulberry-style 64-bit seed parts from a 32-bit integer seed
export function seedParts(n) {
  let x = BigInt(n >>> 0) * 0x9E3779B97F4A7C15n;
  const parts = [];
  for (let k = 0; k < 4; k++) { x = (x ^ (x >> 31n)) * 0xBF58476D1CE4E5B9n & 0xFFFFFFFFFFFFFFFFn; parts.push(x | 1n); }
  return parts;
}
// Small seeded PRNG so a duel (and every replay of it, e.g. for undo) shuffles the same way
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function shuffled(list, seed) { const r = rng(seed); const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
export function createDuel(lib, { seed, decks, cards, scriptReader, flags, onError }) {
  // constant.lua and utility.lua must be loaded before any card (utility.lua pulls in the other rule scripts)
  const handle = lib.createDuel({
    flags, seed: seedParts(seed),
    team1: { drawCountPerTurn: 1, startingDrawCount: 5, startingLP: 8000 },
    team2: { drawCountPerTurn: 1, startingDrawCount: 5, startingLP: 8000 },
    cardReader: code => cards.get(code) ?? null,
    scriptReader,
    errorHandler: (type, text) => onError && onError(type, text)
  });
  if (!handle) throw new Error('The duel engine could not start.');
  for (const name of ['constant.lua', 'utility.lua']) lib.loadScript(handle, name, scriptReader(name));
  decks.forEach((d, team) => {
    for (const code of shuffled(d.main, (seed ^ (0x9E37 * (team + 1))) >>> 0)) lib.duelNewCard(handle, { team, duelist: 0, code, controller: team, location: LOC.DECK, sequence: 0, position: POS.FACEDOWN_DEFENSE });
    for (const code of d.extra) lib.duelNewCard(handle, { team, duelist: 0, code, controller: team, location: LOC.EXTRA, sequence: 0, position: POS.FACEDOWN_DEFENSE });
  });
  lib.startDuel(handle);
  return handle;
}
// field_mask bits set = zone NOT available; low 16 bits = selecting player's zones, high 16 = opponent's
export function freeZones(player, mask) {
  const out = [];
  for (let half = 0; half < 2; half++) {
    const p = half === 0 ? player : 1 - player, m = (mask >>> (half * 16)) & 0xffff;
    for (let s = 0; s < 7; s++) if (!(m & (1 << s))) out.push({ player: p, location: LOC.MZONE, sequence: s });
    for (let s = 0; s < 6; s++) if (!(m & (1 << (8 + s)))) out.push({ player: p, location: LOC.SZONE, sequence: s });
  }
  return out;
}
function pickN(arr, n) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); }
function subsetSum(items, target, max) {      // indices whose amounts can reach exactly target (amount may pack 2 values)
  const vals = items.map(it => [it.amount & 0xffff, (it.amount >>> 16) & 0xffff].filter((v, k) => k === 0 || v));
  const res = [];
  const dfs = (i, sum, pick) => {
    if (sum === target && pick.length) { res.push(pick.slice()); return true; }
    if (i >= items.length || pick.length >= max || sum > target) return false;
    for (const v of vals[i]) { pick.push(i); if (dfs(i + 1, sum + v, pick)) return true; pick.pop(); }
    return dfs(i + 1, sum, pick);
  };
  dfs(0, 0, []);
  return res[0] || null;
}
// A legal (not smart) answer for any prompt. Used for zone picks, and by the test bot.
export function autoAnswer(msg, cards, opts = {}) {
  const rnd = n => (Math.random() * n) | 0;
  switch (msg.type) {
    case 11: { // idle command
      const acts = [];
      ['summons', 'special_summons', 'pos_changes', 'monster_sets', 'spell_sets', 'activates'].forEach((k, action) => msg[k].forEach((_, index) => acts.push({ action, index })));
      if (msg.to_bp && opts.allowBattle !== false) acts.push({ action: 6 });
      if (msg.to_ep) acts.push({ action: 7 }, { action: 7 });
      const a = acts.length ? acts[rnd(acts.length)] : { action: 7 };
      return { type: 1, action: a.action, index: a.index ?? 0 };
    }
    case 10: { // battle command
      const acts = [];
      msg.chains.forEach((_, index) => acts.push({ action: 0, index }));
      msg.attacks.forEach((_, index) => acts.push({ action: 1, index }, { action: 1, index }));
      if (msg.to_m2) acts.push({ action: 2 });
      if (msg.to_ep) acts.push({ action: 3 });
      const a = acts.length ? acts[rnd(acts.length)] : { action: 3 };
      return { type: 0, action: a.action, index: a.index ?? 0 };
    }
    case 12: return { type: 2, yes: Math.random() < .7 };
    case 13: return { type: 3, yes: Math.random() < .6 };
    case 14: return { type: 4, index: rnd(msg.options.length) };
    case 15: { const n = Math.max(msg.min, Math.min(msg.max, msg.min)); return { type: 5, indicies: pickN(msg.selects.map((_, i) => i), n) }; }
    case 20: { const n = Math.max(1, msg.min); return { type: 12, indicies: pickN(msg.selects.map((_, i) => i), n) }; }
    case 23: { const all = msg.selects_must.concat(msg.selects); const pick = subsetSum(msg.selects, msg.amount - msg.selects_must.reduce((a, s) => a + (s.amount & 0xffff), 0), msg.max || 99); return { type: 14, indicies: msg.selects_must.map((_, i) => i).concat((pick || [0]).map(i => i + msg.selects_must.length)) }; }
    case 26: { if (msg.can_finish && Math.random() < .5) return { type: 7, index: null }; return { type: 7, index: msg.select_cards.length ? rnd(msg.select_cards.length) : null }; }
    case 16: { if (!msg.forced && (Math.random() < .5 || !msg.selects.length)) return { type: 8, index: null }; return { type: 8, index: rnd(msg.selects.length) }; }
    case 18: case 24: { const z = freeZones(msg.player, msg.field_mask); return { type: msg.type === 18 ? 10 : 9, places: pickN(z, msg.count) }; }
    case 19: { const ps = [1, 2, 4, 8].filter(p => msg.positions & p); return { type: 11, position: ps[rnd(ps.length)] }; }
    case 21: case 25: return { type: 15, order: null };
    case 22: { const out = msg.cards.map(() => 0); let left = msg.count; msg.cards.forEach((c, i) => { const t = Math.min(c.count, left); out[i] = t; left -= t; }); return { type: 13, counters: out }; }
    case 140: { const races = []; for (let b = 0n; b < 32n && races.length < msg.count; b++) if (msg.available & (1n << b)) races.push(1n << b); return { type: 16, races }; }
    case 141: { const at = []; for (let b = 0; b < 7 && at.length < msg.count; b++) if (msg.available & (1 << b)) at.push(1 << b); return { type: 17, attributes: at }; }
    case 142: { const pool = opts.announceCandidates ? opts.announceCandidates(msg) : []; return { type: 18, card: pool.length ? pool[rnd(pool.length)] : 0 }; }
    case 143: return { type: 19, value: rnd(msg.options.length) };
    case 132: return { type: 20, value: 1 + rnd(3) };
    default: return null;
  }
}
export const SELECT_TYPES = new Set([10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26, 132, 140, 141, 142, 143]);
