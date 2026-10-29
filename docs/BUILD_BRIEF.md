# Build Brief: Commit Supplier EIB Builder

Read this whole brief before writing any code. Then read every file in `/reference`. When something in this brief conflicts with what you find in the reference files, stop and ask me rather than guessing.

## 1. What we're building

A browser-based tool that takes supplier data and produces a load-ready Workday **Submit Supplier (v44.1) EIB**.

The tool should:

* Ingest supplier data from either:
  * a structured **Supplier Conversion Workbook**, or
  * loosely formatted tables (Excel, CSV, or pasted text).
* Build an editable **proposed profile** for every supplier, laid out like a Workday View Supplier page.
* Resolve **reference IDs** inside the app (never in the workbook).
* Run **live validation**, with blocking errors vs warnings.
* Stop at a **pre-export gate** to confirm assumptions, then export:
  * the populated EIB, matching the blank template exactly
  * a client-facing exception report

Users are Commit consultants, and possibly clients later. It must work opened locally from a single HTML file and hosted as a static site.

## 2. Locked decisions

These are settled. Don't revisit them without asking.

* **Create only.** No updates to existing suppliers.
* **No AI or LLM calls anywhere.** All parsing, matching, and validation is deterministic.
* **100% client-side.** No backend, no network calls at runtime, no telemetry. Supplier data never leaves the browser.
* **Out of scope:** supplier contacts, remit-to / order-from supplier connections, contracts, assigned roles. These load through separate processes. If the input contains them, report them as "not loaded by this tool" in the ingest summary.
* **Reference IDs are handled only in the app.** The Conversion Workbook contains display values only.
* **Temporary IDs:**
  * Every supplier gets a tool-only ID (`TMP-0001`, `TMP-0002`, ...) used for tracking, review, and the exception report.
  * It is **never** written to the EIB.
  * Supplier ID in the EIB stays blank unless the input explicitly supplied one.
* **EIB scope:** include every supplier data section the template supports. Exclude business process and submission plumbing, with two exceptions that are always set on every supplier:
  * **Auto Complete = Y**
  * **Approval Status = Approved**
* **Output is locked to the provided v44.1 blank template.** Same sheet, same columns, same header rows 1 to 5, data starting on row 6.
* **Commit branding** throughout (see section 8).
* **Multiple values are normal.** Many fields hold more than one value, and the tool must handle that everywhere: ingest, mapping, value mapping, reference matching, profiles, validation, and export.

## 3. Reference files (in `/reference`)

| File | What it is | How to use it |
|---|---|---|
| `Submit_Supplier_Blank.xlsx` | Tenant-generated blank EIB, Submit Supplier v44.1. One sheet, 411 columns. | The export target. See section 6.8. |
| `Supplier_Conversion_Workbook.xlsx` | Our structured input workbook, Commit-branded. | Primary ingestion format. See section 6.1. |
| `Agile_Staffing_LTD.pdf` | Workday View Supplier printout. | Layout reference for the proposed profile. Also a test fixture (an India supplier, INR, Check + EFT, Bank of America checking). |
| `RAVN_Supplier_Workbook__Blank_.xlsm` | The legacy workbook our Conversion Workbook was derived from. | Source of validation rule logic (the `ValidationManifest` sheet, 161 rules). Don't support it as an input format. |
| `commit-logo.png` | Commit logo, 1024x238. | App header and favicon source. |

### EIB template structure (Submit_Supplier_Blank.xlsx)

* **Row 1:** title ("Submit Supplier - v44.1").
* **Row 2:** Area. This is the XML path of each column group, for example `Address Data+ (All > Supplier Data > Business Entity Data > Contact Data)`.
* **Row 3:** Restrictions: Required, Optional, or "May have multiples".
* **Row 4:** Format or reference ID type, for example `Supplier_Category_ID`, `Y/N`, `YYYY-MM-DD`, `ISO_3166-1_Alpha-2_Code`. Some row-4 cells have dropdowns for choosing the ID type.
* **Row 5:** Field names. Many names repeat across sections (`Country`, `Row ID*`, `Use For+`, `Delete`), so **a column must be identified by Area (row 2, carried forward across blanks) + Field (row 5) + position, never by field name alone.**
* **Row 6 onward:** data.
* Repeating groups use `Row ID*` / `Row ID**` columns.
* One supplier spans multiple rows that share a `Spreadsheet Key*` value.

### Conversion Workbook structure

