// Usage tracking and chip suggestion source: recency-weighted learned
// ordering, or the user's manual set list when overridden. Stats and
// settings are scoped per script id, so each script learns independently.

import { load, save } from './store.js';

export const DEFAULT_TRANSITIONS = ['CUT TO:', 'SMASH CUT TO:', 'DISSOLVE TO:', 'FADE OUT.'];

// Full maps of { scriptId: value }. The active script's slices are held
// in `stats` / `settings` and re-pointed by activateScript().
const allStats = load('stats', () => ({}));
const allSettings = load('settings', () => ({}));

let currentId = null;
let stats = freshStats();
let settings = freshSettings();

function freshStats() {
  return { characters: {}, locations: {}, transitions: {} };
}

function freshSettings() {
  return { chipMode: 'learned', manualChips: { characters: [], locations: [], transitions: [] } };
}

// Point the module at a script's stats/settings, creating them on first use.
export function activateScript(id) {
  currentId = id;
  stats = allStats[id] || (allStats[id] = freshStats());
  settings = allSettings[id] || (allSettings[id] = freshSettings());
}

// Drop a deleted script's learned data.
export function removeScriptData(id) {
  delete allStats[id];
  delete allSettings[id];
  save('stats', allStats);
  save('settings', allSettings);
}

// Copy learned data when a script is duplicated.
export function copyScriptData(fromId, toId) {
  allStats[toId] = JSON.parse(JSON.stringify(allStats[fromId] || freshStats()));
  allSettings[toId] = JSON.parse(JSON.stringify(allSettings[fromId] || freshSettings()));
  save('stats', allStats);
  save('settings', allSettings);
}

export function getSettings() {
  return settings;
}

export function saveSettings() {
  save('settings', allSettings);
}

export function recordUse(category, name) {
  name = (name || '').trim().toUpperCase();
  if (!name) return;
  const bucket = stats[category] || (stats[category] = {});
  const entry = bucket[name] || (bucket[name] = { count: 0, lastUsed: 0 });
  entry.count++;
  entry.lastUsed = Date.now();
  save('stats', allStats);
}

const HALF_LIFE_DAYS = 7;

function score(entry) {
  const days = (Date.now() - entry.lastUsed) / 86400000;
  return entry.count * Math.pow(0.5, days / HALF_LIFE_DAYS);
}

function rankedFromStats(category, limit) {
  const bucket = stats[category] || {};
  return Object.entries(bucket)
    .sort((a, b) => score(b[1]) - score(a[1]))
    .slice(0, limit)
    .map(([name]) => name);
}

// What the quick bar shows: manual list verbatim when overridden,
// otherwise learned ranking.
export function topItems(category, limit = 8) {
  if (settings.chipMode === 'manual') {
    return (settings.manualChips[category] || []).slice(0, limit);
  }
  return rankedFromStats(category, limit);
}

// Learned ranking regardless of mode (used to prefill the manual lists).
export function learnedTop(category, limit = 8) {
  return rankedFromStats(category, limit);
}

// Prefix match over learned names for autocomplete (Phase 2).
export function prefixMatch(category, prefix, limit = 1) {
  prefix = (prefix || '').trim().toUpperCase();
  if (!prefix) return [];
  const bucket = stats[category] || {};
  return Object.entries(bucket)
    .filter(([name]) => name.startsWith(prefix) && name !== prefix)
    .sort((a, b) => score(b[1]) - score(a[1]))
    .slice(0, limit)
    .map(([name]) => name);
}
