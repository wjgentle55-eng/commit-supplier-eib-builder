# Decisions

Running log of choices made while building the Supplier EIB Builder, and why.
Status: **Locked** (agreed with Jack), **Default** (my call, open to change), **Proposed** (needs Jack's confirmation before the milestone that depends on it).

| ID | Date | Decision | Status |
|---|---|---|---|
| D-001 | 2026-10-29 | Repo is private `wjgentle55-eng/commit-supplier-eib-builder`. Commits are pushed through the GitHub web UI as the signed-in account. | Locked |
| D-002 | 2026-10-29 | The RAVN workbook is out of scope, including as a rule source. Validation rules come from brief section 6.6 plus the Conversion Workbook's Address Rules and Bank Rules tabs. | Locked |
| D-003 | 2026-10-29 | Vanilla JS (ES modules), no UI framework. Vite 8.3.4 + vite-plugin-singlefile 2.3.3 build one HTML file. Versions are pinned exactly and were all released at least two weeks before pinning. | Default |
| D-004 | 2026-10-29 | **The EIB is written by injecting rows into the template's sheet XML (JSZip), not by an ExcelJS round-trip.** The brief asked to verify ExcelJS first. It failed: ExcelJS expanded the template's 56 data validations into about 3 million per-cell entries in memory and wrote them back as 223 differently grouped validations, and it dropped the auto color on header borders. Injection keeps every package part except the sheet byte-identical, and keeps rows 1 to 5, `<cols>`, merged cells, and data validations in the sheet byte-identical too (see `tests/template-roundtrip.test.js`). ExcelJS stays in the project for the branded exception report, where we build the file from scratch. | Default |
| D-005 | 2026-10-29 | SheetJS is pinned to `xlsx@0.18.5`, the last version on the npm registry. The current SheetJS release (0.20.x) is only published on cdn.sheetjs.com, which this build environment can't reach. 0.18.5 has known advisories (prototype pollution, ReDoS) that matter most for untrusted files. Plan: vendor the 0.20.3 tarball into `vendor/` and switch before Milestone 2 ships to users. | Default, follow-up |
| D-006 | 2026-10-29 | npm needs `legacy-peer-deps=true` (in `.npmrc`) because npm 10's peer resolver crashes on vitest 5's optional browser peers. No runtime effect. | Default |
| D-007 | 2026-10-29 | The built page carries a strict Content Security Policy (`default-src 'none'`, `connect-src 'none'`, inline scripts and styles only, `data:`/`blob:` images). This makes "no network calls at runtime" enforced by the browser, not just by convention. | Default |
| D-008 | 2026-10-29 | EIB columns are keyed as `Area :: Field #occurrence`, with Area carried forward across blank row-2 cells. In v44.1 only one Area + Field pair repeats (`Web Address` in Web Address Data+, the second one being the `Web_Address_ID` reference). `src/eib/template-columns.json` snapshots all 411 columns and a test fails if the template headers change. | Default |
| D-009 | 2026-10-29 | Workbook columns ending in `+` are treated as multi-value even where row 2 doesn't say "multi" (`Classifications > Value+`, `Suppliers > Included Children+`, `Proposed Children+`). | Default |
| D-010 | 2026-10-29 | Value Mapping headers are matched tolerantly, so the workbook's "Workday Value" matches the brief's "Workday Value(s)". | Default |
| D-011 | 2026-10-29 | `Suppliers > Supplier Note` maps to `Note Data+ > Note Content`. | Default |
| D-012 | 2026-10-29 | Approval Status defaults to `APPROVED` (Document_Status_ID) and is configurable per workspace. Shown as "Verify in tenant" until confirmed. | Default, open item |
| D-013 | 2026-10-29 | Address lines go on nested `Address Line Data+` rows with Type `ADDRESS_LINE_1` through `ADDRESS_LINE_4`. City goes to `Municipality`. Subregion and Submunicipality use the same nested Type pattern. | Proposed |
| D-014 | 2026-10-29 | Communication usage `Type*` (Communication_Usage_Type_ID) defaults to `BUSINESS` for every address, phone, email, and web address, since the workbook doesn't collect it. | Proposed |
| D-015 | 2026-10-29 | Supplier status writes to `Supplier Status Data+` with Row ID 1. `Proposed Supplier Status Data` is left blank. | Proposed |
| D-016 | 2026-10-29 | Region IDs: bundle a standard ISO 3166-2 subdivision list at build time so regions resolve as Assumed (for example `USA-TX`) instead of Unresolved. | Proposed |
| D-017 | 2026-10-29 | Related Worktags and classification choice columns allow one ID type per column. Options: one ID type per export (setting), WIDs, or flag as manual load. | Open |
| D-018 | 2026-10-29 | `Add Only` and `Submit` are left blank as submission plumbing. | Proposed |
