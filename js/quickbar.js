// Thumb-reach quick bar: two rows of chips that insert formatted
// screenplay elements in one tap. The top row is context-sensitive scene
// and formatting tools; the bottom row (nearest the thumb) is always the
// script's characters. Chips act on pointerup (so the chip row
// can still be swipe-scrolled) and cancel pointerdown so the editor
// textarea never loses focus — the iOS keyboard stays up.

import * as editor from './editor.js';
import * as profile from './profile.js';
import { TYPE_LABELS, characterStatName, sceneLocation } from './model.js';
import { topItems, DEFAULT_TRANSITIONS, getSettings, prefixMatch, isKnown } from './suggest.js';

let chipsEl;
let charChipsEl;
let cycleBtn;
let undoBtn;
let redoBtn;

export function init() {
  chipsEl = document.getElementById('chips');
  charChipsEl = document.getElementById('charChips');
  cycleBtn = document.getElementById('cycleType');
  undoBtn = document.getElementById('undoBtn');
  redoBtn = document.getElementById('redoBtn');
  wireTaps(chipsEl, (chip) => chip._act && chip._act());
  wireTaps(
    charChipsEl,
    (chip) => chip._act && chip._act(),
    // Long-press a character chip to open its Personae Dramatis profile.
    (chip) => {
      if (chip.classList.contains('chip-char')) profile.open(chip.textContent);
    }
  );
  wireTaps(cycleBtn.parentElement, (chip) => {
    if (chip === cycleBtn) editor.cycleType();
    else if (chip === undoBtn) editor.undo();
    else if (chip === redoBtn) editor.redo();
    // the settings button keeps its normal click handler (keyboard may drop)
  });
  const fades = new ResizeObserver((entries) => entries.forEach((e) => syncFades(e.target)));
  for (const row of [chipsEl, charChipsEl]) {
    row.addEventListener('scroll', () => syncFades(row), { passive: true });
    fades.observe(row);
    // A mouse wheel only scrolls vertically; turn it sideways here.
    row.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || row.scrollWidth <= row.clientWidth) return;
      e.preventDefault();
      row.scrollLeft += e.deltaY;
    });
  }
  // Right-click is the mouse's long-press.
  charChipsEl.addEventListener('contextmenu', (e) => {
    const chip = e.target.closest('button.chip-char');
    if (!chip) return;
    e.preventDefault();
    profile.open(chip.textContent);
  });
  editor.onKey(onKey);
  document.addEventListener('keydown', onCharKey, true);
  // Holding Option/Alt shows each character chip's number.
  const showKeys = (on) => document.body.classList.toggle('show-char-keys', on);
  document.addEventListener('keydown', (e) => showKeys(e.key === 'Alt' || (e.altKey && !e.metaKey && !e.ctrlKey)));
  document.addEventListener('keyup', (e) => e.key === 'Alt' && showKeys(false));
  window.addEventListener('blur', () => showKeys(false));
  editor.onActiveChange(refresh);
  // Update the inline completion chip and undo/redo enabled state on every edit.
  editor.onUpdate(() => {
    refreshCompletion();
    syncUndoRedo();
  });
}

// Fade a chip row's edges only where there's more to scroll to.
function syncFades(row) {
  const max = row.scrollWidth - row.clientWidth;
  row.classList.toggle('fade-start', row.scrollLeft > 1);
  row.classList.toggle('fade-end', row.scrollLeft < max - 1);
}

function syncUndoRedo() {
  if (undoBtn) undoBtn.disabled = !editor.canUndo();
  if (redoBtn) redoBtn.disabled = !editor.canRedo();
}

function wireTaps(container, act, hold) {
  let downChip = null;
  let downX = 0;
  let downY = 0;
  let held = false;
  let holdTimer = null;

  const cancelHold = () => {
    clearTimeout(holdTimer);
    holdTimer = null;
  };

  container.addEventListener('pointerdown', (e) => {
    const chip = e.target.closest('button.chip');
    if (!chip || chip.id === 'openSettings') return;
    e.preventDefault();
    downChip = chip;
    downX = e.clientX;
    downY = e.clientY;
    held = false;
    if (hold) {
      holdTimer = setTimeout(() => {
        held = true;
        hold(chip);
      }, 500);
    }
  });
  container.addEventListener('pointermove', (e) => {
    if (downChip && Math.hypot(e.clientX - downX, e.clientY - downY) > 10) cancelHold();
  });
  container.addEventListener('pointerup', (e) => {
    cancelHold();
    const chip = e.target.closest('button.chip');
    // A completed long-press suppresses the tap.
    if (!held && chip && chip === downChip && Math.hypot(e.clientX - downX, e.clientY - downY) < 10) {
      act(chip);
    }
    downChip = null;
    held = false;
  });
  container.addEventListener('pointercancel', () => {
    cancelHold();
    downChip = null;
    held = false;
  });
}