* **Row 1:** logo and title.
* **Row 2:** requirement flags: Required, Conditional, Optional, plus ", multi" on multi-value columns.
* **Row 3:** headers.
* **Row 4 onward:** data.
* Column A is always **Supplier Name**, the join key across all tabs. Column B is the optional Supplier ID.

| Tab | Rows per supplier |
|---|---|
| Suppliers | One |
| Payment & Procurement | One |
| Addresses | Many |
| Phones | Many |
| Emails | Many |
| Web Addresses | Many |
| Tax IDs | Many |
| Tax Statuses | Many |
| Settlement Accounts | Many |
| Intermediary Banks | Many |
| Bank Addresses | Many |
| Alternate Names | Many |
| Classifications | Many |
| Related Worktags | Many |

* **Settlement Accounts** carry a client-chosen **Account Label** (e.g. ACCT1). **Intermediary Banks** and **Bank Addresses** link back via Account Label, and intermediaries also have an Intermediary Label. The app generates real Settlement Bank Account IDs from these.
* **Multi-value columns** end in `+`. Values are separated by semicolons, but commas and line breaks are also allowed, so split on all three. Split only on `+` columns, never on others: names and addresses can legitimately contain commas.
* **Support tabs:**
  * **Value Mapping:** legacy-to-Workday translations, one-to-many allowed.
  * **Existing Suppliers:** optional, for duplicate checks.
  * **Lists:** standard Workday display values.
  * **Address Rules:** per-country required, optional, or not accepted, for each address field.
  * **Bank Rules:** per-country bank field requirements and regex formats.
* **Matching rules for workbook files:**
  * Match tabs and headers tolerantly: case-insensitive, trimmed, ignoring a trailing `+` or `?`.
  * Never rely on column position. Clients will reorder and add columns.
  * Ignore rows where Supplier Name is blank.

## 4. Tech stack

* Vanilla JavaScript (ES modules) or TypeScript, with no UI framework unless you make a strong case first.
* **Vite**, with `vite-plugin-singlefile`, so `npm run build` produces **one self-contained HTML file** (`dist/supplier-eib-builder.html`) that works from `file://`.
* **SheetJS** for reading any input (xlsx, xlsm, xls, csv).
* **ExcelJS** for writing the EIB into the blank template. It preserves the template's header rows, styles, and data validations far better than SheetJS community edition. Verify that by round-tripping the template before building on it.
* **Vitest** for unit tests.
* Pin exact dependency versions.
* **Bundled assets:**
  * The blank EIB template, as a base64 asset.
  * The logo.
  * The standard reference lists extracted from the Conversion Workbook's Lists, Address Rules, and Bank Rules tabs. Write a script, `scripts/extract-reference-data.mjs`, that generates JSON from the workbook so it can be refreshed later.

## 5. App flow

A left-hand step navigation runs through five steps: **1 Ingest → 2 Map → 3 Reference IDs → 4 Review → 5 Export**. Users can move back and forth freely. A persistent header shows the Commit logo, the active client workspace, and a batch status summary (suppliers: clean / warnings / blocked).

## 6. Modules

### 6.1 Ingest

* Drag-and-drop or file picker for `.xlsx`, `.xlsm`, `.xls`, and `.csv`, plus a paste box for tab-delimited or CSV text.
* **Path A: Conversion Workbook.**
  * Auto-detect it by its tab names and headers.
  * Read every in-scope tab by header and join on Supplier Name. No mapping step.
  * Also import the workbook's Value Mapping rows and Existing Suppliers rows.
* **Path B: loose table.**
  * Detect the header row, which may not be row 1. Skip blank and title rows.
  * Send the data to the Map step.
  * If the same supplier name appears on several rows, merge them into one supplier. Extra addresses, bank accounts, and so on become child records. Conflicting single-value fields get flagged for review.
* **Ingest summary:** files read, rows read, suppliers found, rows skipped (and why), out-of-scope tabs or columns ignored.

### 6.2 Map (loose tables only)

* Auto-guess a target for each source column from header synonyms, fuzzy matching, and value sniffing:
  * values that look like email addresses → Email Address
  * 9-digit numbers → possible routing number or EIN, confirmed by context
* A mapping screen to confirm or change each column's target field. Show a sample of values next to each column.
* Allow one source column to map to a multi-value target, and allow several source columns to feed one target. For example, Address Line 1 and Address Line 2 columns, or several "Payment Type" columns combined into Payment Types Accepted+.
* **Mapping profiles:** save a confirmed mapping under a name (e.g. "Client X NetSuite vendor export") and auto-apply it when a file with matching headers is loaded. Profiles export and import as JSON so the team can share them.

