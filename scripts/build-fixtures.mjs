#!/usr/bin/env node
// Builds the test fixtures from the blank Conversion Workbook:
//   fixtures/Sample_Conversion_Workbook.xlsx   5 suppliers (brief section 10)
//   fixtures/sample-loose.csv                  the same suppliers as a loose export
// All names, numbers, and accounts are fictional test data.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// --------------------------------------------------------------- data
const AGILE = 'Agile Staffing LTD';
const NORTHWIND = 'Northwind Logistics LLC';
const SUMMIT = 'Summit Industrial Supply Inc';
const MESSY = 'Bad Data Co';
const NORTHWIND_DUP = 'Northwind Logistics, LLC';

export const DATA = {
  Suppliers: [
    { 'Supplier Name': AGILE, 'Supplier Category': 'Professional Services', 'Supplier Groups+': 'Suppliers A - L', 'Supplier Status': 'Active', 'Status Reason': 'Data Entry Error', 'Default Currency': 'INR', 'IRS 1099 Supplier': 'No', 'Report 1099 with Parent': 'No', FATCA: 'No', 'Do Not Reimburse Contingent Worker Expense Reports': 'No' },
    { 'Supplier Name': NORTHWIND, 'Supplier Category': 'Logistics / Freight Providers', 'Supplier Groups+': 'Suppliers M - Z', 'Supplier Status': 'Active', 'Default Currency': 'USD', 'Accepted Currencies+': 'USD', 'Restricted to Companies+': '100 Commit Demo US', 'IRS 1099 Supplier': 'No', 'DUNS Number': '012345678' },
    { 'Supplier Name': SUMMIT, 'Supplier Category': 'Equipment & Supplies Vendors', 'Supplier Groups+': 'Suppliers M - Z; Preferred', 'Default Currency': 'USD', 'Accepted Currencies+': 'USD; CAD', 'IRS 1099 Supplier': 'Yes', 'Tax Authority Form Type': '1099 (Misc/NEC)', 'Certificate of Insurance Date': '2026-06-30' },
    { 'Supplier Name': MESSY, 'Supplier Category': 'Consultants???', 'Default Currency': 'USD', 'Supplier Status': 'Hold' },
    { 'Supplier Name': NORTHWIND_DUP, 'Supplier Category': 'Logistics / Freight Providers', 'Default Currency': 'USD', 'IRS 1099 Supplier': 'No' },
  ],
  'Payment & Procurement': [
    { 'Supplier Name': AGILE, 'Payment Terms': 'Net 30', 'Terms Based on Invoice Received Date': 'No', 'Payment Types Accepted+': 'Check; EFT', 'Default Payment Type': 'EFT', 'Always Separate Payments': 'No', 'Do Not Pay During Bank Account Updates': 'No', 'Disable Change Order': 'No', 'Acknowledgement Expected': 'No', 'Supplier Minimum Order Amount': '0', 'Supplier Lead Time (Days)': '0', 'Enable ASN': 'No', 'Invoice Any Supplier': 'No', 'Edit Portal Taxes': 'No', 'Enable Global Location Number': 'No' },
    { 'Supplier Name': NORTHWIND, 'Payment Terms': 'Net 30', 'Payment Types Accepted+': 'EFT; Check', 'Default Payment Type': 'EFT' },
    { 'Supplier Name': SUMMIT, 'Payment Terms': 'Net 45', 'Payment Types Accepted+': 'Check, ACH\nWire', 'Default Payment Type': 'Wire', 'Purchase Order Issue Option': 'Email', 'Default PO Issue Emails+': 'po@summitindustrial.example; orders@summitindustrial.example', 'Shipping Terms': 'FOB Destination', 'Shipping Method': 'Ground Shipping', 'Supplier Minimum Order Amount': '250', 'Minimum Order Amount Currency': 'USD', 'Enable ASN': 'Yes', 'ASN Due In Days': '3' },
    { 'Supplier Name': MESSY, 'Payment Terms': 'Net 30', 'Payment Types Accepted+': 'EFT', 'Default Payment Type': 'EFT' },
    { 'Supplier Name': NORTHWIND_DUP, 'Payment Terms': 'Net 30', 'Payment Types Accepted+': 'EFT', 'Default Payment Type': 'EFT' },
  ],
  Addresses: [
    { 'Supplier Name': AGILE, Country: 'India', Region: 'Haryāna', City: 'Delhi', 'Address Line 1': 'Scf 41, Market -ii', 'Postal Code': '121001', 'Effective Date': '2023-01-01', Primary: 'Yes', Public: 'Yes', 'Use For+': 'Billing; Remit To; Shipping' },
    { 'Supplier Name': NORTHWIND, Country: 'United States of America', Region: 'Texas', City: 'Dallas', 'Address Line 1': '1200 Main St', 'Address Line 2': 'Suite 400', 'Postal Code': '75202', Primary: 'Yes', Public: 'Yes', 'Use For+': 'Billing; Remit To' },
    { 'Supplier Name': SUMMIT, 'Address Label': 'HQ', Country: 'United States of America', Region: 'Ohio', City: 'Columbus', 'Address Line 1': '88 Foundry Way', 'Postal Code': '43215-1234', Primary: 'Yes', Public: 'Yes', 'Use For+': 'Billing; Remit To' },
    { 'Supplier Name': SUMMIT, 'Address Label': 'Warehouse', Country: 'United States of America', Region: 'Ohio', City: 'Groveport', 'Address Line 1': '4500 Logistics Pkwy', 'Address Line 2': 'Dock 7', 'Postal Code': '43125', Primary: 'No', Public: 'Yes', 'Use For+': 'Shipping' },
    { 'Supplier Name': MESSY, Country: 'United States of America', City: 'Austin', 'Address Line 1': '500 Congress Ave', 'Postal Code': '7870', Primary: 'Yes' },
    { 'Supplier Name': NORTHWIND_DUP, Country: 'United States of America', Region: 'Texas', City: 'Dallas', 'Address Line 1': '1200 Main Street', 'Postal Code': '75202', Primary: 'Yes' },
  ],
  Phones: [
    { 'Supplier Name': NORTHWIND, 'Phone Country': 'United States of America', 'Area Code': '214', 'Phone Number': '5550142', 'Device Type': 'Landline', Primary: 'Yes', Public: 'Yes' },
    { 'Supplier Name': SUMMIT, 'Phone Country': 'United States of America', 'Area Code': '614', 'Phone Number': '5550199', 'Device Type': 'Landline', Primary: 'Yes', Public: 'Yes' },
    { 'Supplier Name': SUMMIT, 'Phone Country': 'United States of America', 'Area Code': '614', 'Phone Number': '5550198', 'Device Type': 'Fax', Primary: 'No', Public: 'Yes' },
  ],
  Emails: [
    { 'Supplier Name': AGILE, 'Email Address': 'jsteiffel@agilestaffltd.com', Primary: 'Yes', Public: 'Yes', 'Use For+': 'Billing; Remit To; Shipping' },
    { 'Supplier Name': NORTHWIND, 'Email Address': 'ap@northwindlogistics.example', Primary: 'Yes', Public: 'Yes' },
    { 'Supplier Name': SUMMIT, 'Email Address': 'ar@summitindustrial.example', Primary: 'Yes', Public: 'Yes', 'Use For+': 'Billing; Remit To' },
    { 'Supplier Name': SUMMIT, 'Email Address': 'shipping@summitindustrial.example', Primary: 'No', Public: 'Yes', 'Use For+': 'Shipping' },
    { 'Supplier Name': MESSY, 'Email Address': 'billing@baddata.example', Primary: 'Yes' },
    { 'Supplier Name': MESSY, 'Email Address': 'owner@baddata', Primary: 'Yes' },
  ],
  'Web Addresses': [
    { 'Supplier Name': SUMMIT, 'Web Address': 'https://www.summitindustrial.example', Primary: 'Yes', Public: 'Yes' },
  ],
  'Tax IDs': [
    { 'Supplier Name': NORTHWIND, 'Tax ID Country': 'United States of America', 'Tax ID Type': 'Employer ID Number', 'Tax ID': '12-3456789', 'Primary Tax ID': 'Yes', 'Transaction Tax ID': 'No' },
    { 'Supplier Name': SUMMIT, 'Tax ID Country': 'United States of America', 'Tax ID Type': 'Employer ID Number', 'Tax ID': '98-7654321', 'Primary Tax ID': 'Yes' },
    { 'Supplier Name': MESSY, 'Tax ID Country': 'United States of America', 'Tax ID Type': 'Employer ID Number', 'Tax ID': '1234', 'Primary Tax ID': 'Yes' },
    { 'Supplier Name': NORTHWIND_DUP, 'Tax ID Country': 'United States of America', 'Tax ID Type': 'Employer ID Number', 'Tax ID': '12-3456789', 'Primary Tax ID': 'Yes' },
  ],
  'Settlement Accounts': [
    { 'Supplier Name': AGILE, 'Account Label': 'ACCT1', 'Bank Country': 'United States of America', Currency: 'USD', 'Account Type': 'Checking', 'Bank Name': 'Bank of America', 'Name on Account': AGILE, 'Bank Account Number': '4810028510', 'Account Nickname': 'Bank of America', 'Routing Number / Bank Code': '026009593', 'Accepts Payment Types+': 'EFT' },
    { 'Supplier Name': NORTHWIND, 'Account Label': 'ACCT1', 'Bank Country': 'United States of America', Currency: 'USD', 'Account Type': 'Checking', 'Bank Name': 'JP Morgan Chase', 'Name on Account': NORTHWIND, 'Bank Account Number': '000123456789', 'Routing Number / Bank Code': '111000614', 'Accepts Payment Types+': 'EFT' },
    { 'Supplier Name': SUMMIT, 'Account Label': 'OPS', 'Bank Country': 'United States of America', Currency: 'USD', 'Account Type': 'Checking', 'Bank Name': 'Fifth Third Bank', 'Name on Account': SUMMIT, 'Bank Account Number': '7300112233', 'Routing Number / Bank Code': '042000314', 'SWIFT / BIC': 'FTBCUS3C', 'Accepts Payment Types+': 'EFT; Wire' },
    { 'Supplier Name': MESSY, 'Account Label': 'ACCT1', 'Bank Country': 'United States of America', Currency: 'USD', 'Account Type': 'Checking', 'Bank Name': 'Lone Star Credit Union', 'Bank Account Number': '55500011', 'Routing Number / Bank Code': '123456789' },
    { 'Supplier Name': NORTHWIND_DUP, 'Account Label': 'ACCT1', 'Bank Country': 'United States of America', Currency: 'USD', 'Account Type': 'Checking', 'Bank Name': 'JP Morgan Chase', 'Bank Account Number': '000123456789', 'Routing Number / Bank Code': '111000614' },
  ],
  'Intermediary Banks': [
    { 'Supplier Name': SUMMIT, 'Account Label': 'OPS', 'Intermediary Label': 'INT1', Order: '1', 'Bank Country': 'United States of America', Currency: 'USD', 'Account Type': 'Checking', 'Bank Name': 'Citibank N.A.', 'Bank Account Number': '36011122', 'Routing Number / Bank Code': '021000089', 'SWIFT / BIC': 'CITIUS33' },
  ],
  'Bank Addresses': [
    { 'Supplier Name': SUMMIT, 'Account Label': 'OPS', Country: 'United States of America', Region: 'Ohio', City: 'Cincinnati', 'Address Line 1': '38 Fountain Square Plaza', 'Postal Code': '45263' },
    { 'Supplier Name': SUMMIT, 'Account Label': 'OPS', 'Intermediary Label': 'INT1', Country: 'United States of America', Region: 'New York', City: 'New York', 'Address Line 1': '388 Greenwich St', 'Postal Code': '10013' },
  ],
  'Alternate Names': [
    { 'Supplier Name': SUMMIT, 'Alternate Name': 'Summit Supply', 'Alternate Name Usage+': 'Doing Business As; Remit To Payee' },
  ],
  Classifications: [
    { 'Supplier Name': SUMMIT, 'Supplier Classification': 'Diversity', 'Classification Field': 'Small Business', 'Value+': 'Yes' },
  ],
  'Related Worktags': [
    { 'Supplier Name': SUMMIT, 'Worktag Type': 'Cost Center', 'Default Worktag': 'CC100 Operations', 'Required on Transaction': 'No' },
  ],
  'Value Mapping': [
    { Tab: 'Payment & Procurement', Column: 'Payment Types Accepted+', 'Legacy Value': 'ACH', 'Workday Value': 'EFT', Notes: 'Legacy ERP calls EFT "ACH"' },
  ],
  'Existing Suppliers': [
    { 'Supplier ID': 'S-0042', 'Supplier Name': 'Summit Industrial Supply', 'Tax ID': '98-7654321', Status: 'Active', 'Bank Account Last 4': '2233' },
  ],
};

