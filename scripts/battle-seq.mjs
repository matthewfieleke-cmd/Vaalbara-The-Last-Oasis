/* Captures a rapid frame sequence of an offline Battle so directional
 * sprite views can be checked against actual unit motion over time. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = '/tmp/battle-seq';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
await page.goto('http://localhost:4310', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.setItem('vaalbara.introSeen', '1'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.menu', { timeout: 5000 });
await page.click('text=Battle');
await page.click('.faction-card.oasis');
await page.click('text=March to the Basalt Fields');
await page.click('text=Play offline now');
await page.waitForSelector('.game-screen', { timeout: 8000 });

// Deploy whatever is affordable a few times so both sides field troops.
async function deploySomething() {
  const cards = page.locator('.hand .card:not(.unaffordable)');
  if (!(await cards.count())) return false;
  await cards.first().click();
  const wb = await page.locator('.game-canvas-wrap').boundingBox();
  await page.mouse.move(wb.x + wb.width * 0.5, wb.y + wb.height * 0.86);
  await page.mouse.down();
  await page.mouse.move(wb.x + wb.width * 0.45, wb.y + wb.height * 0.5, { steps: 6 });
  await page.mouse.up();
  return true;
}

await page.waitForTimeout(4000);
await deploySomething();
await page.waitForTimeout(4000);
await deploySomething();

// Burst capture: one frame every 400 ms for ~16 s.
for (let i = 0; i < 40; i++) {
  await page.screenshot({ path: `${OUT}/f${String(i).padStart(2, '0')}.png` });
  await page.waitForTimeout(400);
  if (i === 12 || i === 24) await deploySomething();
}
console.log('done');
await browser.close();
