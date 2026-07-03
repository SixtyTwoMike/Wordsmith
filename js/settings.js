// Settings sheet: choose between learned suggestions and a manual set
// list, and edit the manual lists (add / remove / reorder).

import { getSettings, saveSettings, learnedTop, DEFAULT_TRANSITIONS } from './suggest.js';

const CATEGORIES = [
  ['characters', 'Characters'],
  ['locations', 'Locations'],
  ['transitions', 'Transitions'],
];

let sheet;
let onChange;

export function init(onChangeCb) {
  onChange = onChangeCb;
  sheet = document.getElementById('settingsSheet');
  build();
  document.getElementById('openSettings').addEventListener('click', open);
}

function open() {
  renderMode();
  renderLists();
  sheet.hidden = false;
}

function close() {
  sheet.hidden = true;
  onChange();
}

function build() {
  sheet.innerHTML = `
    <div class="sheet-head">
      <h2>Quick Bar</h2>
      <button id="closeSettings" class="btn-done">Done</button>
    </div>
    <div class="sheet-body">
      <p class="hint">Suggestion chips can follow your recent usage, or stick to a set list you control.</p>
      <div class="seg" id="modeSeg">
        <button data-mode="learned">Learned from usage</button>
        <button data-mode="manual">My set list</button>
      </div>
      <div id="manualLists"></div>
    </div>`;

  sheet.querySelector('#closeSettings').addEventListener('click', close);

  sheet.querySelector('#modeSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    const settings = getSettings();
    settings.chipMode = btn.dataset.mode;
    if (settings.chipMode === 'manual') prefillIfEmpty(settings);
    saveSettings();
    renderMode();
    renderLists();
  });
}

// First switch to manual: seed the lists from what's been learned so the
// user edits a sensible starting point instead of empty lists.
function prefillIfEmpty(settings) {
  const m = settings.manualChips;
  if (m.characters.length || m.locations.length || m.transitions.length) return;
  m.characters = learnedTop('characters', 8);
  m.locations = learnedTop('locations', 8);
  m.transitions = learnedTop('transitions', 8);
  for (const d of DEFAULT_TRANSITIONS) {
    if (m.transitions.length >= 8) break;
    if (!m.transitions.includes(d)) m.transitions.push(d);
  }
}

function renderMode() {
  const mode = getSettings().chipMode;
  for (const btn of sheet.querySelectorAll('#modeSeg button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
  }
  sheet.querySelector('#manualLists').style.display = mode === 'manual' ? '' : 'none';
}

function renderLists() {
  const settings = getSettings();
  const wrap = sheet.querySelector('#manualLists');
  wrap.replaceChildren(
    ...CATEGORIES.map(([cat, label]) => {
      const section = document.createElement('section');
      section.dataset.cat = cat;
      const items = settings.manualChips[cat];

      const h = document.createElement('h3');
      h.textContent = label;
      section.appendChild(h);

      const ul = document.createElement('ul');
      items.forEach((name, i) => {
        const li = document.createElement('li');
        const span = document.createElement('span');
        span.textContent = name;
        li.appendChild(span);
        li.appendChild(listBtn('↑', `Move up ${name}`, () => move(cat, i, -1)));
        li.appendChild(listBtn('↓', `Move down ${name}`, () => move(cat, i, 1)));
        li.appendChild(listBtn('✕', `Remove ${name}`, () => removeAt(cat, i)));
        ul.appendChild(li);
      });
      section.appendChild(ul);

      const form = document.createElement('form');
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = `Add ${label.toLowerCase().replace(/s$/, '')}`;
      input.autocapitalize = 'characters';
      const add = document.createElement('button');
      add.type = 'submit';
      add.textContent = 'Add';
      form.appendChild(input);
      form.appendChild(add);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = input.value.trim().toUpperCase();
        if (name && !getSettings().manualChips[cat].includes(name)) {
          getSettings().manualChips[cat].push(name);
          saveSettings();
          renderLists();
        }
        input.value = '';
      });
      section.appendChild(form);
      return section;
    })
  );
}

function listBtn(text, label, act) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', act);
  return b;
}

function move(cat, i, delta) {
  const list = getSettings().manualChips[cat];
  const j = i + delta;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  saveSettings();
  renderLists();
}

function removeAt(cat, i) {
  getSettings().manualChips[cat].splice(i, 1);
  saveSettings();
  renderLists();
}
