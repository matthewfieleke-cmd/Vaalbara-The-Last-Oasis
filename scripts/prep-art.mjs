/* Art pipeline: normalizes source paintings into game-ready webp under
 * public/art/, and builds the iOS/PWA icons from the Phase 1 arena.
 * Run: node scripts/prep-art.mjs */
import sharp from 'sharp';
import fs from 'node:fs';

fs.mkdirSync('public/art/anim', { recursive: true });

const portraits = [
  ['art-src/Trex.png', 'public/art/trex.webp', 640],
  ['art-src/Lion.png', 'public/art/lion.webp', 640],
  ['art-src/Eagle.png', 'public/art/eagle.webp', 640],
  ['art-src/Honeybadger.png', 'public/art/honeybadger.webp', 640],
  ['art-src/Scorpion.png', 'public/art/scorpion.webp', 640],
  ['art-src/Fire ants.png', 'public/art/fireants.webp', 640],
  ['art-src/Bear.png', 'public/art/bear.webp', 640],
  ['art-src/Bighorn.png', 'public/art/bighorn.webp', 640],
  ['art-src/Bees.png', 'public/art/bees.webp', 640],
  ['art-src/Wolves.png', 'public/art/wolves.webp', 800],
  ['art-src/Porcupine.png', 'public/art/porcupine.webp', 640],
  ['art-src/Beetle.png', 'public/art/beetles.webp', 640],
];

const arenas = [
  ['art-src/arena1.png', 'public/art/arena1.webp', 820],
  ['art-src/arena2.png', 'public/art/arena2.webp', 820],
];

// Fortress paintings: white background keyed to alpha, trimmed to content.
// front* is the enemy stronghold seen face-on across the field; rear* is
// YOUR stronghold seen from behind/above (the camera side).
const fortresses = [
  ['art-src/fort-front.png', 'public/art/fort-front.webp', 1400],
  ['art-src/fort-front-ruin.png', 'public/art/fort-front-ruin.webp', 1400],
  ['art-src/fort-rear.png', 'public/art/fort-rear.webp', 1400],
  ['art-src/fort-rear-ruin.png', 'public/art/fort-rear-ruin.webp', 1400],
];

// Animation sheets: kept at full width so each frame stays ~300px.
const animSheets = fs.readdirSync('art-src/anim').filter((f) => f.endsWith('.png'));

let total = 0;
async function convert(src, out, maxW) {
  const img = sharp(src);
  const meta = await img.metadata();
  const width = Math.min(maxW, meta.width ?? maxW);
  await img.resize({ width }).webp({ quality: 84 }).toFile(out);
  const kb = Math.round(fs.statSync(out).size / 1024);
  total += kb;
  console.log(`${out}  ${width}px  ${kb} KB`);
}

/* Some generated sheets carry solid black letterbox bars at the top/bottom
 * (and occasionally the sides), or stray magenta separator rules hugging the
 * sheet's outer edges. Both survive white-keying at load time and corrupt
 * the frames' bounds/ground anchors (an edge rule's anti-aliased fringe can
 * stretch a frame's bounding box to the rule's full height, shrinking the
 * animal to a speck), so strip them here before resizing. */
