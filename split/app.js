/* Split: the screens. Plain modules, no build step.
   core.js   the money logic (splits, balances, the log)
   store.js  where trips are kept (the drafters' Firebase database + a copy on the phone)
   rates.js  live exchange rates */
import * as C from './core.js';
import { makeStore, memoryBackend, memoryServer, browserPrefs, browserDisk } from './store.js';
import { makeRates, currencyName, guessCurrency } from './rates.js';
import { qrcode } from './lib/qr.js';

const TEST = globalThis.__SPLIT_TEST__ || null;
const DEMO = new URLSearchParams(location.search).has('demo');            // ?demo opens a sample trip that stays on this phone
const LOCALE = (TEST && TEST.locale) || navigator.language || 'en';
const demoServer = DEMO ? memoryServer() : null;
const store = DEMO ? makeStore({ backend: memoryBackend(demoServer), prefs: browserPrefs('demo.'), disk: browserDisk('-demo') }) : makeStore();
const prefs = store.prefs;
const rates = makeRates({ prefs });
const HEX = { mango: '#ffb52e', lime: '#b9e04c', aqua: '#5fd6c6', sky: '#86c5ff', lilac: '#c4b0ff', flamingo: '#ff9bb0' };

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
  clip: raw('<svg class="clip" viewBox="0 0 11 13" role="img" aria-label="has a receipt photo"><path d="M1 1h9v11l-1.5-1.2L7 12l-1.5-1.2L4 12l-1.5-1.2L1 12z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M3.3 4.2h4.4M3.3 6.8h4.4" stroke="currentColor" stroke-width="1.3"/></svg>'),
};

