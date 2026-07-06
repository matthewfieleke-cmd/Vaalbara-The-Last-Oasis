/* Accelerated match: rides into Phase 2 and deploys walkers toward the pond
 * to verify water entry splashes, leg submersion and waterline rendering. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = '/tmp/pond-check';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto('http://localhost:4310/?p1ticks=60&p2ticks=500', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.setItem('vaalbara.introSeen', '1'));
await page.goto('http://localhost:4310/?p1ticks=60&p2ticks=500', { waitUntil: 'networkidle' });
await page.waitForSelector('.menu', { timeout: 5000 });
await page.click('text=Battle');
await page.click('text=March to the Basalt Fields');
await page.click('text=Play offline now');
await page.waitForSelector('.game-screen', { timeout: 8000 });

const deployWalker = async (fx) => {
  const cs = page.locator('.hand .card');
  const n = await cs.count();
  for (let i = 0; i < n; i++) {
    const cls = (await cs.nth(i).getAttribute('class')) ?? '';
    const txt = ((await cs.nth(i).textContent()) ?? '').toUpperCase();
    if (cls.includes('unaffordable') || cls.includes('spell-card')) continue;
    if (txt.includes('EAGLE') || txt.includes('BEES')) continue; // walkers only
    await cs.nth(i).click();
    const wb = await page.locator('.game-canvas-wrap').boundingBox();
    await page.mouse.move(wb.x + wb.width * fx, wb.y + wb.height * 0.86);
    await page.mouse.down();
    await page.mouse.move(wb.x + wb.width * 0.5, wb.y + wb.height * 0.5, { steps: 6 });
    await page.mouse.up();
    return true;
  }
  return false;
};

// Ride phase 1 out (60 ticks = 18s + ~6s transition).
await page.waitForTimeout(27000);
await page.screenshot({ path: `${OUT}/entry.png` });
// Deploy walkers aimed at the pond as elixir allows, then record the wade.
let deployed = 0;
for (let i = 0; i < 10 && deployed < 3; i++) {
  if (await deployWalker(0.35 + deployed * 0.15)) deployed++;
  await page.waitForTimeout(2500);
}
for (let i = 0; i < 26; i++) {
  await page.screenshot({ path: `${OUT}/w${String(i).padStart(2, '0')}.png` });
  await page.waitForTimeout(400);
}
console.log('deployed walkers:', deployed);
await browser.close();
