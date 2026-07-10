/* Lava Rain card art in hand (procedural canvas loop).
 *   node scripts/capture-lava-rain.mjs
 * Requires preview on :4310. */
import { chromium } from 'playwright';
import { launchPage, skipIntroToMenu, OUT } from './capture-helpers.mjs';
import { mkdirSync } from 'node:fs';

const DIR = `${OUT}/lava-rain`;
mkdirSync(DIR, { recursive: true });

const { browser, page } = await launchPage(chromium);
await skipIntroToMenu(page);
await page.click('text=Battle');
await page.click('.faction-card.magma');
await page.click('text=March to the Basalt Fields');
await page.click('text=Play offline now');
await page.waitForSelector('.game-screen', { timeout: 8000 });

// Wait for Lava Rain to cycle into hand (fixed in 8-card deck).
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(1500);
  const card = page.locator('.hand .card', { hasText: 'LAVA RAIN' });
  if (await card.count()) {
    await page.screenshot({ path: `${DIR}/hand-${i}.png` });
    if (i >= 3) break;
  }
}

// Close-up of the card art tile.
const lava = page.locator('.hand .card', { hasText: 'LAVA RAIN' }).first();
if (await lava.count()) {
  await lava.screenshot({ path: `${DIR}/card-closeup.png` });
}

console.log(`Lava Rain captures in ${DIR}`);
await browser.close();
