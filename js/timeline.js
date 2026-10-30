// Timeline: a ruler-style dial down the left of the page. The
// scale — a long tick per page, half and quarter ticks between, scene and
// act marks beside — slides past a fixed needle as the script scrolls.
// Drag it to scrub, click a scene to jump there, ⌥↑/⌥↓ for the previous
// or next scene. Pages come from the PDF export's own pagination, so
// "page 12" here is page 12 of the exported script.
//
// Wide desktop windows show it beside the page. Everywhere else (iPhone,
// narrow windows) it's a drawer behind a pull-tab on the left edge. The
// tab opens on a tap; dragging it open is only enabled in the installed
// Home Screen app, because in Safari a swipe from the screen edge is the
// browser's own Back gesture. The drawer closes with a swipe left inside
// it (well clear of the edge), a tap on the dimmed page, a jump, or Esc.

import * as editor from './editor.js';
import { characterStatName } from './model.js';
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
let drawerOpen = false;
let handle;
let scrim;
let suppressClick = false;

const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isDrawer = () => !wide.matches;

export function init() {
  root = document.getElementById('timeline');
  root.innerHTML = `
    <div class="tl-window">
      <div class="tl-needle"></div>
      <div class="tl-scale"></div>
      <span class="tl-readout"></span>
    </div>
    <div class="tl-card" hidden></div>`;
  scale = root.querySelector('.tl-scale');
  readout = root.querySelector('.tl-readout');
  wide = window.matchMedia('(min-width: 1180px) and (hover: hover) and (pointer: fine)');
  wireDrawer();

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
    if (suppressClick) return; // the tap ended a drag
    const mark = e.target.closest('.tl-mark');
    if (mark) jumpTo(Number(mark.dataset.i));
  });
  wireCard();
  editor.onKey(onKey);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawerOpen) {
      closeDrawer();
      e.preventDefault();
      return;
    }
    if (!e.target.closest('input, textarea, select') && onKey(e)) e.preventDefault();
  });
  rebuild();
}

function onKey(e) {
  if (!e.altKey || e.metaKey || e.ctrlKey || root.hidden || (isDrawer() && !drawerOpen)) return false;
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
  const drawer = isDrawer();
  root.classList.toggle('tl-drawer', drawer);
  root.hidden = false;
  handle.hidden = !drawer;
  if (!drawer && drawerOpen) closeDrawer();
  if (drawer && !drawerOpen) return; // measured when it opens
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
    const info = act ? { heading: text, desc: '', cast: [] } : summary(els, i);
    marks.push({ i, pos: positions[i], act, info });
    const label = act
      ? escapeHtml(text)
      : `<b>${escapeHtml(place(text))}</b>${info.desc ? `<span>${escapeHtml(info.desc)}</span>` : ''}`;
    parts.push(
      `<button class="tl-mark${act ? ' tl-act' : ''}${crowded ? ' tl-crowded' : ''}" data-i="${i}" ` +
        `style="top:${y}px" aria-label="${escapeHtml(text)}, page ${Math.floor(positions[i]) + 1}">${label}</button>`
    );
  });
  scale.style.height = pages * PX_PER_PAGE + 'px';
  scale.innerHTML = parts.join('');
  marks.forEach((m) => (m.node = scale.querySelector(`.tl-mark[data-i="${m.i}"]`)));
  sync();
}

// What a scene is: its opening action (the description under the
// heading) and who speaks in it, up to the next scene or act marker.
function summary(els, i) {
  let desc = '';
  const cast = [];
  for (let k = i + 1; k < els.length; k++) {
    const el = els[k];
    if (el.type === 'scene' || el.type === 'marker') break;
    const t = (el.text || '').trim();
    if (!t) continue;
    if (!desc && el.type === 'action') desc = t.replace(/\s+/g, ' ');
    if (el.type === 'character') {
      const name = characterStatName(t);
      if (name && !cast.includes(name)) cast.push(name);
    }
  }
  return { heading: els[i].text.trim(), desc, cast };
}

// "INT. DINER - NIGHT" -> "DINER", keeping the label to the place.
function place(text) {
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
  if (drawerOpen) closeDrawer();
  editor.activate(i);
  scrollToPos(positions[i]);
  sync();
}

/* ---------- drawer (iPhone and narrow windows) ---------- */

function wireDrawer() {
  handle = document.createElement('button');
  handle.id = 'tlHandle';
  handle.setAttribute('aria-label', 'Timeline');
  handle.hidden = true;
  scrim = document.createElement('div');
  scrim.id = 'tlScrim';
  document.body.append(handle, scrim);

  handle.addEventListener('click', openDrawer);
  scrim.addEventListener('click', closeDrawer);
  // Drag the tab open — installed app only (no Back gesture to collide with).
  let startX = null;
  handle.addEventListener('pointerdown', (e) => {
    startX = standalone() ? e.clientX : null;
  });
  handle.addEventListener('pointermove', (e) => {
    if (startX !== null && e.clientX - startX > 24) {
      startX = null;
      openDrawer();
    }
  });
}

