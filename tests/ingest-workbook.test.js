import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { ingest } from '../src/ingest/index.js';

const bytes = readFileSync(new URL('../fixtures/Sample_Conversion_Workbook.xlsx', import.meta.url));
const v = (f) => f?.value;

describe('Conversion Workbook ingest (Milestone 2 acceptance)', () => {
  let res;
  const byName = (n) => res.suppliers.find((s) => v(s.supplier.fields.supplierName) === n);
  beforeAll(() => {
    res = ingest([{ name: 'Sample_Conversion_Workbook.xlsx', bytes }]);
  });

  it('detects the workbook and loads 5 suppliers with temp IDs in order', () => {
    expect(res.summary.files[0].kind).toBe('Supplier Conversion Workbook');
    expect(res.tables).toHaveLength(0);
    expect(res.suppliers.map((s) => s.tempId)).toEqual(['TMP-0001', 'TMP-0002', 'TMP-0003', 'TMP-0004', 'TMP-0005']);
    expect(res.suppliers.map((s) => v(s.supplier.fields.supplierName))).toEqual([
      'Agile Staffing LTD', 'Northwind Logistics LLC', 'Summit Industrial Supply Inc', 'Bad Data Co', 'Northwind Logistics, LLC',
    ]);
  });

  it('reports rows, value mappings, existing suppliers, and out-of-scope tabs', () => {
    expect(res.summary.rowsRead).toBe(41);
    expect(res.summary.skipped).toEqual([]);
    expect(res.valueMappings).toHaveLength(1);
    expect(res.valueMappings[0]).toMatchObject({ legacyValue: 'ACH', workdayValue: 'EFT' });
    expect(res.existingSuppliers[0]).toMatchObject({ supplierId: 'S-0042', accountLast4: '2233' });
    expect(res.summary.outOfScope).toEqual([expect.objectContaining({ label: 'Supplier contacts' })]);
  });

  it('rebuilds Agile Staffing LTD as in the View Supplier PDF', () => {
    const s = byName('Agile Staffing LTD');
    expect(v(s.supplier.fields.category)).toBe('Professional Services');
    expect(v(s.supplier.fields.groups)).toEqual(['Suppliers A - L']);
    expect(v(s.supplier.fields.defaultCurrency)).toBe('INR');
    expect(v(s.supplier.fields.statusReason)).toBe('Data Entry Error');
    expect(v(s.payment.fields.paymentTypesAccepted)).toEqual(['Check', 'EFT']);
    expect(v(s.payment.fields.defaultPaymentType)).toBe('EFT');
    expect(s.addresses).toHaveLength(1);
    const a = s.addresses[0].fields;
    expect([v(a.addressLine1), v(a.city), v(a.region), v(a.postalCode), v(a.country)]).toEqual(['Scf 41, Market -ii', 'Delhi', 'Haryāna', '121001', 'India']);
    expect(v(a.useFor)).toEqual(['Billing', 'Remit To', 'Shipping']);
    expect(v(a.effectiveDate)).toBe('2023-01-01');
    expect(v(s.emails[0].fields.emailAddress)).toBe('jsteiffel@agilestaffltd.com');
    expect(v(s.settlementAccounts[0].fields.accountType)).toBe('Checking');
    expect(v(s.settlementAccounts[0].fields.accountNumber)).toMatch(/8510$/);
  });

  it('keeps leading zeros and text IDs', () => {
    const s = byName('Northwind Logistics LLC');
    expect(v(s.settlementAccounts[0].fields.accountNumber)).toBe('000123456789');
    expect(v(s.supplier.fields.duns)).toBe('012345678');
    expect(v(s.taxIds[0].fields.taxId)).toBe('12-3456789');
  });

  it('handles multiple addresses, emails, payment types, and nested banking', () => {
    const s = byName('Summit Industrial Supply Inc');
    expect(s.addresses).toHaveLength(2);
    expect(s.emails).toHaveLength(2);
    expect(v(s.payment.fields.paymentTypesAccepted)).toEqual(['Check', 'ACH', 'Wire']);
    expect(v(s.payment.fields.poIssueEmails)).toHaveLength(2);
    expect(v(s.supplier.fields.coiDate)).toBe('2026-06-30');
    const acct = s.settlementAccounts[0];
    expect(acct.intermediaries).toHaveLength(1);
    expect(acct.bankAddresses).toHaveLength(1);
    expect(acct.intermediaries[0].bankAddresses).toHaveLength(1);
    expect(v(acct.intermediaries[0].bankAddresses[0].fields.city)).toBe('New York');
    expect(v(s.alternateNames[0].fields.usage)).toEqual(['Doing Business As', 'Remit To Payee']);
    expect(s.notes).toEqual([]);
  });

  it('records where every value came from', () => {
    const f = byName('Northwind Logistics LLC').payment.fields.paymentTerms;
    expect(f.source).toMatchObject({ sheet: 'Payment & Procurement', column: 'Payment Terms', cell: 'C5' });
  });

  it('keeps the messy supplier data as-is for validation to flag', () => {
    const s = byName('Bad Data Co');
    expect(s.emails.filter((e) => v(e.fields.primary) === 'Yes')).toHaveLength(2);
    expect(v(s.addresses[0].fields.region)).toBeUndefined();
    expect(v(s.settlementAccounts[0].fields.routingNumber)).toBe('123456789');
  });
});
