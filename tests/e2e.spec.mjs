import { test, expect } from '@playwright/test';
import fs from 'node:fs';

async function getBlocks(page) {
  return page.$$eval('#page .el', (els) =>
    els.map((div) => {
      const type = [...div.classList].find((c) => c.startsWith('el-')).slice(3);
      const ta = div.querySelector('textarea');
      const pin = div.querySelector('.note-pin');
      return {
        type,
        text: ta ? ta.value : div.textContent.slice(pin ? pin.textContent.length : 0),
        active: div.classList.contains('active'),
      };
    })
  );
}

// Both quick-bar rows: scene/formatting tools on top, characters below.
function chipTexts(page) {
  return page.$$eval('.qb-chips .chip', (cs) => cs.map((c) => c.textContent.trim()));
}

function charChipTexts(page) {
  return page.$$eval('#charChips .chip', (cs) => cs.map((c) => c.textContent.trim()));
}

function chipNamed(page, label) {
  return page.locator(`.qb-chips .chip:text-is("${label}")`);
}

async function startScene(page, heading = 'INT. DINER - NIGHT') {
  await page.goto('/');
  await page.locator('#page .el').first().click();
  await page.keyboard.type(heading);
  await page.keyboard.press('Enter'); // scene -> character
  await page.keyboard.press('Enter'); // empty character -> action
}

// Type a character + one dialogue line, ending focused on a fresh action block.
async function speak(page, name, line) {
  await page.keyboard.press('Tab'); // action -> character
  await page.keyboard.type(name);
  await page.keyboard.press('Enter'); // -> dialogue (commits character)
  await page.keyboard.type(line);
  await page.keyboard.press('Enter'); // -> action
}

// Press and hold long enough to trigger a long-press (>500ms). page.mouse
// doesn't auto-scroll, so bring the chip into the row's view first.
async function longPress(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
}

test('screenplay formatting and enter flow', async ({ page }) => {
  await startScene(page);
  await page.keyboard.type('Sarah wipes the counter.');

  const blocks = await getBlocks(page);
  expect(blocks[0].type).toBe('scene');
  expect(blocks[0].text).toBe('INT. DINER - NIGHT');
  expect(blocks[1].type).toBe('action');
  expect(blocks[1].text).toBe('Sarah wipes the counter.');
  expect(blocks[1].active).toBe(true);
  await expect(page.locator('#blockInput')).toBeFocused();
});

test('character chip inserts formatted character + dialogue in one tap', async ({ page }) => {
  await startScene(page);
  await speak(page, 'Sarah', 'We open at six.');

  // Now on an empty action block: the quick bar should offer SARAH.
  await expect(chipNamed(page, 'SARAH')).toBeVisible();
  await chipNamed(page, 'SARAH').click();

  let blocks = await getBlocks(page);
  const n = blocks.length;
  expect(blocks[n - 2]).toMatchObject({ type: 'character', text: 'SARAH' });
  expect(blocks[n - 1].type).toBe('dialogue');
  expect(blocks[n - 1].active).toBe(true);
  await expect(page.locator('#blockInput')).toBeFocused();

  // Typing goes straight into the dialogue line.
  await page.keyboard.type('Coffee?');
  blocks = await getBlocks(page);
  expect(blocks[n - 1].text).toBe('Coffee?');
});

test('chip order adapts to usage and recency', async ({ page }) => {
  await startScene(page);
  await speak(page, 'Mike', 'Morning.');
  await speak(page, 'Sarah', 'Hey.');

  // Boost SARAH via chip taps (each tap = one committed character block).
  for (const line of ['One.', 'Two.']) {
    await chipNamed(page, 'SARAH').click();
    await page.keyboard.type(line);
    await page.keyboard.press('Enter'); // dialogue -> action
  }

  let texts = await chipTexts(page);
  expect(texts.indexOf('SARAH')).toBeLessThan(texts.indexOf('MIKE'));

  // Now boost MIKE past SARAH.
  for (const line of ['A.', 'B.', 'C.', 'D.']) {
    await chipNamed(page, 'MIKE').click();
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
  }

  texts = await chipTexts(page);
  expect(texts.indexOf('MIKE')).toBeLessThan(texts.indexOf('SARAH'));
});

test('manual set list overrides learned suggestions', async ({ page }) => {
  await startScene(page);
  await speak(page, 'Sarah', 'Hello.');

  await page.locator('#openSettings').click();
  await page.locator('#modeSeg button[data-mode="manual"]').click();

  // Manual lists are prefilled from learned usage; make it exactly [BOB].
  const chars = page.locator('#manualLists section[data-cat="characters"]');
  await chars.locator('button[aria-label="Remove SARAH"]').click();
  await chars.locator('input').fill('Bob');
  await chars.locator('form button').click();
  await page.locator('#closeSettings').click();

  let texts = await chipTexts(page);
  expect(texts).toContain('BOB');
  expect(texts).not.toContain('SARAH');

  // Toggle back to learned: SARAH returns, BOB is gone.
  await page.locator('#openSettings').click();
  await page.locator('#modeSeg button[data-mode="learned"]').click();
  await page.locator('#closeSettings').click();

  texts = await chipTexts(page);
  expect(texts).toContain('SARAH');
  expect(texts).not.toContain('BOB');
});

test('autosave persists script, stats and settings across reload', async ({ page }) => {
  await startScene(page);
  await speak(page, 'Sarah', 'We open at six.');
  await page.keyboard.type('She flips the sign.');
  await page.waitForTimeout(600); // let the debounced autosave flush

  await page.reload();

  const blocks = await getBlocks(page);
  expect(blocks.map((b) => [b.type, b.text])).toEqual([
    ['scene', 'INT. DINER - NIGHT'],
    ['character', 'SARAH'],
    ['dialogue', 'We open at six.'],
    ['action', 'She flips the sign.'],
  ]);

  // Stats survived too: SARAH still suggested from an action context.
  await page.locator('#page .el').last().click();
  await expect(chipNamed(page, 'SARAH')).toBeVisible();
});

test('empty-enter cycles type; transition chip inserts transition + scene', async ({ page }) => {
  await startScene(page);
  await speak(page, 'Sarah', 'Closing time.');

  // On the empty action block, Enter is a no-op type-wise; Tab cycles to
  // character, and Enter on the empty character cycles back to action.
  await page.keyboard.press('Tab');
  let blocks = await getBlocks(page);
  expect(blocks.at(-1).type).toBe('character');
  await page.keyboard.press('Enter');
  blocks = await getBlocks(page);
  expect(blocks.at(-1).type).toBe('action');

  await chipNamed(page, 'CUT TO:').click();
  blocks = await getBlocks(page);
  expect(blocks.at(-2)).toMatchObject({ type: 'transition', text: 'CUT TO:' });
  expect(blocks.at(-1).type).toBe('scene');
  expect(blocks.at(-1).active).toBe(true);
});

