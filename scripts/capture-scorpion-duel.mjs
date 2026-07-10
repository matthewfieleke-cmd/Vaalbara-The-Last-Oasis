/* Scorpion duel tail-strike: normal + Venom special contact frames.
 *   node scripts/capture-scorpion-duel.mjs
 * Requires preview on :4310. */
import { chromium } from 'playwright';
import { launchPage, skipIntroToMenu, OUT } from './capture-helpers.mjs';
import { mkdirSync } from 'node:fs';

const DIR = `${OUT}/scorpion-duel`;
mkdirSync(DIR, { recursive: true });

const { browser, page } = await launchPage(chromium);
await skipIntroToMenu(page);
await page.click('text=Duels');
await page.waitForSelector('.duel-setup', { timeout: 8000 });
await page.waitForTimeout(800);

// Order roster with Scorpion fighting first.
const cards = page.locator('.duel-roster .duel-card');
const n = await cards.count();
const labels = [];
for (let i = 0; i < n; i++) labels.push((await cards.nth(i).innerText()).trim());
const scorpionIdx = labels.findIndex((t) => /scorpion/i.test(t));
const order = scorpionIdx >= 0
  ? [scorpionIdx, ...labels.map((_, i) => i).filter((i) => i !== scorpionIdx)]
  : labels.map((_, i) => i);
for (const i of order) await cards.nth(i).click();

await page.screenshot({ path: `${DIR}/00-setup.png` });
await page.getByRole('button', { name: /Enter the Arena/ }).click();
await page.waitForSelector('.duel-screen', { timeout: 8000 });
await page.waitForTimeout(1400);
await page.screenshot({ path: `${DIR}/01-entrance.png` });

let normalShots = 0;
let specialDone = false;
const anyState = page.locator('.duel-over-overlay, .duel-pick-overlay, .duel-btn.strike');

for (let round = 0; round < 300; round++) {
  await anyState.first().waitFor({ timeout: 25000 });
  if ((await page.locator('.duel-over-overlay').count()) > 0) break;
  if ((await page.locator('.duel-pick-overlay').count()) > 0) {
    await page.locator('.duel-pick-grid .duel-card:not(.downed)').first().click();
    continue;
  }
  const special = page.locator('.duel-btn.special.ready');
  if ((await special.count()) > 0 && !specialDone) {
    await special.click();
    // Long wind-up (1.35s) + strike arc — sample wind-up, contact, recoil.
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${DIR}/02-venom-windup.png` });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${DIR}/03-venom-contact.png` });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${DIR}/04-venom-recoil.png` });
    specialDone = true;
  } else {
    await page.locator('.duel-btn.strike').click();
    if (normalShots < 2) {
      await page.waitForTimeout(650);
      await page.screenshot({ path: `${DIR}/05-strike-mid-${normalShots}.png` });
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${DIR}/06-strike-contact-${normalShots}.png` });
      normalShots++;
    }
  }
}

await page.screenshot({ path: `${DIR}/99-end.png` });
console.log(`Scorpion duel captures in ${DIR}; special=${specialDone}`);
await browser.close();
