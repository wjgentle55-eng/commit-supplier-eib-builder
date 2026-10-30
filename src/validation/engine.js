// Validation engine: runs the rules table (rules.js) over the batch.
// Pure and deterministic; re-run on every change (the UI debounces edits).

import { RULES } from './rules.js';
import { SECTION_BY_KEY } from '../model/schema.js';
import { isBlank, nameKey } from '../model/normalize.js';
import { records } from '../reference/resolve.js';
import { findCountry, taxIdTypesFor, fold } from '../reference/baseline.js';
import { similarity } from '../mapping/auto-map.js';
import {
  isAbaRouting, isIban, isBic, isEin, isKnownEinPrefix, isSsnOrItin, isEmail, isUrl, isUsPostal, isIsoDate, isNumber, matchesFormat,
} from './validators.js';
import addressRules from '../data/address-rules.json';
import bankRules from '../data/bank-rules.json';

const VALIDATORS = {
  email: isEmail, url: isUrl, isoDate: isIsoDate, number: isNumber, iban: isIban, bic: isBic,
  bool: (v) => v === 'Yes' || v === 'No',
};

const addressRulesByIso3 = new Map(Object.values(addressRules.countries).map((r) => [r['ISO 3'], r]));

const ADDRESS_FIELDS = {
  Region: 'region', Subregion: 'subregion', City: 'city', Submunicipality: 'submunicipality', 'City Subdivision': 'citySubdivision',
  'Address Line 1': 'addressLine1', 'Address Line 2': 'addressLine2', 'Address Line 3': 'addressLine3', 'Address Line 4': 'addressLine4', 'Postal Code': 'postalCode',
};

const BANK_FIELDS = [
  { field: 'routingNumber', option: 'Routing Number/Bank Code', format: 'Routing Number/Bank Code Format Validator' },
  { field: 'accountNumber', option: 'Bank Account Number', format: 'Bank Account Number Format Validator' },
  { field: 'branchId', option: 'Branch ID', format: 'Branch ID Format Validator' },
  { field: 'checkDigit', option: 'Check Digit Display Option', format: 'Check Digit Format Validator', formatMessage: 'Check Digit Validator Message' },
  { field: 'bankName', option: 'Bank Name Display Option' },
  { field: 'nameOnAccount', option: 'Name on Account', format: 'Name on Account Format Validator' },
  { field: 'branchName', option: 'Branch Name Display Option' },
  { field: 'rollNumber', option: 'Roll Number Display Option' },
  { field: 'iban', option: 'IBAN', format: 'IBAN Format Validator' },
  { field: 'swift', option: 'Bank Identification Code', format: 'Bank Identification Code Format Validator' },
];

const val = (rec, field) => rec?.fields?.[field]?.value;
const values = (v) => (Array.isArray(v) ? v : isBlank(v) ? [] : [v]);
const labelOf = (section, field) => SECTION_BY_KEY[section]?.columns.find((c) => c.key === field)?.label ?? field;
const fill = (tpl, ctx) => String(tpl ?? '').replace(/\{(\w+)\}/g, (_, k) => (ctx[k] ?? `{${k}}`));
const refIds = (rec, field) => (rec?.fields?.[field]?.refs ?? []).map((r) => r.id || r.value);

const SECTION_NOUN = {
  supplier: 'Supplier', payment: 'Payment & Procurement', addresses: 'Address', phones: 'Phone', emails: 'Email', webAddresses: 'Web address',
  taxIds: 'Tax ID', taxStatuses: 'Tax status', settlementAccounts: 'Bank account', intermediaryBanks: 'Intermediary bank', bankAddresses: 'Bank address',
  alternateNames: 'Alternate name', classifications: 'Classification', relatedWorktags: 'Related worktag',
};

function recordLabel(section, path) {
  const noun = SECTION_NOUN[section] ?? section;
  const idx = /\.(\d+)$/.exec(path);
  return idx && section !== 'supplier' && section !== 'payment' ? `${noun} ${Number(idx[1]) + 1}` : noun;
}

// ----------------------------------------------------------------- checks
// Record checks get (rule, rec, ctx) and return [{ field, value, extra }].
// Supplier checks get (rule, supplier, ctx) and return [{ section, path, field, value, extra }].

