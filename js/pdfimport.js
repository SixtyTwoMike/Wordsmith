// PDF import: turn a screenplay PDF (Final Draft, Highland, WriterDuet,
// Fade In, our own export…) back into editable elements. A PDF only knows
// text and where it sits, so each line is classified by its indent from
// the page's own left margin, using the standard screenplay layout:
// action/scene at 0", dialogue ~1", parenthetical ~1.6", character ~2.2",
// transitions pushed right. Page furniture — page and scene numbers,
// (MORE), CONTINUED — is dropped, and speeches split across pages with
// NAME (CONT'D) are joined back together.
//
// pdf.js (vendor/pdfjs) does the text extraction. It's large, so it loads
// only when a PDF is actually imported.

import { newElement, detectType, characterStatName } from './model.js';

const SCENE_RE = /^(INT\.?\/EXT|I\/E|INT|EXT|EST)[.\s]/i;
const MARKER_RE =
  /^(COLD OPEN|TEASER|TAG|ACT (ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|\d+)|END OF (ACT.*|COLD OPEN|TEASER|SHOW|EPISODE))$/i;
const SCENE_NUMBER_RE = /^[A-Z]?\d+[A-Z]?\.?$/;
const CONTD_RE = /\s*\((CONT['’]D|CONTINUING|CONTINUED)\)\s*$/i;
const FURNITURE_RE = /^\(?(MORE|CONTINUED:?|CONT['’]D)\)?$/i;
const CREDIT_RE = /^(written by|screenplay by|teleplay by|story by|by)$/i;
const INCH = 72;

const isAllCaps = (s) => /[A-Z]/.test(s) && s === s.toUpperCase();

/* ---------- extraction (pdf.js) ---------- */

let pdfjs;

async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}

// -> [{ width, height, items: [{ x, y, w, h, text }] }], y up from the bottom.
export async function readPdfPages(data) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  const pages = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const [x0, y0, x1, y1] = page.view;
      const { items } = await page.getTextContent();
      pages.push({
        width: x1 - x0,
        height: y1 - y0,
        items: items
          .filter((it) => it.str && it.str.trim())
          .map((it) => ({ x: it.transform[4] - x0, y: it.transform[5] - y0, w: it.width, h: it.height, text: it.str })),
      });
    }
  } finally {
    await doc.destroy();
  }
  return pages;
}

/* ---------- lines ---------- */

// Group a page's text items into lines (same baseline, left to right).
function pageLines(page) {
  const items = [...page.items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of items) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - it.y) < 2) line.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines;
}

// Join items into text, adding a space where there's a visible gap.
function lineText(items) {
  let out = '';
  let end = null;
  for (const it of items) {
    if (end !== null && it.x - end > 1.5 && !/\s$/.test(out)) out += ' ';
    out += it.text;
    end = it.x + it.w;
  }
  return out.replace(/\s+/g, ' ').trim();
}

// The action margin: the most common line start (in whole points).
function leftMargin(pages) {
  const counts = new Map();
  for (const page of pages) {
    for (const line of page.lines) {
      const it = line.items.find((i) => !SCENE_NUMBER_RE.test(i.text.trim()));
      if (!it) continue;
      const x = Math.round(it.x);
      counts.set(x, (counts.get(x) || 0) + 1);
    }
  }
  let best = INCH * 1.5;
  let n = 0;
  for (const [x, c] of counts) if (c > n || (c === n && x < best)) [best, n] = [x, c];
  return best;
}

// Line spacing: screenplays set one line per font size (Courier 12 at 6
// lines an inch), so the median text height is the single-line gap. The
// most common gap can't be used — in action-heavy pages it's the blank
// line between paragraphs.
function leading(pages) {
  const hs = pages.flatMap((p) => p.items.map((it) => it.h).filter((h) => h > 4)).sort((a, b) => a - b);
  return hs.length ? hs[hs.length >> 1] : 12;
}

/* ---------- title page ---------- */

// A first page with no scene headings and little text is a title page.
function looksLikeTitlePage(page, total) {
  if (total < 2 || page.lines.length > 30) return false;
  return !page.lines.some((l) => SCENE_RE.test(lineText(l.items)));
}

// Split a line's items wherever there's more than an inch of space.
function runs(items) {
  const out = [];
  for (const it of items) {
    const run = out[out.length - 1];
    const prev = run && run[run.length - 1];
    if (prev && it.x - (prev.x + prev.w) <= INCH) run.push(it);
    else out.push([it]);
  }
  return out;
}

function parseTitlePage(page, margin) {
  const mid = page.width / 2;
  const groups = [];
  let prevY = null;
  const contact = [];
  let draftDate = '';
  for (const line of page.lines) {
    const text = lineText(line.items);
    if (line.y < page.height * 0.35) {
      // Lower block: contact on the left, draft date on the right — often
      // on the same baseline, so split the line at wide gaps first.
      for (const run of runs(line.items)) {
        const first = run[0];
        const last = run[run.length - 1];
        const t = lineText(run);
        if ((first.x + last.x + last.w) / 2 > mid + INCH) draftDate = draftDate ? draftDate + ' ' + t : t;
        else if (first.x < margin + INCH) contact.push(t);
      }
      continue;
    }
    if (prevY === null || prevY - line.y > 20) groups.push([]);
    groups[groups.length - 1].push(text);
    prevY = line.y;
  }
  const title = (groups.shift() || []).join(' ');
  const tp = {};
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (CREDIT_RE.test(g[0])) {
      tp.credit = g[0];
      const author = g.length > 1 ? g.slice(1) : groups[++i] || [];
      if (author.length) tp.author = author.join('\n');
    } else if (/^based on/i.test(g[0])) {
      tp.source = g.join('\n');
    } else if (!tp.author && i === 0) {
      tp.author = g.join('\n');
    }
  }
  if (contact.length) tp.contact = contact.join('\n');
  if (draftDate) tp.draftDate = draftDate;
  if (tp.credit && /^written by$/i.test(tp.credit) && tp.author) delete tp.credit;
  return { title, titlePage: tp };
}

