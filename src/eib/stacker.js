// Row stacker: turns suppliers into EIB data rows (row 6 down).
//
// How rows stack (DECISIONS D-031, confirm with a sandbox load):
//   - Every row of a supplier carries its Spreadsheet Key (1, 2, 3, ...).
//   - Single-value supplier fields go on the supplier's first row.
//   - Each repeating group (tax IDs, addresses, phones, ...) fills its own
//     columns on successive rows, with sequential Row IDs per group.
//   - Groups are independent: row 2 can hold the 2nd address and 2nd email.
//   - A nested group (an address's lines, Use For values, an account's
//     intermediaries) stacks under its parent: the parent's fields sit on the
//     parent's first row, and the parent's Row ID repeats on every row the
//     nested data uses, so Workday knows which parent each row belongs to.
//   - Multi-value "+" columns put one value per row.

import { COL } from './column-map.js';
import { findCountry } from '../reference/baseline.js';
import { isBlank } from '../model/normalize.js';
import { displayName } from '../model/supplier.js';

// ------------------------------------------------------------- primitives

const merge = (...lanes) => {
  const n = Math.max(1, ...lanes.map((l) => l.length));
  return Array.from({ length: n }, (_, i) => Object.assign({}, ...lanes.map((l) => l[i] ?? {})));
};
const concat = (blocks) => blocks.flat();
const lane = (col, list) => list.map((v) => ({ [col]: v }));

/** A group instance: parent fields on row 0, parent Row ID on every row of the block. */
function block(rowIdCol, rowId, parentFields, ...childLanes) {
  const rows = merge([parentFields], ...childLanes);
  for (const r of rows) r[rowIdCol] = rowId;
  return rows;
}

// -------------------------------------------------------------- values

const field = (rec, k) => rec?.fields?.[k];
const raw = (rec, k) => field(rec, k)?.value;
const yn = (rec, k) => {
  const v = raw(rec, k);
  return v === 'Yes' ? 'Y' : v === 'No' ? 'N' : undefined;
};
const text = (rec, k) => (isBlank(raw(rec, k)) ? undefined : String(raw(rec, k)));
const num = (rec, k) => {
  const v = raw(rec, k);
  if (isBlank(v)) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : String(v);
};
/** Resolved reference ID(s): one per value, falling back to the value itself. */
const ids = (rec, k) => {
  const f = field(rec, k);
  if (!f || isBlank(f.value)) return [];
  const vals = Array.isArray(f.value) ? f.value : [f.value];
  return vals.map((v, i) => f.refs?.[i]?.id || v);
};
const id = (rec, k) => ids(rec, k)[0];

const set = (obj, col, v) => {
  if (v !== undefined && v !== null && v !== '') obj[col] = v;
  return obj;
};

// ------------------------------------------------------------ addresses

const LINE_FIELDS = ['addressLine1', 'addressLine2', 'addressLine3', 'addressLine4'];

function addressRows(rec, rowId, C, addressId, { withUsage }) {
  const lines = LINE_FIELDS.map((k, i) => [i + 1, text(rec, k)]).filter(([, v]) => v);
  const lineLane = lines.map(([n, v], i) => ({ [C.lineRowId]: i + 1, [C.lineType]: `ADDRESS_LINE_${n}`, [C.lineData]: v }));
  const subMuni = [['submunicipality', 'CITY_SUBDIVISION_1'], ['citySubdivision', 'CITY_SUBDIVISION_2']]
    .filter(([k]) => text(rec, k))
    .map(([k, type], i) => ({ [C.subMuniRowId]: i + 1, [C.subMuniType]: type, [C.subMuniData]: text(rec, k) }));
  const subRegion = text(rec, 'subregion') ? [{ [C.subRegionRowId]: 1, [C.subRegionType]: 'REGION_SUBDIVISION_1', [C.subRegionData]: text(rec, 'subregion') }] : [];

  let usage = [];
  if (withUsage) {
    const useFor = ids(rec, 'useFor');
    const first = { [C.usageRowId]: 1, [C.typeRowId]: 1, [C.usageType]: 'BUSINESS' };
    set(first, C.public, yn(rec, 'public'));
    set(first, C.primary, yn(rec, 'primary'));
    usage = merge([first], lane(C.useFor, useFor)).map((r) => ({ ...r, [C.usageRowId]: 1 }));
  }

  const parent = {};
  set(parent, C.effectiveDate, text(rec, 'effectiveDate'));
  set(parent, C.country, id(rec, 'country'));
  set(parent, C.municipality, text(rec, 'city'));
  set(parent, C.region, id(rec, 'region'));
  set(parent, C.postalCode, text(rec, 'postalCode'));
  set(parent, C.addressId, addressId);
  return block(C.rowId, rowId, parent, lineLane, subMuni, subRegion, usage);
}

