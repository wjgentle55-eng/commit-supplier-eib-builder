import { h } from './dom.js';
import { exportEib, exportPlan, today, WORKTAG_ID_TYPES } from '../eib/export.js';
import { base64ToBytes } from '../eib/template.js';
import { EIB_TEMPLATE_BASE64 } from '../data/eib-template.js';
import { settingsOf } from '../model/workspace.js';
import { typeLabel } from '../reference/resolve.js';
import { displayName } from '../model/supplier.js';
import { downloadBytes } from './files.js';
import { buildExceptionReport } from '../report/exception-report.js';
import logoUrl from '../assets/commit-logo.png';

// Step 5: the pre-export gate, then the EIB and the exception report.

export function exportView(ctx) {
  const { state } = ctx;
  if (!state.batch.suppliers.length) return h('section.panel', h('p.muted', 'Load supplier files on the Ingest step first.'));
  const ui = (state.ui.export ??= { reviewedAssumed: false, last: null, busy: false, includeWarnings: true });
  const plan = exportPlan(state.batch.suppliers);
  const assumed = assumedForIncluded(state);
  const needsAck = assumed.length > 0 && !ui.reviewedAssumed;
  const ready = plan.canExport && !needsAck;

  return h('div.stack', [
    h('section.panel', [
      h('div.panel-head', [h('h3', 'Pre-export check'), ready ? h('span.chip.ok', 'Ready to export') : h('span.chip.err', 'Not ready yet')]),
      h('div.stats', [
        stat(plan.included.length, 'Suppliers included', plan.included.length ? 'ok' : ''),
        stat(plan.excluded.length, 'Excluded', ''),
        stat(plan.blocked.length, 'Included with errors', plan.blocked.length ? 'err' : 'ok'),
        stat(assumed.length, 'Assumed IDs to confirm', assumed.length ? 'warn' : 'ok'),
      ]),
      h('ol.gate-steps', [
        gateStep(plan.blocked.length === 0, 'Fix or exclude every supplier with errors'),
        gateStep(assumed.length === 0 || ui.reviewedAssumed, 'Confirm or change every assumed reference ID'),
        gateStep(plan.included.length > 0, 'Include at least one supplier'),
      ]),
    ]),
    plan.blocked.length > 0 && blockedPanel(ctx, plan),
    assumedPanel(ctx, assumed),
    settingsPanel(ctx),
    h('section.panel', [
      h('div.panel-head', [h('h3', 'Export')]),
      h('p.small.muted', 'The EIB is built on the Workday Submit Supplier v44.1 template, rows 6 and down. Everything is generated in this browser.'),
      h('div.actions', [
        h('button.btn.primary', { type: 'button', disabled: !ready || ui.busy, on: { click: () => doExport(ctx) } }, ui.busy ? 'Building...' : `Download EIB (${plan.included.length} supplier${plan.included.length === 1 ? '' : 's'})`),
        h('label.inline.small', [
          h('input', { type: 'checkbox', checked: ui.includeWarnings, on: { change: (e) => { ui.includeWarnings = e.target.checked; } } }),
          'Include warnings in the exception report',
        ]),
        h('button.btn', { type: 'button', on: { click: () => doReport(ctx) } }, 'Download exception report'),
      ]),
      ui.error && h('div.banner.err', ui.error),
      ui.last && lastExport(ui.last),
    ]),
  ]);
}

const stat = (n, label, tone) => h('div.stat', { class: tone }, [h('span.stat-value', String(n)), h('span.stat-label', label)]);
const gateStep = (ok, text) => h('li', { class: ok ? 'done' : '' }, [h('span.gate-mark', ok ? '✓' : '•'), text]);

