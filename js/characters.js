// Per-script character registry: the metadata behind Personae Dramatis
// (full name, aliases, description, relationships, motives, notes). Keyed
// by the normalized base name, so "ELIZABETH" and "ELIZABETH (V.O.)" share
// one profile. Scoped per script like stats, and kept in localStorage.

import { load, save } from './store.js';
import { characterStatName } from './model.js';

const all = load('characters', () => ({})); // { scriptId: { NAME: profile } }
let reg = {};

function freshProfile() {
  return {
    fullName: '',
    aliases: '',
    description: '',
    relationships: '',
    motives: '',
    notes: '',
  };
}

export function activateScript(id) {
  reg = all[id] || (all[id] = {});
}

export function removeScriptData(id) {
  delete all[id];
  save('characters', all);
}

export function copyScriptData(fromId, toId) {
  all[toId] = JSON.parse(JSON.stringify(all[fromId] || {}));
  save('characters', all);
}

export function getProfile(name) {
  return reg[characterStatName(name)] || null;
}

// Return the stored profile or a fresh (unsaved) blank one to edit.
export function profileFor(name) {
  return getProfile(name) || freshProfile();
}

// Persist a single field change for a character.
export function updateProfileField(name, field, value) {
  const key = characterStatName(name);
  const p = reg[key] || (reg[key] = freshProfile());
  p[field] = value;
  save('characters', all);
}
