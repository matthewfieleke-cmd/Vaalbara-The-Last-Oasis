/* Deploys the Bighorn (oasis) and captures frames to check the keyed art. */
import { chromium } from 'playwright';

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

// Wait for aqua, then deploy Bighorn as soon as its card is affordable.
for (let tries = 0; tries < 20; tries++) {
  await page.waitForTimeout(1500);
  const card = page.locator('.hand .card', { hasText: 'BIGHORN' });
  if (!(await card.count())) continue;
  const cls = (await card.first().getAttribute('class')) ?? '';
  if (cls.includes('unaffordable')) continue;
  await card.first().click();
  const wb = await page.locator('.game-canvas-wrap').boundingBox();
  await page.mouse.move(wb.x + wb.width * 0.5, wb.y + wb.height * 0.86);
  await page.mouse.down();
  await page.mouse.move(wb.x + wb.width * 0.5, wb.y + wb.height * 0.45, { steps: 6 });
  await page.mouse.up();
  break;
}
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/vaalbara-shots/bighorn-a.png' });
await page.waitForTimeout(3500);
await page.screenshot({ path: '/tmp/vaalbara-shots/bighorn-b.png' });
await page.waitForTimeout(4000);
await page.screenshot({ path: '/tmp/vaalbara-shots/bighorn-c.png' });
console.log('done');
await browser.close();
