import { h } from './dom.js';
import { ingestView } from './ingest-view.js';
import { mapView } from './map-view.js';
import { refsView } from './refs-view.js';
import { refCounts } from '../reference/resolve.js';
import { reviewView } from './review-view.js';
import { exportView } from './export-view.js';

// Step definitions for the left-hand navigation. Each view gets the app
// context and returns a DOM node. Views are placeholders until their milestone.

export const STEPS = [
  {
    id: 'ingest',
    label: 'Ingest',
    title: 'Bring in supplier data',
    helper: 'Drop in a Supplier Conversion Workbook to load every tab in one go, or a loose Excel or CSV export to map it yourself.',
    view: (ctx) => ingestView(ctx),
  },
  {
    id: 'map',
    label: 'Map',
    title: 'Map columns to Workday fields',
    helper: 'Save a confirmed mapping as a profile to make the next file from this client load instantly.',
    view: (ctx) => mapView(ctx),
    badge: (ctx) => {
      const pending = (ctx.state.batch.tables ?? []).filter((t) => !ctx.state.mappings[t.id]?.confirmed).length;
      return pending ? h('span.step-badge', { title: `${pending} table(s) to map` }, String(pending)) : null;
    },
  },
  {
    id: 'reference',
    label: 'Reference IDs',
    title: 'Resolve reference IDs',
    helper: 'Resolve each value once and this workspace remembers it, to make the next batch for this client faster.',
    view: (ctx) => refsView(ctx),
    badge: (ctx) => {
      const idx = ctx.state.batch.refIndex;
      const n = idx ? refCounts(idx).unresolved : 0;
      return n ? h('span.step-badge.err', { title: `${n} unresolved value(s)` }, String(n)) : null;
    },
  },
  {
    id: 'review',
    label: 'Review',
    title: 'Review proposed suppliers',
    helper: 'Fix issues right on the profile to see the batch status update as you go.',
    wide: true,
    view: (ctx) => reviewView(ctx),
    badge: (ctx) => {
      const n = ctx.state.batch.validation?.counts.blocked ?? 0;
      return n ? h('span.step-badge.err', { title: `${n} blocked supplier(s)` }, String(n)) : null;
    },
  },
  {
    id: 'export',
    label: 'Export',
    title: 'Confirm and export',
    helper: 'Confirm the assumed values first to make sure the load goes through cleanly the first time.',
    view: (ctx) => exportView(ctx),
  },
];
