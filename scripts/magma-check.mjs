/* Deploys Fire Ants and Scorpion (magma) and captures frames to verify the
 * 4-ant deployment, scorpion gait and plodding march. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = '/tmp/magma-check';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
await page.goto('http://localhost:4310', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.setItem('vaalbara.introSeen', '1'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.menu', { timeout: 5000 });
await page.click('text=Battle');
await page.click('.faction-card.magma');
await page.click('text=March to the Basalt Fields');
await page.click('text=Play offline now');
await page.waitForSelector('.game-screen', { timeout: 8000 });

async function deploy(name, fx) {
  for (let tries = 0; tries < 15; tries++) {
    await page.waitForTimeout(1200);
    const card = page.locator('.hand .card', { hasText: name });
    if (!(await card.count())) continue;
    const cls = (await card.first().getAttribute('class')) ?? '';
    if (cls.includes('unaffordable')) continue;
    await card.first().click();
    const wb = await page.locator('.game-canvas-wrap').boundingBox();
    const sx = wb.x + wb.width * fx;
    const sy = wb.y + wb.height * 0.86;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 10, sy - 120, { steps: 8 });
    await page.mouse.up();
    return true;
  }
  return false;
}

await deploy('FIRE ANTS', 0.45);
for (let i = 0; i < 12; i++) {
  await page.screenshot({ path: `${OUT}/ants-${String(i).padStart(2, '0')}.png` });
  await page.waitForTimeout(300);
}
await deploy('SCORPION', 0.6);
for (let i = 0; i < 14; i++) {
  await page.screenshot({ path: `${OUT}/scorp-${String(i).padStart(2, '0')}.png` });
  await page.waitForTimeout(300);
}
console.log('done');
await browser.close();
