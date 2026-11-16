/* Split: where trips are kept.

   Trips live in the Firebase Realtime Database the drafters already use (project goat-draft-796f7),
   under rooms/split-<trip code>. Knowing the code is what lets a phone read and write a trip; the
   list of rooms itself can't be read by anyone.

     rooms/split-<CODE>/meta             name, currency, colour (written once, when the trip starts)
     rooms/split-<CODE>/events/<id>      one entry per change; entries are only ever added
     rooms/split-<CODE>/receipts/<id>    receipt photos, fetched one at a time when someone opens one

   Every phone also keeps its own copy of the entries. That copy opens a trip instantly, keeps it
   usable with no signal (new entries wait in a queue and are sent later), and is how the app
   notices when an entry was removed or changed behind its back: a missing entry is put back from
   the phone's copy, a changed one is reported in the log. */
import { readEntry, newEntryId, newCode, newId } from './core.js?v=3';

const FB_VERSION = '12.19.0';
const FB_CONFIG = {
  apiKey: 'AIzaSyAto8uv4bsHkhDGkhiCFa-PuILGZS9Hf08',
  authDomain: 'goat-draft-796f7.firebaseapp.com',
  databaseURL: 'https://goat-draft-796f7-default-rtdb.firebaseio.com',
  projectId: 'goat-draft-796f7',
  storageBucket: 'goat-draft-796f7.firebasestorage.app',
  messagingSenderId: '906831006037',
  appId: '1:906831006037:web:80e372d9ca72e53073c7dc',
};
export const SERVER_TS = { '.sv': 'timestamp' };          // the database swaps this for its own clock
const ROOM = code => `rooms/split-${code}`;
const ENTRY_FIELDS = ['t', 'd', 'ts', 'ct', 'by', 'dev', 'uid', 'gn', 'v'];
const MAX_PHOTO_CHARS = 420000;                            // about 300 KB of picture
const TEST = globalThis.__SPLIT_TEST__ || null;            // set only by the automated tests

/* ---------- what's kept on the phone ---------- */
/* Small settings go in localStorage; bulky things (entry copies, photos) in IndexedDB so they
   don't crowd the small space the trivia and drafter pages also use. */
