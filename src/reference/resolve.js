// Reference ID resolution. Every distinct source value of every reference
// field gets one status:
//   matched     exact or normalized match to a tenant value, a Workday standard
//               ID (ISO country or currency), or a value you confirmed
//   assumed     derived from the built-in baseline or the ID pattern
//   unresolved  no match (a fuzzy suggestion may be offered, never auto-applied)
//
// Matching order: your confirmed resolution -> exact -> normalized -> synonyms
// -> baseline -> pattern -> fuzzy suggestion.

import { SECTIONS } from '../model/schema.js';
import { MANY_SECTIONS } from '../model/supplier.js';
import { similarity } from '../mapping/auto-map.js';
import {
  BASELINE, SYNONYMS, CLEAN_VALUE, fold, patternId, findCountry, findRegion, regionsFor, taxIdTypesFor,
} from './baseline.js';

export const REF_TYPE_LABELS = {
  'ISO_3166-1_Alpha-2_Code': 'Country',
  Country_Region_ID: 'Region',
  Currency_ID: 'Currency',
  Supplier_Category_ID: 'Supplier Category',
  Supplier_Group_ID: 'Supplier Group',
  Business_Entity_Status_Value_ID: 'Supplier Status',
  Reason_for_Supplier_Status_Change_ID: 'Status Reason',
  Company_Reference_ID: 'Company',
  Tax_Authority_Form_Type: 'Tax Authority Form Type',
  Tax_Code_ID: 'Tax Code',
  External_Supplier_Invoice_Source_ID: 'Supplier Source',
  Integration_System_ID: 'Integration System',
  Supplier_Security_Segment_ID: 'Supplier Security Segment',
  Resource_Category_Hierarchy_ID: 'Spend Category or Hierarchy',
  Supplier_ID: 'Supplier (children)',
  Payment_Terms_ID: 'Payment Terms',
  Payment_Type_ID: 'Payment Type',
  Expense_Credit_Card_ID: 'Procurement Credit Card',
  Purchase_Order_Issue_Option_ID: 'PO Issue Option',
  Shipping_Terms_ID: 'Shipping Terms',
  Shipping_Method_ID: 'Shipping Method',
  Spend_Category_ID: 'Spend Category',
  Purchase_Item_ID: 'Procurement Item',
  Communication_Usage_Behavior_ID: 'Use For',
  Phone_Device_Type_ID: 'Phone Device Type',
  Tax_ID_Type: 'Tax ID Type',
  Transaction_Tax_Status_ID: 'Transaction Tax Status',
  Tax_Withholding_Status_ID: 'Withholding Tax Status',
  Bank_Account_Type_Code: 'Bank Account Type',
  Alternate_Name_Usage_ID: 'Alternate Name Usage',
  Custom_Supplier_Classification_ID: 'Supplier Classification',
  Custom_Supplier_Classification_Field_ID: 'Classification Field',
  Accounting_Worktag_Type_ID: 'Worktag Type',
};

export const typeLabel = (t) => REF_TYPE_LABELS[t] ?? t.replace(/_ID$|_Code$/, '').replace(/_/g, ' ');

/** Maps a type given in a tenant file ("Supplier Category", "Supplier_Category_ID") to a reference type. */
export function normalizeTypeName(t) {
  const f = fold(t);
  for (const [type, label] of Object.entries(REF_TYPE_LABELS)) {
    if (fold(type) === f || fold(label) === f || fold(type.replace(/_ID$|_Code$/, '')) === f) return type;
  }
  return String(t ?? '').trim();
}

/** Tenant matching normalizes case and whitespace only (brief 6.4), so "Consultants???" doesn't match "Consultants". */
const soft = (v) => String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

const CONTEXT_TYPES = new Set(['Country_Region_ID', 'Tax_ID_Type']);

export function resolutionKey(type, value, country) {
  return CONTEXT_TYPES.has(type) ? `${country ?? ''}|${fold(value)}` : fold(value);
}

