// Live tables over Firebase Realtime Database (same project as YGO Drafter, under rooms/myl-XXXXX).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getDatabase, ref, set, get, update, push, remove, onValue, onChildAdded, onDisconnect,
  runTransaction, query, limitToLast, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

const CFG = {
  apiKey: 'AIzaSyAto8uv4bsHkhDGkhiCFa-PuILGZS9Hf08',
  authDomain: 'goat-draft-796f7.firebaseapp.com',
  databaseURL: 'https://goat-draft-796f7-default-rtdb.firebaseio.com',
  projectId: 'goat-draft-796f7',
  storageBucket: 'goat-draft-796f7.firebasestorage.app',
  messagingSenderId: '906831006037',
  appId: '1:906831006037:web:80e372d9ca72e53073c7dc',
};

let app = null, auth = null, db = null, connecting = null;
export function connect() {
  if (connecting) return connecting;
  connecting = (async () => {
    app = initializeApp(CFG, 'myl');
    auth = getAuth(app);
    db = getDatabase(app);
    await auth.authStateReady();
    if (!auth.currentUser) await signInAnonymously(auth);
    return auth.currentUser;
  })();
  connecting.catch(() => { connecting = null; });
  return connecting;
}

const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const genCode = () => Array.from({ length: 5 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
export const cleanCode = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
const base = code => `rooms/myl-${code}`;

export async function createRoom(name, opts) {
  const u = await connect();
  for (let i = 0; i < 8; i++) {
    const code = genCode();
    const snap = await get(ref(db, `${base(code)}/meta`));
    if (snap.exists()) continue;
    const now = Date.now();
    await set(ref(db, base(code)), {
      meta: { kind: 'myl-table', v: 1, host: u.uid, created: now, status: 'lobby', game: 0, opts },
      seats: { p1: { uid: u.uid, name } },
    });
    return code;
  }
  throw new Error('No se pudo crear la mesa. Intenta de nuevo.');
}

export class Room {
  constructor(code, h) { this.code = code; this.base = base(code); this.h = h; this.unsubs = []; this.uid = null; this.closed = false; }

  async open(name) {
    const u = await connect();
    this.uid = u.uid;
    const meta = await get(ref(db, `${this.base}/meta`));
    if (!meta.exists()) throw new Error('No existe una mesa con ese código.');
    const mem = ref(db, `${this.base}/members/${u.uid}`);
    await set(mem, { name, t: serverTimestamp() });
    onDisconnect(mem).remove();
    this.memRef = mem;
    const watch = (path, cb) => this.unsubs.push(onValue(ref(db, `${this.base}/${path}`), s => !this.closed && cb(s.val())));
    watch('meta', v => this.h.meta(v));
    watch('seats', v => this.h.seats(v || {}));
    watch('members', v => this.h.members(v || {}));
    watch('turn', v => this.h.turn(v));
    watch('sides/p1', v => this.h.side('p1', v));
    watch('sides/p2', v => this.h.side('p2', v));
    this.unsubs.push(onChildAdded(query(ref(db, `${this.base}/log`), limitToLast(250)), s => !this.closed && this.h.log(s.key, s.val())));
    // only effects that happen after we arrive
    const fxRef = query(ref(db, `${this.base}/fx`), limitToLast(15));
    const seen = new Set(Object.keys((await get(fxRef)).val() || {}));
    this.unsubs.push(onChildAdded(fxRef, s => { if (!this.closed && !seen.has(s.key)) this.h.fx(s.val()); }));
    this.unsubs.push(onChildAdded(ref(db, `${this.base}/ops`), s => !this.closed && this.h.op(s.key, s.val())));
    // keep presence fresh after reconnects
    this.unsubs.push(onValue(ref(db, '.info/connected'), s => { if (s.val() === true && !this.closed) { set(mem, { name, t: serverTimestamp() }); onDisconnect(mem).remove(); } }));
    return meta.val();
  }

  close() {
    this.closed = true;
    for (const u of this.unsubs) { try { u(); } catch { /* already gone */ } }
    this.unsubs = [];
    if (this.memRef) remove(this.memRef).catch(() => {});
  }

  setName(name) { return update(this.memRef, { name }); }
  setSide(seat, side) { return set(ref(db, `${this.base}/sides/${seat}`), side); }
  clearSides() { return remove(ref(db, `${this.base}/sides`)); }
  setTurn(t) { return set(ref(db, `${this.base}/turn`), t); }
  log(entry) { return push(ref(db, `${this.base}/log`), { ...entry, t: serverTimestamp() }); }
  fx(entry) { return push(ref(db, `${this.base}/fx`), { ...entry, t: serverTimestamp() }); }
  op(entry) { return push(ref(db, `${this.base}/ops`), { ...entry, t: serverTimestamp() }); }
  doneOp(key) { return remove(ref(db, `${this.base}/ops/${key}`)); }
  updateMeta(patch) { return update(ref(db, `${this.base}/meta`), patch); }
  updateSeat(seat, patch) { return update(ref(db, `${this.base}/seats/${seat}`), patch); }
  // extra (a deck handed over from a draft) goes in the same transaction: a separate update()
  // on the seat would cancel this transaction before it commits.
  async claimSeat(seat, name, extra = null) {
    const uid = this.uid;
    const r = await runTransaction(ref(db, `${this.base}/seats/${seat}`), cur => {
      if (cur && cur.uid && cur.uid !== uid) return undefined;
      return { ...(cur || {}), uid, name, ready: false, ...(extra || {}) };
    });
    return r.committed;
  }
  leaveSeat(seat) { return remove(ref(db, `${this.base}/seats/${seat}`)); }
  async resetGame(game) {
    await Promise.all([remove(ref(db, `${this.base}/sides`)), remove(ref(db, `${this.base}/ops`)), remove(ref(db, `${this.base}/fx`))]);
    return game;
  }
}

// ---------------------------------------------------------------- drafts
// A draft room lives next to the tables (rooms/myl-XXXXX) and keeps the whole draft in one `game`
// node updated by transactions, like YGO Drafter. kind tells the join box where to send people.
export async function roomKind(code) {
  await connect();
  const s = await get(ref(db, `${base(code)}/meta/kind`));
  return s.exists() ? s.val() : null;
}

export async function createDraftRoom(name, settings) {
  const u = await connect();
  for (let i = 0; i < 8; i++) {
    const code = genCode();
    const snap = await get(ref(db, `${base(code)}/meta`));
    if (snap.exists()) continue;
    const now = Date.now();
    await set(ref(db, base(code)), {
      meta: { kind: 'myl-draft', v: 1, host: u.uid, created: now },
      settings,
      members: { [u.uid]: { name, joined: now } },
    });
    return code;
  }
  throw new Error('No se pudo crear el draft. Intenta de nuevo.');
}

export class DraftNet {
  constructor(code, onRoom, onError) { this.code = code; this.base = base(code); this.onRoom = onRoom; this.onError = onError; this.unsubs = []; this.closed = false; this.uid = null; }
  async open(name) {
    const u = await connect();
    this.uid = u.uid;
    const meta = await get(ref(db, `${this.base}/meta`));
    if (!meta.exists()) throw new Error('No existe un draft con ese código.');
    const mem = ref(db, `${this.base}/members/${u.uid}`);
    const cur = (await get(mem)).val();
    await update(mem, { name, joined: (cur && cur.joined) || Date.now() });
    const pr = ref(db, `${this.base}/presence/${u.uid}`);
    this.prRef = pr;
    this.unsubs.push(onValue(ref(db, '.info/connected'), s => {
      if (s.val() === true && !this.closed) onDisconnect(pr).set(false).then(() => set(pr, true)).catch(() => {});
    }));
    this.unsubs.push(onValue(ref(db, this.base), s => { if (!this.closed) this.onRoom(s.val()); }, err => this.onError && this.onError(err)));
    return meta.val();
  }
  close() {
    this.closed = true;
    for (const u of this.unsubs) { try { u(); } catch { /* already gone */ } }
    this.unsubs = [];
    if (this.prRef) set(this.prRef, false).catch(() => {});
  }
  ref(p = '') { return ref(db, p ? `${this.base}/${p}` : this.base); }
  push(p, v) { return push(this.ref(p), v); }
  put(p, v) { return set(this.ref(p), v); }
  patch(p, v) { return update(this.ref(p), v); }
  tx(p, fn) { return runTransaction(this.ref(p), fn); }
}

// ---------------------------------------------------------------- tournament tables
// A table for one tournament match: both seats are filled in advance with the players and their
// registered decks, and meta.match points back to the draft room so results can be reported there.
export async function createMatchTable(seats, match, opts) {
  const u = await connect();
  for (let i = 0; i < 8; i++) {
    const code = genCode();
    const snap = await get(ref(db, `${base(code)}/meta`));
    if (snap.exists()) continue;
    await set(ref(db, base(code)), {
      meta: { kind: 'myl-table', v: 1, host: u.uid, created: Date.now(), status: 'lobby', game: 0, opts, match },
      seats,
    });
    return code;
  }
  throw new Error('No se pudo crear la mesa. Intenta de nuevo.');
}
export async function deleteRoom(code) { await connect(); return remove(ref(db, base(code))); }
// one game won in a tournament match, reported from the match table (for example when the rival concedes)
export async function reportMatchGame(match, winnerUid) {
  await connect();
  const t = await get(ref(db, `${base(match.draft)}/tour/id`));
  if (!t.exists() || t.val() !== match.tour) return;
  return push(ref(db, `${base(match.draft)}/tour/rounds/${match.r}/matches/${match.i}/games`), winnerUid);
}
