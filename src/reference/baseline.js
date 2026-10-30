// Built-in reference baseline: standard Workday values from the bundled Lists
// data, plus the ID patterns and synonyms the matcher uses.

import lists from '../data/lists.json';
import regionData from '../data/regions.json';

/** Folds a value for comparison: case, accents, punctuation, and spacing ignored. */
export function fold(v) {
  return String(v ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The default ID pattern: non-alphanumerics become single underscores ("Net 30" -> "Net_30"). */
export function patternId(name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** A value clean enough to derive an ID from by pattern. "Consultants???" is not. */
export const CLEAN_VALUE = /^[\p{L}\p{N}][\p{L}\p{N} &/().,'%+:-]*$/u;

// ---------------------------------------------------------------- countries

const COUNTRY_SYNONYMS = {
  usa: 'US', 'u s a': 'US', 'u s': 'US', us: 'US', 'united states': 'US', america: 'US', 'united states of america': 'US',
  uk: 'GB', 'u k': 'GB', 'great britain': 'GB', britain: 'GB', england: 'GB', scotland: 'GB', wales: 'GB', 'united kingdom': 'GB',
  uae: 'AE', 'south korea': 'KR', korea: 'KR', 'north korea': 'KP', russia: 'RU', vietnam: 'VN', 'viet nam': 'VN', holland: 'NL',
  'the netherlands': 'NL', 'czech republic': 'CZ', czechia: 'CZ', 'ivory coast': 'CI', taiwan: 'TW', iran: 'IR', syria: 'SY',
  bolivia: 'BO', venezuela: 'VE', tanzania: 'TZ', laos: 'LA', moldova: 'MD', macedonia: 'MK', 'hong kong': 'HK', macau: 'MO',
};

export const COUNTRIES = lists.Country.map((c) => ({ name: c.Country, iso2: c['ISO 2'], iso3: c['ISO 3'], phoneCode: c['Phone Code'], usesAreaCode: c['Uses Area Code'] === 'Yes' }));
const COUNTRY_BY = new Map();
for (const c of COUNTRIES) {
  COUNTRY_BY.set(fold(c.name), c);
  COUNTRY_BY.set(fold(c.iso2), c);
  COUNTRY_BY.set(fold(c.iso3), c);
}
for (const [k, iso2] of Object.entries(COUNTRY_SYNONYMS)) {
  const c = COUNTRIES.find((x) => x.iso2 === iso2);
  if (c) COUNTRY_BY.set(fold(k), c);
}

export function findCountry(value) {
  return COUNTRY_BY.get(fold(value)) ?? null;
}
export const countryByIso2 = (iso2) => COUNTRIES.find((c) => c.iso2 === iso2) ?? null;

// ---------------------------------------------------------------- regions

const EXTRA_US = [
  ['PR', 'Puerto Rico'], ['GU', 'Guam'], ['VI', 'Virgin Islands, U.S.'], ['AS', 'American Samoa'], ['MP', 'Northern Mariana Islands'],
  ['UM', 'United States Minor Outlying Islands'], ['AA', 'Armed Forces Americas'], ['AE', 'Armed Forces Europe'], ['AP', 'Armed Forces Pacific'],
];

export function regionsFor(iso2) {
  const c = regionData[iso2];
  if (!c) return [];
  const list = c.regions.map((r) => ({ ...r }));
  if (iso2 === 'US') for (const [code, name] of EXTRA_US) if (!list.some((r) => r.code === code)) list.push({ id: `USA-${code}`, code, names: [name] });
  return list;
}

const regionCache = new Map();
export function findRegion(iso2, value) {
  if (!regionCache.has(iso2)) {
    const m = new Map();
    for (const r of regionsFor(iso2)) {
      m.set(fold(r.code), r);
      m.set(fold(r.id), r);
      for (const n of r.names) m.set(fold(n), r);
    }
    regionCache.set(iso2, m);
  }
  return regionCache.get(iso2).get(fold(value)) ?? null;
}

// ------------------------------------------------------------ tax ID types

// Best-known Workday IDs for common US tax ID types. Everything else gets
// "<ISO3>-<pattern>" and stays Assumed until confirmed (DECISIONS D-028).
const KNOWN_TAX_ID_TYPES = { 'US|employer id number': 'USA-EIN', 'US|ssn or itin': 'USA-SSN' };

export function taxIdTypesFor(iso2) {
  const c = countryByIso2(iso2);
  if (!c) return [];
  return lists['Tax ID Country']
    .filter((t) => t['Tax ID Country'] === c.name)
    .map((t) => ({
      name: t['Tax ID Type'],
      id: KNOWN_TAX_ID_TYPES[`${iso2}|${fold(t['Tax ID Type'])}`] ?? `${c.iso3}-${patternId(t['Tax ID Type'])}`,
      canBeTransaction: t['Can Be Transaction Tax ID'] === 'Yes',
    }));
}

// -------------------------------------------------------------- simple lists

const CURRENCY_SYNONYMS = {
  '$': 'USD', 'us dollar': 'USD', 'us dollars': 'USD', dollar: 'USD', dollars: 'USD', usd: 'USD', euro: 'EUR', euros: 'EUR', '€': 'EUR',
  pound: 'GBP', pounds: 'GBP', sterling: 'GBP', '£': 'GBP', 'canadian dollar': 'CAD', 'canadian dollars': 'CAD', rupee: 'INR', rupees: 'INR',
  'indian rupee': 'INR', yen: 'JPY', 'mexican peso': 'MXN', peso: 'MXN', 'australian dollar': 'AUD', 'swiss franc': 'CHF',
};

/**
 * Baseline per reference type: known display names with their (assumed) IDs.
 * `standard: true` types use universal Workday IDs (ISO codes), so a baseline
 * hit counts as Matched, not Assumed (DECISIONS D-027).
 */
const fromList = (key, ids = {}) => (lists[key] ?? []).map((name) => ({ name, id: ids[name] ?? patternId(name) }));

export const BASELINE = {
  'ISO_3166-1_Alpha-2_Code': { standard: true, values: COUNTRIES.map((c) => ({ name: c.name, id: c.iso2 })) },
  Currency_ID: { standard: true, values: lists.Currency.map((c) => ({ name: c, id: c })) },
  Bank_Account_Type_Code: { values: fromList('Account Type', { Checking: 'DDA', Savings: 'SA' }) },
  Phone_Device_Type_ID: { values: fromList('Phone Device Type') },
  Communication_Usage_Behavior_ID: {
    values: [...new Set([...(lists['Use For'] ?? []), 'Procurement'])].map((name) => ({
      name,
      id: { Billing: 'BILLING', 'Remit To': 'REMIT', Shipping: 'SHIPPING', Procurement: 'PROCUREMENT' }[name] ?? patternId(name).toUpperCase(),
    })),
  },
  Alternate_Name_Usage_ID: { values: fromList('Alternate Name Usage') },
  Business_Entity_Status_Value_ID: { values: fromList('Supplier Status', { Active: 'ACTIVE', Inactive: 'INACTIVE', Hold: 'HOLD' }) },
  Reason_for_Supplier_Status_Change_ID: { values: fromList('Status Reason') },
  Tax_Authority_Form_Type: { values: fromList('Tax Authority Form Type') },
  Tax_Code_ID: { values: fromList('Tax Code') },
  Transaction_Tax_Status_ID: { values: fromList('Transaction Tax Status') },
  Purchase_Order_Issue_Option_ID: { values: fromList('PO Issue Option') },
  Shipping_Terms_ID: { values: fromList('Shipping Terms') },
  Shipping_Method_ID: { values: fromList('Shipping Method') },
};

/** Synonyms applied before matching, per type: legacy wording -> standard display value. */
export const SYNONYMS = {
  Payment_Type_ID: {
    ach: 'EFT', 'ach transfer': 'EFT', 'direct deposit': 'Direct Deposit', 'electronic funds transfer': 'EFT', eft: 'EFT', electronic: 'EFT',
    check: 'Check', cheque: 'Check', 'check cheque': 'Check', chk: 'Check', 'paper check': 'Check',
    wire: 'Wire', 'wire transfer': 'Wire', 'international wire': 'Wire', 'domestic wire': 'Wire',
    'credit card': 'Credit Card', card: 'Credit Card', 'p card': 'Credit Card', pcard: 'Credit Card', 'virtual card': 'Credit Card',
  },
  Currency_ID: CURRENCY_SYNONYMS,
  Bank_Account_Type_Code: { checking: 'Checking', chk: 'Checking', dda: 'Checking', 'demand deposit': 'Checking', savings: 'Savings', sav: 'Savings', sa: 'Savings' },
  Phone_Device_Type_ID: { phone: 'Landline', office: 'Landline', work: 'Landline', business: 'Landline', cell: 'Mobile', mobile: 'Mobile', 'cell phone': 'Mobile', fax: 'Fax' },
  Communication_Usage_Behavior_ID: { remit: 'Remit To', 'remit to': 'Remit To', remittance: 'Remit To', bill: 'Billing', billing: 'Billing', invoice: 'Billing', ship: 'Shipping', 'ship to': 'Shipping', shipping: 'Shipping', purchasing: 'Procurement', ordering: 'Procurement', po: 'Procurement' },
  Business_Entity_Status_Value_ID: { active: 'Active', inactive: 'Inactive', 'on hold': 'Hold', hold: 'Hold', blocked: 'Hold' },
  Payment_Terms_ID: { 'due upon receipt': 'Due on Receipt', 'due on receipt': 'Due on Receipt', immediate: 'Due on Receipt', cod: 'Due on Receipt', n30: 'Net 30', n45: 'Net 45', n60: 'Net 60', n15: 'Net 15', n10: 'Net 10', 'net30': 'Net 30', 'net 30 days': 'Net 30', 'net 45 days': 'Net 45', 'net 60 days': 'Net 60', 'net 15 days': 'Net 15' },
};

export const listsData = lists;