// ------------------------------------------------------------ workbook
const norm = (h) => String(h ?? '').trim().toLowerCase().replace(/[+?]$/, '');

async function buildWorkbook() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(root, 'reference', 'Supplier_Conversion_Workbook.xlsx'));
  for (const [tab, rows] of Object.entries(DATA)) {
    const ws = wb.getWorksheet(tab);
    if (!ws) throw new Error(`Template has no tab ${tab}`);
    const header = new Map();
    ws.getRow(3).eachCell((cell, c) => header.set(norm(cell.value), c));
    rows.forEach((rec, i) => {
      const row = ws.getRow(4 + i);
      for (const [h, v] of Object.entries(rec)) {
        const c = header.get(norm(h));
        if (!c) throw new Error(`${tab} has no column ${h}`);
        row.getCell(c).value = v;
      }
      row.commit();
    });
  }
  // An out-of-scope tab, to check the ingest summary reports it.
  const contacts = wb.addWorksheet('Supplier Contacts');
  contacts.addRow(['Supplier Name', 'Contact Name', 'Email']);
  contacts.addRow([AGILE, 'Allen Apex', 'allen.apex@email.example']);
  await wb.xlsx.writeFile(join(root, 'fixtures', 'Sample_Conversion_Workbook.xlsx'));
}

