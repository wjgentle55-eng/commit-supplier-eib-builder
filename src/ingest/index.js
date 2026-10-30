// Ingest orchestrator: turns dropped files or pasted text into either a
// finished supplier batch (Conversion Workbook) or tables waiting for the Map
// step (loose tables).

import { readWorkbook, readText } from './sheets.js';
import { isConversionWorkbook, readConversionWorkbook, newSummary } from './workbook-reader.js';
import { extractTable } from './loose-reader.js';
import { assignTempIds } from '../model/supplier.js';
import { OUT_OF_SCOPE_PATTERNS } from '../model/schema.js';
import { nameKey } from '../model/normalize.js';

/**
 * @param {Array<{ name: string, bytes?: Uint8Array|ArrayBuffer, text?: string }>} inputs
 * @returns {{ suppliers, tables, valueMappings, existingSuppliers, summary }}
 */
export function ingest(inputs) {
  const summary = newSummary();
  const suppliers = [];
  const tables = [];
  const valueMappings = [];
  const existingSuppliers = [];

  for (const input of inputs) {
    let wb;
    try {
      wb = input.text !== undefined ? readText(input.text, input.name) : readWorkbook(input.bytes, input.name);
    } catch (err) {
      summary.problems.push(`Couldn't read ${input.name}: ${err.message}`);
      continue;
    }

    if (isConversionWorkbook(wb)) {
      const res = readConversionWorkbook(wb, input.name);
      mergeSummary(summary, res.summary);
      appendSuppliers(suppliers, res.suppliers, summary);
      valueMappings.push(...res.valueMappings);
      existingSuppliers.push(...res.existingSuppliers);
      continue;
    }

    summary.files.push({ name: input.name, kind: input.text !== undefined ? 'Pasted table' : 'Table' });
    for (const sheet of wb.sheets) {
      const oos = OUT_OF_SCOPE_PATTERNS.find((p) => p.pattern.test(sheet.name));
      if (oos && wb.sheets.length > 1) {
        summary.outOfScope.push({ file: input.name, where: `Tab "${sheet.name}"`, label: oos.label });
        continue;
      }
      const table = extractTable(sheet);
      if (!table || !table.rows.length) {
        if (sheet.rows.some((r) => r.some(Boolean))) {
          summary.ignored.push({ file: input.name, where: `Tab "${sheet.name}"`, reason: 'No table with a header row found' });
        }
        continue;
      }
      table.file = input.name;
      table.id = `${input.name}::${sheet.name}`;
      tables.push(table);
    }
  }

  assignTempIds(suppliers);
  summary.suppliersFound = suppliers.length;
  summary.tablesToMap = tables.length;
  return { suppliers, tables, valueMappings, existingSuppliers, summary };
}

function mergeSummary(into, from) {
  into.files.push(...from.files);
  into.rowsRead += from.rowsRead;
  into.skipped.push(...from.skipped);
  into.ignored.push(...from.ignored);
  into.outOfScope.push(...from.outOfScope);
  into.problems.push(...from.problems);
  into.valueMappings += from.valueMappings;
  into.existingSuppliers += from.existingSuppliers;
  into.notOnSuppliersTab += from.notOnSuppliersTab;
}

/** Suppliers from a second workbook with the same name are flagged, not silently merged. */
function appendSuppliers(all, incoming, summary) {
  const have = new Set(all.map((s) => s.nameKey));
  for (const s of incoming) {
    if (have.has(s.nameKey)) {
      s.notes.push({
        severity: 'error',
        code: 'duplicate-across-files',
        section: 'supplier',
        field: 'supplierName',
        message: `"${s.supplier.fields.supplierName.value}" is in more than one file.`,
      });
      summary.problems.push(`"${s.supplier.fields.supplierName.value}" appears in more than one file.`);
    }
    have.add(nameKey(s.supplier.fields.supplierName.value));
    all.push(s);
  }
}
