// Path A: the structured Supplier Conversion Workbook.
// Every in-scope tab is read by header (never by column position) and joined
// on Supplier Name. No mapping step needed.

import { SECTIONS, SUPPORT_TABS, REFERENCE_TABS, OUT_OF_SCOPE_PATTERNS } from '../model/schema.js';
import { headerKey, nameKey, normalizeForColumn, isBlank, cleanText } from '../model/normalize.js';
import { newSupplier, mergeField, addNote, noteConflicts, linkBanking } from '../model/supplier.js';
import { colLetter } from '../eib/template.js';

const tabKey = headerKey;

function findSheet(wb, tab) {
  return wb.sheets.find((s) => tabKey(s.name) === tabKey(tab));
}

/** True when a parsed workbook looks like a Supplier Conversion Workbook. */
export function isConversionWorkbook(wb) {
  const suppliers = findSheet(wb, 'Suppliers');
  if (!suppliers || !findSheet(wb, 'Payment & Procurement')) return false;
  const h = findHeaderRow(suppliers.rows, SECTIONS[0].columns);
  return h >= 0;
}

/**
 * Finds the header row: the row (in the first 15) that matches the most known
 * headers, with at least "Supplier Name" (or 2 known headers for support tabs).
 */
function findHeaderRow(rows, columns) {
  const known = new Set(columns.map((c) => headerKey(c.label)));
  let best = -1;
  let bestScore = 1;
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const score = (rows[r] ?? []).filter((c) => known.has(headerKey(c))).length;
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

/** Maps sheet columns to schema columns by header. Returns { map: [{ c, col }], unknown: [header] }. */
function mapHeaders(headerRow, columns) {
  const byKey = new Map(columns.map((c) => [headerKey(c.label), c]));
  const map = [];
  const unknown = [];
  const used = new Set();
  headerRow.forEach((h, c) => {
    const k = headerKey(h);
    if (!k) return;
    const col = byKey.get(k);
    if (col && !used.has(col.key)) {
      map.push({ c, col, header: cleanText(h) });
      used.add(col.key);
    } else unknown.push({ c, header: cleanText(h) });
  });
  return { map, unknown };
}

export function readConversionWorkbook(wb, fileName = wb.name) {
  const summary = newSummary();
  summary.files.push({ name: fileName, kind: 'Supplier Conversion Workbook' });

  const suppliers = new Map(); // nameKey -> supplier
  const order = [];
  const pending = new Map(); // nameKey -> { intermediaryBanks: [], bankAddresses: [] }
  const getSupplier = (name, sectionKey, src) => {
    const k = nameKey(name);
    let s = suppliers.get(k);
    if (!s) {
      s = newSupplier(name);
      s.supplier.fields.supplierName = { value: cleanText(name), source: src };
      suppliers.set(k, s);
      order.push(s);
      if (sectionKey !== 'supplier') {
        s.missingFromSuppliersTab = true;
      }
    }
    return s;
  };

  const known = new Set([
    ...SECTIONS.map((s) => tabKey(s.tab)),
    ...Object.values(SUPPORT_TABS).map((s) => tabKey(s.tab)),
    ...REFERENCE_TABS.map(tabKey),
  ]);
  for (const sheet of wb.sheets) {
    if (known.has(tabKey(sheet.name))) continue;
    const oos = OUT_OF_SCOPE_PATTERNS.find((p) => p.pattern.test(sheet.name));
    if (oos) summary.outOfScope.push({ file: fileName, where: `Tab "${sheet.name}"`, label: oos.label });
    else summary.ignored.push({ file: fileName, where: `Tab "${sheet.name}"`, reason: 'Not a tab this tool reads' });
  }

  for (const section of SECTIONS) {
    const sheet = findSheet(wb, section.tab);
    if (!sheet) {
      if (section.key === 'supplier' || section.key === 'payment') {
        summary.problems.push(`The "${section.tab}" tab is missing.`);
      }
      continue;
    }
    const h = findHeaderRow(sheet.rows, section.columns);
    if (h < 0) {
      summary.problems.push(`Couldn't find the header row on the "${section.tab}" tab.`);
      continue;
    }
    const { map, unknown } = mapHeaders(sheet.rows[h], section.columns);
    for (const u of unknown) {
      const oos = OUT_OF_SCOPE_PATTERNS.find((p) => p.pattern.test(u.header));
      if (oos) summary.outOfScope.push({ file: fileName, where: `${sheet.name} > ${u.header}`, label: oos.label });
      else summary.ignored.push({ file: fileName, where: `${sheet.name} > ${u.header}`, reason: 'Column not recognized' });
    }
    const nameCol = map.find((m) => m.col.key === 'supplierName');
    if (!nameCol) {
      summary.problems.push(`The "${section.tab}" tab has no Supplier Name column.`);
      continue;
    }

    for (let r = h + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r] ?? [];
      if (row.every((v) => cleanText(v) === '')) continue;
      summary.rowsRead++;
      const rowNum = r + 1;
      const name = cleanText(row[nameCol.c]);
      if (!name) {
        summary.skipped.push({ file: fileName, sheet: sheet.name, row: rowNum, reason: 'Supplier Name is blank' });
        continue;
      }
      const src = (c, header) => ({ file: fileName, sheet: sheet.name, cell: `${colLetter(c + 1)}${rowNum}`, column: header });
      const s = getSupplier(name, section.key, src(nameCol.c, nameCol.header));

      if (!section.many) {
        s.rowCounts[section.key]++;
        for (const { c, col, header } of map) {
          if (col.key === 'supplierName') continue;
          mergeField(s[section.key].fields, col.key, normalizeForColumn(col, row[c]), src(c, header), col);
        }
        continue;
      }

      const fields = {};
      for (const { c, col, header } of map) {
        if (col.key === 'supplierName' || col.key === 'supplierId') continue;
        const value = normalizeForColumn(col, row[c]);
        if (!isBlank(value)) fields[col.key] = { value, source: src(c, header) };
      }
      const record = { fields, source: { file: fileName, sheet: sheet.name, row: rowNum } };
      if (section.nestedUnder) {
        const p = pending.get(s.nameKey) ?? { intermediaryBanks: [], bankAddresses: [] };
        p[section.key].push(record);
        pending.set(s.nameKey, p);
      } else {
        s[section.key].push(record);
      }
    }
  }

  for (const s of order) {
    const p = pending.get(s.nameKey) ?? { intermediaryBanks: [], bankAddresses: [] };
    linkBanking(s, p.intermediaryBanks, p.bankAddresses);
    noteConflicts(s);
    if (s.rowCounts.supplier > 1) {
      addNote(s, {
        severity: 'error',
        code: 'duplicate-supplier-row',
        section: 'supplier',
        field: 'supplierName',
        message: `"${s.supplier.fields.supplierName.value}" appears ${s.rowCounts.supplier} times on the Suppliers tab. Each supplier should have one row.`,
      });
    }
    if (s.rowCounts.payment > 1) {
      addNote(s, {
        severity: 'warning',
        code: 'duplicate-payment-row',
        section: 'payment',
        field: 'supplierName',
        message: `"${s.supplier.fields.supplierName.value}" appears ${s.rowCounts.payment} times on the Payment & Procurement tab. The rows were merged.`,
      });
    }
    if (s.missingFromSuppliersTab) {
      addNote(s, {
        severity: 'error',
        code: 'not-on-suppliers-tab',
        section: 'supplier',
        field: 'supplierName',
        message: `"${s.supplier.fields.supplierName.value}" has rows on other tabs but no row on the Suppliers tab. Check the spelling, or add a Suppliers row.`,
      });
    }
  }

  const valueMappings = readSupportTab(wb, SUPPORT_TABS.valueMapping, fileName, summary).filter((r) => r.legacyValue);
  const existingSuppliers = readSupportTab(wb, SUPPORT_TABS.existingSuppliers, fileName, summary).filter(
    (r) => r.supplierName || r.supplierId || r.taxId,
  );
  summary.valueMappings = valueMappings.length;
  summary.existingSuppliers = existingSuppliers.length;
  summary.suppliersFound = order.length;
  summary.notOnSuppliersTab = order.filter((s) => s.missingFromSuppliersTab).length;

  return { suppliers: order, valueMappings, existingSuppliers, summary };
}

function readSupportTab(wb, def, fileName, summary) {
  const sheet = findSheet(wb, def.tab);
  if (!sheet) return [];
  const h = findHeaderRow(sheet.rows, def.columns);
  if (h < 0) return [];
  const { map } = mapHeaders(sheet.rows[h], def.columns);
  const out = [];
  for (let r = h + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    if (row.every((v) => cleanText(v) === '')) continue;
    const rec = { source: { file: fileName, sheet: sheet.name, row: r + 1 } };
    for (const { c, col } of map) rec[col.key] = normalizeForColumn(col, row[c]);
    out.push(rec);
  }
  return out;
}

export function newSummary() {
  return {
    files: [],
    rowsRead: 0,
    suppliersFound: 0,
    skipped: [],
    ignored: [],
    outOfScope: [],
    problems: [],
    valueMappings: 0,
    existingSuppliers: 0,
    notOnSuppliersTab: 0,
  };
}
