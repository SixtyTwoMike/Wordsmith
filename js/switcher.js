// Scripts sheet: list every script, switch between them, and create,
// rename, duplicate or delete. Decoupled from storage — the controller
// object passed to init() supplies the data and performs the mutations.

let sheet;
let cfg;

export function init(config) {
  cfg = config;
  sheet = document.getElementById('scriptsSheet');
  build();
  document.getElementById('openScripts').addEventListener('click', open);
}

function open() {
  render();
  sheet.hidden = false;
}

function close() {
  sheet.hidden = true;
}

function build() {
  sheet.innerHTML = `
    <div class="sheet-head">
      <h2>Scripts</h2>
      <button id="closeScripts" class="btn-done">Done</button>
    </div>
    <div class="sheet-body">
      <button id="newScript" class="btn-primary">+ New Script</button>
      <button id="exportBtn" class="btn-secondary">⬆ Export current script</button>
      <ul id="scriptList" class="script-list"></ul>
    </div>`;
  sheet.querySelector('#closeScripts').addEventListener('click', close);
  sheet.querySelector('#newScript').addEventListener('click', () => {
    cfg.onNew();
    close();
  });
  sheet.querySelector('#exportBtn').addEventListener('click', () => {
    close();
    cfg.onExport();
  });
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function render() {
  const listEl = sheet.querySelector('#scriptList');
  const items = cfg.list();
  const curId = cfg.currentId();
  listEl.replaceChildren(...items.map((m) => row(m, curId)));
}

function row(m, curId) {
  const li = document.createElement('li');
  li.className = 'script-row' + (m.id === curId ? ' current' : '');
  li.dataset.id = m.id;

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'script-open';
  open.innerHTML = `<span class="script-title"></span><span class="script-meta"></span>`;
  open.querySelector('.script-title').textContent = m.title || 'Untitled Script';
  open.querySelector('.script-meta').textContent =
    (m.id === curId ? 'Current · ' : '') + fmtDate(m.updatedAt);
  open.addEventListener('click', () => {
    cfg.onOpen(m.id);
    close();
  });
  li.appendChild(open);

  const actions = document.createElement('div');
  actions.className = 'script-actions';
  actions.appendChild(
    iconBtn('✎', `Rename ${m.title || 'script'}`, () => startRename(li, m))
  );
  actions.appendChild(
    iconBtn('⧉', `Duplicate ${m.title || 'script'}`, () => {
      cfg.onDuplicate(m.id);
      close();
    })
  );
  actions.appendChild(deleteBtn(m));
  li.appendChild(actions);
  return li;
}

function iconBtn(text, label, act) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'script-act';
  b.textContent = text;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', act);
  return b;
}

// Two-tap delete so a stray tap can't destroy a script (and no native
// confirm() dialog, which would block automated tests).
function deleteBtn(m) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'script-act script-del';
  b.textContent = '🗑';
  b.setAttribute('aria-label', `Delete ${m.title || 'script'}`);
  let armed = false;
  let t = null;
  b.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      b.textContent = 'Delete?';
      b.classList.add('armed');
      t = setTimeout(() => {
        armed = false;
        b.textContent = '🗑';
        b.classList.remove('armed');
      }, 3000);
      return;
    }
    clearTimeout(t);
    cfg.onDelete(m.id);
    render();
  });
  return b;
}

function startRename(li, m) {
  const open = li.querySelector('.script-open');
  const form = document.createElement('form');
  form.className = 'script-rename';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = m.title || '';
  input.setAttribute('aria-label', 'Script name');
  input.placeholder = 'Untitled Script';
  const save = document.createElement('button');
  save.type = 'submit';
  save.textContent = 'Save';
  form.appendChild(input);
  form.appendChild(save);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    cfg.onRename(m.id, input.value.trim());
    render();
  });
  li.replaceChild(form, open);
  input.focus();
  input.select();
}
