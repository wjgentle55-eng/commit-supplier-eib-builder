// Deterministic column auto-mapping: header synonyms, fuzzy header matching,
// and value sniffing. Suggestions only; the user confirms on the Map screen.

import { TARGETS, TARGET_BY_ID, IMPLIED_DEFAULTS } from './targets.js';
import { headerKey } from '../model/normalize.js';

const norm = (s) => headerKey(s).replace(/[_#.:()\-/]+/g, ' ').replace(/\s+/g, ' ').trim();

function bigrams(s) {
  const t = ` ${s} `;
  const out = new Map();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Sorensen-Dice similarity on character bigrams, 0..1. */
export function similarity(a, b) {
  a = norm(a);
  b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  const total = [...A.values()].reduce((x, y) => x + y, 0) + [...B.values()].reduce((x, y) => x + y, 0);
  return (2 * inter) / total;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL = /^(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;
const PHONE = /^\+?[\d\s().-]{7,20}$/;
const NINE = /^\d{9}$/;
const EIN = /^\d{2}-\d{7}$/;
const SSN = /^\d{3}-\d{2}-\d{4}$/;
const BOOL = /^(y|n|yes|no|true|false|0|1)$/i;

function sniff(header, samples) {
  const vals = samples.filter(Boolean);
  if (vals.length === 0) return null;
  const share = (re) => vals.filter((v) => re.test(v)).length / vals.length;
  const h = norm(header);
  if (share(EMAIL) >= 0.6) return { id: h.includes('po') ? 'payment.poIssueEmails' : 'emails.emailAddress', why: 'Values look like email addresses' };
  if (share(EIN) >= 0.6) return { id: 'taxIds.taxId', why: 'Values look like EINs', implied: 'ein' };
  if (share(SSN) >= 0.6) return { id: 'taxIds.taxId', why: 'Values look like SSNs', implied: 'ssn' };
  if (share(NINE) >= 0.6) {
    if (/bank|aba|rout|transit/.test(h)) return { id: 'settlementAccounts.routingNumber', why: '9-digit values in a bank column look like routing numbers' };
    if (/tax|ein|tin|fed/.test(h)) return { id: 'taxIds.taxId', why: '9-digit values in a tax column look like EINs', implied: 'ein' };
    return null;
  }
  if (share(URL) >= 0.6 && !vals.some((v) => EMAIL.test(v))) return { id: 'webAddresses.webAddress', why: 'Values look like web addresses' };
  if (share(PHONE) >= 0.8 && vals.some((v) => v.replace(/\D/g, '').length >= 10) && /phone|tel|fax|mobile|cell/.test(h)) {
    return { id: 'phones.phoneNumber', why: 'Values look like phone numbers' };
  }
  if (share(BOOL) >= 0.8 && /primary|main|default/.test(h) && /addr/.test(h)) return { id: 'addresses.primary', why: 'Yes/No values on a primary address column' };
  return null;
}

/**
 * Suggests a target for every column of a table.
 * @returns {{ columns: Array<{ column, header, samples, target: string|null, confidence, why }>, defaults: Array }}
 */
export function guessMapping(table) {
  const sampleOf = (c) => {
    const out = [];
    for (const r of table.rows) {
      const v = r.cells[c];
      if (v && !out.includes(v)) out.push(v);
      if (out.length >= 5) break;
    }
    return out;
  };

  const cols = table.headers.map((header, column) => {
    const samples = sampleOf(column);
    const h = norm(header);
    let best = null;
    TARGETS.forEach((t, order) => {
      let score = 0;
      for (const syn of t.synonyms) {
        const s = norm(syn) === h ? 1 : similarity(syn, header) * 0.9;
        if (s > score) score = s;
      }
      if (!best || score > best.score + 1e-9) best = { id: t.id, score, order, why: score === 1 ? `Header matches "${t.label}"` : `Header is similar to "${t.label}"` };
    });
    const sniffed = sniff(header, samples);
    let pick = best && best.score >= 0.72 ? best : null;
    if (sniffed && (!pick || pick.score < 1)) pick = { id: sniffed.id, score: 0.95, why: sniffed.why, implied: sniffed.implied };
    if (pick && !pick.implied) {
      const key = h.replace(/\s+/g, '');
      if (IMPLIED_DEFAULTS[key] && pick.id === 'taxIds.taxId') pick.implied = key;
    }
    return { column, header, samples, pick };
  });

  // A single-value target takes only its best column, except text fields that
  // can be combined. Multi-value targets accept several columns.
  const taken = new Map();
  for (const c of [...cols].sort((a, b) => (b.pick?.score ?? 0) - (a.pick?.score ?? 0))) {
    if (!c.pick) continue;
    const t = TARGET_BY_ID[c.pick.id];
    if (!t.multi && taken.has(t.id)) {
      c.pick = null;
      continue;
    }
    taken.set(t.id, c.column);
  }

  const defaults = [];
  for (const c of cols) {
    if (!c.pick?.implied) continue;
    for (const d of IMPLIED_DEFAULTS[c.pick.implied]) {
      const id = `${d.section}.${d.field}`;
      if (!taken.has(id) && !defaults.some((x) => x.target === id)) defaults.push({ target: id, value: d.value, why: `Implied by the "${c.header}" column` });
    }
  }

  return {
    columns: cols.map((c) => ({
      column: c.column,
      header: c.header,
      samples: c.samples,
      target: c.pick?.id ?? null,
      confidence: c.pick ? (c.pick.score >= 0.95 ? 'high' : 'medium') : 'none',
      why: c.pick?.why ?? 'No confident match',
    })),
    defaults,
  };
}

/** Converts a confirmed mapping into the shape buildSuppliersFromTable expects. */
export function toBuildMapping(mapping) {
  return mapping.columns
    .filter((c) => c.target)
    .map((c) => {
      const t = TARGET_BY_ID[c.target];
      return { column: c.column, target: { section: t.section, field: t.field } };
    });
}
