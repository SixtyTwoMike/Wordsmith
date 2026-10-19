// Full backup and restore of every script, with its learned chip stats,
// set-list settings and character profiles, as one JSON file. iOS Safari
// can evict a site's localStorage after a stretch of disuse, so this is
// the user's safety net — and the way to move scripts between devices.

import { snapshot } from './store.js';

const FORMAT = 'wordsmith-backup';

export function toBackup() {
  const data = snapshot();
  const index = data.scriptIndex || { scripts: [] };
  const all = data.scripts || {};
  const scripts = index.scripts
    .filter((m) => all[m.id])
    .map((m) => ({
      script: all[m.id],
      stats: (data.stats || {})[m.id] || null,
      settings: (data.settings || {})[m.id] || null,
      characters: (data.characters || {})[m.id] || null,
    }));
  return { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), scripts };
}

// Parse and validate a backup file's text. Throws with a readable message.
export function parseBackup(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new Error('That file isn’t a Wordsmith backup.');
  }
  if (!obj || obj.format !== FORMAT || !Array.isArray(obj.scripts)) {
    throw new Error('That file isn’t a Wordsmith backup.');
  }
  return obj.scripts.filter((e) => e && e.script && Array.isArray(e.script.elements));
}

// Same content as a script already on this device? (Restoring the same
// backup twice shouldn't pile up duplicates.)
export function sameContent(a, b) {
  if (!a || !b) return false;
  const key = (s) =>
    JSON.stringify([s.title || '', s.titlePage || {}, s.elements.map((e) => [e.type, e.text])]);
  return key(a) === key(b);
}

export function backupFilename(date = new Date()) {
  return `wordsmith-backup-${date.toISOString().slice(0, 10)}.json`;
}
