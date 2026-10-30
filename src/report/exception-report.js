// Client-facing exception report (xlsx, Commit-branded).
//   Summary: counts by status, top issues, and what isn't in the EIB.
//   Issues:  one row per issue, in plain language.

import ExcelJS from 'exceljs';
import { displayName } from '../model/supplier.js';
import { summarize } from '../validation/engine.js';
import { today } from '../eib/export.js';

const NAVY = 'FF29357F';
const CYAN = 'FF0099E6';
const GRAY = 'FF595959';
const LIGHT = 'FFE8F4FB';
const ERR = { font: 'FF9B1C1C', fill: 'FFFDE2E1' };
const WARN = { font: 'FF92400E', fill: 'FFFEF3C7' };
const FONT = 'Aptos';

// The report goes to clients, so tool-internal wording is swapped for plain
// language, and assumed-ID warnings (a Commit-side check) are left out.
const INTERNAL_RULES = new Set(['REF-assumed']);
const CLIENT_TEXT = {
  'REF-unresolved': (i) => ({
    message: `${i.fieldLabel} "${i.value}" doesn\u2019t match a value set up in Workday.`,
    fix: `Confirm the correct ${i.fieldLabel}, or tell us which existing Workday value to use.`,
  }),
  'INGEST-notes:conflicting-values': (i) => ({ message: i.message, fix: 'Tell us which value is correct.' }),
};
const clientText = (i) => (CLIENT_TEXT[i.ruleId] ? CLIENT_TEXT[i.ruleId](i) : { message: i.message, fix: i.fix });

const SENSITIVE = new Set(['Bank Account Number', 'IBAN', 'Tax ID']);
const maskValue = (label, v) => (SENSITIVE.has(label) && v ? `••••${String(v).replace(/[^A-Za-z0-9]/g, '').slice(-4)}` : v);

/**
 * @param {{ suppliers, workspace, includeWarnings?: boolean, skipped?: Array, logoDataUrl?: string, date?: string }} opts
 */
