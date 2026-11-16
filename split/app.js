/* Split: the screens. Plain modules, no build step.
   core.js   the money logic (splits, balances, the log)
   store.js  where trips are kept (the drafters' Firebase database + a copy on the phone)
   rates.js  live exchange rates */
import * as C from './core.js?v=3';
import { makeStore, memoryBackend, memoryServer, browserPrefs, browserDisk } from './store.js?v=3';
import { makeRates, currencyName, guessCurrency } from './rates.js?v=3';
import { qrcode } from './lib/qr.js';

const TEST = globalThis.__SPLIT_TEST__ || null;
const DEMO = new URLSearchParams(location.search).has('demo');            // ?demo opens a sample trip that stays on this phone
const LOCALE = (TEST && TEST.locale) || navigator.language || 'en';
const demoServer = DEMO ? memoryServer() : null;
const store = DEMO ? makeStore({ backend: memoryBackend(demoServer), prefs: browserPrefs('demo.'), disk: browserDisk('-demo') }) : makeStore();
const prefs = store.prefs;
const rates = makeRates({ prefs });
const HEX = { night: '#151a3a', pine: '#0f3a2d', royal: '#0c2296', plum: '#3b1447', ember: '#5a1524', coal: '#1d1d1d' };
const ACCENT = { night: '#f6c453', pine: '#f3c969', royal: '#ffc72c', plum: '#ffb26b', ember: '#ffc978', coal: '#ffffff' };
const COLOR_NAMES = { night: 'Night blue', pine: 'Pine green', royal: 'Royal blue', plum: 'Plum', ember: 'Dark red', coal: 'Charcoal' };

/* ---------- small helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* html`...` escapes everything put into it, so a trip or expense name can never run as code. */
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = s => new Safe(String(s));
const flat = v => (v == null || v === false ? '' : v instanceof Safe ? v.s : Array.isArray(v) ? v.map(flat).join('') : esc(v));
function html(strings, ...vals) { let out = strings[0]; vals.forEach((v, i) => { out += flat(v) + strings[i + 1]; }); return new Safe(out); }

const IC = {
  back: raw('<svg viewBox="0 0 9 14" aria-hidden="true"><path d="M7.5 1 1.5 7l6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'),
  plus: raw('<svg viewBox="0 0 22 22" aria-hidden="true"><path d="M11 2v18M2 11h18" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/></svg>'),
  down: raw('<svg viewBox="0 0 10 7" aria-hidden="true"><path d="m1 1 4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'),
  tick: raw('<svg viewBox="0 0 14 11" aria-hidden="true"><path d="m1.5 5.5 3.7 3.7L12.5 1.8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'),
  cam: raw('<svg viewBox="0 0 20 16" aria-hidden="true" style="width:19px;height:15px"><path d="M2.5 4.2h3l1.3-2h6.4l1.3 2h3a1.2 1.2 0 0 1 1.2 1.2v7.9a1.2 1.2 0 0 1-1.2 1.2h-15a1.2 1.2 0 0 1-1.2-1.2V5.4a1.2 1.2 0 0 1 1.2-1.2z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="10" cy="9.2" r="2.9" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>'),
  ver: raw('<svg class="ver" viewBox="0 0 14 11" role="img" aria-label="signed in with Google"><path d="m1.5 5.5 3.7 3.7L12.5 1.8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'),
  clip: raw('<svg class="clip" viewBox="0 0 11 13" role="img" aria-label="has a photo"><path d="M1 1h9v11l-1.5-1.2L7 12l-1.5-1.2L4 12l-1.5-1.2L1 12z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M3.3 4.2h4.4M3.3 6.8h4.4" stroke="currentColor" stroke-width="1.3"/></svg>'),
};

const S = { view: 'boot', tab: 'expenses', code: null, trip: null, v: null, st: null, bal: null, paid: new Map(), me: null, filter: 'all', showGone: false, homeErr: '', homeCode: '', fresh: null, asked: false, mixing: false,
  guesses: [], looking: false,                             // other codes the typed one could stand for, and whether they're being checked
  google: false };                                         // is Google sign-in switched on for this site?
let googleReady = Promise.resolve(false);                   // settles once we know whether it is

const Trips = {
  all: () => prefs.get('trips', []),
  get(code) { return this.all().find(t => t.code === code) || null; },
  put(code, patch) {
    const list = this.all(), i = list.findIndex(t => t.code === code);
    const rec = { ...(i >= 0 ? list[i] : { code }), ...patch };
    if (i >= 0 && JSON.stringify(rec) === JSON.stringify(list[i])) return rec;
    if (i >= 0) list[i] = rec; else list.unshift(rec);
    prefs.set('trips', list); return rec;
  },
  touch(code) { const list = this.all(), i = list.findIndex(t => t.code === code); if (i > 0) { list.unshift(list.splice(i, 1)[0]); prefs.set('trips', list); } },
  drop(code) { prefs.set('trips', this.all().filter(t => t.code !== code)); },
};

const money = (minor, st = S.st) => C.fmtMoney(minor, st.base, st.dec, LOCALE);
const origMoney = x => C.fmtMoney(C.toMinor(x.amt, x.cd), x.cur, x.cd, LOCALE);
const nameOf = (id, st = S.st) => { const m = st && st.members.get(id); return m ? m.name : 'Someone'; };
const who = id => (id && id === S.me ? 'You' : nameOf(id));
const whom = id => (id && id === S.me ? 'you' : nameOf(id));
const people = n => n + (n === 1 ? ' person' : ' people');
/* "Ana, Marko and you" */
function nameList(ids, st = S.st) {
  const n = [...ids.filter(id => id !== S.me).map(id => nameOf(id, st)), ...(ids.includes(S.me) ? ['you'] : [])];
  return n.length > 1 ? n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1] : n[0] || 'nobody';
}
/* People are always listed in the order they joined the trip, whatever order their ids were stored in. */
const inOrder = (ids, st = S.st) => [...st.members.keys()].filter(id => ids.includes(id));
const liveGroups = (st = S.st) => [...st.groups.values()].filter(g => !g.gone).map(g => ({ ...g, members: inOrder(g.members, st).filter(id => !st.members.get(id).gone) }));
/* The Google account on this phone, or null when it's only a nameless visitor. */
const myAccount = () => { const a = store.account(); return a && a.google ? a : null; };
const acctOf = a => (a ? { e: a.mail } : undefined);        // the name travels in the entry's own checked field, not here
const acctText = a => `${a.name}${a.mail ? ` (${a.mail})` : ''}`;
const firstAcct = m => Object.values(m.accounts)[0] || null;
/* Grammar for "You owe" / "Jon owes". */
function voice(id) {
  const me = id === S.me, n = nameOf(id), third = { are: 'is', have: 'has', were: 'was', 'weren’t': 'wasn’t' };
  return { N: me ? 'You' : n, n: me ? 'you' : n, P: me ? 'Your' : n + '’s', p: me ? 'your' : n + '’s', s: w => (me ? w : third[w] || w + 's') };
}
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const VIA = [['cash', 'Cash'], ['PayPal', 'PayPal'], ['bank transfer', 'Bank transfer']];       // what is stored, and what the button says
const viaSay = v => (!v ? '' : v === 'cash' ? 'in cash' : 'by ' + v);                            // "in cash", "by PayPal", "by Revolut"
/* ", for Airbnb, in cash": what a payment was for and how it was made, when that is known. */
function payFor(p, st = S.st) {
  const x = p.x ? st.expenses.get(p.x) : null;
  return `${x ? `, for ${x.title}` : ''}${p.via ? `, ${viaSay(p.via)}` : ''}`;
}
const activeMembers = (st = S.st) => [...st.members.values()].filter(m => !m.gone);       // in the order they were added
const meFirst = list => [...list.filter(m => m.id === S.me), ...list.filter(m => m.id !== S.me)];

const fDay = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
const fDayYear = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
const fTime = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function niceDate(ds) {
  if (!ds) return 'No date';
  const d = C.parseLocalDate(ds);
  return d.getFullYear() === new Date().getFullYear() ? fDay.format(d) : fDayYear.format(d);
}
function dayLabel(ds) {
  const today = C.localDate(), yest = C.localDate(new Date(Date.now() - 864e5));
  return ds === today ? ['Today', niceDate(ds)] : ds === yest ? ['Yesterday', niceDate(ds)] : [niceDate(ds), ''];
}
const stampText = ms => `${niceDate(C.localDate(new Date(ms)))}, ${fTime.format(new Date(ms))}`;
/* "1 EUR = 104.17 ALL": always the way round that gives a number above one. */
function rateText(cur, base, rate) {
  if (!rate || cur === base) return '';
  return rate < 1 ? `1 ${base} = ${C.fmtRate(1 / rate)} ${cur}` : `1 ${cur} = ${C.fmtRate(rate)} ${base}`;
}
/* The two colours of a look, ready-made or someone's own. */
const lookParts = c => C.customParts(c) || { field: HEX[c] || HEX[C.COLORS[0]], accent: ACCENT[c] || ACCENT[C.COLORS[0]] };
/* A phone can have its own colours for a trip, which nobody else sees. */
const ownLook = code => C.colorOf(prefs.get('look.' + code)) || null;
function setColor(c) {
  const col = C.colorOf(c) || C.COLORS[0], own = C.customParts(col), b = document.body;
  b.className = own ? 'c-own' : 'c-' + col;
  for (const v of ['--field', '--on', '--accent', '--accent-ink', '--glow', '--mark']) b.style.removeProperty(v);
  if (own) {
    /* Someone's own two colours. Everything written on them switches to black or white, whichever reads better, and
       the small marks that sit on white paper or on the black bar fall back to a colour that shows up there. */
    const set = (k, v) => b.style.setProperty(k, v);
    set('--field', own.field); set('--on', C.inkOn(own.field)); set('--accent', own.accent); set('--accent-ink', C.inkOn(own.accent));
    set('--glow', C.contrast(own.accent, '#ffffff') >= 1.5 ? own.accent : C.contrast(own.field, '#ffffff') >= 1.5 ? own.field : '#a8a8a8');
    set('--mark', C.contrast(own.accent, '#000000') >= 3 ? own.accent : '#ffffff');
    if (C.contrast(own.accent, own.field) < 1.6) b.classList.add('c-flat');             // buttons the colour of the background get an outline
    if (C.contrast(own.field, '#ffffff') < 1.2) b.classList.add('c-pale');               // a background as pale as the paper: the paper gets edges
  }
  const m = $('meta[name="theme-color"]'); if (m) m.content = lookParts(col).field;
}
/* The colour chooser: six ready-made looks, or two colours of your own. get() is the look in use; pick(look, done) hears
   about every change, with done = false while a colour is still being dragged around in the phone's picker. */
function colorPicker(host, get, pick) {
  const draw = () => {
    const cur = get(), own = C.customParts(cur);
    host.innerHTML = html`<div class="swatches" role="radiogroup" aria-label="Colour">${C.COLORS.map(c => html`<button class="sw" type="button" role="radio" aria-checked="${String(cur === c)}" aria-label="${COLOR_NAMES[c]}" data-col="${c}" style="background:${HEX[c]}"></button>`)}
        <button class="sw own" type="button" role="radio" aria-checked="${String(!!own)}" aria-label="Your own colours" data-col="own" style="${own ? `background:linear-gradient(135deg,${own.field} 50%,${own.accent} 50%)` : ''}">${own ? '' : IC.plus}</button></div>
      ${own ? html`<div class="mix"><label>Background<input type="color" value="${own.field}" data-mix="field"></label><label>Buttons<input type="color" value="${own.accent}" data-mix="accent"></label></div>
        <p class="note">Any two colours. The writing turns black or white by itself so it stays readable.</p>` : ''}`;
  };
  host.addEventListener('click', e => {
    const b = e.target.closest('[data-col]'); if (!b) return;
    if (b.dataset.col !== 'own') pick(b.dataset.col, true);
    else if (!C.customParts(get())) { const last = C.colorOf(prefs.get('lastown')), now = lookParts(get()); pick(C.customParts(last) ? last : C.customColor(now.field, now.accent), true); }
    draw();
  });
  const mixed = done => {
    const f = $('[data-mix=field]', host), a = $('[data-mix=accent]', host), c = f && a ? C.customColor(f.value, a.value) : null;
    if (!c) return;
    prefs.set('lastown', c); pick(c, done);
    const sw = $('.sw.own', host); if (sw) sw.style.background = `linear-gradient(135deg,${f.value} 50%,${a.value} 50%)`;
  };
  host.addEventListener('input', e => { if (e.target.dataset.mix) mixed(false); });
  host.addEventListener('change', e => { if (e.target.dataset.mix) mixed(true); });
  draw();
  return draw;
}

let toastTimer = 0;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = html`<span>${msg}</span>${action ? html`<button type="button">${action.label}</button>` : ''}`;
  el.hidden = false; el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  if (action) $('button', el).onclick = () => { el.hidden = true; action.run(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6500 : 2600);
}
function stamp(word) {
  const el = document.createElement('div'); el.className = 'stamp'; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = html`<span>${word}</span>`; document.body.appendChild(el);
  setTimeout(() => el.remove(), 1250);
  try { if (navigator.vibrate) navigator.vibrate(18); } catch (_) { /* no buzz on this phone */ }
}
function download(name, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: type + ';charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const DEMO_Q = DEMO ? (new URLSearchParams(location.search).get('demo') === 'google' ? 'demo=google' : 'demo') : '';
const pageUrl = code => location.pathname + (DEMO || code ? '?' : '') + DEMO_Q + (DEMO && code ? '&' : '') + (code ? 't=' + C.fmtCode(code) : '');
const inviteUrl = code => location.origin + location.pathname.replace(/index\.html$/, '') + '?t=' + C.fmtCode(code);

/* ---------- sheets: slips of paper that slide up over the page ---------- */
const sheets = [];
function openSheet({ title, render, onClose }) {
  const veil = document.createElement('div'); veil.className = 'veil';
  veil.innerHTML = html`<section class="sheet" role="dialog" aria-modal="true" tabindex="-1"><div class="hd"><h2></h2><button class="link" type="button" data-close>Close</button></div><div class="body"></div><div class="ft" hidden></div></section>`;
  const sh = {
    veil, el: $('.sheet', veil), body: $('.body', veil), foot: $('.ft', veil), onClose, refresh: null, back: document.activeElement,
    title(t) { $('h2', veil).textContent = t; sh.el.setAttribute('aria-label', t); },
    footer(h) { sh.foot.innerHTML = h; sh.foot.hidden = false; },
    close() { if (sheets[sheets.length - 1] === sh) history.back(); },
  };
  sh.title(title);
  let downOnVeil = false;
  veil.addEventListener('pointerdown', e => { downOnVeil = e.target === veil; });
  veil.addEventListener('click', e => { if ((e.target === veil && downOnVeil) || e.target.closest('[data-close]')) sh.close(); });
  veil.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); sh.close(); return; }
    if (e.key !== 'Tab') return;
    const f = $$('button:not([disabled]),input:not([hidden]):not([disabled]),textarea,select,a[href]', sh.el).filter(x => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && (document.activeElement === f[0] || document.activeElement === sh.el)) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
  $('#sheets').appendChild(veil);
  sheets.push(sh);
  history.pushState({ ...(history.state || {}), sheet: sheets.length }, '');
  document.body.style.overflow = 'hidden';
  $('#app').inert = true;
  sh.el.focus({ preventScroll: true });
  render(sh);
  return sh;
}
function dropSheet() {
  const sh = sheets.pop(); if (!sh) return;
  sh.veil.classList.add('out'); setTimeout(() => sh.veil.remove(), 170);
  if (!sheets.length) { document.body.style.overflow = ''; $('#app').inert = false; }
  try { if (sh.back && sh.back.isConnected) sh.back.focus({ preventScroll: true }); } catch (_) { /* nothing to return to */ }
  if (sh.onClose) sh.onClose();
}
/* Closes `n` sheets and waits until they are gone. */
function closeSheets(n = 1) {
  n = Math.min(n, sheets.length);
  if (!n) return Promise.resolve();
  return new Promise(res => { const want = sheets.length - n; const t = setInterval(() => { if (sheets.length <= want) { clearInterval(t); res(); } }, 15); history.go(-n); });
}
window.addEventListener('popstate', e => {
  const depth = (e.state && e.state.sheet) || 0;
  if (sheets.length > depth) { while (sheets.length > depth) dropSheet(); return; }
  route();
});
function confirmSheet({ title, text, yes, danger }) {
  return new Promise(res => {
    let answer = false;
    openSheet({
      title, onClose: () => res(answer),
      render(sh) {
        sh.body.innerHTML = html`<p class="lead">${text}</p>`;
        sh.footer(html`<button class="btn big" type="button" data-yes style="${danger ? 'background:var(--red)' : ''}">${yes}</button>`);
        $('[data-yes]', sh.el).onclick = () => { answer = true; sh.close(); };
      },
    });
  });
}

/* ---------- getting around ---------- */
function route() {
  const t = new URLSearchParams(location.search).get('t');
  if (t == null) return showHome();
  const g = C.codeGuesses(t);
  if (g.length) {
    if (g[0] !== C.cleanCode(t)) history.replaceState(history.state, '', pageUrl(g[0]));
    return showTrip(g[0], g.slice(1));
  }
  history.replaceState({ v: 'home' }, '', pageUrl());
  showHome('That link doesn’t hold a valid trip code. Codes look like ABCD-EFGH.');
}
function go(code, guesses = []) { history.pushState({ v: 'trip', fromHome: true }, '', pageUrl(code)); showTrip(code, guesses); }
/* Opens whatever was put into the code box. g is what core.js made of it: the best guess first. */
function openCode(g) {
  S.homeCode = '';
  if (S.view !== 'trip') return go(g[0], g.slice(1));
  if (S.code === g[0] && !S.st) leaveTrip();                // the same code again: look it up afresh
  history.replaceState(history.state, '', pageUrl(g[0])); showTrip(g[0], g.slice(1));
}
/* The box a trip code goes into. A pasted invite link or message works as well. */
const codeBox = (value = '') => html`<form class="joinbox" id="joinForm"><input id="joinCode" aria-label="Trip code" placeholder="Have a code? Type it here" value="${value}" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go"><button class="btn">Join</button></form>`;
function goHome() {
  if (history.state && history.state.fromHome) history.back();
  else { history.replaceState({ v: 'home' }, '', pageUrl()); showHome(); }
}
function leaveTrip() {
  if (S.trip) S.trip.close();
  Object.assign(S, { trip: null, code: null, v: null, st: null, bal: null, paid: new Map(), me: null, asked: false, showGone: false, filter: 'all', fresh: null, mixing: false, guesses: [], looking: false });
}
function showHome(err = '') {
  leaveTrip(); S.view = 'home'; S.homeErr = err; setColor(C.COLORS[0]); document.title = 'Split';
  if (!err) S.homeCode = '';
  const trips = Trips.all();
  $('#app').innerHTML = html`<div class="home">
    <h1>Split</h1>
    <p class="lede">Trip costs, shared and settled. Everyone adds what they paid; the app works out who owes who.</p>
    <button class="btn big start" type="button" data-act="new">Start a trip</button>
    ${codeBox(S.homeCode)}
    ${err ? html`<p class="err" role="alert">${err}</p>` : ''}
    ${trips.length ? html`<h2>Your trips</h2><div class="paper trips">${trips.map((t, i) => {
      const net = t.net || 0, st = { base: t.base || 'EUR', dec: t.dec == null ? 2 : t.dec };
      return html`<button class="x ${i ? '' : 'nob'}" type="button" data-act="go" data-code="${t.code}"><div class="a"><span>${t.name || 'Trip'}</span><b class="${net < 0 ? 'red' : ''}">${net ? money(Math.abs(net), st) : ''}</b></div>
        <div class="b"><span>${people(t.people || 1)}</span><em class="${net < 0 ? 'red' : net ? '' : 'dim'}">${net > 0 ? 'you get back' : net < 0 ? 'you owe' : 'settled up'}</em></div></button>`;
    })}</div>` : ''}
    <p class="foot">${DEMO ? 'Sample mode: everything here stays on this phone.' : 'A trip is shared by its link or code.'}</p>
  </div>`;
  window.scrollTo(0, 0);
}
function showTrip(code, guesses = []) {
  if (S.code === code && S.trip) { S.view = 'trip'; renderTrip(); return; }
  leaveTrip();
  const rec = Trips.get(code);
  Object.assign(S, { view: 'trip', code, tab: 'expenses', me: rec ? rec.me : null, guesses });
  setColor(ownLook(code) || (rec ? rec.color : C.COLORS[0]));
  if (rec) Trips.touch(code);
  renderTrip(); window.scrollTo(0, 0);
  S.trip = store.openTrip(code, onTrip);
}
/* No trip under the code as typed: maybe one letter was read wrong. Codes that differ only by look-alike
   characters (S and 5, U and V, Q read as O...) are checked, and if a trip is there, it opens. */
