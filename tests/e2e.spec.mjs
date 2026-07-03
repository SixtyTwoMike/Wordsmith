import { test, expect } from '@playwright/test';

async function getBlocks(page) {
  return page.$$eval('#page .el', (els) =>
    els.map((div) => {
      const type = [...div.classList].find((c) => c.startsWith('el-')).slice(3);
      const ta = div.querySelector('textarea');
      return {
        type,
        text: ta ? ta.value : div.textContent,
        active: div.classList.contains('active'),
      };
    })
  );
}

function chipTexts(page) {
  return page.$$eval('#chips .chip', (cs) => cs.map((c) => c.textContent.trim()));
}

function chipNamed(page, label) {
  return page.locator(`#chips .chip:text-is("${label}")`);
}

async function startScene(page, heading = 'INT. DINER - NIGHT') {
  await page.goto('/');
  await page.locator('#page .el').first().click();
  await page.keyboard.type(heading);
  await page.keyboard.press('Enter'); // scene -> action
}

// Type a character + one dialogue line, ending focused on a fresh action block.
async function speak(page, name, line) {
  await page.keyboard.press('Tab'); // action -> character
  await page.keyboard.type(name);
  await page.keyboard.press('Enter'); // -> dialogue (commits character)
  await page.keyboard.type(line);
  await page.keyboard.press('Enter'); // -> action
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
