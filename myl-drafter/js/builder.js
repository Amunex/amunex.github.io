import { DB, card, IMG, THUMB, T, searchCards, edition, typeName, raceName, rarityName, raceList, foilTier, textHTML } from './data.js';
import {
  loadDecks, upsertDeck, removeDeck, newDeck, deckSize, encodeDeck, deckToText, parseDeckInput, sortedEntries,
  randomDeck, getSelectedId, setSelectedId,
} from './decks.js';
import { $, esc, openMenu, openModal, closeModal, confirmBox, toast, copyText } from './ui.js';

const PAGE = 60;
const GROUPS = [[T.ALIADO, 'Aliados'], [T.TALISMAN, 'Talismanes'], [T.TOTEM, 'Tótems'], [T.ARMA, 'Armas'], [T.MONUMENTO, 'Monumentos'], [T.ORO, 'Oros']];

export class Builder {
  constructor(app) {
    this.app = app;
    this.deck = null;
    this.results = [];
    this.shown = 0;
    this.bound = false;
  }

  open(deckId = null) {
    if (!this.bound) this.bind();
    this.fillFilters();
    let decks = loadDecks();
    if (!decks.length) { upsertDeck(newDeck('Mi primer mazo')); decks = loadDecks(); }
    const id = deckId || getSelectedId();
    this.deck = decks.find(d => d.id === id) || decks[0];
    setSelectedId(this.deck.id);
    this.renderDeckSelect();
    this.renderDeck();
    this.search();
  }

