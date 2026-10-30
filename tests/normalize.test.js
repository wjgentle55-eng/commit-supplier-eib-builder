import { describe, it, expect } from 'vitest';
import { headerKey, nameKey, splitMulti, normBool, normDate, numberToText, normalizeForColumn } from '../src/model/normalize.js';

describe('normalize', () => {
  it('matches headers tolerantly', () => {
    expect(headerKey('  Payment Types Accepted+ ')).toBe('payment types accepted');
    expect(headerKey('Primary?')).toBe('primary');
    expect(headerKey('Supplier   NAME')).toBe('supplier name');
  });
  it('joins supplier names case and space insensitively', () => {
    expect(nameKey(' Acme  Inc ')).toBe(nameKey('acme inc'));
  });
  it('splits multi-value cells on semicolons, commas, and line breaks', () => {
    expect(splitMulti('Check; EFT, Wire\nCheck')).toEqual(['Check', 'EFT', 'Wire']);
    expect(splitMulti('')).toEqual([]);
  });
  it('keeps company names with a comma before a legal suffix whole', () => {
    expect(splitMulti('601 RAVN Group, Inc')).toEqual(['601 RAVN Group, Inc']);
    expect(splitMulti('Acme, LLC; Beta Corp, Ltd., Gamma')).toEqual(['Acme, LLC', 'Beta Corp, Ltd.', 'Gamma']);
    expect(splitMulti('Bank of America, N.A., Chase')).toEqual(['Bank of America, N.A.', 'Chase']);
  });
  it('only splits multi columns, so commas in names and addresses survive', () => {
    expect(normalizeForColumn({ type: 'text', multi: false }, 'Scf 41, Market -ii')).toBe('Scf 41, Market -ii');
    expect(normalizeForColumn({ type: 'text', multi: true }, 'a, b')).toEqual(['a', 'b']);
  });
  it('normalizes booleans and keeps unknown text for validation', () => {
    expect(['Y', 'yes', 'TRUE', '1'].map(normBool)).toEqual(['Yes', 'Yes', 'Yes', 'Yes']);
    expect(['N', 'no', 'false', '0'].map(normBool)).toEqual(['No', 'No', 'No', 'No']);
    expect(normBool('maybe')).toBe('maybe');
  });
  it('normalizes dates to YYYY-MM-DD', () => {
    expect(normDate('2023-01-01')).toBe('2023-01-01');
    expect(normDate('1/2/2023')).toBe('2023-01-02');
    expect(normDate('45000')).toBe('2023-03-15');
    expect(normDate('2023-02-30')).toBe('2023-02-30');
    expect(normDate('next week')).toBe('next week');
  });
  it('writes numbers without exponents or float noise', () => {
    expect(numberToText(123456789012345)).toBe('123456789012345');
    expect(numberToText(0.1 + 0.2)).toBe('0.3');
  });
});