const S = { view: 'boot', tab: 'expenses', code: null, trip: null, v: null, st: null, bal: null, me: null, filter: 'all', showGone: false, homeErr: '', fresh: null, asked: false };

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
function setColor(c) {
  const col = C.COLORS.includes(c) ? c : 'mango';
  document.body.className = 'c-' + col;
  const m = $('meta[name="theme-color"]'); if (m) m.content = HEX[col];
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
const pageUrl = code => location.pathname + (DEMO || code ? '?' : '') + (DEMO ? 'demo' : '') + (DEMO && code ? '&' : '') + (code ? 't=' + C.fmtCode(code) : '');
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
  const code = C.cleanCode(t);
  if (code) return showTrip(code);
  history.replaceState({ v: 'home' }, '', pageUrl());
  showHome('That link doesn’t hold a valid trip code. Codes look like ABCD-EFGH.');
}
function go(code) { history.pushState({ v: 'trip', fromHome: true }, '', pageUrl(code)); showTrip(code); }
function goHome() {
  if (history.state && history.state.fromHome) history.back();
  else { history.replaceState({ v: 'home' }, '', pageUrl()); showHome(); }
}
function leaveTrip() {
  if (S.trip) S.trip.close();
  Object.assign(S, { trip: null, code: null, v: null, st: null, bal: null, me: null, asked: false, showGone: false, filter: 'all', fresh: null });
}
function showHome(err = '') {
  leaveTrip(); S.view = 'home'; S.homeErr = err; setColor('mango'); document.title = 'Split';
  const trips = Trips.all();
  $('#app').innerHTML = html`<div class="home">
    <h1>Split</h1>
    <p class="lede">Trip costs, shared and settled. Everyone adds what they paid; the app works out who owes who.</p>
    <button class="btn big start" type="button" data-act="new">Start a trip</button>
    <form class="joinbox" id="joinForm"><input id="joinCode" aria-label="Trip code" placeholder="Have a code? Type it here" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" enterkeyhint="go"><button class="btn">Join</button></form>
    ${err ? html`<p class="err" role="alert">${err}</p>` : ''}
    ${trips.length ? html`<h2>Your trips</h2><div class="paper trips">${trips.map((t, i) => {
      const net = t.net || 0, st = { base: t.base || 'EUR', dec: t.dec == null ? 2 : t.dec };
      return html`<button class="x ${i ? '' : 'nob'}" type="button" data-act="go" data-code="${t.code}"><div class="a"><span>${t.name || 'Trip'}</span><b class="${net < 0 ? 'red' : ''}">${net ? money(Math.abs(net), st) : ''}</b></div>
        <div class="b"><span>${people(t.people || 1)}</span><em class="${net < 0 ? 'red' : net ? '' : 'dim'}">${net > 0 ? 'you get back' : net < 0 ? 'you owe' : 'settled up'}</em></div></button>`;
    })}</div>` : ''}
    <p class="foot">${DEMO ? 'Sample mode: everything here stays on this phone.' : 'No account needed. A trip is shared by its code.'}</p>
  </div>`;
  window.scrollTo(0, 0);
}
function showTrip(code) {
  if (S.code === code && S.trip) { S.view = 'trip'; renderTrip(); return; }
  leaveTrip();
  const rec = Trips.get(code);
  Object.assign(S, { view: 'trip', code, tab: 'expenses', me: rec ? rec.me : null });
  setColor(rec ? rec.color : 'mango');
  if (rec) Trips.touch(code);
  renderTrip(); window.scrollTo(0, 0);
  S.trip = store.openTrip(code, onTrip);
}
function onTrip(v) {
  if (v.code !== S.code) return;
  S.v = v;
  if (v.meta) { S.st = C.replay(v.meta, v.entries); S.bal = C.balances(S.st); }
  const st = S.st;
  if (st) {
    if (S.me && v.status.live && !st.members.has(S.me)) S.me = null;        // this phone's person is not in the trip any more
    setColor(st.color); document.title = st.name + ' - Split';
    if (S.me) Trips.put(S.code, { name: st.name, color: st.color, me: S.me, net: S.bal.net[S.me] || 0, base: st.base, dec: st.dec, people: activeMembers().length });
    if (!S.me && !S.asked && v.status.live && !sheets.length) { S.asked = true; sheetJoin(); }
  }
  if (S.view === 'trip') renderTrip();
  for (const sh of sheets) if (sh.refresh) sh.refresh();
}
/* Things only someone in the trip can do. */
function needMe() { if (S.me) return true; if (S.st) sheetJoin(); return false; }
function add(items) { return S.trip.add(items.map(it => ({ ...it, by: S.me }))); }

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
    const gone = v && v.status.notFound, stuck = v && v.status.loaded && !v.status.online && !gone;
    app.innerHTML = html`<div class="top"><button class="back" type="button" data-act="home">${IC.back}Trips</button></div>
      <header class="head"><h1>${gone ? 'No trip with that code' : 'Opening the trip…'}</h1>
      <p class="sub">${gone ? html`<span class="who">There’s no trip called ${C.fmtCode(S.code)}. Check the link, or ask whoever sent it for a new one.</span>` : stuck ? html`<span class="who">No connection. A trip opens without signal once this phone has loaded it before.</span>` : ''}</p>
      ${gone ? html`<button class="btn" type="button" data-act="home">Back to Split</button>` : ''}</header>`;
    return;
  }
  const y = window.scrollY, sync = syncInfo(), n = activeMembers().length;
  app.innerHTML = html`<div class="top"><button class="back" type="button" data-act="home">${IC.back}Trips</button>
      <button class="sync ${sync.cls}" type="button" data-act="retry"><i></i><span>${sync.text}</span></button></div>
    <header class="head"><h1 class="${st.name.length > 20 ? 'long' : ''}">${st.name}</h1>
      <div class="sub"><button class="who" type="button" data-act="more">${S.me ? html`<span>${people(n)}, you’re&nbsp;<b>${nameOf(S.me)}</b></span>` : html`<span>${people(n)}</span>`}</button>
      ${S.me ? html`<button class="btn small" type="button" data-act="invite">Invite</button><button class="btn small line" type="button" data-act="more">More</button>` : html`<button class="btn small" type="button" data-act="join">Join this trip</button>`}</div></header>
    ${S.tab === 'expenses' ? tabExpenses() : S.tab === 'balances' ? tabBalances() : tabLog()}
    <nav class="bar" aria-label="Trip sections">${['expenses', 'balances', 'log'].map(t => html`<button class="tab" type="button" data-act="tab" data-tab="${t}" ${S.tab === t ? raw('aria-current="page"') : ''}>${t[0].toUpperCase() + t.slice(1)}</button>`)}
      <button class="plus" type="button" data-act="add" aria-label="Add an expense">${IC.plus}</button></nav>`;
  window.scrollTo(0, y);
  if (S.fresh) setTimeout(() => { S.fresh = null; }, 700);
}
function standing() {
  const net = S.me ? S.bal.net[S.me] || 0 : 0, n = money(Math.abs(net));
  return html`<div class="stand ${net < 0 ? 'owe' : ''}"><div class="l">${!S.me ? 'Trip total' : net > 0 ? 'You get back' : net < 0 ? 'You owe' : 'You’re settled up'}</div>
    <div class="n ${n.length > 10 ? 'small' : ''}">${S.me ? n : money(S.bal.total)}</div></div>`;
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
    ${S.me ? html`<div class="sums"><div><span>Trip total</span><span>${money(b.total)}</span></div><div><span>Your share</span><span>${money(b.share[S.me] || 0)}</span></div><div><span>You paid</span><span>${money(b.paid[S.me] || 0)}</span></div></div>` : ''}
    ${shown.length ? rows : html`<div class="empty"><b>${alone ? 'Just you so far' : 'Nothing on the tab yet'}</b>${alone ? 'Send the invite so your friends can join, or add them yourself under More.' : 'Add the first expense with the + button below.'}
      ${alone && S.me ? html`<br><button class="btn" type="button" data-act="invite">Invite friends</button>` : ''}</div>`}
    ${gone ? html`<button class="link more" type="button" data-act="gone">${S.showGone ? 'Hide' : 'Show'} ${gone} deleted</button>` : ''}</main>`;
}
/* "Ana paid", "Ana paid for Jon": the short line under an expense. */
function paidWords(x, shares) {
  const ids = Object.keys(shares);
  const only = ids.length === 1 ? (ids[0] === x.payer ? (x.payer === S.me ? ' for yourself' : ' for themselves') : ` for ${whom(ids[0])}`) : '';
  return `${who(x.payer)} paid${only}${x.edits ? ', edited' : ''}`;
}
function expenseRow(x) {
  const st = S.st, base = C.baseMinor(x, st.dec), shares = C.expenseShares(x, st.dec), me = S.me;
  const mine = (x.payer === me ? base : 0) - (shares[me] || 0);
  const left = x.gone ? `Deleted by ${whom(x.goneBy)}` : paidWords(x, shares);
  const right = x.gone || !me ? '' : mine > 0 ? html`<em>you get back ${money(mine)}</em>` : mine < 0 ? html`<em class="red">you owe ${money(-mine)}</em>`
    : html`<em class="dim">${x.payer === me || me in shares ? 'evens out' : 'not yours'}</em>`;
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
    <div class="sec"><span>Everyone</span><span>paid so far</span></div>
    ${members.map(m => { const net = b.net[m.id] || 0; return html`<button class="x" type="button" data-act="person" data-id="${m.id}"><div class="a"><span>${m.name}${m.id === me ? ' (you)' : ''}</span><b>${money(b.paid[m.id] || 0)}</b></div>
      <div class="b"><span>share ${money(b.share[m.id] || 0)}</span><em class="${net < 0 ? 'red' : net ? '' : 'dim'}">${net > 0 ? 'gets back ' + money(net) : net < 0 ? 'owes ' + money(-net) : 'settled'}</em></div></button>`; })}
    ${pays.length ? html`<div class="sec"><span>Payments made</span><span></span></div>${pays.map(p => html`<button class="x ${p.pending ? 'wait' : ''}" type="button" data-act="payment" data-id="${p.id}"><div class="a"><span>${who(p.from)} paid ${whom(p.to)}</span><b>${origMoney(p)}</b></div>
      <div class="b"><span>${niceDate(p.date || C.localDate(new Date(p.at)))}</span></div></button>`)}` : ''}
    <button class="link more" type="button" data-act="settle">Record another payment</button></main>`;
}

/* ---------- the log ---------- */
const LOG_KIND = { 'member.addmany': 'people', 'expense.add': 'adds', 'expense.edit': 'changes', 'expense.delete': 'changes', 'expense.restore': 'changes', 'pay.add': 'payments', 'pay.delete': 'payments',
  'member.add': 'people', 'member.rename': 'people', 'member.remove': 'people', claim: 'people', 'trip.rename': 'changes', 'trip.color': 'changes' };
