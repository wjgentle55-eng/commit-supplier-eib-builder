import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveValue, indexTenant, resolveBatch, records, resolutionKey } from '../src/reference/resolve.js';
import { parseTenantValues } from '../src/reference/tenant.js';
import { findRegion, patternId } from '../src/reference/baseline.js';
import { ingest } from '../src/ingest/index.js';
import { deriveBatch } from '../src/pipeline.js';
import { applyEdits } from '../src/model/edits.js';
import '../src/stages.js';

const none = { tenant: new Map(), resolutions: {} };

describe('reference matching', () => {
  it('derives IDs by pattern', () => {
    expect(patternId('Net 30')).toBe('Net_30');
    expect(patternId('Logistics / Freight Providers')).toBe('Logistics_Freight_Providers');
  });

  it('matches countries and currencies as Workday standard IDs, with synonyms', () => {
    for (const v of ['USA', 'United States', 'US', 'united states of america']) {
      expect(resolveValue('ISO_3166-1_Alpha-2_Code', v, none)).toMatchObject({ status: 'matched', id: 'US' });
    }
    expect(resolveValue('Currency_ID', 'usd', none)).toMatchObject({ status: 'matched', id: 'USD' });
    expect(resolveValue('Currency_ID', 'US Dollars', none)).toMatchObject({ status: 'matched', id: 'USD' });
    expect(resolveValue('Currency_ID', 'Zorkmid', none).status).toBe('unresolved');
  });

  it('resolves regions by name or code within the country', () => {
    expect(resolveValue('Country_Region_ID', 'TX', { ...none, country: 'US' })).toMatchObject({ status: 'assumed', id: 'USA-TX' });
    expect(resolveValue('Country_Region_ID', 'Haryāna', { ...none, country: 'IN' })).toMatchObject({ id: 'IND-HR' });
    expect(resolveValue('Country_Region_ID', 'Ontario', { ...none, country: 'CA' }).id).toBe('CAN-ON');
    expect(resolveValue('Country_Region_ID', 'Texas', none).status).toBe('unresolved');
    expect(findRegion('US', 'Puerto Rico').id).toBe('USA-PR');
  });

  it('applies synonyms before the pattern (ACH -> EFT, Check/Cheque -> Check)', () => {
    expect(resolveValue('Payment_Type_ID', 'ACH', none)).toMatchObject({ status: 'assumed', id: 'EFT' });
    expect(resolveValue('Payment_Type_ID', 'Check/Cheque', none)).toMatchObject({ id: 'Check' });
    expect(resolveValue('Bank_Account_Type_Code', 'Checking', none)).toMatchObject({ status: 'assumed', id: 'DDA' });
  });

  it('leaves values it cannot derive an ID from unresolved, with a fuzzy suggestion only', () => {
    expect(resolveValue('Supplier_Category_ID', 'Consultants???', none)).toMatchObject({ status: 'unresolved', id: '' });
    const tenant = indexTenant([{ type: 'Supplier_Category_ID', id: 'CONSULTANTS', name: 'Consultants' }]);
    const r = resolveValue('Supplier_Category_ID', 'Consultants???', { tenant, resolutions: {} });
    expect(r.status).toBe('unresolved');
    expect(r.suggestion).toMatchObject({ id: 'CONSULTANTS' });
  });

  it('prefers tenant values: exact, then normalized, then synonyms, and never falls back to the pattern', () => {
    const tenant = indexTenant([
      { type: 'Supplier Category', id: 'PS', name: 'Professional Services' },
      { type: 'Payment_Type_ID', id: 'PT_EFT', name: 'EFT' },
    ]);
    const o = { tenant, resolutions: {} };
    expect(resolveValue('Supplier_Category_ID', 'Professional Services', o)).toMatchObject({ status: 'matched', id: 'PS' });
    expect(resolveValue('Supplier_Category_ID', 'professional  services', o)).toMatchObject({ status: 'matched', id: 'PS' });
    expect(resolveValue('Payment_Type_ID', 'ACH', o)).toMatchObject({ status: 'matched', id: 'PT_EFT' });
    expect(resolveValue('Supplier_Category_ID', 'Logistics', o).status).toBe('unresolved');
  });

  it('uses saved resolutions first', () => {
    const resolutions = { Supplier_Category_ID: { [resolutionKey('Supplier_Category_ID', 'Consultants???')]: { id: 'CONSULTING' } } };
    expect(resolveValue('Supplier_Category_ID', 'Consultants???', { tenant: new Map(), resolutions })).toMatchObject({ status: 'matched', id: 'CONSULTING', how: 'Confirmed by you' });
  });
});

