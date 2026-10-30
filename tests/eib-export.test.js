import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { ingest } from '../src/ingest/index.js';
import { deriveBatch } from '../src/pipeline.js';
import { applyEdits } from '../src/model/edits.js';
import { exportEib, exportFileName, exportPlan } from '../src/eib/export.js';
import { COL, mappedColumns, columnInfo } from '../src/eib/column-map.js';
import template from '../src/eib/template-columns.json';
import '../src/stages.js';

const TEMPLATE = readFileSync(new URL('../reference/Submit_Supplier_Blank.xlsx', import.meta.url));
const WB = readFileSync(new URL('../fixtures/Sample_Conversion_Workbook.xlsx', import.meta.url));
const GOLDEN = readFileSync(new URL('./golden/expected-eib-clean-fixtures.xlsx', import.meta.url));
const ws = { name: 'Commit Demo', valueMappings: [], referenceResolutions: {}, tenantReferenceValues: [] };
const batch = (excluded) => deriveBatch({ ingestResult: ingest([{ name: 'wb.xlsx', bytes: WB }]), workspace: ws, applyEditsFn: applyEdits, excluded: new Set(excluded) });

function dataCells(bytes) {
  const wb = XLSX.read(bytes, { type: 'buffer' });
  const sh = wb.Sheets[wb.SheetNames[0]];
  const out = {};
  const range = XLSX.utils.decode_range(sh['!ref']);
  for (let r = 5; r <= range.e.r; r++) {
    for (let c = 0; c <= range.e.c; c++) {
      const cell = sh[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v !== '' && cell.v !== undefined) out[XLSX.utils.encode_cell({ r, c })] = cell.v;
    }
  }
  return out;
}

describe('column map', () => {
  it('resolves every mapped field to a distinct template column', () => {
    const cols = mappedColumns();
    expect(new Set(cols).size).toBe(cols.length);
    for (const c of cols) expect(c).toBeGreaterThanOrEqual(2);
  });
  it('never maps submission plumbing (Add Only, Submit, Delete, Replace All, Do Not Replace All)', () => {
    const fields = mappedColumns().map((c) => columnInfo(c).field);
    for (const f of ['Add Only', 'Submit', 'Delete', 'Replace All', 'Do Not Replace All', 'Supplier Reference ID']) expect(fields).not.toContain(f);
  });
  it('identifies repeated field names by area', () => {
    expect(columnInfo(COL.address.country).area).toMatch(/Contact Data/);
    expect(columnInfo(COL.sbaAddress.country).area).toMatch(/Settlement Account Data\+\)$/);
    expect(columnInfo(COL.sba.country).index).toBe(210);
    expect(template.columns[COL.supplier.approvalStatus - 1].format).toBe('Document_Status_ID');
  });
});

describe('Milestone 7: EIB export', () => {
  let out;
  let cells;
  beforeAll(async () => {
    out = await exportEib({ suppliers: batch(['TMP-0004', 'TMP-0005']).suppliers, workspace: ws, templateBytes: TEMPLATE, date: '2026-10-30' });
    cells = dataCells(out.bytes);
  });

  it('names the file Submit_Supplier_<Client>_<date>.xlsx', () => {
    expect(out.fileName).toBe('Submit_Supplier_Commit_Demo_2026-10-30.xlsx');
    expect(exportFileName('Acme & Co.', '2026-01-02')).toBe('Submit_Supplier_Acme_Co_2026-01-02.xlsx');
  });

  it('golden file: matches the reviewed expected EIB cell by cell', () => {
    expect(cells).toEqual(dataCells(GOLDEN));
  });

  it('keys every row, sets Auto Complete and Approval Status once per supplier, and never writes temp IDs', () => {
    const rows = new Set(Object.keys(cells).map((k) => k.replace(/^[A-Z]+/, '')));
    for (const r of rows) expect(cells[`B${r}`], `row ${r}`).toBeTruthy();
    expect(Object.entries(cells).filter(([k, v]) => k.startsWith('E') && /^E\d+$/.test(k) && v === 'Y')).toHaveLength(3);
    expect(Object.values(cells).some((v) => String(v).startsWith('TMP-'))).toBe(false);
    expect(Object.keys(cells).some((k) => /^(C|H|O)\d+$/.test(k))).toBe(false); // Add Only, Supplier ID, Submit
  });

  it('keeps leading zeros as text', () => {
    expect(Object.values(cells)).toContain('000123456789');
    expect(Object.values(cells)).toContain('026009593');
  });

  it('leaves rows 1 to 5 and data validations untouched', async () => {
    const a = await (await JSZip.loadAsync(TEMPLATE)).file('xl/worksheets/sheet1.xml').async('string');
    const b = await (await JSZip.loadAsync(out.bytes)).file('xl/worksheets/sheet1.xml').async('string');
    const head = (x) => x.slice(x.indexOf('<sheetData>'), x.indexOf('<row r="6"'));
    // The only allowed header change is the Related Worktags ID type in row 4 (D-017).
    const strip = (x) => head(x).replace(/<c r="O[DI]4"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, '');
    expect(strip(b)).toBe(strip(a));
    expect(b.slice(b.indexOf('</sheetData>'))).toBe(a.slice(a.indexOf('</sheetData>')));
    expect(out.worktagIdType).toBe('Cost_Center_Reference_ID');
  });

  it('refuses to export while an included supplier has errors', async () => {
    const all = batch([]).suppliers;
    expect(exportPlan(all).canExport).toBe(false);
    await expect(exportEib({ suppliers: all, workspace: ws, templateBytes: TEMPLATE })).rejects.toThrow(/errors/);
  });
});