// ---------------------------------------------------------------- csv
// A loose vendor export: different headers, a title row, and one row per
// address / bank account, so the same supplier spans several rows.
function buildLooseCsv() {
  const header = ['Vendor', 'Vendor Type', 'Currency', 'Terms', 'Pay Method 1', 'Pay Method 2', 'Pay Method 3', 'Default Pay Method',
    'Street', 'Street 2', 'City', 'State', 'Zip', 'Country', 'Address Purpose', 'Main Address', 'Email', 'Phone', 'EIN',
    'Bank', 'Bank Acct #', 'ABA'];
  const rows = [
    [AGILE, 'Professional Services', 'INR', 'Net 30', 'Check', 'EFT', '', 'EFT', 'Scf 41, Market -ii', '', 'Delhi', 'Haryāna', '121001', 'India', 'Billing; Remit To; Shipping', 'Y', 'jsteiffel@agilestaffltd.com', '', '', 'Bank of America', '4810028510', '026009593'],
    [NORTHWIND, 'Logistics / Freight Providers', 'USD', 'Net 30', 'EFT', 'Check', '', 'EFT', '1200 Main St', 'Suite 400', 'Dallas', 'TX', '75202', 'USA', 'Billing; Remit To', 'Y', 'ap@northwindlogistics.example', '(214) 555-0142', '12-3456789', 'JP Morgan Chase', '000123456789', '111000614'],
    [SUMMIT, 'Equipment & Supplies Vendors', 'USD', 'Net 45', 'Check', 'ACH', 'Wire', 'Wire', '88 Foundry Way', '', 'Columbus', 'OH', '43215-1234', 'USA', 'Billing; Remit To', 'Y', 'ar@summitindustrial.example', '(614) 555-0199', '98-7654321', 'Fifth Third Bank', '7300112233', '042000314'],
    [SUMMIT, 'Equipment & Supplies Vendors', 'USD', 'Net 45', '', '', '', '', '4500 Logistics Pkwy', 'Dock 7', 'Groveport', 'OH', '43125', 'USA', 'Shipping', 'N', 'shipping@summitindustrial.example', '', '', '', '', ''],
    [MESSY, 'Consultants???', 'USD', 'Net 30', 'EFT', '', '', 'EFT', '500 Congress Ave', '', 'Austin', '', '7870', 'USA', '', 'Y', 'billing@baddata.example', '', '1234', 'Lone Star Credit Union', '55500011', '123456789'],
    [MESSY, 'Consulting', 'USD', '', '', '', '', '', '', '', '', '', '', '', '', '', 'owner@baddata', '', '', '', '', ''],
    [NORTHWIND_DUP, 'Logistics / Freight Providers', 'USD', 'Net 30', 'EFT', '', '', 'EFT', '1200 Main Street', '', 'Dallas', 'TX', '75202', 'USA', '', 'Y', '', '', '12-3456789', 'JP Morgan Chase', '000123456789', '111000614'],
  ];
  const esc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ['Vendor Master Export - Legacy ERP', 'Run date: 10/29/2026', '', header.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))];
  writeFileSync(join(root, 'fixtures', 'sample-loose.csv'), lines.join('\r\n') + '\r\n');
}

await buildWorkbook();
buildLooseCsv();
console.log('Wrote fixtures/Sample_Conversion_Workbook.xlsx and fixtures/sample-loose.csv');
