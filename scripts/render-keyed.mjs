/* Fully replicates the runtime splitStrip -> keyBackground pipeline in Node
 * and writes each keyed frame over a dark arena colour for visual QC.
 * Usage: node scripts/render-keyed.mjs <sheet> <panels> <outdir-name> */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const file = process.argv[2];
const count = Number(process.argv[3] ?? 8);
const outName = process.argv[4] ?? 'keyed';
const OUT = `/tmp/vaalbara-shots/${outName}`;
mkdirSync(OUT, { recursive: true });

const meta = await sharp(file).metadata();
const pw = Math.floor(meta.width / count);

function keyBackground(px, w, h) {
  const isMagenta = (i) => { const r = px[i], g = px[i+1], b = px[i+2]; return r > 150 && b > 150 && g < r*0.7 && g < b*0.7; };
  const bgLike = (i) => {
    const r = px[i], g = px[i+1], b = px[i+2];
    const mx = Math.max(r,g,b), mn = Math.min(r,g,b);
    return (mx > 196 && mx - mn < 26) || isMagenta(i);
  };
  const borderMins = [];
  const bs = (i) => { if (bgLike(i*4)) borderMins.push(Math.min(px[i*4], px[i*4+1], px[i*4+2])); };
  for (let x = 0; x < w; x++) { bs(x); bs((h-1)*w + x); }
  for (let y = 0; y < h; y++) { bs(y*w); bs(y*w + w - 1); }
  borderMins.sort((a,b) => a-b);
  const paperRef = borderMins.length ? borderMins[Math.floor(borderMins.length*0.25)] : 250;
  const pureFloor = Math.max(200, paperRef - 14);
  const pureBg = (i) => {
    const r = px[i], g = px[i+1], b = px[i+2];
    const mx = Math.max(r,g,b), mn = Math.min(r,g,b);
    return (mn > pureFloor && mx - mn < 10) || isMagenta(i);
  };
  const bg = new Uint8Array(w*h);
  for (let i = 0; i < w*h; i++) bg[i] = bgLike(i*4) ? 1 : 0;
  const deep = new Uint8Array(w*h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y*w + x;
    if (!bg[i]) continue;
    if (x === 0 || x === w-1 || y === 0 || y === h-1) { deep[i] = 1; continue; }
    let ok = pureBg(i*4) ? 1 : 0;
    for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!bg[i + dy*w + dx]) { ok = 0; break; }
    }
    deep[i] = ok;
  }
  const reach = new Uint8Array(w*h);
  const work = [];
  const seed = (s) => { if (!reach[s] && deep[s]) { reach[s] = 1; work.push(s); } };
  for (let x = 0; x < w; x++) { seed(x); seed((h-1)*w + x); }
  for (let y = 0; y < h; y++) { seed(y*w); seed(y*w + w - 1); }
  while (work.length) {
    const cur = work.pop();
    const cy = (cur/w)|0, cx = cur%w;
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = cx+dx, ny = cy+dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const ni = ny*w + nx;
      if (reach[ni] || !deep[ni]) continue;
      reach[ni] = 1; work.push(ni);
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    let grew = false;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y*w + x;
      if (reach[i] || !bg[i]) continue;
      if ((x > 0 && reach[i-1] === 1) || (x < w-1 && reach[i+1] === 1)
        || (y > 0 && reach[i-w] === 1) || (y < h-1 && reach[i+w] === 1)) { reach[i] = 2; grew = true; }
    }
    for (let i = 0; i < w*h; i++) if (reach[i] === 2) reach[i] = 1;
    if (!grew) break;
  }
  for (let i = 0; i < w*h; i++) if (reach[i] === 1 || isMagenta(i*4)) px[i*4+3] = 0;

  // pockets (with the new glow-core guard)
  const minPocket = Math.max(120, Math.round(w*h*0.002));
  for (let s = 0; s < w*h; s++) {
    if (!deep[s] || reach[s]) continue;
    const comp = [s];
    reach[s] = 3;
    let rimDark = 0, rimChroma = 0, rimTotal = 0;
    for (let k = 0; k < comp.length; k++) {
      const cur = comp[k];
      const cy = (cur/w)|0, cxp = cur%w;
      for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = cxp+dx, ny = cy+dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const ni = ny*w + nx;
        if (reach[ni]) continue;
        if (deep[ni]) { reach[ni] = 3; comp.push(ni); }
        else {
          for (let step = 0; step < 6; step++) {
            const sx = nx + dx*step, sy = ny + dy*step;
            if (sx < 0 || sx >= w || sy < 0 || sy >= h) break;
            const si = sy*w + sx;
            if (bg[si]) continue;
            const i4 = si*4;
            const mx = Math.max(px[i4], px[i4+1], px[i4+2]);
            const mn = Math.min(px[i4], px[i4+1], px[i4+2]);
            rimTotal++;
            if (mx < 150) rimDark++;
            if (mx - mn > 60) rimChroma++;
            break;
          }
        }
      }
    }
    if (rimTotal > 0 && rimChroma / rimTotal > 0.25) continue;
    if (comp.length >= minPocket && rimTotal > 0 && rimDark/rimTotal > 0.55) for (const i of comp) px[i*4+3] = 0;
    if (comp.length >= 36 && comp.length < minPocket && rimTotal > 0 && rimDark/rimTotal > 0.62) for (const i of comp) px[i*4+3] = 0;
  }

  // halo erosion
  const paperTinted = (i4) => {
    const r = px[i4], g = px[i4+1], b = px[i4+2];
    const mx = Math.max(r,g,b), mn = Math.min(r,g,b);
    return mx > 165 && mx - mn < 44;
  };
  for (let pass = 0; pass < 5; pass++) {
    let ate = false;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y*w + x;
      if (px[i*4+3] === 0) continue;
      const holeAdj = x === 0 || x === w-1 || y === 0 || y === h-1 ||
        px[(i-1)*4+3] === 0 || px[(i+1)*4+3] === 0 || px[(i-w)*4+3] === 0 || px[(i+w)*4+3] === 0;
      if (holeAdj && paperTinted(i*4)) { px[i*4+3] = 254; ate = true; }
    }
    if (!ate) break;
    for (let i = 0; i < w*h; i++) if (px[i*4+3] === 254) px[i*4+3] = 0;
  }
  // feather
  for (let y = 1; y < h-1; y++) for (let x = 1; x < w-1; x++) {
    const i = y*w + x;
    if (px[i*4+3] === 0) continue;
    let holes = 0;
    if (px[(i-1)*4+3] === 0) holes++;
    if (px[(i+1)*4+3] === 0) holes++;
    if (px[(i-w)*4+3] === 0) holes++;
    if (px[(i+w)*4+3] === 0) holes++;
    if (holes > 0) {
      const mx = Math.max(px[i*4], px[i*4+1], px[i*4+2]);
      const bright = mx > 152 ? 82 : 48;
      px[i*4+3] = Math.min(px[i*4+3], 255 - holes*bright);
    }
  }
}

for (let p = 0; p < count; p++) {
  const { data: px, info } = await sharp(file)
    .extract({ left: p * pw, top: 0, width: pw, height: meta.height })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  keyBackground(px, info.width, info.height);
  // composite over dark arena tone
  const out = Buffer.alloc(info.width * info.height * 3);
  for (let i = 0; i < info.width * info.height; i++) {
    const a = px[i*4+3] / 255;
    out[i*3] = Math.round(px[i*4] * a + 46 * (1-a));
    out[i*3+1] = Math.round(px[i*4+1] * a + 38 * (1-a));
    out[i*3+2] = Math.round(px[i*4+2] * a + 52 * (1-a));
  }
  await sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } })
    .png().toFile(`${OUT}/f${p}.png`);
}
console.log(`wrote ${count} keyed frames to ${OUT}`);
