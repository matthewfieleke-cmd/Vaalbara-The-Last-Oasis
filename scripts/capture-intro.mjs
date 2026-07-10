/* Intro cinematic captures: T-Rex full-width, Wolves/Bighorn all 8 parade frames.
 *   node scripts/capture-intro.mjs
 * Requires preview on :4310. */
import { chromium } from 'playwright';
import { beginIntro, launchPage, OUT, shotAt } from './capture-helpers.mjs';

const { browser, page } = await launchPage(chromium);
const t0 = await beginIntro(page);

// Story cards
await shotAt(t0, page, 2.5, 'intro-01-title');
await shotAt(t0, page, 9.5, 'intro-02-oasis');

// T-Rex — per-frame width up to 90%; check snout/tail not clipped
await shotAt(t0, page, 21.0, 'intro-trex-a');
await shotAt(t0, page, 22.4, 'intro-trex-b');
await shotAt(t0, page, 23.8, 'intro-trex-c');

// Bighorn — 8 parade frames (beat 52.0–55.6 s, ~0.45 s apart)
for (let i = 0; i < 8; i++) {
  await shotAt(t0, page, 52.1 + i * 0.42, `intro-bighorn-frame-${i}`);
}

// Wolves — 8 parade frames (beat 59.2–62.8 s)
for (let i = 0; i < 8; i++) {
  await shotAt(t0, page, 59.3 + i * 0.42, `intro-wolves-frame-${i}`);
}

// Eagle centering sanity check
await shotAt(t0, page, 28.8, 'intro-eagle');

console.log(`Intro captures written to ${OUT}`);
await browser.close();
