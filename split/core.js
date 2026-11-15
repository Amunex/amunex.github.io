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
export const TYPES = ['member.add', 'member.rename', 'member.remove', 'claim', 'expense.add', 'expense.edit',
  'expense.delete', 'expense.restore', 'pay.add', 'pay.delete', 'trip.rename', 'trip.color', 'trip.policy', 'group.set', 'group.remove'];
export const COLORS = ['night', 'pine', 'royal', 'plum', 'ember', 'coal'];
/* Trips started before the colours were redone keep working: each old colour maps to a new one. */
const OLD_COLORS = { mango: 'night', lime: 'pine', aqua: 'pine', sky: 'royal', lilac: 'plum', flamingo: 'ember' };
export const colorOf = c => (COLORS.includes(c) ? c : OLD_COLORS[c] || null);
const EXPENSE_FIELDS = ['title', 'amt', 'cur', 'cd', 'rate', 'rsrc', 'rdate', 'mkt', 'date', 'payer', 'mode', 'parts', 'tag', 'note', 'rc'];
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
    rc: Array.isArray(d.rc) ? d.rc.filter(isId).slice(0, 4) : [] };
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

/* Replays every entry and returns the trip as it stands now, plus one log line per entry. */
export function replay(meta, entries) {
  const st = {
    name: str(meta && meta.name, 60) || 'Trip', base: isCurrencyCode(meta && meta.base) ? meta.base : 'EUR',
    dec: [0, 2, 3].includes(meta && meta.dec) ? meta.dec : 2, color: colorOf(meta && meta.color) || COLORS[0],
    members: new Map(), expenses: new Map(), payments: new Map(), devices: new Map(), groups: new Map(), accounts: new Map(), log: [],
    signin: 'any',                                         // 'google': new people must sign in with Google to join
  };
  const used = id => {
    for (const x of st.expenses.values()) if (x.payer === id || id in x.parts) return true;
    for (const p of st.payments.values()) if (p.from === id || p.to === id) return true;
    return false;
  };
  for (const e of sortEntries(entries)) {
    const d = e.d, at = entryTime(e);
    const line = { id: e.id, t: e.t, at, ts: e.ts, ct: e.ct, by: e.by, dev: e.dev, pending: e.pending, ok: true, flags: [], ref: null, changes: [] };
    // which person this phone first said it was
    const dv = e.dev ? st.devices.get(e.dev) : null;
    if (dv && e.by && dv.first && dv.first !== e.by && e.t !== 'claim') { line.flags.push('borrowed'); line.owner = dv.first; }

    switch (e.t) {
      case 'member.add': {
        const name = str(d.name, 40);
        if (!isId(d.id) || !name || st.members.has(d.id)) { line.ok = false; break; }
        st.members.set(d.id, { id: d.id, name, addedBy: e.by, at, gone: false, accounts: {} });
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
        const newAcct = !!(acctName && !(e.uid in m.accounts));
        if (newAcct) {
          m.accounts[e.uid] = { name: acctName, mail: str(d.acct && d.acct.e, 60), at };
          line.acct = m.accounts[e.uid];
          if (linked && linked !== m.id) { line.flags.push('switched'); line.changes.push({ f: 'who', from: linked, to: m.id }); }
          st.accounts.set(e.uid, m.id);
        } else if (acctName) line.sameAcct = true;           // an account this person already uses
        if (!cur) st.devices.set(e.dev, { first: m.id, now: m.id });
        else if (cur.now !== m.id) { if (!line.flags.includes('switched')) { line.changes.push({ f: 'who', from: cur.now, to: m.id }); line.flags.push('switched'); } cur.now = m.id; }
        else if (newAcct) line.signedIn = true;              // same phone, same person, now signed in
        else line.ok = false;                                // same phone, same person: nothing happened
        if (line.ok && !acctName && st.signin === 'google') line.flags.push('nosign');     // the trip asks for a sign-in and this join has none
        break;
      }
      case 'expense.add': {
        const x = cleanExpense(d);
        if (!x || st.expenses.has(x.id)) { line.ok = false; break; }
        x.parts = sortedParts(x.parts);
        st.expenses.set(x.id, { ...x, at, by: e.by, edits: 0, editedAt: 0, gone: false, goneBy: null, pending: e.pending, entries: [e.id] });
        line.ref = x.id; line.snap = { ...x };
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
        break;
      }
      case 'pay.add': {
        const p = cleanPayment(d);
        if (!p || st.payments.has(p.id)) { line.ok = false; break; }
        st.payments.set(p.id, { ...p, at, by: e.by, gone: false, pending: e.pending });
        line.ref = p.id; line.snap = { ...p };
        break;
      }
      case 'pay.delete': {
        const p = st.payments.get(d.id);
        if (!p || p.gone) { line.ok = false; break; }
        p.gone = true; p.goneBy = e.by; line.ref = p.id; line.snap = { ...p };
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
      default: line.ok = false;
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
    if (p.from === id) gave.push({ id: p.id, who: p.to, amt, date: p.date });
    if (p.to === id) got.push({ id: p.id, who: p.from, amt, date: p.date });
  }
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.at || 0) - (b.at || 0));
  paid.sort(byDate); share.sort(byDate);
  const sum = (a, k = 'amt') => a.reduce((t, v) => t + v[k], 0);
  const paidTotal = sum(paid), shareTotal = sum(share, 'mine'), gaveTotal = sum(gave), gotTotal = sum(got);
  return { paid, share, gave, got, paidTotal, shareTotal, gaveTotal, gotTotal, net: paidTotal - shareTotal + gaveTotal - gotTotal };
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
