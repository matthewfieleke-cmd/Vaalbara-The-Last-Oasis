/* Mute the painted white smoke in the ruin paintings: near-white,
 * low-saturation pixels read as pale blobs at game scale. Darken them into
 * the basalt palette and let the renderer's live ash/ember particles carry
 * the smoulder instead. */
import sharp from 'sharp';

for (const src of ['art-src/fort-front-ruin.png', 'art-src/fort-rear-ruin.png']) {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  // Border-reachable paper is the keyed backdrop and must stay untouched;
  // ENCLOSED paper (white pockets inside the painting) is an artifact and
  // gets muted like smoke.
  const paper = (i) => {
    const mn = Math.min(data[i], data[i + 1], data[i + 2]);
    const mx = Math.max(data[i], data[i + 1], data[i + 2]);
    return mn > 205 && mx - mn < 22;
  };
  const reach = new Uint8Array(w * h);
  const work = [];
  const seed = (x, y) => {
    const p = y * w + x;
    if (!reach[p] && paper(p * 4)) { reach[p] = 1; work.push(p); }
  };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
  while (work.length) {
    const cur = work.pop();
    const cy = (cur / w) | 0;
    const cx = cur % w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const ni = ny * w + nx;
      if (reach[ni] || !paper(ni * 4)) continue;
      reach[ni] = 1;
      work.push(ni);
    }
  }
  let hits = 0;
  for (let p = 0; p < w * h; p++) {
    if (reach[p]) continue;
    const i = p * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const lum = r * 0.3 + g * 0.6 + b * 0.1;
    if (lum > 132 && mx - mn < 46) {
      // Fold smoke toward warm basalt grey, harder the brighter it is.
      const k = Math.min(1, (lum - 132) / 60) * 0.85;
      data[i] = Math.round(r * (1 - k) + 72 * k);
      data[i + 1] = Math.round(g * (1 - k) + 62 * k);
      data[i + 2] = Math.round(b * (1 - k) + 58 * k);
      hits++;
    }
  }
  await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toFile(src);
  console.log(src, 'muted', hits, 'px');
}
