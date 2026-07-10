/* Flyer gate passage: Bees + Eagle through intact arch and razed causeway.
 *   node scripts/capture-flyers.mjs
 * Requires preview on :4310. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { launchPage, skipIntroToMenu, OUT } from './capture-helpers.mjs';

const DIR = `${OUT}/flyers`;
mkdirSync(DIR, { recursive: true });

const { browser, page } = await launchPage(chromium);
await skipIntroToMenu(page);

async function startBattle(faction) {
  await page.click('text=Battle');
  await page.click(`.faction-card.${faction}`);
  await page.click('text=March to the Basalt Fields');
  await page.click('text=Play offline now');
  await page.waitForSelector('.game-screen', { timeout: 8000 });
  await page.waitForTimeout(1500);
}

async function deployCard(name, padFracX, padFracY) {
  for (let tries = 0; tries < 24; tries++) {
    await page.waitForTimeout(1200);
    const card = page.locator('.hand .card', { hasText: name });
    if (!(await card.count())) continue;
    const cls = (await card.first().getAttribute('class')) ?? '';
    if (cls.includes('unaffordable')) continue;
    await card.first().click();
    const wb = await page.locator('.game-canvas-wrap').boundingBox();
    await page.mouse.click(wb.x + wb.width * padFracX, wb.y + wb.height * padFracY);
    return true;
  }
  return false;
}

// Oasis: Bees through own rear gate (intact).
await startBattle('oasis');
await deployCard('BEES', 0.5, 0.86);
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${DIR}/bees-intact-${i}.png` });
}

// Magma: Eagle through enemy front gate.
await page.goto(`http://localhost:4310`, { waitUntil: 'networkidle' });
await skipIntroToMenu(page);
await startBattle('magma');
await deployCard('EAGLE', 0.5, 0.14);
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/eagle-intact-${i}.png` });
}

console.log(`Flyer captures written to ${DIR}`);
await browser.close();