const RECORD_CHECKS = {
  required(rule, rec) {
    const f = rule.params.field;
    return isBlank(val(rec, f)) ? [{ field: f }] : [];
  },
  requiredIf(rule, rec) {
    const { field, when } = rule.params;
    const w = val(rec, when.field);
    const wv = Array.isArray(w) ? w.join(', ') : w ?? '';
    let on = false;
    if (when.test === 'eq') on = fold(wv) === fold(when.value);
    else if (when.test === 'notIn') on = !when.value.some((x) => fold(x) === fold(wv));
    else if (when.test === 'nonZero') on = !isBlank(wv) && Number(wv) !== 0;
    else if (when.test === 'notBlank') on = !isBlank(wv);
    return on && isBlank(val(rec, field)) ? [{ field, extra: { whenValue: wv } }] : [];
  },
  format(rule, rec) {
    const { field, validator } = rule.params;
    const ok = VALIDATORS[validator];
    return values(val(rec, field)).filter((v) => !ok(v)).map((v) => ({ field, value: v }));
  },
  usPostal(rule, rec) {
    const c = findCountry(val(rec, 'country'));
    const pc = val(rec, 'postalCode');
    return c?.iso2 === 'US' && pc && !isUsPostal(pc) ? [{ field: 'postalCode', value: pc }] : [];
  },
  addressRules(rule, rec) {
    const c = findCountry(val(rec, 'country'));
    const rules = c && addressRulesByIso3.get(c.iso3);
    if (!rules) return [];
    const out = [];
    for (const [ruleField, field] of Object.entries(ADDRESS_FIELDS)) {
      const opt = rules[ruleField];
      const v = val(rec, field);
      if (opt === 'Required' && isBlank(v)) out.push({ field, extra: { rule: 'required', country: c.name, fixText: `Enter ${labelOf('addresses', field)}.` } });
      if (opt === 'Not Accepted' && !isBlank(v)) out.push({ field, value: v, severity: 'warning', extra: { rule: 'not accepted', country: c.name, fixText: `Move "${v}" to an accepted address field, or remove it.` } });
    }
    return out;
  },
  bankRules(rule, rec) {
    const c = findCountry(val(rec, 'bankCountry'));
    const rules = c && bankRules.countries[c.name];
    if (!rules) return [];
    const out = [];
    for (const b of BANK_FIELDS) {
      const opt = rules[b.option];
      const v = val(rec, b.field);
      const label = labelOf('settlementAccounts', b.field);
      if (opt === 'Required' && isBlank(v)) {
        out.push({ field: b.field, extra: { message: `${label} is required for bank accounts in ${c.name}.`, fixText: `Enter ${label}.` } });
      } else if (opt === 'Do Not Show' && !isBlank(v)) {
        out.push({ field: b.field, value: v, extra: { message: `${label} isn’t used for bank accounts in ${c.name}, so Workday won’t accept it.`, fixText: `Remove ${label}.` } });
      } else if (!isBlank(v) && b.format && rules[b.format] && !matchesFormat(v, rules[b.format])) {
        const hint = (b.formatMessage && rules[b.formatMessage]) || `expected format ${rules[b.format]}`;
        out.push({ field: b.field, value: v, extra: { message: `${label} "${v}" isn’t in the format Workday expects for ${c.name} (${hint}).`, fixText: `Correct ${label}.` } });
      }
    }
    return out;
  },
  abaChecksum(rule, rec) {
    const c = findCountry(val(rec, 'bankCountry'));
    const r = val(rec, 'routingNumber');
    return c?.iso2 === 'US' && r && /^\d{9}$/.test(r.replace(/[\s-]/g, '')) && !isAbaRouting(r) ? [{ field: 'routingNumber', value: r }] : [];
  },
  usTaxIdFormat(rule, rec) {
    const k = usTaxKind(rec);
    const v = val(rec, 'taxId');
    if (!k || !v) return [];
    const ok = k === 'EIN' ? isEin(v) : isSsnOrItin(v);
    return ok ? [] : [{ field: 'taxId', value: v, extra: { kind: k === 'EIN' ? 'EIN' : 'SSN or ITIN', expected: k === 'EIN' ? '##-#######' : '###-##-####' } }];
  },
  einPrefix(rule, rec) {
    const v = val(rec, 'taxId');
    return usTaxKind(rec) === 'EIN' && isEin(v) && !isKnownEinPrefix(v) ? [{ field: 'taxId', value: v, extra: { prefix: v.slice(0, 2) } }] : [];
  },
  transactionTaxId(rule, rec) {
    if (val(rec, 'transactionTaxId') !== 'Yes') return [];
    const c = findCountry(val(rec, 'taxIdCountry'));
    const type = val(rec, 'taxIdType');
    if (!c || !type) return [];
    const t = taxIdTypesFor(c.iso2).find((x) => fold(x.name) === fold(type) || fold(x.id) === fold(type));
    return t && !t.canBeTransaction ? [{ field: 'transactionTaxId', value: 'Yes', extra: { type: t.name, country: c.name } }] : [];
  },
};