### 6.3 Value mapping

* Rules use the Value Mapping tab structure: Tab, Column, Condition Column, Condition Value, Legacy Value, Workday Value(s).
* Matching is case-insensitive and whole-value. For multi-value cells, match **each value separately**.
* **One-to-many:** a Workday Value of `EFT; Check` replaces one legacy value with two.
* Rules are saved per client workspace, and can be imported from a workbook or added in the app.

### 6.4 Reference ID manager

* Every field whose EIB row-4 format is a reference ID type (for example `Supplier_Category_ID`, `Payment_Terms_ID`, `Payment_Type_ID`, `Company_Reference_ID`, `Currency_ID`, `ISO_3166-1_Alpha-2_Code`, `Country_Region_ID`, `Tax_ID_Type`, `Alternate_Name_Usage_ID`, and the usage type IDs) gets resolved here.
* **Loading tenant values:** accept a simple file with columns Reference ID Type, Reference ID, and Display Name. Also accept a few common report shapes tolerantly.
* **Built-in baseline:**
  * The standard Workday values from the bundled Lists data: countries (ISO2/ISO3), regions, currencies, tax ID types by country, tax codes, statuses, alternate name usages, account types, phone device types, PO issue options, shipping terms and methods.
  * Where no ID is known, **assume** one using the pattern the bundled data shows, for example spaces to underscores (`Net 30` → `Net_30`).
* **Each distinct source value gets a status:**
  * **Matched:** exact or normalized match to a loaded tenant value.
  * **Assumed:** derived from the baseline or the pattern.
  * **Unresolved:** no match.
* **Matching order:** exact → case or whitespace normalized → known synonyms (e.g. "ACH" → EFT, "USA" / "United States" → US) → fuzzy suggestion. A fuzzy result only suggests; it never auto-applies.
* **UI:** one table per reference type, showing source value, suppliers affected, status, and the chosen Workday value. Include a picker and a bulk "accept all suggestions".
* Resolutions are saved per client workspace so a value only gets resolved once.
* Multi-value fields resolve each value individually.

### 6.5 Proposed profiles (Review step)

* A filterable list of suppliers on the left: All / Blocked / Warnings / Clean, plus search.
* A profile card on the right, laid out like `Agile_Staffing_LTD.pdf`:
  * **Header:** temp ID, Supplier Name, status chip, primary address.
  * **Overview / Summary:** category, groups, restricted companies, status and reason, DUNS, UEI, customer account number, COI date, hierarchy (children).
  * **Contact Information:** address table with usage, visibility, and effective date; then emails, phones, and web addresses.
  * **Payment Details:** terms, accepted types, default type, currencies, memo settings, separate payments, bank update hold.
  * **Settlement Bank Accounts:** with intermediaries nested. Mask account numbers to the last 4 digits by default, with a reveal toggle.
  * **Alternate Names.**
  * **Related Worktags.**
  * **Procurement Setup:** issue options, PO emails, shipping, acknowledgement, minimum order, lead time, ASN, invoice options.
  * **Tax Information:** form type, 1099, FATCA, default tax codes, tax IDs (masked), tax statuses.
  * **Classifications.**
* **Every field is editable inline.** Multi-value fields edit as chips.
* Errors and warnings show **inline next to the field**, and as a summary at the top of the card.
* Each field shows its source (which tab/column or file/column it came from) and whether it was value-mapped or reference-assumed.
* **Batch dashboard:** counts by status, the top 10 issues by frequency, and a "fix all like this" option where it's safe. An example is a Value Mapping rule created from one fix.

### 6.6 Validation engine

Rules are data, not hard-coded branches. Keep them in a rules table (`src/validation/rules.*`) with id, scope, severity, condition, and message, so new rules are easy to add. Port the intent of the RAVN `ValidationManifest` rule types:

* Missing
* Match
* MatchNumerous
* Duplicatecolumn
* CheckDuplicateCombinationColumns
* EnsureDataMultipleColumns (all-or-none)
* OneSelectionPerInstance
* RequiredBetweenTabs
* CheckBasedOnCondition
* MatchValueorFormat
* Email
* Date
* address requirements
* bank account requirements and formats

Validation re-runs live on every edit, debounced, and per supplier.

