// Bootstrap: migrate legacy data, load the script catalog, wire modules,
// register the service worker, and keep the quick bar pinned above the
// iOS keyboard.

// store.js runs the v1->v2 migration at its own module load, before any
// module reads storage — so the catalog and stats are already in v2 shape.
import { estimatePages } from './model.js';
import * as scripts from './scripts.js';
import * as suggest from './suggest.js';
import * as editor from './editor.js';
import * as quickbar from './quickbar.js';
import * as settings from './settings.js';
import * as switcher from './switcher.js';
import * as outline from './navigator.js';

const current = scripts.initCatalog();
suggest.activateScript(scripts.currentId());

const titleInput = document.getElementById('title');

function updateHeader() {
  titleInput.value = scripts.currentScript().title || '';
}

updateHeader();
titleInput.addEventListener('input', () => {
  scripts.rename(scripts.currentId(), titleInput.value);
});

editor.init(current, document.getElementById('page'), () =>
  scripts.syncMeta(editor.getScript())
);
quickbar.init();
settings.init(() => quickbar.refresh());
outline.init();

// Live page count in the header (1 page ≈ 1 minute of screen time).
const pageCountEl = document.getElementById('pageCount');
function updatePageCount() {
  const pages = estimatePages(editor.getScript().elements);
  pageCountEl.textContent = Math.max(1, Math.ceil(pages));
}
editor.onUpdate(updatePageCount);
updatePageCount();

// Switch the whole app to a different script: commit the outgoing block
// first (so its stats stay in the outgoing scope), then re-point stats and
// swap the editor's script.
function openScript(id) {
  editor.commitActive();
  const s = scripts.switchTo(id);
  if (!s) return;
  suggest.activateScript(id);
  editor.load(s);
  quickbar.refresh();
  updateHeader();
}

switcher.init({
  list: () => scripts.list(),
  currentId: () => scripts.currentId(),
  onOpen: openScript,
  onNew: () => {
    editor.commitActive();
    const s = scripts.create();
    suggest.activateScript(s.id);
    editor.load(s);
    quickbar.refresh();
    updateHeader();
    titleInput.focus();
  },
  onRename: (id, title) => scripts.rename(id, title),
  onDuplicate: (id) => {
    editor.commitActive();
    const res = scripts.duplicate(id);
    if (!res) return;
    suggest.copyScriptData(res.fromId, res.toId);
    suggest.activateScript(res.toId);
    editor.load(res.script);
    quickbar.refresh();
    updateHeader();
  },
  onDelete: (id) => {
    const wasCurrent = id === scripts.currentId();
    if (wasCurrent) editor.commitActive();
    suggest.removeScriptData(id);
    const s = scripts.remove(id);
    // Only reload the editor if the script we were editing went away;
    // deleting some other script must not disturb the current cursor.
    if (wasCurrent) {
      suggest.activateScript(s.id);
      editor.load(s);
      quickbar.refresh();
      updateHeader();
    }
  },
});

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
