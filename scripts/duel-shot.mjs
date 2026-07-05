/* Duels mode smoke + visual capture: setup sheet, entrance, clashes,
 * special, KO flow. Assumes `vite preview --port 4310` is running. */
import { chromium } from 'playwright';

const OUT = '/tmp/vaalbara-shots';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text());
});

await page.goto('http://localhost:4310/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.setItem('vaalbara.introSeen', '1'));
await page.goto('http://localhost:4310/', { waitUntil: 'networkidle' });
await page.waitForSelector('.menu', { timeout: 8000 });
await page.screenshot({ path: `${OUT}/duel-0-menu.png` });

await page.click('text=Duels');
await page.waitForSelector('.duel-setup', { timeout: 5000 });
await page.waitForTimeout(1200); // sprites land
await page.screenshot({ path: `${OUT}/duel-1-setup.png` });

// Order all six in roster order.
const cards = page.locator('.duel-roster .duel-card');
const n = await cards.count();
for (let i = 0; i < n; i++) await cards.nth(i).click();
await page.screenshot({ path: `${OUT}/duel-2-ordered.png` });
await page.click('text=Enter the Arena');
await page.waitForSelector('.duel-screen', { timeout: 5000 });
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/duel-3-entrance.png` });
await page.waitForTimeout(1600); // intro overlay clears

// Fight until victory, shooting mid-clash + special + KO-pick frames.
let shots = 0;
let specialUsed = false;
let specialShot = false;
let pickShot = false;
const anyState = page.locator('.duel-over-overlay, .duel-pick-overlay, .duel-btn.strike');
for (let round = 0; round < 400; round++) {
  await anyState.first().waitFor({ timeout: 20000 });
  if ((await page.locator('.duel-over-overlay').count()) > 0) break;
  if ((await page.locator('.duel-pick-overlay').count()) > 0) {
    if (!pickShot) {
      pickShot = true;
      await page.screenshot({ path: `${OUT}/duel-7-pick.png` });
    }
    await page.locator('.duel-pick-grid .duel-card:not(.downed)').first().click();
    continue;
  }
  const special = page.locator('.duel-btn.special.ready');
  if ((await special.count()) > 0) {
    await special.click();
    specialUsed = true;
    if (!specialShot) {
      specialShot = true;
      await page.waitForTimeout(1100);
      await page.screenshot({ path: `${OUT}/duel-5-special.png` });
      await page.waitForTimeout(1400);
      await page.screenshot({ path: `${OUT}/duel-5b-special-impact.png` });
    }
  } else {
    await page.locator('.duel-btn.strike').click();
    if (shots < 3) {
      await page.waitForTimeout(750); // mid-dash / impact
      await page.screenshot({ path: `${OUT}/duel-4-clash-${shots}.png` });
      shots++;
    }
  }
}

// KO banner or victory screen.
await page.screenshot({ path: `${OUT}/duel-8-end.png` });
const overVisible = await page.locator('.duel-over-overlay').count();
console.log('finished; over overlay:', overVisible > 0, '; special used:', specialUsed);
await browser.close();
