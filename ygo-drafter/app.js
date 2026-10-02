/* YGO Drafter: live Yu-Gi-Oh! drafts (Duelist Kingdom, GOAT, Edison). */
const V = 18;
const HOME_PACKS = [["dk","LOB","Legend of Blue Eyes White Dragon","2002"],["dk","MRD","Metal Raiders","2002"],["goat","MRL","Magic Ruler","2002"],["goat","PSV","Pharaoh's Servant","2002"],["goat","LON","Labyrinth of Nightmare","2003"],["goat","LOD","Legacy of Darkness","2003"],["goat","PGD","Pharaonic Guardian","2003"],["goat","MFC","Magician's Force","2003"],["goat","DCR","Dark Crisis","2003"],["goat","IOC","Invasion of Chaos","2004"],["goat","AST","Ancient Sanctuary","2004"],["goat","EP1","Exclusive Pack","2004"],["goat","SOD","Soul of the Duelist","2004"],["goat","RDS","Rise of Destiny","2004"],["goat","FET","Flaming Eternity","2005"],["goat","TLM","The Lost Millennium","2005"],["edison","CRV","Cybernetic Revolution","2005"],["edison","EEN","Elemental Energy","2005"],["edison","DP2","Duelist Pack: Chazz Princeton","2006"],["edison","DP1","Duelist Pack: Jaden Yuki","2006"],["edison","SOI","Shadow of Infinity","2006"],["edison","EOJ","Enemy of Justice","2006"],["edison","POTD","Power of the Duelist","2006"],["edison","CDIP","Cyberdark Impact","2006"],["edison","DP05","Duelist Pack: Aster Phoenix","2007"],["edison","DP03","Duelist Pack: Jaden Yuki 2","2007"],["edison","STON","Strike of Neos","2007"],["edison","DP04","Duelist Pack: Zane Truesdale","2007"],["edison","FOTB","Force of the Breaker","2007"],["edison","PP01","Premium Pack (TCG)","2007"],["edison","TAEV","Tactical Evolution","2007"],["edison","GLAS","Gladiator's Assault","2007"],["edison","DP06","Duelist Pack: Jaden Yuki 3","2008"],["edison","DP07","Duelist Pack: Jesse Anderson","2008"],["edison","PTDN","Phantom Darkness","2008"],["edison","LODT","Light of Destruction","2008"],["edison","PP02","Premium Pack 2 (TCG)","2008"],["edison","TDGS","The Duelist Genesis","2008"],["edison","CSOC","Crossroads of Chaos","2008"],["edison","DLG1","Dark Legends","2008"],["edison","DP08","Duelist Pack: Yusei","2009"],["edison","CRMS","Crimson Crisis","2009"],["edison","RGBT","Raging Battle","2009"],["edison","DPYG","Duelist Pack: Yugi","2009"],["edison","ANPR","Ancient Prophecy","2009"],["edison","HA01","Hidden Arsenal","2009"],["edison","SOVR","Stardust Overdrive","2009"],["edison","DP09","Duelist Pack: Yusei 2","2010"],["edison","ABPF","Absolute Powerforce","2010"],["edison","DPKB","Duelist Pack: Kaiba","2010"]];
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

/* ================= card pools ================= */
const TIERS = {
  tcg: { label: ['Common', 'Rare', 'Super Rare', 'Ultra Rare', 'Secret Rare'], short: ['C', 'R', 'SR', 'UR', 'ScR'], badge: ['', 'b1', 'b2', 'b3', 'b4'], foil: [0, 1, 2, 3, 4], arena: [50, 30, 15, 5] },
  md: { label: ['N (Normal)', 'R (Rare)'], short: ['N', 'R'], badge: ['bN', 'bR'], foil: [0, 0], arena: [65, 35] }
};
const POOLS = {
  dk: { name: 'Duelist Kingdom', tab: 'Duelist Kingdom', title: 'Duelist Kingdom', big: 'KINGDOM', era: 'Duelist Kingdom', tiers: 'tcg', sample: 0, usage: false,
    blurb: 'Cards first released before Spell Ruler (March to September 2002): Legend of Blue Eyes, Metal Raiders, the Yugi and Kaiba starter decks, Tournament Pack 1 and promos.' },
  goat: { name: 'GOAT', tab: 'GOAT 2005', title: 'GOAT format', big: 'GOAT', era: 'Format of 2005', tiers: 'tcg', sample: 300, usage: true,
    blurb: 'Cards first released after Duelist Kingdom, up to The Lost Millennium (September 2002 to July 2005).' },
  edison: { name: 'Edison', tab: 'Edison 2010', title: 'Edison format', big: 'EDISON', era: 'Format of 2010', tiers: 'tcg', sample: 400, usage: true,
    blurb: 'Cards first released after GOAT, up to Duelist Pack: Kaiba (August 2005 to April 2010). Synchros included.' }
};
const P = {};            // loaded pools: key -> { cards, byId, byR, cfg, tier }
let ACT = null;          // pool used for lookups and rendering
const imgSrc = id => `img/${id}.webp`;
const loading = {};
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Couldn’t load ' + src)); document.head.appendChild(s); }); }
function loadPool(key) {
  if (!POOLS[key]) key = 'goat';
  if (!loading[key]) loading[key] = (async () => {
    await loadScript(`data/${key}/pool.js?v=${V}`);
    const raw = (window.YGO_POOLS || {})[key] || {};
    const cards = Array.isArray(raw) ? raw : (raw.cards || []);
    const byR = [[], [], [], [], []]; cards.forEach(c => byR[c.r].push(c));
    const byId = new Map((raw.extra || []).map(c => [c.i, c])); cards.forEach(c => byId.set(c.i, c));
    const decks = raw.decks && !Array.isArray(raw.decks) ? raw.decks : { struct: raw.decks || [], comp: [] };
    const sets = (raw.sets || []).map(s => { const sb = [[], [], [], [], []]; const rOf = new Map(); s.l.forEach(([id, r]) => { const c = byId.get(id); if (c) { sb[r].push(c); rOf.set(id, r); } }); return { n: s.n, img: s.img, l: s.l, byR: sb, rOf, size: s.l.length }; });
    P[key] = { key, cards, byId, byR, cfg: POOLS[key], tier: TIERS[POOLS[key].tiers], groups: raw.groups || raw.products || [], decks, packs: raw.packs || [], sets, goodies: raw.goodies || [] };
    return P[key];
  })().catch(e => { delete loading[key]; throw e; });
  return loading[key];
}
function usePool(key) { if (P[key]) ACT = P[key]; return ACT; }
const C = id => ACT && ACT.byId.get(+id);

const MAX_COPIES = 3;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const NAME_KEY = 'ygo-drafter-name';
const MAX_SEATS = 10;
const DEFAULTS = { pool: 'goat', mode: 'booster', src: 'comp', contents: 'sets', bonus: 'on', tour: 'off', bestOf: 1, bots: 3, packs: 6, atOnce: 1, perPick: 1, odds: 'booster' };
const deckList = (pd, src) => { const d = pd ? pd.decks : { struct: [], comp: [] }; const l = src === 'struct' ? d.struct : src === 'both' ? d.struct.concat(d.comp) : d.comp; return l.length ? l : (d.struct.length ? d.struct : d.comp); };
const STACK = 20;
const cidOf = x => typeof x === 'number' ? x : parseInt(x, 10);

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
  settings: { ...DEFAULTS }, sel: [], focus: null, expanded: false, lastKey: null, lastSig: null,
  deck: null, deckId: null, buildSel: null, poolFilter: -1, poolView: 'goat', error: '', busy: false,
  offRoom: null, offConn: null, pendingCode: null, editName: false, renaming: false, connecting: false, loadingPool: null
};

/* ================= draft engine (shared by practice and online) ================= */
const toArr = x => Array.isArray(x) ? x.filter(v => v !== null && v !== undefined)
  : (x && typeof x === 'object' ? Object.keys(x).sort((a, b) => a - b).map(k => x[k]).filter(v => v != null) : []);