test('service worker caches the app shell for offline use', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(async () => {
    const keys = await caches.keys();
    for (const key of keys) {
      const cache = await caches.open(key);
      if ((await cache.match('index.html')) && (await cache.match('js/app.js'))) return true;
    }
    return false;
  });

  await page.reload(); // page is now controlled by the SW
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#quickbar')).toBeVisible();
  await expect(page.locator('#page .el').first()).toBeVisible();
  await context.setOffline(false);
});

test('scripts are isolated and switchable', async ({ page }) => {
  await page.goto('/');
  await page.locator('#title').fill('First');
  await page.locator('#page .el').first().click();
  await page.keyboard.type('INT. DINER - NIGHT');
  await page.keyboard.press('Enter'); // -> character
  await page.keyboard.press('Enter'); // empty character -> action
  await speak(page, 'Sarah', 'Hello.');
  await expect(chipNamed(page, 'SARAH')).toBeVisible();

  // Create a second script — it starts empty and hasn't learned SARAH.
  await page.locator('#openScripts').click();
  await page.locator('#newScript').click();
  await page.locator('#title').fill('Second');
  let blocks = await getBlocks(page);
  expect(blocks.length).toBe(1);
  expect(blocks[0].text).toBe('');

  await page.locator('#page .el').first().click();
  await page.keyboard.type('INT. OFFICE - DAY');
  await page.keyboard.press('Enter'); // character context
  await expect(chipNamed(page, 'SARAH')).toHaveCount(0);

  // Switch back to First: its blocks and learned SARAH return.
  await page.locator('#openScripts').click();
  await page.locator('.script-row', { hasText: 'First' }).locator('.script-open').click();
  blocks = await getBlocks(page);
  expect(blocks[0].text).toBe('INT. DINER - NIGHT');
  await page.locator('#page .el').nth(3).click(); // trailing action block
  await expect(chipNamed(page, 'SARAH')).toBeVisible();
});

test('duplicate copies content and learned stats; delete removes a script', async ({ page }) => {
  await page.goto('/');
  await page.locator('#title').fill('Original');
  await page.locator('#page .el').first().click();
  await page.keyboard.type('INT. DINER - NIGHT');
  await page.keyboard.press('Enter'); // -> character
  await page.keyboard.press('Enter'); // empty character -> action
  await speak(page, 'Sarah', 'Hello.');

  // Duplicate.
  await page.locator('#openScripts').click();
  await page.locator('.script-row', { hasText: 'Original' })
    .locator('button[aria-label^="Duplicate"]').click();
  await expect(page.locator('#title')).toHaveValue('Original copy');

  // The copy carries the content and the learned SARAH stat.
  let blocks = await getBlocks(page);
  expect(blocks[0].text).toBe('INT. DINER - NIGHT');
  await page.locator('#page .el').nth(3).click();
  await expect(chipNamed(page, 'SARAH')).toBeVisible();

  // Delete the copy (two-tap confirm), landing back on a remaining script.
  await page.locator('#openScripts').click();
  const del = page.locator('.script-row', { hasText: 'Original copy' })
    .locator('button[aria-label^="Delete"]');
  await del.click();
  await del.click();
  await expect(page.locator('.script-row', { hasText: 'Original copy' })).toHaveCount(0);
  await expect(page.locator('.script-row', { hasText: 'Original' })).toHaveCount(1);
});

test('scene navigator lists headings and jumps to them', async ({ page }) => {
  await startScene(page, 'INT. DINER - NIGHT');
  await page.keyboard.type('Sarah enters.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('EXT. STREET - DAY'); // auto-detects to a scene

  await page.locator('#openOutline').click();
  const items = page.locator('#sceneList .scene-jump');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('INT. DINER - NIGHT');
  await expect(items.nth(1)).toContainText('EXT. STREET - DAY');

  await items.nth(0).click(); // jump to the first scene
  const blocks = await getBlocks(page);
  expect(blocks[0].type).toBe('scene');
  expect(blocks[0].active).toBe(true);
});

test('page count grows with content', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#pageCount')).toHaveText('1');
  await page.locator('#page .el').first().click();
  await page.keyboard.type('INT. DINER - NIGHT');
  await page.keyboard.press('Enter');
  for (let i = 0; i < 50; i++) {
    await page.keyboard.type('The rain falls hard on the tin roof again tonight.');
    await page.keyboard.press('Enter');
  }
  await expect
    .poll(async () => Number(await page.locator('#pageCount').textContent()))
    .toBeGreaterThan(1);
});

test('undo and redo step through edits', async ({ page }) => {
  await startScene(page);
  await page.waitForTimeout(500); // checkpoint: [scene, empty action]
  await page.keyboard.type('Sarah wipes the counter.');
  await page.waitForTimeout(500); // checkpoint: action has text
  await page.keyboard.press('Enter');
  await page.keyboard.type('She pauses.');
  await page.waitForTimeout(500); // checkpoint: new block with text

  let blocks = await getBlocks(page);
  expect(blocks.length).toBe(3);

  await page.locator('#undoBtn').click();
  blocks = await getBlocks(page);
  expect(blocks.length).toBe(2);
  expect(blocks.map((b) => b.text)).toContain('Sarah wipes the counter.');
  expect(blocks.some((b) => b.text === 'She pauses.')).toBe(false);

  await page.locator('#redoBtn').click();
  blocks = await getBlocks(page);
  expect(blocks.length).toBe(3);
  expect(blocks.some((b) => b.text === 'She pauses.')).toBe(true);
});

test('autocomplete completes a learned character name', async ({ page }) => {
  await startScene(page);
  await speak(page, 'Reddington', 'Talk to me.'); // learns REDDINGTON

  await page.keyboard.press('Tab'); // action -> character
  await page.keyboard.type('RED');

  const sugg = page.locator('#charChips .chip-suggest');
  await expect(sugg).toHaveText('REDDINGTON');
  await sugg.click();

  const active = (await getBlocks(page)).find((b) => b.active);
  expect(active.type).toBe('character');
  expect(active.text).toBe('REDDINGTON');
});

test('exports the current script as Fountain', async ({ page }) => {
  await startScene(page); // scene INT. DINER - NIGHT, on empty action
  await page.keyboard.type('Sarah wipes the counter.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('THE LIGHTS GO OUT.'); // all-caps action
  await page.keyboard.press('Enter');
  await speak(page, 'Sarah', 'We open at six.'); // SARAH + dialogue, trailing action
  await chipNamed(page, 'CUT TO:').click(); // transition + new scene
  await page.locator('#title').fill('Night Shift');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.locator('#openScripts').click();
      await page.locator('#exportBtn').click();
      await page.locator('.export-fmt[data-fmt="fountain"]').click();
    })(),
  ]);

  expect(download.suggestedFilename()).toBe('night-shift.fountain');
  const text = fs.readFileSync(await download.path(), 'utf8');

  expect(text).toContain('Title: Night Shift');
  expect(text).toContain('INT. DINER - NIGHT');
  expect(text).toContain('Sarah wipes the counter.');
  expect(text).toContain('!THE LIGHTS GO OUT.'); // all-caps action forced
  expect(text).toContain('SARAH\nWe open at six.'); // cue attached to its dialogue
  expect(text).toContain('> CUT TO:'); // forced transition
});

