import { DB, loadDB, IMG, foilTier, card } from './data.js';
import { Builder, chooseDeckModal } from './builder.js';
import { Session } from './session.js';
import { DraftApp } from './draft.js';
import { DEFAULTS as DRAFT_DEFAULTS } from './draft-engine.js';
import { createRoom, createDraftRoom, roomKind, cleanCode } from './net.js';
import { $, $$, esc, toast, closeModal, closeMenu } from './ui.js';
import { upsertDeck, newDeck, decodeDeck, loadDecks, getSelectedId, setSelectedId } from './decks.js';

const HERO = ['45/007', '19/001', '21/007', '21/008', '19/067'];
const LS_NAME = 'myl.name';

class App {
  constructor() {
    this.session = null;
    this.builder = new Builder(this);
    this.draft = new DraftApp(this);
    this.soloDecks = null;
    this.bindHome();
    this.dbPromise = null;
    this.prefetch();
    this.route();
    window.addEventListener('popstate', () => this.route());
  }

  // ------------------------------------------------------------ data
  prefetch() {
    this.dbPromise = loadDB(p => { this.loadPct = p; const bar = $('#loadBar'); if (bar) bar.style.width = Math.round(p * 100) + '%'; });
    this.dbPromise.catch(() => {});
  }
  async needDB() {
    if (DB.ready) return true;
    $('#loading').hidden = false;
    $('#loadText').textContent = 'Cargando las cartas de Mitos y Leyendas…';
    try { await (this.dbPromise || (this.dbPromise = loadDB())); return true; }
    catch (e) { this.dbPromise = null; toast(e.message || 'No se pudo cargar la base de cartas.', { err: true }); this.prefetch(); return false; }
    finally { $('#loading').hidden = true; }
  }

  // ------------------------------------------------------------ screens
  show(id) {
    closeMenu(); closeModal();
    for (const s of $$('.screen')) s.hidden = s.id !== id;
    document.title = { 's-home': 'MyL Drafter · Mesa de juego', 's-decks': 'Mis mazos · MyL Drafter', 's-table': 'Mesa · MyL Drafter', 's-draft': 'Draft · MyL Drafter' }[id] || 'MyL Drafter';
  }
  setUrl(q, replace = false) {
    const url = location.pathname + (q ? '?' + q : '');
    if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
  }
  async route() {
    const p = new URLSearchParams(location.search);
    const t = cleanCode(p.get('t') || '');
    const deck = p.get('deck');
    if (t) {
      if (!this.name()) { this.showHome(); $('#joinCode').value = t; $('#homeName').focus(); $('#homeNote').textContent = `Escribe tu nombre y pulsa Unirse para entrar a ${t}.`; return; }
      this.openCode(t); return;
    }
    if (deck) {
      if (!(await this.needDB())) return;
      const cards = decodeDeck(deck);
      if (cards) {
        const d = upsertDeck(newDeck(p.get('name') || 'Mazo compartido', cards));
        setSelectedId(d.id);
        this.setUrl('view=decks', true);
        toast('Mazo agregado a tus mazos.');
      }
      this.openDecks(); return;
    }
    if (p.get('view') === 'decks') { this.openDecks(); return; }
    if (p.get('view') === 'draft') { this.openPracticeDraft(); return; }
    this.showHome();
  }