function usTaxKind(rec) {
  const c = findCountry(val(rec, 'taxIdCountry'));
  if (c?.iso2 !== 'US') return null;
  const t = fold([val(rec, 'taxIdType'), ...refIds(rec, 'taxIdType')].join(' '));
  if (/employer|ein/.test(t)) return 'EIN';
  if (/ssn|itin|social/.test(t)) return 'SSN';
  return null;
}

const ELECTRONIC = (rule) => new Set(rule.params.types.map(fold));

const SUPPLIER_CHECKS = {
  onePrimary(rule, s) {
    const { section, field } = rule.params;
    const list = s[section];
    if (!list.length) return [];
    const n = list.filter((r) => val(r, field) === 'Yes').length;
    return n === 1 ? [] : [{ section, path: section, field, value: String(n), extra: { count: n } }];
  },
  needsRecord(rule, s) {
    return s[rule.params.section].length ? [] : [{ section: rule.params.section, path: rule.params.section, field: null }];
  },
  defaultInAccepted(rule, s) {
    const p = s.payment;
    const def = val(p, 'defaultPaymentType');
    const acc = values(val(p, 'paymentTypesAccepted'));
    if (!def || !acc.length) return [];
    const accIds = new Set([...acc.map(fold), ...refIds(p, 'paymentTypesAccepted').map(fold)]);
    const defIds = [fold(def), ...refIds(p, 'defaultPaymentType').map(fold)];
    return defIds.some((d) => accIds.has(d)) ? [] : [{ section: 'payment', path: 'payment', field: 'defaultPaymentType', value: def, extra: { accepted: acc.join(', ') } }];
  },
  electronicNeedsAccount(rule, s) {
    if (s.settlementAccounts.length) return [];
    const el = ELECTRONIC(rule);
    const p = s.payment;
    const acc = values(val(p, 'paymentTypesAccepted'));
    const ids = refIds(p, 'paymentTypesAccepted');
    const hits = acc.filter((v, i) => el.has(fold(v)) || el.has(fold(ids[i] ?? '')));
    return hits.length ? [{ section: 'payment', path: 'payment', field: 'paymentTypesAccepted', value: hits.join(', '), extra: { types: hits.join(' and ') } }] : [];
  },
  duplicateInSupplier(rule, s) {
    const { section, fields } = rule.params;
    const seen = new Map();
    const out = [];
    for (const r of s[section]) {
      const k = fields.map((f) => fold(val(r, f))).join('|');
      if (fields.some((f) => isBlank(val(r, f)))) continue;
      if (seen.has(k)) out.push({ section, path: `${section}.${r._i ?? 0}`, field: fields[fields.length - 1], value: fields.map((f) => val(r, f)).join(' ') });
      else seen.set(k, r);
    }
    return out;
  },
  refStatus(rule, s) {
    const out = [];
    for (const { section, rec, path } of records(s)) {
      for (const [field, f] of Object.entries(rec.fields)) {
        for (const r of f.refs ?? []) {
          if (r.status !== rule.params.status) continue;
          out.push({ section, path, field, value: r.value, extra: { id: r.id, how: r.how } });
        }
      }
    }
    return out;
  },
  ingestNotes(rule, s) {
    return s.notes.map((n) => ({
      section: n.section ?? 'supplier',
      path: n.section === 'supplier' || n.section === 'payment' || !n.section ? n.section ?? 'supplier' : n.section,
      field: n.field,
      severity: n.severity,
      extra: { message: n.message, fixText: NOTE_FIX[n.code] ?? 'Review this in the source file.' },
      code: n.code,
    }));
  },
  existingSupplier(rule, s, ctx) {
    const list = ctx.existingSuppliers;
    if (!list?.length) return [];
    const name = val(s.supplier, 'supplierName');
    const taxIds = s.taxIds.map((t) => String(val(t, 'taxId') ?? '').replace(/\D/g, '')).filter(Boolean);
    const last4 = s.settlementAccounts.map((a) => String(val(a, 'accountNumber') ?? '').slice(-4)).filter(Boolean);
    const out = [];
    for (const e of list) {
      const why = [];
      if (e.supplierName && nameKey(e.supplierName) === nameKey(name)) why.push('same name');
      else if (e.supplierName && similarity(stripSuffix(e.supplierName), stripSuffix(name)) >= 0.85) why.push('similar name');
      if (e.taxId && taxIds.includes(String(e.taxId).replace(/\D/g, ''))) why.push('same tax ID');
      if (e.accountLast4 && last4.includes(String(e.accountLast4).slice(-4)) && why.length) why.push('same bank account last 4');
      if (why.length) out.push({ section: 'supplier', path: 'supplier', field: 'supplierName', value: name, extra: { existing: `${e.supplierName ?? ''}${e.supplierId ? ` (${e.supplierId})` : ''}`, why: why.join(', ') } });
    }
    return out;
  },
};

