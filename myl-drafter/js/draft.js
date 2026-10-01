// Draft screens: practice against bots and live rooms. Same flow as YGO Drafter,
// with the MyL eras (Primera Era, Primer Bloque, Segundo Bloque, Furia, Imperio…) as card pools.
import { DB, card, IMG, THUMB, T, edition, typeName, raceName, rarityName, preloadThumbs, textHTML } from './data.js';
import {
  ERAS, eraOf, poolFor, erasOf, erasLabel, tierOf, DEFAULTS, MAX_SEATS, MAX_COPIES, PACK_SIZE, STACK, keyOf, shuffle,
  norm, newGame, need, applyPick, botsPick, advance, deckRounds, roundsOf,
} from './draft-engine.js';
import { DraftNet, createRoom, createMatchTable, deleteRoom } from './net.js';
import { $, esc, toast, confirmBox, copyText, reduced } from './ui.js';
import { upsertDeck, encodeDeck, decodeDeck, deckToText } from './decks.js';
import { FORMATS, makeTour, normTour, result, roundDone, advance as advanceTour, standings, champion, roundName } from './tour.js';

const DECK_SIZE = 50;
const RSHORT = { 4: 'R', 3: 'MR', 2: 'UR', 1: 'L', 8: 'M', 9: 'S', 11: 'SP' };
const RARE_FX = { 2: ['#E9EEF5', '#AEB6C1'], 3: ['#BFE3FF', '#FFFFFF'], 4: ['#FFE08A', '#F2B32E'] };
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const DOTS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2.2" fill="currentColor"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><circle cx="19" cy="12" r="2.2" fill="currentColor"/></svg>';
const ARROW_L = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H5m6-6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ARROW_R = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ZZ = (() => { const n = 14, top = [], bot = []; for (let i = 0; i <= n; i++) top.push(`${(i * 100 / n).toFixed(2)}% ${i % 2 ? 0 : 2.4}%`); for (let i = n; i >= 0; i--) bot.push(`${(i * 100 / n).toFixed(2)}% ${i % 2 ? 100 : 97.6}%`); return `polygon(${top.concat(bot).join(',')})`; })();
const CROWN = '<svg viewBox="0 0 64 48" aria-hidden="true"><path d="M6 40 2 10l16 12L32 2l14 20 16-12-4 30z" fill="currentColor"/><rect x="6" y="41" width="52" height="6" rx="2" fill="currentColor"/></svg>';
const TOUR_HELP = { off: 'Después del draft cada uno abre su propia mesa.', rr: 'Cada jugador se enfrenta una vez con todos los demás.', swiss: 'Rondas por puntos: ganadores contra ganadores, sin repetir rivales.', se: 'Llaves: quien pierde queda fuera y el último en pie gana.' };
const slug = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function downloadText(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
const listNames = a => a.length <= 1 ? (a[0] || '') : `${a.slice(0, -1).join(', ')} y ${a[a.length - 1]}`;
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage off */ } },
};

export class DraftApp {
  constructor(app) {
    this.app = app;
    this.reset();
    this.el = $('#s-draft');
    this.el.addEventListener('click', e => this.onClick(e));
    this.el.addEventListener('change', e => this.onChange(e));
    this.el.addEventListener('pointerover', e => this.onHover(e));
  }
  reset() {
    this.S = { online: false, code: null, uid: null, net: null, room: null, g: null, practice: null, settings: { ...DEFAULTS },
      sel: [], focus: null, lastKey: null, lastSig: null, deck: null, busy: false, name: '', tour: null, tab: 'tour' };
  }

  // ------------------------------------------------------------ entry points
  openPractice(name) {
    this.leave();
    this.S.name = name || 'Jugador';
    this.S.settings = { ...DEFAULTS, ...(JSON.parse(store.get('myl.draft.settings') || '{}')) };
    try { const g = JSON.parse(store.get('myl.draft.practice') || 'null'); if (g && g.seats) this.S.practice = norm(g); } catch { this.S.practice = null; }
    this.render();
  }
  savePractice() { if (!this.S.online) store.set('myl.draft.practice', this.S.practice ? JSON.stringify(this.S.practice) : ''); }
  async openRoom(code, name) {
    this.leave();
    const S = this.S;
    S.online = true; S.code = code; S.name = name;
    this.render();
    S.net = new DraftNet(code, v => this.onRoom(v), () => toast('Se perdió la conexión con el draft. Recarga la página.', { err: true }));
    await S.net.open(name);
    S.uid = S.net.uid;
  }
  leave() {
    if (this.S && this.S.net) this.S.net.close();
    this.reset();
    const m = $('#dMain'); if (m) m.innerHTML = '';
  }
  onRoom(v) {
    const S = this.S;
    S.room = v;
    S.g = v && v.game ? norm(v.game) : null;
    S.tour = v && v.tour ? normTour(JSON.parse(JSON.stringify(v.tour))) : null;
    if (!v) { toast('Este draft ya no existe.', { err: true }); return; }
    this.render();
  }

  // ------------------------------------------------------------ helpers
  game() { return this.S.online ? this.S.g : this.S.practice; }
  activeTour() { const S = this.S; const g = this.game(); return S.online && S.tour && g && S.tour.gid === g.id ? S.tour : null; }
  mySeat(g) { return g ? g.seats.findIndex(s => s.uid === (this.S.online ? this.S.uid : 'me')) : -1; }
  isHost() { return !this.S.online || !!(this.S.room && this.S.room.meta && this.S.room.meta.host === this.S.uid); }
  presenceOf(uid) { const p = this.S.room && this.S.room.presence; return !p || p[uid] !== false; }
  members() {
    return Object.entries((this.S.room && this.S.room.members) || {})
      .map(([uid, m]) => ({ uid, name: (m && m.name) || 'Jugador', joined: (m && m.joined) || 0 })).sort((a, b) => a.joined - b.joined);
  }
  setBar(status, actions = []) {
    $('#dStatus').innerHTML = status || '';
    $('#dActions').innerHTML = actions.join('');
  }

  // ------------------------------------------------------------ rendering
  render() {
    const S = this.S;
    if (S.online && !S.room) {
      this.setBar(`<span>Conectando al draft ${esc(S.code || '')}…</span>`);
      $('#dMain').innerHTML = '<p class="dloading">Conectando…</p>';
      return;
    }
    const g = this.game();
    if (S.online) {
      if (!g) return this.renderLobby();
      if (this.mySeat(g) < 0) return this.renderSpectate();
    } else if (!g) return this.renderSetup();
    if (g.finished) return this.renderBuild();
    return this.renderDraft();
  }

  // o.set: a booster set of the pool (real wrapper photo when we have one); o.era: era key for a drawn wrapper
  packHTML(o = {}) {
    const set = o.set;
    const era = eraOf((set && set.era) || o.era || 'pb');
    if (set && set.art) {
      const n = o.variant || 1 + Math.floor(Math.random() * set.art);
      const src = `img/packs/${set.id}-${Math.min(n, set.art)}.webp`;
      return `<div class="pack photo" title="${esc(set.name)}"><div class="body" style="background-image:url('${src}')"></div><div class="strip" style="background-image:url('${src}')"></div><div class="tearglow"></div></div>`;
    }
    const art = set && set.img ? `<img class="logo" src="${esc(set.img)}" alt="" draggable="false">`
      : `<span class="big ${(o.big || era.big).length > 12 ? 'long' : ''}">${esc(o.big || (set ? set.name : era.big))}</span>`;
    return `<div class="pack era-${era.key}" ${set ? `title="${esc(set.name)}"` : ''}><div class="body" style="clip-path:${ZZ}"></div><div class="strip" style="clip-path:${ZZ}"></div><div class="tearglow"></div>
      <div class="label">${art}<span class="yr">${esc(set ? era.name : o.sub || 'Mitos y Leyendas')}</span><span class="count">${esc(o.count || `${PACK_SIZE} cartas`)}</span></div></div>`;
  }
  heroHTML(eras) {
    const pool = poolFor(eras); const art = pool.sets.filter(s => s.art);
    const pick = art.length ? [...new Set([art[0], art[Math.floor(art.length / 2)], art[art.length - 1]])] : [];
    if (!pick.length) return `<div class="dhero">${this.packHTML({ set: pool.sets.find(s => s.img), era: pool.eras[0] })}</div>`;
    return `<div class="dhero fan n${pick.length}">${pick.map(s => this.packHTML({ set: s, variant: 1 })).join('')}</div>`;
  }
  deckVisualHTML(name) {
    return `<div class="pack deckstack"><div class="body"></div><div class="tearglow"></div><span class="deckname">${esc(name)}</span></div>`;
  }

  cardHTML(entry, { u = null, pressed = false, num = 0 } = {}) {
    const key = keyOf(entry); const c = card(key);
    const t = c.type === T.ORO ? 0 : tierOf(c);
    const badge = RSHORT[c.rarity] ? `<span class="rbadge t${t}">${RSHORT[c.rarity]}</span>` : '';
    return `<button class="dcard${t >= 2 ? ` shiny t${t}` : ''}" type="button" data-u="${esc(u ?? entry)}" data-k="${key}" data-tier="${t}" aria-pressed="${pressed}" aria-label="${esc(c.name)}">
      <span class="fname">${esc(c.name)}</span><img src="${THUMB(key)}" data-k="${key}" alt="" loading="lazy" decoding="async" draggable="false"><span class="foil"></span>${badge}${num ? `<span class="picknum">${num}</span>` : ''}</button>`;
  }

