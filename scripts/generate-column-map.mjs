#!/usr/bin/env node
// Snapshots every column of the blank EIB template (Area + Field + occurrence,
// plus restriction and format) into src/eib/template-columns.json.
//
// The hand-reviewed internal field -> column map (src/eib/column-map.js) is
// built on top of these keys. tests/template-headers.test.js fails if the
// template's header rows ever drift from this snapshot.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTemplate } from '../src/eib/template.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tpl = await loadTemplate(readFileSync(join(root, 'reference', 'Submit_Supplier_Blank.xlsx')));

const snapshot = {
  title: tpl.title,
  sheetName: tpl.sheetName,
  columnCount: tpl.columns.length,
  columns: tpl.columns.map(({ index, letter, area, field, occurrence, restriction, format, key }) => ({
    index, letter, area, field, occurrence, restriction, format, key,
  })),
};

writeFileSync(join(root, 'src', 'eib', 'template-columns.json'), JSON.stringify(snapshot, null, 1) + '\n');
const dupes = tpl.columns.filter((c) => c.occurrence > 1);
console.log(`${tpl.title}: ${tpl.columns.length} columns, ${dupes.length} repeated Area + Field pairs`);
