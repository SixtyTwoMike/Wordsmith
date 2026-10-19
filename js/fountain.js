// Fountain import: parse a .fountain (or plain-text) screenplay into
// Wordsmith's element model. Covers the parts of the spec that map onto
// our element types — title page, scene headings, action, character cues,
// parentheticals, dialogue, transitions and centered text (act markers).
// [[Notes]] become review comments on the element they sit in (or the one
// before, for a note on its own line). Boneyard, sections, synopses and
// page breaks have no equivalent and are dropped.

import { newElement } from './model.js';

const SCENE_RE = /^(INT\.?\/EXT|I\/E|INT|EXT|EST)[.\s]/i;
const SCENE_NUMBER_RE = /\s*#[\w.-]+#\s*$/;
// Title-page keys we keep, mapped to script.titlePage fields.
const TITLE_KEYS = {
  author: 'author',
  authors: 'author',
  credit: 'credit',
  source: 'source',
  'draft date': 'draftDate',
  contact: 'contact',
};

const isAllCaps = (s) => /[A-Z]/.test(s) && s === s.toUpperCase();

// Split the leading "Key: value" block (if any) off the body. Multi-line
// values are indented on the lines that follow their key.
function parseTitlePage(lines) {
  if (!/^[A-Za-z][A-Za-z ]*:/.test(lines[0] || '')) return { fields: null, rest: lines };
  const fields = {};
  let key = null;
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) break;
    const m = line.match(/^([A-Za-z][A-Za-z ]*):\s*(.*)$/);
    if (m && !/^\s/.test(line)) {
      key = m[1].trim().toLowerCase();
      fields[key] = m[2].trim();
    } else if (key) {
      fields[key] = (fields[key] ? fields[key] + '\n' : '') + line.trim();
    }
  }
  return { fields, rest: lines.slice(i) };
}

// Notes are swapped for private-use placeholder tokens (no letters, so
// they can't disturb all-caps cue detection) and collected separately.
const NOTE_RE = /(\d+)/g;

function stripMarkup(text, notes) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '') // boneyard
    .replace(/\[\[([\s\S]*?)\]\]/g, (_, body) => {
      notes.push(body.replace(/\s+/g, ' ').trim());
      return '' + (notes.length - 1) + '';
    });
}

// Returns { title, titlePage, elements, notes: [{ elId, text }] }.
export function parseFountain(source) {
  const noteTexts = [];
  const text = stripMarkup(
    String(source || '').replace(/\r\n?/g, '\n').replace(/^﻿/, ''),
    noteTexts
  );
  const notes = [];
  let pendingNotes = []; // notes seen before any element exists
  const { fields, rest } = parseTitlePage(text.split('\n'));

  let title = '';
  const titlePage = {};
  if (fields) {
    title = (fields.title || '').replace(/\n/g, ' ').replace(/[*_]/g, '').trim();
    for (const [k, v] of Object.entries(fields)) {
      if (TITLE_KEYS[k]) titlePage[TITLE_KEYS[k]] = v;
    }
  }

  // Group the body into paragraphs separated by blank lines.
  const paras = [];
  let cur = [];
  for (const raw of rest) {
    const line = raw.replace(/\s+$/, '');
    if (line.trim() === '' && !/^ {2}$/.test(raw)) {
      if (cur.length) paras.push(cur);
      cur = [];
    } else {
      cur.push(line);
    }
  }
  if (cur.length) paras.push(cur);

  const elements = [];
  const push = (type, t) => {
    const found = [...t.matchAll(NOTE_RE)].map((m) => noteTexts[Number(m[1])]).filter(Boolean);
    t = t.replace(/[ \t]*\d+/g, '').replace(/[ \t]+$/gm, '').trim();
    if (t) {
      const el = newElement(type, t);
      elements.push(el);
      for (const n of [...pendingNotes, ...found]) notes.push({ elId: el.id, text: n });
      pendingNotes = [];
    } else if (found.length) {
      // A note on its own line belongs to the element before it.
      const prev = elements[elements.length - 1];
      if (prev) for (const n of found) notes.push({ elId: prev.id, text: n });
      else pendingNotes.push(...found);
    }
  };

  for (const para of paras) {
    const first = para[0].trim();

    // Skip things with no Wordsmith equivalent.
    if (/^={3,}$/.test(first)) continue; // page break
    if (para.every((l) => /^\s*(#|=(?!=))/.test(l))) continue; // sections, synopses

    // Centered text "> ACT ONE <" becomes a marker.
    if (para.length === 1 && /^>.*<$/.test(first)) {
      push('marker', first.slice(1, -1));
      continue;
    }
    // Forced transition "> CUT TO:".
    if (para.length === 1 && first.startsWith('>')) {
      push('transition', first.slice(1));
      continue;
    }
    // Forced scene heading ".FLASHBACK" (but not "..." ellipses).
    if (para.length === 1 && /^\.[^.]/.test(first)) {
      push('scene', first.slice(1).replace(SCENE_NUMBER_RE, ''));
      continue;
    }
    if (para.length === 1 && SCENE_RE.test(first)) {
      push('scene', first.replace(SCENE_NUMBER_RE, ''));
      continue;
    }
    if (para.length === 1 && isAllCaps(first) && /TO:$/.test(first)) {
      push('transition', first);
      continue;
    }
    // Forced action.
    if (first.startsWith('!')) {
      push('action', [first.slice(1), ...para.slice(1)].join('\n'));
      continue;
    }

    // Character cue: forced "@Name", or an all-caps line with dialogue
    // beneath it. The dual-dialogue caret is dropped.
    const cue = first.replace(/\s*\^$/, '');
    const forcedCue = cue.startsWith('@');
    if (para.length > 1 && (forcedCue || (isAllCaps(cue.replace(/\(.*\)/g, '')) && !first.startsWith('~')))) {
      push('character', forcedCue ? cue.slice(1) : cue);
      let dialogue = [];
      const flush = () => {
        if (dialogue.length) push('dialogue', dialogue.join('\n'));
        dialogue = [];
      };
      for (const line of para.slice(1)) {
        const t = line.trim();
        if (/^\(.*\)$/.test(t)) {
          flush();
          push('paren', t.slice(1, -1));
        } else {
          dialogue.push(t);
        }
      }
      flush();
      continue;
    }

    push('action', para.map((l) => l.replace(/^~/, '')).join('\n'));
  }

  if (!elements.length) elements.push(newElement('scene', ''));
  return { title, titlePage, elements, notes };
}