function norm(g) {
  if (!g) return g;
  const seats = toArr(g.seats); const n = seats.length;
  g.seats = seats.map((s, i) => ({ uid: s.uid || '', name: s.name || `Seat ${i + 1}`, bot: !!s.bot }));
  const Pk = g.packs || {}, K = g.picks || {}, D = g.done || {};
  g.packs = Array.from({ length: n }, (_, i) => toArr(Pk[i]).map(x => typeof x === 'string' && (x.includes('~') || x.includes('^')) ? x : Number(x)));
  g.opens = Array.from({ length: n }, (_, i) => toArr((g.opens || {})[i]).map(Number));
  g.pile = toArr(g.pile);
  g.picks = Array.from({ length: n }, (_, i) => toArr(K[i]).map(Number));
  g.done = Array.from({ length: n }, (_, i) => !!D[i]);
  g.round = g.round || 0; g.turn = g.turn || 0; g.finished = !!g.finished;
  g.settings = Object.assign({ pool: 'goat', mode: 'booster', packs: 6, atOnce: 1, odds: 'booster', perPick: 1 }, g.settings || {});
  g.decksUsed = toArr(g.decksUsed);
  if (g.opened == null) g.opened = Math.min(g.settings.packs, (g.round + 1) * g.settings.atOnce);
  g.batch = g.batch || Math.min(g.settings.atOnce, g.settings.packs);
  return g;
}
function rareSlot(pd) { if (pd.cfg.tiers === 'md') return 1; const x = Math.random(); if (x < 1 / 31) return 4; if (x < 1 / 31 + 1 / 12) return 3; if (x < 1 / 31 + 1 / 12 + 1 / 5) return 2; return 1; }
function arenaSlot(pd) {
  const w = pd.tier.arena; let x = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) { if (x < w[i]) return i === 3 && Math.random() < .2 ? 4 : i; x -= w[i]; }
  return 0;
}
function draw(pd, r, used) {
  const order = [r]; for (let t = r - 1; t >= 0; t--) order.push(t); for (let t = r + 1; t < 5; t++) order.push(t);
  for (const t of order) { const opts = pd.byR[t].filter(c => !used.has(c.i)); if (opts.length) { const c = opts[(Math.random() * opts.length) | 0]; used.add(c.i); return c; } }
  return null;
}
function makePackIds(pd, odds, used) {
  const slots = odds === 'arena' ? Array.from({ length: 9 }, () => arenaSlot(pd)).sort((a, b) => a - b) : [0, 0, 0, 0, 0, 0, 0, 0, rareSlot(pd)];
  return slots.map(r => draw(pd, r, used)).filter(Boolean).map(c => c.i);
}
function pickSets(pd, n) {
  const out = [], all = pd.sets.map((_, i) => i);
  for (let k = 0; k < n; k++) {
    const cand = all.filter(i => !out.includes(i)); const list = cand.length ? cand : all;
    let x = Math.random() * list.reduce((a, i) => a + pd.sets[i].size, 0), pick = list[0];
    for (const i of list) { x -= pd.sets[i].size; if (x < 0) { pick = i; break; } }
    out.push(pick);
  }
  return out;
}
function makeSetPack(pd, set, odds, used) {
  const slots = odds === 'arena' ? Array.from({ length: 9 }, () => arenaSlot(pd)).sort((a, b) => a - b) : [0, 0, 0, 0, 0, 0, 0, 0, rareSlot(pd)];
  return slots.map(r => { const c = draw(set, r, used); return c ? `${c.i}^${set.rOf.get(c.i)}` : null; }).filter(Boolean);
}
function openBatch(g) {
  const pd = P[g.settings.pool];
  const n = Math.max(1, Math.min(g.settings.atOnce, g.settings.packs - g.opened));
  if (pd && pd.sets && pd.sets.length && g.settings.contents !== 'pool') {
    g.opens = g.seats.map(() => pickSets(pd, n));
    g.packs = g.opens.map(idx => { const used = new Set(); let ids = []; idx.forEach(si => { ids = ids.concat(makeSetPack(pd, pd.sets[si], g.settings.odds, used)); }); return ids; });
  } else g.packs = g.seats.map(() => { const used = new Set(); let ids = []; for (let k = 0; k < n; k++) ids = ids.concat(makePackIds(pd, g.settings.odds, used)); return ids; });
  g.opened += n; g.batch = n;
}
const rOf = (e, c) => typeof e === 'string' && e.includes('^') ? +e.split('^')[1] : c.r;
const withR = (c, r) => !c || r === c.r ? c : Object.assign({}, c, { r });
function dealStacks(g) {
  const n = g.seats.length, rem = g.pile.length;
  if (rem >= n * STACK) g.packs = g.seats.map(() => g.pile.splice(0, STACK));
  else { const per = Math.floor(rem / n), extra = rem % n; g.packs = g.seats.map((_, i) => g.pile.splice(0, per + (i < extra ? 1 : 0))); }
  g.batch = 1;
}
const deckRounds = g => Math.max(1, Math.ceil((g.totalCards || 0) / (g.seats.length * STACK)));
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
function newGame(settings, humans) {
  const st = Object.assign({}, DEFAULTS, settings || {});
  if (!POOLS[st.pool]) st.pool = 'goat';
  const bots = Math.max(0, Math.min(MAX_SEATS - humans.length, typeof st.bots === 'number' ? st.bots : 3));
  let b = 0;
  const seats = shuffle(Array.from({ length: humans.length + bots }, (_, i) => i < humans.length
    ? { uid: humans[i].uid, name: humans[i].name, bot: false } : { uid: '', name: `Bot ${++b}`, bot: true }));
  const g = { id: Math.random().toString(36).slice(2, 10), seats, round: 0, turn: 0, opened: 0, finished: false,
    settings: { pool: st.pool, mode: 'booster', src: st.src || 'comp', contents: st.contents === 'pool' ? 'pool' : 'sets', packs: st.packs, atOnce: st.atOnce === 2 ? 2 : 1, odds: st.odds, perPick: st.perPick === 2 ? 2 : 1 } };
  const pd = P[st.pool];
  const srcList = deckList(pd, st.src);
  if (st.mode === 'deck' && srcList.length) {
    const list = shuffle(srcList.slice()); const used = seats.map((_, k) => list[k % list.length]);
    let serial = 0; const pile = [];
    used.forEach(d => d.l.forEach(([id, q]) => { for (let j = 0; j < q; j++) pile.push(`${id}~${serial++}`); }));
    g.bonusPacks = 0;
    if (st.bonus !== 'off' && pd.goodies.length) {
      g.bonusPacks = Math.ceil(seats.length / 2);
      shuffle(pd.goodies.slice()).slice(0, g.bonusPacks * 10).forEach(id => pile.push(`${id}~${serial++}`));
    }
    g.settings.mode = 'deck'; g.pile = shuffle(pile); g.totalCards = pile.length; g.decksUsed = used.map(d => d.n);
    dealStacks(g);
  } else openBatch(g);
  g.picks = seats.map(() => []); g.done = seats.map(() => false);
  botsPick(g); advance(g);
  return g;
}
const need = (g, i) => Math.min(g.settings.perPick, g.packs[i].length);
function applyPick(g, i, ids) {
  if (g.finished || g.done[i] || !g.seats[i]) return false;
  const pack = g.packs[i];
  if (ids.length !== need(g, i) || new Set(ids).size !== ids.length || !ids.every(id => pack.includes(id))) return false;
  ids.forEach(id => { pack.splice(pack.indexOf(id), 1); g.picks[i].push(cidOf(id)); });
  g.done[i] = true; return true;
}
function botChoose(g, pack, picks) {
  const pd = P[g.settings.pool]; let best = null, bs = -1e9;
  for (const e of pack) {
    const id = cidOf(e); const c = pd && pd.byId.get(id); if (!c) continue;
    let s = Math.log1p(c.w ?? c.u) + c.r * .25 + Math.random() * .8;
    if (picks.reduce((n, x) => n + (x === id), 0) >= MAX_COPIES) s -= 3;
    if (s > bs) { bs = s; best = e; }
  }
  return best ?? pack[0];
}
function botsPick(g) {
  g.seats.forEach((s, i) => {
    if (!s.bot || g.done[i]) return;
    const n = need(g, i);
    for (let k = 0; k < n; k++) { const e = botChoose(g, g.packs[i], g.picks[i]); g.packs[i].splice(g.packs[i].indexOf(e), 1); g.picks[i].push(cidOf(e)); }
    g.done[i] = true;
  });
}
function advance(g) {
  let guard = 0;
  while (!g.finished && g.done.every(Boolean) && guard++ < 400) {
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
const roundsOf = st => Math.ceil(st.packs / (st.atOnce || 1));

/* ================= Firebase ================= */
let FB = null;
async function fb() {
  if (FB) return FB;
  const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
  const [A, Au, D] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-database.js')]);
  const app = A.initializeApp(FB_CONFIG); const auth = Au.getAuth(app); const db = D.getDatabase(app);
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
    v: 3, host: F.uid, created: F.serverTimestamp(), status: 'lobby',
    settings: { pool: st.pool, mode: st.mode, src: st.src, contents: st.contents, bonus: st.bonus, tour: st.tour || 'off', bestOf: +st.bestOf === 3 ? 3 : 1, bots: st.bots, packs: st.packs, atOnce: st.atOnce, odds: st.odds, perPick: st.perPick },
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
  const r = snap.val(); const known = r.members && r.members[F.uid];
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
    else if (snap.val().members && snap.val().members[F.uid]) await enterRoom(code);
  } catch (e) { console.error(e); S.error = 'Couldn’t reach the server. Check your connection and refresh.'; }
  S.connecting = false; render();
}
async function renameMe(name) {
  const F = await fb();
  if (nameClash(S.room, F.uid, name)) throw new Error(`Someone here already goes by ${name}. Pick another username.`);
  await F.update(roomRef(F, `/members/${F.uid}`), { name }); store.set(NAME_KEY, name);
}
async function setReady(v) {
  const F = await fb(); const g = game(); if (!g) return;
  if (v) await F.set(roomRef(F, `/decks/${g.id}/${F.uid}`), { name: myName() || 'Player', ydk: ydkText() });
  await F.set(roomRef(F, `/ready/${g.id}/${F.uid}`), v);
}
async function enterRoom(code) {
  const F = await fb();
  S.online = true; S.code = code; S.uid = F.uid; S.lastKey = null; S.sel = []; S.focus = null; S.pendingCode = null;
  history.replaceState(null, '', `${location.pathname}?room=${code}`);
  const pr = F.ref(F.db, `rooms/${code}/presence/${F.uid}`);
  if (S.offConn) S.offConn();
  S.offConn = F.onValue(F.ref(F.db, '.info/connected'), snap => { if (snap.val() === true) F.onDisconnect(pr).set(false).then(() => F.set(pr, true)).catch(() => {}); });
  if (S.offRoom) S.offRoom();
  S.offRoom = F.onValue(F.ref(F.db, `rooms/${code}`), snap => { S.room = snap.val(); onRoom(); }, err => { toast('Lost access to the room. Refresh the page to reconnect.'); console.error(err); });
}
async function leaveRoom() {
  if (S.online && FB) {
    const F = FB;
    try { if (S.room && S.room.status === 'lobby') await F.remove(roomRef(F, `/members/${F.uid}`)); await F.set(roomRef(F, `/presence/${F.uid}`), false); } catch (_) {}
    if (S.offRoom) S.offRoom(); if (S.offConn) S.offConn(); S.offRoom = S.offConn = null;
  }
  Object.assign(S, { pendingCode: null, online: false, code: null, room: null, practice: null, view: 'home', sel: [], focus: null, lastKey: null, deck: null, deckId: null, buildSel: null });
  history.replaceState(null, '', location.pathname); render();
}
function roomPool() { const r = S.room; const g = r && r.game; return (g && g.settings && g.settings.pool) || (r && r.settings && r.settings.pool) || 'goat'; }
function onRoom() {
  const r = S.room;
  if (!r) { toast('This room no longer exists.'); leaveRoom(); return; }
  const key = POOLS[roomPool()] ? roomPool() : 'goat';
  if (!P[key]) { S.loadingPool = key; loadPool(key).then(() => { S.loadingPool = null; onRoom(); }).catch(() => { S.loadingPool = null; toast('Couldn’t load the card pool. Refresh the page.'); }); if (!S.room.game) { S.view = 'lobby'; render(); } else { $('#app').innerHTML = `<p class="loading">Loading the ${esc(POOLS[key].title)} card pool…</p>`; } return; }
  usePool(key);
  const g = r.game ? norm(r.game) : null;
  if (r.status === 'lobby' || !g) S.view = 'lobby';
  else { const seat = g.seats.findIndex(s => s.uid === S.uid); S.view = seat < 0 ? 'spectate' : (g.finished ? 'build' : 'draft'); }
  render();
}
async function setSetting(key, value) {
  S.settings[key] = value;
  if (key === 'pool') { loadPool(value).then(() => { if (!S.online || !isHost()) render(); }).catch(() => {}); if (POOLS[value] && POOLS[value].tiers === 'md' && S.settings.mode === 'deck') { S.settings.mode = 'booster'; if (S.online && isHost()) { const F = await fb(); await F.update(roomRef(F, '/settings'), { mode: 'booster' }); } } }
  if (S.online && isHost()) { const F = await fb(); await F.update(roomRef(F, '/settings'), { [key]: value }); }
  else render();
}
async function startOnline() {
  const F = await fb(); S.busy = true; render();
  try {
    const key = (S.room && S.room.settings && S.room.settings.pool) || 'goat';
    await loadPool(key); usePool(key);
    await F.runTransaction(roomRef(F), r => {
      if (!r) return r; if (r.status !== 'lobby') return;
      const presence = r.presence || {};
      const humans = Object.entries(r.members || {}).map(([uid, m]) => ({ uid, name: (m && m.name) || 'Player', joined: (m && m.joined) || 0 }))
        .filter(m => presence[m.uid] !== false || m.uid === F.uid).sort((a, b) => a.joined - b.joined);
      r.game = newGame(r.settings || DEFAULTS, humans); r.status = 'draft'; return r;
    });
  } catch (e) { toast('Couldn’t start the draft. Try again.'); console.error(e); }
  S.busy = false; render();
}
async function newDraftSameRoom() { const F = await fb(); await F.update(roomRef(F), { status: 'lobby', game: null, tour: null }); S.tab = null; }
async function takeHost() { const F = await fb(); await F.update(roomRef(F), { host: F.uid }); }
async function botTakeover(i) {
  const F = await fb(); await loadPool(roomPool());
  await F.runTransaction(roomRef(F, '/game'), g => { if (!g) return g; norm(g); if (g.finished || !g.seats[i] || g.seats[i].bot || g.done[i]) return; g.seats[i].bot = true; botsPick(g); advance(g); return g; });
}
async function reclaimSeat() {
  const F = await fb();
  await F.runTransaction(roomRef(F, '/game'), g => { if (!g) return g; norm(g); const i = g.seats.findIndex(s => s.uid === F.uid); if (i < 0 || !g.seats[i].bot) return; g.seats[i].bot = false; return g; });
}

/* ================= current game helpers ================= */
function game() { return S.online ? (S.room && S.room.game ? norm(S.room.game) : null) : S.practice; }
function mySeat(g) { return g ? g.seats.findIndex(s => s.uid === (S.online ? S.uid : 'me')) : -1; }
function isHost() { return !S.online || (S.room && S.room.host === S.uid); }
function presenceOf(uid) { const p = S.room && S.room.presence; return !p || p[uid] !== false; }
async function submitPick() {
  if (S.opening) return;
  const g = game(); const seat = mySeat(g);
  if (!g || seat < 0 || S.busy) return;
  const pack = g.packs[seat]; const ids = S.sel.map(s => pack.find(x => String(x) === s)).filter(x => x != null);
  if (ids.length !== need(g, seat)) return;
  if (!S.online) { if (applyPick(g, seat, ids)) { advance(g); S.sel = []; S.focus = null; S.expanded = false; if (g.finished) enterBuild(); else render(); } return; }
  S.busy = true; render();
  try {
    const F = await fb(); await loadPool(g.settings.pool);
    const res = await F.runTransaction(roomRef(F, '/game'), cur => { if (!cur) return cur; norm(cur); if (!applyPick(cur, seat, ids)) return; advance(cur); return cur; });
    if (!res.committed) toast('That pick didn’t go through. Try again.');
  } catch (e) { toast('Couldn’t send your pick. Check your connection and try again.'); console.error(e); }
  S.busy = false; S.sel = []; S.focus = null; S.expanded = false; render();
}

/* ================= deck building ================= */
function myPicks() { const g = game(); const i = mySeat(g); return g && i >= 0 ? g.picks[i].map((id, u) => ({ u, c: C(id) })).filter(p => p.c) : []; }
function deckKey(g) { return `ygo-drafter:deck:${g.id}`; }
function savedDecks() { try { return JSON.parse(store.get('ygo-drafter:decks') || '[]'); } catch (_) { return []; } }
function storeDecks(list) { store.set('ygo-drafter:decks', JSON.stringify(list.slice(0, 60))); }
function savedDecksHTML() {
  const list = savedDecks(); if (!list.length) return '';
  return `<details class="saved"><summary>My saved decks (${list.length})</summary><ul>${list.map(d => `<li data-id="${esc(d.id)}"><span><b>${esc(d.name)}</b> <small>${esc((POOLS[d.pool] || {}).name || '')}, ${new Date(d.saved).toLocaleDateString()}</small></span><span class="row"><button class="ghost small" type="button" data-act="dldeck">Download</button><button class="linkish" type="button" data-act="deldeck">Delete</button></span></li>`).join('')}</ul></details>`;
}
function drawTestHand() {
  const main = myPicks().filter(p => zoneOf(p.u) === 'main'); const hand = shuffle(main.slice()).slice(0, 5);
  $('#testHand').innerHTML = `<div class="testhand"><p class="lbl">Test hand (5 random cards from your Main Deck)</p><div class="zgrid">${hand.map(p => cardHTML(p)).join('')}</div><div class="row"><button class="ghost small" type="button" data-act="testhand">Draw again</button></div></div>`;
}
function enterBuild() { S.view = 'build'; render(); }
function ensureDeck() {
  const g = game(); if (!g) return;
  if (S.deckId === g.id && S.deck) return;
  S.deckId = g.id; S.buildSel = null;
  const saved = store.get(deckKey(g));
  if (saved) { try { const d = JSON.parse(saved); S.deck = { main: new Set(d.main), extra: new Set(d.extra), side: new Set(d.side), order: d.order || {} }; return; } catch (_) {} }
  autoBuild();
}
function saveDeck() {
  const g = game(); if (!g || !S.deck) return;
  store.set(deckKey(g), JSON.stringify({ main: [...S.deck.main], extra: [...S.deck.extra], side: [...S.deck.side], order: S.deck.order || {} }));
  const m = new Map(myPicks().map(p => [p.u, p.c.i]));
  store.set('ygo-drafter:lastdeck', JSON.stringify({ pool: g.settings.pool, main: [...S.deck.main].map(u => m.get(u)).filter(Boolean), extra: [...S.deck.extra].map(u => m.get(u)).filter(Boolean) }));
}
function zoneOf(u) { for (const z of ['main', 'extra', 'side']) if (S.deck[z].has(u)) return z; return 'pool'; }
function autoBuild() {
  S.deck = { main: new Set(), extra: new Set(), side: new Set(), order: {} };
  const score = c => (c.w ?? c.u) + c.r * 4;
  const picks = myPicks().sort((a, b) => score(b.c) - score(a.c));
  const count = new Map(); const ok = p => (count.get(p.c.i) || 0) < MAX_COPIES;
  const add = (z, p) => { S.deck[z].add(p.u); count.set(p.c.i, (count.get(p.c.i) || 0) + 1); };
  for (const p of picks) if (p.c.k === 'F' && S.deck.extra.size < 15 && ok(p)) add('extra', p);
  const target = { M: 18, S: 13, T: 9 }, got = { M: 0, S: 0, T: 0 };
  for (const p of picks) { if (p.c.k === 'F' || S.deck.main.size >= 40) continue; if (got[p.c.k] < target[p.c.k] && ok(p)) { add('main', p); got[p.c.k]++; } }
  for (const p of picks) { if (S.deck.main.size >= 40) break; if (p.c.k === 'F' || S.deck.main.has(p.u)) continue; if (ok(p)) add('main', p); }
  saveDeck();
}
function moveTo(u, z) { for (const k of ['main', 'extra', 'side']) S.deck[k].delete(u); if (z !== 'pool') S.deck[z].add(u); saveDeck(); }
// Drag and drop: move a card to a zone, optionally placing it before another card. Order is kept per zone.
function dropCard(u, z, beforeU, visibleOrder) {
  const p = myPicks().find(x => x.u === u); if (!p) return false;
  if (z === 'extra' && p.c.k !== 'F') { toast('Only Fusion and Synchro monsters go in the Extra Deck.'); return false; }
  if (z === 'main' && p.c.k === 'F') { toast('Fusion and Synchro monsters go in the Extra Deck.'); return false; }
  const ord = S.deck.order || (S.deck.order = {});
  for (const k of ['main', 'extra', 'side', 'pool']) if (ord[k]) ord[k] = ord[k].filter(x => x !== u);
  const list = (visibleOrder[z] || []).filter(x => x !== u);
  const at = beforeU != null && list.includes(beforeU) ? list.indexOf(beforeU) : list.length;
  list.splice(at, 0, u); ord[z] = list;
  for (const k of ['main', 'extra', 'side']) S.deck[k].delete(u); if (z !== 'pool') S.deck[z].add(u);
  saveDeck(); return true;
}
function fillSide() {
  const unused = myPicks().filter(p => zoneOf(p.u) === 'pool').sort((a, b) => (b.c.w ?? b.c.u) - (a.c.w ?? a.c.u));
  let added = 0; for (const p of unused) { if (S.deck.side.size >= 15) break; S.deck.side.add(p.u); added++; }
  saveDeck(); render(); toast(added ? `Moved ${added} unused picks to the side deck.` : 'No unused picks to move.');
}
function deckWarnings() {
  const m = new Map(myPicks().map(p => [p.u, p])); const cnt = new Map();
  for (const z of ['main', 'extra', 'side']) for (const u of S.deck[z]) { const c = m.get(u)?.c; if (c) cnt.set(c.i, (cnt.get(c.i) || 0) + 1); }
  const out = []; for (const [id, n] of cnt) { const c = C(id); if (c && n > MAX_COPIES) out.push(`${c.n} (${n} copies)`); }
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
  const g = game(); const pool = g ? g.settings.pool : 'goat';
  const name = `ygo_drafter_${pool}_${S.code ? S.code.toLowerCase() + '_' : ''}deck.ydk`;
  const url = URL.createObjectURL(new Blob([ydkText()], { type: 'application/octet-stream' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000); toast(`Downloaded ${name}.`);
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
function deckVisualHTML(v) {
  if (v.img) return `<div class="pack photo deckbox"><div class="body" style="background-image:url('${v.img}')"></div><div class="tearglow"></div><span class="deckname">${esc(v.name)}</span></div>`;
  return `<div class="pack deckstack"><div class="body"></div><div class="tearglow"></div><span class="deckname">${esc(v.name)}</span></div>`;
}
function packHTML(key = 'goat', o = {}) {
  if (o.img) return `<div class="pack photo"><div class="body" style="background-image:url('${o.img}')"></div><div class="strip" style="background-image:url('${o.img}')"></div><div class="tearglow"></div>${o.name ? `<span class="deckname">${esc(o.name)}</span>` : ''}</div>`;
  const cfg = POOLS[key] || POOLS.goat; const big = o.big || cfg.big;
  return `<div class="pack pk-${key}"><div class="body" style="clip-path:${ZZ}"></div><div class="strip" style="clip-path:${ZZ}"></div><div class="tearglow"></div>
    <div class="label">${EYE}<span class="goat ${big.length > 6 ? 'xlong' : big.length > 5 ? 'long' : ''}">${esc(big)}</span><span class="yr">${esc(o.era || cfg.era)}</span><span class="count">${esc(o.count || '9 cards')}</span></div></div>`;
}
function cardHTML(p, { pressed = false, num = 0, back = false } = {}) {
  const c = p.c || p; const u = p.u ?? ''; const t = ACT ? ACT.tier : TIERS.tcg;
  const badge = t.badge[c.r] ? `<span class="badge ${t.badge[c.r]}">${t.short[c.r]}</span>` : '';
  return `<button class="card" type="button" data-u="${u}" data-id="${c.i}" data-r="${t.foil[c.r]}" data-tier="${c.r}" aria-pressed="${pressed}" aria-label="${esc(c.n + ', ' + t.label[c.r])}">
    <img src="${imgSrc(c.i)}" alt="" width="210" height="306" loading="lazy" decoding="async"><span class="foil"></span>${badge}${num ? `<span class="picknum">${num}</span>` : ''}${back ? `<span class="back">${EYE}</span>` : ''}</button>`;
}
function typeLine(c) {
  if (c.k === 'S') return `${c.race === 'Normal' ? '' : c.race + ' '}Spell`;
  if (c.k === 'T') return `${c.race === 'Normal' ? '' : c.race + ' '}Trap`;
  const words = (c.t || '').replace(/ Monster$/, '').split(' ');
  const order = ['Fusion', 'Ritual', 'Synchro', 'XYZ', 'Link', 'Pendulum', 'Flip', 'Gemini', 'Spirit', 'Toon', 'Union', 'Tuner', 'Effect'];
  const tags = order.filter(w => words.includes(w)).map(w => w === 'XYZ' ? 'Xyz' : w);
  if (['Spirit', 'Toon', 'Gemini', 'Union'].some(w => tags.includes(w)) && !tags.includes('Effect')) tags.push('Effect');
  return `[${[c.race, ...tags].join(' / ')}]`;
}
function statsLine(c) {
  if (c.k !== 'M' && c.k !== 'F') return '';
  const t = c.t || '';
  const head = t.includes('Link') ? `Link-${c.lk ?? '?'}, ${esc(c.at || '')}` : `${t.includes('XYZ') ? 'Rank' : 'Level'} ${c.lv ?? '?'}, ${esc(c.at || '')}${c.sc != null ? `, Scale ${c.sc}` : ''}`;
  const nums = t.includes('Link') ? `ATK ${c.a ?? '?'}` : `ATK ${c.a ?? '?'} &nbsp; DEF ${c.d ?? '?'}`;
  return `<p class="d-stats"><span>${head}</span><span>${nums}</span></p>`;
}
function detailHTML(c, actions = '') {
  const cfg = ACT ? ACT.cfg : POOLS.goat; const t = ACT ? ACT.tier : TIERS.tcg;
  const played = cfg.usage && !c.fb && c.u ? ` Played in ${Math.round(100 * c.u / cfg.sample)}% of ${cfg.sample} ${esc(cfg.tiers === 'md' ? 'Master Duel' : cfg.name)} decklists.` : '';
  const foot = (cfg.tiers === 'md' ? `Master Duel rarity ${t.short[c.r]}.` : `First printed in ${esc(c.s)}.`) + played;
  return `<div class="d-head"><img class="d-img" src="${imgSrc(c.i)}" alt="${esc(c.n)}" width="210" height="306">
    <div class="d-info"><h2>${esc(c.n)}</h2><div class="d-tags"><span class="pill ${cfg.tiers === 'md' ? 'md' + c.r : ''}">${t.label[c.r]}</span></div>
    <p class="d-type">${esc(typeLine(c))}</p>${statsLine(c)}</div></div>
    <p class="d-text">${esc(c.x)}</p><p class="d-foot">${foot}</p>
    <div class="actions">${actions}<button class="ghost more" type="button" data-act="more">Card text</button><button class="ghost close" type="button" data-act="close">Close</button></div>`;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3800); }
function listNames(names) { return names.length <= 1 ? (names[0] || '') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]; }
function settingsHTML(st, editable, online, humans = 1) {
  const dis = editable ? '' : 'disabled';
  const seg = (key, opts) => `<div class="seg" role="radiogroup">${opts.map(([v, l]) => `<label><input type="radio" name="set-${key}" value="${v}" ${String(st[key]) === String(v) ? 'checked' : ''} ${dis}><span>${l}</span></label>`).join('')}</div>`;
  const minB = online ? 0 : 1, maxB = MAX_SEATS - humans;
  const bots = Math.max(minB, Math.min(maxB, typeof st.bots === 'number' ? st.bots : 3));
  const perRound = 9 * (st.atOnce || 1); const turns = Math.ceil(perRound / st.perPick) * roundsOf(st);
  const cfg = POOLS[st.pool] || POOLS.goat; const md = cfg.tiers === 'md';
  const deck = st.mode === 'deck' && !md; const pdx = P[st.pool]; const nComp = pdx ? pdx.decks.comp.length : 0, nStruct = pdx ? pdx.decks.struct.length : 0;
  const src = nComp ? (st.src || 'comp') : 'struct';
  const srcText = src === 'comp' ? `${nComp} tournament decks (top 4 finishes)` : src === 'struct' ? `${nStruct} starter and structure decks${nStruct < 4 ? ', repeated if needed' : ''}` : `${nComp} tournament decks and ${nStruct} starter and structure decks`;
  const deckInfo = `One deck per seat, picked at random from ${srcText}, all shuffled into stacks of ${STACK}.`;
  return `<div class="settings ${editable ? '' : 'readonly'}">
    <div class="field stack"><div class="lbl">Card pool<small>${esc(cfg.blurb)}</small></div>${seg('pool', Object.entries(POOLS).map(([k, v]) => [k, v.tab]))}</div>
    <div class="field stack"><div class="lbl">Draft style<small>${md ? 'Master Duel N/R uses booster packs.' : deck ? esc(deckInfo) : 'Open booster packs, keep a card and pass the rest.'}</small></div>${md ? '' : seg('mode', [['booster', 'Booster packs'], ['deck', 'Deck draft']])}</div>
    ${online ? `<div class="field stack"><div class="lbl">Tournament after the draft<small>${esc(TOUR_HELP[st.tour] || 'Optional. The host can still start one when decks are done.')}</small></div>${seg('tour', [['off', 'Off'], ['rr', 'Round robin'], ['swiss', 'Swiss'], ['se', 'Single elimination']])}</div>
    ${st.tour && st.tour !== 'off' ? `<div class="field"><div class="lbl">Matches<small>${+st.bestOf === 3 ? 'First to win 2 games' : 'One game per match'}</small></div>${seg('bestOf', [[1, 'Best of 1'], [3, 'Best of 3']])}</div>` : ''}` : ''}
    ${!deck && !md ? `<div class="field stack"><div class="lbl">Pack contents<small>${st.contents === 'pool' ? 'Packs mix every card of the era, including starter deck cards, tins, promos and staples.' : 'Each pack is a random real booster set with only that set\'s cards.'}</small></div>${seg('contents', [['sets', 'Real sets'], ['pool', 'Whole pool']])}</div>` : ''}
    ${deck ? `<div class="field stack"><div class="lbl">Bonus packs<small>${st.bonus === 'off' ? 'Only the decks go into the stacks.' : 'Adds 1 pack of 10 staples and rares for every 2 players, shuffled in with the decks.'}</small></div>${seg('bonus', [['on', 'On'], ['off', 'Off']])}</div>` : ''}
    ${deck ? `<div class="field stack"><div class="lbl">Decks to use<small>${nComp ? 'Tournament decks come from Format Library event results.' : 'No tournament decklists exist for Duelist Kingdom, so it uses the starter decks.'}</small></div>${nComp ? seg('src', [['comp', 'Competitive'], ['struct', 'Structure'], ['both', 'Both']]) : ''}</div>` : ''}
    <div class="field"><div class="lbl">Bots<small>${online ? 'Bots take the seats your friends don’t' : 'Bots take the other seats'}</small></div>
      <div class="stepper"><button type="button" data-set="bots" data-d="-1" aria-label="Fewer bots" ${dis || (bots <= minB ? 'disabled' : '')}>−</button><output>${bots}</output><button type="button" data-set="bots" data-d="1" aria-label="More bots" ${dis || (bots >= maxB ? 'disabled' : '')}>+</button></div></div>
    ${deck ? '' : `<div class="field"><div class="lbl">Packs each<small>${st.packs * 9} cards each, ${turns} turns</small></div>
      <div class="stepper"><button type="button" data-set="packs" data-d="-1" aria-label="Fewer packs" ${dis || (st.packs <= 1 ? 'disabled' : '')}>−</button><output>${st.packs}</output><button type="button" data-set="packs" data-d="1" aria-label="More packs" ${dis || (st.packs >= 10 ? 'disabled' : '')}>+</button></div></div>
    <div class="field"><div class="lbl">Open at once<small>${st.atOnce === 2 ? 'Two packs make one 18-card pile each round' : 'One 9-card pack each round'}</small></div>${seg('atOnce', [[1, '1 pack'], [2, '2 packs']])}</div>`}
    <div class="field"><div class="lbl">Cards per pick<small>${st.perPick === 2 ? 'Take 2 each turn, twice as fast' : 'Take 1 each turn, like Magic'}</small></div>${seg('perPick', [[1, '1'], [2, '2']])}</div>
    ${deck ? '' : `<div class="field"><div class="lbl">Rarity odds<small>${st.odds === 'arena' ? (md ? 'Every slot rolls N 65 / R 35' : 'Every slot rolls 50/30/15/5') : (md ? '8 N and 1 R per pack' : '8 commons and 1 rare slot per pack')}</small></div>${seg('odds', [['booster', 'Real packs'], ['arena', 'Arena']])}</div>`}
  </div>`;
}

/* ================= screens ================= */
function setBar(statusHTML, actions) {
  $('#status').innerHTML = statusHTML || '';
  $('#barActions').innerHTML = [`<button class="ghost" type="button" data-act="pool">Card pool</button>`].concat(actions || []).join('');
}
function render() {
  if (S.view !== 'draft') S.lastSig = null;
  const v = S.view;
  if (v === 'home') renderHome(); else if (v === 'practice') renderPracticeSetup(); else if (v === 'lobby') renderLobby();
  else if (v === 'spectate') renderSpectate(); else if (v === 'draft') renderDraft(); else if (v === 'build') renderBuild();
}
let heroIdx = 0, heroTimer = null, heroKey = null;
function heroList(pool) { const l = pool ? HOME_PACKS.filter(p => p[0] === pool) : HOME_PACKS; return l.length ? l : HOME_PACKS; }
function heroCycleHTML(pool) {
  const list = heroList(pool); const key = pool || 'all';
  if (heroKey !== key) { heroKey = key; heroIdx = 0; }
  const p = list[heroIdx % list.length];
  return `<div class="pack-cycle photo-cycle" id="packCycle" data-pool="${pool || ''}" aria-hidden="true">
    <img class="cyc on" src="packs/${p[1]}.webp" alt="" width="300" height="540"><img class="cyc" alt="" width="300" height="540">
    <p class="cyc-cap"><span class="cyc-name">${esc(p[2])}</span><span class="cyc-year">${p[3]}</span></p></div>`;
}
function startHeroCycle() {
  clearInterval(heroTimer); heroTimer = null;
  if (reduceMotion || !$('#packCycle')) return;
  heroTimer = setInterval(() => {
    const box = $('#packCycle');
    if (!box) { clearInterval(heroTimer); heroTimer = null; return; }
    if (document.hidden) return;
    const list = heroList(box.dataset.pool || null); if (list.length < 2) return;
    heroIdx = (heroIdx + 1) % list.length; const p = list[heroIdx];
    const [a, b] = box.querySelectorAll('.cyc'); const cur = a.classList.contains('on') ? a : b, nxt = cur === a ? b : a;
    const img = new Image(); img.onload = () => {
      if (!box.isConnected) return;
      nxt.src = img.src; cur.classList.remove('on'); nxt.classList.add('on');
      const cap = box.querySelector('.cyc-cap'); cap.classList.add('swap');
      setTimeout(() => { cap.querySelector('.cyc-name').textContent = p[2]; cap.querySelector('.cyc-year').textContent = p[3]; cap.classList.remove('swap'); }, 450);
    };
    img.src = `packs/${p[1]}.webp`;
  }, 2800);
}
function renderHome() {
  setBar('', []);
  if (S.connecting) { $('#app').innerHTML = `<p class="loading">Connecting to room ${esc(S.pendingCode || '')}…</p>`; return; }
  const name = myName(); const code = S.pendingCode;
  const err = S.error ? `<p class="err" role="alert">${esc(S.error)}</p>` : '';
  const nameInput = `<input class="text" id="nameIn" maxlength="20" autocomplete="nickname" value="${esc(name)}" placeholder="For example, Kaiba">`;
  let body;
  if (code) body = `<h2>Join room ${esc(code)}</h2><p class="lede">Pick the username everyone at the table will see.</p>
      <div class="block"><h3><label for="nameIn">Your username for this draft</label></h3>${nameInput}
      <div class="row"><button class="cta" type="button" data-act="join-pending">Join room ${esc(code)}</button><button class="linkish" type="button" data-act="forget-code">Not this room</button></div></div>${err}`;
  else if (!name || S.editName) body = `<h2>${name ? 'Change your username' : 'First, pick a username'}</h2><p class="lede">It’s the name your friends see at the table. You can change it for each draft.</p>
      <div class="block"><h3><label for="nameIn">Username</label></h3>${nameInput}
      <div class="row"><button class="cta" type="button" data-act="save-name">${name ? 'Save' : 'Continue'}</button>${name ? '<button class="linkish" type="button" data-act="cancel-name">Cancel</button>' : ''}</div></div>${err}`;
  else body = `<h2>Draft a deck with your friends</h2>
      <p class="lede">Open packs, keep a card, pass the rest. Draft from Duelist Kingdom, GOAT or Edison, with every card each era released.</p>
      <p class="playing">Playing as ${esc(name)}. <button class="linkish" type="button" data-act="edit-name">Change username</button></p>
      <div class="block"><h3>Host a draft</h3><p>Create a room, send the invite link, and start when everyone’s in.</p><div class="row"><button class="cta" type="button" data-act="create">Create a room</button></div></div>
      <div class="block"><h3><label for="codeIn">Join with a code</label></h3><div class="row"><input class="text code" id="codeIn" maxlength="4" autocomplete="off" placeholder="ABCD"><button class="ghost" type="button" data-act="join">Join</button></div></div>
      <div class="block"><h3>Practice</h3><p>Draft alone against bots. Nothing goes online.</p><div class="row"><button class="ghost" type="button" data-act="practice">Practice vs bots</button></div></div>
      <div class="block"><h3>Duel test (beta)</h3><p>Play a GOAT duel against yourself with automatic rules and an undo button.</p><div class="row"><a class="ghost" href="duel/">Open the duel table</a></div></div>${err}`;
  $('#app').innerHTML = `<section class="home"><div class="hero-pack">${heroCycleHTML(null)}</div><div>${body}</div></section>`;
  startHeroCycle();
}
function renderPracticeSetup() {
  setBar('<span>Practice vs bots</span>', [`<button class="ghost" type="button" data-act="home">Back</button>`]);
  $('#app').innerHTML = `<section class="home"><div class="hero-pack">${heroCycleHTML(S.settings.pool)}</div>
    <div><h2>Practice draft</h2><p class="lede">Same packs and rules as a live room, with bots in the other seats.</p>${settingsHTML(S.settings, true, false, 1)}
      <div class="row" style="margin-top:22px"><button class="cta" type="button" data-act="start-practice" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Loading cards…' : 'Open your first pack'}</button></div></div></section>`;
  startHeroCycle();
}
function lobbyMembers() { return Object.entries((S.room && S.room.members) || {}).map(([uid, m]) => ({ uid, name: (m && m.name) || 'Player', joined: (m && m.joined) || 0 })).sort((a, b) => a.joined - b.joined); }
function humansInLobby() { return S.online && S.room ? lobbyMembers().filter(m => presenceOf(m.uid)).length : 1; }
function renderLobby() {
  const typed = $('#renameIn') ? $('#renameIn').value : null;
  const r = S.room; const st = Object.assign({}, DEFAULTS, r.settings || {}); if (typeof st.bots !== 'number') st.bots = 3;
  S.settings = { ...st };
  const members = lobbyMembers(); const host = isHost(); const hostOnline = presenceOf(r.host);
  const humans = members.filter(m => presenceOf(m.uid)).length;
  const bots = Math.max(0, Math.min(MAX_SEATS - humans, st.bots)); const seatsN = humans + bots;
  const link = `${location.origin}${location.pathname}?room=${S.code}`;
  const hostName = (r.members && r.members[r.host] && r.members[r.host].name) || 'the host';
  const cfg = POOLS[st.pool] || POOLS.goat;
  setBar(`<span>Room ${esc(S.code)}</span>`, [`<button class="ghost" type="button" data-act="leave">Leave</button>`]);
  const row = m => {
    const on = presenceOf(m.uid), me = m.uid === S.uid;
    if (me && S.renaming) return `<li><span class="dot on"></span><span class="me-edit"><input class="text" id="renameIn" maxlength="20" value="${esc(typed ?? m.name)}" aria-label="Your username for this draft"><button class="ghost" type="button" data-act="rename-save">Save</button><button class="linkish" type="button" data-act="rename-cancel">Cancel</button></span></li>`;
    return `<li><span class="dot ${on ? 'on' : ''}" title="${on ? 'Online' : 'Offline'}"></span>${esc(m.name)}${m.uid === r.host ? ' <span class="tag">Host</span>' : ''}${me ? ' <span class="tag">You</span> <button class="linkish" type="button" data-act="rename">Change name</button>' : ''}${on ? '' : ' <span class="tag">Offline</span>'}</li>`;
  };
  const tooMany = humans > MAX_SEATS;
  $('#app').innerHTML = `<section class="lobby"><div>
      <p class="lede" style="margin:0">Room code</p><p class="roomcode">${esc(S.code)}</p>
      <div class="invite"><button class="cta" type="button" data-act="copy-link">Copy invite link</button><code id="inviteLink">${esc(link)}</code></div>
      <h3>Players (${humans})</h3><ul class="people">${members.map(row).join('')}</ul>
      ${S.error ? `<p class="err" role="alert" style="margin-top:10px">${esc(S.error)}</p>` : ''}
      <p class="summary">${esc(cfg.title)}, ${st.mode === 'deck' && cfg.tiers !== 'md' ? `deck draft (${({ comp: 'competitive', struct: 'structure', both: 'competitive and structure' })[P[st.pool] && P[st.pool].decks.comp.length ? (st.src || 'comp') : 'struct']} decks)` : `booster draft (${st.contents === 'pool' ? 'whole pool' : 'real sets'})`}. ${humans} player${humans === 1 ? '' : 's'} and ${bots} bot${bots === 1 ? '' : 's'}: ${seatsN} seats, ${st.mode === 'deck' && cfg.tiers !== 'md' ? `${seatsN} pre-built decks${st.bonus !== 'off' ? ` plus ${Math.ceil(seatsN / 2)} bonus pack${Math.ceil(seatsN / 2) === 1 ? '' : 's'}` : ''} in stacks of ${STACK}` : `${st.packs * 9} cards each`}.</p>
      ${host ? `<div class="row" style="margin-top:14px"><button class="cta" type="button" data-act="start-online" ${S.busy || seatsN < 2 || tooMany ? 'disabled' : ''}>${S.busy ? 'Starting…' : 'Start the draft'}</button></div>
        <p class="waitnote">${tooMany ? `The table holds ${MAX_SEATS}. Ask someone to leave first.` : seatsN < 2 ? 'Add a bot or wait for a friend. A draft needs at least 2 seats.' : 'Seats are shuffled when you start. Anyone who joins after that can only watch.'}</p>`
      : `<p class="waitnote">Waiting for ${esc(hostName)} to start the draft.</p>${hostOnline ? '' : '<div class="row" style="margin-top:10px"><span class="err">The host is offline.</span><button class="ghost" type="button" data-act="take-host">Take over as host</button></div>'}`}
    </div>
    <div><h3>Draft settings</h3>${settingsHTML(st, host, true, humans)}${host ? '' : '<p class="waitnote">Only the host can change these.</p>'}</div></section>`;
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
  usePool(g.settings.pool);
  if (g.finished) { enterBuild(); return; }
  const pack = g.packs[me], picks = g.picks[me], n = need(g, me), done = g.done[me];
  const key = `${g.id}:${g.round}:${g.turn}`;
  let anim = null;
  if (S.lastKey !== key) {
    const prev = S.lastKey ? S.lastKey.split(':') : null;
    anim = !prev || prev[0] !== g.id || +prev[1] !== g.round ? 'open' : (g.round % 2 === 0 ? 'from-right' : 'from-left');
    S.lastKey = key; S.sel = []; S.focus = null; S.expanded = false;
  }
  S.sel = S.sel.filter(s => pack.some(x => String(x) === s));
  const deckMode = g.settings.mode === 'deck';
  const d = g.round % 2 === 0 ? 1 : -1; const st = g.settings;
  const where = deckMode ? `Stack round ${g.round + 1} of ${deckRounds(g)}` : st.atOnce === 2 ? `Round ${g.round + 1} of ${roundsOf(st)}` : `Pack ${g.round + 1} of ${st.packs}`;
  const actions = S.online ? [`<button class="ghost" type="button" data-act="leave">Leave</button>`] : [`<button class="ghost" type="button" data-act="restart">Start over</button>`];
  setBar(`<span>${where}, pick ${g.turn + 1}</span><span class="dir">${d === 1 ? ARROW_L : ARROW_R}Passing ${d === 1 ? 'left' : 'right'}</span>`, actions);
  const order = g.seats.map((_, k) => (me + k * d + g.seats.length * 8) % g.seats.length);
  const waitingOn = g.seats.map((s, i) => ({ s, i })).filter(x => !g.done[x.i] && x.i !== me);
  const host = isHost();
  const seatsHTML = `<ul class="seats" aria-label="Seats in passing order">${order.map(i => { const s = g.seats[i]; const off = S.online && !s.bot && !presenceOf(s.uid);
    return `<li class="${i === me ? 'me' : ''} ${off ? 'off' : ''}"><span class="${g.done[i] ? 'ok' : 'wait'}">${g.done[i] ? CHECK : DOTS}</span>${esc(i === me ? 'You' : s.name)}${s.bot && s.uid ? ' (bot)' : ''}</li>`; }).join('')}</ul>`;
  const reclaim = S.online && g.seats[me].bot ? `<div class="waitbar">A bot is picking for you. <button class="ghost" type="button" data-act="reclaim">Take my seat back</button></div>` : '';
  const waitbar = done && waitingOn.length ? `<div class="waitbar"><span>Waiting for ${esc(listNames(waitingOn.map(x => x.s.name)))}.</span>
      ${waitingOn.filter(x => !x.s.bot && (host || !presenceOf(x.s.uid))).map(x => `<button class="ghost" type="button" data-act="bot-for" data-seat="${x.i}">Let a bot pick for ${esc(x.s.name)}</button>`).join('')}</div>` : '';
  const hint = done ? 'Your pick is in.' : (n === 2 ? `Pick 2 cards. ${S.sel.length} of 2 chosen.` : 'Tap a card, then pick it.');
  const focus = S.focus != null ? withR(C(cidOf(S.focus)), rOf(S.focus, C(cidOf(S.focus)) || {})) : null;
  let act = '';
  if (!done && focus) {
    if (n === 1) act = `<button class="cta" type="button" data-act="pick" ${S.busy ? 'disabled' : ''}>Pick ${esc(focus.n)}</button><p class="hint">Or tap the card again.</p>`;
    else act = `<ul class="chosen">${S.sel.map((s, k) => `<li>${k + 1}. ${esc((C(cidOf(s)) || {}).n || '')}</li>`).join('')}</ul><button class="cta" type="button" data-act="pick" ${S.sel.length === n && !S.busy ? '' : 'disabled'}>${S.sel.length === n ? 'Pick these 2' : `Choose ${n - S.sel.length} more`}</button>`;
  }
  const sig = [key, done, S.sel.join(','), S.focus, S.busy, S.expanded, picks.length, g.seats[me].bot, wide()].join('|');
  if (!anim && S.lastSig === sig && $('#packGrid') && $('#seatsWrap')) { $('#seatsWrap').innerHTML = seatsHTML; $('#waitWrap').innerHTML = reclaim + waitbar; return; }
  S.lastSig = sig;
  const groups = { M: 0, S: 0, T: 0, F: 0 }; picks.forEach(id => { const c = C(id); if (c) groups[c.k]++; });
  const title = deckMode ? 'Your stack' : g.batch === 2 ? 'Your packs' : 'Your pack';
  const decksLine = deckMode && g.decksUsed.length ? `<p class="decksline">In the mix: ${esc(listNames([...new Set(g.decksUsed)]))}${g.bonusPacks ? `, plus ${g.bonusPacks} bonus pack${g.bonusPacks === 1 ? '' : 's'} of staples and rares` : ''}.</p>` : '';
  $('#app').innerHTML = `<section class="draft"><div>
      <div id="seatsWrap">${seatsHTML}</div><div id="waitWrap">${reclaim}${waitbar}</div>
      <div class="table" id="table">
        <div class="table-head"><h2>${title}</h2><p>${pack.length} card${pack.length === 1 ? '' : 's'} left. ${hint}</p></div>
        <div class="grid ${anim && anim !== 'open' ? anim : ''} ${done ? 'waiting' : ''}" id="packGrid">${pack.map(e => { const key = String(e); const k = S.sel.indexOf(key); const c0 = C(cidOf(e)); return cardHTML({ u: key, c: withR(c0, rOf(e, c0 || {})) }, { pressed: k >= 0, num: n === 2 && k >= 0 ? k + 1 : 0 }); }).join('')}</div>
        ${decksLine}
      </div>
      <div class="picks"><div class="picks-head"><h3>Your picks</h3><div class="tally"><span>${picks.length} total</span><span>${groups.M} monsters</span><span>${groups.S} spells</span><span>${groups.T} traps</span><span>${groups.F} extra deck</span></div></div>
        ${picks.length ? `<div class="strip">${picks.slice().reverse().map(id => cardHTML({ u: 'p' + id, c: C(id) })).join('')}</div>` : '<p class="empty">Nothing yet. Your first pick lands here.</p>'}</div>
      <div class="sheet-pad"></div></div>
    <aside class="detail ${S.expanded ? 'expanded' : ''}" id="detail" ${focus || wide() ? '' : 'hidden'}>
      ${focus ? detailHTML(focus, act) : `<p class="detail-empty">${done ? 'Your pick is in. The next pack arrives when everyone has picked.' : 'Tap a card to read it here.'}</p>`}
    </aside></section>`;
  if (anim === 'open') {
    let label = null;
    if (deckMode) {
      const pdk = P[g.settings.pool]; const all = pdk ? pdk.decks.struct.concat(pdk.decks.comp) : [];
      const names = shuffle([...new Set(g.decksUsed)]).slice(0, 3);
      label = { decks: names.map(n => { const d = all.find(x => x.n === n); const i = n.indexOf(', '); return { img: d && d.img, name: i > 0 ? n.slice(0, i) : n }; }) };
    }
    else if (g.settings.contents === 'pool') label = {};
    else { const pdx = P[g.settings.pool]; const mine = (g.opens && g.opens[me]) || []; if (pdx && pdx.sets.length && mine.length) label = { sets: mine.map(si => pdx.sets[si]).filter(Boolean) }; }
    playOpen(g.settings.pool, g.batch || 1, label);
  }
}

/* ================= pack opening ================= */
const RARE_FX = { 1: ['#E9EEF5', '#AEB6C1', 'Rare'], 2: ['#BFE3FF', '#FFFFFF', 'Super Rare'], 3: ['#FFE08A', '#F2B32E', 'Ultra Rare'], 4: ['#FF9BD6', '#9CC9FF', 'Secret Rare'] };
function playOpen(poolKey, packs, label) {
  const table = $('#table'), grid = $('#packGrid');
  if (!table || !grid) return;
  const cards = [...grid.querySelectorAll('.card')];
  const cleanup = () => cards.forEach(el => { el.getAnimations().forEach(a => a.cancel()); el.querySelectorAll('.back').forEach(b => b.remove()); el.style.opacity = ''; el.style.zIndex = ''; });
  const anims = []; const timers = []; let over = false; S.opening = true;
  const art = !label && P[poolKey] ? shuffle(P[poolKey].packs.slice()).map(x => x[1]) : [];
  const ov = document.createElement('div'); ov.className = 'opening'; ov.setAttribute('aria-hidden', 'true');
  const visuals = label && label.decks ? label.decks.map(deckVisualHTML)
    : label && label.sets ? label.sets.map(s => s.img ? packHTML(poolKey, { img: s.img, name: s.n }) : packHTML(poolKey, { big: 'PACK', era: s.n }))
    : Array.from({ length: packs }, (_, i) => packHTML(poolKey, label || (art.length ? { img: art[i % art.length] } : {})));
  ov.innerHTML = `<div class="shade"></div><div class="rays"></div><div class="flash"></div><div class="packs">${visuals.join('')}</div>`;
  table.appendChild(ov);
  const fx = document.createElement('div'); fx.className = 'fxlayer'; fx.setAttribute('aria-hidden', 'true'); table.appendChild(fx);
  cards.forEach(el => { el.style.opacity = '0'; });
  const A = (el, kf, opt) => { if (!el) return null; const a = el.animate(kf, { fill: 'both', ...opt }); anims.push(a); return a; };
  const at = (ms, fn) => timers.push(setTimeout(() => { if (!over) fn(); }, ms));
  const finish = () => {
    if (over) return; over = true; timers.forEach(clearTimeout);
    anims.forEach(a => { try { a.cancel(); } catch (_) {} });
    ov.remove(); fx.remove(); cleanup(); S.opening = false;
    document.querySelectorAll('[data-act="pick"]').forEach(b => { b.disabled = false; });
  };
  setTimeout(finish, 14000);
  document.querySelectorAll('[data-act="pick"]').forEach(b => { b.disabled = true; });
  const packEls = [...ov.querySelectorAll('.pack')];
  const jolt = (px, ms) => reduceMotion ? null : A(table, [0, px, -px, px * .7, -px * .6, px * .3, 0].map(x => ({ transform: `translate(${x}px, ${-x * .4}px)` })), { duration: ms, easing: 'ease-out', fill: 'none' });
  // 1. the packs slam down onto the table
  packEls.forEach((p, i) => A(p, [
    { transform: 'translateY(-320px) scale(.5) rotate(-16deg)', opacity: 0 },
    { transform: 'translateY(26px) scale(1.1) rotate(4deg)', opacity: 1, offset: .62 },
    { transform: 'translateY(-10px) scale(.97) rotate(-2deg)', offset: .82 },
    { transform: 'none', opacity: 1 }], { duration: 740, delay: i * 110, easing: 'cubic-bezier(.2,.8,.3,1)' }));
  at(500, () => jolt(5, 320));
  // 2. they hover and glow
  at(780, () => packEls.forEach((p, i) => {
    A(p, [{ transform: 'none' }, { transform: 'translateY(-16px) scale(1.04)' }, { transform: 'translateY(-4px) scale(1.02)' }], { duration: 520, delay: i * 60, easing: 'ease-in-out' });
    A(p.querySelector('.tearglow'), [{ opacity: 0, transform: 'scaleX(.1)' }, { opacity: .55, transform: 'scaleX(.8)' }, { opacity: .3, transform: 'scaleX(.6)' }], { duration: 520, delay: i * 60 });
  }));
  // 3. a violent shake while the tear line blazes
  at(1260, () => packEls.forEach((p, i) => {
    A(p, [0, -4, 5, -7, 8, -10, 11, -13, 14, -15, 12, -8, 0].map((r, k) => ({ transform: `translateY(-4px) rotate(${r}deg) scale(${1.02 + k * .008})` })), { duration: 950, delay: i * 50, easing: 'ease-in' });
    A(p.querySelector('.tearglow'), [{ opacity: .3 }, { opacity: .9 }, { opacity: .5 }, { opacity: 1 }, { opacity: .7 }, { opacity: 1, transform: 'scaleX(1.05) scaleY(1.6)' }], { duration: 950, delay: i * 50 });
  }));
  // 4. RIP: the top flies off, light pours out
  at(2220, () => {
    jolt(9, 420);
    packEls.forEach((p, i) => {
      if (p.classList.contains('deckbox') || p.classList.contains('deckstack')) {
        A(p, [{ transform: 'translateY(-4px) scale(1.1)', opacity: 1 }, { transform: 'translateY(-10px) scale(1.25)', opacity: 1, offset: .3 }, { transform: 'translateY(-30px) scale(1.5)', opacity: 0 }], { duration: 750, easing: 'cubic-bezier(.3,.6,.3,1)' });
        sparks(ov, p, ['#FFF3C4', '#F4CC62', '#FFFFFF', '#FFD27A'], 34); return;
      }
      A(p, [{ transform: 'translateY(-4px) scale(1.12)' }, { transform: 'translateY(6px) scale(1.02)' }], { duration: 380, easing: 'ease-out' });
      A(p.querySelector('.strip'), [{ transform: 'none', opacity: 1 }, { transform: `translate(${i % 2 ? -90 : 90}px,-120px) rotate(${i % 2 ? -40 : 40}deg)`, opacity: 1, offset: .35 }, { transform: `translate(${i % 2 ? -230 : 230}px,-360px) rotate(${i % 2 ? -110 : 110}deg)`, opacity: 0 }], { duration: 1000, easing: 'cubic-bezier(.25,.7,.3,1)' });
      A(p.querySelector('.tearglow'), [{ opacity: 1 }, { opacity: 0 }], { duration: 450 });
      sparks(ov, p, ['#FFF3C4', '#F4CC62', '#FFFFFF', '#FFD27A'], 34);
    });
    A(ov.querySelector('.flash'), [{ opacity: 0, transform: 'scale(.2)' }, { opacity: 1, transform: 'scale(1.1)', offset: .2 }, { opacity: 0, transform: 'scale(2.6)' }], { duration: 1000, easing: 'ease-out' });
    A(ov.querySelector('.rays'), [{ opacity: 0, transform: 'rotate(0deg) scale(.4)' }, { opacity: .85, transform: 'rotate(40deg) scale(1)', offset: .3 }, { opacity: 0, transform: 'rotate(120deg) scale(1.4)' }], { duration: 1700, easing: 'ease-out' });
  });
  // 5. the cards rise out one by one, soar across the table and flip face up
  const D0 = 2520;
  at(D0, () => {
    const tr = table.getBoundingClientRect(); const tcx = tr.left + tr.width / 2, tcy = tr.top + Math.min(tr.height, window.innerHeight) * .42;
    const centers = packEls.map(p => { const r = p.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height * .3]; });
    const tiers = cards.map(el => +el.dataset.tier || 0);
    const top = Math.max(...tiers); const rareIdx = top >= 1 ? tiers.lastIndexOf(top) : -1;
    const step = cards.length > 12 ? 62 : 105;
    packEls.forEach(p => A(p, [{ transform: 'translateY(6px) scale(1.02)', opacity: 1 }, { transform: 'translateY(70px) scale(.85) rotate(-4deg)', opacity: 0 }], { duration: 800, delay: 350, easing: 'ease-in' }));
    let t = 0, end = 0;
    const normals = cards.map((el, i) => i).filter(i => i !== rareIdx);
    const order = rareIdx >= 0 ? normals.concat([rareIdx]) : normals;
    order.forEach((i, k) => {
      const el = cards[i];
      const [cx, cy] = centers[Math.min(packEls.length - 1, Math.floor(i * packEls.length / cards.length))];
      const r = el.getBoundingClientRect(); const dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2);
      const rare = i === rareIdx; el.style.opacity = ''; el.style.zIndex = rare ? '25' : '7';
      const back = document.createElement('span'); back.className = 'back'; el.appendChild(back);
      const tilt = (k % 5 - 2) * 6;
      if (!rare) {
        const delay = t; t += step; const dur = 920; const E = 'cubic-bezier(.3,.7,.35,1)';
        A(el, [
          { transform: `translate(${dx}px,${dy + 30}px) scale(.4) rotateY(180deg) rotateZ(${tilt}deg)`, opacity: 0, easing: E },
          { transform: `translate(${dx}px,${dy - 120}px) scale(.62) rotateY(180deg) rotateZ(${tilt}deg)`, opacity: 1, offset: .28, easing: 'ease-in' },
          { transform: `translate(${dx * .45}px,${dy * .45 - 150}px) scale(1.05) rotateY(90deg) rotateZ(${tilt / 2}deg)`, offset: .62, easing: 'ease-out' },
          { transform: 'translate(0,-14px) scale(1.08) rotateY(0deg) rotateZ(0deg)', offset: .85, easing: 'ease-in-out' },
          { transform: 'translate(0,0) scale(1) rotateY(0deg) rotateZ(0deg)', opacity: 1 }
        ], { duration: dur, delay });
        A(back, [{ opacity: 1 }, { opacity: 1, offset: .62 }, { opacity: 0, offset: .621 }, { opacity: 0 }], { duration: dur, delay });
        end = Math.max(end, delay + dur);
      } else {
        const delay = t + 200; const dur = 2000; const cx2 = tcx - (r.left + r.width / 2), cy2 = tcy - (r.top + r.height / 2);
        A(el, [
          { transform: `translate(${dx}px,${dy + 30}px) scale(.4) rotateY(180deg) rotateZ(0deg)`, opacity: 0, easing: 'ease-out' },
          { transform: `translate(${dx}px,${dy - 120}px) scale(.62) rotateY(180deg) rotateZ(0deg)`, opacity: 1, offset: .12, easing: 'cubic-bezier(.3,.7,.35,1)' },
          { transform: `translate(${cx2}px,${cy2}px) scale(1.7) rotateY(180deg) rotateZ(0deg)`, offset: .36, easing: 'ease-in-out' },
          { transform: `translate(${cx2}px,${cy2}px) scale(1.78) rotateY(180deg) rotateZ(-3deg)`, offset: .46, easing: 'ease-in-out' },
          { transform: `translate(${cx2}px,${cy2}px) scale(1.78) rotateY(180deg) rotateZ(3deg)`, offset: .52, easing: 'ease-in' },
          { transform: `translate(${cx2}px,${cy2}px) scale(1.82) rotateY(90deg) rotateZ(0deg)`, offset: .6, easing: 'ease-out' },
          { transform: `translate(${cx2}px,${cy2}px) scale(1.85) rotateY(0deg) rotateZ(0deg)`, offset: .68 },
          { transform: `translate(${cx2}px,${cy2}px) scale(1.85) rotateY(0deg) rotateZ(0deg)`, offset: .84, easing: 'cubic-bezier(.4,0,.2,1)' },
          { transform: 'translate(0,0) scale(1) rotateY(0deg) rotateZ(0deg)', opacity: 1 }
        ], { duration: dur, delay });
        A(back, [{ opacity: 1 }, { opacity: 1, offset: .6 }, { opacity: 0, offset: .601 }, { opacity: 0 }], { duration: dur, delay });
        at(D0 + delay + dur * .68, () => { rareBurst(fx, el, top); jolt(6, 320); });
        end = Math.max(end, delay + dur);
      }
    });
    A(ov.querySelector('.shade'), [{ opacity: 1 }, { opacity: 0 }], { duration: 700, delay: Math.max(0, end - 500), easing: 'ease-out' });
    at(D0 + end + 450, finish);
  });
}
function sparks(ov, anchor, colors, n) {
  const box = ov.getBoundingClientRect(), r = anchor.getBoundingClientRect();
  const x0 = r.left + r.width / 2 - box.left, y0 = r.top + r.height * .12 - box.top;
  for (let k = 0; k < n; k++) {
    const s = document.createElement('span'); s.className = 'spark'; s.style.left = x0 + 'px'; s.style.top = y0 + 'px'; s.style.background = colors[k % colors.length]; ov.appendChild(s);
    const a = Math.random() * Math.PI * 2, dist = 50 + Math.random() * 120;
    s.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * dist}px), calc(-50% + ${Math.sin(a) * dist - 30}px)) scale(.2)`, opacity: 0 }],
      { duration: 600 + Math.random() * 400, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' }).onfinish = () => s.remove();
  }
}
function rareBurst(ov, el, tier) {
  if (!ov.isConnected) return;
  const md = ACT && ACT.cfg.tiers === 'md';
  const fx = md ? ['#9FD2FF', '#2F7BE0', 'R'] : (RARE_FX[tier] || RARE_FX[1]); const box = ov.getBoundingClientRect(), r = el.getBoundingClientRect();
  const ring = document.createElement('span'); ring.className = 'ring';
  Object.assign(ring.style, { left: (r.left - box.left + r.width / 2) + 'px', top: (r.top - box.top + r.height / 2) + 'px', width: r.width * 1.1 + 'px', height: r.height * 1.1 + 'px', boxShadow: `0 0 34px 10px ${fx[0]}, inset 0 0 24px 6px ${fx[1]}` });
  ov.appendChild(ring);
  ring.animate([{ transform: 'translate(-50%,-50%) scale(.8)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .3 }, { transform: 'translate(-50%,-50%) scale(1.25)', opacity: 0 }], { duration: 1300, easing: 'ease-out', fill: 'forwards' });
  sparks(ov, el, [fx[0], fx[1], '#FFFFFF'], tier >= 3 ? 44 : 28);
  if (md) return;
  const tag = document.createElement('span'); tag.className = 'raretag'; tag.textContent = fx[2];
  Object.assign(tag.style, { left: (r.left - box.left + r.width / 2) + 'px', top: (r.top - box.top - 6) + 'px', color: tier === 4 ? '#FFD6F0' : fx[0] });
  ov.appendChild(tag);
  tag.animate([{ transform: 'translate(-50%,0) scale(.5)', opacity: 0 }, { transform: 'translate(-50%,-22px) scale(1.15)', opacity: 1, offset: .2 }, { transform: 'translate(-50%,-30px) scale(1)', opacity: 1, offset: .7 }, { transform: 'translate(-50%,-44px) scale(1)', opacity: 0 }], { duration: 1700, easing: 'ease-out', fill: 'forwards' });
}

/* ================= deck building screen ================= */
function renderBuild() {
  const g = game(); if (!g) { S.view = S.online ? 'lobby' : 'home'; render(); return; }
  usePool(g.settings.pool);
  const tour = S.online ? activeTour() : null;
  if (tour && (S.tab !== 'deck' || mySeat(g) < 0)) { renderTourView(tour); return; }
  if (mySeat(g) < 0) { S.view = S.online ? 'lobby' : 'home'; render(); return; }
  ensureDeck();
  const picks = myPicks(); const m = new Map(picks.map(p => [p.u, p]));
  const zones = { main: [], extra: [], side: [], pool: [] }; picks.forEach(p => zones[zoneOf(p.u)].push(p));
  const ord = p => ({ M: 0, S: 1, T: 2, F: 3 }[p.c.k] * 100000 - (p.c.k === 'M' ? (p.c.lv || 0) * 1000 : 0));
  for (const z in zones) {
    zones[z].sort((a, b) => ord(a) - ord(b) || a.c.n.localeCompare(b.c.n));
    const custom = (S.deck.order || {})[z];
    if (custom && custom.length) { const pos = new Map(custom.map((u, i) => [u, i])); const base = new Map(zones[z].map((p, i) => [p.u, i]));
      zones[z].sort((a, b) => (pos.has(a.u) ? pos.get(a.u) : 1e6 + base.get(a.u)) - (pos.has(b.u) ? pos.get(b.u) : 1e6 + base.get(b.u))); }
  }
  S.visibleOrder = Object.fromEntries(Object.entries(zones).map(([z, l]) => [z, l.map(p => p.u)]));
  const mainN = zones.main.length, exN = zones.extra.length, sdN = zones.side.length;
  const warns = deckWarnings(); const sel = S.buildSel != null ? m.get(S.buildSel) : null;
  const actions = [];
  if (S.online && isHost()) actions.push(`<button class="ghost" type="button" data-act="new-draft">New draft</button>`);
  actions.push(S.online ? `<button class="ghost" type="button" data-act="leave">Leave</button>` : `<button class="ghost" type="button" data-act="restart">Start over</button>`);
  setBar(`<span>Build your deck</span>`, actions);
  const zoneBlock = (key, title, note, list, dim) => `<section class="zone" data-zone="${key}"><h3>${title}<span>${note}</span></h3>${list.length ? `<div class="zgrid ${dim ? 'dim' : ''}">${list.map(p => cardHTML(p, { pressed: p.u === S.buildSel })).join('')}</div>` : `<p class="empty">${key === 'pool' ? 'Every pick is in your deck.' : 'Empty. Drag cards here.'}</p>`}</section>`;
  let act = '';
  if (sel) {
    const z = zoneOf(sel.u), home = sel.c.k === 'F' ? 'extra' : 'main';
    if (z === 'pool') act = `<button class="cta" type="button" data-act="to-${home}">Add to ${home} deck</button><button class="ghost" type="button" data-act="to-side">Add to side deck</button>`;
    else if (z === 'side') act = `<button class="cta" type="button" data-act="to-${home}">Move to ${home} deck</button><button class="ghost" type="button" data-act="to-pool">Take out of side deck</button>`;
    else act = `<button class="cta" type="button" data-act="to-pool">Take out of deck</button><button class="ghost" type="button" data-act="to-side">Move to side deck</button>`;
  }
  const md = ACT.cfg.tiers === 'md';
  $('#app').innerHTML = `<section class="build"><div>
    ${tour ? tourTabs('deck') : ''}
    ${readyHTML(g)}
    <div class="buildbar"><span class="count ${mainN >= 40 && mainN <= 60 ? 'ok' : 'bad'}">Main ${mainN} / 40</span><span class="count ${exN <= 15 ? '' : 'bad'}">Extra ${exN}</span><span class="count ${sdN <= 15 ? '' : 'bad'}">Side ${sdN}</span><span class="spacer"></span>
      <button class="ghost" type="button" data-act="auto">Rebuild automatically</button><button class="ghost" type="button" data-act="fillside">Fill side from unused</button>${Object.values(S.deck.order || {}).some(l => l && l.length) ? '<button class="ghost" type="button" data-act="sortzones">Sort by type</button>' : ''}</div>
    <p class="draghint">Drag cards between sections, or within one to reorder. On a phone, hold a card for a moment, then drag.</p>
    ${warns.length ? `<p class="warn">More than 3 copies: ${warns.map(esc).join('; ')}.</p>` : ''}
    ${zoneBlock('main', 'Main deck', `${mainN} cards, needs 40 to 60`, zones.main)}
    ${zoneBlock('extra', 'Extra deck', `${exN} of 15`, zones.extra)}
    ${zoneBlock('side', 'Side deck', `${sdN} of 15`, zones.side)}
    ${zoneBlock('pool', 'Unused picks', `${zones.pool.length} cards`, zones.pool, true)}
    <section class="export"><h3>Export</h3>
      <p>Same layout as a YGOPRODeck .ydk: #main, #extra and !side, one card ID per line, sorted by ID. ${md ? 'Import it into YGOPRODeck or a Master Duel deck-transfer tool to build it in Master Duel.' : 'Load it in DuelingBook, EDOPro or YGOPRODeck.'}</p>
      <div class="row"><button class="cta" type="button" data-act="download" ${mainN ? '' : 'disabled'}>Download .ydk</button><button class="ghost" type="button" data-act="copy" ${mainN ? '' : 'disabled'}>Copy text</button></div>
      <div class="row"><button class="ghost" type="button" data-act="testhand" ${mainN >= 5 ? '' : 'disabled'}>Draw a test hand</button><button class="ghost" type="button" data-act="savedeck" ${mainN ? '' : 'disabled'}>Save this deck</button></div>
      <div id="testHand"></div><div id="saveBox"></div>
      ${savedDecksHTML()}
      <details><summary>Preview the file</summary><textarea id="ydkPreview" readonly spellcheck="false">${esc(ydkText())}</textarea></details></section>
    ${POOLS[ACT.key] ? `<section class="export play"><h3>Play it</h3><p>Duel with this deck on the duel table: test it solo, or send a friend an invite. No tournament needed.</p>
      <div class="row"><button class="cta" type="button" data-act="duel-friend" ${mainN >= 20 ? '' : 'disabled'}>Duel a friend</button><button class="ghost" type="button" data-act="duel" ${mainN >= 20 ? '' : 'disabled'}>Test it solo</button></div></section>` : ''}
    <div class="sheet-pad"></div></div>
    <aside class="detail ${S.expanded ? 'expanded' : ''}" id="detail" ${sel || wide() ? '' : 'hidden'}>
      ${sel ? detailHTML(sel.c, act) : '<p class="detail-empty">Tap a card to see it and move it between your deck, side deck and unused picks.</p>'}</aside></section>`;
}
function readyInfo(g) {
  const rd = (S.room && S.room.ready && S.room.ready[g.id]) || {};
  const people = g.seats.filter(s => s.uid); const waiting = people.filter(s => rd[s.uid] !== true);
  return { rd, people, waiting, all: waiting.length === 0, meReady: rd[S.uid] === true };
}
function tourBoxHTML(g, people, waiting) {
  if (people.length < 2) return '';
  if (activeTour()) return `<div class="tourstart"><p><b>A tournament is running.</b> Open the Tournament tab to see your match.</p></div>`;
  const st = Object.assign({}, DEFAULTS, (S.room && S.room.settings) || {}); const host = isHost();
  const fmt = TFORMATS[st.tour] ? st.tour : 'rr'; const regs = tourRegistered(g);
  const seg = (key, cur, opts) => `<div class="seg small" role="radiogroup">${opts.map(([v, l]) => `<label><input type="radio" name="set-${key}" value="${v}" ${String(cur) === String(v) ? 'checked' : ''} ${host ? '' : 'disabled'}><span>${esc(l)}</span></label>`).join('')}</div>`;
  return `<div class="tourstart"><p><b>Tournament</b> ${regs.length >= 2 ? `with ${regs.length} ready players` : ''}<small>${esc(TOUR_HELP[fmt])} Optional: you can also just duel freely.</small></p>
    ${host ? `${seg('tour', fmt, [['rr', 'Round robin'], ['swiss', 'Swiss'], ['se', 'Single elimination']])}${seg('bestOf', +st.bestOf === 3 ? 3 : 1, [[1, 'Best of 1'], [3, 'Best of 3']])}
      <div class="row"><button class="cta" type="button" data-act="tour-start" ${regs.length >= 2 && !S.busy ? '' : 'disabled'}>Start the tournament</button>${regs.length < 2 ? '<span class="waitnote" style="margin:0">At least 2 players need to be ready.</span>' : waiting.length ? '<span class="waitnote" style="margin:0">Anyone not ready yet is left out.</span>' : ''}</div>`
    : `<p class="waitnote" style="margin:0">The host can start a tournament (${esc(TFORMATS[fmt].toLowerCase())}, best of ${+st.bestOf === 3 ? 3 : 1}) once decks are ready.</p>`}</div>`;
}
function readyHTML(g) {
  if (!S.online) return '';
  const { rd, people, waiting, all, meReady } = readyInfo(g);
  const names = waiting.map(s => s.uid === S.uid ? 'you' : s.name);
  const chips = people.map(s => `<li class="${s.uid === S.uid ? 'me' : ''}"><span class="${rd[s.uid] === true ? 'ok' : 'wait'}">${rd[s.uid] === true ? CHECK : DOTS}</span>${esc(s.uid === S.uid ? 'You' : s.name)}</li>`).join('');
  const where = 'load your .ydk in DuelingBook';
  return `<div class="roomstatus ${all ? 'allready' : ''}" id="readyPanel">
    <p>${all ? `Everyone is ready. Time to ${where} and start dueling.` : `Deck building: ${people.length - waiting.length} of ${people.length} ready. Waiting for ${esc(listNames(names))}.`}</p>
    <ul class="seats">${chips}</ul>
    <div class="row">${meReady ? `<span class="okline">${CHECK}You’re ready.</span><button class="ghost" type="button" data-act="unready">Keep editing</button>` : `<button class="cta" type="button" data-act="ready">I’m done building</button><span class="waitnote" style="margin:0">Download your .ydk first, then tap this.</span>`}</div>
    ${tourBoxHTML(g, people, waiting)}
    ${POOLS[g.settings.pool] ? `<div class="casual"><p><b>Just want to play?</b> Duel anyone from this room without a tournament: send them an invite from the duel table.</p><div class="row"><button class="ghost" type="button" data-act="duel-friend">Duel a friend</button></div></div>` : ''}
  </div>`;
}

/* ================= tournament for the players of an online draft ================= */
const TFORMATS = { rr: 'Round robin', swiss: 'Swiss', se: 'Single elimination' };
const TOUR_HELP = { rr: 'Everyone plays everyone once.', swiss: 'A few rounds. Each round you face someone with a similar record.', se: 'Lose a match and you are out. The last one standing wins.' };
const TROPHY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 15v2h3v3H8v-3h3v-2a5 5 0 0 1-2.7-3H8a4 4 0 0 1-4-4V5h3zm0 4H6v1a2 2 0 0 0 1 1.7zm10 0v2.7A2 2 0 0 0 18 8V7z"/></svg>';
const tArr = x => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.keys(x).sort((a, b) => a - b).map(k => x[k]) : []);
function normTour(t) {
  if (!t) return null;
  t.order = tArr(t.order).filter(Boolean); t.players = t.players || {};
  t.rounds = tArr(t.rounds).map(r => ({ matches: tArr(r && r.matches).map(m => ({ a: m.a, b: m.b || null, games: m.games || {} })) }));
  t.round = t.round || 0; t.done = !!t.done; t.bestOf = t.bestOf === 3 ? 3 : 1; t.total = t.total || tTotal(t.format, t.order.length);
  return t;
}
function tTotal(format, n) { return format === 'rr' ? Math.max(1, n % 2 ? n : n - 1) : Math.max(1, Math.ceil(Math.log2(Math.max(2, n)))); }
function tRoundRobin(uids) {
  const list = uids.slice(); if (list.length % 2) list.push(null);
  const n = list.length, rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const matches = [];
    for (let i = 0; i < n / 2; i++) { const a = list[i], b = list[n - 1 - i]; if (a == null && b == null) continue; matches.push(a == null ? { a: b, b: null } : { a, b }); }
    matches.sort((x, y) => (x.b ? 0 : 1) - (y.b ? 0 : 1)); rounds.push({ matches }); list.splice(1, 0, list.pop());
  }
  return rounds;
}
function tSeedOrder(size) { let s = [1]; while (s.length < size) { const m = s.length * 2 + 1; s = s.flatMap(x => [x, m - x]); } return s; }
function tBracket(uids) {
  const size = 2 ** Math.ceil(Math.log2(Math.max(2, uids.length))); const ord = tSeedOrder(size); const matches = [];
  for (let k = 0; k < size / 2; k++) { const a = uids[ord[2 * k] - 1] ?? null, b = uids[ord[2 * k + 1] - 1] ?? null; if (a == null && b == null) continue; matches.push(a == null ? { a: b, b: null } : { a, b }); }
  return { matches };
}
function makeTour({ id, format, bestOf, players, gid }) {
  const order = shuffle(players.map(p => p.uid));
  const t = { id, gid, format: TFORMATS[format] ? format : 'rr', bestOf: bestOf === 3 ? 3 : 1, created: Date.now(), round: 0, done: false,
    players: Object.fromEntries(players.map(p => [p.uid, { name: p.name, ydk: p.ydk || '' }])), order };
  t.total = tTotal(t.format, order.length);
  t.rounds = t.format === 'rr' ? tRoundRobin(order) : t.format === 'se' ? [tBracket(order)] : [tSwiss(t, order)];
  return t;
}
const tNeed = t => (t.bestOf === 3 ? 2 : 1);
function tResult(t, m) {
  const n = tNeed(t);
  if (!m.b) return { done: true, winner: m.a, wa: n, wb: 0, bye: true };
  const g = Object.keys(m.games || {}).sort().map(k => m.games[k]);
  const wa = g.filter(x => x === m.a).length, wb = g.filter(x => x === m.b).length;
  const winner = wa >= n ? m.a : wb >= n ? m.b : null;
  return { done: !!winner, winner, wa, wb, bye: false };
}
const tRoundDone = (t, r = t.round) => !!t.rounds[r] && t.rounds[r].matches.every(m => tResult(t, m).done);
function tStandings(t) {
  const P0 = {};
  for (const uid of t.order) P0[uid] = { uid, name: (t.players[uid] && t.players[uid].name) || 'Player', mw: 0, ml: 0, gw: 0, gl: 0, pts: 0, opps: [], byes: 0, out: null };
  t.rounds.forEach((r, ri) => r.matches.forEach(m => {
    const res = tResult(t, m); if (!res.done || !P0[m.a]) return;
    if (res.bye) { P0[m.a].mw++; P0[m.a].pts += 3; P0[m.a].byes++; P0[m.a].gw += res.wa; return; }
    if (!P0[m.b]) return;
    P0[m.a].opps.push(m.b); P0[m.b].opps.push(m.a);
    P0[m.a].gw += res.wa; P0[m.a].gl += res.wb; P0[m.b].gw += res.wb; P0[m.b].gl += res.wa;
    const w = P0[res.winner], l = P0[res.winner === m.a ? m.b : m.a]; w.mw++; w.pts += 3; l.ml++;
    if (t.format === 'se') l.out = ri;
  }));
  const mwp = p => Math.max(1 / 3, p.mw / Math.max(1, p.mw + p.ml)); const list = Object.values(P0);
  for (const p of list) p.omw = p.opps.length ? p.opps.reduce((a, o) => a + mwp(P0[o]), 0) / p.opps.length : 0;
  const alive = p => (p.out == null ? 99 : p.out);
  list.sort((a, b) => (t.format === 'se' ? alive(b) - alive(a) : 0) || b.pts - a.pts || b.omw - a.omw || (b.gw - b.gl) - (a.gw - a.gl) || a.name.localeCompare(b.name));
  return list;
}
function tSwiss(t, order) {
  const st = t.rounds && t.rounds.length ? tStandings(t) : order.map(uid => ({ uid, pts: 0, byes: 0 }));
  const played = new Set(); (t.rounds || []).forEach(r => r.matches.forEach(m => { if (m.b) { played.add(`${m.a}|${m.b}`); played.add(`${m.b}|${m.a}`); } }));
  const matches = []; const pool = st.map(p => p.uid);
  if (pool.length % 2) { const byes = new Map(st.map(p => [p.uid, p.byes || 0])); let k = pool.length - 1; while (k > 0 && byes.get(pool[k]) > 0) k--; const [bye] = pool.splice(k, 1); matches.push({ a: bye, b: null }); }
  const solve = list => { if (!list.length) return []; const [a, ...rest] = list; for (let j = 0; j < rest.length; j++) { if (played.has(`${a}|${rest[j]}`)) continue; const sub = solve(rest.filter((_, k) => k !== j)); if (sub) return [{ a, b: rest[j] }, ...sub]; } return null; };
  let pairs = pool.length <= 12 ? solve(pool) : null;
  if (!pairs) { pairs = []; for (let k = 0; k < pool.length; k += 2) pairs.push({ a: pool[k], b: pool[k + 1] }); }
  matches.unshift(...pairs);
  return { matches: matches.sort((x, y) => (x.b ? 0 : 1) - (y.b ? 0 : 1)) };
}
function tAdvance(t) {
  if (t.done || !tRoundDone(t)) return false;
  if (t.format === 'rr') { if (t.round + 1 < t.rounds.length) t.round++; else t.done = true; return true; }
  if (t.format === 'se') {
    const winners = t.rounds[t.round].matches.map(m => tResult(t, m).winner);
    if (winners.length <= 1) { t.done = true; return true; }
    const matches = []; for (let k = 0; k < winners.length; k += 2) matches.push(winners[k + 1] ? { a: winners[k], b: winners[k + 1] } : { a: winners[k], b: null });
    t.rounds.push({ matches }); t.round++; return true;
  }
  if (t.round + 1 >= t.total) { t.done = true; return true; }
  t.rounds.push(tSwiss(t, t.order)); t.round++; return true;
}
function tChampion(t) {
  if (!t.done) return null;
  if (t.format === 'se') { const last = t.rounds[t.rounds.length - 1]; const m = last && last.matches[0]; return m ? tResult(t, m).winner : null; }
  const st = tStandings(t); return st.length ? st[0].uid : null;
}
const tRoundName = (t, r) => { if (t.format !== 'se') return `Round ${r + 1}`; const left = t.total - r; return left === 1 ? 'Final' : left === 2 ? 'Semifinal' : left === 3 ? 'Quarterfinal' : `Round ${r + 1}`; };
function activeTour() { const g = game(); const raw = S.room && S.room.tour; if (!g || !raw || raw.gid !== g.id) return null; return normTour(JSON.parse(JSON.stringify(raw))); }
function tourRegistered(g) {
  const rd = (S.room && S.room.ready && S.room.ready[g.id]) || {}; const decks = (S.room && S.room.decks && S.room.decks[g.id]) || {};
  return g.seats.filter(s => s.uid && rd[s.uid] === true).map(s => ({ uid: s.uid, name: (decks[s.uid] && decks[s.uid].name) || s.name, ydk: (decks[s.uid] && decks[s.uid].ydk) || '' }));
}
async function startTour() {
  const g = game(); const players = tourRegistered(g);
  if (players.length < 2) { toast('At least 2 players need to be ready.'); return; }
  const st = Object.assign({}, DEFAULTS, S.room.settings || {});
  const fmt = TFORMATS[st.tour] ? st.tour : 'rr';
  const tour = makeTour({ id: Math.random().toString(36).slice(2, 10), gid: g.id, format: fmt, bestOf: +st.bestOf === 3 ? 3 : 1, players });
  const F = await fb(); S.busy = true; render();
  try { await F.runTransaction(roomRef(F, '/tour'), cur => (cur && cur.gid === g.id && !cur.done ? undefined : tour)); S.tab = 'tour'; }
  catch (e) { toast('Couldn’t start the tournament. Check your connection.'); }
  finally { S.busy = false; render(); }
}
async function tourGame(r, i, winner) {
  const t = activeTour(); const m = t && t.rounds[r] && t.rounds[r].matches[i]; if (!m || tResult(t, m).done) return;
  const F = await fb(); await F.push(roomRef(F, `/tour/rounds/${r}/matches/${i}/games`), winner);
}
async function tourUndo(r, i) {
  const t = activeTour(); const m = t && t.rounds[r] && t.rounds[r].matches[i]; if (!m) return;
  const keys = Object.keys(m.games || {}).sort(); if (!keys.length) return;
  const F = await fb(); await F.remove(roomRef(F, `/tour/rounds/${r}/matches/${i}/games/${keys[keys.length - 1]}`));
}
async function tourNext() { const F = await fb(); await F.runTransaction(roomRef(F, '/tour'), cur => { if (!cur) return cur; const t = normTour(cur); return tAdvance(t) ? t : undefined; }); }
async function tourReset() { const F = await fb(); await F.set(roomRef(F, '/tour'), null); S.tab = 'deck'; }
const tName = (t, uid) => uid === S.uid ? 'You' : (t.players[uid] && t.players[uid].name) || 'Player';
function tMatchRow(t, r, i, m, live) {
  const res = tResult(t, m); const host = isHost(); const nm = uid => esc(tName(t, uid));
  if (!m.b) return `<li class="bye"><span class="p a win">${nm(m.a)}</span><span class="score">bye</span><span class="p b"></span><span class="mstat">Counts as a win</span></li>`;
  const mine = m.a === S.uid || m.b === S.uid; const games = Object.keys(m.games || {}).length;
  const ctl = [];
  if (live && !t.done && host && !mine && !res.done) ctl.push(`<button class="ghost small" type="button" data-act="tour-game" data-r="${r}" data-i="${i}" data-w="${esc(m.a)}">+1 ${nm(m.a)}</button><button class="ghost small" type="button" data-act="tour-game" data-r="${r}" data-i="${i}" data-w="${esc(m.b)}">+1 ${nm(m.b)}</button>`);
  if (live && !t.done && host && !mine && games) ctl.push(`<button class="linkish" type="button" data-act="tour-undo" data-r="${r}" data-i="${i}">Undo</button>`);
  const stat = res.done ? `${nm(res.winner)} won` : games ? 'Playing' : 'Not started';
  return `<li class="${res.done ? 'done' : ''} ${mine ? 'mine' : ''}"><span class="p a ${res.winner === m.a ? 'win' : ''}">${nm(m.a)}</span><span class="score">${res.wa} – ${res.wb}</span><span class="p b ${res.winner === m.b ? 'win' : ''}">${nm(m.b)}</span><span class="mstat">${stat}</span>${ctl.length ? `<span class="mctl">${ctl.join('')}</span>` : ''}</li>`;
}
function tourTabs(active) { return `<div class="ttabs" role="tablist"><button type="button" role="tab" aria-selected="${active === 'tour'}" data-act="tab-tour">Tournament</button><button type="button" role="tab" aria-selected="${active === 'deck'}" data-act="tab-deck">My deck</button></div>`; }
function renderTourView(t) {
  const host = isHost(); const g = game();
  const actions = [];
  if (host) actions.push(`<button class="ghost" type="button" data-act="tour-reset">End tournament</button>`, `<button class="ghost" type="button" data-act="new-draft">New draft</button>`);
  actions.push(`<button class="ghost" type="button" data-act="leave">Leave</button>`);
  setBar(`<span>Tournament: ${esc(TFORMATS[t.format])}, best of ${t.bestOf}</span>`, actions);
  const r = t.round, round = t.rounds[r], st = tStandings(t), champ = tChampion(t);
  const myI = round ? round.matches.findIndex(m => m.a === S.uid || m.b === S.uid) : -1;
  let myBox = '';
  if (!t.done && myI >= 0) {
    const m = round.matches[myI]; const res = tResult(t, m);
    if (!m.b) myBox = `<div class="mymatch"><h3>Your match</h3><p>You have a bye this round. It counts as a win.</p></div>`;
    else {
      const opp = m.a === S.uid ? m.b : m.a; const mine = m.a === S.uid ? res.wa : res.wb, theirs = m.a === S.uid ? res.wb : res.wa; const games = Object.keys(m.games || {}).length;
      myBox = `<div class="mymatch ${res.done ? (res.winner === S.uid ? 'won' : 'lost') : ''}"><h3>Your match: you vs ${esc(tName(t, opp))}</h3><p class="bigscore">${mine} – ${theirs}</p>
        <p>${res.done ? (res.winner === S.uid ? 'You won this round.' : 'You lost this round.') : `${t.bestOf === 3 ? 'Best of 3: first to 2 games wins.' : 'One game.'} Duel on DuelingBook, EDOPro or face to face with your .ydk, then report each game here.`}</p>
        ${res.done ? '' : `<div class="row"><button class="cta" type="button" data-act="tour-game" data-r="${r}" data-i="${myI}" data-w="${esc(S.uid)}">I won a game</button><button class="ghost" type="button" data-act="tour-game" data-r="${r}" data-i="${myI}" data-w="${esc(opp)}">I lost a game</button>${games ? `<button class="linkish" type="button" data-act="tour-undo" data-r="${r}" data-i="${myI}">Undo the last one</button>` : ''}<button class="ghost" type="button" data-act="download">Download my .ydk</button></div>${POOLS[game().settings.pool] ? `<div class="row"><a class="cta" href="duel/?match=${esc(S.code)}.${r}.${myI}" target="_blank" rel="noopener">Play this match on the duel table</a><span class="waitnote" style="margin:0">The winner of each game is reported here automatically.</span></div>` : ''}`}</div>`;
    }
  } else if (!t.done && !t.players[S.uid]) myBox = '<div class="mymatch"><p>You’re not in this tournament, but you can follow it here.</p></div>';
  const pending = round ? round.matches.filter(m => !tResult(t, m).done).length : 0;
  const last = t.format === 'se' ? round && round.matches.length === 1 : r + 1 >= t.total;
  const next = !t.done && round ? (tRoundDone(t)
    ? (host ? `<div class="row"><button class="cta" type="button" data-act="tour-next">${last ? 'Finish the tournament' : 'Next round'}</button></div>` : `<p class="waitnote">Round over. The host ${last ? 'finishes the tournament' : 'starts the next round'}.</p>`)
    : `<p class="waitnote">${pending} match${pending === 1 ? '' : 'es'} still to play this round.</p>`) : '';
  const past = t.rounds.map((rr, ri) => ri === r && !t.done ? '' : `<details ${t.done && ri === t.rounds.length - 1 ? 'open' : ''}><summary>${esc(tRoundName(t, ri))}</summary><ol class="pairings">${rr.matches.map((m, i) => tMatchRow(t, ri, i, m, false)).join('')}</ol></details>`).reverse().join('');
  $('#app').innerHTML = `<section class="tourview"><div>
      ${tourTabs('tour')}
      ${t.done ? `<div class="champ"><span class="trophy">${TROPHY}</span><p class="lbl">Tournament champion</p><p class="who">${esc(champ ? tName(t, champ) : '')}</p></div>` : ''}
      ${myBox}
      ${t.done ? '' : `<section class="tround"><h2>${esc(tRoundName(t, r))} <small>of ${t.total}</small></h2><ol class="pairings">${round.matches.map((m, i) => tMatchRow(t, r, i, m, true)).join('')}</ol>${next}</section>`}
      ${past ? `<section class="tpast"><h3>Rounds</h3>${past}</section>` : ''}
    </div>
    <aside class="tside"><h3>Standings</h3>
      <table class="standings"><thead><tr><th>#</th><th>Player</th><th title="Points: 3 per match win">Pts</th><th title="Matches won and lost">W–L</th><th title="Games won and lost">Games</th></tr></thead>
      <tbody>${st.map((p, k) => `<tr class="${p.uid === S.uid ? 'me' : ''} ${t.done && k === 0 ? 'first' : ''}"><td>${k + 1}</td><td>${esc(tName(t, p.uid))}${t.format === 'se' && p.out != null && !(t.done && p.uid === champ) ? ` <small>out in ${esc(tRoundName(t, p.out).toLowerCase())}</small>` : ''}</td><td>${p.pts}</td><td>${p.mw}–${p.ml}</td><td>${p.gw}–${p.gl}</td></tr>`).join('')}</tbody></table>
      <p class="note">${t.format === 'se' ? 'Ordered by how far each player got.' : 'Ties are broken by opponents’ win rate, then game difference.'}</p>
      <div class="row"><button class="ghost" type="button" data-act="tour-download">Download results and decks</button></div>
    </aside></section>`;
}
function tourText(t) {
  const g = game(); const pd = P[g.settings.pool]; const st = tStandings(t); const champ = tChampion(t);
  const L = [`YGO Drafter tournament, room ${S.code}`, `Card pool: ${POOLS[g.settings.pool].title}`, `Format: ${TFORMATS[t.format]}, best of ${t.bestOf}`];
  if (champ) L.push(`Champion: ${(t.players[champ] || {}).name}`);
  L.push('', 'STANDINGS'); st.forEach((p, k) => L.push(`${k + 1}. ${p.name}: ${p.pts} pts, matches ${p.mw}-${p.ml}, games ${p.gw}-${p.gl}`));
  L.push('', 'ROUNDS');
  t.rounds.forEach((rr, ri) => { L.push(tRoundName(t, ri)); rr.matches.forEach(m => { const res = tResult(t, m); const n = u => (t.players[u] || {}).name || 'Player'; L.push(m.b ? `  ${n(m.a)} ${res.wa}-${res.wb} ${n(m.b)}${res.done ? `  (${n(res.winner)} won)` : '  (unfinished)'}` : `  ${n(m.a)} has a bye`); }); });
  L.push('', 'DECKS');
  st.forEach(p => {
    const pl = t.players[p.uid] || {}; L.push('', `== ${pl.name} ==`);
    let sec = 'Main'; const counts = new Map();
    const flush = () => { if (counts.size) { L.push(`${sec}:`); for (const [id, n] of counts) L.push(`  ${n}x ${((pd && pd.byId.get(id)) || {}).n || id}`); counts.clear(); } };
    for (const line of String(pl.ydk || '').split('\n')) { const s = line.trim(); if (s === '#main') { flush(); sec = 'Main'; } else if (s === '#extra') { flush(); sec = 'Extra'; } else if (s === '!side') { flush(); sec = 'Side'; } else if (/^\d+$/.test(s)) counts.set(+s, (counts.get(+s) || 0) + 1); }
    flush();
  });
  return L.join('\n');
}

/* ================= drag and drop in the deck builder ================= */
const DRAG = { el: null, ghost: null, sx: 0, sy: 0, ox: 0, oy: 0, started: false, timer: null, id: null, touch: false, swallow: false, raf: 0, y: 0, x: 0 };
function dragCancel() { clearTimeout(DRAG.timer); cancelAnimationFrame(DRAG.raf); if (DRAG.ghost) DRAG.ghost.remove(); if (DRAG.el) DRAG.el.classList.remove('dragging'); document.querySelectorAll('.drop-on,.drop-before').forEach(x => x.classList.remove('drop-on', 'drop-before')); document.body.classList.remove('is-dragging'); Object.assign(DRAG, { el: null, ghost: null, started: false, id: null }); }
function dragTarget(x, y) {
  const under = document.elementFromPoint(x, y); if (!under) return {};
  const zone = under.closest('.build [data-zone]'); if (!zone) return {};
  const before = under.closest('.zgrid .card'); return { zone, before: before && before !== DRAG.el ? before : null };
}
function dragStart(x, y) {
  const r = DRAG.el.getBoundingClientRect(); DRAG.ox = x - r.left; DRAG.oy = y - r.top;
  const g = DRAG.el.cloneNode(true); g.classList.add('drag-ghost'); g.style.width = r.width + 'px'; g.removeAttribute('aria-pressed');
  document.body.appendChild(g); DRAG.ghost = g; DRAG.started = true; DRAG.el.classList.add('dragging'); document.body.classList.add('is-dragging');
  if (navigator.vibrate && DRAG.touch) try { navigator.vibrate(12); } catch (_) {}
  dragMove(x, y);
  const tick = () => { if (!DRAG.started) return; const edge = 90, sp = DRAG.y < edge ? -(edge - DRAG.y) / 4 : DRAG.y > innerHeight - edge ? (DRAG.y - innerHeight + edge) / 4 : 0; if (sp) { scrollBy(0, sp); dragMove(DRAG.x, DRAG.y); } DRAG.raf = requestAnimationFrame(tick); };
  DRAG.raf = requestAnimationFrame(tick);
}
function dragMove(x, y) {
  DRAG.x = x; DRAG.y = y;
  DRAG.ghost.style.transform = `translate(${x - DRAG.ox}px, ${y - DRAG.oy}px) rotate(3deg) scale(1.05)`;
  document.querySelectorAll('.drop-on,.drop-before').forEach(el => el.classList.remove('drop-on', 'drop-before'));
  const { zone, before } = dragTarget(x, y); if (zone) zone.classList.add('drop-on'); if (before) before.classList.add('drop-before');
}
function dragFinish(x, y) {
  const { zone, before } = dragTarget(x, y); const u = +DRAG.el.dataset.u;
  dragCancel(); DRAG.swallow = true; setTimeout(() => { DRAG.swallow = false; }, 60);
  if (!zone) return;
  if (dropCard(u, zone.dataset.zone, before ? +before.dataset.u : null, S.visibleOrder || {})) { S.buildSel = null; render(); }
}
document.addEventListener('pointerdown', e => {
  if (S.view !== 'build' || e.button > 0) return;
  const card = e.target.closest('.build .zgrid .card'); if (!card) return;
  dragCancel(); Object.assign(DRAG, { el: card, sx: e.clientX, sy: e.clientY, id: e.pointerId, touch: e.pointerType !== 'mouse', started: false });
  if (DRAG.touch) DRAG.timer = setTimeout(() => { if (DRAG.el) dragStart(DRAG.sx, DRAG.sy); }, 300);
});
document.addEventListener('pointermove', e => {
  if (!DRAG.el || e.pointerId !== DRAG.id) return;
  if (!DRAG.started) { const d = Math.hypot(e.clientX - DRAG.sx, e.clientY - DRAG.sy); if (DRAG.touch) { if (d > 10) dragCancel(); return; } if (d < 6) return; dragStart(e.clientX, e.clientY); }
  dragMove(e.clientX, e.clientY);
});
document.addEventListener('pointerup', e => { if (!DRAG.el || e.pointerId !== DRAG.id) return; if (DRAG.started) dragFinish(e.clientX, e.clientY); else dragCancel(); });
document.addEventListener('pointercancel', e => { if (DRAG.el && !DRAG.started) dragCancel(); });
document.addEventListener('touchmove', e => { if (DRAG.started) e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', e => { if (DRAG.el && DRAG.touch) e.preventDefault(); });
document.addEventListener('dragstart', e => { if (e.target.closest && e.target.closest('.card')) e.preventDefault(); });
document.addEventListener('click', e => { if (DRAG.swallow) { e.stopPropagation(); e.preventDefault(); DRAG.swallow = false; } }, true);

/* ================= card pool viewer ================= */
function contextPool() { const g = game(); if (g && (S.view === 'draft' || S.view === 'build')) return g.settings.pool; if (S.online && S.room) return roomPool(); return S.settings.pool || 'goat'; }
function poolForViewer() { const g = game(); if (g && (S.view === 'draft' || S.view === 'build')) return g.settings.pool; return S.poolView || contextPool(); }
async function renderPool() {
  const key = poolForViewer(); const locked = !!(game() && (S.view === 'draft' || S.view === 'build'));
  $('#poolTitle').textContent = `${POOLS[key].title} card pool`;
  if (!P[key]) { $('#poolBody').innerHTML = '<p class="loading">Loading…</p>'; try { await loadPool(key); } catch (_) { $('#poolBody').innerHTML = '<p class="err">Couldn’t load this pool. Check your connection.</p>'; return; } }
  const pd = P[key]; const prev = ACT; ACT = pd;
  $('#poolBody').scrollTop = 0;
  $('#poolCount').textContent = `${pd.cards.length} cards`;
  const tabs = locked ? '' : Object.entries(POOLS).map(([k, v]) => `<button class="chip tab" type="button" data-pv="${k}" aria-pressed="${k === key}">${esc(v.tab)}</button>`).join('') + '<span class="chip-gap"></span>';
  const nDecks = pd.decks.comp.length + pd.decks.struct.length;
  const views = `<button class="chip view" type="button" data-ptab="cards" aria-pressed="${S.poolTab !== 'decks'}">Cards</button>${nDecks ? `<button class="chip view" type="button" data-ptab="decks" aria-pressed="${S.poolTab === 'decks'}">Decks (${nDecks})</button>` : ''}<span class="chip-gap"></span>`;
  if (S.poolTab === 'decks' && nDecks) { $('#poolChips').innerHTML = tabs + views; renderDecksView(pd); ACT = prev && (S.view === 'draft' || S.view === 'build') ? prev : pd; return; }
  const tiers = pd.tier.label.map((l, i) => [l, i]).filter(([, i]) => pd.byR[i].length);
  $('#poolChips').innerHTML = tabs + views + [`<button class="chip" type="button" data-pf="-1" aria-pressed="${S.poolFilter === -1}">All ${pd.cards.length}</button>`]
    .concat(tiers.map(([l, i]) => `<button class="chip" type="button" data-pf="${i}" aria-pressed="${S.poolFilter === i}">${esc(l)} ${pd.byR[i].length}</button>`)).join('');
  const list = (S.poolFilter < 0 || !pd.byR[S.poolFilter] ? pd.cards : pd.byR[S.poolFilter]);
  const dn = pd.decks.comp.length, sn = pd.decks.struct.length;
  const decksNote = dn || sn ? `<p class="poolnote">Deck draft can use ${dn ? `${dn} tournament decks and ` : ''}${sn} starter and structure decks from this era.</p>` : '';
  if (pd.sets.length) {
    const f = S.poolFilter; const keep = r => f < 0 || r === f;
    const month = d => { const [y, m] = (d || '').split('-'); return m ? `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1]} ${y}` : ''; };
    const secs = pd.sets.map((st, si) => ({ id: 's' + si, name: st.n, sub: `Booster pack, ${st.size} cards`, cards: st.l.map(([id, r]) => withR(pd.byId.get(id), r)).filter(c => c && keep(c.r)) }));
    const inPacks = new Set(pd.sets.flatMap(st => st.l.map(([id]) => id)));
    pd.groups.forEach(([name], gi) => {
      if (name !== 'Other releases' && name !== 'Earlier-era staples') return;
      const cs = pd.cards.filter(c => c.g === gi && !inPacks.has(c.i) && keep(c.r));
      secs.push({ id: 'g' + gi, name: name === 'Other releases' ? 'Not in packs: starter decks, tins and promos' : 'Not in packs: earlier-era staples', sub: 'These show up in Deck draft', cards: cs });
    });
    const shown = secs.filter(x => x.cards.length);
    shown.forEach(x => x.cards.sort((a, b) => b.r - a.r || a.n.localeCompare(b.n)));
    $('#poolBody').innerHTML = `<p class="poolnote">${esc(pd.cfg.blurb)} Every pack is a real booster set: it only contains that set's cards, at that set's rarities.</p>${decksNote}
      <label class="jump">Jump to <select id="pgJump">${shown.map(x => `<option value="${x.id}">${esc(x.name)} (${x.cards.length})</option>`).join('')}</select></label>
      ${shown.map(x => `<section class="pgroup" id="pg-${x.id}"><h3>${esc(x.name)}<span>${esc(x.sub)}, ${x.cards.length} shown</span></h3><div class="zgrid">${x.cards.map(c => cardHTML(c)).join('')}</div></section>`).join('')}`;
  } else if (pd.groups.length) {
    const groups = pd.groups.map(([name, date], gi) => ({ gi, name, date, cards: [] }));
    list.forEach(c => groups[c.g] && groups[c.g].cards.push(c));
    const shown = groups.filter(x => x.cards.length);
    shown.forEach(x => x.cards.sort((a, b) => b.r - a.r || a.n.localeCompare(b.n)));
    const month = d => { const [y, m] = (d || '').split('-'); return m ? `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1]} ${y}` : ''; };
    $('#poolBody').innerHTML = `<p class="poolnote">${esc(pd.cfg.blurb)} Grouped by booster set, oldest first. Cards that only came in starter decks, tins, tournament packs or promos are under Other releases.</p>${decksNote}
      <label class="jump">Jump to <select id="pgJump">${shown.map(x => `<option value="${x.gi}">${esc(x.name)} (${x.cards.length})</option>`).join('')}</select></label>
      ${shown.map(x => `<section class="pgroup" id="pg-${x.gi}"><h3>${esc(x.name)}<span>${x.name === 'Other releases' ? 'Starter decks, tins, tournament packs and promos' : month(x.date)}, ${x.cards.length} card${x.cards.length === 1 ? '' : 's'}</span></h3><div class="zgrid">${x.cards.map(c => cardHTML(c)).join('')}</div></section>`).join('')}`;
  } else {
    const sorted = list.slice().sort((a, b) => b.r - a.r || b.u - a.u);
    $('#poolBody').innerHTML = `<p class="poolnote">${esc(pd.cfg.blurb)}</p>${decksNote}<div class="zgrid">${sorted.map(c => cardHTML(c)).join('')}</div>`;
  }
  ACT = prev && (S.view === 'draft' || S.view === 'build') ? prev : pd;
}
function deckParts(d) { const i = d.n.indexOf(', '); return i > 0 ? [d.n.slice(0, i), d.n.slice(i + 2)] : [d.n, '']; }
function renderDecksView(pd) {
  const sec = (src, title, sub) => {
    const list = pd.decks[src]; if (!list.length) return '';
    return `<h3 class="dhead">${title}<span>${sub}</span></h3><div class="decklist">${list.map((d, i) => {
      const cards = d.l.map(([id, q]) => [pd.byId.get(id), q]).filter(x => x[0]);
      const main = cards.filter(([c]) => c.k !== 'F').reduce((n, [, q]) => n + q, 0), extra = cards.filter(([c]) => c.k === 'F').reduce((n, [, q]) => n + q, 0);
      const top = cards.slice().sort((a, b) => b[0].r - a[0].r || (b[0].w ?? b[0].u) - (a[0].w ?? a[0].u)).slice(0, 3);
      const [name, meta] = deckParts(d);
      const thumbs = d.img ? `<img class="dbox" src="${d.img}" alt="" loading="lazy" width="48" height="72">` : top.map(([c]) => `<img src="${imgSrc(c.i)}" alt="" loading="lazy" width="42" height="61">`).join('');
      return `<details class="deck" data-src="${src}" data-i="${i}"><summary><span class="dthumbs">${thumbs}</span>
        <span class="dtext"><span class="dname">${esc(name)}</span><span class="dmeta">${meta ? esc(meta) + '. ' : ''}${main} main${extra ? `, ${extra} extra` : ''}</span></span></summary><div class="dcards"></div></details>`;
    }).join('')}</div>`;
  };
  $('#poolBody').innerHTML = `<p class="poolnote">The decks Deck draft can use in this era. Open one to see its cards.</p>
    ${sec('comp', 'Competitive', `${pd.decks.comp.length} top-4 tournament decks from Format Library`)}
    ${sec('struct', 'Structure', `${pd.decks.struct.length} starter and structure decks`)}`;
}
function fillDeck(el) {
  const box = el.querySelector('.dcards'); if (!box || box.childElementCount) return;
  const pd = P[poolForViewer()]; if (!pd) return;
  const d = pd.decks[el.dataset.src][+el.dataset.i]; const prev = ACT; ACT = pd;
  const ord = c => ({ M: 0, S: 1, T: 2, F: 3 }[c.k] * 100000 - (c.k === 'M' ? (c.lv || 0) * 1000 : 0));
  const cards = d.l.map(([id, q]) => [pd.byId.get(id), q]).filter(x => x[0]).sort((a, b) => ord(a[0]) - ord(b[0]) || a[0].n.localeCompare(b[0].n));
  const grid = list => `<div class="zgrid">${list.map(([c, q]) => cardHTML(c, { num: 0 }).replace('</button>', `${q > 1 ? `<span class="qty">×${q}</span>` : ''}</button>`)).join('')}</div>`;
  const main = cards.filter(([c]) => c.k !== 'F'), extra = cards.filter(([c]) => c.k === 'F');
  box.innerHTML = `<p class="dsub">Main deck</p>${grid(main)}${extra.length ? `<p class="dsub">Extra deck</p>${grid(extra)}` : ''}`;
  ACT = prev;
}
document.addEventListener('toggle', e => { const d = e.target; if (d && d.classList && d.classList.contains('deck') && d.open) fillDeck(d); }, true);
function openPool() { S.poolFilter = -1; renderPool(); $('#poolModal').hidden = false; $('#poolClose').focus(); }
function closePool() { $('#poolModal').hidden = true; }

/* ================= events ================= */
async function guarded(fn) {
  S.error = ''; S.busy = true;
  try { await fn(); } catch (e) { console.error(e); S.error = e && e.message && !/firebase|permission|network|fetch|load/i.test(e.message) ? e.message : 'Couldn’t reach the server. Check your connection and try again.'; if (!S.online) S.view = S.view === 'practice' ? 'practice' : 'home'; }
  S.busy = false; render();
}
function readName(sel) {
  const el = $(sel); const v = ((el && el.value) || '').trim().replace(/\s+/g, ' ');
  if (!v) { S.error = 'Type a username first.'; render(); const i = $(sel); i && i.focus(); return null; }
  return v.slice(0, 20);
}
async function startPractice() {
  const key = S.settings.pool; S.busy = true; renderPracticeSetup();
  try { await loadPool(key); usePool(key); S.practice = newGame({ ...S.settings }, [{ uid: 'me', name: 'You' }]); S.lastKey = null; S.view = 'draft'; }
  catch (e) { console.error(e); S.error = 'Couldn’t load the card pool. Check your connection and try again.'; }
  S.busy = false; render();
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
  const pv = t.closest('[data-pv]'); if (pv) { S.poolView = pv.dataset.pv; S.poolFilter = -1; renderPool(); return; }
  const ptab = t.closest('[data-ptab]'); if (ptab) { S.poolTab = ptab.dataset.ptab; renderPool(); return; }
  const chip = t.closest('[data-pf]'); if (chip) { S.poolFilter = +chip.dataset.pf; renderPool(); return; }
  if (t.closest('#poolClose')) { closePool(); return; }
  const a = t.closest('[data-act]')?.dataset.act;
  if (a) {
    if (a === 'pool') { S.poolView = contextPool(); return openPool(); }
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
    if (a === 'practice') { S.error = ''; S.settings = { ...DEFAULTS, ...S.settings }; if (typeof S.settings.bots !== 'number' || S.settings.bots < 1) S.settings.bots = 3; S.view = 'practice'; loadPool(S.settings.pool).catch(() => {}); render(); return; }
    if (a === 'home') { S.view = 'home'; render(); return; }
    if (a === 'start-practice') { startPractice(); return; }
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
    if (a === 'pick') { if (!S.opening) submitPick(); return; }
    if (a === 'bot-for') { botTakeover(+t.closest('[data-act]').dataset.seat); return; }
    if (a === 'reclaim') { reclaimSeat(); return; }
    if (a === 'more') { S.expanded = !S.expanded; $('#detail').classList.toggle('expanded', S.expanded); return; }
    if (a === 'close') { S.focus = null; S.buildSel = null; S.expanded = false; if (S.view === 'draft') S.sel = []; render(); return; }
    if (a === 'auto') { autoBuild(); S.buildSel = null; render(); toast('Rebuilt a 40-card deck from your strongest picks.'); return; }
    if (a === 'sortzones') { S.deck.order = {}; saveDeck(); render(); return; }
    if (a === 'fillside') { fillSide(); return; }
    if (a === 'download') { downloadYdk(); return; }
    if (a === 'tour-start') { startTour(); return; }
    if (a === 'tour-game') { const b = t.closest('[data-act]'); tourGame(+b.dataset.r, +b.dataset.i, b.dataset.w); return; }
    if (a === 'tour-undo') { const b = t.closest('[data-act]'); tourUndo(+b.dataset.r, +b.dataset.i); return; }
    if (a === 'tour-next') { tourNext(); return; }
    if (a === 'tour-reset') { if (confirm('End the tournament for everyone? Results are cleared.')) tourReset(); return; }
    if (a === 'tour-download') { const tt = activeTour(); if (tt) { const url = URL.createObjectURL(new Blob([tourText(tt)], { type: 'text/plain' })); const l = document.createElement('a'); l.href = url; l.download = `ygo_drafter_tournament_${S.code}.txt`; l.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); } return; }
    if (a === 'tab-tour') { S.tab = 'tour'; render(); return; }
    if (a === 'tab-deck') { S.tab = 'deck'; render(); return; }
    if (a === 'duel' || a === 'duel-friend') { try { localStorage.setItem('ygo-drafter:duel-ydk', ydkText()); localStorage.setItem('ygo-drafter:duel-ydk-name', `Drafted ${POOLS[ACT.key].name} deck`); localStorage.setItem('ygo-drafter:duel-format', ACT.key === 'edison' ? 'edison' : 'goat'); } catch (_) {} window.open(a === 'duel' ? 'duel/' : 'duel/?invite=1', '_blank', 'noopener'); return; }
    if (a === 'testhand') { drawTestHand(); return; }
    if (a === 'savedeck') { $('#saveBox').innerHTML = `<div class="savebox"><label for="deckName">Name this deck</label><div class="row"><input class="text" id="deckName" maxlength="40" value="${esc(`${POOLS[ACT.key].name} draft ${new Date().toLocaleDateString()}`)}"><button class="cta" type="button" data-act="savedeck-ok">Save</button></div><p class="note">Saved in this browser. It shows up on the duel table under “My saved decks”.</p></div>`; $('#deckName').select(); return; }
    if (a === 'savedeck-ok') { const name = ($('#deckName').value || '').trim().slice(0, 40) || 'My deck'; const list = savedDecks(); list.unshift({ id: Date.now().toString(36), name, pool: ACT.key, ydk: ydkText(), saved: Date.now() }); storeDecks(list); toast(`Saved “${name}”.`); render(); return; }
    if (a === 'deldeck') { const id = t.closest('[data-id]').dataset.id; storeDecks(savedDecks().filter(d => d.id !== id)); render(); return; }
    if (a === 'dldeck') { const d = savedDecks().find(x => x.id === t.closest('[data-id]').dataset.id); if (d) { const url = URL.createObjectURL(new Blob([d.ydk], { type: 'application/octet-stream' })); const l = document.createElement('a'); l.href = url; l.download = `${d.name.replace(/[^\w\- ]+/g, '').trim() || 'deck'}.ydk`; l.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); } return; }
    if (a === 'copy') { copyText(ydkText(), 'Copied the .ydk text.', '#ydkPreview'); return; }
    if (a.startsWith('to-') && S.buildSel != null) { moveTo(S.buildSel, a.slice(3)); S.buildSel = null; S.expanded = false; render(); return; }
  }
  const card = t.closest('.card');
  if (!card || card.closest('#poolBody')) return;
  if (S.view === 'draft' && card.closest('#packGrid')) {
    const g = game(); const me = mySeat(g); if (!g || me < 0 || g.done[me] || S.busy) return;
    const id = card.dataset.u, n = need(g, me);
    if (n === 1) { if (S.sel[0] === id && S.focus === id) { submitPick(); return; } S.sel = [id]; }
    else { const k = S.sel.indexOf(id); if (k >= 0 && S.focus === id) S.sel.splice(k, 1); else if (k < 0) { S.sel.push(id); if (S.sel.length > n) S.sel.shift(); } }
    S.focus = id; S.expanded = false; renderDraft();
    const again = document.querySelector(`#packGrid .card[data-u="${CSS.escape(id)}"]`); again && again.focus({ preventScroll: true }); return;
  }
  if (S.view === 'draft' && card.closest('.strip')) { const c = C(+card.dataset.id); const d = $('#detail'); if (c && d) { d.hidden = false; d.innerHTML = detailHTML(c); } return; }
  if (S.view === 'build') {
    const u = +card.dataset.u; S.buildSel = S.buildSel === u ? null : u; S.expanded = false; renderBuild();
    const again = document.querySelector(`.zgrid .card[data-u="${u}"]`); again && again.focus({ preventScroll: true });
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 'pgJump') { const sec = document.getElementById('pg-' + e.target.value); sec && sec.scrollIntoView({ block: 'start' }); return; }
  const n = e.target.name || '';
  if (n.startsWith('set-')) { const k = n.slice(4); let v = e.target.value; if (k === 'perPick' || k === 'atOnce' || k === 'bestOf') v = +v; setSetting(k, v); }
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
loadPool('goat').then(() => { if (!ACT) usePool('goat'); }).catch(() => {});
const params = new URLSearchParams(location.search);
const urlCode = (params.get('room') || '').toUpperCase();
if (/^[A-Z]{4}$/.test(urlCode)) { S.pendingCode = urlCode; bootRoom(urlCode); } else render();
