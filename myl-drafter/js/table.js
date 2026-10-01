import { card, IMG, THUMB, BACK_URL, foilTier, T, typeName, raceName, rarityName, edition, keywordNames, textHTML } from './data.js';
import { ZONES, LINES, attachedTo, strength, other } from './game.js';
import { esc, reduced, damagePop, sparkles } from './ui.js';

const RATIO = 734 / 512;
const EASE = 'cubic-bezier(.2,.75,.2,1)';

export function inspectCard(key, extra = {}) {
  const box = document.getElementById('inspCard'), body = document.getElementById('inspBody');
  if (!box) return;
  if (!key) {
    box.className = 'insp-card';
    box.innerHTML = extra.hidden ? `<div style="position:absolute;inset:0;background:var(--back) center/cover;border-radius:inherit"></div>` : '';
    body.innerHTML = `<p class="insp-hint">${extra.hidden ? 'Carta oculta.' : 'Pasa el cursor sobre una carta para verla aquí.'}</p>`;
    return;
  }
  const c = card(key); const e = edition(c); const ft = foilTier(c);
  box.className = 'insp-card has' + (ft ? ` foil-${ft}` : '');
  if (box.dataset.k !== key) { box.dataset.k = key; box.innerHTML = `<img src="${IMG(key)}" alt="${esc(c.name)}"><div class="foil"></div>`; }
  const str = extra.str != null && extra.str !== c.str ? `${extra.str} (impresa ${Math.max(0, c.str)})` : c.str;
  const rows = [
    ['Tipo', typeName(c)],
    c.race > 0 ? ['Raza', raceName(c)] : null,
    c.cost >= 0 ? ['Coste', c.cost] : null,
    c.type === T.ALIADO && c.str >= 0 ? ['Fuerza', str] : null,
    ['Frecuencia', rarityName(c)],
    e ? ['Edición', e.title] : null,
    e ? ['Bloque', e.blockName] : null,
  ].filter(Boolean);
  const kws = keywordNames(c);
  const flags = [...kws, ...(extra.flags || [])];
  body.innerHTML = `<h3>${esc(c.name)}</h3>
    <dl class="insp-meta">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <div class="insp-text">${textHTML(c, esc)}</div>
    ${flags.length ? `<div class="insp-flags">${flags.map(f => `<span>${esc(f)}</span>`).join('')}</div>` : ''}`;
}