function splitList(x) {
  const ids = Object.keys(x.parts);
  if (x.mode === 'equal') return ids.length > 4 ? people(ids.length) : ids.map(id => nameOf(id)).join(', ') || 'nobody';
  return ids.map(id => `${nameOf(id)} ${x.mode === 'exact' ? C.fmtMoney(C.toMinor(x.parts[id], x.cd), x.cur, x.cd, LOCALE) : x.parts[id] + (x.parts[id] === 1 ? ' share' : ' shares')}`).join(', ');
}
/* "for everyone", "for Ana and Jon", "split 4 ways": who an expense was for, in a few words. */
function splitFor(x) {
  const ids = Object.keys(x.parts), names = ids.map(id => nameOf(id));
  if (x.mode !== 'equal') return 'split unevenly: ' + splitList(x);
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
  if (ch.has('note')) out.push(['note', b.note || 'empty', a.note || 'empty']);
  if (ch.has('rc')) out.push(['receipt photos', String(b.rc.length), String(a.rc.length)]);
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
    case 'claim':
      if (l.flags.includes('switched')) { o.text = html`<b>${nameOf(l.changes[0].from)}</b>’s phone now acts as ${l.name}`; o.flags.push('This phone was ' + nameOf(l.changes[0].from) + ' before'); }
      else if (ctx.claims[l.id] === 1) { if (ctx.selfAdded.has(l.ref)) return null; o.text = html`<b>${l.name}</b> joined the trip`; }
      else o.text = html`<b>${l.name}</b> opened the trip on another phone`;
      break;
    case 'expense.add':
      o.text = html`<b>${actor}</b> added ${x.title}`; o.amt = origMoney(x); o.open = l.ref;
      o.details.push(html`paid by ${nameOf(x.payer)}, ${splitFor(x)}${x.cur !== st.base ? html`, at ${rateText(x.cur, st.base, x.rate)}${x.rsrc === 'manual' ? ' (typed in)' : ''}` : ''}`);
      break;
    case 'expense.edit':
      o.text = html`<b>${actor}</b> changed ${x.title}`; o.open = l.ref;
      for (const [k, from, to] of editDetails(l)) o.details.push(html`${k} was <i class="struck">${from}</i>, now <i>${to}</i>`);
      if (l.flags.includes('amount')) o.flags.push('The amount was changed');
      if (l.flags.includes('late')) o.flags.push('Changed more than a day after it was added');
      break;
    case 'expense.delete': o.text = html`<b>${actor}</b> deleted <span class="struck">${x.title}</span>`; o.amt = origMoney(x); o.struck = true; o.open = l.ref;
      if (l.flags.includes('late')) o.flags.push('Deleted more than a day after it was added'); break;
    case 'expense.restore': o.text = html`<b>${actor}</b> brought back ${x.title}`; o.amt = origMoney(x); o.open = l.ref; break;
    case 'pay.add': o.text = l.by === x.from ? html`<b>${actor}</b> paid ${whom(x.to)}` : html`<b>${actor}</b> recorded that ${whom(x.from)} paid ${whom(x.to)}`; o.amt = origMoney(x); break;
    case 'pay.delete': o.text = html`<b>${actor}</b> deleted the payment from ${whom(x.from)} to ${whom(x.to)}`; o.amt = origMoney(x); o.struck = true; break;
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
    const prev = out[out.length - 1];
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
  else if (a === 'add') { if (needMe()) sheetExpense(null); }
  else if (a === 'open') sheetDetail(b.dataset.id);
  else if (a === 'gone') { S.showGone = !S.showGone; renderTrip(); }
  else if (a === 'settle') { if (needMe()) sheetPayment(b.dataset.from ? { from: b.dataset.from, to: b.dataset.to, amt: +b.dataset.amt } : null); }
  else if (a === 'payment') sheetPaymentDetail(b.dataset.id);
  else if (a === 'person') { if (needMe()) sheetPerson(b.dataset.id); }
  else if (a === 'filter') { S.filter = b.dataset.f; renderTrip(); }
  else if (a === 'hide-alert') S.trip.hideAlert(+b.dataset.at);
  else if (a === 'csv-log') exportLog();
});
$('#app').addEventListener('submit', e => {
  if (e.target.id !== 'joinForm') return;
  e.preventDefault();
  const code = C.cleanCode($('#joinCode').value);
  if (code) go(code); else showHome('That code doesn’t look right. Codes have 8 letters and numbers, like ABCD-EFGH.');
});

