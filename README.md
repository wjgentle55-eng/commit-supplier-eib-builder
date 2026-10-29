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

## Milestones

1. **Scaffold** (done): single-file build, branding shell, step navigation, reference data extraction, template round-trip test
2. Ingest + model
3. Map + value mapping
4. Reference ID manager
5. Validation engine
6. Proposed profiles + dashboard
7. Pre-export gate + EIB export
8. Exception report + workspaces + polish
9. Deploy