export class TableView {
  constructor(ctl) {
    this.ctl = ctl;
    this.board = document.getElementById('board');
    this.posEl = { top: this.board.querySelector('.side[data-pos=top]'), bottom: this.board.querySelector('.side[data-pos=bottom]') };
    this.arrows = document.getElementById('arrows');
    this.els = new Map();
    this.prevZone = new Map();
    this.prevVis = new Map();
    this.place = new Map();
    this.contRects = null;
    this.ready = false;
    this.cw = 80; this.ch = 80 * RATIO;
    this.points = [];
    this.hovered = null;
    this.drag = null;
    document.documentElement.style.setProperty('--back', `url("${BACK_URL}")`);
    this.build();
    this.bind();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.board);
    const mid = document.getElementById('midbar');
    mid && this.ro.observe(mid);
  }

  destroy() {
    this.ro.disconnect();
    for (const el of this.els.values()) el.remove();
    this.els.clear();
    this.board.removeEventListener('pointerdown', this._down);
  }

  build() {
    const zones = `
      <div class="z mano" data-zone="mano"></div>
      <div class="z row" data-zone="apoyo"><span class="zl">Línea de apoyo</span><span class="zc"></span></div>
      <div class="z row" data-zone="ataque"><span class="zl">Línea de ataque</span><span class="zc"></span></div>
      <div class="z row" data-zone="defensa"><span class="zl">Línea de defensa</span><span class="zc"></span></div>
      <div class="goldbox">
        <div class="z gold" data-zone="reserva" title="Reserva de oro"><span class="zl">Reserva</span><span class="zc"></span></div>
        <div class="z gold" data-zone="pagado" title="Oro pagado"><span class="zl">Pagado</span><span class="zc"></span></div>
      </div>
      <div class="z pile castle" data-zone="castillo" title="Castillo"><div class="stack"></div><div class="num">0</div></div>
      <div class="z pile" data-zone="cementerio"><span class="zl">Cementerio</span><span class="zc"></span></div>
      <div class="z pile" data-zone="destierro"><span class="zl">Destierro</span><span class="zc"></span></div>
      <div class="tools"></div>`;
    for (const pos of ['top', 'bottom']) this.posEl[pos].innerHTML = zones;
  }
  zc(pos, zone) { return this.posEl[pos].querySelector(`.z[data-zone="${zone}"]`); }
  posOf(seat) { return this.ctl.bottomSeat() === seat ? 'bottom' : 'top'; }

  resize() {
    const r = this.board.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const mid = document.getElementById('midbar')?.offsetHeight || 46;
    const chH = (r.height - 12 - mid - 24 - 64) / 5.4;
    const cwW = (r.width - 20 - 24) / (2.7 + 2.24 + 5.2);
    const cw = Math.max(30, Math.min(150, Math.floor(Math.min(chH / RATIO, cwW))));
    this.board.classList.toggle('tiny', cw < 52);
    const ch = cw * RATIO;
    // spare height goes into the rows so the table breathes instead of leaving a gap
    const rowh = Math.max(ch + 16, Math.min(ch * 1.45, (r.height - 12 - mid - 24 - ch * 1.4) / 4));
    if (cw !== this.cw || !this.sized || Math.abs(rowh - (this.rowh || 0)) > .5) {
      this.cw = cw; this.ch = ch; this.sized = true; this.rowh = rowh;
      document.documentElement.style.setProperty('--cw', cw + 'px');
      document.documentElement.style.setProperty('--ch', ch.toFixed(2) + 'px');
      document.documentElement.style.setProperty('--rowh', rowh.toFixed(1) + 'px');
    }
    this.render(false);
  }

  visibleIn(seat, zone, inst) {
    if (!inst || zone === 'castillo') return false;
    if (zone === 'mano') return this.ctl.seeHand(seat) || !!inst.rv;
    if (inst.fd) return this.ctl.controls(seat) ? 'peek' : false;
    return true;
  }

  // ---------------------------------------------------------------- render
  render(animate = true) {
    const ctl = this.ctl;
    if (!ctl.sides || !this.sized) return;
    const doAnim = animate && this.ready && !reduced();
    const before = new Map();
    if (doAnim) for (const [iid, el] of this.els) if (el.isConnected) before.set(iid, el.getBoundingClientRect());
    const oldCont = this.contRects;
    const out = [];
    const curZone = new Map();
    const nowVis = new Map();
    const bottom = ctl.bottomSeat();
    const seats = { bottom, top: other(bottom) };
    this.board.classList.toggle('picking', !!ctl.pick);
    for (const pos of ['bottom', 'top']) {
      const seat = seats[pos];
      const side = ctl.sides[seat];
      const el = this.posEl[pos];
      el.dataset.seat = seat;
      el.classList.toggle('mine', ctl.controls(seat));
      el.classList.toggle('active-turn', !!(ctl.turn && ctl.turn.p === seat));
      if (!side) { this.paintEmpty(pos); continue; }
      for (const z of ZONES) for (const iid of side.z[z]) {
        curZone.set(iid, `${seat}:${z}`);
        nowVis.set(iid, !!this.visibleIn(seat, z, side.c[iid]));
      }
      for (const z of LINES) this.layRow(pos, seat, side, z, out);
      this.layGold(pos, seat, side, 'reserva', out);
      this.layGold(pos, seat, side, 'pagado', out);
      this.layHand(pos, seat, side, out);
      this.layPileTop(pos, seat, side, 'cementerio', out);
      this.layPileTop(pos, seat, side, 'destierro', out);
      this.paintCastle(pos, seat, side);
      this.paintCounts(pos, side);
      this.paintTools(pos, seat, side);
    }
    const wanted = new Set();
    const created = new Set();
    for (const p of out) {
      wanted.add(p.iid);
      let el = this.els.get(p.iid);
      if (!el) { el = this.makeEl(p.iid); created.add(p.iid); }
      if (el.parentNode !== p.cont) p.cont.appendChild(el);
      this.applyPlace(el, p);
      this.paint(el, p, created.has(p.iid), nowVis);
    }
    for (const [iid, el] of this.els) if (!wanted.has(iid)) { el.remove(); this.els.delete(iid); }
    this.place = new Map(out.map(p => [p.iid, p]));
    const contRects = new Map();
    for (const pos of ['bottom', 'top']) for (const z of ZONES) {
      if (z === 'armas') continue;
      const c = this.zc(pos, z);
      contRects.set(`${seats[pos]}:${z}`, (z === 'castillo' ? c.querySelector('.stack') : c).getBoundingClientRect());
    }
    this.contRects = contRects;
    const mills = { p1: 0, p2: 0 };
    if (doAnim) this.animateMoves(out, before, oldCont || contRects, contRects, curZone, wanted, created, mills);
    for (const seat of ['p1', 'p2']) if (mills[seat]) this.castleHit(seat, mills[seat]);
    this.prevZone = curZone;
    this.prevVis = nowVis;
    this.ready = true;
    this.drawArrows();
  }

  paintEmpty(pos) {
    for (const el of this.posEl[pos].querySelectorAll('.zc')) el.textContent = '';
    const c = this.zc(pos, 'castillo');
    c.querySelector('.stack').innerHTML = ''; c.querySelector('.stack')._n = 0;
    c.querySelector('.num').textContent = '–';
    this.posEl[pos].querySelector('.tools').innerHTML = '';
  }

  makeEl(iid) {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.iid = iid;
    el.innerHTML = '<div class="flip"><div class="face"><span class="fname"></span><img alt="" decoding="async" draggable="false"></div><div class="back"></div></div><div class="foil"></div><div class="badges"></div>';
    this.els.set(iid, el);
    return el;
  }

  applyPlace(el, p) {
    const st = el.style;
    st.left = p.x.toFixed(1) + 'px'; st.top = p.y.toFixed(1) + 'px';
    st.width = p.w.toFixed(1) + 'px'; st.height = p.h.toFixed(1) + 'px';
    st.zIndex = p.z;
    st.transform = p.rot ? `rotate(${p.rot.toFixed(2)}deg)` : '';
    el.dataset.seat = p.seat; el.dataset.zone = p.zone;
  }

  paint(el, p, isNew, nowVis) {
    const side = this.ctl.sides[p.seat];
    const inst = side.c[p.iid];
    const c = card(inst.k);
    const v = this.visibleIn(p.seat, p.zone, inst);
    const show = !!v;
    if (show) {
      const img = el.querySelector('img');
      if (img.dataset.k !== inst.k) { img.dataset.k = inst.k; img.src = THUMB(inst.k); el.querySelector('.fname').textContent = c.name; }
    }
    const wasVis = this.prevVis.get(p.iid);
    if (isNew && show && wasVis === false && this.ready && !reduced()) {
      el.classList.add('hidden');
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('hidden')));
    } else el.classList.toggle('hidden', !show);
    const ft = show && v !== 'peek' ? foilTier(c) : 0;
    el.classList.toggle('foil-1', ft === 1);
    el.classList.toggle('foil-2', ft === 2);
    el.classList.toggle('fd-own', v === 'peek');
    el.classList.toggle('r90', !!inst.r);
    el.classList.toggle('nw', !!inst.nw && p.zone === 'defensa');
    el.classList.toggle('rv', !!inst.rv && p.zone === 'mano');
    const pick = this.ctl.pick;
    el.classList.toggle('tgt', !!(pick && pick.ok(p.seat, p.iid)));
    el.classList.toggle('sel', !!(pick && pick.from && pick.from.iid === p.iid));
    let b = '';
    if (show && LINES.includes(p.zone) && c.type === T.ALIADO) {
      const x = inst.x || 0;
      b += `<span class="b-str${x > 0 ? ' up' : x < 0 ? ' down' : ''}" title="Fuerza">${strength(side, p.iid)}</span>`;
    } else if (inst.x) b += `<span class="b-ctr">${inst.x > 0 ? '+' : ''}${inst.x}</span>`;
    if (inst.nw && p.zone === 'defensa') b += '<span class="b-new">recién jugado</span>';
    if (inst.bl && p.zone === 'defensa') b += '<span class="b-blk">bloquea</span>';
    if (p.count) b += `<span class="b-cnt">${p.count}</span>`;
    if (el._b !== b) { el._b = b; el.querySelector('.badges').innerHTML = b; }
  }

  // ---------------------------------------------------------------- layouts
  layRow(pos, seat, side, zone, out) {
    const cont = this.zc(pos, zone);
    const ids = side.z[zone].filter(id => side.c[id]);
    const n = ids.length; if (!n) return;
    const W = cont.clientWidth, H = cont.clientHeight;
    const cw = this.cw, ch = this.ch, gap = Math.round(cw * .1), pad = 10;
    const avail = W - pad * 2;
    let step = cw + gap;
    if (n > 1 && n * cw + (n - 1) * gap > avail) step = Math.max(cw * .16, (avail - cw) / (n - 1));
    const total = cw + (n - 1) * step;
    const x0 = pad + Math.max(0, (avail - total) / 2);
    const y = (H - ch) / 2;
    const dir = pos === 'bottom' ? 1 : -1;
    ids.forEach((iid, i) => {
      const x = x0 + i * step;
      out.push({ iid, seat, zone, cont, x, y, w: cw, h: ch, z: 10 + i * 4 + 3 });
      attachedTo(side, iid).forEach((wid, j) => {
        out.push({ iid: wid, seat, zone: 'armas', cont, x: x + (j + 1) * cw * .07, y: y + dir * (j + 1) * ch * .17, w: cw, h: ch, z: 10 + i * 4 + 2 - Math.min(j, 2) });
      });
    });
  }

  layGold(pos, seat, side, zone, out) {
    const cont = this.zc(pos, zone);
    const ids = side.z[zone].filter(id => side.c[id]);
    const n = ids.length; if (!n) return;
    const W = cont.clientWidth, H = cont.clientHeight;
    const w = Math.min(this.cw * .8, (H - 22) / RATIO), h = w * RATIO;
    const pad = 6, avail = W - pad * 2;
    const step = n > 1 ? Math.min(w * .5, (avail - w) / (n - 1)) : 0;
    const total = w + (n - 1) * step;
    const x0 = pad + Math.max(0, (avail - total) / 2);
    const y = (H - h) / 2 + (pos === 'bottom' ? 7 : -7);
    ids.forEach((iid, i) => out.push({ iid, seat, zone, cont, x: x0 + i * step, y, w, h, z: 10 + i }));
  }

  layHand(pos, seat, side, out) {
    const cont = this.zc(pos, 'mano');
    const ids = side.z.mano.filter(id => side.c[id]);
    const n = ids.length; if (!n) return;
    const W = cont.clientWidth, H = cont.clientHeight;
    const mine = pos === 'bottom';
    const w = mine ? this.cw * 1.12 : this.cw * .7, h = w * RATIO;
    const avail = W - 12;
    const step = n > 1 ? Math.min(w * (mine ? .8 : .58), (avail - w) / (n - 1)) : 0;
    const total = w + (n - 1) * step;
    const x0 = 6 + Math.max(0, (avail - total) / 2);
    const spread = Math.min(3, 26 / n);
    ids.forEach((iid, i) => {
      const t = i - (n - 1) / 2;
      const arc = t * t * (mine ? 1.4 : 1);
      const rot = (mine ? 1 : -1) * t * spread;
      const y = mine ? 6 + arc : H - h - arc;
      out.push({ iid, seat, zone: 'mano', cont, x: x0 + i * step, y, w, h, z: 10 + i, rot });
    });
  }

  layPileTop(pos, seat, side, zone, out) {
    const cont = this.zc(pos, zone);
    const ids = side.z[zone];
    const n = ids.length; if (!n) return;
    const iid = ids[n - 1]; if (!side.c[iid]) return;
    const W = cont.clientWidth, H = cont.clientHeight;
    const w = Math.min(this.cw * .9, (H - 24) / RATIO), h = w * RATIO;
    out.push({ iid, seat, zone, cont, x: (W - w) / 2, y: (H - h) / 2 + (pos === 'bottom' ? 7 : -7), w, h, z: 10, count: n > 1 ? n : 0 });
  }

  paintCastle(pos, seat, side) {
    const c = this.zc(pos, 'castillo');
    const n = side.z.castillo.length;
    const stack = c.querySelector('.stack');
    const layers = n ? Math.min(7, 1 + Math.floor(n / 7)) : 0;
    if (stack._n !== layers) {
      stack._n = layers;
      stack.innerHTML = Array.from({ length: layers }, (_, i) => `<i style="transform:translate(${(-i * 1.3).toFixed(1)}px,${(-i * 1.3).toFixed(1)}px)"></i>`).join('');
    }
    c.querySelector('.num').textContent = n;
    c.classList.toggle('empty', !n);
    c.title = `Castillo: ${n} carta${n === 1 ? '' : 's'}`;
  }

  paintCounts(pos, side) {
    for (const z of ['apoyo', 'ataque', 'defensa', 'reserva', 'pagado', 'cementerio', 'destierro']) {
      const el = this.zc(pos, z).querySelector('.zc');
      const n = side.z[z].length;
      const t = n ? String(n) : '';
      if (el.textContent !== t) el.textContent = t;
    }
  }

  paintTools(pos, seat, side) {
    const box = this.posEl[pos].querySelector('.tools');
    const hand = side.z.mano.length;
    const mine = this.ctl.controls(seat);
    const warn = hand > 8 ? ' warn' : '';
    const html = `<div class="tstat${warn}"><b>${hand}</b>${hand === 1 ? 'carta' : 'cartas'} en mano</div>` +
      (mine ? `<button class="btn tbtn" data-tool="draw" title="Robar 1 (R)">Robar</button><button class="btn tbtn" data-tool="mill" title="Botar cartas del castillo (B)">Botar…</button>` :
        `<div class="tstat"><b>${side.z.reserva.length}</b>oro${side.z.reserva.length === 1 ? '' : 's'} en reserva</div>`);
    if (box._h !== html) { box._h = html; box.innerHTML = html; }
  }

  // ---------------------------------------------------------------- animation
  animateMoves(out, before, oldCont, newCont, curZone, wanted, created, mills) {
    const toCount = new Map();
    let k = 0;
    for (const [iid, cz] of curZone) {
      const pz = this.prevZone.get(iid);
      if (!pz || pz === cz) continue;
      const pzone = pz.split(':')[1];
      const [cs, czone] = cz.split(':');
      if (pzone === 'castillo' && (czone === 'cementerio' || czone === 'destierro')) mills[cs]++;
      if (wanted.has(iid)) continue;
      const from = before.get(iid) || oldCont.get(pz);
      const to = newCont.get(cz);
      if (!from || !to || k > 30) continue;
      const n = toCount.get(cz) || 0; toCount.set(cz, n + 1);
      this.ghost(iid, cs, czone, from, to, n * 80);
      k++;
    }
    for (const p of out) {
      const el = this.els.get(p.iid);
      const cz = curZone.get(p.iid), pz = this.prevZone.get(p.iid);
      const moved = pz && pz !== cz;
      let from = before.get(p.iid);
      if (!from && moved) from = oldCont.get(pz);
      if (!from) { if (!pz && created.has(p.iid)) this.enter(el); continue; }
      const to = el.getBoundingClientRect();
      if (Math.abs(from.left - to.left) < 1.5 && Math.abs(from.top - to.top) < 1.5 && Math.abs(from.width - to.width) < 1.5) continue;
      const delay = moved ? (toCount.get(cz) || 0) * 80 : 0;
      this.flip(el, from, to, p.rot, delay);
      if (moved && LINES.includes(p.zone) && !LINES.includes(pz.split(':')[1])) {
        const c = card(this.ctl.sides[p.seat].c[p.iid].k);
        setTimeout(() => {
          if (!el.isConnected) return;
          if (foilTier(c) && !el.classList.contains('hidden')) {
            el.classList.add('glint'); setTimeout(() => el.classList.remove('glint'), 1200);
            sparkles(el.getBoundingClientRect(), foilTier(c) === 2 ? 26 : 14);
          }
        }, 380 + delay);
      }
      if (moved && p.zone === 'ataque' && pz.split(':')[1] === 'defensa') {
        el.classList.add('lunge'); setTimeout(() => el.classList.remove('lunge'), 600);
      }
    }
  }

  flip(el, from, to, rot, delay = 0) {
    const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
    const dy = (from.top + from.height / 2) - (to.top + to.height / 2);
    const s = Math.max(.25, Math.min(4, from.width / Math.max(1, to.width)));
    const r = rot ? ` rotate(${rot}deg)` : '';
    el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s})${r}` }, { transform: rot ? `rotate(${rot}deg)` : 'none' }],
      { duration: 440, delay, easing: EASE, fill: 'backwards' });
  }

  enter(el) {
    const t = el.style.transform || 'none';
    el.animate([{ opacity: 0, transform: `${t === 'none' ? '' : t} scale(.86)` }, { opacity: 1, transform: t }], { duration: 300, easing: EASE });
  }

  ghost(iid, seat, zone, from, to, delay) {
    const side = this.ctl.sides[seat];
    const inst = side && side.c[iid];
    if (!inst) return;
    const showEnd = !!this.visibleIn(seat, zone, inst);
    const showStart = !!this.prevVis.get(iid);
    const g = document.createElement('div');
    g.className = 'card ghost' + (showStart ? '' : ' hidden');
    g.innerHTML = `<div class="flip"><div class="face">${showStart || showEnd ? `<img alt="" data-k="${inst.k}" src="${THUMB(inst.k)}">` : ''}</div><div class="back"></div></div>`;
    let w, h, x, y;
    if (zone === 'castillo') { w = to.width; h = to.height; x = to.left; y = to.top; }
    else { w = Math.min(this.cw * .9, to.width); h = w * RATIO; x = to.left + (to.width - w) / 2; y = to.top + (to.height - h) / 2; }
    Object.assign(g.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    document.body.appendChild(g);
    if (showEnd !== showStart) setTimeout(() => g.classList.toggle('hidden', !showEnd), delay + 120);
    const dx = (from.left + from.width / 2) - (x + w / 2);
    const dy = (from.top + from.height / 2) - (y + h / 2);
    const s = Math.max(.25, Math.min(4, from.width / w));
    const a = g.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: 'none' }], { duration: 480, delay, easing: EASE, fill: 'backwards' });
    const done = () => g.remove();
    a.onfinish = done; setTimeout(done, delay + 900);
  }

  castleHit(seat, n) {
    const pos = this.posOf(seat);
    const c = this.zc(pos, 'castillo');
    c.classList.remove('hit'); void c.offsetWidth; c.classList.add('hit');
    setTimeout(() => c.classList.remove('hit'), 600);
    damagePop(c.getBoundingClientRect(), `−${n}`);
  }
  shuffleFx(seat) {
    const c = this.zc(this.posOf(seat), 'castillo');
    c.classList.remove('shuffle'); void c.offsetWidth; c.classList.add('shuffle');
    setTimeout(() => c.classList.remove('shuffle'), 1050);
  }
  pulse(iid) {
    const el = this.els.get(iid); if (!el) return;
    el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
    setTimeout(() => el.classList.remove('pulse'), 2500);
  }
  landed(iid, delay = 380) {
    setTimeout(() => {
      const el = this.els.get(iid); if (!el) return;
      el.classList.remove('landed'); void el.offsetWidth; el.classList.add('landed');
      setTimeout(() => el.classList.remove('landed'), 900);
    }, delay);
  }
  rectOf(iid) { const el = this.els.get(iid); return el ? el.getBoundingClientRect() : null; }
  zoneRect(seat, zone) { return this.zc(this.posOf(seat), zone).getBoundingClientRect(); }

  // ---------------------------------------------------------------- arrows
  centerOf(iid) {
    const p = this.place.get(iid); if (!p) return null;
    const cr = p.cont.getBoundingClientRect(), br = this.board.getBoundingClientRect();
    return { x: cr.left - br.left + p.x + p.w / 2, y: cr.top - br.top + p.y + p.h / 2 };
  }
  point(fromIid, toIid) {
    this.points.push({ a: fromIid, b: toIid, until: Date.now() + 2800 });
    this.drawArrows();
    setTimeout(() => this.drawArrows(), 2900);
  }
  drawArrows() {
    let html = '';
    const sides = this.ctl.sides || {};
    for (const seat of ['p1', 'p2']) {
      const side = sides[seat]; if (!side) continue;
      for (const id of side.z.defensa) {
        const inst = side.c[id]; if (!inst || !inst.bl) continue;
        const a = this.centerOf(id), b = this.centerOf(inst.bl);
        if (a && b) html += `<line class="blk" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
      }
    }
    const now = Date.now();
    this.points = this.points.filter(p => p.until > now);
    for (const p of this.points) {
      const a = this.centerOf(p.a), b = this.centerOf(p.b);
      if (!a || !b) continue;
      const mx = (a.x + b.x) / 2 + (b.y - a.y) * .18, my = (a.y + b.y) / 2 - (b.x - a.x) * .18;
      const ang = Math.atan2(b.y - my, b.x - mx);
      const hx = b.x - Math.cos(ang) * 4, hy = b.y - Math.sin(ang) * 4;
      const l = 14, w = .5;
      html += `<path class="pt" d="M${a.x},${a.y} Q${mx},${my} ${hx},${hy}"/>` +
        `<path class="pt-head" d="M${b.x},${b.y} L${b.x - l * Math.cos(ang - w)},${b.y - l * Math.sin(ang - w)} L${b.x - l * Math.cos(ang + w)},${b.y - l * Math.sin(ang + w)} Z"/>`;
    }
    this.arrows.innerHTML = html;
  }

  // ---------------------------------------------------------------- input
  bind() {
    const b = this.board;
    b.addEventListener('contextmenu', e => { if (e.target.closest('.side')) e.preventDefault(); });
    this._down = e => this.down(e);
    b.addEventListener('pointerdown', this._down);
    b.addEventListener('pointerover', e => {
      const el = e.target.closest('.card');
      if (!el || !el.dataset.iid) return;
      this.hovered = { seat: el.dataset.seat, iid: el.dataset.iid };
      this.inspect(el.dataset.seat, el.dataset.iid);
    });
    b.addEventListener('pointerout', e => { if (e.target.closest('.card') && !e.relatedTarget?.closest?.('.card')) this.hovered = null; });
    b.addEventListener('pointermove', e => {
      const el = e.target.closest('.card.foil-1, .card.foil-2');
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      el.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    });
    b.addEventListener('click', e => {
      const t = e.target.closest('[data-tool]');
      if (!t) return;
      const side = t.closest('.side');
      side && this.ctl.toolClick(side.dataset.seat, t.dataset.tool, e);
    });
  }

  inspect(seat, iid) {
    const side = this.ctl.sides && this.ctl.sides[seat];
    const inst = side && side.c[iid];
    if (!inst) return;
    const el = this.els.get(iid);
    const zone = el ? el.dataset.zone : null;
    const v = this.visibleIn(seat, zone, inst);
    if (!v) { inspectCard(null, { hidden: true }); return; }
    const c = card(inst.k);
    const flags = [];
    if (inst.fd) flags.push('Boca abajo');
    if (inst.nw && zone === 'defensa') flags.push('Aún no puede atacar');
    if (inst.x) flags.push(`${inst.x > 0 ? '+' : ''}${inst.x} a la fuerza`);
    inspectCard(inst.k, { str: c.type === T.ALIADO ? strength(side, iid) : null, flags });
  }

  down(e) {
    if (e.target.closest('[data-tool], button, input, select, textarea')) return;
    const sideEl = e.target.closest('.side');
    if (!sideEl) return;
    const seat = sideEl.dataset.seat;
    const cardEl = e.target.closest('.card');
    const zoneEl = e.target.closest('.z');
    const zone = cardEl ? cardEl.dataset.zone : zoneEl && zoneEl.dataset.zone;
    if (!zone) return;
    const iid = cardEl ? cardEl.dataset.iid : null;
    if (e.button === 2) { e.preventDefault(); this.click(seat, iid, zone, e); return; }
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    let dragging = false;
    const canDrag = this.ctl.controls(seat) && !this.ctl.pick && (iid || (zone === 'castillo' && this.ctl.sides[seat]?.z.castillo.length));
    const move = ev => {
      if (!dragging && canDrag && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 7) dragging = this.startDrag(seat, iid, zone, ev);
      if (dragging) { ev.preventDefault(); this.dragMove(ev); }
    };
    const up = ev => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (dragging) this.endDrag(ev, ev.type === 'pointercancel');
      else if (ev.type === 'pointerup') this.click(seat, iid, zone, ev);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  click(seat, iid, zone, ev) {
    if (iid) this.ctl.cardClick(seat, iid, zone, ev);
    else this.ctl.zoneClick(seat, zone, ev);
  }

  startDrag(seat, iid, zone, ev) {
    const side = this.ctl.sides[seat];
    const fromCastle = !iid && zone === 'castillo';
    const id = fromCastle ? side.z.castillo[0] : iid;
    if (!id || !side.c[id]) return false;
    const inst = side.c[id];
    const vis = !fromCastle && this.visibleIn(seat, zone, inst);
    const av = document.getElementById('dragAvatar');
    av.innerHTML = vis ? `<img src="${THUMB(inst.k)}" data-k="${inst.k}" alt="">` : '<div style="width:100%;height:100%;background:var(--back) center/cover"></div>';
    av.hidden = false;
    this.drag = { seat, iid: id, zone: fromCastle ? 'castillo' : zone, type: card(inst.k).type, hover: null, hoverEl: null };
    const el = this.els.get(id); el && el.classList.add('dragging');
    const pos = this.posOf(seat);
    for (const z of this.posEl[pos].querySelectorAll('.z')) z.classList.add('drop-ok');
    this.dragMove(ev);
    return true;
  }
  dragMove(ev) {
    const av = document.getElementById('dragAvatar');
    av.style.left = ev.clientX + 'px'; av.style.top = ev.clientY + 'px';
    const t = this.dropTarget(ev.clientX, ev.clientY);
    if (this.drag.hover !== t.key) {
      this.drag.hoverEl && this.drag.hoverEl.classList.remove('drop-hover');
      t.el && t.el.classList.add('drop-hover');
      this.drag.hover = t.key; this.drag.hoverEl = t.el || null;
    }
  }
  dropTarget(x, y) {
    const hit = document.elementFromPoint(x, y);
    if (!hit || !this.drag) return {};
    const sideEl = hit.closest('.side');
    if (!sideEl || sideEl.dataset.seat !== this.drag.seat) return {};
    const cardEl = hit.closest('.card');
    if (cardEl && cardEl.dataset.iid !== this.drag.iid && LINES.includes(cardEl.dataset.zone) && this.drag.type === T.ARMA) {
      const host = this.ctl.sides[this.drag.seat].c[cardEl.dataset.iid];
      if (host && card(host.k).type === T.ALIADO) return { el: cardEl, key: 'eq:' + cardEl.dataset.iid, host: cardEl.dataset.iid };
    }
    const zEl = hit.closest('.z');
    if (!zEl || !zEl.dataset.zone) return {};
    return { el: zEl, key: 'z:' + zEl.dataset.zone, zone: zEl.dataset.zone };
  }
  endDrag(ev, cancel) {
    document.getElementById('dragAvatar').hidden = true;
    for (const z of this.board.querySelectorAll('.drop-ok, .drop-hover')) z.classList.remove('drop-ok', 'drop-hover');
    const d = this.drag; this.drag = null;
    const el = this.els.get(d.iid); el && el.classList.remove('dragging');
    if (cancel) return;
    const t = this.dropTargetFor(d, ev.clientX, ev.clientY);
    if (t.host) { this.ctl.drop(d.seat, d.iid, d.zone, 'armas', null, t.host); return; }
    if (!t.zone) return;
    const index = this.insertIndex(t.el, t.zone, ev.clientX, d.iid);
    this.ctl.drop(d.seat, d.iid, d.zone, t.zone, index, null);
  }
  dropTargetFor(d, x, y) { const keep = this.drag; this.drag = d; const t = this.dropTarget(x, y); this.drag = keep; return t; }
  insertIndex(cont, zone, x, dragIid) {
    if (!['defensa', 'ataque', 'apoyo', 'mano', 'reserva', 'pagado'].includes(zone)) return null;
    let i = 0;
    for (const c of cont.querySelectorAll(':scope > .card')) {
      if (c.dataset.zone !== zone || c.dataset.iid === dragIid) continue;
      const r = c.getBoundingClientRect();
      if (x > r.left + r.width / 2) i++;
    }
    return i;
  }
}