const stripSuffix = (n) => fold(n).replace(/\b(inc|llc|ltd|corp|co|company|corporation|limited|lp|llp|plc)\b/g, '').trim();

const NOTE_FIX = {
  'conflicting-values': 'Pick the right value on the profile.',
  'unknown-account-label': 'Fix the Account Label so it matches a row on the Settlement Accounts tab.',
  'duplicate-account-label': 'Give each settlement account its own Account Label.',
  'duplicate-supplier-row': 'Keep one row per supplier on the Suppliers tab.',
  'duplicate-payment-row': 'Keep one row per supplier on the Payment & Procurement tab.',
  'not-on-suppliers-tab': 'Add the supplier to the Suppliers tab, or fix the spelling of the name.',
  'duplicate-across-files': 'Load each supplier from one file only, or exclude the extra copy.',
};

// ------------------------------------------------------------------ batch

function duplicateIssues(rule, suppliers) {
  const { section, field, normalize, with: alsoField } = rule.params;
  const norm = (v) => (normalize === 'digits' ? String(v).replace(/\D/g, '') : normalize === 'alnum' ? String(v).replace(/[^A-Za-z0-9]/g, '').toUpperCase() : nameKey(v));
  const seen = new Map();
  for (const s of suppliers) {
    const recs = section === 'supplier' || section === 'payment' ? [{ rec: s[section], path: section }] : s[section].map((r) => ({ rec: r, path: `${section}.${r._i ?? 0}` }));
    for (const { rec, path } of recs) {
      const v = val(rec, field);
      if (isBlank(v)) continue;
      const k = norm(v) + (alsoField ? `|${norm(val(rec, alsoField) ?? '')}` : '');
      if (!k || k === '|') continue;
      if (!seen.has(k)) seen.set(k, []);
      seen.get(k).push({ s, path, value: v });
    }
  }
  const out = new Map();
  for (const hits of seen.values()) {
    const owners = [...new Set(hits.map((x) => x.s.tempId))];
    if (owners.length < 2) continue;
    // The first supplier to use a value keeps it; later ones are flagged.
    for (const h of hits.filter((x) => x.s.tempId !== owners[0])) {
      const others = hits.filter((x) => x.s.tempId !== h.s.tempId && suppliers.indexOf(x.s) < suppliers.indexOf(h.s)).map((x) => `${x.s.supplier.fields.supplierName?.value ?? ''} (${x.s.tempId})`);
      if (!others.length) continue;
      const list = out.get(h.s.tempId) ?? [];
      list.push({ section, path: h.path, field, value: h.value, extra: { others: [...new Set(others)].join(', ') } });
      out.set(h.s.tempId, list);
    }
  }
  return out;
}