export async function buildExceptionReport({ suppliers, workspace, includeWarnings = true, skipped = [], logoDataUrl, date = today() }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Commit Supplier EIB Builder';
  wb.created = new Date(`${date}T12:00:00Z`);

  // Status as the client sees it: assumed-ID warnings don't count against a supplier.
  const clientView = suppliers.map((s) => {
    const issues = (s.issues ?? []).filter((i) => !INTERNAL_RULES.has(i.ruleId));
    const errorCount = issues.filter((i) => i.severity === 'error').length;
    const warningCount = issues.length - errorCount;
    return { ...s, issues, errorCount, warningCount, status: errorCount ? 'blocked' : warningCount ? 'warnings' : 'clean' };
  });
  suppliers = clientView;
  const summary = summarize(suppliers);
  const client = workspace?.name ?? 'Client';
  const issues = [];
  for (const s of suppliers) {
    for (const i of s.issues ?? []) {
      if (!includeWarnings && i.severity !== 'error') continue;
      if (INTERNAL_RULES.has(i.ruleId)) continue;
      issues.push({ s, i });
    }
  }

  // ------------------------------------------------------------- Summary
  const sum = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
  sum.columns = [{ width: 4 }, { width: 34 }, { width: 16 }, { width: 70 }];
  let logoRows = 0;
  if (logoDataUrl) {
    const imageId = wb.addImage({ base64: logoDataUrl, extension: 'png' });
    sum.addImage(imageId, { tl: { col: 1, row: 0.3 }, ext: { width: 180, height: 54 } });
    logoRows = 4;
  }
  sum.getRow(logoRows + 1).values = [null, 'Supplier Data Exception Report'];
  style(sum.getCell(logoRows + 1, 2), { size: 18, bold: true, color: NAVY });
  sum.getRow(logoRows + 2).values = [null, `${client} · Prepared ${date}`];
  style(sum.getCell(logoRows + 2, 2), { size: 11, color: GRAY });

  let r = logoRows + 4;
  r = heading(sum, r, 'Where things stand');
  const statusRows = [
    ['Suppliers reviewed', suppliers.length, ''],
    ['Ready to load', summary.counts.clean, 'No issues.'],
    ['Ready, with items to review', summary.counts.warnings, 'Can load, but please look over the warnings.'],
    ['Need changes before loading', summary.counts.blocked, 'Have at least one error.'],
    ['Left out of this load', suppliers.filter((s) => s.excluded).length, 'Excluded on purpose. Listed below.'],
  ];
  for (const [label, n, note] of statusRows) {
    sum.getRow(r).values = [null, label, n, note];
    style(sum.getCell(r, 2), { color: NAVY });
    style(sum.getCell(r, 3), { bold: true, color: NAVY });
    style(sum.getCell(r, 4), { color: GRAY });
    r++;
  }

  r = heading(sum, r + 1, 'Most common issues');
  sum.getRow(r).values = [null, 'Issue', 'Suppliers', 'Example'];
  headerRow(sum.getRow(r), 2, 4);
  r++;
  for (const g of summary.top.filter((t) => includeWarnings || t.severity === 'error')) {
    sum.getRow(r).values = [null, `${g.severity === 'error' ? 'Error' : 'Warning'}: ${g.fieldLabel || g.sectionLabel}`, g.suppliers.size, CLIENT_TEXT[g.ruleId] ? clientText({ ruleId: g.ruleId, fieldLabel: g.fieldLabel, value: [...g.values.keys()][0], message: g.example }).message : g.example];
    tone(sum.getCell(r, 2), g.severity);
    style(sum.getCell(r, 4), { color: GRAY, wrap: true });
    r++;
  }

  const notLoaded = [
    ...suppliers.filter((s) => s.excluded).map((s) => [displayName(s), s.tempId, 'Left out of this load']),
    ...skipped.map((x) => [x.name, x.tempId, x.message]),
  ];
  if (notLoaded.length) {
    r = heading(sum, r + 1, 'Not in this load');
    sum.getRow(r).values = [null, 'Supplier', 'Temp ID', 'Reason'];
    headerRow(sum.getRow(r), 2, 4);
    r++;
    for (const [name, id, why] of notLoaded) {
      sum.getRow(r).values = [null, name, id, why];
      style(sum.getCell(r, 4), { color: GRAY, wrap: true });
      r++;
    }
  }
  sum.getRow(r + 1).values = [null, 'Temp ID is a tracking number for this review only. It is not a Workday Supplier ID.'];
  style(sum.getCell(r + 1, 2), { italic: true, size: 9, color: GRAY });

  // -------------------------------------------------------------- Issues
  const sh = wb.addWorksheet('Issues', { views: [{ state: 'frozen', ySplit: 1 }] });
  sh.columns = [
    { header: 'Temp ID', key: 'ref', width: 12 },
    { header: 'Supplier Name', key: 'name', width: 34 },
    { header: 'Section', key: 'section', width: 22 },
    { header: 'Field', key: 'field', width: 26 },
    { header: 'Current Value', key: 'value', width: 30 },
    { header: 'Severity', key: 'severity', width: 11 },
    { header: 'Message', key: 'message', width: 60 },
    { header: 'Suggested Fix', key: 'fix', width: 50 },
  ];
  headerRow(sh.getRow(1), 1, 8);
  issues.sort((a, b) => a.s.tempId.localeCompare(b.s.tempId) || (a.i.severity === b.i.severity ? 0 : a.i.severity === 'error' ? -1 : 1));
  for (const { s, i } of issues) {
    const row = sh.addRow({
      ref: s.tempId,
      name: displayName(s),
      section: i.recordLabel,
      field: i.fieldLabel,
      value: maskValue(i.fieldLabel, i.value),
      severity: i.severity === 'error' ? 'Error' : 'Warning',
      ...clientText(i),
    });
    row.eachCell((c) => style(c, { wrap: true, color: NAVY, valign: 'top' }));
    tone(row.getCell('severity'), i.severity);
  }
  sh.autoFilter = { from: 'A1', to: `H${Math.max(1, issues.length + 1)}` };
  if (!issues.length) sh.addRow({ name: 'No issues found.' });

  const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
  const safe = String(client).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Client';
  return { bytes, fileName: `Supplier_Exception_Report_${safe}_${date}.xlsx`, issueCount: issues.length };
}

function style(cell, { size = 11, bold = false, italic = false, color = NAVY, wrap = false, valign } = {}) {
  cell.font = { name: FONT, size, bold, italic, color: { argb: color } };
  if (wrap || valign) cell.alignment = { wrapText: wrap, vertical: valign ?? 'middle' };
}

function heading(ws, r, text) {
  ws.getRow(r).values = [null, text];
  style(ws.getCell(r, 2), { size: 13, bold: true, color: CYAN });
  return r + 1;
}

function headerRow(row, from, to) {
  for (let c = from; c <= to; c++) {
    const cell = row.getCell(c);
    cell.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle' };
  }
}

function tone(cell, severity) {
  const t = severity === 'error' ? ERR : WARN;
  cell.font = { name: FONT, bold: true, color: { argb: t.font } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: t.fill } };
}

export { LIGHT };
