/* Art pipeline: normalizes source paintings into game-ready webp under
 * public/art/, and builds the iOS/PWA icons from the Phase 1 arena.
 * Run: node scripts/prep-art.mjs */
import sharp from 'sharp';
import fs from 'node:fs';

fs.mkdirSync('public/art/anim', { recursive: true });

const portraits = [
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
];

const arenas = [
  ['art-src/arena1.png', 'public/art/arena1.webp', 820],
  ['art-src/arena2.png', 'public/art/arena2.webp', 820],
];

// Animation sheets: kept at full width so each frame stays ~300px.
const animSheets = fs.readdirSync('art-src/anim').filter((f) => f.endsWith('.png'));

let total = 0;
async function convert(src, out, maxW) {
  const img = sharp(src);
  const meta = await img.metadata();
  const width = Math.min(maxW, meta.width ?? maxW);
  await img.resize({ width }).webp({ quality: 84 }).toFile(out);
  const kb = Math.round(fs.statSync(out).size / 1024);
  total += kb;
  console.log(`${out}  ${width}px  ${kb} KB`);
}

for (const [src, out, w] of portraits) await convert(src, out, w);
for (const [src, out, w] of arenas) await convert(src, out, w);
for (const f of animSheets) {
  await convert(`art-src/anim/${f}`, `public/art/anim/${f.replace('.png', '.webp')}`, 1280);
}

/* iOS Home Screen + PWA icons from the Phase 1 arena: square crop centred on
 * the upper lava river (the most iconic slice of the painting). */
const a1 = sharp('art-src/arena1.png');
const m = await a1.metadata();
const side = m.width; // full width square
const topOffset = Math.round(m.height * 0.10);
const iconJobs = [
  ['public/apple-touch-icon.png', 180],
  ['public/icon-192.png', 192],
  ['public/icon-512.png', 512],
];
for (const [out, size] of iconJobs) {
  await sharp('art-src/arena1.png')
    .extract({ left: 0, top: topOffset, width: side, height: side })
    .resize(size, size)
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toFile(out);
  console.log(`${out}  ${size}px  ${Math.round(fs.statSync(out).size / 1024)} KB`);
}

console.log(`total webp: ${total} KB`);
