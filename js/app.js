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
import * as exporter from './export.js';
import * as characters from './characters.js';
import * as profile from './profile.js';
import * as snippet from './snippet.js';
import * as prefs from './prefs.js';

prefs.applyTheme();
prefs.applyIcon();
import { parseFountain } from './fountain.js';
import { toBackup, parseBackup, sameContent, backupFilename } from './backup.js';
import { createScript, characterStatName, sceneLocation } from './model.js';

const current = scripts.initCatalog();
suggest.activateScript(scripts.currentId());
characters.activateScript(scripts.currentId());

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
exporter.init(() => scripts.syncMeta(editor.getScript()));
profile.init();
snippet.init();

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
  characters.activateScript(id);
  editor.load(s);
  quickbar.refresh();
  updateHeader();
}

// Make a script current across every module (stats, profiles, editor).
function showScript(s) {
  suggest.activateScript(s.id);
  characters.activateScript(s.id);
  editor.load(s);
  quickbar.refresh();
  updateHeader();
}

// Import a .fountain file as a new script, and teach the chips its
// characters, locations and transitions so they're one tap away at once.
async function importFountain(file) {
  const parsed = parseFountain(await file.text());
  editor.commitActive();
  const s = createScript(parsed.title || file.name.replace(/\.[^.]+$/, ''));
  s.elements = parsed.elements;
  if (Object.keys(parsed.titlePage).length) s.titlePage = parsed.titlePage;
  scripts.add(s);
  suggest.activateScript(s.id);
  for (const el of s.elements) {
    if (el.type === 'character') suggest.recordUse('characters', characterStatName(el.text));
    else if (el.type === 'scene' && sceneLocation(el.text)) suggest.recordUse('locations', sceneLocation(el.text));
    else if (el.type === 'transition') suggest.recordUse('transitions', el.text);
  }
  showScript(s);
}

// Restore a backup by merging: scripts already here unchanged are skipped,
// everything else comes in as an extra script (never overwriting local work).
async function restoreBackup(file) {
  const entries = parseBackup(await file.text());
  editor.commitActive();
  const local = scripts.list().map((m) => scripts.get(m.id));
  let added = 0;
  let last = null;
  for (const e of entries) {
    if (local.some((l) => sameContent(l, e.script))) continue;
    const copy = JSON.parse(JSON.stringify(e.script));
    // An edited version of a script that's still here: keep both, labelled.
    if (scripts.get(copy.id)) copy.title = (copy.title || 'Untitled') + ' (restored)';
    const s = scripts.add(copy);
    suggest.importScriptData(s.id, { stats: e.stats, settings: e.settings });
    characters.importScriptData(s.id, e.characters);
    last = s;
    added++;
  }
  if (last) showScript(last);
  return added;
}

switcher.init({
  list: () => scripts.list(),
  currentId: () => scripts.currentId(),
  onOpen: openScript,
  onNew: () => {
    editor.commitActive();
    const s = scripts.create();
    suggest.activateScript(s.id);
    characters.activateScript(s.id);
    editor.load(s);
    quickbar.refresh();
    updateHeader();
    titleInput.focus();
  },
  onRename: (id, title) => scripts.rename(id, title),
  onExport: () => exporter.open(),
  onImport: importFountain,
  onRestore: restoreBackup,
  onBackup: () => {
    editor.commitActive();
    exporter.deliver(
      backupFilename(),
      JSON.stringify(toBackup(), null, 1),
      'application/json'
    );
  },
  onDuplicate: (id) => {
    editor.commitActive();
    const res = scripts.duplicate(id);
    if (!res) return;
    suggest.copyScriptData(res.fromId, res.toId);
    characters.copyScriptData(res.fromId, res.toId);
    suggest.activateScript(res.toId);
    characters.activateScript(res.toId);
    editor.load(res.script);
    quickbar.refresh();
    updateHeader();
  },
  onDelete: (id) => {
    const wasCurrent = id === scripts.currentId();
    if (wasCurrent) editor.commitActive();
    suggest.removeScriptData(id);
    characters.removeScriptData(id);
    const s = scripts.remove(id);
    // Only reload the editor if the script we were editing went away;
    // deleting some other script must not disturb the current cursor.
    if (wasCurrent) {
      suggest.activateScript(s.id);
      characters.activateScript(s.id);
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
  quickbarEl.classList.toggle('kb-open', keyboard > 80);
  pageEl.style.paddingBottom = keyboard + 200 + 'px';
}

// Inside a frame (e.g. a preview embedded in another app) iOS doesn't
// shrink our visual viewport for the keyboard, so the bar can't follow it.
// If typing starts and no keyboard shows up, dock the bar at the top
// instead, where the keyboard can't cover it. Only touch devices, and only
// when framed: a top-level page always sees the keyboard.
const framed = window.self !== window.top;
const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
const keyboardSeen = () => vv && window.innerHeight - vv.height > 80;

if (framed && touch) {
  document.addEventListener('focusin', (e) => {
    if (e.target.id !== 'blockInput') return;
    setTimeout(() => {
      if (document.activeElement === e.target && !keyboardSeen()) {
        document.body.classList.add('qb-top');
      }
    }, 500);
  });
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      if (document.activeElement?.id !== 'blockInput') document.body.classList.remove('qb-top');
    }, 100);
  });
}

if (vv) {
  vv.addEventListener('resize', placeQuickbar);
  vv.addEventListener('scroll', placeQuickbar);
  placeQuickbar();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
