// Screenplay element model: types, keyboard transition tables, text helpers.

export const TYPES = ['scene', 'action', 'character', 'paren', 'dialogue', 'transition'];

export const TYPE_LABELS = {
  scene: 'Scene',
  action: 'Action',
  character: 'Character',
  paren: '(Paren)',
  dialogue: 'Dialogue',
  transition: 'Trans.',
};

export const PLACEHOLDERS = {
  scene: 'INT. LOCATION - DAY',
  action: 'What happens...',
  character: 'CHARACTER',
  paren: 'beat',
  dialogue: 'Dialogue',
  transition: 'CUT TO:',
};

// Enter on a non-empty block: type of the block inserted after it.
export const ENTER_NEXT = {
  scene: 'action',
  action: 'action',
  character: 'dialogue',
  paren: 'dialogue',
  dialogue: 'action',
  transition: 'scene',
};

// Enter on an empty block: convert it instead of inserting (double-Enter escape).
export const EMPTY_ENTER_CYCLE = {
  scene: 'action',
  action: 'action',
  character: 'action',
  paren: 'dialogue',
  dialogue: 'character',
  transition: 'action',
};

// Tab / type-cycle chip: change the current block's type.
export const TAB_CYCLE = {
  scene: 'action',
  action: 'character',
  character: 'transition',
  transition: 'scene',
  dialogue: 'paren',
  paren: 'dialogue',
};

export const UPPERCASE_TYPES = new Set(['scene', 'character', 'transition']);

const SCENE_PREFIX_RE = /^(INT\.?\/EXT|I\/E|INT|EXT|EST)[.\s]/i;
const TRANSITION_RE = /^(FADE (IN|OUT|TO)|CUT TO|SMASH CUT|DISSOLVE TO|MATCH CUT)/i;

let counter = 0;

export function uid() {
  return Date.now().toString(36) + '-' + (counter++).toString(36);
}

export function newElement(type = 'action', text = '') {
  return { id: uid(), type, text };
}

export function createScript(title = '') {
  const now = Date.now();
  return { id: uid(), title, elements: [newElement('scene', '')], createdAt: now, updatedAt: now };
}

// Promote an action block based on what the user is typing.
export function detectType(type, text) {
  if (type === 'action') {
    if (SCENE_PREFIX_RE.test(text)) return 'scene';
    if (TRANSITION_RE.test(text)) return 'transition';
  }
  return type;
}

export function normalizeOnCommit(type, text) {
  let t = text.trim();
  if (UPPERCASE_TYPES.has(type)) t = t.toUpperCase();
  return t;
}

// "SARAH (V.O.)" -> "SARAH" for usage stats.
export function characterStatName(text) {
  return text.replace(/\s*\(.*\)\s*$/, '').trim().toUpperCase();
}

// Rough page estimate (~55 lines per US Letter screenplay page). Each
// element type wraps at a different width and most carry a blank lead
// line, mirroring standard margins. Good enough for a live "N pp" gauge
// and the 1 page ≈ 1 minute runtime rule of thumb.
const LINE_WIDTH = { scene: 60, action: 60, character: 38, paren: 25, dialogue: 35, transition: 60 };
const LEAD_LINES = { scene: 1, action: 1, character: 1, paren: 0, dialogue: 0, transition: 1 };
const LINES_PER_PAGE = 55;

export function estimatePages(elements) {
  let lines = 0;
  for (const el of elements) {
    const width = LINE_WIDTH[el.type] || 60;
    const text = (el.text || '').trim();
    const wrapped = text ? Math.ceil(text.length / width) : 1;
    lines += wrapped + (LEAD_LINES[el.type] || 0);
  }
  return lines / LINES_PER_PAGE;
}

// "INT. DINER - NIGHT" -> "DINER" for usage stats.
export function sceneLocation(text) {
  let t = text.trim().toUpperCase();
  t = t.replace(/^(INT\.?\/EXT|I\/E|INT|EXT|EST)[.\s]+/i, '');
  const dash = t.lastIndexOf(' - ');
  if (dash > 0) t = t.slice(0, dash);
  return t.trim();
}
