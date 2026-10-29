import { describe, it, expect } from 'vitest';
import lists from '../src/data/lists.json';
import addressRules from '../src/data/address-rules.json';
import bankRules from '../src/data/bank-rules.json';

describe('bundled reference data', () => {
  it('has the standard lists', () => {
    for (const k of ['Country', 'Currency', 'Region', 'Tax ID Country', 'Alternate Name Usage', 'Phone Device Type', 'Use For']) {
      expect(lists[k]?.length, k).toBeGreaterThan(0);
    }
    const us = lists.Country.find((c) => c['ISO 2'] === 'US');
    expect(us).toMatchObject({ 'ISO 3': 'USA', 'Phone Code': '1' });
    expect(lists.Currency).toContain('INR');
  });

  it('has address rules per country', () => {
    expect(addressRules.fields).toContain('Postal Code');
    expect(addressRules.countries['United States of America']['Address Line 1']).toBe('Required');
  });

  it('has bank rules with usable regexes', () => {
    const fmtFields = bankRules.fields.filter((f) => /Format Validator$/.test(f));
    let n = 0;
    for (const rec of Object.values(bankRules.countries)) {
      for (const f of fmtFields) {
        const v = rec[f];
        if (v && !/^(Required|Optional|Do Not Show)$/.test(v)) {
          expect(() => new RegExp(`^(?:${v})$`), `${f}: ${v}`).not.toThrow();
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(100);
  });
});
