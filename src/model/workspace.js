// Client workspaces hold everything that should carry over from one batch to
// the next for the same client: mapping profiles, value mapping rules,
// reference resolutions, tenant reference values, and settings.
// Supplier batch data is NOT part of a workspace (it holds bank and tax numbers).

import { load, save } from '../ui/storage.js';

export const DEFAULT_SETTINGS = Object.freeze({
  // Document_Status_ID written to Approval Status on every supplier (D-012).
  approvalStatusId: 'APPROVED',
  // ID patterns for generated Address, Settlement Bank Account, and
  // Intermediary Bank Account IDs. Tokens: {date} {key} {n} {label}.
  addressIdPattern: 'ADDR-{date}-{key}-{n}',
  settlementAccountIdPattern: 'SBA-{date}-{key}-{n}',
  intermediaryAccountIdPattern: 'IBA-{date}-{key}-{n}',
  // Reference ID type written for Related Worktags (D-017). Blank = pick from the first worktag type.
  worktagIdType: '',
  // Opt-in: keep the supplier batch (bank and tax numbers) in this browser.
  persistBatch: false,
});

/** Workspace settings with defaults filled in, so older workspaces keep working. */
export const settingsOf = (ws) => ({ ...DEFAULT_SETTINGS, ...(ws?.settings ?? {}) });

export function newWorkspace(name) {
  return {
    id: `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || 'Untitled client',
    createdAt: new Date().toISOString(),
    settings: { ...DEFAULT_SETTINGS },
    mappingProfiles: [],
    valueMappings: [],
    referenceResolutions: {},
    tenantReferenceValues: [],
  };
}

export function loadWorkspaces() {
  const list = load('workspaces', null);
  if (Array.isArray(list) && list.length) return list;
  return [newWorkspace('My first client')];
}

export function saveWorkspaces(list) {
  return save('workspaces', list);
}

export function loadActiveWorkspaceId(list) {
  const id = load('activeWorkspace', null);
  return list.some((w) => w.id === id) ? id : list[0].id;
}

export function saveActiveWorkspaceId(id) {
  return save('activeWorkspace', id);
}

// ------------------------------------------------------ export / import

export const WORKSPACE_FORMAT = 'commit-seb-workspace@1';

/** Workspace JSON for sharing with the team. Never includes supplier batch data. */
export function exportWorkspace(ws) {
  const { id, name, createdAt, settings, mappingProfiles, valueMappings, referenceResolutions, tenantReferenceValues } = ws;
  return JSON.stringify({ format: WORKSPACE_FORMAT, exportedAt: new Date().toISOString(), workspace: { id, name, createdAt, settings, mappingProfiles, valueMappings, referenceResolutions, tenantReferenceValues } }, null, 2);
}

export function importWorkspace(text) {
  const data = JSON.parse(text);
  const w = data.workspace ?? data;
  if (!w || typeof w.name !== 'string') throw new Error('This file is not a Supplier EIB Builder workspace.');
  const base = newWorkspace(w.name);
  return {
    ...base,
    name: w.name,
    createdAt: w.createdAt ?? base.createdAt,
    settings: { ...DEFAULT_SETTINGS, ...(w.settings ?? {}), persistBatch: false },
    mappingProfiles: Array.isArray(w.mappingProfiles) ? w.mappingProfiles : [],
    valueMappings: Array.isArray(w.valueMappings) ? w.valueMappings : [],
    referenceResolutions: w.referenceResolutions && typeof w.referenceResolutions === 'object' ? w.referenceResolutions : {},
    tenantReferenceValues: Array.isArray(w.tenantReferenceValues) ? w.tenantReferenceValues : [],
  };
}
