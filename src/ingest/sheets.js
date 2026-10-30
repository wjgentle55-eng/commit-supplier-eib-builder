// Reads any supported input (xlsx, xlsm, xls, csv, pasted text) into plain
// grids of strings. Everything downstream works on these grids, so file
// format quirks stay in this one module.

import * as XLSX from 'xlsx';
import { excelSerialToIso, numberToText } from '../model/normalize.js';

export const ACCEPTED_EXTENSIONS = ['.xlsx', '.xlsm', '.xls', '.csv', '.txt', '.tsv'];

/**
 * @returns {{ name: string, sheets: Array<{ name: string, rows: string[][] }> }}
 *   rows[0] is spreadsheet row 1. Cells are strings ('' when empty).
 */
export function readWorkbook(bytes, fileName = 'file') {
  const ext = (/\.[^.]+$/.exec(fileName)?.[0] ?? '').toLowerCase();
  if (ext === '.csv' || ext === '.txt' || ext === '.tsv') {
    const text = new TextDecoder('utf-8').decode(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
    return readText(text, fileName);
  }
  const wb = XLSX.read(bytes, { type: 'array', cellDates: false, cellNF: true, cellText: true, dense: false });
  return {
    name: fileName,
    sheets: wb.SheetNames.map((name) => ({ name, rows: sheetToGrid(wb.Sheets[name]) })),
  };
}

/** Parses pasted or plain-text tables. Tab-delimited when tabs are present, CSV otherwise. */
export function readText(text, name = 'Pasted text') {
  const clean = text.replace(/^\uFEFF/, '');
  const firstLines = clean.split(/\r?\n/).slice(0, 5).join('\n');
  const FS = firstLines.includes('\t') ? '\t' : firstLines.split(';').length > firstLines.split(',').length ? ';' : ',';
  // raw: true keeps every value as text, so leading zeros and long numbers survive.
  const wb = XLSX.read(clean, { type: 'string', raw: true, FS, cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return { name, sheets: [{ name: FS === '\t' ? 'Pasted table' : 'CSV', rows: sheetToGrid(sheet) }] };
}

function sheetToGrid(sheet) {
  if (!sheet || !sheet['!ref']) return [];
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const rows = [];
  for (let r = 0; r <= range.e.r; r++) {
    const row = [];
    for (let c = 0; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      row.push(cell ? cellText(cell) : '');
    }
    // Trim trailing empties to keep grids small.
    while (row.length && row[row.length - 1] === '') row.pop();
    rows.push(row);
  }
  return rows;
}

function cellText(cell) {
  switch (cell.t) {
    case 's':
    case 'str':
      return String(cell.v ?? '');
    case 'b':
      return cell.v ? 'Yes' : 'No';
    case 'd':
      return cell.v instanceof Date ? cell.v.toISOString().slice(0, 10) : String(cell.v ?? '');
    case 'n': {
      const fmt = cell.z ? String(cell.z) : '';
      if (fmt && XLSX.SSF.is_date(fmt)) return excelSerialToIso(cell.v) ?? String(cell.v);
      // A format like 000000000 or "00000" pads with leading zeros: trust the formatted text.
      if (/^0{2,}$/.test(fmt) && cell.w) return cell.w;
      return numberToText(cell.v);
    }
    case 'e':
      return '';
    default:
      return cell.w ?? String(cell.v ?? '');
  }
}