/* ---------- start a trip ---------- */
function sheetNewTrip() {
  const F = { name: '', base: guessCurrency(LOCALE), me: prefs.get('name', ''), others: [], color: C.COLORS[Math.floor(Math.random() * C.COLORS.length)], busy: false };
  openSheet({
    title: 'Start a trip',
    render(sh) {
      sh.body.innerHTML = html`<form id="nf" novalidate>
        <div class="f"><label for="nName">Trip name</label><input class="in" id="nName" maxlength="60" placeholder="Albania road trip" autocomplete="off" enterkeyhint="next"></div>
        <div class="f"><div class="lab">Count everything in <small>other currencies are converted</small></div><button class="cur" type="button" id="nBase"></button></div>
        <div class="f"><label for="nMe">Your name</label><input class="in" id="nMe" maxlength="40" autocomplete="given-name" enterkeyhint="next"></div>
        <div class="f"><label for="nOther">Who else is coming <small>optional</small></label>
          <div class="pick" id="nOthers"></div><div class="addrow"><input class="in" id="nOther" maxlength="40" placeholder="A friend’s name" autocomplete="off" enterkeyhint="done"><button class="btn line" type="button" id="nAdd">Add</button></div></div>
        <div class="f"><div class="lab">Colour</div><div class="swatches" role="radiogroup" aria-label="Trip colour" id="nCol"></div></div></form>`;
      sh.footer(html`<div class="msg" id="nMsg" role="alert"></div><button class="btn big" form="nf" id="nGo">Start the trip</button>`);
      $('#nMe', sh.el).value = F.me;
      const draw = () => {
        $('#nBase', sh.el).innerHTML = html`${F.base} ${IC.down}`; $('#nBase', sh.el).setAttribute('aria-label', 'Trip currency: ' + currencyName(F.base, LOCALE));
        $('#nOthers', sh.el).innerHTML = html`${F.others.map((n, i) => html`<button class="chip" type="button" data-i="${i}" aria-label="Remove ${n}"><span>${n}</span> ×</button>`)}`;
        $('#nCol', sh.el).innerHTML = html`${C.COLORS.map(c => html`<button class="sw" type="button" role="radio" aria-checked="${String(F.color === c)}" aria-label="${c}" data-c="${c}" style="background:${HEX[c]}"></button>`)}`;
        setColor(F.color);
      };
      const addOther = () => { const el = $('#nOther', sh.el), n = el.value.trim(); if (n && F.others.length < 30) { F.others.push(n.slice(0, 40)); el.value = ''; draw(); } el.focus(); };
      draw();
      $('#nBase', sh.el).onclick = () => sheetCurrency(F.base, c => { F.base = c; draw(); });
      $('#nAdd', sh.el).onclick = addOther;
      $('#nOther', sh.el).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addOther(); } });
      $('#nOthers', sh.el).onclick = e => { const b = e.target.closest('[data-i]'); if (b) { F.others.splice(+b.dataset.i, 1); draw(); } };
      $('#nCol', sh.el).onclick = e => { const b = e.target.closest('[data-c]'); if (b) { F.color = b.dataset.c; draw(); } };
      $('#nf', sh.el).onsubmit = async e => {
        e.preventDefault(); if (F.busy) return;
        const name = $('#nName', sh.el).value.trim(), me = $('#nMe', sh.el).value.trim(), msg = $('#nMsg', sh.el);
        const pending = $('#nOther', sh.el).value.trim(); if (pending) F.others.push(pending.slice(0, 40));
        if (!name) { msg.textContent = 'Give the trip a name.'; $('#nName', sh.el).focus(); return; }
        if (!me) { msg.textContent = 'Type your name so friends know who you are.'; $('#nMe', sh.el).focus(); return; }
        F.busy = true; $('#nGo', sh.el).disabled = true; msg.textContent = ''; $('#nGo', sh.el).textContent = 'Starting…';
        const myId = C.newId('m'), items = [{ t: 'member.add', d: { id: myId, name: me }, by: myId }, { t: 'claim', d: { m: myId }, by: myId }];
        const seen = new Set([me.toLowerCase()]);
        for (const n of F.others) if (!seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); items.push({ t: 'member.add', d: { id: C.newId('m'), name: n }, by: myId }); }
        try {
          const code = await store.createTrip({ name, base: F.base, dec: C.curDecimals(F.base), color: F.color }, items);
          prefs.set('name', me);
          Trips.put(code, { name, color: F.color, me: myId, net: 0, base: F.base, dec: C.curDecimals(F.base), people: seen.size });
          await closeSheets(1);
          go(code);
          setTimeout(() => { if (S.code === code && !sheets.length) sheetInvite(true); }, 350);
        } catch (err) {
          F.busy = false; $('#nGo', sh.el).disabled = false; $('#nGo', sh.el).textContent = 'Start the trip';
          msg.textContent = 'Couldn’t start the trip. Check your connection and try again.';
        }
      };
      $('#nName', sh.el).focus({ preventScroll: true });
    },
    onClose() { if (S.view === 'home') setColor('mango'); },
  });
}

