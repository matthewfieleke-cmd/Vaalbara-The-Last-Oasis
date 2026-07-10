/* Build scorpion-duel-attack.png — 6-frame forward tail-strike strip for Duels.
 * The intro source already faces RIGHT (duel side-0 convention): keep the
 * body facing the opponent while its tail arcs forward from behind.
 *
 *   node scripts/gen-scorpion-duel-attack.mjs
 */
import sharp from 'sharp';

const INTRO = 'art-src/anim/scorpion-intro.png';
const OUT = 'art-src/anim/scorpion-duel-attack.png';

/** Intro parade indices: coil → wind → strike arc (tip at index 4) → recoil */
const FRAME_IDX = [0, 1, 2, 4, 5, 6];
const PANELS = 6;

async function loadRaw(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

function slicePanel(data, w, h, idx) {
  const cols = 4;
  const rows = 2;
  const pw = Math.floor(w / cols);
  const ph = Math.floor(h / rows);
  const x0 = (idx % cols) * pw;
  const y0 = Math.floor(idx / cols) * ph;
  const out = Buffer.alloc(pw * ph * 4);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const si = ((y0 + y) * w + x0 + x) * 4;
      const di = (y * pw + x) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = data[si + 3];
    }
  }
  return { data: out, w: pw, h: ph };
}

async function main() {
  const intro = await loadRaw(INTRO);
  const panels = [];
  for (let i = 0; i < PANELS; i++) {
    const idx = FRAME_IDX[i] ?? i;
    const { data, w, h } = slicePanel(intro.data, intro.w, intro.h, idx);
    const panel = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
    const meta = await sharp(panel).metadata();
    panels.push({ buf: panel, w: meta.width, h: meta.height });
  }

  const maxH = Math.max(...panels.map((p) => p.h));
  const maxW = Math.max(...panels.map((p) => p.w));
  const pad = 6;
  const panelW = maxW + pad * 2;
  const panelH = maxH + pad * 2;
  const stripW = panelW * PANELS;
  const composites = [];
  for (let i = 0; i < PANELS; i++) {
    const p = panels[i];
    const keyed = await sharp(p.buf).extend({
      top: pad + Math.floor((maxH - p.h) / 2),
      bottom: pad + Math.ceil((maxH - p.h) / 2),
      left: pad + Math.floor((maxW - p.w) / 2),
      right: pad + Math.ceil((maxW - p.w) / 2),
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    }).png().toBuffer();
    composites.push({ input: keyed, left: i * panelW, top: 0 });
  }

  await sharp({
    create: {
      width: stripW,
      height: panelH,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  }).composite(composites).png().toFile(OUT);

  console.log(`Wrote ${OUT} (${stripW}x${panelH}, ${PANELS} frames)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