  bind() {
    this.bound = true;
    const s = $('#s-decks');
    let t;
    const later = () => { clearTimeout(t); t = setTimeout(() => this.search(), 140); };
    $('#fQ').addEventListener('input', later);
    for (const id of ['#fText', '#fType', '#fRace', '#fRar', '#fCost', '#fStr', '#fUnique', '#fEd']) $(id).addEventListener('change', () => this.search());
    $('#fBlock').addEventListener('change', () => { this.fillEditions(); this.search(); });
    s.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const a = b.dataset.act;
      if (a === 'filters-clear') this.clearFilters();
      if (a === 'deck-new') this.createDeck();
      if (a === 'deck-dup') this.duplicate();
      if (a === 'deck-import') this.importDeck();
      if (a === 'deck-export') this.exportDeck();
      if (a === 'deck-random') this.randomDialog();
      if (a === 'deck-delete') this.deleteDeck();
      if (a === 'deck-test') this.app.startSoloWith(this.deck);
    });
    $('#deckSelect').addEventListener('change', e => { this.select(e.target.value); });
    $('#deckName').addEventListener('change', e => { this.deck.name = e.target.value.trim() || 'Sin nombre'; this.save(); this.renderDeckSelect(); });
    const grid = $('#resGrid');
    grid.addEventListener('click', e => { const c = e.target.closest('.rcard'); if (c) this.add(c.dataset.k, 1, c); });
    grid.addEventListener('contextmenu', e => { const c = e.target.closest('.rcard'); if (c) { e.preventDefault(); this.add(c.dataset.k, -1, c); } });
    grid.addEventListener('pointerover', e => { const c = e.target.closest('.rcard'); c && this.preview(c.dataset.k); });
    const list = $('#deckCards');
    list.addEventListener('click', e => {
      const b = e.target.closest('[data-q]'); if (!b) return;
      this.add(b.dataset.k, +b.dataset.q);
    });
    list.addEventListener('pointerover', e => { const r = e.target.closest('.drow'); r && this.preview(r.dataset.k); });
    this.io = new IntersectionObserver(en => { if (en.some(x => x.isIntersecting)) this.more(); }, { root: $('.results'), rootMargin: '600px' });
    this.io.observe($('#resMore'));
  }

  fillFilters() {
    if (this.filled) return;
    this.filled = true;
    $('#fBlock').innerHTML = '<option value="">Todos los bloques</option>' + DB.blocks.map(b => `<option value="${b.code}">${esc(b.name)}</option>`).join('');
    this.fillEditions();
    $('#fType').innerHTML = '<option value="">Todos</option>' + Object.entries(DB.types).map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('');
    $('#fRace').innerHTML = '<option value="">Todas</option>' + raceList().map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
    $('#fRar').innerHTML = '<option value="">Todas</option>' + Object.entries(DB.rarities).map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('');
    const nums = '<option value="">Todos</option>' + [0, 1, 2, 3, 4, 5, 6].map(n => `<option value="${n}">${n}</option>`).join('') + '<option value="7">7 o más</option>';
    $('#fCost').innerHTML = nums; $('#fStr').innerHTML = nums;
  }
  fillEditions() {
    const b = $('#fBlock').value;
    const eds = DB.editions.filter(e => !b || e.block === b);
    const groups = b ? [[DB.blocks.find(x => x.code === b), eds]] : DB.blocks.map(bl => [bl, eds.filter(e => e.block === bl.code)]);
    $('#fEd').innerHTML = '<option value="">Todas las ediciones</option>' + groups.map(([bl, list]) => `<optgroup label="${esc(bl.name)}">${list.map(e => `<option value="${e.id}">${esc(e.title)}</option>`).join('')}</optgroup>`).join('');
  }
  clearFilters() {
    $('#fQ').value = ''; $('#fText').checked = false; $('#fUnique').checked = false;
    for (const id of ['#fBlock', '#fType', '#fRace', '#fRar', '#fCost', '#fStr']) $(id).value = '';
    this.fillEditions(); $('#fEd').value = '';
    this.search();
  }
  filters() {
    const num = id => { const v = $(id).value; return v === '' ? '' : +v; };
    return {
      q: $('#fQ').value, inText: $('#fText').checked, block: $('#fBlock').value, ed: num('#fEd') || 0,
      type: num('#fType') || 0, race: num('#fRace'), rarity: num('#fRar'), cost: num('#fCost'), str: num('#fStr'), unique: $('#fUnique').checked,
    };
  }

  search() {
    this.results = searchCards(this.filters());
    this.shown = 0;
    $('#resGrid').innerHTML = '';
    $('#resCount').textContent = `${this.results.length.toLocaleString('es-CL')} carta${this.results.length === 1 ? '' : 's'}`;
    this.more();
  }
  more() {
    if (this.shown >= this.results.length) { $('#resMore').textContent = this.results.length ? '' : 'Ninguna carta coincide con esos filtros.'; return; }
    const slice = this.results.slice(this.shown, this.shown + PAGE);
    this.shown += slice.length;
    const html = slice.map(c => {
      const e = edition(c);
      const n = this.deck ? this.deck.cards[c.key] || 0 : 0;
      return `<div class="rcard" data-k="${c.key}" title="${esc(c.name)}"><img loading="lazy" decoding="async" data-k="${c.key}" src="${THUMB(c.key)}" alt="" onload="this.classList.add('ok')">
        <div class="rname"><b>${esc(c.name)}</b><i>${esc(e ? e.title : '')}</i></div>${n ? `<span class="incount">${n}</span>` : ''}</div>`;
    }).join('');
    $('#resGrid').insertAdjacentHTML('beforeend', html);
    $('#resMore').textContent = this.shown < this.results.length ? 'Cargando más…' : '';
  }

  preview(k) {
    const c = card(k); const e = edition(c);
    const meta = [typeName(c), c.race > 0 ? raceName(c) : '', c.cost >= 0 ? `coste ${c.cost}` : '', c.type === T.ALIADO && c.str >= 0 ? `fuerza ${c.str}` : '', rarityName(c)].filter(Boolean).join(', ');
    $('#bInspect').innerHTML = `<img src="${IMG(k)}" alt="${esc(c.name)}"><div class="insp-text"><b style="color:var(--parch);font-size:15px">${esc(c.name)}</b><br>${esc(meta)}<br><i>${esc(e ? `${e.title} (${e.blockName})` : '')}</i><p style="margin:6px 0 0;font-family:var(--serif);font-size:14px;color:var(--parch)">${textHTML(c, esc)}</p></div>`;
  }

  add(k, d, fromEl = null) {
    const cur = this.deck.cards[k] || 0;
    const n = Math.max(0, cur + d);
    if (n) this.deck.cards[k] = n; else delete this.deck.cards[k];
    this.save();
    this.renderDeck();
    for (const el of document.querySelectorAll(`.rcard[data-k="${CSS.escape(k)}"]`)) {
      let b = el.querySelector('.incount');
      if (!n) { b && b.remove(); continue; }
      if (!b) { b = document.createElement('span'); b.className = 'incount'; el.appendChild(b); }
      b.textContent = n;
    }
    if (fromEl && d > 0) {
      const r = fromEl.getBoundingClientRect();
      fromEl.animate([{ transform: 'scale(.94)' }, { transform: 'none' }], { duration: 180 });
      const row = document.querySelector(`.drow[data-k="${CSS.escape(k)}"]`);
      row && row.animate([{ background: 'rgba(200,162,75,.35)' }, { background: 'transparent' }], { duration: 700 });
      void r;
    }
  }

  renderDeck() {
    const d = this.deck;
    $('#deckName').value = d.name;
    const total = deckSize(d);
    const by = {};
    for (const [k, n] of Object.entries(d.cards)) { const c = card(k); by[c.type] = (by[c.type] || 0) + n; }
    $('#deckStats').innerHTML = `<div class="total">${total}<small>carta${total === 1 ? '' : 's'}</small></div>
      <div class="bars">${GROUPS.filter(([t]) => by[t]).map(([t, n]) => `<span>${esc(n)} <b>${by[t]}</b></span>`).join('') || '<span>Sin cartas todavía</span>'}</div>`;
    const entries = sortedEntries(d.cards);
    $('#deckEmpty').hidden = !!entries.length;
    $('#deckCards').innerHTML = GROUPS.map(([t, label]) => {
      const rows = entries.filter(([k]) => card(k).type === t);
      if (!rows.length) return '';
      const cnt = rows.reduce((s, [, n]) => s + n, 0);
      return `<div class="dgroup"><h4><span>${esc(label)}</span><span>${cnt}</span></h4>${rows.map(([k, n]) => {
        const c = card(k); const e = edition(c);
        return `<div class="drow" data-k="${k}"><div class="thumb" style="background-image:url('${THUMB(k)}')"></div>
          <div class="dn">${esc(c.name)}<small>${esc(e ? e.title : '')}${c.cost >= 0 && t !== T.ORO ? `, coste ${c.cost}` : ''}</small></div>
          <div class="qty"><button class="qbtn" data-q="-1" data-k="${k}" aria-label="Quitar una">−</button><b>${n}</b><button class="qbtn" data-q="1" data-k="${k}" aria-label="Agregar una">+</button></div></div>`;
      }).join('')}</div>`;
    }).join('');
  }

  renderDeckSelect() {
    const decks = loadDecks();
    $('#deckSelect').innerHTML = decks.map(d => `<option value="${d.id}" ${d.id === this.deck.id ? 'selected' : ''}>${esc(d.name)} (${deckSize(d)})</option>`).join('');
  }
  save() { upsertDeck(this.deck); this.renderDeckSelectSoon(); }
  renderDeckSelectSoon() { clearTimeout(this._rs); this._rs = setTimeout(() => this.renderDeckSelect(), 250); }
  select(id) {
    const d = loadDecks().find(x => x.id === id); if (!d) return;
    this.deck = d; setSelectedId(id); this.renderDeck(); this.search();
  }
  createDeck(name = 'Mazo nuevo', cards = {}) {
    const d = upsertDeck(newDeck(name, cards));
    this.deck = d; setSelectedId(d.id); this.renderDeckSelect(); this.renderDeck(); this.search();
    if (!Object.keys(cards).length) { $('#deckName').focus(); $('#deckName').select(); }
  }
  duplicate() { this.createDeck(this.deck.name + ' (copia)', this.deck.cards); toast('Mazo duplicado.'); }
  async deleteDeck() {
    if (!(await confirmBox('Eliminar mazo', `Se borra "${this.deck.name}" de este navegador.`, 'Eliminar'))) return;
    removeDeck(this.deck.id);
    const left = loadDecks();
    if (!left.length) { this.createDeck('Mazo nuevo'); return; }
    this.select(left[0].id); this.renderDeckSelect();
  }

  importDeck() {
    const box = openModal(`<h2>Importar mazo</h2><p>Pega un código <b>MYL1.…</b> o una lista con una carta por línea, por ejemplo <i>3 Rey Arturo Pendragón (Espada Sagrada)</i>.</p>
      <textarea class="code" id="impText" autofocus></textarea>
      <label class="field" style="margin-top:10px"><span>Nombre</span><input id="impName" value="Mazo importado"></label>
      <div class="modal-foot"><button class="btn" data-x="no">Cancelar</button><button class="btn primary" data-x="ok">Importar como mazo nuevo</button></div>`);
    box.querySelector('[data-x=no]').onclick = () => closeModal();
    box.querySelector('[data-x=ok]').onclick = () => {
      const { cards, missing } = parseDeckInput(box.querySelector('#impText').value);
      if (!Object.keys(cards).length) { toast('No reconocí ninguna carta en el texto.', { err: true }); return; }
      closeModal();
      this.createDeck(box.querySelector('#impName').value.trim() || 'Mazo importado', cards);
      toast(missing.length ? `Importado. No encontré: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''}` : 'Mazo importado.', { ms: 6000 });
    };
  }
  exportDeck() {
    const code = encodeDeck(this.deck.cards);
    const link = `${location.origin}${location.pathname}?deck=${code}&name=${encodeURIComponent(this.deck.name)}`;
    const text = deckToText(this.deck);
    const box = openModal(`<h2>Exportar "${esc(this.deck.name)}"</h2>
      <p>El código sirve para importar el mazo aquí o en una mesa. El enlace abre este mazo en el constructor de quien lo reciba.</p>
      <label class="field"><span>Código</span><textarea class="code" readonly style="min-height:70px">${esc(code)}</textarea></label>
      <label class="field" style="margin-top:10px"><span>Lista</span><textarea class="code" readonly>${esc(text)}</textarea></label>
      <div class="modal-foot"><button class="btn" data-x="code">Copiar código</button><button class="btn" data-x="list">Copiar lista</button><button class="btn primary" data-x="link">Copiar enlace</button></div>`);
    const cp = async (v, what) => toast((await copyText(v)) ? `${what} copiado.` : 'No se pudo copiar.');
    box.querySelector('[data-x=code]').onclick = () => cp(code, 'Código');
    box.querySelector('[data-x=list]').onclick = () => cp(text, 'Lista');
    box.querySelector('[data-x=link]').onclick = () => cp(link, 'Enlace');
  }
  randomDialog() {
    const box = openModal(`<h2>Mazo al azar</h2><p>50 cartas: 16 oros, aliados y soporte de la edición o bloque que elijas. Sirve para probar rápido.</p>
      <label class="field"><span>Tomar cartas de</span><select id="rdSrc">
        <option value="">Cualquier edición</option>
        ${DB.blocks.map(b => `<optgroup label="${esc(b.name)}"><option value="b:${b.code}">Todo ${esc(b.name)}</option>${DB.editions.filter(e => e.block === b.code).map(e => `<option value="e:${e.id}">${esc(e.title)}</option>`).join('')}</optgroup>`).join('')}
      </select></label>
      <div class="modal-foot"><button class="btn" data-x="no">Cancelar</button><button class="btn primary" data-x="ok">Crear mazo</button></div>`, { narrow: true });
    box.querySelector('[data-x=no]').onclick = () => closeModal();
    box.querySelector('[data-x=ok]').onclick = () => {
      const v = box.querySelector('#rdSrc').value;
      const opt = v.startsWith('b:') ? { block: v.slice(2) } : v.startsWith('e:') ? { edIds: [+v.slice(2)] } : {};
      const label = v ? box.querySelector('#rdSrc').selectedOptions[0].textContent.replace(/^Todo /, '') : 'todas las ediciones';
      closeModal();
      this.createDeck(`Al azar: ${label}`, randomDeck(opt));
    };
  }
}