async function lookNear() {
  const code = S.code, list = S.guesses;
  S.guesses = []; S.looking = true;
  const found = await Promise.all(list.map(c => store.fetchMeta(c).then(m => (m ? c : null), () => null)));
  if (S.code !== code) return;                                // moved on in the meantime
  S.looking = false;
  if (S.st) return;
  const hit = found.find(Boolean);
  if (!hit) return renderTrip();
  history.replaceState(history.state, '', pageUrl(hit));
  showTrip(hit); toast(`Found it: the code is ${C.fmtCode(hit)}`);
}
function onTrip(v) {
  if (v.code !== S.code) return;
  S.v = v;
  if (!v.meta && v.status.notFound && S.guesses.length && !S.looking) lookNear();
  if (v.meta) { S.st = C.replay(v.meta, v.entries); S.bal = C.balances(S.st); S.paid = C.paidFor(S.st); }
  const st = S.st;
  if (st) {
    if (S.me && v.status.live && !st.members.has(S.me)) S.me = null;        // this phone's person is not in the trip any more
    const acct = myAccount(), known = acct && v.status.live ? st.accounts.get(acct.uid) : null;
    if (!S.me && known && st.members.has(known) && !st.members.get(known).gone) {                // same Google account, new phone: straight back in
      S.me = known; S.trip.add([{ t: 'claim', d: { m: known, acct: acctOf(acct) }, by: known, signed: true }]);
      Trips.put(S.code, { me: known, g: true }); toast(`Welcome back, ${nameOf(known)}`);
    }
    if (!S.mixing) setColor(ownLook(S.code) || st.color);
    document.title = st.name + ' - Split';
    if (S.me) Trips.put(S.code, { name: st.name, color: st.color, me: S.me, net: S.bal.net[S.me] || 0, base: st.base, dec: st.dec, people: activeMembers().length });
    if (!S.me && !S.asked && v.status.live && !sheets.length) {
      S.asked = true; const code = S.code;
      googleReady.then(() => { if (S.code === code && !S.me && !sheets.length) sheetJoin(); });
    }
  }
  if (S.view === 'trip') renderTrip();
  for (const sh of sheets) if (sh.refresh) sh.refresh();
}
/* Things only someone in the trip can do. */
function needMe() { if (S.me) return true; if (S.st) sheetJoin(); return false; }
function add(items) { return S.trip.add(items.map(it => ({ ...it, by: S.me }))); }
/* Expenses can't change on a finalized trip: offer to reopen it first. Gives back whether to go ahead. */
async function unlocked(what) {
  if (!S.st.final) return true;
  if (!(await confirmSheet({ title: 'The trip is finalized', text: `${what} means reopening the trip. Everyone sees that on the log, and it can be finalized again afterwards.`, yes: 'Reopen the trip' }))) return false;
  if (S.st.final) { add([{ t: 'trip.final', d: { on: false } }]); toast('Trip reopened'); }
  return true;
}

/* ---------- the trip page ---------- */
function syncInfo() {
  const s = S.v.status;
  if (s.unreadable) return { cls: 'off', text: 'Can’t reach the trip. Tap to retry' };
  if (s.error) return { cls: 'off', text: 'Not saved yet. Tap to retry' };
  if (!s.online) return { cls: 'off', text: s.waiting ? `Offline, ${s.waiting} waiting to send` : 'Offline' };
  if (s.waiting || !s.live) return { cls: 'busy', text: s.live ? 'Saving…' : 'Connecting…' };
  return { cls: '', text: 'Up to date' };
}
function renderTrip() {
  const app = $('#app'), v = S.v, st = S.st;
  if (!st) {
    const gone = v && v.status.notFound && !S.looking && !S.guesses.length, stuck = v && v.status.loaded && !v.status.online && !gone;
    app.innerHTML = html`<div class="top"><button class="back" type="button" data-act="home">${IC.back}Trips</button></div>
      <header class="head"><h1>${gone ? 'No trip with that code' : 'Opening the trip…'}</h1>
      <p class="sub">${gone ? html`<span class="who">Nothing is saved under ${C.fmtCode(S.code)}. Check it letter by letter, or ask for the invite link instead.</span>` : stuck ? html`<span class="who">No connection. A trip opens without signal once this phone has loaded it before.</span>` : ''}</p>
      ${gone ? codeBox(C.fmtCode(S.code)) : ''}</header>`;
    return;
  }
  const y = window.scrollY, sync = syncInfo(), n = activeMembers().length;
  app.innerHTML = html`<div class="top"><button class="back" type="button" data-act="home">${IC.back}Trips</button>
      <button class="sync ${sync.cls}" type="button" data-act="retry"><i></i><span>${sync.text}</span></button></div>
    <header class="head"><h1 class="${st.name.length > 20 ? 'long' : ''}">${S.me ? html`<button type="button" data-act="rename-trip" aria-label="${st.name}. Tap to rename the trip">${st.name}</button>` : st.name}</h1>
      <div class="sub"><button class="who" type="button" data-act="more">${S.me ? html`<span>${people(n)}, you’re&nbsp;<b>${nameOf(S.me)}</b></span>` : html`<span>${people(n)}</span>`}</button>
      ${S.me ? html`<button class="btn small" type="button" data-act="invite">Invite</button><button class="btn small line" type="button" data-act="more">More</button>` : html`<button class="btn small" type="button" data-act="join">Join this trip</button>`}</div>
      ${wantsSignIn() ? html`<div class="nudge"><span>${st.signin === 'google' ? 'This trip asks everyone to sign in, so friends know it’s really you.' : 'Sign in so friends know it’s really you.'}</span>
        <button class="btn small" type="button" data-act="signin">Continue with Google</button><button class="link" type="button" data-act="nonudge">Not now</button></div>` : ''}
      ${st.final ? html`<div class="nudge"><span><b>Finalized</b> by ${whom(st.final.by)} on ${niceDate(C.localDate(new Date(st.final.at)))}. No new expenses unless it’s reopened.</span>
        <button class="btn small" type="button" data-act="final">See the final bill</button></div>` : ''}
      ${st.newer ? html`<div class="nudge"><span>Split has been updated since this page was opened. Load the new version to see everything.</span>
        <button class="btn small" type="button" data-act="reload">Load it</button></div>` : ''}</header>
    ${S.tab === 'expenses' ? tabExpenses() : S.tab === 'balances' ? tabBalances() : tabLog()}
    <nav class="bar" aria-label="Trip sections">${['expenses', 'balances', 'log'].map(t => html`<button class="tab" type="button" data-act="tab" data-tab="${t}" ${S.tab === t ? raw('aria-current="page"') : ''}>${t[0].toUpperCase() + t.slice(1)}</button>`)}
      <button class="plus" type="button" data-act="add" aria-label="Add an expense">${IC.plus}</button></nav>`;
  window.scrollTo(0, y);
  if (S.fresh) setTimeout(() => { S.fresh = null; }, 700);
}
/* Google sign-in is on, this phone is in the trip, and it hasn't signed in (or said "not now"). */
function wantsSignIn() {
  const a = store.account();
  return !!(S.google && S.me && a && !a.google && !inAppBrowser && !prefs.get('nonudge.' + S.code));
}
function standing() {
  const net = S.me ? S.bal.net[S.me] || 0 : 0, n = money(Math.abs(net));
  return html`<div class="stand ${net < 0 ? 'owe' : ''}"><div class="l">${!S.me ? 'Trip total' : net > 0 ? 'You get back' : net < 0 ? 'You owe' : 'You’re settled up'}${S.st.final ? html` <span class="stampd">Final</span>` : ''}</div>
    <div class="n ${n.length > 10 ? 'small' : ''}">${S.me ? n : money(S.bal.total)}</div>
    ${S.me && S.st.expenses.size ? html`<button class="link why" type="button" data-act="why" data-id="${S.me}">Why this number?</button>` : ''}</div>`;
}
function tabExpenses() {
  const st = S.st, b = S.bal, all = [...st.expenses.values()], live = all.filter(x => !x.gone), gone = all.length - live.length;
  const dateOf = x => x.date || C.localDate(new Date(x.at));
  const shown = (S.showGone ? all : live).sort((p, q) => (dateOf(p) < dateOf(q) ? 1 : dateOf(p) > dateOf(q) ? -1 : q.at - p.at || (p.id < q.id ? 1 : -1)));
  const rows = []; let day = null;
  for (const x of shown) {
    if (dateOf(x) !== day) { day = dateOf(x); const [a, c] = dayLabel(day); rows.push(html`<div class="sec ${rows.length ? '' : 'first'}"><span>${a}</span><span>${c}</span></div>`); }
    rows.push(expenseRow(x));
  }
  const alone = activeMembers().length < 2;
  return html`<main class="paper">${standing()}
    ${S.me ? html`<div class="sums"><div><span>Trip total</span><span>${money(b.total)}</span></div><div><span>Your part</span><span>${money(b.share[S.me] || 0)}</span></div><div><span>You paid</span><span>${money(b.paid[S.me] || 0)}</span></div></div>` : ''}
    ${shown.length ? rows : html`<div class="empty"><b>${alone ? 'Just you so far' : 'Nothing on the tab yet'}</b>${alone ? 'Send the invite so your friends can join, or add them yourself under More.' : 'Add the first expense with the + button below.'}
      ${alone && S.me ? html`<br><button class="btn" type="button" data-act="invite">Invite friends</button>` : ''}</div>`}
    ${gone ? html`<button class="link more" type="button" data-act="gone">${S.showGone ? 'Hide' : 'Show'} ${gone} deleted</button>` : ''}</main>`;
}
/* "Ana paid", "Ana paid for Jon": the short line under an expense. */
function paidWords(x, shares) {
  const ids = Object.keys(shares);
  const only = ids.length === 1 ? (ids[0] === x.payer ? (x.payer === S.me ? ' for yourself' : ' for themselves') : ` for ${whom(ids[0])}`) : '';
  return `${who(x.payer)} paid${only}${x.tag ? ', ' + x.tag : ''}${x.edits ? ', edited' : ''}`;
}
function expenseRow(x) {
  const st = S.st, base = C.baseMinor(x, st.dec), shares = C.expenseShares(x, st.dec), me = S.me, paid = S.paid.get(x.id) || {};
  const left = x.gone ? `Deleted by ${whom(x.goneBy)}` : paidWords(x, shares);
  let right = '';
  if (!x.gone && me) {
    if (x.payer === me) {                                    // what is still to come back to you for this one
      const back = base - (shares[me] || 0), still = back - Object.keys(paid).reduce((t, id) => t + (id === me ? 0 : paid[id]), 0);
      right = still > 0 ? html`<em>you get back ${money(still)}</em>` : html`<em class="dim">${back > 0 ? 'paid back' : 'evens out'}</em>`;
    } else if (me in shares) {                               // what is left of your part
      const still = shares[me] - (paid[me] || 0);
      right = still > 0 ? html`<em class="red">you owe ${money(still)}</em>` : html`<em class="dim">${shares[me] > 0 ? 'you paid your part' : 'evens out'}</em>`;
    } else right = html`<em class="dim">not yours</em>`;
  }
  return html`<button class="x ${x.gone ? 'void' : ''} ${x.pending ? 'wait' : ''} ${S.fresh === x.id ? 'fresh' : ''}" type="button" data-act="open" data-id="${x.id}">
    <div class="a"><span>${x.title}</span><b>${x.rc.length ? IC.clip : ''} ${origMoney(x)}</b></div><div class="b"><span>${left}</span>${right}</div></button>`;
}
function tabBalances() {
  const st = S.st, b = S.bal, me = S.me;
  const mine = p => p.from === me || p.to === me;
  const plan = C.settleUp(b.net).sort((p, q) => mine(q) - mine(p) || q.amt - p.amt);
  const members = [...st.members.values()].filter(m => !m.gone || b.net[m.id]).sort((p, q) => (b.net[q.id] || 0) - (b.net[p.id] || 0) || (p.name < q.name ? -1 : 1));
  const pays = [...st.payments.values()].filter(p => !p.gone).sort((p, q) => q.at - p.at);
  return html`<main class="paper">${standing()}
    <div class="sec first"><span>Settle up</span><span>${plan.length ? (plan.length === 1 ? '1 payment clears it' : plan.length + ' payments clear it') : ''}</span></div>
    ${plan.length ? plan.map(p => html`<div class="pay ${mine(p) ? 'mine' : ''}"><div class="t">${who(p.from)} ${p.from === me ? 'pay' : 'pays'} ${whom(p.to)}</div><span class="pa"><b class="${p.from === me ? 'red' : ''}">${money(p.amt)}</b>
      <button class="btn small ${mine(p) ? '' : 'line'}" type="button" data-act="settle" data-from="${p.from}" data-to="${p.to}" data-amt="${p.amt}">Mark paid</button></span></div>`)
      : html`<p class="note">${st.expenses.size ? 'Everyone is settled up. Nobody owes anything.' : 'Once there are expenses, the payments that settle everything show up here.'}</p>`}
    ${plan.length ? html`<button class="link more" type="button" data-act="why-plan">Why these payments?</button>` : ''}
    <div class="sec"><span>Everyone</span><span>tap a name to see why</span></div>
    ${members.map(m => { const net = b.net[m.id] || 0; return html`<button class="x" type="button" data-act="why" data-id="${m.id}"><div class="a"><span>${m.name}${m.id === me ? ' (you)' : ''}${firstAcct(m) ? IC.ver : ''}</span><b class="${net < 0 ? 'red' : ''}">${money(Math.abs(net))}</b></div>
      <div class="b"><span>paid ${money(b.paid[m.id] || 0)}, part ${money(b.share[m.id] || 0)}</span><em class="${net < 0 ? 'red' : net ? '' : 'dim'}">${net > 0 ? (m.id === me ? 'you get back' : 'gets back') : net < 0 ? (m.id === me ? 'you owe' : 'owes') : 'settled up'}</em></div></button>`; })}
    ${pays.length ? html`<div class="sec"><span>Payments made</span><span></span></div>${pays.map(p => html`<button class="x ${p.pending ? 'wait' : ''}" type="button" data-act="payment" data-id="${p.id}"><div class="a"><span>${who(p.from)} paid ${whom(p.to)}</span><b>${p.rc.length ? IC.clip : ''} ${origMoney(p)}</b></div>
      <div class="b"><span>${niceDate(p.date || C.localDate(new Date(p.at)))}${payFor(p)}</span></div></button>`)}` : ''}
    <button class="link more" type="button" data-act="settle">Record another payment</button>
    ${me && st.expenses.size ? (st.final ? html`<button class="btn big fbtn" type="button" data-act="final">See the final bill</button>`
      : html`<button class="btn big line fbtn" type="button" data-act="final">Finalize trip</button><p class="note">For when everything is in. Shows the final bill and closes the trip to new expenses.</p>`) : ''}</main>`;
}

/* ---------- the log ---------- */
const LOG_KIND = { 'member.addmany': 'people', 'expense.add': 'adds', 'expense.edit': 'changes', 'expense.delete': 'changes', 'expense.restore': 'changes', 'pay.add': 'payments', 'pay.delete': 'payments',
  'member.add': 'people', 'member.rename': 'people', 'member.remove': 'people', claim: 'people', 'trip.rename': 'changes', 'trip.color': 'changes',
  'trip.policy': 'people', 'group.set': 'people', 'group.remove': 'people', 'trip.final': 'changes' };
