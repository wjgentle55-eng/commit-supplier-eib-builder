// Validation rules, as data. Each rule names a check type implemented in
// engine.js plus its parameters, so adding a rule is adding a row here.
//
//   id        stable rule ID (shown in the exception report)
//   scope     'record' (each record of `section`), 'supplier', or 'batch'
//   section   schema section key for record rules
//   severity  'error' blocks export, 'warning' needs review
//   type      check type (see CHECKS in engine.js)
//   params    check parameters
//   message   plain-language message; {label}, {value}, and check-specific
//             placeholders are filled in
//   fix       suggested fix for the exception report
//
// Rule types ported from the RAVN ValidationManifest intent: Missing (required),
// Match (match), MatchNumerous (match on multi values), Duplicatecolumn
// (duplicateInBatch), CheckDuplicateCombinationColumns (duplicateInSupplier),
// EnsureDataMultipleColumns (allOrNone), OneSelectionPerInstance (onePrimary),
// RequiredBetweenTabs (needsRecord), CheckBasedOnCondition (requiredIf),
// MatchValueorFormat (format), Email, Date, address and bank rules.

import { SECTIONS } from '../model/schema.js';

const R = (id, o) => ({ id, ...o });

// Required fields come straight from the schema (`required: true`), so the
// schema and the rules can't drift apart. Primary flags and the intermediary
// Order are covered by their own rules below.
const SKIP_REQUIRED = new Set(['supplierName@supplier', 'primary@addresses', 'primary@phones', 'primary@emails', 'primary@webAddresses', 'primary@taxIds']);
const requiredRules = SECTIONS.flatMap((s) =>
  s.columns
    .filter((c) => c.required && !(s.key !== 'supplier' && c.key === 'supplierName') && !SKIP_REQUIRED.has(`${c.key}@${s.key}`))
    .map((c) =>
      R(`REQ-${s.key}-${c.key}`, {
        scope: 'record', section: s.key, severity: 'error', type: 'required', params: { field: c.key },
        message: '{label} is required.', fix: 'Enter a value for {label}.',
      }),
    ),
);

const BOOL_FIELDS = SECTIONS.flatMap((s) => s.columns.filter((c) => c.type === 'bool').map((c) => ({ section: s.key, field: c.key })));
const DATE_FIELDS = SECTIONS.flatMap((s) => s.columns.filter((c) => c.type === 'date').map((c) => ({ section: s.key, field: c.key })));
const NUMBER_FIELDS = SECTIONS.flatMap((s) => s.columns.filter((c) => c.type === 'number').map((c) => ({ section: s.key, field: c.key })));

