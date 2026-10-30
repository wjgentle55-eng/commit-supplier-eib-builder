#!/usr/bin/env node
// Generates the bundled reference data used by the app:
//   src/data/lists.json          Standard Workday display values (Lists tab)
//   src/data/address-rules.json  Per-country address field rules (Address Rules tab)
//   src/data/bank-rules.json     Per-country bank field rules and regex formats (Bank Rules tab)
//   src/data/eib-template.js     The blank Submit Supplier v44.1 EIB as a base64 string
//
// Run with `npm run extract` after replacing anything in /reference.
// Output is deterministic, so re-running without changes produces no diff.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ref = (f) => join(root, 'reference', f);
const out = (f) => join(root, 'src', 'data', f);
mkdirSync(join(root, 'src', 'data'), { recursive: true });

const clean = (v) => (v === null || v === undefined ? '' : String(v).trim());
const norm = (v) => clean(v).toLowerCase().replace(/[+?]$/, '').trim();

const wb = XLSX.read(readFileSync(ref('Supplier_Conversion_Workbook.xlsx')), { type: 'buffer' });

function findSheet(name) {
  const hit = wb.SheetNames.find((n) => norm(n) === norm(name));
  if (!hit) throw new Error(`Conversion Workbook is missing the "${name}" tab`);
  return wb.Sheets[hit];
}

/** Returns the sheet as an array of row arrays (row 1 = index 0). */
function grid(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: true });
}

/** Finds the header row: the first row whose first cell matches `firstHeader`. */
function headerRowIndex(rows, firstHeader) {
  const i = rows.findIndex((r) => norm(r[0]) === norm(firstHeader));
  if (i < 0) throw new Error(`Could not find a header row starting with "${firstHeader}"`);
  return i;
}

// ---------------------------------------------------------------- Lists
// The Lists tab holds several lists side by side, separated by blank columns.
// Each contiguous block of headers on the header row is one list. Single-column
// blocks become string arrays; multi-column blocks become arrays of objects.
function extractLists() {
  const rows = grid(findSheet('Lists'));
  const h = rows.findIndex((r) => r.some((c) => norm(c) === 'country') && r.some((c) => norm(c) === 'currency'));
  if (h < 0) throw new Error('Could not find the header row on the Lists tab');
  const header = rows[h];
  const blocks = [];
  let cur = null;
  for (let c = 0; c < header.length; c++) {
    const name = clean(header[c]);
    if (name) {
      if (!cur) blocks.push((cur = { start: c, cols: [] }));
      cur.cols.push({ c, name });
    } else {
      cur = null;
    }
  }
  const lists = {};
  for (const b of blocks) {
    const key = b.cols[0].name;
    const data = [];
    for (let r = h + 1; r < rows.length; r++) {
      const vals = b.cols.map(({ c }) => clean(rows[r][c]));
      if (vals.every((v) => v === '')) continue;
      if (b.cols.length === 1) data.push(vals[0]);
      else data.push(Object.fromEntries(b.cols.map((col, i) => [col.name, vals[i]])));
    }
    // Disambiguate repeated block names (none today, but keep it safe).
    let k = key;
    for (let n = 2; lists[k]; n++) k = `${key} (${n})`;
    lists[k] = data;
  }
  return lists;
}

// ---------------------------------------------------------- Rules tabs
function extractRuleTable(tab) {
  const rows = grid(findSheet(tab));
  const h = headerRowIndex(rows, 'Country');
  const header = rows[h].map(clean);
  const lastCol = header.reduce((m, v, i) => (v ? i : m), 0);
  const fields = header.slice(0, lastCol + 1);
  const byCountry = {};
  for (let r = h + 1; r < rows.length; r++) {
    const country = clean(rows[r][0]);
    if (!country) continue;
    const rec = {};
    fields.forEach((f, i) => {
      if (i > 0 && f) rec[f] = clean(rows[r][i]);
    });
    byCountry[country] = rec;
  }
  return { fields: fields.slice(1).filter(Boolean), countries: byCountry };
}

const lists = extractLists();
const addressRules = extractRuleTable('Address Rules');
const bankRules = extractRuleTable('Bank Rules');

const json = (o) => JSON.stringify(o, null, 1) + '\n';
writeFileSync(out('lists.json'), json(lists));
writeFileSync(out('address-rules.json'), json(addressRules));
writeFileSync(out('bank-rules.json'), json(bankRules));

// ----------------------------------------------------- Region IDs (D-016)
// Workday Country_Region_ID is the ISO 3166-1 alpha-3 code plus the ISO 3166-2
// subdivision code, e.g. USA-TX, CAN-ON, IND-HR. Subdivision codes come from
// the iso3166-2-db package (MIT, build time only). Region names from the Lists
// tab are added as aliases when they match a subdivision.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const isoDb = require('iso3166-2-db/i18n/dispute/UN/en.json');
const fold = (v) => clean(v).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

const regions = {};
for (const c of lists.Country) {
  const iso2 = c['ISO 2'];
  const iso3 = c['ISO 3'];
  const db = isoDb[iso2];
  const subs = (db?.regions ?? []).map((r) => ({ id: `${iso3}-${r.iso}`, code: r.iso, names: [r.name] }));
  const byName = new Map(subs.map((r) => [fold(r.names[0]), r]));
  const unmatched = [];
  for (const r of lists.Region.filter((x) => x.Country === c.Country)) {
    const hit = byName.get(fold(r.Region));
    if (hit) {
      if (!hit.names.includes(r.Region)) hit.names.push(r.Region);
    } else unmatched.push(r.Region);
  }
  if (subs.length || unmatched.length) regions[iso2] = { iso3, regions: subs, namesWithoutId: unmatched };
}
writeFileSync(out('regions.json'), json(regions));

// ------------------------------------------------------- EIB template
const tpl = readFileSync(ref('Submit_Supplier_Blank.xlsx'));
writeFileSync(
  out('eib-template.js'),
  '// Generated by scripts/extract-reference-data.mjs. Do not edit by hand.\n' +
    '// Blank Workday Submit Supplier v44.1 EIB template (reference/Submit_Supplier_Blank.xlsx).\n' +
    `export const EIB_TEMPLATE_BASE64 = '${tpl.toString('base64')}';\n`,
);

const summary = Object.entries(lists)
  .map(([k, v]) => `${k}: ${v.length}`)
  .join(', ');
console.log(`Lists -> ${summary}`);
console.log(`Address Rules -> ${Object.keys(addressRules.countries).length} countries, ${addressRules.fields.length} fields`);
console.log(`Bank Rules -> ${Object.keys(bankRules.countries).length} countries, ${bankRules.fields.length} fields`);
console.log(`EIB template -> ${tpl.length} bytes`);
const nRegions = Object.values(regions).reduce((n, c) => n + c.regions.length, 0);
const nNoId = Object.values(regions).reduce((n, c) => n + c.namesWithoutId.length, 0);
console.log(`Regions -> ${nRegions} with IDs across ${Object.keys(regions).length} countries, ${nNoId} Lists names without an ISO match`);