export function browserPrefs(ns = '') {
  const mem = new Map(), pre = 'split.' + ns;
  return {
    get(k, fallback = null) { try { const v = localStorage.getItem(pre + k); return v == null ? (mem.has(k) ? mem.get(k) : fallback) : JSON.parse(v); } catch (_) { return mem.has(k) ? mem.get(k) : fallback; } },
    set(k, v) { try { localStorage.setItem(pre + k, JSON.stringify(v)); mem.delete(k); return true; } catch (_) { mem.set(k, v); return false; } },
    del(k) { mem.delete(k); try { localStorage.removeItem(pre + k); } catch (_) { /* nothing to remove */ } },
  };
}
export function browserDisk(ns = '') {
  const mem = new Map();
  let opening = null;
  const open = () => opening || (opening = new Promise(res => {
    try {
      const rq = indexedDB.open('split' + ns, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
      rq.onsuccess = () => res(rq.result);
      rq.onerror = rq.onblocked = () => res(null);
    } catch (_) { res(null); }
  }));
  const run = async (mode, fn) => {
    const db = await open(); if (!db) return { ok: false };
    return new Promise(res => {
      try {
        const t = db.transaction('kv', mode); const rq = fn(t.objectStore('kv'));
        t.oncomplete = () => res({ ok: true, value: rq.result }); t.onerror = t.onabort = () => res({ ok: false });
      } catch (_) { res({ ok: false }); }
    });
  };
  return {
    async get(k) { const r = await run('readonly', s => s.get(k)); return r.ok ? (r.value === undefined ? null : r.value) : (mem.has(k) ? mem.get(k) : null); },
    async set(k, v) { const r = await run('readwrite', s => s.put(v, k)); if (!r.ok) mem.set(k, v); },
    async del(k) { mem.delete(k); await run('readwrite', s => s.delete(k)); },
  };
}

/* ---------- the database ---------- */
/* "an•••@gmail.com": enough to tell friends' accounts apart without publishing the whole address. */
export function maskMail(mail) {
  const m = String(mail || '').match(/^([^@]{1,64})@(.+)$/);
  return m ? m[1].slice(0, 2) + '•••@' + m[2] : '';
}
function firebaseBackend() {
  let loading = null, lib = null;
  const subs = new Set();
  const who = () => {
    const u = lib && lib.auth.currentUser; if (!u) return null;
    const google = u.providerData.some(p => p.providerId === 'google.com');
    return { uid: u.uid, google, name: google ? u.displayName || '' : '', mail: google ? maskMail(u.email) : '' };
  };
  const load = () => {
    if (loading) return loading;
    loading = (async () => {
      const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
      const [A, Au, D] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-database.js')]);
      const app = A.initializeApp((TEST && TEST.config) || FB_CONFIG, 'split');
      const auth = Au.getAuth(app), db = D.getDatabase(app);
      if (TEST && TEST.emu) { Au.connectAuthEmulator(auth, TEST.emu.auth, { disableWarnings: true }); D.connectDatabaseEmulator(db, TEST.emu.host, TEST.emu.port); }
      if (TEST) TEST.net = { off: () => D.goOffline(db), on: () => D.goOnline(db) };     // lets the tests cut the connection
      await auth.authStateReady();
      if (!auth.currentUser) await Au.signInAnonymously(auth);
      lib = { D, db, Au, auth };
      Au.onAuthStateChanged(auth, () => { for (const cb of subs) cb(who()); });
      return lib;
    })();
    loading.catch(() => { loading = null; });                // no signal at start: try again later
    return loading;
  };
  const listen = (path, cb, onError) => {
    let off = null, stopped = false;
    load().then(f => { if (!stopped) off = f.D.onValue(f.D.ref(f.db, path), s => cb(s.val()), e => onError && onError(e)); }, e => onError && onError(e));
    return () => { stopped = true; if (off) off(); };
  };
  return {
    ready: async () => ({ uid: (await load()).auth.currentUser.uid }),
    /* Who this phone is signed in as: { uid, google, name, mail }. Null until the library has loaded. */
    account: who,
    onAccount(cb) { subs.add(cb); return () => subs.delete(cb); },
    preload: () => load().then(() => true, () => false),
    /* Opens Google's sign-in window. Call it straight from a tap (after preload), or browsers block the window. */
    async signInGoogle() {
      if (!lib) throw Object.assign(new Error('not ready'), { code: 'split/not-ready' });
      const provider = new lib.Au.GoogleAuthProvider(); provider.setCustomParameters({ prompt: 'select_account' });
      await lib.Au.signInWithPopup(lib.auth, provider);
      return who();
    },
    async signOut() { const f = await load(); await f.Au.signOut(f.auth); await f.Au.signInAnonymously(f.auth); return who(); },
    /* Is Google sign-in switched on for this Firebase project? true, false, or null when it can't be checked right now. */
    async googleAvailable() {
      if (TEST && TEST.emu) return TEST.google !== false;
      try {
        const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${FB_CONFIG.apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerId: 'google.com', continueUri: location.origin + location.pathname }) });
        if (r.ok) return true;
        const why = await r.json().then(j => String((j.error && j.error.message) || ''), () => '');
        return /OPERATION_NOT_ALLOWED/.test(why) ? false : null;   // any other answer: can't tell right now
      } catch (_) { return null; }
    },
    async get(path) { const f = await load(); const s = await f.D.get(f.D.ref(f.db, path)); return s.exists() ? s.val() : null; },
    async update(path, obj) { const f = await load(); await f.D.update(f.D.ref(f.db, path), obj); },
    watch: listen,
    onConnected: (cb, onError) => listen('.info/connected', v => cb(v === true), onError),
  };
}

