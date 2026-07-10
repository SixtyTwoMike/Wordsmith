// Scene navigator / outline: a tap-to-jump list of every scene heading,
// plus a page count and 1-page-per-minute runtime estimate. The only
// practical way to move around a long script by thumb.

import * as editor from './editor.js';
import { estimatePages, isActStart } from './model.js';

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
      <div id="actStructure"></div>
      <ol id="sceneList" class="scene-list"></ol>
    </div>`;
  sheet.querySelector('#closeOutline').addEventListener('click', close);
}

// Split the script into act-length segments at each COLD OPEN / ACT / TEASER
// marker, for the page-window check (NBC one-hour drama: acts ~9–12 pp).
function actSegments(els) {
  const starts = [];
  els.forEach((el, i) => {
    if (isActStart(el)) starts.push(i);
  });
  return starts.map((from, s) => {
    const to = s + 1 < starts.length ? starts[s + 1] : els.length;
    const label = (els[from].text || 'ACT').toUpperCase();
    return { label, pages: estimatePages(els.slice(from, to)) };
  });
}

function renderActs(els, pages) {
  const wrap = sheet.querySelector('#actStructure');
  const segs = actSegments(els);
  if (segs.length === 0) {
    wrap.replaceChildren();
    return;
  }
  const rows = segs.map((seg) => {
    const isAct = seg.label.startsWith('ACT');
    const warn = isAct && (seg.pages < 9 || seg.pages > 12);
    const li = document.createElement('li');
    li.className = 'act-row' + (warn ? ' warn' : '');
    li.textContent = `${seg.label} — ${seg.pages.toFixed(1)} pp` + (warn ? '  ⚠ off 9–12' : '');
    return li;
  });
  const total = document.createElement('li');
  const hourWarn = pages < 45 || pages > 63;
  total.className = 'act-row act-total' + (hourWarn ? ' warn' : '');
  total.textContent =
    `TOTAL — ${pages.toFixed(1)} pp` + (hourWarn ? '  ⚠ off 45–63 (hour drama)' : '');

  const h = document.createElement('h3');
  h.className = 'profile-sub';
  h.textContent = 'Act structure';
  const ul = document.createElement('ul');
  ul.className = 'act-list';
  ul.replaceChildren(...rows, total);
  wrap.replaceChildren(h, ul);
}

function render() {
  const els = editor.getScript().elements;
  const pages = estimatePages(els);
  const scenes = [];
  els.forEach((el, i) => {
    if (el.type === 'scene') scenes.push({ i, text: el.text });
  });

  const runtime = pages < 1 ? '<1' : pages.toFixed(1);
  sheet.querySelector('#outlineStats').textContent =
    `${scenes.length} scene${scenes.length === 1 ? '' : 's'} · ` +
    `${Math.max(1, Math.ceil(pages))} pp · ~${runtime} min`;

  renderActs(els, pages);

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