describe('tenant value files', () => {
  it('reads the simple 3-column format', () => {
    const { values } = parseTenantValues({ name: 't.csv', text: 'Reference ID Type,Reference ID,Display Name\nSupplier_Category_ID,PS,Professional Services\nPayment Terms,Net_30,Net 30\n' });
    expect(values).toEqual([
      { type: 'Supplier_Category_ID', id: 'PS', name: 'Professional Services' },
      { type: 'Payment_Terms_ID', id: 'Net_30', name: 'Net 30' },
    ]);
  });
  it('reads a single-type report with the type as the ID column header', () => {
    const { values } = parseTenantValues({ name: 'r.csv', text: 'Supplier Category,Supplier_Category_ID\nProfessional Services,PS\nLogistics,LOG\n' });
    expect(values).toEqual([
      { type: 'Supplier_Category_ID', id: 'PS', name: 'Professional Services' },
      { type: 'Supplier_Category_ID', id: 'LOG', name: 'Logistics' },
    ]);
  });
  it('reports sheets it cannot place', () => {
    const { values, problems } = parseTenantValues({ name: 'x.csv', text: 'Foo,Bar\n1,2\n' });
    expect(values).toEqual([]);
    expect(problems).toHaveLength(1);
  });
});

describe('Milestone 4 acceptance', () => {
  const bytes = readFileSync(new URL('../fixtures/Sample_Conversion_Workbook.xlsx', import.meta.url));
  const run = (workspace) => deriveBatch({ ingestResult: ingest([{ name: 'wb.xlsx', bytes }]), workspace, applyEditsFn: applyEdits });

  it('gives every reference value on the fixtures a status', () => {
    const b = run({ valueMappings: [], referenceResolutions: {}, tenantReferenceValues: [] });
    let n = 0;
    for (const s of b.suppliers) {
      for (const { rec } of records(s)) {
        for (const f of Object.values(rec.fields)) {
          for (const r of f.refs ?? []) {
            expect(['matched', 'assumed', 'unresolved']).toContain(r.status);
            n++;
          }
        }
      }
    }
    expect(n).toBeGreaterThan(60);
    const cat = b.refIndex.get('Supplier_Category_ID');
    expect([...cat.values()].find((e) => e.value === 'Consultants???').status).toBe('unresolved');
    expect([...cat.values()].filter((e) => e.status === 'unresolved')).toHaveLength(1);
  });

  it('persists resolutions in the workspace and applies them on the next run', () => {
    const ws = { valueMappings: [], referenceResolutions: {}, tenantReferenceValues: [] };
    const first = run(ws);
    const e = [...first.refIndex.get('Supplier_Category_ID').values()].find((x) => x.status === 'unresolved');
    ws.referenceResolutions.Supplier_Category_ID = { [e.key]: { id: 'Consultants' } };
    const second = JSON.parse(JSON.stringify(ws));
    const b = run(second);
    const again = [...b.refIndex.get('Supplier_Category_ID').values()].find((x) => x.key === e.key);
    expect(again).toMatchObject({ status: 'matched', id: 'Consultants' });
    const messy = b.suppliers.find((s) => s.supplier.fields.supplierName.value === 'Bad Data Co');
    expect(messy.supplier.fields.category.refs[0]).toMatchObject({ status: 'matched', id: 'Consultants' });
  });

  it('resolves multi-value fields value by value', () => {
    const b = run({ valueMappings: [], referenceResolutions: {}, tenantReferenceValues: [] });
    const summit = b.suppliers.find((s) => s.supplier.fields.supplierName.value.startsWith('Summit'));
    expect(summit.payment.fields.paymentTypesAccepted.refs.map((r) => r.id)).toEqual(['Check', 'EFT', 'Wire']);
  });
});