  previewHTML(key) {
    if (!key) return '';
    const c = card(key); const e = edition(c);
    const stats = [c.cost >= 0 && c.type !== T.ORO ? `Coste ${c.cost}` : '', c.type === T.ALIADO && c.str >= 0 ? `Fuerza ${c.str}` : ''].filter(Boolean);
    return `<div class="dd-img"><img src="${THUMB(key)}" data-k="${key}" data-full="${IMG(key)}" alt="${esc(c.name)}"></div>
      <h2>${esc(c.name)}</h2>
      <div class="dd-tags"><span class="pill r">${esc(rarityName(c))}</span><span class="pill">${esc(typeName(c))}</span>${c.race > 0 ? `<span class="pill">${esc(raceName(c))}</span>` : ''}${stats.map(s => `<span class="pill">${esc(s)}</span>`).join('')}</div>
      <p class="dd-text">${textHTML(c, esc)}</p>
      <p class="dd-foot">${esc(e ? `${e.title}, ${e.blockName}` : '')}</p>`;
  }

  settingsHTML(st, editable, online, humans = 1) {
    const dis = editable ? '' : 'disabled';
    const seg = (key, opts) => `<div class="seg" role="radiogroup">${opts.map(([v, l]) => `<label><input type="radio" name="set-${key}" value="${v}" ${String(st[key]) === String(v) ? 'checked' : ''} ${dis}><span>${esc(l)}</span></label>`).join('')}</div>`;
    const minB = online ? 0 : 1, maxB = MAX_SEATS - humans;
    const bots = Math.max(minB, Math.min(maxB, typeof st.bots === 'number' ? st.bots : 3));
    const eras = erasOf(st); const pool = poolFor(eras);
    const deck = st.mode === 'deck';
    const perRound = PACK_SIZE * (st.atOnce || 1); const turns = Math.ceil(perRound / st.perPick) * roundsOf(st);
    const setNames = pool.sets.map(s => s.name);
    const blurb = setNames.length
      ? `${plural(setNames.length, 'sobre', 'sobres')}${eras.length > 1 ? ` de ${eras.length} eras` : ''}${pool.from && eras.length === 1 ? ` (desde ${pool.from})` : ''}: ${listNames(setNames.slice(0, 6))}${setNames.length > 6 ? ` y ${setNames.length - 6} más` : ''}. ${pool.cards.toLocaleString('es-CL')} cartas distintas. Puedes marcar varias eras.`
      : 'Estas eras no tienen sobres en la base de cartas.';
    const tour = st.tour || 'rr';
    return `<div class="dsettings ${editable ? '' : 'readonly'}">
      <div class="field stack"><div class="lbl">${eras.length > 1 ? 'Eras' : 'Era'}<small>${esc(blurb)}</small></div>
        <div class="seg eras multi" role="group" aria-label="Eras del draft">${ERAS.map(e => `<label><input type="checkbox" name="era" value="${e.key}" ${eras.includes(e.key) ? 'checked' : ''} ${dis}><span>${esc(e.name)}</span></label>`).join('')}</div></div>
      <div class="field stack"><div class="lbl">Estilo<small>${deck ? `Un mazo racial por asiento, armado con cartas de la era (20 aliados de la raza, 14 de soporte y 16 oros), todo barajado en pilas de ${STACK}.` : 'Abre sobres, quédate una carta y pasa el resto.'}</small></div>${seg('mode', [['booster', 'Sobres'], ['deck', 'Draft de mazos']])}</div>
      ${deck ? `<div class="field stack"><div class="lbl">Sobres extra<small>${st.bonus === 'off' ? 'Solo los mazos van a las pilas.' : 'Suma 1 sobre de 10 cartas reales o mejores por cada 2 jugadores.'}</small></div>${seg('bonus', [['on', 'Sí'], ['off', 'No']])}</div>`
        : `<div class="field stack"><div class="lbl">Contenido de los sobres<small>${st.contents === 'pool' ? 'Cada sobre mezcla todas las cartas de la era.' : 'Cada sobre es un set real de la era, solo con sus cartas.'}</small></div>${seg('contents', [['sets', 'Sets reales'], ['pool', 'Toda la era']])}</div>`}
      <div class="field"><div class="lbl">Bots<small>${online ? 'Ocupan los asientos que tus amigos no usan' : 'Ocupan los otros asientos'}</small></div>
        <div class="stepper"><button type="button" data-set="bots" data-dd="-1" aria-label="Menos bots" ${dis || (bots <= minB ? 'disabled' : '')}>−</button><output>${bots}</output><button type="button" data-set="bots" data-dd="1" aria-label="Más bots" ${dis || (bots >= maxB ? 'disabled' : '')}>+</button></div></div>
      ${deck ? '' : `<div class="field"><div class="lbl">Sobres por jugador<small>${st.packs * PACK_SIZE} cartas cada uno, ${turns} turnos</small></div>
        <div class="stepper"><button type="button" data-set="packs" data-dd="-1" aria-label="Menos sobres" ${dis || (st.packs <= 1 ? 'disabled' : '')}>−</button><output>${st.packs}</output><button type="button" data-set="packs" data-dd="1" aria-label="Más sobres" ${dis || (st.packs >= 10 ? 'disabled' : '')}>+</button></div></div>
      <div class="field"><div class="lbl">Abrir a la vez<small>${st.atOnce === 2 ? `Dos sobres forman una pila de ${PACK_SIZE * 2} cada ronda` : `Un sobre de ${PACK_SIZE} cada ronda`}</small></div>${seg('atOnce', [[1, '1 sobre'], [2, '2 sobres']])}</div>`}
      <div class="field"><div class="lbl">Cartas por pick<small>${st.perPick === 2 ? 'Tomas 2 por turno, el doble de rápido' : 'Tomas 1 por turno, como en Magic'}</small></div>${seg('perPick', [[1, '1'], [2, '2']])}</div>
      ${online ? `<div class="field stack"><div class="lbl">Torneo<small>${esc(TOUR_HELP[tour] || '')} Se juega con los mazos que cada uno marca como listos.</small></div>${seg('tour', [['off', 'Sin torneo'], ['rr', FORMATS.rr], ['swiss', FORMATS.swiss], ['se', FORMATS.se]])}</div>
        ${tour === 'off' ? '' : `<div class="field"><div class="lbl">Partidas del torneo<small>${+st.bestOf === 3 ? 'Gana quien se lleve 2 juegos' : 'Un juego por partida'}</small></div>${seg('bestOf', [[1, 'Al mejor de 1'], [3, 'Al mejor de 3']])}</div>`}` : ''}
      ${deck ? '' : `<div class="field"><div class="lbl">Rareza<small>${st.odds === 'arena' ? 'Cada carta tira vasallo 50, cortesano 30, real 15, ultra real 5, más 1 oro' : '6 vasallos, 3 cortesanos, 1 real (a veces mejor) y 1 oro por sobre'}</small></div>${seg('odds', [['booster', 'Clásica'], ['arena', 'Arena']])}</div>`}
    </div>`;
  }

  renderSetup() {
    const S = this.S;
    this.setBar('<span>Draft de práctica contra bots</span>');
    $('#dMain').innerHTML = `<section class="dhome">${this.heroHTML(erasOf(S.settings))}
      <div><h2>Draft de práctica</h2><p class="lede">Los mismos sobres y reglas que en una sala en vivo, con bots en los otros asientos. Nada se sube a internet.</p>
      ${this.settingsHTML(S.settings, true, false, 1)}
      <div class="row" style="margin-top:22px"><button class="btn primary big" data-d="start-practice">${S.settings.mode === 'deck' ? 'Repartir las pilas' : 'Abrir el primer sobre'}</button></div></div></section>`;
  }

  renderLobby() {
    const S = this.S; const r = S.room;
    const st = Object.assign({}, DEFAULTS, r.settings || {}); if (typeof st.bots !== 'number') st.bots = 3;
    S.settings = { ...st };
    const members = this.members(); const host = this.isHost(); const hostOn = this.presenceOf(r.meta && r.meta.host);
    const humans = members.filter(m => this.presenceOf(m.uid)).length;
    const bots = Math.max(0, Math.min(MAX_SEATS - humans, st.bots)); const seatsN = humans + bots;
    const link = `${location.origin}${location.pathname}?t=${S.code}`;
    const hostName = (r.members && r.meta && r.members[r.meta.host] && r.members[r.meta.host].name) || 'el anfitrión';
    const eraName = erasLabel(erasOf(st));
    this.setBar(`<span>Draft ${esc(S.code)}</span><span class="era-tag">${esc(eraName)}</span>`);
    const row = m => {
      const on = this.presenceOf(m.uid), me = m.uid === S.uid;
      return `<li><span class="dot ${on ? 'on' : ''}"></span>${esc(m.name)}${r.meta && m.uid === r.meta.host ? ' <span class="tag">Anfitrión</span>' : ''}${me ? ' <span class="tag">Tú</span>' : ''}${on ? '' : ' <span class="tag">Desconectado</span>'}</li>`;
    };
    const tooMany = humans > MAX_SEATS;
    const tourTxt = !st.tour || st.tour === 'off' ? '' : ` Después, torneo ${FORMATS[st.tour].toLowerCase()} al mejor de ${+st.bestOf === 3 ? 3 : 1}.`;
    const summary = `${eraName}, ${st.mode === 'deck' ? 'draft de mazos raciales' : `draft de sobres (${st.contents === 'pool' ? 'toda la era' : 'sets reales'})`}. ${plural(humans, 'jugador', 'jugadores')} y ${plural(bots, 'bot', 'bots')}: ${seatsN} asientos.${tourTxt}`;
    $('#dMain').innerHTML = `<section class="dlobby"><div>${this.heroHTML(erasOf(st)).replace('class="dhero', 'class="dhero small')}
        <p class="lede" style="margin:0">Código del draft</p><p class="roomcode">${esc(S.code)}</p>
        <div class="invite"><button class="btn primary" data-d="copy-link">Copiar invitación</button><code>${esc(link)}</code></div>
        <h3>Jugadores (${humans})</h3><ul class="people">${members.map(row).join('')}</ul>
        <p class="summary">${esc(summary)}</p>
        ${host ? `<div class="row" style="margin-top:14px"><button class="btn primary big" data-d="start-online" ${S.busy || seatsN < 2 || tooMany ? 'disabled' : ''}>${S.busy ? 'Empezando…' : 'Empezar el draft'}</button></div>
          <p class="waitnote">${tooMany ? `Caben ${MAX_SEATS} en la mesa. Alguien tiene que salir primero.` : seatsN < 2 ? 'Agrega un bot o espera a un amigo. Un draft necesita al menos 2 asientos.' : 'Los asientos se sortean al empezar. Quien entre después solo podrá mirar.'}</p>`
        : `<p class="waitnote">Esperando a que ${esc(hostName)} empiece el draft.</p>${hostOn ? '' : '<div class="row" style="margin-top:10px"><span class="err">El anfitrión se desconectó.</span><button class="btn" data-d="take-host">Ser el anfitrión</button></div>'}`}
      </div>
      <div><h3>Opciones del draft</h3>${this.settingsHTML(st, host, true, humans)}${host ? '' : '<p class="waitnote">Solo el anfitrión cambia las opciones.</p>'}</div></section>`;
  }