export const RULES = [
  R('REQ-supplier-name', { scope: 'record', section: 'supplier', severity: 'error', type: 'required', params: { field: 'supplierName' }, message: 'Supplier Name is required.', fix: 'Enter the supplier’s legal name.' }),
  ...requiredRules,

  // ------------------------------------------------------------ duplicates
  R('DUP-name', { scope: 'batch', severity: 'error', type: 'duplicateInBatch', params: { section: 'supplier', field: 'supplierName', normalize: 'name' }, message: 'An earlier supplier in this batch has the same name ({others}).', fix: 'Remove the duplicate, or exclude one of them from the load.' }),
  R('DUP-taxid', { scope: 'batch', severity: 'error', type: 'duplicateInBatch', params: { section: 'taxIds', field: 'taxId', normalize: 'digits' }, message: 'Tax ID {value} is already used by {others}.', fix: 'Check whether these are the same supplier. Keep one, or correct the tax ID.' }),
  R('DUP-account', { scope: 'batch', severity: 'error', type: 'duplicateInBatch', params: { section: 'settlementAccounts', field: 'accountNumber', normalize: 'alnum', with: 'routingNumber' }, message: 'This bank account is already used by {others}.', fix: 'Check whether these are the same supplier. Keep one, or correct the account.' }),
  R('DUP-existing', { scope: 'supplier', severity: 'warning', type: 'existingSupplier', message: 'Possible duplicate of existing supplier {existing} ({why}).', fix: 'Confirm this is a new supplier. If it already exists in Workday, remove it from the load.' }),
  R('DUP-email-in-supplier', { scope: 'supplier', severity: 'warning', type: 'duplicateInSupplier', params: { section: 'emails', fields: ['emailAddress'] }, message: 'Email {value} is listed more than once.', fix: 'Remove the extra row.' }),
  R('DUP-taxtype-in-supplier', { scope: 'supplier', severity: 'error', type: 'duplicateInSupplier', params: { section: 'taxIds', fields: ['taxIdCountry', 'taxIdType'] }, message: 'There is more than one {value} tax ID.', fix: 'Keep one tax ID per country and type.' }),

  // ------------------------------------------------- one primary per type
  ...[
    ['addresses', 'address'], ['phones', 'phone'], ['emails', 'email'], ['webAddresses', 'web address'], ['taxIds', 'tax ID'],
  ].map(([section, noun]) =>
    R(`PRIMARY-${section}`, {
      scope: 'supplier', severity: 'error', type: 'onePrimary', params: { section, field: 'primary', noun },
      message: `Exactly one ${noun} must be marked Primary (found {count}).`, fix: `Mark one ${noun} as Primary = Yes and the others No.`,
    }),
  ),
  R('NEEDS-address', { scope: 'supplier', severity: 'warning', type: 'needsRecord', params: { section: 'addresses' }, message: 'This supplier has no address.', fix: 'Add at least a remit-to address.' }),

  // ------------------------------------------------------------- payments
  R('PAY-default-in-accepted', { scope: 'supplier', severity: 'error', type: 'defaultInAccepted', message: 'Default Payment Type {value} is not one of the Payment Types Accepted ({accepted}).', fix: 'Add {value} to Payment Types Accepted, or pick a different default.' }),
  R('PAY-electronic-needs-account', { scope: 'supplier', severity: 'error', type: 'electronicNeedsAccount', params: { types: ['EFT', 'Wire', 'Direct_Deposit', 'Direct Deposit', 'ACH'] }, message: 'Accepts {types} but has no settlement bank account.', fix: 'Add a bank account, or remove {types} from Payment Types Accepted.' }),

  // ------------------------------------------------------- conditionals
  R('COND-status-reason', { scope: 'record', section: 'supplier', severity: 'error', type: 'requiredIf', params: { field: 'statusReason', when: { field: 'status', test: 'notIn', value: ['', 'Active'] } }, message: 'Status Reason is required when Supplier Status is {whenValue}.', fix: 'Pick a Status Reason, or set the status to Active.' }),
  R('COND-form-type', { scope: 'record', section: 'supplier', severity: 'error', type: 'requiredIf', params: { field: 'taxAuthorityFormType', when: { field: 'irs1099', test: 'eq', value: 'Yes' } }, message: 'Tax Authority Form Type is required for 1099 suppliers.', fix: 'Pick the form type, for example 1099 (Misc/NEC).' }),
  R('COND-min-order-currency', { scope: 'record', section: 'payment', severity: 'error', type: 'requiredIf', params: { field: 'minimumOrderCurrency', when: { field: 'minimumOrderAmount', test: 'nonZero' } }, message: 'Minimum Order Amount Currency is required when a minimum order amount is set.', fix: 'Enter the currency, for example USD.' }),
  R('COND-asn-days', { scope: 'record', section: 'payment', severity: 'error', type: 'requiredIf', params: { field: 'asnDueDays', when: { field: 'enableAsn', test: 'eq', value: 'Yes' } }, message: 'ASN Due In Days is required when ASN is enabled.', fix: 'Enter the number of days.' }),
  R('COND-po-email', { scope: 'record', section: 'payment', severity: 'error', type: 'requiredIf', params: { field: 'poIssueEmails', when: { field: 'poIssueOption', test: 'eq', value: 'Email' } }, message: 'Default PO Issue Email is required when POs are issued by email.', fix: 'Enter the email address POs should go to.' }),
  R('COND-prenote-type', { scope: 'record', section: 'settlementAccounts', severity: 'error', type: 'requiredIf', params: { field: 'prenotePaymentType', when: { field: 'requiresPrenote', test: 'eq', value: 'Yes' } }, message: 'Payment Type Prenote is required when a prenote is required.', fix: 'Pick the payment type to prenote, usually EFT.' }),

  // ------------------------------------------------------------- formats
  R('FMT-email', { scope: 'record', section: 'emails', severity: 'error', type: 'format', params: { field: 'emailAddress', validator: 'email' }, message: '"{value}" is not a valid email address.', fix: 'Correct the email address.' }),
  R('FMT-po-email', { scope: 'record', section: 'payment', severity: 'error', type: 'format', params: { field: 'poIssueEmails', validator: 'email' }, message: '"{value}" is not a valid email address.', fix: 'Correct the PO issue email.' }),
  R('FMT-url', { scope: 'record', section: 'webAddresses', severity: 'error', type: 'format', params: { field: 'webAddress', validator: 'url' }, message: '"{value}" is not a valid web address.', fix: 'Enter a full web address, for example https://www.example.com.' }),
  ...DATE_FIELDS.map(({ section, field }) => R(`FMT-date-${section}-${field}`, { scope: 'record', section, severity: 'error', type: 'format', params: { field, validator: 'isoDate' }, message: '{label} "{value}" is not a valid date (YYYY-MM-DD).', fix: 'Enter the date as YYYY-MM-DD.' })),
  ...BOOL_FIELDS.map(({ section, field }) => R(`FMT-bool-${section}-${field}`, { scope: 'record', section, severity: 'error', type: 'format', params: { field, validator: 'bool' }, message: '{label} must be Yes or No (found "{value}").', fix: 'Enter Yes or No.' })),
  ...NUMBER_FIELDS.map(({ section, field }) => R(`FMT-num-${section}-${field}`, { scope: 'record', section, severity: 'error', type: 'format', params: { field, validator: 'number' }, message: '{label} must be a number (found "{value}").', fix: 'Enter a number.' })),

  // ------------------------------------------------------------- addresses
  R('ADDR-country-rules', { scope: 'record', section: 'addresses', severity: 'error', type: 'addressRules', message: '{label} is {rule} for addresses in {country}.', fix: '{fixText}' }),
  R('ADDR-bank-country-rules', { scope: 'record', section: 'bankAddresses', severity: 'error', type: 'addressRules', message: '{label} is {rule} for addresses in {country}.', fix: '{fixText}' }),
  R('ADDR-us-postal', { scope: 'record', section: 'addresses', severity: 'error', type: 'usPostal', message: 'US postal code "{value}" should be ##### or #####-####.', fix: 'Correct the ZIP code.' }),
  R('ADDR-bank-us-postal', { scope: 'record', section: 'bankAddresses', severity: 'error', type: 'usPostal', message: 'US postal code "{value}" should be ##### or #####-####.', fix: 'Correct the ZIP code.' }),

  // ------------------------------------------------------------------ bank
  R('BANK-country-rules', { scope: 'record', section: 'settlementAccounts', severity: 'error', type: 'bankRules', message: '{message}', fix: '{fixText}' }),
  R('BANK-intermediary-country-rules', { scope: 'record', section: 'intermediaryBanks', severity: 'error', type: 'bankRules', message: '{message}', fix: '{fixText}' }),
  R('BANK-aba', { scope: 'record', section: 'settlementAccounts', severity: 'error', type: 'abaChecksum', message: 'Routing number {value} fails the ABA checksum.', fix: 'Check the routing number with the supplier’s bank letter or voided check.' }),
  R('BANK-intermediary-aba', { scope: 'record', section: 'intermediaryBanks', severity: 'error', type: 'abaChecksum', message: 'Routing number {value} fails the ABA checksum.', fix: 'Check the routing number.' }),
  R('BANK-iban', { scope: 'record', section: 'settlementAccounts', severity: 'error', type: 'format', params: { field: 'iban', validator: 'iban' }, message: 'IBAN {value} fails the IBAN check.', fix: 'Check the IBAN with the supplier.' }),
  R('BANK-intermediary-iban', { scope: 'record', section: 'intermediaryBanks', severity: 'error', type: 'format', params: { field: 'iban', validator: 'iban' }, message: 'IBAN {value} fails the IBAN check.', fix: 'Check the IBAN.' }),
  R('BANK-bic', { scope: 'record', section: 'settlementAccounts', severity: 'error', type: 'format', params: { field: 'swift', validator: 'bic' }, message: 'SWIFT/BIC "{value}" should be 8 or 11 letters and digits.', fix: 'Check the SWIFT/BIC code.' }),
  R('BANK-intermediary-bic', { scope: 'record', section: 'intermediaryBanks', severity: 'error', type: 'format', params: { field: 'swift', validator: 'bic' }, message: 'SWIFT/BIC "{value}" should be 8 or 11 letters and digits.', fix: 'Check the SWIFT/BIC code.' }),
  R('BANK-intermediary-order', { scope: 'record', section: 'intermediaryBanks', severity: 'error', type: 'required', params: { field: 'order' }, message: 'Order is required for intermediary banks.', fix: 'Number the intermediaries 1, 2, ...' }),

  // ------------------------------------------------------------------ tax
  R('TAX-us-format', { scope: 'record', section: 'taxIds', severity: 'error', type: 'usTaxIdFormat', message: '{value} is not a valid {kind} ({expected}).', fix: 'Correct the tax ID, or check the Tax ID Type.' }),
  R('TAX-ein-prefix', { scope: 'record', section: 'taxIds', severity: 'warning', type: 'einPrefix', message: 'EIN {value} starts with {prefix}, which isn’t on the IRS’s published list of EIN prefixes.', fix: 'Double-check the EIN against the supplier’s W-9.' }),
  R('TAX-transaction-allowed', { scope: 'record', section: 'taxIds', severity: 'error', type: 'transactionTaxId', message: '{type} can’t be a Transaction Tax ID in {country}.', fix: 'Set Transaction Tax ID to No.' }),

  // ------------------------------------------------------------ references
  R('REF-unresolved', { scope: 'supplier', severity: 'error', type: 'refStatus', params: { status: 'unresolved' }, message: '{label} "{value}" doesn’t match a Workday value.', fix: 'Pick the right Workday value on the Reference IDs step, or add a value mapping rule.' }),
  R('REF-assumed', { scope: 'supplier', severity: 'warning', type: 'refStatus', params: { status: 'assumed' }, message: '{label} "{value}" will load as {id}, which is assumed.', fix: 'Confirm {id} on the Reference IDs step, or load tenant values.' }),

  // ---------------------------------------------------------- ingest notes
  R('INGEST-notes', { scope: 'supplier', severity: 'from-note', type: 'ingestNotes', message: '{message}', fix: '{fixText}' }),
];

export const RULE_BY_ID = Object.fromEntries(RULES.map((r) => [r.id, r]));
