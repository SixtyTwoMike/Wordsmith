// Export the current script. Fountain is a pure-JS, zero-dependency,
// fully-offline plain-text format (opens in Highland, Slugline, Final
// Draft, etc.). PDF/DOCX are added later as lazy-loaded options; the
// format list here is the single place they plug into.

import * as editor from './editor.js';

/* ---------- Fountain generation ---------- */

const up = (s) => (s || '').toUpperCase();
const stripParens = (s) => (s || '').replace(/^\(+/, '').replace(/\)+$/, '').trim();

// Action text can be ambiguous to a Fountain parser: an all-caps line
// reads as a CHARACTER cue, an INT./EXT. line as a scene heading, a
// "... TO:" line as a transition, and (only at the very top, with no
// title page) a "Key: value" line as title-page metadata. Force those
// with a leading "!" so they round-trip as action.
function actionNeedsForce(text, atDocStart) {
  const first = text.split('\n')[0];
  if (!first) return false;
  const hasLetter = /[A-Za-z]/.test(first);
  const allCaps = hasLetter && first === first.toUpperCase();
  const sceneish = /^(INT|EXT|EST|I\/E)[.\s]/i.test(first);
  const transitionish = /TO:\s*$/.test(first);
  const titleKeyish = atDocStart && /^[A-Za-z][^:]*:/.test(first);
  return allCaps || sceneish || transitionish || titleKeyish;
}

export function toFountain(script) {
  const els = script.elements || [];
  const title = (script.title || '').trim();
  const paras = [];

  const pushAction = (text) => {
    if (!text) return;
    // atDocStart matters only when there is no title page to terminate.
    const atDocStart = paras.length === 0 && !title;
    paras.push(actionNeedsForce(text, atDocStart) ? '!' + text : text);
  };

  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    const text = (el.text || '').trim();

    if (el.type === 'character') {
      // A character cue plus its attached parentheticals and dialogue form
      // one contiguous block (no blank lines inside). Empty inner elements
      // are skipped so they can't split the cue from its dialogue.
      const buf = text ? [up(text)] : [];
      let j = i + 1;
      while (j < els.length && (els[j].type === 'paren' || els[j].type === 'dialogue')) {
        const t = (els[j].text || '').trim();
        if (t) buf.push(els[j].type === 'paren' ? '(' + stripParens(t) + ')' : t);
        j++;
      }
      if (buf.length) paras.push(buf.join('\n'));
      i = j - 1;
    } else if (el.type === 'scene') {
      if (text) paras.push(up(text));
    } else if (el.type === 'transition') {
      if (text) paras.push('> ' + up(text)); // force, so "FADE OUT." isn't read as action
    } else if (el.type === 'paren') {
      if (text) pushAction('(' + stripParens(text) + ')'); // orphaned parenthetical
    } else {
      pushAction(text); // action or orphaned dialogue
    }
  }

  const body = paras.join('\n\n');
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
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '') || 'untitled';
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
