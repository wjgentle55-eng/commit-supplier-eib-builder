import { h } from './dom.js';
import { typeLabel, refCounts, resolutionKey, indexTenant } from '../reference/resolve.js';
import { BASELINE, regionsFor, taxIdTypesFor } from '../reference/baseline.js';
import { parseTenantValues } from '../reference/tenant.js';
import { downloadText } from './files.js';

const STATUS = {
  matched: ['ok', 'Matched'],
  assumed: ['warn', 'Assumed'],
  unresolved: ['err', 'Unresolved'],
};

export function refsView(ctx) {
  const { state, actions, workspace } = ctx;
  const index = state.batch.refIndex;
  if (!index) return h('section.panel', h('p.muted', 'Load supplier files on the Ingest step first.'));
  const ui = (state.ui.refs ??= { filter: 'attention' });
  const counts = refCounts(index);
  const tenant = workspace.tenantReferenceValues ?? [];
  const tenantIdx = indexTenant(tenant);

  const setResolution = (type, key, id) =>
    actions.updateWorkspace((ws) => {
      ws.referenceResolutions ??= {};
      ws.referenceResolutions[type] ??= {};
      if (id) ws.referenceResolutions[type][key] = { id: id.trim(), at: new Date().toISOString() };
      else delete ws.referenceResolutions[type][key];
    });

  const bulk = (pred, pickId) =>
    actions.updateWorkspace((ws) => {
      ws.referenceResolutions ??= {};
      for (const [type, m] of index) {
        for (const e of m.values()) {
          if (!pred(e)) continue;
          ws.referenceResolutions[type] ??= {};
          ws.referenceResolutions[type][e.key] = { id: pickId(e), at: new Date().toISOString() };
        }
      }
    });

  const nSugg = [...index.values()].flatMap((m) => [...m.values()]).filter((e) => e.status === 'unresolved' && e.suggestion).length;

  const types = [...index.keys()].sort((a, b) => typeLabel(a).localeCompare(typeLabel(b)));
  const visible = (e) => ui.filter === 'all' || (ui.filter === 'attention' ? e.status !== 'matched' : e.status === ui.filter);

  return h('div.stack', [
    h('section.panel', [
      h('div.panel-head', [h('h3', 'Summary'), h('span.muted.small', `Resolutions are saved in "${workspace.name}", so each value only needs resolving once`)]),
      h('div.stats', [
        statBtn(ui, 'matched', counts.matched, 'Matched', 'ok', actions),
        statBtn(ui, 'assumed', counts.assumed, 'Assumed', 'warn', actions),
        statBtn(ui, 'unresolved', counts.unresolved, 'Unresolved', counts.unresolved ? 'err' : '', actions),
      ]),
      h('div.actions', [
        h('label.inline', ['Show ', h('select', {
          'aria-label': 'Filter values',
          on: { change: (e) => { ui.filter = e.target.value; actions.render(); } },
        }, [['attention', 'Needs attention'], ['all', 'All values'], ['unresolved', 'Unresolved'], ['assumed', 'Assumed'], ['matched', 'Matched']].map(([v, l]) => h('option', { value: v, selected: ui.filter === v }, l)))]),
        h('button.btn', { type: 'button', disabled: !nSugg, on: { click: () => bulk((e) => e.status === 'unresolved' && e.suggestion, (e) => e.suggestion.id) } }, `Accept all suggestions (${nSugg})`),
        h('button.btn', { type: 'button', disabled: !counts.assumed, title: 'Marks every assumed ID as confirmed for this client', on: { click: () => { if (confirm(`Confirm all ${counts.assumed} assumed IDs as correct for this client?`)) bulk((e) => e.status === 'assumed', (e) => e.id); } } }, `Confirm all assumed (${counts.assumed})`),
      ]),
    ]),
    tenantPanel(ctx, tenant, tenantIdx),
    ...types.map((type) => {
      const entries = [...index.get(type).values()].sort((a, b) => order(a) - order(b) || String(a.value).localeCompare(String(b.value)));
      const shown = entries.filter(visible);
      if (!shown.length) return null;
      const c = { matched: 0, assumed: 0, unresolved: 0 };
      entries.forEach((e) => c[e.status]++);
      const listId = `dl-${type}`;
      return h('details.panel.ref-type', { open: c.unresolved > 0 || ui.filter !== 'all' }, [
        h('summary.panel-head', [
          h('h3', typeLabel(type)),
          h('span.ref-type-id.mono', type),
          h('span.spacer'),
          c.unresolved > 0 && h('span.chip.err', `${c.unresolved} unresolved`),
          c.assumed > 0 && h('span.chip.warn', `${c.assumed} assumed`),
          c.matched > 0 && h('span.chip.ok', `${c.matched} matched`),
        ]),
        h('datalist', { id: listId }, candidates(type, entries, tenantIdx).map((v) => h('option', { value: v.id }, v.name))),
        h('div.table-wrap', [
          h('table.grid.ref-grid', [
            h('thead', h('tr', [h('th', 'Source value'), h('th.num', 'Suppliers'), h('th', 'Status'), h('th', 'Workday ID'), h('th', '')])),
            h('tbody', shown.map((e) => refRow(e, listId, setResolution, workspace))),
          ]),
        ]),
      ]);
    }),
  ]);
}

