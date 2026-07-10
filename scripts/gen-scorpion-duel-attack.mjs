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

  // Keep the entire curled tail attached to the body and remove only its
  // original stinger. The strike extends from the final attached armour
  // plate, so there is never a floating tail section or a broken root.
  const stingerPoly = [
    [126, 132], [181, 134], [211, 163], [215, 234],
    [184, 252], [142, 226], [126, 184],
  ];
  const inside = (x, y) => {
    let hit = false;
    for (let i = 0, j = stingerPoly.length - 1; i < stingerPoly.length; j = i++) {
      const [xi, yi] = stingerPoly[i];
      const [xj, yj] = stingerPoly[j];
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
  const idlePng = await sharp(data, {
    raw: { width: w, height: h, channels: 4 },
  }).png().toBuffer();
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
  const idleUri = `data:image/png;base64,${idlePng.toString('base64')}`;
  const bodyUri = `data:image/png;base64,${bodyPng.toString('base64')}`;

  const cropPiece = async (def) => {
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
    return { ...def, uri: `data:image/png;base64,${png.toString('base64')}` };
  };
  // Both pieces are directly sampled from the source Scorpion: one armour
  // plate for the articulated chain and its original crystal stinger.
  const armour = await cropPiece({ x: 80, y: 96, w: 46, h: 58 });
  const stinger = await cropPiece({ x: 126, y: 132, w: 92, h: 122 });
  const hinge = { x: 145, y: 139 };
  const chain = [
    { x: 148, y: 140, rot: -8 },
    { x: 180, y: 139, rot: -3 },
    { x: 212, y: 141, rot: 2 },
    { x: 244, y: 146, rot: 7 },
    { x: 276, y: 153, rot: 12 },
    { x: 308, y: 163, rot: 18 },
  ];

  // Exactly one extension. The final panel is fully reset, preventing a
  // partial second strike during recoil.
  const progress = [0, 0.2, 0.48, 0.78, 1, 0];
  const canvasW = 560;
  const offsetX = 18;
  const panels = [];
  for (let i = 0; i < PANELS; i++) {
    const p = progress[i] * progress[i] * (3 - 2 * progress[i]);
    const chainImages = chain.map((target) => {
      const tx = offsetX + hinge.x + (target.x - hinge.x) * p;
      const ty = hinge.y + (target.y - hinge.y) * p;
      return `<g transform="translate(${tx} ${ty}) rotate(${target.rot * p}) translate(${-armour.w / 2} ${-armour.h / 2})">
        <image href="${armour.uri}" width="${armour.w}" height="${armour.h}"/>
      </g>`;
    }).join('');
    const stingerX = offsetX + hinge.x + (350 - hinge.x) * p;
    const stingerY = hinge.y + (178 - hinge.y) * p;
    const tailImages = p === 0 ? '' : `${chainImages}
      <g transform="translate(${stingerX} ${stingerY}) rotate(${-58 * p}) translate(${-stinger.w / 2} ${-stinger.h / 2})">
        <image href="${stinger.uri}" width="${stinger.w}" height="${stinger.h}"/>
      </g>`;
    const svg = Buffer.from(`
      <svg width="${canvasW}" height="${h}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white"/>
        <image href="${p === 0 ? idleUri : bodyUri}" x="${offsetX}" y="0" width="${w}" height="${h}"/>
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
