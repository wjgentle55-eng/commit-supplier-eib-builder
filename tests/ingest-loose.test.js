import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ingest } from '../src/ingest/index.js';
import { detectHeaderRow, buildSuppliersFromTable } from '../src/ingest/loose-reader.js';
import { newSummary } from '../src/ingest/workbook-reader.js';
import { assignTempIds } from '../src/model/supplier.js';

const csv = readFileSync(new URL('../fixtures/sample-loose.csv', import.meta.url));

describe('loose table ingest', () => {
  it('finds the header row below title rows', () => {
    const rows = [['Vendor Master Export'], ['Run date: 10/29/2026'], [], ['Vendor', 'Terms', 'City'], ['Acme', 'Net 30', 'Dallas'], ['Beta', 'Net 15', 'Austin']];
    expect(detectHeaderRow(rows)).toBe(3);
  });

  it('sends loose files to the Map step with text kept as text', () => {
    const res = ingest([{ name: 'sample-loose.csv', bytes: csv }]);
    expect(res.suppliers).toHaveLength(0);
    expect(res.tables).toHaveLength(1);
    const t = res.tables[0];
    expect(t.headerRow).toBe(4);
    expect(t.headers[0]).toBe('Vendor');
    expect(t.rows).toHaveLength(7);
    const acct = t.headers.indexOf('Bank Acct #');
    expect(t.rows[1].cells[acct]).toBe('000123456789');
  });

  it('reads pasted tab-delimited text', () => {
    const res = ingest([{ name: 'Pasted text', text: 'Vendor\tTerms\nAcme\tNet 30\nBeta\tNet 15\n' }]);
    expect(res.tables[0].rows.map((r) => r.cells[0])).toEqual(['Acme', 'Beta']);
  });

  it('merges repeated supplier rows into one supplier with child records and flags conflicts', () => {
    const t = ingest([{ name: 'sample-loose.csv', bytes: csv }]).tables[0];
    const col = (h) => t.headers.indexOf(h);
    const mapping = [
      { column: col('Vendor'), target: { section: 'supplier', field: 'supplierName' } },
      { column: col('Vendor Type'), target: { section: 'supplier', field: 'category' } },
      { column: col('Pay Method 1'), target: { section: 'payment', field: 'paymentTypesAccepted' } },
      { column: col('Pay Method 2'), target: { section: 'payment', field: 'paymentTypesAccepted' } },
      { column: col('Pay Method 3'), target: { section: 'payment', field: 'paymentTypesAccepted' } },
      { column: col('Street'), target: { section: 'addresses', field: 'addressLine1' } },
      { column: col('City'), target: { section: 'addresses', field: 'city' } },
      { column: col('Email'), target: { section: 'emails', field: 'emailAddress' } },
      { column: col('Bank Acct #'), target: { section: 'settlementAccounts', field: 'accountNumber' } },
    ];
    const summary = newSummary();
    const suppliers = assignTempIds(buildSuppliersFromTable(t, mapping, { fileName: 'sample-loose.csv', summary }));
    expect(suppliers).toHaveLength(5);
    const summit = suppliers.find((s) => s.supplier.fields.supplierName.value.startsWith('Summit'));
    expect(summit.addresses).toHaveLength(2);
    expect(summit.emails).toHaveLength(2);
    expect(summit.settlementAccounts).toHaveLength(1);
    expect(summit.settlementAccounts[0].fields.accountLabel.value).toBe('ACCT1');
    expect(summit.payment.fields.paymentTypesAccepted.value).toEqual(['Check', 'ACH', 'Wire']);
    const messy = suppliers.find((s) => s.supplier.fields.supplierName.value === 'Bad Data Co');
    expect(messy.supplier.fields.category.conflicts[0].value).toBe('Consulting');
    expect(messy.notes.map((n) => n.code)).toContain('conflicting-values');
    expect(summary.rowsRead).toBe(7);
  });
});
