// Review comments: notes pinned to individual lines of the script, with
// replies and resolve/reopen. Stored on the script itself
// (script.comments), so they travel with backups and duplicates, and they
// round-trip through Fountain as [[Name: note]] for reviewers using other
// apps.
//
// comment: { id, elId, quote, author, text, at, resolved, replies: [{ author, text, at }] }

import * as editor from './editor.js';
import * as prefs from './prefs.js';
import { uid } from './model.js';

let sheet;
let onPersist = () => {};
let filter = 'open';
let focusId = null; // show one line's thread (opened from its margin pin)

const list = () => editor.getScript().comments || [];
const openOn = (elId) => list().filter((c) => c.elId === elId && !c.resolved).length;

export function init(persist) {
  if (persist) onPersist = persist;
  sheet = document.getElementById('reviewSheet');
  build();
  document.getElementById('openReview').addEventListener('click', () => open());
  editor.setNoteCounter((el) => openOn(el.id));
  editor.onUpdate(updateBadge);

  // Tapping a line's margin pin opens that line's thread (capture phase,
  // ahead of the editor's own tap handling).
  document.getElementById('page').addEventListener(
    'pointerdown',
    (e) => {
      const pin = e.target.closest('.note-pin');
      if (!pin) return;
      e.preventDefault();
      e.stopPropagation();
      open(pin.dataset.elId);
    },
    true
  );
  updateBadge();
}

function updateBadge() {
  const n = list().filter((c) => !c.resolved).length;
  const badge = document.getElementById('reviewCount');
  badge.textContent = n;
  badge.hidden = n === 0;
  document.getElementById('openReview').setAttribute('aria-label', `Review (${n} open)`);
}

function changed() {
  const script = editor.getScript();
  script.updatedAt = Date.now();
  onPersist();
  editor.refreshPins();
  updateBadge();
  render();
}

function build() {
  sheet.innerHTML = `
    <div class="sheet-head">
      <h2>Review</h2>
      <button id="closeReview" class="btn-done">Done</button>
    </div>
    <div class="sheet-body">
      <label class="profile-field">
        <span>Your name</span>
        <input id="reviewerName" type="text" autocomplete="name" placeholder="Shown on your comments">
      </label>
      <div class="rv-compose">
        <p class="rv-on">On <span id="composeQuote"></span></p>
        <textarea id="newComment" rows="2" placeholder="Add a comment…"></textarea>
        <button id="addComment" class="btn-primary">Comment</button>
      </div>
      <div id="reviewFilter" class="seg" role="group" aria-label="Show">
        <button data-filter="open">Open</button>
        <button data-filter="resolved">Resolved</button>
        <button data-filter="all">All</button>
      </div>
      <p id="focusNote" class="hint rv-focus" hidden>
        Showing one line. <button id="showAll" class="rv-link">Show all comments</button>
      </p>
      <ul id="threadList" class="rv-list"></ul>
      <p class="hint">Comments go out with Fountain exports as notes ([[Name: comment]]); notes in an imported Fountain file come back as comments.</p>
    </div>`;

  sheet.querySelector('#closeReview').addEventListener('click', close);
  const name = sheet.querySelector('#reviewerName');
  name.addEventListener('input', () => prefs.set('reviewer', name.value.trim()));
  sheet.querySelector('#addComment').addEventListener('click', add);
  sheet.querySelector('#reviewFilter').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-filter]');
    if (!b) return;
    filter = b.dataset.filter;
    render();
  });
  sheet.querySelector('#showAll').addEventListener('click', () => {
    focusId = null;
    render();
  });
}

export function open(elId = null) {
  editor.commitActive();
  focusId = elId;
  if (elId) filter = 'all';
  sheet.querySelector('#reviewerName').value = prefs.get('reviewer') || '';
  sheet.querySelector('#newComment').value = '';
  render();
  sheet.hidden = false;
}

function close() {
  sheet.hidden = true;
}

// The line a new comment attaches to: the focused thread's line, else the
// line being edited.
function target() {
  const script = editor.getScript();
  if (focusId) return script.elements.find((el) => el.id === focusId) || null;
  return editor.activeElement() || null;
}

function quoteOf(el) {
  const t = (el.text || '').trim();
  const label = { scene: 'Scene', action: 'Action', character: 'Cue', paren: 'Parenthetical', dialogue: 'Dialogue', transition: 'Transition', marker: 'Marker' }[el.type] || 'Line';
  return { label, text: t || '(empty line)' };
}