test('a new edit after undo abandons the redo branch', async ({ page }) => {
  await startScene(page);
  await page.waitForTimeout(500);
  await page.keyboard.type('AAA');
  await page.waitForTimeout(500); // checkpoint: action = AAA
  await page.keyboard.press('Enter');
  await page.keyboard.type('BBB');
  await page.waitForTimeout(500); // checkpoint: new block BBB

  await page.locator('#undoBtn').click(); // back to the AAA state
  let blocks = await getBlocks(page);
  expect(blocks.some((b) => b.text === 'BBB')).toBe(false);

  // Type a new edit immediately (no debounce wait) then hit redo: the new
  // edit must survive and the old BBB branch must not come back.
  await page.locator('#page .el').nth(1).click();
  await page.keyboard.type('ZZZ');
  await page.locator('#redoBtn').click();

  blocks = await getBlocks(page);
  const text = blocks.map((b) => b.text).join('|');
  expect(text).toContain('ZZZ');
  expect(blocks.some((b) => b.text === 'BBB')).toBe(false);
});

test('long-press a character chip opens its profile; edit and jump work', async ({ page }) => {
  await startScene(page);
  await speak(page, 'Sarah', 'We open at six.'); // SARAH cue #1
  await chipNamed(page, 'SARAH').click(); // SARAH cue #2 + empty dialogue
  await page.keyboard.type('And we close at six.');

  const chip = page.locator('#charChips .chip-char', { hasText: 'SARAH' }).first();
  await longPress(page, chip);

  await expect(page.locator('#profileSheet')).toBeVisible();
  await expect(page.locator('#profileSheet .profile-name')).toHaveText('SARAH');
  await expect(page.locator('#profileSheet .appearance-jump')).toHaveCount(2);

  // Edit metadata; it autosaves to the per-script character registry.
  await page.locator('#profileSheet .profile-field input').first().fill('Sarah Connor');
  await page.waitForTimeout(500);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('wordsmith.characters.v1'))
  );
  expect(Object.values(saved)[0].SARAH.fullName).toBe('Sarah Connor');

  // Jump to the first appearance.
  await page.locator('#profileSheet .appearance-jump').first().click();
  await expect(page.locator('#profileSheet')).toBeHidden();
  const active = (await getBlocks(page)).find((b) => b.active);
  expect(active.type).toBe('character');
  expect(active.text).toBe('SARAH');
});

test('a character and its (V.O.) form share one profile', async ({ page }) => {
  await startScene(page);
  await speak(page, 'Sarah', 'Present tense.'); // SARAH
  await page.keyboard.press('Tab'); // action -> character
  await page.keyboard.type('SARAH (V.O.)');
  await page.keyboard.press('Enter'); // -> dialogue
  await page.keyboard.type('Voice of memory.');

  const chip = page.locator('#charChips .chip-char', { hasText: 'SARAH' }).first();
  await longPress(page, chip);

  await expect(page.locator('#profileSheet .profile-name')).toHaveText('SARAH');
  // Both the plain cue and the (V.O.) cue count as appearances of SARAH.
  await expect(page.locator('#profileSheet .appearance-jump')).toHaveCount(2);
  await expect(page.locator('#profileSheet .profile-stats')).toContainText('2 appearances');
});

async function buildDinerScene(page) {
  await startScene(page); // scene INT. DINER - NIGHT, on empty action
  await page.keyboard.type('Sarah wipes the counter.');
  await page.keyboard.press('Enter');
  await speak(page, 'Sarah', 'We open at six.');
  await page.locator('#title').fill('Night Shift');
}

async function openExport(page) {
  await page.locator('#openScripts').click();
  await page.locator('#exportBtn').click();
}

test('exports a valid .docx (pure-JS ZIP) with the script text', async ({ page }) => {
  await buildDinerScene(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await openExport(page);
      await page.locator('.export-fmt[data-fmt="docx"]').click();
    })(),
  ]);

  expect(download.suggestedFilename()).toBe('night-shift.docx');
  const buf = fs.readFileSync(await download.path());
  // ZIP magic bytes.
  expect(buf[0]).toBe(0x50);
  expect(buf[1]).toBe(0x4b);
  // Store method = uncompressed, so the XML parts and text appear verbatim.
  const asText = buf.toString('latin1');
  expect(asText).toContain('word/document.xml');
  expect(asText).toContain('[Content_Types].xml');
  expect(asText).toContain('INT. DINER - NIGHT');
  expect(asText).toContain('We open at six.');
  expect(asText).toContain('w:document');
});

test('PDF export builds a print document with formatted screenplay', async ({ page }) => {
  // Headless print() returns at once and fires afterprint, which removes the
  // frame before we can read it; stub it out in every frame.
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await buildDinerScene(page);
  await openExport(page);
  await page.locator('.export-fmt[data-fmt="print"]').click();

  // The print iframe holds the full formatted HTML in its srcdoc.
  const html = await page
    .locator('#wsPrintFrame')
    .getAttribute('srcdoc', { timeout: 5000 });
  expect(html).toContain('INT. DINER - NIGHT');
  expect(html).toContain('class="el scene"');
  expect(html).toContain('class="el character"');
  expect(html).toContain('We open at six.');
});

test('V.O./O.S. cue, scene notation, and parenthetical presets', async ({ page }) => {
  await startScene(page); // scene INT. DINER - NIGHT, on empty action

  // Scene notation: go back to the scene block and tag it.
  await page.locator('#page .el').first().click();
  await chipNamed(page, '[FLASHBACK]').click();
  let blocks = await getBlocks(page);
  expect(blocks[0].text).toBe('INT. DINER - NIGHT [FLASHBACK]');

  // Character V.O. cue (uppercase is applied on commit).
  await page.locator('#page .el').nth(1).click(); // action block
  await page.keyboard.press('Tab'); // -> character
  await page.keyboard.type('Sarah');
  await chipNamed(page, '(V.O.)').click();
  await page.keyboard.press('Enter'); // commit character -> dialogue
  blocks = await getBlocks(page);
  const charBlock = blocks.find((b) => b.type === 'character');
  expect(charBlock.text).toBe('SARAH (V.O.)');

  // Parenthetical preset from the dialogue block.
  await page.keyboard.type('We open at six.');
  await chipNamed(page, '(beat)').click();
  blocks = await getBlocks(page);
  const paren = blocks.find((b) => b.type === 'paren');
  expect(paren).toBeTruthy();
  expect(paren.text).toBe('beat');
});

