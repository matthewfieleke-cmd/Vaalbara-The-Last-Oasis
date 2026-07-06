/* Replicates the sprites.ts pipeline (splitStrip -> keyBackground -> crop ->
 * area-matched normalization) for a KO sheet and composes the 4 frames on a
 * shared ground line, exactly as the duel stage would draw them.
 * Usage: node scripts/ko-frames.mjs <species> */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const species = process.argv[2] ?? 'honeybadger';
mkdirSync('/tmp/ko-frames', { recursive: true });

async function loadRaw(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { px: data, w: info.width, h: info.height };
}

function keyBackground(px, w, h) {
  const bgLike = (i) => {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return (mx > 196 && mx - mn < 26) || (r > 150 && b > 150 && g < r * 0.7 && g < b * 0.7);
  };
  const borderMins = [];
  const sample = (i) => { if (bgLike(i * 4)) borderMins.push(Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2])); };
  for (let x = 0; x < w; x++) { sample(x); sample((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { sample(y * w); sample(y * w + w - 1); }
  borderMins.sort((a, b) => a - b);
  const paperRef = borderMins.length ? borderMins[Math.floor(borderMins.length * 0.25)] : 250;
  const pureFloor = Math.max(200, paperRef - 14);
  const pure = (i) => {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return (mn > pureFloor && mx - mn < 10) || (r > 150 && b > 150 && g < r * 0.7 && g < b * 0.7);
  };
  const bg = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) bg[i] = bgLike(i * 4) ? 1 : 0;
  const deep = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!bg[i]) continue;
    if (x === 0 || x === w - 1 || y === 0 || y === h - 1) { deep[i] = 1; continue; }
    let ok = pure(i * 4);
    for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!bg[i + dy * w + dx]) { ok = 0; break; }
    }
    deep[i] = ok ? 1 : 0;
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
      if (!reach[ni] && deep[ni]) { reach[ni] = 1; work.push(ni); }
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
  for (let i = 0; i < w * h; i++) if (reach[i] === 1) px[i * 4 + 3] = 0;
}

function bounds(px, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (px[(y * w + x) * 4 + 3] > 16) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < minX ? null : { minX, minY, maxX, maxY };
}

function area(px) {
  let n = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] > 16) n++;
  return Math.max(1, n);
}

// splitStrip separator detection (magenta rules).
async function splitSheet(file, expected) {
  const { px, w, h } = await loadRaw(file);
  const magenta = new Array(w).fill(0);
  const ink = new Array(w).fill(0);
  for (let x = 0; x < w; x++) {
    let nMag = 0, nInk = 0, t = 0;
    for (let y = 0; y < h; y += 3) {
      const i = (y * w + x) * 4;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (r > 140 && b > 140 && g < r * 0.72 && g < b * 0.72) nMag++;
      if (!(mx > 196 && mx - mn < 26)) nInk++;
      t++;
    }
    magenta[x] = nMag / t;
    ink[x] = nInk / t;
  }
  const cuts = [];
  const maxRule = Math.max(6, Math.round(w * 0.012));
  let x = 4;
  while (x < w - 4) {
    const isMag = magenta[x] > 0.5;
    const isRule = ink[x] > 0.7;
    if (isMag || isRule) {
      let x2 = x;
      while (x2 < w - 1 && (isMag ? magenta[x2] > 0.15 : ink[x2] > 0.6)) x2++;
      const gutterL = ink[Math.max(0, x - 3)] < 0.05;
      const gutterR = ink[Math.min(w - 1, x2 + 3)] < 0.05;
      if (isMag || (x2 - x <= maxRule && gutterL && gutterR)) {
        cuts.push({ a: x, b: x2 });
        x = x2 + Math.round(w * 0.05);
        continue;
      }
      x = x2 + 1;
    } else x++;
  }
  console.log('cuts:', JSON.stringify(cuts));
  const inset = Math.max(2, Math.round(w * 0.004));
  const ranges = [];
  if (cuts.length >= expected - 1) {
    const used = cuts.slice(0, expected - 1);
    for (let i = 0; i < expected; i++) {
      const x0 = i === 0 ? 0 : used[i - 1].b + inset;
      const x1 = i === expected - 1 ? w : used[i].a - inset;
      ranges.push([x0, x1]);
    }
  } else {
    const step = w / expected;
    for (let i = 0; i < expected; i++) {
      ranges.push([Math.round(i * step) + (i === 0 ? 0 : inset), Math.round((i + 1) * step) - (i === expected - 1 ? 0 : inset)]);
    }
  }
  const frames = [];
  for (const [x0, x1] of ranges) {
    const fw = x1 - x0;
    const fpx = Buffer.alloc(fw * h * 4);
    for (let y = 0; y < h; y++) {
      px.copy(fpx, y * fw * 4, (y * w + x0) * 4, (y * w + x1) * 4);
    }
    keyBackground(fpx, fw, h);
    const b = bounds(fpx, fw, h);
    if (!b) { frames.push(null); continue; }
    const cw = b.maxX - b.minX + 1 + 4, ch = b.maxY - b.minY + 1 + 4;
    const cx0 = Math.max(0, b.minX - 2), cy0 = Math.max(0, b.minY - 2);
    const cpx = Buffer.alloc(cw * ch * 4);
    for (let y = 0; y < ch; y++) {
      const sy = cy0 + y;
      if (sy >= h) break;
      px.copy; // noop
      fpx.copy(cpx, y * cw * 4, (sy * fw + cx0) * 4, (sy * fw + Math.min(fw, cx0 + cw)) * 4);
    }
    frames.push({ px: cpx, w: cw, h: ch, area: area(cpx) });
  }
  return frames;
}

