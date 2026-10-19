// Real PDF export, written by hand: no library, no print dialog. Uses the
// PDF base-14 Courier faces (no font embedding needed), US Letter, 12pt at
// 6 lines per inch, 1.5" left margin and a 6" text block — the standard
// screenplay page. Pagination keeps scene headings and cues with what
// follows and splits long speeches with (MORE) / NAME (CONT'D).

import { COLS, layoutLines, up } from './layout.js';

const PAGE_W = 612;
const PAGE_H = 792;
const LEFT = 108; // 1.5"
const CHAR_W = 7.2; // Courier 12pt: 600/1000 em
const LEADING = 12;
const FIRST_BASELINE = PAGE_H - 72 - 10; // 1" top margin
export const LINES_PER_PAGE = 54;

/* ---------- pagination ---------- */

export function paginate(lines) {
  const pages = [];
  let page = [];
  let cue = '';
  const newPage = () => {
    while (page.length && !page[page.length - 1].text) page.pop();
    if (page.length) pages.push(page);
    page = [];
  };
  const speech = (t) => t === 'dialogue' || t === 'paren';

  for (const ln of lines) {
    if (ln.type === 'character') cue = ln.text.replace(/\s*\(CONT['’]D\)\s*$/i, '');
    const left = LINES_PER_PAGE - page.length;
    const prev = page[page.length - 1];
    if ((ln.type === 'scene' || ln.type === 'character') && ln.text && left < 3) {
      newPage(); // never strand a heading or a cue at the foot of a page
    } else if (speech(ln.type) && prev && (speech(prev.type) || prev.type === 'character') && left === 1) {
      page.push({ text: '(MORE)', type: 'more', col: 22 });
      newPage();
      page.push({ text: `${cue} (CONT'D)`, type: 'character', col: 22 });
    } else if (left <= 0) {
      newPage();
    }
    if (!page.length && !ln.text) continue; // no blank line at the top of a page
    page.push(ln);
  }
  newPage();
  return pages;
}

/* ---------- PDF text encoding ---------- */

// Courier base-14 with WinAnsiEncoding: map typographic punctuation to
// its WinAnsi byte, escape PDF string syntax, and octal-escape high bytes
// so the whole file stays 7-bit (string length == byte length).
const WIN_ANSI = { '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97, '…': 0x85, '•': 0x95 };

export function pdfString(s) {
  let out = '';
  for (const ch of s) {
    let code = WIN_ANSI[ch] || ch.codePointAt(0);
    if (code > 255) code = 63; // '?'
    if (ch === '\\' || ch === '(' || ch === ')') out += '\\' + ch;
    else if (code < 32 || code > 126) out += '\\' + code.toString(8).padStart(3, '0');
    else out += ch;
  }
  return '(' + out + ')';
}

const textWidth = (s) => [...s].length * CHAR_W;

/* ---------- page content ---------- */

function textOp(text, x, y, bold) {
  return `BT /${bold ? 'F2' : 'F1'} 12 Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfString(text)} Tj ET`;
}

function bodyPage(lines, number) {
  const ops = [];
  if (number > 1) {
    const label = number + '.';
    ops.push(textOp(label, LEFT + COLS * CHAR_W - textWidth(label), PAGE_H - 36, false));
  }
  lines.forEach((ln, i) => {
    if (!ln.text) return;
    const y = FIRST_BASELINE - i * LEADING;
    const w = textWidth(ln.text);
    let x = LEFT + (ln.col || 0) * CHAR_W;
    if (ln.align === 'right') x = LEFT + COLS * CHAR_W - w;
    if (ln.align === 'center') x = LEFT + (COLS * CHAR_W - w) / 2;
    ops.push(textOp(ln.text, x, y, ln.bold));
    if (ln.underline) ops.push(`0.6 w ${x.toFixed(2)} ${(y - 2).toFixed(2)} m ${(x + w).toFixed(2)} ${(y - 2).toFixed(2)} l S`);
  });
  return ops.join('\n');
}

function titlePage(script) {
  const tp = script.titlePage || {};
  const title = up((script.title || 'Untitled Script').trim());
  const author = (tp.author || '').trim();
  const credit = (tp.credit || '').trim() || (author ? 'Written by' : '');
  const ops = [];
  const center = (text, line, bold) =>
    ops.push(textOp(text, LEFT + (COLS * CHAR_W - textWidth(text)) / 2, FIRST_BASELINE - line * LEADING, bold));
  let line = 20;
  center(title, line, true);
  for (const t of [credit, author, (tp.source || '').trim()]) {
    if (!t) continue;
    line += 2;
    const parts = t.split('\n');
    parts.forEach((part, k) => center(part, line + k, false));
    line += parts.length - 1;
  }
  const contact = (tp.contact || '').trim().split('\n').filter(Boolean);
  contact.forEach((t, i) =>
    ops.push(textOp(t, LEFT, FIRST_BASELINE - (LINES_PER_PAGE - contact.length + i) * LEADING, false))
  );
  const draft = (tp.draftDate || '').trim();
  if (draft) {
    ops.push(textOp(draft, LEFT + COLS * CHAR_W - textWidth(draft), FIRST_BASELINE - (LINES_PER_PAGE - 1) * LEADING, false));
  }
  return ops.join('\n');
}

function hasTitlePage(script) {
  const tp = script.titlePage || {};
  return !!((script.title || '').trim() || Object.values(tp).some((v) => (v || '').trim()));
}

/* ---------- file assembly ---------- */

function assemble(streams, title) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    null, // page tree, filled in below
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title ${pdfString(title)} /Creator (Wordsmith) >>`,
  ];
  const kids = [];
  for (const s of streams) {
    objs.push(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
    const contentId = objs.length;
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    kids.push(objs.length);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets = objs.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out +=
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

export function toPdf(script) {
  const streams = [];
  if (hasTitlePage(script)) streams.push(titlePage(script));
  const pages = paginate(layoutLines(script.elements || []));
  if (!pages.length) pages.push([]);
  pages.forEach((p, i) => streams.push(bodyPage(p, i + 1)));
  return assemble(streams, (script.title || 'Untitled Script').trim());
}

export function toPdfBlob(script) {
  return new Blob([toPdf(script)], { type: 'application/pdf' });
}
