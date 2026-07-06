/* Drives a duel to a K.O. while recording frames continuously so the slump
 * collapse can be verified (the K.O. banner is canvas-drawn, not DOM). */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = '/tmp/duel-ko';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto('http://localhost:4310', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.setItem('vaalbara.introSeen', '1'));
await page.goto('http://localhost:4310', { waitUntil: 'networkidle' });
await page.click('text=Duels');
await page.waitForSelector('.duel-setup');
await page.waitForTimeout(800);
const cards = page.locator('.duel-roster .duel-card');
const n = await cards.count();
for (let i = 0; i < n; i++) await cards.nth(i).click();
await page.click('text=Enter the Arena');
await page.waitForSelector('.duel-screen');
await page.waitForTimeout(2200);

let frame = 0;
let done = false;
const recorder = (async () => {
  while (!done && frame < 400) {
    await page.screenshot({ path: `${OUT}/f${String(frame++).padStart(3, '0')}.png` })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 240));
  }
})();

for (let i = 0; i < 90; i++) {
  if ((await page.locator('.duel-over-overlay').count()) > 0) break;
  const pick = page.locator('.duel-pick-overlay');
  if ((await pick.count()) > 0) {
    // A champion fell — let the recorder run through the moment, then stop.
    await page.waitForTimeout(2500);
    console.log('KO at frame ~', frame);
    break;
  }
  const strike = page.locator('.duel-btn.strike');
  if ((await strike.count()) > 0 && (await strike.isEnabled().catch(() => false))) {
    await strike.click().catch(() => {});
  }
  await page.waitForTimeout(900);
}
done = true;
await recorder;
console.log('frames:', frame);
await browser.close();
