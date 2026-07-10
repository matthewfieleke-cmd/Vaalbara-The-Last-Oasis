/* Shared Playwright helpers for Vaalbara visual capture scripts.
 * Assumes `npm run build && npx vite preview --port 4310` is running. */
import { mkdirSync } from 'node:fs';

export const PORT = 4310;
export const BASE = `http://localhost:${PORT}`;
export const OUT = '/tmp/vaalbara-shots';

export function ensureOut() {
  mkdirSync(OUT, { recursive: true });
}

/** Fresh session → tap to begin → skip intro → menu. */
export async function skipIntroToMenu(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.tap-to-begin', { timeout: 12000 });
  await page.click('.tap-to-begin');
  await page.waitForSelector('.skip-btn', { timeout: 8000 });
  await page.click('.skip-btn');
  await page.waitForSelector('.menu', { timeout: 8000 });
}

/** Play full intro from tap; returns wall-clock t0 for timed shots. */
export async function beginIntro(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.tap-to-begin', { timeout: 12000 });
  await page.click('.tap-to-begin');
  await page.waitForSelector('.skip-btn', { timeout: 8000 });
  return Date.now();
}

export async function shotAt(t0, page, sec, name, dir = OUT) {
  const wait = t0 + sec * 1000 - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  await page.screenshot({ path: `${dir}/${name}.png` });
}

export async function launchPage(chromium, opts = {}) {
  ensureOut();
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    ...opts,
  });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  return { browser, page };
}
