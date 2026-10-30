// Desktop timeline: a ruler-style dial down the left of the page. The
// scale — a long tick per page, half and quarter ticks between, scene and
// act marks beside — slides past a fixed needle as the script scrolls.
// Drag it to scrub, click a scene to jump there, ⌥↑/⌥↓ for the previous
// or next scene. Pages come from the PDF export's own pagination, so
// "page 12" here is page 12 of the exported script.

import * as editor from './editor.js';
import { layoutLines } from './layout.js';
import { paginate, LINES_PER_PAGE } from './pdf.js';

const PX_PER_PAGE = 56;
const LABEL_GAP = 15; // px between scene labels before one is hidden

let root;
let scale;
let readout;
let wide;
let positions = []; // page position (pages, fractional) of each element
let pages = 1;
let marks = []; // { i, pos, node }
let current = 0;
let timer = null;

export function init() {
  root = document.getElementById('timeline');
  root.innerHTML = `
    <div class="tl-window">
      <div class="tl-needle"></div>
      <div class="tl-scale"></div>
      <span class="tl-readout"></span>
    </div>`;
  scale = root.querySelector('.tl-scale');
  readout = root.querySelector('.tl-readout');
  wide = window.matchMedia('(min-width: 1180px) and (hover: hover) and (pointer: fine)');

  const rebuildSoon = () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 250);
  };
  editor.onUpdate(rebuildSoon);
  editor.onActiveChange(rebuildSoon);
  wide.addEventListener('change', rebuild);
  window.addEventListener('resize', rebuildSoon);
  window.addEventListener('scroll', sync, { passive: true });
  wireDrag();
  scale.addEventListener('click', (e) => {
    const mark = e.target.closest('.tl-mark');
    if (mark) jumpTo(Number(mark.dataset.i));
  });
  editor.onKey(onKey);
  document.addEventListener('keydown', (e) => {
    if (!e.target.closest('input, textarea, select') && onKey(e)) e.preventDefault();
  });
  rebuild();
}

function onKey(e) {
  if (!e.altKey || e.metaKey || e.ctrlKey || root.hidden) return false;
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
  const scenes = marks.filter((m) => !m.act);
  const target =
    e.key === 'ArrowDown'
      ? scenes.find((m) => m.pos > current + 0.01)
      : [...scenes].reverse().find((m) => m.pos < current - 0.01);
  if (target) jumpTo(target.i);
  return true;
}

/* ---------- measuring ---------- */

function measure() {
  const els = editor.getScript().elements;
  const pgs = paginate(layoutLines(els));
  pages = Math.max(1, pgs.length);
  const at = new Map();
  pgs.forEach((pg, p) =>
    pg.forEach((ln, k) => {
      if (ln.id && !at.has(ln.id)) at.set(ln.id, p + k / LINES_PER_PAGE);
    })
  );
  // Empty elements aren't laid out; they sit where the previous one ends.
  let last = 0;
  positions = els.map((el) => {
    if (at.has(el.id)) last = at.get(el.id);
    return last;
  });
}

function rebuild() {
  root.hidden = !wide.matches;
  if (root.hidden) return;
  measure();
  const els = editor.getScript().elements;
  const parts = [`<div class="tl-ticks" style="height:${pages * PX_PER_PAGE}px"></div>`];
  for (let p = 0; p < pages; p++) {
    const label = pages <= 60 || p % 5 === 0 || p === 0 ? `<span>${p + 1}</span>` : '';
    parts.push(`<div class="tl-page" style="top:${p * PX_PER_PAGE}px">${label}</div>`);
  }
  marks = [];
  let lastY = -Infinity;
  els.forEach((el, i) => {
    const text = (el.text || '').trim();
    if (!text || (el.type !== 'scene' && el.type !== 'marker')) return;
    const y = positions[i] * PX_PER_PAGE;
    const act = el.type === 'marker';
    // Act labels sit just above their line (see CSS), so they never hide
    // the scene that opens the act.
    const crowded = !act && y - lastY < LABEL_GAP;
    if (!crowded && !act) lastY = y;
    marks.push({ i, pos: positions[i], act });
    parts.push(
      `<button class="tl-mark${act ? ' tl-act' : ''}${crowded ? ' tl-crowded' : ''}" data-i="${i}" ` +
        `style="top:${y}px" title="${escapeHtml(text)} — p. ${Math.floor(positions[i]) + 1}">${escapeHtml(short(text))}</button>`
    );
  });
  scale.style.height = pages * PX_PER_PAGE + 'px';
  scale.innerHTML = parts.join('');
  marks.forEach((m) => (m.node = scale.querySelector(`.tl-mark[data-i="${m.i}"]`)));
  sync();
}