async function convertSheet(src, out, maxW) {
  const { data, info } = await sharp(src).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const isBar = (i) =>
    // solid black letterbox ink
    (data[i] < 34 && data[i + 1] < 34 && data[i + 2] < 34)
    // magenta separator rule (tolerant: webp softening leaves it pinkish)
    || (data[i] > 130 && data[i + 2] > 130
      && data[i + 1] < data[i] * 0.85 && data[i + 1] < data[i + 2] * 0.85);
  const rowBar = (y) => {
    let n = 0, t = 0;
    for (let x = 0; x < w; x += 4) {
      if (isBar((y * w + x) * 4)) n++;
      t++;
    }
    return n / t;
  };
  const colBar = (x) => {
    let n = 0, t = 0;
    for (let y = 0; y < h; y += 4) {
      if (isBar((y * w + x) * 4)) n++;
      t++;
    }
    return n / t;
  };
  // Black bars are near-total rows/columns; edge magenta rules only span the
  // painted band, so anything above ~30% coverage at the very edge counts.
  let top = 0;
  while (top < h * 0.3 && rowBar(top) > (top < 4 ? 0.3 : 0.85)) top++;
  let bot = h;
  while (bot > h * 0.7 && rowBar(bot - 1) > (h - bot < 4 ? 0.3 : 0.85)) bot--;
  let left = 0;
  while (left < w * 0.2 && colBar(left) > (left < 4 ? 0.3 : 0.85)) left++;
  let right = w;
  while (right > w * 0.8 && colBar(right - 1) > (w - right < 4 ? 0.3 : 0.85)) right--;
  // Shave the anti-aliased fringe the bars leave behind.
  if (top > 0) top = Math.min(h - 1, top + 2);
  if (bot < h) bot = Math.max(top + 1, bot - 2);
  if (left > 0) left = Math.min(w - 1, left + 2);
  if (right < w) right = Math.max(left + 1, right - 2);

  const cw = right - left;
  const ch = bot - top;

  /* Sanitize the interior separator rules: the generator anti-aliases them
   * and webp smears them further, leaving a faint pink fringe that is
   * neither white nor magenta to the runtime keyer — it survives as frame
   * "content" and stretches the frame's bounding box to the rule's full
   * height (the Honey Badger KO collapse rendered at a third of its size).
   * Repaint each detected rule as a crisp pure-magenta core with pure-white
   * flanks so keying removes it completely. */
  const isMag = (i) =>
    data[i] > 120 && data[i + 2] > 120
    && data[i + 1] < data[i] * 0.85 && data[i + 1] < data[i + 2] * 0.85;
  const colMag = (x) => {
    let n = 0, t = 0;
    for (let y = top; y < bot; y += 2) {
      if (isMag((y * w + x) * 4)) n++;
      t++;
    }
    return n / t;
  };
  const rules = [];
  for (let x = left; x < right; x++) {
    if (colMag(x) > 0.3) {
      let x2 = x;
      while (x2 < right - 1 && colMag(x2 + 1) > 0.1) x2++;
      rules.push([x, x2]);
      x = x2 + Math.round(w * 0.03);
    }
  }
  const paint = (x, r, g, b) => {
    if (x < left || x >= right) return;
    for (let y = top; y < bot; y++) {
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  };
  for (const [a, b] of rules) {
    for (let x = a - 7; x < a; x++) paint(x, 255, 255, 255);
    for (let x = a; x <= b; x++) paint(x, 255, 0, 255);
    for (let x = b + 1; x <= b + 7; x++) paint(x, 255, 255, 255);
  }

  /* Same problem, horizontal: some sheets draw a full frame BOX, leaving
   * thin grey/pink rules running the sheet's whole width mid-image. They
   * are far above the black-bar threshold and stretch every frame's bbox
   * vertically (the Bighorn KO frames all measured the rule-to-rule height,
   * not the sheep). Detect thin full-width ink rows and erase them to pure
   * white — but only in columns where the rule crosses background, so any
   * painted content overlapping the line survives. */
  const paper = (i) => {
    const mx = Math.max(data[i], data[i + 1], data[i + 2]);
    const mn = Math.min(data[i], data[i + 1], data[i + 2]);
    return mx > 196 && mx - mn < 26;
  };
  const rowInk = (y) => {
    let n = 0, t = 0;
    for (let x = left; x < right; x += 3) {
      if (!paper((y * w + x) * 4)) n++;
      t++;
    }
    return n / t;
  };
  const hRules = [];
  for (let y = top; y < bot; y++) {
    if (rowInk(y) > 0.75) {
      let y2 = y;
      while (y2 < bot - 1 && rowInk(y2 + 1) > 0.5) y2++;
      if (y2 - y <= 10) hRules.push([y, y2]);
      y = y2 + 1;
    }
  }
  // Vertical magenta rules count as background here: the h-rule crossing a
  // separator is still a rule, not content, and it keys out at runtime.
  const bgLike = (i) => paper(i) || isMag(i);
  for (const [a, b] of hRules) {
    for (let x = left; x < right; x++) {
      const above = (Math.max(top, a - 6) * w + x) * 4;
      const below = (Math.min(bot - 1, b + 6) * w + x) * 4;
      if (!bgLike(above) || !bgLike(below)) continue; // content crosses here
      for (let y = Math.max(top, a - 3); y <= Math.min(bot - 1, b + 3); y++) {
        const i = (y * w + x) * 4;
        data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
      }
    }
  }

  /* Whiten the crop's outer 2px border: frame-box fringes leave lone dark
   * specks on the sheet edge that survive keying and blow a frame's bbox
   * out to the full sheet height. Painted content never reaches the border
   * (the generator leaves margins), so this is always safe. */
  for (let y = top; y < bot; y++) {
    for (const x of [left, left + 1, right - 2, right - 1]) {
      const i = (y * w + x) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
    }
  }
  for (let x = left; x < right; x++) {
    for (const y of [top, top + 1, bot - 2, bot - 1]) {
      const i = (y * w + x) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
    }
  }

  const width = Math.min(maxW, cw);
  await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left, top, width: cw, height: ch })
    .resize({ width })
    .webp({ quality: 84 })
    .toFile(out);
  const kb = Math.round(fs.statSync(out).size / 1024);
  total += kb;
  const notes = [
    top || left || bot < h || right < w ? 'bars trimmed' : '',
    rules.length ? `${rules.length} rules sharpened` : '',
    hRules.length ? `${hRules.length} h-rules erased` : '',
  ].filter(Boolean).join(', ');
  console.log(`${out}  ${width}px  ${kb} KB${notes ? `  (${notes})` : ''}`);
}