/* ---------- chip sets ---------- */

function characterChips(limit = 8) {
  return topItems('characters', limit);
}

function transitionChips(limit = 4) {
  const items = topItems('transitions', limit);
  if (getSettings().chipMode === 'learned') {
    for (const d of DEFAULT_TRANSITIONS) {
      if (items.length >= limit) break;
      if (!items.includes(d)) items.push(d);
    }
  }
  return items;
}

const SCENE_PREFIX_RE = /^(INT\.?\/EXT|I\/E|INT|EXT|EST)[.\s]*/i;
const SCENE_SUFFIX_RE = /\s*-\s*(DAY|NIGHT|MORNING|EVENING|DAWN|DUSK|LATER|CONTINUOUS)\s*$/i;

function scenePrefix(p) {
  editor.updateActiveText((t) => p + t.replace(SCENE_PREFIX_RE, ''));
}

function setLocation(loc) {
  editor.updateActiveText((t) => {
    const m = t.match(SCENE_PREFIX_RE);
    const prefix = m ? m[0] : 'INT. ';
    const rest = t.slice(m ? m[0].length : 0);
    const dash = rest.lastIndexOf(' - ');
    const suffix = dash >= 0 ? rest.slice(dash) : '';
    return prefix + loc + suffix;
  });
}

function sceneSuffix(s) {
  editor.updateActiveText((t) => t.replace(SCENE_SUFFIX_RE, '') + s);
}