/* A stand-in database that lives in memory. The tests use it, and so does the sample trip. */
export function memoryServer() {
  return { data: {}, subs: new Set(), clock: () => Date.now(), failWrites: false, rule: null };   // rule(path, value, already there) === false refuses a write
}
export function memoryBackend(server, uid = 'u' + newId('', 8)) {
  let online = true; const conn = new Set(); const waiting = [];
  const parts = p => p.split('/').filter(Boolean);
  const getAt = path => { let o = server.data; for (const k of parts(path)) { if (o == null || typeof o !== 'object') return undefined; o = o[k]; } return o; };
  const setAt = (path, v) => {
    const ks = parts(path); let o = server.data;
    for (const k of ks.slice(0, -1)) { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
    if (v === null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = v;
  };
  const stamp = v => (v && typeof v === 'object' ? (v['.sv'] === 'timestamp' ? server.clock() : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stamp(x)]))) : v);
  const clone = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const tell = () => { for (const s of [...server.subs]) if (s.online()) s.cb(clone(getAt(s.path))); };
  const write = (path, obj) => {
    if (server.failWrites) throw new Error('PERMISSION_DENIED');
    if (server.rule && Object.entries(obj).some(([k, v]) => server.rule(path + '/' + k, v, getAt(path + '/' + k)) === false)) throw new Error('PERMISSION_DENIED');
    for (const [k, v] of Object.entries(obj)) setAt(path + '/' + k, stamp(clone(v)));
    tell();
  };
  let acct = { uid, google: false, name: '', mail: '' }; const accSubs = new Set();
  const setAcct = a => { acct = a; uid = a.uid; for (const cb of accSubs) cb(acct); return acct; };
  return {
    get uid() { return uid; },
    ready: async () => ({ uid }),
    account: () => acct,
    onAccount(cb) { accSubs.add(cb); return () => accSubs.delete(cb); },
    preload: async () => true,
    signInGoogle: async () => setAcct(server.google || { uid: 'G-' + uid, google: true, name: 'Sample Person', mail: 'sa•••@gmail.com' }),
    signOut: async () => setAcct({ uid: 'u' + newId('', 8), google: false, name: '', mail: '' }),
    googleAvailable: async () => !!server.googleOn,
    async get(path) { if (!online) throw new Error('offline'); return clone(getAt(path)); },
    update(path, obj) {
      return new Promise((res, rej) => {
        const go = () => { try { write(path, obj); res(); } catch (e) { rej(e); } };
        if (online) queueMicrotask(go); else waiting.push(go);
      });
    },
    watch(path, cb) {
      const s = { path, cb, online: () => online }; server.subs.add(s);
      queueMicrotask(() => { if (online && server.subs.has(s)) cb(clone(getAt(path))); });
      return () => server.subs.delete(s);
    },
    onConnected(cb) { conn.add(cb); queueMicrotask(() => cb(online)); return () => conn.delete(cb); },
    /* test controls */
    setOnline(v) {
      online = v; for (const cb of conn) cb(v);
      if (v) { for (const go of waiting.splice(0)) go(); for (const s of server.subs) if (s.online === undefined || s.online()) s.cb(clone(getAt(s.path))); }
    },
  };
}

const pickEntry = raw => { const o = {}; for (const k of ENTRY_FIELDS) if (raw && raw[k] !== undefined && raw[k] !== null) o[k] = raw[k]; return o; };
const sameEntry = (a, b) => JSON.stringify(pickEntry(a)) === JSON.stringify(pickEntry(b));

/* A photo's id is a fingerprint of the picture itself, so a swapped picture no longer matches its id. */
export async function photoId(dataUrl) {
  try {
    const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataUrl));
    return 'r' + [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (_) { return 'q' + newId('', 16); }                // very old browsers: a random id, no check
}