const runFrames = await splitSheet(`public/art/anim/${species}-run.webp`, 4);
const koFrames = await splitSheet(`public/art/anim/${species}-ko.webp`, 4);
const runH = Math.max(...runFrames.filter(Boolean).map((f) => f.h));
const runArea = runFrames.filter(Boolean).reduce((a, f) => a + f.area, 0) / runFrames.filter(Boolean).length;

console.log(`run: H=${runH} meanArea=${Math.round(runArea)}`);
const CANVAS_H = 360;
const scaleBase = 300; // logical px for runH
const composites = [];
for (let i = 0; i < koFrames.length; i++) {
  const f = koFrames[i];
  if (!f) { console.log(`ko[${i}]: EMPTY`); continue; }
  const logicalH = runH * Math.sqrt(f.area / runArea); // crossH per frame
  const scale = (scaleBase / runH) * (logicalH / f.h); // drawn scale: targetH/logicalH per game, sprite h maps via logicalH
  // In game: drawn height = targetH * (f.h / logicalH)?? Actually scale = targetH / s.h where s.h = logicalH.
  // Drawn pixel height of the frame = f.h * (targetH / logicalH).
  const drawnH = Math.round(f.h * (scaleBase / logicalH));
  const drawnW = Math.round(f.w * (scaleBase / logicalH));
  console.log(`ko[${i}]: crop=${f.w}x${f.h} area=${f.area} logicalH=${Math.round(logicalH)} drawn=${drawnW}x${drawnH}`);
  const buf = await sharp(f.px, { raw: { width: f.w, height: f.h, channels: 4 } })
    .resize({ width: Math.max(1, drawnW), height: Math.max(1, drawnH), fit: 'fill' }).png().toBuffer();
  composites.push({ buf, w: drawnW, h: drawnH });
}
const totalW = composites.reduce((a, c) => a + c.w + 20, 20);
const strip = sharp({ create: { width: totalW, height: CANVAS_H, channels: 4, background: { r: 24, g: 26, b: 30, alpha: 1 } } });
let xo = 20;
const layers = [];
for (const c of composites) {
  layers.push({ input: c.buf, left: xo, top: Math.max(0, CANVAS_H - 20 - c.h) });
  xo += c.w + 20;
}
await strip.composite(layers).png().toFile(`/tmp/ko-frames/${species}.png`);
console.log(`wrote /tmp/ko-frames/${species}.png`);
