/* Browser smoke test: boots the built app in headless Chromium (portrait
 * mobile viewport), walks menu -> faction -> offline match, deploys a card
 * via drag, fires the ultimate, and watches ticks advance. */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://localhost:4310';
const shots = '/tmp/vaalbara-shots';
fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${shots}/01-boot.png` });

// Boot -> cinematic (first visit): tap to begin, sample a frame, then skip.
const tap = page.locator('.tap-to-begin');
if (await tap.count()) {
  await tap.click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${shots}/02-cinematic.png` });
  await page.click('.skip-btn');
}
await page.waitForSelector('.menu', { timeout: 5000 });
await page.screenshot({ path: `${shots}/03-menu.png` });

// Menu -> faction select.
await page.click('text=Battle');
await page.waitForSelector('.faction-select', { timeout: 5000 });
await page.screenshot({ path: `${shots}/04-faction.png` });

// Confirm magma -> matchmaking -> should fall back to local guest mode.
await page.click('text=March to the Basalt Fields');
await page.waitForSelector('.matchmaking', { timeout: 5000 });
await page.click('text=Play offline now');
await page.waitForSelector('.game-screen', { timeout: 8000 });
await page.waitForTimeout(2600);
await page.screenshot({ path: `${shots}/05-game-start.png` });

// Read initial timer, select the first affordable card and drag-deploy it.
const timer1 = await page.textContent('.timer');
await page.waitForTimeout(3000); // accumulate aqua

const cards = page.locator('.hand .card');
const n = await cards.count();
let played = false;
for (let i = 0; i < n && !played; i++) {
  const cls = (await cards.nth(i).getAttribute('class')) ?? '';
  if (!cls.includes('unaffordable') && !cls.includes('spell-card')) {
    await cards.nth(i).click();
    played = true;
  }
}
if (!played) throw new Error('No affordable unit card found');

// Drag from baseline (bottom of canvas) upward = vector fling.
const wrap = await page.locator('.game-canvas-wrap').boundingBox();
const sx = wrap.x + wrap.width * 0.5;
const sy = wrap.y + wrap.height * 0.86;
await page.mouse.move(sx, sy);
await page.mouse.down();
await page.mouse.move(sx + 10, sy - 120, { steps: 8 });
await page.screenshot({ path: `${shots}/06-drag-aim.png` });
await page.mouse.up();

// Wait a few ticks: unit should spawn and start marching.
await page.waitForTimeout(4000);
await page.screenshot({ path: `${shots}/07-unit-marching.png` });

// Fire the ultimate at mid-board.
await page.click('.ult-btn');
await page.mouse.click(wrap.x + wrap.width * 0.5, wrap.y + wrap.height * 0.4);
await page.waitForTimeout(2600);
await page.screenshot({ path: `${shots}/08-lava-rain.png` });

// Verify ult is now spent and the timer advanced.
const ultDisabled = await page.locator('.ult-btn').isDisabled();
const timer2 = await page.textContent('.timer');
await page.waitForTimeout(6000);
await page.screenshot({ path: `${shots}/09-battle.png` });

const state = {
  timer1,
  timer2,
  ultDisabled,
  errors,
};
console.log(JSON.stringify(state, null, 2));

if (errors.length) {
  console.error('FAIL: page errors detected');
  process.exit(1);
}
if (timer1 === timer2) {
  console.error('FAIL: timer did not advance (tick loop dead?)');
  process.exit(1);
}
if (!ultDisabled) {
  console.error('FAIL: ultimate did not consume');
  process.exit(1);
}

/* ------- accelerated full match: both phases through to results --------- */
await page.goto(`${BASE}?p1ticks=60&p2ticks=40`, { waitUntil: 'networkidle' });
// The cinematic gate plays on every boot (it doubles as the audio unlock).
const tap2 = page.locator('.tap-to-begin');
if (await tap2.count()) {
  await tap2.click();
  await page.click('.skip-btn');
}
await page.waitForSelector('.menu', { timeout: 5000 });
await page.click('text=Battle');
await page.waitForSelector('.faction-select', { timeout: 5000 });
await page.click('text=March to the Basalt Fields');
await page.waitForSelector('.matchmaking', { timeout: 5000 });
await page.click('text=Play offline now');
await page.waitForSelector('.game-screen', { timeout: 8000 });

// Deploy a couple of units while phase 1 runs.
for (let round = 0; round < 2; round++) {
  await page.waitForTimeout(4200);
  const cs = page.locator('.hand .card');
  const cn = await cs.count();
  for (let i = 0; i < cn; i++) {
    const cls = (await cs.nth(i).getAttribute('class')) ?? '';
    if (!cls.includes('unaffordable') && !cls.includes('spell-card')) {
      await cs.nth(i).click();
      const wb = await page.locator('.game-canvas-wrap').boundingBox();
      await page.mouse.move(wb.x + wb.width * (0.3 + round * 0.35), wb.y + wb.height * 0.86);
      await page.mouse.down();
      await page.mouse.move(wb.x + wb.width * 0.5, wb.y + wb.height * 0.5, { steps: 6 });
      await page.mouse.up();
      break;
    }
  }
}

// Phase 1 = 60 ticks * 0.3s = 18s, transition ≈ 4s, phase 2 = 40 ticks = 12s.
await page.waitForTimeout(15000);
await page.screenshot({ path: `${shots}/10-transition-or-oasis.png` });
const phasePill = await page.textContent('.phase-pill').catch(() => 'gone');
await page.waitForSelector('.results', { timeout: 45000 });
await page.screenshot({ path: `${shots}/11-results.png` });
const resultTitle = await page.textContent('.results h1');

console.log(JSON.stringify({ phasePill, resultTitle, errors }, null, 2));
if (errors.length) {
  console.error('FAIL: page errors during full match');
  process.exit(1);
}
console.log('SMOKE PASS (including full two-phase match to results)');
await browser.close();