  // ------------------------------------------------------------ home
  name() { try { return (localStorage.getItem(LS_NAME) || '').trim(); } catch { return ''; } }
  setName(n) { try { localStorage.setItem(LS_NAME, n); } catch { /* storage off */ } }
  bindHome() {
    $('#homeName').value = this.name();
    $('#homeName').addEventListener('change', e => this.setName(e.target.value.trim()));
    $('#joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') this.homeAct('join'); });
    $('#s-home').addEventListener('click', e => { const b = e.target.closest('[data-act]'); b && this.homeAct(b.dataset.act); });
    document.addEventListener('click', e => { const b = e.target.closest('#s-decks [data-act="home"]'); if (b) this.goHome(); });
  }
  showHome() {
    this.endSession();
    this.show('s-home');
    const fan = $('#heroFan');
    if (!fan.childElementCount) {
      fan.innerHTML = HERO.map((k, i) => {
        const a = (i - 2) * 8, x = (i - 2) * 26, y = Math.abs(i - 2) * 14;
        return `<div class="hero-card" style="--to: translate(calc(-50% + ${x}%), calc(-50% + ${y}px)) rotate(${a}deg); animation-delay:${150 + i * 110}ms; z-index:${10 - Math.abs(i - 2)}"><img src="${IMG(k)}" alt=""></div>`;
      }).join('');
    }
  }
  needName() {
    const n = $('#homeName').value.trim();
    if (!n) { $('#homeName').focus(); $('#homeNote').textContent = 'Primero escribe tu nombre para la mesa.'; return null; }
    this.setName(n);
    return n;
  }
  async homeAct(a) {
    if (a === 'decks') { this.setUrl('view=decks'); this.openDecks(); return; }
    if (a === 'solo') { this.startSoloPick(); return; }
    if (a === 'draft-practice') { const n = $('#homeName').value.trim(); if (n) this.setName(n); this.setUrl('view=draft'); this.openPracticeDraft(); return; }
    const n = this.needName(); if (!n) return;
    if (a === 'join') {
      const code = cleanCode($('#joinCode').value);
      if (code.length !== 5) { $('#homeNote').textContent = 'El código de la mesa tiene 5 caracteres.'; $('#joinCode').focus(); return; }
      this.setUrl('t=' + code); this.openCode(code);
    }
    if (a === 'draft-create') {
      if (!(await this.needDB())) return;
      $('#homeNote').textContent = 'Creando el draft…';
      try {
        let st = {}; try { st = JSON.parse(localStorage.getItem('myl.draft.settings') || '{}'); } catch { st = {}; }
        const code = await createDraftRoom(n, { ...DRAFT_DEFAULTS, ...st });
        this.setUrl('t=' + code); $('#homeNote').textContent = '';
        this.openDraft(code);
      } catch (e) { $('#homeNote').textContent = e.message || 'No se pudo crear el draft.'; }
    }
    if (a === 'create') {
      if (!(await this.needDB())) return;
      $('#homeNote').textContent = 'Creando la mesa…';
      try {
        const code = await createRoom(n, { hand: 8, oroInicial: true, autoPhases: true, specHands: false, testCards: true });
        this.setUrl('t=' + code); $('#homeNote').textContent = '';
        this.openTable(code);
      } catch (e) { $('#homeNote').textContent = e.message || 'No se pudo crear la mesa.'; }
    }
  }

  // ------------------------------------------------------------ decks
  async openDecks(deckId = null) {
    this.endSession();
    if (!(await this.needDB())) { this.showHome(); return; }
    this.show('s-decks');
    this.builder.open(deckId);
  }
  chooseDeck(title, opts) { return chooseDeckModal(title, opts); }

  // ------------------------------------------------------------ tables
  endSession() {
    if (this.session) { this.session.destroy(); this.session = null; }
    if (this.draft) this.draft.leave();
  }
  // one code box for tables and drafts
  async openCode(code) {
    if (!(await this.needDB())) { this.showHome(); return; }
    let kind = null;
    try { kind = await roomKind(code); } catch { kind = null; }
    if (!kind) { this.setUrl('', true); this.showHome(); $('#homeNote').textContent = `No existe una mesa ni un draft con el código ${code}.`; return; }
    if (kind === 'myl-draft') this.openDraft(code); else this.openTable(code);
  }
  async openDraft(code) {
    this.endSession();
    if (!(await this.needDB())) { this.showHome(); return; }
    this.show('s-draft');
    try { await this.draft.openRoom(code, this.name() || 'Invitado'); }
    catch (e) { this.draft.leave(); this.setUrl('', true); this.showHome(); $('#homeNote').textContent = e.message || 'No se pudo entrar al draft.'; }
  }
  async openPracticeDraft() {
    this.endSession();
    if (!(await this.needDB())) { this.showHome(); return; }
    this.show('s-draft');
    this.draft.openPractice(this.name() || 'Jugador');
  }
  openTableFromDraft(code) { this.endSession(); this.setUrl('t=' + code); this.openTable(code); }
  async openTable(code) {
    this.endSession();
    if (!(await this.needDB())) { this.showHome(); return; }
    const name = this.name() || 'Invitado';
    this.show('s-table');
    $('#feed').innerHTML = '';
    const s = new Session(this, { mode: 'online', name, code });
    this.session = s;
    try { await s.openOnline(); }
    catch (e) {
      if (this.session === s) this.endSession();
      this.setUrl('', true);
      this.showHome();
      $('#homeNote').textContent = e.message || 'No se pudo entrar a la mesa.';
    }
  }
  async startSoloPick() {
    if (!(await this.needDB())) return;
    const a = await this.chooseDeck('Tu mazo para la prueba');
    if (!a) return;
    const b = await this.chooseDeck('¿Mazo para el lado de arriba?', { allowNone: true, noneLabel: 'Dejar vacío' });
    this.startSoloWith(a, b && !b.none ? b : null);
  }
  async startSoloWith(a, b = null) {
    if (!(await this.needDB())) return;
    if (!a || !Object.keys(a.cards || {}).length) { toast('Ese mazo está vacío.'); return; }
    this.endSession();
    this.soloDecks = [a, b];
    this.setUrl('view=solo', true);
    this.show('s-table');
    $('#feed').innerHTML = '';
    const s = new Session(this, { mode: 'solo', name: this.name() || 'Jugador 1' });
    this.session = s;
    await s.startSolo(a, b);
  }
  restartSolo() { if (this.soloDecks) this.startSoloWith(...this.soloDecks); }
  goHome() { this.endSession(); this.setUrl('', false); this.showHome(); }
}

const start = () => { if (!window.mylApp) window.mylApp = new App(); };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