test('act markers: auto-detect, outline act-length check, Fountain centering', async ({ page }) => {
  await startScene(page); // scene INT. DINER - NIGHT, on empty action
  await page.keyboard.type('COLD OPEN'); // action auto-detects to marker
  let active = (await getBlocks(page)).find((b) => b.active);
  expect(active.type).toBe('marker');
  expect(active.text).toBe('COLD OPEN');

  await page.keyboard.press('Enter'); // marker -> scene
  expect((await getBlocks(page)).at(-1).type).toBe('scene');
  await page.keyboard.type('INT. ROOM - DAY');
  await page.keyboard.press('Enter'); // -> character
  await page.keyboard.press('Enter'); // empty character -> action
  await page.keyboard.type('ACT ONE'); // -> marker
  await page.keyboard.press('Enter'); // -> scene
  await page.keyboard.type('EXT. STREET - DAY');

  // Outline shows an act-structure breakdown with a short-act warning.
  await page.locator('#openOutline').click();
  const rows = page.locator('#actStructure .act-row');
  await expect(rows).toHaveCount(3); // COLD OPEN, ACT ONE, TOTAL
  await expect(page.locator('#actStructure')).toContainText('COLD OPEN');
  await expect(page.locator('#actStructure')).toContainText('ACT ONE');
  await expect(page.locator('#actStructure')).toContainText('TOTAL');
  await expect(page.locator('#actStructure .act-row.warn').first()).toContainText('⚠');
  await page.locator('#closeOutline').click();

  // Fountain centers markers with the > TEXT < form.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.locator('#openScripts').click();
      await page.locator('#exportBtn').click();
      await page.locator('.export-fmt[data-fmt="fountain"]').click();
    })(),
  ]);
  const text = fs.readFileSync(await download.path(), 'utf8');
  expect(text).toContain('> COLD OPEN <');
  expect(text).toContain('> ACT ONE <');
});

test('migrates v1 single-script storage to the v2 catalog', async ({ page }) => {
  // Seed legacy v1 keys before any app code runs (addInitScript executes
  // ahead of the page's own scripts), so migration sees them on first load.
  await page.addInitScript(() => {
    if (localStorage.getItem('__seeded__')) return;
    localStorage.clear();
    localStorage.setItem(
      'wordsmith.script.v1',
      JSON.stringify({
        id: 'default',
        title: 'Legacy',
        updatedAt: Date.now(),
        elements: [
          { id: 'a', type: 'scene', text: 'INT. OLD ROOM - DAY' },
          { id: 'b', type: 'action', text: 'Dust everywhere.' },
        ],
      })
    );
    localStorage.setItem(
      'wordsmith.stats.v1',
      JSON.stringify({
        characters: { GHOST: { count: 3, lastUsed: Date.now() } },
        locations: {},
        transitions: {},
      })
    );
    localStorage.setItem('__seeded__', '1');
  });
  await page.goto('/');

  const blocks = await getBlocks(page);
  expect(blocks.map((b) => [b.type, b.text])).toEqual([
    ['scene', 'INT. OLD ROOM - DAY'],
    ['action', 'Dust everywhere.'],
  ]);
  await expect(page.locator('#title')).toHaveValue('Legacy');

  // Legacy learned stats survived the migration.
  await page.locator('#page .el').nth(1).click();
  await expect(chipNamed(page, 'GHOST')).toBeVisible();

  // The legacy key is gone and the v2 index exists.
  const legacy = await page.evaluate(() => localStorage.getItem('wordsmith.script.v1'));
  expect(legacy).toBeNull();
  const index = await page.evaluate(() => localStorage.getItem('wordsmith.scriptIndex.v1'));
  expect(index).not.toBeNull();
});

const SAMPLE_FOUNTAIN = `Title: The Long Night
Credit: Written by
Author: Jo Writer
Draft date: First Draft
Contact:
    jo@example.com
    555-0100

> COLD OPEN <

INT. DINER - NIGHT #1#

Sarah wipes the counter. [[a note to cut]]

SARAH
(quietly)
We open at six.

@McCLANE
Not tonight.

!LOUD NOISE.

CUT TO:

EXT. PARKING LOT - CONTINUOUS
`;

test('imports a Fountain file as a new script with learned chips', async ({ page }) => {
  await page.goto('/');
  await page.locator('#openScripts').click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('#importBtn').click(),
  ]);
  await chooser.setFiles({
    name: 'long-night.fountain',
    mimeType: 'text/plain',
    buffer: Buffer.from(SAMPLE_FOUNTAIN),
  });

  await expect(page.locator('#scriptsSheet')).toBeHidden();
  await expect(page.locator('#title')).toHaveValue('The Long Night');
  const blocks = await getBlocks(page);
  expect(blocks.map((b) => [b.type, b.text])).toEqual([
    ['marker', 'COLD OPEN'],
    ['scene', 'INT. DINER - NIGHT'],
    ['action', 'Sarah wipes the counter.'],
    ['character', 'SARAH'],
    ['paren', '(quietly)'],
    ['dialogue', 'We open at six.'],
    ['character', 'MCCLANE'], // displayed in caps
    ['dialogue', 'Not tonight.'],
    ['action', 'LOUD NOISE.'],
    ['transition', 'CUT TO:'],
    ['scene', 'EXT. PARKING LOT - CONTINUOUS'],
  ]);

  // The imported characters are already chips; the title page came along.
  await page.locator('#page .el').nth(2).click(); // action block
  await page.keyboard.press('Tab'); // -> character
  expect(await chipTexts(page)).toEqual(expect.arrayContaining(['SARAH', 'MCCLANE']));
  await openExport(page);
  await expect(page.locator('#titlePageFields [data-field="author"]')).toHaveValue('Jo Writer');
  await expect(page.locator('#titlePageFields [data-field="contact"]')).toHaveValue(
    'jo@example.com\n555-0100'
  );

  // And the original script is still in the list.
  await page.locator('#closeExport').click();
  await page.locator('#openScripts').click();
  await expect(page.locator('.script-row')).toHaveCount(2);
});

test('title page fields persist and appear in every export', async ({ page }) => {
  await buildDinerScene(page);
  await openExport(page);
  await page.locator('#titlePageFields [data-field="author"]').fill('Jo Writer');
  await page.locator('#titlePageFields [data-field="contact"]').fill('jo@example.com\n555-0100');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.export-fmt[data-fmt="fountain"]').click(),
  ]);
  const text = fs.readFileSync(await download.path(), 'utf8');
  expect(text).toContain(
    'Title: Night Shift\nCredit: Written by\nAuthor: Jo Writer\nContact:\n    jo@example.com\n    555-0100\n\n'
  );

  const [docx] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.export-fmt[data-fmt="docx"]').click(),
  ]);
  const xml = fs.readFileSync(await docx.path()).toString('utf8');
  expect(xml).toContain('Jo Writer');
  expect(xml).toContain('w:type="page"');

  await page.addInitScript(() => {
    window.print = () => {};
  });
  await page.reload();
  await openExport(page);
  await expect(page.locator('#titlePageFields [data-field="author"]')).toHaveValue('Jo Writer');
  await page.locator('.export-fmt[data-fmt="print"]').click();
  const html = await page.locator('#wsPrintFrame').getAttribute('srcdoc');
  expect(html).toContain('<p class="tp-author">Jo Writer</p>');
  expect(html).toContain('<p class="tp-credit">Written by</p>');
});

