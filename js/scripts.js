// Script catalog: owns the index of scripts and the map of their content,
// and all create / switch / rename / duplicate / delete operations. The
// editor holds a reference to the active script object; this module keeps
// the persisted map and lightweight index metadata in sync.

import { load, save } from './store.js';
import { createScript, newElement, uid } from './model.js';

let index; // { current, scripts: [{ id, title, createdAt, updatedAt }] }
let scripts; // { [id]: scriptObject }

function meta(s) {
  const now = Date.now();
  return {
    id: s.id,
    title: s.title || '',
    createdAt: s.createdAt || s.updatedAt || now,
    updatedAt: s.updatedAt || now,
  };
}

function persist() {
  save('scriptIndex', index);
  save('scripts', scripts);
}

// Load the catalog, seeding a first script if storage is empty. Returns
// the active script object.
export function initCatalog() {
  index = load('scriptIndex', null);
  scripts = load('scripts', () => ({}));
  const valid = index && Array.isArray(index.scripts) && index.scripts.length > 0;
  if (!valid) {
    const s = createScript();
    scripts = { [s.id]: s };
    index = { current: s.id, scripts: [meta(s)] };
    persist();
  }
  if (!scripts[index.current]) index.current = index.scripts[0].id;
  return currentScript();
}

export function currentId() {
  return index.current;
}

export function currentScript() {
  const s = scripts[index.current];
  if (!Array.isArray(s.elements) || s.elements.length === 0) {
    s.elements = [newElement('scene', '')];
  }
  return s;
}

export function list() {
  // Most recently updated first.
  return index.scripts.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// Keep index metadata (title, updatedAt) aligned with the live script and
// persist. Called from the editor's debounced autosave.
export function syncMeta(s) {
  const m = index.scripts.find((x) => x.id === s.id);
  if (m) {
    m.title = s.title || '';
    m.updatedAt = s.updatedAt || Date.now();
  }
  persist();
}

export function switchTo(id) {
  if (!scripts[id]) return null;
  index.current = id;
  save('scriptIndex', index);
  return currentScript();
}

export function create(title = '') {
  const s = createScript(title);
  scripts[s.id] = s;
  index.scripts.push(meta(s));
  index.current = s.id;
  persist();
  return s;
}

export function rename(id, title) {
  if (scripts[id]) {
    scripts[id].title = title;
    scripts[id].updatedAt = Date.now();
  }
  const m = index.scripts.find((x) => x.id === id);
  if (m) {
    m.title = title;
    m.updatedAt = Date.now();
  }
  persist();
}

// Deep-copy a script under a fresh id (and fresh element ids). Returns
// { fromId, toId, script } so the caller can copy learned stats too.
export function duplicate(id) {
  const src = scripts[id];
  if (!src) return null;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = uid();
  copy.title = (src.title || 'Untitled') + ' copy';
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  copy.elements = copy.elements.map((el) => ({ ...el, id: uid() }));
  scripts[copy.id] = copy;
  index.scripts.push(meta(copy));
  index.current = copy.id;
  persist();
  return { fromId: id, toId: copy.id, script: copy };
}

// Remove a script. If it was the last one, seed a fresh empty script so
// the app is never without a current script. Returns the new current one.
export function remove(id) {
  delete scripts[id];
  index.scripts = index.scripts.filter((x) => x.id !== id);
  if (index.scripts.length === 0) {
    const s = createScript();
    scripts[s.id] = s;
    index.scripts.push(meta(s));
    index.current = s.id;
  } else if (index.current === id) {
    index.current = list()[0].id;
  }
  persist();
  return currentScript();
}
