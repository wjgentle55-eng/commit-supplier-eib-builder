// Tenant reference values: a simple file with Reference ID Type, Reference ID,
// and Display Name columns. Common report shapes are accepted too:
//   - ID Type / ID / Instance (or Descriptor, Name) columns
//   - one sheet per type, with the type as the sheet name or as the ID column header
//     (for example a "Supplier_Category_ID" column next to a "Supplier Category" column)

import { readWorkbook, readText } from '../ingest/sheets.js';
import { extractTable } from '../ingest/loose-reader.js';
import { headerKey } from '../model/normalize.js';
import { normalizeTypeName, REF_TYPE_LABELS } from './resolve.js';

const TYPE_HEADERS = ['reference id type', 'id type', 'type', 'reference type', 'reference_id_type', 'object type', 'business object'];
const ID_HEADERS = ['reference id', 'id', 'reference id value', 'workday id', 'value', 'reference_id', 'id value'];
const NAME_HEADERS = ['display name', 'name', 'descriptor', 'instance', 'description', 'display value', 'label'];

const KNOWN_TYPES = new Set(Object.keys(REF_TYPE_LABELS));
const isType = (s) => KNOWN_TYPES.has(normalizeTypeName(s));

function pick(headers, wanted) {
  const keys = headers.map(headerKey);
  for (const w of wanted) {
    const i = keys.indexOf(w);
    if (i >= 0) return i;
  }
  return -1;
}

export function parseTenantValues(input) {
  const wb = input.text !== undefined ? readText(input.text, input.name) : readWorkbook(input.bytes, input.name);
  const out = [];
  const problems = [];
  for (const sheet of wb.sheets) {
    const t = extractTable(sheet);
    if (!t || !t.rows.length) continue;
    let typeCol = pick(t.headers, TYPE_HEADERS);
    let idCol = pick(t.headers, ID_HEADERS);
    let nameCol = pick(t.headers, NAME_HEADERS);
    let fixedType = null;

    if (typeCol < 0) {
      // One type per sheet: from an ID column named after the type, or the sheet name.
      const typedIdCol = t.headers.findIndex((h) => /_ID$|_Code$/i.test(h.trim()) && isType(h));
      if (typedIdCol >= 0) {
        idCol = typedIdCol;
        fixedType = normalizeTypeName(t.headers[typedIdCol]);
        if (nameCol < 0) nameCol = t.headers.findIndex((h, i) => i !== idCol && h.trim());
      } else if (isType(sheet.name)) {
        fixedType = normalizeTypeName(sheet.name);
      } else {
        problems.push(`${sheet.name}: couldn't tell which reference type these values are. Add a Reference ID Type column.`);
        continue;
      }
    }
    if (idCol < 0) {
      problems.push(`${sheet.name}: no Reference ID column found.`);
      continue;
    }
    for (const r of t.rows) {
      const id = r.cells[idCol];
      const type = fixedType ?? normalizeTypeName(r.cells[typeCol]);
      if (!id || !type) continue;
      out.push({ type, id, name: nameCol >= 0 ? r.cells[nameCol] || id : id });
    }
  }
  return { values: dedupe(out), problems };
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((v) => {
    const k = `${v.type}|${v.id}|${v.name}`;
    return seen.has(k) ? false : seen.add(k);
  });
}