/* Intro parade cycles are painted as 2x4 GRIDS (8 frames — twice the poses
 * of the battle sheets, for film-smooth crossfades in the cinematic). Split
 * the grid at its horizontal magenta rule, lay the two rows side by side
 * with a fresh separator, and push the result through the same strip
 * sanitizer as every other sheet. */
async function convertGridSheet(src, out, maxW) {
  const { data, info } = await sharp(src).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const isMag = (i) =>
    data[i] > 120 && data[i + 2] > 120
    && data[i + 1] < data[i] * 0.85 && data[i + 1] < data[i + 2] * 0.85;
  const rowMag = (y) => {
    let n = 0, t = 0;
    for (let x = 0; x < w; x += 3) {
      if (isMag((y * w + x) * 4)) n++;
      t++;
    }
    return n / t;
  };
  // The row separator: a horizontal magenta band near mid-height.
  let bandA = -1, bandB = -1;
  for (let y = Math.floor(h * 0.3); y < h * 0.7; y++) {
    if (rowMag(y) > 0.3) {
      bandA = y;
      let y2 = y;
      while (y2 < h - 1 && rowMag(y2 + 1) > 0.1) y2++;
      bandB = y2;
      break;
    }
  }
  const halves = bandA >= 0
    ? [[0, bandA - 1], [bandB + 2, h]]
    : [[0, Math.floor(h / 2)], [Math.ceil(h / 2), h]];
  const raw = sharp(data, { raw: { width: w, height: h, channels: 4 } });
  const rowH = Math.min(halves[0][1] - halves[0][0], halves[1][1] - halves[1][0]);
  const parts = [];
  for (const [y0, y1] of halves) {
    parts.push(await raw.clone()
      .extract({ left: 0, top: y0, width: w, height: y1 - y0 })
      .resize({ height: rowH })
      .png().toBuffer());
  }
  const rule = 8;
  const joined = await sharp({
    create: { width: w * 2 + rule, height: rowH, channels: 4, background: '#ffffff' },
  }).composite([
    { input: parts[0], left: 0, top: 0 },
    { input: { create: { width: rule, height: rowH, channels: 4, background: '#ff00ff' } }, left: w, top: 0 },
    { input: parts[1], left: w + rule, top: 0 },
  ]).png().toBuffer();
  const tmp = `${out}.strip.png`;
  fs.writeFileSync(tmp, joined);
  await convertSheet(tmp, out, maxW);
  fs.unlinkSync(tmp);
}

/* Fortress facades ship as transparent sprites: the paper-white studio
 * backdrop is keyed via a border flood fill (so the pitch-black arch
 * interiors and any pale stone highlights survive), then the canvas is
 * trimmed to the content box so the wall base sits exactly on the sprite's
 * bottom edge — the renderer plants that edge on the wall line. */
async function convertFortress(src, out, maxW) {
  const { data, info } = await sharp(src).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
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
  let top = h, bot = 0, left = w, right = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (reach[p]) { data[p * 4 + 3] = 0; continue; }
      if (y < top) top = y;
      if (y > bot) bot = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  const cut = sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left, top, width: right - left + 1, height: bot - top + 1 });
  const cw = right - left + 1;
  await (cw > maxW ? cut.resize({ width: maxW }) : cut).webp({ quality: 86 }).toFile(out);
  const kb = Math.round(fs.statSync(out).size / 1024);
  total += kb;
  console.log(`${out}  keyed  ${kb} KB`);
}

for (const [src, out, w] of portraits) await convert(src, out, w);
for (const [src, out, w] of arenas) await convert(src, out, w);
for (const [src, out, w] of fortresses) await convertFortress(src, out, w);
for (const f of animSheets) {
  const out = `public/art/anim/${f.replace('.png', '.webp')}`;
  if (f.includes('-intro')) await convertGridSheet(`art-src/anim/${f}`, out, 2400);
  else await convertSheet(`art-src/anim/${f}`, out, 1280);
}

/* iOS Home Screen + PWA icons from the dedicated app icon painting. */
const iconJobs = [
  ['public/apple-touch-icon.png', 180],
  ['public/icon-192.png', 192],
  ['public/icon-512.png', 512],
  ['public/favicon.png', 64],
];
for (const [out, size] of iconJobs) {
  await sharp('art-src/app-icon.png')
    .resize(size, size, { fit: 'cover' })
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toFile(out);
  console.log(`${out}  ${size}px  ${Math.round(fs.statSync(out).size / 1024)} KB`);
}

console.log(`total webp: ${total} KB`);
