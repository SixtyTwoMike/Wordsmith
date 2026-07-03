// Usage tracking and chip suggestion source: recency-weighted learned
// ordering, or the user's manual set list when overridden.

import { load, save } from './store.js';

export const DEFAULT_TRANSITIONS = ['CUT TO:', 'SMASH CUT TO:', 'DISSOLVE TO:', 'FADE OUT.'];

const stats = load('stats', () => ({ characters: {}, locations: {}, transitions: {} }));
const settings = load('settings', () => ({
  chipMode: 'learned',
  manualChips: { characters: [], locations: [], transitions: [] },
}));

export function getSettings() {
  return settings;
}

export function saveSettings() {
  save('settings', settings);
}

export function recordUse(category, name) {
  name = (name || '').trim().toUpperCase();
  if (!name) return;
  const bucket = stats[category] || (stats[category] = {});
  const entry = bucket[name] || (bucket[name] = { count: 0, lastUsed: 0 });
  entry.count++;
  entry.lastUsed = Date.now();
  save('stats', stats);
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