/**
 * Validates every supplier. Sets s.issues and s.status ('clean' | 'warnings'
 * | 'blocked') in place and returns a batch summary.
 */
export function validateBatch(suppliers, { existingSuppliers = [], excluded = new Set(), rules = RULES } = {}) {
  const ctx = { existingSuppliers };
  const batchHits = new Map();
  for (const rule of rules.filter((r) => r.scope === 'batch')) batchHits.set(rule.id, duplicateIssues(rule, suppliers));

  for (const s of suppliers) {
    const issues = [];
    const push = (rule, hit) => {
      const severity = hit.severity ?? (rule.severity === 'from-note' ? 'warning' : rule.severity);
      const label = hit.field ? labelOf(hit.section, hit.field) : SECTION_NOUN[hit.section] ?? '';
      const c = { label, value: hit.value ?? '', ...(hit.extra ?? {}) };
      issues.push({
        ruleId: hit.code ? `${rule.id}:${hit.code}` : rule.id,
        severity,
        section: hit.section,
        sectionLabel: SECTION_NOUN[hit.section] ?? hit.section,
        recordLabel: recordLabel(hit.section, hit.path),
        path: hit.path,
        field: hit.field,
        fieldLabel: label,
        value: hit.value ?? (hit.field && !hit.path.includes('.') ? valueAt(s, hit.path, hit.field) : ''),
        message: fill(rule.message, c),
        fix: fill(rule.fix, c),
      });
    };

    for (const rule of rules) {
      if (rule.scope === 'record') {
        for (const { section, rec, path } of records(s)) {
          if (section !== rule.section) continue;
          for (const hit of RECORD_CHECKS[rule.type](rule, rec, ctx)) push(rule, { section, path, ...hit, value: hit.value ?? stringify(val(rec, hit.field)) });
        }
      } else if (rule.scope === 'supplier') {
        for (const hit of SUPPLIER_CHECKS[rule.type](rule, s, ctx)) push(rule, hit);
      } else if (rule.scope === 'batch') {
        for (const hit of batchHits.get(rule.id).get(s.tempId) ?? []) push(rule, hit);
      }
    }
    s.issues = dedupeIssues(issues);
    s.errorCount = s.issues.filter((i) => i.severity === 'error').length;
    s.warningCount = s.issues.filter((i) => i.severity === 'warning').length;
    s.status = s.errorCount ? 'blocked' : s.warningCount ? 'warnings' : 'clean';
    s.excluded = excluded.has(s.tempId);
  }
  return summarize(suppliers);
}

const stringify = (v) => (Array.isArray(v) ? v.join('; ') : v ?? '');
function valueAt(s, path, field) {
  return stringify(s[path]?.fields?.[field]?.value);
}

function dedupeIssues(list) {
  const seen = new Set();
  return list.filter((i) => {
    const k = `${i.ruleId}|${i.path}|${i.field}|${i.value}|${i.message}`;
    return seen.has(k) ? false : seen.add(k);
  });
}

/** Batch counts and the most frequent issues, grouped by rule and field. */
export function summarize(suppliers) {
  const counts = { clean: 0, warnings: 0, blocked: 0, errors: 0, warningsTotal: 0 };
  const groups = new Map();
  for (const s of suppliers) {
    counts[s.status]++;
    counts.errors += s.errorCount;
    counts.warningsTotal += s.warningCount;
    for (const i of s.issues) {
      const k = `${i.ruleId}|${i.fieldLabel}`;
      if (!groups.has(k)) groups.set(k, { key: k, ruleId: i.ruleId, severity: i.severity, fieldLabel: i.fieldLabel, sectionLabel: i.sectionLabel, example: i.message, suppliers: new Set(), issues: 0, values: new Map() });
      const g = groups.get(k);
      g.suppliers.add(s.tempId);
      g.issues++;
      const vk = String(i.value ?? '');
      g.values.set(vk, (g.values.get(vk) ?? 0) + 1);
    }
  }
  const top = [...groups.values()].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1) || b.suppliers.size - a.suppliers.size || b.issues - a.issues).slice(0, 10);
  return { counts, top, groups };
}
