/* Validate intro parade source sheets.
 *
 * Intro art is authored as a 4 × 2 grid. Runtime now slices that grid
 * directly and performs non-destructive paper keying. Do not rewrite these
 * source PNGs: previous pixel eroders removed real Bighorn wool/face anatomy
 * and repeated T-Rex repadding split bodies at the panel midpoint.
 *
 *   node scripts/fix-intro-art.mjs
 */
import sharp from 'sharp';

const sheets = [
  'art-src/anim/trex-intro.png',
  'art-src/anim/wolf-intro.png',
  'art-src/anim/bighorn-intro.png',
  'art-src/anim/scorpion-intro.png',
];

for (const file of sheets) {
  const meta = await sharp(file).metadata();
  if (!meta.width || !meta.height || meta.width % 4 !== 0 || meta.height % 2 !== 0) {
    throw new Error(`${file} is not a valid 4 × 2 intro grid (${meta.width}×${meta.height})`);
  }
  console.log(`valid 4×2 intro grid: ${file} (${meta.width}×${meta.height})`);
}
