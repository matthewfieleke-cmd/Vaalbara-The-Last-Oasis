/* Replicates src/sprites.ts keyBackground in Node to tune thresholds.
 * Usage: node scripts/key-test.mjs [sheet.png] [outname]  */
import sharp from 'sharp';

const file = process.argv[2] ?? 'art-src/anim/bighorn-run.png';
const out = process.argv[3] ?? 'key-test';
const { data: px, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const w = info.width, h = info.height;

const bgLike = (i) => {
  const r = px[i], g = px[i + 1], b = px[i + 2];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const grey = mx > 196 && mx - mn < 26;
  const magenta = r > 150 && b > 150 && g < r * 0.7 && g < b * 0.7;
  return grey || magenta;
};

const borderMins = [];
const borderSample = (i) => {
  if (bgLike(i * 4)) borderMins.push(Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]));
};
for (let x = 0; x < w; x++) { borderSample(x); borderSample((h - 1) * w + x); }
for (let y = 0; y < h; y++) { borderSample(y * w); borderSample(y * w + w - 1); }
borderMins.sort((a, b) => a - b);
const paperRef = borderMins.length ? borderMins[Math.floor(borderMins.length * 0.25)] : 250;
const pureFloor = Math.max(200, paperRef - 14);

const pure = (i) => {
  const r = px[i], g = px[i + 1], b = px[i + 2];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const white = mn > pureFloor && mx - mn < 10;
  const magenta = r > 150 && b > 150 && g < r * 0.7 && g < b * 0.7;
  return white || magenta;
};

const bg = new Uint8Array(w * h);
for (let i = 0; i < w * h; i++) bg[i] = bgLike(i * 4) ? 1 : 0;

const deep = new Uint8Array(w * h);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!bg[i]) continue;
    if (x === 0 || x === w - 1 || y === 0 || y === h - 1) { deep[i] = 1; continue; }
    let ok = pure(i * 4);
    for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!bg[i + dy * w + dx]) { ok = 0; break; }
    }
    deep[i] = ok ? 1 : 0;
  }
}

const reach = new Uint8Array(w * h);
const work = [];
const seed = (s) => { if (!reach[s] && deep[s]) { reach[s] = 1; work.push(s); } };
for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
while (work.length) {
  const cur = work.pop();
  const cy = (cur / w) | 0, cx = cur % w;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = cx + dx, ny = cy + dy;
    if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
    const ni = ny * w + nx;
    if (reach[ni] || !deep[ni]) continue;
    reach[ni] = 1; work.push(ni);
  }
}
for (let pass = 0; pass < 3; pass++) {
  let grew = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (reach[i] || !bg[i]) continue;
    if ((x > 0 && reach[i - 1] === 1) || (x < w - 1 && reach[i + 1] === 1)
      || (y > 0 && reach[i - w] === 1) || (y < h - 1 && reach[i + w] === 1)) { reach[i] = 2; grew = true; }
  }
  for (let i = 0; i < w * h; i++) if (reach[i] === 2) reach[i] = 1;
  if (!grew) break;
}
// Paint removed pixels hot pink so leaks/halos are obvious.
let removed = 0;
for (let i = 0; i < w * h; i++) {
  if (reach[i] === 1) { px[i * 4] = 255; px[i * 4 + 1] = 0; px[i * 4 + 2] = 128; removed++; }
}
await sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toFile(`/tmp/vaalbara-shots/${out}.png`);
console.log(`wrote /tmp/vaalbara-shots/${out}.png  removed=${(removed / (w * h) * 100).toFixed(1)}%`);
