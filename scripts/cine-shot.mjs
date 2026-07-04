/* Captures intro cinematic frames for visual review. */
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto('http://localhost:4310', { waitUntil: 'networkidle' });
// Fresh profile => cinematic plays.
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
// Pass the tap-to-begin gate.
await page.waitForSelector('.tap-to-begin', { timeout: 8000 });
await page.click('.tap-to-begin');
await page.waitForSelector('.tap-to-begin', { state: 'detached', timeout: 8000 });

const t0 = Date.now();
const shotAt = async (sec, name) => {
  const wait = t0 + sec * 1000 - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  await page.screenshot({ path: `/tmp/vaalbara-shots/${name}.png` });
};

await shotAt(2.5, 'cine-title');    // "Vaalbara" card
await shotAt(9.5, 'cine-oasis');    // "The Last Oasis" card over oasis art
await shotAt(22.2, 'cine-trex');    // T-Rex hero
await shotAt(39.8, 'cine-ants');    // Fire ants hero (size check)
await shotAt(50.2, 'cine-bear');    // Bear hero
await shotAt(61.2, 'cine-wolves');  // Wolves hero (size check)
console.log('done');
await browser.close();
