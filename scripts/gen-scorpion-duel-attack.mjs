/* Build scorpion-duel-attack.png — 6-frame forward tail-strike strip for Duels.
 * The body remains facing RIGHT. The ACTUAL painted tail is isolated from
 * the intro artwork, articulated around its root, and swept over the body
 * toward the opponent — no synthetic replacement tail.
 *
 *   node scripts/gen-scorpion-duel-attack.mjs
 */
import sharp from 'sharp';

const INTRO = 'art-src/anim/scorpion-intro.png';
const OUT = 'art-src/anim/scorpion-duel-attack.png';

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
  const source = slicePanel(intro.data, intro.w, intro.h, 0);
  const { data, w, h } = source;

  // Remove only the distal tail. The proximal root remains painted into the
  // body; actual armour/stinger crops are then articulated from that hinge.
  const tailPoly = [
    [18, 214], [18, 112], [42, 88], [92, 92], [148, 108],
    [207, 138], [214, 241], [174, 255], [128, 214], [75, 204],
    [48, 221],
  ];
  const inside = (x, y) => {
    let hit = false;
    for (let i = 0, j = tailPoly.length - 1; i < tailPoly.length; j = i++) {
      const [xi, yi] = tailPoly[i];
      const [xj, yj] = tailPoly[j];
      if (((yi > y) !== (yj > y))
        && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const paper = (i) => {
    const mx = Math.max(data[i], data[i + 1], data[i + 2]);
    const mn = Math.min(data[i], data[i + 1], data[i + 2]);
    return mx > 190 && mx - mn < 34;
  };
  const body = Buffer.from(data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (inside(x, y)) {
        body[i] = 255;
        body[i + 1] = 255;
        body[i + 2] = 255;
        body[i + 3] = 255;
      }
    }
  }
  const bodyPng = await sharp(body, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  const bodyUri = `data:image/png;base64,${bodyPng.toString('base64')}`;

  const defs = [
    { x: 27, y: 120, w: 55, h: 85, tx: 76, ty: 178, rot: -18 },
    { x: 45, y: 94, w: 75, h: 65, tx: 105, ty: 155, rot: -10 },
    { x: 85, y: 94, w: 72, h: 62, tx: 138, ty: 140, rot: -4 },
    { x: 85, y: 94, w: 72, h: 62, tx: 172, ty: 132, rot: 2 },
    { x: 85, y: 94, w: 72, h: 62, tx: 207, ty: 129, rot: 7 },
    { x: 85, y: 94, w: 72, h: 62, tx: 242, ty: 132, rot: 12 },
    { x: 124, y: 111, w: 70, h: 68, tx: 275, ty: 140, rot: 20 },
    { x: 130, y: 140, w: 88, h: 110, tx: 320, ty: 157, rot: -56 },
  ];
  const pieces = [];
  for (const def of defs) {
    const buf = Buffer.alloc(def.w * def.h * 4);
    for (let y = 0; y < def.h; y++) {
      for (let x = 0; x < def.w; x++) {
        const si = ((def.y + y) * w + def.x + x) * 4;
        const di = (y * def.w + x) * 4;
        if (!paper(si)) {
          buf[di] = data[si];
          buf[di + 1] = data[si + 1];
          buf[di + 2] = data[si + 2];
          buf[di + 3] = data[si + 3];
        }
      }
    }
    const png = await sharp(buf, {
      raw: { width: def.w, height: def.h, channels: 4 },
    }).png().toBuffer();
    pieces.push({ ...def, uri: `data:image/png;base64,${png.toString('base64')}` });
  }

  // Coil → lift → extend → full contact → recoil.
  const progress = [0, 0.16, 0.4, 0.72, 1, 0.28];
  const canvasW = 560;
  const offsetX = 18;
  const panels = [];
  for (let i = 0; i < PANELS; i++) {
    const p = progress[i] * progress[i] * (3 - 2 * progress[i]);
    const tailImages = pieces.map((piece) => {
      const ox = offsetX + piece.x + piece.w / 2;
      const oy = piece.y + piece.h / 2;
      const tx = ox + (piece.tx - ox) * p;
      const ty = oy + (piece.ty - oy) * p;
      const rot = piece.rot * p;
      return `<g transform="translate(${tx} ${ty}) rotate(${rot}) translate(${-piece.w / 2} ${-piece.h / 2})">
        <image href="${piece.uri}" width="${piece.w}" height="${piece.h}"/>
      </g>`;
    }).join('');
    const svg = Buffer.from(`
      <svg width="${canvasW}" height="${h}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white"/>
        <image href="${bodyUri}" x="${offsetX}" y="0" width="${w}" height="${h}"/>
        ${tailImages}
      </svg>`);
    const panel = await sharp(svg).png().toBuffer();
    panels.push({ buf: panel, w: canvasW, h });
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