/* ---------- join ---------- */
function sheetJoin() {
  if (!S.st || sheets.some(s => s.kind === 'join')) return;
  let pick = null;
  const sh = openSheet({
    title: 'Join ' + S.st.name,
    render(sh) {
      sh.body.innerHTML = html`<p class="lead">Who are you?</p><div class="pick" role="radiogroup" aria-label="Who are you" id="jPick"></div>
        <div class="f" id="jNew" hidden><label for="jName">Your name</label><input class="in" id="jName" maxlength="40" autocomplete="given-name" enterkeyhint="done"></div>`;
      sh.footer(html`<div class="msg" id="jMsg" role="alert"></div><button class="btn big" type="button" id="jGo">Join the trip</button>`);
      $('#jName', sh.el).value = prefs.get('name', '');
      const draw = () => {
        $('#jPick', sh.el).innerHTML = html`${activeMembers().map(m => html`<button class="chip" type="button" role="radio" aria-checked="${String(pick === m.id)}" data-id="${m.id}"><span>${m.name}</span></button>`)}
          <button class="chip" type="button" role="radio" aria-checked="${String(pick === 'new')}" data-id="new"><span>I’m not on the list</span></button>`;
        $('#jNew', sh.el).hidden = pick !== 'new';
      };
      sh.refresh = draw; draw();
      $('#jPick', sh.el).onclick = e => { const b = e.target.closest('[data-id]'); if (!b) return; pick = b.dataset.id; draw(); if (pick === 'new') $('#jName', sh.el).focus(); };
      const join = () => {
        const msg = $('#jMsg', sh.el);
        if (!pick) { msg.textContent = 'Tap your name, or “I’m not on the list”.'; return; }
        let id = pick; const items = [];
        if (pick === 'new') {
          const name = $('#jName', sh.el).value.trim();
          if (!name) { msg.textContent = 'Type your name.'; $('#jName', sh.el).focus(); return; }
          const same = activeMembers().find(m => m.name.toLowerCase() === name.toLowerCase());
          if (same) id = same.id; else { id = C.newId('m'); items.push({ t: 'member.add', d: { id, name }, by: id }); }
          prefs.set('name', name);
        }
        items.push({ t: 'claim', d: { m: id }, by: id });
        S.me = id; S.trip.add(items);
        Trips.put(S.code, { name: S.st.name, color: S.st.color, me: id });
        sh.close(); toast('You’re in');
      };
      $('#jGo', sh.el).onclick = join;
      $('#jName', sh.el).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); join(); } });
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
        <div class="f"><label for="xt">What was it for</label><input class="in" id="xt" maxlength="80" placeholder="Dinner, taxi, groceries…" autocomplete="off" enterkeyhint="done"></div>
        <div class="f"><div class="lab">Paid by</div><div class="pick" role="radiogroup" aria-label="Paid by" id="xp"></div></div>
        <div class="f"><div class="lab">Split between <small id="xsum"></small></div>
          <div class="seg" role="radiogroup" aria-label="How to split">${[['equal', 'Equally'], ['shares', 'By shares'], ['exact', 'Exact amounts']].map(([k, t]) => html`<button type="button" role="radio" data-mode="${k}">${t}</button>`)}</div>
          <div class="rows" id="xs"></div><div class="left" id="xleft" aria-live="polite"></div></div>
        <div class="f"><label for="xd">When</label><input class="in" type="date" id="xd" max="2100-12-31"></div>
        <div class="f"><div class="lab">Receipt photo <small>optional</small></div><div class="photos" id="xph"></div><input type="file" accept="image/*" id="xfile" hidden></div>
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
      }
      function drawPhotos() {
        el('xph').innerHTML = html`${F.photos.map((p, i) => html`<div class="ph ${p.url ? '' : 'load'}">${p.url ? html`<img src="${p.url}" alt="Receipt photo ${i + 1}">` : p.note || 'Loading…'}<button class="rm" type="button" data-rm="${i}" aria-label="Remove photo ${i + 1}">×</button></div>`)}
          ${F.photos.length < 4 ? html`<button class="btn line" type="button" id="xadd">${F.photos.length ? 'Add another' : 'Add a photo'}</button>` : ''}`;
      }
      const box = moneyBox(F, sh, { amt: '#xa', cur: '#xc', fx: '#xfx' }, { onChange: () => { msg.textContent = ''; drawSplit(false); } });
      drawPayer(); drawSplit(); drawPhotos(); box.draw();
      if (!old) box.load(); else if (old.cur !== st.base && !F.rate.mkt && !F.manual) F.rate.mkt = F.rate.rate;
      for (const p of F.photos) if (!p.url) S.trip.photo(p.rid).then(r => { p.url = r.img || ''; p.note = r.img ? '' : r.changed ? 'Changed outside the app' : 'Not uploaded yet'; if (sheets.includes(sh)) drawPhotos(); });

      el('xp').onclick = e => { const b = e.target.closest('[data-id]'); if (b) { F.payer = b.dataset.id; drawPayer(); } };
      $('.seg', sh.el).onclick = e => {
        const b = e.target.closest('[data-mode]'); if (!b || b.dataset.mode === F.mode) return;
        const from = F.mode; F.mode = b.dataset.mode;
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
        if (row) { const i = row.dataset.id; if (F.sel.has(i)) F.sel.delete(i); else F.sel.add(i); row.setAttribute('aria-checked', String(F.sel.has(i))); drawSplit(false); }
        else if (inc) { F.shares[inc.dataset.inc] = Math.min(99, (F.shares[inc.dataset.inc] || 0) + 1); drawSplit(false); }
        else if (dec) { F.shares[dec.dataset.dec] = Math.max(0, (F.shares[dec.dataset.dec] || 0) - 1); drawSplit(false); }
        msg.textContent = '';
      });
      el('xs').addEventListener('input', e => { const i = e.target.dataset.exact; if (i) { F.exact[i] = e.target.value; drawSplit(false); msg.textContent = ''; } });
      el('xd').onchange = () => { F.date = el('xd').value || C.localDate(); if (!old && F.cur !== st.base && !F.manual) box.load(true); };
      el('xph').addEventListener('click', e => {
        const rm = e.target.closest('[data-rm]');
        if (rm) { F.photos.splice(+rm.dataset.rm, 1); drawPhotos(); } else if (e.target.closest('#xadd')) el('xfile').click();
      });
      el('xfile').onchange = async () => {
        const file = el('xfile').files[0]; el('xfile').value = ''; if (!file) return;
        const p = { rid: null, url: '', note: 'Shrinking…' }; F.photos.push(p); drawPhotos();
        try { p.url = await shrinkPhoto(file); p.rid = await S.trip.addPhoto(p.url); p.note = ''; }
        catch (err) { F.photos.splice(F.photos.indexOf(p), 1); msg.textContent = 'That photo couldn’t be added. Try another one.'; }
        if (sheets.includes(sh)) drawPhotos();
      };
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
        const d = { title, amt, cur: F.cur, cd: cd(), ...rateFields(F), date: F.date, payer: F.payer, mode: F.mode, parts: w, note: el('xn').value.trim(), rc: F.photos.map(p => p.rid) };
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

/* ---------- one expense ---------- */
function sheetDetail(id) {
  if (!S.st.expenses.has(id)) return;
  openSheet({
    title: S.st.expenses.get(id).title,
    render(sh) {
      const draw = () => {
        const st = S.st, x = st.expenses.get(id); if (!x) return;
        const base = C.baseMinor(x, st.dec), shares = C.expenseShares(x, st.dec), ctx = logContext();
        sh.title(x.title);
        sh.body.innerHTML = html`<div class="bigamt ${x.gone ? 'struck' : ''}">${origMoney(x)}</div>
          ${x.cur !== st.base ? html`<div class="dim">${money(base)} at ${rateText(x.cur, st.base, x.rate)}${x.rsrc === 'manual' ? ' (typed in)' : ''}</div>` : ''}
          ${x.gone ? html`<div class="stampd">Deleted by ${whom(x.goneBy)}</div>` : ''}
          <div class="dl"><div><span>When</span><span>${niceDate(x.date)}</span></div><div><span>Paid by</span><span>${nameOf(x.payer)}</span></div>
            <div><span>Added by</span><span>${nameOf(x.by)}, ${stampText(x.at)}</span></div>${x.note ? html`<div><span>Note</span><span>${x.note}</span></div>` : ''}</div>
          <h3 class="h3">Who it was for</h3><div class="dl">${Object.keys(shares).sort((a, b) => (nameOf(a) < nameOf(b) ? -1 : 1)).map(m => html`<div><span>${nameOf(m)}${m === S.me ? ' (you)' : ''}</span><span>${money(shares[m])}</span></div>`)}</div>
          ${x.rc.length ? html`<h3 class="h3">Receipt</h3><div class="photos">${x.rc.map((rid, i) => html`<button class="ph load" type="button" data-rid="${rid}" aria-label="Open receipt photo ${i + 1}">Photo ${i + 1}</button>`)}</div>` : ''}
          <h3 class="h3">History</h3><div class="paper-in">${st.log.filter(l => l.ref === id).map(l => logLine(l, ctx, true))}</div>`;
        sh.footer(x.gone ? html`<button class="btn big" type="button" data-do="restore">Bring it back</button>` : html`<div class="acts"><button class="btn line" type="button" data-do="delete">Delete</button><button class="btn" type="button" data-do="edit">Edit</button></div>`);
        for (const b of $$('[data-rid]', sh.el)) S.trip.photo(b.dataset.rid).then(r => { if (r.img && b.isConnected) { b.classList.remove('load'); b.innerHTML = html`<img src="${r.img}" alt="">`; } else if (b.isConnected) b.textContent = r.changed ? 'Changed' : 'Not uploaded yet'; }, () => {});
      };
      sh.refresh = draw; draw();
      sh.el.addEventListener('click', async e => {
        const rid = e.target.closest('[data-rid]'), act = e.target.closest('[data-do]');
        if (rid) return sheetPhoto(rid.dataset.rid);
        if (!act || !needMe()) return;
        const x = S.st.expenses.get(id);
        if (act.dataset.do === 'edit') sheetExpense(id);
        else if (act.dataset.do === 'restore') { add([{ t: 'expense.restore', d: { id } }]); toast('Expense brought back'); }
        else if (await confirmSheet({ title: 'Delete this expense?', text: `“${x.title}” comes off the balances. It stays in the log, crossed out, and can be brought back.`, yes: 'Delete expense', danger: true })) {
          add([{ t: 'expense.delete', d: { id } }]);
          await closeSheets(sheets.length);
          toast('Expense deleted', { label: 'Undo', run: () => add([{ t: 'expense.restore', d: { id } }]) });
        }
      });
    },
  });
}

