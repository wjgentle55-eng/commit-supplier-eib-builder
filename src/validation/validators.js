// Pure format and checksum validators. Each returns true when the value is valid.

/** ABA routing number: 9 digits with the 3-7-1 weighted checksum. */
export function isAbaRouting(v) {
  const d = String(v ?? '').replace(/[\s-]/g, '');
  if (!/^\d{9}$/.test(d)) return false;
  const n = [...d].map(Number);
  const sum = 3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8]);
  return sum % 10 === 0 && d !== '000000000';
}

/** IBAN: country prefix, 2 check digits, and the ISO 13616 mod-97 check. */
export function isIban(v) {
  const s = String(v ?? '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const val = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of val) rem = (rem * 10 + Number(digit)) % 97;
  }
  return rem === 1;
}

/** SWIFT/BIC: 4 bank letters, 2 country letters, 2 location chars, optional 3 branch chars (8 or 11). */
export function isBic(v) {
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(String(v ?? '').replace(/\s+/g, '').toUpperCase());
}

/** US EIN format: ##-####### (or 9 digits). */
export function isEin(v) {
  return /^\d{2}-?\d{7}$/.test(String(v ?? '').trim());
}

/**
 * EIN prefix on the IRS's published list of campus prefixes. The list has
 * grown over time, so an unknown prefix is only a warning, never an error.
 */
export function isKnownEinPrefix(v) {
  const prefix = Number(String(v ?? '').trim().slice(0, 2));
  return ![0, 7, 8, 9, 17, 18, 19, 28, 29, 49, 69, 70, 78, 79, 89, 96, 97].includes(prefix);
}

/** US SSN or ITIN: ###-##-#### (or 9 digits); area not 000, 666; group not 00; serial not 0000. */
export function isSsnOrItin(v) {
  const s = String(v ?? '').trim();
  const m = /^(\d{3})-?(\d{2})-?(\d{4})$/.exec(s);
  if (!m) return false;
  const [, area, group, serial] = m;
  if (area === '000' || area === '666' || serial === '0000') return false;
  if (area.startsWith('9')) return /^(5\d|6[0-5]|7\d|8[0-8]|9[0-24-9])$/.test(group); // ITIN ranges
  return group !== '00';
}

export function isEmail(v) {
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/.test(String(v ?? '').trim());
}

export function isUrl(v) {
  const s = String(v ?? '').trim();
  if (/\s/.test(s)) return false;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    return /^https?:$/.test(u.protocol) && /\.[a-z]{2,}$/i.test(u.hostname);
  } catch {
    return false;
  }
}

export function isUsPostal(v) {
  return /^\d{5}(-\d{4})?$/.test(String(v ?? '').trim());
}

/** A real calendar date written as YYYY-MM-DD. */
export function isIsoDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function isNumber(v) {
  return /^-?\d+(\.\d+)?$/.test(String(v ?? '').trim());
}

/** Full-string match against a Workday-style format regex from Bank Rules. */
export function matchesFormat(v, pattern) {
  if (!pattern) return true;
  try {
    return new RegExp(`^(?:${pattern})$`).test(String(v ?? '').trim());
  } catch {
    return true;
  }
}
