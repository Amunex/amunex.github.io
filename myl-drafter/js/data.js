// Card database: compact snapshot of api.myl.cl, images hotlinked from the official server.
export const DATA_V = 3;
// The image server keeps editions 1-9 in two-digit folders (01/001.png); card keys stay "1/001".
const imgPath = key => { const i = key.indexOf('/'); return i === 1 ? '0' + key : key; };
export const IMG = key => `https://api.myl.cl/static/cards/${imgPath(key)}.png`;
export const BACK_URL = 'https://api.myl.cl/static/cards/00/000.png';
// Light thumbnails through a public resize cache (falls back to the original PNG on error).
export const THUMB = key => `https://wsrv.nl/?url=api.myl.cl/static/cards/${imgPath(key)}.png&w=300&output=webp&q=82`;
if (typeof document !== 'undefined') {
  document.addEventListener('error', e => {
    const im = e.target;
    if (im && im.tagName === 'IMG' && im.dataset && im.dataset.k && im.src.includes('wsrv.nl')) im.src = IMG(im.dataset.k);
  }, true);
}
export const T = { ALIADO: 1, TALISMAN: 2, ARMA: 3, TOTEM: 4, ORO: 5, MONUMENTO: 6 };
// rarity ids -> foil tier (0 none, 1 light, 2 strong)
const FOIL = { 0: 1, 1: 2, 2: 2, 3: 2, 4: 1, 5: 0, 6: 0, 7: 0, 8: 2, 9: 2, 10: 0, 11: 1 };

export const DB = {
  ready: false, cards: [], byKey: new Map(), editions: [], edById: new Map(), edIndex: new Map(),
  blocks: [], types: {}, races: {}, rarities: {}, keywords: {},
};

export const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

let loading = null;
export function loadDB(onProgress) {
  if (loading) return loading;
  loading = (async () => {
    const res = await fetch(`data/cards.json?v=${DATA_V}`);
    if (!res.ok) throw new Error(`No se pudo cargar la base de cartas (${res.status}).`);
    let json;
    const total = +res.headers.get('content-length') || 0;
    if (res.body && onProgress) {
      const reader = res.body.getReader();
      const chunks = []; let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); got += value.length;
        onProgress(total ? Math.min(.98, got / (total * 4.5)) : Math.min(.95, got / 4e6));
      }
      const buf = new Uint8Array(got); let o = 0;
      for (const c of chunks) { buf.set(c, o); o += c.length; }
      json = JSON.parse(new TextDecoder().decode(buf));
    } else {
      json = await res.json();
    }
    build(json);
    onProgress && onProgress(1);
    return DB;
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

function build(j) {
  DB.types = j.types; DB.races = j.races; DB.rarities = j.rarities; DB.keywords = j.keywords;
  DB.blocks = j.blocks;
  const bname = Object.fromEntries(j.blocks.map(b => [b.code, b.name]));
  j.editions.forEach((e, i) => { e.blockName = bname[e.block]; DB.edById.set(e.id, e); DB.edIndex.set(e.id, i); });
  DB.editions = j.editions;
  for (const r of j.cards) {
    const [ed, num, name, type, race, rarity, cost, str, kw, text, flavor = ''] = r;
    const key = `${ed}/${num}`;
    const c = { key, ed, num, name, type, race, rarity, cost, str, kw, text, flavor, nn: norm(name), tn: null };
    DB.cards.push(c);
    DB.byKey.set(key, c);
  }
  DB.ready = true;
}

export const card = key => DB.byKey.get(key) || { key, name: 'Carta desconocida', type: 0, race: 0, rarity: 6, cost: -1, str: -1, kw: 0, text: '', ed: 0, nn: '' };
export const typeName = c => DB.types[c.type] || '';
// what to show under a card: its ability, or (for cards without one) the flavour text in italics
export const textHTML = (c, esc) => c.text ? esc(c.text) : c.flavor ? `<i class="flavor">${esc(c.flavor)}</i>`
  : `<i class="flavor">${c.type === T.ORO || /^oro\b/i.test(c.name) ? 'Oro sin habilidad.' : / cread[oa]\b/i.test(c.name) ? 'Ficha creada por otra carta. No tiene texto.' : 'Esta carta no tiene texto.'}</i>`;
export const raceName = c => (c.race > 0 ? DB.races[c.race] : '') || '';
export const rarityName = c => DB.rarities[c.rarity] || '';
export const edition = c => DB.edById.get(c.ed);
export const foilTier = c => FOIL[c.rarity] || 0;
export const isAlly = c => c.type === T.ALIADO;
export const keywordNames = c => {
  const out = [];
  if (!(c.kw > 0)) return out;
  for (const [flag, k] of Object.entries(DB.keywords)) if (+flag <= 65536 && (c.kw & +flag)) out.push(k.t);
  return out;
};

export function searchCards(f) {
  const q = norm(f.q || '').trim();
  const terms = q ? q.split(/\s+/) : [];
  const out = [];
  const seen = f.unique ? new Set() : null;
  const edBlock = f.block ? new Set(DB.editions.filter(e => e.block === f.block).map(e => e.id)) : null;
  for (const c of DB.cards) {
    if (f.ed && c.ed !== f.ed) continue;
    if (edBlock && !edBlock.has(c.ed)) continue;
    if (f.type && c.type !== f.type) continue;
    if (f.race !== '' && f.race != null && c.race !== f.race) continue;
    if (f.rarity !== '' && f.rarity != null && c.rarity !== f.rarity) continue;
    if (f.cost !== '' && f.cost != null && (f.cost >= 7 ? c.cost < 7 : c.cost !== f.cost)) continue;
    if (f.str !== '' && f.str != null && (f.str >= 7 ? c.str < 7 : c.str !== f.str)) continue;
    if (terms.length) {
      let hay = c.nn;
      if (f.inText) { if (c.tn === null) c.tn = norm(c.text); hay += ' ' + c.tn; }
      let ok = true;
      for (const t of terms) if (!hay.includes(t)) { ok = false; break; }
      if (!ok) continue;
    }
    if (seen) { if (seen.has(c.nn)) continue; seen.add(c.nn); }
    out.push(c);
  }
  if (q) {
    // exact and prefix name matches first
    const score = c => (c.nn === q ? 0 : c.nn.startsWith(q) ? 1 : 2);
    out.sort((a, b) => score(a) - score(b));
  }
  return out;
}

// races actually used by allies, sorted by name
export function raceList() {
  const used = new Set(DB.cards.filter(c => c.race > 0).map(c => c.race));
  return [...used].map(id => ({ id, name: DB.races[id] })).filter(r => r.name).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

const preloaded = new Set();
export function preloadThumbs(keys) {
  for (const k of keys) {
    if (preloaded.has(k)) continue;
    preloaded.add(k);
    const im = new Image(); im.decoding = 'async'; im.dataset.k = k; im.src = THUMB(k);
  }
}
