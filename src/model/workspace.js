// Client workspaces hold everything that should carry over from one batch to
// the next for the same client: mapping profiles, value mapping rules,
// reference resolutions, tenant reference values, and settings.
// Supplier batch data is NOT part of a workspace (it holds bank and tax numbers).

import { load, save } from '../ui/storage.js';

export const DEFAULT_SETTINGS = Object.freeze({
  // Document_Status_ID written to Approval Status on every supplier.
  // Verify in tenant: see DECISIONS.md and the open items in BUILD_BRIEF.md.
  approvalStatusId: 'APPROVED',
  addressIdPrefix: 'ADDR-',
  settlementAccountIdPrefix: 'SBA-',
  intermediaryAccountIdPrefix: 'IBA-',
});

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
