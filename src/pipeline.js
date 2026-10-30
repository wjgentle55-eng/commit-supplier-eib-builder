// The batch pipeline. Every change (a mapping confirmed, a rule added, a
// field edited, a reference resolved) re-derives the batch from the ingested
// data, so the result never depends on the order things were done in.
//
//   ingest result + confirmed table mappings
//     -> suppliers (temp IDs)
//     -> value mapping rules
//     -> user edits
//     -> reference resolution          (Milestone 4)
//     -> validation                    (Milestone 5)

import { buildSuppliersFromTable } from './ingest/loose-reader.js';
import { toBuildMapping } from './mapping/auto-map.js';
import { applyValueMappings, normalizeRule } from './mapping/value-mapping.js';
import { assignTempIds, mergeField, MANY_SECTIONS, addNote, noteConflicts } from './model/supplier.js';
import { SECTION_BY_KEY } from './model/schema.js';

const hooks = { afterEdits: [] };
/** Later stages (references, validation) register here. */
export function registerStage(fn) {
  hooks.afterEdits.push(fn);
}

export function deriveBatch({ ingestResult, mappings = {}, workspace, edits = {}, applyEditsFn, excluded = new Set() }) {
  const suppliers = structuredClone(ingestResult.suppliers);
  const byName = new Map(suppliers.map((s) => [s.nameKey, { s, origin: 'workbook' }]));
  const tableStats = [];

  for (const table of ingestResult.tables) {
    const m = mappings[table.id];
    if (!m?.confirmed) continue;
    const built = buildSuppliersFromTable(table, toBuildMapping(m), { fileName: table.file, defaults: m.defaults ?? [] });
    tableStats.push({ id: table.id, suppliers: built.length });
    for (const s of built) {
      const hit = byName.get(s.nameKey);
      if (!hit) {
        byName.set(s.nameKey, { s, origin: 'table' });
        suppliers.push(s);
      } else if (hit.origin === 'table') {
        mergeSupplier(hit.s, s);
      } else {
        addNote(s, {
          severity: 'error',
          code: 'duplicate-across-files',
          section: 'supplier',
          field: 'supplierName',
          message: `"${s.supplier.fields.supplierName.value}" is also in the Conversion Workbook.`,
        });
        suppliers.push(s);
      }
    }
  }
  assignTempIds(suppliers);

  const rules = [
    ...(workspace?.valueMappings ?? []).map((r) => normalizeRule(r, 'workspace')),
    ...(ingestResult.valueMappings ?? []).map((r, i) => normalizeRule({ ...r, id: `wb-${i}` }, 'workbook')),
  ];
  const valueMapping = applyValueMappings(suppliers, rules);

  if (applyEditsFn) applyEditsFn(suppliers, edits);

  const ctx = { suppliers, workspace, ingestResult, excluded, existingSuppliers: ingestResult.existingSuppliers ?? [] };
  for (const stage of hooks.afterEdits) Object.assign(ctx, stage(ctx) ?? {});

  return { ...ctx, rules, valueMapping, tableStats };
}

/** Merges a supplier built from another loose table into an existing one. */
function mergeSupplier(into, from) {
  for (const sec of ['supplier', 'payment']) {
    for (const [key, f] of Object.entries(from[sec].fields)) {
      const col = SECTION_BY_KEY[sec].columns.find((c) => c.key === key);
      mergeField(into[sec].fields, key, f.value, f.source, col);
    }
  }
  for (const k of MANY_SECTIONS) into[k].push(...from[k]);
  into.notes.push(...from.notes);
  noteConflicts(into);
}
