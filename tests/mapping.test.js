import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ingest } from '../src/ingest/index.js';
import { guessMapping, similarity } from '../src/mapping/auto-map.js';
import { makeProfile, findProfile, applyProfile, exportProfiles, importProfiles } from '../src/mapping/profiles.js';
import { applyValueMappings, normalizeRule } from '../src/mapping/value-mapping.js';
import { deriveBatch } from '../src/pipeline.js';

const wbBytes = readFileSync(new URL('../fixtures/Sample_Conversion_Workbook.xlsx', import.meta.url));
const csvBytes = readFileSync(new URL('../fixtures/sample-loose.csv', import.meta.url));
const v = (f) => f?.value;

describe('auto-mapping', () => {
  it('scores similar headers', () => {
    expect(similarity('Zip Code', 'zip code')).toBe(1);
    expect(similarity('Postal Cd', 'Postal Code')).toBeGreaterThan(0.7);
  });

  it('maps every column of the loose CSV and implies EIN defaults', () => {
    const t = ingest([{ name: 'sample-loose.csv', bytes: csvBytes }]).tables[0];
    const g = guessMapping(t);
    const by = Object.fromEntries(g.columns.map((c) => [c.header, c.target]));
    expect(by).toMatchObject({
      Vendor: 'supplier.supplierName',
      'Vendor Type': 'supplier.category',
      'Pay Method 1': 'payment.paymentTypesAccepted',
      'Pay Method 3': 'payment.paymentTypesAccepted',
      'Default Pay Method': 'payment.defaultPaymentType',
      Zip: 'addresses.postalCode',
      Email: 'emails.emailAddress',
      EIN: 'taxIds.taxId',
      'Bank Acct #': 'settlementAccounts.accountNumber',
      ABA: 'settlementAccounts.routingNumber',
    });
    expect(g.columns.every((c) => c.target)).toBe(true);
    expect(g.defaults.map((d) => d.target)).toContain('taxIds.taxIdType');
  });

  it('sniffs values when headers say nothing', () => {
    const table = { headers: ['A', 'B'], rows: [{ cells: ['x@y.com', 'Acme'] }, { cells: ['a@b.org', 'Beta'] }] };
    expect(guessMapping(table).columns[0].target).toBe('emails.emailAddress');
  });
});

describe('mapping profiles', () => {
  it('saves, finds by headers (any order), applies, and round-trips as JSON', () => {
    const t = ingest([{ name: 'sample-loose.csv', bytes: csvBytes }]).tables[0];
    const g = guessMapping(t);
    g.columns.find((c) => c.header === 'Phone').target = null;
    const p = makeProfile('Legacy ERP vendor export', t, g);
    const reordered = { ...t, headers: [...t.headers].reverse() };
    expect(findProfile([p], reordered)?.name).toBe('Legacy ERP vendor export');
    expect(findProfile([p], { ...t, headers: t.headers.slice(1) })).toBeNull();
    const applied = applyProfile(p, t, guessMapping(t));
    expect(applied.columns.find((c) => c.header === 'Phone').target).toBeNull();
    expect(importProfiles(exportProfiles([p]))[0].columns).toEqual(p.columns);
    expect(() => importProfiles('{"nope":1}')).toThrow();
  });
});

