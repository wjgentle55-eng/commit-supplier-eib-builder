import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { ingest } from '../src/ingest/index.js';
import { deriveBatch } from '../src/pipeline.js';
import { applyEdits } from '../src/model/edits.js';
import { buildExceptionReport } from '../src/report/exception-report.js';
import { newWorkspace, exportWorkspace, importWorkspace, settingsOf } from '../src/model/workspace.js';
import '../src/stages.js';

const WB = readFileSync(new URL('../fixtures/Sample_Conversion_Workbook.xlsx', import.meta.url));
const ws = { name: 'Commit Demo', valueMappings: [], referenceResolutions: {}, tenantReferenceValues: [] };
const batch = () => deriveBatch({ ingestResult: ingest([{ name: 'wb.xlsx', bytes: WB }]), workspace: ws, applyEditsFn: applyEdits, excluded: new Set(['TMP-0005']) });

async function sheets(bytes) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const out = {};
  wb.eachSheet((sh) => {
    out[sh.name] = [];
    sh.eachRow((row) => out[sh.name].push(row.values.slice(1)));
  });
  return out;
}

describe('exception report', () => {
  it('has a Summary and an Issues tab with the brief’s columns, in client language', async () => {
    const { bytes, fileName } = await buildExceptionReport({ suppliers: batch().suppliers, workspace: ws, date: '2026-10-30' });
    expect(fileName).toBe('Supplier_Exception_Report_Commit_Demo_2026-10-30.xlsx');
    const s = await sheets(bytes);
    expect(Object.keys(s)).toEqual(['Summary', 'Issues']);
    expect(s.Issues[0]).toEqual(['Temp ID', 'Supplier Name', 'Section', 'Field', 'Current Value', 'Severity', 'Message', 'Suggested Fix']);
    const text = JSON.stringify(s);
    expect(text).not.toMatch(/assumed|Reference IDs step/i);
    expect(text).toMatch(/Consultants\?\?\?.*doesn.t match a value set up in Workday/);
    expect(text).toMatch(/Left out of this load/);
  });

  it('masks bank and tax numbers and can leave warnings out', async () => {
    const { bytes } = await buildExceptionReport({ suppliers: batch().suppliers, workspace: ws, includeWarnings: false, date: '2026-10-30' });
    const s = await sheets(bytes);
    expect(s.Issues.slice(1).every((r) => r[5] === 'Error')).toBe(true);
    const tax = s.Issues.find((r) => r[3] === 'Tax ID');
    expect(tax[4]).toBe('••••1234');
  });
});

describe('workspaces', () => {
  it('export and import round-trip without supplier data, and never import persistence as on', () => {
    const w = newWorkspace('Client X');
    w.valueMappings.push({ id: 'vm-1', tab: 'Payment & Procurement', column: 'Payment Types Accepted', legacyValue: 'ACH', workdayValues: ['EFT'] });
    w.settings.persistBatch = true;
    const text = exportWorkspace(w);
    expect(text).not.toMatch(/supplier(s)?":/i);
    const back = importWorkspace(text);
    expect(back.name).toBe('Client X');
    expect(back.valueMappings).toEqual(w.valueMappings);
    expect(back.settings.persistBatch).toBe(false);
    expect(back.id).not.toBe(w.id);
    expect(() => importWorkspace('{"x":1}')).toThrow();
  });

  it('fills in default settings for older workspaces', () => {
    expect(settingsOf({ settings: { approvalStatusId: 'APPROVED' } })).toMatchObject({ addressIdPattern: 'ADDR-{date}-{key}-{n}', persistBatch: false });
  });
});