function splitList(x) {
  const ids = inOrder(Object.keys(x.parts));
  if (x.mode === 'equal') return ids.length > 4 ? people(ids.length) : ids.map(id => nameOf(id)).join(', ') || 'nobody';
  return ids.map(id => `${nameOf(id)} ${x.mode === 'exact' ? C.fmtMoney(C.toMinor(x.parts[id], x.cd), x.cur, x.cd, LOCALE) : x.parts[id] + (x.parts[id] === 1 ? ' share' : ' shares')}`).join(', ');
}
/* "for everyone", "for Ana and Jon", "split 4 ways": who an expense was for, in a few words. */
function splitFor(x) {
  const ids = inOrder(Object.keys(x.parts)), names = ids.map(id => nameOf(id));
  if (x.mode !== 'equal') return 'split unevenly: ' + splitList(x);
  if (x.tag) return `for the ${x.tag} group (${names.join(', ')})`;
  if (ids.length > 1 && ids.length === activeMembers().length) return 'for everyone';
  if (ids.length <= 3) return 'for ' + (names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0] || 'nobody');
  return `split ${ids.length} ways`;
}
function editDetails(l) {
  const st = S.st, ch = new Set(l.changes.map(c => c.f)), b = l.before, a = l.snap, out = [];
  if (ch.has('title')) out.push(['name', b.title, a.title]);
  if (ch.has('amt') || ch.has('cur')) out.push(['amount', origMoney(b), origMoney(a)]);
  if ((ch.has('rate') || ch.has('rsrc')) && (a.cur !== st.base || b.cur !== st.base)) out.push(['rate', rateText(b.cur, st.base, b.rate) || 'none', (rateText(a.cur, st.base, a.rate) || 'none') + (a.rsrc === 'manual' && a.cur !== st.base ? ' (typed in)' : '')]);
  if (ch.has('date')) out.push(['date', niceDate(b.date), niceDate(a.date)]);
  if (ch.has('payer')) out.push(['paid by', nameOf(b.payer), nameOf(a.payer)]);
  if (ch.has('parts') || ch.has('mode')) out.push(['split', splitList(b), splitList(a)]);
  if (ch.has('tag')) out.push(['group', b.tag || 'none', a.tag || 'none']);
  if (ch.has('note')) out.push(['note', b.note || 'empty', a.note || 'empty']);
  if (ch.has('rc')) {
    const added = a.rc.filter(r => !b.rc.includes(r)).length, removed = b.rc.filter(r => !a.rc.includes(r)).length, n = k => (k === 1 ? 'a receipt photo' : k + ' receipt photos');
    out.push({ text: added === 1 && removed === 1 ? 'swapped a receipt photo for a different one' : added && removed ? `took off ${n(removed)} and added ${n(added)}` : added ? `added ${n(added)}` : `took off ${n(removed)}` });
  }
  return out;
}
/* What changed when a payment was edited. */
function payDetails(l) {
  const st = S.st, ch = new Set(l.changes.map(c => c.f)), b = l.before, a = l.snap, out = [], title = id => (id && st.expenses.get(id) ? st.expenses.get(id).title : 'nothing in particular');
  if (ch.has('amt') || ch.has('cur')) out.push(['amount', origMoney(b), origMoney(a)]);
  if (ch.has('from')) out.push(['who paid', nameOf(b.from), nameOf(a.from)]);
  if (ch.has('to')) out.push(['who got it', nameOf(b.to), nameOf(a.to)]);
  if (ch.has('via')) out.push(['how', b.via || 'not said', a.via || 'not said']);
  if (ch.has('date')) out.push(['date', niceDate(b.date), niceDate(a.date)]);
  if (ch.has('x')) out.push(['for', title(b.x), title(a.x)]);
  if ((ch.has('rate') || ch.has('rsrc')) && (a.cur !== st.base || b.cur !== st.base)) out.push(['rate', rateText(b.cur, st.base, b.rate) || 'none', rateText(a.cur, st.base, a.rate) || 'none']);
  if (ch.has('rc')) {
    const added = a.rc.filter(r => !b.rc.includes(r)).length, removed = b.rc.filter(r => !a.rc.includes(r)).length, n = k => (k === 1 ? 'a proof photo' : k + ' proof photos');
    out.push({ text: added && removed ? `took off ${n(removed)} and added ${n(added)}` : added ? `added ${n(added)}` : `took off ${n(removed)}` });
  }
  return out;
}
/* Turns one log line into words. Returns null for lines not worth showing. */
function logWords(l, ctx) {
  const st = S.st, actor = l.by ? who(l.by) : 'Someone', o = { text: '', amt: '', struck: false, details: [], flags: [], open: null };
  const x = l.snap;
  switch (l.t) {
    case 'member.add': o.text = l.by === l.ref ? html`<b>${l.id === st.log[0].id ? actor : l.name}</b> ${l.id === st.log[0].id ? 'started' : 'joined'} the trip` : html`<b>${actor}</b> added ${l.name} to the trip`; break;
    case 'member.addmany': o.text = html`<b>${actor}</b> added ${l.names.length > 3 ? `${l.names.slice(0, 2).join(', ')} and ${l.names.length - 2} others` : `${l.names.slice(0, -1).join(', ')} and ${l.names[l.names.length - 1]}`} to the trip`; break;
    case 'member.rename': o.text = html`<b>${actor}</b> renamed ${l.changes[0].from} to ${l.changes[0].to}`; break;
    case 'member.remove': o.text = html`<b>${actor}</b> removed ${l.name} from the trip`; break;
    case 'claim': {
      const as = l.acct ? `, signed in with Google as ${acctText(l.acct)}` : l.sameAcct ? ', same Google account' : '';
      const first = ctx.claims[l.id] === 1, self = first && ctx.selfAdded.has(l.ref), nosign = l.flags.includes('nosign');
      if (l.flags.includes('switched')) {
        o.text = html`<b>${nameOf(l.changes[0].from)}</b>’s ${l.acct ? 'Google account' : 'phone'} now acts as ${l.name}${as}`;
        o.flags.push(`This ${l.acct ? 'Google account' : 'phone'} was ${nameOf(l.changes[0].from)} before`);
      } else if (l.signedIn || self) {
        if (l.acct) o.text = html`<b>${l.name}</b> signed in with Google as ${acctText(l.acct)}`;
        else if (nosign) o.text = html`<b>${l.name}</b> joined`;
        else return null;                                      // their own "joined" line already says it
      } else if (first) o.text = html`<b>${l.name}</b> joined the trip${as}`;
      else o.text = html`<b>${l.name}</b> opened the trip on another phone${as}`;
      if (nosign) o.flags.push('Without the Google sign-in this trip asks for');
      break;
    }
    case 'group.set':
      if (l.made) { o.text = html`<b>${actor}</b> made the group ${l.name}`; o.details.push(html`in it: ${nameList(inOrder(l.members))}`); }
      else {
        o.text = html`<b>${actor}</b> changed the group ${l.name}`;
        for (const c of l.changes) {
          if (c.f === 'name') o.details.push(html`name was <i class="struck">${c.from}</i>, now <i>${c.to}</i>`);
          else { if (c.added.length) o.details.push(html`added ${nameList(inOrder(c.added))}`); if (c.removed.length) o.details.push(html`took out ${nameList(inOrder(c.removed))}`); }
        }
      }
      break;
    case 'group.remove': o.text = html`<b>${actor}</b> removed the group ${l.name}`; break;
    case 'trip.policy': o.text = l.signin === 'google' ? html`<b>${actor}</b> set the trip so new people must sign in with Google` : html`<b>${actor}</b> let new people join without signing in`; break;
    case 'expense.add':
      o.text = html`<b>${actor}</b> added ${x.title}`; o.amt = origMoney(x); o.open = l.ref;
      o.details.push(html`paid by ${nameOf(x.payer)}, ${splitFor(x)}${x.cur !== st.base ? html`, at ${rateText(x.cur, st.base, x.rate)}${x.rsrc === 'manual' ? ' (typed in)' : ''}` : ''}`);
      if (l.flags.includes('final')) o.flags.push('Added after the trip was finalized');
      break;
    case 'expense.edit':
      o.text = html`<b>${actor}</b> changed ${x.title}`; o.open = l.ref;
      for (const d of editDetails(l)) o.details.push(Array.isArray(d) ? html`${d[0]} was <i class="struck">${d[1]}</i>, now <i>${d[2]}</i>` : d.text);
      if (l.changes.some(c => c.f === 'rc') && l.before.rc.some(r => !x.rc.includes(r))) o.flags.push('A receipt photo was taken off');
      if (l.flags.includes('amount')) o.flags.push('The amount was changed');
      if (l.flags.includes('late')) o.flags.push('Changed more than a day after it was added');
      if (l.flags.includes('final')) o.flags.push('Changed after the trip was finalized');
      break;
    case 'expense.delete': o.text = html`<b>${actor}</b> deleted <span class="struck">${x.title}</span>`; o.amt = origMoney(x); o.struck = true; o.open = l.ref;
      if (l.flags.includes('late')) o.flags.push('Deleted more than a day after it was added');
      if (l.flags.includes('final')) o.flags.push('Deleted after the trip was finalized'); break;
    case 'expense.restore': o.text = html`<b>${actor}</b> brought back ${x.title}`; o.amt = origMoney(x); o.open = l.ref;
      if (l.flags.includes('final')) o.flags.push('Brought back after the trip was finalized'); break;
    case 'pay.add': {
      const fors = payFor(x).replace(/^, /, '');
      o.amt = origMoney(x); if (x.x) o.open = x.x;
      if (l.edit) {
        o.text = html`<b>${actor}</b> changed the payment from ${whom(x.from)} to ${whom(x.to)}`;
        for (const d of payDetails(l)) o.details.push(Array.isArray(d) ? html`${d[0]} was <i class="struck">${d[1]}</i>, now <i>${d[2]}</i>` : d.text);
        if (l.flags.includes('amount')) o.flags.push('The amount was changed');
        if (l.flags.includes('late')) o.flags.push('Changed more than a day after it was recorded');
      } else {
        o.text = l.by === x.from ? html`<b>${actor}</b> paid ${whom(x.to)}` : html`<b>${actor}</b> recorded that ${whom(x.from)} paid ${whom(x.to)}`;
        if (fors) o.details.push(fors);
      }
      break;
    }
    case 'pay.delete': o.text = html`<b>${actor}</b> deleted the payment from ${whom(x.from)} to ${whom(x.to)}`; o.amt = origMoney(x); o.struck = true; if (x.x) o.open = x.x;
      if (payFor(x)) o.details.push(payFor(x).replace(/^, /, ''));
      if (l.flags.includes('late')) o.flags.push('Deleted more than a day after it was recorded'); break;
    case 'trip.final':
      o.text = l.on ? html`<b>${actor}</b> finalized the trip` : html`<b>${actor}</b> reopened the trip`;
      if (l.on) o.details.push(`trip total ${money(l.total)}, ${l.left ? (l.left === 1 ? '1 payment' : l.left + ' payments') + ' still to make' : 'everyone settled up'}`);
      break;
    case 'trip.rename': o.text = html`<b>${actor}</b> renamed the trip to ${l.changes[0].to}`; o.details.push(html`it was called ${l.changes[0].from}`); break;
    case 'trip.color': o.text = html`<b>${actor}</b> changed the trip colour`; break;
    default: return null;
  }
  if (l.flags.includes('rate') && x && x.mkt) { const pct = Math.round(Math.abs(x.rate / x.mkt - 1) * 100); o.flags.push(`Typed-in rate counts this ${pct}% ${x.rate > x.mkt ? 'higher' : 'lower'} than the market rate`); }
  if (l.flags.includes('borrowed')) o.flags.push(`Sent from the phone ${nameOf(l.owner)} uses`);
  return o;
}
function logContext() {
  const claims = {}, seen = {}, selfAdded = new Set();
  for (const l of S.st.log) {
    if (l.t === 'member.add' && l.by === l.ref) selfAdded.add(l.ref);
    if (l.t === 'claim') { seen[l.ref] = (seen[l.ref] || 0) + 1; claims[l.id] = seen[l.ref]; }
  }
  return { claims, selfAdded };
}
function logLine(l, ctx, withDate = false) {
  const o = logWords(l, ctx); if (!o) return '';
  const exists = o.open && S.st.expenses.has(o.open);
  const inner = html`<time>${withDate ? fDay.format(new Date(l.at)).replace(/^\S+\s/, '') : fTime.format(new Date(l.at))}</time><span class="w">${o.amt ? html`<span class="amt ${o.struck ? 'struck' : ''}">${o.amt}</span>` : ''}${o.text}
    ${o.details.map(d => html`<span class="d">${d}</span>`)}${l.pending ? html`<span class="d">waiting to send</span>` : ''}${o.flags.map(f => html`<span class="flag">${f}</span>`)}</span>`;
  return exists && !withDate ? html`<button class="lg" type="button" data-act="open" data-id="${o.open}">${inner}</button>` : html`<div class="lg ${withDate ? 'dated' : ''}">${inner}</div>`;
}
function entryBrief(rawEntry) {
  const e = C.readEntry('x', rawEntry); if (!e) return 'an unreadable entry';
  const d = e.d, by = e.by ? nameOf(e.by) : 'someone';
  if (e.t === 'expense.add' && d.title) return `${by} added ${d.title}, ${d.amt} ${d.cur}, paid by ${nameOf(d.payer)}`;
  if (e.t === 'expense.edit') return `${by} changed an expense: ${Object.entries(d.set || {}).map(([k, v]) => k + ' ' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(', ')}`;
  if (e.t === 'pay.add') return `${by} recorded ${nameOf(d.from)} paying ${nameOf(d.to)} ${d.amt} ${d.cur}`;
  return `${by}: ${e.t.replace('.', ' ')}`;
}
/* Several friends added in one go read as one line, not one line each. */
function mergeAdds(log) {
  const out = [];
  for (const l of log) {
    if (l.merged) continue;                                  // the taking-off half of an edited payment: the edit line tells it
    const prev = out[out.length - 1];
    if (l.t === 'trip.color' && prev && prev.t === 'trip.color' && prev.by === l.by && Math.abs(l.at - prev.at) < 600000) { out[out.length - 1] = l; continue; }
    if (l.t === 'member.add' && l.by !== l.ref && !l.flags.length && prev && (prev.t === 'member.add' || prev.t === 'member.addmany') && prev.by === l.by && prev.by !== prev.ref && !prev.flags.length && Math.abs(l.at - prev.at) < 5000) {
      out[out.length - 1] = { ...prev, t: 'member.addmany', names: [...(prev.names || [prev.name]), l.name], pending: prev.pending || l.pending };
    } else out.push(l);
  }
  return out;
}
function tabLog() {
  const st = S.st, ctx = logContext(), f = S.filter;
  const lines = mergeAdds(st.log).filter(l => f === 'all' || LOG_KIND[l.t] === f || (f === 'changes' && l.flags.length)).reverse();
  const rows = []; let day = null;
  for (const l of lines) {
    const h = logLine(l, ctx); if (!h) continue;
    const ds = C.localDate(new Date(l.at));
    if (ds !== day) { day = ds; const [a, c] = dayLabel(ds); rows.push(html`<div class="sec"><span>${a}</span><span>${c}</span></div>`); }
    rows.push(h);
  }
  const alerts = S.v.alerts.map(a => html`<div class="alert" role="alert">${a.kind === 'changed' ? html`<b>An entry was changed outside the app</b>Noticed ${stampText(a.at)}. The trip now uses the changed version.
      <span class="was">It said: ${entryBrief(a.was)}.</span><span class="was">It now says: ${entryBrief(a.now)}.</span>`
    : a.kind === 'restored' ? html`<b>${a.n === 1 ? 'An entry was' : a.n + ' entries were'} missing from the server</b>Noticed ${stampText(a.at)}. This phone still had ${a.n === 1 ? 'it' : 'them'} and put ${a.n === 1 ? 'it' : 'them'} back.`
      : html`<b>${a.n === 1 ? 'An entry was' : a.n + ' entries were'} removed on the server</b>Noticed ${stampText(a.at)}. ${a.n === 1 ? 'It' : 'They'} could not be put back.`}
    <br><button class="link" type="button" data-act="hide-alert" data-at="${a.at}">Hide this</button></div>`);
  return html`<main class="paper"><p class="note">Every change is kept here, newest first. Edits show what it said before. Deleted expenses stay, crossed out.</p>
    ${alerts}
    <div class="chips" role="group" aria-label="Show">${[['all', 'Everything'], ['changes', 'Edits and deletes'], ['payments', 'Payments'], ['people', 'People']].map(([k, t]) => html`<button class="chip" type="button" data-act="filter" data-f="${k}" aria-pressed="${String(S.filter === k)}">${t}</button>`)}</div>
    ${rows.length ? rows : html`<p class="note">${f === 'changes' ? 'No edits or deletes so far.' : 'Nothing here yet.'}</p>`}
    ${st.log.length ? html`<button class="link more" type="button" data-act="csv-log">Download the log</button>` : ''}</main>`;
}

/* ---------- taps on the page ---------- */
$('#app').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'new') sheetNewTrip();
  else if (a === 'go') go(b.dataset.code);
  else if (a === 'home') goHome();
  else if (a === 'retry') { if (S.trip) S.trip.retry(); }
  else if (a === 'tab') { S.tab = b.dataset.tab; renderTrip(); window.scrollTo(0, 0); }
  else if (a === 'join') sheetJoin();
  else if (a === 'invite') sheetInvite();
  else if (a === 'more') { if (needMe()) sheetTrip(); }
  else if (a === 'add') { if (needMe()) unlocked('Adding an expense').then(go => { if (go) sheetExpense(null); }); }
  else if (a === 'rename-trip') renameTrip();
  else if (a === 'final') sheetFinal();
  else if (a === 'reload') location.reload();
  else if (a === 'open') sheetDetail(b.dataset.id);
  else if (a === 'gone') { S.showGone = !S.showGone; renderTrip(); }
  else if (a === 'settle') { if (needMe()) sheetPayment(b.dataset.from ? { from: b.dataset.from, to: b.dataset.to, amt: +b.dataset.amt } : {}); }
  else if (a === 'payment') sheetPaymentDetail(b.dataset.id);
  else if (a === 'person') { if (needMe()) sheetPerson(b.dataset.id); }
  else if (a === 'signin') signInHere(toast);
  else if (a === 'nonudge') { prefs.set('nonudge.' + S.code, 1); renderTrip(); }
  else if (a === 'why') sheetWhy(b.dataset.id);
  else if (a === 'why-plan') sheetWhyPlan();
  else if (a === 'filter') { S.filter = b.dataset.f; renderTrip(); }
  else if (a === 'hide-alert') S.trip.hideAlert(+b.dataset.at);
  else if (a === 'csv-log') exportLog();
});
$('#app').addEventListener('submit', e => {
  if (e.target.id !== 'joinForm') return;
  e.preventDefault();
  const typed = $('#joinCode').value, g = C.codeGuesses(typed);
  if (g.length) return openCode(g);
  S.homeCode = typed.trim().slice(0, 80);
  showHome(S.homeCode ? 'That isn’t a trip code. A code is 8 letters and numbers, like ABCD-EFGH. Pasting the invite link here works too.' : 'Type the trip code first: 8 letters and numbers, like ABCD-EFGH.');
  const box = $('#joinCode'); if (box) box.focus();
});

/* ---------- Google sign-in (optional: it appears once it is switched on in Firebase) ---------- */
const inAppBrowser = /FBAN|FBAV|FB_IAB|Instagram|Line\/|TikTok|musical_ly|Snapchat|; wv\)/i.test(navigator.userAgent);   // Google refuses to sign in inside these
/* Opens Google's sign-in window. Gives back the account, or null when it didn't happen (say() gets the reason). */
async function googleSignIn(say) {
  try { const a = await store.signInGoogle(); return a && a.google ? a : null; }
  catch (e) {
    const c = String((e && (e.code || e.message)) || '');
    if (/popup-closed|cancelled-popup/.test(c)) return null;                 // they closed the window themselves
    if (/operation-not-allowed/.test(c)) { S.google = false; prefs.set('google', { on: false, at: Date.now() }); }     // it was switched off again in Firebase
    say(/popup-blocked|not-supported|web-storage|not-ready/.test(c) ? 'The sign-in window couldn’t open here. Open this page in Safari or Chrome and try again.'
      : /operation-not-allowed/.test(c) ? 'Google sign-in isn’t switched on for this site yet.' : /network/.test(c) ? 'No connection. Try again in a moment.' : 'Signing in didn’t work. Try again.');
    return null;
  }
}
const acctLine = a => html`Signed in with Google as <b>${a.name || 'your account'}</b>${a.mail ? ` (${a.mail})` : ''}`;
const checkGoogle = () => (DEMO ? Promise.resolve(!!demoServer.googleOn) : store.googleAvailable()).then(on => { S.google = !!on; return S.google; }, () => S.google);
/* Signs this phone in while it is already in a trip, and writes that on the log. */
async function signInHere(say) {
  const a = await googleSignIn(say); if (!a || !S.me || !S.st) return null;
  const known = S.st.accounts.get(a.uid), mine = known && S.st.members.has(known) && !S.st.members.get(known).gone ? known : S.me;
  S.trip.add([{ t: 'claim', d: { m: mine, acct: acctOf(a) }, by: mine, signed: true }]);
  if (mine !== S.me) { S.me = mine; toast(`That account is ${nameOf(mine)} in this trip, so this phone is ${nameOf(mine)} now`); } else toast(`Signed in as ${a.name || 'you'}`);
  Trips.put(S.code, { me: mine, g: true });
  return a;
}

/* ---------- start a trip ---------- */
function sheetNewTrip() {
  const F = { name: '', base: guessCurrency(LOCALE), me: prefs.get('name', ''), others: [], color: C.COLORS[0], busy: false, acct: myAccount(), require: true };
  openSheet({
    title: 'Start a trip',
    render(sh) {
      sh.body.innerHTML = html`<form id="nf" novalidate>
        <div class="f"><label for="nName">Trip name</label><input class="in" id="nName" maxlength="60" placeholder="Albania road trip" autocomplete="off" enterkeyhint="next"></div>
        <div class="f"><div class="lab">Count everything in <small>other currencies are converted</small></div><button class="cur" type="button" id="nBase"></button></div>
        <div class="f"><label for="nMe">Your name</label><input class="in" id="nMe" maxlength="40" autocomplete="given-name" enterkeyhint="next"><div id="nAcct"></div></div>
        <div class="f"><label for="nOther">Who else is coming <small>optional</small></label>
          <div class="pick" id="nOthers"></div><div class="addrow"><input class="in" id="nOther" maxlength="40" placeholder="A friend’s name" autocomplete="off" enterkeyhint="done"><button class="btn line" type="button" id="nAdd">Add</button></div></div>
        <div class="f"><div class="lab">Colour</div><div id="nCol"></div></div></form>`;
      sh.footer(html`<div class="msg" id="nMsg" role="alert"></div><button class="btn big" form="nf" id="nGo">Start the trip</button>`);
      const el = k => $('#' + k, sh.el), msg = el('nMsg');
      el('nMe').value = F.me;
      const draw = () => {
        el('nBase').innerHTML = html`${F.base} ${IC.down}`; el('nBase').setAttribute('aria-label', 'Trip currency: ' + currencyName(F.base, LOCALE));
        el('nOthers').innerHTML = html`${F.others.map((n, i) => html`<button class="chip" type="button" data-i="${i}" aria-label="Remove ${n}"><span>${n}</span> ×</button>`)}`;
      };
      const drawAcct = () => {
        el('nAcct').innerHTML = !S.google ? '' : F.acct ? html`<p class="note ok">${acctLine(F.acct)}</p>
            <button class="prow" type="button" role="checkbox" aria-checked="${String(F.require)}" id="nReq"><span class="tick">${IC.tick}</span><span class="nm wrap">Friends must sign in with Google to join</span></button>`
          : html`<button class="btn line gbtn" type="button" id="nGoogle" ${store.account() ? '' : raw('disabled')}>Continue with Google</button><p class="note">Optional. Friends then see it’s really you, and you can ask the same of them.</p>`;
      };
      const addOther = () => { const i = el('nOther'), n = i.value.trim(); if (n && F.others.length < 30) { F.others.push(n.slice(0, 40)); i.value = ''; draw(); } i.focus(); };
      draw(); drawAcct();
      Promise.all([store.preload(), checkGoogle()]).then(() => { if (sheets.includes(sh)) { F.acct = myAccount(); drawAcct(); } });
      el('nBase').onclick = () => sheetCurrency(F.base, c => { F.base = c; draw(); });
      el('nAdd').onclick = addOther;
      el('nOther').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addOther(); } });
      el('nOthers').onclick = e => { const b = e.target.closest('[data-i]'); if (b) { F.others.splice(+b.dataset.i, 1); draw(); } };
      colorPicker(el('nCol'), () => F.color, c => { F.color = c; setColor(c); });
      el('nAcct').addEventListener('click', async e => {
        if (e.target.closest('#nReq')) { F.require = !F.require; drawAcct(); return; }
        if (!e.target.closest('#nGoogle')) return;
        msg.textContent = '';
        const a = await googleSignIn(t => { msg.textContent = t; }); if (!a || !sheets.includes(sh)) return;
        F.acct = a; if (!el('nMe').value.trim()) el('nMe').value = (a.name || '').split(' ')[0];
        drawAcct();
      });
      el('nf').onsubmit = async e => {
        e.preventDefault(); if (F.busy) return;
        const name = el('nName').value.trim(), me = el('nMe').value.trim();
        const pending = el('nOther').value.trim(); if (pending) { F.others.push(pending.slice(0, 40)); el('nOther').value = ''; }
        if (!name) { msg.textContent = 'Give the trip a name.'; el('nName').focus(); return; }
        if (!me) { msg.textContent = 'Type your name so friends know who you are.'; el('nMe').focus(); return; }
        F.busy = true; el('nGo').disabled = true; msg.textContent = ''; el('nGo').textContent = 'Starting…';
        const acct = myAccount(), myId = C.newId('m');
        const items = [{ t: 'member.add', d: { id: myId, name: me }, by: myId }, { t: 'claim', d: { m: myId, acct: acctOf(acct) }, by: myId, signed: !!acct }];
        const seen = new Set([me.toLowerCase()]);
        for (const n of F.others) if (!seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); items.push({ t: 'member.add', d: { id: C.newId('m'), name: n }, by: myId }); }
        if (acct && F.require && S.google) items.push({ t: 'trip.policy', d: { signin: 'google' }, by: myId });
        try {
          const code = await store.createTrip({ name, base: F.base, dec: C.curDecimals(F.base), color: F.color }, items);
          prefs.set('name', me);
          Trips.put(code, { name, color: F.color, me: myId, net: 0, base: F.base, dec: C.curDecimals(F.base), people: seen.size, g: !!acct });
          await closeSheets(1);
          go(code);
          setTimeout(() => { if (S.code === code && !sheets.length) sheetInvite(true); }, 350);
        } catch (err) {
          F.busy = false; el('nGo').disabled = false; el('nGo').textContent = 'Start the trip';
          msg.textContent = 'Couldn’t start the trip. Check your connection and try again.';
        }
      };
      el('nName').focus({ preventScroll: true });
    },
    onClose() { if (S.view === 'home') setColor(C.COLORS[0]); },
  });
}

