// Scene Snippet: render a scene (or the page it sits on) as a share-ready
// image with screenplay layout, plus generated alt text and a caption.
// Sharing goes through the system share sheet (Web Share with files), which
// is how Instagram, Threads and Bluesky receive images on iPhone; Save image
// and text-only compose links cover everything else.

import * as editor from './editor.js';
import { estimatePages } from './model.js';
import { download, safeName } from './export.js';
import { COLS, layoutLines, stripParens, up } from './layout.js';

/* ---------- picking the excerpt ---------- */

// A scene runs from its heading to the next heading or act marker.
export function sceneRange(els, start) {
  let end = start + 1;
  while (end < els.length && els[end].type !== 'scene' && els[end].type !== 'marker') end++;
  return [start, end];
}

// The estimated page (55 lines, same estimator as the page count) that
// element `i` starts on, as [from, to, pageNumber].
export function pageRange(els, i) {
  const pageOf = (k) => Math.floor(estimatePages(els.slice(0, k)) + 1e-9);
  const page = pageOf(i);
  let from = i;
  while (from > 0 && pageOf(from - 1) === page) from--;
  let to = i + 1;
  while (to < els.length && pageOf(to) === page) to++;
  return [from, to, page + 1];
}

// Alt text a screen reader can follow: what it is, then the scene as
// plain lines, with cues folded into their dialogue.
export function altText(script, els, label) {
  const title = (script.title || '').trim();
  const author = ((script.titlePage || {}).author || '').trim();
  const head =
    `Screenplay ${label.toLowerCase()}` +
    (title ? ` from “${title}”` : '') +
    (author ? ` by ${author}` : '') +
    '.';
  const out = [head];
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    const t = (el.text || '').trim();
    if (!t) continue;
    if (el.type === 'character') {
      let speech = '';
      let j = i + 1;
      while (j < els.length && (els[j].type === 'paren' || els[j].type === 'dialogue')) {
        const s = (els[j].text || '').trim();
        if (s) speech += (speech ? ' ' : '') + (els[j].type === 'paren' ? '(' + stripParens(s) + ')' : s);
        j++;
      }
      out.push(`${up(t)}: ${speech}`.trim());
      i = j - 1;
    } else if (el.type === 'paren') {
      out.push('(' + stripParens(t) + ')');
    } else if (['scene', 'transition', 'marker'].includes(el.type)) {
      out.push(up(t));
    } else {
      out.push(t);
    }
  }
  return out.join('\n');
}

export function captionFor(script, heading) {
  const title = (script.title || '').trim();
  const bits = [heading ? up(heading) : '', title ? `from “${title}”` : ''].filter(Boolean);
  return (bits.length ? bits.join(' — ') + '\n\n' : '') + '#screenwriting #amwriting';
}

/* ---------- drawing ---------- */

export const FORMATS = {
  portrait: { w: 1080, h: 1350, label: '4:5' },
  square: { w: 1080, h: 1080, label: 'Square' },
  story: { w: 1080, h: 1920, label: 'Story' },
};

const THEMES = {
  paper: { bg: '#f7f5ef', ink: '#1c1c1c', dim: '#7a756b', rule: '#ddd8cc', accent: '#b86e12' },
  night: { bg: '#131418', ink: '#ece9e2', dim: '#8d929c', rule: '#2b2e36', accent: '#e0a458' },
};

const MONO = '"Courier Prime", "Courier New", Courier, monospace';
const SANS = '-apple-system, BlinkMacSystemFont, system-ui, sans-serif';

