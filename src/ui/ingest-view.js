import { h } from './dom.js';
import { ingest } from '../ingest/index.js';
import { ACCEPTED_EXTENSIONS } from '../ingest/sheets.js';
import { displayName, childCounts } from '../model/supplier.js';

// Step 1: Ingest. Inputs (file bytes and pasted text) are kept in memory only,
// so adding another file re-runs ingest over everything and temp IDs stay stable.

export function ingestView(ctx) {
  const { state, actions } = ctx;
  const batch = state.batch;
  const hasBatch = state.inputs.length > 0;

  const fileInput = h('input', {
    type: 'file',
    multiple: true,
    accept: ACCEPTED_EXTENSIONS.join(','),
    hidden: true,
    on: { change: (e) => addFiles(ctx, [...e.target.files]) },
  });

  const drop = h(
    'div.dropzone',
    {
      tabIndex: 0,
      role: 'button',
      'aria-label': 'Choose supplier files to load',
      on: {
        click: () => fileInput.click(),
        keydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInput.click();
          }
        },
        dragover: (e) => {
          e.preventDefault();
          drop.classList.add('over');
        },
        dragleave: () => drop.classList.remove('over'),
        drop: (e) => {
          e.preventDefault();
          drop.classList.remove('over');
          addFiles(ctx, [...e.dataTransfer.files]);
        },
      },
    },
    [
      h('div.dropzone-icon', { 'aria-hidden': 'true' }, '\u{1F4C2}'),
      h('strong', hasBatch ? 'Add more files' : 'Drop files here, or click to choose'),
      h('span.muted', 'Excel (.xlsx, .xlsm, .xls) or CSV. Files are read right here in your browser and never uploaded.'),
      fileInput,
    ],
  );

  const paste = h('textarea.paste', {
    rows: 4,
    placeholder: 'Or paste a table copied from Excel or a CSV, headers included',
    'aria-label': 'Paste a table',
  });
  const pasteRow = h('div.paste-row', [
    paste,
    h(
      'button.btn',
      {
        type: 'button',
        on: {
          click: () => {
            if (!paste.value.trim()) return;
            const n = state.inputs.filter((i) => i.text !== undefined).length + 1;
            actions.setInputs([...state.inputs, { name: n > 1 ? `Pasted table ${n}` : 'Pasted table', text: paste.value }]);
          },
        },
      },
      'Read pasted table',
    ),
  ]);

  return h('div.stack', [
    h('div.ingest-inputs', [drop, pasteRow]),
    state.ingestError && h('div.banner.err', state.ingestError),
    hasBatch && summaryPanel(ctx, batch),
    hasBatch && batch.tables.length > 0 && tablesPanel(batch),
    hasBatch && batch.suppliers.length > 0 && suppliersPanel(batch),
  ]);
}

async function addFiles(ctx, files) {
  const { state, actions } = ctx;
  const bad = files.filter((f) => !ACCEPTED_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext)));
  const good = files.filter((f) => !bad.includes(f));
  const read = await Promise.all(good.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
  const fresh = read.filter((r) => !state.inputs.some((i) => i.name === r.name && i.bytes?.length === r.bytes.length));
  actions.setInputs([...state.inputs, ...fresh], bad.length ? `Skipped ${bad.map((f) => f.name).join(', ')}: only Excel and CSV files can be read.` : null);
}

/** Runs ingest over all inputs. Exported for main.js. */
export function runIngest(inputs) {
  return ingest(inputs);
}

function stat(label, value, tone) {
  return h('div.stat', { class: tone ?? '' }, [h('span.stat-value', String(value)), h('span.stat-label', label)]);
}