/* ---------- join ---------- */
function sheetJoin() {
  if (!S.st || sheets.some(s => s.kind === 'join')) return;
  let pick = null, guest = false, failed = false;
  const sh = openSheet({
    title: 'Join ' + S.st.name,
    render(sh) {
      sh.body.innerHTML = html`<div id="jTop"></div><div id="jWho" hidden><p class="lead">Which one is you?</p><div class="pick" role="radiogroup" aria-label="Which one is you" id="jPick"></div>
        <div class="f" id="jNew" hidden><label for="jName">Your name</label><input class="in" id="jName" maxlength="40" autocomplete="given-name" enterkeyhint="done"></div></div>
        <div class="msg" id="jMsg" role="alert"></div>`;
      sh.footer(html`<button class="btn big" type="button" id="jGo">Join the trip</button>`);
      const el = k => $('#' + k, sh.el), msg = el('jMsg');
      el('jName').value = prefs.get('name', '');
      const draw = () => {
        const st = S.st, acct = myAccount(), must = st.signin === 'google', ask = S.google && !acct && !guest;
        const stuck = inAppBrowser || failed;                    // Google can't sign in here: don't leave them outside
        el('jTop').innerHTML = ask ? html`<p class="lead">${must ? 'This trip asks everyone to sign in, so friends know it’s really you.' : 'Sign in so friends know it’s really you.'} One tap, and this phone stays signed in.</p>
            ${inAppBrowser ? html`<p class="note">Google doesn’t sign in inside this app’s browser. Open this page in Safari or Chrome first (look for “Open in browser” in the menu).</p>`
              : html`<button class="btn big gbtn" type="button" id="jGoogle" ${store.account() ? '' : raw('disabled')}>Continue with Google</button>`}
            ${must && !stuck ? '' : html`<button class="link" type="button" id="jGuest">${must ? 'Can’t sign in on this phone? Join without it' : 'Join without signing in'}</button>`}
            ${must && stuck ? html`<p class="note">The log will show that you joined without signing in.</p>` : ''}`
          : acct ? html`<p class="note ok">${acctLine(acct)}</p>` : '';
        el('jWho').hidden = ask; sh.foot.hidden = ask;
        el('jPick').innerHTML = html`${activeMembers().map(m => {
          const taken = Object.keys(m.accounts).length > 0 && !(acct && acct.uid in m.accounts);        // that name belongs to someone else's Google account
          return html`<button class="chip" type="button" role="radio" aria-checked="${String(pick === m.id)}" data-id="${m.id}" ${taken ? raw('disabled') : ''}><span>${m.name}${taken ? ' (already signed in)' : ''}</span></button>`;
        })}<button class="chip" type="button" role="radio" aria-checked="${String(pick === 'new')}" data-id="new"><span>I’m not on the list</span></button>`;
        el('jNew').hidden = pick !== 'new';
      };
      sh.refresh = draw; draw();
      Promise.all([store.preload(), checkGoogle()]).then(() => { if (sheets.includes(sh)) draw(); });
      const finish = (id, items, acct) => {
        items.push({ t: 'claim', d: { m: id, acct: acctOf(acct) }, by: id, signed: !!acct });
        S.me = id; S.trip.add(items);
        Trips.put(S.code, { name: S.st.name, color: S.st.color, me: id, g: !!acct });
        sh.close();
      };
      el('jTop').addEventListener('click', async e => {
        if (e.target.closest('#jGuest')) { guest = true; msg.textContent = ''; draw(); return; }
        if (!e.target.closest('#jGoogle')) return;
        msg.textContent = '';
        const a = await googleSignIn(t => { msg.textContent = t; failed = true; });
        if (!sheets.includes(sh) || S.me) return;
        if (!a) { draw(); return; }
        const known = S.st.accounts.get(a.uid);
        if (known && S.st.members.has(known) && !S.st.members.get(known).gone) { finish(known, [], a); toast(`Welcome back, ${nameOf(known)}`); return; }
        if (!el('jName').value.trim()) el('jName').value = (a.name || '').split(' ')[0];
        draw();
      });
      el('jPick').onclick = e => { const b = e.target.closest('[data-id]'); if (!b || b.disabled) return; pick = b.dataset.id; msg.textContent = ''; draw(); if (pick === 'new') el('jName').focus(); };
      const join = () => {
        if (!pick) { msg.textContent = 'Tap your name, or “I’m not on the list”.'; return; }
        let id = pick; const items = [], acct = myAccount();
        if (pick === 'new') {
          const name = el('jName').value.trim();
          if (!name) { msg.textContent = 'Type your name.'; el('jName').focus(); return; }
          const same = activeMembers().find(m => m.name.toLowerCase() === name.toLowerCase());
          if (same && Object.keys(same.accounts).length && !(acct && acct.uid in same.accounts)) { msg.textContent = `Someone called ${same.name} is already signed in with another account. Add a last initial so friends can tell you apart.`; return; }
          if (same) id = same.id; else { id = C.newId('m'); items.push({ t: 'member.add', d: { id, name }, by: id }); }
          prefs.set('name', name);
        }
        finish(id, items, acct); toast('You’re in');
      };
      el('jGo').onclick = join;
      el('jName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); join(); } });
    },
  });
  sh.kind = 'join';
}

/* ---------- currency picker ---------- */
function sheetCurrency(current, onPick) {
  openSheet({
    title: 'Currency',
    render(sh) {
      const all = rates.currencies(), usedHere = S.st ? [S.st.base, ...new Set([...S.st.expenses.values()].map(x => x.cur))] : [];
      const top = [...new Set([current, ...usedHere, guessCurrency(LOCALE), 'EUR', 'USD'])].filter(c => C.isCurrencyCode(c));
      sh.body.innerHTML = html`<input class="in" id="cQ" placeholder="Search: lek, peso, USD…" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Search currencies"><div class="list" id="cL" style="margin-top:12px"></div>`;
      const row = c => html`<button class="li" type="button" data-c="${c}"><span class="code">${c}</span><span class="grow">${currencyName(c, LOCALE)}</span>${c === current ? html`<span class="go">chosen</span>` : ''}</button>`;
      const draw = () => {
        const q = $('#cQ', sh.el).value.trim().toLowerCase();
        const list = q ? all.filter(c => c.toLowerCase().includes(q) || currencyName(c, LOCALE).toLowerCase().includes(q)) : [...top, ...all.filter(c => !top.includes(c))];
        $('#cL', sh.el).innerHTML = list.length ? html`${list.map(row)}` : html`<p class="note">No currency matches “${q}”.</p>`;
      };
      draw();
      $('#cQ', sh.el).oninput = draw;
      $('#cL', sh.el).onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; const c = b.dataset.c; closeSheets(1).then(() => onPick(c)); };
      rates.table().then(() => { if (sheets.includes(sh)) draw(); });
    },
  });
}

/* ---------- amount + currency + exchange rate, shared by expenses and payments ---------- */
function moneyBox(F, sh, ids, { onChange }) {
  const st = S.st, amtEl = $(ids.amt, sh.el), curEl = $(ids.cur, sh.el), fxEl = $(ids.fx, sh.el);
  let token = 0, typing = false;
  const amount = () => C.parseAmount(amtEl.value, C.curDecimals(F.cur));
  function draw() {
    curEl.innerHTML = html`${F.cur} ${IC.down}`; curEl.setAttribute('aria-label', 'Currency: ' + currencyName(F.cur, LOCALE));
    if (F.cur === st.base) { fxEl.innerHTML = ''; return; }
    const a = amount(), r = F.rate && F.rate.rate, about = a && r ? html`About <b>${money(C.baseMinor({ amt: a, cd: C.curDecimals(F.cur), rate: r }, st.dec))}</b> ` : '';
    if (typing) { const out = $('[data-about]', fxEl); if (out) out.innerHTML = about; return; }
    if (F.loading) fxEl.innerHTML = html`Getting today’s rate…`;
    else if (F.manual) {
      fxEl.innerHTML = html`<span data-about>${about}</span>${F.rate && F.rate.mkt ? '' : html`No live rate for ${F.cur} right now. Type the rate you got.`}
        <div class="row"><label for="fxIn">${F.inv ? `1 ${st.base} =` : `1 ${F.cur} =`}</label><input class="in" id="fxIn" inputmode="decimal" autocomplete="off" value="${r ? C.fmtRate(F.inv ? 1 / r : r) : ''}"><span>${F.inv ? F.cur : st.base}</span></div>
        <button class="link" type="button" data-fx="live">Use the live rate</button>`;
    } else if (r) {
      fxEl.innerHTML = html`<span data-about>${about}</span>at ${rateText(F.cur, st.base, r)}${F.rate.src === 'saved' ? html` (saved rate from ${niceDate(F.rate.date)}, no connection)` : F.rate.src === 'manual' ? ' (typed in)' : ''}
        <br><button class="link" type="button" data-fx="own">Use my own rate</button>`;
    } else fxEl.innerHTML = '';
  }
  async function load(force) {
    if (F.cur === st.base) { F.rate = { rate: 1, src: 'same', date: '', mkt: 0 }; F.manual = false; F.loading = false; draw(); onChange(); return; }
    if (F.manual && !force) { draw(); return; }
    const my = ++token; F.loading = true; draw();
    const r = await rates.rate(F.cur, st.base, F.date);
    if (my !== token || !sheets.includes(sh)) return;
    F.loading = false;
    if (r) { F.rate = { rate: r.rate, src: r.src, date: r.date, mkt: r.rate }; F.manual = false; }
    else { F.rate = null; F.manual = true; F.inv = true; }
    draw(); onChange();
  }
  amtEl.addEventListener('input', () => {
    const clean = amtEl.value.replace(/[^0-9.,\s]/g, ''); if (clean !== amtEl.value) amtEl.value = clean;
    draw(); onChange();
  });
  curEl.onclick = () => sheetCurrency(F.cur, c => { if (c === F.cur) return; F.cur = c; F.manual = false; F.rate = null; const a = amount(); if (a != null) amtEl.value = String(a); load(true); });
  fxEl.addEventListener('click', e => {
    const b = e.target.closest('[data-fx]'); if (!b) return;
    if (b.dataset.fx === 'own') { F.manual = true; F.inv = !!(F.rate && F.rate.rate < 1); if (F.rate) F.rate = { ...F.rate, src: 'manual' }; draw(); const i = $('#fxIn', fxEl); if (i) { i.focus(); i.select(); } onChange(); }
    else load(true);
  });
  fxEl.addEventListener('input', e => {
    if (e.target.id !== 'fxIn') return;
    const n = Number(String(e.target.value).replace(/\s/g, '').replace(',', '.'));
    const mkt = (F.rate && F.rate.mkt) || 0;
    F.rate = Number.isFinite(n) && n > 0 ? { rate: Number((F.inv ? 1 / n : n).toPrecision(8)), src: 'manual', date: '', mkt } : (mkt ? { rate: 0, src: 'manual', date: '', mkt } : null);
    typing = true; draw(); typing = false; onChange();
  });
  return { draw, load, amount };
}
const rateFields = F => ({ rate: F.rate.rate, rsrc: F.rate.src === 'same' ? 'same' : F.manual || F.rate.src === 'manual' ? 'manual' : F.rate.src, rdate: F.rate.date || '', mkt: F.manual || F.rate.src === 'manual' ? F.rate.mkt || 0 : 0 });

/* ---------- add or edit an expense ---------- */
function sheetExpense(id) {
  const st = S.st, old = id ? st.expenses.get(id) : null;
  const members = meFirst([...st.members.values()].filter(m => !m.gone || (old && (old.payer === m.id || m.id in old.parts))));
  const F = old ? {
    cur: old.cur, payer: old.payer, mode: old.mode, date: old.date || C.localDate(), sel: new Set(Object.keys(old.parts)),
    shares: old.mode === 'shares' ? { ...old.parts } : {}, exact: old.mode === 'exact' ? Object.fromEntries(Object.entries(old.parts).map(([k, v]) => [k, String(v)])) : {},
    photos: old.rc.map(rid => ({ rid })), rate: { rate: old.rate, src: old.rsrc, date: old.rdate, mkt: old.mkt }, manual: old.rsrc === 'manual', inv: old.rate < 1, loading: false,
  } : { cur: prefs.get('cur.' + S.code) || st.base, payer: S.me, mode: 'equal', date: C.localDate(), sel: new Set(activeMembers().map(m => m.id)), shares: {}, exact: {}, photos: [], rate: null, manual: false, inv: true, loading: false };
  if (!C.isCurrencyCode(F.cur)) F.cur = st.base;
  let busy = false;
  openSheet({
    title: old ? 'Edit expense' : 'Add an expense',
    render(sh) {
      sh.body.innerHTML = html`<form id="xf" novalidate>
        <div class="f"><label for="xa">Amount</label><div class="amount"><input id="xa" inputmode="decimal" autocomplete="off" placeholder="0" enterkeyhint="next"><button class="cur" type="button" id="xc"></button></div><div class="fx" id="xfx" aria-live="polite"></div></div>
        <div class="f"><label for="xt">What was it for</label><input class="in" id="xt" maxlength="80" placeholder="Dinner, taxi, groceries…" autocomplete="off" enterkeyhint="done">
          <div class="photos under" id="xph"></div><input type="file" accept="image/*" id="xfile" hidden></div>
        <div class="f"><div class="lab">Paid by</div><div class="pick" role="radiogroup" aria-label="Paid by" id="xp"></div></div>
        <div class="f"><div class="lab">Split between <small id="xsum"></small></div>
          <div class="quick" id="xq" role="group" aria-label="Quick pick"></div>
          <div class="seg" role="radiogroup" aria-label="How to split">${[['equal', 'Equally'], ['shares', 'By shares'], ['exact', 'Exact amounts']].map(([k, t]) => html`<button type="button" role="radio" data-mode="${k}">${t}</button>`)}</div>
          <div class="rows" id="xs"></div><div class="left" id="xleft" aria-live="polite"></div></div>
        <div class="f"><label for="xd">When</label><input class="in" type="date" id="xd" max="2100-12-31"></div>
        <div class="f"><label for="xn">Note <small>optional</small></label><textarea class="in" id="xn" maxlength="300" rows="2"></textarea></div>
        ${old ? html`<div class="f"><button class="link red" type="button" id="xdel">Delete this expense</button></div>` : ''}</form>`;
      sh.footer(html`<div class="msg" id="xmsg" role="alert"></div><button class="btn big" form="xf">${old ? 'Save changes' : 'Add expense'}</button>`);
      const el = k => $('#' + k, sh.el), msg = el('xmsg');
      if (old) { el('xa').value = String(old.amt); el('xt').value = old.title; el('xn').value = old.note; }
      el('xd').value = F.date;

      const cd = () => C.curDecimals(F.cur);
      const weights = () => {                                    // { id: weight } for the people included
        const o = {};
        for (const m of members) {
          if (F.mode === 'equal') { if (F.sel.has(m.id)) o[m.id] = 1; }
          else if (F.mode === 'shares') { const n = F.shares[m.id] || 0; if (n > 0) o[m.id] = n; }
          else { const n = C.parseAmount(F.exact[m.id], cd()); if (n > 0) o[m.id] = n; }
        }
        return o;
      };
      const fmtCur = minor => C.fmtMoney(minor, F.cur, cd(), LOCALE);
      function drawPayer() {
        el('xp').innerHTML = html`${members.map(m => html`<button class="chip" type="button" role="radio" aria-checked="${String(F.payer === m.id)}" data-id="${m.id}"><span>${m.id === S.me ? 'You' : m.name}</span></button>`)}`;
      }
      function drawSplit(full = true) {
        const a = box.amount(), total = a ? C.toMinor(a, cd()) : 0, w = weights(), ids = Object.keys(w).sort();
        const cents = C.allocate(total, ids.map(i => w[i]), 'preview'), share = Object.fromEntries(ids.map((i, k) => [i, cents[k]]));
        $$('[data-mode]', sh.el).forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === F.mode)));
        el('xsum').textContent = ids.length ? (ids.length === members.length ? 'everyone' : people(ids.length)) : 'nobody yet';
        if (full) {
          el('xs').innerHTML = html`${members.map(m => {
            const nm = m.id === S.me ? 'You' : m.name;
            if (F.mode === 'equal') return html`<button class="prow" type="button" role="checkbox" aria-checked="${String(F.sel.has(m.id))}" data-id="${m.id}"><span class="tick">${IC.tick}</span><span class="nm">${nm}</span><span class="val" data-v="${m.id}"></span></button>`;
            if (F.mode === 'shares') return html`<div class="prow ${F.shares[m.id] ? '' : 'offp'}" data-row="${m.id}"><span class="nm">${nm}</span><span class="val" data-v="${m.id}"></span><span class="step"><button type="button" data-dec="${m.id}" aria-label="One share less for ${nm}">−</button><output data-o="${m.id}">${F.shares[m.id] || 0}</output><button type="button" data-inc="${m.id}" aria-label="One share more for ${nm}">+</button></span></div>`;
            return html`<div class="prow"><label class="nm" for="xe-${m.id}">${nm}</label><input class="in sm" id="xe-${m.id}" data-exact="${m.id}" inputmode="decimal" autocomplete="off" placeholder="0" value="${F.exact[m.id] || ''}"></div>`;
          })}`;
        }
        if (F.mode !== 'exact') for (const m of members) { const v = $(`[data-v="${m.id}"]`, sh.el); if (v) v.textContent = m.id in share && total ? fmtCur(share[m.id]) : ''; }
        if (F.mode === 'shares') for (const m of members) { const r = $(`[data-row="${m.id}"]`, sh.el); if (r) { r.classList.toggle('offp', !F.shares[m.id]); $(`[data-o="${m.id}"]`, r).textContent = F.shares[m.id] || 0; } }
        const left = el('xleft');
        if (F.mode === 'exact' && total) {
          const used = ids.reduce((s, i) => s + C.toMinor(w[i], cd()), 0), diff = total - used;
          left.textContent = diff === 0 ? 'Adds up to the total.' : diff > 0 ? `${fmtCur(diff)} still to share out.` : `${fmtCur(-diff)} over the total.`;
          left.classList.toggle('red', diff !== 0);
        } else left.textContent = '';
        drawQuick();
      }
      /* One-tap picks: everyone, or a group made for things only some people share (alcohol, say). */
      const picked = () => (F.mode === 'equal' ? members.filter(m => F.sel.has(m.id)) : F.mode === 'shares' ? members.filter(m => F.shares[m.id] > 0) : []).map(m => m.id);
      function drawQuick() {
        const now = picked(), everyone = activeMembers().map(m => m.id);
        const is = ids => F.mode !== 'exact' && ids.length > 0 && now.length === ids.length && ids.every(i => now.includes(i));
        F.tag = '';
        const chips = [html`<button class="chip" type="button" data-q="all" aria-pressed="${String(is(everyone))}">Everyone</button>`];
        for (const g of liveGroups().filter(g => g.members.length)) {
          const on = is(g.members) && !is(everyone); if (on && !F.tag) F.tag = g.name;
          chips.push(html`<button class="chip" type="button" data-q="${g.id}" aria-pressed="${String(on)}">${g.name}</button>`);
        }
        chips.push(html`<button class="chip dash" type="button" data-q="new">New group</button>`);
        el('xq').innerHTML = html`${chips}`;
      }
      function pickPeople(ids) {
        F.touched = true;
        if (F.mode === 'exact') F.mode = 'equal';
        if (F.mode === 'equal') F.sel = new Set(ids); else for (const m of members) F.shares[m.id] = ids.includes(m.id) ? Math.max(1, F.shares[m.id] || 0) : 0;
        msg.textContent = ''; drawSplit();
      }
      el('xq').onclick = e => {
        const b = e.target.closest('[data-q]'); if (!b) return;
        const q = b.dataset.q, g = S.st.groups.get(q);
        if (q === 'all') pickPeople(activeMembers().map(m => m.id));
        else if (q === 'new') sheetGroup(null, picked().length && picked().length < activeMembers().length ? picked() : [], made => pickPeople(made));
        else if (g) pickPeople(liveGroups().find(x => x.id === q).members);
      };
      sh.refresh = drawQuick;
      const box = moneyBox(F, sh, { amt: '#xa', cur: '#xc', fx: '#xfx' }, { onChange: () => { msg.textContent = ''; drawSplit(false); } });
      drawPayer(); drawSplit(); box.draw();
      photoStrip(sh, el('xph'), el('xfile'), F.photos, { first: 'Add a receipt photo', onError: () => { msg.textContent = 'That photo couldn’t be added. Try another one.'; } });
      if (!old) box.load(); else if (old.cur !== st.base && !F.rate.mkt && !F.manual) F.rate.mkt = F.rate.rate;

      el('xp').onclick = e => { const b = e.target.closest('[data-id]'); if (b) { F.payer = b.dataset.id; drawPayer(); } };
      $('.seg', sh.el).onclick = e => {
        const b = e.target.closest('[data-mode]'); if (!b || b.dataset.mode === F.mode) return;
        const from = F.mode; F.mode = b.dataset.mode; F.touched = true;
        if (F.mode === 'shares' && !Object.values(F.shares).some(v => v > 0)) for (const m of members) F.shares[m.id] = (from === 'equal' ? F.sel.has(m.id) : true) ? 1 : 0;
        if (F.mode === 'equal' && from === 'shares') F.sel = new Set(members.filter(m => F.shares[m.id] > 0).map(m => m.id));
        if (F.mode === 'exact' && !Object.values(F.exact).some(v => C.parseAmount(v, cd()) > 0)) {
          const a = box.amount(), ids = members.filter(m => (from === 'shares' ? F.shares[m.id] > 0 : F.sel.has(m.id))).map(m => m.id);
          if (a && ids.length) { const cents = C.allocate(C.toMinor(a, cd()), ids.map(i => (from === 'shares' ? F.shares[i] : 1)), 'preview'); ids.forEach((i, k) => { F.exact[i] = String(C.fromMinor(cents[k], cd())); }); }
        }
        drawSplit();
      };
      el('xs').addEventListener('click', e => {
        const row = e.target.closest('button.prow'), inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]');
        if (row || inc || dec) F.touched = true;
        if (row) { const i = row.dataset.id; if (F.sel.has(i)) F.sel.delete(i); else F.sel.add(i); row.setAttribute('aria-checked', String(F.sel.has(i))); drawSplit(false); }
        else if (inc) { F.shares[inc.dataset.inc] = Math.min(99, (F.shares[inc.dataset.inc] || 0) + 1); drawSplit(false); }
        else if (dec) { F.shares[dec.dataset.dec] = Math.max(0, (F.shares[dec.dataset.dec] || 0) - 1); drawSplit(false); }
        msg.textContent = '';
      });
      el('xs').addEventListener('input', e => { const i = e.target.dataset.exact; if (i) { F.exact[i] = e.target.value; F.touched = true; drawSplit(false); msg.textContent = ''; } });
      el('xd').onchange = () => { F.date = el('xd').value || C.localDate(); if (!old && F.cur !== st.base && !F.manual) box.load(true); };
      if (old) el('xdel').onclick = async () => {
        if (!(await confirmSheet({ title: 'Delete this expense?', text: `“${old.title}” comes off the balances. It stays in the log, crossed out, and can be brought back.`, yes: 'Delete expense', danger: true }))) return;
        add([{ t: 'expense.delete', d: { id } }]);
        await closeSheets(sheets.length);
        toast('Expense deleted', { label: 'Undo', run: () => add([{ t: 'expense.restore', d: { id } }]) });
      };
      el('xf').onsubmit = async e => {
        e.preventDefault(); if (busy) return;
        const amt = box.amount(), title = el('xt').value.trim(), w = weights();
        if (!amt) { msg.textContent = 'Type the amount.'; el('xa').focus(); return; }
        if (!title) { msg.textContent = 'Say what it was for.'; el('xt').focus(); return; }
        if (!F.payer) { msg.textContent = 'Pick who paid.'; return; }
        if (F.photos.some(p => !p.rid)) { msg.textContent = 'The photo is still being added. One moment.'; return; }
        if (F.loading) { msg.textContent = 'Still getting the exchange rate. One moment.'; return; }
        if (!F.rate || !(F.rate.rate > 0)) { msg.textContent = 'Type an exchange rate.'; return; }
        if (!Object.keys(w).length) { msg.textContent = 'Pick at least one person to split it between.'; return; }
        if (F.mode === 'exact') {
          const used = Object.values(w).reduce((s, v) => s + C.toMinor(v, cd()), 0), total = C.toMinor(amt, cd());
          if (used !== total) { msg.textContent = `The amounts add up to ${fmtCur(used)}, not ${fmtCur(total)}.`; return; }
        }
        const d = { title, amt, cur: F.cur, cd: cd(), ...rateFields(F), date: F.date, payer: F.payer, mode: F.mode, parts: w, tag: old && !F.touched ? old.tag : F.mode === 'exact' ? '' : F.tag || '', note: el('xn').value.trim(), rc: F.photos.map(p => p.rid) };
        busy = true;
        if (old) {
          const set = {}, before = C.cleanExpense({ ...old }), after = C.cleanExpense({ ...d, id });
          for (const k of Object.keys(d)) if (JSON.stringify(sortKeys(before[k])) !== JSON.stringify(sortKeys(after[k]))) set[k] = d[k];
          if ('cur' in set) set.cd = d.cd;
          if (Object.keys(set).length) add([{ t: 'expense.edit', d: { id, set } }]);
          await closeSheets(1);
          toast(Object.keys(set).length ? 'Changes saved' : 'Nothing changed');
        } else {
          const nid = C.newId('x');
          add([{ t: 'expense.add', d: { id: nid, ...d } }]);
          prefs.set('cur.' + S.code, F.cur); S.fresh = nid; S.tab = 'expenses';
          await closeSheets(1);
          window.scrollTo(0, 0); toast('Expense added');
        }
      };
      if (!old) el('xa').focus();
    },
  });
}
const sortKeys = v => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);

