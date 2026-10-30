import './ui/styles.css';
import logoUrl from './assets/commit-logo.png';
import faviconUrl from './assets/favicon.png';
import { h, clear } from './ui/dom.js';
import { STEPS } from './ui/steps.js';
import { load, save, clearAll, storageAvailable } from './ui/storage.js';
import {
  loadWorkspaces, saveWorkspaces, loadActiveWorkspaceId, saveActiveWorkspaceId, newWorkspace,
} from './model/workspace.js';
import { loadTemplate, base64ToBytes } from './eib/template.js';
import { EIB_TEMPLATE_BASE64 } from './data/eib-template.js';
import { ingest } from './ingest/index.js';
import { deriveBatch } from './pipeline.js';
import { initialMapping } from './ui/map-view.js';
import { applyEdits } from './model/edits.js';
import './stages.js';
import { loadPersistedBatch, persistBatch } from './model/batch-store.js';
import { workspacePanel } from './ui/workspace-panel.js';

const state = {
  step: load('step', 'ingest'),
  theme: load('theme', 'system'),
  workspaces: loadWorkspaces(),
  activeWorkspaceId: null,
  // Supplier batch: in memory only. It holds bank and tax numbers, so it is
  // never written to browser storage unless the user opts in (Settings).
  inputs: [],
  ingestResult: null,
  mappings: {},
  edits: {},
  excluded: new Set(),
  batch: emptyBatch(),
  ingestError: null,
  template: null,
  ui: { review: { filter: 'all', search: '', selected: null, reveal: false } },
};
state.activeWorkspaceId = loadActiveWorkspaceId(state.workspaces);
if (!STEPS.some((s) => s.id === state.step)) state.step = 'ingest';

function emptyBatch() {
  return { suppliers: [], tables: [], summary: null, rules: [], valueMapping: null, validated: false };
}

const workspace = () => state.workspaces.find((w) => w.id === state.activeWorkspaceId);

function recompute() {
  if (!state.ingestResult) {
    state.batch = emptyBatch();
    return;
  }
  const derived = deriveBatch({
    ingestResult: state.ingestResult,
    mappings: state.mappings,
    workspace: workspace(),
    edits: state.edits,
    applyEditsFn: applyEdits,
    excluded: state.excluded,
  });
  state.batch = {
    ...derived,
    tables: state.ingestResult.tables,
    summary: state.ingestResult.summary,
    validated: Boolean(derived.validation),
  };
  if (workspace()?.settings?.persistBatch) {
    if (!persistBatch(state)) state.ingestError = 'This batch is too large to keep in browser storage. It will last until you close this tab.';
  }
}

let timer = null;
function recomputeSoon() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    recompute();
    render();
  }, 150);
}

const actions = {
  setInputs(inputs, message = null) {
    state.inputs = inputs;
    state.ingestError = message;
    state.edits = {};
    state.excluded = new Set();
    try {
      state.ingestResult = inputs.length ? ingest(inputs) : null;
      const ws = workspace();
      const kept = {};
      for (const t of state.ingestResult?.tables ?? []) kept[t.id] = state.mappings[t.id] ?? initialMapping(t, ws);
      state.mappings = kept;
      recompute();
    } catch (err) {
      console.error(err);
      state.ingestError = `Something went wrong reading the files: ${err.message}`;
    }
    render();
  },
  setMapping(tableId, mapping) {
    state.mappings = { ...state.mappings, [tableId]: mapping };
    recompute();
    render();
  },
  /** Mutates the active workspace, saves it, and re-derives the batch. */
  updateWorkspace(fn, { soon = false } = {}) {
    fn(workspace());
    saveWorkspaces(state.workspaces);
    if (soon) recomputeSoon();
    else {
      recompute();
      render();
    }
  },
  /** Field edits re-validate after a short pause, so typing stays smooth. */
  edit(tempId, fn) {
    const cur = state.edits[tempId] ?? { fields: {}, removed: [], added: {} };
    fn(cur);
    state.edits = { ...state.edits, [tempId]: cur };
    recomputeSoon();
  },
  setExcluded(tempIds, excluded) {
    for (const id of tempIds) excluded ? state.excluded.add(id) : state.excluded.delete(id);
    recompute();
    render();
  },
  recompute: () => {
    recompute();
    render();
  },
  render: () => render(),
  go: (id) => go(id),
  workspace,
};

