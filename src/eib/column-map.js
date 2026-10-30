// Column map: every value the tool writes, keyed to its exact EIB column by
// Area (row 2) + Field (row 5) + occurrence. Reviewed by hand against
// reference/Submit_Supplier_Blank.xlsx (v44.1). tests/column-map.test.js fails
// if any key stops matching the template.

import template from './template-columns.json';

const A = {
  all: 'All',
  bp: 'Business Process Parameters (All)',
  sup: 'Supplier Data (All)',
  taxId: 'Tax ID Data+ (All > Supplier Data > Tax ID Widget Data)',
  taxStatus: 'Tax Status Data+ (All > Supplier Data > Tax Status Widget Data)',
  poEmail: 'Default PO Issue Email Data+ (All > Supplier Data > Default PO Issue Email WWS Widget Data)',
  be: 'Business Entity Data (All > Supplier Data)',
  phone: 'Phone Data+ (All > Supplier Data > Business Entity Data > Contact Data)',
  email: 'Email Address Data+ (All > Supplier Data > Business Entity Data > Contact Data)',
  web: 'Web Address Data+ (All > Supplier Data > Business Entity Data > Contact Data)',
  sba: 'Settlement Account Data+ (All > Supplier Data > Settlement Account Widget Data)',
  iba: 'Intermediary Bank Data+ (All > Supplier Data > Settlement Account Widget Data > Settlement Account Data+ > Intermediary Bank Widget Data)',
  status: 'Supplier Status Data+ (All > Supplier Data)',
  cls: 'Supplier Classification Data+ (All > Supplier Data > Supplier Classification Widget Data)',
  clsField: 'Supplier Classification Field Interface Data+ (All > Supplier Data > Supplier Classification Widget Data > Supplier Classification Data+)',
  alt: 'Business Entity Alternate Name Data+ (All > Supplier Data > Business Entity Alternate Name Widget Data)',
  note: 'Note Data+ (All > Supplier Data > Note Widget Data)',
  wt: 'Related Worktags by Type Data+ (All > Supplier Data > Related Worktag Data)',
  wtDefault: 'Default Worktag Data (All > Supplier Data > Related Worktag Data > Related Worktags by Type Data+)',
  wtAllowed: 'Allowed Worktag Data+ (All > Supplier Data > Related Worktag Data > Related Worktags by Type Data+)',
};

// Address blocks repeat under three parents with the same field layout.
const ADDRESS_PARENTS = {
  contact: 'All > Supplier Data > Business Entity Data > Contact Data',
  sba: 'All > Supplier Data > Settlement Account Widget Data > Settlement Account Data+',
  iba: 'All > Supplier Data > Settlement Account Widget Data > Settlement Account Data+ > Intermediary Bank Widget Data > Intermediary Bank Data+',
};

function addressBlock(parent) {
  const addr = `Address Data+ (${parent})`;
  const sub = (name) => `${name} (${parent} > Address Data+)`;
  const usage = `Usage Data+ (${parent} > Address Data+)`;
  return {
    rowId: [addr, 'Row ID*'],
    effectiveDate: [addr, 'Effective Date'],
    country: [addr, 'Country'],
    lineRowId: [sub('Address Line Data+'), 'Row ID*'],
    lineType: [sub('Address Line Data+'), 'Type'],
    lineData: [sub('Address Line Data+'), 'Address Line Data'],
    municipality: [addr, 'Municipality'],
    subMuniRowId: [sub('Submunicipality Data+'), 'Row ID*'],
    subMuniType: [sub('Submunicipality Data+'), 'Type'],
    subMuniData: [sub('Submunicipality Data+'), 'Submunicipality Data'],
    region: [addr, 'Country Region'],
    subRegionRowId: [sub('Subregion Data+'), 'Row ID*'],
    subRegionType: [sub('Subregion Data+'), 'Type'],
    subRegionData: [sub('Subregion Data+'), 'Subregion Data'],
    postalCode: [addr, 'Postal Code'],
    ...usageBlock(usage, `Type Data+ (${parent} > Address Data+ > Usage Data+)`),
    addressId: [addr, 'Address ID'],
  };
}