/* The row of photo thumbnails with an "Add a photo" button: receipts on expenses, proof on payments. */
function photoStrip(sh, host, file, photos, { first, onError }) {
  const draw = () => {
    host.innerHTML = html`${photos.map((p, i) => html`<div class="ph ${p.url ? '' : 'load'}">${p.url ? html`<img src="${p.url}" alt="Photo ${i + 1}">` : p.note || 'Loading…'}<button class="rm" type="button" data-rm="${i}" aria-label="Remove photo ${i + 1}">×</button></div>`)}
      ${photos.length < 4 ? html`<button class="btn line small" type="button" data-addph>${IC.cam}${photos.length ? 'Add another' : first}</button>` : ''}`;
  };
  host.addEventListener('click', e => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { photos.splice(+rm.dataset.rm, 1); draw(); } else if (e.target.closest('[data-addph]')) file.click();
  });
  file.onchange = async () => {
    const f = file.files[0]; file.value = ''; if (!f) return;
    const p = { rid: null, url: '', note: 'Shrinking…' }; photos.push(p); draw();
    try { p.url = await shrinkPhoto(f); p.rid = await S.trip.addPhoto(p.url); p.note = ''; }
    catch (err) { photos.splice(photos.indexOf(p), 1); onError(); }
    if (sheets.includes(sh)) draw();
  };
  for (const p of photos) if (!p.url && p.rid) S.trip.photo(p.rid).then(r => { p.url = r.img || ''; p.note = r.img ? '' : r.changed ? 'Changed outside the app' : 'Not uploaded yet'; if (sheets.includes(sh)) draw(); }, () => {});
  draw();
}

/* Makes a phone photo small enough to store: at most about 300 KB. */
async function shrinkPhoto(file) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (_) {
    src = await new Promise((res, rej) => { const im = new Image(), u = URL.createObjectURL(file); im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('not a picture')); }; im.src = u; });
  }
  const W = src.width || src.naturalWidth, H = src.height || src.naturalHeight;
  if (!W || !H) throw new Error('not a picture');
  const canvas = document.createElement('canvas'); let max = 1500, q = 0.72;
  for (let i = 0; i < 9; i++) {
    const k = Math.min(1, max / Math.max(W, H));
    canvas.width = Math.max(1, Math.round(W * k)); canvas.height = Math.max(1, Math.round(H * k));
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/jpeg', q);
    if (url.length <= 400000) return url;
    if (q > 0.5) q -= 0.11; else max = Math.round(max * 0.8);
  }
  throw new Error('too large');
}
function sheetPhoto(rid) {
  const v = document.createElement('div'); v.className = 'viewer'; v.setAttribute('role', 'dialog'); v.setAttribute('aria-label', 'Receipt photo');
  v.innerHTML = html`<div class="vtop"><button class="btn small" type="button">Close</button></div><div class="vimg"><p>Loading the photo…</p></div>`;
  document.body.appendChild(v);
  const fake = { veil: v, onClose: null, refresh: null, back: document.activeElement, close() { if (sheets[sheets.length - 1] === fake) history.back(); } };
  sheets.push(fake); history.pushState({ ...(history.state || {}), sheet: sheets.length }, '');
  $('button', v).onclick = () => fake.close(); $('button', v).focus();
  v.addEventListener('keydown', e => { if (e.key === 'Escape') fake.close(); });
  S.trip.photo(rid).then(r => {
    const box = $('.vimg', v);
    if (r.img) { box.innerHTML = html`<img src="${r.img}" alt="Receipt photo">`; box.onclick = () => box.classList.toggle('zoom'); }
    else box.innerHTML = html`<p>${r.changed ? 'This photo was changed outside the app, so it isn’t shown.' : 'This photo hasn’t been uploaded yet. It will appear once the phone it was taken on is back online.'}</p>`;
  }, () => { $('.vimg', v).innerHTML = html`<p>Couldn’t load the photo. Check your connection.</p>`; });
}