function openDrawer() {
  if (drawerOpen) return;
  drawerOpen = true;
  // Drop the keyboard so the dial gets the whole screen.
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  rebuild();
  scrim.classList.add('on');
  handle.classList.add('tl-handle-off');
  requestAnimationFrame(() => root.classList.add('tl-open'));
}

function closeDrawer() {
  if (!drawerOpen) return;
  drawerOpen = false;
  root.classList.remove('tl-open');
  scrim.classList.remove('on');
  handle.classList.remove('tl-handle-off');
}

/* ---------- drawing ---------- */

function sync() {
  if (root.hidden || !positions.length || (isDrawer() && !drawerOpen)) return;
  current = posFromScroll();
  const mid = scale.parentElement.clientHeight / 2;
  scale.style.transform = `translateY(${(mid - current * PX_PER_PAGE).toFixed(1)}px)`;
  readout.textContent = `${Math.min(pages, Math.floor(current) + 1)}`;
  readout.title = `Page ${Math.min(pages, Math.floor(current) + 1)} of ${pages}`;
  let here = null;
  for (const m of marks) if (!m.act && m.pos <= current + 0.005) here = m;
  for (const m of marks) m.node.classList.toggle('tl-current', m === here);
}

// Hover a scene for the longer story: full heading, page, more of the
// description and who's in it.
function wireCard() {
  const card = root.querySelector('.tl-card');
  scale.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse' || isDrawer()) return; // touch shows the label itself
    const node = e.target.closest('.tl-mark');
    const m = node && marks.find((x) => x.node === node);
    if (!m || m.act) {
      card.hidden = true;
      return;
    }
    const { heading, desc, cast } = m.info;
    const more = desc.length > 220 ? desc.slice(0, 220).replace(/\s+\S*$/, '') + '…' : desc;
    card.innerHTML =
      `<div class="tl-card-head"><b>${escapeHtml(heading)}</b><span>p. ${Math.floor(m.pos) + 1}</span></div>` +
      (more ? `<p>${escapeHtml(more)}</p>` : '') +
      (cast.length ? `<div class="tl-card-cast">${cast.map(escapeHtml).join(' · ')}</div>` : '');
    card.hidden = false;
    const r = node.getBoundingClientRect();
    const top = r.top + r.height / 2 - root.getBoundingClientRect().top;
    card.style.top = Math.max(0, Math.min(root.clientHeight - card.offsetHeight, top - card.offsetHeight / 2)) + 'px';
  });
  scale.addEventListener('pointerleave', () => (card.hidden = true));
  window.addEventListener('scroll', () => (card.hidden = true), { passive: true });
}

function wireDrag() {
  const win = root.querySelector('.tl-window');
  // Tracked by hand rather than with pointer capture from the start:
  // capturing on pointerdown would retarget the tap's click away from the
  // scene label. Capture is taken only once the gesture becomes a drag.
  let track = null; // { id, x, y, pos, moved }
  win.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    // Mouse clicks on a label are plain clicks; touch drags may start on one.
    if (e.pointerType === 'mouse' && e.target.closest('.tl-mark')) return;
    suppressClick = false;
    track = { id: e.pointerId, x: e.clientX, y: e.clientY, pos: current, moved: false };
  });
  win.addEventListener('pointermove', (e) => {
    if (!track || e.pointerId !== track.id) return;
    const dx = e.clientX - track.x;
    const dy = e.clientY - track.y;
    // A clear swipe left inside the drawer closes it.
    if (drawerOpen && dx < -50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      track = null;
      suppressClick = true;
      win.classList.remove('tl-dragging');
      closeDrawer();
      return;
    }
    if (!track.moved && Math.abs(dy) > 6) {
      track.moved = true;
      suppressClick = true;
      win.classList.add('tl-dragging');
      try {
        win.setPointerCapture(e.pointerId);
      } catch (err) {
        /* the pointer may already be gone */
      }
    }
    if (track.moved) scrollToPos(track.pos - dy / PX_PER_PAGE);
  });
  const end = (e) => {
    if (!track || e.pointerId !== track.id) return;
    const { moved } = track;
    track = null;
    win.classList.remove('tl-dragging');
    if (e.type === 'pointercancel' || moved) return;
    if (e.target.closest('.tl-mark')) return; // the label's click jumps
    // A tap on the ruler itself jumps to that spot.
    const r = win.getBoundingClientRect();
    scrollToPos(current + (e.clientY - (r.top + r.height / 2)) / PX_PER_PAGE);
  };
  win.addEventListener('pointerup', end);
  win.addEventListener('pointercancel', end);
}
