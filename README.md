# Wordsmith

Screenwriting under your thumb. Wordsmith is a mobile-first screenplay editor
built as an installable PWA for iPhone: standard screenplay formatting with the
common inputs — character names, scene headings, transitions — one tap away in
a quick bar docked above the keyboard.

## The core idea

While you write, Wordsmith learns which characters, locations, and transitions
you use most (recency-weighted) and surfaces them as chips in thumb reach.
Tap a character chip and the app inserts a correctly formatted CHARACTER line
and drops the cursor straight into a new dialogue line — one tap from action
to that character's next line. Prefer full control? Switch the quick bar to
"My set list" in settings and pin exactly the chips you want, in your order.

## Features

- Full screenplay element formatting: Scene Heading, Action, Character,
  Parenthetical, Dialogue, Transition — Courier, correct case and indents
- Final Draft-style flow: Enter advances to the natural next element,
  Enter on an empty line switches element type, Tab (or the type chip) cycles
- Context-aware quick bar: character chips, INT./EXT. + recent locations +
  DAY/NIGHT for scene headings, transition chips
- Learned suggestions with a manual "set list" override (add/remove/reorder)
- Auto-saves locally (localStorage); no account, no server
- Installable PWA, works fully offline

## Run it

```sh
npm install
npm run serve          # http://localhost:4173
```

On iPhone: open the URL in Safari (serve it over HTTPS or on-device), then
Share → Add to Home Screen for the standalone app experience.

## Develop

```sh
npm test               # Playwright e2e suite at iPhone viewport (390x844)
npm run icons          # regenerate PNG icons from icons/icon.svg
```

Plain ES modules, no build step, no runtime dependencies. The only dev
dependency is `@playwright/test`.

## Layout

- `js/model.js` — element types, Enter/Tab transition tables, text helpers
- `js/editor.js` — block-based editor with a single roving textarea
- `js/quickbar.js` — context-sensitive chips and one-tap insert behaviors
- `js/suggest.js` — usage stats, recency-weighted ranking, manual override
- `js/settings.js` — learned/manual toggle and set-list editor
- `js/store.js` — debounced localStorage autosave
- `sw.js`, `manifest.webmanifest` — offline app shell + install metadata