export function drawSnippet(canvas, { lines, format, theme, title, label, credit }) {
  const { w, h } = FORMATS[format];
  const c = THEMES[theme];
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, w, h);

  const pad = 84;
  // Header: title left, scene/page label right, a hairline under both.
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = c.ink;
  ctx.font = `600 32px ${SANS}`;
  const head = title || 'Untitled Script';
  ctx.fillText(fit(ctx, head, w - pad * 2 - 220), pad, pad + 24);
  ctx.fillStyle = c.accent;
  ctx.font = `700 24px ${SANS}`;
  ctx.textAlign = 'right';
  ctx.fillText(up(label), w - pad, pad + 22);
  ctx.textAlign = 'left';
  ctx.fillStyle = c.rule;
  ctx.fillRect(pad, pad + 52, w - pad * 2, 2);

  // Footer: credit left, app mark right.
  ctx.fillStyle = c.dim;
  ctx.font = `500 22px ${SANS}`;
  if (credit) ctx.fillText(fit(ctx, credit, w - pad * 2 - 220), pad, h - pad + 20);
  ctx.textAlign = 'right';
  ctx.fillText('Wordsmith', w - pad, h - pad + 20);
  ctx.textAlign = 'left';

  // Body: pick the largest monospace size that fits the 60-column block
  // and every line; past the minimum size, cut and mark (MORE).
  const top = pad + 110;
  const bottom = h - pad - 50;
  const availW = w - pad * 2;
  const availH = bottom - top;
  ctx.font = `100px ${MONO}`;
  const k = ctx.measureText('M').width / 100; // char width per px of font size
  const LH = 1.32;
  let size = Math.min(30, availW / (COLS * k), availH / (Math.max(lines.length, 1) * LH));
  let shown = lines;
  if (size < 17) {
    size = 17;
    const max = Math.floor(availH / (size * LH));
    shown = lines.slice(0, max - 1);
    while (shown.length && !shown[shown.length - 1].text) shown.pop();
    shown.push({ text: '(MORE)', col: 22 });
  }
  const cw = size * k;
  const blockW = COLS * cw;
  const left = pad + (availW - blockW) / 2;
  // Short excerpts sit a little above centre rather than hugging the top.
  const spare = Math.max(0, availH - shown.length * size * LH);
  const y0 = top + spare * 0.4;
  shown.forEach((ln, idx) => {
    if (!ln.text) return;
    const y = y0 + (idx + 1) * size * LH - size * (LH - 1);
    ctx.font = `${ln.bold ? '700 ' : ''}${size}px ${MONO}`;
    ctx.fillStyle = c.ink;
    const tw = ctx.measureText(ln.text).width;
    let x = left + (ln.col || 0) * cw;
    if (ln.align === 'right') x = left + blockW - tw;
    if (ln.align === 'center') x = left + (blockW - tw) / 2;
    ctx.fillText(ln.text, x, y);
    if (ln.underline) ctx.fillRect(x, y + size * 0.15, tw, Math.max(2, size / 14));
  });
}

