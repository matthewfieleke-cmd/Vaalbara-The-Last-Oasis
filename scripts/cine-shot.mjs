/* Captures intro cinematic frames for visual review. */
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto('http://localhost:4310', { waitUntil: 'networkidle' });
// Fresh profile => cinematic plays.
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.cinematic', { timeout: 8000 });
await page.waitForTimeout(4000);
await page.screenshot({ path: '/tmp/vaalbara-shots/cine-title.png' });
await page.waitForTimeout(33000); // ~37s: T-Rex hero card
await page.screenshot({ path: '/tmp/vaalbara-shots/cine-trex.png' });
await page.waitForTimeout(30000); // ~67s: Bear hero card
await page.screenshot({ path: '/tmp/vaalbara-shots/cine-bear.png' });
console.log('done');
await browser.close();