/* ---------- groups: a shortcut for things only some people share ---------- */
function sheetGroup(id, preselect = [], onSaved = null) {
  if (!needMe()) return;
  const old = id ? liveGroups().find(g => g.id === id) : null;
  if (id && !old) return;
  const F = { sel: new Set(old ? old.members : preselect) }, members = meFirst(activeMembers());
  openSheet({
    title: old ? 'Edit group' : 'New group',
    render(sh) {
      sh.body.innerHTML = html`<p class="lead">A group is a shortcut for things only some of you share, like alcohol. Pick it when you add an expense and only these people split it.</p>
        <div class="f"><label for="gName">Group name</label><input class="in" id="gName" maxlength="30" placeholder="Alcohol" autocomplete="off" enterkeyhint="done"></div>
        <div class="f"><div class="lab">Who’s in it <small id="gSum"></small></div><div class="rows" id="gRows"></div></div>
        <p class="note">Changing a group later doesn’t change expenses that were already added.</p>
        ${old ? html`<div class="f"><button class="link red" type="button" id="gDel">Remove this group</button></div>` : ''}`;
      sh.footer(html`<div class="msg" id="gMsg" role="alert"></div><button class="btn big" type="button" id="gGo">${old ? 'Save group' : 'Make the group'}</button>`);
      const el = k => $('#' + k, sh.el), msg = el('gMsg');
      if (old) el('gName').value = old.name;
      const draw = () => {
        el('gRows').innerHTML = html`${members.map(m => html`<button class="prow" type="button" role="checkbox" aria-checked="${String(F.sel.has(m.id))}" data-id="${m.id}"><span class="tick">${IC.tick}</span><span class="nm">${m.id === S.me ? 'You' : m.name}</span></button>`)}`;
        el('gSum').textContent = F.sel.size ? people(F.sel.size) : 'nobody yet';
      };
      draw();
      el('gRows').onclick = e => { const b = e.target.closest('[data-id]'); if (!b) return; const i = b.dataset.id; if (F.sel.has(i)) F.sel.delete(i); else F.sel.add(i); msg.textContent = ''; draw(); };
      const save = async () => {
        const name = el('gName').value.trim(), ids = members.filter(m => F.sel.has(m.id)).map(m => m.id);
        if (!name) { msg.textContent = 'Give the group a name, like Alcohol.'; el('gName').focus(); return; }
        if (!ids.length) { msg.textContent = 'Pick at least one person.'; return; }
        if (ids.length === members.length && members.length > 1) { msg.textContent = 'That’s everyone, which is the normal split already. Leave out whoever doesn’t share it.'; return; }
        if (liveGroups().some(g => g.id !== id && g.name.toLowerCase() === name.toLowerCase())) { msg.textContent = `There’s already a group called ${name}.`; return; }
        add([{ t: 'group.set', d: { id: id || C.newId('g'), name, members: ids } }]);
        await closeSheets(1); toast(old ? 'Group saved' : `${name} group made`);
        if (onSaved) onSaved(ids);
      };
      el('gGo').onclick = save;
      el('gName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); el('gName').blur(); } });
      if (old) el('gDel').onclick = async () => {
        if (!(await confirmSheet({ title: `Remove the ${old.name} group?`, text: 'Expenses already split with it stay exactly as they are.', yes: 'Remove group', danger: true }))) return;
        add([{ t: 'group.remove', d: { id } }]); await closeSheets(1); toast('Group removed');
      };
      if (!old) el('gName').focus({ preventScroll: true });
    },
  });
}

/* ---------- why: a balance explained in plain words ---------- */
function sheetWhy(id) {
  if (!S.st || !S.st.members.has(id)) return;
  openSheet({
    title: '',
    render(sh) {
      const draw = () => {
        const st = S.st, e = C.explain(st, id), v = voice(id), M = money;
        sh.title(e.net > 0 ? `Why ${v.n} ${v.s('get')} back ${M(e.net)}` : e.net < 0 ? `Why ${v.n} ${v.s('owe')} ${M(-e.net)}` : `Why ${v.n} ${v.s('are')} settled up`);
        /* one line per expense: how this person's part of it was worked out */
        const whole = r => { const x = st.expenses.get(r.id); return x && x.cur !== st.base ? `${origMoney(x)} (${M(r.total)})` : M(r.total); };
        const how = r => (r.mode === 'alone' ? `${whole(r)}, only for ${v.n}`
          : r.mode === 'equal' ? `${whole(r)} shared equally by ${r.tag ? `the ${r.people} people in the ${r.tag} group` : `${r.people} people`}${r.total % r.people ? ', rounded' : ''}`
            : r.mode === 'shares' ? `${whole(r)} cut into ${r.weights} shares. ${v.N} ${v.s('have')} ${r.weight} of them`
              : `${whole(r)} in total. ${v.P} part was typed in by hand`);
        const notIn = [...st.expenses.values()].filter(x => !x.gone && !(id in C.expenseShares(x, st.dec)));
        /* the sum, one small step at a time, always with plain positive numbers */
        const steps = []; let r = e.paidTotal - e.shareTotal;
        steps.push(r > 0 ? { say: `${v.N} paid ${M(e.paidTotal)}. ${v.P} part is ${M(e.shareTotal)}. ${v.N} paid more than ${v.p} part, so the group owes ${v.n} the extra.`, calc: `${M(e.paidTotal)} − ${M(e.shareTotal)} = ${M(r)}` }
          : r < 0 ? { say: `${v.N} paid ${M(e.paidTotal)}. ${v.P} part is ${M(e.shareTotal)}. ${v.P} part is bigger than what ${v.n} paid, so ${v.n} ${v.s('owe')} the group the gap.`, calc: `${M(e.shareTotal)} − ${M(e.paidTotal)} = ${M(-r)}` }
            : { say: `${v.N} paid ${M(e.paidTotal)} and ${v.p} part is ${M(e.shareTotal)}. That’s the same, so ${v.n} ${v.s('are')} even with the group.`, calc: '' });
        if (e.gaveTotal) {
          const names = nameList([...new Set(e.gave.map(g => g.who))]), G = e.gaveTotal, was = r; r += G;
          steps.push(was < 0 ? { say: `${v.N} already gave ${names} ${M(G)}. Take that off what ${v.n} ${v.s('owe')}.${r > 0 ? ` ${v.N} gave more than ${v.n} owed, so now ${v.n} ${v.s('get')} the extra back.` : ''}`, calc: r <= 0 ? `${M(-was)} − ${M(G)} = ${M(-r)}` : `${M(G)} − ${M(-was)} = ${M(r)}` }
            : { say: `${v.N} also gave ${names} ${M(G)}. That is more money out of ${v.p} pocket, so add it to what ${v.n} ${v.s('get')} back.`, calc: `${M(was)} + ${M(G)} = ${M(r)}` });
        }
        if (e.gotTotal) {
          const names = cap(nameList([...new Set(e.got.map(g => g.who))])), R = e.gotTotal, was = r; r -= R;
          steps.push(was > 0 ? { say: `${names} already gave ${v.n} ${M(R)}. Take that off what ${v.n} ${v.s('get')} back.${r < 0 ? ` That is more than ${v.n} ${v.s('were')} owed, so now ${v.n} ${v.s('owe')} the rest.` : ''}`, calc: r >= 0 ? `${M(was)} − ${M(R)} = ${M(r)}` : `${M(R)} − ${M(was)} = ${M(-r)}` }
            : { say: `${names} gave ${v.n} ${M(R)}. ${v.N} ${v.s('have')} to give that back too, so add it to what ${v.n} ${v.s('owe')}.`, calc: `${M(-was)} + ${M(R)} = ${M(-r)}` });
        }
        const plan = C.settleSteps(S.bal.net).filter(p => p.from === id || p.to === id), moved = e.gave.length + e.got.length;
        sh.body.innerHTML = html`<p class="lead">Everyone pays for their own part of the trip. Pay more than your part and you get the extra back. Pay less and you owe the gap.</p>
          <h3 class="h3">1. What ${v.n} paid</h3>
          <div class="paper-in why">${e.paid.length ? e.paid.map(p => html`<button class="x" type="button" data-open="${p.id}"><div class="a"><span>${p.title}</span><b>${M(p.amt)}</b></div></button>`) : html`<p class="note">Nothing so far.</p>`}
            <div class="tot"><span>Paid in total</span><b>${M(e.paidTotal)}</b></div></div>
          <h3 class="h3">2. ${v.P} part of each thing</h3>
          <div class="paper-in why">${e.share.length ? e.share.map(p => html`<button class="x" type="button" data-open="${p.id}"><div class="a"><span>${p.title}</span><b>${M(p.mine)}</b></div><div class="b"><span>${how(p)}</span></div></button>`) : html`<p class="note">Nothing was bought for ${v.n} so far.</p>`}
            <div class="tot"><span>${v.P} part in total</span><b>${M(e.shareTotal)}</b></div></div>
          ${notIn.length ? html`<p class="note">Not counted: ${notIn.slice(0, 4).map(x => x.title).join(', ')}${notIn.length > 4 ? ` and ${notIn.length - 4} more` : ''}. ${v.N} ${v.s('weren’t')} part of ${notIn.length === 1 ? 'it' : 'those'}, so ${v.n} ${v.s('pay')} nothing for ${notIn.length === 1 ? 'it' : 'them'}.</p>` : ''}
          ${moved ? html`<h3 class="h3">3. Money already handed over</h3><div class="paper-in why">
            ${e.gave.map(p => html`<button class="x" type="button" data-pay="${p.id}"><div class="a"><span>${v.N} gave ${whom(p.who)}</span><b>${M(p.amt)}</b></div>${payFor(p) ? html`<div class="b"><span>${payFor(p).slice(2)}</span></div>` : ''}</button>`)}
            ${e.got.map(p => html`<button class="x" type="button" data-pay="${p.id}"><div class="a"><span>${who(p.who)} gave ${v.n}</span><b>${M(p.amt)}</b></div>${payFor(p) ? html`<div class="b"><span>${payFor(p).slice(2)}</span></div>` : ''}</button>`)}</div>` : ''}
          <h3 class="h3">${moved ? 4 : 3}. The sum</h3>
          ${steps.map(t => html`<p class="say">${t.say}</p>${t.calc ? html`<p class="calc">${t.calc}</p>` : ''}`)}
          <p class="concl ${r < 0 ? 'red' : ''}">${r > 0 ? `So ${v.n} ${v.s('get')} back ${M(r)}.` : r < 0 ? `So ${v.n} ${v.s('owe')} ${M(-r)}.` : `So ${v.n} ${v.s('are')} settled up. Nothing to pay, nothing to get back.`}</p>
          ${plan.length ? html`<h3 class="h3">How it gets cleared</h3><div class="paper-in why">${plan.map(p => html`<div class="x"><div class="a"><span>${who(p.from)} ${p.from === S.me ? 'pay' : 'pays'} ${whom(p.to)}</span><b>${M(p.amt)}</b></div></div>`)}</div>
            <button class="link" type="button" data-plan>Why these payments?</button>` : ''}`;
      };
      sh.refresh = draw; draw();
      sh.el.addEventListener('click', e => {
        const x = e.target.closest('[data-open]'), p = e.target.closest('[data-pay]');
        if (x) sheetDetail(x.dataset.open); else if (p) sheetPaymentDetail(p.dataset.pay); else if (e.target.closest('[data-plan]')) sheetWhyPlan();
      });
    },
  });
}
/* How the list of payments under "Settle up" was worked out. */
function sheetWhyPlan() {
  if (!S.st) return;
  openSheet({
    title: 'Why these payments',
    render(sh) {
      const draw = () => {
        const st = S.st, net = S.bal.net, steps = C.settleSteps(net), M = money;
        const ms = [...st.members.values()].filter(m => !m.gone || net[m.id]);
        const up = ms.filter(m => net[m.id] > 0).sort((a, b) => net[b.id] - net[a.id]), down = ms.filter(m => net[m.id] < 0).sort((a, b) => net[a.id] - net[b.id]), even = ms.filter(m => !net[m.id]);
        const gave = {}, got = {};
        for (const p of st.payments.values()) if (!p.gone) { const a = C.baseMinor(p, st.dec); gave[p.from] = (gave[p.from] || 0) + a; got[p.to] = (got[p.to] || 0) + a; }
        const row = (m, word) => html`<button class="x" type="button" data-why="${m.id}"><div class="a"><span>${m.name}${m.id === S.me ? ' (you)' : ''}</span><b class="${net[m.id] < 0 ? 'red' : ''}">${M(Math.abs(net[m.id]))}</b></div>
          <div class="b"><span>paid ${M(S.bal.paid[m.id] || 0)}, part ${M(S.bal.share[m.id] || 0)}${gave[m.id] ? `, already gave ${M(gave[m.id])}` : ''}${got[m.id] ? `, already got ${M(got[m.id])}` : ''}</span><em class="${net[m.id] < 0 ? 'red' : ''}">${word}</em></div></button>`;
        const block = (p, i) => {
          const a = voice(p.from), b = voice(p.to), moreA = p.owed !== -net[p.from], moreB = p.due !== net[p.to];
          return html`<div class="stp"><b>${i + 1}. ${a.N} ${a.s('pay')} ${b.n} ${M(p.amt)}</b>
            <span>${a.N} ${moreA ? 'still ' : ''}${a.s('owe')} ${M(p.owed)}. ${b.N} ${b.s('are')} ${moreB ? 'still ' : ''}owed ${M(p.due)}.
            ${!p.owedAfter && !p.dueAfter ? 'That fits exactly, so both are done.'
              : !p.owedAfter ? `${a.N} ${a.s('pay')} all of it and ${a.s('are')} done. ${b.N} ${b.s('are')} still owed ${M(p.dueAfter)}.`
                : `${b.N} only ${b.s('need')} ${M(p.due)}, so that is what ${a.n} ${a.s('pay')}. ${b.N} ${b.s('are')} done, and ${a.n} still ${a.s('owe')} ${M(p.owedAfter)}.`}</span></div>`;
        };
        sh.body.innerHTML = html`<p class="lead">Everyone has one number: what they paid, take away their own part of the trip.${Object.keys(gave).length ? ' Money already handed over counts too.' : ''} Tap a name to see where it comes from.</p>
          ${up.length ? html`<h3 class="h3">Paid more than their part</h3><div class="paper-in why">${up.map(m => row(m, m.id === S.me ? 'you get back' : 'gets back'))}</div>` : ''}
          ${down.length ? html`<h3 class="h3">Paid less than their part</h3><div class="paper-in why">${down.map(m => row(m, m.id === S.me ? 'you owe' : 'owes'))}</div>` : ''}
          ${even.length && steps.length ? html`<p class="note">${cap(nameList(even.map(m => m.id)))} ${even.length > 1 || even[0].id === S.me ? 'are' : 'is'} even already.</p>` : ''}
          ${steps.length ? html`<p class="say">Both sides add up to the same amount, ${M(up.reduce((t, m) => t + net[m.id], 0))}. So the people who owe pay the people who are owed, and nothing is left over.</p>
            <h3 class="h3">Who pays who</h3>
            <p class="say">Whoever owes the most pays whoever is owed the most. Then the same again with the people who are left, until nobody owes anything.</p>
            ${steps.map(block)}
            <p class="concl">After ${steps.length === 1 ? 'that one payment' : `those ${steps.length} payments`}, everyone is even.</p>
            <p class="note">Nobody pays back each expense one by one. Only the totals count, which keeps the number of payments small.</p>`
            : html`<p class="concl">Nobody owes anything right now.</p>`}`;
      };
      sh.refresh = draw; draw();
      sh.el.addEventListener('click', e => { const b = e.target.closest('[data-why]'); if (b) sheetWhy(b.dataset.why); });
    },
  });
}

/* ---------- every receipt photo in one place ---------- */
function sheetReceipts() {
  openSheet({
    title: 'Receipt photos',
    render(sh) {
      let sig = '';
      const draw = () => {
        const st = S.st, dateOf = x => x.date || C.localDate(new Date(x.at));
        const xs = [...st.expenses.values()].filter(x => !x.gone).sort((a, b) => (dateOf(a) < dateOf(b) ? 1 : dateOf(a) > dateOf(b) ? -1 : b.at - a.at));
        const have = xs.filter(x => x.rc.length), none = xs.filter(x => !x.rc.length), pays = [...st.payments.values()].filter(p => !p.gone && p.rc.length).sort((a, b) => b.at - a.at);
        const now = JSON.stringify([have.map(x => [x.id, x.title, x.amt, x.rc]), none.map(x => [x.id, x.title, x.amt]), pays.map(p => [p.id, p.rc]), S.me]);
        if (now === sig) return; sig = now;                    // nothing here changed: keep the loaded pictures on screen
        const thumbs = rc => html`<div class="photos">${rc.map((rid, i) => html`<button class="ph load" type="button" data-rid="${rid}" aria-label="Open photo ${i + 1}">Photo ${i + 1}</button>`)}</div>`;
        sh.body.innerHTML = html`<p class="lead">${!xs.length ? 'No expenses yet.' : have.length === xs.length ? `All ${xs.length === 1 ? 'of the 1 expense has' : xs.length + ' expenses have'} a photo.` : `${have.length} of ${xs.length} ${xs.length === 1 ? 'expense has' : 'expenses have'} a photo.`}
            ${xs.length ? 'Adding or removing a photo always shows on the log.' : ''}</p>
          ${have.map(x => html`<div class="rcp"><button class="t" type="button" data-open="${x.id}"><span>${x.title}</span><b>${origMoney(x)}</b></button><small>${who(x.payer)} paid, ${niceDate(dateOf(x))}</small>${thumbs(x.rc)}</div>`)}
          ${pays.length ? html`<h3 class="h3">Proof of payments</h3>${pays.map(p => html`<div class="rcp"><button class="t" type="button" data-pay="${p.id}"><span>${who(p.from)} paid ${whom(p.to)}</span><b>${origMoney(p)}</b></button>${payFor(p) ? html`<small>${payFor(p).slice(2)}</small>` : ''}${thumbs(p.rc)}</div>`)}` : ''}
          ${none.length ? html`<h3 class="h3">No photo yet</h3><div class="list">${none.map(x => html`<button class="li" type="button" data-open="${x.id}"><span class="grow">${x.title}<small>${who(x.payer)} paid, ${niceDate(dateOf(x))}</small></span><span class="go">${origMoney(x)}</span></button>`)}</div>
            <p class="note">Open one to add its photo.</p>` : ''}`;
        loadThumbs(sh.el);
      };
      sh.refresh = draw; draw();
      sh.el.addEventListener('click', e => {
        const rid = e.target.closest('[data-rid]'), x = e.target.closest('[data-open]'), p = e.target.closest('[data-pay]');
        if (rid) sheetPhoto(rid.dataset.rid); else if (x) sheetDetail(x.dataset.open); else if (p) sheetPaymentDetail(p.dataset.pay);
      });
    },
  });
}
/* Fills in the little pictures for every photo button inside el. */
function loadThumbs(el) {
  for (const b of $$('[data-rid]', el)) S.trip.photo(b.dataset.rid).then(r => {
    if (!b.isConnected) return;
    if (r.img) { b.classList.remove('load'); b.innerHTML = html`<img src="${r.img}" alt="">`; } else b.textContent = r.changed ? 'Changed' : 'Not uploaded yet';
  }, () => {});
}

/* ---------- a small sheet for changing one piece of text ---------- */
function sheetText({ title, label, value = '', max = 80, long = false, placeholder = '', optional = false, button = 'Save', save }) {
  openSheet({
    title,
    render(sh) {
      sh.body.innerHTML = html`<form id="tf" novalidate><div class="f"><label for="tIn">${label}${optional ? html` <small>optional</small>` : ''}</label>
        ${long ? html`<textarea class="in" id="tIn" maxlength="${max}" placeholder="${placeholder}" rows="3"></textarea>` : html`<input class="in" id="tIn" maxlength="${max}" placeholder="${placeholder}" autocomplete="off" enterkeyhint="done">`}</div></form>`;
      sh.footer(html`<div class="msg" id="tMsg2" role="alert"></div><button class="btn big" form="tf">${button}</button>`);
      const input = $('#tIn', sh.el); input.value = value;
      $('#tf', sh.el).onsubmit = e => {
        e.preventDefault();
        const v = input.value.trim();
        if (!v && !optional) { $('#tMsg2', sh.el).textContent = 'Type something first.'; input.focus(); return; }
        sh.close(); if (v !== value.trim()) save(v);
      };
      input.focus({ preventScroll: true }); if (!long) input.select();
    },
  });
}
function renameTrip() {
  if (!needMe()) return;
  sheetText({ title: 'Rename the trip', label: 'Trip name', value: S.st.name, max: 60, save: name => { add([{ t: 'trip.rename', d: { name } }]); toast('Trip renamed'); } });
}

/* ---------- one expense ---------- */
function sheetDetail(id) {
  if (!S.st.expenses.has(id)) return;
  openSheet({
    title: 'Expense',
    render(sh) {
      const draw = () => {
        const st = S.st, x = st.expenses.get(id); if (!x) return;
        const base = C.baseMinor(x, st.dec), ps = C.partStatus(st, x), ctx = logContext(), me = S.me, can = !x.gone && !!me;
        const mine = ps.rows.find(r => r.id === me && !r.payer), others = ps.rows.filter(r => !r.payer && r.part > 0).length;
        sh.title(x.gone ? 'Deleted expense' : 'Expense');
        /* one person's line: their part, anything they already paid towards it, and what is left */
        const row = r => {
          const v = voice(r.id);
          const state = r.payer ? html`<em class="dim">paid the bill</em>`
            : r.over ? html`<em>paid ${money(r.over)} extra</em>` : r.left ? html`<em class="red">${r.paid ? `${money(r.left)} left` : `${v.s('owe')} ${money(r.left)}`}</em>` : r.part || r.paid ? html`<em>paid in full</em>` : '';
          return html`<div class="pt"><div class="a"><span>${r.id === me ? 'You' : nameOf(r.id)}</span><b>${money(r.part)}</b></div>
            ${r.pays.map(p => html`<button class="pp" type="button" data-pay="${p.id}" ${can ? '' : raw('disabled')}><span>paid ${origMoney(p)}${p.via ? ' ' + viaSay(p.via) : ''}${p.rc.length ? IC.clip : ''}</span><small>${niceDate(p.date || C.localDate(new Date(p.at)))}${can ? ', change' : ''}</small></button>`)}
            <div class="b">${state}${can && !r.payer && r.left ? html`<button class="link" type="button" data-part="${r.id}">${r.paid ? 'Add a payment' : 'Mark as paid'}</button>` : ''}</div></div>`;
        };
        sh.body.innerHTML = html`<div class="xhead">
            ${can ? html`<button class="xtitle" type="button" data-do="rename"><span>${x.title}</span><i>Rename</i></button>` : html`<div class="xtitle"><span class="${x.gone ? 'struck' : ''}">${x.title}</span></div>`}
            ${x.note ? html`<p class="xnote">${x.note}${can ? html` <button class="link" type="button" data-do="note">Change</button>` : ''}</p>` : can ? html`<button class="link xadd" type="button" data-do="note">Add what it was about</button>` : ''}
            <div class="bigamt ${x.gone ? 'struck' : ''}">${origMoney(x)}</div>
            ${x.cur !== st.base ? html`<div class="dim">${money(base)} at ${rateText(x.cur, st.base, x.rate)}${x.rsrc === 'manual' ? ' (typed in)' : ''}</div>` : ''}
            <p class="xby">${who(x.payer)} paid, ${niceDate(x.date)}</p>
            ${x.gone ? html`<div class="stampd">Deleted by ${whom(x.goneBy)}</div>` : ''}
            ${x.rc.length || can ? html`<div class="photos">${x.rc.map((rid, i) => html`<button class="ph load" type="button" data-rid="${rid}" aria-label="Open receipt photo ${i + 1}">Photo ${i + 1}</button>`)}
              ${can && x.rc.length < 4 ? html`<button class="btn line small" type="button" data-do="photo">${IC.cam}${x.rc.length ? 'Add another' : 'Add a receipt photo'}</button>` : ''}</div>` : ''}
          </div>
          <h3 class="h3">Everyone’s part${x.tag ? html` <small>the ${x.tag} group</small>` : ''}</h3>
          ${can && others ? html`<p class="note pthint">${x.payer === me ? 'Has someone already paid you their part? Mark it beside their name.' : 'Already paid some of it? Mark it here and it comes off what is owed.'}</p>` : ''}
          <div class="parts">${ps.rows.map(row)}</div>
          ${others && ps.got ? html`<div class="tot"><span>${ps.left ? `Still to come back to ${whom(x.payer)}` : `All paid back to ${whom(x.payer)}`}</span><b>${ps.left ? money(ps.left) : ''}</b></div>` : ''}
          <h3 class="h3">History</h3><div class="paper-in">${st.log.filter(l => !l.merged && (l.ref === id || (l.snap && l.snap.x === id && l.t.startsWith('pay.')))).map(l => logLine(l, ctx, true))}</div>
          <p class="note">Added by ${whom(x.by)}, ${stampText(x.at)}.</p>`;
        sh.footer(x.gone ? html`<button class="btn big" type="button" data-do="restore">Bring it back</button>`
          : html`${can && mine && mine.left ? html`<button class="btn big" type="button" data-part="${me}">I’ve paid my part</button>` : ''}
            <div class="acts"><button class="btn line" type="button" data-do="delete">Delete</button><button class="btn ${can && mine && mine.left ? 'line' : ''}" type="button" data-do="edit">Edit</button></div>`);
        loadThumbs(sh.el);
      };
      sh.refresh = draw; draw();
      /* a photo added straight from here is saved as an edit, so it shows on the log like any other change */
      const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true; sh.el.appendChild(file);
      file.onchange = async () => {
        const f = file.files[0]; file.value = ''; if (!f || !S.me) return;
        toast('Adding the photo…');
        try {
          const rid = await S.trip.addPhoto(await shrinkPhoto(f)), x = S.st.expenses.get(id);
          if (!x || x.gone || x.rc.length >= 4) return;
          if (x.rc.includes(rid)) { toast('That photo is already there'); return; }
          add([{ t: 'expense.edit', d: { id, set: { rc: [...x.rc, rid] } } }]); toast('Receipt photo added');
        } catch (_) { toast('That photo couldn’t be added. Try another one.'); }
      };
      sh.el.addEventListener('click', async e => {
        const rid = e.target.closest('[data-rid]'), act = e.target.closest('[data-do]'), part = e.target.closest('[data-part]'), paid = e.target.closest('[data-pay]');
        if (rid) return sheetPhoto(rid.dataset.rid);
        if (!(act || part || paid) || !needMe()) return;
        const x = S.st.expenses.get(id), a = act ? act.dataset.do : '';
        if (part) sheetPayment({ x: id, from: part.dataset.part });
        else if (paid) sheetPayment({ edit: paid.dataset.pay });
        else if (a === 'photo') file.click();
        else if (a === 'rename') sheetText({ title: 'Rename', label: 'What was it for', value: x.title, max: 80, save: title => { add([{ t: 'expense.edit', d: { id, set: { title } } }]); toast('Renamed'); } });
        else if (a === 'note') sheetText({ title: 'What was it about?', label: 'A few words', value: x.note, max: 300, long: true, optional: true, placeholder: 'Three nights, the whole flat…', save: note => { add([{ t: 'expense.edit', d: { id, set: { note } } }]); toast('Saved'); } });
        else if (a === 'edit') { if (await unlocked('Changing an expense')) sheetExpense(id); }
        else if (a === 'restore') { if (await unlocked('Bringing an expense back')) { add([{ t: 'expense.restore', d: { id } }]); toast('Expense brought back'); } }
        else if (a === 'delete' && await unlocked('Deleting an expense')) {
          const linked = C.partStatus(S.st, x).rows.reduce((t, r) => t + r.pays.length, 0);
          if (!(await confirmSheet({ title: 'Delete this expense?', text: `“${x.title}” comes off the balances. It stays in the log, crossed out, and can be brought back.${linked ? ` The ${linked === 1 ? 'payment' : linked + ' payments'} already marked for it still count, because that money did change hands.` : ''}`, yes: 'Delete expense', danger: true }))) return;
          add([{ t: 'expense.delete', d: { id } }]);
          await closeSheets(sheets.length);
          toast('Expense deleted', { label: 'Undo', run: () => add([{ t: 'expense.restore', d: { id } }]) });
        }
      });
    },
  });
}

/* ---------- payments between people ---------- */
/* One form for three things: a payment between two people, someone's part of one expense ({ x, from }), and changing
   a payment that is already there ({ edit }). */
function sheetPayment(o = {}) {
  const st = S.st, members = meFirst(activeMembers());
  const old = o.edit ? st.payments.get(o.edit) : null;
  if (o.edit && (!old || old.gone)) return;
  const x = (old ? old.x : o.x) ? st.expenses.get(old ? old.x : o.x) : null;                // the expense it is for, if any
  const fixed = !!x && (!!old || !!o.from);                                                 // who pays whom is already known
  const F = old ? { cur: old.cur, from: old.from, to: old.to, date: old.date || C.localDate(new Date(old.at)), rate: { rate: old.rate, src: old.rsrc, date: '', mkt: 0 }, manual: old.rsrc === 'manual', inv: old.rate < 1, loading: false,
    photos: old.rc.map(rid => ({ rid })), via: old.via }
    : { cur: st.base, from: o.from || S.me, to: x ? x.payer : o.to || null, date: C.localDate(), rate: { rate: 1, src: 'same', date: '', mkt: 0 }, manual: false, inv: true, loading: false, photos: [], via: '' };
  let other = !!F.via && !VIA.some(([k]) => k === F.via);                                    // a way of paying that isn't one of the buttons
  const part = () => (x ? C.partStatus(S.st, x).rows.find(r => r.id === F.from) : null);
  const v = voice(F.from);
  openSheet({
    title: fixed ? `${F.from === S.me ? 'Your' : nameOf(F.from) + '’s'} part of ${x.title}` : old ? 'Change the payment' : 'Record a payment',
    render(sh) {
      const p0 = part(), was = old && x ? C.baseMinor(old, st.dec) : 0;                      // when changing a payment, its own amount doesn't count as "already paid"
      sh.body.innerHTML = html`<form id="pf" novalidate>
        ${fixed ? html`<p class="lead">${F.from === S.me ? `Already paid ${whom(F.to)} for this? Put in how much.` : `Did ${v.n} already pay ${whom(F.to)} for this? Put in how much.`} It comes off what ${v.n} ${v.s('owe')}.</p>
          ${p0 ? html`<div class="dl"><div><span>${v.P} part</span><span>${money(p0.part)}</span></div>${p0.paid - was > 0 ? html`<div><span>Already paid</span><span>${money(p0.paid - was)}</span></div><div><span>Left</span><span>${money(Math.max(0, p0.part - p0.paid + was))}</span></div>` : ''}</div>` : ''}`
          : html`<p class="lead">Someone paid a friend back, in cash or by transfer. This clears it from the balances.</p>
        <div class="f"><div class="lab">Who paid</div><div class="pick" role="radiogroup" aria-label="Who paid" id="pFrom"></div></div>
        <div class="f"><div class="lab">Who got the money</div><div class="pick" role="radiogroup" aria-label="Who got the money" id="pTo"></div></div>`}
        <div class="f"><label for="pa">${fixed ? 'Amount paid' : 'Amount'}</label><div class="amount"><input id="pa" inputmode="decimal" autocomplete="off" placeholder="0"><button class="cur" type="button" id="pc"></button></div><div class="fx" id="pfx" aria-live="polite"></div>
          <p class="note" id="pOver" hidden></p></div>
        <div class="f"><div class="lab">How <small>optional</small></div><div class="pick" role="radiogroup" aria-label="How it was paid" id="pVia"></div>
          <input class="in" id="pViaText" maxlength="30" placeholder="Revolut, Wise, a round of drinks…" autocomplete="off" aria-label="How it was paid" hidden style="margin-top:10px"></div>
        <div class="f"><label for="pd">When</label><input class="in" type="date" id="pd" max="2100-12-31"></div>
        <div class="f"><div class="lab">Proof <small>optional</small></div><div class="photos" id="pph"></div><input type="file" accept="image/*" id="pfile" hidden></div>
        ${old ? html`<div class="f"><button class="link red" type="button" id="pDel">Remove this payment</button></div>` : ''}</form>`;
      sh.footer(html`<div class="msg" id="pmsg" role="alert"></div><button class="btn big" form="pf">${old ? 'Save changes' : fixed ? 'Mark as paid' : 'Record payment'}</button>`);
      const el = k => $('#' + k, sh.el), msg = el('pmsg');
      photoStrip(sh, el('pph'), el('pfile'), F.photos, { first: 'Add a photo or screenshot', onError: () => { msg.textContent = 'That photo couldn’t be added. Try another one.'; } });
      if (old) el('pa').value = String(old.amt);
      else if (o.amt) el('pa').value = String(C.fromMinor(o.amt, st.dec));
      else if (fixed && p0 && p0.left) el('pa').value = String(C.fromMinor(p0.left, st.dec));
      el('pd').value = F.date;
      if (other) { el('pViaText').hidden = false; el('pViaText').value = F.via; }
      const draw = () => {
        if (!fixed) {
          const chips = (sel, skip) => html`${members.filter(m => m.id !== skip).map(m => html`<button class="chip" type="button" role="radio" aria-checked="${String(sel === m.id)}" data-id="${m.id}"><span>${m.id === S.me ? 'You' : m.name}</span></button>`)}`;
          el('pFrom').innerHTML = chips(F.from, null); el('pTo').innerHTML = chips(F.to, F.from);
        }
        el('pVia').innerHTML = html`${VIA.map(([k, t]) => html`<button class="chip" type="button" role="radio" aria-checked="${String(!other && F.via === k)}" data-via="${k}"><span>${t}</span></button>`)}<button class="chip" type="button" role="radio" aria-checked="${String(other)}" data-via="other"><span>Other</span></button>`;
      };
      /* paying more than the part is fine; say what happens to the extra */
      const over = () => {
        const p = part(), a = box.amount(), note = el('pOver');
        const extra = fixed && p && a && F.rate && F.rate.rate > 0 ? C.baseMinor({ amt: a, cd: C.curDecimals(F.cur), rate: F.rate.rate }, st.dec) - Math.max(0, p.part - p.paid + was) : 0;
        note.hidden = !(extra > 0); if (extra > 0) note.textContent = `That is ${money(extra)} more than what is left of the part. It still counts: the extra comes off the rest of what ${v.n} ${v.s('owe')}.`;
      };
      const box = moneyBox(F, sh, { amt: '#pa', cur: '#pc', fx: '#pfx' }, { onChange: () => { msg.textContent = ''; over(); } });
      draw(); box.draw(); over();
      if (!fixed) {
        el('pFrom').onclick = e => { const b = e.target.closest('[data-id]'); if (b) { F.from = b.dataset.id; if (F.to === F.from) F.to = null; draw(); } };
        el('pTo').onclick = e => { const b = e.target.closest('[data-id]'); if (b) { F.to = b.dataset.id; draw(); } };
      }
      el('pVia').onclick = e => {
        const b = e.target.closest('[data-via]'); if (!b) return;
        const k = b.dataset.via;
        if (k === 'other') { other = !other; F.via = other ? el('pViaText').value.trim() : ''; }
        else { F.via = !other && F.via === k ? '' : k; other = false; }                       // a second tap takes the choice back
        el('pViaText').hidden = !other; draw(); if (other) el('pViaText').focus();
      };
      el('pViaText').oninput = () => { if (other) F.via = el('pViaText').value.trim(); };
      el('pd').onchange = () => { F.date = el('pd').value || C.localDate(); };
      if (old) el('pDel').onclick = async () => {
        if (!(await confirmSheet({ title: 'Remove this payment?', text: `${nameOf(old.from)} will owe that money again. The log keeps a record that it was removed.`, yes: 'Remove payment', danger: true }))) return;
        add([{ t: 'pay.delete', d: { id: old.id } }]);
        await closeSheets(1); toast('Payment removed');
      };
      el('pf').onsubmit = async e => {
        e.preventDefault();
        const amt = box.amount();
        if (!F.from || !F.to) { msg.textContent = 'Pick who paid and who got the money.'; return; }
        if (!amt) { msg.textContent = 'Type the amount.'; el('pa').focus(); return; }
        if (other && !F.via) { msg.textContent = 'Type how it was paid, or pick one of the buttons.'; el('pViaText').focus(); return; }
        if (F.photos.some(p => !p.rid)) { msg.textContent = 'The photo is still being added. One moment.'; return; }
        if (F.loading) { msg.textContent = 'Still getting the exchange rate. One moment.'; return; }
        if (!F.rate || !(F.rate.rate > 0)) { msg.textContent = 'Type an exchange rate.'; return; }
        const r = rateFields(F);
        const d = { id: C.newId('p'), from: F.from, to: F.to, amt, cur: F.cur, cd: C.curDecimals(F.cur), rate: r.rate, rsrc: r.rsrc, date: F.date, rc: F.photos.map(p => p.rid), ...(x ? { x: x.id } : {}), ...(F.via ? { via: F.via } : {}) };
        if (old) {
          const same = old.from === d.from && old.to === d.to && old.amt === d.amt && old.cur === d.cur && Math.abs(old.rate - d.rate) < 1e-12 && (old.date || '') === d.date && (old.via || '') === (d.via || '') && JSON.stringify(old.rc) === JSON.stringify(d.rc);
          /* an edit is two entries every version of the app understands: the old payment comes off, the new one goes on */
          if (!same) add([{ t: 'pay.delete', d: { id: old.id } }, { t: 'pay.add', d: { ...d, re: old.id } }]);
          await closeSheets(1); if (!same) toast('Payment changed');
          return;
        }
        add([{ t: 'pay.add', d }]);
        await closeSheets(1);
        stamp('Paid'); toast(fixed ? 'Marked as paid' : 'Payment recorded');
      };
      if (!old && !o.amt && !(fixed && p0 && p0.left)) el('pa').focus({ preventScroll: true });
    },
  });
}
function sheetPaymentDetail(id) {
  if (!S.st.payments.get(id)) return;
  openSheet({
    title: 'Payment',
    render(sh) {
      let seen = '';
      const draw = () => {
        const st = S.st;
        let p = st.payments.get(id);
        while (p && p.gone && p.next && st.payments.get(p.next)) { id = p.next; p = st.payments.get(id); }      // it was changed: follow it to the new version
        if (!p) return;
        const x = p.x ? st.expenses.get(p.x) : null, sig = JSON.stringify([p.id, p.gone, p.amt, p.cur, p.from, p.to, p.date, p.via, p.rc, x && x.title, S.me]);
        if (sig === seen) return; seen = sig;
        sh.body.innerHTML = html`<div class="bigamt ${p.gone ? 'struck' : ''}">${origMoney(p)}</div>${p.cur !== st.base ? html`<div class="dim">${money(C.baseMinor(p, st.dec))} at ${rateText(p.cur, st.base, p.rate)}</div>` : ''}
          ${p.gone ? html`<div class="stampd">Removed by ${whom(p.goneBy)}</div>` : ''}
          <div class="dl"><div><span>From</span><span>${nameOf(p.from)}</span></div><div><span>To</span><span>${nameOf(p.to)}</span></div>
          ${x ? html`<div><span>For</span><span><button class="link inl" type="button" data-x="${x.id}">${x.title}</button></span></div>` : ''}
          ${p.via ? html`<div><span>How</span><span>${cap(p.via)}</span></div>` : ''}
          <div><span>When</span><span>${niceDate(p.date || C.localDate(new Date(p.at)))}</span></div>
          <div><span>Recorded by</span><span>${nameOf(p.first ? p.first.by : p.by)}, ${stampText(p.first ? p.first.at : p.at)}</span></div>
          ${p.first ? html`<div><span>Last changed by</span><span>${nameOf(p.by)}, ${stampText(p.at)}</span></div>` : ''}</div>
          ${p.rc.length ? html`<h3 class="h3">Proof</h3><div class="photos">${p.rc.map((rid, i) => html`<button class="ph load" type="button" data-rid="${rid}" aria-label="Open proof photo ${i + 1}">Photo ${i + 1}</button>`)}</div>` : html`<p class="note">No proof photo was added with this payment.</p>`}`;
        loadThumbs(sh.el);
        if (p.gone) sh.foot.hidden = true;
        else sh.footer(html`<div class="acts"><button class="btn line" type="button" id="pdel">Delete</button><button class="btn" type="button" id="pedit">Change</button></div>`);
      };
      sh.refresh = draw; draw();
      sh.el.addEventListener('click', async e => {
        const b = e.target.closest('[data-rid]'), x = e.target.closest('[data-x]');
        if (b) return sheetPhoto(b.dataset.rid);
        if (x) return sheetDetail(x.dataset.x);
        if (e.target.closest('#pedit')) { if (needMe()) sheetPayment({ edit: id }); return; }
        if (!e.target.closest('#pdel') || !needMe()) return;
        const p = S.st.payments.get(id);
        if (!(await confirmSheet({ title: 'Delete this payment?', text: `${nameOf(p.from)} will owe that money again. The log keeps a record that it was deleted.`, yes: 'Delete payment', danger: true }))) return;
        add([{ t: 'pay.delete', d: { id } }]);
        await closeSheets(sheets.length); toast('Payment deleted');
      });
    },
  });
}

/* ---------- the final bill ---------- */
async function copyText(text, done) {
  try { await navigator.clipboard.writeText(text); toast(done); }
  catch (_) { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); toast(done); } catch (e) { toast('Couldn’t copy it on this phone'); } t.remove(); }
}
/* The bill as plain text, for the group chat. Names, never "you". */
function finalText() {
  const st = S.st, me = S.me; S.me = null;
  try {
    const f = C.summary(st), M = v => money(v).replace(/[  ]/g, ' '), L = [];
    L.push(`${st.name}: ${st.final ? 'final bill' : 'where things stand'}`, `Trip total ${M(f.total)}, ${f.count === 1 ? '1 expense' : f.count + ' expenses'}`, '');
    if (f.plan.length) { L.push('Still to pay:'); for (const p of f.plan) L.push(`- ${nameOf(p.from)} pays ${nameOf(p.to)} ${M(p.amt)}`); } else L.push('Everyone is settled up.');
    L.push('', 'Everyone:');
    for (const p of f.people) L.push(`- ${nameOf(p.id)}: paid ${M(p.paid)}, part ${M(p.share)}${p.gave ? `, gave ${M(p.gave)}` : ''}${p.got ? `, got ${M(p.got)}` : ''}. ${p.net > 0 ? `Still gets ${M(p.net)}` : p.net < 0 ? `Still owes ${M(-p.net)}` : 'Settled up'}.`);
    L.push('', 'Every expense and receipt: ' + inviteUrl(S.code));
    return L.join('\n');
  } finally { S.me = me; }
}
function sheetFinal() {
  if (!S.st) return;
  openSheet({
    title: '',
    render(sh) {
      const draw = () => {
        const st = S.st, f = C.summary(st), M = money, fin = st.final, me = S.me;
        sh.title(fin ? 'Final bill' : 'Finalize trip');
        const pct = f.owedAtStart ? Math.round(100 * f.paidBack / f.owedAtStart) : 100;
        const mine = p => p.from === me || p.to === me, plan = f.plan.slice().sort((p, q) => mine(q) - mine(p) || q.amt - p.amt);
        const rank = p => (p.net < 0 ? 0 : p.net > 0 ? 1 : 2), folk = f.people.slice().sort((p, q) => rank(p) - rank(q) || Math.abs(q.net) - Math.abs(p.net));
        const pays = [...st.payments.values()].filter(p => !p.gone).sort((a, b) => b.at - a.at);
        sh.body.innerHTML = html`${fin ? html`<div class="stampd">Finalized by ${whom(fin.by)}, ${stampText(fin.at)}</div>`
            : html`<p class="lead">Check it over. Finalizing tells everyone this is the bill and closes the trip to new expenses. It can be reopened if something was missed.</p>`}
          <div class="bigamt">${M(f.total)}</div><div class="dim">trip total, ${f.count === 1 ? '1 expense' : f.count + ' expenses'}, ${people(f.people.length)}</div>
          <h3 class="h3">How it’s going</h3>
          ${f.owedAtStart ? html`<div class="meter" role="img" aria-label="${pct} percent paid back"><i style="width:${pct}%"></i></div>
            <p class="say">${f.owedNow ? html`<b>${M(f.paidBack)}</b> of ${M(f.owedAtStart)} has been paid back. <b>${M(f.owedNow)}</b> to go.` : html`All <b>${M(f.owedAtStart)}</b> has been paid back.`}</p>
            <p class="note">${f.settled} of ${people(f.people.length)} ${f.settled === 1 ? 'is' : 'are'} settled up.</p>` : html`<p class="say">Nobody owes anything.</p>`}
          <h3 class="h3">${plan.length ? 'Still to pay' : 'Nothing left to pay'}</h3>
          ${plan.length ? html`<div class="paper-in fpay">${plan.map(p => html`<div class="pay ${mine(p) ? 'mine' : ''}"><div class="t">${who(p.from)} ${p.from === me ? 'pay' : 'pays'} ${whom(p.to)}</div><span class="pa"><b class="${p.from === me ? 'red' : ''}">${M(p.amt)}</b>
            ${me ? html`<button class="btn small ${mine(p) ? '' : 'line'}" type="button" data-settle data-from="${p.from}" data-to="${p.to}" data-amt="${p.amt}">Mark paid</button>` : ''}</span></div>`)}</div>` : html`<p class="note">Everyone is settled up.</p>`}
          <h3 class="h3">Everyone</h3>
          <div class="paper-in why">${folk.map(p => html`<button class="x" type="button" data-why="${p.id}"><div class="a"><span>${nameOf(p.id)}${p.id === me ? ' (you)' : ''}</span><b class="${p.net < 0 ? 'red' : ''}">${p.net ? M(Math.abs(p.net)) : ''}</b></div>
            <div class="b"><span>paid ${M(p.paid)}, part ${M(p.share)}${p.gave ? `, gave ${M(p.gave)}` : ''}${p.got ? `, got ${M(p.got)}` : ''}</span><em class="${p.net < 0 ? 'red' : p.net ? '' : 'dim'}">${p.net > 0 ? 'still gets' : p.net < 0 ? 'still owes' : 'settled up'}</em></div></button>`)}</div>
          ${pays.length ? html`<h3 class="h3">Paid so far</h3><div class="paper-in why">${pays.map(p => html`<button class="x" type="button" data-pay="${p.id}"><div class="a"><span>${who(p.from)} paid ${whom(p.to)}</span><b>${p.rc.length ? IC.clip : ''} ${origMoney(p)}</b></div>
            <div class="b"><span>${niceDate(p.date || C.localDate(new Date(p.at)))}${payFor(p)}</span></div></button>`)}</div>` : ''}
          ${fin && me ? html`<button class="link red" type="button" data-do="reopen" style="margin-top:18px">Reopen the trip</button>` : ''}`;
        sh.footer(fin ? html`<button class="btn big" type="button" data-do="share">${navigator.share ? 'Share the final bill' : 'Copy the final bill'}</button>`
          : html`<button class="btn big" type="button" data-do="finalize">Finalize trip</button>`);
      };
      sh.refresh = draw; draw();
      sh.el.addEventListener('click', async e => {
        const why = e.target.closest('[data-why]'), pay = e.target.closest('[data-pay]'), set = e.target.closest('[data-settle]'), act = e.target.closest('[data-do]');
        if (why) return sheetWhy(why.dataset.why);
        if (pay) return sheetPaymentDetail(pay.dataset.pay);
        if (set) { if (needMe()) sheetPayment({ from: set.dataset.from, to: set.dataset.to, amt: +set.dataset.amt }); return; }
        if (!act) return;
        const a = act.dataset.do;
        if (a === 'share') {
          const text = finalText();
          if (navigator.share) { try { await navigator.share({ title: S.st.name, text }); } catch (err) { if (err && err.name !== 'AbortError') copyText(text, 'Final bill copied'); } } else copyText(text, 'Final bill copied');
        } else if (!needMe()) return;
        else if (a === 'finalize') { add([{ t: 'trip.final', d: { on: true } }]); stamp('Final'); toast('Trip finalized'); sh.body.scrollTop = 0; }
        else if (a === 'reopen' && await confirmSheet({ title: 'Reopen the trip?', text: 'Expenses can be added and changed again. Everyone sees on the log that it was reopened, and it can be finalized again afterwards.', yes: 'Reopen the trip' })) {
          add([{ t: 'trip.final', d: { on: false } }]); toast('Trip reopened');
        }
      });
    },
  });
}

