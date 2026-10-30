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
- Final Draft-style flow: Enter advances to the natural next element (a
  scene heading goes straight to a character cue),
  Enter on an empty line switches element type, Tab (or the type chip) cycles
- Two-row quick bar: context-aware scene tools on top (INT./EXT. + recent
  locations + DAY/NIGHT, transitions, parentheticals, act markers) and an
  always-on row of the script's characters nearest the thumb
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
- **Export** — Fountain, PDF, Word (.docx) and Print — all generated with
  zero runtime dependencies and fully offline. The PDF is written directly
  (base-14 Courier, US Letter) with a title page, keep-with-next for scene
  headings and cues, (MORE)/(CONT'D) speech splits and page numbers. On
  iPhone, exports open the share sheet (Save to Files, Mail, AirDrop…)
- **Scene Snippet** — share a scene (or its page) as an image for Instagram,
  Threads, Bluesky and more: 4:5, square or story sizes in Paper or Night,
  with generated alt text and a caption, each one tap to copy
- **Fountain import** — open a `.fountain` file from Files (Highland, Slugline,
  Final Draft exports) as a new script; its characters and locations become
  chips straight away
- **PDF import** — open a screenplay PDF (Final Draft, Highland, WriterDuet,
  Fade In or Wordsmith's own) and get editable elements back: each line is
  classified by its indent, page/scene numbers, (MORE) and CONTINUED are
  dropped, and speeches split across pages are rejoined. Uses a vendored
  pdf.js (Apache-2.0), loaded only when a PDF is imported and cached for
  offline use. Scanned PDFs (no text layer) are refused with an explanation
- **Title page** — written by, based on, draft date and contact, included in
  every export
- **Backup & restore** — one JSON file holding every script with its learned
  chips and character profiles; restoring merges and never overwrites
- **Liquid Glass look** — floating translucent bars and sheets
- **Web / desktop** — on wider windows the script sits on a centred,
  page-width column with matching bars and sheets as centred panels (Esc
  closes them). Keyboard: Enter/Tab flow as on iPhone, ⌘/Ctrl+1–7 set the
  element type (Scene, Action, Character, Parenthetical, Dialogue,
  Transition, Act marker — Final Draft's numbering), ⌘Z / ⇧⌘Z (Ctrl+Y)
  undo and redo across blocks. Mouse: hover states and tooltips, the
  wheel scrolls chip rows, right-click a character for its profile.
  Exports download instead of opening the share sheet
- **Timeline dial** (wide desktop windows) — a ruler down the left of the
  page: page ticks with numbers, half/quarter-page ticks, scene and act
  marks, sliding past a fixed needle as you scroll. Drag to scrub, click a
  scene to jump, ⌥↑/⌥↓ for the previous/next scene. Scene labels show the
  place and the opening action; hover for the full heading, page, more of
  the description and who's in it. Pages match the PDF
  export, as does the header page count
- **Timeline on iPhone** — the same dial in a drawer behind a pull-tab on
  the left edge: tap the tab to open it (dragging it open works in the
  installed Home Screen app; in Safari an edge swipe is the browser's Back
  gesture, so it's left alone), drag the dial to scrub, tap a scene to
  jump, and swipe left or tap the page to close
- **Keyboard character picks** — Option/Alt+1–9 picks a character from
  the character row (hold Option to see the numbers); on a character line,
  type a few letters and Enter accepts the suggested name and moves to
  dialogue (Esc dismisses it)
- **Themes** — Auto (follows the system light/dark setting), Paper, Night,
  Sepia, Midnight and High contrast (solid surfaces, no translucency)
- **Home Screen app** — install steps in Settings, and a choice of five app
  icons (Classic, Paper, Glass, Midnight, Typewriter) picked before adding
  to the Home Screen
- **Review comments** — pin comments to any line (a margin marker shows
  where), reply, resolve/reopen and delete, filter Open/Resolved/All, and
  tap a comment to jump to its line. Comments travel with backups and
  duplicates, and round-trip through Fountain as `[[Name: note]]`, so a
  reviewer can mark up the .fountain in Highland or Slugline and send it back
- Auto-saves locally (localStorage); no account, no server
- Installable PWA, works fully offline

## Export, without dependencies

Wordsmith keeps its zero-runtime-dependency, offline-first promise even for
export:

- **Fountain** — a pure-JS plain-text generator; opens in Highland, Slugline,
  Final Draft and more.
- **PDF** — a hand-written PDF 1.4 file (`js/pdf.js`) using the PDF
  standard Courier faces, so no font needs embedding. **Print** still uses
  the browser's print dialog with a dedicated print stylesheet.
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
npm run icons          # regenerate PNG icons from the icons/*.svg designs
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
- `js/export.js` + `js/zip.js` — Fountain / PDF / DOCX export, title page
- `js/fountain.js` — Fountain import parser
- `js/backup.js` — full backup / restore of every script
- `js/layout.js` — screenplay line layout shared by the PDF and snippets
- `js/pdf.js` — zero-dependency PDF writer and paginator
- `js/snippet.js` — Scene Snippet image, alt text and sharing
- `js/settings.js` — theme, app icon and install help; learned/manual toggle and set-list editor
- `js/prefs.js` — app-wide preferences (theme, icon, reviewer name)
- `js/review.js` — review comments, the Review sheet and Fountain note round trip
- `js/store.js` — debounced localStorage autosave + v1→v2 migration
- `sw.js`, `manifest.webmanifest` — offline app shell + install metadata
