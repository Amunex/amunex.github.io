import { DB, card, IMG, THUMB, T, searchCards, edition, typeName, preloadThumbs, textHTML } from './data.js';
import {
  ZN, ZTO, LINES, IN_PLAY, PUBLIC, PHASES, PH, other, fixSide, clone, zoneOf, attachedTo, buildSide, strength,
  move, attach, drawN, millN, shuffleCastle, agrupar, payGold, setupSide, mulligan, suggestOroInicial, computeBattle,
} from './game.js';
import { TableView, inspectCard } from './table.js';
import { $, esc, openMenu, closeMenu, openModal, closeModal, modalOpen, confirmBox, promptNumber, toast, stage, stageHtml, banner, copyText } from './ui.js';
import { loadDecks, deckKeys, decodeDeck, encodeDeck, deckSize, randomDeck, getSelectedId } from './decks.js';
import { Room, reportMatchGame } from './net.js';

const DEFAULT_OPTS = { hand: 8, oroInicial: true, autoPhases: true, specHands: false, testCards: true };
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

export class Session {
  constructor(app, { mode, name, code = null }) {
    this.app = app;
    this.mode = mode;
    this.me = name;
    this.code = code;
    this.cid = Math.random().toString(36).slice(2, 9);
    this.sides = { p1: null, p2: null };
    this.turn = null;
    this.meta = mode === 'solo' ? { status: 'duel', game: 1, opts: { ...DEFAULT_OPTS } } : null;
    this.seats = {}; this.members = {};
    this.mySeat = mode === 'solo' ? 'p1' : null;
    this.persp = 'p1';
    this.undo = { p1: [], p2: [] }; this.undoOrder = [];
    this.pick = null;
    this.feedItems = [];
    this.hideTopHand = false;
    this.view = new TableView(this);
    this.bindChrome();
    this.renderChrome();
  }

  // ------------------------------------------------------------ perspective / permissions
  get opts() { return (this.meta && this.meta.opts) || DEFAULT_OPTS; }
  isPlayer() { return this.mode === 'solo' || !!this.mySeat; }
  controls(seat) { return !!this.sides[seat] && (this.mode === 'solo' || seat === this.mySeat); }
  seeHand(seat) {
    if (this.mode === 'solo') return seat === this.bottomSeat() || !this.hideTopHand;
    if (seat === this.mySeat) return true;
    return !this.mySeat && !!this.opts.specHands;
  }
  bottomSeat() { return this.mode === 'online' && this.mySeat ? this.mySeat : this.persp; }
  nameOf(seat) {
    return (this.sides[seat] && this.sides[seat].name) || (this.seats[seat] && this.seats[seat].name) || (seat === 'p1' ? 'Jugador 1' : 'Jugador 2');
  }
  canDriveTurn() { return !!this.turn && (this.mode === 'solo' || this.turn.p === this.mySeat); }

  destroy() {
    this.room && this.room.close();
    this.view.destroy();
    document.removeEventListener('keydown', this._key);
    closeMenu(); closeModal();
    $('#lobby').hidden = true;
    for (const pos of ['top', 'bottom']) document.querySelector(`.side[data-pos=${pos}]`).innerHTML = '';
    $('#feed').innerHTML = ''; $('#railHead').innerHTML = ''; $('#railTools').innerHTML = ''; $('#midbar').innerHTML = '';
    $('#arrows').innerHTML = '';
  }

  // ------------------------------------------------------------ core action pipeline
  act(seat, fn, log, { undoable = true } = {}) {
    if (!this.controls(seat)) return false;
    const cur = this.sides[seat];
    const next = clone(cur);
    const res = fn(next);
    if (res === false) return false;
    next.seq = (cur.seq || 0) + 1;
    if (undoable) {
      this.undo[seat].push(cur); if (this.undo[seat].length > 50) this.undo[seat].shift();
      this.undoOrder.push(seat); if (this.undoOrder.length > 100) this.undoOrder.shift();
    }
    this.sides[seat] = next;
    this.commit(seat);
    const msg = typeof log === 'function' ? log(res) : log;
    if (msg) this.log(msg, seat);
    return res === undefined ? true : res;
  }
  commit(seat) {
    this.view.render();
    this.renderChrome();
    if (this.mode === 'online' && seat === this.mySeat && this.room) this.room.setSide(seat, this.sides[seat]).catch(e => toast('No se pudo sincronizar: ' + e.message, { err: true }));
  }
  undoLast() {
    let seat = this.mode === 'solo' ? this.undoOrder.pop() : this.mySeat;
    if (this.mode !== 'solo' && seat) { const i = this.undoOrder.lastIndexOf(seat); if (i >= 0) this.undoOrder.splice(i, 1); }
    if (!seat || !this.undo[seat].length) { toast('No hay nada que deshacer.'); return; }
    const prev = this.undo[seat].pop();
    prev.seq = (this.sides[seat].seq || 0) + 1;
    this.sides[seat] = prev;
    this.commit(seat);
    this.log('deshizo su última acción', seat);
  }

  // ------------------------------------------------------------ log, chat, fx
  ref(seat, iid, publicAnyway = false) {
    const side = this.sides[seat]; const inst = side && side.c[iid];
    if (!inst) return 'una carta';
    const z = zoneOf(side, iid);
    const pub = publicAnyway || (PUBLIC.has(z) && !inst.fd) || inst.rv;
    return pub ? `{{${inst.k}}}` : 'una carta';
  }
  log(m, seat, kind = 'log') {
    const e = { k: kind, s: seat || '', n: seat ? this.nameOf(seat) : '', m };
    if (this.mode === 'online') this.room && this.room.log(e);
    else this.addFeed(e);
  }
  chat(text) {
    const e = { k: 'chat', s: this.mySeat || 'sp', n: this.me, m: text };
    if (this.mode === 'online') this.room.log(e); else this.addFeed(e);
  }
  addFeed(e, key = null) {
    this.feedItems.push(e);
    const feed = $('#feed');
    const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
    const d = document.createElement('div');
    const refs = s => esc(s).replace(/\{\{(\d+\/\d+)\}\}/g, (_, k) => `<span class="card-ref" data-key="${k}">${esc(card(k).name)}</span>`);
    if (e.k === 'chat') { d.className = 'ch ' + (e.s === 'p2' ? 'p2' : e.s === 'p1' ? 'p1' : 'sp'); d.innerHTML = `<b>${esc(e.n)}:</b> ${esc(e.m)}`; }
    else if (e.k === 'turn') { d.className = 'lg turn'; d.innerHTML = refs(e.m); }
    else if (e.k === 'sys') { d.className = 'lg sys'; d.innerHTML = refs(e.m); }
    else { d.className = 'lg' + (e.s && e.s === this.mySeat ? ' me' : ''); d.innerHTML = `${esc(e.n)} ${refs(e.m)}`; }
    // keep server order (push keys sort by time) even when two players log at the same moment
    let before = null;
    if (key) {
      d.dataset.k = key;
      for (let el = feed.lastElementChild; el && el.dataset.k && el.dataset.k > key; el = el.previousElementSibling) before = el;
    }
    feed.insertBefore(d, before);
    while (feed.children.length > 400) feed.firstChild.remove();
    if (atBottom || e.s === this.mySeat) feed.scrollTop = feed.scrollHeight;
  }
  fx(e) {
    e.cid = this.cid;
    this.playFx(e);
    if (this.mode === 'online' && this.room) this.room.fx(e);
  }
  playFx(e) {
    switch (e.t) {
      case 'show': stage([e.k], e.cap || '', 2000); break;
      case 'reveal': stage(e.ks || [], e.cap || '', 3400); break;
      case 'coin': stageHtml(`<div style="text-align:center"><div class="coin">${esc(e.r)}</div><div class="cap">${esc(e.cap || '')}</div></div>`, 2600); break;
      case 'dice': stageHtml(`<div style="text-align:center"><div class="die">${esc(e.r)}</div><div class="cap">${esc(e.cap || '')}</div></div>`, 2200); break;
      case 'shuffle': this.view.shuffleFx(e.s); break;
      case 'point': this.view.point(e.a, e.b); break;
      case 'pulse': this.view.pulse(e.i); break;
      case 'banner': banner(e.m); break;
      default: break;
    }
  }

