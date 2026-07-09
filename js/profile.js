// Personae Dramatis: long-press a character chip to open this profile.
// Shows every appearance (jump straight to it), a live line count, and
// editable notes — full name, aliases, relationships, motives.

import * as editor from './editor.js';
import { characterStatName } from './model.js';
import { profileFor, updateProfileField } from './characters.js';

const FIELDS = [
  ['fullName', 'Full name', 'input', 'e.g. Elizabeth Keen'],
  ['aliases', 'Also known as', 'input', 'LIZ, KEEN'],
  ['description', 'Description', 'input', 'FBI profiler, 30s'],
  ['relationships', 'Relationships', 'textarea', 'REDDINGTON — mentor\nTOM — husband'],
  ['motives', 'Motives', 'textarea', 'What drives them…'],
  ['notes', 'Notes', 'textarea', 'Voice, tics, backstory…'],
];

let sheet;
let currentName = null;

export function init() {
  sheet = document.getElementById('profileSheet');
}

// Scan the current script for this character's cues, attaching the first
// dialogue line and the scene they sit in for context.
function buildIndex(name) {
  const els = editor.getScript().elements;
  const appearances = [];
  let lineCount = 0;
  let currentScene = '';
  els.forEach((el, i) => {
    if (el.type === 'scene') currentScene = el.text || '';
    if (el.type === 'character' && characterStatName(el.text) === name) {
      let firstLine = '';
      for (let j = i + 1; j < els.length && (els[j].type === 'dialogue' || els[j].type === 'paren'); j++) {
        if (els[j].type === 'dialogue') {
          lineCount++;
          if (!firstLine) firstLine = els[j].text || '';
        }
      }
      appearances.push({ index: i, scene: currentScene, preview: firstLine });
    }
  });
  return { appearances, lineCount };
}

export function open(name) {
  currentName = characterStatName(name);
  render();
  sheet.hidden = false;
}

function close() {
  sheet.hidden = true;
}

function render() {
  const { appearances, lineCount } = buildIndex(currentName);
  const profile = profileFor(currentName);

  const head = document.createElement('div');
  head.className = 'sheet-head';
  head.innerHTML = `<h2 class="profile-name"></h2><button id="closeProfile" class="btn-done">Done</button>`;
  head.querySelector('.profile-name').textContent = currentName;
  head.querySelector('#closeProfile').addEventListener('click', close);

  const body = document.createElement('div');
  body.className = 'sheet-body';

  const stats = document.createElement('p');
  stats.className = 'profile-stats';
  stats.textContent =
    `${lineCount} line${lineCount === 1 ? '' : 's'} · ` +
    `${appearances.length} appearance${appearances.length === 1 ? '' : 's'}`;
  body.appendChild(stats);

  // Editable metadata — each field autosaves as you type.
  for (const [key, label, kind, placeholder] of FIELDS) {
    const wrap = document.createElement('label');
    wrap.className = 'profile-field';
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement(kind);
    if (kind === 'input') input.type = 'text';
    input.value = profile[key] || '';
    input.placeholder = placeholder;
    input.addEventListener('input', () => updateProfileField(currentName, key, input.value));
    wrap.appendChild(span);
    wrap.appendChild(input);
    body.appendChild(wrap);
  }

  const h3 = document.createElement('h3');
  h3.className = 'profile-sub';
  h3.textContent = 'Appearances';
  body.appendChild(h3);

  const list = document.createElement('ol');
  list.className = 'appearance-list';
  if (appearances.length === 0) {
    const li = document.createElement('li');
    li.className = 'scene-empty';
    li.textContent = 'No lines in this script yet.';
    list.appendChild(li);
  } else {
    for (const a of appearances) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'appearance-jump';
      const scene = document.createElement('span');
      scene.className = 'appearance-scene';
      scene.textContent = a.scene || '(no scene)';
      const line = document.createElement('span');
      line.className = 'appearance-line';
      line.textContent = a.preview || '—';
      btn.appendChild(scene);
      btn.appendChild(line);
      btn.addEventListener('click', () => {
        editor.activate(a.index);
        close();
      });
      li.appendChild(btn);
      list.appendChild(li);
    }
  }
  body.appendChild(list);

  sheet.replaceChildren(head, body);
}
