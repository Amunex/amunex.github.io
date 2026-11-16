/* Split: the money logic. No DOM, no network: the app and the tests both import this file.

   A trip is a list of entries that only ever grows. Nothing is edited in place: an edit is a
   new entry that says what changed, a delete is a new entry that crosses the expense out.
   The current state (expenses, balances, the log) is worked out by replaying the entries. */

/* ---------- codes and ids ---------- */
export const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no I, L, O, 0 or 1: they look alike
export const CODE_LEN = 8;

function randomInts(n) {
  const a = new Uint32Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}
function randomString(n, chars) {
  // rejection sampling so every character is equally likely
  const out = []; const limit = Math.floor(0x100000000 / chars.length) * chars.length;
  while (out.length < n) for (const v of randomInts(n * 2)) { if (v < limit && out.length < n) out.push(chars[v % chars.length]); }
  return out.join('');
}
export const newCode = () => randomString(CODE_LEN, CODE_CHARS);
export function cleanCode(s) {
  const c = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === CODE_LEN && [...c].every(ch => CODE_CHARS.includes(ch)) ? c : null;
}
export const fmtCode = c => (c ? c.slice(0, 4) + '-' + c.slice(4) : '');

/* Characters people mix up when they read a code off a screen. O and 0 are never in a code,
   so a typed one stands for the round letter it was mistaken for. */
const LOOKALIKE = { S: '5', 5: 'S', Z: '2', 2: 'Z', B: '8', 8: 'B', G: '6', 6: 'G', U: 'V', V: 'U', O: 'QD', 0: 'QD' };
/* The codes a typed one could stand for, each with how far it is from what was typed. A slip is usually
   made everywhere at once (someone who reads one 6 as a G reads them all that way), so besides every
   one- and two-character change, each kind of mix-up is also tried on all its characters together. */
function nearCodes(raw, max = 80) {
  const opts = [...raw].map(ch => (CODE_CHARS.includes(ch) ? ch : '') + (LOOKALIKE[ch] || ''));
  const out = [];
  if (opts.some(o => !o)) return out;
  const walk = (i, acc, cost, most) => {
    if (i === opts.length) { out.push({ cost, code: acc }); return; }
    for (let k = 0; k < opts[i].length && cost + k <= most; k++) walk(i + 1, acc + opts[i][k], cost + k, most);
  };
  if (opts.reduce((n, o) => n * o.length, 1) <= max) { walk(0, '', 0, Infinity); return out; }     // few enough to try them all
  walk(0, '', 0, 2);
  const base = opts.map(o => o[0]), kinds = [...new Set(base.filter((ch, i) => opts[i].length > 1 && opts[i][0] === raw[i]))];
  const swapAll = set => base.map((ch, i) => (set.includes(ch) && opts[i][0] === raw[i] ? opts[i][1] : ch)).join('');
  kinds.forEach((a, x) => { out.push({ cost: 1.5, code: swapAll([a]) }); kinds.slice(x + 1).forEach(b => out.push({ cost: 2.5, code: swapAll([a, b]) })); });
  return out;
}
/* The trip codes that could be meant by whatever was typed or pasted into the code box: the code
   itself (any case, with or without the dash), an invite link, or a whole invite message.
   Best guess first; after it come the codes that differ only by look-alike characters. Empty when there is no code in it. */
export function codeGuesses(text, max = 80) {
  let s = String(text == null ? '' : text);
  try { s = s.normalize('NFKC'); } catch (_) { /* very old browsers */ }
  s = s.toUpperCase();
  const raws = [];
  const push = r => { r = r.replace(/[^A-Z0-9]/g, ''); if (r.length === CODE_LEN && !raws.includes(r)) raws.push(r); };
  const link = /[?&]T=([^&#\s]*)/.exec(s);
  if (link) push(link[1]);
  push(s);
  const parts = s.split(/([^A-Z0-9]+)/);                     // words at even places, what stands between them at odd ones
  const dashed = [], whole = [], spaced = [];
  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i].length === CODE_LEN) whole.push(parts[i]);
    if (parts[i].length === 4 && (parts[i + 2] || '').length === 4) (/^\s*[-\u2010-\u2015\u2212]\s*$/.test(parts[i + 1]) ? dashed : /^\s+$/.test(parts[i + 1]) ? spaced : []).push(parts[i] + parts[i + 2]);
  }
  [...dashed, ...whole, ...spaced].forEach(push);
  const all = [];
  raws.forEach((r, pri) => { for (const g of nearCodes(r)) all.push({ ...g, pri }); });
  all.sort((a, b) => a.cost - b.cost || a.pri - b.pri);
  const out = [];
  for (const g of all) if (!out.includes(g.code)) out.push(g.code);
  return out.slice(0, max);
}

/* ---------- a person's own login key ---------- */
/* Everyone in a trip has a key of their own. It lives in their own link (…&me=KEY) and on their phones.
   The trip's log only ever holds a fingerprint of it, so knowing the log doesn't let anyone sign in as someone else. */
