// Render the app icon designs in icons/ to the PNG sizes iOS and the
// manifest need. icon.svg is the default ("classic") design; each
// icon-<name>.svg is an alternative the writer can pick in Settings.

import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const DESIGNS = ['classic', 'paper', 'glass', 'midnight', 'typewriter'];

const browser = await chromium.launch();
const page = await browser.newPage();

for (const name of DESIGNS) {
  const file = name === 'classic' ? 'icon' : `icon-${name}`;
  const svg = await readFile(new URL(`../icons/${file}.svg`, import.meta.url), 'utf8');
  for (const size of [180, 192, 512]) {
    await page.setViewportSize({ width: size, height: size });
    const sized = svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
    await page.setContent(`<style>html,body{margin:0}</style>${sized}`);
    const path = fileURLToPath(new URL(`../icons/${file}-${size}.png`, import.meta.url));
    await page.screenshot({ path });
    console.log('wrote', path);
  }
}

await browser.close();
