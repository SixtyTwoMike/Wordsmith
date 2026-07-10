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
- **Multiple scripts** — a scripts sheet to create, switch, rename, duplicate
  and delete; each script learns its own characters/locations independently
- **Scene navigator** — a tap-to-jump outline of every scene, with a live page
  count and 1-page-per-minute runtime estimate
- **Undo / redo** — a bounded history stack with on-screen ↶ ↷ controls
- **Autocomplete** — a leading chip completes a learned character name (or
  scene location) from the prefix you're typing
- **Personae Dramatis** — long-press a character chip to open its profile:
  every appearance (tap to jump there), a line count, and editable notes
  (full name, aliases, relationships, motives). A character and its (V.O.)
  form share one profile
- **Pro TV formatting** — (V.O.)/(O.S.) cues, bracketed scene notations
  ([FLASHBACK], [ARCHIVAL], [SURVEILLANCE]), parenthetical presets, and
  centered act markers (COLD OPEN / ACT ONE / TAG) with a page-window check
  in the outline (acts ~9–12 pp, hour drama ~45–63 pp)
- **Export** — Fountain, PDF (native print), and Word (.docx) — all generated
  with zero runtime dependencies and fully offline
- Auto-saves locally (localStorage); no account, no server
- Installable PWA, works fully offline

## Export, without dependencies

Wordsmith keeps its zero-runtime-dependency, offline-first promise even for
export:

- **Fountain** — a pure-JS plain-text generator; opens in Highland, Slugline,
  Final Draft and more.
- **PDF** — the browser's own print-to-PDF from a dedicated print stylesheet
  (real page breaks). On iPhone: Print → pinch out → Share to Files.
- **Word (.docx)** — generated in pure JS via a tiny store-method ZIP writer
  (`js/zip.js`) plus hand-written WordprocessingML. A `.docx` is just a ZIP of
  XML, so no library is needed.

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

- `js/model.js` — element types, Enter/Tab transition tables, page estimator, text helpers
- `js/editor.js` — block-based editor with a single roving textarea; undo/redo
- `js/quickbar.js` — context-sensitive chips and one-tap insert behaviors
- `js/suggest.js` — usage stats, recency-weighted ranking, manual override, prefix match
- `js/scripts.js` — multi-script catalog (create/switch/rename/duplicate/delete)
- `js/switcher.js` — scripts sheet UI
- `js/navigator.js` — scene outline, page/runtime, act-structure check
- `js/characters.js` + `js/profile.js` — Personae Dramatis registry and overlay
- `js/export.js` + `js/zip.js` — Fountain / PDF / DOCX export
- `js/settings.js` — learned/manual toggle and set-list editor
- `js/store.js` — debounced localStorage autosave + v1→v2 migration
- `sw.js`, `manifest.webmanifest` — offline app shell + install metadata