export const KEY_LEN = 16;
export const newKey = () => randomString(KEY_LEN, CODE_CHARS);
export function cleanKey(s) {
  const k = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return k.length === KEY_LEN && [...k].every(ch => CODE_CHARS.includes(ch)) ? k : null;
}
const SHA_K = (() => {                                      // the 64 round constants: cube roots of the first primes
  const k = [], prime = n => { for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; };
  for (let n = 2; k.length < 64; n++) if (prime(n)) k.push(Math.floor((Math.cbrt(n) % 1) * 0x100000000));
  return k;
})();
/* SHA-256. The browser has one built in, but it only answers later, and the replay needs the answer now. */
export function sha256(text) {
  const bytes = new TextEncoder().encode(String(text)), l = bytes.length;
  const words = new Uint32Array((((l + 8) >> 6) + 1) << 4);
  for (let i = 0; i < l; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  words[l >> 2] |= 0x80 << (24 - (l % 4) * 8);
  words[words.length - 1] = l * 8;
  const H = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < words.length; o += 16) {
    for (let i = 0; i < 16; i++) w[i] = words[o + i];
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      w[i] = (w[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return [...H].map(x => x.toString(16).padStart(8, '0')).join('');
}
/* The fingerprint of a key, as it is written on the log. Tied to the trip, so the same key means nothing elsewhere. */
export const keyHash = (code, key) => sha256(`split|${code}|${key}`).slice(0, 32);
const isKeyHash = s => typeof s === 'string' && /^[0-9a-f]{32}$/.test(s);
/* What a link says besides the trip code: someone's own key (me=…), or the name an invite is meant for (as=…). */
export function linkParts(text) {
  const s = String(text == null ? '' : text);
  const me = /[?&#]me=([A-Za-z0-9-]+)/i.exec(s), as = /[?&#]as=([A-Za-z0-9_-]{1,40})(?![A-Za-z0-9_-])/i.exec(s);
  return { me: me ? cleanKey(me[1]) : null, as: as ? as[1] : null };
}

const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
export const newId = (prefix = '', n = 9) => prefix + randomString(n, B36);
/* Entry ids sort by the time they were made, so the database returns them in order. */
export function newEntryId(now = Date.now()) {
  return Math.max(0, Math.floor(now)).toString(36).padStart(9, '0') + randomString(11, B36);
}

/* ---------- currencies ---------- */
/* How many decimals a currency is written with. Kept here (not read from the phone) so every
   phone agrees. Besides the official zero-decimal currencies this lists a few whose cents
   nobody uses (lek, forint, rupiah, Colombian peso, Taiwan dollar, Serbian dinar). */
const ZERO_DEC = new Set(('BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF ' +
  'ALL HUF IDR COP TWD RSD').split(' '));
const THREE_DEC = new Set('BHD IQD JOD KWD LYD OMR TND'.split(' '));
export const curDecimals = cur => (ZERO_DEC.has(cur) ? 0 : THREE_DEC.has(cur) ? 3 : 2);
export const isCurrencyCode = c => typeof c === 'string' && /^[A-Z]{3}$/.test(c);

export const toMinor = (amount, dec) => Math.round(Number(amount) * 10 ** dec);
export const fromMinor = (minor, dec) => minor / 10 ** dec;
export const roundTo = (n, dec) => Math.round(Number(n) * 10 ** dec) / 10 ** dec;

/* Reads what someone typed into an amount box: "12,50", "1 234.5", "1.234,56", "1,234.56". */
export function parseAmount(text, dec = 2) {
  let s = String(text == null ? '' : text).trim().replace(/[\s'’  ]/g, '');
  if (!s || !/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return null;
  const dots = (s.match(/\./g) || []).length, commas = (s.match(/,/g) || []).length;
  if (dots && commas) {
    const d = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    s = s.split(d === '.' ? ',' : '.').join('');
    if (s.split(d).length > 2) return null;
    s = s.replace(d, '.');
  } else if (dots + commas > 1) {
    s = s.replace(/[.,]/g, '');                      // 1,234,567: thousands
  } else if (dots + commas === 1) {
    const after = s.length - 1 - s.search(/[.,]/);
    const before = s.search(/[.,]/);
    if (after === 3 && dec !== 3 && before > 0 && before <= 3 && s[0] !== '0') s = s.replace(/[.,]/, '');   // 1,234: thousands
    else s = s.replace(',', '.');
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 1e12) return null;
  return roundTo(n, dec);
}

export function fmtMoney(minor, cur, dec, locale) {
  const n = fromMinor(minor, dec);
  try {
    return new Intl.NumberFormat(locale || undefined, { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol', minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
  } catch (_) {
    return cur + ' ' + n.toFixed(dec);
  }
}
export function fmtRate(r) {
  if (!Number.isFinite(r) || r <= 0) return '';
  const digits = r >= 10 ? 2 : r >= 1 ? 4 : Math.min(8, 3 - Math.floor(Math.log10(r)));
  return String(Number(r.toFixed(digits)));
}

/* ---------- splitting ---------- */
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/* Shares out `total` (a whole number of cents) in proportion to `weights`, so the pieces add
   up to the total exactly. Cents left over go to whoever lost the most to rounding; when
   that's a tie (an equal split) the starting person rotates with `seed`, so the same friend
   doesn't pick up the odd cent every time. Every phone gets the same answer. */
export function allocate(total, weights, seed = '') {
  const n = weights.length;
  const out = new Array(n).fill(0);
  if (!n) return out;
  const w = weights.map(x => { const v = Math.round(Number(x) * 1000); return Number.isFinite(v) && v > 0 ? BigInt(v) : 0n; });
  const W = w.reduce((a, b) => a + b, 0n);
  if (W === 0n) return out;
  const neg = total < 0; const T = BigInt(Math.abs(Math.round(total)));
  const rem = new Array(n);
  let given = 0n;
  for (let i = 0; i < n; i++) { const q = (T * w[i]) / W; out[i] = Number(q); rem[i] = (T * w[i]) % W; given += q; }
  let left = Number(T - given);
  const start = hash32(String(seed)) % n;
  const order = [...Array(n).keys()].sort((a, b) => (rem[a] === rem[b] ? ((a - start + n) % n) - ((b - start + n) % n) : rem[a] > rem[b] ? -1 : 1));
  for (let k = 0; left > 0; k = (k + 1) % n) { if (w[order[k]] > 0n) { out[order[k]]++; left--; } }
  return neg ? out.map(v => -v) : out;
}

const SPLIT_MODES = ['equal', 'shares', 'exact'];

/* What an expense or payment is worth in the trip's own currency, in cents. */
export function baseMinor(x, tripDec) {
  const cd = Number.isInteger(x.cd) ? x.cd : 2;
  const rate = Number.isFinite(x.rate) && x.rate > 0 ? x.rate : 1;
  const v = toMinor(x.amt, cd) * rate, k = tripDec - cd;
  return Math.round(k >= 0 ? v * 10 ** k : v / 10 ** -k);     // whole powers of ten only, so every phone rounds alike
}

/* Who owes what for one expense: { memberId: cents in the trip currency }. */
export function expenseShares(x, tripDec) {
  const total = baseMinor(x, tripDec);
  const ids = Object.keys(x.parts || {}).filter(id => Number(x.parts[id]) > 0).sort();
  if (!ids.length) return { [x.payer]: total };               // nobody picked: the payer carries it
  const weights = ids.map(id => (x.mode === 'equal' ? 1 : Number(x.parts[id])));
  const cents = allocate(total, weights, x.id);
  const out = {};
  ids.forEach((id, i) => { out[id] = cents[i]; });
  return out;
}

/* ---------- replaying the entries ---------- */
export const TYPES = ['member.add', 'member.rename', 'member.remove', 'claim', 'key.set', 'expense.add', 'expense.edit',
  'expense.delete', 'expense.restore', 'pay.add', 'pay.delete', 'trip.rename', 'trip.color', 'trip.policy', 'trip.final', 'group.set', 'group.remove'];
export const COLORS = ['night', 'pine', 'royal', 'plum', 'ember', 'coal'];
/* Trips started before the colours were redone keep working: each old colour maps to a new one. */
const OLD_COLORS = { mango: 'night', lime: 'pine', aqua: 'pine', sky: 'royal', lilac: 'plum', flamingo: 'ember' };
/* Besides the six ready-made colours a trip can have its own pair: "x-" + background + "-" + buttons, as hex ("x-151a3a-f6c453"). */
const CUSTOM = /^x-([0-9a-f]{6})-([0-9a-f]{6})$/;
export const colorOf = c => (COLORS.includes(c) ? c : typeof c === 'string' && CUSTOM.test(c) ? c : OLD_COLORS[c] || null);
export const customColor = (field, accent) => { const c = `x-${String(field).replace('#', '').toLowerCase()}-${String(accent).replace('#', '').toLowerCase()}`; return CUSTOM.test(c) ? c : null; };
export const customParts = c => { const m = typeof c === 'string' && c.match(CUSTOM); return m ? { field: '#' + m[1], accent: '#' + m[2] } : null; };
/* How bright a colour is (0 black to 1 white) and how well two colours read on each other (1 to 21), the standard way. */
export function luminance(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16), ch = v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}
export const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
export const inkOn = hex => (contrast(hex, '#000000') >= contrast(hex, '#ffffff') ? '#000000' : '#ffffff');
const EXPENSE_FIELDS = ['title', 'amt', 'cur', 'cd', 'rate', 'rsrc', 'rdate', 'mkt', 'date', 'payer', 'mode', 'parts', 'tag', 'note', 'rc'];
const MONEY_FIELDS = ['amt', 'cur', 'cd', 'rate', 'payer', 'mode', 'parts'];       // the ones that move a balance
const PAY_FIELDS = ['from', 'to', 'amt', 'cur', 'cd', 'rate', 'rsrc', 'date', 'x', 'via', 'rc'];
const LATE_MS = 24 * 3600 * 1000;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v);

function cleanParts(parts) {
  const out = {};
  if (parts && typeof parts === 'object') {
    for (const [k, v] of Object.entries(parts)) { const n = Number(v); if (isId(k) && Number.isFinite(n) && n > 0 && n <= 1e12) out[k] = n; }
  }
  return out;
}
/* Tidies an expense that arrived from another phone. Returns null if it can't be used. */
export function cleanExpense(d) {
  if (!d || !isId(d.id)) return null;
  const amt = Number(d.amt);
  if (!Number.isFinite(amt) || amt <= 0 || amt > 1e12) return null;
  if (!isCurrencyCode(d.cur) || !isId(d.payer)) return null;
  const cd = [0, 2, 3].includes(d.cd) ? d.cd : curDecimals(d.cur);
  const rate = Number(d.rate);
  const x = {
    id: d.id, title: str(d.title, 80) || 'Expense', amt: roundTo(amt, cd), cur: d.cur, cd,
    rate: Number.isFinite(rate) && rate > 0 ? rate : 1,
    rsrc: ['same', 'live', 'saved', 'manual'].includes(d.rsrc) ? d.rsrc : 'manual',
    rdate: isDate(d.rdate) ? d.rdate : '', mkt: Number.isFinite(Number(d.mkt)) && Number(d.mkt) > 0 ? Number(d.mkt) : 0,
    date: isDate(d.date) ? d.date : '', payer: d.payer,
    mode: SPLIT_MODES.includes(d.mode) ? d.mode : 'equal', parts: cleanParts(d.parts),
    tag: str(d.tag, 30),                                   // the group it was split with ("Alcohol"), if one was picked
    note: str(d.note, 300), rc: Array.isArray(d.rc) ? d.rc.filter(isId).slice(0, 4) : [],
  };
  return x;
}
export function cleanPayment(d) {
  if (!d || !isId(d.id) || !isId(d.from) || !isId(d.to) || d.from === d.to) return null;
  const amt = Number(d.amt);
  if (!Number.isFinite(amt) || amt <= 0 || amt > 1e12 || !isCurrencyCode(d.cur)) return null;
  const cd = [0, 2, 3].includes(d.cd) ? d.cd : curDecimals(d.cur);
  const rate = Number(d.rate);
  return { id: d.id, from: d.from, to: d.to, amt: roundTo(amt, cd), cur: d.cur, cd, rate: Number.isFinite(rate) && rate > 0 ? rate : 1,
    rsrc: ['same', 'live', 'saved', 'manual'].includes(d.rsrc) ? d.rsrc : 'manual', date: isDate(d.date) ? d.date : '', note: str(d.note, 300),
    rc: Array.isArray(d.rc) ? d.rc.filter(isId).slice(0, 4) : [],
    x: isId(d.x) ? d.x : '',                               // the expense it was for, when someone paid their part of one
    via: str(d.via, 30),                                   // how: "cash", "PayPal", ...
    re: isId(d.re) ? d.re : '' };                          // the payment this one takes the place of (an edit)
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function sortedParts(p) { const o = {}; for (const k of Object.keys(p || {}).sort()) o[k] = p[k]; return o; }

/* Reads one stored entry. `d` is kept as text in the database so it comes back exactly as written. */
export function readEntry(id, raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.t !== 'string') return null;
  let d = raw.d;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { d = null; } }
  return {
    id, t: raw.t, d: d && typeof d === 'object' ? d : {},
    ts: Number.isFinite(raw.ts) ? raw.ts : null,          // the server's clock: when it was saved
    ct: Number.isFinite(raw.ct) ? raw.ct : 0,             // the phone's clock: when it was made
    by: isId(raw.by) ? raw.by : null, dev: isId(raw.dev) ? raw.dev : null, uid: typeof raw.uid === 'string' ? raw.uid : null,
    gn: typeof raw.gn === 'string' ? raw.gn.trim().slice(0, 80) : '',     // the Google account name the entry was written under, if signed in
    pending: !!raw.pending,
  };
}
export const entryTime = e => (e.ts != null ? e.ts : e.ct || 0);
export function sortEntries(list) {
  return list.slice().sort((a, b) => {
    // saved entries first, in the order the server stamped them; waiting ones after, in the order they were made
    if ((a.ts == null) !== (b.ts == null)) return a.ts == null ? 1 : -1;
    return entryTime(a) - entryTime(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

/* Has someone already joined under this name? Then nobody else can pick it. */
export function nameTaken(st, id) {
  const m = st.members.get(id);
  if (!m || m.gone) return false;
  if (m.key || Object.keys(m.accounts).length) return true;
  for (const dv of st.devices.values()) if (dv.now === id) return true;
  return false;
}
/* Is this phone signed in as that person, as far as the log can tell? */
export function signedIn(st, dev, id) {
  const m = st.members.get(id), dv = st.devices.get(dev);
  return !!(m && dv && dv.now === id && (!m.key || dv.key === m.key || dv.g));
}

/* Replays every entry and returns the trip as it stands now, plus one log line per entry. */
export function replay(meta, entries) {
  const st = {
    name: str(meta && meta.name, 60) || 'Trip', base: isCurrencyCode(meta && meta.base) ? meta.base : 'EUR',
    dec: [0, 2, 3].includes(meta && meta.dec) ? meta.dec : 2, color: colorOf(meta && meta.color) || COLORS[0],
    members: new Map(), expenses: new Map(), payments: new Map(), devices: new Map(), groups: new Map(), accounts: new Map(), log: [],
    signin: 'any',                                         // 'google': new people must sign in with Google to join
    final: null,                                           // { by, at } once someone has finalized the trip
    newer: false,                                          // an entry this version of the app doesn't know: time to reload
  };
  const delLines = new Map();                              // payment id -> the log line that took it off
  const used = id => {
    for (const x of st.expenses.values()) if (x.payer === id || id in x.parts) return true;
    for (const p of st.payments.values()) if (p.from === id || p.to === id) return true;
    return false;
  };
  for (const e of sortEntries(entries)) {
    const d = e.d, at = entryTime(e);
    const line = { id: e.id, t: e.t, at, ts: e.ts, ct: e.ct, by: e.by, dev: e.dev, pending: e.pending, ok: true, flags: [], ref: null, changes: [] };
    // which person this phone first said it was
    const dv = e.dev ? st.devices.get(e.dev) : null, who = e.by ? st.members.get(e.by) : null;
    const signed = !!(who && dv && dv.now === e.by && (dv.g || (who.key && dv.key === who.key)));     // this phone showed that person's key (or Google account)
    if (e.t !== 'claim' && e.t !== 'key.set') {
      if (dv && e.by && dv.first && dv.first !== e.by && !signed) { line.flags.push('borrowed'); line.owner = dv.first; }
      if (who && who.key && !signed) line.flags.push('nokey');         // written under a name whose key this phone never showed
    }

    switch (e.t) {
      case 'member.add': {
        const name = str(d.name, 40);
        if (!isId(d.id) || !name || st.members.has(d.id)) { line.ok = false; break; }
        st.members.set(d.id, { id: d.id, name, addedBy: e.by, at, gone: false, accounts: {}, key: '', keyAt: 0, keyBy: null });
        line.ref = d.id; line.name = name;
        break;
      }
      case 'member.rename': {
        const m = st.members.get(d.id), name = str(d.name, 40);
        if (!m || !name || name === m.name) { line.ok = false; break; }
        line.ref = m.id; line.changes.push({ f: 'name', from: m.name, to: name }); line.name = name;
        m.name = name;
        break;
      }
      case 'member.remove': {
        const m = st.members.get(d.id);
        if (!m || m.gone || used(m.id)) { line.ok = false; break; }
        m.gone = true; line.ref = m.id; line.name = m.name;
        break;
      }
      case 'claim': {
        const m = st.members.get(d.m);
        if (!m || !e.dev) { line.ok = false; break; }
        const cur = st.devices.get(e.dev);
        line.ref = m.id; line.name = m.name;
        // A Google account. Its name is the entry's own `gn` field (not something inside d), because that is the
        // one place the stricter database rules can check against the real sign-in.
        const acctName = e.uid ? e.gn : '', linked = acctName ? st.accounts.get(e.uid) : null;
        // A name with a key of its own only takes a phone that shows the key (or a Google account already tied to the name).
        const k = isKeyHash(d.k) ? d.k : '', keyed = !!(m.key && k === m.key);
        const here = !!(cur && cur.now === m.id && (cur.key === m.key || cur.g));              // this phone is signed in as them already
        if (m.key && !keyed && !here && !(acctName && e.uid in m.accounts)) { line.flags.push('nokey'); line.refused = true; break; }
        const newAcct = !!(acctName && !(e.uid in m.accounts));
        if (newAcct) {
          m.accounts[e.uid] = { name: acctName, mail: str(d.acct && d.acct.e, 60), at };
          line.acct = m.accounts[e.uid];
          if (linked && linked !== m.id) { line.flags.push('switched'); line.changes.push({ f: 'who', from: linked, to: m.id }); }
          st.accounts.set(e.uid, m.id);
        } else if (acctName) line.sameAcct = true;           // an account this person already uses
        if (keyed && (!cur || cur.now !== m.id) && [...st.devices.values()].some(x => x.now === m.id)) line.viaKey = true;     // one more phone of theirs
        if (!cur) st.devices.set(e.dev, { first: m.id, now: m.id, key: keyed ? k : '', g: !!acctName });
        else if (cur.now !== m.id) {
          if (!line.flags.includes('switched')) { line.changes.push({ f: 'who', from: cur.now, to: m.id }); line.flags.push('switched'); }
          Object.assign(cur, { now: m.id, key: keyed ? k : '', g: !!acctName });
        } else if (newAcct) { line.signedIn = true; cur.g = true; if (keyed) cur.key = k; }      // same phone, same person, now signed in
        else if (keyed && cur.key !== k) { cur.key = k; line.keyed = true; }                   // same phone, same person, now with their own key
        else line.ok = false;                                // same phone, same person: nothing happened
        if (line.ok && !acctName && st.signin === 'google') line.flags.push('nosign');     // the trip asks for a sign-in and this join has none
        break;
      }
      case 'key.set': {
        // Gives a name its own key, swaps it for a new one, or (k empty) lets the name go again. `was` is the fingerprint
        // being replaced: of two phones that set one at the same moment, only the first counts.
        const m = st.members.get(d.m), k = d.k === '' ? '' : isKeyHash(d.k) ? d.k : null, was = typeof d.was === 'string' ? d.was : '';
        if (!m || m.gone || k == null || m.key !== was || k === was) { line.ok = false; break; }
        const own = !!(dv && e.by === m.id && dv.now === m.id && (!was || dv.key === was || dv.g));        // done on a phone that is signed in as this person
        if (!k && !own) { line.ok = false; break; }           // only their own phone can let a name go
        line.ref = m.id; line.name = m.name; line.k = k;
        if (!k) line.release = true;
        else if (!was) {                                      // a first key: their own doing, unless it comes from a phone that isn't theirs
          line.first = true;
          const elsewhere = !(dv && dv.now === m.id) && [...st.devices.values()].some(x => x.now === m.id);
          if (e.by !== m.id || elsewhere) line.flags.push('reset');
        }
        else if (own) line.renew = true;
        else line.flags.push('reset');                        // someone else made this person a new key: their phones are signed out
        m.key = k; m.keyAt = at; m.keyBy = e.by;
        if (own && dv) dv.key = k;
        break;
      }
      case 'expense.add': {
        const x = cleanExpense(d);
        if (!x || st.expenses.has(x.id)) { line.ok = false; break; }
        x.parts = sortedParts(x.parts);
        st.expenses.set(x.id, { ...x, at, by: e.by, edits: 0, editedAt: 0, gone: false, goneBy: null, pending: e.pending, entries: [e.id] });
        line.ref = x.id; line.snap = { ...x };
        if (st.final) line.flags.push('final');
        if (x.rsrc === 'manual' && x.mkt && Math.abs(x.rate / x.mkt - 1) > 0.02) line.flags.push('rate');
        break;
      }
      case 'expense.edit': {
        const x = st.expenses.get(d.id);
        if (!x || !d.set || typeof d.set !== 'object') { line.ok = false; break; }
        const merged = { ...pick(x, EXPENSE_FIELDS), ...pick(d.set, EXPENSE_FIELDS), id: x.id };
        if ('cur' in d.set && !('cd' in d.set)) delete merged.cd;         // new currency: its own decimals
        const next = cleanExpense(merged);
        if (!next) { line.ok = false; break; }
        next.parts = sortedParts(next.parts);
        for (const f of EXPENSE_FIELDS) if (!same(x[f], next[f])) line.changes.push({ f, from: x[f], to: next[f] });
        if (!line.changes.length) { line.ok = false; break; }
        line.ref = x.id; line.before = pick(x, EXPENSE_FIELDS); line.snap = { ...next };
        if (line.changes.some(c => ['amt', 'cur', 'rate'].includes(c.f))) line.flags.push('amount');
        if (at - x.at > LATE_MS) line.flags.push('late');
        if (st.final && line.changes.some(c => MONEY_FIELDS.includes(c.f))) line.flags.push('final');
        if (next.rsrc === 'manual' && next.mkt && Math.abs(next.rate / next.mkt - 1) > 0.02 && line.changes.some(c => c.f === 'rate')) line.flags.push('rate');
        Object.assign(x, next); x.edits++; x.editedAt = at; x.pending = x.pending || e.pending; x.entries.push(e.id);
        break;
      }
      case 'expense.delete':
      case 'expense.restore': {
        const x = st.expenses.get(d.id), del = e.t === 'expense.delete';
        if (!x || x.gone === del) { line.ok = false; break; }
        x.gone = del; x.goneBy = del ? e.by : null; x.goneAt = del ? at : 0; x.entries.push(e.id);
        line.ref = x.id; line.snap = pick(x, EXPENSE_FIELDS);
        if (del && at - x.at > LATE_MS) line.flags.push('late');
        if (st.final) line.flags.push('final');
        break;
      }
      case 'pay.add': {
        const p = cleanPayment(d);
        if (!p || st.payments.has(p.id)) { line.ok = false; break; }
        const rec = { ...p, at, by: e.by, gone: false, pending: e.pending, first: null, edits: 0, next: '' };
        line.ref = p.id; line.snap = { ...p };
        /* An edit is written as two entries every version of the app understands: the old payment is taken off and a
           new one, pointing back at it, is put in. When both come from the same person in one go, the log shows them
           as one change. */
        const old = p.re ? st.payments.get(p.re) : null, del = old ? delLines.get(old.id) : null;
        if (old && old.gone && !old.next && del && del.by === e.by && del.dev === e.dev && Math.abs(at - del.at) < 120000) {
          old.next = p.id; rec.first = old.first || { by: old.by, at: old.at }; rec.edits = old.edits + 1;
          for (const f of PAY_FIELDS) if (!same(old[f], p[f])) line.changes.push({ f, from: old[f], to: p[f] });
          line.edit = true; line.before = pick(old, PAY_FIELDS); del.merged = true;
          if (!line.changes.length) line.merged = true;      // put back exactly as it was: nothing to tell
          if (line.changes.some(c => ['amt', 'cur', 'rate'].includes(c.f))) line.flags.push('amount');
          if (at - rec.first.at > LATE_MS) line.flags.push('late');
        } else rec.re = '';
        st.payments.set(p.id, rec);
        break;
      }
      case 'pay.delete': {
        const p = st.payments.get(d.id);
        if (!p || p.gone) { line.ok = false; break; }
        line.ref = p.id; line.snap = pick(p, ['id', ...PAY_FIELDS]);
        p.gone = true; p.goneBy = e.by; p.goneAt = at; delLines.set(p.id, line);
        if (at - ((p.first && p.first.at) || p.at) > LATE_MS) line.flags.push('late');
        break;
      }
      case 'trip.rename': {
        const name = str(d.name, 60);
        if (!name || name === st.name) { line.ok = false; break; }
        line.changes.push({ f: 'name', from: st.name, to: name }); st.name = name;
        break;
      }
      case 'trip.color': {
        if (!colorOf(d.color) || colorOf(d.color) === st.color) { line.ok = false; break; }
        st.color = colorOf(d.color);
        break;
      }
      case 'trip.final': {
        const on = d.on !== false;
        if (on === !!st.final) { line.ok = false; break; }
        st.final = on ? { by: e.by, at } : null; line.on = on;
        if (on) { const b = balances(st); line.total = b.total; line.left = settleSteps(b.net).length; }
        break;
      }
      case 'trip.policy': {
        const v = d.signin === 'google' ? 'google' : 'any';
        if (v === st.signin) { line.ok = false; break; }
        st.signin = v; line.signin = v;
        break;
      }
      case 'group.set': {
        const name = str(d.name, 30), old = st.groups.get(d.id);
        const members = [...new Set(Array.isArray(d.members) ? d.members : [])].filter(id => st.members.has(id)).sort();
        if (!isId(d.id) || !name || (old && old.gone)) { line.ok = false; break; }
        line.ref = d.id; line.name = name; line.members = members;
        if (!old) { st.groups.set(d.id, { id: d.id, name, members, by: e.by, at, gone: false }); line.made = true; break; }
        if (old.name !== name) line.changes.push({ f: 'name', from: old.name, to: name });
        const added = members.filter(id => !old.members.includes(id)), removed = old.members.filter(id => !members.includes(id));
        if (added.length || removed.length) line.changes.push({ f: 'members', added, removed });
        if (!line.changes.length) { line.ok = false; break; }
        old.name = name; old.members = members;
        break;
      }
      case 'group.remove': {
        const g = st.groups.get(d.id);
        if (!g || g.gone) { line.ok = false; break; }
        g.gone = true; line.ref = g.id; line.name = g.name;
        break;
      }
      default: line.ok = false; if (typeof e.t === 'string' && !TYPES.includes(e.t)) st.newer = true;
    }
    if (line.ok) st.log.push(line);
  }
  return st;
}
function pick(o, keys) { const r = {}; for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; }

/* ---------- balances ---------- */
/* net > 0: the group owes this person. net < 0: this person owes the group. Always adds up to zero. */
export function balances(st) {
  const net = {}, paid = {}, share = {};
  for (const id of st.members.keys()) { net[id] = 0; paid[id] = 0; share[id] = 0; }
  const add = (o, id, v) => { o[id] = (o[id] || 0) + v; };
  let total = 0;
  for (const x of st.expenses.values()) {
    if (x.gone) continue;
    const base = baseMinor(x, st.dec); total += base;
    add(paid, x.payer, base); add(net, x.payer, base);
    for (const [id, c] of Object.entries(expenseShares(x, st.dec))) { add(share, id, c); add(net, id, -c); }
  }
  for (const p of st.payments.values()) {
    if (p.gone) continue;
    const base = baseMinor(p, st.dec);
    add(net, p.from, base); add(net, p.to, -base);
  }
  return { net, paid, share, total };
}

/* A short list of payments that clears every balance: the person who owes most pays the person owed most,
   then again with whoever is left. Never more payments than people minus one.
   Each step also says what both people still owed or were owed before and after, for the explanation. */
export function settleSteps(net) {
  const debt = [], cred = [];
  for (const [id, v] of Object.entries(net)) { if (v < 0) debt.push({ id, v: -v }); else if (v > 0) cred.push({ id, v }); }
  const order = (a, b) => b.v - a.v || (a.id < b.id ? -1 : 1);
  const out = [];
  while (debt.length && cred.length) {
    debt.sort(order); cred.sort(order);
    const d = debt[0], c = cred[0], amt = Math.min(d.v, c.v);
    out.push({ from: d.id, to: c.id, amt, owed: d.v, due: c.v, owedAfter: d.v - amt, dueAfter: c.v - amt });
    d.v -= amt; c.v -= amt;
    if (!d.v) debt.shift();
    if (!c.v) cred.shift();
  }
  return out;
}
export const settleUp = net => settleSteps(net).map(({ from, to, amt }) => ({ from, to, amt }));

/* Why one person's balance is what it is: what they paid, their part of each expense, and money
   already handed over. The screens turn these numbers into sentences. net = paid - share + gave - got. */
export function explain(st, id) {
  const paid = [], share = [], gave = [], got = [];
  for (const x of st.expenses.values()) {
    if (x.gone) continue;
    const total = baseMinor(x, st.dec), sh = expenseShares(x, st.dec), ids = Object.keys(sh);
    if (x.payer === id) paid.push({ id: x.id, title: x.title, amt: total, date: x.date, at: x.at });
    if (id in sh) {
      const w = ids.map(i => (x.mode === 'equal' ? 1 : Number(x.parts[i]) || 0));
      share.push({ id: x.id, title: x.title, total, mine: sh[id], people: ids.length, mode: ids.length === 1 ? 'alone' : x.mode,
        weight: x.mode === 'equal' ? 1 : Number(x.parts[id]) || 0, weights: w.reduce((a, b) => a + b, 0), tag: x.tag, cur: x.cur, cd: x.cd, date: x.date, at: x.at });
    }
  }
  for (const p of st.payments.values()) {
    if (p.gone) continue;
    const amt = baseMinor(p, st.dec);
    if (p.from === id) gave.push({ id: p.id, who: p.to, amt, date: p.date, x: p.x, via: p.via });
    if (p.to === id) got.push({ id: p.id, who: p.from, amt, date: p.date, x: p.x, via: p.via });
  }
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.at || 0) - (b.at || 0));
  paid.sort(byDate); share.sort(byDate);
  const sum = (a, k = 'amt') => a.reduce((t, v) => t + v[k], 0);
  const paidTotal = sum(paid), shareTotal = sum(share, 'mine'), gaveTotal = sum(gave), gotTotal = sum(got);
  return { paid, share, gave, got, paidTotal, shareTotal, gaveTotal, gotTotal, net: paidTotal - shareTotal + gaveTotal - gotTotal };
}

/* ---------- paying your part of one expense ---------- */
/* Money already handed to the payer for one expense: expense id -> { who gave it: cents }. */
export function paidFor(st) {
  const out = new Map();
  for (const p of st.payments.values()) {
    if (p.gone || !p.x) continue;
    const o = out.get(p.x) || {}; o[p.from] = (o[p.from] || 0) + baseMinor(p, st.dec); out.set(p.x, o);
  }
  return out;
}
/* One expense, person by person: their part, what they already paid towards it, what is left.
   `back` is what the payer is owed for it in all, `left` what is still to come. */
export function partStatus(st, x) {
  const shares = expenseShares(x, st.dec), pays = {};
  for (const p of st.payments.values()) if (!p.gone && p.x === x.id) (pays[p.from] = pays[p.from] || []).push(p);
  const order = [...st.members.keys()], ids = [...new Set([...Object.keys(shares), ...Object.keys(pays)])].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const rows = ids.map(id => {
    const part = shares[id] || 0, list = (pays[id] || []).slice().sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
    const paid = list.reduce((t, p) => t + baseMinor(p, st.dec), 0), payer = id === x.payer;
    return { id, part, paid, left: payer ? 0 : Math.max(0, part - paid), over: payer ? 0 : Math.max(0, paid - part), pays: list, payer };
  });
  const back = baseMinor(x, st.dec) - (shares[x.payer] || 0), got = rows.reduce((t, r) => t + (r.payer ? 0 : r.paid), 0);
  return { rows, back, got, left: Math.max(0, back - got) };
}

/* ---------- the final bill ---------- */
/* Where the whole trip stands: each person's numbers, the payments still to make, and how much of
   what was owed has been paid back so far. */
export function summary(st) {
  const b = balances(st), gave = {}, got = {};
  for (const p of st.payments.values()) if (!p.gone) { const a = baseMinor(p, st.dec); gave[p.from] = (gave[p.from] || 0) + a; got[p.to] = (got[p.to] || 0) + a; }
  const people = [...st.members.values()].filter(m => !m.gone || b.net[m.id] || b.paid[m.id] || b.share[m.id])
    .map(m => ({ id: m.id, paid: b.paid[m.id] || 0, share: b.share[m.id] || 0, gave: gave[m.id] || 0, got: got[m.id] || 0, net: b.net[m.id] || 0 }));
  const owedAtStart = people.reduce((t, p) => t + Math.max(0, p.share - p.paid), 0);      // before anyone paid anyone back
  const owedNow = people.reduce((t, p) => t + Math.max(0, -p.net), 0);
  return { total: b.total, count: [...st.expenses.values()].filter(x => !x.gone).length, people, plan: settleSteps(b.net),
    owedAtStart, owedNow, paidBack: Math.max(0, owedAtStart - owedNow), settled: people.filter(p => !p.net).length };
}

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2, '0');
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseLocalDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }

/* ---------- exports ---------- */
export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;                   // stop spreadsheets running a cell as a formula
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const toCSV = rows => rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
