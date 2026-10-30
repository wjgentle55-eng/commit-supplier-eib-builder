import { h } from './dom.js';
import { SECTION_BY_KEY } from '../model/schema.js';
import { displayName } from '../model/supplier.js';
import { normalizeRule } from '../mapping/value-mapping.js';
import { typeLabel } from '../reference/resolve.js';

// Step 4: Review. A filterable supplier list, a batch dashboard, and an
// editable proposed profile laid out like Workday's View Supplier page.

const STATUS = { clean: ['ok', 'Clean'], warnings: ['warn', 'Warnings'], blocked: ['err', 'Blocked'] };

export function reviewView(ctx) {
  const { state } = ctx;
  const batch = state.batch;
  if (!batch.suppliers.length) return h('section.panel', h('p.muted', 'Load supplier files on the Ingest step first.'));
  const ui = state.ui.review;
  const list = filtered(batch.suppliers, ui);
  let selected = batch.suppliers.find((s) => s.tempId === ui.selected) ?? list[0] ?? batch.suppliers[0];
  ui.selected = selected?.tempId;

  return h('div.stack', [
    dashboard(ctx),
    h('div.review', [
      supplierList(ctx, list),
      selected ? profileCard(ctx, selected) : h('section.panel', h('p.muted', 'No suppliers match this filter.')),
    ]),
  ]);
}

