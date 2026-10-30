// Supplier data model, described as data.
//
// Each section mirrors one Conversion Workbook tab. Column `label` is the
// workbook header (without the trailing "+"), which is also the canonical
// field name shown in the app. `multi` marks multi-value fields, `type` drives
// normalization, and `ref` names the Workday reference ID type the field
// resolves to in the Reference IDs step (from EIB row 4).
//
// Sections with `many: true` hold several records per supplier.

const T = (key, label, opts = {}) => ({ key, label, type: 'text', multi: false, ...opts });
const B = (key, label, opts = {}) => T(key, label, { type: 'bool', ...opts });
const D = (key, label, opts = {}) => T(key, label, { type: 'date', ...opts });
const N = (key, label, opts = {}) => T(key, label, { type: 'number', ...opts });
const R = (key, label, ref, opts = {}) => T(key, label, { ref, ...opts });

const NAME = T('supplierName', 'Supplier Name', { required: true });
const SID = T('supplierId', 'Supplier ID');

const ADDRESS_PARTS = [
  R('country', 'Country', 'ISO_3166-1_Alpha-2_Code', { required: true }),
  R('region', 'Region', 'Country_Region_ID'),
  T('subregion', 'Subregion'),
  T('city', 'City'),
  T('submunicipality', 'Submunicipality'),
  T('citySubdivision', 'City Subdivision'),
  T('addressLine1', 'Address Line 1', { required: true }),
  T('addressLine2', 'Address Line 2'),
  T('addressLine3', 'Address Line 3'),
  T('addressLine4', 'Address Line 4'),
  T('postalCode', 'Postal Code', { keepText: true }),
  D('effectiveDate', 'Effective Date'),
];

const BANK_PARTS = [
  R('bankCountry', 'Bank Country', 'ISO_3166-1_Alpha-2_Code', { required: true }),
  R('currency', 'Currency', 'Currency_ID', { required: true }),
  R('accountType', 'Account Type', 'Bank_Account_Type_Code', { required: true }),
  T('bankName', 'Bank Name', { required: true }),
  T('nameOnAccount', 'Name on Account'),
  T('accountNumber', 'Bank Account Number', { required: true, keepText: true, sensitive: true }),
  T('accountNickname', 'Account Nickname'),
  T('routingNumber', 'Routing Number / Bank Code', { keepText: true }),
  T('iban', 'IBAN', { keepText: true, sensitive: true }),
  T('swift', 'SWIFT / BIC'),
  T('branchId', 'Branch ID', { keepText: true }),
  T('branchName', 'Branch Name'),
  T('rollNumber', 'Roll Number', { keepText: true }),
  T('checkDigit', 'Check Digit', { keepText: true }),
];