test('backup downloads every script; restore merges without duplicates', async ({ page }) => {
  await buildDinerScene(page);
  await page.locator('#openScripts').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#backupBtn').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^wordsmith-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const backup = fs.readFileSync(await download.path(), 'utf8');
  const parsed = JSON.parse(backup);
  expect(parsed.format).toBe('wordsmith-backup');
  expect(parsed.scripts).toHaveLength(1);
  expect(parsed.scripts[0].stats.characters).toHaveProperty('SARAH');

  const restore = async (buffer, name = 'backup.json') => {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('#restoreBtn').click(),
    ]);
    await chooser.setFiles({ name, mimeType: 'application/json', buffer });
  };

  // Same device, unchanged: nothing to restore.
  await restore(Buffer.from(backup));
  await expect(page.locator('#fileStatus')).toHaveText('Nothing new to restore.');
  await expect(page.locator('.script-row')).toHaveCount(1);

  // A wiped device: restore brings the script and its learned chips back.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('#openScripts').click();
  await restore(Buffer.from(backup));
  await expect(page.locator('#fileStatus')).toHaveText('Restored 1 script.');
  await expect(page.locator('#title')).toHaveValue('Night Shift');
  await page.locator('#closeScripts').click();
  await page.locator('#page .el').nth(1).click();
  await page.keyboard.press('Tab');
  expect(await chipTexts(page)).toContain('SARAH');

  // A file that isn't a backup is rejected with a message.
  await page.locator('#openScripts').click();
  await restore(Buffer.from('not json'), 'notes.json');
  await expect(page.locator('#fileStatus')).toHaveText('That file isn’t a Wordsmith backup.');
});

test('follows the system dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(19, 20, 24)');
  await page.emulateMedia({ colorScheme: 'light' });
  const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(light).toBe('rgb(247, 245, 239)');
});

test('Enter after a scene heading goes to a character, with names one tap away', async ({ page }) => {
  await startScene(page); // learns nothing yet; ends on action
  await speak(page, 'Sarah', 'We open at six.');
  await page.keyboard.press('Tab'); // action -> character
  await page.keyboard.press('Tab'); // -> transition
  await page.keyboard.press('Tab'); // -> scene
  await page.keyboard.type('EXT. PARKING LOT - NIGHT');
  await page.keyboard.press('Enter');

  let active = (await getBlocks(page)).find((b) => b.active);
  expect(active.type).toBe('character');
  expect(await charChipTexts(page)).toEqual(['SARAH']);

  // Tapping the name fills the cue and drops into dialogue.
  await page.locator('#charChips .chip', { hasText: 'SARAH' }).click();
  const blocks = await getBlocks(page);
  expect(blocks.at(-2)).toMatchObject({ type: 'character', text: 'SARAH' });
  expect(blocks.at(-1)).toMatchObject({ type: 'dialogue', active: true });

  // Enter on an empty character line still escapes to action.
  await page.keyboard.type('Bye.');
  await page.keyboard.press('Enter'); // dialogue -> action
  await page.keyboard.press('Tab'); // -> character
  await page.keyboard.press('Enter');
  active = (await getBlocks(page)).find((b) => b.active);
  expect(active.type).toBe('action');
});

test('quick bar has a scene-tools row above an always-on character row', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#charChips .qb-empty')).toHaveText('Characters you name will appear here');

  await page.locator('#page .el').first().click();
  await page.keyboard.type('INT. DINER - NIGHT');
  expect(await page.$$eval('#chips .chip', (cs) => cs.map((c) => c.textContent))).toEqual(
    expect.arrayContaining(['INT.', 'EXT.', '- DAY', '- NIGHT'])
  );
  await page.keyboard.press('Enter'); // -> character
  await page.keyboard.type('Sarah');
  await page.keyboard.press('Enter'); // -> dialogue
  await page.keyboard.type('Hi.');
  await page.keyboard.press('Enter'); // -> action

  // Action context: scene tools on top, SARAH below, and they don't mix.
  const top = await page.$$eval('#chips .chip', (cs) => cs.map((c) => c.textContent));
  expect(top).toEqual(expect.arrayContaining(['INT.', 'EXT.']));
  expect(top).not.toContain('SARAH');
  expect(await charChipTexts(page)).toEqual(['SARAH']);

  // The character row sits below the tools row.
  const toolsBox = await page.locator('#chips').boundingBox();
  const charsBox = await page.locator('#charChips').boundingBox();
  expect(charsBox.y).toBeGreaterThan(toolsBox.y);
});

test('when framed and the keyboard is undetectable, the quick bar docks at the top', async ({ page }) => {
  await page.goto('/');
  // Load the app inside a frame, as the preview host does.
  await page.setContent('<iframe src="/" style="width:390px;height:700px;border:0"></iframe>');
  const app = page.frameLocator('iframe');
  await app.locator('#page .el').first().click();
  await expect(app.locator('body')).toHaveClass(/qb-top/);
  const bar = await app.locator('#quickbar').boundingBox();
  expect(bar.y).toBeLessThan(200);
});

test('PDF export writes a real PDF file with a title page and screenplay pages', async ({ page }) => {
  await buildDinerScene(page);
  await openExport(page);
  await page.locator('#titlePageFields [data-field="author"]').fill('Jo Writer');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.export-fmt[data-fmt="pdf"]').click(),
  ]);
  expect(download.suggestedFilename()).toBe('night-shift.pdf');
  const pdf = fs.readFileSync(await download.path(), 'latin1');
  expect(pdf.startsWith('%PDF-1.4')).toBe(true);
  expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  expect(pdf).toContain('/Count 2'); // title page + one script page
  expect(pdf).toContain('(NIGHT SHIFT) Tj');
  expect(pdf).toContain('(Jo Writer) Tj');
  expect(pdf).toContain('(INT. DINER - NIGHT) Tj');
  expect(pdf).toContain('(We open at six.) Tj');
  // The cross-reference table points at each object.
  const xref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  expect(pdf.slice(xref, xref + 4)).toBe('xref');
  const first = Number(pdf.slice(xref).split('\n')[3].slice(0, 10));
  expect(pdf.slice(first, first + 7)).toBe('1 0 obj');
});

