import { h } from './dom.js';
import { guessMapping } from '../mapping/auto-map.js';
import { TARGETS, MAP_SECTIONS, TARGET_BY_ID } from '../mapping/targets.js';
import { findProfile, applyProfile, makeProfile, exportProfiles, importProfiles } from '../mapping/profiles.js';
import { normalizeRule, compileRules } from '../mapping/value-mapping.js';
import { SECTIONS } from '../model/schema.js';
import { downloadText, pickFile } from './files.js';

/** First mapping for a newly ingested table: a matching saved profile, else the auto-guess. */
export function initialMapping(table, workspace) {
  const guessed = guessMapping(table);
  const profile = findProfile(workspace?.mappingProfiles, table);
  const m = profile ? applyProfile(profile, table, guessed) : { ...guessed, profileId: null };
  return { ...m, confirmed: false };
}

export function mapView(ctx) {
  const { state } = ctx;
  const tables = state.batch.tables ?? [];
  return h('div.stack', [
    !state.ingestResult && h('section.panel', h('p.muted', 'Load supplier files on the Ingest step first.')),
    state.ingestResult && tables.length === 0 &&
      h('section.panel.callout', [
        h('h3', 'Nothing to map'),
        h('p', 'Your files are in the Conversion Workbook format, so every column already lines up with a Workday field. Value mapping rules below still apply.'),
      ]),
    ...tables.map((t) => tableCard(ctx, t)),
    tables.length > 0 && profilesPanel(ctx),
    valueMappingPanel(ctx),
  ]);
}

// ---------------------------------------------------------------- tables

function targetSelect(value, onChange, { allowIgnore = true, focusKey } = {}) {
  return h(
    'select.target',
    { 'data-focus-key': focusKey, 'aria-label': 'Workday field', on: { change: (e) => onChange(e.target.value || null) } },
    [
      allowIgnore && h('option', { value: '', selected: !value }, 'Ignore this column'),
      ...MAP_SECTIONS.map((s) =>
        h(
          'optgroup',
          { label: s.tab },
          TARGETS.filter((t) => t.section === s.key).map((t) =>
            h('option', { value: t.id, selected: t.id === value }, `${t.label}${t.multi ? ' (multi)' : ''}`),
          ),
        ),
      ),
    ],
  );
}

const CONF = { high: ['ok', 'Strong match'], medium: ['warn', 'Check this'], profile: ['ok', 'From profile'], none: ['', 'Not mapped'], manual: ['', 'Set by you'] };

function tableCard(ctx, table) {
  const { state, actions } = ctx;
  const m = state.mappings[table.id];
  if (!m) return null;
  const set = (patch) => actions.setMapping(table.id, { ...m, ...patch, confirmed: patch.confirmed ?? false });
  const hasName = m.columns.some((c) => c.target === 'supplier.supplierName');
  const built = state.batch.tableStats?.find((x) => x.id === table.id);
  const profile = (ctx.workspace.mappingProfiles ?? []).find((p) => p.id === m.profileId);

  const dupSingles = new Map();
  for (const c of m.columns) {
    if (!c.target || TARGET_BY_ID[c.target].multi) continue;
    dupSingles.set(c.target, (dupSingles.get(c.target) ?? 0) + 1);
  }

  const rows = m.columns.map((c, i) => {
    const [tone, label] = CONF[c.confidence] ?? CONF.manual;
    const shared = c.target && dupSingles.get(c.target) > 1;
    return h('tr', { class: c.target ? '' : 'ignored' }, [
      h('td', [h('strong', c.header), h('div.muted.small', `Column ${i + 1}`)]),
      h('td.samples', c.samples.length ? c.samples.slice(0, 3).map((v) => h('span.sample', v)) : h('span.muted', '(empty)')),
      h('td', [
        m.confirmed
          ? h('span', c.target ? `${TARGET_BY_ID[c.target].sectionLabel} > ${TARGET_BY_ID[c.target].label}` : 'Ignored')
          : targetSelect(c.target, (target) => {
              const columns = m.columns.map((x, j) => (j === i ? { ...x, target, confidence: 'manual', why: 'Set by you' } : x));
              set({ columns });
            }, { focusKey: `map-${table.id}-${i}` }),
        shared && h('div.small.warn-text', 'Several columns feed this field. Their values are joined with a space.'),
      ]),
      h('td', h('span.chip', { class: tone, title: c.why }, label)),
    ]);
  });

  return h('section.panel', [
    h('div.panel-head', [
      h('h3', `${table.file} > ${table.sheet}`),
      h('span.muted.small', `${table.rows.length} rows, headers on row ${table.headerRow}`),
    ]),
    profile && h('p.small', ['Mapped with profile ', h('strong', profile.name), '. Check it over, then confirm.']),
    !hasName && h('div.banner.err', 'Map one column to Supplier Name. It ties rows to suppliers.'),
    h('div.table-wrap', { 'data-scroll-key': `map-${table.id}` }, [
      h('table.grid.map-grid', [
        h('thead', h('tr', [h('th', 'Source column'), h('th', 'Sample values'), h('th', 'Workday field'), h('th', 'Match')])),
        h('tbody', rows),
      ]),
    ]),
    defaultsBlock(m, set),
    h('div.actions', [
      m.confirmed
        ? [
            h('span.chip.ok', `Confirmed: ${built?.suppliers ?? 0} suppliers`),
            h('button.btn', { type: 'button', on: { click: () => set({ confirmed: false }) } }, 'Edit mapping'),
          ]
        : [
            h('button.btn.primary', { type: 'button', disabled: !hasName, on: { click: () => set({ confirmed: true }) } }, 'Confirm mapping'),
            h('button.btn', { type: 'button', on: { click: () => set({ ...guessMapping(table), profileId: null }) } }, 'Reset to suggestions'),
          ],
      h(
        'button.btn',
        {
          type: 'button',
          title: 'Save this mapping to make the next file from this client load instantly',
          on: {
            click: () => {
              const name = prompt('Name this mapping profile, for example "Client X NetSuite vendor export"', profile?.name ?? '');
              if (!name?.trim()) return;
              ctx.actions.updateWorkspace((ws) => {
                const p = makeProfile(name, table, m);
                ws.mappingProfiles = [...(ws.mappingProfiles ?? []).filter((x) => x.name !== p.name), p];
                state.mappings[table.id] = { ...m, profileId: p.id };
              });
            },
          },
        },
        'Save as profile',
      ),
    ]),
  ]);
}

