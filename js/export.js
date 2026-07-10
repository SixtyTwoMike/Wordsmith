// Export the current script. Fountain is a pure-JS, zero-dependency,
// fully-offline plain-text format (opens in Highland, Slugline, Final
// Draft, etc.). PDF/DOCX are added later as lazy-loaded options; the
// format list here is the single place they plug into.

import * as editor from './editor.js';
import { zipStore } from './zip.js';

/* ---------- Fountain generation ---------- */

const up = (s) => (s || '').toUpperCase();
const stripParens = (s) => (s || '').replace(/^\(+/, '').replace(/\)+$/, '').trim();
const escHtml = (s) =>
  (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escXml = (s) =>
  (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

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
    } else if (el.type === 'marker') {
      if (text) paras.push('> ' + up(text) + ' <'); // Fountain centered text
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

/* ---------- shared display text ---------- */

// The on-page text for an element (caps + parenthesization), matching the
// editor's display() so PDF/DOCX read like the screen.
function displayText(el) {
  const t = (el.text || '').trim();
  if (el.type === 'paren') return t ? '(' + stripParens(t) + ')' : '';
  if (['scene', 'character', 'transition', 'marker'].includes(el.type)) return up(t);
  return t;
}

/* ---------- PDF via native print ---------- */

// A standalone, print-optimized HTML document. The browser's own
// print-to-PDF gives real page breaks with zero dependencies and works
// offline. On iPhone: Share → Print → Save to Files (or pinch the preview).
export function toPrintHTML(script) {
  const title = (script.title || 'Untitled Script').trim();
  const rows = (script.elements || [])
    .map((el) => {
      const text = displayText(el);
      return text ? `<p class="el ${el.type}">${escHtml(text)}</p>` : '';
    })
    .filter(Boolean)
    .join('\n');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>
  @page { size: letter; margin: 1in; }
  * { box-sizing: border-box; }
  body { font-family: 'Courier New', Courier, monospace; font-size: 12pt; line-height: 1; color: #000; margin: 0; }
  .title-page { text-align: center; page-break-after: always; padding-top: 3.5in; }
  .title-page h1 { font-size: 12pt; font-weight: bold; text-transform: uppercase; margin: 0; }
  .el { margin: 0 0 12pt; white-space: pre-wrap; }
  .scene { font-weight: bold; text-transform: uppercase; }
  .character { text-transform: uppercase; margin-left: 3.7in; margin-bottom: 0; }
  .paren { margin-left: 3.1in; margin-bottom: 0; }
  .dialogue { margin-left: 2.5in; margin-right: 1.5in; }
  .transition { text-transform: uppercase; text-align: right; }
  .marker { text-transform: uppercase; text-align: center; font-weight: bold; text-decoration: underline; }
  @media screen { body { background: #fff; padding: 1in; max-width: 8.5in; margin: 0 auto; } }
</style></head><body>
<section class="title-page"><h1>${escHtml(title)}</h1></section>
${rows}
</body></html>`;
}

function exportPDF() {
  const html = toPrintHTML(editor.getScript());
  const prev = document.getElementById('wsPrintFrame');
  if (prev) prev.remove();
  const iframe = document.createElement('iframe');
  iframe.id = 'wsPrintFrame';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  iframe.addEventListener('load', () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      iframe.contentWindow.addEventListener('afterprint', () => iframe.remove());
    } catch (e) {
      /* headless / no print support: leave the frame in place */
    }
    setTimeout(() => iframe.remove(), 60000);
  });
  iframe.srcdoc = html;
}

/* ---------- DOCX (pure-JS WordprocessingML in a ZIP) ---------- */

const TWIP = { characterLeft: 2160, parenLeft: 1440, dialogueLeft: 1008, dialogueRight: 1008 };

function docxParagraph(el) {
  const text = displayText(el);
  if (!text) return '';
  let ind = '';
  if (el.type === 'character') ind = `<w:ind w:left="${TWIP.characterLeft}"/>`;
  else if (el.type === 'paren') ind = `<w:ind w:left="${TWIP.parenLeft}"/>`;
  else if (el.type === 'dialogue')
    ind = `<w:ind w:left="${TWIP.dialogueLeft}" w:right="${TWIP.dialogueRight}"/>`;
  else if (el.type === 'transition') ind = `<w:jc w:val="right"/>`;
  else if (el.type === 'marker') ind = `<w:jc w:val="center"/>`;
  const bold = el.type === 'scene' || el.type === 'marker' ? '<w:b/>' : '';
  const underline = el.type === 'marker' ? '<w:u w:val="single"/>' : '';
  const rPr = `<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="24"/>${bold}${underline}</w:rPr>`;
  return `<w:p>${ind ? `<w:pPr>${ind}</w:pPr>` : ''}<w:r>${rPr}<w:t xml:space="preserve">${escXml(text)}</w:t></w:r></w:p>`;
}

export function toDocxBlob(script) {
  const title = (script.title || '').trim();
  const paras = [];
  if (title) {
    paras.push(
      `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="24"/><w:b/></w:rPr><w:t xml:space="preserve">${escXml(up(title))}</w:t></w:r></w:p>`
    );
  }
  for (const el of script.elements || []) {
    const p = docxParagraph(el);
    if (p) paras.push(p);
  }
  const sectPr =
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    paras.join('') +
    sectPr +
    '</w:body></w:document>';

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  return zipStore(
    [
      { name: '[Content_Types].xml', text: contentTypes },
      { name: '_rels/.rels', text: rels },
      { name: 'word/document.xml', text: documentXml },
    ],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
}

function exportDocx() {
  const script = editor.getScript();
  download(safeName(script.title, 'docx'), toDocxBlob(script));
}

const FORMATS = {
  fountain: exportFountain,
  pdf: exportPDF,
  docx: exportDocx,
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
        <button class="export-fmt" data-fmt="pdf">
          <b>PDF</b>
          <span>Print-formatted pages via your browser. On iPhone: Print → pinch out → Share to Files.</span>
        </button>
        <button class="export-fmt" data-fmt="docx">
          <b>Word (.docx)</b>
          <span>Styled Word document for collaborators. Opens in Word, Pages and Google Docs.</span>
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
