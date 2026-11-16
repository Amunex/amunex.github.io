/* Split: live exchange rates.

   Rates come from the free, key-less currency-api project (github.com/fawazahmed0/exchange-api),
   updated daily, with a second source as backup. One table (everything against the euro) covers
   any pair. The rate used for an expense is stored with that expense, so balances never drift
   when rates move later. The last table fetched stays on the phone for when there's no signal. */
import { localDate } from './core.js?v=3';

const FRESH_MS = 6 * 3600 * 1000;
const TIMEOUT_MS = 7000;
/* Shown in the currency picker before any table has been fetched. */
const COMMON = 'EUR USD GBP ALL CHF CLP ARS AUD BGN BRL CAD CNY COP CZK DKK EGP GEL HUF IDR ILS INR ISK JPY KRW MAD MKD MXN NOK NZD PEN PLN RON RSD SEK THB TRY UAH VND ZAR'.split(' ');

async function getJSON(fetchFn, url) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
  try {
    const r = await fetchFn(url, ctl ? { signal: ctl.signal } : undefined);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}
/* { date, rates: { USD: 1.1, ALL: 90.6, ... } } with 1 EUR = rates[X], or null if the answer isn't usable. */
function normalise(json) {
  let src = null, date = '';
  if (json && json.eur && typeof json.eur === 'object') { src = json.eur; date = json.date || ''; }
  else if (json && json.rates && json.base_code === 'EUR') { src = json.rates; date = json.time_last_update_unix ? localDate(new Date(json.time_last_update_unix * 1000)) : ''; }
  if (!src) return null;
  const rates = { EUR: 1 };
  for (const [k, v] of Object.entries(src)) if (/^[A-Za-z]{3}$/.test(k) && Number.isFinite(v) && v > 0) rates[k.toUpperCase()] = v;
  return Object.keys(rates).length > 20 && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { date, rates } : null;
}

export function makeRates({ prefs, fetchFn = (...a) => globalThis.fetch(...a), now = () => Date.now() }) {
  const inflight = new Map();
  const sources = date => {
    const today = localDate(new Date(now()));
    if (date && date < today) return [
      `https://${date}.currency-api.pages.dev/v1/currencies/eur.min.json`,
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/eur.min.json`,
    ];
    return [
      'https://latest.currency-api.pages.dev/v1/currencies/eur.min.json',
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.min.json?d=${today}`,
      'https://open.er-api.com/v6/latest/EUR',
    ];
  };
  async function download(date) {
    for (const url of sources(date)) {
      try { const t = normalise(await getJSON(fetchFn, url)); if (t) return t; } catch (_) { /* try the next source */ }
    }
    return null;
  }
  /* The table for a day (today when no date is given). Falls back to the newest table the phone has. */
  async function table(date) {
    const today = localDate(new Date(now()));
    const past = date && date < today ? date : '';
    const key = past ? 'fx.' + past : 'fx';
    const saved = prefs.get(key);
    if (saved && (past || now() - saved.at < FRESH_MS)) return { ...saved, live: true };
    if (!inflight.has(key)) {
      inflight.set(key, download(past).then(t => {
        inflight.delete(key);
        if (!t) return null;
        const rec = { date: t.date, rates: t.rates, at: now() };
        if (past) { prefs.set(key, rec); const old = prefs.get('fx.days', []).filter(d => d !== past); old.push(past); for (const d of old.splice(0, Math.max(0, old.length - 6))) prefs.del('fx.' + d); prefs.set('fx.days', old); }
        else prefs.set('fx', rec);
        return rec;
      }));
    }
    const got = await inflight.get(key);
    if (got) return { ...got, live: true };
    if (past) return table();                                // that day isn't published: use the newest instead
    return saved ? { ...saved, live: false } : null;         // offline: the last table we had
  }
  /* How many `to` you get for 1 `from`. { rate, date, src: 'live' | 'saved' } or null when unknown. */
  async function rate(from, to, date) {
    if (from === to) return { rate: 1, date: '', src: 'same' };
    const t = await table(date);
    if (!t || !t.rates[from] || !t.rates[to]) return null;
    return { rate: Number((t.rates[to] / t.rates[from]).toPrecision(8)), date: t.date, src: t.live ? 'live' : 'saved' };
  }
  function currencies() {
    const saved = prefs.get('fx');
    let known = saved ? Object.keys(saved.rates) : COMMON;
    try { const iso = new Set(Intl.supportedValuesOf('currency')); known = known.filter(c => iso.has(c)); } catch (_) { if (saved) known = COMMON.filter(c => saved.rates[c]); }
    return known.sort();
  }
  return { table, rate, currencies, common: COMMON };
}

export function currencyName(code, locale) {
  try { return new Intl.DisplayNames(locale ? [locale] : undefined, { type: 'currency' }).of(code) || code; } catch (_) { return code; }
}
/* A sensible first guess at someone's currency from their phone's region. */
export function guessCurrency(locale) {
  const region = (String(locale || '').match(/[-_]([A-Z]{2})\b/) || [])[1] || '';
  const map = { AL: 'ALL', CL: 'CLP', US: 'USD', GB: 'GBP', CH: 'CHF', UA: 'UAH', ID: 'IDR', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN', SE: 'SEK', NO: 'NOK', DK: 'DKK',
    TR: 'TRY', JP: 'JPY', CN: 'CNY', IN: 'INR', BR: 'BRL', MX: 'MXN', AR: 'ARS', CO: 'COP', PE: 'PEN', CA: 'CAD', AU: 'AUD', NZ: 'NZD', RS: 'RSD', MK: 'MKD', GE: 'GEL', IL: 'ILS', ZA: 'ZAR', KR: 'KRW', TH: 'THB', VN: 'VND', EG: 'EGP', MA: 'MAD', IS: 'ISK' };
  return map[region] || 'EUR';
}