/* ---------- trip settings, people, invite ---------- */
function sheetTrip() {
  openSheet({
    title: 'This trip',
    render(sh) {
      const typing = () => ['tNew', 'tName'].includes(document.activeElement && document.activeElement.id);
      const draw = () => {
        const st = S.st, joined = new Set(st.log.filter(l => l.t === 'claim').map(l => l.ref)), keepName = document.activeElement && document.activeElement.id === 'tName' ? document.activeElement.value : null;
        const acct = myAccount(), must = st.signin === 'google', groups = liveGroups();
        const photos = [...st.expenses.values()].filter(x => !x.gone && x.rc.length).length, live = [...st.expenses.values()].filter(x => !x.gone).length;
        const status = m => { const a = firstAcct(m); return a ? `signed in with Google as ${acctText(a)}` : joined.has(m.id) ? (S.google ? 'joined, not signed in' : 'joined') : 'hasn’t opened the trip yet'; };
        $('#tA', sh.el).innerHTML = html`<div class="f"><label for="tName">Trip name</label><div class="addrow" style="margin-top:0"><input class="in" id="tName" maxlength="60" value="${keepName == null ? st.name : keepName}" enterkeyhint="done"><button class="btn line" type="button" id="tSave">Save</button></div></div>
          <div class="f"><div class="lab">People <small>tap a name to change it</small></div><div class="list">${activeMembers().map(m => html`<button class="li" type="button" data-person="${m.id}"><span class="grow">${m.name}${m.id === S.me ? ' (you)' : ''}${firstAcct(m) ? IC.ver : ''}<small>${status(m)}</small></span><span class="go">Edit</span></button>`)}</div>
            <div class="addrow"><input class="in" id="tNew" maxlength="40" placeholder="Add a person" autocomplete="off" enterkeyhint="done"><button class="btn line" type="button" id="tAdd">Add</button></div></div>
          <div class="f"><div class="lab">Groups <small>for things only some of you share</small></div>
            ${groups.length ? html`<div class="list">${groups.map(g => html`<button class="li" type="button" data-group="${g.id}"><span class="grow">${g.name}<small>${g.members.length ? nameList(g.members) : 'nobody in it'}</small></span><span class="go">Edit</span></button>`)}</div>` : ''}
            <button class="btn line small" type="button" data-do="group" style="margin-top:${groups.length ? 12 : 0}px">New group</button>
            ${groups.length ? '' : html`<p class="note">Example: an Alcohol group with only the people who drink. Pick it when adding an expense and the others pay nothing for it.</p>`}</div>
          ${S.google ? html`<div class="f"><div class="lab">Signing in</div>
            ${acct ? html`<p class="note ok" style="padding-top:0">${acctLine(acct)}. This phone stays signed in.</p><button class="link" type="button" data-do="signout">Sign out</button>`
              : inAppBrowser ? html`<p class="note" style="padding-top:0">Google doesn’t sign in inside this app’s browser. Open this page in Safari or Chrome to sign in.</p>`
                : html`<button class="btn line" type="button" data-do="signin" ${store.account() ? '' : raw('disabled')}>Continue with Google</button><p class="note">So friends know it’s really you. One tap, and this phone stays signed in.</p>`}
            ${acct || must ? html`<button class="prow" type="button" role="checkbox" aria-checked="${String(must)}" data-do="policy"><span class="tick">${IC.tick}</span><span class="nm wrap">New people must sign in with Google to join</span></button>` : ''}
            <div class="msg" id="tMsg" role="alert"></div></div>` : ''}`;
        $('#tB', sh.el).innerHTML = html`<div class="f"><div class="lab">Money</div><p class="note" style="padding-top:0">Everything is counted in ${currencyName(st.base, LOCALE)} (${st.base}). Other currencies are converted at the day’s rate, which is saved with each expense. Rates: fawazahmed0 currency-api, updated daily.</p></div>
          <div class="f"><div class="list"><button class="li" type="button" data-do="invite"><span class="grow">Invite friends<small>code ${C.fmtCode(S.code)}</small></span><span class="go">Open</span></button>
            <button class="li" type="button" data-do="final"><span class="grow">${st.final ? 'Final bill' : 'Finalize trip'}<small>${st.final ? 'the trip is finalized: see the bill, or reopen it' : 'the final bill for everyone, and no new expenses'}</small></span><span class="go">Open</span></button>
            <button class="li" type="button" data-do="receipts"><span class="grow">Receipt photos<small>${live ? `${photos} of ${live} ${live === 1 ? 'expense has' : 'expenses have'} one` : 'none yet'}</small></span><span class="go">Open</span></button>
            <button class="li" type="button" data-do="csv"><span class="grow">Download expenses<small>a spreadsheet file (CSV)</small></span><span class="go">Save</span></button>
            <button class="li" type="button" data-do="csvlog"><span class="grow">Download the log<small>every change, with who and when</small></span><span class="go">Save</span></button>
            <button class="li" type="button" data-do="forget"><span class="grow red">Take this trip off this phone<small>it stays for everyone else</small></span></button></div></div>`;
      };
      sh.body.innerHTML = html`<div id="tA"></div>
        <div class="f"><div class="lab">Colour</div>
          <div class="seg" role="radiogroup" aria-label="Who sees the colour" id="tScope"><button type="button" role="radio" data-scope="all">For everyone</button><button type="button" role="radio" data-scope="me">Only on my phone</button></div>
          <div id="tPick"></div></div>
        <div id="tB"></div>`;
      /* Colours: for the whole trip (logged like any change), or only on this phone. While a colour is being dragged
         around it is only shown; it is saved once the choosing stops, so the log gets one line, not fifty. */
      let scope = ownLook(S.code) ? 'me' : 'all', pending = null, timer = 0;
      const look = () => (scope === 'me' ? ownLook(S.code) || S.st.color : pending || S.st.color);
      const commit = () => {
        clearTimeout(timer); const c = pending, now = lookParts(S.st.color), next = c ? lookParts(c) : null; pending = null; S.mixing = false;
        if (!c || c === S.st.color) return;
        if (C.customParts(c) && next.field === now.field && next.accent === now.accent) return;       // "your own" opened but nothing changed yet: nothing to tell anyone
        add([{ t: 'trip.color', d: { color: c } }]);
      };
      const drawScope = () => { for (const b of $$('#tScope button', sh.el)) b.setAttribute('aria-checked', String(b.dataset.scope === scope)); };
      const drawPick = colorPicker($('#tPick', sh.el), look, (c, done) => {
        setColor(c);
        if (scope === 'me') { prefs.set('look.' + S.code, c); return; }
        pending = c; S.mixing = true; clearTimeout(timer);
        if (done && !C.customParts(c)) commit(); else timer = setTimeout(commit, done ? 500 : 1600);
      });
      $('#tScope', sh.el).onclick = e => {
        const b = e.target.closest('[data-scope]'); if (!b || b.dataset.scope === scope) return;
        commit(); scope = b.dataset.scope;
        if (scope === 'me') { prefs.set('look.' + S.code, S.st.color); toast('Colours you pick now stay on this phone'); } else { prefs.del('look.' + S.code); setColor(S.st.color); toast('Back to the trip’s colours'); }
        drawScope(); drawPick();
      };
      sh.onClose = commit;
      drawScope();
      sh.refresh = () => {
        if (!$('#tNew', sh.el) || !typing()) draw();
        if (!S.mixing && !(document.activeElement && document.activeElement.type === 'color')) drawPick();
      };
      draw();
      store.preload().then(() => { if (sheets.includes(sh) && !typing()) draw(); });
      const addPerson = () => {
        const i = $('#tNew', sh.el), name = i.value.trim(); if (!name) return i.focus();
        if (activeMembers().some(m => m.name.toLowerCase() === name.toLowerCase())) { toast(name + ' is already in the trip'); return; }
        add([{ t: 'member.add', d: { id: C.newId('m'), name } }]); i.value = ''; i.blur(); toast(name + ' added');
      };
      const rename = () => { const n = $('#tName', sh.el).value.trim(); $('#tName', sh.el).blur(); if (n && n !== S.st.name) { add([{ t: 'trip.rename', d: { name: n } }]); toast('Trip renamed'); } };
      sh.el.addEventListener('keydown', e => { if (e.key !== 'Enter') return; if (e.target.id === 'tNew') { e.preventDefault(); addPerson(); } if (e.target.id === 'tName') { e.preventDefault(); rename(); } });
      sh.el.addEventListener('click', async e => {
        const p = e.target.closest('[data-person]'), act = e.target.closest('[data-do]'), grp = e.target.closest('[data-group]');
        if (e.target.closest('#tAdd')) addPerson();
        else if (e.target.closest('#tSave')) rename();
        else if (p) sheetPerson(p.dataset.person);
        else if (grp) sheetGroup(grp.dataset.group);
        else if (act) {
          const a = act.dataset.do;
          if (a === 'invite') sheetInvite();
          else if (a === 'group') sheetGroup(null);
          else if (a === 'final') sheetFinal();
          else if (a === 'receipts') sheetReceipts();
          else if (a === 'csv') exportExpenses();
          else if (a === 'csvlog') exportLog();
          else if (a === 'signin') { await signInHere(t => { const m = $('#tMsg', sh.el); if (m) m.textContent = t; }); if (sheets.includes(sh)) draw(); }
          else if (a === 'policy') {
            const on = S.st.signin !== 'google';
            add([{ t: 'trip.policy', d: { signin: on ? 'google' : 'any' } }]); toast(on ? 'New people now have to sign in' : 'New people can join without signing in');
          }
          else if (a === 'signout' && await confirmSheet({ title: 'Sign out on this phone?', text: 'This phone stays in the trip under the same name. Friends just won’t see new things from it as signed in. You can sign in again any time.', yes: 'Sign out' })) {
            try { await store.signOut(); } catch (_) { /* reloading sorts it out either way */ }
            location.reload();                                 // the live connection belonged to the old sign-in
          }
          else if (a === 'forget' && await confirmSheet({ title: 'Take this trip off this phone?', text: S.v.status.waiting ? 'Some entries from this phone haven’t been sent yet and would be lost. The trip itself stays for everyone else.' : 'The trip stays for everyone else. You can come back with the invite link or the code ' + C.fmtCode(S.code) + '.', yes: 'Take it off this phone', danger: true })) {
            const code = S.code; await closeSheets(sheets.length);
            leaveTrip(); Trips.drop(code); prefs.del('nonudge.' + code); prefs.del('look.' + code); await store.forgetTrip(code);
            history.replaceState({ v: 'home' }, '', pageUrl()); showHome(); toast('Trip taken off this phone');
          }
        }
      });
    },
  });
}
function sheetPerson(id) {
  const m = S.st.members.get(id); if (!m) return;
  openSheet({
    title: m.name,
    render(sh) {
      const st = S.st, b = S.bal, net = b.net[id] || 0, accts = Object.values(m.accounts), acct = myAccount();
      const used = [...st.expenses.values()].some(x => x.payer === id || id in x.parts) || [...st.payments.values()].some(p => p.from === id || p.to === id);
      const theirs = accts.length > 0 && !(acct && acct.uid in m.accounts);      // signed in with a Google account that isn't this phone's
      sh.body.innerHTML = html`<div class="dl"><div><span>Paid so far</span><span>${money(b.paid[id] || 0)}</span></div><div><span>Own part of the trip</span><span>${money(b.share[id] || 0)}</span></div>
          <div><span>${net < 0 ? 'Owes' : net > 0 ? 'Gets back' : 'Balance'}</span><span class="${net < 0 ? 'red' : ''}">${net ? money(Math.abs(net)) : 'settled'}</span></div>
          ${accts.map(a => html`<div><span>Google account</span><span>${acctText(a)}</span></div>`)}</div>
        <button class="link" type="button" id="mWhy">Why this number?</button>
        <div class="f"><label for="mName">Name</label><div class="addrow" style="margin-top:0"><input class="in" id="mName" maxlength="40" value="${m.name}" enterkeyhint="done"><button class="btn line" type="button" id="mSave">Save</button></div></div>
        <div class="f"><div class="list">${id !== S.me && !theirs ? html`<button class="li" type="button" id="mMe"><span class="grow">I’m ${m.name}<small>use this phone as ${m.name}. The log notes the switch.</small></span></button>` : ''}
          ${!used && id !== S.me ? html`<button class="li" type="button" id="mDel"><span class="grow red">Remove from the trip<small>possible because ${m.name} has no expenses or payments</small></span></button>` : ''}</div>
          ${id !== S.me && theirs ? html`<p class="note">${m.name} is signed in with Google, so another phone can’t take over this name.</p>` : ''}</div>`;
      const save = () => { const n = $('#mName', sh.el).value.trim(); if (n && n !== m.name) { add([{ t: 'member.rename', d: { id, name: n } }]); if (id === S.me) prefs.set('name', n); sh.close(); toast('Name changed'); } else sh.close(); };
      $('#mSave', sh.el).onclick = save;
      $('#mWhy', sh.el).onclick = () => sheetWhy(id);
      $('#mName', sh.el).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
      const me = $('#mMe', sh.el), del = $('#mDel', sh.el);
      if (me) me.onclick = async () => {
        if (!(await confirmSheet({ title: `Use this phone as ${m.name}?`, text: `From now on, what you add is recorded as ${m.name}. The log shows that this phone was ${nameOf(S.me)} before.`, yes: `Yes, I’m ${m.name}` }))) return;
        const a = myAccount();
        S.trip.add([{ t: 'claim', d: { m: id, acct: acctOf(a) }, by: id, signed: !!a }]); S.me = id; Trips.put(S.code, { me: id });
        await closeSheets(1); toast(`You’re ${m.name} now`);
      };
      if (del) del.onclick = () => { add([{ t: 'member.remove', d: { id } }]); sh.close(); toast(m.name + ' removed'); };
    },
  });
}
function qrSvg(text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(); let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return raw(`<svg viewBox="-2 -2 ${n + 4} ${n + 4}" role="img" aria-label="QR code with the invite link" shape-rendering="crispEdges"><path d="${d}" fill="#000"/></svg>`);
}
function sheetInvite(fresh = false) {
  const st = S.st, url = inviteUrl(S.code), text = `Join “${st.name}” on Split and add what you paid:`;
  openSheet({
    title: fresh ? 'Trip started' : 'Invite friends',
    render(sh) {
      sh.body.innerHTML = html`<p class="lead">${S.google ? (st.signin === 'google' ? 'Send friends the link. They open it, sign in with Google, pick their name, and they’re in.' : 'Send friends the link. They open it, pick their name, and they’re in. Signing in with Google is one tap, so you know it’s really them.')
        : 'Send friends the link. They open it, pick their name, and they’re in. No account needed.'}</p>
        <div class="ticket"><div class="tname">${st.name}</div><div class="tbody"><div class="qr">${qrSvg(url)}</div><div class="tcode"><span>Trip code</span><b>${C.fmtCode(S.code)}</b></div></div>
          <p class="thow">Scan the square with a phone camera, or type the code at <b>${(location.host + location.pathname).replace(/index\.html$/, '').replace(/\/$/, '')}</b></p></div>`;
      sh.footer(html`<div class="acts">${navigator.share ? html`<button class="btn" type="button" id="iShare">Share the invite</button>` : ''}<button class="btn ${navigator.share ? 'line' : ''}" type="button" id="iCopy">Copy the link</button></div>`);
      const copy = async () => {
        try { await navigator.clipboard.writeText(url); toast('Link copied'); }
        catch (_) { const t = document.createElement('textarea'); t.value = url; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); toast('Link copied'); } catch (e) { toast(url); } t.remove(); }
      };
      $('#iCopy', sh.el).onclick = copy;
      const share = $('#iShare', sh.el);
      if (share) share.onclick = async () => { try { await navigator.share({ title: st.name, text, url }); } catch (e) { if (e && e.name !== 'AbortError') copy(); } };
    },
  });
}

