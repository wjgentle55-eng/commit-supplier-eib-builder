import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { writeEib, loadTemplate, HEADER_ROWS } from '../src/eib/template.js';
import { EIB_TEMPLATE_BASE64 } from '../src/data/eib-template.js';
import { base64ToBytes } from '../src/eib/template.js';

const TEMPLATE = readFileSync(new URL('../reference/Submit_Supplier_Blank.xlsx', import.meta.url));
const SHEET = 'xl/worksheets/sheet1.xml';

async function files(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const out = {};
  for (const name of Object.keys(zip.files).sort()) {
    if (!zip.files[name].dir) out[name] = await zip.file(name).async('uint8array');
  }
  return out;
}
const text = (u8) => new TextDecoder().decode(u8);
const headerRowsXml = (xml) =>
  [...xml.matchAll(/<row r="(\d+)"[\s\S]*?(?:<\/row>|\/>)(?=<row|<\/sheetData>)/g)]
    .filter((m) => Number(m[1]) <= HEADER_ROWS)
    .map((m) => m[0])
    .join('');
const section = (xml, tag) => {
  const m = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`).exec(xml);
  return m ? m[0] : null;
};

describe('EIB template round trip', () => {
  let original;
  beforeAll(async () => {
    original = await files(TEMPLATE);
  });

  it('bundled base64 template matches /reference', () => {
    expect(Buffer.from(base64ToBytes(EIB_TEMPLATE_BASE64)).equals(TEMPLATE)).toBe(true);
  });

  for (const [label, rows] of [
    ['with no data rows', []],
    ['with data rows written', [{ 2: '1', 11: 'Acme & Sons <Test>', 5: 'Y' }, { 2: '1', 26: '001234567' }, new Map([[2, '2'], [73, 1250.5]])]],
  ]) {
    describe(label, () => {
      let written;
      beforeAll(async () => {
        written = await files(await writeEib(TEMPLATE, rows));
      });

      it('keeps every package part other than the sheet byte-identical', () => {
        expect(Object.keys(written)).toEqual(Object.keys(original));
        for (const name of Object.keys(original)) {
          if (name === SHEET) continue;
          expect(Buffer.from(written[name]).equals(Buffer.from(original[name])), name).toBe(true);
        }
      });

      it('keeps header rows 1 to 5 unchanged', () => {
        expect(headerRowsXml(text(written[SHEET]))).toBe(headerRowsXml(text(original[SHEET])));
      });

      it('keeps data validations, merged cells, columns, and comments link unchanged', () => {
        const a = text(original[SHEET]);
        const b = text(written[SHEET]);
        for (const tag of ['dataValidations', 'mergeCells', 'cols', 'sheetViews']) {
          expect(section(b, tag), tag).toBe(section(a, tag));
        }
        expect(section(a, 'dataValidations')).toContain('count="56"');
        expect(b.slice(b.indexOf('</sheetData>'))).toBe(a.slice(a.indexOf('</sheetData>')));
      });
    });
  }

  it('writes data from row 6 with text kept as text', async () => {
    const out = await writeEib(TEMPLATE, [{ 2: '1', 26: '001234567', 11: 'Acme & Sons' }, { 2: '1' }]);
    const xml = text((await files(out))[SHEET]);
    expect(xml).toContain('<row r="6">');
    expect(xml).toContain('<row r="7">');
    expect(xml).not.toContain('<row r="8"');
    expect(xml).toContain('<t>001234567</t>');
    expect(xml).toContain('<t>Acme &amp; Sons</t>');
    expect(xml).toContain('<dimension ref="A1:OU7"/>');
  });

  it('reads the written file back with the same headers', async () => {
    const a = await loadTemplate(TEMPLATE);
    const b = await loadTemplate(await writeEib(TEMPLATE, [{ 2: '1' }]));
    expect(b.columns).toEqual(a.columns);
  });
});