export const SECTIONS = [
  {
    key: 'supplier',
    tab: 'Suppliers',
    many: false,
    columns: [
      NAME,
      SID,
      T('businessEntityName', 'Business Entity Name'),
      R('category', 'Supplier Category', 'Supplier_Category_ID', { required: true }),
      R('groups', 'Supplier Groups', 'Supplier_Group_ID', { multi: true }),
      R('status', 'Supplier Status', 'Business_Entity_Status_Value_ID'),
      R('statusReason', 'Status Reason', 'Reason_for_Supplier_Status_Change_ID'),
      T('statusReasonDescription', 'Status Reason Description'),
      R('defaultCurrency', 'Default Currency', 'Currency_ID', { required: true }),
      R('acceptedCurrencies', 'Accepted Currencies', 'Currency_ID', { multi: true }),
      R('restrictedToCompanies', 'Restricted to Companies', 'Company_Reference_ID', { multi: true }),
      R('restrictedCompaniesForContacts', 'Restricted Companies for Supplier Contacts', 'Company_Reference_ID', { multi: true }),
      B('irs1099', 'IRS 1099 Supplier'),
      R('taxAuthorityFormType', 'Tax Authority Form Type', 'Tax_Authority_Form_Type'),
      B('report1099WithParent', 'Report 1099 with Parent'),
      D('taxDocumentDate', 'Tax Document Date'),
      R('defaultTaxCode', 'Default Tax Code', 'Tax_Code_ID'),
      R('defaultWithholdingTaxCode', 'Default Withholding Tax Code', 'Tax_Code_ID'),
      B('fatca', 'FATCA'),
      T('duns', 'DUNS Number', { keepText: true }),
      T('uei', 'Unique Entity Identifier', { keepText: true }),
      T('customerAccountNumber', 'Customer Account Number', { keepText: true }),
      D('coiDate', 'Certificate of Insurance Date'),
      T('externalEntityId', 'External Entity ID', { keepText: true }),
      R('supplierSource', 'Supplier Source', 'External_Supplier_Invoice_Source_ID'),
      R('supplierChangeSource', 'Supplier Change Source', 'External_Supplier_Invoice_Source_ID'),
      R('integrationSystem', 'Integration System', 'Integration_System_ID'),
      R('securitySegment', 'Supplier Security Segment', 'Supplier_Security_Segment_ID'),
      R('spendCategoriesOrHierarchies', 'Spend Categories or Hierarchies', 'Resource_Category_Hierarchy_ID', { multi: true }),
      B('worktagOnly', 'Worktag Only'),
      B('doNotReimburseCwExpenses', 'Do Not Reimburse Contingent Worker Expense Reports'),
      R('includedChildren', 'Included Children', 'Supplier_ID', { multi: true }),
      R('proposedChildren', 'Proposed Children', 'Supplier_ID', { multi: true }),
      T('note', 'Supplier Note'),
      D('noteFollowUpDate', 'Supplier Note Follow-Up Date'),
    ],
  },
  {
    key: 'payment',
    tab: 'Payment & Procurement',
    many: false,
    columns: [
      NAME,
      SID,
      R('paymentTerms', 'Payment Terms', 'Payment_Terms_ID', { required: true }),
      B('termsBasedOnInvoiceReceived', 'Terms Based on Invoice Received Date'),
      R('paymentTypesAccepted', 'Payment Types Accepted', 'Payment_Type_ID', { multi: true, required: true }),
      R('defaultPaymentType', 'Default Payment Type', 'Payment_Type_ID', { required: true }),
      R('procurementCreditCard', 'Procurement Credit Card', 'Expense_Credit_Card_ID'),
      B('alwaysSeparatePayments', 'Always Separate Payments'),
      B('doNotPayDuringBankUpdates', 'Do Not Pay During Bank Account Updates'),
      T('defaultPaymentMemo', 'Default Payment Memo Text'),
      B('useSupplierReferenceMemo', 'Use Supplier Reference as Payment Memo'),
      B('useInvoiceMemo', 'Use Invoice Memo as Payment Memo'),
      B('useConnectionMemo', 'Use Supplier Connection Memo'),
      B('overrideDiscountExclusion', 'Override Tenant Invoice Discount Exclusion'),
      B('excludeFreight', 'Exclude Freight from Invoice Discount'),
      B('excludeOtherCharges', 'Exclude Other Charges from Invoice Discount'),
      B('excludeTax', 'Exclude Tax from Invoice Discount'),
      R('poIssueOption', 'Purchase Order Issue Option', 'Purchase_Order_Issue_Option_ID'),
      T('poIssueEmails', 'Default PO Issue Emails', { multi: true }),
      R('changeOrderIssueOption', 'Change Order Issue Option', 'Purchase_Order_Issue_Option_ID'),
      B('disableChangeOrder', 'Disable Change Order'),
      T('multiSupplierLink', 'Multi-Supplier Link for PO Issue'),
      R('shippingTerms', 'Shipping Terms', 'Shipping_Terms_ID'),
      R('shippingMethod', 'Shipping Method', 'Shipping_Method_ID'),
      B('acknowledgementExpected', 'Acknowledgement Expected'),
      N('minimumOrderAmount', 'Supplier Minimum Order Amount'),
      R('minimumOrderCurrency', 'Minimum Order Amount Currency', 'Currency_ID'),
      N('leadTimeDays', 'Supplier Lead Time (Days)'),
      B('enableAsn', 'Enable ASN'),
      N('asnDueDays', 'ASN Due In Days'),
      B('invoiceAnySupplier', 'Invoice Any Supplier'),
      B('editPortalTaxes', 'Edit Portal Taxes'),
      B('enableGln', 'Enable Global Location Number'),
      R('defaultSpendCategory', 'Default Spend Category', 'Spend_Category_ID'),
      R('defaultProcurementItem', 'Default Procurement Item', 'Purchase_Item_ID'),
    ],
  },
  {
    key: 'addresses',
    tab: 'Addresses',
    many: true,
    recordLabel: 'address',
    columns: [
      NAME, SID,
      T('addressLabel', 'Address Label'),
      ...ADDRESS_PARTS,
      B('primary', 'Primary', { required: true }),
      B('public', 'Public'),
      R('useFor', 'Use For', 'Communication_Usage_Behavior_ID', { multi: true }),
      T('comments', 'Comments'),
    ],
  },
  {
    key: 'phones',
    tab: 'Phones',
    many: true,
    recordLabel: 'phone',
    columns: [
      NAME, SID,
      R('phoneCountry', 'Phone Country', 'ISO_3166-1_Alpha-2_Code', { required: true }),
      T('areaCode', 'Area Code', { keepText: true }),
      T('phoneNumber', 'Phone Number', { required: true, keepText: true }),
      T('extension', 'Extension', { keepText: true }),
      R('deviceType', 'Device Type', 'Phone_Device_Type_ID', { required: true }),
      B('primary', 'Primary', { required: true }),
      B('public', 'Public'),
      R('useFor', 'Use For', 'Communication_Usage_Behavior_ID', { multi: true }),
      T('comments', 'Comments'),
    ],
  },
  {
    key: 'emails',
    tab: 'Emails',
    many: true,
    recordLabel: 'email',
    columns: [
      NAME, SID,
      T('emailAddress', 'Email Address', { required: true }),
      B('primary', 'Primary', { required: true }),
      B('public', 'Public'),
      R('useFor', 'Use For', 'Communication_Usage_Behavior_ID', { multi: true }),
      T('comments', 'Comments'),
    ],
  },
  {
    key: 'webAddresses',
    tab: 'Web Addresses',
    many: true,
    recordLabel: 'web address',
    columns: [
      NAME, SID,
      T('webAddress', 'Web Address', { required: true }),
      B('primary', 'Primary', { required: true }),
      B('public', 'Public'),
      R('useFor', 'Use For', 'Communication_Usage_Behavior_ID', { multi: true }),
      T('comments', 'Comments'),
    ],
  },
  {
    key: 'taxIds',
    tab: 'Tax IDs',
    many: true,
    recordLabel: 'tax ID',
    columns: [
      NAME, SID,
      R('taxIdCountry', 'Tax ID Country', 'ISO_3166-1_Alpha-2_Code', { required: true }),
      R('taxIdType', 'Tax ID Type', 'Tax_ID_Type', { required: true }),
      T('taxId', 'Tax ID', { required: true, keepText: true, sensitive: true }),
      B('primary', 'Primary Tax ID', { required: true }),
      B('transactionTaxId', 'Transaction Tax ID'),
    ],
  },
  {
    key: 'taxStatuses',
    tab: 'Tax Statuses',
    many: true,
    recordLabel: 'tax status',
    columns: [
      NAME, SID,
      R('country', 'Country', 'ISO_3166-1_Alpha-2_Code', { required: true }),
      R('transactionTaxStatus', 'Transaction Tax Status', 'Transaction_Tax_Status_ID'),
      R('withholdingTaxStatus', 'Withholding Tax Status', 'Tax_Withholding_Status_ID'),
    ],
  },
  {
    key: 'settlementAccounts',
    tab: 'Settlement Accounts',
    many: true,
    recordLabel: 'settlement account',
    columns: [
      NAME, SID,
      T('accountLabel', 'Account Label', { required: true }),
      ...BANK_PARTS,
      R('acceptsPaymentTypes', 'Accepts Payment Types', 'Payment_Type_ID', { multi: true }),
      R('paymentTypes', 'Payment Types', 'Payment_Type_ID', { multi: true }),
      B('forConnectionsOnly', 'For Supplier Connections Only'),
      B('requiresPrenote', 'Requires Prenote'),
      R('prenotePaymentType', 'Payment Type Prenote', 'Payment_Type_ID'),
      B('inactive', 'Inactive'),
      T('bankInstructions', 'Bank Instructions'),
    ],
  },
  {
    key: 'intermediaryBanks',
    tab: 'Intermediary Banks',
    many: true,
    nestedUnder: 'settlementAccounts',
    recordLabel: 'intermediary bank',
    columns: [
      NAME, SID,
      T('accountLabel', 'Account Label', { required: true }),
      T('intermediaryLabel', 'Intermediary Label', { required: true }),
      N('order', 'Order', { required: true }),
      ...BANK_PARTS,
      B('inactive', 'Inactive'),
      T('bankInstructions', 'Bank Instructions'),
    ],
  },
  {
    key: 'bankAddresses',
    tab: 'Bank Addresses',
    many: true,
    nestedUnder: 'settlementAccounts',
    recordLabel: 'bank address',
    columns: [
      NAME, SID,
      T('accountLabel', 'Account Label', { required: true }),
      T('intermediaryLabel', 'Intermediary Label'),
      ...ADDRESS_PARTS,
    ],
  },
  {
    key: 'alternateNames',
    tab: 'Alternate Names',
    many: true,
    recordLabel: 'alternate name',
    columns: [
      NAME, SID,
      T('alternateName', 'Alternate Name', { required: true }),
      R('usage', 'Alternate Name Usage', 'Alternate_Name_Usage_ID', { multi: true, required: true }),
    ],
  },
  {
    key: 'classifications',
    tab: 'Classifications',
    many: true,
    recordLabel: 'classification',
    columns: [
      NAME, SID,
      R('classification', 'Supplier Classification', 'Custom_Supplier_Classification_ID', { required: true }),
      R('field', 'Classification Field', 'Custom_Supplier_Classification_Field_ID', { required: true }),
      T('value', 'Value', { multi: true, required: true }),
    ],
  },
  {
    key: 'relatedWorktags',
    tab: 'Related Worktags',
    many: true,
    recordLabel: 'related worktag',
    columns: [
      NAME, SID,
      R('worktagType', 'Worktag Type', 'Accounting_Worktag_Type_ID', { required: true }),
      T('defaultWorktag', 'Default Worktag'),
      B('requiredOnTransaction', 'Required on Transaction'),
      B('requiredForValidation', 'Required on Transaction for Validation'),
      T('allowedWorktags', 'Allowed Worktags', { multi: true }),
    ],
  },
];

