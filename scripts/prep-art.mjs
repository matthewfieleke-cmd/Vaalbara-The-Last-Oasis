/* One-time art pipeline: normalizes the uploaded paintings into game-ready
 * webp files under public/art/. Characters capped at 640px wide, backgrounds
 * kept portrait at sensible resolutions. Run: node scripts/prep-art.mjs */
import sharp from 'sharp';
import fs from 'node:fs';

const jobs = [
  // [source, output, maxWidth]
  ['art-src/Trex.png', 'public/art/trex.webp', 640],
  ['art-src/Lion.png', 'public/art/lion.webp', 640],
  ['art-src/Eagle.png', 'public/art/eagle.webp', 640],
  ['art-src/Honeybadger.png', 'public/art/honeybadger.webp', 640],
  ['art-src/Scorpion.png', 'public/art/scorpion.webp', 640],
  ['art-src/Fire ants.png', 'public/art/fireants.webp', 640],
  ['art-src/Bear.png', 'public/art/bear.webp', 640],
  ['art-src/Bighorn.png', 'public/art/bighorn.webp', 640],
  ['art-src/Bees.png', 'public/art/bees.webp', 640],
  ['art-src/Wolves.png', 'public/art/wolves.webp', 800],
  ['art-src/Porcupine.png', 'public/art/porcupine.webp', 640],
  ['art-src/Beetle.png', 'public/art/beetles.webp', 640],
  ['art-src/Phase1.png', 'public/art/phase1.webp', 572],
  ['art-src/Phase2.png', 'public/art/phase2.webp', 760],
];

let total = 0;
for (const [src, out, maxW] of jobs) {
  const img = sharp(src);
  const meta = await img.metadata();
  const width = Math.min(maxW, meta.width ?? maxW);
  await img.resize({ width }).webp({ quality: 84 }).toFile(out);
  const kb = Math.round(fs.statSync(out).size / 1024);
  total += kb;
  console.log(`${out}  ${width}px  ${kb} KB`);
}
console.log(`total: ${total} KB`);
