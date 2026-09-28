/* YGO Drafter: live GOAT-format booster drafts. */
const FB_VERSION = '12.19.0';
const FB_CONFIG = {
  apiKey: 'AIzaSyAto8uv4bsHkhDGkhiCFa-PuILGZS9Hf08',
  authDomain: 'goat-draft-796f7.firebaseapp.com',
  databaseURL: 'https://goat-draft-796f7-default-rtdb.firebaseio.com',
  projectId: 'goat-draft-796f7',
  storageBucket: 'goat-draft-796f7.firebasestorage.app',
  messagingSenderId: '906831006037',
  appId: '1:906831006037:web:80e372d9ca72e53073c7dc'
};

const POOL = window.YGO_POOL || [];
const IMG = window.YGO_IMG || {};
const DECKS_SAMPLED = 300;
const R_LABEL = ['Common', 'Rare', 'Super Rare', 'Ultra Rare', 'Secret Rare'];
const R_SHORT = ['C', 'R', 'SR', 'UR', 'ScR'];
const BAN_LABEL = ['', 'Limited', 'Semi-Limited'];
const MAXC = [3, 1, 2];
const BY_R = [[], [], [], [], []];
POOL.forEach(c => BY_R[c.r].push(c));
const CARD = new Map(POOL.map(c => [c.i, c]));
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const NAME_KEY = 'ygo-drafter-name';
const MAX_SEATS = 10;
const DEFAULTS = { bots: 3, packs: 6, odds: 'booster', perPick: 1 };

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wide = () => matchMedia('(min-width:981px)').matches;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
};

const S = {
  view: 'home', online: false, code: null, uid: null, room: null, practice: null,
  settings: { ...DEFAULTS }, sel: [], focus: null, expanded: false, lastKey: null,
  deck: null, deckId: null, buildSel: null, poolFilter: -1, error: '', busy: false,
  offRoom: null, offConn: null, pendingCode: null, editName: false, renaming: false, connecting: false
};

/* ================= draft engine (shared by practice and online) ================= */
const toArr = x => Array.isArray(x) ? x.filter(v => v !== null && v !== undefined)
  : (x && typeof x === 'object' ? Object.keys(x).sort((a, b) => a - b).map(k => x[k]).filter(v => v != null) : []);
