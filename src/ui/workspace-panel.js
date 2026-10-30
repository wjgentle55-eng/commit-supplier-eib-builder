import { h } from './dom.js';
import { exportWorkspace, importWorkspace, saveWorkspaces, saveActiveWorkspaceId, settingsOf } from '../model/workspace.js';
import { forgetBatch } from '../model/batch-store.js';
import { downloadText, pickFile } from './files.js';

// Workspace tools in the left rail: rename, export/import JSON, and the
// opt-in toggle for keeping the supplier batch in this browser.

export function workspacePanel(ctx) {
  const { state, actions, workspace } = ctx;
  const st = settingsOf(workspace);
  return h('details.ws-panel', [
    h('summary', 'Workspace'),
    h('div.ws-actions', [
      h('button.link-btn', { type: 'button', on: { click: () => {
        const name = prompt('Rename this client workspace', workspace.name);
        if (name?.trim()) actions.updateWorkspace((ws) => { ws.name = name.trim(); });
      } } }, 'Rename'),
      h('button.link-btn', { type: 'button', title: 'Share mapping profiles, value mappings, resolutions, and settings with your team. No supplier data is included.', on: { click: () => downloadText(`workspace-${workspace.name.replace(/[^A-Za-z0-9]+/g, '-')}.json`, exportWorkspace(workspace), 'application/json') } }, 'Export workspace'),
      h('button.link-btn', { type: 'button', on: { click: async () => {
        const text = await pickFile('.json');
        if (!text) return;
        try {
          const ws = importWorkspace(text);
          const clash = state.workspaces.find((w) => w.name === ws.name);
          if (clash && !confirm(`A workspace named "${ws.name}" already exists. Import as a copy?`)) return;
          if (clash) ws.name = `${ws.name} (imported)`;
          state.workspaces.push(ws);
          state.activeWorkspaceId = ws.id;
          saveWorkspaces(state.workspaces);
          saveActiveWorkspaceId(ws.id);
          actions.recompute();
        } catch (err) {
          alert(`Couldn't import the workspace: ${err.message}`);
        }
      } } }, 'Import workspace'),
      state.workspaces.length > 1 && h('button.link-btn.danger', { type: 'button', on: { click: () => {
        if (!confirm(`Delete the "${workspace.name}" workspace from this browser? Export it first if you want to keep it.`)) return;
        state.workspaces = state.workspaces.filter((w) => w.id !== workspace.id);
        state.activeWorkspaceId = state.workspaces[0].id;
        saveWorkspaces(state.workspaces);
        saveActiveWorkspaceId(state.activeWorkspaceId);
        actions.recompute();
      } } }, 'Delete workspace'),
    ]),
    h('label.persist', [
      h('input', { type: 'checkbox', checked: st.persistBatch, on: { change: (e) => {
        if (e.target.checked && !confirm('Keep the supplier batch in this browser?\n\nThe batch includes bank account and tax ID numbers. They will be saved unencrypted in this browser’s storage until you clear them. Only turn this on for a computer you trust.')) {
          e.target.checked = false;
          return;
        }
        if (!e.target.checked) forgetBatch();
        actions.updateWorkspace((ws) => { ws.settings = { ...settingsOf(ws), persistBatch: e.target.checked }; });
      } } }),
      h('span', [h('strong', 'Keep the batch in this browser'), h('br'), h('span.muted', 'Off by default. The batch holds bank and tax numbers.')]),
    ]),
  ]);
}
