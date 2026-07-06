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

/* Some generated sheets carry solid black letterbox bars at the top/bottom
 * (and occasionally the sides). They survive white-keying at load time and
 * corrupt the frames' ground anchors, so strip them here before resizing. */
async function convertSheet(src, out, maxW) {
  const { data, info } = await sharp(src).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const rowBlack = (y) => {
    let n = 0, t = 0;
    for (let x = 0; x < w; x += 4) {
      const i = (y * w + x) * 4;
      if (data[i] < 34 && data[i + 1] < 34 && data[i + 2] < 34) n++;
      t++;
    }
    return n / t;
  };
  const colBlack = (x) => {
    let n = 0, t = 0;
    for (let y = 0; y < h; y += 4) {
      const i = (y * w + x) * 4;
      if (data[i] < 34 && data[i + 1] < 34 && data[i + 2] < 34) n++;
      t++;
    }
    return n / t;
  };
  let top = 0;
  while (top < h * 0.3 && rowBlack(top) > 0.85) top++;
  let bot = h;
  while (bot > h * 0.7 && rowBlack(bot - 1) > 0.85) bot--;
  let left = 0;
  while (left < w * 0.2 && colBlack(left) > 0.85) left++;
  let right = w;
  while (right > w * 0.8 && colBlack(right - 1) > 0.85) right--;
  // Shave the anti-aliased fringe the bars leave behind.
  if (top > 0) top = Math.min(h - 1, top + 2);
  if (bot < h) bot = Math.max(top + 1, bot - 2);
  if (left > 0) left = Math.min(w - 1, left + 2);
  if (right < w) right = Math.max(left + 1, right - 2);

  const cw = right - left;
  const ch = bot - top;
  const width = Math.min(maxW, cw);
  await sharp(src)
    .extract({ left, top, width: cw, height: ch })
    .resize({ width })
    .webp({ quality: 84 })
    .toFile(out);
  const kb = Math.round(fs.statSync(out).size / 1024);
  total += kb;
  const trimmed = top || left || bot < h || right < w ? '  (bars trimmed)' : '';
  console.log(`${out}  ${width}px  ${kb} KB${trimmed}`);
}

for (const [src, out, w] of portraits) await convert(src, out, w);
for (const [src, out, w] of arenas) await convert(src, out, w);
for (const f of animSheets) {
  await convertSheet(`art-src/anim/${f}`, `public/art/anim/${f.replace('.png', '.webp')}`, 1280);
}

/* iOS Home Screen + PWA icons from the dedicated app icon painting. */
const iconJobs = [
  ['public/apple-touch-icon.png', 180],
  ['public/icon-192.png', 192],
  ['public/icon-512.png', 512],
  ['public/favicon.png', 64],
];
for (const [out, size] of iconJobs) {
  await sharp('art-src/app-icon.png')
    .resize(size, size, { fit: 'cover' })
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toFile(out);
  console.log(`${out}  ${size}px  ${Math.round(fs.statSync(out).size / 1024)} KB`);
}

console.log(`total webp: ${total} KB`);
