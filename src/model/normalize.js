// Deterministic value normalization shared by every ingest path.

/** Header match key: case-insensitive, trimmed, inner spaces collapsed, trailing "+" or "?" ignored. */
export function headerKey(h) {
  return String(h ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*[+?*]+$/, '')
    .trim()
    .toLowerCase();
}

/** Supplier Name join key: trimmed, inner spaces collapsed, case-insensitive. */
export function nameKey(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function cleanText(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\u00A0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

// Company and legal-form suffixes that follow a comma inside one value,
// as in "601 RAVN Group, Inc". A comma before one of these never splits.
const SUFFIX = /^(inc|incorporated|llc|l\.l\.c|ltd|limited|lp|l\.p|llp|corp|corporation|co|company|n\.a|na|plc|gmbh|ag|bv|b\.v|sa|s\.a|sas|srl|pty|pvt|pc|p\.c|pllc|lllp|jr|sr|ii|iii)\.?$/i;

/**
 * Splits a multi-value cell. Semicolons and line breaks always separate
 * values. Commas separate values too, except when what follows the comma is a
 * company suffix ("Acme, Inc"), so legal names with commas stay whole.
 * Dedupes and keeps order.
 */
export function splitMulti(v) {
  const seen = new Set();
  const out = [];
  for (const chunk of String(v ?? '').split(/[;\r\n]+/)) {
    const parts = [];
    for (const piece of chunk.split(',')) {
      const t = cleanText(piece);
      if (parts.length && SUFFIX.test(t)) parts[parts.length - 1] += `, ${t}`;
      else parts.push(t);
    }
    for (const t of parts) {
      const k = t.toLowerCase();
      if (t && !seen.has(k)) {
        seen.add(k);
        out.push(t);
      }
    }
  }
  return out;
}

const TRUE = new Set(['y', 'yes', 'true', '1', 't', 'x']);
const FALSE = new Set(['n', 'no', 'false', '0', 'f']);

/** Returns 'Yes', 'No', or the original text when it isn't recognizable (validation flags it). */
export function normBool(v) {
  const t = cleanText(v);
  if (!t) return '';
  const k = t.toLowerCase();
  if (TRUE.has(k)) return 'Yes';
  if (FALSE.has(k)) return 'No';
  return t;
}

const pad = (n) => String(n).padStart(2, '0');

export function dateToIso(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Normalizes a date to YYYY-MM-DD when it is unambiguous. Accepts ISO, US
 * M/D/YYYY, and Excel serial numbers. Anything else is returned as typed so
 * validation can flag it.
 */
export function normDate(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return dateToIso(v);
  const t = cleanText(v);
  if (!t) return '';
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(t);
  if (m) return validYmd(+m[1], +m[2], +m[3]) ?? t;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(t);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return validYmd(y, +m[1], +m[2]) ?? t;
  }
  if (/^\d{5}(\.\d+)?$/.test(t)) return excelSerialToIso(Number(t)) ?? t;
  return t;
}

function validYmd(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

export function excelSerialToIso(serial) {
  if (!(serial > 59 && serial < 2958466)) return null; // 1900-03-01 .. 9999-12-31
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return dateToIso(new Date(ms));
}

/** Plain decimal text for numbers (no exponent, no float noise). */
export function numberToText(n) {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return BigInt(Math.round(n)).toString();
  return String(Number(n.toPrecision(15)));
}

/** Normalizes one raw value for a schema column. Returns a string, or a string[] for multi columns. */
export function normalizeForColumn(col, raw) {
  if (col.multi) {
    const parts = Array.isArray(raw) ? raw.flatMap(splitMulti) : splitMulti(raw);
    return col.type === 'bool' ? parts.map(normBool) : parts;
  }
  switch (col.type) {
    case 'bool':
      return normBool(raw);
    case 'date':
      return normDate(raw);
    case 'number': {
      const t = cleanText(raw);
      return t.replace(/^\$/, '').replace(/,(?=\d{3}\b)/g, '');
    }
    default:
      return cleanText(raw);
  }
}

export const isBlank = (v) => (Array.isArray(v) ? v.length === 0 : cleanText(v) === '');
