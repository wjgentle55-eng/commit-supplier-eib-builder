// Mapping targets for loose tables: every schema column a source column can
// feed, with header synonyms used by the auto-guesser.

import { SECTIONS } from '../model/schema.js';

// Extra header synonyms, keyed "section.field". Labels themselves always match.
const SYNONYMS = {
  'supplier.supplierName': ['vendor', 'vendor name', 'supplier', 'name', 'company', 'company name', 'payee', 'payee name', 'legal name', 'vendor legal name'],
  'supplier.supplierId': ['vendor id', 'vendor number', 'vendor no', 'vendor #', 'supplier number', 'supplier #', 'supplier no'],
  'supplier.category': ['vendor type', 'vendor category', 'category', 'supplier type', 'type', 'vendor class', 'classification'],
  'supplier.groups': ['vendor group', 'supplier group', 'group', 'groups'],
  'supplier.status': ['status', 'vendor status', 'active status'],
  'supplier.defaultCurrency': ['currency', 'currency code', 'vendor currency', 'default currency', 'ccy'],
  'supplier.acceptedCurrencies': ['accepted currencies', 'other currencies'],
  'supplier.restrictedToCompanies': ['company', 'companies', 'subsidiary', 'subsidiaries', 'entity', 'restricted companies'],
  'supplier.irs1099': ['1099', '1099 vendor', 'is 1099', '1099 eligible', '1099 flag', 'irs 1099'],
  'supplier.taxAuthorityFormType': ['1099 type', '1099 form', 'form type', 'tax form'],
  'supplier.duns': ['duns', 'duns #', 'duns no'],
  'supplier.uei': ['uei', 'sam uei'],
  'supplier.customerAccountNumber': ['our account number', 'account # with vendor', 'customer number', 'customer account'],
  'supplier.note': ['notes', 'note', 'memo', 'comments'],
  'payment.paymentTerms': ['terms', 'payment terms', 'pay terms', 'term'],
  'payment.paymentTypesAccepted': ['payment method', 'pay method', 'payment type', 'payment types', 'pay method 1', 'pay method 2', 'pay method 3', 'payment method 1', 'payment method 2', 'payment methods'],
  'payment.defaultPaymentType': ['default pay method', 'default payment method', 'preferred payment method', 'primary payment method'],
  'payment.poIssueEmails': ['po email', 'purchase order email', 'po emails'],
  'payment.shippingTerms': ['freight terms', 'fob'],
  'payment.shippingMethod': ['ship via', 'ship method'],
  'addresses.addressLine1': ['street', 'address', 'address 1', 'street 1', 'street address', 'addr1', 'address line1', 'line 1'],
  'addresses.addressLine2': ['street 2', 'address 2', 'addr2', 'suite', 'address line2', 'line 2'],
  'addresses.addressLine3': ['street 3', 'address 3', 'addr3'],
  'addresses.city': ['city', 'town', 'municipality'],
  'addresses.region': ['state', 'province', 'region', 'state/province', 'st', 'county/state'],
  'addresses.postalCode': ['zip', 'zip code', 'postal', 'postcode', 'post code', 'postal code', 'zipcode'],
  'addresses.country': ['country', 'country code', 'nation'],
  'addresses.useFor': ['address purpose', 'address type', 'address use', 'use for', 'address usage'],
  'addresses.primary': ['main address', 'primary address', 'is primary', 'default address'],
  'addresses.addressLabel': ['address label', 'address name', 'location name', 'site'],
  'phones.phoneNumber': ['phone', 'phone number', 'telephone', 'tel', 'main phone', 'phone #', 'office phone'],
  'phones.areaCode': ['area code'],
  'phones.extension': ['ext', 'extension', 'phone ext'],
  'phones.deviceType': ['phone type', 'device type'],
  'emails.emailAddress': ['email', 'e-mail', 'email address', 'remit email', 'ap email', 'contact email', 'vendor email'],
  'webAddresses.webAddress': ['website', 'web', 'url', 'web site', 'homepage', 'web address'],
  'taxIds.taxId': ['tax id', 'tin', 'ein', 'fein', 'federal id', 'ssn', 'tax number', 'vat number', 'vat', 'tax id number', 'federal tax id', 'gst number'],
  'taxIds.taxIdType': ['tax id type', 'tin type'],
  'taxIds.taxIdCountry': ['tax country', 'tax id country'],
  'settlementAccounts.bankName': ['bank', 'bank name', 'financial institution'],
  'settlementAccounts.accountNumber': ['bank account', 'account number', 'bank acct #', 'bank account number', 'acct #', 'account #', 'acct no', 'bank acct', 'acct number'],
  'settlementAccounts.routingNumber': ['aba', 'routing', 'routing number', 'aba number', 'aba #', 'routing #', 'transit number', 'bank code', 'sort code', 'bsb'],
  'settlementAccounts.iban': ['iban'],
  'settlementAccounts.swift': ['swift', 'bic', 'swift code', 'swift/bic', 'bic code'],
  'settlementAccounts.accountType': ['account type', 'bank account type', 'acct type'],
  'settlementAccounts.nameOnAccount': ['name on account', 'account name', 'account holder', 'beneficiary name', 'beneficiary'],
  'settlementAccounts.bankCountry': ['bank country'],
  'settlementAccounts.currency': ['bank currency', 'account currency'],
  'alternateNames.alternateName': ['dba', 'doing business as', 'alternate name', 'alias', 'trade name', 'remit to name', 'check name', 'print on check as', 'pay to name'],
};

// Implied values: mapping a column to the key target also suggests these
// constant defaults for the same record, e.g. an "EIN" column is a US EIN.
export const IMPLIED_DEFAULTS = {
  ein: [
    { section: 'taxIds', field: 'taxIdType', value: 'Employer ID Number' },
    { section: 'taxIds', field: 'taxIdCountry', value: 'United States of America' },
    { section: 'taxIds', field: 'primary', value: 'Yes' },
  ],
  fein: [
    { section: 'taxIds', field: 'taxIdType', value: 'Employer ID Number' },
    { section: 'taxIds', field: 'taxIdCountry', value: 'United States of America' },
    { section: 'taxIds', field: 'primary', value: 'Yes' },
  ],
  ssn: [
    { section: 'taxIds', field: 'taxIdType', value: 'SSN or ITIN' },
    { section: 'taxIds', field: 'taxIdCountry', value: 'United States of America' },
    { section: 'taxIds', field: 'primary', value: 'Yes' },
  ],
};

export const MAP_SECTIONS = SECTIONS.filter((s) => s.key !== 'intermediaryBanks' && s.key !== 'bankAddresses');

export const TARGETS = MAP_SECTIONS.flatMap((s) =>
  s.columns
    .filter((c) => !(s.key !== 'supplier' && (c.key === 'supplierName' || c.key === 'supplierId')))
    .map((c) => ({
      id: `${s.key}.${c.key}`,
      section: s.key,
      field: c.key,
      label: c.label,
      sectionLabel: s.tab,
      multi: c.multi,
      type: c.type,
      synonyms: [c.label, ...(SYNONYMS[`${s.key}.${c.key}`] ?? [])],
    })),
);

export const TARGET_BY_ID = Object.fromEntries(TARGETS.map((t) => [t.id, t]));
