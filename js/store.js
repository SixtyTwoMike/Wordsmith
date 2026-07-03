// localStorage persistence with debounced autosave.

const KEYS = {
  script: 'wordsmith.script.v1',
  stats: 'wordsmith.stats.v1',
  settings: 'wordsmith.settings.v1',
};

export function load(kind, fallback) {
  try {
    const raw = localStorage.getItem(KEYS[kind]);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    // corrupt or unavailable storage: fall through to fresh state
  }
  return typeof fallback === 'function' ? fallback() : fallback;
}

let pending = {};
let timer = null;

export function save(kind, value) {
  pending[kind] = value;
  clearTimeout(timer);
  timer = setTimeout(flush, 400);
}

export function flush() {
  clearTimeout(timer);
  timer = null;
  for (const [kind, value] of Object.entries(pending)) {
    try {
      localStorage.setItem(KEYS[kind], JSON.stringify(value));
    } catch (e) {
      // quota or private-mode failure: keep the app running
    }
  }
  pending = {};
}

// iOS never fires unload; flush whenever the app goes to background.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});
window.addEventListener('pagehide', flush);
