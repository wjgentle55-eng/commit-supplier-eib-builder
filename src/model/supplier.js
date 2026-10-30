// Supplier records and the merge rules shared by both ingest paths.
//
// A supplier looks like:
// {
//   tempId: 'TMP-0001',            tool-only ID, never written to the EIB
//   nameKey: 'acme inc',           join key
//   supplier: { fields },          Suppliers tab (one record)
//   payment:  { fields },          Payment & Procurement tab (one record)
//   addresses: [{ fields, source }], phones, emails, webAddresses, taxIds,
//   taxStatuses, alternateNames, classifications, relatedWorktags,
//   settlementAccounts: [{ fields, source, intermediaries: [{ fields, source, bankAddresses }], bankAddresses }],
//   unlinked: { intermediaryBanks: [], bankAddresses: [] },
//   notes: [{ severity, code, message, section, field }],   ingest findings
// }
// and every field is { value, source, conflicts? } where value is a string,
// or a string[] for multi-value fields.

import { SECTIONS } from './schema.js';
import { isBlank, nameKey } from './normalize.js';

export const MANY_SECTIONS = SECTIONS.filter((s) => s.many && !s.nestedUnder).map((s) => s.key);

export function newSupplier(name) {
  const s = {
    tempId: '',
    nameKey: nameKey(name),
    supplier: { fields: {} },
    payment: { fields: {} },
    unlinked: { intermediaryBanks: [], bankAddresses: [] },
    notes: [],
    rowCounts: { supplier: 0, payment: 0 },
  };
  for (const k of MANY_SECTIONS) s[k] = [];
  return s;
}

export function assignTempIds(suppliers) {
  suppliers.forEach((s, i) => {
    s.tempId = `TMP-${String(i + 1).padStart(4, '0')}`;
  });
  return suppliers;
}

export const displayName = (s) => s.supplier.fields.supplierName?.value || '(no name)';

const sameValue = (a, b) =>
  Array.isArray(a) || Array.isArray(b)
    ? JSON.stringify([].concat(a).map((x) => String(x).toLowerCase())) === JSON.stringify([].concat(b).map((x) => String(x).toLowerCase()))
    : String(a).toLowerCase() === String(b).toLowerCase();

/**
 * Merges one incoming field into a single-record section.
 * Multi-value fields take the union. Single-value fields keep the first value
 * and record any different later value as a conflict (flagged for review).
 */
export function mergeField(fields, key, value, source, col) {
  if (isBlank(value)) return;
  const cur = fields[key];
  if (!cur || isBlank(cur.value)) {
    fields[key] = { value, source };
    return;
  }
  if (col?.multi) {
    const have = new Set(cur.value.map((v) => v.toLowerCase()));
    const added = value.filter((v) => !have.has(v.toLowerCase()));
    if (added.length) {
      cur.value = [...cur.value, ...added];
      cur.extraSources = [...(cur.extraSources ?? []), source];
    }
    return;
  }
  if (sameValue(cur.value, value)) return;
  cur.conflicts = cur.conflicts ?? [];
  if (!cur.conflicts.some((c) => sameValue(c.value, value))) cur.conflicts.push({ value, source });
}

export function addNote(supplier, note) {
  const key = `${note.code}|${note.section ?? ''}|${note.field ?? ''}|${note.message}`;
  if (!supplier.notes.some((n) => `${n.code}|${n.section ?? ''}|${n.field ?? ''}|${n.message}` === key)) supplier.notes.push(note);
}

/** Adds conflict notes for every single-value field that received different values. */
export function noteConflicts(supplier) {
  for (const sec of ['supplier', 'payment']) {
    const section = SECTIONS.find((s) => s.key === sec);
    for (const [key, f] of Object.entries(supplier[sec].fields)) {
      if (!f.conflicts?.length) continue;
      const col = section.columns.find((c) => c.key === key);
      addNote(supplier, {
        severity: 'warning',
        code: 'conflicting-values',
        section: sec,
        field: key,
        message: `${col?.label ?? key} had different values in the source (${[f.value, ...f.conflicts.map((c) => c.value)]
          .map((v) => `"${v}"`)
          .join(', ')}). Kept the first one.`,
      });
    }
  }
}

const labelKey = (v) => String(v ?? '').trim().toLowerCase();

/**
 * Nests intermediary banks and bank addresses under their settlement account
 * by Account Label (and Intermediary Label for intermediary bank addresses).
 * Anything that points at an unknown label stays in `unlinked` with an error note.
 */
export function linkBanking(supplier, intermediaries, bankAddresses) {
  const accounts = new Map();
  for (const acct of supplier.settlementAccounts) {
    acct.intermediaries = acct.intermediaries ?? [];
    acct.bankAddresses = acct.bankAddresses ?? [];
    const k = labelKey(acct.fields.accountLabel?.value);
    if (!k) continue;
    if (accounts.has(k)) {
      addNote(supplier, {
        severity: 'error',
        code: 'duplicate-account-label',
        section: 'settlementAccounts',
        field: 'accountLabel',
        message: `Account Label "${acct.fields.accountLabel.value}" is used on more than one settlement account.`,
      });
    } else accounts.set(k, acct);
  }

  for (const im of intermediaries) {
    const acct = accounts.get(labelKey(im.fields.accountLabel?.value));
    if (!acct) {
      supplier.unlinked.intermediaryBanks.push(im);
      addNote(supplier, {
        severity: 'error',
        code: 'unknown-account-label',
        section: 'intermediaryBanks',
        field: 'accountLabel',
        message: `Intermediary bank "${im.fields.intermediaryLabel?.value ?? ''}" points to Account Label "${im.fields.accountLabel?.value ?? ''}", which isn't on the Settlement Accounts tab.`,
      });
      continue;
    }
    im.bankAddresses = [];
    acct.intermediaries.push(im);
  }
  for (const acct of accounts.values()) {
    acct.intermediaries.sort((a, b) => Number(a.fields.order?.value ?? 0) - Number(b.fields.order?.value ?? 0));
  }

  for (const ba of bankAddresses) {
    const acct = accounts.get(labelKey(ba.fields.accountLabel?.value));
    const imLabel = labelKey(ba.fields.intermediaryLabel?.value);
    const target = acct && imLabel ? acct.intermediaries.find((i) => labelKey(i.fields.intermediaryLabel?.value) === imLabel) : acct;
    if (!target) {
      supplier.unlinked.bankAddresses.push(ba);
      addNote(supplier, {
        severity: 'error',
        code: 'unknown-account-label',
        section: 'bankAddresses',
        field: imLabel ? 'intermediaryLabel' : 'accountLabel',
        message: imLabel
          ? `A bank address points to Intermediary Label "${ba.fields.intermediaryLabel.value}" on Account Label "${ba.fields.accountLabel?.value ?? ''}", which doesn't exist.`
          : `A bank address points to Account Label "${ba.fields.accountLabel?.value ?? ''}", which isn't on the Settlement Accounts tab.`,
      });
      continue;
    }
    target.bankAddresses.push(ba);
  }
}

/** Short counts for tables and the ingest summary. */
export function childCounts(s) {
  return Object.fromEntries(MANY_SECTIONS.map((k) => [k, s[k].length]));
}
