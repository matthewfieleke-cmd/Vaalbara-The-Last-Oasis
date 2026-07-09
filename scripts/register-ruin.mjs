/* Registers a generated "collapsed gatehouse" painting onto the intact
 * fortress painting's geometry so the renderer can hot-swap them in the SAME
 * layout box:
 *
 *   - the ground line lands on the intact ground line;
 *   - the standing RIGHT gate keeps the intact arch height (vertical scale);
 *   - a piecewise-linear horizontal warp pins the rubble-mound SADDLE (the
 *     breach units march through) to the razed lane and the right arch to
 *     its intact position, with the canvas edges fixed;
 *   - anything outside the intact content box is clamped to paper white so
 *     prep-art trims both paintings to identical boxes.
 *
 *   node scripts/register-ruin.mjs <intact.png> <generated.png> <out.png> <laneFracL> <laneFracR>
 */
import sharp from 'sharp';

const [intactSrc, genSrc, outSrc, lfL, lfR] = process.argv.slice(2);
if (!lfR) {
  console.error('usage: node scripts/register-ruin.mjs intact.png generated.png out.png laneFracL laneFracR');
  process.exit(1);
}

/** Lane anchors as fractions of the intact CONTENT box — must match the
 *  arch fractions the renderer uses (FORT_ART in src/render.ts). */
const LANE_FRACS = [Number(lfL), Number(lfR)];

const paper = (d, i) => {
  const mn = Math.min(d[i], d[i + 1], d[i + 2]);
  const mx = Math.max(d[i], d[i + 1], d[i + 2]);
  return mn > 205 && mx - mn < 22;
};
const lum = (d, i) => d[i] * 0.3 + d[i + 1] * 0.6 + d[i + 2] * 0.1;

