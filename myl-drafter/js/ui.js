import { IMG } from './data.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
export const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- context menu ----------
const menuEl = () => document.getElementById('menu');
let menuClose = null;
// items: {label, hint, act, cls, disabled} | 'sep' | {title} | {num: {label, value, min, max, act}}
export function openMenu(x, y, items) {
  closeMenu();
  const m = menuEl();
  m.innerHTML = '';
  for (const it of items) {
    if (!it) continue;
    if (it === 'sep') { m.appendChild(document.createElement('hr')); continue; }
    if (it.title) { const h = document.createElement('h5'); h.textContent = it.title; m.appendChild(h); continue; }
    if (it.num) {
      const row = document.createElement('div'); row.className = 'num-row';
      row.innerHTML = `<input type="number" min="${it.num.min ?? 1}" max="${it.num.max ?? 99}" value="${it.num.value ?? 1}"><button class="btn small">${esc(it.num.label)}</button>`;
      const inp = row.querySelector('input');
      const go = () => { const v = Math.max(it.num.min ?? 1, Math.min(it.num.max ?? 99, parseInt(inp.value, 10) || 0)); closeMenu(); it.num.act(v); };
      row.querySelector('button').onclick = go;
      inp.onkeydown = e => { if (e.key === 'Enter') go(); };
      m.appendChild(row);
      continue;
    }
    const b = document.createElement('button');
    b.innerHTML = `<span>${esc(it.label)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}`;
    if (it.cls) b.className = it.cls;
    b.disabled = !!it.disabled;
    b.onclick = e => { e.stopPropagation(); closeMenu(); it.act && it.act(); };
    m.appendChild(b);
  }
  m.hidden = false;
  const r = m.getBoundingClientRect();
  const W = window.innerWidth, H = window.innerHeight;
  m.style.left = Math.max(6, Math.min(x, W - r.width - 6)) + 'px';
  m.style.top = Math.max(6, Math.min(y, H - r.height - 6)) + 'px';
  const first = m.querySelector('button:not([disabled]), input');
  first && first.focus({ preventScroll: true });
  const onDown = e => { if (!m.contains(e.target)) closeMenu(); };
  const onKey = e => { if (e.key === 'Escape') closeMenu(); };
  setTimeout(() => { document.addEventListener('pointerdown', onDown, true); document.addEventListener('keydown', onKey); }, 0);
  menuClose = () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey); };
}
export function closeMenu() {
  const m = menuEl();
  if (menuClose) { menuClose(); menuClose = null; }
  if (m) m.hidden = true;
}

