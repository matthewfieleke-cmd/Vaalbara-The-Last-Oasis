/* Capture the main menu (three moments, to see the flame/water animation). */
import { chromium } from 'playwright';
import { launchPage, skipIntroToMenu, OUT } from './capture-helpers.mjs';

const { browser, page } = await launchPage(chromium);
await skipIntroToMenu(page);
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/menu-a.png` });
await page.waitForTimeout(1400);
await page.screenshot({ path: `${OUT}/menu-b.png` });
await page.waitForTimeout(1700);
await page.screenshot({ path: `${OUT}/menu-c.png` });
await browser.close();
console.log('menu shots done');