/* ---------- payments between people ---------- */
function sheetPayment(pre) {
  const st = S.st, members = meFirst(activeMembers());
  const F = { cur: st.base, from: pre ? pre.from : S.me, to: pre ? pre.to : null, date: C.localDate(), rate: { rate: 1, src: 'same', date: '', mkt: 0 }, manual: false, inv: true, loading: false };
  openSheet({
    title: 'Record a payment',
    render(sh) {
      sh.body.innerHTML = html`<form id="pf" novalidate><p class="lead">Someone paid a friend back, in cash or by transfer. This clears it from the balances.</p>
        <div class="f"><div class="lab">Who paid</div><div class="pick" role="radiogroup" aria-label="Who paid" id="pFrom"></div></div>
        <div class="f"><div class="lab">Who got the money</div><div class="pick" role="radiogroup" aria-label="Who got the money" id="pTo"></div></div>
        <div class="f"><label for="pa">Amount</label><div class="amount"><input id="pa" inputmode="decimal" autocomplete="off" placeholder="0"><button class="cur" type="button" id="pc"></button></div><div class="fx" id="pfx" aria-live="polite"></div></div>
        <div class="f"><label for="pd">When</label><input class="in" type="date" id="pd" max="2100-12-31"></div></form>`;
      sh.footer(html`<div class="msg" id="pmsg" role="alert"></div><button class="btn big" form="pf">Record payment</button>`);
      const msg = $('#pmsg', sh.el);
      if (pre) $('#pa', sh.el).value = String(C.fromMinor(pre.amt, st.dec));
      $('#pd', sh.el).value = F.date;
      const draw = () => {
        const chips = (sel, skip) => html`${members.filter(m => m.id !== skip).map(m => html`<button class="chip" type="button" role="radio" aria-checked="${String(sel === m.id)}" data-id="${m.id}"><span>${m.id === S.me ? 'You' : m.name}</span></button>`)}`;
        $('#pFrom', sh.el).innerHTML = chips(F.from, null); $('#pTo', sh.el).innerHTML = chips(F.to, F.from);
      };
      const box = moneyBox(F, sh, { amt: '#pa', cur: '#pc', fx: '#pfx' }, { onChange: () => { msg.textContent = ''; } });
      draw(); box.draw();
      $('#pFrom', sh.el).onclick = e => { const b = e.target.closest('[data-id]'); if (b) { F.from = b.dataset.id; if (F.to === F.from) F.to = null; draw(); } };
      $('#pTo', sh.el).onclick = e => { const b = e.target.closest('[data-id]'); if (b) { F.to = b.dataset.id; draw(); } };
      $('#pd', sh.el).onchange = () => { F.date = $('#pd', sh.el).value || C.localDate(); };
      $('#pf', sh.el).onsubmit = async e => {
        e.preventDefault();
        const amt = box.amount();
        if (!F.from || !F.to) { msg.textContent = 'Pick who paid and who got the money.'; return; }
        if (!amt) { msg.textContent = 'Type the amount.'; $('#pa', sh.el).focus(); return; }
        if (F.loading) { msg.textContent = 'Still getting the exchange rate. One moment.'; return; }
        if (!F.rate || !(F.rate.rate > 0)) { msg.textContent = 'Type an exchange rate.'; return; }
        const r = rateFields(F);
        add([{ t: 'pay.add', d: { id: C.newId('p'), from: F.from, to: F.to, amt, cur: F.cur, cd: C.curDecimals(F.cur), rate: r.rate, rsrc: r.rsrc, date: F.date } }]);
        await closeSheets(1);
        stamp('Paid'); toast('Payment recorded');
      };
      if (!pre) $('#pa', sh.el).focus({ preventScroll: true });
    },
  });
}
function sheetPaymentDetail(id) {
  const st = S.st, p = st.payments.get(id); if (!p) return;
  openSheet({
    title: 'Payment',
    render(sh) {
      sh.body.innerHTML = html`<div class="bigamt">${origMoney(p)}</div>${p.cur !== st.base ? html`<div class="dim">${money(C.baseMinor(p, st.dec))} at ${rateText(p.cur, st.base, p.rate)}</div>` : ''}
        <div class="dl"><div><span>From</span><span>${nameOf(p.from)}</span></div><div><span>To</span><span>${nameOf(p.to)}</span></div><div><span>When</span><span>${niceDate(p.date || C.localDate(new Date(p.at)))}</span></div>
        <div><span>Recorded by</span><span>${nameOf(p.by)}, ${stampText(p.at)}</span></div></div>`;
      sh.footer(html`<button class="btn big line" type="button" id="pdel">Delete this payment</button>`);
      $('#pdel', sh.el).onclick = async () => {
        if (!needMe()) return;
        if (!(await confirmSheet({ title: 'Delete this payment?', text: `${nameOf(p.from)} will owe that money again. The log keeps a record that it was deleted.`, yes: 'Delete payment', danger: true }))) return;
        add([{ t: 'pay.delete', d: { id } }]);
        await closeSheets(sheets.length); toast('Payment deleted');
      };
    },
  });
}

