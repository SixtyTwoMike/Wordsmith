// Thumb-reach quick bar: context-sensitive chips that insert formatted
// screenplay elements in one tap. Chips act on pointerup (so the chip row
// can still be swipe-scrolled) and cancel pointerdown so the editor
// textarea never loses focus — the iOS keyboard stays up.

import * as editor from './editor.js';
import { TYPE_LABELS } from './model.js';
import { topItems, DEFAULT_TRANSITIONS, getSettings } from './suggest.js';

let chipsEl;
let cycleBtn;

export function init() {
  chipsEl = document.getElementById('chips');
  cycleBtn = document.getElementById('cycleType');
  wireTaps(chipsEl, (chip) => chip._act && chip._act());
  wireTaps(cycleBtn.parentElement, (chip) => {
    if (chip === cycleBtn) editor.cycleType();
    // the settings button keeps its normal click handler (keyboard may drop)
  });
  editor.onActiveChange(refresh);
}

function wireTaps(container, act) {
  let downChip = null;
  let downX = 0;
  let downY = 0;
  container.addEventListener('pointerdown', (e) => {
    const chip = e.target.closest('button.chip');
    if (!chip || chip.id === 'openSettings') return;
    e.preventDefault();
    downChip = chip;
    downX = e.clientX;
    downY = e.clientY;
  });
  container.addEventListener('pointerup', (e) => {
    const chip = e.target.closest('button.chip');
    if (chip && chip === downChip && Math.hypot(e.clientX - downX, e.clientY - downY) < 10) {
      act(chip);
    }
    downChip = null;
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

function chip(label, act, cls = '') {
  return { label, act, cls };
}

function buildChips(type) {
  switch (type) {
    case 'scene':
      return [
        chip('INT.', () => scenePrefix('INT. ')),
        chip('EXT.', () => scenePrefix('EXT. ')),
        ...topItems('locations', 6).map((l) => chip(l, () => setLocation(l))),
        chip('- DAY', () => sceneSuffix(' - DAY')),
        chip('- NIGHT', () => sceneSuffix(' - NIGHT')),
      ];
    case 'character':
      return characterChips().map((n) =>
        chip(n, () => editor.setCharacterAndDialogue(n), 'chip-char')
      );
    case 'dialogue':
      return [
        chip('( )', () => editor.newBlock('paren', '')),
        ...characterChips(6).map((n) =>
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
}
