// localStorage persistence with debounced autosave.

import { uid } from './model.js';

const KEYS = {
  script: 'wordsmith.script.v1', // legacy v1 key, read only for migration
  scriptIndex: 'wordsmith.scriptIndex.v1',
  scripts: 'wordsmith.scripts.v1',
  stats: 'wordsmith.stats.v1',
  settings: 'wordsmith.settings.v1',
  characters: 'wordsmith.characters.v1',
};

export function load(kind, fallback) {
  try {
    const raw = localStorage.getItem(KEYS[kind]);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    // corrupt or unavailable storage: fall through to fresh state
  }
  return typeof fallback === 'function' ? fallback() : fallback;
}

let pending = {};
let timer = null;

export function save(kind, value) {
  pending[kind] = value;
  clearTimeout(timer);
  timer = setTimeout(flush, 400);
}

export function flush() {
  clearTimeout(timer);
  timer = null;
  for (const [kind, value] of Object.entries(pending)) {
    try {
      localStorage.setItem(KEYS[kind], JSON.stringify(value));
    } catch (e) {
      // quota or private-mode failure: keep the app running
    }
  }
  pending = {};
}

// One-time upgrade from the single-script v1 layout to the v2 catalog.
// v1 stored one script under `script`, with flat `stats`/`settings`.
// v2 keys everything by script id, so nest the legacy data under a
// generated id and drop the old key. Runs only when the v2 index is
// absent and a legacy script is present, so it is a no-op afterwards.
//
// This MUST run before suggest.js reads stats/settings at its module
// top level. Because suggest.js imports store.js, this module is fully
// evaluated (including the call at the bottom) before suggest.js's body,
// so the data is already in v2 shape when suggest reads it.
export function migrateV1toV2(makeId) {
  if (localStorage.getItem(KEYS.scriptIndex)) return;
  const legacy = localStorage.getItem(KEYS.script);
  if (!legacy) return;
  try {
    const script = JSON.parse(legacy);
    const id = script.id && script.id !== 'default' ? script.id : makeId();
    script.id = id;
    const now = Date.now();
    const stamp = script.updatedAt || now;
    const index = {
      current: id,
      scripts: [{ id, title: script.title || '', createdAt: stamp, updatedAt: stamp }],
    };
    localStorage.setItem(KEYS.scriptIndex, JSON.stringify(index));
    localStorage.setItem(KEYS.scripts, JSON.stringify({ [id]: script }));

    const flatStats = JSON.parse(localStorage.getItem(KEYS.stats) || 'null');
    if (flatStats && flatStats.characters) {
      localStorage.setItem(KEYS.stats, JSON.stringify({ [id]: flatStats }));
    }
    const flatSettings = JSON.parse(localStorage.getItem(KEYS.settings) || 'null');
    if (flatSettings && flatSettings.chipMode) {
      localStorage.setItem(KEYS.settings, JSON.stringify({ [id]: flatSettings }));
    }
    localStorage.removeItem(KEYS.script);
  } catch (e) {
    // leave the legacy data untouched if anything looks wrong
  }
}

// Run the upgrade at module load, before any other module reads storage.
migrateV1toV2(uid);

// iOS never fires unload; flush whenever the app goes to background.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});
window.addEventListener('pagehide', flush);