function filtered(suppliers, ui) {
  const q = ui.search.trim().toLowerCase();
  return suppliers.filter((s) => {
    if (ui.filter === 'excluded' && !s.excluded) return false;
    if (['clean', 'warnings', 'blocked'].includes(ui.filter) && s.status !== ui.filter) return false;
    if (ui.issueKey && !s.issues.some((i) => `${i.ruleId}|${i.fieldLabel}` === ui.issueKey)) return false;
    if (q && !`${s.tempId} ${displayName(s)}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

// --------------------------------------------------------------- dashboard

function dashboard(ctx) {
  const { state, actions } = ctx;
  const v = state.batch.validation;
  if (!v) return null;
  const ui = state.ui.review;
  const c = v.counts;
  const tile = (key, n, label, tone) =>
    h('button.stat', { type: 'button', class: `${tone} ${ui.filter === key ? 'selected' : ''}`, on: { click: () => { ui.filter = key; ui.issueKey = null; actions.render(); } } }, [h('span.stat-value', String(n)), h('span.stat-label', label)]);
  return h('section.panel', [
    h('div.panel-head', [h('h3', 'Batch dashboard'), h('span.muted.small', `${c.errors} errors and ${c.warningsTotal} warnings across ${state.batch.suppliers.length} suppliers`)]),
    h('div.stats', [
      tile('all', state.batch.suppliers.length, 'All suppliers', ''),
      tile('blocked', c.blocked, 'Blocked', c.blocked ? 'err' : ''),
      tile('warnings', c.warnings, 'Warnings', c.warnings ? 'warn' : ''),
      tile('clean', c.clean, 'Clean', c.clean ? 'ok' : ''),
      tile('excluded', state.excluded.size, 'Excluded', ''),
    ]),
    v.top.length > 0 &&
      h('details.detail', { open: true }, [
        h('summary', 'Top issues'),
        h('table.grid.top-issues', [
          h('tbody', v.top.map((g) => topIssueRow(ctx, g))),
        ]),
      ]),
  ]);
}

function topIssueRow(ctx, g) {
  const { state, actions } = ctx;
  const ui = state.ui.review;
  const active = ui.issueKey === g.key;
  return h('tr', { class: active ? 'active' : '' }, [
    h('td', h('span.chip', { class: g.severity === 'error' ? 'err' : 'warn' }, g.severity === 'error' ? 'Error' : 'Warning')),
    h('td.num', `${g.suppliers.size}`),
    h('td', [h('strong', g.fieldLabel || g.sectionLabel), h('div.small.muted', g.example)]),
    h('td.actions-cell', [
      h('button.btn.small', { type: 'button', on: { click: () => { ui.issueKey = active ? null : g.key; ui.filter = 'all'; actions.render(); } } }, active ? 'Show all' : 'Show suppliers'),
      fixAllButton(ctx, g),
    ]),
  ]);
}

/** "Fix all like this" for issue kinds where one decision safely applies everywhere. */
function fixAllButton(ctx, g) {
  const { state, actions } = ctx;
  if (g.ruleId === 'REF-assumed') {
    const entries = refEntriesFor(state, g, 'assumed');
    return h('button.btn.small', {
      type: 'button',
      title: 'Confirms each assumed ID for this client, so it counts as Matched from now on',
      on: { click: () => actions.updateWorkspace((ws) => entries.forEach((e) => setRes(ws, e, e.id))) },
    }, `Confirm ${entries.length} assumed ID${entries.length > 1 ? 's' : ''}`);
  }
  if (g.ruleId === 'REF-unresolved') {
    return h('button.btn.small', { type: 'button', on: { click: () => { state.ui.refs = { filter: 'unresolved' }; actions.go('reference'); } } }, 'Resolve on Reference IDs');
  }
  return null;
}

function refEntriesFor(state, g, status) {
  const out = [];
  for (const m of state.batch.refIndex?.values() ?? []) {
    for (const e of m.values()) {
      if (e.status === status && e.uses.some((u) => u.label === g.fieldLabel)) out.push(e);
    }
  }
  return out;
}

function setRes(ws, e, id) {
  ws.referenceResolutions ??= {};
  ws.referenceResolutions[e.type] ??= {};
  ws.referenceResolutions[e.type][e.key] = { id, at: new Date().toISOString() };
}

// ----------------------------------------------------------- supplier list

function supplierList(ctx, list) {
  const { state, actions } = ctx;
  const ui = state.ui.review;
  const chip = (key, label) => h('button.filter-chip', { type: 'button', class: ui.filter === key ? 'active' : '', on: { click: () => { ui.filter = key; actions.render(); } } }, label);
  return h('aside.panel.supplier-list', [
    h('div.filter-row', [chip('all', 'All'), chip('blocked', 'Blocked'), chip('warnings', 'Warnings'), chip('clean', 'Clean'), chip('excluded', 'Excluded')]),
    h('input.field-input.search', {
      type: 'search',
      placeholder: 'Search name or temp ID',
      value: ui.search,
      'aria-label': 'Search suppliers',
      'data-focus-key': 'review-search',
      on: { input: (e) => { ui.search = e.target.value; actions.render(); } },
    }),
    ui.issueKey && h('div.small.issue-filter', ['Filtered to one issue. ', h('button.link-btn', { type: 'button', on: { click: () => { ui.issueKey = null; actions.render(); } } }, 'Clear')]),
    h('p.small.muted', `${list.length} of ${state.batch.suppliers.length}`),
    h('ul.slist', { 'data-scroll-key': 'review-list', role: 'listbox', 'aria-label': 'Suppliers', on: { keydown: (e) => listKeys(e, ctx, list) } },
      list.map((s) => {
        const [tone, label] = STATUS[s.status];
        return h('li', [
          h('button.sitem', {
            type: 'button',
            role: 'option',
            'aria-selected': s.tempId === ui.selected ? 'true' : 'false',
            class: `${s.tempId === ui.selected ? 'active' : ''} ${s.excluded ? 'excluded' : ''}`,
            'data-focus-key': `sitem-${s.tempId}`,
            on: { click: () => { ui.selected = s.tempId; actions.render(); } },
          }, [
            h('span.sname', displayName(s)),
            h('span.smeta', [h('span.mono', s.tempId), s.excluded ? h('span.chip', 'Excluded') : h('span.chip', { class: tone }, s.errorCount ? `${s.errorCount} err` : s.warningCount ? `${s.warningCount} warn` : label)]),
          ]),
        ]);
      })),
  ]);
}

function listKeys(e, ctx, list) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const ui = ctx.state.ui.review;
  const i = list.findIndex((s) => s.tempId === ui.selected);
  const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
  if (!next) return;
  ui.selected = next.tempId;
  ctx.actions.render();
  document.querySelector(`[data-focus-key="sitem-${next.tempId}"]`)?.focus();
}

// ------------------------------------------------------------ profile card

function profileCard(ctx, s) {
  const { state, actions } = ctx;
  const [tone, label] = STATUS[s.status];
  const addr = s.addresses.find((a) => a.fields.primary?.value === 'Yes') ?? s.addresses[0];
  const errors = s.issues.filter((i) => i.severity === 'error');
  const warnings = s.issues.filter((i) => i.severity === 'warning');
  const F = fieldMaker(ctx, s);

  return h('article.panel.profile', { 'data-scroll-key': 'profile' }, [
    h('header.profile-head', [
      h('div', [
        h('div.small.muted.mono', s.tempId),
        h('h2', displayName(s)),
        addr && h('div.muted', addressOneLine(addr)),
      ]),
      h('div.profile-head-actions', [
        h('span.chip.big', { class: tone }, label),
        h('label.inline.small', [
          h('input', { type: 'checkbox', checked: s.excluded, on: { change: (e) => actions.setExcluded([s.tempId], e.target.checked) } }),
          'Exclude from export',
        ]),
      ]),
    ]),
    (errors.length || warnings.length) && issueSummary(errors, warnings),

    section('Overview', [
      sub('Summary', grid([
        F('supplier', 'supplierName'), F('supplier', 'supplierId'), F('supplier', 'businessEntityName'),
        F('supplier', 'category'), F('supplier', 'groups'), F('supplier', 'restrictedToCompanies'),
      ])),
      sub('Supplier Status Details', grid([F('supplier', 'status'), F('supplier', 'statusReason'), F('supplier', 'statusReasonDescription')])),
      sub('Identifiers', grid([F('supplier', 'duns'), F('supplier', 'uei'), F('supplier', 'customerAccountNumber'), F('supplier', 'coiDate'), F('supplier', 'externalEntityId')])),
      sub('Supplier Hierarchy', grid([F('supplier', 'includedChildren'), F('supplier', 'proposedChildren')])),
      sub('Other', grid([
        F('supplier', 'supplierSource'), F('supplier', 'supplierChangeSource'), F('supplier', 'integrationSystem'), F('supplier', 'securitySegment'),
        F('supplier', 'spendCategoriesOrHierarchies'), F('supplier', 'worktagOnly'), F('supplier', 'doNotReimburseCwExpenses'), F('supplier', 'note'), F('supplier', 'noteFollowUpDate'),
      ])),
    ]),

    section('Contact Information', [
      recordList(ctx, s, 'addresses', 'Address', (r) => addressOneLine(r) || 'New address', [
        'addressLabel', 'country', 'region', 'subregion', 'city', 'submunicipality', 'citySubdivision', 'addressLine1', 'addressLine2', 'addressLine3', 'addressLine4', 'postalCode', 'effectiveDate', 'primary', 'public', 'useFor', 'comments',
      ]),
      recordList(ctx, s, 'emails', 'Email', (r) => r.fields.emailAddress?.value || 'New email', ['emailAddress', 'primary', 'public', 'useFor', 'comments']),
      recordList(ctx, s, 'phones', 'Phone', (r) => [r.fields.areaCode?.value, r.fields.phoneNumber?.value].filter(Boolean).join(' ') || 'New phone', ['phoneCountry', 'areaCode', 'phoneNumber', 'extension', 'deviceType', 'primary', 'public', 'useFor', 'comments']),
      recordList(ctx, s, 'webAddresses', 'Web Address', (r) => r.fields.webAddress?.value || 'New web address', ['webAddress', 'primary', 'public', 'useFor', 'comments']),
    ]),

    section('Payment Details', [
      grid([
        F('payment', 'paymentTerms'), F('payment', 'termsBasedOnInvoiceReceived'), F('payment', 'paymentTypesAccepted'), F('payment', 'defaultPaymentType'),
        F('supplier', 'defaultCurrency'), F('supplier', 'acceptedCurrencies'), F('payment', 'procurementCreditCard'),
        F('payment', 'alwaysSeparatePayments'), F('payment', 'doNotPayDuringBankUpdates'),
      ]),
      sub('Default Supplier Payment Memo', grid([F('payment', 'defaultPaymentMemo'), F('payment', 'useSupplierReferenceMemo'), F('payment', 'useInvoiceMemo'), F('payment', 'useConnectionMemo')])),
      sub('Invoice Discount', grid([F('payment', 'overrideDiscountExclusion'), F('payment', 'excludeFreight'), F('payment', 'excludeOtherCharges'), F('payment', 'excludeTax')])),
    ]),

    section('Settlement Bank Accounts', [
      h('div.actions.right', [
        h('label.inline.small', [
          h('input', { type: 'checkbox', checked: state.ui.review.reveal, on: { change: (e) => { state.ui.review.reveal = e.target.checked; actions.render(); } } }),
          'Show full account and tax ID numbers',
        ]),
      ]),
      recordList(ctx, s, 'settlementAccounts', 'Settlement Bank Account', (r) => `${r.fields.accountLabel?.value ?? ''} ${r.fields.bankName?.value ?? ''} ${mask(r.fields.accountNumber?.value, state.ui.review.reveal)}`.trim() || 'New account', [
        'accountLabel', 'bankCountry', 'currency', 'accountType', 'bankName', 'nameOnAccount', 'accountNumber', 'accountNickname', 'routingNumber', 'iban', 'swift', 'branchId', 'branchName', 'rollNumber', 'checkDigit',
        'acceptsPaymentTypes', 'paymentTypes', 'forConnectionsOnly', 'requiresPrenote', 'prenotePaymentType', 'inactive', 'bankInstructions',
      ], (r, path) => [
        ...(r.bankAddresses ?? []).map((ba, j) => nested(ctx, s, 'bankAddresses', ba, `${path}.bankAddresses.${j}`, `Bank address: ${addressOneLine(ba)}`, ['country', 'region', 'city', 'addressLine1', 'addressLine2', 'postalCode', 'effectiveDate'])),
        ...(r.intermediaries ?? []).map((im, j) => nested(ctx, s, 'intermediaryBanks', im, `${path}.intermediaries.${j}`, `Intermediary ${im.fields.order?.value ?? j + 1}: ${im.fields.bankName?.value ?? ''} ${mask(im.fields.accountNumber?.value, state.ui.review.reveal)}`, [
          'intermediaryLabel', 'order', 'bankCountry', 'currency', 'accountType', 'bankName', 'accountNumber', 'routingNumber', 'iban', 'swift', 'branchId', 'inactive', 'bankInstructions',
        ], (im.bankAddresses ?? []).map((ba, m) => nested(ctx, s, 'bankAddresses', ba, `${path}.intermediaries.${j}.bankAddresses.${m}`, `Bank address: ${addressOneLine(ba)}`, ['country', 'region', 'city', 'addressLine1', 'postalCode'])))),
      ]),
      s.unlinked.intermediaryBanks.length + s.unlinked.bankAddresses.length > 0 &&
        h('p.small.err-text', `${s.unlinked.intermediaryBanks.length + s.unlinked.bankAddresses.length} intermediary or bank address row(s) point to an Account Label that doesn't exist, so they won't load.`),
    ]),

    section('Alternate Names', [recordList(ctx, s, 'alternateNames', 'Alternate Name', (r) => r.fields.alternateName?.value || 'New alternate name', ['alternateName', 'usage'])]),
    section('Related Worktags', [recordList(ctx, s, 'relatedWorktags', 'Worktag Type', (r) => r.fields.worktagType?.value || 'New worktag type', ['worktagType', 'defaultWorktag', 'requiredOnTransaction', 'requiredForValidation', 'allowedWorktags'])]),

    section('Procurement Setup', [
      sub('Purchase Order Options', grid([
        F('payment', 'poIssueOption'), F('payment', 'poIssueEmails'), F('payment', 'multiSupplierLink'), F('payment', 'disableChangeOrder'), F('payment', 'changeOrderIssueOption'),
        F('payment', 'shippingTerms'), F('payment', 'shippingMethod'), F('payment', 'acknowledgementExpected'),
        F('payment', 'minimumOrderAmount'), F('payment', 'minimumOrderCurrency'), F('payment', 'leadTimeDays'),
      ])),
      sub('Advanced Ship Notice (ASN) Options', grid([F('payment', 'enableAsn'), F('payment', 'asnDueDays')])),
      sub('Invoicing Options', grid([
        F('payment', 'invoiceAnySupplier'), F('payment', 'editPortalTaxes'), F('payment', 'enableGln'), F('payment', 'defaultSpendCategory'), F('payment', 'defaultProcurementItem'),
        F('supplier', 'restrictedCompaniesForContacts'),
      ])),
    ]),

    section('Tax Information', [
      grid([
        F('supplier', 'taxAuthorityFormType'), F('supplier', 'irs1099'), F('supplier', 'report1099WithParent'), F('supplier', 'taxDocumentDate'),
        F('supplier', 'defaultTaxCode'), F('supplier', 'defaultWithholdingTaxCode'), F('supplier', 'fatca'),
      ]),
      recordList(ctx, s, 'taxIds', 'Tax ID', (r) => `${r.fields.taxIdType?.value ?? ''} ${mask(r.fields.taxId?.value, state.ui.review.reveal)}`.trim() || 'New tax ID', ['taxIdCountry', 'taxIdType', 'taxId', 'primary', 'transactionTaxId']),
      recordList(ctx, s, 'taxStatuses', 'Tax Status', (r) => r.fields.country?.value || 'New tax status', ['country', 'transactionTaxStatus', 'withholdingTaxStatus']),
    ]),

    section('Classifications', [recordList(ctx, s, 'classifications', 'Classification', (r) => `${r.fields.classification?.value ?? ''} > ${r.fields.field?.value ?? ''}`, ['classification', 'field', 'value'])]),
  ]);
}

function issueSummary(errors, warnings) {
  const item = (i) => h('li', [
    h('button.link-btn', { type: 'button', on: { click: () => jumpTo(i) } }, `${i.recordLabel}${i.fieldLabel ? ` > ${i.fieldLabel}` : ''}`),
    `: ${i.message}`,
  ]);
  return h('div.issue-summary', [
    errors.length > 0 && h('div.banner.err', [h('strong', `${errors.length} error${errors.length > 1 ? 's' : ''} to fix before export`), h('ul.plain-list', errors.map(item))]),
    warnings.length > 0 && h('details.banner.warn', [h('summary', h('strong', `${warnings.length} warning${warnings.length > 1 ? 's' : ''} to review`)), h('ul.plain-list', warnings.map(item))]),
  ]);
}

function jumpTo(i) {
  const el = document.querySelector(`[data-field-path="${CSS.escape(`${i.path}.${i.field}`)}"]`) ?? document.querySelector(`[data-record-path="${CSS.escape(i.path)}"]`);
  if (!el) return;
  el.closest('details')?.setAttribute('open', '');
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1500);
  el.querySelector('input, select')?.focus({ preventScroll: true });
}

const section = (title, children) => h('section.psection', [h('h3.psection-title', title), ...children]);
const sub = (title, child) => h('div.psub', [h('h4', title), child]);
const grid = (fields) => h('div.fgrid', fields);

// --------------------------------------------------------------- records

function recordList(ctx, s, sectionKey, noun, summary, fields, extra) {
  const { actions } = ctx;
  const list = s[sectionKey];
  const blank = Object.fromEntries([]);
  return h('div.records', [
    h('div.records-head', [
      h('h4', `${SECTION_BY_KEY[sectionKey].tab} (${list.length})`),
      h('button.btn.small', {
        type: 'button',
        on: {
          click: () => actions.edit(s.tempId, (e) => {
            e.added[sectionKey] = [...(e.added[sectionKey] ?? []), { fields: blank }];
          }),
        },
      }, `+ Add ${noun.toLowerCase()}`),
    ]),
    s.issues.filter((i) => i.path === sectionKey).map((i) => h('div.fissue', { class: i.severity === 'error' ? 'err' : 'warn', 'data-record-path': sectionKey }, i.message)),
    !list.length && h('p.small.muted', 'None.'),
    ...list.map((r) => {
      const path = `${sectionKey}.${r._i}`;
      const issues = s.issues.filter((i) => i.path === path || i.path.startsWith(`${path}.`));
      const tone = issues.some((i) => i.severity === 'error') ? 'err' : issues.length ? 'warn' : '';
      return h('details.record', { 'data-record-path': path, open: Boolean(r.added) || tone === 'err' }, [
        h('summary', [
          h('span.record-title', summary(r)),
          r.fields.primary?.value === 'Yes' && h('span.chip.ok', 'Primary'),
          r.added && h('span.chip', 'Added by you'),
          tone && h('span.chip', { class: tone }, `${issues.length} issue${issues.length > 1 ? 's' : ''}`),
          h('span.spacer'),
          h('button.link-btn.danger', {
            type: 'button',
            on: { click: (ev) => { ev.preventDefault(); actions.edit(s.tempId, (e) => { e.removed = [...new Set([...(e.removed ?? []), path])]; }); } },
          }, 'Remove'),
        ]),
        h('div.fgrid', fields.map((f) => fieldEditor(ctx, s, sectionKey, r, path, f))),
        extra && h('div.nested-list', extra(r, path)),
      ]);
    }),
  ]);
}

function nested(ctx, s, sectionKey, rec, path, title, fields, children = []) {
  const issues = s.issues.filter((i) => i.path === path || i.path.startsWith(`${path}.`));
  const tone = issues.some((i) => i.severity === 'error') ? 'err' : issues.length ? 'warn' : '';
  return h('details.record.nested', { 'data-record-path': path, open: tone === 'err' }, [
    h('summary', [h('span.record-title', title), tone && h('span.chip', { class: tone }, `${issues.length} issue${issues.length > 1 ? 's' : ''}`)]),
    h('div.fgrid', fields.map((f) => fieldEditor(ctx, s, sectionKey, rec, path, f))),
    children.length > 0 && h('div.nested-list', children),
  ]);
}

// ----------------------------------------------------------------- fields

function fieldMaker(ctx, s) {
  return (sectionKey, key) => fieldEditor(ctx, s, sectionKey, s[sectionKey], sectionKey, key);
}

const SENSITIVE = new Set(['accountNumber', 'iban', 'taxId']);

function fieldEditor(ctx, s, sectionKey, rec, path, key) {
  const { state, actions } = ctx;
  const col = SECTION_BY_KEY[sectionKey].columns.find((c) => c.key === key);
  const f = rec.fields[key];
  const value = f?.value ?? (col.multi ? [] : '');
  const fullPath = `${path}.${key}`;
  const issues = s.issues.filter((i) => i.path === path && i.field === key);
  const tone = issues.some((i) => i.severity === 'error') ? 'err' : issues.length ? 'warn' : '';
  const set = (v) => actions.edit(s.tempId, (e) => { e.fields[fullPath] = v; });
  const masked = SENSITIVE.has(key) && !state.ui.review.reveal && value;

  let input;
  if (masked) {
    input = h('div.masked', [h('span.mono', mask(value, false)), h('button.link-btn.small', { type: 'button', on: { click: () => { state.ui.review.reveal = true; actions.render(); } } }, 'Reveal')]);
  } else if (col.multi) {
    input = chips(value, set, `${s.tempId}-${fullPath}`, col.label);
  } else if (col.type === 'bool') {
    input = h('select.field-input', { 'aria-label': col.label, 'data-focus-key': `${s.tempId}-${fullPath}`, on: { change: (e) => set(e.target.value) } }, [
      h('option', { value: '', selected: !value }, ''),
      h('option', { value: 'Yes', selected: value === 'Yes' }, 'Yes'),
      h('option', { value: 'No', selected: value === 'No' }, 'No'),
      value && value !== 'Yes' && value !== 'No' && h('option', { value, selected: true }, value),
    ]);
  } else {
    input = h('input.field-input', {
      type: 'text',
      value,
      placeholder: col.type === 'date' ? 'YYYY-MM-DD' : '',
      'aria-label': col.label,
      'data-focus-key': `${s.tempId}-${fullPath}`,
      class: col.keepText || SENSITIVE.has(key) ? 'mono' : '',
      on: { change: (e) => set(e.target.value.trim()) },
    });
  }

  return h('div.field', { class: tone, 'data-field-path': fullPath }, [
    h('label.flabel', [col.label, col.required && h('span.req', { title: 'Required' }, ' *')]),
    input,
    refLine(f),
    issues.map((i) => h('div.fissue', { class: i.severity === 'error' ? 'err' : 'warn' }, i.message)),
    provenance(ctx, s, sectionKey, path, key, f, col),
  ]);
}

function refLine(f) {
  if (!f?.refs?.length) return null;
  const tone = { matched: 'ok', assumed: 'warn', unresolved: 'err' };
  return h('div.refline', f.refs.map((r) => h('span.chip.ref', { class: tone[r.status], title: r.how }, r.status === 'unresolved' ? `${r.value}: unresolved` : `→ ${r.id}`)));
}

function provenance(ctx, s, sectionKey, path, key, f, col) {
  if (!f) return null;
  const bits = [];
  const src = f.source ?? {};
  if (src.edited) bits.push(`Edited by you${isShown(f.original) ? ` (was "${show(f.original)}")` : ''}`);
  else if (src.default) bits.push('Set for all rows on the Map step');
  else if (src.generated) bits.push('Generated');
  else if (src.sheet) bits.push(`${src.file} > ${src.sheet}${src.cell ? `!${src.cell}` : ''}${src.column ? ` (${src.column})` : ''}`);
  if (f.mappedFrom !== undefined) bits.push(`Value mapped from "${show(f.mappedFrom)}"`);
  if (f.conflicts?.length) bits.push(`Other source values: ${f.conflicts.map((c) => `"${show(c.value)}"`).join(', ')}`);
  const fixAll = src.edited && isShown(f.original) && !col.multi && !SENSITIVE.has(key) ? fixAllLikeThis(ctx, s, sectionKey, path, key, f, col) : null;
  return h('div.prov', [bits.join(' · '), fixAll]);
}

/** After editing a value, offer to apply the same change to every supplier with the same original value, as a Value Mapping rule. */
function fixAllLikeThis(ctx, s, sectionKey, path, key, f, col) {
  const { state, actions } = ctx;
  const from = String(f.original).toLowerCase();
  let others = 0;
  for (const o of state.batch.suppliers) {
    if (o === s) continue;
    const recs = sectionKey === 'supplier' || sectionKey === 'payment' ? [o[sectionKey]] : o[sectionKey] ?? [];
    if (recs.some((r) => String(r?.fields?.[key]?.value ?? '').toLowerCase() === from)) others++;
  }
  if (!others) return null;
  return h('button.link-btn.small', {
    type: 'button',
    title: 'Creates a Value Mapping rule in this workspace, so the same fix applies to every supplier and every future batch',
    on: {
      click: () => {
        actions.updateWorkspace((ws) => {
          ws.valueMappings = [...(ws.valueMappings ?? []), normalizeRule({ tab: SECTION_BY_KEY[sectionKey].tab, column: col.label, legacyValue: f.original, workdayValue: f.value }, 'workspace')];
        });
        actions.edit(s.tempId, (e) => { delete e.fields[`${path}.${key}`]; });
      },
    },
  }, ` Fix all like this (${others} more)`);
}

function chips(values, set, focusKey, label) {
  const add = (text) => {
    const parts = text.split(/[;\n]+/).map((x) => x.trim()).filter(Boolean);
    if (parts.length) set([...values, ...parts.filter((p) => !values.some((v) => v.toLowerCase() === p.toLowerCase()))]);
  };
  return h('div.chips', [
    ...values.map((v, i) => h('span.vchip', [v, h('button', { type: 'button', 'aria-label': `Remove ${v}`, on: { click: () => set(values.filter((_, j) => j !== i)) } }, '×')])),
    h('input.chip-input', {
      type: 'text',
      placeholder: values.length ? 'Add' : 'Add a value',
      'aria-label': `Add ${label}`,
      'data-focus-key': focusKey,
      on: {
        keydown: (e) => { if (e.key === 'Enter' || e.key === ';') { e.preventDefault(); add(e.target.value); } },
        change: (e) => add(e.target.value),
      },
    }),
  ]);
}

// ---------------------------------------------------------------- helpers

export function mask(v, reveal) {
  const t = String(v ?? '');
  if (!t) return '';
  if (reveal) return t;
  const alnum = t.replace(/[^A-Za-z0-9]/g, '');
  return `••••${alnum.slice(-4)}`;
}

function addressOneLine(r) {
  const v = (k) => r.fields[k]?.value;
  return [v('addressLine1'), v('addressLine2'), v('city'), [v('region'), v('postalCode')].filter(Boolean).join(' '), v('country')].filter(Boolean).join(', ');
}

const isShown = (v) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length) && v !== '';
const show = (v) => (Array.isArray(v) ? v.join('; ') : String(v));

export { typeLabel };
