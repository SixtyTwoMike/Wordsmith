// Bootstrap: load state, wire modules, register the service worker, and
// keep the quick bar pinned above the iOS keyboard.

import { load, save } from './store.js';
import { createScript, newElement } from './model.js';
import * as editor from './editor.js';
import * as quickbar from './quickbar.js';
import * as settings from './settings.js';

const script = load('script', createScript);
if (!Array.isArray(script.elements) || script.elements.length === 0) {
  script.elements = [newElement('scene', '')];
}

const titleInput = document.getElementById('title');
titleInput.value = script.title || '';
titleInput.addEventListener('input', () => {
  script.title = titleInput.value;
  save('script', script);
});

editor.init(script, document.getElementById('page'));
quickbar.init();
settings.init(() => quickbar.refresh());
quickbar.refresh();

// iOS Safari does not resize the layout viewport when the keyboard opens;
// translate the quick bar to the visual viewport's bottom edge and pad the
// page so the caret is never hidden behind the keyboard.
const quickbarEl = document.getElementById('quickbar');
const pageEl = document.getElementById('page');
const vv = window.visualViewport;

function placeQuickbar() {
  if (!vv) return;
  const offset = vv.offsetTop + vv.height - window.innerHeight;
  quickbarEl.style.transform = `translateY(${offset}px)`;
  const keyboard = Math.max(0, window.innerHeight - vv.height);
  pageEl.style.paddingBottom = keyboard + 200 + 'px';
}

if (vv) {
  vv.addEventListener('resize', placeQuickbar);
  vv.addEventListener('scroll', placeQuickbar);
  placeQuickbar();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
