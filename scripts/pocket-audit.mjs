/* Replicates the runtime keyBackground POCKET stage on every art asset and
 * reports which enclosed pockets would be punched, with rim colour stats. */
import sharp from 'sharp';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
for (const dir of ['/workspace/public/art', '/workspace/public/art/anim']) {
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.webp') || f.endsWith('.png')) files.push(join(dir, f));
  }
}

for (const file of files.sort()) {
  const { data: px, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  if (w * h > 40_000_000) { console.log(`${file}: skipped (too big)`); continue; }

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
  const minPocket = Math.max(120, Math.round(w*h*0.002));
  const pockets = [];
  for (let s = 0; s < w*h; s++) {
    if (!deep[s] || reach[s]) continue;
    const comp = [s];
    reach[s] = 3;
    let rimDark = 0, rimTotal = 0, rimChroma = 0;
    let minX = w, maxX = 0, minY = h, maxY = 0;
    for (let k = 0; k < comp.length; k++) {
      const cur = comp[k];
      const cy = (cur/w)|0, cxp = cur%w;
      if (cxp < minX) minX = cxp; if (cxp > maxX) maxX = cxp;
      if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
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
            const r = px[i4], g = px[i4+1], b = px[i4+2];
            const mx = Math.max(r,g,b), mn = Math.min(r,g,b);
            rimTotal++;
            if (mx < 150) rimDark++;
            if (mx - mn > 60) rimChroma++;
            break;
          }
        }
      }
    }
    const big = comp.length >= minPocket && rimTotal > 0 && rimDark/rimTotal > 0.55;
    const small = comp.length >= 36 && comp.length < minPocket && rimTotal > 0 && rimDark/rimTotal > 0.62;
    if (big || small) pockets.push({ n: comp.length, box: `${minX}-${maxX},${minY}-${maxY}`, dark: (rimDark/rimTotal).toFixed(2), chroma: (rimChroma/rimTotal).toFixed(2) });
  }
  if (pockets.length) {
    console.log(`${file.replace('/workspace/public/art/','')}: ${pockets.length} pocket(s) punched`);
    for (const p of pockets.slice(0, 12)) console.log(`   n=${p.n} box=${p.box} rimDark=${p.dark} rimChroma=${p.chroma}`);
  }
}
console.log('audit done');