const order = (e) => ({ unresolved: 0, assumed: 1, matched: 2 })[e.status];

function statBtn(ui, key, n, label, tone, actions) {
  return h('button.stat', { type: 'button', class: `${tone} ${ui.filter === key ? 'selected' : ''}`, on: { click: () => { ui.filter = key; actions.render(); } } }, [h('span.stat-value', String(n)), h('span.stat-label', label)]);
}

function refRow(e, listId, setResolution, workspace) {
  const [tone, label] = STATUS[e.status];
  const saved = workspace.referenceResolutions?.[e.type]?.[e.key];
  const sup = [...e.suppliers];
  return h('tr', [
    h('td', [h('strong', String(e.value)), e.country && h('span.muted.small', ` (${e.country})`)]),
    h('td.num', { title: sup.join(', ') }, String(sup.length)),
    h('td', [h('span.chip', { class: tone }, label), h('div.muted.small', e.how)]),
    h('td', h('input.field-input.mono', {
      type: 'text',
      list: listId,
      value: e.id,
      placeholder: 'Enter or pick an ID',
      'aria-label': `Workday ID for ${e.value}`,
      'data-focus-key': `ref-${e.type}-${e.key}`,
      on: { change: (ev) => setResolution(e.type, resolutionKey(e.type, e.value, e.country), ev.target.value) },
    })),
    h('td.ref-actions', [
      e.status === 'unresolved' && e.suggestion &&
        h('button.btn.small', { type: 'button', title: `Use ${e.suggestion.name}`, on: { click: () => setResolution(e.type, e.key, e.suggestion.id) } }, `Use "${e.suggestion.id}"`),
      e.status === 'assumed' && h('button.btn.small', { type: 'button', on: { click: () => setResolution(e.type, e.key, e.id) } }, 'Confirm'),
      saved && h('button.link-btn', { type: 'button', title: 'Forget this resolution', on: { click: () => setResolution(e.type, e.key, '') } }, 'Reset'),
    ]),
  ]);
}

function candidates(type, entries, tenantIdx) {
  const t = tenantIdx.get(type);
  if (t?.list.length) return t.list;
  if (type === 'Country_Region_ID') {
    const countries = [...new Set(entries.map((e) => e.country).filter(Boolean))];
    return countries.flatMap((c) => regionsFor(c).map((r) => ({ id: r.id, name: r.names[0] })));
  }
  if (type === 'Tax_ID_Type') {
    const countries = [...new Set(entries.map((e) => e.country).filter(Boolean))];
    return countries.flatMap((c) => taxIdTypesFor(c));
  }
  return BASELINE[type]?.values ?? [];
}

function tenantPanel(ctx, tenant, tenantIdx) {
  const { actions } = ctx;
  const input = h('input', {
    type: 'file', hidden: true, accept: '.xlsx,.xlsm,.xls,.csv,.txt',
    on: {
      change: async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          const { values, problems } = parseTenantValues({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
          if (!values.length) return alert(`No reference values found in ${f.name}.\n${problems.join('\n')}`);
          actions.updateWorkspace((ws) => {
            const types = new Set(values.map((v) => v.type));
            ws.tenantReferenceValues = [...(ws.tenantReferenceValues ?? []).filter((v) => !types.has(v.type)), ...values];
          });
          if (problems.length) alert(`Loaded ${values.length} values. Some sheets were skipped:\n${problems.join('\n')}`);
        } catch (err) {
          alert(`Couldn't read ${f.name}: ${err.message}`);
        }
      },
    },
  });
  const byType = [...tenantIdx.entries()].map(([type, t]) => `${typeLabel(type)} (${t.list.length})`);
  return h('section.panel', [
    h('div.panel-head', [h('h3', 'Tenant values'), h('span.muted.small', tenant.length ? `${tenant.length} values loaded` : 'None loaded')]),
    h('p.small.muted', 'Load reference IDs from your tenant to turn assumed values into matches. Use a file with Reference ID Type, Reference ID, and Display Name columns. Loading a type replaces that type’s values.'),
    tenant.length > 0 && h('p.small', byType.join(', ')),
    h('div.actions', [
      input,
      h('button.btn', { type: 'button', on: { click: () => input.click() } }, 'Load tenant values'),
      h('button.btn', { type: 'button', on: { click: () => downloadText('tenant-reference-values-template.csv', 'Reference ID Type,Reference ID,Display Name\r\nSupplier_Category_ID,Professional_Services,Professional Services\r\nPayment_Terms_ID,Net_30,Net 30\r\n', 'text/csv') } }, 'Download template'),
      tenant.length > 0 && h('button.link-btn.danger', { type: 'button', on: { click: () => { if (confirm('Remove all tenant values from this workspace?')) actions.updateWorkspace((ws) => { ws.tenantReferenceValues = []; }); } } }, 'Clear tenant values'),
    ]),
  ]);
}