describe('value mapping', () => {
  const sup = (types, extra = {}) => ({
    supplier: { fields: {} },
    payment: { fields: { paymentTypesAccepted: { value: types }, defaultPaymentType: { value: types[0] }, ...extra } },
    addresses: [], phones: [], emails: [], webAddresses: [], taxIds: [], taxStatuses: [], settlementAccounts: [], alternateNames: [], classifications: [], relatedWorktags: [],
  });

  it('maps each value of a multi-value field, case-insensitively, one-to-many', () => {
    const s = sup(['ach', 'Check', 'Electronic']);
    const rules = [
      normalizeRule({ tab: 'Payment & Procurement', column: 'Payment Types Accepted+', legacyValue: 'ACH', workdayValue: 'EFT' }),
      normalizeRule({ tab: 'Payment & Procurement', column: 'Payment Types Accepted', legacyValue: 'electronic', workdayValue: 'EFT; Wire' }),
    ];
    const res = applyValueMappings([s], rules);
    expect(s.payment.fields.paymentTypesAccepted.value).toEqual(['EFT', 'Check', 'Wire']);
    expect(s.payment.fields.paymentTypesAccepted.mappedFrom).toEqual(['ach', 'Check', 'Electronic']);
    expect(s.payment.fields.defaultPaymentType.value).toBe('ach');
    expect(res.applied).toBe(1);
  });

  it('only matches whole values and respects conditions', () => {
    const s = sup(['ACH Debit']);
    s.supplier.fields.category = { value: 'Utilities' };
    applyValueMappings([s], [normalizeRule({ column: 'Payment Types Accepted', legacyValue: 'ACH', workdayValue: 'EFT' })]);
    expect(s.payment.fields.paymentTypesAccepted.value).toEqual(['ACH Debit']);
    const t = sup(['Check']);
    t.supplier.fields.category = { value: 'Utilities' };
    applyValueMappings([t], [normalizeRule({ column: 'Default Payment Type', conditionColumn: 'Supplier Category', conditionValue: 'utilities', legacyValue: 'check', workdayValue: 'EFT' })]);
    expect(t.payment.fields.defaultPaymentType.value).toBe('EFT');
  });

  it('reports rules that point at nothing', () => {
    const res = applyValueMappings([sup(['Check'])], [normalizeRule({ column: 'Nope', legacyValue: 'a', workdayValue: 'b' })]);
    expect(res.invalid).toHaveLength(1);
  });
});

describe('Milestone 3 acceptance: the loose CSV maps into the same 5 suppliers', () => {
  const key = (s) => ({
    name: v(s.supplier.fields.supplierName),
    category: v(s.supplier.fields.category),
    currency: v(s.supplier.fields.defaultCurrency),
    terms: v(s.payment.fields.paymentTerms),
    accepted: [...(v(s.payment.fields.paymentTypesAccepted) ?? [])].sort(),
    def: v(s.payment.fields.defaultPaymentType),
    addresses: s.addresses.map((a) => [v(a.fields.addressLine1), v(a.fields.city), v(a.fields.postalCode)]),
    emails: s.emails.map((e) => v(e.fields.emailAddress)),
    taxIds: s.taxIds.map((t) => v(t.fields.taxId)),
    accounts: s.settlementAccounts.map((a) => [v(a.fields.accountNumber), v(a.fields.routingNumber), v(a.fields.bankName)]),
  });

  it('matches the workbook on every core field', () => {
    const wb = deriveBatch({ ingestResult: ingest([{ name: 'wb.xlsx', bytes: wbBytes }]), workspace: { valueMappings: [] } });
    const csvIngest = ingest([{ name: 'sample-loose.csv', bytes: csvBytes }]);
    const t = csvIngest.tables[0];
    const g = guessMapping(t);
    const loose = deriveBatch({
      ingestResult: csvIngest,
      mappings: { [t.id]: { ...g, confirmed: true } },
      workspace: { valueMappings: [{ tab: 'Payment & Procurement', column: 'Payment Types Accepted', legacyValue: 'ACH', workdayValue: 'EFT' }] },
    });
    const wbBatch = deriveBatch({
      ingestResult: ingest([{ name: 'wb.xlsx', bytes: wbBytes }]),
      workspace: { valueMappings: [] },
    });
    expect(loose.suppliers.map((s) => s.tempId)).toEqual(['TMP-0001', 'TMP-0002', 'TMP-0003', 'TMP-0004', 'TMP-0005']);
    for (let i = 0; i < 5; i++) {
      const a = key(wbBatch.suppliers[i]);
      const b = key(loose.suppliers[i]);
      // The messy supplier's second CSV row conflicts on category; the first value is kept.
      expect(b).toEqual(a);
    }
    expect(wb.suppliers).toHaveLength(5);
    const phone = loose.suppliers[1].phones[0].fields;
    expect([v(phone.areaCode), v(phone.phoneNumber)]).toEqual(['214', '5550142']);
    expect(v(loose.suppliers[1].taxIds[0].fields.taxIdType)).toBe('Employer ID Number');
  });
});