  // ------------------------------------------------------------ cross-side effects (damage, destroy, requests)
  route(seat, op) {
    if (this.controls(seat)) this.applyOp(seat, op);
    else if (this.mode === 'online' && this.room) this.room.op({ ...op, to: seat, by: this.mySeat || '', byName: this.me });
  }
  applyOp(seat, op) {
    if (op.k === 'mill' && op.n > 0) {
      this.act(seat, s => millN(s, op.n), k => `recibió ${op.n} de daño y botó ${plural(k, 'carta', 'cartas')}`);
      if (this.sides[seat] && !this.sides[seat].z.castillo.length) this.fx({ t: 'banner', m: `El castillo de ${this.nameOf(seat)} cayó` });
    } else if (op.k === 'destroy' && op.ids && op.ids.length) {
      const names = op.ids.map(i => this.ref(seat, i, true));
      this.act(seat, s => { for (const i of op.ids) if (s.c[i]) move(s, i, 'cementerio'); }, `perdió en combate: ${names.join(', ')}`);
    } else if (op.k === 'clearBlocks') {
      this.act(seat, s => { for (const i of s.z.defensa) delete s.c[i].bl; }, null, { undoable: false });
    } else if (op.k === 'ask') {
      this.askPrompt(seat, op);
    }
  }
  onOp(key, op) {
    if (!op || op.to !== this.mySeat) return;
    this.room.doneOp(key);
    this.applyOp(this.mySeat, op);
  }
  askPrompt(seat, op) {
    const side = this.sides[seat]; if (!side || !side.c[op.iid]) return;
    const what = { cementerio: 'destruir', destierro: 'desterrar', mano: 'devolver a tu mano' }[op.to2] || 'mover';
    const name = card(side.c[op.iid].k).name;
    const box = document.getElementById('toasts');
    const t = document.createElement('div'); t.className = 'toast';
    t.innerHTML = `<span>${esc(op.byName || 'Tu rival')} pide ${what} ${esc(name)}</span><button class="btn small primary">Aceptar</button><button class="btn small">Rechazar</button>`;
    const [ok, no] = t.querySelectorAll('button');
    ok.onclick = () => { t.remove(); this.doMove(seat, op.iid, op.to2); };
    no.onclick = () => { t.remove(); this.log(`rechazó ${what} {{${side.c[op.iid].k}}}`, seat); };
    box.appendChild(t);
    this.view.pulse(op.iid);
    setTimeout(() => t.remove(), 20000);
  }

  // ------------------------------------------------------------ moves
  doMove(seat, iid, to, opt = {}) {
    const side = this.sides[seat]; if (!side || !side.c[iid]) return;
    const from = zoneOf(side, iid);
    if (!from) return;
    const inst = side.c[iid];
    const willBePublic = PUBLIC.has(to) && !opt.fd;
    const r = willBePublic || (PUBLIC.has(from) && !inst.fd) || inst.rv ? `{{${inst.k}}}` : 'una carta';
    let msg;
    if (to === 'cementerio') msg = from === 'mano' ? `descartó ${r}` : IN_PLAY.has(from) ? `destruyó ${r}` : `puso ${r} en el cementerio`;
    else if (to === 'destierro') msg = `desterró ${r}`;
    else if (to === 'mano') msg = from === 'castillo' ? 'tomó una carta del castillo' : `devolvió ${r} a la mano`;
    else if (to === 'castillo') msg = `puso ${r} ${opt.bottom ? 'debajo' : 'encima'} del castillo`;
    else if (to === 'ataque' && from === 'defensa') msg = `atacó con ${r}`;
    else if (to === 'defensa' && from === 'ataque') msg = `devolvió ${r} a defensa`;
    else if (to === 'reserva' && from === 'mano') msg = `puso ${r} en la reserva de oro`;
    else if (to === 'pagado' && from === 'reserva') msg = `pagó con ${r}`;
    else if (from === 'mano' && LINES.includes(to)) msg = `jugó ${r} ${opt.fd ? 'boca abajo ' : ''}${ZTO[to]}`;
    else msg = `movió ${r} ${ZTO[to]}`;
    this.act(seat, s => { move(s, iid, to, opt); }, msg);
    if (to === 'ataque') this.enterBattle(seat);
  }
  enterBattle(seat) {
    const t = this.turn;
    if (t && t.p === seat && t.ph < PH.BATALLA && this.canDriveTurn()) this.setPhase(PH.BATALLA);
  }

  play(seat, iid, to, pay) {
    const side = this.sides[seat]; const inst = side.c[iid]; const c = card(inst.k);
    let paid = 0;
    this.act(seat, s => { paid = pay ? payGold(s, pay) : 0; move(s, iid, to); }, () => {
      const p = pay ? ` (pagó ${paid}${paid < pay ? ` de ${pay}` : ''})` : '';
      return `jugó {{${inst.k}}} ${ZTO[to]}${p}`;
    });
    if (pay && paid < pay) toast(`Solo había ${paid} oro${paid === 1 ? '' : 's'} en la reserva.`);
    this.view.landed(iid);
  }
  useTalisman(seat, iid, pay) {
    const inst = this.sides[seat].c[iid]; const c = card(inst.k);
    let paid = 0;
    this.fx({ t: 'show', k: inst.k, cap: `${this.nameOf(seat)} usa ${c.name}` });
    this.act(seat, s => { paid = pay ? payGold(s, pay) : 0; move(s, iid, 'cementerio'); },
      () => `usó el talismán {{${inst.k}}}${pay ? ` (pagó ${paid})` : ''}`);
  }
  startEquip(seat, iid, pay) {
    const side = this.sides[seat];
    const hosts = LINES.flatMap(z => side.z[z]).filter(i => i !== iid && card(side.c[i].k).type === T.ALIADO);
    if (!hosts.length) { toast('No tienes aliados en juego para equipar.'); return; }
    this.startPick('Elige el aliado que portará el arma', (s2, i2) => s2 === seat && hosts.includes(i2), (s2, i2) => this.equip(seat, iid, i2, pay), { seat, iid });
  }
  equip(seat, iid, host, pay) {
    const inst = this.sides[seat].c[iid]; const hostK = this.sides[seat].c[host].k;
    let paid = 0;
    this.act(seat, s => { paid = pay ? payGold(s, pay) : 0; attach(s, iid, host); }, () => `equipó {{${inst.k}}} a {{${hostK}}}${pay ? ` (pagó ${paid})` : ''}`);
  }
  draw(seat, n = 1) {
    if (!this.sides[seat].z.castillo.length) { toast('El castillo está vacío.'); return; }
    this.act(seat, s => drawN(s, n), k => `robó ${k === 1 ? 'una carta' : `${k} cartas`}`);
  }
  mill(seat, n, why = '') {
    if (n <= 0) return;
    this.act(seat, s => millN(s, n), k => `botó ${plural(k, 'carta', 'cartas')}${why}`);
    if (!this.sides[seat].z.castillo.length) this.fx({ t: 'banner', m: `El castillo de ${this.nameOf(seat)} cayó` });
  }
  banishTop(seat, n) { this.act(seat, s => millN(s, n, 'destierro'), k => `desterró ${plural(k, 'carta', 'cartas')} desde el castillo`); }
  shuffle(seat) {
    this.act(seat, s => shuffleCastle(s), 'barajó su castillo');
    this.fx({ t: 'shuffle', s: seat });
  }
  addCounter(seat, iid, d) {
    this.act(seat, s => { const x = (s.c[iid].x || 0) + d; if (x) s.c[iid].x = x; else delete s.c[iid].x; },
      () => `${d > 0 ? 'dio' : 'quitó'} ${Math.abs(d)} de fuerza a ${this.ref(seat, iid)}`);
  }
  payN(seat, n) { this.act(seat, s => payGold(s, n), k => `pagó ${plural(k, 'oro', 'oros')}`); }
  unpayAll(seat) { this.act(seat, s => { const n = s.z.pagado.length; for (const i of [...s.z.pagado]) move(s, i, 'reserva'); return n; }, k => `recuperó ${plural(k, 'oro', 'oros')}`); }
  revealHand(seat) {
    const side = this.sides[seat];
    if (!side.z.mano.length) return;
    this.fx({ t: 'reveal', ks: side.z.mano.map(i => side.c[i].k), cap: `Mano de ${this.nameOf(seat)}` });
    this.log(`reveló su mano (${plural(side.z.mano.length, 'carta', 'cartas')})`, seat);
  }
  revealCard(seat, iid) {
    const inst = this.sides[seat].c[iid];
    this.fx({ t: 'show', k: inst.k, cap: `${this.nameOf(seat)} revela` });
    this.act(seat, s => { s.c[iid].rv = 1; }, `reveló {{${inst.k}}}`, { undoable: false });
  }

  // ------------------------------------------------------------ turn & phases
  setTurn(t) {
    if (this.mode === 'online') { this.room.setTurn(t); return; }
    const prev = this.turn; this.turn = t; this.onTurn(prev, t);
  }
  setPhase(ph) {
    if (!this.turn) return;
    if (!this.canDriveTurn()) { toast('Solo el jugador activo cambia la fase.'); return; }
    if (ph === this.turn.ph) return;
    this.setTurn({ ...this.turn, ph });
  }
  nextPhase() {
    if (!this.turn) return;
    if (this.turn.ph >= PH.ROBAR) this.passTurn();
    else this.setPhase(this.turn.ph + 1);
  }
  endTurn() {
    if (!this.turn || !this.canDriveTurn()) return;
    if (this.turn.ph !== PH.ROBAR) this.setPhase(PH.ROBAR); else this.passTurn();
  }
  passTurn() {
    if (!this.turn || !this.canDriveTurn()) return;
    const t = { n: this.turn.n + 1, p: other(this.turn.p), ph: PH.AGRUP };
    this.log(`Turno ${t.n}: ${this.nameOf(t.p)}`, '', 'turn');
    this.setTurn(t);
  }
  onTurn(prev, t) {
    this.renderChrome();
    this.view.render();
    if (!t) return;
    const newTurn = !prev || prev.n !== t.n || prev.p !== t.p;
    if (newTurn && prev) {
      banner(this.mySeat === t.p && this.mode === 'online' ? 'Tu turno' : `Turno de ${this.nameOf(t.p)}`);
      for (const seat of ['p1', 'p2']) {
        const s = this.sides[seat];
        if (this.controls(seat) && s && s.z.defensa.some(i => s.c[i].bl)) this.applyOp(seat, { k: 'clearBlocks' });
      }
    }
    if (!this.opts.autoPhases) return;
    const seat = t.p;
    if (!this.controls(seat)) return;
    const side = this.sides[seat];
    if (!side || side.st === 'setup') return;
    const key = `${t.n}:${t.ph}`;
    if (side.au === key) return;
    if (t.ph === PH.AGRUP) {
      this.act(seat, s => { s.au = key; return agrupar(s); }, r => (r.gold || r.back) ? `agrupó: ${[r.gold && plural(r.gold, 'oro vuelve', 'oros vuelven') + ' a la reserva', r.back && plural(r.back, 'aliado vuelve', 'aliados vuelven') + ' a defensa'].filter(Boolean).join(', ')}` : 'agrupó', { undoable: false });
      setTimeout(() => { if (this.turn && this.turn.n === t.n && this.turn.ph === PH.AGRUP) this.setPhase(PH.VIGILIA); }, 650);
    } else if (t.ph === PH.ROBAR) {
      const empty = !side.z.castillo.length;
      this.act(seat, s => { s.au = key; return drawN(s, 1); }, k => k ? 'robó una carta para terminar el turno' : 'no pudo robar: castillo vacío', { undoable: false });
      if (this.sides[seat].z.mano.length > 8) toast('Tienes más de 8 cartas: descarta hasta 8 y luego pasa el turno.', { ms: 6000 });
      else if (!empty) setTimeout(() => { if (this.turn && this.turn.n === t.n && this.turn.ph === PH.ROBAR) this.passTurn(); }, 750);
    }
  }

