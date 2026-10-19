// Export the current script. Fountain is a pure-JS, zero-dependency,
// fully-offline plain-text format (opens in Highland, Slugline, Final
// Draft, etc.). PDF/DOCX are added later as lazy-loaded options; the
// format list here is the single place they plug into.

import * as editor from './editor.js';
import { zipStore } from './zip.js';
import { toPdfBlob } from './pdf.js';

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

/* ---------- title page ---------- */

// Optional title-page fields stored on the script (script.titlePage).
export const TITLE_FIELDS = [
  { key: 'author', label: 'Written by', placeholder: 'Your name' },
  { key: 'source', label: 'Based on', placeholder: 'Optional — e.g. the novel by…' },
  { key: 'draftDate', label: 'Draft date', placeholder: 'e.g. First Draft, Oct 2026' },
  { key: 'contact', label: 'Contact', placeholder: 'Email, phone, agent…', multiline: true },
];

function titlePageOf(script) {
  const tp = script.titlePage || {};
  const out = {};
  for (const { key } of TITLE_FIELDS) out[key] = (tp[key] || '').trim();
  out.credit = (tp.credit || '').trim() || (out.author ? 'Written by' : '');
  return out;
}

function hasTitlePage(script) {
  const tp = titlePageOf(script);
  return TITLE_FIELDS.some(({ key }) => tp[key]);
}

function fountainField(key, value) {
  if (!value) return '';
  const lines = value.split('\n');
  if (lines.length === 1) return `${key}: ${value}\n`;
  return `${key}:\n` + lines.map((l) => '    ' + l).join('\n') + '\n';
}

export function toFountain(script) {
  const els = script.elements || [];
  const title = (script.title || '').trim();
  const paras = [];

  const pushAction = (text) => {
    if (!text) return;
    // atDocStart matters only when there is no title page to terminate.
    const atDocStart = paras.length === 0 && !title && !hasTitlePage(script);
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
  const tp = titlePageOf(script);
  const fields =
    fountainField('Title', title) +
    fountainField('Credit', tp.credit) +
    fountainField('Author', tp.author) +
    fountainField('Source', tp.source) +
    fountainField('Draft date', tp.draftDate) +
    fountainField('Contact', tp.contact);
  const header = fields ? fields + '\n' : '';
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

export function download(filename, data, mime) {
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

// Hand a finished file to the user. On a phone, the share sheet (Save to
// Files, Mail, AirDrop…) is more dependable than a download, especially
// from a Home Screen web app; elsewhere, download it.
export function deliver(filename, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const file = typeof File === 'function' ? new File([blob], filename, { type: blob.type }) : null;
  if (touch && file && navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file] }).catch((e) => {
      if (e.name !== 'AbortError') download(filename, blob);
    });
    return;
  }
  download(filename, blob);
}

function exportFountain() {
  const script = editor.getScript();
  deliver(safeName(script.title, 'fountain'), toFountain(script), 'text/plain;charset=utf-8');
}

