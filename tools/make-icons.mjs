// Render icons/icon.svg to the PNG sizes iOS and the manifest need.

import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const svg = await readFile(new URL('../icons/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();

for (const size of [180, 192, 512]) {
  await page.setViewportSize({ width: size, height: size });
  const sized = svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
  await page.setContent(`<style>html,body{margin:0;background:#16191f}</style>${sized}`);
  const path = fileURLToPath(new URL(`../icons/icon-${size}.png`, import.meta.url));
  await page.screenshot({ path });
  console.log('wrote', path);
}

await browser.close();
