// Mapping profiles: a confirmed column mapping saved under a name so the next
// file with the same headers maps itself. Profiles match on headers, not
// column positions, and export/import as JSON for sharing across the team.

import { headerKey } from '../model/normalize.js';
import { TARGET_BY_ID } from './targets.js';

export const PROFILE_FORMAT = 'commit-seb-mapping-profile@1';

export function headerSignature(headers) {
  return [...new Set(headers.map(headerKey).filter(Boolean))].sort();
}

export function makeProfile(name, table, mapping) {
  return {
    format: PROFILE_FORMAT,
    id: `mp-${Date.now().toString(36)}`,
    name: name.trim(),
    createdAt: new Date().toISOString(),
    headers: headerSignature(table.headers),
    columns: mapping.columns.filter((c) => c.target).map((c) => ({ header: c.header, target: c.target })),
    ignored: mapping.columns.filter((c) => !c.target).map((c) => c.header),
    defaults: mapping.defaults.map(({ target, value }) => ({ target, value })),
  };
}

/** Share of the profile's headers present in the table (1 = every header found). */
export function profileFit(profile, table) {
  const have = new Set(headerSignature(table.headers));
  if (!profile.headers.length) return 0;
  return profile.headers.filter((h) => have.has(h)).length / profile.headers.length;
}

/** Best profile whose headers are all present in the table. */
export function findProfile(profiles, table) {
  let best = null;
  for (const p of profiles ?? []) {
    const fit = profileFit(p, table);
    if (fit === 1 && (!best || p.headers.length > best.headers.length)) best = p;
  }
  return best;
}

export function applyProfile(profile, table, guessed) {
  const byHeader = new Map(profile.columns.map((c) => [headerKey(c.header), c.target]));
  const ignored = new Set((profile.ignored ?? []).map(headerKey));
  return {
    columns: guessed.columns.map((c) => {
      const k = headerKey(c.header);
      if (byHeader.has(k) && TARGET_BY_ID[byHeader.get(k)]) return { ...c, target: byHeader.get(k), confidence: 'profile', why: `From profile "${profile.name}"` };
      if (ignored.has(k)) return { ...c, target: null, confidence: 'profile', why: `Ignored in profile "${profile.name}"` };
      return c;
    }),
    defaults: (profile.defaults ?? []).filter((d) => TARGET_BY_ID[d.target]).map((d) => ({ ...d, why: `From profile "${profile.name}"` })),
    profileId: profile.id,
  };
}

export function exportProfiles(profiles) {
  return JSON.stringify({ format: PROFILE_FORMAT, exportedAt: new Date().toISOString(), profiles }, null, 2);
}

/** Parses a profiles file. Accepts the export wrapper, a single profile, or an array. */
export function importProfiles(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : Array.isArray(data.profiles) ? data.profiles : [data];
  const ok = list.filter((p) => p && typeof p.name === 'string' && Array.isArray(p.columns) && Array.isArray(p.headers));
  if (!ok.length) throw new Error('No mapping profiles found in this file.');
  return ok.map((p) => ({ ...p, format: PROFILE_FORMAT }));
}