function exportPdfFile() {
  const script = editor.getScript();
  deliver(safeName(script.title, 'pdf'), toPdfBlob(script));
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
  .title-page { position: relative; height: 9in; text-align: center; page-break-after: always; padding-top: 3in; }
  .title-page h1 { font-size: 12pt; font-weight: bold; text-transform: uppercase; text-decoration: underline; margin: 0 0 24pt; }
  .title-page p { margin: 0 0 12pt; white-space: pre-wrap; }
  .title-page .tp-contact { position: absolute; left: 0; bottom: 0; text-align: left; margin: 0; }
  .title-page .tp-draft { position: absolute; right: 0; bottom: 0; text-align: right; margin: 0; }
  .el { margin: 0 0 12pt; white-space: pre-wrap; }
  .scene { font-weight: bold; text-transform: uppercase; }
  .character { text-transform: uppercase; margin-left: 3.7in; margin-bottom: 0; }
  .paren { margin-left: 3.1in; margin-bottom: 0; }
  .dialogue { margin-left: 2.5in; margin-right: 1.5in; }
  .transition { text-transform: uppercase; text-align: right; }
  .marker { text-transform: uppercase; text-align: center; font-weight: bold; text-decoration: underline; }
  @media screen { body { background: #fff; padding: 1in; max-width: 8.5in; margin: 0 auto; } }
</style></head><body>
<section class="title-page"><h1>${escHtml(title)}</h1>${titlePageHTML(script)}</section>
${rows}
</body></html>`;
}

function titlePageHTML(script) {
  const tp = titlePageOf(script);
  const p = (cls, text) => (text ? `<p class="${cls}">${escHtml(text)}</p>` : '');
  return (
    p('tp-credit', tp.credit) +
    p('tp-author', tp.author) +
    p('tp-source', tp.source) +
    p('tp-contact', tp.contact) +
    p('tp-draft', tp.draftDate)
  );
}

function exportPrint() {
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
  const tp = titlePageOf(script);
  if (title || hasTitlePage(script)) {
    // Title page: title a third of the way down, credits beneath, contact
    // and draft date after, then a page break before the script.
    const run = (text, extra = '') => {
      const lines = text
        .split('\n')
        .map((line, i) => (i ? '<w:br/>' : '') + `<w:t xml:space="preserve">${escXml(line)}</w:t>`)
        .join('');
      return `<w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="24"/>${extra}</w:rPr>${lines}</w:r>`;
    };
    const para = (text, { jc = 'center', before = 0, extra = '' } = {}) =>
      text
        ? `<w:p><w:pPr><w:jc w:val="${jc}"/><w:spacing w:before="${before}" w:after="240"/></w:pPr>${run(text, extra)}</w:p>`
        : '';
    paras.push(para(up(title || 'Untitled Script'), { before: 4320, extra: '<w:b/><w:u w:val="single"/>' }));
    paras.push(para(tp.credit), para(tp.author), para(tp.source));
    paras.push(para(tp.draftDate, { jc: 'right', before: 2880 }));
    paras.push(para(tp.contact, { jc: 'left', before: tp.draftDate ? 0 : 2880 }));
    paras.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
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
  deliver(safeName(script.title, 'docx'), toDocxBlob(script));
}

const FORMATS = {
  fountain: exportFountain,
  pdf: exportPdfFile,
  print: exportPrint,
  docx: exportDocx,
};

/* ---------- UI ---------- */

let sheet;

let onPersist = () => {};

export function init(persist) {
  if (persist) onPersist = persist;
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
          <span>Industry-standard pages (Courier 12pt, US Letter) with a title page, scene and cue breaks, (MORE)/(CONT'D) and page numbers. Works offline.</span>
        </button>
        <button class="export-fmt" data-fmt="docx">
          <b>Word (.docx)</b>
          <span>Styled Word document for collaborators. Opens in Word, Pages and Google Docs.</span>
        </button>
        <button class="export-fmt" data-fmt="print">
          <b>Print</b>
          <span>Send the formatted script to a printer through your browser.</span>
        </button>
      </div>
      <h3 class="profile-sub">Title page</h3>
      <p class="hint">Included at the front of every export.</p>
      <div id="titlePageFields"></div>
    </div>`;
  const fieldsEl = sheet.querySelector('#titlePageFields');
  for (const f of TITLE_FIELDS) {
    const label = document.createElement('label');
    label.className = 'profile-field';
    const span = document.createElement('span');
    span.textContent = f.label;
    const input = document.createElement(f.multiline ? 'textarea' : 'input');
    if (!f.multiline) input.type = 'text';
    input.dataset.field = f.key;
    input.placeholder = f.placeholder;
    input.autocomplete = 'off';
    input.addEventListener('input', () => {
      const script = editor.getScript();
      script.titlePage = { ...(script.titlePage || {}), [f.key]: input.value };
      script.updatedAt = Date.now();
      onPersist();
    });
    label.append(span, input);
    fieldsEl.appendChild(label);
  }
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
  const script = editor.getScript();
  sheet.querySelector('#exportName').textContent = script.title || 'Untitled Script';
  const tp = script.titlePage || {};
  for (const input of sheet.querySelectorAll('#titlePageFields [data-field]')) {
    input.value = tp[input.dataset.field] || '';
  }
  sheet.hidden = false;
}

function close() {
  sheet.hidden = true;
}
