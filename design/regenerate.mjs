// Re-export the social card from og-card.html after a copy change.
//
//   npm i -D playwright && npx playwright install chromium
//   node regenerate.mjs
//
// Writes og.png, og@2x.png, og-dark.png next to this file.
// Dev-only: do NOT add playwright to the repo's runtime dependencies — the shipped
// app stays dependency-free. Commit the PNGs, not node_modules.
//
// Font caveat: og-card.html resolves Inter / SF Pro via local() only (no CDN, by design),
// so output depends on the fonts installed on THIS machine. If neither Inter nor SF Pro is
// installed, Chromium falls back and the type will not match the committed PNG. Diff against
// the committed file before replacing it.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { statSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const WIDTH = 1200, HEIGHT = 630;
const MAX_KB = 500;

const shots = [
  { selector: '#og-light', file: 'og.png',      scale: 1 },
  { selector: '#og-light', file: 'og@2x.png',   scale: 2 },
  { selector: '#og-dark',  file: 'og-dark.png', scale: 1 },
];

const browser = await chromium.launch();
for (const { selector, file, scale } of shots) {
  const page = await browser.newPage({
    viewport: { width: WIDTH + 120, height: HEIGHT + 200 },
    deviceScaleFactor: scale,
  });
  await page.goto('file://' + join(here, 'og-card.html'));
  await page.evaluate(() => document.fonts.ready);
  const out = join(here, file);
  await page.locator(selector).screenshot({ path: out });
  await page.close();

  const kb = statSync(out).size / 1024;
  const box = await (async () => null)();
  console.log(`${file.padEnd(12)} ${(WIDTH * scale)}x${(HEIGHT * scale)}  ${kb.toFixed(1)} KB` +
    (kb > MAX_KB ? '   <-- OVER THE ' + MAX_KB + ' KB BUDGET' : ''));
  void box;
}
await browser.close();
