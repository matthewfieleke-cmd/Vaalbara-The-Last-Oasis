/* Add horizontal breathing room to trex-intro panels — the painted dino
 * currently touches both panel edges, so keyed frames clip snout/tail.
 * Scales each panel to 86% and centres it on white paper.
 *
 *   node scripts/repad-trex-intro.mjs
 *   node scripts/prep-art.mjs   # refresh trex-intro.webp
 */
import sharp from 'sharp';

const SRC = 'art-src/anim/trex-intro.png';
const OUT = SRC;
const FRAMES = 8;
const SCALE = 0.86;

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const pw = Math.floor(W / FRAMES);
const out = Buffer.from(data);

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
  const dw = Math.round(pw * SCALE);
  const dh = Math.round(H * SCALE);
  const scaled = await sharp(panel, { raw: { width: pw, height: H, channels: 4 } })
    .resize(dw, dh, { fit: 'inside' })
    .png()
    .toBuffer();
  const meta = await sharp(scaled).metadata();
  const ox = Math.floor((pw - meta.width) / 2);
  const oy = Math.floor((H - meta.height) / 2);
  const centred = await sharp({
    create: { width: pw, height: H, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  }).composite([{ input: scaled, left: ox, top: oy }]).png().toBuffer();
  const cd = await sharp(centred).ensureAlpha().raw().toBuffer();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < pw; x++) {
      const di = (y * W + x0 + x) * 4;
      const si = (y * pw + x) * 4;
      out[di] = cd[si];
      out[di + 1] = cd[si + 1];
      out[di + 2] = cd[si + 2];
      out[di + 3] = cd[si + 3];
    }
  }
}

await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toFile(OUT);
console.log(`Re-padded ${OUT} (${FRAMES} panels @ ${SCALE} scale)`);
