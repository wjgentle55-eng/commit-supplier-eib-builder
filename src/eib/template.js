// Reads and writes the Workday Submit Supplier v44.1 EIB template.
//
// Writing works by injecting <row> elements into the template's sheet XML and
// leaving every other part of the package byte-for-byte untouched. That keeps
// header rows 1 to 5, styles, header comments, merged cells, and all 56 data
// validations exactly as Workday generated them. See DECISIONS.md (D-004) for
// why this replaced a full ExcelJS round-trip.

import JSZip from 'jszip';

export const HEADER_ROWS = 5;
export const FIRST_DATA_ROW = 6;
const SHEET_PATH = 'xl/worksheets/sheet1.xml';
const SST_PATH = 'xl/sharedStrings.xml';

// ------------------------------------------------------------ helpers

export function colLetter(n) {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function colNumber(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXml(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e];
  });
}

export function encodeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Strip control characters Excel rejects (keep tab, LF, CR).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const parts = [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1]));
    out.push(parts.join(''));
  }
  return out;
}

function parseCellValue(cellXml, sst) {
  const type = /\st="([^"]+)"/.exec(cellXml)?.[1];
  if (type === 'inlineStr') {
    return [...cellXml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1])).join('');
  }
  const v = /<v>([\s\S]*?)<\/v>/.exec(cellXml)?.[1];
  if (v === undefined) return '';
  if (type === 's') return sst[Number(v)] ?? '';
  return decodeXml(v);
}

/** Parses the <cols> element into a per-column default style lookup. */
function parseColStyles(sheetXml) {
  const styles = new Map();
  const cols = /<cols>([\s\S]*?)<\/cols>/.exec(sheetXml)?.[1] ?? '';
  for (const m of cols.matchAll(/<col\s([^>]*)\/>/g)) {
    const a = m[1];
    const min = Number(/min="(\d+)"/.exec(a)?.[1]);
    const max = Number(/max="(\d+)"/.exec(a)?.[1]);
    const style = /style="(\d+)"/.exec(a)?.[1];
    if (style !== undefined) for (let c = min; c <= max; c++) styles.set(c, style);
  }
  return styles;
}

// ------------------------------------------------------------- reading

/**
 * Loads the template package and describes its columns.
 * Each column is identified by Area (row 2, carried forward across blanks),
 * Field (row 5), and its occurrence number for that Area + Field pair.
 */
export async function loadTemplate(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const sheetXml = await zip.file(SHEET_PATH).async('string');
  const sstXml = zip.file(SST_PATH) ? await zip.file(SST_PATH).async('string') : '';
  const sst = parseSharedStrings(sstXml);

  const headerCells = {}; // { [row]: { [col]: value } }
  for (let r = 1; r <= HEADER_ROWS; r++) {
    headerCells[r] = {};
    const row = new RegExp(`<row r="${r}"[^>]*>([\\s\\S]*?)</row>`).exec(sheetXml)?.[1] ?? '';
    for (const m of row.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const value = parseCellValue(`<c${m[2]}>${m[3] ?? ''}</c>`, sst);
      if (value !== '') headerCells[r][colNumber(m[1])] = value;
    }
  }

  const dim = /<dimension ref="[A-Z]+\d+:([A-Z]+)\d+"/.exec(sheetXml)?.[1];
  const lastCol = Math.max(
    dim ? colNumber(dim) : 0,
    ...Object.keys(headerCells[5]).map(Number),
  );

  const columns = [];
  const seen = new Map();
  let area = '';
  for (let c = 1; c <= lastCol; c++) {
    if (headerCells[2][c]) area = headerCells[2][c];
    const field = headerCells[5][c] ?? '';
    const pair = `${area}\u0000${field}`;
    const occurrence = (seen.get(pair) ?? 0) + 1;
    seen.set(pair, occurrence);
    columns.push({
      index: c,
      letter: colLetter(c),
      area,
      field,
      occurrence,
      restriction: headerCells[3][c] ?? '',
      format: headerCells[4][c] ?? '',
      key: columnKey(area, field, occurrence),
    });
  }

  return {
    zip,
    sheetXml,
    title: headerCells[1][1] ?? '',
    sheetName: await readFirstSheetName(zip),
    columns,
    colStyles: parseColStyles(sheetXml),
  };
}