  // ------------------------------------------------------------ pick mode (target another card)
  startPick(label, ok, done, from = null) {
    this.pick = { label, ok, done, from };
    toast(label + ' (Esc para cancelar)', { ms: 2600 });
    this.view.render(false);
    this.renderChrome();
  }
  cancelPick() { if (!this.pick) return; this.pick = null; this.view.render(false); this.renderChrome(); }
  pickClick(seat, iid) {
    const p = this.pick; if (!p) return;
    if (iid && p.ok(seat, iid)) { this.pick = null; this.view.render(false); this.renderChrome(); p.done(seat, iid); }
    else this.cancelPick();
  }

  // ------------------------------------------------------------ input from the board
  cardClick(seat, iid, zone, ev) {
    if (this.pick) { this.pickClick(seat, iid); return; }
    const side = this.sides[seat]; const inst = side && side.c[iid];
    if (!inst) return;
    const c = card(inst.k);
    const vis = this.view.visibleIn(seat, zone, inst);
    const mine = this.controls(seat);
    const x = ev.clientX, y = ev.clientY;
    if (zone === 'cementerio' || zone === 'destierro') { this.openZone(seat, zone); return; }
    const items = [{ title: vis ? c.name : 'Carta oculta' }];
    if (!mine) {
      if (vis) items.push({ label: 'Ver en grande', act: () => stage([inst.k], c.name, 2400) });
      if (this.isPlayer()) {
        if (IN_PLAY.has(zone)) {
          items.push('sep');
          if (zone === 'ataque') {
            const me = this.mode === 'solo' ? other(seat) : this.mySeat;
            const myDef = this.sides[me] ? this.sides[me].z.defensa : [];
            if (myDef.length) items.push({ label: 'Bloquear con…', cls: 'hot', act: () => this.startPick('Elige el aliado que bloquea', (s2, i2) => s2 === me && myDef.includes(i2), (s2, i2) => this.block(me, i2, iid)) });
          }
          if (this.mode === 'online') {
            items.push({ label: 'Pedir que lo destruya', act: () => this.ask(seat, iid, 'cementerio') });
            items.push({ label: 'Pedir que lo destierre', act: () => this.ask(seat, iid, 'destierro') });
            items.push({ label: 'Pedir que vuelva a su mano', act: () => this.ask(seat, iid, 'mano') });
          }
        }
        items.push({ label: 'Señalar esta carta', act: () => this.fx({ t: 'pulse', i: iid }) });
      }
      openMenu(x, y, items);
      return;
    }
    const pay = Math.max(0, c.cost);
    const reserve = side.z.reserva.length;
    const payHint = pay ? `paga ${pay}${reserve < pay ? ` (tienes ${reserve})` : ''}` : '';
    if (zone === 'mano') {
      if (c.type === T.ALIADO) {
        items.push({ label: 'Jugar a defensa', hint: payHint, cls: 'hot', act: () => this.play(seat, iid, 'defensa', pay) });
        if (pay) items.push({ label: 'Jugar sin pagar', act: () => this.play(seat, iid, 'defensa', 0) });
      } else if (c.type === T.TALISMAN) {
        items.push({ label: 'Usar talismán', hint: payHint, cls: 'hot', act: () => this.useTalisman(seat, iid, pay) });
        if (pay) items.push({ label: 'Usar sin pagar', act: () => this.useTalisman(seat, iid, 0) });
      } else if (c.type === T.TOTEM || c.type === T.MONUMENTO) {
        items.push({ label: 'Jugar a apoyo', hint: payHint, cls: 'hot', act: () => this.play(seat, iid, 'apoyo', pay) });
        if (pay) items.push({ label: 'Jugar sin pagar', act: () => this.play(seat, iid, 'apoyo', 0) });
      } else if (c.type === T.ARMA) {
        items.push({ label: 'Equipar a un aliado…', hint: payHint, cls: 'hot', act: () => this.startEquip(seat, iid, pay) });
        if (pay) items.push({ label: 'Equipar sin pagar…', act: () => this.startEquip(seat, iid, 0) });
      } else if (c.type === T.ORO) {
        items.push({ label: 'Poner en la reserva de oro', cls: 'hot', act: () => this.doMove(seat, iid, 'reserva') });
      }
      items.push({ label: 'Jugar boca abajo a…', act: () => openMenu(x, y, [{ title: 'Boca abajo a…' }, ...['defensa', 'apoyo'].map(z => ({ label: ZN[z], act: () => this.doMove(seat, iid, z, { fd: true }) }))]) });
      items.push('sep');
      items.push(inst.rv ? { label: 'Ocultar de nuevo', act: () => this.act(seat, s => { delete s.c[iid].rv; }, null, { undoable: false }) } : { label: 'Revelar', act: () => this.revealCard(seat, iid) });
      items.push({ label: 'Descartar', hint: 'al cementerio', act: () => this.doMove(seat, iid, 'cementerio') });
      items.push({ label: 'Desterrar', act: () => this.doMove(seat, iid, 'destierro') });
      items.push({ label: 'Encima del castillo', act: () => this.doMove(seat, iid, 'castillo') });
      items.push({ label: 'Debajo del castillo', act: () => this.doMove(seat, iid, 'castillo', { bottom: true }) });
    } else if (LINES.includes(zone) || zone === 'armas') {
      const isAlly = c.type === T.ALIADO;
      if (zone === 'defensa' && isAlly) items.push({ label: 'Atacar', hint: inst.nw ? 'recién jugado' : 'A', cls: inst.nw ? '' : 'hot', act: () => this.doMove(seat, iid, 'ataque') });
      if (zone === 'ataque') items.push({ label: 'Volver a defensa', cls: 'hot', act: () => this.doMove(seat, iid, 'defensa') });
      if (zone === 'defensa' && isAlly) {
        const opp = other(seat); const att = this.sides[opp] ? this.sides[opp].z.ataque : [];
        if (inst.bl) items.push({ label: 'Dejar de bloquear', act: () => this.block(seat, iid, null) });
        else if (att.length) items.push({ label: 'Bloquear a…', cls: 'hot', act: () => this.startPick('Elige el atacante que bloqueas', (s2, i2) => s2 === opp && att.includes(i2), (s2, i2) => this.block(seat, iid, i2), { seat, iid }) });
      }
      if (zone === 'armas') items.push({ label: 'Desequipar', hint: 'a apoyo', act: () => this.doMove(seat, iid, 'apoyo') });
      if (c.type === T.ARMA && zone !== 'armas') items.push({ label: 'Equipar a un aliado…', act: () => this.startEquip(seat, iid, 0) });
      if (isAlly || inst.x) {
        items.push({ label: '+1 a la fuerza', act: () => this.addCounter(seat, iid, 1) });
        items.push({ label: '−1 a la fuerza', act: () => this.addCounter(seat, iid, -1) });
        if (inst.x) items.push({ label: 'Quitar modificadores', act: () => this.act(seat, s => { delete s.c[iid].x; }, `quitó los modificadores de ${this.ref(seat, iid)}`) });
      }
      items.push('sep');
      for (const z of LINES) if (z !== zone && !(z === 'ataque' && zone !== 'defensa')) items.push({ label: `Mover a ${ZN[z].toLowerCase()}`, act: () => this.doMove(seat, iid, z) });
      items.push({ label: 'Destruir', hint: 'al cementerio', cls: 'warn', act: () => this.doMove(seat, iid, 'cementerio') });
      items.push({ label: 'Desterrar', act: () => this.doMove(seat, iid, 'destierro') });
      items.push({ label: 'Devolver a la mano', act: () => this.doMove(seat, iid, 'mano') });
      items.push({ label: 'Encima del castillo', act: () => this.doMove(seat, iid, 'castillo') });
      items.push({ label: inst.fd ? 'Poner boca arriba' : 'Poner boca abajo', act: () => this.act(seat, s => { if (s.c[iid].fd) delete s.c[iid].fd; else s.c[iid].fd = 1; }, inst.fd ? `dio vuelta {{${inst.k}}}` : 'puso una carta boca abajo') });
      items.push({ label: inst.r ? 'Enderezar' : 'Girar', act: () => this.act(seat, s => { if (s.c[iid].r) delete s.c[iid].r; else s.c[iid].r = 1; }, null) });
      items.push({ label: 'Señalar…', act: () => this.startPick('Elige a qué carta apuntas', () => true, (s2, i2) => this.fx({ t: 'point', a: iid, b: i2 }), { seat, iid }) });
    } else if (zone === 'reserva') {
      items.push({ label: 'Pagar con este oro', cls: 'hot', act: () => this.doMove(seat, iid, 'pagado') });
      items.push({ num: { label: 'Pagar', value: Math.min(2, side.z.reserva.length), max: side.z.reserva.length, act: n => this.payN(seat, n) } });
      items.push('sep');
      items.push({ label: 'Destruir', cls: 'warn', act: () => this.doMove(seat, iid, 'cementerio') });
      items.push({ label: 'Desterrar', act: () => this.doMove(seat, iid, 'destierro') });
      items.push({ label: 'Devolver a la mano', act: () => this.doMove(seat, iid, 'mano') });
    } else if (zone === 'pagado') {
      items.push({ label: 'Devolver a la reserva', cls: 'hot', act: () => this.doMove(seat, iid, 'reserva') });
      items.push({ label: 'Recuperar todo el oro pagado', act: () => this.unpayAll(seat) });
      items.push('sep');
      items.push({ label: 'Destruir', cls: 'warn', act: () => this.doMove(seat, iid, 'cementerio') });
      items.push({ label: 'Desterrar', act: () => this.doMove(seat, iid, 'destierro') });
    }
    openMenu(x, y, items);
  }