function add() {
  const box = sheet.querySelector('#newComment');
  const text = box.value.trim();
  const el = target();
  if (!text || !el) return;
  const script = editor.getScript();
  script.comments = script.comments || [];
  script.comments.push({
    id: uid(),
    elId: el.id,
    quote: (el.text || '').trim(),
    author: prefs.get('reviewer') || 'You',
    text,
    at: Date.now(),
    resolved: false,
    replies: [],
  });
  box.value = '';
  focusId = el.id;
  filter = filter === 'resolved' ? 'all' : filter;
  changed();
}

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function render() {
  const script = editor.getScript();
  const all = list();
  const counts = { open: all.filter((c) => !c.resolved).length, resolved: all.filter((c) => c.resolved).length, all: all.length };
  for (const b of sheet.querySelectorAll('#reviewFilter button')) {
    b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
    b.textContent = `${b.dataset.filter[0].toUpperCase()}${b.dataset.filter.slice(1)} (${counts[b.dataset.filter]})`;
  }

  const el = target();
  const q = el ? quoteOf(el) : null;
  sheet.querySelector('#composeQuote').textContent = q ? `${q.label}: “${q.text}”` : '—';
  sheet.querySelector('#focusNote').hidden = !focusId;

  // Script order; comments whose line was deleted go last.
  const pos = new Map(script.elements.map((e, i) => [e.id, i]));
  const shown = all
    .filter((c) => (filter === 'all' ? true : filter === 'open' ? !c.resolved : c.resolved))
    .filter((c) => !focusId || c.elId === focusId)
    .sort((a, b) => (pos.get(a.elId) ?? 1e9) - (pos.get(b.elId) ?? 1e9) || a.at - b.at);

  const ul = sheet.querySelector('#threadList');
  if (!shown.length) {
    const li = document.createElement('li');
    li.className = 'scene-empty';
    li.textContent =
      filter === 'resolved'
        ? 'No resolved comments.'
        : 'No comments yet. Tap a line in the script, then add a comment here.';
    ul.replaceChildren(li);
    return;
  }
  ul.replaceChildren(...shown.map((c) => thread(c, pos)));
}

function thread(c, pos) {
  const script = editor.getScript();
  const li = document.createElement('li');
  li.className = 'rv-thread' + (c.resolved ? ' resolved' : '');
  li.dataset.id = c.id;

  const idx = pos.get(c.elId);
  const jump = document.createElement('button');
  jump.type = 'button';
  jump.className = 'rv-quote';
  if (idx != null) {
    const q = quoteOf(script.elements[idx]);
    jump.textContent = `${q.label}: ${q.text}`;
    jump.addEventListener('click', () => {
      close();
      editor.activate(idx);
    });
  } else {
    jump.textContent = `Line removed: ${c.quote || ''}`;
    jump.disabled = true;
  }
  li.appendChild(jump);

  const entry = (author, text, at, cls) => {
    const d = document.createElement('div');
    d.className = cls;
    const meta = document.createElement('div');
    meta.className = 'rv-meta';
    const who = document.createElement('b');
    who.textContent = author || 'Note'; // unattributed, e.g. an imported Fountain note
    meta.append(who, ` · ${ago(at)}`);
    const body = document.createElement('p');
    body.className = 'rv-text';
    body.textContent = text;
    d.append(meta, body);
    return d;
  };
  li.appendChild(entry(c.author, c.text, c.at, 'rv-entry'));
  for (const r of c.replies || []) li.appendChild(entry(r.author, r.text, r.at, 'rv-entry rv-reply'));

  const actions = document.createElement('div');
  actions.className = 'rv-actions';
  const btn = (label, fn, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rv-act ' + cls;
    b.textContent = label;
    b.addEventListener('click', fn);
    actions.appendChild(b);
    return b;
  };
  btn('Reply', () => replyForm(li, c));
  btn(c.resolved ? 'Reopen' : 'Resolve', () => {
    c.resolved = !c.resolved;
    changed();
  });
  // Two-tap delete, like scripts (no native confirm dialogs).
  const del = btn('Delete', () => {
    if (!del.classList.contains('armed')) {
      del.classList.add('armed');
      del.textContent = 'Delete?';
      setTimeout(() => {
        del.classList.remove('armed');
        del.textContent = 'Delete';
      }, 3000);
      return;
    }
    script.comments = list().filter((x) => x !== c);
    changed();
  }, 'rv-del');
  li.appendChild(actions);
  return li;
}

function replyForm(li, c) {
  if (li.querySelector('.rv-replyform')) return;
  const form = document.createElement('form');
  form.className = 'rv-replyform';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Reply…';
  input.setAttribute('aria-label', 'Reply');
  const send = document.createElement('button');
  send.type = 'submit';
  send.textContent = 'Send';
  form.append(input, send);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    c.replies = c.replies || [];
    c.replies.push({ author: prefs.get('reviewer') || 'You', text, at: Date.now() });
    changed();
  });
  li.insertBefore(form, li.querySelector('.rv-actions'));
  input.focus();
}

/* ---------- Fountain round trip ---------- */

// The open comments on an element as inline Fountain notes.
export function fountainNotes(script, el) {
  return (script.comments || [])
    .filter((c) => c.elId === el.id && !c.resolved)
    .map((c) => {
      const named = (x) => x.author && x.author !== 'You';
      const parts = [c, ...(c.replies || [])].map((x) => (named(x) ? `${x.author}: ${x.text}` : x.text));
      return ' [[' + parts.join(' — ').replace(/\]\]/g, '] ]') + ']]';
    })
    .join('');
}

// Comments from notes found by the Fountain parser: [{ elId, text }].
export function commentsFromNotes(notes, elements) {
  return notes.map(({ elId, text }) => {
    const m = text.match(/^([^:\n]{1,40}):\s*([\s\S]+)$/);
    const el = elements.find((e) => e.id === elId);
    return {
      id: uid(),
      elId,
      quote: el ? el.text : '',
      author: m ? m[1].trim() : '',
      text: (m ? m[2] : text).trim(),
      at: Date.now(),
      resolved: false,
      replies: [],
    };
  });
}