function fit(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

/* ---------- sheet UI ---------- */

let sheet;
let state = null; // { sceneIndex, scope, format, theme }
let blob = null;

export function init() {
  sheet = document.getElementById('snippetSheet');
  build();
}

function build() {
  sheet.innerHTML = `
    <div class="sheet-head">
      <h2>Scene Snippet</h2>
      <button id="closeSnippet" class="btn-done">Done</button>
    </div>
    <div class="sheet-body">
      <div class="snip-controls">
        <div class="seg" role="group" aria-label="What to share">
          <button class="snip-scope" data-scope="scene">Scene</button>
          <button class="snip-scope" data-scope="page">Page</button>
        </div>
        <div class="seg" role="group" aria-label="Image size">
          ${Object.entries(FORMATS)
            .map(([k, f]) => `<button class="snip-fmt" data-fmt="${k}">${f.label}</button>`)
            .join('')}
        </div>
        <div class="seg" role="group" aria-label="Look">
          <button class="snip-theme" data-theme="paper">Paper</button>
          <button class="snip-theme" data-theme="night">Night</button>
        </div>
      </div>
      <div class="snip-preview"><canvas id="snippetCanvas" aria-label="Snippet preview"></canvas></div>
      <button id="shareSnippet" class="btn-primary">Share image…</button>
      <div class="btn-row">
        <button id="saveSnippet" class="btn-secondary">Save image</button>
        <a id="shareBluesky" class="btn-secondary" target="_blank" rel="noopener">Bluesky</a>
        <a id="shareThreads" class="btn-secondary" target="_blank" rel="noopener">Threads</a>
      </div>
      <p class="hint">Share image opens your share sheet — pick Instagram, Threads, Bluesky or any app. The Bluesky and Threads buttons start a post with the caption; attach the saved image there.</p>
      <p id="snippetStatus" class="hint" role="status"></p>
      <label class="profile-field">
        <span>Alt text <em id="altCount" class="snip-count"></em></span>
        <textarea id="snippetAlt" rows="6"></textarea>
      </label>
      <button id="copyAlt" class="btn-secondary">Copy alt text</button>
      <label class="profile-field">
        <span>Caption</span>
        <textarea id="snippetCaption" rows="3"></textarea>
      </label>
      <button id="copyCaption" class="btn-secondary">Copy caption</button>
    </div>`;

  sheet.querySelector('#closeSnippet').addEventListener('click', () => (sheet.hidden = true));
  for (const [cls, key] of [['snip-scope', 'scope'], ['snip-fmt', 'format'], ['snip-theme', 'theme']]) {
    sheet.querySelectorAll('.' + cls).forEach((b) =>
      b.addEventListener('click', () => {
        state[key] = b.dataset[key === 'format' ? 'fmt' : key];
        render(key === 'scope');
      })
    );
  }
  const altEl = sheet.querySelector('#snippetAlt');
  const capEl = sheet.querySelector('#snippetCaption');
  altEl.addEventListener('input', updateCount);
  capEl.addEventListener('input', updateLinks);
  sheet.querySelector('#copyAlt').addEventListener('click', () => copy(altEl, 'Alt text copied.'));
  sheet.querySelector('#copyCaption').addEventListener('click', () => copy(capEl, 'Caption copied.'));
  sheet.querySelector('#saveSnippet').addEventListener('click', save);
  sheet.querySelector('#shareSnippet').addEventListener('click', share);
}

function status(text) {
  sheet.querySelector('#snippetStatus').textContent = text;
}

export function open(sceneIndex) {
  editor.commitActive();
  state = { sceneIndex, scope: 'scene', format: 'portrait', theme: state ? state.theme : 'paper' };
  status('');
  render(true);
  sheet.hidden = false;
}

function excerpt() {
  const script = editor.getScript();
  const els = script.elements;
  if (state.scope === 'page') {
    const [from, to, n] = pageRange(els, state.sceneIndex);
    return { els: els.slice(from, to), label: `Page ${n}` };
  }
  const [from, to] = sceneRange(els, state.sceneIndex);
  const n = els.slice(0, state.sceneIndex + 1).filter((e) => e.type === 'scene').length;
  return { els: els.slice(from, to), label: `Scene ${n}` };
}

// Redraw the preview; regenerate alt text and caption when the excerpt
// itself changed (format/theme changes keep the writer's edits).
function render(textChanged) {
  const script = editor.getScript();
  const { els, label } = excerpt();
  for (const [cls, key, attr] of [['snip-scope', 'scope', 'scope'], ['snip-fmt', 'format', 'fmt'], ['snip-theme', 'theme', 'theme']]) {
    sheet.querySelectorAll('.' + cls).forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset[attr] === state[key]))
    );
  }
  const canvas = sheet.querySelector('#snippetCanvas');
  const author = ((script.titlePage || {}).author || '').trim();
  drawSnippet(canvas, {
    lines: layoutLines(els),
    format: state.format,
    theme: state.theme,
    title: (script.title || '').trim(),
    label,
    credit: author ? 'by ' + author : '',
  });
  blob = null;
  canvas.toBlob((b) => (blob = b), 'image/png');

  if (textChanged) {
    sheet.querySelector('#snippetAlt').value = altText(script, els, label);
    const heading = els[0] && els[0].type === 'scene' ? els[0].text : '';
    sheet.querySelector('#snippetCaption').value = captionFor(script, state.scope === 'scene' ? heading : '');
  }
  updateCount();
  updateLinks();
}

function updateCount() {
  const n = sheet.querySelector('#snippetAlt').value.length;
  sheet.querySelector('#altCount').textContent = `${n} characters`;
}

function updateLinks() {
  const text = encodeURIComponent(sheet.querySelector('#snippetCaption').value);
  sheet.querySelector('#shareBluesky').href = `https://bsky.app/intent/compose?text=${text}`;
  sheet.querySelector('#shareThreads').href = `https://www.threads.net/intent/post?text=${text}`;
}

function fileName() {
  const { label } = excerpt();
  return safeName(`${editor.getScript().title || 'snippet'} ${label}`, 'png');
}

function currentBlob() {
  if (blob) return Promise.resolve(blob);
  return new Promise((res) => sheet.querySelector('#snippetCanvas').toBlob(res, 'image/png'));
}

async function save() {
  download(fileName(), await currentBlob());
  status('Image saved.');
}

async function share() {
  const b = await currentBlob();
  const file = new File([b], fileName(), { type: 'image/png' });
  const caption = sheet.querySelector('#snippetCaption').value;
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: caption });
      status('Shared.');
    } catch (e) {
      if (e.name !== 'AbortError') status('Couldn’t open the share sheet — use Save image instead.');
    }
    return;
  }
  download(fileName(), b);
  status('This browser can’t share images directly, so the image was saved instead.');
}

async function copy(textarea, done) {
  try {
    await navigator.clipboard.writeText(textarea.value);
    status(done);
  } catch (e) {
    textarea.focus();
    textarea.select();
    const ok = document.execCommand && document.execCommand('copy');
    status(ok ? done : 'Text selected — tap Copy to copy it.');
  }
}