  zoneClick(seat, zone, ev) {
    if (this.pick) { this.cancelPick(); return; }
    const side = this.sides[seat]; if (!side) return;
    const mine = this.controls(seat);
    const x = ev.clientX, y = ev.clientY;
    if (zone === 'cementerio' || zone === 'destierro') { this.openZone(seat, zone); return; }
    if (zone === 'castillo') {
      const n = side.z.castillo.length;
      if (!mine) { openMenu(x, y, [{ title: `Castillo de ${this.nameOf(seat)}` }, { label: `${plural(n, 'carta', 'cartas')}`, disabled: true }]); return; }
      openMenu(x, y, [
        { title: `Castillo: ${plural(n, 'carta', 'cartas')}` },
        { label: 'Robar 1', hint: 'R', cls: 'hot', disabled: !n, act: () => this.draw(seat, 1) },
        { num: { label: 'Robar', value: 2, max: n, act: k => this.draw(seat, k) } },
        { num: { label: 'Botar', value: 1, max: n, act: k => this.mill(seat, k) } },
        { label: 'Barajar', hint: 'S', act: () => this.shuffle(seat) },
        'sep',
        { num: { label: 'Ver las primeras', value: 3, max: n, act: k => this.openZone(seat, 'castillo', { top: k }) } },
        { label: 'Buscar en el castillo…', act: () => this.openZone(seat, 'castillo', { search: true }) },
        { label: 'Revelar la primera', disabled: !n, act: () => { const id = side.z.castillo[0]; this.fx({ t: 'show', k: side.c[id].k, cap: `${this.nameOf(seat)} revela la primera de su castillo` }); this.log(`reveló la primera carta de su castillo: {{${side.c[id].k}}}`, seat); } },
        { num: { label: 'Desterrar las primeras', value: 1, max: n, act: k => this.banishTop(seat, k) } },
      ]);
      return;
    }
    if (!mine) return;
    if (zone === 'reserva') {
      openMenu(x, y, [{ title: `Reserva de oro: ${side.z.reserva.length}` },
        { num: { label: 'Pagar', value: Math.min(2, side.z.reserva.length), max: side.z.reserva.length, act: n => this.payN(seat, n) } },
        { label: 'Recuperar todo el oro pagado', act: () => this.unpayAll(seat) }]);
    } else if (zone === 'pagado') {
      openMenu(x, y, [{ title: `Oro pagado: ${side.z.pagado.length}` }, { label: 'Recuperar todo el oro pagado', cls: 'hot', act: () => this.unpayAll(seat) }]);
    } else if (zone === 'mano') {
      openMenu(x, y, [{ title: 'Mano' }, { label: 'Revelar mi mano', act: () => this.revealHand(seat) },
        this.opts.testCards ? { label: 'Agregar una carta de prueba…', act: () => this.openAddCard(seat) } : null]);
    } else if (LINES.includes(zone)) {
      const allies = side.z.defensa.filter(i => card(side.c[i].k).type === T.ALIADO && !side.c[i].nw);
      openMenu(x, y, [{ title: ZN[zone] },
        zone === 'defensa' && allies.length ? { label: 'Atacar con todos los listos', act: () => this.attackAll(seat) } : null,
        zone === 'ataque' && side.z.ataque.length ? { label: 'Volver todos a defensa', act: () => this.act(seat, s => { for (const i of [...s.z.ataque]) move(s, i, 'defensa'); }, 'retiró su ataque') } : null,
        this.opts.testCards ? { label: 'Agregar una carta de prueba…', act: () => this.openAddCard(seat, zone) } : null].filter(Boolean));
    }
  }

  toolClick(seat, act) {
    if (!this.controls(seat)) return;
    if (act === 'draw') this.draw(seat, 1);
    if (act === 'mill') promptNumber('Botar cartas', 'Pasan del castillo al cementerio.', 1, this.sides[seat].z.castillo.length).then(n => n && this.mill(seat, n));
  }

  drop(seat, iid, fromZone, to, index, host) {
    if (!this.controls(seat)) return;
    const side = this.sides[seat];
    if (host) {
      const c = card(side.c[iid].k);
      const pay = fromZone === 'mano' ? Math.max(0, c.cost) : 0;
      this.equip(seat, iid, host, pay);
      return;
    }
    if (to === 'castillo' && fromZone === 'castillo') return;
    if (fromZone === 'castillo') {
      if (to === 'mano') { this.draw(seat, 1); return; }
      const msg = to === 'cementerio' ? 'botó 1 carta' : `puso la primera carta del castillo ${ZTO[to]}`;
      this.act(seat, s => { move(s, iid, to); }, msg + (PUBLIC.has(to) ? `: {{${side.c[iid].k}}}` : ''));
      return;
    }
    if (fromZone === to || (fromZone === 'armas' && LINES.includes(to) && to === zoneOf(side, side.c[iid].at || ''))) {
      // reorder within the same zone
      if (index == null || fromZone === 'armas') return;
      this.act(seat, s => { const a = s.z[to]; a.splice(a.indexOf(iid), 1); a.splice(Math.min(index, a.length), 0, iid); }, null);
      return;
    }
    const c = card(side.c[iid].k);
    if (fromZone === 'mano' && (LINES.includes(to)) && this.opts.autoPay !== false) {
      if (c.type === T.TALISMAN && to !== 'apoyo') { this.useTalisman(seat, iid, Math.max(0, c.cost)); return; }
      if (c.type !== T.ORO) { this.play(seat, iid, to, Math.max(0, c.cost)); return; }
    }
    this.act(seat, s => { move(s, iid, to, { index }); }, () => {
      const r = (PUBLIC.has(to) || PUBLIC.has(fromZone)) ? `{{${side.c[iid].k}}}` : 'una carta';
      if (to === 'ataque' && fromZone === 'defensa') { setTimeout(() => this.enterBattle(seat), 0); return `atacó con ${r}`; }
      if (to === 'cementerio') return fromZone === 'mano' ? `descartó ${r}` : `destruyó ${r}`;
      if (to === 'destierro') return `desterró ${r}`;
      if (to === 'pagado' && fromZone === 'reserva') return `pagó con ${r}`;
      return `movió ${r} ${ZTO[to]}`;
    });
  }

  attackAll(seat) {
    const side = this.sides[seat];
    const ids = side.z.defensa.filter(i => card(side.c[i].k).type === T.ALIADO && !side.c[i].nw && !side.c[i].bl);
    if (!ids.length) return;
    this.act(seat, s => { for (const i of ids) move(s, i, 'ataque'); }, `atacó con ${ids.map(i => `{{${side.c[i].k}}}`).join(', ')}`);
    this.enterBattle(seat);
  }
  block(seat, blocker, attacker) {
    const side = this.sides[seat];
    const opp = this.sides[other(seat)];
    this.act(seat, s => { if (attacker) s.c[blocker].bl = attacker; else delete s.c[blocker].bl; },
      attacker ? `bloquea a {{${opp.c[attacker].k}}} con {{${side.c[blocker].k}}}` : `dejó de bloquear con {{${side.c[blocker].k}}}`);
  }
  ask(seat, iid, to2) {
    this.route(seat, { k: 'ask', iid, to2 });
    const what = { cementerio: 'que destruya', destierro: 'que destierre', mano: 'que devuelva a la mano' }[to2];
    this.log(`pidió ${what} ${this.ref(seat, iid)}`, this.mySeat);
    toast('Solicitud enviada.');
  }