function defaultsBlock(m, set) {
  const list = m.defaults ?? [];
  const update = (i, patch) => set({ defaults: list.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  return h('details.detail', { open: list.length > 0 }, [
    h('summary', ['Set a value for all rows ', h('span.chip', String(list.length))]),
    h('p.small.muted', 'Fill a Workday field the file doesn’t have, to save editing every supplier later. Values in the file always win.'),
    h('div.defaults', [
      ...list.map((d, i) =>
        h('div.default-row', [
          m.confirmed ? h('span', TARGET_BY_ID[d.target]?.label) : targetSelect(d.target, (target) => update(i, { target }), { allowIgnore: false }),
          h('input', { type: 'text', value: d.value, disabled: m.confirmed, 'aria-label': 'Value', on: { change: (e) => update(i, { value: e.target.value }) } }),
          d.why && h('span.muted.small', d.why),
          !m.confirmed && h('button.link-btn', { type: 'button', on: { click: () => set({ defaults: list.filter((_, j) => j !== i) }) } }, 'Remove'),
        ]),
      ),
      !m.confirmed &&
        h('button.btn.small', { type: 'button', on: { click: () => set({ defaults: [...list, { target: 'addresses.country', value: 'United States of America' }] }) } }, '+ Add a value'),
    ]),
  ]);
}

// -------------------------------------------------------------- profiles

function profilesPanel(ctx) {
  const list = ctx.workspace.mappingProfiles ?? [];
  return h('section.panel', [
    h('div.panel-head', [h('h3', `Mapping profiles (${list.length})`), h('span.muted.small', `Saved in "${ctx.workspace.name}"`)]),
    list.length
      ? h('ul.plain-list', list.map((p) => h('li', [
          h('strong', p.name), h('span.muted.small', ` ${p.columns.length} columns, saved ${p.createdAt.slice(0, 10)} `),
          h('button.link-btn', { type: 'button', on: { click: () => ctx.actions.updateWorkspace((ws) => { ws.mappingProfiles = ws.mappingProfiles.filter((x) => x.id !== p.id); }) } }, 'Delete'),
        ])))
      : h('p.muted', 'No profiles yet. Save a confirmed mapping to make the next file from this client load instantly.'),
    h('div.actions', [
      h('button.btn', { type: 'button', disabled: !list.length, on: { click: () => downloadText(`mapping-profiles-${slug(ctx.workspace.name)}.json`, exportProfiles(list), 'application/json') } }, 'Export profiles'),
      h('button.btn', {
        type: 'button',
        on: {
          click: async () => {
            const text = await pickFile('.json');
            if (!text) return;
            try {
              const incoming = importProfiles(text);
              ctx.actions.updateWorkspace((ws) => {
                const names = new Set(incoming.map((p) => p.name));
                ws.mappingProfiles = [...(ws.mappingProfiles ?? []).filter((p) => !names.has(p.name)), ...incoming];
              });
            } catch (err) {
              alert(`Couldn't import profiles: ${err.message}`);
            }
          },
        },
      }, 'Import profiles'),
    ]),
  ]);
}

// --------------------------------------------------------- value mapping

const RULE_TABS = SECTIONS.map((s) => s.tab);

function valueMappingPanel(ctx) {
  const { state, actions, workspace } = ctx;
  const wsRules = (workspace.valueMappings ?? []).map((r) => normalizeRule(r, 'workspace'));
  const wbRules = (state.ingestResult?.valueMappings ?? []).map((r, i) => normalizeRule({ ...r, id: `wb-${i}` }, 'workbook'));
  const all = [...wsRules, ...wbRules];
  const hits = state.batch.valueMapping?.byRule ?? new Map();
  const invalid = new Map(compileRules(all).invalid.map((x) => [x.rule.id, x.reason]));

  const row = (r) =>
    h('tr', [
      h('td', r.tab || 'Any tab'),
      h('td', r.column),
      h('td', r.conditionColumn ? `${r.conditionColumn} = ${r.conditionValue}` : h('span.muted', 'Always')),
      h('td', h('code', r.legacyValue)),
      h('td', r.workdayValues.map((v) => h('span.sample', v))),
      h('td.num', invalid.has(r.id) ? h('span.chip.err', { title: invalid.get(r.id) }, 'Invalid') : String(hits.get(r.id) ?? 0)),
      h('td', r.origin === 'workbook'
        ? h('button.link-btn', { type: 'button', title: 'Keep this rule for every future batch from this client', on: { click: () => actions.updateWorkspace((ws) => { ws.valueMappings = [...(ws.valueMappings ?? []), normalizeRule({ ...r, id: undefined }, 'workspace')]; }) } }, 'Save to workspace')
        : h('button.link-btn', { type: 'button', on: { click: () => actions.updateWorkspace((ws) => { ws.valueMappings = ws.valueMappings.filter((x) => (x.id ?? '') !== r.id); }) } }, 'Delete')),
    ]);

  const form = { tab: 'Payment & Procurement', column: 'Payment Types Accepted', conditionColumn: '', conditionValue: '', legacyValue: '', workdayValue: '' };
  const colsFor = (tab) => (SECTIONS.find((s) => s.tab === tab)?.columns ?? []).filter((c) => c.key !== 'supplierName' && c.key !== 'supplierId');
  const colSelect = h('select', { 'aria-label': 'Column', on: { change: (e) => (form.column = e.target.value) } }, colsFor(form.tab).map((c) => h('option', { value: c.label, selected: c.label === form.column }, c.label)));
  const tabSelect = h('select', {
    'aria-label': 'Tab',
    on: {
      change: (e) => {
        form.tab = e.target.value;
        colSelect.replaceChildren(...colsFor(form.tab).map((c) => h('option', { value: c.label }, c.label)));
        form.column = colsFor(form.tab)[0]?.label ?? '';
      },
    },
  }, RULE_TABS.map((t) => h('option', { value: t, selected: t === form.tab }, t)));
  const input = (key, placeholder) => h('input', { type: 'text', placeholder, 'aria-label': placeholder, on: { input: (e) => (form[key] = e.target.value) } });

  return h('section.panel', [
    h('div.panel-head', [h('h3', `Value mapping (${all.length})`), h('span.muted.small', 'Applies to every supplier, every time the batch updates')]),
    h('p.small.muted', 'Translate legacy values to Workday values. Matching is whole-value and ignores case. Use semicolons for several Workday values, for example EFT; Check.'),
    all.length > 0 &&
      h('div.table-wrap', [
        h('table.grid', [
          h('thead', h('tr', [h('th', 'Tab'), h('th', 'Column'), h('th', 'Condition'), h('th', 'Legacy value'), h('th', 'Workday value(s)'), h('th.num', 'Used'), h('th', '')])),
          h('tbody', all.map(row)),
        ]),
      ]),
    h('div.rule-form', [
      tabSelect, colSelect, input('legacyValue', 'Legacy value'), input('workdayValue', 'Workday value(s)'),
      input('conditionColumn', 'Only when column (optional)'), input('conditionValue', 'equals (optional)'),
      h('button.btn', {
        type: 'button',
        on: {
          click: () => {
            if (!form.legacyValue.trim() || !form.workdayValue.trim()) return alert('Enter a legacy value and at least one Workday value.');
            actions.updateWorkspace((ws) => {
              ws.valueMappings = [...(ws.valueMappings ?? []), normalizeRule(form, 'workspace')];
            });
          },
        },
      }, 'Add rule'),
    ]),
  ]);
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
