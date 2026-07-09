/* Measure stone profiles of fortress paintings: per-column topmost DARK
 * (stone) pixel, content bounds via the paper-white key, arch positions.
 * Used to register the generated rubble mound onto the intact painting. */
import sharp from 'sharp';

const paper = (d, i) => {
  const mn = Math.min(d[i], d[i + 1], d[i + 2]);
  const mx = Math.max(d[i], d[i + 1], d[i + 2]);
  return mn > 205 && mx - mn < 22;
};
const dark = (d, i) => (d[i] * 0.3 + d[i + 1] * 0.6 + d[i + 2] * 0.1) < 120 && !paper(d, i);

async function profile(src) {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  let L = w, R = 0, T = h, B = 0;
  const solidTop = new Int32Array(w).fill(-1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      if (!paper(data, i)) {
        if (x < L) L = x;
        if (x > R) R = x;
        if (y < T) T = y;
        if (y > B) B = y;
      }
      if (solidTop[x] === -1 && dark(data, i)) solidTop[x] = y;
    }
  }
  return { w, h, L, R, T, B, solidTop };
}

for (const src of process.argv.slice(2)) {
  const p = await profile(src);
  console.log(`\n${src}: ${p.w}x${p.h} content L=${p.L} R=${p.R} T=${p.T} B=${p.B}`);
  // Sample the solid-stone profile every 4% of the content width.
  const cw = p.R - p.L;
  const rows = [];
  for (let f = 0; f <= 1.0001; f += 0.02) {
    const x = Math.round(p.L + cw * f);
    rows.push(`${f.toFixed(2)}:${p.solidTop[Math.min(x, p.w - 1)]}`);
  }
  console.log(rows.join(' '));
}