test('PDF pagination keeps cues with dialogue and splits long speeches', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { paginate, LINES_PER_PAGE } = await import('/js/pdf.js');
    const { layoutLines } = await import('/js/layout.js');
    const els = [{ type: 'scene', text: 'INT. DINER - NIGHT' }];
    for (let i = 0; i < 5; i++) {
      els.push({ type: 'character', text: 'SARAH' });
      els.push({ type: 'dialogue', text: ('Speech ' + i + ' goes on. ').repeat(40) });
    }
    const pages = paginate(layoutLines(els));
    return {
      max: Math.max(...pages.map((p) => p.length)),
      limit: LINES_PER_PAGE,
      tails: pages.map((p) => p.at(-1).text),
      heads: pages.slice(1).map((p) => p[0].text),
      anyBlankTop: pages.some((p) => !p[0].text),
      cueAtFoot: pages.some((p) => p.at(-1).type === 'character'),
    };
  });
  expect(result.max).toBeLessThanOrEqual(result.limit);
  expect(result.tails[0]).toBe('(MORE)');
  expect(result.heads[0]).toBe("SARAH (CONT'D)");
  expect(result.anyBlankTop).toBe(false);
  expect(result.cueAtFoot).toBe(false);
});

test('scene snippet: image, alt text, caption and share options', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await buildDinerScene(page);
  await page.locator('#openOutline').click();
  await page.locator('.scene-share').first().click();

  const sheet = page.locator('#snippetSheet');
  await expect(sheet).toBeVisible();
  const canvas = page.locator('#snippetCanvas');
  expect(await canvas.evaluate((c) => [c.width, c.height])).toEqual([1080, 1350]);

  const alt = await page.locator('#snippetAlt').inputValue();
  expect(alt).toContain('Screenplay scene 1 from “Night Shift”.');
  expect(alt).toContain('INT. DINER - NIGHT');
  expect(alt).toContain('SARAH: We open at six.');
  await expect(page.locator('#altCount')).toHaveText(`${alt.length} characters`);

  await page.locator('#copyAlt').click();
  await expect(page.locator('#snippetStatus')).toHaveText('Alt text copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(alt);

  const caption = await page.locator('#snippetCaption').inputValue();
  expect(caption).toContain('INT. DINER - NIGHT — from “Night Shift”');
  const bsky = await page.locator('#shareBluesky').getAttribute('href');
  expect(bsky).toBe('https://bsky.app/intent/compose?text=' + encodeURIComponent(caption));

  // Formats and themes redraw without losing an edited caption.
  await page.locator('#snippetCaption').fill('My scene');
  await page.locator('.snip-fmt[data-fmt="story"]').click();
  await page.locator('.snip-theme[data-theme="night"]').click();
  expect(await canvas.evaluate((c) => [c.width, c.height])).toEqual([1080, 1920]);
  expect(await canvas.evaluate((c) => Array.from(c.getContext('2d').getImageData(5, 5, 1, 1).data.slice(0, 3)))).toEqual([19, 20, 24]);
  await expect(page.locator('#snippetCaption')).toHaveValue('My scene');

  // Page scope relabels the excerpt.
  await page.locator('.snip-scope[data-scope="page"]').click();
  expect(await page.locator('#snippetAlt').inputValue()).toContain('Screenplay page 1');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#saveSnippet').click(),
  ]);
  expect(download.suggestedFilename()).toBe('night-shift-page-1.png');
  const png = fs.readFileSync(await download.path());
  expect(png.subarray(1, 4).toString()).toBe('PNG');
});

test('themes apply instantly and persist; Auto follows the system', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await bg()).toBe('rgb(19, 20, 24)'); // Auto + dark system

  await page.locator('#openSettings').click();
  await page.locator('.theme-opt[data-theme="sepia"]').click();
  await expect(page.locator('.theme-opt[data-theme="sepia"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('sepia');
  expect(await bg()).toBe('rgb(241, 231, 208)');
  expect(await page.locator('meta[name="theme-color"]').first().getAttribute('content')).toBe('#f1e7d0');

  // A forced light theme wins over the dark system setting, and survives reload.
  await page.locator('.theme-opt[data-theme="paper"]').click();
  await page.waitForTimeout(500);
  await page.reload();
  expect(await bg()).toBe('rgb(247, 245, 239)');

  await page.locator('#openSettings').click();
  await page.locator('.theme-opt[data-theme="midnight"]').click();
  expect(await bg()).toBe('rgb(13, 20, 36)');
  await page.locator('.theme-opt[data-theme="system"]').click();
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-theme'))).toBe(false);
  expect(await bg()).toBe('rgb(19, 20, 24)');
});

test('choosing an app icon points the Home Screen icon and manifest at it', async ({ page }) => {
  await page.goto('/');
  await page.locator('#openSettings').click();
  await expect(page.locator('#installCard')).toContainText('Add to Home Screen');
  await page.locator('.icon-opt[data-icon="glass"]').click();
  await expect(page.locator('.icon-opt[data-icon="glass"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')).toBe('icons/icon-glass-180.png');
  expect(await page.locator('link[rel="manifest"]').getAttribute('href')).toBe('manifest-glass.webmanifest');

  const manifest = await (await page.request.get('/manifest-glass.webmanifest')).json();
  expect(manifest.icons[0].src).toBe('icons/icon-glass-192.png');
  for (const icon of manifest.icons) {
    expect((await page.request.get('/' + icon.src)).status()).toBe(200);
  }

  await page.waitForTimeout(500);
  await page.reload();
  expect(await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')).toBe('icons/icon-glass-180.png');
});

test('review comments: add, pin, reply, resolve, delete', async ({ page }) => {
  await buildDinerScene(page);
  await page.locator('#page .el').nth(1).click(); // the action line
  await expect(page.locator('#reviewCount')).toBeHidden();

  await page.locator('#openReview').click();
  await page.locator('#reviewerName').fill('Jo');
  await expect(page.locator('#composeQuote')).toHaveText('Action: “Sarah wipes the counter.”');
  await page.locator('#newComment').fill('Show, don’t tell — what is she avoiding?');
  await page.locator('#addComment').click();

  const thread = page.locator('.rv-thread').first();
  await expect(thread.locator('.rv-meta b')).toHaveText('Jo');
  await expect(thread.locator('.rv-text')).toHaveText('Show, don’t tell — what is she avoiding?');
  await expect(page.locator('#reviewCount')).toHaveText('1');

  // Reply.
  await thread.getByRole('button', { name: 'Reply' }).click();
  await thread.getByLabel('Reply').fill('Agreed.');
  await thread.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.rv-thread .rv-reply .rv-text')).toHaveText('Agreed.');

  // The line shows a margin pin; tapping it opens just that thread.
  await page.locator('#closeReview').click();
  const pin = page.locator('#page .el').nth(1).locator('.note-pin');
  await expect(pin).toHaveText('1');
  await pin.dispatchEvent('pointerdown');
  await expect(page.locator('#reviewSheet')).toBeVisible();
  await expect(page.locator('#focusNote')).toBeVisible();
  await expect(page.locator('.rv-thread')).toHaveCount(1);

  // Comments survive a reload (stored with the script).
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator('#reviewCount')).toHaveText('1');

  // Resolve hides it from Open and clears the pin; Delete removes it.
  await page.locator('#openReview').click();
  await page.locator('.rv-thread').getByRole('button', { name: 'Resolve' }).click();
  await expect(page.locator('.rv-thread')).toHaveCount(0);
  await expect(page.locator('#reviewCount')).toBeHidden();
  await page.locator('#reviewFilter button[data-filter="resolved"]').click();
  await expect(page.locator('.rv-thread.resolved')).toHaveCount(1);
  const del = page.locator('.rv-thread').getByRole('button', { name: 'Delete' });
  await del.click();
  await page.locator('.rv-thread').getByRole('button', { name: 'Delete?' }).click();
  await expect(page.locator('.rv-thread')).toHaveCount(0);
  await page.locator('#closeReview').click();
  await expect(page.locator('#page .note-pin')).toHaveCount(0);
});

