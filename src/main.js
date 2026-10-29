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

const state = {
  step: load('step', 'ingest'),
  theme: load('theme', 'system'),
  workspaces: loadWorkspaces(),
  activeWorkspaceId: null,
  batch: { suppliers: [] }, // filled from Milestone 2 on; never persisted by default
  template: null,
};
state.activeWorkspaceId = loadActiveWorkspaceId(state.workspaces);
if (!STEPS.some((s) => s.id === state.step)) state.step = 'ingest';

const workspace = () => state.workspaces.find((w) => w.id === state.activeWorkspaceId);

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
        h('span.count', [h('b', String(state.batch.suppliers.length)), ' suppliers']),
        h('span.chip.ok', `${counts.clean} clean`),
        h('span.chip.warn', `${counts.warnings} warnings`),
        h('span.chip.err', `${counts.blocked} blocked`),
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
            [h('span.step-num', String(i + 1)), h('span.step-label', s.label)],
          ),
        ]),
      ),
    ),
    h('div.nav-foot', [
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
              if (!confirm('Clear all data? This removes every workspace and anything saved in this browser.')) return;
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

function main() {
  const i = STEPS.findIndex((s) => s.id === state.step);
  const step = STEPS[i];
  const ctx = { state, workspace: workspace(), template: state.template };
  return h('main.content', { id: 'main', tabIndex: -1 }, [
    h('div.step-head', [
      h('p.eyebrow', `Step ${i + 1} of ${STEPS.length}`),
      h('h1', step.title),
      h('p.helper', step.helper),
    ]),
    step.view(ctx),
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
  target?.focus();
}

function createWorkspace() {
  const name = prompt('Name the new client workspace');
  if (name && name.trim()) {
    const ws = newWorkspace(name);
    state.workspaces.push(ws);
    state.activeWorkspaceId = ws.id;
    saveWorkspaces(state.workspaces);
    saveActiveWorkspaceId(ws.id);
  }
  render();
}

function render() {
  clear(app).append(h('a.skip', { href: '#main' }, 'Skip to content'), header(), h('div.layout', [nav(), main()]));
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
render();

loadTemplate(base64ToBytes(EIB_TEMPLATE_BASE64))
  .then((tpl) => {
    state.template = tpl;
    render();
  })
  .catch((err) => console.error('Could not read the bundled EIB template', err));