// Professional formatting (Phase 5), informed by TV-drama conventions.
const SCENE_NOTES = ['[FLASHBACK]', '[ARCHIVAL]', '[SURVEILLANCE]'];
const PAREN_PRESETS = ['beat', 'pause', 'whispers', "cont'd"];
// TV act structure (Phase 7): centered structural markers.
const MARKERS = ['COLD OPEN', 'ACT ONE', 'END OF ACT', 'TAG'];
const CUE_RE = /\s*\((?:V\.O\.|O\.S\.|CONT'D|CONT’D)\)\s*$/i;

// Append a voice cue to a character name, replacing any existing one so
// (V.O.) then (O.S.) swaps rather than stacking.
function setCue(cue) {
  editor.updateActiveText((t) => t.replace(CUE_RE, '').replace(/\s+$/, '') + ' ' + cue);
}

// Append a bracketed scene notation, replacing any trailing one.
function sceneNote(tag) {
  editor.updateActiveText((t) => t.replace(/\s*\[[^\]]*\]\s*$/, '').replace(/\s+$/, '') + ' ' + tag);
}

function chip(label, act, cls = '') {
  return { label, act, cls };
}

function toButtons(chips) {
  return chips.map(({ label, act, cls }) => {
    const b = document.createElement('button');
    b.className = 'chip' + (cls ? ' ' + cls : '');
    b.textContent = label;
    b.setAttribute('aria-label', label);
    b._act = act;
    return b;
  });
}

// Character row: from a character block the chip fills in that name;
// anywhere else it starts a new CHARACTER + dialogue pair.
function buildCharacterChips(type) {
  return characterChips(12).map((n) =>
    chip(
      n,
      () =>
        type === 'character'
          ? editor.setCharacterAndDialogue(n)
          : editor.insertCharacterWithDialogue(n),
      'chip-char'
    )
  );
}

// Top row: scene and formatting tools for the active element type.
function buildChips(type) {
  switch (type) {
    case 'scene':
      return [
        chip('INT.', () => scenePrefix('INT. ')),
        chip('EXT.', () => scenePrefix('EXT. ')),
        ...topItems('locations', 5).map((l) => chip(l, () => setLocation(l))),
        chip('- DAY', () => sceneSuffix(' - DAY')),
        chip('- NIGHT', () => sceneSuffix(' - NIGHT')),
        ...SCENE_NOTES.map((tag) => chip(tag, () => sceneNote(tag))),
      ];
    case 'character':
      return [
        chip('(V.O.)', () => setCue('(V.O.)')),
        chip('(O.S.)', () => setCue('(O.S.)')),
        chip('(CONT\'D)', () => setCue("(CONT'D)")),
        chip('Action', () => editor.setActiveType('action')),
      ];
    case 'dialogue':
      return [
        chip('( )', () => editor.newBlock('paren', '')),
        ...PAREN_PRESETS.map((p) => chip('(' + p + ')', () => editor.newBlock('paren', p))),
        ...transitionChips(2).map((t) => chip(t, () => editor.insertTransitionThenScene(t))),
      ];
    case 'transition':
      return transitionChips(6).map((t) =>
        chip(t, () => editor.updateActiveText(() => t))
      );
    case 'marker':
      return MARKERS.map((m) => chip(m, () => editor.updateActiveText(() => m)));
    default: // action, paren
      return [
        chip('INT.', () => editor.newBlock('scene', 'INT. ')),
        chip('EXT.', () => editor.newBlock('scene', 'EXT. ')),
        ...transitionChips(2).map((t) => chip(t, () => editor.insertTransitionThenScene(t))),
        ...MARKERS.map((m) => chip(m, () => editor.newBlock('marker', m))),
      ];
  }
}

/* ---------- autocomplete completion chip ---------- */

// Keyboard picks for characters (desktop):
//  - Option/Alt+1–9 acts like tapping that chip in the character row.
//  - On a character line, Enter accepts the suggested name and moves to
//    its dialogue (Final Draft's SmartType); Esc dismisses the suggestion.
//    A name that's already known as typed is kept, so ALICE never
//    swallows AL.
let dismissed = null; // text the writer dismissed a suggestion for

// Option+digit is caught at the document (capture phase), so it works
// wherever focus is — script line, chip, or nothing — except other text
// fields, where Option+digit should still type ¡ ™ £ and friends.
function onCharKey(e) {
  if (!e.altKey || e.metaKey || e.ctrlKey || !/^Digit[1-9]$/.test(e.code)) return;
  const t = e.target;
  if (t.closest && t.closest('input, textarea, [contenteditable]') && t.id !== 'blockInput') return;
  e.preventDefault(); // never type the Option-symbol into the script
  e.stopPropagation();
  const chip = charChipsEl.querySelectorAll('.chip-char')[Number(e.code.slice(5)) - 1];
  if (chip) chip._act();
}

function onKey(e) {
  if (editor.activeType() !== 'character') return false;
  const text = editor.activeText() || '';
  if (e.key === 'Escape' && document.querySelector('#quickbar .chip-suggest')) {
    dismissed = text;
    refreshCompletion();
    return true;
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    const c = currentCompletion();
    if (!c || isKnown('characters', characterStatName(text))) return false;
    const cue = (text.match(CUE_RE) || [''])[0];
    editor.setCharacterAndDialogue(c.full + cue);
    return true;
  }
  return false;
}

// The single leading chip that completes a learned name from the prefix
// the writer is typing (character names, or the location in a scene
// heading). Null when there is nothing to complete.
function currentCompletion() {
  const type = editor.activeType();
  const text = editor.activeText() || '';
  if (type === 'character') {
    if (text === dismissed) return null;
    const match = prefixMatch('characters', characterStatName(text), 1)[0];
    if (match) return { full: match, apply: () => editor.updateActiveText(() => match) };
  } else if (type === 'scene') {
    const partial = sceneLocation(text);
    const match = partial ? prefixMatch('locations', partial, 1)[0] : null;
    if (match) return { full: match, apply: () => setLocation(match) };
  }
  return null;
}

function refreshCompletion() {
  if (!chipsEl) return;
  const c = currentCompletion();
  // A name completion leads the character row; a location, the top row.
  const row = editor.activeType() === 'character' ? charChipsEl : chipsEl;
  let chip = document.querySelector('#quickbar .chip-suggest');
  if (chip && (!c || chip.parentElement !== row)) {
    chip.remove();
    chip = null;
  }
  if (!c) {
    syncFades(chipsEl);
    syncFades(charChipsEl);
    return;
  }
  if (!chip) {
    chip = document.createElement('button');
    chip.className = 'chip chip-suggest';
    row.insertBefore(chip, row.firstChild);
  }
  chip.textContent = c.full;
  chip.setAttribute('aria-label', 'Complete ' + c.full);
  chip._act = c.apply;
  syncFades(row);
}

export function refresh() {
  const type = editor.activeType();
  if (!type) return;
  cycleBtn.textContent = TYPE_LABELS[type];
  chipsEl.replaceChildren(...toButtons(buildChips(type)));
  const chars = toButtons(buildCharacterChips(type));
  if (chars.length) {
    chars.slice(0, 9).forEach((b, i) => {
      b.dataset.key = i + 1;
      b.title = `${b.textContent} (${/Mac/.test(navigator.platform) ? '⌥' : 'Alt+'}${i + 1})`;
    });
    charChipsEl.replaceChildren(...chars);
  } else {
    const empty = document.createElement('span');
    empty.className = 'qb-empty';
    empty.textContent = 'Characters you name will appear here';
    charChipsEl.replaceChildren(empty);
  }
  refreshCompletion();
  syncUndoRedo();
}
