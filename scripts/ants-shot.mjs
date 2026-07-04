/* Quick capture: deploy Fire Ants and eyeball their size + forward lean. */
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
await page.goto('http://localhost:4310', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.setItem('vaalbara.introSeen', '1'));
await page.reload({ waitUntil: 'networkidle' });
const tap = page.locator('.tap-to-begin');
if (await tap.count()) { await tap.click(); await page.click('.skip-btn'); }
await page.waitForSelector('.menu', { timeout: 5000 });
await page.click('text=Battle');
await page.click('text=March to the Basalt Fields');
await page.click('text=Play offline now');
await page.waitForSelector('.game-screen', { timeout: 8000 });
await page.waitForTimeout(4000);

const deploy = async (label, fx) => {
  const card = page.locator('.hand .card', { hasText: label });
  if (!(await card.count())) return false;
  const cls = (await card.first().getAttribute('class')) ?? '';
  if (cls.includes('unaffordable')) return false;
  await card.first().click();
  const wb = await page.locator('.game-canvas-wrap').boundingBox();
  await page.mouse.move(wb.x + wb.width * fx, wb.y + wb.height * 0.86);
  await page.mouse.down();
  await page.mouse.move(wb.x + wb.width * 0.5, wb.y + wb.height * 0.5, { steps: 6 });
  await page.mouse.up();
  return true;
};

await deploy('FIRE ANTS', 0.35);
await page.waitForTimeout(3500);
await deploy('T-REX', 0.6) || await deploy('HONEY BADGER', 0.6) || await deploy('LION', 0.6);
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/vaalbara-shots/ants-a.png' });
await page.waitForTimeout(4000);
await page.screenshot({ path: '/tmp/vaalbara-shots/ants-b.png' });
await page.waitForTimeout(5000);
await page.screenshot({ path: '/tmp/vaalbara-shots/ants-c.png' });
console.log('done');
await browser.close();