function blockedPanel(ctx, plan) {
  const { state, actions } = ctx;
  return h('section.panel', [
    h('div.panel-head', [h('h3', `Suppliers with errors (${plan.blocked.length})`),
      h('button.btn.small', { type: 'button', title: 'Leaves them out of this EIB; they stay in the exception report', on: { click: () => actions.setExcluded(plan.blocked.map((s) => s.tempId), true) } }, 'Exclude all of these')]),
    h('div.table-wrap', [
      h('table.grid', [
        h('thead', h('tr', [h('th', 'Temp ID'), h('th', 'Supplier'), h('th', 'Errors'), h('th', '')])),
        h('tbody', plan.blocked.map((s) => h('tr', [
          h('td.mono', s.tempId),
          h('td', h('strong', displayName(s))),
          h('td.wrap', s.issues.filter((i) => i.severity === 'error').slice(0, 3).map((i) => h('div.small', `${i.recordLabel}${i.fieldLabel ? ` > ${i.fieldLabel}` : ''}: ${i.message}`)).concat(s.errorCount > 3 ? [h('div.small.muted', `and ${s.errorCount - 3} more`)] : [])),
          h('td.actions-cell', [
            h('button.btn.small', { type: 'button', on: { click: () => { state.ui.review.selected = s.tempId; state.ui.review.filter = 'all'; actions.go('review'); } } }, 'Fix'),
            h('button.btn.small', { type: 'button', on: { click: () => actions.setExcluded([s.tempId], true) } }, 'Exclude'),
          ]),
        ]))),
      ]),
    ]),
  ]);
}

/** Assumed reference values used by included suppliers, grouped by type. */
function assumedForIncluded(state) {
  const included = new Set(state.batch.suppliers.filter((s) => !s.excluded).map((s) => s.tempId));
  const out = [];
  for (const m of state.batch.refIndex?.values() ?? []) {
    for (const e of m.values()) if (e.status === 'assumed' && [...e.suppliers].some((t) => included.has(t))) out.push(e);
  }
  return out.sort((a, b) => typeLabel(a.type).localeCompare(typeLabel(b.type)) || String(a.value).localeCompare(String(b.value)));
}

function assumedPanel(ctx, assumed) {
  const { state, actions } = ctx;
  const ui = state.ui.export;
  const setRes = (list, idOf) => actions.updateWorkspace((ws) => {
    ws.referenceResolutions ??= {};
    for (const e of list) {
      ws.referenceResolutions[e.type] ??= {};
      ws.referenceResolutions[e.type][e.key] = { id: idOf(e), at: new Date().toISOString() };
    }
  });
  if (!assumed.length) {
    return h('section.panel', [h('div.panel-head', [h('h3', 'Assumed reference IDs'), h('span.chip.ok', 'None left')]), h('p.small.muted', 'Every reference ID is matched to tenant values, a Workday standard, or confirmed by you.')]);
  }
  const groups = new Map();
  for (const e of assumed) groups.set(e.type, [...(groups.get(e.type) ?? []), e]);
  return h('section.panel', [
    h('div.panel-head', [h('h3', `Assumed reference IDs (${assumed.length})`),
      h('button.btn.small', { type: 'button', on: { click: () => setRes(assumed, (e) => e.id) } }, 'Confirm all as shown')]),
    h('p.small.muted', 'These IDs were derived from standard Workday values or the naming pattern, not from your tenant. Check each one, to make sure the load goes through cleanly the first time. Confirmed IDs are saved in this workspace.'),
    h('div.assumed-groups', [...groups].map(([type, list]) => h('div.assumed-group', [
      h('h4', typeLabel(type)),
      h('table.grid.compact', h('tbody', list.map((e) => h('tr', [
        h('td', [String(e.value), e.country && h('span.muted.small', ` (${e.country})`)]),
        h('td', h('input.field-input.mono', { type: 'text', value: e.id, 'aria-label': `Workday ID for ${e.value}`, 'data-focus-key': `gate-${e.type}-${e.key}`, on: { change: (ev) => setRes([e], () => ev.target.value.trim()) } })),
        h('td.num', { title: [...e.suppliers].join(', ') }, `${e.suppliers.size} supplier${e.suppliers.size > 1 ? 's' : ''}`),
        h('td', h('button.btn.small', { type: 'button', on: { click: () => setRes([e], () => e.id) } }, 'Confirm')),
      ])))),
    ]))),
    h('label.inline.ack', [
      h('input', { type: 'checkbox', checked: ui.reviewedAssumed, on: { change: (e) => { ui.reviewedAssumed = e.target.checked; actions.render(); } } }),
      'I’ve reviewed the assumed IDs above and want to export them as shown',
    ]),
  ]);
}

