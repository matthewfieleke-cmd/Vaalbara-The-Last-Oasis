/* Accelerated match: capture Phase-2 pond brawl + Phase-1 running visuals. */
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
await page.goto('http://localhost:4310/?p1ticks=90&p2ticks=400', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.setItem('vaalbara.introSeen', '1'));
await page.goto('http://localhost:4310/?p1ticks=90&p2ticks=400', { waitUntil: 'networkidle' });
await page.waitForSelector('.menu', { timeout: 5000 });
await page.click('text=Battle');
await page.click('text=March to the Basalt Fields');
await page.click('text=Play offline now');
await page.waitForSelector('.game-screen', { timeout: 8000 });

const deployAny = async (fx) => {
  const cs = page.locator('.hand .card');
  const n = await cs.count();
  for (let i = 0; i < n; i++) {
    const cls = (await cs.nth(i).getAttribute('class')) ?? '';
    if (!cls.includes('unaffordable') && !cls.includes('spell-card')) {
      await cs.nth(i).click();
      const wb = await page.locator('.game-canvas-wrap').boundingBox();
      await page.mouse.move(wb.x + wb.width * fx, wb.y + wb.height * 0.86);
      await page.mouse.down();
      await page.mouse.move(wb.x + wb.width * 0.5, wb.y + wb.height * 0.45, { steps: 6 });
      await page.mouse.up();
      return;
    }
  }
};

// Phase 1: deploy and shoot the run cycle (lean + dust check).
await page.waitForTimeout(5000);
await deployAny(0.4);
await page.waitForTimeout(2200);
await page.screenshot({ path: '/tmp/vaalbara-shots/p1-run-a.png' });
await page.waitForTimeout(1800);
await page.screenshot({ path: '/tmp/vaalbara-shots/p1-run-b.png' });
await deployAny(0.6);
await page.waitForTimeout(6000);
await page.screenshot({ path: '/tmp/vaalbara-shots/p1-run-c.png' });

// Ride into phase 2 (p1 = 90 ticks = 27 s + transition ~6 s).
await page.waitForTimeout(24000);
await page.screenshot({ path: '/tmp/vaalbara-shots/p2-entry.png' });
for (let i = 0; i < 3; i++) {
  await page.waitForTimeout(6000);
  await deployAny(0.3 + i * 0.2);
}
await page.waitForTimeout(6000);
await page.screenshot({ path: '/tmp/vaalbara-shots/p2-brawl-a.png' });
await page.waitForTimeout(8000);
await page.screenshot({ path: '/tmp/vaalbara-shots/p2-brawl-b.png' });
await page.waitForTimeout(8000);
await page.screenshot({ path: '/tmp/vaalbara-shots/p2-brawl-c.png' });
console.log('done');
await browser.close();
