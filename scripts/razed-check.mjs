/* Captures the razed-gate sequence with low fortress HP: raze the enemy's
 * left gate, then film enemy reinforcements marching the causeway behind the
 * breach and clambering over the 3D rubble mound. State-aware: watches the
 * sim via window.__vbState and snaps fast whenever a unit is inside a razed
 * lane, logging which frames show breach traffic. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = '/tmp/razedview';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
await page.goto('http://localhost:4310', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.setItem('vaalbara.introSeen', '1'));
await page.reload({ waitUntil: 'networkidle' });
try {
  await page.click('.tap-to-begin', { timeout: 4000 });
  await page.click('.skip-btn', { timeout: 4000 });
} catch { /* already on menu */ }
await page.waitForSelector('.menu', { timeout: 8000 });
await page.click('text=Battle');
await page.click('.faction-card.oasis');
await page.click('text=March to the Basalt Fields');
await page.click('text=Play offline now');
await page.waitForSelector('.game-screen', { timeout: 8000 });
await page.waitForTimeout(1200);

// Exact screen position of the LEFT gate pad (world 1.75, 14.55) using the
// same letterboxed board fit as the renderer.
const wb = await page.locator('.game-canvas-wrap canvas').boundingBox();
const unit = Math.min(wb.width / 9.5, wb.height / 16.6);
const ox = wb.x + (wb.width - unit * 9) / 2;
const oy = wb.y + (wb.height - unit * 15) / 2 + unit * 0.35;
const padL = { x: ox + 1.75 * unit, y: oy + 14.55 * unit };
console.log('canvas', wb.width, wb.height, 'pad', padL.x - wb.x, padL.y - wb.y);

async function deployLeft() {
  const cards = page.locator('.hand .card:not(.unaffordable)');
  if (!(await cards.count())) return false;
  await cards.first().click();
  await page.mouse.click(padL.x, padL.y);
  return true;
}

// Sim probe: obelisk HPs + units currently in either fortress's lane zones.
const probe = () => page.evaluate(() => {
  const st = window.__vbState;
  if (!st) return null;
  const gates = st.obelisks.map((o) => ({ owner: o.owner, wing: o.wing, hp: o.hp }));
  const inZone = st.units
    .filter((u) => u.y < 3.35 || u.y > 11.65)
    .map((u) => ({ id: u.id, owner: u.owner, x: +u.x.toFixed(2), y: +u.y.toFixed(2) }));
  return { phase: st.phase, gates, inZone };
});

let shot = 0;
const snap = async (tag) => {
  await page.screenshot({ path: `${OUT}/${String(shot++).padStart(3, '0')}-${tag}.png` });
};

let razeSeen = false;
for (let i = 0; i < 500; i++) {
  const st = await probe();
  if (!st || st.phase !== 'basalt') {
    console.log(`iter ${i}: phase left basalt (${st?.phase}); razeSeen = ${razeSeen}`);
    break;
  }
  if (i % 12 === 0) console.log(`iter ${i}: gates`, JSON.stringify(st.gates));
  const enemyRazed = st.gates.some((g) => g.owner === 1 && g.hp <= 0);
  const ownRazed = st.gates.some((g) => g.owner === 0 && g.hp <= 0);
  // Push hard until the enemy breach opens, then stop feeding the lane so
  // the second gate survives and the bot's reinforcements march on camera.
  // Once OUR left gate falls too, resume deploying so our warriors scramble
  // our own mound on camera.
  if (!enemyRazed || (ownRazed && i % 3 === 0)) await deployLeft();
  if (!enemyRazed && !ownRazed) {
    await page.waitForTimeout(350);
    continue;
  }
  razeSeen = true;
  // A breach is open somewhere: film fast whenever a unit is inside a
  // razed fortress's zone; otherwise idle-snap slowly.
  const traffic = st.inZone.filter((u) => (enemyRazed && u.y < 3.35) || (ownRazed && u.y > 11.65));
  if (traffic.length) {
    console.log(`frame ${shot}: traffic`, JSON.stringify(traffic));
    await snap('traffic');
    await page.waitForTimeout(220);
  } else {
    if (i % 4 === 0) await snap('idle');
    await page.waitForTimeout(400);
  }
}
console.log('done', shot, 'frames; razeSeen =', razeSeen);
await browser.close();