  renderSpectate() {
    const g = this.game();
    this.setBar(`<span>Draft ${esc(this.S.code)}</span>`);
    $('#dMain').innerHTML = `<section class="dlobby"><div><h2 class="roomcode" style="font-size:40px">Draft en curso</h2>
      <p class="lede">Este draft empezó antes de que entraras, así que no hay asiento para ti. Pídele al anfitrión uno nuevo cuando termine.</p>
      <ul class="seats">${g.seats.map(s => `<li>${esc(s.name)}</li>`).join('')}</ul></div></section>`;
  }

  renderDraft() {
    const S = this.S; const g = this.game(); const me = this.mySeat(g);
    const pack = g.packs[me], picks = g.picks[me], n = need(g, me), done = g.done[me];
    const key = `${g.id}:${g.round}:${g.turn}`;
    let anim = null;
    if (S.lastKey !== key) {
      const prev = S.lastKey ? S.lastKey.split(':') : null;
      anim = !prev || prev[0] !== g.id || +prev[1] !== g.round ? 'open' : (g.round % 2 === 0 ? 'from-right' : 'from-left');
      S.lastKey = key; S.sel = []; S.focus = null;
      preloadThumbs(pack.map(keyOf));
    }
    S.sel = S.sel.filter(s => pack.includes(s));
    if (S.focus && !pack.includes(S.focus)) S.focus = null;
    const deckMode = g.settings.mode === 'deck';
    const d = g.round % 2 === 0 ? 1 : -1; const st = g.settings; const eraName = erasLabel(st.eras);
    const where = deckMode ? `Pila ${g.round + 1} de ${deckRounds(g)}` : st.atOnce === 2 ? `Ronda ${g.round + 1} de ${roundsOf(st)}` : `Sobre ${g.round + 1} de ${st.packs}`;
    this.setBar(`<span class="era-tag">${esc(eraName)}</span><span>${where}, pick ${g.turn + 1}</span><span class="dir">${d === 1 ? ARROW_L : ARROW_R}Pasa a la ${d === 1 ? 'izquierda' : 'derecha'}</span>`,
      S.online ? [] : ['<button class="btn ghost" data-d="restart">Empezar de nuevo</button>']);
    const N = g.seats.length;
    const order = g.seats.map((_, k) => (me + k * d + N * 8) % N);
    const waiting = g.seats.map((s, i) => ({ s, i })).filter(x => !g.done[x.i] && x.i !== me);
    const host = this.isHost();
    const seatsHTML = `<ul class="seats" aria-label="Asientos en orden de pase">${order.map(i => {
      const s = g.seats[i]; const off = S.online && !s.bot && !this.presenceOf(s.uid);
      return `<li class="${i === me ? 'me' : ''} ${off ? 'off' : ''}"><span class="${g.done[i] ? 'ok' : 'wait'}">${g.done[i] ? CHECK : DOTS}</span>${esc(i === me ? 'Tú' : s.name)}${s.bot && s.uid ? ' (bot)' : ''}</li>`;
    }).join('')}</ul>`;
    const reclaim = S.online && g.seats[me].bot ? '<div class="waitbar">Un bot está eligiendo por ti. <button class="btn small" data-d="reclaim">Recuperar mi asiento</button></div>' : '';
    const waitbar = done && waiting.length ? `<div class="waitbar"><span>Esperando a ${esc(listNames(waiting.map(x => x.s.name)))}.</span>
      ${waiting.filter(x => !x.s.bot && (host || !this.presenceOf(x.s.uid))).map(x => `<button class="btn small" data-d="bot-for" data-seat="${x.i}">Que un bot elija por ${esc(x.s.name)}</button>`).join('')}</div>` : '';
    const hint = done ? 'Tu pick ya está.' : n === 2 ? `Elige 2 cartas. Llevas ${S.sel.length} de 2.` : 'Toca una carta y luego elígela.';
    const fc = S.focus ? card(keyOf(S.focus)) : null;
    let act = '';
    if (!done && fc) {
      if (n === 1) act = `<button class="btn primary big" data-d="pick" ${S.busy ? 'disabled' : ''}>Elegir ${esc(fc.name)}</button><p class="hint">O toca la carta otra vez.</p>`;
      else act = `<ul class="chosen">${S.sel.map((s, k) => `<li>${k + 1}. ${esc(card(keyOf(s)).name)}</li>`).join('')}</ul><button class="btn primary big" data-d="pick" ${S.sel.length === n && !S.busy ? '' : 'disabled'}>${S.sel.length === n ? 'Elegir estas 2' : `Elige ${n - S.sel.length} más`}</button>`;
    }
    const sig = [key, done, S.sel.join(','), S.focus, S.busy, picks.length, g.seats[me].bot].join('|');
    if (!anim && S.lastSig === sig && $('#packGrid')) { $('#seatsWrap').innerHTML = seatsHTML; $('#waitWrap').innerHTML = reclaim + waitbar; return; }
    S.lastSig = sig;
    const tally = { a: 0, t: 0, s: 0, o: 0 };
    picks.forEach(k => { const c = card(k); if (c.type === T.ALIADO) tally.a++; else if (c.type === T.TALISMAN) tally.t++; else if (c.type === T.ORO) tally.o++; else tally.s++; });
    const title = deckMode ? 'Tu pila' : g.batch === 2 ? 'Tus sobres' : 'Tu sobre';
    const decksLine = deckMode && g.decksUsed.length ? `<p class="decksline">En la mezcla: mazos ${esc(listNames([...new Set(g.decksUsed)]))}${g.bonusPacks ? `, más ${plural(g.bonusPacks, 'sobre extra', 'sobres extra')} de reales` : ''}.</p>` : '';
    $('#dMain').innerHTML = `<section class="ddraft"><div>
        <div id="seatsWrap">${seatsHTML}</div><div id="waitWrap">${reclaim}${waitbar}</div>
        <div class="dtable" id="dTable">
          <div class="dtable-head"><h2>${title}</h2><p>Quedan ${plural(pack.length, 'carta', 'cartas')}. ${hint}</p></div>
          <div class="dgrid ${anim && anim !== 'open' ? anim : ''} ${done ? 'waiting' : ''}" id="packGrid">${pack.map(e => { const k = S.sel.indexOf(e); return this.cardHTML(e, { pressed: k >= 0 || S.focus === e, num: n === 2 && k >= 0 ? k + 1 : 0 }); }).join('')}</div>
          ${decksLine}
        </div>
        <div class="dpicks"><div class="dpicks-head"><h3>Tus picks</h3><div class="tally"><span>${picks.length} en total</span><span>${tally.a} aliados</span><span>${tally.t} talismanes</span><span>${tally.s} armas y tótems</span><span>${tally.o} oros</span></div></div>
          ${picks.length ? `<div class="dstrip">${picks.slice().reverse().map((k, i) => this.cardHTML(k, { u: `p${picks.length - 1 - i}` })).join('')}</div>` : '<p class="empty">Nada todavía. Tu primer pick aparece aquí.</p>'}</div>
      </div>
      <aside class="ddetail" id="dDetail"><div class="dd-prev" id="ddPrev">${fc ? this.previewHTML(fc.key) : `<p class="detail-empty">${done ? 'Tu pick ya está. El siguiente sobre llega cuando todos elijan.' : 'Pasa el cursor sobre una carta para leerla. Tócala para elegirla.'}</p>`}</div>
        <div class="dd-act">${act}</div></aside></section>`;
    if (fc) this.upgradePreview($('#ddPrev'));
    if (anim === 'open') {
      let label = null;
      if (deckMode) label = { decks: shuffle([...new Set(g.decksUsed)]).slice(0, 3) };
      else if (st.contents === 'pool') label = {};
      else { const pool = poolFor(st.eras); const mine = (g.opens && g.opens[me]) || []; if (pool.sets.length && mine.length) label = { sets: mine.map(i => pool.sets[i]).filter(Boolean) }; }
      this.playOpen(st.eras, g.batch || 1, label);
    }
  }

