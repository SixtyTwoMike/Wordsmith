// Block-based screenplay editor with a single roving textarea.
// No contenteditable: iOS Safari handles a plain textarea far more
// reliably. The active block hosts the textarea; all others render as
// styled divs. The textarea is never blurred when moving between blocks
// so the iOS keyboard stays up.

import {
  ENTER_NEXT,
  EMPTY_ENTER_CYCLE,
  TAB_CYCLE,
  UPPERCASE_TYPES,
  PLACEHOLDERS,
  newElement,
  detectType,
  normalizeOnCommit,
  characterStatName,
  sceneLocation,
} from './model.js';
import { recordUse } from './suggest.js';
import { createHistory } from './history.js';

let script;
let pageEl;
let ta;
let activeIndex = 0;
let rendering = false;
let applying = false;
let persistCb = () => {};
const listeners = [];
const updateListeners = [];
const history = createHistory(100);
let histTimer = null;

export function init(theScript, page, onPersist) {
  script = theScript;
  pageEl = page;
  persistCb = onPersist || (() => {});

  ta = document.createElement('textarea');
  ta.id = 'blockInput';
  ta.rows = 1;
  ta.autocapitalize = 'sentences';
  ta.autocomplete = 'off';
  ta.setAttribute('autocorrect', 'on');
  ta.addEventListener('input', onInput);
  ta.addEventListener('keydown', onKeydown);
  ta.addEventListener('blur', () => {
    if (rendering) return;
    commit(activeIndex);
    renderBlockText(activeIndex);
    touch();
    notify();
  });

  pageEl.addEventListener('pointerdown', onPageTap);

  render(false);
  history.reset(snap());
  emitUpdate();
}

export function onActiveChange(fn) {
  listeners.push(fn);
}

// Fired on every edit (text or structure). Used for the live page count
// and the autocomplete completion chip.
export function onUpdate(fn) {
  updateListeners.push(fn);
}

function notify() {
  for (const fn of listeners) fn(activeType());
}

function emitUpdate() {
  for (const fn of updateListeners) fn();
}

export function activeText() {
  return script.elements[activeIndex]?.text ?? '';
}

export function activeType() {
  return script.elements[activeIndex]?.type;
}

export function getScript() {
  return script;
}

/* ---------- rendering ---------- */

function display(el) {
  let t = el.text;
  if (UPPERCASE_TYPES.has(el.type)) t = t.toUpperCase();
  if (el.type === 'paren' && t) t = '(' + t + ')';
  return t;
}

function blockDiv(el, i) {
  const div = document.createElement('div');
  div.className = 'el el-' + el.type + (i === activeIndex ? ' active' : '');
  div.dataset.index = i;
  if (i === activeIndex) {
    ta.value = el.text;
    ta.placeholder = PLACEHOLDERS[el.type];
    div.appendChild(ta);
  } else {
    div.textContent = display(el);
  }
  return div;
}

function render(focus = true) {
  rendering = true;
  const frag = document.createDocumentFragment();
  script.elements.forEach((el, i) => frag.appendChild(blockDiv(el, i)));
  pageEl.replaceChildren(frag);
  autogrow();
  if (focus) ta.focus({ preventScroll: true });
  scrollActiveIntoView();
  setTimeout(() => {
    rendering = false;
  }, 0);
}

function renderBlockText(i) {
  const el = script.elements[i];
  const div = pageEl.children[i];
  if (!el || !div) return;
  if (i === activeIndex) {
    if (ta.value !== el.text) ta.value = el.text;
  } else {
    div.textContent = display(el);
  }
}

function autogrow() {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

function scrollActiveIntoView() {
  pageEl.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
}

/* ---------- persistence & stats ---------- */

function touch() {
  script.updatedAt = Date.now();
  persistCb();
  emitUpdate();
  if (!applying) checkpoint();
}

// Swap in a different script (used by the script switcher). The caller is
// responsible for committing the outgoing block first via commitActive()
// so its stats land in the outgoing script's scope.
export function load(theScript) {
  script = theScript;
  activeIndex = 0;
  render();
  const end = ta.value.length;
  ta.setSelectionRange(end, end);
  history.reset(snap());
  touch();
  notify();
}

// Commit the active block without moving focus (called before switching
// scripts or exporting).
export function commitActive() {
  commit(activeIndex);
  renderBlockText(activeIndex);
}

/* ---------- undo / redo ---------- */

function snap() {
  return JSON.stringify({ elements: script.elements, activeIndex });
}

// Coalesce rapid edits into one history entry.
function checkpoint() {
  clearTimeout(histTimer);
  histTimer = setTimeout(() => history.push(snap()), 450);
}

// Commit any pending (debounced) checkpoint immediately, so an undo issued
// mid-edit still steps back from the latest state.
function flushCheckpoint() {
  if (!histTimer) return;
  clearTimeout(histTimer);
  histTimer = null;
  history.push(snap());
}

function applyState(json) {
  const state = JSON.parse(json);
  applying = true;
  script.elements = state.elements;
  activeIndex = Math.max(0, Math.min(state.activeIndex, script.elements.length - 1));
  clearTimeout(histTimer);
  render();
  const end = ta.value.length;
  ta.setSelectionRange(end, end);
  script.updatedAt = Date.now();
  persistCb();
  emitUpdate();
  notify();
  applying = false;
}

export function undo() {
  flushCheckpoint();
  const json = history.undo();
  if (json != null) applyState(json);
}

export function redo() {
  // Symmetry with undo(): a pending debounced edit must be committed first.
  // It truncates the redo branch (history.redo() then returns null), so a
  // fresh edit made right after an undo can't be clobbered by a stale redo.
  flushCheckpoint();
  const json = history.redo();
  if (json != null) applyState(json);
}

export function canUndo() {
  return history.canUndo();
}

export function canRedo() {
  return history.canRedo();
}

// Normalize a block's text and record usage stats once per distinct text.
function commit(i) {
  const el = script.elements[i];
  if (!el) return;
  el.text = normalizeOnCommit(el.type, el.text);
  if (i === activeIndex && ta.value !== el.text) ta.value = el.text;
  if (!el.text || el.text === el.rec) return;
  if (el.type === 'character') {
    recordUse('characters', characterStatName(el.text));
  } else if (el.type === 'scene') {
    const loc = sceneLocation(el.text);
    if (loc) recordUse('locations', loc);
  } else if (el.type === 'transition') {
    recordUse('transitions', el.text);
  }
  el.rec = el.text;
}

/* ---------- input handling ---------- */

function onInput() {
  const el = script.elements[activeIndex];
  el.text = ta.value;
  const detected = detectType(el.type, el.text);
  if (detected !== el.type) {
    setActiveType(detected);
  } else {
    autogrow();
    touch();
  }
}

function onKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleEnter();
  } else if (e.key === 'Tab') {
    e.preventDefault();
    cycleType();
  } else if (e.key === 'Backspace' && ta.selectionStart === 0 && ta.selectionEnd === 0) {
    if (mergeBack()) e.preventDefault();
  }
}