// "INT. DINER - NIGHT" -> "DINER", keeping the label to the place.
function short(text) {
  return text
    .replace(/^(INT\.?\/EXT|I\/E|INT|EXT|EST)[.\s]*/i, '')
    .replace(/\s*-\s*(DAY|NIGHT|MORNING|EVENING|DAWN|DUSK|LATER|CONTINUOUS)\s*$/i, '')
    .trim() || text;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/* ---------- scroll <-> position ---------- */

// The reading line the needle stands for: the top of the text at the top
// of the script, the bottom at the end, so every page can reach it.
function anchorRange() {
  return { a0: 90, a1: window.innerHeight - 140 };
}

function maxScroll() {
  return Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
}

function anchorAt(scrollY) {
  const { a0, a1 } = anchorRange();
  return a0 + (a1 - a0) * Math.min(1, scrollY / maxScroll());
}

function nodeTop(i) {
  return document.getElementById('page').children[i].getBoundingClientRect().top + window.scrollY;
}

function posFromScroll() {
  const kids = document.getElementById('page').children;
  const n = Math.min(kids.length, positions.length);
  if (!n) return 0;
  const y = window.scrollY + anchorAt(window.scrollY);
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (nodeTop(mid) <= y) lo = mid;
    else hi = mid - 1;
  }
  const top = nodeTop(lo);
  if (lo === n - 1) {
    const h = kids[lo].getBoundingClientRect().height || 1;
    return Math.min(pages, positions[lo] + Math.max(0, Math.min(1, (y - top) / h)) * (pages - positions[lo]));
  }
  const next = nodeTop(lo + 1);
  const f = next > top ? Math.max(0, Math.min(1, (y - top) / (next - top))) : 0;
  return positions[lo] + f * (positions[lo + 1] - positions[lo]);
}

function scrollToPos(pos) {
  const n = Math.min(document.getElementById('page').children.length, positions.length);
  if (!n) return;
  pos = Math.max(0, Math.min(pages, pos));
  let i = 0;
  while (i < n - 1 && positions[i + 1] <= pos) i++;
  const span = (i < n - 1 ? positions[i + 1] : pages) - positions[i];
  const f = span > 0 ? (pos - positions[i]) / span : 0;
  const top = nodeTop(i);
  const bottom = i < n - 1 ? nodeTop(i + 1) : top + document.getElementById('page').children[i].offsetHeight;
  const y = top + f * (bottom - top);
  // Solve scrollY + anchorAt(scrollY) = y for scrollY.
  const { a0, a1 } = anchorRange();
  const s = (y - a0) / (1 + (a1 - a0) / maxScroll());
  window.scrollTo({ top: Math.max(0, s) });
}

function jumpTo(i) {
  editor.activate(i);
  scrollToPos(positions[i]);
  sync();
}

/* ---------- drawing ---------- */

function sync() {
  if (root.hidden || !positions.length) return;
  current = posFromScroll();
  const mid = root.clientHeight / 2;
  scale.style.transform = `translateY(${(mid - current * PX_PER_PAGE).toFixed(1)}px)`;
  readout.textContent = `${Math.min(pages, Math.floor(current) + 1)}`;
  readout.title = `Page ${Math.min(pages, Math.floor(current) + 1)} of ${pages}`;
  let here = null;
  for (const m of marks) if (!m.act && m.pos <= current + 0.005) here = m;
  for (const m of marks) m.node.classList.toggle('tl-current', m === here);
}

function wireDrag() {
  const win = root.querySelector('.tl-window');
  let startY = 0;
  let startPos = 0;
  let moved = false;
  win.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.tl-mark')) return;
    startY = e.clientY;
    startPos = current;
    moved = false;
    win.setPointerCapture(e.pointerId);
    win.classList.add('tl-dragging');
  });
  win.addEventListener('pointermove', (e) => {
    if (!win.hasPointerCapture(e.pointerId)) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 3) moved = true;
    if (moved) scrollToPos(startPos - dy / PX_PER_PAGE);
  });
  const end = (e) => {
    if (!win.hasPointerCapture(e.pointerId)) return;
    if (e.type === 'pointercancel') moved = true;
    win.releasePointerCapture(e.pointerId);
    win.classList.remove('tl-dragging');
    // A click on the ruler (no drag) jumps to that spot.
    if (!moved) {
      const r = win.getBoundingClientRect();
      scrollToPos(current + (e.clientY - (r.top + r.height / 2)) / PX_PER_PAGE);
    }
  };
  win.addEventListener('pointerup', end);
  win.addEventListener('pointercancel', end);
}