export function columnKey(area, field, occurrence = 1) {
  return `${area} :: ${field}${occurrence > 1 ? ` #${occurrence}` : ''}`;
}

async function readFirstSheetName(zip) {
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  return decodeXml(/<sheet\s[^>]*name="([^"]+)"/.exec(wbXml)?.[1] ?? '');
}

// ------------------------------------------------------------- writing

/**
 * Builds a populated EIB.
 * @param {Uint8Array|ArrayBuffer} templateBytes the blank template
 * @param {Array<Map<number, string|number>|Record<number,string|number>>} rows
 *        data rows in order, starting at row 6; each maps column number to value
 * @returns {Promise<Uint8Array>}
 */
export async function writeEib(templateBytes, rows, { headerOverrides = {} } = {}) {
  const tpl = await loadTemplate(templateBytes);
  const { zip, sheetXml, colStyles } = tpl;

  const start = sheetXml.indexOf('<sheetData>');
  const end = sheetXml.indexOf('</sheetData>');
  if (start < 0 || end < 0) throw new Error('Template sheet has no <sheetData> element');
  const body = sheetXml.slice(start + '<sheetData>'.length, end);

  // Keep header rows 1 to 5 exactly as written by Workday. Template rows 6 and
  // later are empty placeholders and get replaced by the data rows.
  const headerXml = [];
  for (const m of body.matchAll(/<row r="(\d+)"[\s\S]*?(?:<\/row>|\/>)(?=<row|$)/g)) {
    if (Number(m[1]) <= HEADER_ROWS) headerXml.push(applyHeaderOverrides(m[0], headerOverrides));
  }

  const lastCol = tpl.columns.length;
  const dataXml = rows.map((row, i) => rowXml(FIRST_DATA_ROW + i, row, colStyles, lastCol)).join('');

  let newSheet = sheetXml.slice(0, start) + '<sheetData>' + headerXml.join('') + dataXml + sheetXml.slice(end);
  const lastRow = Math.max(HEADER_ROWS, FIRST_DATA_ROW + rows.length - 1);
  newSheet = newSheet.replace(/<dimension ref="[^"]+"\/>/, `<dimension ref="A1:${colLetter(lastCol)}${lastRow}"/>`);

  zip.file(SHEET_PATH, newSheet);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/**
 * Header cells are left exactly as Workday wrote them, except row-4 reference
 * ID type cells the user picks on purpose (e.g. the Related Worktags ID type,
 * DECISIONS D-017). Only the cell's value changes; its style stays.
 */
function applyHeaderOverrides(rowXmlText, overrides) {
  let out = rowXmlText;
  for (const [ref, value] of Object.entries(overrides)) {
    const re = new RegExp(`<c r="${ref}"((?: s="\\d+")?)(?: t="[^"]*")?(?:/>|>[\\s\\S]*?</c>)`);
    out = out.replace(re, (_, style) => `<c r="${ref}"${style} t="inlineStr"><is><t>${encodeXml(value)}</t></is></c>`);
  }
  return out;
}

function rowXml(r, row, colStyles, lastCol) {
  const entries = (row instanceof Map ? [...row.entries()] : Object.entries(row))
    .map(([c, v]) => [Number(c), v])
    .filter(([c, v]) => c >= 1 && c <= lastCol && v !== undefined && v !== null && v !== '')
    .sort((a, b) => a[0] - b[0]);
  const cells = entries.map(([c, v]) => {
    const ref = `${colLetter(c)}${r}`;
    const s = colStyles.has(c) ? ` s="${colStyles.get(c)}"` : '';
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
    const text = encodeXml(v);
    const space = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
    return `<c r="${ref}"${s} t="inlineStr"><is><t${space}>${text}</t></is></c>`;
  });
  return `<row r="${r}">${cells.join('')}</row>`;
}

/** Decodes a base64 string to bytes in both the browser and Node. */
export function base64ToBytes(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
