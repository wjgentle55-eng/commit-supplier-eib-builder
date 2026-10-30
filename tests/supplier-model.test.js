import { describe, it, expect } from 'vitest';
import { newSupplier, mergeField, linkBanking, noteConflicts } from '../src/model/supplier.js';

const rec = (fields) => ({ fields: Object.fromEntries(Object.entries(fields).map(([k, value]) => [k, { value }])) });

describe('supplier model', () => {
  it('unions multi values and records single-value conflicts', () => {
    const s = newSupplier('Acme');
    mergeField(s.payment.fields, 'paymentTypesAccepted', ['Check'], {}, { multi: true });
    mergeField(s.payment.fields, 'paymentTypesAccepted', ['check', 'EFT'], {}, { multi: true });
    expect(s.payment.fields.paymentTypesAccepted.value).toEqual(['Check', 'EFT']);
    mergeField(s.payment.fields, 'paymentTerms', 'Net 30', {});
    mergeField(s.payment.fields, 'paymentTerms', 'net 30', {});
    mergeField(s.payment.fields, 'paymentTerms', 'Net 45', {});
    expect(s.payment.fields.paymentTerms.conflicts).toHaveLength(1);
    noteConflicts(s);
    expect(s.notes[0]).toMatchObject({ severity: 'warning', code: 'conflicting-values', field: 'paymentTerms' });
  });

  it('flags intermediaries and bank addresses that point to unknown labels', () => {
    const s = newSupplier('Acme');
    s.settlementAccounts.push(rec({ accountLabel: 'ACCT1' }));
    linkBanking(
      s,
      [rec({ accountLabel: 'ACCT1', intermediaryLabel: 'I1', order: '1' }), rec({ accountLabel: 'NOPE', intermediaryLabel: 'I2' })],
      [rec({ accountLabel: 'acct1' }), rec({ accountLabel: 'ACCT1', intermediaryLabel: 'I9' })],
    );
    expect(s.settlementAccounts[0].intermediaries).toHaveLength(1);
    expect(s.settlementAccounts[0].bankAddresses).toHaveLength(1);
    expect(s.unlinked.intermediaryBanks).toHaveLength(1);
    expect(s.unlinked.bankAddresses).toHaveLength(1);
    expect(s.notes.filter((n) => n.code === 'unknown-account-label')).toHaveLength(2);
  });
});
