/* Source-level fixes for intro parade sheets before prep-art runs.
 *
 *   node scripts/fix-intro-art.mjs
 *   node scripts/prep-art.mjs
 */
import sharp from 'sharp';

const FRAMES = 8;

async function processStrip(src, out, perPanel) {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const pw = Math.floor(W / FRAMES);
  const buf = Buffer.from(data);

  for (let f = 0; f < FRAMES; f++) {
    const x0 = f * pw;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < pw; x++) {
        const i = (y * W + x0 + x) * 4;
        perPanel(buf, i, x, y, pw, H, f);
      }
    }
  }

  await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toFile(out);
  console.log(`fixed ${out}`);
}

function paper(px, i) {
  const mx = Math.max(px[i], px[i + 1], px[i + 2]);
  const mn = Math.min(px[i], px[i + 1], px[i + 2]);
  return mx > 168 && mx - mn < 48;
}

function hornInk(px, i) {
  return px[i + 3] > 40 && px[i + 1] > Math.max(px[i], px[i + 2]) * 0.82;
}

// T-Rex: horizontal breathing room only — keeps full height, avoids mid-body gap.
async function repadTrex() {
  const src = 'art-src/anim/trex-intro.png';
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const pw = Math.floor(W / FRAMES);
  const out = Buffer.from(data);
  const scaleX = 0.93;

  for (let f = 0; f < FRAMES; f++) {
    const x0 = f * pw;
    const panel = Buffer.alloc(pw * H * 4, 255);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < pw; x++) {
        const si = (y * W + x0 + x) * 4;
        const di = (y * pw + x) * 4;
        panel[di] = data[si];
        panel[di + 1] = data[si + 1];
        panel[di + 2] = data[si + 2];
        panel[di + 3] = data[si + 3];
      }
    }
    const dw = Math.round(pw * scaleX);
    const scaled = await sharp(panel, { raw: { width: pw, height: H, channels: 4 } })
      .resize(dw, H, { fit: 'fill' })
      .png()
      .toBuffer();
    const cd = await sharp(scaled).ensureAlpha().raw().toBuffer();
    const ox = Math.floor((pw - dw) / 2);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < pw; x++) {
        const di = (y * W + x0 + x) * 4;
        if (x < ox || x >= ox + dw) {
          out[di] = 255;
          out[di + 1] = 255;
          out[di + 2] = 255;
          out[di + 3] = 255;
        } else {
          const si = (y * dw + (x - ox)) * 4;
          out[di] = cd[si];
          out[di + 1] = cd[si + 1];
          out[di + 2] = cd[si + 2];
          out[di + 3] = cd[si + 3];
        }
      }
    }
  }
  await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toFile(src);
  console.log(`re-padded ${src} (horizontal ${scaleX})`);
}

await repadTrex();

await processStrip('art-src/anim/wolf-intro.png', 'art-src/anim/wolf-intro.png', (px, i, x, y, pw, H) => {
  const yf = y / H;
  const xf = x / pw;
  if (yf < 0.42 || yf > 0.92) return;
  if (xf < 0.14 || xf > 0.86) return;
  if (!paper(px, i) || px[i + 3] === 0) return;
  let ink = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0]]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= pw || ny < 0 || ny >= H) continue;
    const ni = (ny * pw + nx) * 4;
    if (!paper(px, ni) && px[ni + 3] > 20) ink++;
  }
  if (ink >= 2) px[i + 3] = 0;
  // Right leg-gap band
  if (xf >= 0.52 && xf <= 0.78 && yf >= 0.52 && yf <= 0.82 && paper(px, i)) {
    let fur = 0;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= pw || ny < 0 || ny >= H) continue;
        const ni = (ny * pw + nx) * 4;
        if (!paper(px, ni) && px[ni + 3] > 30) fur++;
      }
    }
    if (fur >= 4) px[i + 3] = 0;
  }
});

await processStrip('art-src/anim/bighorn-intro.png', 'art-src/anim/bighorn-intro.png', (px, i, x, y, pw, H) => {
  const yf = y / H;
  const xf = x / pw;
  if (yf < 0.02 || yf > 0.20 || xf < 0.28 || xf > 0.72) return;
  if (!paper(px, i) || px[i + 3] === 0) return;
  const reach = Math.max(14, Math.round(pw * 0.30));
  let hornL = false;
  let hornR = false;
  for (let dx = 1; dx <= reach; dx++) {
    if (x - dx >= 0 && hornInk(px, (y * pw + x - dx) * 4)) hornL = true;
    if (x + dx < pw && hornInk(px, (y * pw + x + dx) * 4)) hornR = true;
  }
  if (hornL && hornR) px[i + 3] = 0;
});

console.log('Intro art fixes complete.');