/** Builds lookup tables for tenant values, by type. */
export function indexTenant(values = []) {
  const byType = new Map();
  for (const v of values) {
    const type = normalizeTypeName(v.type);
    if (!byType.has(type)) byType.set(type, { exact: new Map(), folded: new Map(), list: [] });
    const t = byType.get(type);
    const rec = { id: String(v.id).trim(), name: String(v.name ?? v.id).trim() };
    t.list.push(rec);
    for (const k of [rec.id, rec.name]) {
      if (!t.exact.has(k)) t.exact.set(k, rec);
      if (!t.folded.has(soft(k))) t.folded.set(soft(k), rec);
    }
  }
  return byType;
}

/**
 * Resolves one value.
 * @returns {{ status, id, how, suggestion? }}
 */
export function resolveValue(type, value, { country, tenant, resolutions }) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const saved = resolutions?.[type]?.[resolutionKey(type, raw, country)];
  if (saved?.id) return { status: 'matched', id: saved.id, how: 'Confirmed by you' };

  const t = tenant?.get(type);
  const synRaw = SYNONYMS[type]?.[fold(raw)];
  const syn = synRaw && fold(synRaw) !== fold(raw) ? synRaw : null;
  const synName = synRaw ?? null;

  if (t && t.list.length) {
    const hit = t.exact.get(raw) ?? t.folded.get(soft(raw)) ?? (syn && (t.exact.get(syn) ?? t.folded.get(soft(syn))));
    if (hit) return { status: 'matched', id: hit.id, how: t.exact.get(raw) ? 'Exact match to tenant values' : syn && !t.folded.get(soft(raw)) ? `Synonym of "${syn}" in tenant values` : 'Matched tenant values (ignoring case and spacing)' };
    return unresolved(raw, t.list, 'Not in the tenant values you loaded');
  }

  // Context types: regions by country, tax ID types by country.
  if (type === 'Country_Region_ID') {
    if (!country) return { status: 'unresolved', id: '', how: 'Needs a country to look up the region' };
    const r = findRegion(country, raw);
    if (r) return { status: 'assumed', id: r.id, how: 'Standard ISO 3166-2 region code' };
    return unresolved(raw, regionsFor(country).map((x) => ({ id: x.id, name: x.names[0] })), 'No standard region with this name for the country');
  }
  if (type === 'Tax_ID_Type') {
    const types = country ? taxIdTypesFor(country) : [];
    const hit = types.find((x) => fold(x.name) === fold(raw) || fold(x.id) === fold(raw));
    if (hit) return { status: 'assumed', id: hit.id, how: 'Standard tax ID type for the country' };
    return unresolved(raw, types, country ? 'Not a standard tax ID type for the country' : 'Needs a tax ID country');
  }
  if (type === 'ISO_3166-1_Alpha-2_Code') {
    const c = findCountry(raw);
    if (c) return { status: 'matched', id: c.iso2, how: 'Workday standard country code' };
    return unresolved(raw, BASELINE[type].values, 'Not a recognized country');
  }

  const base = BASELINE[type];
  if (base) {
    const name = synName ?? raw;
    const hit = base.values.find((x) => fold(x.name) === fold(name) || x.id === raw);
    if (hit) return base.standard
      ? { status: 'matched', id: hit.id, how: 'Workday standard ID' }
      : { status: 'assumed', id: hit.id, how: syn ? `Synonym of "${syn}", standard Workday value` : 'Standard Workday value' };
    if (base.standard) return unresolved(raw, base.values, 'Not a standard value');
  }

  const name = syn ?? raw;
  if (type === 'Supplier_ID') return { status: 'assumed', id: raw, how: 'Used as the Supplier ID as typed' };
  if (CLEAN_VALUE.test(name)) {
    return { status: 'assumed', id: patternId(name), how: syn ? `Synonym of "${syn}", ID by pattern` : 'ID derived from the name by pattern' };
  }
  return unresolved(raw, base?.values ?? [], 'Contains characters an ID can’t be derived from');
}

