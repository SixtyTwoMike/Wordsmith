// App-wide preferences (not per script): colour theme, Home Screen icon
// and the name used on review comments. Applied to the document here.

import { load, save } from './store.js';

const prefs = { theme: 'system', icon: 'classic', reviewer: '', ...load('prefs', {}) };

export function get(key) {
  return prefs[key];
}

export function set(key, value) {
  prefs[key] = value;
  save('prefs', prefs);
}

// `paper` is the theme's page colour, used for the browser/status bar.
export const THEMES = [
  { id: 'system', label: 'Auto', paper: null, accent: '#e0a458', swatch: ['#f7f5ef', '#131418'] },
  { id: 'paper', label: 'Paper', paper: '#f7f5ef', accent: '#b86e12', swatch: ['#f7f5ef'] },
  { id: 'night', label: 'Night', paper: '#131418', accent: '#e0a458', swatch: ['#131418'] },
  { id: 'sepia', label: 'Sepia', paper: '#f1e7d0', accent: '#9a5b1e', swatch: ['#f1e7d0'] },
  { id: 'midnight', label: 'Midnight', paper: '#0d1424', accent: '#8fd0ff', swatch: ['#0d1424'] },
  { id: 'contrast', label: 'High contrast', paper: '#ffffff', accent: '#0040c8', swatch: ['#ffffff'] },
];

export const ICONS = [
  { id: 'classic', label: 'Classic', file: 'icon' },
  { id: 'paper', label: 'Paper', file: 'icon-paper' },
  { id: 'glass', label: 'Glass', file: 'icon-glass' },
  { id: 'midnight', label: 'Midnight', file: 'icon-midnight' },
  { id: 'typewriter', label: 'Typewriter', file: 'icon-typewriter' },
];

const SYSTEM_THEME_COLORS = { light: '#f7f5ef', dark: '#131418' };

export function applyTheme() {
  const theme = THEMES.find((t) => t.id === prefs.theme) || THEMES[0];
  const root = document.documentElement;
  if (theme.id === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme.id;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const scheme = (meta.getAttribute('media') || '').includes('dark') ? 'dark' : 'light';
    meta.setAttribute('content', theme.paper || SYSTEM_THEME_COLORS[scheme]);
  }
}

// iOS reads the apple-touch-icon (and other browsers the manifest) when
// the app is added to the Home Screen, so point both at the chosen design.
export function applyIcon() {
  const icon = ICONS.find((i) => i.id === prefs.icon) || ICONS[0];
  const touch = document.querySelector('link[rel="apple-touch-icon"]');
  if (touch) touch.setAttribute('href', `icons/${icon.file}-180.png`);
  const manifest = document.querySelector('link[rel="manifest"]');
  if (manifest) {
    manifest.setAttribute('href', icon.id === 'classic' ? 'manifest.webmanifest' : `manifest-${icon.id}.webmanifest`);
  }
}

export function isInstalled() {
  return (
    window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
  );
}