function usageBlock(usage, type) {
  return {
    usageRowId: [usage, 'Row ID*'],
    public: [usage, 'Public'],
    typeRowId: [type, 'Row ID**'],
    primary: [type, 'Primary'],
    usageType: [type, 'Type*'],
    useFor: [usage, 'Use For+'],
    comments: [usage, 'Comments'],
  };
}

const C = (parent) => `(All > Supplier Data > Business Entity Data > Contact Data > ${parent})`;

export const MAP = {
  key: [A.all, 'Spreadsheet Key*'],
  autoComplete: [A.bp, 'Auto Complete'],

  supplier: {
    supplierId: [A.sup, 'Supplier ID'],
    supplierName: [A.sup, 'Supplier Name'],
    worktagOnly: [A.sup, 'Worktag Only'],
    restrictedToCompanies: [A.sup, 'Restricted To Companies+'],
    approvalStatus: [A.sup, 'Approval Status'],
    taxAuthorityFormType: [A.sup, 'Tax Authority Form Type'],
    irs1099: [A.sup, 'IRS 1099 Supplier'],
    report1099WithParent: [A.sup, 'Report 1099 with Parent'],
    category: [A.sup, 'Supplier Category'],
    groups: [A.sup, 'Supplier Group+'],
    taxDocumentDate: [A.sup, 'Tax Document Date'],
    defaultTaxCode: [A.sup, 'Default Tax Code'],
    defaultWithholdingTaxCode: [A.sup, 'Default Withholding Tax Code'],
    supplierSource: [A.sup, 'Supplier Source'],
    supplierChangeSource: [A.sup, 'Supplier Change Source'],
    fatca: [A.sup, 'FATCA'],
    coiDate: [A.sup, 'Certificate of Insurance Date'],
    customerAccountNumber: [A.sup, 'Customer Account Number'],
    duns: [A.sup, 'DUNS Number'],
    uei: [A.sup, 'Unique Entity Identifier'],
    restrictedCompaniesForContacts: [A.sup, 'Restricted Companies for Supplier Contacts+'],
    includedChildren: [A.sup, 'Included Children+'],
    proposedChildren: [A.sup, 'Proposed Children+'],
    businessEntityName: [A.be, 'Business Entity Name'],
    externalEntityId: [A.be, 'External Entity ID'],
    defaultCurrency: [A.sup, 'Currency'],
    acceptedCurrencies: [A.sup, 'Accepted Currencies+'],
    integrationSystem: [A.sup, 'Integration System'],
    doNotReimburseCwExpenses: [A.sup, 'Do Not Reimburse Contingent Worker Expense Reports'],
    securitySegment: [A.sup, 'Supplier Security Segment'],
    noteFollowUpDate: [A.sup, 'Supplier Note Follow-Up Date'],
    spendCategoriesOrHierarchies: [A.sup, 'Spend Category or Hierarchy+'],
  },
  payment: {
    invoiceAnySupplier: [A.sup, 'Invoice Any Supplier'],
    editPortalTaxes: [A.sup, 'Edit Portal Taxes'],
    enableGln: [A.sup, 'Enable Global Location Number'],
    disableChangeOrder: [A.sup, 'Disable Change Order'],
    poIssueOption: [A.sup, 'Purchase Order Issue Option'],
    changeOrderIssueOption: [A.sup, 'Change Order Issue Option'],
    multiSupplierLink: [A.sup, 'Multi-Supplier Supplier Link for PO Issue'],
    shippingTerms: [A.sup, 'Shipping Terms'],
    shippingMethod: [A.sup, 'Shipping Method'],
    acknowledgementExpected: [A.sup, 'Acknowledgement Expected'],
    minimumOrderAmount: [A.sup, 'Supplier Minimum Order Amount'],
    minimumOrderCurrency: [A.sup, 'Minimum Order Amount Currency'],
    leadTimeDays: [A.sup, 'Supplier Lead Time'],
    enableAsn: [A.sup, 'Enable ASN'],
    asnDueDays: [A.sup, 'ASN Due In Days'],
    overrideDiscountExclusion: [A.sup, 'Overrides Tenant Setup for Supplier Invoice Discount Exclusion'],
    excludeFreight: [A.sup, 'Exclude Freight Amount from Supplier Invoice Discount'],
    excludeOtherCharges: [A.sup, 'Exclude Other Charges from Supplier Invoice Discount'],
    excludeTax: [A.sup, 'Exclude Tax Amount from Supplier Invoice Discount'],
    paymentTerms: [A.sup, 'Payment Terms'],
    termsBasedOnInvoiceReceived: [A.sup, 'Terms Based on Invoice Received Date'],
    paymentTypesAccepted: [A.sup, 'Payment Types Accepted+'],
    defaultPaymentType: [A.sup, 'Default Payment Type'],
    procurementCreditCard: [A.sup, 'Procurement Credit Card'],
    doNotPayDuringBankUpdates: [A.sup, 'Do not pay during Bank Account updates'],
    alwaysSeparatePayments: [A.sup, 'Always Separate Payments'],
    defaultPaymentMemo: [A.sup, 'Text for Default Supplier Payment Memo'],
    useSupplierReferenceMemo: [A.sup, 'Use Supplier Reference as Default Supplier Payment Memo'],
    useInvoiceMemo: [A.sup, 'Use Invoice Memo as Default Supplier Payment Memo'],
    useConnectionMemo: [A.sup, 'Use Supplier Connection Memo'],
    defaultProcurementItem: [A.sup, 'Default Procurement Item'],
    defaultSpendCategory: [A.sup, 'Default Spend Category'],
  },
  poEmail: { rowId: [A.poEmail, 'Row ID**'], email: [A.poEmail, 'Email Address'] },
  taxId: { rowId: [A.taxId, 'Row ID**'], taxId: [A.taxId, 'Tax ID Text'], type: [A.taxId, 'Tax ID Type*'], transaction: [A.taxId, 'Transaction Tax ID'], primary: [A.taxId, 'Primary Tax ID'] },
  taxStatus: { rowId: [A.taxStatus, 'Row ID**'], country: [A.taxStatus, 'Country*'], transaction: [A.taxStatus, 'Transaction Tax Status'], withholding: [A.taxStatus, 'Withholding Tax Status'] },
  status: { rowId: [A.status, 'Row ID*'], status: [A.status, 'Status*'], reason: [A.status, 'Reason'], description: [A.status, 'Reason Description'] },

  address: addressBlock(ADDRESS_PARENTS.contact),
  phone: {
    rowId: [A.phone, 'Row ID*'],
    areaCode: [A.phone, 'Area Code'],
    countryIso: [A.phone, 'Country ISO Code'],
    intlCode: [A.phone, 'International Phone Code'],
    number: [A.phone, 'Phone Number'],
    extension: [A.phone, 'Phone Extension'],
    deviceType: [A.phone, 'Phone Device Type'],
    ...usageBlock(`Usage Data+ ${C('Phone Data+')}`, `Type Data+ ${C('Phone Data+ > Usage Data+')}`),
  },
  email: {
    rowId: [A.email, 'Row ID*'],
    address: [A.email, 'Email Address'],
    comment: [A.email, 'Email Comment'],
    ...usageBlock(`Usage Data+ ${C('Email Address Data+')}`, `Type Data+ ${C('Email Address Data+ > Usage Data+')}`),
  },
  web: {
    rowId: [A.web, 'Row ID*'],
    address: [A.web, 'Web Address'],
    comment: [A.web, 'Web Address Comment'],
    ...usageBlock(`Usage Data+ ${C('Web Address Data+')}`, `Type Data+ ${C('Web Address Data+ > Usage Data+')}`),
  },

  sba: {
    rowId: [A.sba, 'Row ID**'],
    accountId: [A.sba, 'Settlement Bank Account ID'],
    country: [A.sba, 'Country'],
    currency: [A.sba, 'Currency'],
    nickname: [A.sba, 'Bank Account Nickname'],
    accountType: [A.sba, 'Bank Account Type'],
    bankName: [A.sba, 'Bank Name'],
    routing: [A.sba, 'Routing Transit Number'],
    branchId: [A.sba, 'Branch ID'],
    branchName: [A.sba, 'Branch Name'],
    accountNumber: [A.sba, 'Bank Account Number'],
    checkDigit: [A.sba, 'Check Digit'],
    accountName: [A.sba, 'Bank Account Name'],
    rollNumber: [A.sba, 'Roll Number'],
    iban: [A.sba, 'IBAN'],
    swift: [A.sba, 'SWIFT Bank Identification Code'],
    acceptsPaymentTypes: [A.sba, 'Accepts Payment Types+'],
    paymentTypes: [A.sba, 'Payment Types+'],
    forConnectionsOnly: [A.sba, 'For Supplier Connections Only'],
    requiresPrenote: [A.sba, 'Requires Prenote'],
    prenoteType: [A.sba, 'Payment Type Prenote'],
    inactive: [A.sba, 'Inactive'],
    instructions: [A.sba, 'Bank Instructions'],
  },
  sbaAddress: addressBlock(ADDRESS_PARENTS.sba),
  iba: {
    rowId: [A.iba, 'Row ID**'],
    accountId: [A.iba, 'Intermediary Bank Account ID'],
    order: [A.iba, 'Intermediary Bank Order'],
    country: [A.iba, 'Country'],
    currency: [A.iba, 'Currency'],
    nickname: [A.iba, 'Bank Account Nickname'],
    accountType: [A.iba, 'Bank Account Type'],
    bankName: [A.iba, 'Bank Name'],
    routing: [A.iba, 'Routing Transit Number'],
    branchId: [A.iba, 'Branch ID'],
    branchName: [A.iba, 'Branch Name'],
    accountNumber: [A.iba, 'Bank Account Number'],
    checkDigit: [A.iba, 'Check Digit'],
    accountName: [A.iba, 'Bank Account Name'],
    rollNumber: [A.iba, 'Roll Number'],
    iban: [A.iba, 'IBAN'],
    swift: [A.iba, 'SWIFT Bank Identification Code'],
    inactive: [A.iba, 'Inactive'],
    instructions: [A.iba, 'Bank Instructions'],
  },
  ibaAddress: addressBlock(ADDRESS_PARENTS.iba),

  classification: {
    rowId: [A.cls, 'Row ID**'],
    classification: [A.cls, 'Supplier Classification*'],
    fieldRowId: [A.clsField, 'Row ID*'],
    field: [A.clsField, 'Supplier Classification Field*'],
    text: [A.clsField, 'Field Text Value'],
    multiChoice: [A.clsField, 'Field Multi Select Choice+'],
  },
  alternateName: { rowId: [A.alt, 'Row ID**'], name: [A.alt, 'Alternate Name*'], usage: [A.alt, 'Alternate Name Usage*+*'] },
  note: { rowId: [A.note, 'Row ID**'], content: [A.note, 'Note Content'] },
  worktag: {
    rowId: [A.wt, 'Row ID*'],
    type: [A.wt, 'Worktag Type'],
    required: [A.wt, 'Required On Transaction'],
    requiredForValidation: [A.wt, 'Required On Transaction For Validation'],
    defaultWorktag: [A.wtDefault, 'Default Worktag'],
    allowedRowId: [A.wtAllowed, 'Row ID*'],
    allowed: [A.wtAllowed, 'Allowed Worktag'],
  },
};

// --------------------------------------------------------------- resolve

const byKey = new Map(template.columns.map((c) => [`${c.area} :: ${c.field}`, c]));

/** Resolves every [area, field] pair in MAP to its 1-based column index. Throws on any miss. */
function resolveAll(node, path = []) {
  if (Array.isArray(node)) {
    const [area, field, occurrence = 1] = node;
    const hits = template.columns.filter((c) => c.area === area && c.field === field);
    const col = hits[occurrence - 1];
    if (!col) throw new Error(`EIB column not found: ${path.join('.')} -> ${area} :: ${field}`);
    return col.index;
  }
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, resolveAll(v, [...path, k])]));
}

export const COL = resolveAll(MAP);

/** All mapped columns as a flat list (for tests and the never-write check). */
export function mappedColumns(node = COL, out = []) {
  for (const v of Object.values(node)) typeof v === 'number' ? out.push(v) : mappedColumns(v, out);
  return out;
}

export const columnInfo = (index) => template.columns[index - 1];
export { byKey };
