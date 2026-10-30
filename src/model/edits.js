// User edits are an overlay on the derived suppliers, keyed by temp ID, so
// they survive every re-derive (new mapping, new rule, new resolution).
//
// edits[tempId] = {
//   fields:  { 'supplier.category': 'Consulting', 'addresses.0.city': 'Austin',
//              'settlementAccounts.0.intermediaries.1.bankName': 'Citi' },
//   removed: ['emails.1'],                 records removed from the base lists
//   added:   { emails: [{ fields: {...} }] }  new records (edited in place)
// }

import { MANY_SECTIONS } from './supplier.js';
import { isBlank } from './normalize.js';

export function applyEdits(suppliers, edits) {
  for (const s of suppliers) {
    const e = edits?.[s.tempId];
    if (e) {
      for (const [sec, recs] of Object.entries(e.added ?? {})) {
        if (!MANY_SECTIONS.includes(sec)) continue;
        for (const r of recs) s[sec].push({ ...structuredClone(r), source: { edited: true }, added: true });
      }
    }
    // Stable record index (_i) for edit paths, assigned before any removal.
    for (const sec of MANY_SECTIONS) s[sec].forEach((r, i) => (r._i = i));
    if (!e) continue;
    for (const [path, value] of Object.entries(e.fields ?? {})) setPath(s, path, value);
    const removed = new Set(e.removed ?? []);
    if (removed.size) {
      for (const sec of MANY_SECTIONS) {
        s[sec] = s[sec].filter((r) => !removed.has(`${sec}.${r._i}`));
      }
    }
  }
}

function setPath(s, path, value) {
  const parts = path.split('.');
  const field = parts.pop();
  let rec;
  if (parts.length === 1) rec = s[parts[0]];
  else {
    rec = s;
    for (let i = 0; i < parts.length; i++) {
      rec = rec?.[/^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i]];
    }
  }
  if (!rec?.fields) return;
  const prev = rec.fields[field];
  if (isBlank(value)) {
    if (prev) rec.fields[field] = { value: Array.isArray(prev.value) ? [] : '', source: { edited: true }, original: prev.value };
    return;
  }
  rec.fields[field] = { value, source: { edited: true }, original: prev?.original ?? prev?.value };
}