  // ------------------------------------------------------------ zone viewer (cementerio, destierro, castillo)
  openZone(seat, zone, { top = 0, search = false } = {}) {
    const side = this.sides[seat]; if (!side) return;
    const mine = this.controls(seat);
    if (zone === 'castillo' && !mine) return;
    let ids = [...side.z[zone]];
    if (zone === 'castillo' && top) ids = ids.slice(0, top);
    if (zone === 'cementerio' || zone === 'destierro') ids.reverse();
    const title = zone === 'castillo' ? (top ? `Primeras ${ids.length} del castillo` : 'Buscar en el castillo') : `${ZN[zone]} de ${this.nameOf(seat)}`;
    if (zone === 'castillo') this.log(top ? `miró las primeras ${plural(ids.length, 'carta', 'cartas')} de su castillo` : 'está buscando en su castillo', seat);
    let shuffleOnClose = zone === 'castillo' && search;
    const box = openModal(`<h2>${esc(title)}</h2>
      <p>${ids.length ? (mine ? 'Haz clic en una carta para moverla.' : 'Pasa el cursor para leer las cartas.') : 'No hay cartas aquí.'}${zone !== 'castillo' ? ' La más reciente aparece primero.' : top ? ' En orden, de arriba hacia abajo.' : ''}</p>
      <div style="display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:16px;align-items:start">
        <div class="mgrid">${ids.map((id, i) => `<div class="mcard" data-i="${id}"><span class="mname">${esc(card(side.c[id].k).name)}</span><img src="${THUMB(side.c[id].k)}" data-k="${side.c[id].k}" alt="${esc(card(side.c[id].k).name)}" loading="lazy">${zone === 'castillo' && top ? `<span class="mi">${i + 1}</span>` : ''}</div>`).join('')}</div>
        <div class="zprev"></div>
      </div>
      <div class="modal-foot">${zone === 'castillo' && search ? '<label class="check" style="margin-right:auto"><input type="checkbox" id="zShuf" checked> Barajar al cerrar</label>' : ''}
      ${zone === 'castillo' && top ? '<button class="btn" data-x="tobottom">Todas debajo</button>' : ''}<button class="btn primary" data-x="close">Cerrar</button></div>`,
    { onClose: () => { if (shuffleOnClose && this.sides[seat]) this.shuffle(seat); } });
    const prev = box.querySelector('.zprev');
    const showPrev = id => {
      const c = card(side.c[id].k);
      prev.innerHTML = `<img src="${IMG(c.key)}" alt="" style="width:100%;border-radius:4.5%/3.2%;box-shadow:0 10px 26px rgba(0,0,0,.5)"><h3 style="font:700 18px var(--serif);margin:8px 0 4px">${esc(c.name)}</h3><div style="font:14px/1.45 var(--serif);color:var(--parch-2)">${textHTML(c, esc)}</div>`;
    };
    ids.length && showPrev(ids[0]);
    const sh = box.querySelector('#zShuf'); sh && (sh.onchange = () => { shuffleOnClose = sh.checked; });
    box.querySelector('[data-x=close]').onclick = () => closeModal();
    const tb = box.querySelector('[data-x=tobottom]');
    tb && (tb.onclick = () => { closeModal(); this.act(seat, s => { for (const id of ids) move(s, id, 'castillo', { bottom: true }); }, `puso ${plural(ids.length, 'carta', 'cartas')} debajo del castillo`); });
    box.querySelector('.mgrid').addEventListener('pointerover', e => { const m = e.target.closest('.mcard'); m && showPrev(m.dataset.i); });
    if (!mine) return;
    box.querySelector('.mgrid').addEventListener('click', e => {
      const m = e.target.closest('.mcard'); if (!m) return;
      const id = m.dataset.i;
      const dests = [['mano', 'A la mano'], ['defensa', 'A defensa'], ['apoyo', 'A apoyo'], ['reserva', 'A la reserva de oro'], ['cementerio', 'Al cementerio'], ['destierro', 'Al destierro'], ['castillo', 'Encima del castillo'], ['castillo-b', 'Debajo del castillo']]
        .filter(([z]) => z.split('-')[0] !== zone || z === 'castillo-b');
      openMenu(e.clientX, e.clientY, [{ title: card(side.c[id].k).name }, ...dests.map(([z, l]) => ({ label: l, act: () => {
        const real = z.split('-')[0];
        if (zone === 'castillo' && real !== 'castillo') shuffleOnClose = shuffleOnClose && !!box.querySelector('#zShuf')?.checked;
        this.doMove(seat, id, real, { bottom: z === 'castillo-b' });
        m.remove();
      } }))]);
    });
  }

  // ------------------------------------------------------------ testing: add any card
  openAddCard(seat, zone = 'mano') {
    let results = [];
    const box = openModal(`<h2>Agregar una carta de prueba</h2><p>Busca cualquier carta de cualquier edición y ponla en la mesa. Queda registrado en el historial.</p>
      <div style="display:flex;gap:8px;margin-bottom:12px"><input id="acQ" placeholder="Nombre de la carta" style="flex:1" autofocus>
      <select id="acZ">${['mano', 'defensa', 'apoyo', 'reserva', 'castillo', 'cementerio'].map(z => `<option value="${z}" ${z === zone ? 'selected' : ''}>${ZN[z]}</option>`).join('')}</select></div>
      <div class="mgrid" id="acGrid"></div><div class="modal-foot"><button class="btn" data-x="close">Cerrar</button></div>`);
    const q = box.querySelector('#acQ'); const grid = box.querySelector('#acGrid'); const zsel = box.querySelector('#acZ');
    const run = () => {
      results = searchCards({ q: q.value, unique: true }).slice(0, 48);
      grid.innerHTML = results.map(c => `<div class="mcard" data-k="${c.key}" title="${esc(c.name)}"><span class="mname">${esc(c.name)}</span><img src="${THUMB(c.key)}" data-k="${c.key}" alt="${esc(c.name)}" loading="lazy"></div>`).join('');
    };
    let t; q.oninput = () => { clearTimeout(t); t = setTimeout(run, 160); };
    box.querySelector('[data-x=close]').onclick = () => closeModal();
    grid.onclick = e => {
      const m = e.target.closest('.mcard'); if (!m) return;
      const k = m.dataset.k; const z = zsel.value;
      this.act(seat, s => {
        const L = seat === 'p1' ? 'A' : 'B';
        let n = Object.keys(s.c).length; while (s.c[`${L}t${n}`]) n++;
        const id = `${L}t${n}`;
        s.c[id] = { k }; s.z[z === 'castillo' ? 'castillo' : z].push(id);
        if (z === 'castillo') { s.z.castillo.pop(); s.z.castillo.unshift(id); }
      }, `agregó {{${k}}} ${ZTO[z]} (prueba)`);
      m.classList.add('picked');
    };
    run();
  }