/* ---------- trip settings, people, invite ---------- */
function sheetTrip() {
  openSheet({
    title: 'This trip',
    render(sh) {
      const draw = () => {
        const st = S.st, joined = new Set(st.log.filter(l => l.t === 'claim').map(l => l.ref)), keepName = document.activeElement && document.activeElement.id === 'tName' ? document.activeElement.value : null;
        sh.body.innerHTML = html`<div class="f"><label for="tName">Trip name</label><div class="addrow" style="margin-top:0"><input class="in" id="tName" maxlength="60" value="${keepName == null ? st.name : keepName}" enterkeyhint="done"><button class="btn line" type="button" id="tSave">Save</button></div></div>
          <div class="f"><div class="lab">People <small>tap a name to change it</small></div><div class="list">${activeMembers().map(m => html`<button class="li" type="button" data-person="${m.id}"><span class="grow">${m.name}${m.id === S.me ? ' (you)' : ''}<small>${joined.has(m.id) ? 'joined' : 'hasn’t opened the trip yet'}</small></span><span class="go">Edit</span></button>`)}</div>
            <div class="addrow"><input class="in" id="tNew" maxlength="40" placeholder="Add a person" autocomplete="off" enterkeyhint="done"><button class="btn line" type="button" id="tAdd">Add</button></div></div>
          <div class="f"><div class="lab">Colour</div><div class="swatches" role="radiogroup" aria-label="Trip colour">${C.COLORS.map(c => html`<button class="sw" type="button" role="radio" aria-checked="${String(st.color === c)}" aria-label="${c}" data-col="${c}" style="background:${HEX[c]}"></button>`)}</div></div>
          <div class="f"><div class="lab">Money</div><p class="note" style="padding-top:0">Everything is counted in ${currencyName(st.base, LOCALE)} (${st.base}). Other currencies are converted at the day’s rate, which is saved with each expense. Rates: fawazahmed0 currency-api, updated daily.</p></div>
          <div class="f"><div class="list"><button class="li" type="button" data-do="invite"><span class="grow">Invite friends<small>code ${C.fmtCode(S.code)}</small></span><span class="go">Open</span></button>
            <button class="li" type="button" data-do="csv"><span class="grow">Download expenses<small>a spreadsheet file (CSV)</small></span><span class="go">Save</span></button>
            <button class="li" type="button" data-do="csvlog"><span class="grow">Download the log<small>every change, with who and when</small></span><span class="go">Save</span></button>
            <button class="li" type="button" data-do="forget"><span class="grow red">Take this trip off this phone<small>it stays for everyone else</small></span></button></div></div>`;
      };
      sh.refresh = () => { if (!$('#tNew', sh.el) || (document.activeElement !== $('#tNew', sh.el) && document.activeElement !== $('#tName', sh.el))) draw(); };
      draw();
      const addPerson = () => {
        const i = $('#tNew', sh.el), name = i.value.trim(); if (!name) return i.focus();
        if (activeMembers().some(m => m.name.toLowerCase() === name.toLowerCase())) { toast(name + ' is already in the trip'); return; }
        add([{ t: 'member.add', d: { id: C.newId('m'), name } }]); i.value = ''; i.blur(); toast(name + ' added');
      };
      const rename = () => { const n = $('#tName', sh.el).value.trim(); $('#tName', sh.el).blur(); if (n && n !== S.st.name) { add([{ t: 'trip.rename', d: { name: n } }]); toast('Trip renamed'); } };
      sh.el.addEventListener('keydown', e => { if (e.key !== 'Enter') return; if (e.target.id === 'tNew') { e.preventDefault(); addPerson(); } if (e.target.id === 'tName') { e.preventDefault(); rename(); } });
      sh.el.addEventListener('click', async e => {
        const p = e.target.closest('[data-person]'), col = e.target.closest('[data-col]'), act = e.target.closest('[data-do]');
        if (e.target.closest('#tAdd')) addPerson();
        else if (e.target.closest('#tSave')) rename();
        else if (p) sheetPerson(p.dataset.person);
        else if (col) { if (col.dataset.col !== S.st.color) add([{ t: 'trip.color', d: { color: col.dataset.col } }]); }
        else if (act) {
          const a = act.dataset.do;
          if (a === 'invite') sheetInvite();
          else if (a === 'csv') exportExpenses();
          else if (a === 'csvlog') exportLog();
          else if (a === 'forget' && await confirmSheet({ title: 'Take this trip off this phone?', text: S.v.status.waiting ? 'Some entries from this phone haven’t been sent yet and would be lost. The trip itself stays for everyone else.' : 'The trip stays for everyone else. You can come back with the invite link or the code ' + C.fmtCode(S.code) + '.', yes: 'Take it off this phone', danger: true })) {
            const code = S.code; await closeSheets(sheets.length);
            leaveTrip(); Trips.drop(code); await store.forgetTrip(code);
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
      const st = S.st, b = S.bal, net = b.net[id] || 0;
      const used = [...st.expenses.values()].some(x => x.payer === id || id in x.parts) || [...st.payments.values()].some(p => p.from === id || p.to === id);
      sh.body.innerHTML = html`<div class="dl"><div><span>Paid so far</span><span>${money(b.paid[id] || 0)}</span></div><div><span>Share of the trip</span><span>${money(b.share[id] || 0)}</span></div>
          <div><span>${net < 0 ? 'Owes' : net > 0 ? 'Gets back' : 'Balance'}</span><span class="${net < 0 ? 'red' : ''}">${net ? money(Math.abs(net)) : 'settled'}</span></div></div>
        <div class="f"><label for="mName">Name</label><div class="addrow" style="margin-top:0"><input class="in" id="mName" maxlength="40" value="${m.name}" enterkeyhint="done"><button class="btn line" type="button" id="mSave">Save</button></div></div>
        <div class="f"><div class="list">${id !== S.me ? html`<button class="li" type="button" id="mMe"><span class="grow">I’m ${m.name}<small>use this phone as ${m.name}. The log notes the switch.</small></span></button>` : ''}
          ${!used && id !== S.me ? html`<button class="li" type="button" id="mDel"><span class="grow red">Remove from the trip<small>possible because ${m.name} has no expenses or payments</small></span></button>` : ''}</div></div>`;
      const save = () => { const n = $('#mName', sh.el).value.trim(); if (n && n !== m.name) { add([{ t: 'member.rename', d: { id, name: n } }]); if (id === S.me) prefs.set('name', n); sh.close(); toast('Name changed'); } else sh.close(); };
      $('#mSave', sh.el).onclick = save;
      $('#mName', sh.el).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
      const me = $('#mMe', sh.el), del = $('#mDel', sh.el);
      if (me) me.onclick = async () => {
        if (!(await confirmSheet({ title: `Use this phone as ${m.name}?`, text: `From now on, what you add is recorded as ${m.name}. The log shows that this phone was ${nameOf(S.me)} before.`, yes: `Yes, I’m ${m.name}` }))) return;
        S.trip.add([{ t: 'claim', d: { m: id }, by: id }]); S.me = id; Trips.put(S.code, { me: id });
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
      sh.body.innerHTML = html`<p class="lead">Send friends the link. They open it, pick their name, and they’re in. No account needed.</p>
        <div class="ticket"><div class="tname">${st.name}</div><div class="tbody"><div class="qr">${qrSvg(url)}</div><div class="tcode"><span>Trip code</span><b>${C.fmtCode(S.code)}</b><span style="margin-top:8px">Scan the square with a phone camera, or type the code on the Split page.</span></div></div></div>`;
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
  const st = S.st, rows = [['Date', 'What', 'Amount', 'Currency', `Rate to ${st.base}`, `Amount in ${st.base}`, 'Paid by', 'Split between', 'Note', 'Added by', 'Added at', 'Times edited', 'Deleted', 'Receipt photos']];
  for (const x of [...st.expenses.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.at - b.at))) {
    const sh = C.expenseShares(x, st.dec);
    rows.push([x.date, x.title, x.amt, x.cur, x.rate, C.fromMinor(C.baseMinor(x, st.dec), st.dec), nameOf(x.payer), Object.keys(sh).map(id => `${nameOf(id)} ${C.fromMinor(sh[id], st.dec)}`).join('; '), x.note, nameOf(x.by),
      new Date(x.at).toISOString(), x.edits, x.gone ? 'deleted by ' + nameOf(x.goneBy) : '', x.rc.length]);
  }
  rows.push([]); rows.push(['Payments']); rows.push(['Date', 'From', 'To', 'Amount', 'Currency', `Amount in ${st.base}`, 'Recorded by', 'Deleted']);
  for (const p of st.payments.values()) rows.push([p.date, nameOf(p.from), nameOf(p.to), p.amt, p.cur, C.fromMinor(C.baseMinor(p, st.dec), st.dec), nameOf(p.by), p.gone ? 'deleted' : '']);
  rows.push([]); rows.push(['Balances', `in ${st.base}`]);
  for (const m of st.members.values()) rows.push([m.name, C.fromMinor(S.bal.net[m.id] || 0, st.dec)]);
  download(fileName(st, 'expenses'), C.toCSV(rows)); toast('Expenses downloaded');
}
function exportLog() {
  const st = S.st, ctx = logContext(), strip = h => String(h).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  const rows = [['When', 'Who', 'What happened', 'Amount', 'Details', 'Worth a look']];
  for (const l of st.log) {
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
  x(52, 'me', 'd1', 'x1', 'Apartment in Sarandë, 3 nights', 420, 'EUR', 1, 2, 'me', all);
  x(50, 'marko', 'd3', 'x2', 'Fuel', 6000, 'ALL', 0.01103, 2, 'marko', all);
  x(30, 'lena', 'd4', 'x3', 'Groceries for the house, Spar', 11350, 'ALL', 0.01103, 1, 'lena', all);
  x(28, 'ana', 'd2', 'x4', 'Boat to Ksamil', 7500, 'ALL', 0.01103, 1, 'ana', { ana: 1, marko: 1, me: 1 });
  put(26, 'lena', 'd4', 'expense.edit', { id: 'x3', set: { amt: 12350 } });
  x(9, 'marko', 'd3', 'x5', 'Beach umbrellas', 1500, 'ALL', 0.01103, 0, 'marko', all);
  x(7, 'me', 'd1', 'x6', 'Taxi from the airport', 30, 'EUR', 1, 0, 'me', { me: 1, ana: 1, jon: 1 });
  put(5, 'marko', 'd3', 'expense.delete', { id: 'x5' });
  put(4, 'me', 'd1', 'pay.add', { id: 'p1', from: 'jon', to: 'me', amt: 40, cur: 'EUR', cd: 2, rate: 1, rsrc: 'same', date: day(0) });
  x(2, 'ana', 'd2', 'x7', 'Dinner at Oda', 8400, 'ALL', 0.01103, 0, 'ana', { ana: 1, marko: 1, lena: 1, me: 1 });
  demoServer.data.rooms = { [room]: { meta: { kind: 'split', v: 1, name: 'Albania road trip', base: 'EUR', dec: 2, color: 'mango', uid: 'u-d1', ts: now - 80 * H }, events: ev } };
  Trips.put(code, { name: 'Albania road trip', color: 'mango', me: 'me', base: 'EUR', dec: 2, people: 5 });
  return code;
}

/* ---------- start ---------- */
if (location.protocol === 'http:' && !/^(localhost|127\.|\[::1\])/.test(location.host)) location.replace('https:' + location.href.slice(5));
if (DEMO) { const code = seedDemo(); if (!new URLSearchParams(location.search).get('t')) history.replaceState({ v: 'trip' }, '', pageUrl(code)); }
const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
if (standalone && !new URLSearchParams(location.search).get('t') && Trips.all().length) history.replaceState({ v: 'trip' }, '', pageUrl(Trips.all()[0].code));
route();
rates.table().catch(() => {});                                // warm the rates so the first expense is instant
if ('serviceWorker' in navigator && (!TEST || TEST.sw) && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