  // ------------------------------------------------------------ pack opening (same choreography as YGO Drafter)
  playOpen(eras, packs, label) {
    const table = $('#dTable'), grid = $('#packGrid');
    if (!table || !grid) return;
    const cards = [...grid.querySelectorAll('.dcard')];
    const cleanup = () => cards.forEach(el => { el.getAnimations().forEach(a => a.cancel()); el.querySelectorAll('.back').forEach(b => b.remove()); el.style.opacity = ''; el.style.zIndex = ''; });
    if (reduced()) { cleanup(); return; }
    const anims = [], timers = []; let over = false;
    const ov = document.createElement('div'); ov.className = 'opening'; ov.setAttribute('aria-hidden', 'true');
    const ek = erasOf({ eras });
    const visuals = label && label.decks ? label.decks.map(n => this.deckVisualHTML(`Mazo ${n}`))
      : label && label.sets ? label.sets.map(s => this.packHTML({ set: s }))
      : Array.from({ length: packs }, (_, i) => { const e = ek[i % ek.length]; return this.packHTML({ era: e, sub: eraOf(e).name }); });
    ov.innerHTML = `<div class="shade"></div><div class="rays"></div><div class="flash"></div><div class="packs">${visuals.join('')}</div><p class="skip">Toca para saltar</p>`;
    table.appendChild(ov);
    const fx = document.createElement('div'); fx.className = 'fxlayer'; fx.setAttribute('aria-hidden', 'true'); table.appendChild(fx);
    cards.forEach(el => { el.style.opacity = '0'; });
    const A = (el, kf, opt) => { if (!el) return null; const a = el.animate(kf, { fill: 'both', ...opt }); anims.push(a); return a; };
    const at = (ms, fn) => timers.push(setTimeout(() => { if (!over) fn(); }, ms));
    const finish = () => {
      if (over) return; over = true; timers.forEach(clearTimeout);
      anims.forEach(a => { try { a.cancel(); } catch { /* gone */ } });
      ov.remove(); fx.remove(); cleanup();
    };
    ov.addEventListener('click', finish);
    setTimeout(finish, 14000);
    const packEls = [...ov.querySelectorAll('.pack')];
    const jolt = (px, ms) => A(table, [0, px, -px, px * .7, -px * .6, px * .3, 0].map(x => ({ transform: `translate(${x}px, ${-x * .4}px)` })), { duration: ms, easing: 'ease-out', fill: 'none' });
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
    // 4. the top flies off and light pours out
    at(2220, () => {
      jolt(9, 420);
      packEls.forEach((p, i) => {
        if (p.classList.contains('deckstack')) {
          A(p, [{ transform: 'translateY(-4px) scale(1.1)', opacity: 1 }, { transform: 'translateY(-10px) scale(1.25)', opacity: 1, offset: .3 }, { transform: 'translateY(-30px) scale(1.5)', opacity: 0 }], { duration: 750, easing: 'cubic-bezier(.3,.6,.3,1)' });
          this.sparks(ov, p, ['#FFF3C4', '#E9CF86', '#FFFFFF', '#C8A24B'], 34); return;
        }
        A(p, [{ transform: 'translateY(-4px) scale(1.12)' }, { transform: 'translateY(6px) scale(1.02)' }], { duration: 380, easing: 'ease-out' });
        A(p.querySelector('.strip'), [{ transform: 'none', opacity: 1 }, { transform: `translate(${i % 2 ? -90 : 90}px,-120px) rotate(${i % 2 ? -40 : 40}deg)`, opacity: 1, offset: .35 }, { transform: `translate(${i % 2 ? -230 : 230}px,-360px) rotate(${i % 2 ? -110 : 110}deg)`, opacity: 0 }], { duration: 1000, easing: 'cubic-bezier(.25,.7,.3,1)' });
        A(p.querySelector('.tearglow'), [{ opacity: 1 }, { opacity: 0 }], { duration: 450 });
        this.sparks(ov, p, ['#FFF3C4', '#E9CF86', '#FFFFFF', '#C8A24B'], 34);
      });
      A(ov.querySelector('.flash'), [{ opacity: 0, transform: 'scale(.2)' }, { opacity: 1, transform: 'scale(1.1)', offset: .2 }, { opacity: 0, transform: 'scale(2.6)' }], { duration: 1000, easing: 'ease-out' });
      A(ov.querySelector('.rays'), [{ opacity: 0, transform: 'rotate(0deg) scale(.4)' }, { opacity: .85, transform: 'rotate(40deg) scale(1)', offset: .3 }, { opacity: 0, transform: 'rotate(120deg) scale(1.4)' }], { duration: 1700, easing: 'ease-out' });
    });
    // 5. the cards rise out one by one, fly to their place and flip face up; the best card gets its own moment
    const D0 = 2520;
    at(D0, () => {
      const tr = table.getBoundingClientRect(); const tcx = tr.left + tr.width / 2, tcy = tr.top + Math.min(tr.height, window.innerHeight) * .42;
      const centers = packEls.map(p => { const r = p.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height * .3]; });
      const tiers = cards.map(el => +el.dataset.tier || 0);
      const top = Math.max(...tiers); const rareIdx = top >= 2 ? tiers.lastIndexOf(top) : -1;
      const step = cards.length > 14 ? 62 : 100;
      packEls.forEach(p => A(p, [{ transform: 'translateY(6px) scale(1.02)', opacity: 1 }, { transform: 'translateY(70px) scale(.85) rotate(-4deg)', opacity: 0 }], { duration: 800, delay: 350, easing: 'ease-in' }));
      let t = 0, end = 0;
      const normals = cards.map((_, i) => i).filter(i => i !== rareIdx);
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
            { transform: 'translate(0,0) scale(1) rotateY(0deg) rotateZ(0deg)', opacity: 1 }], { duration: dur, delay });
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
            { transform: 'translate(0,0) scale(1) rotateY(0deg) rotateZ(0deg)', opacity: 1 }], { duration: dur, delay });
          A(back, [{ opacity: 1 }, { opacity: 1, offset: .6 }, { opacity: 0, offset: .601 }, { opacity: 0 }], { duration: dur, delay });
          at(D0 + delay + dur * .68, () => { this.rareBurst(fx, el, top); jolt(6, 320); });
          end = Math.max(end, delay + dur);
        }
      });
      A(ov.querySelector('.shade'), [{ opacity: 1 }, { opacity: 0 }], { duration: 700, delay: Math.max(0, end - 500), easing: 'ease-out' });
      A(ov.querySelector('.skip'), [{ opacity: .75 }, { opacity: 0 }], { duration: 300, delay: Math.max(0, end - 500) });
      at(D0 + end + 450, finish);
    });
  }
  sparks(ov, anchor, colors, n) {
    const box = ov.getBoundingClientRect(), r = anchor.getBoundingClientRect();
    const x0 = r.left + r.width / 2 - box.left, y0 = r.top + r.height * .12 - box.top;
    for (let k = 0; k < n; k++) {
      const s = document.createElement('span'); s.className = 'spark'; s.style.left = x0 + 'px'; s.style.top = y0 + 'px'; s.style.background = colors[k % colors.length]; ov.appendChild(s);
      const a = Math.random() * Math.PI * 2, dist = 50 + Math.random() * 120;
      s.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * dist}px), calc(-50% + ${Math.sin(a) * dist - 30}px)) scale(.2)`, opacity: 0 }],
        { duration: 600 + Math.random() * 400, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' }).onfinish = () => s.remove();
    }
  }
  rareBurst(ov, el, tier) {
    if (!ov.isConnected) return;
    const fx = RARE_FX[tier] || RARE_FX[2]; const box = ov.getBoundingClientRect(), r = el.getBoundingClientRect();
    const ring = document.createElement('span'); ring.className = 'ring';
    Object.assign(ring.style, { left: (r.left - box.left + r.width / 2) + 'px', top: (r.top - box.top + r.height / 2) + 'px', width: r.width * 1.1 + 'px', height: r.height * 1.1 + 'px', boxShadow: `0 0 34px 10px ${fx[0]}, inset 0 0 24px 6px ${fx[1]}` });
    ov.appendChild(ring);
    ring.animate([{ transform: 'translate(-50%,-50%) scale(.8)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .3 }, { transform: 'translate(-50%,-50%) scale(1.25)', opacity: 0 }], { duration: 1300, easing: 'ease-out', fill: 'forwards' });
    this.sparks(ov, el, [fx[0], fx[1], '#FFFFFF'], tier >= 3 ? 44 : 28);
    const tag = document.createElement('span'); tag.className = 'raretag'; tag.textContent = rarityName(card(el.dataset.k)) || 'Real';
    Object.assign(tag.style, { left: (r.left - box.left + r.width / 2) + 'px', top: (r.top - box.top - 6) + 'px', color: fx[0] });
    ov.appendChild(tag);
    tag.animate([{ transform: 'translate(-50%,0) scale(.5)', opacity: 0 }, { transform: 'translate(-50%,-22px) scale(1.15)', opacity: 1, offset: .2 }, { transform: 'translate(-50%,-30px) scale(1)', opacity: 1, offset: .7 }, { transform: 'translate(-50%,-44px) scale(1)', opacity: 0 }], { duration: 1700, easing: 'ease-out', fill: 'forwards' });
  }

  // ------------------------------------------------------------ deck building
  myPicks() { const g = this.game(); const i = this.mySeat(g); return g && i >= 0 ? g.picks[i].map((k, u) => ({ u: `p${u}`, k, c: card(k) })) : []; }
  deckKey(g) { return `myl.draft.deck.${g.id}`; }
  ensureDeck() {
    const S = this.S; const g = this.game();
    if (S.deck && S.deck.id === g.id) return;
    let saved = null; try { saved = JSON.parse(store.get(this.deckKey(g)) || 'null'); } catch { saved = null; }
    let basics = saved && saved.basics ? saved.basics : {};
    if (saved && !saved.basics && saved.golds && saved.gold) basics = { [saved.gold]: saved.golds }; // older saves had one gold art
    S.deck = { id: g.id, main: new Set(saved ? saved.main : []), basics };
    if (!saved) this.balance();
  }
  saveDeck() { const S = this.S; const g = this.game(); if (!g || !S.deck) return; store.set(this.deckKey(g), JSON.stringify({ main: [...S.deck.main], basics: S.deck.basics })); }
  basicsTotal() { return Object.values(this.S.deck.basics || {}).reduce((a, b) => a + b, 0); }
  // Generic golds (no ability) from the drafted eras: the free pool every player can add, like basic lands.
  goldOptions() {
    const g = this.game(); const pool = poolFor(g.settings.eras);
    const seen = new Set(); const all = pool.plainGolds.filter(c => !seen.has(c.nn) && seen.add(c.nn));
    const k = Math.min(12, all.length);
    const pick = Array.from({ length: k }, (_, i) => all[Math.floor(i * all.length / k)]);
    for (const key of Object.keys(this.S.deck.basics || {})) if (!pick.some(c => c.key === key)) pick.push(card(key));
    return pick;
  }
  // Suggested gold count from the average cost of the non-gold cards.
  suggestGolds(cards) {
    const costs = cards.filter(c => c.type !== T.ORO && c.cost >= 0).map(c => c.cost);
    const avg = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 2;
    return { avg, n: avg <= 1.8 ? 15 : avg <= 2.4 ? 16 : avg <= 3 ? 17 : 18 };
  }
  spreadBasics(n) {
    const opts = this.goldOptions().slice(0, 3); const out = {};
    if (!opts.length || n <= 0) return out;
    opts.forEach((c, i) => { const v = Math.floor(n / opts.length) + (i < n % opts.length ? 1 : 0); if (v) out[c.key] = v; });
    return out;
  }
  // Best 50: the strongest non-gold picks plus as many golds as their cost curve asks for.
  balance() {
    const S = this.S; const picks = this.myPicks();
    const score = p => tierOf(p.c) * 2 + (p.c.type === T.ALIADO ? 1.5 : 1) + Math.max(0, (p.c.str > 0 ? p.c.str : 0) - (p.c.cost > 0 ? p.c.cost : 0)) * .3 - Math.max(0, (p.c.cost > 0 ? p.c.cost : 0) - 4) * .4;
    const golds = picks.filter(p => p.c.type === T.ORO);
    const spells = picks.filter(p => p.c.type !== T.ORO).sort((a, b) => score(b) - score(a));
    let G = 16;
    for (let k = 0; k < 4; k++) { const n = this.suggestGolds(spells.slice(0, DECK_SIZE - G).map(p => p.c)).n; if (n === G) break; G = n; }
    const chosen = spells.slice(0, DECK_SIZE - G);
    const goldsNeeded = DECK_SIZE - chosen.length;
    const fromDraft = golds.slice(0, goldsNeeded);
    S.deck.main = new Set([...chosen, ...fromDraft].map(p => p.u));
    S.deck.basics = this.spreadBasics(goldsNeeded - fromDraft.length);
    this.saveDeck();
  }
  autoBuild() { this.balance(); }
  deckCards() {
    const S = this.S; const cards = {};
    for (const p of this.myPicks()) if (S.deck.main.has(p.u)) cards[p.k] = (cards[p.k] || 0) + 1;
    for (const [k, n] of Object.entries(S.deck.basics || {})) if (n > 0) cards[k] = (cards[k] || 0) + n;
    return cards;
  }
  deckObj() {
    const g = this.game();
    const d = new Date();
    return { id: `draft-${g.id}`, name: `Draft ${erasLabel(g.settings.eras)} ${d.getDate()}/${d.getMonth() + 1}`, cards: this.deckCards() };
  }
  saveToMyDecks() { const d = upsertDeck(this.deckObj()); return d; }
  warnings() {
    const out = []; const byName = new Map();
    for (const [k, n] of Object.entries(this.deckCards())) {
      const c = card(k);
      if (c.type === T.ORO && !c.text) continue;
      byName.set(c.name, (byName.get(c.name) || 0) + n);
      if (c.kw > 0 && (c.kw & 1) && n > 1) out.push(`${c.name} es Única`);
    }
    for (const [name, n] of byName) if (n > MAX_COPIES) out.push(`${name} x${n}`);
    return out;
  }

  tabsHTML(active) {
    return `<div class="dtabs" role="tablist"><button role="tab" aria-selected="${active === 'tour'}" data-d="tab" data-tab="tour">Torneo</button><button role="tab" aria-selected="${active === 'deck'}" data-d="tab" data-tab="deck">Mi mazo</button></div>`;
  }
  renderBuild() {
    const S = this.S; const g = this.game();
    const tour = this.activeTour();
    if (tour && S.tab !== 'deck') return this.renderTour(tour);
    this.ensureDeck();
    const picks = this.myPicks();
    const ord = p => [T.ALIADO, T.TALISMAN, T.ARMA, T.TOTEM, T.MONUMENTO, T.ORO].indexOf(p.c.type) * 100 + (p.c.cost > 0 ? p.c.cost : 0);
    const main = picks.filter(p => S.deck.main.has(p.u)).sort((a, b) => ord(a) - ord(b) || a.c.name.localeCompare(b.c.name));
    const rest = picks.filter(p => !S.deck.main.has(p.u)).sort((a, b) => ord(a) - ord(b) || a.c.name.localeCompare(b.c.name));
    const basicsN = this.basicsTotal();
    const total = main.length + basicsN;
    const pool = poolFor(g.settings.eras); const eraName = erasLabel(g.settings.eras);
    const goldOpts = this.goldOptions();
    const warns = this.warnings();
    const nonGold = main.filter(p => p.c.type !== T.ORO).map(p => p.c);
    const draftedGolds = main.filter(p => p.c.type === T.ORO).length;
    const goldsN = draftedGolds + basicsN;
    const sug = this.suggestGolds(nonGold);
    const curve = [0, 0, 0, 0, 0, 0, 0]; nonGold.forEach(c => { if (c.cost >= 0) curve[Math.min(6, c.cost)]++; });
    const top = Math.max(1, ...curve);
    const allies = nonGold.filter(c => c.type === T.ALIADO).length;
    const balanceHTML = `<div class="balance">
        <div class="curve" aria-label="Curva de coste">${curve.map((n, i) => `<div class="bar" style="height:${Math.round(52 * n / top) + 2}px"><b>${n || ''}</b><i>${i === 6 ? '6+' : i}</i></div>`).join('')}</div>
        <div class="bstats"><span><b>${allies}</b> aliados, <b>${nonGold.length - allies}</b> de soporte, coste promedio <b>${sug.avg.toFixed(1)}</b></span>
          <span class="${Math.abs(goldsN - sug.n) <= 1 ? 'ok' : 'bad'}">Oros: <b>${goldsN}</b> (${draftedGolds} del draft y ${basicsN} genéricos). Sugerido para esta curva: ${sug.n}.</span></div>
      </div>`;
    const goldHTML = `<section class="goldpool"><div class="gp-head"><h3>Oros genéricos</h3><span>Gratis y sin límite, como las tierras básicas. Toca uno para sumarlo al mazo.</span></div>
        <div class="ggrid">${goldOpts.map(c => { const n = (S.deck.basics || {})[c.key] || 0; return `<div class="gtile ${n ? 'on' : ''}">${this.cardHTML(c.key, { u: `g:${c.key}` })}<span class="gctl"><button type="button" data-d="gsub" data-k="${c.key}" aria-label="Quitar ${esc(c.name)}" ${n ? '' : 'disabled'}>−</button><output>${n}</output><button type="button" data-d="gadd" data-k="${c.key}" aria-label="Agregar ${esc(c.name)}">+</button></span></div>`; }).join('')}</div></section>`;
    const actions = [];
    if (S.online && this.isHost()) actions.push('<button class="btn ghost" data-d="new-draft">Nuevo draft</button>');
    if (!S.online) actions.push('<button class="btn ghost" data-d="restart">Empezar de nuevo</button>');
    this.setBar(`<span class="era-tag">${esc(eraName)}</span><span>Arma tu mazo</span>`, actions);
    const zone = (title, note, list, dim) => `<section class="zone"><h3>${title}<span>${note}</span></h3>${list.length ? `<div class="zgrid ${dim ? 'dim' : ''}">${list.map(p => this.cardHTML(p.k, { u: p.u })).join('')}</div>` : `<p class="empty">${dim ? 'Todos tus picks están en el mazo.' : 'Vacío.'}</p>`}</section>`;
    const tables = Object.entries((S.room && S.room.tables) || {}).sort((a, b) => (a[1].t || 0) - (b[1].t || 0));
    $('#dMain').innerHTML = `<section class="dbuild"><div>
      ${tour ? `${this.tabsHTML('deck')}<p class="note">El torneo usa el mazo que marcaste como listo. Si lo cambias aquí, vuelve a marcarlo antes de la siguiente partida.</p>` : ''}
      ${tour ? '' : this.readyHTML(g)}
      <div class="buildbar"><span class="count ${total === DECK_SIZE ? 'ok' : 'bad'}">Mazo ${total} / ${DECK_SIZE}</span>
        <span class="goldctl">${goldsN} oros</span>
        <span class="spacer"></span>
        <button class="btn" data-d="fill" ${total >= DECK_SIZE ? 'disabled' : ''}>Completar a ${DECK_SIZE} con oros</button><button class="btn" data-d="trim" ${basicsN && total > DECK_SIZE ? '' : 'disabled'}>Quitar oros sobrantes</button><button class="btn primary" data-d="auto">Equilibrar mazo</button></div>
      ${balanceHTML}
      ${warns.length ? `<p class="warn">Más copias de las permitidas: ${warns.map(esc).join('; ')}.</p>` : ''}
      ${zone('Mazo', `${main.length} picks más ${plural(basicsN, 'oro genérico', 'oros genéricos')}`, main, false)}
      ${goldHTML}
      ${zone('Sin usar', plural(rest.length, 'carta', 'cartas'), rest, true)}
      <section class="export"><h3>Jugar</h3>
        <p>Tu mazo queda guardado en Mis mazos. Ábrelo en una mesa para jugar con tus amigos, o pruébalo solo.</p>
        <div class="row">${S.online && !tour ? '<button class="btn primary" data-d="open-table">Abrir una mesa con este mazo</button>' : ''}${tour ? '<button class="btn" data-d="reregister">Usar este mazo en el torneo</button>' : ''}<button class="btn ${S.online ? '' : 'primary'}" data-d="solo">Probar solo</button><button class="btn" data-d="save">Guardar en Mis mazos</button><button class="btn" data-d="download-deck">Descargar lista</button><button class="btn" data-d="copy-code">Copiar código</button></div>
        ${tables.length && !tour ? `<ul class="tables">${tables.map(([code, t]) => `<li><span>Mesa <b>${esc(code)}</b> de ${esc(t.name || 'alguien')}</span><button class="btn small" data-d="join-table" data-code="${esc(code)}">Unirme con mi mazo</button></li>`).join('')}</ul>` : ''}
      </section></div>
      <aside class="ddetail" id="dDetail"><div class="dd-prev" id="ddPrev"><p class="detail-empty">Toca una carta para pasarla entre el mazo y las cartas sin usar. Pasa el cursor para leerla.</p></div></aside></section>`;
  }

  readyHTML(g) {
    const S = this.S;
    if (!S.online) return '';
    const rd = (S.room && S.room.ready && S.room.ready[g.id]) || {};
    const people = g.seats.filter(s => s.uid); const waiting = people.filter(s => rd[s.uid] !== true);
    const all = !waiting.length; const meReady = rd[S.uid] === true;
    const chips = people.map(s => `<li class="${s.uid === S.uid ? 'me' : ''}"><span class="${rd[s.uid] === true ? 'ok' : 'wait'}">${rd[s.uid] === true ? CHECK : DOTS}</span>${esc(s.uid === S.uid ? 'Tú' : s.name)}</li>`).join('');
    const st = Object.assign({}, DEFAULTS, (S.room && S.room.settings) || {});
    const fmt = FORMATS[st.tour] ? st.tour : 'rr';
    const regs = this.registered(g);
    const host = this.isHost();
    const seg = (key, opts) => `<div class="seg small" role="radiogroup">${opts.map(([v, l]) => `<label><input type="radio" name="set-${key}" value="${v}" ${String(key === 'tour' ? fmt : +st.bestOf === 3 ? 3 : 1) === String(v) ? 'checked' : ''} ${host ? '' : 'disabled'}><span>${esc(l)}</span></label>`).join('')}</div>`;
    const tourBox = `<div class="tourstart">
      <p><b>Torneo</b> ${regs.length >= 2 ? `con ${plural(regs.length, 'jugador listo', 'jugadores listos')}` : ''}<small>${esc(TOUR_HELP[fmt])}</small></p>
      ${host ? `${seg('tour', [['rr', FORMATS.rr], ['swiss', FORMATS.swiss], ['se', FORMATS.se]])}${seg('bestOf', [[1, 'Al mejor de 1'], [3, 'Al mejor de 3']])}
        <div class="row"><button class="btn primary" data-d="tour-start" ${regs.length >= 2 && !S.busy ? '' : 'disabled'}>Empezar el torneo</button>${regs.length < 2 ? '<span class="waitnote" style="margin:0">Hacen falta al menos 2 jugadores listos.</span>' : waiting.length ? `<span class="waitnote" style="margin:0">Quien no esté listo queda fuera.</span>` : ''}</div>`
        : `<p class="waitnote" style="margin:0">El anfitrión arma el torneo cuando todos estén listos (${esc(FORMATS[fmt].toLowerCase())}, al mejor de ${+st.bestOf === 3 ? 3 : 1}).</p>`}
    </div>`;
    return `<div class="roomstatus ${all ? 'allready' : ''}">
      <p>${all ? (st.tour === 'off' ? 'Todos terminaron. Abran una mesa y a jugar, o armen un torneo.' : 'Todos terminaron. Ya se puede empezar el torneo.') : `Armando mazos: ${people.length - waiting.length} de ${people.length} listos. Falta ${esc(listNames(waiting.map(s => s.uid === S.uid ? 'tú' : s.name)))}.`}</p>
      <ul class="seats">${chips}</ul>
      <div class="row">${meReady ? `<span class="okline">${CHECK}Estás listo. Tu mazo quedó registrado.</span><button class="btn" data-d="unready">Seguir editando</button>` : '<button class="btn primary" data-d="ready">Terminé mi mazo</button>'}</div>
      ${tourBox}</div>`;
  }

  // ------------------------------------------------------------ tournament
  registered(g) {
    const S = this.S;
    const rd = (S.room && S.room.ready && S.room.ready[g.id]) || {};
    const decks = (S.room && S.room.decks && S.room.decks[g.id]) || {};
    return g.seats.filter(s => s.uid && rd[s.uid] === true && decks[s.uid] && decks[s.uid].deck)
      .map(s => ({ uid: s.uid, name: decks[s.uid].name || s.name, deck: decks[s.uid].deck }));
  }
  tourName(t, uid) { return uid === this.S.uid ? 'Tú' : (t.players[uid] && t.players[uid].name) || 'Jugador'; }
  matchRow(t, r, i, m, { live }) {
    const S = this.S; const res = result(t, m); const host = this.isHost();
    const nm = uid => esc(this.tourName(t, uid));
    if (!m.b) return `<li class="bye"><span class="p a win">${nm(m.a)}</span><span class="score">descansa</span><span class="p b"></span><span class="mstat">Cuenta como victoria</span></li>`;
    const mine = m.a === S.uid || m.b === S.uid;
    const canReport = live && !t.done && (mine || host);
    const games = Object.keys(m.games || {}).length;
    const ctl = [];
    if (m.table && live && !res.done) ctl.push(`<button class="btn small" data-d="tour-watch" data-code="${esc(m.table)}">${mine ? 'Ir a la mesa' : 'Mirar'}</button>`);
    if (canReport && !res.done && !mine) ctl.push(`<button class="btn small" data-d="tour-game" data-r="${r}" data-i="${i}" data-w="${esc(m.a)}">+1 ${nm(m.a)}</button><button class="btn small" data-d="tour-game" data-r="${r}" data-i="${i}" data-w="${esc(m.b)}">+1 ${nm(m.b)}</button>`);
    if (canReport && games && !mine) ctl.push(`<button class="btn small ghost" data-d="tour-undo" data-r="${r}" data-i="${i}">Deshacer</button>`);
    const stat = res.done ? `Ganó ${nm(res.winner)}` : games ? 'En juego' : m.table ? 'Mesa abierta' : 'Por jugar';
    return `<li class="${res.done ? 'done' : ''} ${mine ? 'mine' : ''}"><span class="p a ${res.winner === m.a ? 'win' : ''}">${nm(m.a)}</span><span class="score">${res.wa} – ${res.wb}</span><span class="p b ${res.winner === m.b ? 'win' : ''}">${nm(m.b)}</span><span class="mstat">${stat}</span>${ctl.length ? `<span class="mctl">${ctl.join('')}</span>` : ''}</li>`;
  }
  renderTour(t) {
    const S = this.S; const g = this.game(); const host = this.isHost();
    const actions = host ? ['<button class="btn ghost" data-d="tour-reset">Borrar torneo</button>', '<button class="btn ghost" data-d="new-draft">Nuevo draft</button>'] : [];
    this.setBar(`<span class="era-tag">${esc(erasLabel(g.settings.eras))}</span><span>Torneo: ${esc(FORMATS[t.format])}, al mejor de ${t.bestOf}</span>`, actions);
    const r = t.round; const round = t.rounds[r]; const st = standings(t); const champ = champion(t);
    const myI = round ? round.matches.findIndex(m => m.a === S.uid || m.b === S.uid) : -1;
    let myBox = '';
    if (!t.done && myI >= 0) {
      const m = round.matches[myI]; const res = result(t, m);
      if (!m.b) myBox = `<div class="mymatch"><h3>Tu partida</h3><p>Descansas esta ronda. Cuenta como victoria.</p></div>`;
      else {
        const opp = m.a === S.uid ? m.b : m.a; const mine = m.a === S.uid ? res.wa : res.wb; const theirs = m.a === S.uid ? res.wb : res.wa;
        const games = Object.keys(m.games || {}).length;
        myBox = `<div class="mymatch ${res.done ? (res.winner === S.uid ? 'won' : 'lost') : ''}">
          <h3>Tu partida: tú contra ${esc(this.tourName(t, opp))}</h3>
          <p class="bigscore">${mine} – ${theirs}</p>
          <p>${res.done ? (res.winner === S.uid ? 'Ganaste esta ronda.' : 'Perdiste esta ronda.') : t.bestOf === 3 ? 'Al mejor de 3: gana quien se lleve 2 juegos.' : 'Un juego. Al terminar, anoten quién ganó.'} ${!res.done && m.table ? `Mesa <b>${esc(m.table)}</b> abierta.` : ''}</p>
          ${res.done ? '' : `<div class="row"><button class="btn primary" data-d="tour-play" data-r="${r}" data-i="${myI}" ${S.busy ? 'disabled' : ''}>${m.table ? 'Ir a la mesa' : 'Jugar en una mesa'}</button>
            <button class="btn" data-d="tour-game" data-r="${r}" data-i="${myI}" data-w="${esc(S.uid)}">Gané un juego</button><button class="btn" data-d="tour-game" data-r="${r}" data-i="${myI}" data-w="${esc(opp)}">Perdí un juego</button>
            ${games ? `<button class="btn ghost" data-d="tour-undo" data-r="${r}" data-i="${myI}">Deshacer el último</button>` : ''}</div>`}
        </div>`;
      }
    } else if (!t.done && !t.players[S.uid]) myBox = '<div class="mymatch"><p>No estás en este torneo, pero puedes seguirlo y mirar las mesas.</p></div>';
    const pending = round ? round.matches.filter(m => !result(t, m).done).length : 0;
    const last = t.format === 'se' ? round && round.matches.length === 1 : r + 1 >= t.total;
    const next = !t.done && round ? (roundDone(t)
      ? (host ? `<div class="row"><button class="btn primary big" data-d="tour-next">${last ? 'Cerrar el torneo' : 'Siguiente ronda'}</button></div>` : `<p class="waitnote">Ronda terminada. El anfitrión ${last ? 'cierra el torneo' : 'arma la siguiente'}.</p>`)
      : `<p class="waitnote">Faltan ${plural(pending, 'partida', 'partidas')} en esta ronda.</p>`) : '';
    const past = t.rounds.map((rr, ri) => ri === r && !t.done ? '' : `<details ${t.done && ri === t.rounds.length - 1 ? 'open' : ''}><summary>${esc(roundName(t, ri))}</summary><ol class="pairings">${rr.matches.map((m, i) => this.matchRow(t, ri, i, m, { live: false })).join('')}</ol></details>`).reverse().join('');
    const decks = t.done ? `<section class="tdecks"><h3>Mazos</h3>${st.map(p => { const pl = t.players[p.uid] || {}; const cards = pl.deck ? decodeDeck(pl.deck.code) : null; return `<details><summary>${esc(pl.name || 'Jugador')} <small>${esc(pl.deck ? pl.deck.name : '')}</small></summary>${cards ? `<pre>${esc(deckToText({ cards }))}</pre>` : '<p class="empty">Sin mazo.</p>'}</details>`; }).join('')}</section>` : '';
    $('#dMain').innerHTML = `<section class="dtour"><div>
        ${this.tabsHTML('tour')}
        ${t.done ? `<div class="champ"><span class="crown">${CROWN}</span><p class="lbl">Campeón del torneo</p><p class="who">${esc(champ ? (t.players[champ] || {}).name || '' : '')}</p></div>` : ''}
        ${myBox}
        ${t.done ? '' : `<section class="tround"><h2>${esc(roundName(t, r))} <small>de ${t.format === 'se' ? t.total : t.total}</small></h2><ol class="pairings">${round.matches.map((m, i) => this.matchRow(t, r, i, m, { live: true })).join('')}</ol>${next}</section>`}
        ${past ? `<section class="tpast"><h3>Rondas</h3>${past}</section>` : ''}
        ${decks}
      </div>
      <aside class="tside"><h3>Posiciones</h3>
        <table class="standings"><thead><tr><th>#</th><th>Jugador</th><th title="Puntos">Pts</th><th title="Partidas ganadas y perdidas">V–D</th><th title="Juegos ganados y perdidos">Juegos</th></tr></thead>
        <tbody>${st.map((p, k) => `<tr class="${p.uid === S.uid ? 'me' : ''} ${t.done && k === 0 ? 'first' : ''}"><td>${k + 1}</td><td>${esc(this.tourName(t, p.uid))}${t.format === 'se' && p.out != null && !(t.done && p.uid === champ) ? ` <small>fuera en ${esc(roundName(t, p.out).toLowerCase())}</small>` : ''}</td><td>${p.pts}</td><td>${p.mw}–${p.ml}</td><td>${p.gw}–${p.gl}</td></tr>`).join('')}</tbody></table>
        <p class="note">${t.format === 'se' ? 'Ordenado por hasta dónde llegó cada uno.' : 'Empates: porcentaje de victorias de los rivales y diferencia de juegos.'}</p>
        <div class="row"><button class="btn" data-d="tour-download">Descargar resultados y mazos</button></div>
      </aside></section>`;
    if (t.done && !this._confetti) { this._confetti = t.id; const c = $('.champ .crown'); if (c && !reduced()) this.sparks($('.champ'), c, ['#FFE08A', '#F2B32E', '#FFFFFF', '#E9CF86'], 46); }
  }
  tourText(t) {
    const g = this.game(); const st = standings(t); const champ = champion(t);
    const L = [`Torneo MyL Drafter · draft ${this.S.code}`, `Eras: ${erasLabel(g.settings.eras)}`, `Formato: ${FORMATS[t.format]}, al mejor de ${t.bestOf}`];
    if (champ) L.push(`Campeón: ${(t.players[champ] || {}).name}`);
    L.push('', 'POSICIONES');
    st.forEach((p, k) => L.push(`${k + 1}. ${p.name}: ${p.pts} pts, partidas ${p.mw}-${p.ml}, juegos ${p.gw}-${p.gl}`));
    L.push('', 'RONDAS');
    t.rounds.forEach((rr, ri) => {
      L.push(roundName(t, ri));
      rr.matches.forEach(m => { const res = result(t, m); const n = u => (t.players[u] || {}).name || 'Jugador'; L.push(m.b ? `  ${n(m.a)} ${res.wa}-${res.wb} ${n(m.b)}${res.done ? `  (ganó ${n(res.winner)})` : '  (sin terminar)'}` : `  ${n(m.a)} descansa`); });
    });
    L.push('', 'MAZOS');
    st.forEach(p => {
      const pl = t.players[p.uid] || {}; const cards = pl.deck ? decodeDeck(pl.deck.code) : null;
      L.push('', `== ${pl.name}${pl.deck ? ` · ${pl.deck.name}` : ''} ==`);
      if (cards) { L.push(deckToText({ cards }), `Código: ${pl.deck.code}`); }
    });
    return L.join('\n');
  }
  async startTour() {
    const S = this.S; const g = this.game();
    const players = this.registered(g);
    if (players.length < 2) { toast('Hacen falta al menos 2 jugadores listos.'); return; }
    const st = Object.assign({}, DEFAULTS, (S.room && S.room.settings) || {});
    const t = makeTour({ id: Math.random().toString(36).slice(2, 10), format: FORMATS[st.tour] ? st.tour : 'rr', bestOf: +st.bestOf === 3 ? 3 : 1, players });
    t.gid = g.id;
    S.busy = true; this.render();
    try { await S.net.tx('tour', cur => (cur && cur.gid === g.id && !cur.done ? undefined : t)); S.tab = 'tour'; }
    catch (e) { toast('No se pudo armar el torneo: ' + e.message, { err: true }); }
    finally { S.busy = false; this.render(); }
  }
  async tourGame(r, i, winner) {
    const S = this.S; const t = this.activeTour(); if (!t) return;
    const m = t.rounds[r] && t.rounds[r].matches[i]; if (!m || result(t, m).done) return;
    await S.net.push(`tour/rounds/${r}/matches/${i}/games`, winner);
  }
  async tourUndo(r, i) {
    const S = this.S; const t = this.activeTour(); if (!t) return;
    const m = t.rounds[r] && t.rounds[r].matches[i]; const keys = Object.keys((m && m.games) || {}).sort();
    if (keys.length) await S.net.put(`tour/rounds/${r}/matches/${i}/games/${keys[keys.length - 1]}`, null);
  }
  async tourNext() {
    const S = this.S;
    await S.net.tx('tour', cur => { if (!cur) return cur; const t = normTour(cur); if (!advanceTour(t)) return; return t; });
  }
  async playMatch(r, i) {
    const S = this.S; const t = this.activeTour(); if (!t) return;
    const m = t.rounds[r].matches[i];
    if (m.table) { this.app.openTableFromDraft(m.table); return; }
    S.busy = true; this.render();
    try {
      const pa = t.players[m.a] || {}, pb = t.players[m.b] || {};
      const seats = { p1: { uid: m.a, name: pa.name || 'Jugador 1', deck: pa.deck, ready: true }, p2: { uid: m.b, name: pb.name || 'Jugador 2', deck: pb.deck, ready: true } };
      const code = await createMatchTable(seats, { draft: S.code, tour: t.id, r, i, label: `${roundName(t, r)} del torneo` }, { hand: 8, oroInicial: true, autoPhases: true, specHands: false, testCards: true });
      const res = await S.net.tx(`tour/rounds/${r}/matches/${i}/table`, cur => (cur ? undefined : code));
      if (!res.committed) { deleteRoom(code).catch(() => {}); this.app.openTableFromDraft(res.snapshot.val()); return; }
      this.app.openTableFromDraft(code);
    } catch (e) { toast('No se pudo abrir la mesa: ' + e.message, { err: true }); }
    finally { S.busy = false; }
  }
  async registerDeck() {
    const S = this.S; const g = this.game();
    const d = this.saveToMyDecks();
    const n = Object.values(d.cards).reduce((a, b) => a + b, 0);
    await S.net.put(`decks/${g.id}/${S.uid}`, { name: S.name, deck: { name: d.name, code: encodeDeck(d.cards), n } });
    return d;
  }

  // ------------------------------------------------------------ actions
  async startPractice() {
    const S = this.S;
    store.set('myl.draft.settings', JSON.stringify(S.settings));
    S.practice = newGame(S.settings, [{ uid: 'me', name: S.name || 'Jugador' }]);
    S.lastKey = null;
    this.savePractice();
    this.render();
  }
  async startOnline() {
    const S = this.S;
    S.busy = true; this.render();
    try {
      const humans = this.members().filter(m => this.presenceOf(m.uid)).slice(0, MAX_SEATS).map(m => ({ uid: m.uid, name: m.name }));
      const g0 = newGame(S.settings, humans);
      await S.net.tx('game', cur => (cur ? undefined : g0));
    } catch (e) { toast('No se pudo empezar: ' + e.message, { err: true }); }
    finally { S.busy = false; this.render(); }
  }
  async submitPick() {
    const S = this.S; const g = this.game(); const me = this.mySeat(g);
    if (!g || me < 0 || g.done[me]) return;
    const n = need(g, me);
    const ids = n === 2 ? S.sel.slice() : (S.focus ? [S.focus] : []);
    if (ids.length !== n) return;
    if (!S.online) {
      if (applyPick(g, me, ids)) advance(g);
      S.sel = []; S.focus = null; this.savePractice(); this.render();
      return;
    }
    S.busy = true; this.render();
    try {
      const res = await S.net.tx('game', cur => {
        if (!cur) return cur;
        norm(cur);
        if (!applyPick(cur, me, ids)) return;
        advance(cur);
        return cur;
      });
      if (!res.committed) toast('Esa carta ya no está en el sobre.');
    } catch (e) { toast('No se pudo enviar tu pick. Intenta de nuevo.', { err: true }); }
    finally { S.busy = false; S.sel = []; S.focus = null; this.render(); }
  }
  async botTakeover(i) {
    await this.S.net.tx('game', g => {
      if (!g) return g;
      norm(g);
      if (g.finished || !g.seats[i] || g.seats[i].bot || g.done[i]) return;
      g.seats[i].bot = true; botsPick(g); advance(g);
      return g;
    });
  }
  async reclaim() {
    const S = this.S;
    await S.net.tx('game', g => { if (!g) return g; norm(g); const i = g.seats.findIndex(s => s.uid === S.uid); if (i < 0 || !g.seats[i].bot) return; g.seats[i].bot = false; return g; });
  }
  async newDraftSameRoom() {
    if (!(await confirmBox('Nuevo draft', 'Se cierra este draft para todos y vuelven a la sala con las mismas opciones.', 'Nuevo draft'))) return;
    await this.S.net.patch('', { game: null, tables: null, tour: null });
  }
  async setSetting(key, value) {
    const S = this.S;
    if (['bots', 'packs', 'atOnce', 'perPick', 'bestOf'].includes(key)) value = +value;
    S.settings[key] = value;
    if (S.online) { if (this.isHost()) await S.net.patch('settings', { [key]: value }); }
    else { store.set('myl.draft.settings', JSON.stringify(S.settings)); this.render(); }
  }
  async openTable() {
    const S = this.S; const g = this.game();
    const d = this.saveToMyDecks();
    try {
      const code = await createRoom(S.name || 'Jugador', { hand: 8, oroInicial: true, autoPhases: true, specHands: false, testCards: true });
      await S.net.patch(`tables/${code}`, { name: S.name || 'Jugador', uid: S.uid, t: Date.now(), g: g.id });
      this.goTable(code, d);
    } catch (e) { toast('No se pudo abrir la mesa: ' + e.message, { err: true }); }
  }
  goTable(code, d) {
    try { sessionStorage.setItem('myl.pendingDeck', JSON.stringify({ name: d.name, code: encodeDeck(d.cards), n: Object.values(d.cards).reduce((a, b) => a + b, 0) })); } catch { /* storage off */ }
    this.app.openTableFromDraft(code);
  }

  // ------------------------------------------------------------ events
  onChange(e) {
    const t = e.target;
    if (t.name && t.name.startsWith('set-')) { this.setSetting(t.name.slice(4), t.value); return; }
    if (t.name === 'era') {
      const eras = new Set(erasOf(this.S.settings));
      if (t.checked) eras.add(t.value); else eras.delete(t.value);
      if (!eras.size) { t.checked = true; toast('Deja al menos una era.'); return; }
      this.setSetting('eras', ERAS.map(e => e.key).filter(k => eras.has(k)));
      return;
    }

  }
  onHover(e) {
    const c = e.target.closest('.dcard');
    if (!c) return;
    const box = $('#ddPrev'); if (!box) return;
    if (box.dataset.k === c.dataset.k) return;
    box.dataset.k = c.dataset.k;
    box.innerHTML = this.previewHTML(c.dataset.k);
    this.upgradePreview(box);
  }
  upgradePreview(box) {
    const im = box && box.querySelector('img[data-full]'); if (!im) return;
    const full = new Image(); full.onload = () => { if (im.isConnected) im.src = full.src; }; full.src = im.dataset.full;
  }
  async onClick(e) {
    const S = this.S;
    const st = e.target.closest('[data-set]');
    if (st && !st.disabled) {
      const k = st.dataset.set; const cur = S.settings[k] ?? DEFAULTS[k];
      const humans = S.online ? this.members().filter(m => this.presenceOf(m.uid)).length : 1;
      const lim = k === 'bots' ? [S.online ? 0 : 1, MAX_SEATS - humans] : [1, 10];
      this.setSetting(k, Math.max(lim[0], Math.min(lim[1], cur + (+st.dataset.dd))));
      return;
    }
    const b = e.target.closest('[data-d]');
    const cardEl = e.target.closest('.dcard');
    if (!b && cardEl) { this.cardClick(cardEl); return; }
    if (!b) return;
    const a = b.dataset.d;
    if (a === 'home') { this.app.goHome(); return; }
    if (a === 'start-practice') this.startPractice();
    if (a === 'start-online') this.startOnline();
    if (a === 'restart') { if (await confirmBox('Empezar de nuevo', 'Se pierde este draft de práctica. Los mazos que guardaste siguen en Mis mazos.', 'Empezar de nuevo')) { S.practice = null; S.deck = null; S.lastKey = null; this.savePractice(); this.render(); } }
    if (a === 'copy-link') { const link = `${location.origin}${location.pathname}?t=${S.code}`; toast((await copyText(link)) ? 'Invitación copiada.' : link, { ms: 5000 }); }
    if (a === 'take-host') await S.net.patch('meta', { host: S.uid });
    if (a === 'pick') this.submitPick();
    if (a === 'bot-for') this.botTakeover(+b.dataset.seat);
    if (a === 'reclaim') this.reclaim();
    if (a === 'new-draft') this.newDraftSameRoom();
    if (a === 'gadd' || a === 'gsub') { this.addBasic(b.dataset.k, a === 'gadd' ? 1 : -1); }
    if (a === 'fill') {
      const missing = DECK_SIZE - (S.deck.main.size + this.basicsTotal());
      if (missing > 0) { const has = Object.keys(S.deck.basics || {}).filter(k => S.deck.basics[k] > 0); const add = has.length ? null : this.spreadBasics(missing);
        if (add) S.deck.basics = add; else for (let i = 0; i < missing; i++) { const k = has[i % has.length]; S.deck.basics[k] += 1; } }
      this.saveDeck(); this.render();
    }
    if (a === 'trim') {
      let extra = S.deck.main.size + this.basicsTotal() - DECK_SIZE;
      while (extra > 0 && this.basicsTotal() > 0) { const k = Object.keys(S.deck.basics).sort((x, y) => S.deck.basics[y] - S.deck.basics[x])[0]; S.deck.basics[k]--; if (!S.deck.basics[k]) delete S.deck.basics[k]; extra--; }
      this.saveDeck(); this.render();
    }
    if (a === 'auto') { this.autoBuild(); this.render(); }
    if (a === 'save') { this.saveToMyDecks(); toast('Guardado en Mis mazos.'); }
    if (a === 'copy-code') toast((await copyText(encodeDeck(this.deckCards()))) ? 'Código del mazo copiado.' : 'No se pudo copiar.');
    if (a === 'solo') { const d = this.saveToMyDecks(); this.app.startSoloWith(d); }
    if (a === 'ready' || a === 'unready') {
      const g = this.game();
      if (a === 'ready') await this.registerDeck();
      await S.net.put(`ready/${g.id}/${S.uid}`, a === 'ready');
      if (a === 'ready') toast('Listo. Tu mazo quedó registrado y en Mis mazos.');
    }
    if (a === 'reregister') { await this.registerDeck(); toast('El torneo usará este mazo desde tu próxima partida.'); }
    if (a === 'download-deck') { const d = this.saveToMyDecks(); const n = Object.values(d.cards).reduce((x, y) => x + y, 0); downloadText(`${slug(d.name) || 'mazo-draft'}.txt`, `${d.name} (${n} cartas)\n\n${deckToText(d)}\n\nCódigo para importar en MyL Drafter: ${encodeDeck(d.cards)}\n`); }
    if (a === 'tab') { S.tab = b.dataset.tab; this.render(); }
    if (a === 'tour-start') this.startTour();
    if (a === 'tour-game') this.tourGame(+b.dataset.r, +b.dataset.i, b.dataset.w);
    if (a === 'tour-undo') this.tourUndo(+b.dataset.r, +b.dataset.i);
    if (a === 'tour-next') this.tourNext();
    if (a === 'tour-play') this.playMatch(+b.dataset.r, +b.dataset.i);
    if (a === 'tour-watch') this.app.openTableFromDraft(b.dataset.code);
    if (a === 'tour-download') { const t = this.activeTour(); if (t) downloadText(`torneo-${S.code}.txt`, this.tourText(t)); }
    if (a === 'tour-reset') { if (await confirmBox('Borrar torneo', 'Se borran las rondas y resultados para todos. Los mazos siguen registrados.', 'Borrar')) await S.net.put('tour', null); }
    if (a === 'open-table') this.openTable();
    if (a === 'join-table') { const d = this.saveToMyDecks(); this.goTable(b.dataset.code, d); }
  }
  addBasic(key, d) {
    const S = this.S; if (!key) return;
    const n = Math.max(0, ((S.deck.basics || {})[key] || 0) + d);
    S.deck.basics = { ...(S.deck.basics || {}) };
    if (n) S.deck.basics[key] = n; else delete S.deck.basics[key];
    this.saveDeck(); this.render();
  }
  cardClick(el) {
    const S = this.S; const g = this.game(); if (!g) return;
    const u = el.dataset.u;
    if (g.finished) {
      if (u && u.startsWith('g:')) { this.addBasic(u.slice(2), 1); return; }
      if (!u || !u.startsWith('p')) return;
      if (S.deck.main.has(u)) S.deck.main.delete(u); else S.deck.main.add(u);
      this.saveDeck(); this.render();
      return;
    }
    const me = this.mySeat(g);
    if (me < 0 || g.done[me] || !el.closest('#packGrid') || S.busy) return;
    const n = need(g, me);
    if (n === 2) {
      const i = S.sel.indexOf(u);
      if (i >= 0) S.sel.splice(i, 1); else if (S.sel.length < 2) S.sel.push(u); else S.sel = [S.sel[1], u];
      S.focus = u;
      this.render();
      return;
    }
    if (S.focus === u) { this.submitPick(); return; }
    S.focus = u;
    this.render();
  }
}