| Check | Severity |
|---|---|
| Required field blank (Supplier Name, Category, Default Currency, Payment Terms, Payment Types Accepted, Default Payment Type, address Country + Line 1, Primary flags on addresses, phones, emails, and web addresses, tax ID trio, bank core fields) | Error |
| Duplicate supplier name, tax ID, or bank account number within the batch | Error |
| Possible duplicate vs Existing Suppliers (exact or fuzzy name, same tax ID, same account last 4) | Warning |
| More or fewer than one Primary per supplier for address, phone, email, web, tax ID | Error |
| Default Payment Type not among Payment Types Accepted | Error |
| EFT / Wire / Direct Deposit accepted but no settlement account | Error |
| Address fields required or not accepted per country (Address Rules) | Error / Warning |
| Region not valid for the country | Error |
| US postal code not `#####` or `#####-####` | Error |
| Bank fields required or not shown per country, and regex formats (Bank Rules) | Error |
| ABA routing checksum (US) | Error |
| IBAN mod-97 check, SWIFT/BIC format (8 or 11 characters) | Error |
| EIN / SSN format for US tax IDs | Error |
| Transaction Tax ID set on a type that can't be one | Error |
| Email and URL format | Error |
| Dates parse to YYYY-MM-DD | Error |
| Conditionals: Status Reason when status is not Active; Tax Form Type when 1099 = Yes; Min Order Currency when an amount is set; ASN Due Days when ASN is enabled; PO Issue Email when the issue option is Email; Prenote Payment Type when a prenote is required | Error |
| Reference value Unresolved | Error |
| Reference value Assumed | Warning |
| Single-value field had conflicting source values (merged rows) | Warning |
| Intermediary or Bank Address points to an unknown Account Label | Error |

### 6.7 Pre-export gate

Before generating the EIB, show a blocking review screen:

* every **Assumed** reference value, grouped by type, so each can be confirmed or changed
* every remaining **Error**
* the counts of suppliers included vs excluded

The user can either fix the issues, or explicitly exclude the blocked suppliers and export the rest. Export is impossible while an included supplier has errors.

### 6.8 EIB export

* Load the bundled blank template with ExcelJS and write data from **row 6 down**. Rows 1 to 5 stay untouched, along with all styles and data validations.
* **Column map:** build `src/eib/column-map.*` that maps every internal field to its exact EIB column, identified by Area path + Field name + occurrence (see section 3). Generate it from the template and review it by hand. Write a test that fails if the template's headers change.
* **Spreadsheet Key:** 1, 2, 3, and so on, one per supplier, on every row belonging to that supplier.
* **Row stacking:**
  * The first row for a supplier carries all the single-value supplier fields.
  * Each repeating group (Tax IDs, Tax Statuses, Addresses with their usages, Phones, Emails, Web Addresses, Settlement Accounts with intermediaries and bank addresses, Alternate Names, Classifications, Related Worktags) fills its own columns on successive rows under the same key, with sequential `Row ID` values per group.
  * Nested groups (an address's Use For values, an account's payment types) stack under their parent's Row ID.
  * Multi-value `+` columns put one value per row in that column, under the same key.
  * Groups are independent: row 2 of a supplier can hold its 2nd address and its 2nd email at the same time.
  * Validate this against how Workday EIBs actually stack repeating data. If anything is ambiguous, ask me before finalizing.
* **Values:**
  * Y/N for booleans.
  * YYYY-MM-DD for dates.
  * Reference IDs as resolved.
  * Text for IDs, so leading zeros stay.
* **Always set on every supplier:**
  * **Auto Complete = Y**
  * **Approval Status = Approved**: the Document_Status_ID value. Make this one configurable in settings, with the default flagged "verify in tenant".
* **Never write:** temp IDs, Supplier ID (unless explicitly provided), Delete / Replace All / Do Not Replace All flags, or any other submission-only fields.
* **Address and settlement account IDs:** generate them when not provided, using a configurable prefix pattern.
* **File name:** `Submit_Supplier_<Client>_<YYYY-MM-DD>.xlsx`.

### 6.9 Exception report export

* An xlsx with Commit branding.
* **Summary tab:** counts by status and the top issues.
* **Issues tab**, one row per issue, with these columns: Temp ID, Supplier Name, Section, Field, Current Value, Severity, Message, Suggested Fix.
* Written for a client audience: plain language, no internal jargon.
* An option to include warnings or errors only.

## 7. Workspaces and persistence

* A **client workspace** holds mapping profiles, value mapping rules, reference resolutions, settings (ID prefixes, Approval Status value), and the tenant reference values.
* Workspaces save to `localStorage` and can be exported and imported as a JSON file.
* **Supplier batch data is not persisted by default**, because it contains bank and tax numbers. Add an explicit opt-in toggle labeled with that warning, and a "Clear all data" button.
* Wrap all storage calls in try/catch, and work normally if storage is unavailable.

