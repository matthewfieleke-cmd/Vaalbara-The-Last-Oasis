/* Razed-gate causeway perspective: enemy march depth + own-exit no-shrink.
 *   node scripts/capture-causeway.mjs
 * Requires preview on :4310. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { launchPage, skipIntroToMenu } from './capture-helpers.mjs';

const OUT = '/tmp/vaalbara-causeway';
mkdirSync(OUT, { recursive: true });

const { browser, page } = await launchPage(chromium);
await skipIntroToMenu(page);
await page.click('text=Battle');
await page.click('.faction-card.oasis');
await page.click('text=March to the Basalt Fields');
await page.click('text=Play offline now');
await page.waitForSelector('.game-screen', { timeout: 8000 });
await page.waitForTimeout(1200);

const wb = await page.locator('.game-canvas-wrap canvas').boundingBox();
const unit = Math.min(wb.width / 9.5, wb.height / 16.6);
const ox = wb.x + (wb.width - unit * 9) / 2;
const oy = wb.y + (wb.height - unit * 15) / 2 + unit * 0.35;
const padL = { x: ox + 1.75 * unit, y: oy + 14.55 * unit };

async function deployLeft() {
  const cards = page.locator('.hand .card:not(.unaffordable)');
  if (!(await cards.count())) return false;
  await cards.first().click();
  await page.mouse.click(padL.x, padL.y);
  return true;
}

const probe = () => page.evaluate(() => {
  const st = window.__vbState;
  if (!st) return null;
  const gates = st.obelisks.map((o) => ({ owner: o.owner, wing: o.wing, hp: o.hp }));
  const inZone = st.units
    .filter((u) => u.y < 3.35 || u.y > 11.65)
    .map((u) => ({
      id: u.id, owner: u.owner, species: u.species,
      x: +u.x.toFixed(2), y: +u.y.toFixed(2),
    }));
  return { phase: st.phase, gates, inZone };
});

let shot = 0;
const snap = async (tag) => {
  await page.screenshot({ path: `${OUT}/${String(shot++).padStart(3, '0')}-${tag}.png` });
};

let razeSeen = false;
for (let i = 0; i < 500; i++) {
  const st = await probe();
  if (!st || st.phase !== 'basalt') break;
  const enemyRazed = st.gates.some((g) => g.owner === 1 && g.hp <= 0);
  const ownRazed = st.gates.some((g) => g.owner === 0 && g.hp <= 0);
  if (!enemyRazed || (ownRazed && i % 3 === 0)) await deployLeft();
  if (!enemyRazed && !ownRazed) {
    await page.waitForTimeout(350);
    continue;
  }
  razeSeen = true;
  const traffic = st.inZone.filter((u) => (enemyRazed && u.y < 3.35) || (ownRazed && u.y > 11.65));
  if (traffic.length) {
    console.log(`frame ${shot}:`, JSON.stringify(traffic));
    await snap('traffic');
    await page.waitForTimeout(220);
  } else if (i % 4 === 0) {
    await snap('idle');
    await page.waitForTimeout(400);
  } else {
    await page.waitForTimeout(400);
  }
}

console.log(`Causeway captures: ${shot} frames in ${OUT}; razeSeen=${razeSeen}`);
await browser.close();