async function load(src) {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

function measure(img) {
  const { data, w, h } = img;
  let L = w, R = 0, T = h, B = 0;
  const solidTop = new Int32Array(w).fill(-1);
  const solidBot = new Int32Array(w).fill(-1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      if (paper(data, i)) continue;
      if (x < L) L = x;
      if (x > R) R = x;
      if (y < T) T = y;
      if (y > B) B = y;
      if (lum(data, i) < 120) {
        if (solidTop[x] === -1) solidTop[x] = y;
        solidBot[x] = y;
      }
    }
  }
  // Ground line: the modal bottom-of-stone row (rubble spill and smoke are
  // above/beside it; the wall foot dominates).
  const counts = new Map();
  for (let x = L; x <= R; x++) {
    if (solidBot[x] < 0) continue;
    const key = Math.round(solidBot[x] / 4) * 4;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let ground = B;
  let best = 0;
  for (const [k, c] of counts) if (c > best) { best = c; ground = k; }

  // The standing RIGHT gate tower: columns whose stone silhouette rises well
  // above the curtain wall. Threshold halfway between the modal wall top and
  // the highest point in the right half; take the rightmost contiguous run.
  const tops = [];
  for (let x = Math.round(L + (R - L) * 0.5); x <= R; x++) if (solidTop[x] >= 0) tops.push(solidTop[x]);
  tops.sort((a, b) => a - b);
  const hiTop = tops[Math.floor(tops.length * 0.02)];
  const wallTop = tops[Math.floor(tops.length * 0.7)];
  const towerThresh = hiTop + (wallTop - hiTop) * 0.45;
  let tL = -1, tR = -1, tT = h;
  for (let x = R; x >= Math.round(L + (R - L) * 0.4); x--) {
    const isTower = solidTop[x] >= 0 && solidTop[x] <= towerThresh;
    if (isTower) {
      if (tR === -1) tR = x;
      tL = x;
      if (solidTop[x] < tT) tT = solidTop[x];
    } else if (tR !== -1 && tR - x > (R - L) * 0.03) break;
  }

  // Saddle: within the left 65% of the content box, the LOWEST top-of-stone
  // point (largest solidTop) — the breach floor the units march through.
  let sadX = -1, sadY = -1;
  for (let x = Math.round(L + (R - L) * 0.08); x <= Math.round(L + (R - L) * 0.62); x++) {
    if (solidTop[x] < 0) continue;
    if (solidTop[x] > sadY) { sadY = solidTop[x]; sadX = x; }
  }
  return { L, R, T, B, ground, tower: { L: tL, R: tR, T: tT }, saddle: { x: sadX, y: sadY } };
}

const I = await load(intactSrc);
const G = await load(genSrc);
const mi = measure(I);
const mg = measure(G);
console.log('intact:', JSON.stringify(mi));
console.log('gen   :', JSON.stringify(mg));

const laneL = mi.L + (mi.R - mi.L) * LANE_FRACS[0];
const laneR = mi.L + (mi.R - mi.L) * LANE_FRACS[1];

// Vertical: anchor the ground line, scale so the standing right gate tower
// keeps the intact painting's full height.
const sy = (mi.ground - mi.tower.T) / Math.max(1, mg.ground - mg.tower.T);
// Horizontal control points in TARGET space -> SOURCE space: pin the rubble
// saddle to the razed (left) lane and the standing tower's centre to the
// right lane, with identity slope past the tower so it isn't stretched.
const towerCi = (mi.tower.L + mi.tower.R) / 2;
const towerCg = (mg.tower.L + mg.tower.R) / 2;
const sxGate = (mg.tower.R - mg.tower.L) / Math.max(1, mi.tower.R - mi.tower.L);
const xCtrl = [
  [0, 0],
  [laneL, mg.saddle.x],
  [towerCi, towerCg],
  [I.w - 1, towerCg + (I.w - 1 - towerCi) * sxGate],
];
console.log(`sy=${sy.toFixed(3)} sxGate=${sxGate.toFixed(3)} lanes ${laneL.toFixed(0)}/${laneR.toFixed(0)} towerCi=${towerCi.toFixed(0)} <- saddle ${mg.saddle.x} towerCg=${towerCg.toFixed(0)}`);

const srcX = (tx) => {
  for (let k = 0; k < xCtrl.length - 1; k++) {
    const [t0, s0] = xCtrl[k];
    const [t1, s1] = xCtrl[k + 1];
    if (tx <= t1 || k === xCtrl.length - 2) return s0 + ((tx - t0) / (t1 - t0)) * (s1 - s0);
  }
  return tx;
};
const srcY = (ty) => mg.ground + (ty - mi.ground) / sy;

const out = Buffer.alloc(I.w * I.h * 4);
const sample = (fx, fy, o) => {
  // Bilinear sample of G with paper-white outside.
  if (fx < 0 || fy < 0 || fx > G.w - 1.001 || fy > G.h - 1.001) {
    out[o] = 255; out[o + 1] = 255; out[o + 2] = 255; out[o + 3] = 255;
    return;
  }
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const kx = fx - x0, ky = fy - y0;
  for (let c = 0; c < 4; c++) {
    const p00 = G.data[(y0 * G.w + x0) * 4 + c];
    const p10 = G.data[(y0 * G.w + x0 + 1) * 4 + c];
    const p01 = G.data[((y0 + 1) * G.w + x0) * 4 + c];
    const p11 = G.data[((y0 + 1) * G.w + x0 + 1) * 4 + c];
    out[o + c] = (p00 * (1 - kx) + p10 * kx) * (1 - ky) + (p01 * (1 - kx) + p11 * kx) * ky;
  }
};
for (let y = 0; y < I.h; y++) {
  for (let x = 0; x < I.w; x++) {
    const o = (y * I.w + x) * 4;
    // Clamp to the intact content box so both paintings trim identically.
    if (y < mi.T || y > mi.B || x < mi.L || x > mi.R) {
      out[o] = 255; out[o + 1] = 255; out[o + 2] = 255; out[o + 3] = 255;
      continue;
    }
    sample(srcX(x), srcY(y), o);
  }
}
// Guarantee content reaches the intact box's extremes: copy a 2px sliver of
// the intact painting along each content-box edge (walls bleed to the sides
// in both paintings, so this is invisible).
for (const y of [mi.T, mi.T + 1, mi.B - 1, mi.B]) {
  for (let x = mi.L; x <= mi.R; x++) {
    const o = (y * I.w + x) * 4;
    if (paper(out, o) && !paper(I.data, o)) {
      // Only keep intact-content pixels on the RIGHT half (the standing
      // gatehouse), so razed-side sky stays clear of floating slivers.
      if (x > laneR - (mi.R - mi.L) * 0.12) {
        for (let c = 0; c < 4; c++) out[o + c] = I.data[o + c];
      }
    }
  }
}
await sharp(out, { raw: { width: I.w, height: I.h, channels: 4 } }).png().toFile(outSrc);
const mo = measure({ data: out, w: I.w, h: I.h });
console.log('out   :', JSON.stringify(mo));