function usageRows(rec, C) {
  const first = { [C.usageRowId]: 1, [C.typeRowId]: 1, [C.usageType]: 'BUSINESS' };
  set(first, C.public, yn(rec, 'public'));
  set(first, C.primary, yn(rec, 'primary'));
  return merge([first], lane(C.useFor, ids(rec, 'useFor'))).map((r) => ({ ...r, [C.usageRowId]: 1 }));
}

// --------------------------------------------------------------- IDs

export function makeId(pattern, { date, key, n, label = '' }) {
  return String(pattern)
    .replace(/\{date\}/g, date.replace(/-/g, ''))
    .replace(/\{key\}/g, String(key).padStart(4, '0'))
    .replace(/\{n\}/g, String(n))
    .replace(/\{label\}/g, String(label).replace(/[^A-Za-z0-9]+/g, '').toUpperCase());
}

// ------------------------------------------------------------ supplier

/**
 * @param {object} s       validated supplier
 * @param {number} key     Spreadsheet Key
 * @param {object} opts    { settings, date, worktag: { idType, typeFilter } }
 * @returns {{ rows: object[], skipped: string[] }}
 */
export function supplierRows(s, key, { settings, date, worktag }) {
  const skipped = [];
  const S = COL.supplier;
  const P = COL.payment;
  const sup = s.supplier;
  const pay = s.payment;

  // Single-value fields on the first row.
  const first = { [COL.autoComplete]: 'Y', [S.approvalStatus]: settings.approvalStatusId || 'APPROVED' };
  set(first, S.supplierId, text(sup, 'supplierId'));
  set(first, S.supplierName, text(sup, 'supplierName'));
  set(first, S.businessEntityName, text(sup, 'businessEntityName') ?? text(sup, 'supplierName'));
  set(first, S.externalEntityId, text(sup, 'externalEntityId'));
  set(first, S.worktagOnly, yn(sup, 'worktagOnly'));
  set(first, S.taxAuthorityFormType, id(sup, 'taxAuthorityFormType'));
  set(first, S.irs1099, yn(sup, 'irs1099'));
  set(first, S.report1099WithParent, yn(sup, 'report1099WithParent'));
  set(first, S.category, id(sup, 'category'));
  set(first, S.taxDocumentDate, text(sup, 'taxDocumentDate'));
  set(first, S.defaultTaxCode, id(sup, 'defaultTaxCode'));
  set(first, S.defaultWithholdingTaxCode, id(sup, 'defaultWithholdingTaxCode'));
  set(first, S.supplierSource, id(sup, 'supplierSource'));
  set(first, S.supplierChangeSource, id(sup, 'supplierChangeSource'));
  set(first, S.fatca, yn(sup, 'fatca'));
  set(first, S.coiDate, text(sup, 'coiDate'));
  set(first, S.customerAccountNumber, text(sup, 'customerAccountNumber'));
  set(first, S.duns, text(sup, 'duns'));
  set(first, S.uei, text(sup, 'uei'));
  set(first, S.defaultCurrency, id(sup, 'defaultCurrency'));
  set(first, S.integrationSystem, id(sup, 'integrationSystem'));
  set(first, S.doNotReimburseCwExpenses, yn(sup, 'doNotReimburseCwExpenses'));
  set(first, S.securitySegment, id(sup, 'securitySegment'));
  set(first, S.noteFollowUpDate, text(sup, 'noteFollowUpDate'));

  for (const k of ['invoiceAnySupplier', 'editPortalTaxes', 'enableGln', 'disableChangeOrder', 'acknowledgementExpected', 'enableAsn', 'overrideDiscountExclusion', 'excludeFreight', 'excludeOtherCharges', 'excludeTax', 'termsBasedOnInvoiceReceived', 'doNotPayDuringBankUpdates', 'alwaysSeparatePayments', 'useSupplierReferenceMemo', 'useInvoiceMemo', 'useConnectionMemo']) {
    set(first, P[k], yn(pay, k));
  }
  for (const k of ['poIssueOption', 'changeOrderIssueOption', 'shippingTerms', 'shippingMethod', 'minimumOrderCurrency', 'paymentTerms', 'defaultPaymentType', 'procurementCreditCard', 'defaultProcurementItem', 'defaultSpendCategory']) {
    set(first, P[k], id(pay, k));
  }
  set(first, P.multiSupplierLink, text(pay, 'multiSupplierLink'));
  set(first, P.minimumOrderAmount, num(pay, 'minimumOrderAmount'));
  set(first, P.leadTimeDays, num(pay, 'leadTimeDays'));
  set(first, P.asnDueDays, num(pay, 'asnDueDays'));
  set(first, P.defaultPaymentMemo, text(pay, 'defaultPaymentMemo'));

  const lanes = [[first]];

  // Multi-value supplier columns, one value per row.
  for (const k of ['restrictedToCompanies', 'groups', 'restrictedCompaniesForContacts', 'includedChildren', 'proposedChildren', 'acceptedCurrencies', 'spendCategoriesOrHierarchies']) {
    lanes.push(lane(S[k], ids(sup, k)));
  }
  lanes.push(lane(P.paymentTypesAccepted, ids(pay, 'paymentTypesAccepted')));

  // Supplier status (one instance).
  if (raw(sup, 'status')) {
    const st = { [COL.status.rowId]: 1 };
    set(st, COL.status.status, id(sup, 'status'));
    set(st, COL.status.reason, id(sup, 'statusReason'));
    set(st, COL.status.description, text(sup, 'statusReasonDescription'));
    lanes.push([st]);
  }

  // Default PO issue emails.
  lanes.push((raw(pay, 'poIssueEmails') ?? []).map((e, i) => ({ [COL.poEmail.rowId]: i + 1, [COL.poEmail.email]: e })));

  // Tax IDs and tax statuses.
  lanes.push(s.taxIds.map((t, i) => {
    const r = { [COL.taxId.rowId]: i + 1 };
    set(r, COL.taxId.taxId, text(t, 'taxId'));
    set(r, COL.taxId.type, id(t, 'taxIdType'));
    set(r, COL.taxId.transaction, yn(t, 'transactionTaxId'));
    set(r, COL.taxId.primary, yn(t, 'primary'));
    return r;
  }));
  lanes.push(s.taxStatuses.map((t, i) => {
    const r = { [COL.taxStatus.rowId]: i + 1 };
    set(r, COL.taxStatus.country, id(t, 'country'));
    set(r, COL.taxStatus.transaction, id(t, 'transactionTaxStatus'));
    set(r, COL.taxStatus.withholding, id(t, 'withholdingTaxStatus'));
    return r;
  }));

  // Contact information.
  lanes.push(concat(s.addresses.map((a, i) => addressRows(a, i + 1, COL.address, makeId(settings.addressIdPattern, { date, key, n: i + 1, label: text(a, 'addressLabel') }), { withUsage: true }))));
  lanes.push(concat(s.phones.map((p, i) => {
    const C = COL.phone;
    const c = findCountry(raw(p, 'phoneCountry'));
    const parent = {};
    set(parent, C.areaCode, text(p, 'areaCode'));
    set(parent, C.countryIso, c?.iso3);
    set(parent, C.intlCode, c?.phoneCode);
    set(parent, C.number, text(p, 'phoneNumber'));
    set(parent, C.extension, text(p, 'extension'));
    set(parent, C.deviceType, id(p, 'deviceType'));
    return block(C.rowId, i + 1, parent, usageRows(p, C));
  })));
  lanes.push(concat(s.emails.map((e, i) => {
    const C = COL.email;
    const parent = {};
    set(parent, C.address, text(e, 'emailAddress'));
    set(parent, C.comment, text(e, 'comments'));
    return block(C.rowId, i + 1, parent, usageRows(e, C));
  })));
  lanes.push(concat(s.webAddresses.map((w, i) => {
    const C = COL.web;
    const parent = {};
    set(parent, C.address, text(w, 'webAddress'));
    set(parent, C.comment, text(w, 'comments'));
    return block(C.rowId, i + 1, parent, usageRows(w, C));
  })));

  // Settlement bank accounts, with bank addresses and intermediaries nested.
  lanes.push(concat(s.settlementAccounts.map((a, i) => {
    const C = COL.sba;
    const parent = { [C.accountId]: makeId(settings.settlementAccountIdPattern, { date, key, n: i + 1, label: text(a, 'accountLabel') }) };
    bankFields(parent, a, C);
    set(parent, C.forConnectionsOnly, yn(a, 'forConnectionsOnly'));
    set(parent, C.requiresPrenote, yn(a, 'requiresPrenote'));
    set(parent, C.prenoteType, id(a, 'prenotePaymentType'));
    const bankAddr = concat((a.bankAddresses ?? []).map((ba, j) => addressRows(ba, j + 1, COL.sbaAddress, makeId(settings.addressIdPattern, { date, key, n: `B${i + 1}${j > 0 ? `-${j + 1}` : ''}` }), { withUsage: false })));
    const inter = concat((a.intermediaries ?? []).map((im, j) => {
      const I = COL.iba;
      const p = { [I.accountId]: makeId(settings.intermediaryAccountIdPattern, { date, key, n: `${i + 1}-${j + 1}`, label: text(im, 'intermediaryLabel') }) };
      set(p, I.order, text(im, 'order') ?? String(j + 1));
      bankFields(p, im, I);
      const imAddr = concat((im.bankAddresses ?? []).map((ba, m) => addressRows(ba, m + 1, COL.ibaAddress, makeId(settings.addressIdPattern, { date, key, n: `I${i + 1}-${j + 1}${m > 0 ? `-${m + 1}` : ''}` }), { withUsage: false })));
      return block(I.rowId, j + 1, p, imAddr);
    }));
    return block(C.rowId, i + 1, parent, lane(C.acceptsPaymentTypes, ids(a, 'acceptsPaymentTypes')), lane(C.paymentTypes, ids(a, 'paymentTypes')), bankAddr, inter);
  })));

  // Classifications, alternate names, note, related worktags.
  lanes.push(concat(s.classifications.map((c, i) => {
    const C = COL.classification;
    const values = raw(c, 'value') ?? [];
    const fieldLane = values.length > 1
      ? merge([{ [C.fieldRowId]: 1, [C.field]: id(c, 'field') }], lane(C.multiChoice, values)).map((r) => ({ ...r, [C.fieldRowId]: 1 }))
      : [set({ [C.fieldRowId]: 1, [C.field]: id(c, 'field') }, C.text, values[0])];
    return block(C.rowId, i + 1, set({}, C.classification, id(c, 'classification')), fieldLane);
  })));
  lanes.push(concat(s.alternateNames.map((a, i) => {
    const C = COL.alternateName;
    return block(C.rowId, i + 1, set({}, C.name, text(a, 'alternateName')), lane(C.usage, ids(a, 'usage')));
  })));
  if (text(sup, 'note')) lanes.push([{ [COL.note.rowId]: 1, [COL.note.content]: text(sup, 'note') }]);

  const worktags = s.relatedWorktags.filter((w) => {
    const ok = !worktag?.typeFilter || worktag.typeFilter(raw(w, 'worktagType'));
    if (!ok) skipped.push(`Related worktag "${raw(w, 'worktagType')}" was left out: its ID type isn't ${worktag.idType}. Load it in a separate file.`);
    return ok;
  });
  lanes.push(concat(worktags.map((w, i) => {
    const C = COL.worktag;
    const parent = {};
    set(parent, C.type, id(w, 'worktagType'));
    set(parent, C.required, yn(w, 'requiredOnTransaction'));
    set(parent, C.requiredForValidation, yn(w, 'requiredForValidation'));
    set(parent, C.defaultWorktag, text(w, 'defaultWorktag'));
    const allowed = (raw(w, 'allowedWorktags') ?? []).map((v, j) => ({ [C.allowedRowId]: j + 1, [C.allowed]: v }));
    return block(C.rowId, i + 1, parent, allowed);
  })));

  const rows = merge(...lanes);
  for (const r of rows) r[COL.key] = String(key);
  return { rows, skipped, name: displayName(s) };
}

