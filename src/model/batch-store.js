// Optional batch persistence. Off by default because a batch holds bank and
// tax numbers. When a user opts in (Settings), the raw inputs, mappings,
// edits, and exclusions are saved in this browser only.

import { load, save, remove } from '../ui/storage.js';

const KEY = 'batch';

function toB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromB64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function persistBatch(state) {
  const data = {
    savedAt: new Date().toISOString(),
    inputs: state.inputs.map((i) => (i.bytes ? { name: i.name, b64: toB64(i.bytes) } : { name: i.name, text: i.text })),
    mappings: state.mappings,
    edits: state.edits,
    excluded: [...state.excluded],
  };
  return save(KEY, data);
}

export function loadPersistedBatch() {
  const data = load(KEY, null);
  if (!data?.inputs) return null;
  try {
    return {
      inputs: data.inputs.map((i) => (i.b64 ? { name: i.name, bytes: fromB64(i.b64) } : { name: i.name, text: i.text })),
      mappings: data.mappings ?? {},
      edits: data.edits ?? {},
      excluded: data.excluded ?? [],
    };
  } catch {
    return null;
  }
}

export function forgetBatch() {
  remove(KEY);
}