function handleEnter() {
  const el = script.elements[activeIndex];
  if (ta.value.trim() === '') {
    const next = EMPTY_ENTER_CYCLE[el.type];
    if (next !== el.type) setActiveType(next);
    return;
  }
  const pos = ta.selectionStart;
  const before = ta.value.slice(0, pos);
  const after = ta.value.slice(pos);
  el.text = before;
  if (after) {
    insertBlockAfter(el.type, after, 0);
  } else {
    insertBlockAfter(ENTER_NEXT[el.type], '', 0);
  }
}

function mergeBack() {
  if (activeIndex === 0) return false;
  const cur = script.elements[activeIndex];
  const prev = script.elements[activeIndex - 1];
  const caret = prev.text.length;
  prev.text += cur.text;
  script.elements.splice(activeIndex, 1);
  activeIndex--;
  render();
  ta.setSelectionRange(caret, caret);
  touch();
  notify();
  return true;
}

function onPageTap(e) {
  const div = e.target.closest('.el');
  if (div && div.contains(ta)) return; // native caret handling in the active block
  e.preventDefault();
  if (div) {
    activate(Number(div.dataset.index));
  } else {
    activate(script.elements.length - 1);
  }
}

/* ---------- block operations (used by keys and quick bar) ---------- */

export function activate(i) {
  if (i === activeIndex) {
    ta.focus();
    return;
  }
  commit(activeIndex);
  activeIndex = Math.max(0, Math.min(i, script.elements.length - 1));
  render();
  const end = ta.value.length;
  ta.setSelectionRange(end, end);
  touch();
  notify();
}

function setActiveType(type) {
  const el = script.elements[activeIndex];
  el.type = type;
  const div = pageEl.children[activeIndex];
  if (div) div.className = 'el el-' + type + ' active';
  ta.placeholder = PLACEHOLDERS[type];
  autogrow();
  touch();
  notify();
}

function insertBlockAfter(type, text, caret) {
  commit(activeIndex);
  script.elements.splice(activeIndex + 1, 0, newElement(type, text));
  activeIndex++;
  render();
  const pos = caret == null ? ta.value.length : Math.min(caret, ta.value.length);
  ta.setSelectionRange(pos, pos);
  touch();
  notify();
}

export function cycleType() {
  setActiveType(TAB_CYCLE[activeType()]);
  ta.focus();
}

// Convert the active block if it's empty, otherwise insert after it.
export function newBlock(type, text = '', caret = null) {
  if (ta.value.trim() === '') {
    const el = script.elements[activeIndex];
    el.type = type;
    el.text = text;
    render();
    const pos = caret == null ? text.length : caret;
    ta.setSelectionRange(pos, pos);
    touch();
    notify();
  } else {
    insertBlockAfter(type, text, caret == null ? text.length : caret);
  }
}

// Rewrite the active block's text (scene-heading chips).
export function updateActiveText(fn) {
  const el = script.elements[activeIndex];
  el.text = fn(el.text);
  ta.value = el.text;
  const end = el.text.length;
  ta.setSelectionRange(end, end);
  ta.focus();
  autogrow();
  touch();
  notify();
}

// The core one-tap flow: CHARACTER block, then an empty dialogue block
// with the caret in it.
export function insertCharacterWithDialogue(name) {
  newBlock('character', name);
  insertBlockAfter('dialogue', '', 0);
}

// From a character block: replace whatever is typed with the chip name.
export function setCharacterAndDialogue(name) {
  const el = script.elements[activeIndex];
  el.type = 'character';
  el.text = name;
  ta.value = name;
  insertBlockAfter('dialogue', '', 0);
}

export function insertTransitionThenScene(text) {
  newBlock('transition', text);
  insertBlockAfter('scene', '', 0);
}