function summaryPanel(ctx, batch) {
  const s = batch.summary;
  const notLoaded = groupBy(s.outOfScope, (o) => o.label);
  return h('section.panel', [
    h('div.panel-head', [
      h('h3', 'Ingest summary'),
      h('button.link-btn', { type: 'button', on: { click: () => ctx.actions.setInputs([]) } }, 'Start over'),
    ]),
    h('div.stats', [
      stat('Files read', s.files.length),
      stat('Rows read', s.rowsRead),
      stat('Suppliers found', s.suppliersFound, s.suppliersFound ? 'ok' : ''),
      stat('Rows skipped', s.skipped.length, s.skipped.length ? 'warn' : ''),
      s.tablesToMap > 0 && stat('Tables to map', s.tablesToMap, 'warn'),
      s.valueMappings > 0 && stat('Value mappings', s.valueMappings),
      s.existingSuppliers > 0 && stat('Existing suppliers', s.existingSuppliers),
    ]),
    h('ul.file-list', s.files.map((f) => h('li', [h('strong', f.name), h('span.muted', ` ${f.kind}`)]))),
    s.problems.length > 0 && detailList('Needs attention', s.problems.map((p) => p), 'err'),
    s.skipped.length > 0 &&
      detailList(
        'Rows skipped',
        s.skipped.map((r) => `${r.sheet} row ${r.row}: ${r.reason}`),
        'warn',
      ),
    notLoaded.size > 0 &&
      detailList(
        'Not loaded by this tool',
        [...notLoaded].map(([label, items]) => `${label} (${items.map((i) => i.where).join(', ')}). These load through a separate process.`),
      ),
    s.ignored.length > 0 && detailList('Ignored', s.ignored.map((i) => `${i.where}: ${i.reason}`)),
  ]);
}

function detailList(title, items, tone) {
  return h('details.detail', { open: tone === 'err' }, [
    h('summary', [title, ' ', h('span.chip', { class: tone ?? '' }, String(items.length))]),
    h('ul.plain-list', items.slice(0, 200).map((t) => h('li', t))),
    items.length > 200 && h('p.muted.small', `And ${items.length - 200} more.`),
  ]);
}

function tablesPanel(batch) {
  return h('section.panel.callout', [
    h('div.panel-head', [h('h3', 'Tables waiting for mapping'), h('span.tag', 'Next: Map step')]),
    h('p', 'These tables are not in the Conversion Workbook format, so their columns need to be matched to Workday fields first.'),
    h(
      'ul.plain-list',
      batch.tables.map((t) => h('li', `${t.file} > ${t.sheet}: ${t.rows.length} rows, ${t.headers.length} columns, headers on row ${t.headerRow}`)),
    ),
  ]);
}

const COUNT_COLS = [
  ['addresses', 'Addr'],
  ['phones', 'Phone'],
  ['emails', 'Email'],
  ['webAddresses', 'Web'],
  ['taxIds', 'Tax ID'],
  ['settlementAccounts', 'Bank'],
  ['alternateNames', 'Alt name'],
];

function suppliersPanel(batch) {
  const rows = batch.suppliers.map((s) => {
    const c = childCounts(s);
    const f = s.supplier.fields;
    const p = s.payment.fields;
    const errs = s.notes.filter((n) => n.severity === 'error').length;
    const warns = s.notes.filter((n) => n.severity === 'warning').length;
    return h('tr', [
      h('td.mono', s.tempId),
      h('td', [h('strong', displayName(s))]),
      h('td', f.category?.value ?? ''),
      h('td', f.defaultCurrency?.value ?? ''),
      h('td', (p.paymentTypesAccepted?.value ?? []).join(', ')),
      ...COUNT_COLS.map(([k]) => h('td.num', c[k] ? String(c[k]) : h('span.muted', '0'))),
      h('td', [
        errs > 0 && h('span.chip.err', { title: s.notes.filter((n) => n.severity === 'error').map((n) => n.message).join('\n') }, `${errs} error${errs > 1 ? 's' : ''}`),
        warns > 0 && h('span.chip.warn', { title: s.notes.filter((n) => n.severity === 'warning').map((n) => n.message).join('\n') }, `${warns} warning${warns > 1 ? 's' : ''}`),
      ]),
    ]);
  });
  return h('section.panel', [
    h('div.panel-head', [h('h3', `Suppliers found (${batch.suppliers.length})`), h('span.muted.small', 'Full validation runs in the Review step')]),
    h('div.table-wrap', [
      h('table.grid', [
        h('thead', h('tr', [
          h('th', 'Temp ID'), h('th', 'Supplier Name'), h('th', 'Category'), h('th', 'Currency'), h('th', 'Payment types'),
          ...COUNT_COLS.map(([, l]) => h('th.num', l)), h('th', 'Ingest notes'),
        ])),
        h('tbody', rows),
      ]),
    ]),
  ]);
}

function groupBy(list, fn) {
  const m = new Map();
  for (const x of list) {
    const k = fn(x);
    m.set(k, [...(m.get(k) ?? []), x]);
  }
  return m;
}