## 8. Branding and UI

* **Colors:**
  * Navy `#29357F`: primary, headers, body text.
  * Cyan `#0099E6`: accents, section headings, active states.
  * Gray `#595959`: secondary text.
  * Light blue `#E8F4FB`: highlight and callout fill.
  * Status colors: error red `#9B1C1C` on `#FDE2E1`; warning amber `#92400E` on `#FEF3C7`; success green of your choice.
* **Font:** Aptos, with the fallback stack Segoe UI, Calibri, Arial, sans-serif.
* **Logo:** in the header, plus an emoji or logo-derived favicon.
* Clean, professional, dense enough for consultants working through hundreds of suppliers. Keyboard friendly.
* Works in both light and dark mode.
* **UI copy:**
  * Plain and friendly.
  * **No em dashes anywhere in UI text.**
  * Use benefit framing for helper text ("Save this mapping to make the next file from this client load instantly").

## 9. Repo structure (suggested)

```
/reference                 source files listed in section 3 (committed)
/scripts                   extract-reference-data, generate-column-map
/src
  /ingest                  workbook reader, loose table reader, header detection
  /mapping                 column mapping, profiles, value mapping
  /reference               reference types, matching, baseline data
  /model                   supplier data model, merge logic, temp IDs
  /validation              rules table, validators (ABA, IBAN, BIC, EIN), engine
  /eib                     column map, row stacker, template writer
  /report                  exception report writer
  /ui                      steps, profile card, dashboard, components
  /data                    generated JSON (lists, rules, template asset)
/tests                     unit + golden-file tests
/fixtures                  sample inputs
```

## 10. Testing

* Unit tests for every validator, including known-good and known-bad ABA numbers, IBANs, BICs, and EINs.
* **Fixtures:** create a filled sample Conversion Workbook with 5 suppliers:
  * Agile Staffing LTD, rebuilt from the PDF.
  * A clean US supplier with EFT and a bank account.
  * A supplier with multiple addresses, emails, and payment types.
  * A deliberately messy supplier: bad routing number, missing region, unresolved category, two primary emails.
  * A duplicate of supplier 2 under a slightly different name.
* Also a loose CSV covering the same suppliers, with different headers and merged rows.
* **Golden-file test:** export the EIB for the clean fixtures and compare cell by cell against a checked-in expected EIB. Review that expected file with me before locking it in.
* **Template round-trip test:** opening and saving the blank template changes nothing in rows 1 to 5 or in the data validations.

## 11. Milestones

Commit and push at the end of each milestone. Open a PR per milestone if I set up branch protection.

1. **Scaffold:** repo, Vite single-file build, branding shell, step navigation, reference data extraction script, template round-trip test.
2. **Ingest + model:** Conversion Workbook reader, loose table reader, merge logic, temp IDs, ingest summary. Acceptance: the sample workbook loads into 5 correct supplier records.
3. **Map + value mapping:** mapping screen, profiles, value mapping rules, multi-value handling. Acceptance: the loose CSV maps into the same 5 records.
4. **Reference ID manager.** Acceptance: every reference field on the fixtures shows Matched, Assumed, or Unresolved, and resolutions persist.
5. **Validation engine.** Acceptance: the messy supplier shows the expected errors, and the clean suppliers show none.
6. **Proposed profiles + dashboard.** Acceptance: the Agile Staffing profile visually matches the PDF's section order and content.
7. **Pre-export gate + EIB export.** Acceptance: the golden-file test passes, and the file uploads cleanly to a sandbox tenant (I'll test this one).
8. **Exception report + workspaces + polish.**
9. **Deploy:** GitHub Pages via Actions, plus the downloadable single HTML file as a release asset.

## 12. Open items to confirm with me

* The exact Document_Status_ID value for "Approved" in our tenants.
* The full list of address, phone, and email **Use For** values beyond Billing, Remit To, and Shipping.
* Whether the hosted version needs a login (for the BP Workflow Studio we explored hosting with login).
* The repo name and visibility. My suggestion is a private repo named `commit-supplier-eib-builder`.

## 13. How to work with me

* Ask before you guess on anything EIB-structural: column identity, row stacking, reference ID types.
* Keep a running `DECISIONS.md` of choices made and why.
* At the end of each milestone, give me a short summary: what's done, how to try it, and what's next.
