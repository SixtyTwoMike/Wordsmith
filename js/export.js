// Export the current script. Fountain is a pure-JS, zero-dependency,
// fully-offline plain-text format (opens in Highland, Slugline, Final
// Draft, etc.). PDF/DOCX are added later as lazy-loaded options; the
// format list here is the single place they plug into.

import * as editor from './editor.js';

/* ---------- Fountain generation ---------- */

const up = (s) => (s || '').toUpperCase();
const stripParens = (s) => (s || '').replace(/^\(+/, '').replace(/\)+$/, '').trim();

export function toFountain(script) {
  const els = script.elements || [];
  const paras = [];

  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    const text = (el.text || '').trim();

    if (el.type === 'character') {
      // A character cue plus its attached parentheticals and dialogue form
      // one contiguous block (no blank lines inside).
      const buf = [up(text)];
      let j = i + 1;
      while (j < els.length && (els[j].type === 'paren' || els[j].type === 'dialogue')) {
        const t = (els[j].text || '').trim();
        buf.push(els[j].type === 'paren' ? '(' + stripParens(t) + ')' : t);
        j++;
      }
      paras.push(buf.join('\n'));
      i = j - 1;
    } else if (el.type === 'scene') {
      paras.push(up(text));
    } else if (el.type === 'transition') {
      paras.push('> ' + up(text)); // force, so "FADE OUT." isn't read as action
    } else if (el.type === 'paren') {
      paras.push('(' + stripParens(text) + ')'); // orphaned parenthetical
    } else {
      paras.push(text); // action or orphaned dialogue
    }
  }

  const body = paras.filter((p) => p !== '').join('\n\n');
  const title = (script.title || '').trim();
  const header = title ? 'Title: ' + title + '\n\n' : '';
  return header + body + '\n';
}

/* ---------- download plumbing ---------- */

export function safeName(title, ext) {
  const base =
    (title || 'untitled')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled';
  return base + '.' + ext;
}

function download(filename, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportFountain() {
  const script = editor.getScript();
  download(safeName(script.title, 'fountain'), toFountain(script), 'text/plain;charset=utf-8');
}

const FORMATS = {
  fountain: exportFountain,
};

/* ---------- UI ---------- */

let sheet;

export function init() {
  sheet = document.getElementById('exportSheet');
  build();
}

function build() {
  sheet.innerHTML = `
    <div class="sheet-head">
      <h2>Export</h2>
      <button id="closeExport" class="btn-done">Done</button>
    </div>
    <div class="sheet-body">
      <p class="hint">Export “<span id="exportName"></span>” to another app.</p>
      <div id="exportFormats" class="export-formats">
        <button class="export-fmt" data-fmt="fountain">
          <b>Fountain</b>
          <span>Plain-text screenplay (.fountain) — opens in Highland, Slugline, Final Draft and more. Works offline.</span>
        </button>
      </div>
    </div>`;
  sheet.querySelector('#closeExport').addEventListener('click', close);
  sheet.querySelector('#exportFormats').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-fmt]');
    if (!btn || btn.disabled) return;
    const fmt = FORMATS[btn.dataset.fmt];
    if (fmt) fmt();
  });
}

export function open() {
  editor.commitActive();
  sheet.querySelector('#exportName').textContent = editor.getScript().title || 'Untitled Script';
  sheet.hidden = false;
}

function close() {
  sheet.hidden = true;
}
