/* Targeted, anatomy-safe intro-sheet repairs.
 *
 * - T-Rex: reframe each 4x2 cell with safe side margins.
 * - Wolves: mark the enclosed paper pocket under the belly as background.
 * - Bighorn: mark the enclosed paper pocket inside the horn/head cleft.
 *
 * Intentional holes are painted separator-magenta. Runtime keying already
 * treats that colour as transparent, which avoids brightness-based erosion
 * of white fur and wool. Operations are idempotent.
 *
 *   node scripts/polish-intro-art.mjs
 */
import sharp from 'sharp';

const COLS = 4;
const ROWS = 2;
const MAGENTA = [255, 0, 255, 255];

const loadRaw = async (path) => {
  const { data, info } = await sharp(path).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width % COLS || info.height % ROWS) {
    throw new Error(`${path} must be a ${COLS}x${ROWS} grid`);
  }
  return { data, w: info.width, h: info.height };
};

const writeRaw = (path, data, w, h) =>
  sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toFile(path);

const paper = (data, i, floor = 245, spread = 9) => {
  const mn = Math.min(data[i], data[i + 1], data[i + 2]);
  const mx = Math.max(data[i], data[i + 1], data[i + 2]);
  return mn > floor && mx - mn < spread;
};

const magenta = (data, i) =>
  data[i] > 180 && data[i + 2] > 180
  && data[i + 1] < data[i] * 0.35 && data[i + 1] < data[i + 2] * 0.35;

const cellBounds = (w, h, frame) => {
  const cw = w / COLS;
  const ch = h / ROWS;
  const col = frame % COLS;
  const row = Math.floor(frame / COLS);
  // Preserve the authored two-pixel magenta grid.
  return {
    x: col * cw + 2,
    y: row * ch + 2,
    w: cw - 4,
    h: ch - 4,
  };
};

async function reframeTrex() {
  const path = 'art-src/anim/trex-intro.png';
  const { data, w, h } = await loadRaw(path);
  const composites = [];
  let changed = false;

  for (let frame = 0; frame < COLS * ROWS; frame++) {
    const cell = cellBounds(w, h, frame);
    let minX = cell.w;
    let maxX = -1;
    for (let y = 0; y < cell.h; y++) {
      for (let x = 0; x < cell.w; x++) {
        const i = ((cell.y + y) * w + cell.x + x) * 4;
        if (paper(data, i, 190, 28) || magenta(data, i)) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
    // Once a sheet has safe margins this pass intentionally does nothing.
    if (maxX < 0 || (minX >= 20 && maxX <= cell.w - 21)) continue;
    changed = true;
    const input = await sharp(data, { raw: { width: w, height: h, channels: 4 } })
      .extract({ left: cell.x, top: cell.y, width: cell.w, height: cell.h })
      .resize({
        width: Math.round(cell.w * 0.88),
        height: Math.round(cell.h * 0.88),
        fit: 'fill',
      })
      .png()
      .toBuffer();
    composites.push({
      input: {
        create: {
          width: cell.w,
          height: cell.h,
          channels: 4,
          background: '#ffffff',
        },
      },
      left: cell.x,
      top: cell.y,
    });
    composites.push({
      input,
      left: cell.x + Math.round(cell.w * 0.06),
      top: cell.y + Math.round(cell.h * 0.06),
    });
  }
  if (changed) {
    await sharp(data, { raw: { width: w, height: h, channels: 4 } })
      .composite(composites)
      .png()
      .toFile(path);
  }
  console.log(`${changed ? 'reframed' : 'already safe'}: ${path}`);
}

function enclosedPaperComponents(data, sheetW, cell) {
  const ok = new Uint8Array(cell.w * cell.h);
  const seen = new Uint8Array(ok.length);
  for (let y = 0; y < cell.h; y++) {
    for (let x = 0; x < cell.w; x++) {
      const i = ((cell.y + y) * sheetW + cell.x + x) * 4;
      ok[y * cell.w + x] = paper(data, i) ? 1 : 0;
    }
  }
  const result = [];
  for (let s = 0; s < ok.length; s++) {
    if (!ok[s] || seen[s]) continue;
    const points = [s];
    seen[s] = 1;
    let touchesEdge = false;
    let minX = cell.w;
    let minY = cell.h;
    let maxX = 0;
    let maxY = 0;
    for (let k = 0; k < points.length; k++) {
      const p = points[k];
      const x = p % cell.w;
      const y = Math.floor(p / cell.w);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (x === 0 || y === 0 || x === cell.w - 1 || y === cell.h - 1) touchesEdge = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= cell.w || ny < 0 || ny >= cell.h) continue;
        const ni = ny * cell.w + nx;
        if (ok[ni] && !seen[ni]) {
          seen[ni] = 1;
          points.push(ni);
        }
      }
    }
    if (!touchesEdge) result.push({ points, minX, minY, maxX, maxY });
  }
  return result;
}

async function clearTargetedPockets(path, choose, label) {
  const { data, w, h } = await loadRaw(path);
  let count = 0;
  for (let frame = 0; frame < COLS * ROWS; frame++) {
    const cell = cellBounds(w, h, frame);
    const comps = enclosedPaperComponents(data, w, cell);
    for (const comp of comps) {
      if (!choose(comp, frame)) continue;
      count++;
      const x0 = Math.max(0, comp.minX - 4);
      const y0 = Math.max(0, comp.minY - 4);
      const x1 = Math.min(cell.w - 1, comp.maxX + 4);
      const y1 = Math.min(cell.h - 1, comp.maxY + 4);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = ((cell.y + y) * w + cell.x + x) * 4;
          // Clear paper and its neutral anti-aliased rim, never coloured fur,
          // horn crystal, outlines, or anatomy.
          if (!paper(data, i, 188, 42)) continue;
          data[i] = MAGENTA[0];
          data[i + 1] = MAGENTA[1];
          data[i + 2] = MAGENTA[2];
          data[i + 3] = MAGENTA[3];
        }
      }
    }
  }
  if (count) await writeRaw(path, data, w, h);
  console.log(`${count ? `cleared ${count}` : 'already clear'} ${label}: ${path}`);
}

await reframeTrex();
await clearTargetedPockets(
  'art-src/anim/wolf-intro.png',
  (c) => c.points.length > 500 && c.minY > 230,
  'wolf belly pocket',
);
await clearTargetedPockets(
  'art-src/anim/bighorn-intro.png',
  (c) => c.points.length > 500 && c.minY < 210 && c.minX > 160,
  'bighorn horn cleft',
);