test('comments round-trip through Fountain notes and survive duplicate', async ({ page }) => {
  await buildDinerScene(page);
  await page.locator('#page .el').nth(3).click(); // dialogue "We open at six."
  await page.locator('#openReview').click();
  await page.locator('#reviewerName').fill('Sam');
  await page.locator('#newComment').fill('Too early?');
  await page.locator('#addComment').click();
  await page.locator('#closeReview').click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await openExport(page);
      await page.locator('.export-fmt[data-fmt="fountain"]').click();
    })(),
  ]);
  const text = fs.readFileSync(await download.path(), 'utf8');
  expect(text).toContain('SARAH\nWe open at six. [[Sam: Too early?]]');

  // Re-import: the note comes back as a comment on the same line.
  await page.locator('#closeExport').click();
  await page.locator('#openScripts').click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('#importBtn').click(),
  ]);
  await chooser.setFiles({ name: 'night.fountain', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(page.locator('#reviewCount')).toHaveText('1');
  const blocks = await getBlocks(page);
  expect(blocks[3]).toMatchObject({ type: 'dialogue', text: 'We open at six.' });
  await expect(page.locator('#page .el').nth(3).locator('.note-pin')).toHaveText('1');
  await page.locator('#openReview').click();
  await expect(page.locator('.rv-thread .rv-meta b')).toHaveText('Sam');
  await expect(page.locator('.rv-thread .rv-text')).toHaveText('Too early?');
  await page.locator('#closeReview').click();

  // Duplicating keeps comments pinned to the copied lines.
  await page.locator('#openScripts').click();
  await page.locator('.script-row.current button[aria-label^="Duplicate"]').click();
  await expect(page.locator('#page .el').nth(3).locator('.note-pin')).toHaveText('1');
});

// A script exported to PDF by Wordsmith itself, with a title page, an act
// marker and a speech long enough to split across pages with (MORE).
async function exportedPdf(page) {
  return page.evaluate(async () => {
    const { toPdf } = await import('/js/pdf.js');
    const el = (type, text) => ({ id: Math.random().toString(36), type, text });
    const filler = Array.from({ length: 16 }, (_, i) => el('action', `Beat ${i + 1}.`));
    const speech =
      'This is a long speech that goes on and on, line after line, so that it ' +
      'has to break across the bottom of the page and carry on overleaf, where ' +
      'the reader picks it up again under the same name with a continued mark ' +
      'and keeps right on reading until it finally, mercifully, comes to an end.';
    const script = {
      title: 'Paper Trail',
      titlePage: { author: 'Jo Writer', contact: 'jo@example.com', draftDate: 'First Draft' },
      elements: [
        el('marker', 'COLD OPEN'),
        el('scene', 'INT. ARCHIVE - NIGHT'),
        el('action', 'Rows of boxes stretch into the dark. A single lamp burns over a desk where somebody has left a half-finished crossword.'),
        el('character', 'MARA (V.O.)'),
        el('paren', 'whispering'),
        el('dialogue', 'Nobody comes down here.'),
        el('transition', 'CUT TO:'),
        el('scene', 'EXT. ROOF - CONTINUOUS'),
        ...filler,
        el('character', 'ODE'),
        el('dialogue', speech),
        el('action', 'Silence.'),
      ],
    };
    const pdf = toPdf(script);
    return { bytes: Array.from(pdf, (c) => c.charCodeAt(0)), more: pdf.includes('MORE'), speech };
  });
}

