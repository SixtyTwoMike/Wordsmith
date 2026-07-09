// Scene navigator / outline: a tap-to-jump list of every scene heading,
// plus a page count and 1-page-per-minute runtime estimate. The only
// practical way to move around a long script by thumb.

import * as editor from './editor.js';
import { estimatePages } from './model.js';

let sheet;

export function init() {
  sheet = document.getElementById('outlineSheet');
  build();
  document.getElementById('openOutline').addEventListener('click', open);
}

function open() {
  render();
  sheet.hidden = false;
}

function close() {
  sheet.hidden = true;
}

function build() {
  sheet.innerHTML = `
    <div class="sheet-head">
      <h2>Outline</h2>
      <button id="closeOutline" class="btn-done">Done</button>
    </div>
    <div class="sheet-body">
      <p id="outlineStats" class="outline-stats"></p>
      <ol id="sceneList" class="scene-list"></ol>
    </div>`;
  sheet.querySelector('#closeOutline').addEventListener('click', close);
}

function render() {
  const els = editor.getScript().elements;
  const pages = estimatePages(els);
  const scenes = [];
  els.forEach((el, i) => {
    if (el.type === 'scene') scenes.push({ i, text: el.text });
  });

  sheet.querySelector('#outlineStats').textContent =
    `${scenes.length} scene${scenes.length === 1 ? '' : 's'} · ` +
    `${Math.max(1, Math.ceil(pages))} pp · ~${pages.toFixed(1)} min`;

  const listEl = sheet.querySelector('#sceneList');
  if (scenes.length === 0) {
    const li = document.createElement('li');
    li.className = 'scene-empty';
    li.textContent = 'No scene headings yet.';
    listEl.replaceChildren(li);
    return;
  }
  listEl.replaceChildren(
    ...scenes.map((s) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'scene-jump';
      btn.textContent = s.text || '(untitled scene)';
      btn.addEventListener('click', () => {
        editor.activate(s.i);
        close();
      });
      li.appendChild(btn);
      return li;
    })
  );
}