// Deck chooser used by the table (solo test and room seats)
export function chooseDeckModal(title, { allowNone = false, noneLabel = 'Sin mazo' } = {}) {
  return new Promise(res => {
    let done = false;
    const decks = loadDecks();
    const box = openModal(`<h2>${esc(title)}</h2>
      ${decks.length ? `<div class="opt-grid" style="max-height:44vh;overflow:auto">${decks.map(d => `<button class="btn" style="display:flex;justify-content:space-between;text-align:left" data-d="${d.id}"><span>${esc(d.name)}</span><small style="color:var(--parch-2)">${deckSize(d)} cartas</small></button>`).join('')}</div>` : '<p>Aún no tienes mazos guardados. Crea uno al azar o pega un código.</p>'}
      <label class="field" style="margin-top:12px"><span>O pega un código de mazo</span><input id="cdCode" placeholder="MYL1.…"></label>
      <label class="field" style="margin-top:10px"><span>O un mazo al azar</span><select id="cdRand"><option value="">Elegir edición o bloque…</option>
        ${DB.blocks.map(b => `<optgroup label="${esc(b.name)}"><option value="b:${b.code}">Todo ${esc(b.name)}</option>${DB.editions.filter(e => e.block === b.code).map(e => `<option value="e:${e.id}">${esc(e.title)}</option>`).join('')}</optgroup>`).join('')}
      </select></label>
      <div class="modal-foot">${allowNone ? `<button class="btn" data-x="none">${esc(noneLabel)}</button>` : ''}<button class="btn" data-x="no">Cancelar</button><button class="btn primary" data-x="ok">Usar</button></div>`,
    { onClose: () => { if (!done) res(null); } });
    const finish = v => { done = true; closeModal(); res(v); };
    box.querySelectorAll('[data-d]').forEach(b => b.onclick = () => finish(decks.find(d => d.id === b.dataset.d)));
    box.querySelector('[data-x=no]').onclick = () => finish(null);
    const none = box.querySelector('[data-x=none]'); none && (none.onclick = () => finish({ none: true }));
    box.querySelector('[data-x=ok]').onclick = () => {
      const code = box.querySelector('#cdCode').value.trim();
      if (code) {
        const { cards } = parseDeckInput(code);
        if (!Object.keys(cards).length) { toast('Ese código no es válido.', { err: true }); return; }
        finish(newDeck('Mazo pegado', cards)); return;
      }
      const v = box.querySelector('#cdRand').value;
      if (v) {
        const opt = v.startsWith('b:') ? { block: v.slice(2) } : { edIds: [+v.slice(2)] };
        finish(newDeck(`Al azar: ${box.querySelector('#cdRand').selectedOptions[0].textContent.replace(/^Todo /, '')}`, randomDeck(opt)));
        return;
      }
      toast('Elige un mazo, pega un código o elige una edición.');
    };
  });
}
