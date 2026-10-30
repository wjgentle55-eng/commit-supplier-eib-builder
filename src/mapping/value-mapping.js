// Value mapping: legacy-to-Workday translations, using the Conversion
// Workbook's Value Mapping tab structure:
//   Tab, Column, Condition Column, Condition Value, Legacy Value, Workday Value(s)
// Matching is case-insensitive and whole-value. Multi-value fields match each
// value separately, and one legacy value can become several Workday values.

import { SECTIONS } from '../model/schema.js';
import { headerKey, splitMulti, cleanText } from '../model/normalize.js';
import { MANY_SECTIONS } from '../model/supplier.js';

const k = (v) => cleanText(v).toLowerCase();

/** Normalizes a rule from the workbook, a saved workspace rule, or the app. */
export function normalizeRule(r, origin = 'workspace') {
  return {
    id: r.id ?? `vm-${Math.random().toString(36).slice(2, 9)}`,
    tab: cleanText(r.tab),
    column: cleanText(r.column),
    conditionColumn: cleanText(r.conditionColumn),
    conditionValue: cleanText(r.conditionValue),
    legacyValue: cleanText(r.legacyValue),
    workdayValues: Array.isArray(r.workdayValues) ? r.workdayValues : splitMulti(r.workdayValue ?? ''),
    notes: cleanText(r.notes),
    origin,
  };
}

function resolveColumn(section, label) {
  const key = headerKey(label);
  return section.columns.find((c) => headerKey(c.label) === key || c.key.toLowerCase() === key);
}

/** Compiles rules against the schema. Rules that point at nothing are returned as `invalid`. */
export function compileRules(rules) {
  const compiled = [];
  const invalid = [];
  for (const r of rules) {
    if (!r.legacyValue || !r.workdayValues.length) {
      invalid.push({ rule: r, reason: 'Needs a legacy value and at least one Workday value' });
      continue;
    }
    const sections = r.tab ? SECTIONS.filter((s) => headerKey(s.tab) === headerKey(r.tab)) : SECTIONS;
    const targets = sections.map((s) => ({ section: s, col: resolveColumn(s, r.column) })).filter((x) => x.col);
    if (!targets.length) {
      invalid.push({ rule: r, reason: `No column "${r.column}"${r.tab ? ` on ${r.tab}` : ''}` });
      continue;
    }
    for (const t of targets) {
      const cond = r.conditionColumn ? resolveColumn(t.section, r.conditionColumn) ?? resolveAny(r.conditionColumn) : null;
      compiled.push({ rule: r, section: t.section.key, field: t.col.key, multi: t.col.multi, cond });
    }
  }
  return { compiled, invalid };
}

function resolveAny(label) {
  for (const s of SECTIONS) {
    const c = resolveColumn(s, label);
    if (c) return { ...c, section: s.key };
  }
  return null;
}

function records(supplier, sectionKey) {
  if (sectionKey === 'supplier' || sectionKey === 'payment') return [supplier[sectionKey]];
  if (MANY_SECTIONS.includes(sectionKey)) return supplier[sectionKey];
  const accts = supplier.settlementAccounts;
  if (sectionKey === 'intermediaryBanks') return accts.flatMap((a) => a.intermediaries ?? []);
  if (sectionKey === 'bankAddresses') return accts.flatMap((a) => [...(a.bankAddresses ?? []), ...(a.intermediaries ?? []).flatMap((i) => i.bankAddresses ?? [])]);
  return [];
}

function conditionHolds(c, supplier, record) {
  if (!c.cond) return true;
  const want = k(c.rule.conditionValue);
  const look = (rec) => rec?.fields?.[c.cond.key]?.value;
  let v = look(record);
  if (v === undefined) v = look(supplier.supplier) ?? look(supplier.payment);
  if (v === undefined) return want === '';
  return Array.isArray(v) ? v.some((x) => k(x) === want) : k(v) === want;
}

/**
 * Applies rules in place. Each changed field keeps `mappedFrom` (the original
 * value) and `mappedBy` (rule ids), so the profile can show what happened.
 * @returns {{ applied: number, byRule: Map<string, number>, invalid }}
 */
export function applyValueMappings(suppliers, rules) {
  const { compiled, invalid } = compileRules(rules);
  const byRule = new Map();
  let applied = 0;
  if (!compiled.length) return { applied, byRule, invalid };

  const index = new Map(); // section.field -> [compiled]
  for (const c of compiled) {
    const key = `${c.section}.${c.field}`;
    index.set(key, [...(index.get(key) ?? []), c]);
  }

  for (const s of suppliers) {
    for (const [key, list] of index) {
      const [sectionKey, field] = key.split('.');
      for (const rec of records(s, sectionKey)) {
        const f = rec.fields[field];
        if (!f) continue;
        const hit = (val) => list.find((c) => k(c.rule.legacyValue) === k(val) && conditionHolds(c, s, rec));
        if (Array.isArray(f.value)) {
          let changed = false;
          const out = [];
          for (const val of f.value) {
            const c = hit(val);
            if (c) {
              changed = true;
              out.push(...c.rule.workdayValues);
              byRule.set(c.rule.id, (byRule.get(c.rule.id) ?? 0) + 1);
            } else out.push(val);
          }
          if (changed) {
            f.mappedFrom = f.mappedFrom ?? f.value;
            f.value = dedupe(out);
            f.mappedBy = [...new Set([...(f.mappedBy ?? []), ...list.map((c) => c.rule.id)])];
            applied++;
          }
        } else {
          const c = hit(f.value);
          if (c) {
            f.mappedFrom = f.mappedFrom ?? f.value;
            f.value = c.rule.workdayValues[0];
            f.mappedBy = [c.rule.id];
            if (c.rule.workdayValues.length > 1) f.mappingNote = `Only the first Workday value was used, because ${field} holds one value.`;
            byRule.set(c.rule.id, (byRule.get(c.rule.id) ?? 0) + 1);
            applied++;
          }
        }
      }
    }
  }
  return { applied, byRule, invalid };
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((v) => (seen.has(k(v)) ? false : seen.add(k(v))));
}