function norm(g) {
  if (!g) return g;
  const seats = toArr(g.seats);
  const n = seats.length;
  g.seats = seats.map((s, i) => ({ uid: s.uid || '', name: s.name || `Seat ${i + 1}`, bot: !!s.bot }));
  const P = g.packs || {}, K = g.picks || {}, D = g.done || {};
  g.packs = Array.from({ length: n }, (_, i) => toArr(P[i]).map(Number));
  g.picks = Array.from({ length: n }, (_, i) => toArr(K[i]).map(Number));
  g.done = Array.from({ length: n }, (_, i) => !!D[i]);
  g.round = g.round || 0; g.turn = g.turn || 0; g.finished = !!g.finished;
  g.settings = Object.assign({ packs: 6, odds: 'booster', perPick: 1 }, g.settings || {});
  return g;
}
function rareSlot() { const x = Math.random(); if (x < 1 / 31) return 4; if (x < 1 / 31 + 1 / 12) return 3; if (x < 1 / 31 + 1 / 12 + 1 / 5) return 2; return 1; }
function arenaSlot() { const x = Math.random() * 100; if (x < 50) return 0; if (x < 80) return 1; if (x < 95) return 2; return Math.random() < .2 ? 4 : 3; }
function draw(r, used) {
  const order = [r]; for (let t = r - 1; t >= 0; t--) order.push(t); for (let t = r + 1; t < 5; t++) order.push(t);
  for (const t of order) { const opts = BY_R[t].filter(c => !used.has(c.i)); if (opts.length) { const c = opts[(Math.random() * opts.length) | 0]; used.add(c.i); return c; } }
  return null;
}
function makePackIds(odds) {
  const used = new Set();
  const slots = odds === 'arena' ? Array.from({ length: 9 }, arenaSlot).sort((a, b) => a - b) : [0, 0, 0, 0, 0, 0, 0, 0, rareSlot()];
  return slots.map(r => draw(r, used)).filter(Boolean).map(c => c.i);
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
function newGame(settings, humans) {
  const st = Object.assign({}, DEFAULTS, settings || {});
  const bots = Math.max(0, Math.min(MAX_SEATS - humans.length, typeof st.bots === 'number' ? st.bots : 3));
  const seatsN = humans.length + bots;
  let b = 0;
  const seats = shuffle(Array.from({ length: seatsN }, (_, i) => i < humans.length
    ? { uid: humans[i].uid, name: humans[i].name, bot: false }
    : { uid: '', name: `Bot ${++b}`, bot: true }));
  const g = {
    id: Math.random().toString(36).slice(2, 10), seats, round: 0, turn: 0, finished: false,
    settings: { packs: st.packs, odds: st.odds, perPick: st.perPick }
  };
  g.packs = seats.map(() => makePackIds(st.odds));
  g.picks = seats.map(() => []);
  g.done = seats.map(() => false);
  botsPick(g); advance(g);
  return g;
}
const need = (g, i) => Math.min(g.settings.perPick, g.packs[i].length);
function applyPick(g, i, ids) {
  if (g.finished || g.done[i] || !g.seats[i]) return false;
  const pack = g.packs[i];
  if (ids.length !== need(g, i) || new Set(ids).size !== ids.length) return false;
  if (!ids.every(id => pack.includes(id))) return false;
  ids.forEach(id => { pack.splice(pack.indexOf(id), 1); g.picks[i].push(id); });
  g.done[i] = true;
  return true;
}
function botChoose(pack, picks) {
  let best = null, bs = -1e9;
  for (const id of pack) {
    const c = CARD.get(id); if (!c) continue;
    let s = Math.log1p(c.u) + c.r * .25 + Math.random() * .8;
    if (picks.reduce((n, x) => n + (x === id), 0) >= MAXC[c.b]) s -= 3;
    if (s > bs) { bs = s; best = id; }
  }
  return best ?? pack[0];
}
function botsPick(g) {
  g.seats.forEach((s, i) => {
    if (!s.bot || g.done[i]) return;
    const n = need(g, i);
    for (let k = 0; k < n; k++) { const id = botChoose(g.packs[i], g.picks[i]); g.packs[i].splice(g.packs[i].indexOf(id), 1); g.picks[i].push(id); }
    g.done[i] = true;
  });
}
function advance(g) {
  let guard = 0;
  while (!g.finished && g.done.every(Boolean) && guard++ < 400) {
    if (g.packs.every(p => p.length === 0)) {
      g.round++;
      if (g.round >= g.settings.packs) { g.finished = true; break; }
      g.turn = 0;
      g.packs = g.seats.map(() => makePackIds(g.settings.odds));
    } else {
      const n = g.seats.length, d = g.round % 2 === 0 ? 1 : -1, next = new Array(n);
      for (let i = 0; i < n; i++) next[(i + d + n) % n] = g.packs[i];
      g.packs = next; g.turn++;
    }
    g.done = g.seats.map((s, i) => g.packs[i].length === 0);
    botsPick(g);
  }
}

/* ================= Firebase ================= */
let FB = null;
async function fb() {
  if (FB) return FB;
  const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
  const [A, Au, D] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-database.js')]);
  const app = A.initializeApp(FB_CONFIG);
  const auth = Au.getAuth(app);
  const db = D.getDatabase(app);
  const user = await new Promise(res => { const off = Au.onAuthStateChanged(auth, u => { off(); res(u); }); });
  const u = user || (await Au.signInAnonymously(auth)).user;
  FB = { ...D, db, auth, uid: u.uid, deleteMe: () => Au.deleteUser(auth.currentUser) };
  return FB;
}
const roomRef = (F, p = '') => F.ref(F.db, `rooms/${S.code}${p}`);
function myName() { return (store.get(NAME_KEY) || '').trim().slice(0, 24); }
async function createRoom() {
  const F = await fb();
  let code = null;
  for (let t = 0; t < 8 && !code; t++) {
    const c = Array.from({ length: 4 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');
    if (!(await F.get(F.ref(F.db, `rooms/${c}`))).exists()) code = c;
  }
  if (!code) throw new Error('Couldn’t find a free room code. Try again.');
  const st = { ...DEFAULTS, ...S.settings };
  await F.set(F.ref(F.db, `rooms/${code}`), {
    v: 2, host: F.uid, created: F.serverTimestamp(), status: 'lobby',
    settings: { bots: st.bots, packs: st.packs, odds: st.odds, perPick: st.perPick },
    members: { [F.uid]: { name: myName(), joined: F.serverTimestamp() } }
  });
  await enterRoom(code);
}
function nameClash(r, uid, name) {
  const n = name.trim().toLowerCase();
  return Object.entries((r && r.members) || {}).some(([id, m]) => id !== uid && ((m && m.name) || '').trim().toLowerCase() === n);
}
async function joinRoom(code, name) {
  const F = await fb();
  const snap = await F.get(F.ref(F.db, `rooms/${code}`));
  if (!snap.exists()) { S.pendingCode = null; throw new Error(`There’s no room ${code}. Check the code and try again.`); }
  const r = snap.val();
  const known = r.members && r.members[F.uid];
  if (r.status === 'lobby' || known) {
    if (r.status === 'lobby' && nameClash(r, F.uid, name)) throw new Error(`Someone in room ${code} already goes by ${name}. Pick another username.`);
    await F.update(F.ref(F.db, `rooms/${code}/members/${F.uid}`), known ? { name } : { name, joined: F.serverTimestamp() });
  }
  store.set(NAME_KEY, name);
  await enterRoom(code);
}
async function bootRoom(code) {
  S.connecting = true; render();
  try {
    const F = await fb();
    const snap = await F.get(F.ref(F.db, `rooms/${code}`));
    if (!snap.exists()) { S.pendingCode = null; S.error = `There’s no room ${code}. Check the link or ask for a new one.`; history.replaceState(null, '', location.pathname); }
    else if (snap.val().members && snap.val().members[F.uid]) { await enterRoom(code); }
  } catch (e) { console.error(e); S.error = 'Couldn’t reach the server. Check your connection and refresh.'; }
  S.connecting = false; render();
}
async function renameMe(name) {
  const F = await fb();
  if (nameClash(S.room, F.uid, name)) throw new Error(`Someone here already goes by ${name}. Pick another username.`);
  await F.update(roomRef(F, `/members/${F.uid}`), { name });
  store.set(NAME_KEY, name);
}
async function setReady(v) {
  const F = await fb(); const g = game(); if (!g) return;
  await F.set(roomRef(F, `/ready/${g.id}/${F.uid}`), v);
}
async function enterRoom(code) {
  const F = await fb();
  S.online = true; S.code = code; S.uid = F.uid; S.lastKey = null; S.sel = []; S.focus = null; S.pendingCode = null;
  history.replaceState(null, '', `${location.pathname}?room=${code}`);
  const pr = F.ref(F.db, `rooms/${code}/presence/${F.uid}`);
  if (S.offConn) S.offConn();
  S.offConn = F.onValue(F.ref(F.db, '.info/connected'), snap => {
    if (snap.val() === true) F.onDisconnect(pr).set(false).then(() => F.set(pr, true)).catch(() => {});
  });
  if (S.offRoom) S.offRoom();
  S.offRoom = F.onValue(F.ref(F.db, `rooms/${code}`), snap => { S.room = snap.val(); onRoom(); }, err => { toast('Lost access to the room. Refresh the page to reconnect.'); console.error(err); });
}
async function leaveRoom() {
  if (S.online && FB) {
    const F = FB;
    try {
      if (S.room && S.room.status === 'lobby') await F.remove(roomRef(F, `/members/${F.uid}`));
      await F.set(roomRef(F, `/presence/${F.uid}`), false);
    } catch (_) {}
    if (S.offRoom) S.offRoom(); if (S.offConn) S.offConn();
    S.offRoom = S.offConn = null;
  }
  Object.assign(S, { pendingCode: null, online: false, code: null, room: null, practice: null, view: 'home', sel: [], focus: null, lastKey: null, deck: null, deckId: null, buildSel: null });
  history.replaceState(null, '', location.pathname);
  render();
}
function onRoom() {
  const r = S.room;
  if (!r) { toast('This room no longer exists.'); leaveRoom(); return; }
  const g = r.game ? norm(r.game) : null;
  if (r.status === 'lobby' || !g) S.view = 'lobby';
  else {
    const seat = g.seats.findIndex(s => s.uid === S.uid);
    S.view = seat < 0 ? 'spectate' : (g.finished ? 'build' : 'draft');
  }
  render();
}
async function setSetting(key, value) {
  S.settings[key] = value;
  if (S.online && isHost()) { const F = await fb(); await F.update(roomRef(F, '/settings'), { [key]: value }); }
  else render();
}
async function startOnline() {
  const F = await fb();
  S.busy = true; render();
  try {
    await F.runTransaction(roomRef(F), r => {
      if (!r) return r;
      if (r.status !== 'lobby') return;
      const presence = r.presence || {};
      const humans = Object.entries(r.members || {})
        .map(([uid, m]) => ({ uid, name: (m && m.name) || 'Player', joined: (m && m.joined) || 0 }))
        .filter(m => presence[m.uid] !== false || m.uid === F.uid)
        .sort((a, b) => a.joined - b.joined);
      r.game = newGame(r.settings || DEFAULTS, humans);
      r.status = 'draft';
      return r;
    });
  } catch (e) { toast('Couldn’t start the draft. Try again.'); console.error(e); }
  S.busy = false; render();
}
async function newDraftSameRoom() {
  const F = await fb();
  await F.update(roomRef(F), { status: 'lobby', game: null });
}
async function takeHost() { const F = await fb(); await F.update(roomRef(F), { host: F.uid }); }
async function botTakeover(i) {
  const F = await fb();
  await F.runTransaction(roomRef(F, '/game'), g => {
    if (!g) return g; norm(g);
    if (g.finished || !g.seats[i] || g.seats[i].bot || g.done[i]) return;
    g.seats[i].bot = true; botsPick(g); advance(g); return g;
  });
}
async function reclaimSeat() {
  const F = await fb();
  await F.runTransaction(roomRef(F, '/game'), g => {
    if (!g) return g; norm(g);
    const i = g.seats.findIndex(s => s.uid === F.uid);
    if (i < 0 || !g.seats[i].bot) return;
    g.seats[i].bot = false; return g;
  });
}

/* ================= current game helpers ================= */
function game() { return S.online ? (S.room && S.room.game ? norm(S.room.game) : null) : S.practice; }
function mySeat(g) { return g ? g.seats.findIndex(s => s.uid === (S.online ? S.uid : 'me')) : -1; }
function isHost() { return !S.online || (S.room && S.room.host === S.uid); }
function presenceOf(uid) { const p = S.room && S.room.presence; return !p || p[uid] !== false; }

async function submitPick() {
  const g = game(); const seat = mySeat(g);
  if (!g || seat < 0 || S.busy) return;
  const ids = S.sel.slice();
  if (ids.length !== need(g, seat)) return;
  if (!S.online) {
    if (applyPick(g, seat, ids)) { advance(g); S.sel = []; S.focus = null; S.expanded = false; if (g.finished) enterBuild(); else render(); }
    return;
  }
  S.busy = true; render();
  try {
    const F = await fb();
    const res = await F.runTransaction(roomRef(F, '/game'), cur => {
      if (!cur) return cur; norm(cur);
      if (!applyPick(cur, seat, ids)) return;
      advance(cur); return cur;
    });
    if (!res.committed) toast('That pick didn’t go through. Try again.');
  } catch (e) { toast('Couldn’t send your pick. Check your connection and try again.'); console.error(e); }
  S.busy = false; S.sel = []; S.focus = null; S.expanded = false; render();
}

/* ================= deck building ================= */
function myPicks() { const g = game(); const i = mySeat(g); return g && i >= 0 ? g.picks[i].map((id, u) => ({ u, c: CARD.get(id) })).filter(p => p.c) : []; }
function deckKey(g) { return `ygo-drafter:deck:${g.id}`; }
function enterBuild() { S.view = 'build'; render(); }
function ensureDeck() {
  const g = game(); if (!g) return;
  if (S.deckId === g.id && S.deck) return;
  S.deckId = g.id; S.buildSel = null;
  const saved = store.get(deckKey(g));
  if (saved) { try { const d = JSON.parse(saved); S.deck = { main: new Set(d.main), extra: new Set(d.extra), side: new Set(d.side) }; return; } catch (_) {} }
  autoBuild();
}
function saveDeck() { const g = game(); if (!g || !S.deck) return; store.set(deckKey(g), JSON.stringify({ main: [...S.deck.main], extra: [...S.deck.extra], side: [...S.deck.side] })); }
function zoneOf(u) { for (const z of ['main', 'extra', 'side']) if (S.deck[z].has(u)) return z; return 'pool'; }
function autoBuild() {
  S.deck = { main: new Set(), extra: new Set(), side: new Set() };
  const picks = myPicks().sort((a, b) => (b.c.u + b.c.r * 4) - (a.c.u + a.c.r * 4));
  const count = new Map();
  const ok = p => (count.get(p.c.i) || 0) < MAXC[p.c.b];
  const add = (z, p) => { S.deck[z].add(p.u); count.set(p.c.i, (count.get(p.c.i) || 0) + 1); };
  for (const p of picks) if (p.c.k === 'F' && S.deck.extra.size < 15 && ok(p)) add('extra', p);
  const target = { M: 18, S: 13, T: 9 }, got = { M: 0, S: 0, T: 0 };
  for (const p of picks) { if (p.c.k === 'F' || S.deck.main.size >= 40) continue; if (got[p.c.k] < target[p.c.k] && ok(p)) { add('main', p); got[p.c.k]++; } }
  for (const p of picks) { if (S.deck.main.size >= 40) break; if (p.c.k === 'F' || S.deck.main.has(p.u)) continue; if (ok(p)) add('main', p); }
  saveDeck();
}
function moveTo(u, z) { for (const k of ['main', 'extra', 'side']) S.deck[k].delete(u); if (z !== 'pool') S.deck[z].add(u); saveDeck(); }
function fillSide() {
  const unused = myPicks().filter(p => zoneOf(p.u) === 'pool').sort((a, b) => b.c.u - a.c.u);
  let added = 0; for (const p of unused) { if (S.deck.side.size >= 15) break; S.deck.side.add(p.u); added++; }
  saveDeck(); render();
  toast(added ? `Moved ${added} unused picks to the side deck.` : 'No unused picks to move.');
}
function deckWarnings() {
  const m = new Map(myPicks().map(p => [p.u, p])); const cnt = new Map();
  for (const z of ['main', 'extra', 'side']) for (const u of S.deck[z]) { const c = m.get(u)?.c; if (c) cnt.set(c.i, (cnt.get(c.i) || 0) + 1); }
  const out = []; for (const [id, n] of cnt) { const c = CARD.get(id); if (n > MAXC[c.b]) out.push(`${c.n} (${n} copies, ${BAN_LABEL[c.b]} to ${MAXC[c.b]})`); }
  return out;
}
function ydkText() {
  const m = new Map(myPicks().map(p => [p.u, p]));
  const ids = z => [...S.deck[z]].map(u => m.get(u)?.c.i).filter(Boolean).sort((a, b) => a - b);
  let t = '#main\n'; ids('main').forEach(i => t += i + '\n');
  t += '#extra\n'; ids('extra').forEach(i => t += i + '\n');
  t += '!side\n'; ids('side').forEach(i => t += i + '\n');
  return t;
}
function downloadYdk() {
  const name = `ygo_drafter_${S.code ? S.code.toLowerCase() + '_' : ''}deck.ydk`;
  const url = URL.createObjectURL(new Blob([ydkText()], { type: 'application/octet-stream' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(`Downloaded ${name}.`);
}
async function copyText(t, okMsg, fallbackSel) {
  try { await navigator.clipboard.writeText(t); toast(okMsg); return; } catch (_) {}
  const el = fallbackSel && $(fallbackSel);
  if (el) { if (el.closest('details')) el.closest('details').open = true; el.focus(); el.select && el.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (_) {} toast(ok ? okMsg : 'Select the text and copy it.'); }
}

/* ================= view helpers ================= */
const ARROW_L = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H5m6-6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ARROW_R = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHECK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const DOTS = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2.2" fill="currentColor"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><circle cx="19" cy="12" r="2.2" fill="currentColor"/></svg>`;
const EYE = `<svg viewBox="0 0 120 64" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 26c18-16 58-20 90-4 8 4 14 6 18 6"/><path d="M14 30c14 10 42 12 64 2"/><circle cx="52" cy="24" r="9" fill="currentColor"/><path d="M50 34v14c0 6-6 10-12 8"/><path d="M62 33c8 8 14 18 26 22"/></g></svg>`;
const ZZ = (() => { const n = 14, top = [], bot = []; for (let i = 0; i <= n; i++) top.push(`${(i * 100 / n).toFixed(2)}% ${i % 2 ? 0 : 2.4}%`); for (let i = n; i >= 0; i--) bot.push(`${(i * 100 / n).toFixed(2)}% ${i % 2 ? 100 : 97.6}%`); return `polygon(${top.concat(bot).join(',')})`; })();
const packHTML = () => `<div class="pack"><div class="body" style="clip-path:${ZZ}"></div><div class="strip" style="clip-path:${ZZ}"></div><div class="label">${EYE}<span class="goat">GOAT</span><span class="yr">Format of 2005</span><span class="count">9 cards</span></div></div>`;
function cardHTML(p, { pressed = false, num = 0 } = {}) {
  const c = p.c || p; const u = p.u ?? '';
  return `<button class="card" type="button" data-u="${u}" data-id="${c.i}" data-r="${c.r}" aria-pressed="${pressed}" aria-label="${esc(c.n + ', ' + R_LABEL[c.r] + (c.b ? ', ' + BAN_LABEL[c.b] : ''))}">
    <img src="${IMG[c.i] || ''}" alt="" width="210" height="306" loading="lazy" decoding="async"><span class="foil"></span>${c.r ? `<span class="badge b${c.r}">${R_SHORT[c.r]}</span>` : ''}${c.b ? `<span class="limit" title="${BAN_LABEL[c.b]}">${MAXC[c.b]}</span>` : ''}${num ? `<span class="picknum">${num}</span>` : ''}</button>`;
}
function typeLine(c) {
  if (c.k === 'S') return `${c.race === 'Normal' ? '' : c.race + ' '}Spell`;
  if (c.k === 'T') return `${c.race === 'Normal' ? '' : c.race + ' '}Trap`;
  const t = c.t, parts = [c.race];
  if (t === 'Fusion Monster') parts.push('Fusion'); else if (t.startsWith('Ritual')) parts.push('Ritual');
  if (t.includes('Flip')) parts.push('Flip');
  if (t.startsWith('Union')) parts.push('Union');
  if (t.startsWith('Spirit')) parts.push('Spirit');
  if (t.startsWith('Toon')) parts.push('Toon');
  if (t.includes('Effect') || t.startsWith('Spirit') || t.startsWith('Toon')) parts.push('Effect');
  return `[${parts.join(' / ')}]`;
}
function detailHTML(c, actions = '') {
  const stats = (c.k === 'M' || c.k === 'F') ? `<p class="d-stats"><span>Level ${c.lv ?? '?'}, ${esc(c.at || '')}</span><span>ATK ${c.a ?? '?'} &nbsp; DEF ${c.d ?? '?'}</span></p>` : '';
  return `<div class="d-head"><img class="d-img" src="${IMG[c.i] || ''}" alt="${esc(c.n)}" width="210" height="306">
    <div class="d-info"><h2>${esc(c.n)}</h2><div class="d-tags"><span class="pill">${R_LABEL[c.r]}</span>${c.b ? `<span class="pill ban">${BAN_LABEL[c.b]}</span>` : ''}</div>
    <p class="d-type">${esc(typeLine(c))}</p>${stats}</div></div>
    <p class="d-text">${esc(c.x)}</p>
    <p class="d-foot">First printed in ${esc(c.s)}. Played in ${Math.round(100 * c.u / DECKS_SAMPLED)}% of ${DECKS_SAMPLED} GOAT decklists.</p>
    <div class="actions">${actions}<button class="ghost more" type="button" data-act="more">Card text</button><button class="ghost close" type="button" data-act="close">Close</button></div>`;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3800); }
function listNames(names) { return names.length <= 1 ? (names[0] || '') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]; }

function settingsHTML(st, editable, online, humans = 1) {
  const dis = editable ? '' : 'disabled';
  const seg = (key, opts) => `<div class="seg" role="radiogroup">${opts.map(([v, l]) => `<label><input type="radio" name="set-${key}" value="${v}" ${String(st[key]) === String(v) ? 'checked' : ''} ${dis}><span>${l}</span></label>`).join('')}</div>`;
  const minB = online ? 0 : 1, maxB = MAX_SEATS - humans;
  const bots = Math.max(minB, Math.min(maxB, typeof st.bots === 'number' ? st.bots : 3));
  const turns = Math.ceil(9 / st.perPick) * st.packs;
  return `<div class="settings ${editable ? '' : 'readonly'}">
    <div class="field"><div class="lbl">Bots<small>${online ? 'Bots take the seats your friends don’t' : 'Bots take the other seats'}</small></div>
      <div class="stepper"><button type="button" data-set="bots" data-d="-1" aria-label="Fewer bots" ${dis || (bots <= minB ? 'disabled' : '')}>−</button><output>${bots}</output><button type="button" data-set="bots" data-d="1" aria-label="More bots" ${dis || (bots >= maxB ? 'disabled' : '')}>+</button></div></div>
    <div class="field"><div class="lbl">Packs each<small>${st.packs * 9} cards each, ${turns} turns</small></div>
      <div class="stepper"><button type="button" data-set="packs" data-d="-1" aria-label="Fewer packs" ${dis || (st.packs <= 1 ? 'disabled' : '')}>−</button><output>${st.packs}</output><button type="button" data-set="packs" data-d="1" aria-label="More packs" ${dis || (st.packs >= 10 ? 'disabled' : '')}>+</button></div></div>
    <div class="field"><div class="lbl">Cards per pick<small>${st.perPick === 2 ? 'Take 2 each turn, twice as fast' : 'Take 1 each turn, like Magic'}</small></div>${seg('perPick', [[1, '1'], [2, '2']])}</div>
    <div class="field"><div class="lbl">Rarity odds<small>${st.odds === 'arena' ? 'Every slot rolls 50/30/15/5' : '8 commons and 1 rare slot per pack'}</small></div>${seg('odds', [['booster', '2005 boosters'], ['arena', 'Arena']])}</div>
  </div>`;
}

/* ================= screens ================= */
function setBar(statusHTML, actions) {
  $('#status').innerHTML = statusHTML || '';
  $('#barActions').innerHTML = [`<button class="ghost" type="button" data-act="pool">Card pool</button>`].concat(actions || []).join('');
}
function render() {
  if (S.view !== 'draft') S.lastSig = null;
  if (!POOL.length) { $('#app').innerHTML = '<p class="loading">The card data didn’t load. Refresh the page to try again.</p>'; return; }
  const v = S.view;
  if (v === 'home') renderHome();
  else if (v === 'practice') renderPracticeSetup();
  else if (v === 'lobby') renderLobby();
  else if (v === 'spectate') renderSpectate();
  else if (v === 'draft') renderDraft();
  else if (v === 'build') renderBuild();
}
function renderHome() {
  setBar('', []);
  if (S.connecting) { $('#app').innerHTML = `<p class="loading">Connecting to room ${esc(S.pendingCode || '')}…</p>`; return; }
  const name = myName(); const code = S.pendingCode;
  const err = S.error ? `<p class="err" role="alert">${esc(S.error)}</p>` : '';
  const nameInput = `<input class="text" id="nameIn" maxlength="20" autocomplete="nickname" value="${esc(name)}" placeholder="For example, Kaiba">`;
  let body;
  if (code) {
    body = `<h2>Join room ${esc(code)}</h2>
      <p class="lede">Pick the username everyone at the table will see.</p>
      <div class="block"><h3><label for="nameIn">Your username for this draft</label></h3>${nameInput}
        <div class="row"><button class="cta" type="button" data-act="join-pending">Join room ${esc(code)}</button><button class="linkish" type="button" data-act="forget-code">Not this room</button></div></div>${err}`;
  } else if (!name || S.editName) {
    body = `<h2>${name ? 'Change your username' : 'First, pick a username'}</h2>
      <p class="lede">It’s the name your friends see at the table. You can change it for each draft.</p>
      <div class="block"><h3><label for="nameIn">Username</label></h3>${nameInput}
        <div class="row"><button class="cta" type="button" data-act="save-name">${name ? 'Save' : 'Continue'}</button>${name ? '<button class="linkish" type="button" data-act="cancel-name">Cancel</button>' : ''}</div></div>${err}`;
  } else {
    body = `<h2>Draft a GOAT deck with your friends</h2>
      <p class="lede">Open a pack, keep a card, pass the rest. ${POOL.length} cards people actually play in GOAT, each at the rarity it was first printed in.</p>
      <p class="playing">Playing as ${esc(name)}. <button class="linkish" type="button" data-act="edit-name">Change username</button></p>
      <div class="block"><h3>Host a draft</h3><p>Create a room, send the invite link, and start when everyone’s in.</p><div class="row"><button class="cta" type="button" data-act="create">Create a room</button></div></div>
      <div class="block"><h3><label for="codeIn">Join with a code</label></h3><div class="row"><input class="text code" id="codeIn" maxlength="4" autocomplete="off" placeholder="ABCD"><button class="ghost" type="button" data-act="join">Join</button></div></div>
      <div class="block"><h3>Practice</h3><p>Draft alone against bots. Nothing goes online.</p><div class="row"><button class="ghost" type="button" data-act="practice">Practice vs bots</button></div></div>${err}`;
  }
  $('#app').innerHTML = `<section class="home"><div class="hero-pack">${packHTML()}</div><div>${body}</div></section>`;
}
function renderPracticeSetup() {
  setBar('<span>Practice vs bots</span>', [`<button class="ghost" type="button" data-act="home">Back</button>`]);
  $('#app').innerHTML = `<section class="home">
    <div class="hero-pack">${packHTML()}</div>
    <div><h2>Practice draft</h2><p class="lede">Same packs and rules as a live room, with bots in the other seats.</p>
      ${settingsHTML(S.settings, true, false, 1)}
      <div class="row" style="margin-top:22px"><button class="cta" type="button" data-act="start-practice">Open your first pack</button></div></div></section>`;
}
function lobbyMembers() {
  return Object.entries((S.room && S.room.members) || {}).map(([uid, m]) => ({ uid, name: (m && m.name) || 'Player', joined: (m && m.joined) || 0 })).sort((a, b) => a.joined - b.joined);
}
function humansInLobby() { return S.online && S.room ? lobbyMembers().filter(m => presenceOf(m.uid)).length : 1; }
function renderLobby() {
  const typed = $('#renameIn') ? $('#renameIn').value : null;
  const r = S.room; const st = Object.assign({}, DEFAULTS, r.settings || {});
  if (typeof st.bots !== 'number') st.bots = 3;
  S.settings = { ...st };
  const members = lobbyMembers(); const host = isHost(); const hostOnline = presenceOf(r.host);
  const humans = members.filter(m => presenceOf(m.uid)).length;
  const bots = Math.max(0, Math.min(MAX_SEATS - humans, st.bots));
  const seatsN = humans + bots;
  const link = `${location.origin}${location.pathname}?room=${S.code}`;
  const hostName = (r.members && r.members[r.host] && r.members[r.host].name) || 'the host';
  setBar(`<span>Room ${esc(S.code)}</span>`, [`<button class="ghost" type="button" data-act="leave">Leave</button>`]);
  const row = m => {
    const on = presenceOf(m.uid), me = m.uid === S.uid;
    if (me && S.renaming) return `<li><span class="dot on"></span><span class="me-edit"><input class="text" id="renameIn" maxlength="20" value="${esc(typed ?? m.name)}" aria-label="Your username for this draft"><button class="ghost" type="button" data-act="rename-save">Save</button><button class="linkish" type="button" data-act="rename-cancel">Cancel</button></span></li>`;
    return `<li><span class="dot ${on ? 'on' : ''}" title="${on ? 'Online' : 'Offline'}"></span>${esc(m.name)}${m.uid === r.host ? ' <span class="tag">Host</span>' : ''}${me ? ' <span class="tag">You</span> <button class="linkish" type="button" data-act="rename">Change name</button>' : ''}${on ? '' : ' <span class="tag">Offline</span>'}</li>`;
  };
  const tooMany = humans > MAX_SEATS;
  $('#app').innerHTML = `<section class="lobby"><div>
      <p class="lede" style="margin:0">Room code</p>
      <p class="roomcode">${esc(S.code)}</p>
      <div class="invite"><button class="cta" type="button" data-act="copy-link">Copy invite link</button><code id="inviteLink">${esc(link)}</code></div>
      <h3>Players (${humans})</h3>
      <ul class="people">${members.map(row).join('')}</ul>
      ${S.error ? `<p class="err" role="alert" style="margin-top:10px">${esc(S.error)}</p>` : ''}
      <p class="summary">${humans} player${humans === 1 ? '' : 's'} and ${bots} bot${bots === 1 ? '' : 's'}: ${seatsN} seats, ${st.packs * 9} cards each.</p>
      ${host ? `<div class="row" style="margin-top:14px"><button class="cta" type="button" data-act="start-online" ${S.busy || seatsN < 2 || tooMany ? 'disabled' : ''}>Start the draft</button></div>
        <p class="waitnote">${tooMany ? `The table holds ${MAX_SEATS}. Ask someone to leave first.` : seatsN < 2 ? 'Add a bot or wait for a friend. A draft needs at least 2 seats.' : 'Seats are shuffled when you start. Anyone who joins after that can only watch.'}</p>`
      : `<p class="waitnote">Waiting for ${esc(hostName)} to start the draft.</p>${hostOnline ? '' : '<div class="row" style="margin-top:10px"><span class="err">The host is offline.</span><button class="ghost" type="button" data-act="take-host">Take over as host</button></div>'}`}
    </div>
    <div><h3>Draft settings</h3>${settingsHTML(st, host, true, humans)}${host ? '' : '<p class="waitnote">Only the host can change these.</p>'}</div>
  </section>`;
  if (S.renaming) { const i = $('#renameIn'); if (i) { i.focus(); if (typed == null) i.select(); else i.setSelectionRange(i.value.length, i.value.length); } }
}
function renderSpectate() {
  const g = game();
  setBar(`<span>Room ${esc(S.code)}</span>`, [`<button class="ghost" type="button" data-act="leave">Leave</button>`]);
  $('#app').innerHTML = `<section class="lobby"><div><h2 class="roomcode" style="font-size:40px">Draft in progress</h2>
    <p class="lede">This draft started before you joined, so there’s no seat for you. Ask the host to start a new one when it ends.</p>
    ${g ? `<ul class="seats">${g.seats.map(s => `<li>${esc(s.name)}</li>`).join('')}</ul>` : ''}</div></section>`;
}
function renderDraft() {
  const g = game(); const me = mySeat(g);
  if (!g || me < 0) { S.view = S.online ? (S.room && S.room.game ? 'spectate' : 'lobby') : 'home'; render(); return; }
  if (g.finished) { enterBuild(); return; }
  const pack = g.packs[me], picks = g.picks[me], n = need(g, me), done = g.done[me];
  const key = `${g.id}:${g.round}:${g.turn}`;
  let anim = null;
  if (S.lastKey !== key) {
    const prev = S.lastKey ? S.lastKey.split(':') : null;
    anim = !prev || prev[0] !== g.id || +prev[1] !== g.round ? 'open' : (g.round % 2 === 0 ? 'from-right' : 'from-left');
    S.lastKey = key; S.sel = []; S.focus = null; S.expanded = false;
  }
  S.sel = S.sel.filter(id => pack.includes(id));
  const d = g.round % 2 === 0 ? 1 : -1;
  const actions = S.online ? [`<button class="ghost" type="button" data-act="leave">Leave</button>`] : [`<button class="ghost" type="button" data-act="restart">Start over</button>`];
  setBar(`<span>Pack ${g.round + 1} of ${g.settings.packs}, pick ${g.turn + 1}</span><span class="dir">${d === 1 ? ARROW_L : ARROW_R}Passing ${d === 1 ? 'left' : 'right'}</span>`, actions);
  const order = g.seats.map((_, k) => (me + k * d + g.seats.length * 8) % g.seats.length);
  const waitingOn = g.seats.map((s, i) => ({ s, i })).filter(x => !g.done[x.i] && x.i !== me);
  const host = isHost();
  const seatsHTML = `<ul class="seats" aria-label="Seats in passing order">${order.map(i => { const s = g.seats[i]; const off = S.online && !s.bot && !presenceOf(s.uid);
    return `<li class="${i === me ? 'me' : ''} ${off ? 'off' : ''}"><span class="${g.done[i] ? 'ok' : 'wait'}">${g.done[i] ? CHECK : DOTS}</span>${esc(i === me ? 'You' : s.name)}${s.bot && s.uid ? ' (bot)' : ''}</li>`; }).join('')}</ul>`;
  const reclaim = S.online && g.seats[me].bot ? `<div class="waitbar">A bot is picking for you. <button class="ghost" type="button" data-act="reclaim">Take my seat back</button></div>` : '';
  const waitbar = done && waitingOn.length ? `<div class="waitbar"><span>Waiting for ${esc(listNames(waitingOn.map(x => x.s.name)))}.</span>
      ${waitingOn.filter(x => !x.s.bot && (host || !presenceOf(x.s.uid))).map(x => `<button class="ghost" type="button" data-act="bot-for" data-seat="${x.i}">Let a bot pick for ${esc(x.s.name)}</button>`).join('')}</div>` : '';
  const hint = done ? 'Your pick is in.' : (n === 2 ? `Pick 2 cards. ${S.sel.length} of 2 chosen.` : 'Tap a card, then pick it.');
  const focus = S.focus != null ? CARD.get(S.focus) : null;
  let act = '';
  if (!done && focus) {
    if (n === 1) act = `<button class="cta" type="button" data-act="pick" ${S.busy ? 'disabled' : ''}>Pick ${esc(focus.n)}</button><p class="hint">Or tap the card again.</p>`;
    else act = `<ul class="chosen">${S.sel.map((id, k) => `<li>${k + 1}. ${esc(CARD.get(id).n)}</li>`).join('')}</ul><button class="cta" type="button" data-act="pick" ${S.sel.length === n && !S.busy ? '' : 'disabled'}>${S.sel.length === n ? 'Pick these 2' : `Choose ${n - S.sel.length} more`}</button>`;
  }
  const sig = [key, done, S.sel.join(','), S.focus, S.busy, S.expanded, picks.length, g.seats[me].bot, wide()].join('|');
  if (!anim && S.lastSig === sig && $('#packGrid') && $('#seatsWrap')) {
    $('#seatsWrap').innerHTML = seatsHTML; $('#waitWrap').innerHTML = reclaim + waitbar;
    return;
  }
  S.lastSig = sig;
  const groups = { M: 0, S: 0, T: 0, F: 0 }; picks.forEach(id => { const c = CARD.get(id); if (c) groups[c.k]++; });
  $('#app').innerHTML = `<section class="draft"><div>
      <div id="seatsWrap">${seatsHTML}</div><div id="waitWrap">${reclaim}${waitbar}</div>
      <div class="table" id="table">
        <div class="table-head"><h2>Your pack</h2><p>${pack.length} card${pack.length === 1 ? '' : 's'} left. ${hint}</p></div>
        <div class="grid ${anim && anim !== 'open' ? anim : ''} ${done ? 'waiting' : ''}" id="packGrid">${pack.map(id => { const k = S.sel.indexOf(id); return cardHTML({ u: id, c: CARD.get(id) }, { pressed: k >= 0, num: n === 2 && k >= 0 ? k + 1 : 0 }); }).join('')}</div>
      </div>
      <div class="picks"><div class="picks-head"><h3>Your picks</h3><div class="tally"><span>${picks.length} total</span><span>${groups.M} monsters</span><span>${groups.S} spells</span><span>${groups.T} traps</span><span>${groups.F} fusions</span></div></div>
        ${picks.length ? `<div class="strip">${picks.slice().reverse().map(id => cardHTML({ u: 'p' + id, c: CARD.get(id) })).join('')}</div>` : '<p class="empty">Nothing yet. Your first pick lands here.</p>'}</div>
      <div class="sheet-pad"></div></div>
    <aside class="detail ${S.expanded ? 'expanded' : ''}" id="detail" ${focus || wide() ? '' : 'hidden'}>
      ${focus ? detailHTML(focus, act) : `<p class="detail-empty">${done ? 'Your pick is in. The next pack arrives when everyone has picked.' : 'Tap a card to read it here.'}</p>`}
    </aside></section>`;
  if (anim === 'open') playOpen();
}
function playOpen() {
  const table = $('#table'), grid = $('#packGrid');
  if (reduceMotion || !table || !grid) return;
  const cards = [...grid.children]; cards.forEach(c => c.style.opacity = '0');
  const ov = document.createElement('div'); ov.className = 'opening'; ov.innerHTML = packHTML(); table.appendChild(ov);
  let done = false;
  const finish = () => { if (done) return; done = true; cards.forEach(c => { c.style.transition = ''; c.style.transform = ''; c.style.opacity = ''; }); ov.remove(); table.removeEventListener('pointerdown', finish); };
  table.addEventListener('pointerdown', finish);
  setTimeout(() => ov.classList.add('torn'), 260);
  setTimeout(() => {
    if (done || !ov.isConnected) return;
    const pr = ov.querySelector('.pack').getBoundingClientRect(); const cx = pr.left + pr.width / 2, cy = pr.top + pr.height / 2;
    ov.classList.add('gone');
    cards.forEach((el, i) => { const r = el.getBoundingClientRect(); el.style.transition = 'none'; el.style.transform = `translate(${cx - (r.left + r.width / 2)}px,${cy - (r.top + r.height / 2)}px) scale(.42) rotate(${(i - 4) * 3}deg)`; el.style.opacity = '1'; });
    grid.getBoundingClientRect();
    cards.forEach((el, i) => { el.style.transition = `transform .5s cubic-bezier(.2,.8,.2,1) ${i * 55}ms`; el.style.transform = 'none'; });
    setTimeout(finish, 520 + cards.length * 55 + 60);
  }, 620);
}
function renderBuild() {
  const g = game(); if (!g || mySeat(g) < 0) { S.view = S.online ? 'lobby' : 'home'; render(); return; }
  ensureDeck();
  const picks = myPicks(); const m = new Map(picks.map(p => [p.u, p]));
  const zones = { main: [], extra: [], side: [], pool: [] };
  picks.forEach(p => zones[zoneOf(p.u)].push(p));
  const ord = p => ({ M: 0, S: 1, T: 2, F: 3 }[p.c.k] * 100000 - (p.c.k === 'M' ? (p.c.lv || 0) * 1000 : 0));
  for (const z in zones) zones[z].sort((a, b) => ord(a) - ord(b) || a.c.n.localeCompare(b.c.n));
  const mainN = zones.main.length, exN = zones.extra.length, sdN = zones.side.length;
  const warns = deckWarnings(); const sel = S.buildSel != null ? m.get(S.buildSel) : null;
  const actions = [];
  if (S.online && isHost()) actions.push(`<button class="ghost" type="button" data-act="new-draft">New draft</button>`);
  actions.push(S.online ? `<button class="ghost" type="button" data-act="leave">Leave</button>` : `<button class="ghost" type="button" data-act="restart">Start over</button>`);
  setBar('<span>Build your deck</span>', actions);
  const zoneBlock = (key, title, note, list, dim) => `<section class="zone"><h3>${title}<span>${note}</span></h3>${list.length ? `<div class="zgrid ${dim ? 'dim' : ''}">${list.map(p => cardHTML(p, { pressed: p.u === S.buildSel })).join('')}</div>` : `<p class="empty">${key === 'pool' ? 'Every pick is in your deck.' : 'Empty.'}</p>`}</section>`;
  let act = '';
  if (sel) {
    const z = zoneOf(sel.u), isF = sel.c.k === 'F', home = isF ? 'extra' : 'main';
    if (z === 'pool') act = `<button class="cta" type="button" data-act="to-${home}">Add to ${home} deck</button><button class="ghost" type="button" data-act="to-side">Add to side deck</button>`;
    else if (z === 'side') act = `<button class="cta" type="button" data-act="to-${home}">Move to ${home} deck</button><button class="ghost" type="button" data-act="to-pool">Take out of side deck</button>`;
    else act = `<button class="cta" type="button" data-act="to-pool">Take out of deck</button><button class="ghost" type="button" data-act="to-side">Move to side deck</button>`;
  }
  $('#app').innerHTML = `<section class="build"><div>
    ${readyHTML(g)}
    <div class="buildbar"><span class="count ${mainN >= 40 && mainN <= 60 ? 'ok' : 'bad'}">Main ${mainN} / 40</span><span class="count ${exN <= 15 ? '' : 'bad'}">Extra ${exN}</span><span class="count ${sdN <= 15 ? '' : 'bad'}">Side ${sdN}</span><span class="spacer"></span>
      <button class="ghost" type="button" data-act="auto">Rebuild automatically</button><button class="ghost" type="button" data-act="fillside">Fill side from unused</button></div>
    ${warns.length ? `<p class="warn">Over the GOAT limit: ${warns.map(esc).join('; ')}.</p>` : ''}
    ${zoneBlock('main', 'Main deck', `${mainN} cards, needs 40 to 60`, zones.main)}
    ${zoneBlock('extra', 'Extra deck', `${exN} fusions`, zones.extra)}
    ${zoneBlock('side', 'Side deck', `${sdN} of 15`, zones.side)}
    ${zoneBlock('pool', 'Unused picks', `${zones.pool.length} cards`, zones.pool, true)}
    <section class="export"><h3>Export</h3>
      <p>Same layout as a YGOPRODeck .ydk: #main, #extra and !side, one card ID per line, sorted by ID. Load it in DuelingBook, EDOPro or YGOPRODeck.</p>
      <div class="row"><button class="cta" type="button" data-act="download" ${mainN ? '' : 'disabled'}>Download .ydk</button><button class="ghost" type="button" data-act="copy" ${mainN ? '' : 'disabled'}>Copy text</button></div>
      <details><summary>Preview the file</summary><textarea id="ydkPreview" readonly spellcheck="false">${esc(ydkText())}</textarea></details></section>
    <div class="sheet-pad"></div></div>
    <aside class="detail ${S.expanded ? 'expanded' : ''}" id="detail" ${sel || wide() ? '' : 'hidden'}>
      ${sel ? detailHTML(sel.c, act) : '<p class="detail-empty">Tap a card to see it and move it between your deck, side deck and unused picks.</p>'}</aside></section>`;
}

function readyInfo(g) {
  const rd = (S.room && S.room.ready && S.room.ready[g.id]) || {};
  const people = g.seats.filter(s => s.uid);
  const waiting = people.filter(s => rd[s.uid] !== true);
  return { rd, people, waiting, all: waiting.length === 0, meReady: rd[S.uid] === true };
}
function readyHTML(g) {
  if (!S.online) return '';
  const { rd, people, waiting, all, meReady } = readyInfo(g);
  const names = waiting.map(s => s.uid === S.uid ? 'you' : s.name);
  const chips = people.map(s => `<li class="${s.uid === S.uid ? 'me' : ''}"><span class="${rd[s.uid] === true ? 'ok' : 'wait'}">${rd[s.uid] === true ? CHECK : DOTS}</span>${esc(s.uid === S.uid ? 'You' : s.name)}</li>`).join('');
  return `<div class="roomstatus ${all ? 'allready' : ''}" id="readyPanel">
    <p>${all ? 'Everyone is ready. Load your .ydk in DuelingBook and start dueling.' : `Deck building: ${people.length - waiting.length} of ${people.length} ready. Waiting for ${esc(listNames(names))}.`}</p>
    <ul class="seats">${chips}</ul>
    <div class="row">${meReady ? `<span class="okline">${CHECK}You’re ready.</span><button class="ghost" type="button" data-act="unready">Keep editing</button>` : `<button class="cta" type="button" data-act="ready">I’m done building</button><span class="waitnote" style="margin:0">Download your .ydk first, then tap this.</span>`}</div>
  </div>`;
}

/* ================= card pool viewer ================= */
function renderPool() {
  $('#poolCount').textContent = `${POOL.length} cards`;
  $('#poolChips').innerHTML = [`<button class="chip" type="button" data-pf="-1" aria-pressed="${S.poolFilter === -1}">All ${POOL.length}</button>`]
    .concat(R_LABEL.map((l, i) => `<button class="chip" type="button" data-pf="${i}" aria-pressed="${S.poolFilter === i}">${l} ${BY_R[i].length}</button>`)).join('');
  const list = (S.poolFilter < 0 ? POOL : BY_R[S.poolFilter]).slice().sort((a, b) => b.r - a.r || b.u - a.u);
  $('#poolBody').innerHTML = `<div class="zgrid">${list.map(c => cardHTML(c)).join('')}</div>`;
}
function openPool() { renderPool(); $('#poolModal').hidden = false; $('#poolClose').focus(); }
function closePool() { $('#poolModal').hidden = true; }

/* ================= events ================= */
async function guarded(fn) {
  S.error = ''; S.busy = true;
  try { await fn(); } catch (e) { console.error(e); S.error = e && e.message && !/firebase|permission|network|fetch/i.test(e.message) ? e.message : 'Couldn’t reach the server. Check your connection and try again.'; if (!S.online) S.view = 'home'; }
  S.busy = false; render();
}
function readName(sel) {
  const el = $(sel); const v = ((el && el.value) || '').trim().replace(/\s+/g, ' ');
  if (!v) { S.error = 'Type a username first.'; render(); const i = $(sel); i && i.focus(); return null; }
  return v.slice(0, 20);
}
document.addEventListener('click', e => {
  const t = e.target;
  const setBtn = t.closest('[data-set]');
  if (setBtn && !setBtn.disabled) {
    const k = setBtn.dataset.set, d = +setBtn.dataset.d;
    const lim = k === 'bots' ? [S.online ? 0 : 1, MAX_SEATS - humansInLobby()] : [1, 10];
    const cur = typeof S.settings[k] === 'number' ? S.settings[k] : DEFAULTS[k];
    setSetting(k, Math.max(lim[0], Math.min(lim[1], cur + d))); return;
  }
  const chip = t.closest('[data-pf]'); if (chip) { S.poolFilter = +chip.dataset.pf; renderPool(); return; }
  if (t.closest('#poolClose')) { closePool(); return; }
  const a = t.closest('[data-act]')?.dataset.act;
  if (a) {
    if (a === 'pool') return openPool();
    if (a === 'create') { guarded(createRoom); return; }
    if (a === 'join') { const c = ($('#codeIn').value || '').trim().toUpperCase(); if (!/^[A-Z]{4}$/.test(c)) { S.error = 'Room codes are 4 letters.'; render(); return; } guarded(() => joinRoom(c, myName())); return; }
    if (a === 'join-pending') { const v = readName('#nameIn'); if (v) guarded(() => joinRoom(S.pendingCode, v)); return; }
    if (a === 'forget-code') { S.pendingCode = null; S.error = ''; history.replaceState(null, '', location.pathname); render(); return; }
    if (a === 'save-name') { const v = readName('#nameIn'); if (v) { store.set(NAME_KEY, v); S.editName = false; S.error = ''; render(); } return; }
    if (a === 'edit-name') { S.editName = true; S.error = ''; render(); $('#nameIn') && $('#nameIn').focus(); return; }
    if (a === 'cancel-name') { S.editName = false; S.error = ''; render(); return; }
    if (a === 'rename') { S.renaming = true; S.error = ''; render(); return; }
    if (a === 'rename-cancel') { S.renaming = false; S.error = ''; render(); return; }
    if (a === 'rename-save') { const v = readName('#renameIn'); if (v) guarded(async () => { await renameMe(v); S.renaming = false; }); return; }
    if (a === 'ready') { setReady(true).catch(() => toast('Couldn’t mark you ready. Try again.')); return; }
    if (a === 'unready') { setReady(false).catch(() => {}); return; }
    if (a === 'practice') { S.error = ''; S.settings = { ...DEFAULTS, ...S.settings, bots: true }; S.view = 'practice'; render(); return; }
    if (a === 'home') { S.view = 'home'; render(); return; }
    if (a === 'start-practice') { S.practice = newGame({ ...S.settings, bots: true }, [{ uid: 'me', name: 'You' }]); S.lastKey = null; S.view = 'draft'; render(); return; }
    if (a === 'start-online') { startOnline(); return; }
    if (a === 'copy-link') { copyText(`${location.origin}${location.pathname}?room=${S.code}`, 'Invite link copied.', null); return; }
    if (a === 'leave') { leaveRoom(); return; }
    if (a === 'take-host') { takeHost(); return; }
    if (a === 'new-draft') {
      const b = t.closest('[data-act]');
      if (b.dataset.armed === 'true') { newDraftSameRoom(); return; }
      const g = game(); const w = g ? readyInfo(g).waiting.filter(s => s.uid !== S.uid).map(s => s.name) : [];
      b.dataset.armed = 'true'; b.textContent = w.length ? `Tap again: ${listNames(w)} still building` : 'Tap again to start a new draft';
      setTimeout(() => { b.dataset.armed = 'false'; b.textContent = 'New draft'; }, 4000); return;
    }
    if (a === 'restart') { const b = t.closest('[data-act]'); if (b.dataset.armed === 'true') { S.practice = null; S.view = 'practice'; S.deck = null; S.deckId = null; render(); } else { b.dataset.armed = 'true'; b.textContent = 'Tap again to start over'; setTimeout(() => { b.dataset.armed = 'false'; b.textContent = 'Start over'; }, 3000); } return; }
    if (a === 'pick') { submitPick(); return; }
    if (a === 'bot-for') { botTakeover(+t.closest('[data-act]').dataset.seat); return; }
    if (a === 'reclaim') { reclaimSeat(); return; }
    if (a === 'more') { S.expanded = !S.expanded; $('#detail').classList.toggle('expanded', S.expanded); return; }
    if (a === 'close') { S.focus = null; S.buildSel = null; S.expanded = false; if (S.view === 'draft') S.sel = []; render(); return; }
    if (a === 'auto') { autoBuild(); S.buildSel = null; render(); toast('Rebuilt a 40-card deck from your strongest picks.'); return; }
    if (a === 'fillside') { fillSide(); return; }
    if (a === 'download') { downloadYdk(); return; }
    if (a === 'copy') { copyText(ydkText(), 'Copied the .ydk text.', '#ydkPreview'); return; }
    if (a.startsWith('to-') && S.buildSel != null) { moveTo(S.buildSel, a.slice(3)); S.buildSel = null; S.expanded = false; render(); return; }
  }
  const card = t.closest('.card');
  if (!card || card.closest('#poolBody')) return;
  if (S.view === 'draft' && card.closest('#packGrid')) {
    const g = game(); const me = mySeat(g); if (!g || me < 0 || g.done[me] || S.busy) return;
    const id = +card.dataset.id, n = need(g, me);
    if (n === 1) {
      if (S.sel[0] === id && S.focus === id) { submitPick(); return; }
      S.sel = [id];
    } else {
      const k = S.sel.indexOf(id);
      if (k >= 0 && S.focus === id) S.sel.splice(k, 1);
      else if (k < 0) { S.sel.push(id); if (S.sel.length > n) S.sel.shift(); }
    }
    S.focus = id; S.expanded = false; renderDraft();
    const again = document.querySelector(`#packGrid .card[data-id="${id}"]`); again && again.focus({ preventScroll: true });
    return;
  }
  if (S.view === 'draft' && card.closest('.strip')) { const c = CARD.get(+card.dataset.id); const d = $('#detail'); if (c && d) { d.hidden = false; d.innerHTML = detailHTML(c); } return; }
  if (S.view === 'build') {
    const u = +card.dataset.u; S.buildSel = S.buildSel === u ? null : u; S.expanded = false; renderBuild();
    const again = document.querySelector(`.zgrid .card[data-u="${u}"]`); again && again.focus({ preventScroll: true });
  }
});
document.addEventListener('change', e => {
  const n = e.target.name || '';
  if (n.startsWith('set-')) { const k = n.slice(4); let v = e.target.value; if (k === 'perPick') v = +v; if (k === 'bots') v = v === 'true'; setSetting(k, v); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (!$('#poolModal').hidden) { closePool(); return; } if (S.focus != null || S.buildSel != null) { S.focus = null; S.buildSel = null; if (S.view === 'draft') S.sel = []; render(); } }
  if (e.key === 'Enter' && e.target.id === 'codeIn') document.querySelector('[data-act="join"]')?.click();
  if (e.key === 'Enter' && e.target.id === 'nameIn') document.querySelector('[data-act="join-pending"],[data-act="save-name"]')?.click();
  if (e.key === 'Enter' && e.target.id === 'renameIn') document.querySelector('[data-act="rename-save"]')?.click();
  if (e.key === 'Escape' && e.target.id === 'renameIn') document.querySelector('[data-act="rename-cancel"]')?.click();
});
document.addEventListener('dblclick', e => {
  const card = e.target.closest('.card'); if (!card || S.view !== 'build' || card.closest('#poolBody')) return;
  const u = +card.dataset.u; const p = myPicks().find(x => x.u === u); if (!p) return;
  moveTo(u, zoneOf(u) === 'pool' ? (p.c.k === 'F' ? 'extra' : 'main') : 'pool'); S.buildSel = null; render();
});
$('#poolModal').addEventListener('click', e => { if (e.target.id === 'poolModal') closePool(); });

/* ================= boot ================= */
window.__ygoDeleteMe = async () => (await fb()).deleteMe();
const bar = document.querySelector('.bar');
const setBarH = () => document.documentElement.style.setProperty('--bar-h', bar.offsetHeight + 'px');
if ('ResizeObserver' in window) new ResizeObserver(setBarH).observe(bar); setBarH();
const params = new URLSearchParams(location.search);
const urlCode = (params.get('room') || '').toUpperCase();
if (/^[A-Z]{4}$/.test(urlCode)) { S.pendingCode = urlCode; bootRoom(urlCode); } else render();
