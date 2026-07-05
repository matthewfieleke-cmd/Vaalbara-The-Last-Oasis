/* Targeted visual checks for the Duels stage:
 *  - oasis faction (bear/bighorn grounding + flowing water)
 *  - magma faction with T-Rex first (chomp facing)
 *  - special charge-up / impact beats
 * Usage: node scripts/duel-visual.mjs [basalt|oasis] [magma|oasis]
 */
import { chromium } from 'playwright';

const OUT = '/tmp/vaalbara-shots';
const world = process.argv[2] ?? 'oasis';
const faction = process.argv[3] ?? 'oasis';
const tag = `${world}-${faction}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(`http://localhost:4310/?dworld=${world}`, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.setItem('vaalbara.introSeen', '1'));
await page.goto(`http://localhost:4310/?dworld=${world}`, { waitUntil: 'networkidle' });
await page.click('text=Duels');
await page.waitForSelector('.duel-setup');
if (faction === 'oasis') await page.click('text=The Oasis Syndicate');
await page.waitForTimeout(800);
const cards = page.locator('.duel-roster .duel-card');
const n = await cards.count();
for (let i = 0; i < n; i++) await cards.nth(i).click();
await page.click('text=Enter the Arena');
await page.waitForSelector('.duel-screen');

// Idle stance after entrance (grounding check) + flow check (two frames).
await page.waitForTimeout(2600);
await page.screenshot({ path: `${OUT}/v-${tag}-idle-a.png` });
await page.waitForTimeout(1400);
await page.screenshot({ path: `${OUT}/v-${tag}-idle-b.png` });

// First strike: capture the attack frame right at impact (facing check).
await page.locator('.duel-btn.strike').click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/v-${tag}-impact.png` });
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/v-${tag}-impact-b.png` });

// Grind to a special, then capture charge / unleash / impact beats.
for (let i = 0; i < 30; i++) {
  const ready = page.locator('.duel-btn.special.ready');
  const strike = page.locator('.duel-btn.strike');
  const pick = page.locator('.duel-pick-overlay');
  await page.locator('.duel-over-overlay, .duel-pick-overlay, .duel-btn.strike').first().waitFor({ timeout: 20000 });
  if ((await page.locator('.duel-over-overlay').count()) > 0) break;
  if ((await pick.count()) > 0) {
    await page.locator('.duel-pick-grid .duel-card:not(.downed)').first().click();
    continue;
  }
  if ((await ready.count()) > 0) {
    await ready.click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/v-${tag}-charge.png` });
    await page.waitForTimeout(1300);
    await page.screenshot({ path: `${OUT}/v-${tag}-unleash.png` });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/v-${tag}-aftermath.png` });
    break;
  }
  await strike.click();
}
console.log('done', tag);
await browser.close();