export function makeStore(opts = {}) {
  const backend = opts.backend || firebaseBackend();
  const prefs = opts.prefs || browserPrefs();
  const disk = opts.disk || browserDisk();
  const retryMs = opts.retryMs || 8000;

  let dev = prefs.get('dev');
  if (!dev) { dev = newId('d', 11); prefs.set('dev', dev); }

  function envelopes(items, now = Date.now()) {
    return items.map((it, i) => ({ id: newEntryId(now + i), env: { t: it.t, d: JSON.stringify(it.d || {}), ct: now + i, by: it.by || undefined, dev, v: 1, ...(it.signed ? { g: 1 } : {}) } }));
  }
  /* What goes to the database. An entry marked as signed carries the Google name of whoever is signed in when it is sent;
     with the stricter database rules, the database checks that name against the sign-in itself. */
  const wire = (env, uid) => {
    const a = env.g && backend.account ? backend.account() : null;
    return pickEntry({ ...env, uid, ts: SERVER_TS, gn: a && a.google && a.name ? a.name : undefined });
  };

  /* Starts a trip: needs a connection, because the code has to be free and everyone must be able to find it. */
  async function createTrip(meta, items) {
    const { uid } = await backend.ready();
    for (let tries = 0; tries < 6; tries++) {
      const code = newCode();
      if (await backend.get(ROOM(code) + '/meta')) continue;
      const m = { kind: 'split', v: 1, name: meta.name, base: meta.base, dec: meta.dec, color: meta.color, uid, ts: SERVER_TS };
      const upd = { meta: m };
      for (const { id, env } of envelopes(items)) upd['events/' + id] = wire(env, uid);
      await backend.update(ROOM(code), upd);
      return code;
    }
    throw new Error('Could not find a free trip code. Try again.');
  }
  async function fetchMeta(code) {
    const m = await backend.get(ROOM(code) + '/meta');
    return m && m.kind === 'split' ? m : null;
  }

  /* One open trip: keeps the phone's copy, the waiting queue and the live connection in step. */
  function openTrip(code, onChange, metaHint = null) {
    const room = ROOM(code);
    let meta = metaHint, known = {}, sent = {}, lastSrv = undefined, closed = false, loaded = false;
    let olderCopy = false;                                  // this phone's copy was saved before entries could carry a Google name
    let out = prefs.get('out.' + code, []), photosOut = prefs.get('pout.' + code, []);
    let alerts = prefs.get('alerts.' + code, []);
    const inflight = new Set(), restoring = new Set();
    const status = { online: false, live: false, error: '', unreadable: false, notFound: false };
    let stopEvents = null, stopConn = null, retryTimer = null, saveTimer = null, emitQueued = false, flushing = false, flushingPhotos = false;

    const view = () => {
      const list = [];
      for (const [id, raw] of Object.entries(known)) { const e = readEntry(id, raw); if (e) list.push(e); }
      for (const [id, env] of Object.entries(sent)) if (!(id in known)) { const e = readEntry(id, env); if (e) list.push(e); }
      for (const { id, env } of out) if (!(id in known) && !(id in sent)) { const e = readEntry(id, { ...env, pending: true }); if (e) list.push(e); }
      return { code, meta, entries: list, status: { ...status, waiting: out.length + photosOut.length, loaded }, alerts: alerts.slice() };
    };
    const emit = () => { if (emitQueued || closed) return; emitQueued = true; queueMicrotask(() => { emitQueued = false; if (!closed) onChange(view()); }); };
    const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (meta) disk.set('ev:' + code, { v: 2, meta, entries: known }); }, 250); };
    const saveOut = () => { prefs.set('out.' + code, out); prefs.set('pout.' + code, photosOut); };
    const alert = a => { alerts = [{ ...a, at: Date.now() }, ...alerts].slice(0, 20); prefs.set('alerts.' + code, alerts); };

    function onServer(val) {
      if (closed) return;
      lastSrv = val || {};
      const srv = lastSrv, next = {}, missing = [];
      for (const [id, was] of Object.entries(known)) {
        const now = srv[id];
        if (!now) { missing.push(id); next[id] = was; continue; }
        // Only the content counts. The time stamp alone can move when a phone re-sends an entry after a dropped connection.
        // (a copy saved by the first version of the app never kept the Google name, so its absence there is not a change)
        if (!sameEntry({ ...was, ts: 0 }, { ...now, ts: 0, gn: olderCopy && !was.gn ? undefined : now.gn }) && !alerts.some(a => a.kind === 'changed' && a.id === id && sameEntry(a.now, now))) {
          alert({ kind: 'changed', id, was: pickEntry(was), now: pickEntry(now) });
        }
      }
      for (const [id, raw] of Object.entries(srv)) {
        if (inflight.has(id)) continue;                        // still being written by this phone
        if (!raw || typeof raw !== 'object') continue;
        next[id] = pickEntry(raw);
        delete sent[id];
      }
      known = next;
      const before = out.length;
      out = out.filter(o => !(o.id in srv) || inflight.has(o.id));
      if (out.length !== before) saveOut();
      const first = !status.live;
      status.live = true; status.unreadable = false;
      if (meta) status.notFound = false;
      olderCopy = false;                                     // from here on the copy holds exactly what the server sent
      const lost = missing.filter(id => !restoring.has(id));
      if (lost.length) restore(lost);
      saveSoon(); emit();
      if (first) flush();
    }

    /* Entries this phone had saved but the server no longer has: put them back, and say so. */
    async function restore(ids) {
      ids.forEach(id => restoring.add(id));
      const upd = {};
      for (const id of ids) upd['events/' + id] = known[id];
      try {
        let needMeta = false;
        try { needMeta = !!meta && !(await backend.get(room + '/meta')); } catch (_) { /* can't check right now */ }
        if (needMeta) upd.meta = meta;
        await backend.update(room, upd);
        alert({ kind: 'restored', n: ids.length });
      } catch (e) {
        if (/permission/i.test(String(e && (e.code || e.message)))) {
          // the database won't take them back: go with what it has, and say so once
          ids.forEach(id => { delete known[id]; }); alert({ kind: 'lost', n: ids.length }); saveSoon();
        } else ids.forEach(id => restoring.delete(id));        // no connection: try again on the next update
      }
      emit();
    }

    async function flush() {
      if (closed || flushing || !status.online || !status.live) return;     // first see what the server already has
      flushing = true;
      try {
        while (!closed && status.online) {
          const batch = out.filter(o => !inflight.has(o.id)).slice(0, 25);
          if (!batch.length) break;
          const { uid } = await backend.ready();
          const upd = {}, wired = {};
          for (const o of batch) { inflight.add(o.id); wired[o.id] = wire(o.env, uid); upd['events/' + o.id] = wired[o.id]; }
          let failed = 0;
          const done = o => { inflight.delete(o.id); sent[o.id] = { ...wired[o.id], ts: null }; out = out.filter(x => x.id !== o.id); };
          try { await backend.update(room, upd); batch.forEach(done); }
          catch (e) {
            // A write can fail because an entry is already there (sent just before the app was closed), or because the
            // database refuses one of them. Go through them one at a time, so one entry can't hold up the rest.
            const refused = err => /permission/i.test(String(err && (err.code || err.message)));
            for (const o of batch) {
              let there = null; try { there = await backend.get(room + '/events/' + o.id); } catch (_) { /* can't tell */ }
              if (there) { done(o); continue; }
              try { await backend.update(room, { ['events/' + o.id]: wired[o.id] }); done(o); continue; }
              catch (err) {
                // the stricter rules check a Google name against the sign-in: if that is what was refused, send the entry without it
                if (refused(err) && wired[o.id].gn) {
                  const plain = { ...wired[o.id] }; delete plain.gn;
                  try { await backend.update(room, { ['events/' + o.id]: plain }); wired[o.id] = plain; done(o); continue; } catch (_) { /* counted below */ }
                }
              }
              inflight.delete(o.id); failed++;
            }
            if (failed) status.error = 'Could not save ' + (failed === 1 ? 'an entry' : failed + ' entries') + '. Trying again.';
          }
          saveOut();
          if (lastSrv !== undefined) onServer(lastSrv); else emit();
          if (failed) { retryLater(); break; }
          status.error = '';
        }
      } catch (_) { retryLater(); } finally { flushing = false; }
      flushPhotos();
    }
    async function flushPhotos() {
      if (closed || flushingPhotos || !status.online) return;
      flushingPhotos = true; let stuck = 0;
      /* A picture's id is its fingerprint, so the same picture used twice (one receipt for two expenses, or sent just
         before the app was closed) is already in the trip: nothing to send. */
      const there = async rid => { try { return !!(await backend.get(room + '/receipts/' + rid + '/ts')); } catch (_) { return false; } };
      try {
        for (const rid of photosOut.slice()) {
          const img = await disk.get('rc:' + code + ':' + rid);
          if (img && !(await there(rid))) {
            try { const { uid } = await backend.ready(); await backend.update(room, { ['receipts/' + rid]: { img, uid, ts: SERVER_TS } }); }
            catch (_) { if (!(await there(rid))) { stuck++; continue; } }      // one picture that won't go must not hold up the rest
          }
          photosOut = photosOut.filter(x => x !== rid); saveOut(); emit();
        }
      } catch (_) { stuck++; } finally { flushingPhotos = false; }
      if (stuck) retryLater();
    }
    function retryLater() { clearTimeout(retryTimer); if (!closed) retryTimer = setTimeout(() => { connect(); flush(); }, retryMs); }

    function connect() {
      if (closed) return;
      if (!stopConn) stopConn = backend.onConnected(v => { status.online = v; emit(); if (v) flush(); }, () => { stopConn = null; retryLater(); });
      if (!stopEvents) stopEvents = backend.watch(room + '/events', onServer, e => {
        stopEvents = null; status.live = false;
        if (/permission/i.test(String(e && (e.code || e.message)))) status.unreadable = true;
        emit(); retryLater();
      });
      if (!meta) backend.get(room + '/meta').then(m => {
        if (closed) return;
        if (m && m.kind === 'split') { meta = m; status.notFound = false; saveSoon(); } else if (!meta) status.notFound = true;
        emit();
      }, () => retryLater());
    }

    (async () => {
      const cached = await disk.get('ev:' + code);
      if (closed) return;
      if (cached && cached.entries) { known = cached.entries; olderCopy = cached.v !== 2; }
      if (cached && cached.meta && !meta) meta = cached.meta;
      loaded = true; emit();
      if (lastSrv !== undefined) onServer(lastSrv);            // the server answered before the disk did: compare now
    })();
    connect();
    const onOnline = () => { connect(); flush(); };
    if (globalThis.addEventListener) globalThis.addEventListener('online', onOnline);

    return {
      code,
      view,
      /* Adds entries: shown at once, sent when there's a connection. */
      add(items) {
        const made = envelopes(items);
        out = out.concat(made); saveOut(); emit(); flush();
        return made.map(m => m.id);
      },
      async addPhoto(dataUrl) {
        if (typeof dataUrl !== 'string' || dataUrl.length > MAX_PHOTO_CHARS) throw new Error('That photo is too large.');
        const rid = await photoId(dataUrl);
        await disk.set('rc:' + code + ':' + rid, dataUrl);
        if (!photosOut.includes(rid)) { photosOut.push(rid); saveOut(); }
        emit(); flushPhotos();
        return rid;
      },
      /* Returns { img } or { missing: true } (not uploaded yet) or { changed: true } (doesn't match its fingerprint). */
      async photo(rid) {
        const key = 'rc:' + code + ':' + rid;
        const local = await disk.get(key);
        if (local) return { img: local };
        const img = await backend.get(room + '/receipts/' + rid + '/img');
        if (!img || typeof img !== 'string' || !img.startsWith('data:image/')) return { missing: true };
        if (rid[0] === 'r' && (await photoId(img)) !== rid) return { changed: true };
        await disk.set(key, img);
        return { img };
      },
      hideAlert(at) { alerts = alerts.filter(a => a.at !== at); prefs.set('alerts.' + code, alerts); emit(); },
      retry() { connect(); flush(); },
      close() {
        closed = true; clearTimeout(retryTimer); clearTimeout(saveTimer);
        if (meta) disk.set('ev:' + code, { v: 2, meta, entries: known });
        if (stopEvents) stopEvents(); if (stopConn) stopConn();
        if (globalThis.removeEventListener) globalThis.removeEventListener('online', onOnline);
      },
    };
  }

  /* Takes a trip off this phone only. The trip itself stays for everyone else. */
  async function forgetTrip(code) {
    await disk.del('ev:' + code);
    prefs.del('out.' + code); prefs.del('pout.' + code); prefs.del('alerts.' + code);
  }

  /* Google sign-in: is it switched on? Checked once and remembered for a while. */
  async function googleAvailable() {
    const seen = prefs.get('google');
    if (seen && Date.now() - seen.at < (seen.on ? 24 : 0.25) * 3600000) return seen.on;
    const on = await backend.googleAvailable();
    if (on === null) return seen ? seen.on : false;
    prefs.set('google', { on, at: Date.now() });
    return on;
  }

  return { dev, prefs, disk, createTrip, fetchMeta, openTrip, forgetTrip, ready: () => backend.ready(), googleAvailable,
    account: () => (backend.account ? backend.account() : null), onAccount: cb => backend.onAccount(cb), preload: () => backend.preload(),
    signInGoogle: () => backend.signInGoogle(), signOut: () => backend.signOut() };
}