function settingsPanel(ctx) {
  const { actions, workspace, state } = ctx;
  const st = settingsOf(workspace);
  const save = (k) => (e) => actions.updateWorkspace((ws) => { ws.settings = { ...settingsOf(ws), [k]: e.target.value.trim() }; });
  const hasWorktags = state.batch.suppliers.some((s) => s.relatedWorktags.length);
  return h('details.panel.settings', [
    h('summary.panel-head', [h('h3', 'Export settings'), h('span.muted.small', `Saved in "${workspace.name}"`)]),
    h('div.fgrid', [
      setting('Approval Status (Document_Status_ID)', st.approvalStatusId, save('approvalStatusId'), 'Written to every supplier.'),
      setting('Address ID pattern', st.addressIdPattern, save('addressIdPattern'), 'Tokens: {date} {key} {n} {label}'),
      setting('Settlement Bank Account ID pattern', st.settlementAccountIdPattern, save('settlementAccountIdPattern'), 'Tokens: {date} {key} {n} {label}'),
      setting('Intermediary Bank Account ID pattern', st.intermediaryAccountIdPattern, save('intermediaryAccountIdPattern'), 'Tokens: {date} {key} {n} {label}'),
      hasWorktags && h('div.field', [
        h('label.flabel', 'Related Worktags ID type'),
        h('select.field-input', { on: { change: save('worktagIdType') } }, [
          h('option', { value: '', selected: !st.worktagIdType }, 'Pick from the first worktag type'),
          ...WORKTAG_ID_TYPES.map(([, t]) => h('option', { value: t, selected: st.worktagIdType === t }, t)),
        ]),
        h('div.prov', 'One ID type per file. Worktags of other types are left out and listed after export.'),
      ]),
    ]),
  ]);
}

const setting = (label, value, onChange, help) => h('div.field', [h('label.flabel', label), h('input.field-input.mono', { type: 'text', value, on: { change: onChange } }), help && h('div.prov', help)]);

async function doExport(ctx) {
  const { state, actions, workspace } = ctx;
  const ui = state.ui.export;
  ui.busy = true;
  ui.error = null;
  actions.render();
  try {
    const res = await exportEib({ suppliers: state.batch.suppliers, workspace, templateBytes: base64ToBytes(EIB_TEMPLATE_BASE64), date: today() });
    downloadBytes(res.fileName, res.bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    ui.last = res;
  } catch (err) {
    ui.error = err.message;
  }
  ui.busy = false;
  actions.render();
}

async function doReport(ctx) {
  const { state, actions, workspace } = ctx;
  try {
    const { bytes, fileName } = await buildExceptionReport({ suppliers: state.batch.suppliers, workspace, includeWarnings: state.ui.export.includeWarnings, skipped: state.ui.export.last?.skipped ?? [], logoDataUrl: logoUrl });
    downloadBytes(fileName, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  } catch (err) {
    state.ui.export.error = `Couldn't build the exception report: ${err.message}`;
    actions.render();
  }
}

function lastExport(res) {
  return h('div.export-result', [
    h('p', [h('strong', res.fileName), ` downloaded: ${res.keys.length} suppliers on ${res.rowCount} rows.`]),
    res.skipped.length > 0 && h('div.banner.warn', [h('strong', 'Left out of this file'), h('ul.plain-list', res.skipped.map((x) => h('li', `${x.name} (${x.tempId}): ${x.message}`)))]),
    h('details.detail', [
      h('summary', 'Spreadsheet Keys in this file'),
      h('table.grid.compact', [h('thead', h('tr', [h('th', 'Key'), h('th', 'Temp ID'), h('th', 'Supplier'), h('th.num', 'Rows')])),
        h('tbody', res.keys.map((k) => h('tr', [h('td', String(k.key)), h('td.mono', k.tempId), h('td', k.name), h('td.num', String(k.rows))])))]),
    ]),
  ]);
}
