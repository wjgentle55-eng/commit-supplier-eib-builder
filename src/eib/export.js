// EIB export: included, error-free suppliers -> populated Submit Supplier v44.1 file.

import { writeEib, colLetter } from './template.js';
import { buildEibRows } from './stacker.js';
import { COL } from './column-map.js';
import { settingsOf } from '../model/workspace.js';
import { fold } from '../reference/baseline.js';

// Worktag type -> reference ID type for Default/Allowed Worktag (D-017).
export const WORKTAG_ID_TYPES = [
  ['cost center', 'Cost_Center_Reference_ID'],
  ['region', 'Region_Reference_ID'],
  ['location', 'Location_ID'],
  ['project', 'Project_ID'],
  ['fund', 'Fund_ID'],
  ['grant', 'Grant_ID'],
  ['program', 'Program_ID'],
  ['gift', 'Gift_Reference_ID'],
  ['business unit', 'Business_Unit_ID'],
  ['spend category', 'Spend_Category_ID'],
  ['revenue category', 'Revenue_Category_ID'],
  ['employee', 'Employee_ID'],
  ['custom organization', 'Organization_Reference_ID'],
];

export const worktagIdTypeFor = (worktagType) => WORKTAG_ID_TYPES.find(([k]) => fold(worktagType).includes(k))?.[1] ?? null;

export function exportFileName(clientName, date) {
  const client = String(clientName || 'Client').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Client';
  return `Submit_Supplier_${client}_${date}.xlsx`;
}

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** What will (and won't) be exported, without writing anything. */
export function exportPlan(suppliers) {
  const included = suppliers.filter((s) => !s.excluded);
  const blocked = included.filter((s) => s.errorCount > 0);
  return { included, excluded: suppliers.filter((s) => s.excluded), blocked, canExport: included.length > 0 && blocked.length === 0 };
}

/**
 * @returns {Promise<{ bytes, fileName, keys, skipped, worktagIdType }>}
 */
export async function exportEib({ suppliers, workspace, templateBytes, date = today() }) {
  const plan = exportPlan(suppliers);
  if (!plan.included.length) throw new Error('No suppliers are included in the export.');
  if (plan.blocked.length) throw new Error(`${plan.blocked.length} included supplier(s) still have errors. Fix or exclude them first.`);

  const settings = settingsOf(workspace);
  const firstType = plan.included.flatMap((s) => s.relatedWorktags.map((w) => w.fields.worktagType?.value)).find(Boolean);
  const idType = settings.worktagIdType || (firstType ? worktagIdTypeFor(firstType) : null);
  const worktag = idType ? { idType, typeFilter: (t) => worktagIdTypeFor(t) === idType } : null;

  const { rows, keys, skipped } = buildEibRows(plan.included, { settings, date, worktag });
  const headerOverrides = {};
  if (idType && rows.some((r) => r[COL.worktag.defaultWorktag] || r[COL.worktag.allowed])) {
    headerOverrides[`${colLetter(COL.worktag.defaultWorktag)}4`] = idType;
    headerOverrides[`${colLetter(COL.worktag.allowed)}4`] = idType;
  }
  const bytes = await writeEib(templateBytes, rows, { headerOverrides });
  return { bytes, fileName: exportFileName(workspace?.name, date), keys, skipped, worktagIdType: idType, rowCount: rows.length };
}
