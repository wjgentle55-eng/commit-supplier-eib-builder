# Commit Supplier EIB Builder

A browser-based tool that turns supplier data into a load-ready Workday **Submit Supplier (v44.1)** EIB. It shows a proposed profile for every supplier, runs validation as you go, and stops at a pre-export check.

Everything runs in the browser. There's no backend and no network access at runtime, so supplier data never leaves the page.

## Use it

Open `dist/supplier-eib-builder.html` in any modern browser. It works straight from your file system.

## Develop

```bash
npm install          # uses .npmrc (exact versions, legacy peer deps)
npm run dev          # local dev server
npm test             # unit tests
npm run build        # dist/supplier-eib-builder.html (one self-contained file)
npm run extract      # regenerate src/data/* from /reference
node scripts/generate-column-map.mjs   # re-snapshot the EIB template headers
```

## Layout

| Path | What's there |
|---|---|
| `reference/` | Source files: blank EIB template, Conversion Workbook, View Supplier PDF, logos |
| `scripts/` | Reference data extraction and EIB column snapshot |
| `src/eib/` | Template reader and writer, column snapshot |
| `src/data/` | Generated data (lists, address and bank rules, template as base64) |
| `src/ui/` | App shell, steps, styles |
| `src/model/` | Workspaces, and from Milestone 2 the supplier model |
| `tests/` | Vitest suites |
| `docs/BUILD_BRIEF.md` | The build brief |
| `DECISIONS.md` | Choices made and why |

## How it works

1. **Ingest**: drop a Supplier Conversion Workbook (read tab by tab, joined on Supplier Name) or any Excel/CSV export, or paste a table.
2. **Map** (loose tables only): confirm suggested column mappings, set values for all rows, save mapping profiles, and manage value mapping rules.
3. **Reference IDs**: every reference value is Matched, Assumed, or Unresolved. Load tenant values, accept suggestions, confirm assumptions. Resolutions are saved per client workspace.
4. **Review**: batch dashboard, filterable supplier list, and an editable profile per supplier laid out like Workday's View Supplier page, with errors and warnings next to each field.
5. **Export**: the pre-export gate (no errors on included suppliers, every assumed ID confirmed), then the EIB and a client-facing exception report.

Client workspaces (mapping profiles, value mappings, resolutions, tenant values, settings) live in browser storage and export/import as JSON. The supplier batch is only kept in the browser if you opt in.

## Testing

`npm test` runs the unit tests, the Milestone acceptance tests on `fixtures/`, the template round-trip test, and the golden-file test (`tests/golden/expected-eib-clean-fixtures.xlsx`, with a readable cell list in `tests/golden/expected-eib-clean-fixtures.review.csv`). Rebuild fixtures with `node scripts/build-fixtures.mjs`.

## Releases

Push a tag like `v1.0.0` (or run the Release workflow by hand). GitHub Actions runs the tests, builds the single HTML file, and attaches it to the release.

## Milestones

1. **Scaffold** (done)
2. **Ingest + model** (done)
3. **Map + value mapping** (done)
4. **Reference ID manager** (done)
5. **Validation engine** (done)
6. **Proposed profiles + dashboard** (done)
7. **Pre-export gate + EIB export** (done; golden file and row stacking pending your review and a sandbox load)
8. **Exception report + workspaces + polish** (done)
9. **Deploy** (done: CI and release workflows)
