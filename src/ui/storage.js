// Safe wrappers around localStorage. Storage can be missing or throw (private
// windows, blocked site data, file:// in some browsers), so every call is
// guarded and the app keeps working in memory when it is unavailable.

const PREFIX = 'commit-seb:';
const memory = new Map();

function store() {
  try {
    const s = globalThis.localStorage;
    const probe = `${PREFIX}probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export const storageAvailable = () => store() !== null;

export function load(key, fallback) {
  try {
    const s = store();
    const raw = s ? s.getItem(PREFIX + key) : memory.get(key);
    return raw === null || raw === undefined ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  const raw = JSON.stringify(value);
  try {
    const s = store();
    if (s) s.setItem(PREFIX + key, raw);
    else memory.set(key, raw);
    return true;
  } catch {
    memory.set(key, raw);
    return false;
  }
}

export function remove(key) {
  memory.delete(key);
  try {
    store()?.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** Removes everything this app has stored in this browser. */
export function clearAll() {
  memory.clear();
  try {
    const s = store();
    if (!s) return;
    const keys = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => s.removeItem(k));
  } catch {
    /* ignore */
  }
}