/* ---------- spreadsheet files ---------- */
const fileName = (st, what) => `${st.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'trip'}-${what}.csv`;
function exportExpenses() {
  const st = S.st, rows = [['Date', 'What', 'Amount', 'Currency', `Rate to ${st.base}`, `Amount in ${st.base}`, 'Paid by', 'Split between', 'Group', 'Note', 'Added by', 'Added at', 'Times edited', 'Deleted', 'Receipt photos']];
  for (const x of [...st.expenses.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.at - b.at))) {
    const sh = C.expenseShares(x, st.dec);
    rows.push([x.date, x.title, x.amt, x.cur, x.rate, C.fromMinor(C.baseMinor(x, st.dec), st.dec), nameOf(x.payer), Object.keys(sh).map(id => `${nameOf(id)} ${C.fromMinor(sh[id], st.dec)}`).join('; '), x.tag, x.note, nameOf(x.by),
      new Date(x.at).toISOString(), x.edits, x.gone ? 'deleted by ' + nameOf(x.goneBy) : '', x.rc.length]);
  }
  rows.push([]); rows.push(['Payments']); rows.push(['Date', 'From', 'To', 'Amount', 'Currency', `Amount in ${st.base}`, 'For', 'How', 'Recorded by', 'Deleted', 'Proof photos']);
  for (const p of st.payments.values()) rows.push([p.date, nameOf(p.from), nameOf(p.to), p.amt, p.cur, C.fromMinor(C.baseMinor(p, st.dec), st.dec), p.x && st.expenses.get(p.x) ? st.expenses.get(p.x).title : '', p.via, nameOf(p.by),
    p.gone ? (p.next ? 'changed, see the newer line' : 'deleted') : '', p.rc.length]);
  rows.push([]); rows.push(['Balances', `in ${st.base}`, 'Paid', 'Own part', 'Google account']);
  for (const m of st.members.values()) rows.push([m.name, C.fromMinor(S.bal.net[m.id] || 0, st.dec), C.fromMinor(S.bal.paid[m.id] || 0, st.dec), C.fromMinor(S.bal.share[m.id] || 0, st.dec), Object.values(m.accounts).map(acctText).join('; ')]);
  download(fileName(st, 'expenses'), C.toCSV(rows)); toast('Expenses downloaded');
}
function exportLog() {
  const st = S.st, ctx = logContext(), strip = h => String(h).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  const rows = [['When', 'Who', 'What happened', 'Amount', 'Details', 'Worth a look']];
  for (const l of st.log) {
    if (l.merged) continue;
    const o = logWords({ ...l }, ctx); if (!o) continue;
    const me = S.me; S.me = null;                             // write names, not "You"
    const p = logWords(l, ctx); S.me = me;
    rows.push([new Date(l.at).toISOString(), l.by ? nameOf(l.by) : '', strip(p.text), p.amt, p.details.map(strip).join(' | '), p.flags.join(' | ')]);
  }
  download(fileName(st, 'log'), C.toCSV(rows)); toast('Log downloaded');
}

/* ---------- the sample trip (?demo) ---------- */
function seedDemo() {
  const code = 'TRYME234', room = 'split-' + code;
  if (demoServer.data.rooms && demoServer.data.rooms[room]) return code;
  const H = 3600000, now = Date.now(), day = n => C.localDate(new Date(now - n * 24 * H));
  const ev = {}; let k = 0;
  const put = (ago, by, dev, t, d) => { const ts = now - ago * H + k++; ev[C.newEntryId(ts)] = { t, d: JSON.stringify(d), ts, ct: ts, by, dev, uid: 'u-' + dev, v: 1 }; };
  const all = { ana: 1, marko: 1, lena: 1, jon: 1, me: 1 };
  put(80, 'me', 'd1', 'member.add', { id: 'me', name: prefs.get('name') || 'Matías' }); put(80, 'me', 'd1', 'claim', { m: 'me' });
  for (const [id, name] of [['ana', 'Ana'], ['marko', 'Marko'], ['lena', 'Lena'], ['jon', 'Jon']]) put(79.9, 'me', 'd1', 'member.add', { id, name });
  put(78, 'ana', 'd2', 'claim', { m: 'ana' }); put(77, 'marko', 'd3', 'claim', { m: 'marko' }); put(76, 'lena', 'd4', 'claim', { m: 'lena' });
  const x = (ago, by, dev, id, title, amt, cur, rate, dago, payer, parts, more = {}) => put(ago, by, dev, 'expense.add', { id, title, amt, cur, cd: C.curDecimals(cur), rate, rsrc: cur === 'EUR' ? 'same' : 'live', rdate: day(dago), date: day(dago), payer, mode: 'equal', parts, ...more });
  x(52, 'me', 'd1', 'x1', 'Apartment in Sarandë', 420, 'EUR', 1, 2, 'me', all, { note: 'Three nights, the whole flat, two minutes from the beach' });
  x(50, 'marko', 'd3', 'x2', 'Fuel', 6000, 'ALL', 0.01103, 2, 'marko', all);
  x(30, 'lena', 'd4', 'x3', 'Groceries for the house, Spar', 11350, 'ALL', 0.01103, 1, 'lena', all);
  x(28, 'ana', 'd2', 'x4', 'Boat to Ksamil', 7500, 'ALL', 0.01103, 1, 'ana', { ana: 1, marko: 1, me: 1 });
  put(27, 'me', 'd1', 'group.set', { id: 'g1', name: 'Alcohol', members: ['me', 'ana', 'marko'] });
  x(20, 'marko', 'd3', 'x8', 'Wine and raki', 3200, 'ALL', 0.01103, 1, 'marko', { ana: 1, marko: 1, me: 1 }, { tag: 'Alcohol' });
  put(26, 'lena', 'd4', 'expense.edit', { id: 'x3', set: { amt: 12350 } });
  x(9, 'marko', 'd3', 'x5', 'Beach umbrellas', 1500, 'ALL', 0.01103, 0, 'marko', all);
  x(7, 'me', 'd1', 'x6', 'Taxi from the airport', 30, 'EUR', 1, 0, 'me', { me: 1, ana: 1, jon: 1 });
  put(5, 'marko', 'd3', 'expense.delete', { id: 'x5' });
  put(4, 'me', 'd1', 'pay.add', { id: 'p1', from: 'jon', to: 'me', amt: 40, cur: 'EUR', cd: 2, rate: 1, rsrc: 'same', date: day(0), x: 'x1', via: 'cash' });
  x(2, 'ana', 'd2', 'x7', 'Dinner at Oda', 8400, 'ALL', 0.01103, 0, 'ana', { ana: 1, marko: 1, lena: 1, me: 1 });
  demoServer.data.rooms = { [room]: { meta: { kind: 'split', v: 1, name: 'Albania road trip', base: 'EUR', dec: 2, color: 'night', uid: 'u-d1', ts: now - 80 * H }, events: ev } };
  Trips.put(code, { name: 'Albania road trip', color: 'night', me: 'me', base: 'EUR', dec: 2, people: 5 });
  return code;
}

/* ---------- start ---------- */
if (location.protocol === 'http:' && !/^(localhost|127\.|\[::1\])/.test(location.host)) location.replace('https:' + location.href.slice(5));
if (DEMO) { const code = seedDemo(); if (!new URLSearchParams(location.search).get('t')) history.replaceState({ v: 'trip' }, '', pageUrl(code)); }
const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
if (standalone && !new URLSearchParams(location.search).get('t') && Trips.all().length) history.replaceState({ v: 'trip' }, '', pageUrl(Trips.all()[0].code));
if (DEMO) demoServer.googleOn = new URLSearchParams(location.search).get('demo') === 'google';     // ?demo=google also previews the sign-in
googleReady = checkGoogle();
store.onAccount(() => { if (S.view === 'trip' && S.st) renderTrip(); for (const sh of sheets) if (sh.refresh) sh.refresh(); });
route();
rates.table().catch(() => {});                                // warm the rates so the first expense is instant
window.splitStarted = true;
if ('serviceWorker' in navigator && (!TEST || TEST.sw) && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
