# Decisions

Running log of choices made while building the Supplier EIB Builder, and why.
Status: **Locked** (agreed with Jack), **Default** (my call, open to change), **Proposed** (needs Jack's confirmation before the milestone that depends on it).

| ID | Date | Decision | Status |
|---|---|---|---|
| D-001 | 2026-10-29 | Repo is private `wjgentle55-eng/commit-supplier-eib-builder`. Commits are pushed through the GitHub web UI as the signed-in account. | Locked |
| D-002 | 2026-10-29 | The RAVN workbook is out of scope, including as a rule source. Validation rules come from brief section 6.6 plus the Conversion Workbook's Address Rules and Bank Rules tabs. | Locked |
| D-003 | 2026-10-29 | Vanilla JS (ES modules), no UI framework. Vite 8.3.4 + vite-plugin-singlefile 2.3.3 build one HTML file. Versions are pinned exactly and were all released at least two weeks before pinning. | Default |
| D-004 | 2026-10-29 | **The EIB is written by injecting rows into the template's sheet XML (JSZip), not by an ExcelJS round-trip.** The brief asked to verify ExcelJS first. It failed: ExcelJS expanded the template's 56 data validations into about 3 million per-cell entries in memory and wrote them back as 223 differently grouped validations, and it dropped the auto color on header borders. Injection keeps every package part except the sheet byte-identical, and keeps rows 1 to 5, `<cols>`, merged cells, and data validations in the sheet byte-identical too (see `tests/template-roundtrip.test.js`). ExcelJS stays in the project for the branded exception report, where we build the file from scratch. | Default |
| D-005 | 2026-10-29 | SheetJS is the official 0.20.3 release, downloaded from cdn.sheetjs.com and vendored at `vendor/xlsx-0.20.3.tgz` (sha256 `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`), installed as `file:vendor/xlsx-0.20.3.tgz`. The npm registry only has 0.18.5, which has known advisories (prototype pollution, ReDoS). The one remaining `npm audit` item is a moderate `uuid` advisory inside ExcelJS; it affects a code path (`v3/v5/v6` with a caller buffer) neither library uses here. | Locked |
| D-006 | 2026-10-29 | npm needs `legacy-peer-deps=true` (in `.npmrc`) because npm 10's peer resolver crashes on vitest 5's optional browser peers. No runtime effect. | Default |
| D-007 | 2026-10-29 | The built page carries a strict Content Security Policy (`default-src 'none'`, `connect-src 'none'`, inline scripts and styles only, `data:`/`blob:` images). This makes "no network calls at runtime" enforced by the browser, not just by convention. | Default |
| D-008 | 2026-10-29 | EIB columns are keyed as `Area :: Field #occurrence`, with Area carried forward across blank row-2 cells. In v44.1 only one Area + Field pair repeats (`Web Address` in Web Address Data+, the second one being the `Web_Address_ID` reference). `src/eib/template-columns.json` snapshots all 411 columns and a test fails if the template headers change. | Default |
| D-009 | 2026-10-29 | Workbook columns ending in `+` are treated as multi-value even where row 2 doesn't say "multi" (`Classifications > Value+`, `Suppliers > Included Children+`, `Proposed Children+`). | Default |
| D-010 | 2026-10-29 | Value Mapping headers are matched tolerantly, so the workbook's "Workday Value" matches the brief's "Workday Value(s)". | Default |
| D-011 | 2026-10-29 | `Suppliers > Supplier Note` maps to `Note Data+ > Note Content`. | Default |
| D-012 | 2026-10-29 | Approval Status is `APPROVED` (Document_Status_ID), confirmed by Jack. Still editable per workspace in settings. | Locked |
| D-013 | 2026-10-29 | Address lines go on nested `Address Line Data+` rows with Type `ADDRESS_LINE_1` through `ADDRESS_LINE_4`. City goes to `Municipality`. Subregion and Submunicipality use the same nested Type pattern. | Locked |
| D-014 | 2026-10-29 | Communication usage `Type*` (Communication_Usage_Type_ID) defaults to `BUSINESS` for every address, phone, email, and web address, since the workbook doesn't collect it. | Locked |
| D-015 | 2026-10-29 | Supplier status writes to `Supplier Status Data+` with Row ID 1. `Proposed Supplier Status Data` is left blank. | Locked |
| D-016 | 2026-10-29 | Region IDs: bundle a standard ISO 3166-2 subdivision list at build time so regions resolve as Assumed (for example `USA-TX`) instead of Unresolved. | Locked |
| D-017 | 2026-10-29 | Related Worktags and classification choice columns take one reference ID type per column, so the ID type is chosen per export in workspace settings. Suppliers whose worktags need a different ID type get flagged to load in a separate file. | Locked |
| D-018 | 2026-10-29 | `Add Only` and `Submit` are left blank as submission plumbing. | Locked |
| D-019 | 2026-10-29 | Baseline Use For values: Billing, Remit To, Shipping, Procurement. Anything else is loaded per client as tenant values. | Locked |
| D-020 | 2026-10-29 | No hosted version and no login. Milestone 9 ships the single HTML file as a GitHub release asset (built by Actions). No GitHub Pages. | Locked |
| D-021 | 2026-10-29 | No sample tenant reference export yet. The tenant value loader is built around the 3-column format (Reference ID Type, Reference ID, Display Name) plus tolerant handling of common report shapes. | Default |