// ------------------------------------------------------------------ theme
function applyTheme() {
  const root = document.documentElement;
  if (state.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', state.theme);
}
const THEME_NEXT = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL = { system: 'Theme: match system', light: 'Theme: light', dark: 'Theme: dark' };

// ----------------------------------------------------------------- render
const app = document.getElementById('app');

function batchCounts() {
  const c = { clean: 0, warnings: 0, blocked: 0 };
  for (const s of state.batch.suppliers) c[s.status ?? 'clean']++;
  return c;
}

function header() {
  const counts = batchCounts();
  const ws = workspace();
  const n = state.batch.suppliers.length;
  return h('header.app-header', [
    h('div.brand', [
      h('span.logo-chip', [h('img', { src: logoUrl, alt: 'Commit', width: 112, height: 34 })]),
      h('div.brand-text', [h('span.app-name', 'Supplier EIB Builder'), h('span.app-sub', 'Workday Submit Supplier v44.1')]),
    ]),
    h('div.header-tools', [
      h('label.ws-picker', [
        h('span.label', 'Client workspace'),
        h(
          'select',
          {
            'aria-label': 'Client workspace',
            on: {
              change: (e) => {
                if (e.target.value === '__new') return createWorkspace();
                state.activeWorkspaceId = e.target.value;
                saveActiveWorkspaceId(state.activeWorkspaceId);
                recompute();
                render();
              },
            },
          },
          [
            ...state.workspaces.map((w) => h('option', { value: w.id, selected: w.id === ws.id }, w.name)),
            h('option', { value: '__new' }, '+ New client workspace...'),
          ],
        ),
      ]),
      h('div.batch-status', { role: 'status', 'aria-label': 'Batch status' }, [
        h('span.count', [h('b', String(n)), ' suppliers']),
        ...(n && !state.batch.validated
          ? [h('span.chip', 'Not validated yet')]
          : [
              h('button.chip.ok', { type: 'button', on: { click: () => openReview('clean') } }, `${counts.clean} clean`),
              h('button.chip.warn', { type: 'button', on: { click: () => openReview('warnings') } }, `${counts.warnings} warnings`),
              h('button.chip.err', { type: 'button', on: { click: () => openReview('blocked') } }, `${counts.blocked} blocked`),
            ]),
      ]),
      h(
        'button.icon-btn',
        {
          type: 'button',
          title: THEME_LABEL[state.theme],
          'aria-label': THEME_LABEL[state.theme],
          on: {
            click: () => {
              state.theme = THEME_NEXT[state.theme];
              save('theme', state.theme);
              applyTheme();
              render();
            },
          },
        },
        state.theme === 'dark' ? '☾' : state.theme === 'light' ? '☀' : '◐',
      ),
    ]),
  ]);
}

function openReview(filter) {
  state.ui.review.filter = filter;
  go('review');
}

function nav() {
  return h('nav.steps', { 'aria-label': 'Steps' }, [
    h(
      'ol',
      STEPS.map((s, i) =>
        h('li', [
          h(
            'button.step',
            {
              type: 'button',
              class: s.id === state.step ? 'active' : '',
              'aria-current': s.id === state.step ? 'step' : null,
              'data-step': s.id,
              title: `${s.label} (Alt+${i + 1})`,
              on: { click: () => go(s.id), keydown: navKeys },
            },
            [h('span.step-num', String(i + 1)), h('span.step-label', s.label), s.badge && s.badge(ctx())],
          ),
        ]),
      ),
    ),
    h('div.nav-foot', [
      workspacePanel(ctx()),
      h('p.privacy', [
        h('strong', 'Private by design. '),
        'Everything runs in this browser tab. Supplier data is never uploaded anywhere.',
      ]),
      !storageAvailable() && h('p.muted.small', 'Browser storage is off, so workspaces last until you close this tab. Export them to keep them.'),
      h(
        'button.link-btn.danger',
        {
          type: 'button',
          on: {
            click: () => {
              if (!confirm('Clear all data? This removes every workspace, saved batch, and anything else this tool saved in this browser.')) return;
              clearAll();
              location.reload();
            },
          },
        },
        'Clear all data',
      ),
    ]),
  ]);
}

function navKeys(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const i = STEPS.findIndex((s) => s.id === e.currentTarget.dataset.step);
  const next = STEPS[(i + (e.key === 'ArrowDown' ? 1 : STEPS.length - 1)) % STEPS.length];
  go(next.id, true);
}

const ctx = () => ({ state, actions, workspace: workspace(), template: state.template });

function main() {
  const i = STEPS.findIndex((s) => s.id === state.step);
  const step = STEPS[i];
  return h('main.content', { id: 'main', tabIndex: -1, class: step.wide ? 'wide' : '' }, [
    h('div.step-head', [
      h('p.eyebrow', `Step ${i + 1} of ${STEPS.length}`),
      h('h1', step.title),
      h('p.helper', step.helper),
    ]),
    step.view(ctx()),
    h('div.step-pager', [
      i > 0 ? h('button.btn', { type: 'button', on: { click: () => go(STEPS[i - 1].id) } }, `Back: ${STEPS[i - 1].label}`) : h('span'),
      i < STEPS.length - 1
        ? h('button.btn.primary', { type: 'button', on: { click: () => go(STEPS[i + 1].id) } }, `Next: ${STEPS[i + 1].label}`)
        : h('span'),
    ]),
  ]);
}

function go(id, keepNavFocus = false) {
  state.step = id;
  save('step', id);
  render();
  const target = keepNavFocus ? document.querySelector(`.step[data-step="${id}"]`) : document.getElementById('main');
  target?.focus({ preventScroll: keepNavFocus });
  if (!keepNavFocus) window.scrollTo(0, 0);
}

function createWorkspace() {
  const name = prompt('Name the new client workspace');
  if (name && name.trim()) {
    const ws = newWorkspace(name);
    state.workspaces.push(ws);
    state.activeWorkspaceId = ws.id;
    saveWorkspaces(state.workspaces);
    saveActiveWorkspaceId(ws.id);
    recompute();
  }
  render();
}

/** Re-renders while keeping focus and scroll, so inline edits don't lose the cursor. */
function render() {
  const active = document.activeElement;
  const focusKey = active?.dataset?.focusKey;
  const sel = focusKey && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  const scrolls = [...document.querySelectorAll('[data-scroll-key]')].map((el) => [el.dataset.scrollKey, el.scrollTop]);
  const y = window.scrollY;

  clear(app).append(h('a.skip', { href: '#main' }, 'Skip to content'), header(), h('div.layout', [nav(), main()]));

  if (focusKey) {
    const el = document.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (sel && 'setSelectionRange' in el) {
        try {
          el.setSelectionRange(sel[0], sel[1]);
        } catch {
          /* not a text input */
        }
      }
    }
  }
  for (const [k, top] of scrolls) {
    const el = document.querySelector(`[data-scroll-key="${CSS.escape(k)}"]`);
    if (el) el.scrollTop = top;
  }
  window.scrollTo(0, y);
}

document.addEventListener('keydown', (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  const n = Number(e.key);
  if (n >= 1 && n <= STEPS.length) {
    e.preventDefault();
    go(STEPS[n - 1].id);
  }
});

document.head.append(h('link', { rel: 'icon', type: 'image/png', href: faviconUrl }));
applyTheme();
saveWorkspaces(state.workspaces);

const restored = workspace()?.settings?.persistBatch ? loadPersistedBatch() : null;
if (restored) {
  Object.assign(state, restored, { excluded: new Set(restored.excluded ?? []) });
  try {
    state.ingestResult = ingest(state.inputs);
    recompute();
  } catch {
    state.inputs = [];
  }
}
render();

loadTemplate(base64ToBytes(EIB_TEMPLATE_BASE64))
  .then((tpl) => {
    state.template = tpl;
    render();
  })
  .catch((err) => console.error('Could not read the bundled EIB template', err));