function unresolved(raw, candidates, how) {
  let best = null;
  for (const c of candidates) {
    for (const k of [c.name, c.id]) {
      const s = similarity(k, raw);
      if (s >= 0.6 && (!best || s > best.score)) best = { id: c.id, name: c.name, score: s };
    }
  }
  return { status: 'unresolved', id: '', how, suggestion: best ? { id: best.id, name: best.name } : null };
}

// ----------------------------------------------------- walking the batch

const SECTION_COLS = Object.fromEntries(SECTIONS.map((s) => [s.key, s.columns.filter((c) => c.ref)]));

/** Every record of a supplier with its section key and edit path. */
export function* records(s) {
  yield { section: 'supplier', rec: s.supplier, path: 'supplier' };
  yield { section: 'payment', rec: s.payment, path: 'payment' };
  for (const k of MANY_SECTIONS) {
    for (const r of s[k]) {
      const p = `${k}.${r._i ?? s[k].indexOf(r)}`;
      yield { section: k, rec: r, path: p };
      if (k === 'settlementAccounts') {
        for (const [j, ba] of (r.bankAddresses ?? []).entries()) yield { section: 'bankAddresses', rec: ba, path: `${p}.bankAddresses.${j}`, parent: r };
        for (const [j, im] of (r.intermediaries ?? []).entries()) {
          yield { section: 'intermediaryBanks', rec: im, path: `${p}.intermediaries.${j}`, parent: r };
          for (const [m, ba] of (im.bankAddresses ?? []).entries()) yield { section: 'bankAddresses', rec: ba, path: `${p}.intermediaries.${j}.bankAddresses.${m}`, parent: im };
        }
      }
    }
  }
}

const COUNTRY_FIELD = { addresses: 'country', bankAddresses: 'country', taxIds: 'taxIdCountry', taxStatuses: 'country', settlementAccounts: 'bankCountry', intermediaryBanks: 'bankCountry', phones: 'phoneCountry' };

/**
 * Resolves every reference field in place (field.refs, aligned with the
 * values) and returns an index of distinct values per type for the UI.
 */
export function resolveBatch(suppliers, workspace) {
  const tenant = indexTenant(workspace?.tenantReferenceValues);
  const resolutions = workspace?.referenceResolutions ?? {};
  const index = new Map(); // type -> Map(key -> entry)
  const cache = new Map();

  const resolveCached = (type, value, country) => {
    const key = `${type}::${resolutionKey(type, value, country)}`;
    if (!cache.has(key)) cache.set(key, resolveValue(type, value, { country, tenant, resolutions }));
    return cache.get(key);
  };

  for (const s of suppliers) {
    for (const { section, rec, path } of records(s)) {
      const cols = SECTION_COLS[section] ?? [];
      // Country first, so regions and tax ID types have their context.
      const cf = COUNTRY_FIELD[section];
      let country = null;
      if (cf && rec.fields[cf]?.value) country = findCountry(rec.fields[cf].value)?.iso2 ?? null;
      for (const col of cols) {
        const f = rec.fields[col.key];
        if (!f) continue;
        const values = Array.isArray(f.value) ? f.value : f.value ? [f.value] : [];
        f.refs = values.map((value) => {
          const ctx = CONTEXT_TYPES.has(col.ref) ? country : null;
          const r = resolveCached(col.ref, value, ctx);
          const key = resolutionKey(col.ref, value, ctx);
          if (!index.has(col.ref)) index.set(col.ref, new Map());
          const t = index.get(col.ref);
          if (!t.has(key)) t.set(key, { type: col.ref, key, value, country: ctx, ...r, suppliers: new Set(), uses: [] });
          const e = t.get(key);
          e.suppliers.add(s.tempId);
          e.uses.push({ tempId: s.tempId, path: `${path}.${col.key}`, label: col.label });
          return { value, ...r };
        });
      }
    }
  }
  return index;
}

/** Counts by status over the whole index. */
export function refCounts(index) {
  const c = { matched: 0, assumed: 0, unresolved: 0 };
  for (const t of index.values()) for (const e of t.values()) c[e.status]++;
  return c;
}

/** Tenant value file rows -> [{ type, id, name }]. See tenant.js for parsing. */
export { patternId };
