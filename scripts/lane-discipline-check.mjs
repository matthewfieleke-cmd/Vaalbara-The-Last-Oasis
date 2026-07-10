/* Scripted battlefield scenarios for lane-discipline visual QC.
 * A) Own left gate razed + enemy lion at own right gate: deployed warrior
 *    must stay in the left lane, scramble the rubble, THEN cross over.
 * B) Enemy bees exiting their own tunnel: centered until fully through.
 *   node scripts/lane-discipline-check.mjs
 * Requires preview on :4310. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { launchPage, skipIntroToMenu } from './capture-helpers.mjs';

const DIR = '/tmp/vaalbara-shots/scenarios';
mkdirSync(DIR, { recursive: true });

const { browser, page } = await launchPage(chromium);
await skipIntroToMenu(page);
await page.click('text=Battle');
await page.click('.faction-card.oasis');
await page.click('text=March to the Basalt Fields');
await page.click('text=Play offline now');
await page.waitForSelector('.game-screen', { timeout: 8000 });
await page.waitForTimeout(1200);

// Scenario setup: raze own left gate, inject a stunned enemy lion at our
// right gate mouth, and inject enemy bees on their own rear apron.
await page.evaluate(() => {
  const st = window.__vbState;
  const gate = st.obelisks.find((o) => o.owner === 0 && o.wing === 0);
  gate.hp = 0;
  const mk = (id, owner, species, x, y, hp, stun) => ({
    id, owner, species, x, y, px: x, py: y, hp, maxHp: hp,
    facing: owner === 0 ? 1 : -1, atkTimer: 0, traveled: 0, stompBank: 0,
    struckTargets: [], waypoint: null, stall: 0, stallRef: Infinity,
    buffs: { stun, slowTicks: 0, slowMult: 1, burnStacks: 0, burnTicks: 0, rangeCapTicks: 0, blessed: false, berserk: false },
    stealthed: false, action: 'idle', targetId: null,
  });
  st.units.push(mk(9001, 1, 'lion', 6.5, 11.35, 5000, 9999));
  st.units.push(mk(9002, 1, 'bees', 2.6, 0.55, 170, 0));
  st.players[0].aqua = 10;
});

// Deploy a named warrior on the razed LEFT pad.
const wb = await page.locator('.game-canvas-wrap canvas').boundingBox();
const unit = Math.min(wb.width / 9.5, wb.height / 16.6);
const ox = wb.x + (wb.width - unit * 9) / 2;
const oy = wb.y + (wb.height - unit * 15) / 2 + unit * 0.35;
let deployed = false;
for (let tries = 0; tries < 20 && !deployed; tries++) {
  await page.evaluate(() => { window.__vbState.players[0].aqua = 10; });
  for (const name of ['BIGHORN', 'WOLVES', 'BEAR', 'PORCUPINE']) {
    const card = page.locator('.hand .card:not(.unaffordable)', { hasText: name });
    if (!(await card.count())) continue;
    await card.first().click();
    await page.mouse.click(ox + 1.75 * unit, oy + 14.55 * unit);
    deployed = true;
    break;
  }
  if (!deployed) await page.waitForTimeout(700);
}
console.log('deployed:', deployed);

for (let i = 0; i < 26; i++) {
  const st = await page.evaluate(() => {
    const s = window.__vbState;
    return s.units
      .filter((u) => u.hp > 0)
      .map((u) => `${u.owner}:${u.species}@${u.x.toFixed(2)},${u.y.toFixed(2)}`)
      .join('  ');
  });
  console.log(`t=${i}  ${st}`);
  await page.screenshot({ path: `${DIR}/s-${String(i).padStart(2, '0')}.png` });
  await page.waitForTimeout(500);
}
console.log(`Scenario captures in ${DIR}`);
await browser.close();
