// Path B: loosely formatted tables (any Excel sheet, CSV, or pasted text).
// Finds the header row (which may not be row 1), returns the table, and,
// once columns are mapped (Map step), merges rows into suppliers.

import { SECTIONS, SECTION_BY_KEY } from '../model/schema.js';
import { cleanText, nameKey, normalizeForColumn, isBlank } from '../model/normalize.js';
import { newSupplier, mergeField, noteConflicts, linkBanking, assignTempIds } from '../model/supplier.js';
import { colLetter } from '../eib/template.js';

const looksNumeric = (v) => /^[\s$€£(-]*[\d.,]+%?\)?\s*$/.test(v);
const looksDate = (v) => /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(v);

/**
 * Picks the header row in the first 25 rows. A good header row has many
 * non-empty text cells, mostly non-numeric, unique, and is followed by rows
 * of similar width. Title rows (one wide cell) and blank rows are skipped.
 */
export function detectHeaderRow(rows) {
  let best = -1;
  let bestScore = -Infinity;
  const limit = Math.min(rows.length, 25);
  for (let r = 0; r < limit; r++) {
    const cells = (rows[r] ?? []).map(cleanText);
    const filled = cells.filter(Boolean);
    if (filled.length < 2) continue;
    const textual = filled.filter((v) => !looksNumeric(v) && !looksDate(v) && v.length <= 60);
    const unique = new Set(filled.map((v) => v.toLowerCase())).size;
    let below = 0;
    for (let k = r + 1; k < Math.min(rows.length, r + 6); k++) {
      const n = (rows[k] ?? []).filter((v) => cleanText(v)).length;
      if (n >= Math.max(2, filled.length * 0.3)) below++;
    }
    const score = textual.length * 2 + unique - (filled.length - textual.length) * 3 + below * 2 - r * 0.1;
    if (textual.length >= filled.length * 0.7 && score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Extracts a table from a sheet: headers plus data rows. Blank rows are
 * dropped. Empty and duplicate headers get a usable name.
 * @returns {{ sheet, headerRow, headers: string[], rows: Array<{ row: number, cells: string[] }>, skipped: [] }}
 */
export function extractTable(sheet) {
  const h = detectHeaderRow(sheet.rows);
  if (h < 0) return null;
  const raw = sheet.rows[h].map(cleanText);
  let width = raw.length;
  for (let r = h + 1; r < sheet.rows.length; r++) width = Math.max(width, (sheet.rows[r] ?? []).length);
  const seen = new Map();
  const headers = Array.from({ length: width }, (_, c) => {
    const base = raw[c] || `Column ${colLetter(c + 1)}`;
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    return n > 1 ? `${base} (${n})` : base;
  });
  const rows = [];
  for (let r = h + 1; r < sheet.rows.length; r++) {
    const cells = headers.map((_, c) => cleanText(sheet.rows[r]?.[c]));
    if (cells.every((v) => v === '')) continue;
    rows.push({ row: r + 1, cells });
  }
  return { sheet: sheet.name, headerRow: h + 1, headers, rows };
}

/**
 * Builds suppliers from a mapped table.
 *
 * mapping: array of { column: index, target: { section, field } } entries.
 * Several columns may feed the same target: for multi-value targets the
 * values are combined; for single-value targets they are joined with a space
 * (e.g. two address line columns mapped to one line) unless `join: false`.
 *
 * Rows with the same Supplier Name merge into one supplier. Each row can add
 * one record to every "many" section it has data for (an address, a phone,
 * a bank account, ...). Single-value conflicts are flagged for review.
 */
export function buildSuppliersFromTable(table, mapping, { fileName = table.file ?? 'file', summary, defaults = [] } = {}) {
  const nameMap = mapping.find((m) => m.target.section === 'supplier' && m.target.field === 'supplierName');
  if (!nameMap) throw new Error('Map a column to Supplier Name first.');

  const bySection = new Map();
  for (const m of mapping) {
    if (!m.target) continue;
    const list = bySection.get(m.target.section) ?? [];
    list.push(m);
    bySection.set(m.target.section, list);
  }

  const suppliers = new Map();
  const order = [];
  const pendingBank = new Map();

  for (const { row, cells } of table.rows) {
    if (summary) summary.rowsRead++;
    const name = cells[nameMap.column];
    if (!name) {
      summary?.skipped.push({ file: fileName, sheet: table.sheet, row, reason: 'Supplier Name is blank' });
      continue;
    }
    const k = nameKey(name);
    let s = suppliers.get(k);
    if (!s) {
      s = newSupplier(name);
      suppliers.set(k, s);
      order.push(s);
    }
    s.rowCounts.supplier++;
    const src = (c) => ({ file: fileName, sheet: table.sheet, cell: `${colLetter(c + 1)}${row}`, column: table.headers[c] });

    for (const secKey of new Set([...bySection.keys(), ...defaults.map((d) => d.target.split('.')[0])])) {
      const maps = bySection.get(secKey) ?? [];
      const section = SECTION_BY_KEY[secKey];
      const values = collectValues(section, maps, cells, src);
      // Defaults fill blanks, but only on records this row actually has data for.
      if (values.size || !section.many) {
        for (const d of defaults) {
          const [ds, df] = d.target.split('.');
          if (ds !== secKey || values.has(df)) continue;
          const col = section.columns.find((c) => c.key === df);
          if (col) values.set(df, { value: normalizeForColumn(col, d.value), source: { file: fileName, sheet: table.sheet, default: true, column: 'Set for all rows' }, col });
        }
      }
      if (secKey === 'phones') splitUsPhone(values);
      if (!section.many) {
        for (const [field, { value, source, col }] of values) mergeField(s[secKey].fields, field, value, source, col);
        continue;
      }
      const fields = {};
      for (const [field, { value, source }] of values) if (field !== 'supplierName') fields[field] = { value, source };
      if (!Object.keys(fields).length) continue;
      const rec = { fields, source: { file: fileName, sheet: table.sheet, row } };
      if (section.nestedUnder) {
        const p = pendingBank.get(k) ?? { intermediaryBanks: [], bankAddresses: [] };
        p[secKey].push(rec);
        pendingBank.set(k, p);
      } else if (!isDuplicateRecord(s[secKey], rec)) {
        s[secKey].push(rec);
      }
    }
    if (!s.supplier.fields.supplierName) s.supplier.fields.supplierName = { value: name, source: src(nameMap.column) };
  }

  for (const s of order) {
    defaultAccountLabels(s);
    const p = pendingBank.get(s.nameKey) ?? { intermediaryBanks: [], bankAddresses: [] };
    linkBanking(s, p.intermediaryBanks, p.bankAddresses);
    noteConflicts(s);
  }
  return order;
}

function collectValues(section, maps, cells, src) {
  const out = new Map();
  for (const m of maps) {
    const col = section.columns.find((c) => c.key === m.target.field);
    if (!col) continue;
    const raw = cells[m.column];
    if (!raw) continue;
    const value = normalizeForColumn(col, raw);
    if (isBlank(value)) continue;
    const cur = out.get(col.key);
    if (!cur) out.set(col.key, { value, source: src(m.column), col });
    else if (col.multi) cur.value = [...new Set([...cur.value, ...value])];
    else if (m.join !== false) cur.value = `${cur.value} ${value}`.trim();
  }
  return out;
}

/** "(214) 555-0142" with no Area Code column becomes area code 214 + number 5550142. */
function splitUsPhone(values) {
  const num = values.get('phoneNumber');
  if (!num || values.has('areaCode')) return;
  let d = num.value.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10 || /[a-z]/i.test(num.value.replace(/ext\.?\s*\d+$/i, ''))) return;
  values.set('areaCode', { value: d.slice(0, 3), source: num.source });
  values.set('phoneNumber', { value: d.slice(3), source: num.source });
}

/** Merged rows often repeat the same address or phone. Skip exact repeats. */
function isDuplicateRecord(list, rec) {
  const sig = JSON.stringify(Object.entries(rec.fields).map(([k, f]) => [k, f.value]).sort());
  return list.some((r) => JSON.stringify(Object.entries(r.fields).map(([k, f]) => [k, f.value]).sort()) === sig);
}

/** Loose tables rarely carry Account Labels; generate ACCT1, ACCT2, ... per supplier. */
function defaultAccountLabels(s) {
  s.settlementAccounts.forEach((a, i) => {
    if (!a.fields.accountLabel) a.fields.accountLabel = { value: `ACCT${i + 1}`, source: { generated: true } };
  });
}

export { assignTempIds, SECTIONS };