export const SUPPORT_TABS = {
  valueMapping: {
    tab: 'Value Mapping',
    columns: [
      T('tab', 'Tab'), T('column', 'Column'), T('conditionColumn', 'Condition Column'),
      T('conditionValue', 'Condition Value'), T('legacyValue', 'Legacy Value'),
      T('workdayValue', 'Workday Value'), T('notes', 'Notes'),
    ],
  },
  existingSuppliers: {
    tab: 'Existing Suppliers',
    columns: [
      T('supplierId', 'Supplier ID'), T('supplierName', 'Supplier Name'), T('taxId', 'Tax ID', { keepText: true }),
      T('status', 'Status'), T('accountLast4', 'Bank Account Last 4', { keepText: true }),
    ],
  },
};

/** Tabs that are part of the workbook but hold reference data, not supplier data. */
export const REFERENCE_TABS = ['Start Here', 'Lists', 'Address Rules', 'Bank Rules'];

/** Things this tool deliberately doesn't load (brief section 2). */
export const OUT_OF_SCOPE_PATTERNS = [
  { pattern: /contact/i, label: 'Supplier contacts' },
  { pattern: /remit[\s-]*to.*connection|remit[\s-]*to[\s-]*supplier/i, label: 'Remit-to supplier connections' },
  { pattern: /order[\s-]*from/i, label: 'Order-from supplier connections' },
  { pattern: /contract/i, label: 'Contracts' },
  { pattern: /assigned\s*role|role\s*assign/i, label: 'Assigned roles' },
];

export const SECTION_BY_KEY = Object.fromEntries(SECTIONS.map((s) => [s.key, s]));
export const columnByKey = (sectionKey, colKey) => SECTION_BY_KEY[sectionKey].columns.find((c) => c.key === colKey);
