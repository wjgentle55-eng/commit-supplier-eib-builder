import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { ingest } from '../src/ingest/index.js';
import { deriveBatch } from '../src/pipeline.js';
import { applyEdits } from '../src/model/edits.js';
import { RULES } from '../src/validation/rules.js';
import '../src/stages.js';

const bytes = readFileSync(new URL('../fixtures/Sample_Conversion_Workbook.xlsx', import.meta.url));
const ws = () => ({ valueMappings: [], referenceResolutions: {}, tenantReferenceValues: [] });
const run = (edits = {}, workspace = ws()) => deriveBatch({ ingestResult: ingest([{ name: 'wb.xlsx', bytes }]), workspace, edits, applyEditsFn: applyEdits });
const byName = (b, n) => b.suppliers.find((s) => s.supplier.fields.supplierName.value === n);
const errs = (s) => s.issues.filter((i) => i.severity === 'error').map((i) => i.ruleId);

describe('rules table', () => {
  it('has unique IDs and only known scopes and severities', () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
    for (const r of RULES) {
      expect(['record', 'supplier', 'batch']).toContain(r.scope);
      expect(['error', 'warning', 'from-note']).toContain(r.severity);
      expect(r.message).toBeTruthy();
    }
  });
});

describe('Milestone 5 acceptance', () => {
  let b;
  beforeAll(() => {
    b = run();
  });

  it('the clean suppliers have no errors', () => {
    for (const n of ['Agile Staffing LTD', 'Northwind Logistics LLC', 'Summit Industrial Supply Inc']) {
      expect(errs(byName(b, n)), n).toEqual([]);
      expect(byName(b, n).status).not.toBe('blocked');
    }
  });

  it('the messy supplier shows the expected errors', () => {
    const e = errs(byName(b, 'Bad Data Co'));
    expect(e).toEqual(expect.arrayContaining([
      'BANK-aba', // bad routing number
      'ADDR-country-rules', // missing region
      'REF-unresolved', // unresolved category
      'PRIMARY-emails', // two primary emails
      'FMT-email', 'ADDR-us-postal', 'TAX-us-format', 'COND-status-reason',
    ]));
    expect(byName(b, 'Bad Data Co').status).toBe('blocked');
  });

  it('flags the near-duplicate supplier, not the original', () => {
    expect(errs(byName(b, 'Northwind Logistics, LLC'))).toEqual(expect.arrayContaining(['DUP-taxid', 'DUP-account']));
    expect(errs(byName(b, 'Northwind Logistics LLC'))).toEqual([]);
  });

  it('warns about assumed IDs and possible existing duplicates', () => {
    const summit = byName(b, 'Summit Industrial Supply Inc');
    const w = summit.issues.filter((i) => i.severity === 'warning').map((i) => i.ruleId);
    expect(w).toContain('REF-assumed');
    expect(summit.issues.find((i) => i.ruleId === 'DUP-existing').message).toMatch(/S-0042.*same tax ID/);
  });

  it('re-validates after edits', () => {
    const messy = byName(b, 'Bad Data Co');
    const edits = {
      [messy.tempId]: {
        fields: {
          'supplier.category': 'Professional Services',
          'supplier.statusReason': 'Data Entry Error',
          'addresses.0.region': 'Texas',
          'addresses.0.postalCode': '78701',
          'settlementAccounts.0.routingNumber': '111000614',
          'taxIds.0.taxId': '74-1234567',
          'emails.1.primary': 'No',
          'emails.1.emailAddress': 'owner@baddata.example',
        },
        removed: [],
        added: {},
      },
    };
    const after = byName(run(edits), 'Bad Data Co');
    expect(errs(after)).toEqual([]);
    expect(after.supplier.fields.category.original).toBe('Consultants???');
  });

  it('summarizes counts and top issues', () => {
    expect(b.validation.counts).toMatchObject({ blocked: 2, warnings: 3, clean: 0 });
    expect(b.validation.top.length).toBeGreaterThan(0);
    expect(b.validation.top[0].severity).toBe('error');
  });
});

describe('specific rules', () => {
  it('Default Payment Type must be accepted, and electronic types need an account', () => {
    const b0 = run();
    const n = byName(b0, 'Northwind Logistics LLC');
    const b = run({ [n.tempId]: { fields: { 'payment.defaultPaymentType': 'Wire' }, removed: ['settlementAccounts.0'], added: {} } });
    expect(errs(byName(b, 'Northwind Logistics LLC'))).toEqual(expect.arrayContaining(['PAY-default-in-accepted', 'PAY-electronic-needs-account']));
  });

  it('bank fields Workday hides for the country are errors (Name on Account for US)', () => {
    const b0 = run();
    const n = byName(b0, 'Northwind Logistics LLC');
    const b = run({ [n.tempId]: { fields: { 'settlementAccounts.0.nameOnAccount': 'Northwind' }, removed: [], added: {} } });
    const i = byName(b, 'Northwind Logistics LLC').issues.find((x) => x.ruleId === 'BANK-country-rules');
    expect(i.message).toMatch(/Name on Account isn.t used/);
  });

  it('transaction tax ID only on types that allow it', () => {
    const b0 = run();
    const n = byName(b0, 'Northwind Logistics LLC');
    const b = run({ [n.tempId]: { fields: { 'taxIds.0.taxIdType': 'SSN or ITIN', 'taxIds.0.taxId': '123-45-6789', 'taxIds.0.transactionTaxId': 'Yes' }, removed: [], added: {} } });
    expect(errs(byName(b, 'Northwind Logistics LLC'))).toContain('TAX-transaction-allowed');
  });
});