  // ------------------------------------------------------------ battle resolver
  openBattle() {
    if (!this.turn) return;
    const attS = this.turn.p, defS = other(attS);
    const A = this.sides[attS], D = this.sides[defS];
    if (!A || !D) return;
    if (!A.z.ataque.length) { toast(`${this.nameOf(attS)} no tiene aliados en la línea de ataque.`); return; }
    const mods = {};
    let kill = null;
    const box = openModal('<div id="bt"></div>');
    const draw = () => {
      const r = computeBattle(this.sides[attS], this.sides[defS], mods);
      if (!kill) { kill = {}; for (const p of r.pairs) { if (p.aDead) kill[p.a] = 1; if (p.bDead) for (const b of p.blockers) kill[b] = 1; } }
      else { for (const p of r.pairs) { kill[p.a] = p.aDead ? 1 : 0; for (const b of p.blockers) kill[b] = p.bDead ? 1 : 0; } }
      const unit = (side, seat, id, val) => {
        const c = card(side.c[id].k);
        return `<div class="bunit ${kill[id] ? 'dead' : ''}"><img src="${THUMB(c.key)}" data-k="${c.key}" alt=""><div><div class="bn">${esc(c.name)}</div>
          <div class="bs"><button class="qbtn" data-m="${id}" data-d="-1">−</button><b>${val}</b><button class="qbtn" data-m="${id}" data-d="1">+</button>
          <label class="check" style="margin-left:6px;font-size:12px"><input type="checkbox" data-k="${id}" ${kill[id] ? 'checked' : ''}> destruir</label></div></div></div>`;
      };
      box.querySelector('#bt').innerHTML = `<h2>Batalla mitológica</h2><p>${esc(this.nameOf(attS))} ataca a ${esc(this.nameOf(defS))}. Ajusta la fuerza si alguna habilidad o talismán la cambió; el resultado se recalcula.</p>
        <div class="battle-list">${r.pairs.map(p => `<div class="bpair">
          ${unit(this.sides[attS], attS, p.a, p.sa)}
          <div class="bvs">${p.blockers.length ? 'bloqueado por' : 'sin bloqueo'}<div class="bres">${p.dmg ? `${p.dmg} de daño` : '—'}</div></div>
          <div>${p.blockers.length ? p.blockers.map(b => unit(this.sides[defS], defS, b, strength(this.sides[defS], b) + (mods[b] || 0))).join('') : `<span style="color:var(--parch-3);font-style:italic">Directo al castillo</span>`}</div>
        </div>`).join('')}</div>
        <div class="bsum">Daño al castillo de ${esc(this.nameOf(defS))}: <b>${r.dmg}</b> ${r.dmg ? `(botará ${plural(r.dmg, 'carta', 'cartas')})` : ''}</div>
        <div class="modal-foot"><button class="btn" data-x="close">Cerrar</button><button class="btn primary" data-x="apply">Aplicar resultado</button></div>`;
      box.querySelector('[data-x=close]').onclick = () => closeModal();
      box.querySelector('[data-x=apply]').onclick = () => { closeModal(); this.applyBattle(attS, defS, r, kill); };
      box.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { mods[b.dataset.m] = (mods[b.dataset.m] || 0) + (+b.dataset.d); draw(); });
      box.querySelectorAll('[data-k]').forEach(c => c.onchange = () => { kill[c.dataset.k] = c.checked ? 1 : 0; c.closest('.bunit').classList.toggle('dead', c.checked); });
    };
    draw();
  }
  applyBattle(attS, defS, r, kill) {
    const deadA = r.pairs.map(p => p.a).filter(id => kill[id]);
    const deadD = r.pairs.flatMap(p => p.blockers).filter(id => kill[id]);
    this.log(`resolvió la batalla: ${r.dmg} de daño al castillo de ${this.nameOf(defS)}`, this.controls(attS) ? attS : defS);
    if (deadA.length) this.route(attS, { k: 'destroy', ids: deadA });
    if (deadD.length) this.route(defS, { k: 'destroy', ids: deadD });
    if (r.dmg) this.route(defS, { k: 'mill', n: r.dmg });
    this.route(defS, { k: 'clearBlocks' });
  }

  // ------------------------------------------------------------ setup helpers
  pickOroInicial(side, auto = false) {
    const sug = suggestOroInicial(side);
    if (!sug) return Promise.resolve(null);
    if (auto) return Promise.resolve(sug);
    const seen = new Set();
    const golds = side.z.castillo.filter(id => { const c = card(side.c[id].k); if (c.type !== T.ORO || seen.has(c.key)) return false; seen.add(c.key); return true; });
    return new Promise(res => {
      let pick = sug, done = false;
      const box = openModal(`<h2>Elige tu oro inicial</h2><p>Empieza en tu reserva de oro. Marcamos uno sugerido.</p>
        <div class="mgrid">${golds.map(id => `<div class="mcard ${id === sug ? 'picked' : ''}" data-i="${id}" title="${esc(card(side.c[id].k).name)}"><span class="mname">${esc(card(side.c[id].k).name)}</span><img src="${THUMB(side.c[id].k)}" data-k="${side.c[id].k}" alt=""></div>`).join('')}</div>
        <div class="modal-foot"><button class="btn" data-x="none">Sin oro inicial</button><button class="btn primary" data-x="ok">Usar este oro</button></div>`,
      { dismiss: false, onClose: () => { if (!done) res(pick); } });
      box.querySelector('.mgrid').onclick = e => {
        const m = e.target.closest('.mcard'); if (!m) return;
        pick = m.dataset.i; box.querySelectorAll('.mcard').forEach(x => x.classList.toggle('picked', x === m));
      };
      box.querySelector('[data-x=ok]').onclick = () => { done = true; closeModal(); res(pick); };
      box.querySelector('[data-x=none]').onclick = () => { done = true; closeModal(); res(null); };
    });
  }

  async startSolo(deckA, deckB) {
    const g = 1;
    let a = buildSide('p1', this.me || 'Jugador 1', deckA.name, deckKeys(deckA.cards), g);
    let b = deckB ? buildSide('p2', 'Rival de prueba', deckB.name, deckKeys(deckB.cards), g) : buildSide('p2', 'Rival de prueba', 'Sin mazo', [], g);
    this.sides = { p1: a, p2: b };
    preloadThumbs([...new Set([...Object.values(a.c), ...Object.values(b.c)].map(i => i.k))]);
    this.view.render(false);
    const oiA = this.opts.oroInicial ? await this.pickOroInicial(a) : null;
    setupSide(a, { oroInicial: oiA, hand: this.opts.hand });
    setupSide(b, { oroInicial: this.opts.oroInicial ? suggestOroInicial(b) : null, hand: deckB ? this.opts.hand : 0 });
    b.st = 'play';
    this.sides = { p1: a, p2: b };
    this.log('Prueba solo: controlas ambos lados de la mesa.', '', 'sys');
    this.log(`preparó su mesa${oiA ? ` con {{${a.c[oiA].k}}} como oro inicial` : ''} y robó ${a.z.mano.length}`, 'p1');
    this.turn = { n: 1, p: 'p1', ph: PH.VIGILIA };
    this.view.render();
    this.renderChrome();
  }
  keepHand(seat) {
    this.act(seat, s => { s.st = 'play'; }, s => null, { undoable: false });
    this.log(this.sides[seat].mull ? `se quedó con ${plural(this.sides[seat].z.mano.length, 'carta', 'cartas')}` : 'se quedó con su mano', seat);
  }
  doMulligan(seat) {
    this.act(seat, s => mulligan(s), k => `hizo mulligan y robó ${k}`);
  }

  // ------------------------------------------------------------ online room
  async openOnline() {
    this.room = new Room(this.code, {
      meta: v => this.onMeta(v),
      seats: v => { this.seats = v; this.ensureMySeat(); this.renderLobby(); this.renderChrome(); },
      members: v => { this.members = v; this.renderChrome(); this.renderLobby(); },
      turn: v => { const prev = this.turn; this.turn = v || null; this.onTurn(prev, this.turn); },
      side: (seat, v) => this.onSide(seat, v),
      log: (k, v) => v && this.addFeed(v, k),
      fx: v => { if (v && v.cid !== this.cid) this.playFx(v); },
      op: (k, v) => this.onOp(k, v),
    });
    await this.room.open(this.me);
    this.ensureMySeat();
  }
  ensureMySeat() {
    if (!this.room) return;
    const uid = this.room.uid;
    const was = this.mySeat;
    this.mySeat = ['p1', 'p2'].find(s => this.seats[s] && this.seats[s].uid === uid) || null;
    if (was !== this.mySeat) { this.view.ready = false; this.view.render(false); this.maybeInit(); }
    if (this.mySeat) this.applyPendingDeck();
  }
  // A deck handed over from a draft. Sitting down puts it in the claim transaction; a seat you
  // already hold (the host's, made with the room) gets it here.
  takePendingDeck() {
    let p = null;
    try { p = JSON.parse(sessionStorage.getItem('myl.pendingDeck') || 'null'); sessionStorage.removeItem('myl.pendingDeck'); } catch { p = null; }
    return p && p.code ? { name: p.name, code: p.code, n: p.n } : null;
  }
  putPendingDeck(p) { try { sessionStorage.setItem('myl.pendingDeck', JSON.stringify(p)); } catch { /* storage off */ } }
  applyPendingDeck() {
    if (!this.mySeat || !this.meta || this.meta.status !== 'lobby') return;
    const seat = this.seats[this.mySeat];
    if (!seat || seat.uid !== this.room.uid) return;
    const p = this.takePendingDeck();
    if (!p) return;
    this.room.updateSeat(this.mySeat, { deck: p, ready: true });
    toast(`Tu mazo del draft está listo: ${p.name}`);
  }
  onMeta(v) {
    const prev = this.meta;
    this.meta = v;
    if (!prev && v && this.mySeat) setTimeout(() => this.applyPendingDeck(), 0);
    if (!v) { toast('La mesa ya no existe.', { err: true }); return; }
    if (prev && prev.game !== v.game) { this.undo = { p1: [], p2: [] }; this.undoOrder = []; }
    this.renderLobby();
    this.renderChrome();
    this.view.render(false);
    this.maybeInit();
  }
  onSide(seat, v) {
    let s = v ? fixSide(v) : null;
    if (s && this.meta && s.g !== this.meta.game) s = null;
    const cur = this.sides[seat];
    if (seat === this.mySeat && cur && s && s.seq < cur.seq) return; // stale echo
    this.sides[seat] = s;
    this.view.render();
    this.renderChrome();
    if (seat === this.mySeat) this.maybeInit();
  }
  async maybeInit() {
    if (this.mode !== 'online' || !this.meta || this.meta.status !== 'duel' || !this.mySeat || this.initing) return;
    const mine = this.sides[this.mySeat];
    if (mine && mine.g === this.meta.game) return;
    const seat = this.seats[this.mySeat];
    if (!seat || !seat.deck) return;
    this.initing = true;
    try {
      const cards = decodeDeck(seat.deck.code) || {};
      const side = buildSide(this.mySeat, this.me, seat.deck.name || 'Mazo', deckKeys(cards), this.meta.game);
      preloadThumbs(Object.keys(cards));
      const oi = this.opts.oroInicial ? await this.pickOroInicial(side) : null;
      if (this.meta.status !== 'duel') return;
      setupSide(side, { oroInicial: oi, hand: this.opts.hand || 8 });
      this.undo[this.mySeat] = [];
      this.sides[this.mySeat] = side;
      await this.room.setSide(this.mySeat, side);
      this.log(`preparó su mesa${oi ? ` con {{${side.c[oi].k}}} como oro inicial` : ''} y robó ${side.z.mano.length}`, this.mySeat);
      this.view.render(); this.renderChrome();
    } finally { this.initing = false; }
  }
  isHost() { return this.mode === 'online' && this.meta && this.room && this.meta.host === this.room.uid; }

  renderLobby() {
    const L = $('#lobby');
    if (this.mode !== 'online' || !this.meta || this.meta.status !== 'lobby') { L.hidden = true; return; }
    L.hidden = false;
    const host = this.isHost();
    const link = `${location.origin}${location.pathname}?t=${this.code}`;
    const seatHtml = s => {
      const st = this.seats[s];
      const me = this.mySeat === s;
      const on = st && this.members[st.uid];
      const deck = st && st.deck;
      return `<div class="seat ${st && st.ready ? 'ready' : ''}">
        <h3>${s === 'p1' ? 'Jugador 1' : 'Jugador 2'}${st && !on ? ' (desconectado)' : ''}</h3>
        <div class="who ${st ? '' : 'free'}">${st ? esc(st.name) : 'Asiento libre'}</div>
        ${st ? `<div class="deckline">${deck ? `Mazo: <b>${esc(deck.name)}</b> (${deck.n} cartas)` : 'Aún sin mazo'}${st.ready ? ' · listo' : ''}</div>` : ''}
        <div class="row-btns">
          ${me ? `<button class="btn" data-l="deck">${deck ? 'Cambiar mazo' : 'Elegir mazo'}</button>
                  <button class="btn ${st.ready ? 'on' : ''}" data-l="ready" ${deck ? '' : 'disabled'}>${st.ready ? 'Listo ✓' : 'Estoy listo'}</button>
                  <button class="btn ghost" data-l="leave">Dejar asiento</button>` : ''}
          ${!st && !this.mySeat ? `<button class="btn primary" data-l="sit" data-s="${s}">Sentarme aquí</button>` : ''}
        </div></div>`;
    };
    const both = ['p1', 'p2'].every(s => this.seats[s] && this.seats[s].deck);
    const o = this.opts;
    const specs = Object.entries(this.members).filter(([uid]) => !['p1', 'p2'].some(s => this.seats[s] && this.seats[s].uid === uid)).map(([, m]) => m.name);
    L.innerHTML = `<div class="lobby-box">
      <h2>Mesa ${esc(this.code)}</h2>
      <p class="sub">Comparte el enlace. Quien entre sin asiento mira la partida como espectador.</p>
      <div class="invite"><code>${esc(this.code)}</code><button class="btn" data-l="copy">Copiar enlace</button><span style="color:var(--parch-3);font-size:13px">${esc(link)}</span></div>
      <div class="seats">${seatHtml('p1')}${seatHtml('p2')}</div>
      <div class="lobby-opts">
        <label class="check"><input type="checkbox" data-o="oroInicial" ${o.oroInicial ? 'checked' : ''} ${host ? '' : 'disabled'}> Oro inicial en la reserva</label>
        <label class="check"><input type="checkbox" data-o="autoPhases" ${o.autoPhases ? 'checked' : ''} ${host ? '' : 'disabled'}> Automatizar agrupación y robo</label>
        <label class="check"><input type="checkbox" data-o="specHands" ${o.specHands ? 'checked' : ''} ${host ? '' : 'disabled'}> Espectadores ven las manos</label>
        <label class="check"><input type="checkbox" data-o="testCards" ${o.testCards ? 'checked' : ''} ${host ? '' : 'disabled'}> Permitir cartas de prueba</label>
        <label class="check">Mano inicial <input type="number" data-o="hand" min="0" max="15" value="${o.hand}" style="width:64px" ${host ? '' : 'disabled'}></label>
      </div>
      <div class="lobby-foot"><span class="note">${specs.length ? `Mirando: ${specs.map(esc).join(', ')}` : 'Nadie mirando todavía.'}</span>
        ${host ? `<button class="btn primary big" data-l="start" ${both ? '' : 'disabled'}>Empezar duelo</button>` : `<span class="note">${both ? 'Esperando que el anfitrión empiece.' : 'Esperando a los jugadores.'}</span>`}
      </div></div>`;
    L.onclick = async e => {
      const b = e.target.closest('[data-l]'); if (!b) return;
      const a = b.dataset.l;
      if (a === 'copy') { (await copyText(link)) ? toast('Enlace copiado.') : toast(link, { ms: 8000 }); }
      if (a === 'sit') {
        const p = this.takePendingDeck();
        const ok = await this.room.claimSeat(b.dataset.s, this.me, p ? { deck: p, ready: true } : null);
        if (ok) { this.ensureMySeat(); if (p) toast(`Tu mazo del draft está listo: ${p.name}`); }
        else { if (p) this.putPendingDeck(p); toast('Ese asiento se acaba de ocupar.'); }
      }
      if (a === 'leave') { await this.room.leaveSeat(this.mySeat); }
      if (a === 'ready') { const st = this.seats[this.mySeat]; this.room.updateSeat(this.mySeat, { ready: !st.ready }); }
      if (a === 'deck') { const d = await this.app.chooseDeck('Elige tu mazo para esta mesa'); if (d) this.room.updateSeat(this.mySeat, { deck: { name: d.name, code: encodeDeck(d.cards), n: deckSize(d) }, ready: false }); }
      if (a === 'start') this.startDuel();
    };
    L.onchange = e => {
      const i = e.target.closest('[data-o]'); if (!i || !host) return;
      const val = i.type === 'checkbox' ? i.checked : Math.max(0, Math.min(15, parseInt(i.value, 10) || 0));
      this.room.updateMeta({ [`opts/${i.dataset.o}`]: val });
    };
  }
  async startDuel() {
    if (!this.isHost()) return;
    const first = Math.random() < .5 ? 'p1' : 'p2';
    const g = (this.meta.game || 0) + 1;
    await this.room.resetGame();
    await this.room.updateMeta({ status: 'duel', game: g, first });
    await this.room.setTurn({ n: 1, p: first, ph: PH.VIGILIA });
    this.log(`Duelo ${g}: empieza ${this.nameOf(first)}`, '', 'sys');
    this.fx({ t: 'coin', r: this.nameOf(first), cap: 'Empieza' });
  }
  async backToLobby() {
    if (!this.isHost()) return;
    if (!(await confirmBox('Volver a la sala', 'Se termina el duelo actual para que puedan cambiar de mazo.', 'Volver a la sala'))) return;
    await this.room.resetGame();
    await this.room.updateMeta({ status: 'lobby' });
    for (const s of ['p1', 'p2']) if (this.seats[s]) this.room.updateSeat(s, { ready: false });
    await this.room.setTurn(null);
  }
  async rematch() {
    if (this.mode === 'solo') { this.app.restartSolo(); return; }
    if (!this.isHost()) return;
    if (!(await confirmBox('Revancha', 'Ambos vuelven a empezar con los mismos mazos.', 'Empezar revancha'))) return;
    this.startDuel();
  }

  // ------------------------------------------------------------ chrome: midbar, rail
  bindChrome() {
    $('#chatForm').onsubmit = e => { e.preventDefault(); const v = $('#chatIn').value.trim(); if (v) { this.chat(v); $('#chatIn').value = ''; } };
    $('#feed').onpointerover = e => { const r = e.target.closest('.card-ref'); r && inspectCard(r.dataset.key); };
    $('#midbar').onclick = e => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      const a = b.dataset.m;
      if (a === 'phase') this.setPhase(+b.dataset.ph);
      if (a === 'next') this.nextPhase();
      if (a === 'end') this.endTurn();
      if (a === 'battle') this.openBattle();
      if (a === 'keep') this.keepHand(b.dataset.s);
      if (a === 'mull') this.doMulligan(b.dataset.s);
      if (a === 'cancelpick') this.cancelPick();
      if (a === 'rail') $('#rail').classList.toggle('open');
    };
    $('#railTools').onclick = e => { const b = e.target.closest('[data-r]'); b && this.railTool(b.dataset.r, b); };
    $('#railHead').onclick = async e => {
      const b = e.target.closest('[data-r]'); if (!b) return;
      if (b.dataset.r === 'close') { $('#rail').classList.remove('open'); return; }
      if (b.dataset.r === 'copy') { const link = `${location.origin}${location.pathname}?t=${this.code}`; (await copyText(link)) ? toast('Enlace copiado.') : toast(link, { ms: 8000 }); }
    };
    this._key = e => this.onKey(e);
    document.addEventListener('keydown', this._key);
    $('#rail').classList.remove('open');
  }

  railTool(r) {
    const seat = this.mode === 'solo' ? this.bottomSeat() : this.mySeat;
    if (r === 'undo') this.undoLast();
    if (r === 'coin') { const v = Math.random() < .5 ? 'Cara' : 'Sello'; this.fx({ t: 'coin', r: v, cap: `${this.me} lanzó una moneda` }); this.log(`lanzó una moneda: ${v}`, seat || ''); }
    if (r === 'dice') { const v = 1 + Math.floor(Math.random() * 6); this.fx({ t: 'dice', r: v, cap: `${this.me} lanzó un dado` }); this.log(`lanzó un dado: ${v}`, seat || ''); }
    if (r === 'flip') { this.persp = other(this.persp); this.view.ready = false; this.view.render(false); this.renderChrome(); }
    if (r === 'hidetop') { this.hideTopHand = !this.hideTopHand; this.view.render(false); this.renderChrome(); }
    if (r === 'add' && seat) this.openAddCard(this.mode === 'solo' ? this.bottomSeat() : seat);
    if (r === 'concede' && seat) {
      const match = this.meta && this.meta.match;
      confirmBox('Rendirse', match ? 'Se anuncia en la mesa que te rindes y el juego cuenta para tu rival en el torneo.' : 'Se anuncia en la mesa que te rindes.', 'Rendirme').then(ok => {
        if (!ok) return;
        this.log('se rindió', seat); this.fx({ t: 'banner', m: `${this.nameOf(seat)} se rinde` });
        const rival = this.seats[other(seat)];
        if (match && rival && rival.uid) reportMatchGame(match, rival.uid).then(() => toast('Juego anotado en el torneo.')).catch(() => toast('No se pudo anotar el resultado en el torneo.', { err: true }));
      });
    }
    if (r === 'tour' && this.meta && this.meta.match) this.app.openCode(this.meta.match.draft);
    if (r === 'rematch') this.rematch();
    if (r === 'lobby') this.backToLobby();
    if (r === 'help') this.showHelp();
    if (r === 'leave') this.app.goHome();
  }

  renderChrome() {
    this.renderMidbar();
    this.renderRail();
  }
  renderMidbar() {
    const m = $('#midbar');
    const t = this.turn;
    if (!t || (this.mode === 'online' && this.meta && this.meta.status !== 'duel')) { m.innerHTML = this.mode === 'online' ? '<span class="turnbox"><span>Sala de espera</span></span>' : ''; return; }
    const drive = this.canDriveTurn();
    const att = this.sides[t.p];
    let mull = '';
    for (const seat of ['p1', 'p2']) {
      const s = this.sides[seat];
      if (s && s.st === 'mull' && this.controls(seat) && (this.mode === 'online' || seat === 'p1')) {
        const k = Math.max(0, s.z.mano.length - 1);
        mull = `<span class="mull">¿Mantienes esta mano?<button class="btn small primary" data-m="keep" data-s="${seat}">Mantener</button><button class="btn small" data-m="mull" data-s="${seat}">Mulligan (${k})</button></span>`;
      }
    }
    m.innerHTML = `<span class="turnbox"><b>Turno ${t.n}</b><span>${esc(this.nameOf(t.p))}</span></span>
      <span class="phases">${PHASES.map((p, i) => `<button class="phase ${i === t.ph ? 'cur' : ''} ${i === PH.BATALLA ? 'battle' : ''}" data-m="phase" data-ph="${i}" ${drive ? '' : 'disabled'}>${p}</button>`).join('')}</span>
      ${this.pick ? `<span class="mull">${esc(this.pick.label)}<button class="btn small" data-m="cancelpick">Cancelar</button></span>` : mull}
      <span class="spacer"></span>
      ${att && att.z.ataque.length && this.isPlayer() ? '<button class="btn" data-m="battle" style="border-color:rgba(210,74,51,.6)">Resolver batalla</button>' : ''}
      ${drive && !mull && !this.pick ? `<button class="btn" data-m="next" title="Siguiente fase (Espacio)">Siguiente fase</button><button class="btn primary" data-m="end" title="Robar y pasar el turno (E)">Terminar turno</button>` : ''}
      <button class="btn rail-btn" data-m="rail">Chat</button>`;
  }
  renderRail() {
    const head = $('#railHead');
    const pl = seat => {
      const s = this.sides[seat]; const st = this.seats[seat];
      const on = this.mode === 'solo' || (st && this.members[st.uid]);
      const turn = this.turn && this.turn.p === seat;
      return `<div class="pl ${turn ? 'turn' : ''}"><i class="dot ${on ? 'on' : ''}"></i><span>${esc(this.nameOf(seat))}${seat === this.mySeat && this.mode === 'online' ? ' (tú)' : ''}</span>
        <small>${s ? `castillo ${s.z.castillo.length}` : st && st.deck ? 'listo para jugar' : ''}</small></div>`;
    };
    const specs = this.mode === 'online' ? Object.entries(this.members).filter(([uid]) => !['p1', 'p2'].some(s => this.seats[s] && this.seats[s].uid === uid)).map(([, m]) => m.name) : [];
    const h = `<button class="btn small rail-close" data-r="close" aria-label="Cerrar panel">Cerrar</button>${this.mode === 'online' ? `<div class="room-code"><span>Mesa <b>${esc(this.code)}</b></span><button class="btn small" data-r="copy">Copiar enlace</button></div>` : '<div class="room-code"><span><b style="letter-spacing:0">Prueba solo</b></span></div>'}
      <div class="players">${pl('p1')}${pl('p2')}</div>
      ${this.mode === 'online' ? `<div class="specs">${specs.length ? `${plural(specs.length, 'espectador', 'espectadores')}: ${specs.map(esc).join(', ')}` : 'Sin espectadores'}${!this.mySeat ? ' · estás mirando' : ''}</div>` : ''}`;
    if (head._h !== h) { head._h = h; head.innerHTML = h; }
    const tools = $('#railTools');
    const inDuel = this.mode === 'solo' || (this.meta && this.meta.status === 'duel');
    const player = this.isPlayer() && inDuel;
    const host = this.isHost();
    const tb = [
      this.meta && this.meta.match && `<button class="btn primary" data-r="tour" title="${esc(this.meta.match.label || 'Partida de torneo')}">Volver al torneo</button>`,
      player && '<button class="btn" data-r="undo" title="Deshacer (Ctrl+Z)">Deshacer</button>',
      '<button class="btn" data-r="coin">Moneda</button>',
      '<button class="btn" data-r="dice">Dado</button>',
      (this.mode === 'solo' || !this.mySeat) && '<button class="btn" data-r="flip">Cambiar lado</button>',
      this.mode === 'solo' && `<button class="btn ${this.hideTopHand ? 'on' : ''}" data-r="hidetop">Ocultar mano de arriba</button>`,
      player && this.opts.testCards && '<button class="btn" data-r="add">Carta de prueba</button>',
      player && '<button class="btn" data-r="concede">Rendirse</button>',
      (this.mode === 'solo' || (host && inDuel)) && '<button class="btn" data-r="rematch">Revancha</button>',
      host && this.meta && this.meta.status === 'duel' && '<button class="btn" data-r="lobby">Volver a la sala</button>',
      '<button class="btn" data-r="help">Atajos</button>',
      '<button class="btn ghost" data-r="leave">Salir</button>',
    ].filter(Boolean).join('');
    if (tools._h !== tb) { tools._h = tb; tools.innerHTML = tb; }
  }

  showHelp() {
    openModal(`<h2>Cómo se usa la mesa</h2>
      <p>Todo es manual, como en una mesa real: arrastra las cartas o haz clic en ellas para ver sus acciones. Clic en el castillo para robar, botar, barajar o buscar.</p>
      <div class="opt-grid" style="font-size:15px;line-height:1.6">
        <div><b>R</b> robar 1 · <b>B</b> botar cartas · <b>S</b> barajar el castillo</div>
        <div><b>A</b> atacar con la carta bajo el cursor · <b>D</b> destruirla · <b>H</b> devolverla a la mano</div>
        <div><b>Espacio</b> siguiente fase · <b>E</b> terminar turno · <b>Ctrl+Z</b> deshacer · <b>Esc</b> cancelar</div>
        <div>Jugar desde la mano paga el coste automáticamente con tu reserva de oro (primero los oros sin habilidad).</div>
        <div>Al pasar el turno, la agrupación y el robo se hacen solos si la opción está activa.</div>
        <div>Arrastra un arma sobre un aliado para equiparla. Si el aliado sale del juego, el arma va al cementerio.</div>
        <div>En la fase de batalla, el defensor bloquea desde su línea de defensa y cualquiera puede abrir <i>Resolver batalla</i> para calcular y aplicar el daño.</div>
      </div>
      <div class="modal-foot"><button class="btn primary" data-x="ok">Entendido</button></div>`).querySelector('[data-x=ok]').onclick = () => closeModal();
  }

  onKey(e) {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (e.key === 'Escape') { if (this.pick) this.cancelPick(); return; }
    if (modalOpen()) return;
    const seat = this.mode === 'solo' ? (this.view.hovered && this.controls(this.view.hovered.seat) ? this.view.hovered.seat : this.bottomSeat()) : this.mySeat;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undoLast(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || !seat || !this.sides[seat]) return;
    const k = e.key.toLowerCase();
    const hv = this.view.hovered && this.controls(this.view.hovered.seat) ? this.view.hovered : null;
    const hz = hv ? zoneOf(this.sides[hv.seat], hv.iid) : null;
    if (k === 'r') this.draw(seat, 1);
    else if (k === 'b') this.toolClick(seat, 'mill');
    else if (k === 's') this.shuffle(seat);
    else if (k === ' ' || k === 'n') { if (this.canDriveTurn()) { e.preventDefault(); this.nextPhase(); } }
    else if (k === 'e') { if (this.canDriveTurn()) this.endTurn(); }
    else if (k === 'a' && hv && hz === 'defensa') this.doMove(hv.seat, hv.iid, 'ataque');
    else if (k === 'd' && hv && hz) this.doMove(hv.seat, hv.iid, 'cementerio');
    else if (k === 'h' && hv && hz && hz !== 'mano') this.doMove(hv.seat, hv.iid, 'mano');
    else if (k === '?') this.showHelp();
  }
}