// ---------- modal ----------
let modalCleanup = null;
export function openModal(html, { narrow = false, onClose = null, dismiss = true } = {}) {
  closeModal();
  const wrap = document.getElementById('modal');
  const box = wrap.querySelector('.modal-box');
  box.className = 'modal-box' + (narrow ? ' narrow' : '');
  box.innerHTML = html;
  wrap.hidden = false;
  const onKey = e => { if (e.key === 'Escape' && dismiss) closeModal(); };
  const onDown = e => { if (e.target === wrap && dismiss) closeModal(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('pointerdown', onDown);
  modalCleanup = () => { document.removeEventListener('keydown', onKey); wrap.removeEventListener('pointerdown', onDown); onClose && onClose(); };
  const f = box.querySelector('[autofocus], input, textarea, select, button');
  f && setTimeout(() => f.focus({ preventScroll: true }), 30);
  return box;
}
export function closeModal() {
  const wrap = document.getElementById('modal');
  if (modalCleanup) { const c = modalCleanup; modalCleanup = null; c(); }
  if (wrap) wrap.hidden = true;
}
export const modalOpen = () => !document.getElementById('modal').hidden;

export function confirmBox(title, text, okLabel = 'Aceptar', cancelLabel = 'Cancelar') {
  return new Promise(res => {
    let done = false;
    const box = openModal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="modal-foot"><button class="btn" data-x="no">${esc(cancelLabel)}</button><button class="btn primary" data-x="ok">${esc(okLabel)}</button></div>`,
      { narrow: true, onClose: () => { if (!done) res(false); } });
    box.querySelector('[data-x=ok]').onclick = () => { done = true; closeModal(); res(true); };
    box.querySelector('[data-x=no]').onclick = () => { done = true; closeModal(); res(false); };
  });
}
export function promptNumber(title, text, value = 1, max = 99) {
  return new Promise(res => {
    let done = false;
    const box = openModal(`<h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}<input type="number" min="0" max="${max}" value="${value}" style="width:120px;font-size:20px;text-align:center" autofocus>
      <div class="modal-foot"><button class="btn" data-x="no">Cancelar</button><button class="btn primary" data-x="ok">Aceptar</button></div>`, { narrow: true, onClose: () => { if (!done) res(null); } });
    const inp = box.querySelector('input');
    const ok = () => { done = true; const v = parseInt(inp.value, 10); closeModal(); res(Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : null); };
    inp.onkeydown = e => { if (e.key === 'Enter') ok(); };
    box.querySelector('[data-x=ok]').onclick = ok;
    box.querySelector('[data-x=no]').onclick = () => { done = true; closeModal(); res(null); };
    setTimeout(() => inp.select(), 40);
  });
}

// ---------- toasts ----------
export function toast(text, { action = null, label = 'Deshacer', ms = 3800, err = false } = {}) {
  const box = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.innerHTML = `<span>${esc(text)}</span>`;
  if (action) {
    const b = document.createElement('button'); b.className = 'btn small'; b.textContent = label;
    b.onclick = () => { t.remove(); action(); };
    t.appendChild(b);
  }
  box.appendChild(t);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => t.remove(), ms);
}

// ---------- effects ----------
const fxLayer = () => document.getElementById('layer-fx');
export function sparkles(rect, n = 18) {
  if (reduced() || !rect) return;
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i'); s.className = 'spark';
    const ang = Math.random() * Math.PI * 2, d = 40 + Math.random() * Math.max(rect.width, 80) * .9;
    s.style.left = (cx + (Math.random() - .5) * rect.width * .6) + 'px';
    s.style.top = (cy + (Math.random() - .5) * rect.height * .6) + 'px';
    s.style.setProperty('--dx', Math.cos(ang) * d + 'px');
    s.style.setProperty('--dy', Math.sin(ang) * d + 'px');
    s.style.animationDelay = (Math.random() * 120) + 'ms';
    fxLayer().appendChild(s);
    setTimeout(() => s.remove(), 1200);
  }
}
export function damagePop(rect, text) {
  if (!rect) return;
  const d = document.createElement('div'); d.className = 'dmg-pop'; d.textContent = text;
  d.style.left = (rect.left + rect.width / 2) + 'px'; d.style.top = (rect.top + rect.height * .25) + 'px';
  fxLayer().appendChild(d); setTimeout(() => d.remove(), 1300);
}
let stageTimer = null;
export function stage(keys, caption, ms = 2300) {
  const old = document.querySelector('.stage'); old && old.remove();
  clearTimeout(stageTimer);
  const st = document.createElement('div'); st.className = 'stage';
  st.innerHTML = `<div><div class="cards">${keys.slice(0, 8).map((k, i) => `<div class="scard" style="animation-delay:${i * 70}ms"><img src="${IMG(k)}" alt=""><div class="foil"></div></div>`).join('')}</div>${caption ? `<div class="cap">${esc(caption)}</div>` : ''}</div>`;
  document.body.appendChild(st);
  stageTimer = setTimeout(() => { st.classList.add('out'); setTimeout(() => st.remove(), 380); }, ms);
}
export function stageHtml(html, ms = 1900) {
  const old = document.querySelector('.stage'); old && old.remove();
  clearTimeout(stageTimer);
  const st = document.createElement('div'); st.className = 'stage';
  st.innerHTML = html;
  document.body.appendChild(st);
  stageTimer = setTimeout(() => { st.classList.add('out'); setTimeout(() => st.remove(), 380); }, ms);
}
export function banner(text) {
  const b = document.createElement('div'); b.className = 'banner'; b.textContent = text;
  document.body.appendChild(b); setTimeout(() => b.remove(), 1700);
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* no clipboard */ }
    ta.remove(); return ok;
  }
}