test('imports a PDF screenplay back into editable elements', async ({ page }) => {
  await page.goto('/');
  const { bytes, more, speech } = await exportedPdf(page);
  expect(more).toBe(true); // the speech really did split across pages

  await page.locator('#openScripts').click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#importBtn').click()]);
  await chooser.setFiles({ name: 'paper-trail.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) });

  await expect(page.locator('#scriptsSheet')).toBeHidden();
  await expect(page.locator('#title')).toHaveValue('PAPER TRAIL');
  const blocks = (await getBlocks(page)).map((b) => [b.type, b.text]);
  expect(blocks.slice(0, 8)).toEqual([
    ['marker', 'COLD OPEN'],
    ['scene', 'INT. ARCHIVE - NIGHT'],
    ['action', 'Rows of boxes stretch into the dark. A single lamp burns over a desk where somebody has left a half-finished crossword.'],
    ['character', 'MARA (V.O.)'],
    ['paren', '(whispering)'],
    ['dialogue', 'Nobody comes down here.'],
    ['transition', 'CUT TO:'],
    ['scene', 'EXT. ROOF - CONTINUOUS'],
  ]);
  expect(blocks.slice(8, 24)).toEqual(Array.from({ length: 16 }, (_, i) => ['action', `Beat ${i + 1}.`]));
  // The split speech is one element again: no (MORE), no second cue.
  expect(blocks.slice(24)).toEqual([
    ['character', 'ODE'],
    ['dialogue', speech],
    ['action', 'Silence.'],
  ]);

  await openExport(page);
  await expect(page.locator('#titlePageFields [data-field="author"]')).toHaveValue('Jo Writer');
  await expect(page.locator('#titlePageFields [data-field="contact"]')).toHaveValue('jo@example.com');
});

test('PDF import drops scene numbers, page numbers and CONTINUED headers', async ({ page }) => {
  await page.goto('/');
  const parsed = await page.evaluate(async () => {
    const { parsePdf } = await import('/js/pdfimport.js');
    // A Final Draft-style page: 1.5" margin, 12pt leading, numbers both sides.
    let y = 720;
    const items = [];
    const line = (x, text, gap = 1) => {
      y -= 12 * gap;
      items.push({ x, y, w: text.length * 7.2, text });
    };
    items.push({ x: 518, y: 750, w: 21.6, text: '2.' });
    line(108, 'CONTINUED:', 0);
    line(75, '12');
    items.push({ x: 108, y, w: 180, text: 'INT. KITCHEN - DAY' });
    items.push({ x: 540, y, w: 14.4, text: '12' });
    line(108, 'Toast burns.', 2);
    line(266, 'LEN', 2);
    line(180, 'Who did that?');
    line(475, 'FADE OUT.', 2);
    return parsePdf([{ width: 612, height: 792, items }]);
  });
  expect(parsed.elements.map((e) => [e.type, e.text])).toEqual([
    ['scene', 'INT. KITCHEN - DAY'],
    ['action', 'Toast burns.'],
    ['character', 'LEN'],
    ['dialogue', 'Who did that?'],
    ['transition', 'FADE OUT.'],
  ]);
});

test('a scanned PDF with no text explains why it can’t be imported', async ({ page }) => {
  await page.goto('/');
  const message = await page.evaluate(async () => {
    const { parsePdf } = await import('/js/pdfimport.js');
    try {
      parsePdf([{ width: 612, height: 792, items: [] }]);
    } catch (e) {
      return e.message;
    }
  });
  expect(message).toMatch(/scan/);
});

test.describe('web / desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test('the script sits on a centred, page-width column', async ({ page }) => {
    await page.goto('/');
    const pageBox = await page.locator('#page').boundingBox();
    const barBox = await page.locator('#quickbar').boundingBox();
    expect(pageBox.width).toBeLessThanOrEqual(780);
    expect(Math.abs(pageBox.x + pageBox.width / 2 - 640)).toBeLessThan(2);
    expect(Math.abs(barBox.width - pageBox.width)).toBeLessThan(2);
    await page.locator('#openScripts').click();
    const sheet = await page.locator('#scriptsSheet').boundingBox();
    expect(sheet.width).toBeLessThanOrEqual(620);
    await page.keyboard.press('Escape');
    await expect(page.locator('#scriptsSheet')).toBeHidden();
  });

  test('keyboard: Cmd+number sets the type, Cmd+Z undoes across blocks', async ({ page }) => {
    await page.goto('/');
    await page.locator('#page .el').first().click();
    await page.keyboard.type('INT. DINER - NIGHT');
    await page.keyboard.press('Enter'); // -> character
    await page.keyboard.type('Sarah');
    await page.keyboard.press('Enter'); // -> dialogue
    await page.keyboard.type('Hi.');
    await page.keyboard.press('Enter'); // -> action
    await page.keyboard.type('She waves');
    await page.keyboard.press('ControlOrMeta+Digit6'); // -> transition
    let blocks = await getBlocks(page);
    expect(blocks[blocks.length - 1].type).toBe('transition');
    await page.keyboard.press('ControlOrMeta+Digit2'); // back to action

    await page.waitForTimeout(600); // let the edit checkpoint settle
    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('ControlOrMeta+z');
    blocks = await getBlocks(page);
    expect(blocks.map((b) => b.text)).not.toContain('She waves');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    blocks = await getBlocks(page);
    expect(blocks[blocks.length - 1]).toMatchObject({ type: 'action', text: 'She waves' });
  });

  test('keyboard character picks: Option+number, and Enter accepts a suggestion', async ({ page }) => {
    await page.goto('/');
    await page.locator('#page .el').first().click();
    await page.keyboard.type('INT. DINER - NIGHT');
    await page.keyboard.press('Enter'); // scene -> character
    for (const [name, line] of [['Sarah', 'Hi.'], ['Al', 'Hey.'], ['Alice', 'Yo.']]) {
      await page.keyboard.press('ControlOrMeta+Digit3'); // character
      await page.keyboard.type(name);
      await page.keyboard.press('Enter'); // -> dialogue
      await page.keyboard.type(line);
      await page.keyboard.press('Enter'); // dialogue -> action
    }

    // Holding Option numbers the chips; Option+n acts like tapping chip n.
    await page.keyboard.down('Alt');
    await expect(page.locator('body')).toHaveClass(/show-char-keys/);
    const names = await charChipTexts(page);
    await page.keyboard.press('Digit2');
    await page.keyboard.up('Alt');
    await expect(page.locator('body')).not.toHaveClass(/show-char-keys/);
    let blocks = await getBlocks(page);
    expect(blocks.slice(-2).map((b) => [b.type, b.text])).toEqual([['character', names[1]], ['dialogue', '']]);
    await page.keyboard.type('Picked.');

    // SmartType: "SA" + Enter completes to SARAH and lands in her dialogue.
    await page.keyboard.press('Enter');
    await page.keyboard.press('ControlOrMeta+Digit3'); // character
    await page.keyboard.type('Sa');
    await page.keyboard.press('Enter');
    blocks = await getBlocks(page);
    expect(blocks.slice(-2).map((b) => [b.type, b.text])).toEqual([['character', 'SARAH'], ['dialogue', '']]);

    // A name that's known as typed is kept: AL stays AL, not ALICE.
    await page.keyboard.type('Ok.');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ControlOrMeta+Digit3');
    await page.keyboard.type('Al');
    await page.keyboard.press('Enter');
    blocks = await getBlocks(page);
    expect(blocks.slice(-2).map((b) => [b.type, b.text])).toEqual([['character', 'AL'], ['dialogue', '']]);

    // Esc dismisses the suggestion, so Enter keeps what was typed.
    await page.keyboard.type('Fine.');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ControlOrMeta+Digit3');
    await page.keyboard.type('Sa');
    await expect(page.locator('#quickbar .chip-suggest')).toHaveText(/SARAH/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#quickbar .chip-suggest')).toHaveCount(0);
    await page.keyboard.press('Enter');
    blocks = await getBlocks(page);
    expect(blocks.slice(-2).map((b) => [b.type, b.text])).toEqual([['character', 'SA'], ['dialogue', '']]);
  });

  test('mouse: wheel scrolls a chip row, right-click opens a character', async ({ page }) => {
    await page.goto('/');
    await page.locator('#page .el').first().click();
    await page.keyboard.type('INT. DINER - NIGHT');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Sarah');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Hi.');
    await page.keyboard.press('Enter');

    await page.setViewportSize({ width: 800, height: 800 }); // narrow enough to overflow
    const row = page.locator('#chips');
    const overflow = await row.evaluate((r) => r.scrollWidth > r.clientWidth);
    if (overflow) {
      await row.hover();
      await page.mouse.wheel(0, 120);
      await expect.poll(() => row.evaluate((r) => r.scrollLeft)).toBeGreaterThan(0);
    }

    await page.locator('#charChips .chip-char', { hasText: 'SARAH' }).click({ button: 'right' });
    await expect(page.locator('#profileSheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#profileSheet')).toBeHidden();
  });
});