function bankFields(p, a, C) {
  set(p, C.country, id(a, 'bankCountry'));
  set(p, C.currency, id(a, 'currency'));
  set(p, C.nickname, text(a, 'accountNickname'));
  set(p, C.accountType, id(a, 'accountType'));
  set(p, C.bankName, text(a, 'bankName'));
  set(p, C.routing, text(a, 'routingNumber'));
  set(p, C.branchId, text(a, 'branchId'));
  set(p, C.branchName, text(a, 'branchName'));
  set(p, C.accountNumber, text(a, 'accountNumber'));
  set(p, C.checkDigit, text(a, 'checkDigit'));
  set(p, C.accountName, text(a, 'nameOnAccount'));
  set(p, C.rollNumber, text(a, 'rollNumber'));
  set(p, C.iban, text(a, 'iban')?.replace(/\s+/g, '').toUpperCase());
  set(p, C.swift, text(a, 'swift')?.replace(/\s+/g, '').toUpperCase());
  set(p, C.inactive, yn(a, 'inactive'));
  set(p, C.instructions, text(a, 'bankInstructions'));
}

/** Rows for every included supplier, keyed 1..N in batch order. */
export function buildEibRows(suppliers, opts) {
  const rows = [];
  const keys = [];
  const skipped = [];
  let key = 0;
  for (const s of suppliers) {
    key++;
    const r = supplierRows(s, key, opts);
    rows.push(...r.rows);
    keys.push({ tempId: s.tempId, key, name: r.name, rows: r.rows.length });
    for (const m of r.skipped) skipped.push({ tempId: s.tempId, name: r.name, message: m });
  }
  return { rows, keys, skipped };
}
