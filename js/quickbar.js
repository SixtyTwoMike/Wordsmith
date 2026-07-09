// Thumb-reach quick bar: context-sensitive chips that insert formatted
// screenplay elements in one tap. Chips act on pointerup (so the chip row
// can still be swipe-scrolled) and cancel pointerdown so the editor
// textarea never loses focus — the iOS keyboard stays up.

import * as editor from './editor.js';
import * as profile from './profile.js';
import { TYPE_LABELS, characterStatName, sceneLocation } from './model.js';
import { topItems, DEFAULT_TRANSITIONS, getSettings, prefixMatch } from './suggest.js';

let chipsEl;
let cycleBtn;
let undoBtn;
let redoBtn;

export function init() {
  chipsEl = document.getElementById('chips');
  cycleBtn = document.getElementById('cycleType');
  undoBtn = document.getElementById('undoBtn');
  redoBtn = document.getElementById('redoBtn');
  wireTaps(
    chipsEl,
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
  editor.onActiveChange(refresh);
  // Update the inline completion chip and undo/redo enabled state on every edit.
  editor.onUpdate(() => {
    refreshCompletion();
    syncUndoRedo();
  });
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
        ...characterChips().map((n) =>
          chip(n, () => editor.setCharacterAndDialogue(n), 'chip-char')
        ),
      ];
    case 'dialogue':
      return [
        chip('( )', () => editor.newBlock('paren', '')),
        ...PAREN_PRESETS.map((p) => chip('(' + p + ')', () => editor.newBlock('paren', p))),
        ...characterChips(4).map((n) =>
          chip(n, () => editor.insertCharacterWithDialogue(n), 'chip-char')
        ),
        ...transitionChips(2).map((t) => chip(t, () => editor.insertTransitionThenScene(t))),
      ];
    case 'transition':
      return transitionChips(6).map((t) =>
        chip(t, () => editor.updateActiveText(() => t))
      );
    default: // action, paren
      return [
        ...characterChips(6).map((n) =>
          chip(n, () => editor.insertCharacterWithDialogue(n), 'chip-char')
        ),
        chip('INT.', () => editor.newBlock('scene', 'INT. ')),
        chip('EXT.', () => editor.newBlock('scene', 'EXT. ')),
        ...transitionChips(2).map((t) => chip(t, () => editor.insertTransitionThenScene(t))),
      ];
  }
}

/* ---------- autocomplete completion chip ---------- */

// The single leading chip that completes a learned name from the prefix
// the writer is typing (character names, or the location in a scene
// heading). Null when there is nothing to complete.
function currentCompletion() {
  const type = editor.activeType();
  const text = editor.activeText() || '';
  if (type === 'character') {
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
  let chip = chipsEl.querySelector('.chip-suggest');
  if (!c) {
    if (chip) chip.remove();
    return;
  }
  if (!chip) {
    chip = document.createElement('button');
    chip.className = 'chip chip-suggest';
    chipsEl.insertBefore(chip, chipsEl.firstChild);
  }
  chip.textContent = c.full;
  chip.setAttribute('aria-label', 'Complete ' + c.full);
  chip._act = c.apply;
}

export function refresh() {
  const type = editor.activeType();
  if (!type) return;
  cycleBtn.textContent = TYPE_LABELS[type];
  const buttons = buildChips(type).map(({ label, act, cls }) => {
    const b = document.createElement('button');
    b.className = 'chip' + (cls ? ' ' + cls : '');
    b.textContent = label;
    b.setAttribute('aria-label', label);
    b._act = act;
    return b;
  });
  chipsEl.replaceChildren(...buttons);
  refreshCompletion();
  syncUndoRedo();
}