/* ---------- body ---------- */

// Classify a line by its indent (inches from the action margin).
function classify(text, off) {
  if (MARKER_RE.test(text) && off > 0.5) return 'marker';
  if (off < 0.5) return detectType('action', text);
  if (off >= 3.4 || (off >= 2 && isAllCaps(text) && /(:|^FADE .*\.)$/.test(text))) return isAllCaps(text) ? 'transition' : 'action';
  if (off >= 1.95) return isAllCaps(text) ? 'character' : 'dialogue';
  if (off >= 0.5 && text.startsWith('(')) return 'paren';
  if (off >= 0.5) return off >= 1.35 ? 'paren-wrap' : 'dialogue';
  return 'action';
}

// -> { title, titlePage, elements }
export function parsePdf(rawPages) {
  const pages = rawPages.map((p) => ({ ...p, lines: pageLines(p) }));
  if (!pages.some((p) => p.lines.length)) {
    throw new Error('That PDF has no text to read — it may be a scan or a photo.');
  }

  let title = '';
  let titlePage = {};
  const margin = leftMargin(pages.slice(1).length ? pages.slice(1) : pages);
  const lead = leading(pages);
  if (looksLikeTitlePage(pages[0], pages.length)) {
    ({ title, titlePage } = parseTitlePage(pages.shift(), margin));
  }

  const elements = [];
  let cur = null; // element still accepting wrapped lines
  let speaker = ''; // current cue, for joining (CONT'D) speeches
  let continuing = false; // a speech carried over from the previous page

  const start = (type, text) => {
    cur = newElement(type, text);
    elements.push(cur);
  };
  const append = (text) => {
    cur.text += (cur.text.endsWith('-') && !cur.text.endsWith(' -') ? '' : ' ') + text;
  };

  for (const page of pages) {
    let prevY = null;
    for (const line of page.lines) {
      // Scene numbers sit in the margin before the heading, or set well
      // apart after it.
      const items = line.items.filter((it, i, all) => {
        if (!SCENE_NUMBER_RE.test(it.text.trim())) return true;
        if (it.x < margin - 6) return false;
        const prev = all[i - 1];
        return !(i === all.length - 1 && prev && it.x - (prev.x + prev.w) > 0.3 * INCH);
      });
      const text = lineText(items);
      const gap = prevY === null ? Infinity : prevY - line.y;
      prevY = line.y;
      if (!text) continue;
      // Page numbers: in the top or bottom margin, or a lone number pushed
      // right as a page's first line.
      if (
        /^\d+\.?$/.test(text) &&
        (line.y > page.height - 0.9 * INCH || line.y < 0.9 * INCH || (gap === Infinity && items[0].x > margin + 4 * INCH))
      ) {
        continue;
      }
      if (FURNITURE_RE.test(text)) {
        if (/MORE/i.test(text)) continuing = true;
        continue;
      }

      const off = (items[0].x - margin) / INCH;
      let type = classify(text, off);
      const broke = gap > lead * 1.5;

      if (type === 'character') {
        const cue = text.replace(CONTD_RE, '');
        // NAME (CONT'D) after a page break picks the same speech back up.
        if (continuing && characterStatName(cue) === speaker && CONTD_RE.test(text)) {
          continuing = false;
          cur = [...elements].reverse().find((e) => e.type === 'dialogue' || e.type === 'paren') || null;
          continue;
        }
        continuing = false;
        speaker = characterStatName(cue);
        start('character', cue);
        continue;
      }
      continuing = false;

      if (type === 'paren-wrap') type = cur && cur.type === 'paren' && !/\)$/.test(cur.text) ? 'paren' : 'dialogue';
      const inSpeech = cur && ['character', 'paren', 'dialogue'].includes(cur.type);

      if (type === 'paren') {
        if (cur && cur.type === 'paren' && !/\)$/.test(cur.text)) append(text);
        else start('paren', text);
      } else if (type === 'dialogue' && inSpeech) {
        if (cur.type === 'dialogue') append(text);
        else start('dialogue', text);
      } else if (type === 'action' && cur && cur.type === 'action' && !broke) {
        append(text);
      } else {
        start(type === 'dialogue' ? 'action' : type, text);
      }
    }
  }

  for (const el of elements) {
    if (el.type === 'paren') el.text = el.text.replace(/^\(+/, '').replace(/\)+$/, '').trim();
  }
  return { title, titlePage, elements: elements.filter((e) => e.text) };
}

export async function importPdf(data) {
  return parsePdf(await readPdfPages(data));
}
