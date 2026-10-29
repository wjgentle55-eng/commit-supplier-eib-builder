import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadTemplate } from '../src/eib/template.js';
import snapshot from '../src/eib/template-columns.json';

// Fails if the blank template's header rows change. If Workday ships a new
// version on purpose, run `node scripts/generate-column-map.mjs`, then review
// src/eib/column-map.js by hand before committing.
describe('EIB template headers', () => {
  it('match the reviewed snapshot (Area + Field + occurrence, restriction, format)', async () => {
    const tpl = await loadTemplate(readFileSync(new URL('../reference/Submit_Supplier_Blank.xlsx', import.meta.url)));
    expect(tpl.title).toBe('Submit Supplier - v44.1');
    expect(tpl.columns.length).toBe(411);
    expect(tpl.columns.map(({ index, letter, area, field, occurrence, restriction, format, key }) =>
      ({ index, letter, area, field, occurrence, restriction, format, key }))).toEqual(snapshot.columns);
  });

  it('identifies repeated field names by Area, not by name alone', () => {
    const countries = snapshot.columns.filter((c) => c.field === 'Country' || c.field === 'Country*');
    expect(countries.length).toBeGreaterThan(3);
    expect(new Set(countries.map((c) => c.key)).size).toBe(countries.length);
  });
});
