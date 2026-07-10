/* Build scorpion-duel-attack.png — 8-frame forward tail-strike strip for Duels.
 *
 * The strike is the ACTUAL painted tail in motion. The whole tail (segmented
 * arc + crystal stinger) is cut from the idle artwork along its silhouette,
 * split into chain pieces along its real centreline, and uncurled with
 * forward kinematics: each piece rotates about its joint so the coil springs
 * forward and the stinger lands ahead of the head. Every pixel shown during
 * the strike comes from the original painting — no synthetic tube, no
 * repeated plates — so mid-strike the tail looks exactly like the idle tail,
 * just sprung forward.
 *
 *   node scripts/gen-scorpion-duel-attack.mjs
 */
import sharp from 'sharp';

const INTRO = 'art-src/anim/scorpion-intro.png';
const OUT = 'art-src/anim/scorpion-duel-attack.png';

const PANELS = 8;

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

function insidePoly(poly, x, y) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Distance from point to segment ab. */
function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

async function main() {
  const intro = await loadRaw(INTRO);
  const source = slicePanel(intro.data, intro.w, intro.h, 0);
  const { data, w, h } = source;

  // The full painted tail silhouette: segmented arc plus crystal stinger,
  // hugging the artwork but excluding the dorsal back plates, legs and hip.
  const tailPoly = [
    [96, 312], [60, 272], [42, 230], [42, 175], [58, 133], [88, 106],
    [128, 92], [172, 92], [205, 104], [224, 126], [234, 152], [234, 188],
    [220, 218], [196, 242], [183, 246], [158, 250], [138, 252], [114, 278],
  ];
  const paper = (i) => {
    const mx = Math.max(data[i], data[i + 1], data[i + 2]);
    const mn = Math.min(data[i], data[i + 1], data[i + 2]);
    return mx > 190 && mx - mn < 34;
  };

  // Idle panel (frame 0) is the untouched painting. The strike body has the
  // whole tail lifted out; the articulated chain below re-adds every pixel.
  const idlePng = await sharp(data, {
    raw: { width: w, height: h, channels: 4 },
  }).png().toBuffer();

  // Background paper inside the tail polygon is only the paper CONNECTED to
  // the polygon's rim. Enclosed bright pixels — the white glow core inside
  // the crystal stinger — are paint and must ride along with the tail, or
  // the strike frames show punched-out holes where the glow used to be.
  const inPoly = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (insidePoly(tailPoly, x, y)) inPoly[y * w + x] = 1;
    }
  }
  const rimPaper = new Uint8Array(w * h);
  {
    const stack = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!inPoly[p] || !paper(p * 4)) continue;
        const edge =
          x === 0 || x === w - 1 || y === 0 || y === h - 1 ||
          !inPoly[p - 1] || !inPoly[p + 1] || !inPoly[p - w] || !inPoly[p + w];
        if (edge) {
          rimPaper[p] = 1;
          stack.push(p);
        }
      }
    }
    while (stack.length) {
      const p = stack.pop();
      const px2 = p % w;
      const py2 = (p / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px2 + dx;
        const ny = py2 + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (rimPaper[n] || !inPoly[n] || !paper(n * 4)) continue;
        rimPaper[n] = 1;
        stack.push(n);
      }
    }
  }

  const body = Buffer.from(data);
  const tailOnly = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const i = p * 4;
      if (!inPoly[p]) continue;
      body[i] = 255;
      body[i + 1] = 255;
      body[i + 2] = 255;
      body[i + 3] = 255;
      if (!rimPaper[p]) {
        tailOnly[i] = data[i];
        tailOnly[i + 1] = data[i + 1];
        tailOnly[i + 2] = data[i + 2];
        tailOnly[i + 3] = data[i + 3];
      }
    }
  }
  // The polygon cut leaves a hair-thin anti-aliased fringe of the tail's
  // silhouette on the body (pale blend pixels hugging the cut line). Erode
  // it: any light pixel bordering the cleared/paper region is washed white,
  // repeated a few passes so the whole halo lifts while dark body ink stays.
  {
    // Only the band within a few pixels of the cut may erode — the body's
    // own anti-aliased outline (crystal claws especially) must stay intact.
    const nearTail = new Uint8Array(w * h);
    const R = 4;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!insidePoly(tailPoly, x, y)) continue;
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h) nearTail[ny * w + nx] = 1;
          }
        }
      }
    }
    const isBg = (i) => {
      const mx = Math.max(body[i], body[i + 1], body[i + 2]);
      const mn = Math.min(body[i], body[i + 1], body[i + 2]);
      return mx > 190 && mx - mn < 34;
    };
    for (let pass = 0; pass < 3; pass++) {
      const clear = [];
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (!nearTail[y * w + x]) continue;
          const i = (y * w + x) * 4;
          if (isBg(i)) continue;
          if (Math.max(body[i], body[i + 1], body[i + 2]) <= 95) continue;
          let bg = 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (isBg(((y + dy) * w + x + dx) * 4)) bg++;
          }
          if (bg >= 1) clear.push(i);
        }
      }
      for (const i of clear) {
        body[i] = 255;
        body[i + 1] = 255;
        body[i + 2] = 255;
        body[i + 3] = 255;
      }
    }
  }
  // Any fringe still disconnected from the body once the tail is lifted out
  // is removed by keeping only the LARGEST connected non-paper component
  // (the body with legs and claws) and washing everything else white.
  {
    const label = new Int32Array(w * h).fill(-1);
    const sizes = [];
    const stack = [];
    for (let start = 0; start < w * h; start++) {
      const si = start * 4;
      if (label[start] !== -1) continue;
      const mx = Math.max(body[si], body[si + 1], body[si + 2]);
      const mn = Math.min(body[si], body[si + 1], body[si + 2]);
      if (mx > 190 && mx - mn < 34) continue;
      const id = sizes.length;
      sizes.push(0);
      stack.push(start);
      label[start] = id;
      while (stack.length) {
        const p = stack.pop();
        sizes[id]++;
        const px = p % w;
        const py = (p / w) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (label[n] !== -1) continue;
          const ni = n * 4;
          const nmx = Math.max(body[ni], body[ni + 1], body[ni + 2]);
          const nmn = Math.min(body[ni], body[ni + 1], body[ni + 2]);
          if (nmx > 190 && nmx - nmn < 34) continue;
          label[n] = id;
          stack.push(n);
        }
      }
    }
    let biggest = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[biggest]) biggest = i;
    for (let p = 0; p < w * h; p++) {
      if (label[p] !== -1 && label[p] !== biggest) {
        body[p * 4] = 255;
        body[p * 4 + 1] = 255;
        body[p * 4 + 2] = 255;
        body[p * 4 + 3] = 255;
      }
    }
  }
  const bodyPng = await sharp(body, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  const idleUri = `data:image/png;base64,${idlePng.toString('base64')}`;
  const bodyUri = `data:image/png;base64,${bodyPng.toString('base64')}`;

  // Real tail centreline, root -> stinger base, traced from the painting.
  // The final entry is the stinger TIP (length reference for the last piece).
  // The root joint sits DEEP inside the hip silhouette: pixels near the cut
  // line barely move when the root piece rotates about it, so the tail never
  // tears away from the backside mid-strike.
  const joints = [
    { x: 126, y: 280 }, { x: 80, y: 242 }, { x: 62, y: 205 }, { x: 62, y: 165 },
    { x: 82, y: 133 }, { x: 115, y: 112 }, { x: 165, y: 135 },
  ];
  const tip = { x: 183, y: 232 };
  const ends = [...joints.slice(1), tip];
  // Per-piece capsule radius (crystal stinger is much wider than a segment)
  // and joint overlap so adjacent pieces always share seam pixels. Generous
  // values are safe: pieces crop from the tail-only bitmap, so a fat capsule
  // can never grab body paint — it only guarantees the seams stay covered at
  // full extension instead of thinning where neighbouring pieces bend apart.
  const radii = [34, 31, 30, 30, 30, 33, 56];
  const OVERLAP = 24;

  // Heading change per piece from coiled pose to the struck pose (degrees,
  // clockwise = forward). Derived from the painted headings so the released
  // tail forms one continuous forward arc whose stinger lands well past the
  // claws, at the opponent's body height. The root swings LEAST — its base
  // must stay socketed in the hip — and the mid-tail carries the throw.
  const deltas = [50, 97, 93, 70, 49, -4, -49];

  // Cut each chain piece from the tail-only bitmap.
  const pieces = [];
  for (let i = 0; i < joints.length; i++) {
    const a = joints[i];
    const b = ends[i];
    const dirX = b.x - a.x;
    const dirY = b.y - a.y;
    const len = Math.hypot(dirX, dirY) || 1;
    const ax = a.x - (dirX / len) * OVERLAP;
    const ay = a.y - (dirY / len) * OVERLAP;
    const bx = b.x + (dirX / len) * OVERLAP;
    const by = b.y + (dirY / len) * OVERLAP;
    const r = radii[i];
    const minX = Math.max(0, Math.floor(Math.min(ax, bx) - r));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r));
    const minY = Math.max(0, Math.floor(Math.min(ay, by) - r));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r));
    const pw = maxX - minX + 1;
    const ph = maxY - minY + 1;
    const buf = Buffer.alloc(pw * ph * 4);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (segDist(x, y, ax, ay, bx, by) > r) continue;
        const si = (y * w + x) * 4;
        const di = ((y - minY) * pw + (x - minX)) * 4;
        buf[di] = tailOnly[si];
        buf[di + 1] = tailOnly[si + 1];
        buf[di + 2] = tailOnly[si + 2];
        buf[di + 3] = tailOnly[si + 3];
      }
    }
    const png = await sharp(buf, { raw: { width: pw, height: ph, channels: 4 } }).png().toBuffer();
    pieces.push({
      uri: `data:image/png;base64,${png.toString('base64')}`,
      w: pw,
      h: ph,
      // Joint position in the piece's own bitmap space.
      jx: a.x - minX,
      jy: a.y - minY,
      seg: { x: b.x - a.x, y: b.y - a.y },
    });
  }

  // Exactly one strike per playthrough: frames 0..6 sweep coil -> full
  // extension; the final frame is a hard reset to the idle pose so a held
  // last frame can never read as a partial second strike.
  const progress = [0, 0.14, 0.34, 0.58, 0.80, 0.94, 1, 0];
  const canvasW = 760;
  const offsetX = 170;
  const rendered = [];
  for (let f = 0; f < PANELS; f++) {
    const base = progress[f];
    let under = '';
    let over = '';
    if (base > 0) {
      // Whip stagger: distal pieces release a beat after the root so the
      // uncurl travels along the tail instead of rotating as one slab. The
      // stagger is gentle — adjacent pieces stay within a few degrees of one
      // another mid-sweep, so the chain reads as one bowed tail, never a
      // kinked or stretched-flat line.
      let cx = joints[0].x;
      let cy = joints[0].y;
      const placed = [];
      for (let i = 0; i < pieces.length; i++) {
        const lag = Math.max(0, Math.min(1, base * 1.18 - i * 0.035));
        const p = lag * lag * (3 - 2 * lag);
        const ang = (deltas[i] * p * Math.PI) / 180;
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        placed.push({ i, x: cx, y: cy, deg: deltas[i] * p });
        cx += pieces[i].seg.x * cos - pieces[i].seg.y * sin;
        cy += pieces[i].seg.x * sin + pieces[i].seg.y * cos;
      }
      const draw = (q) => {
        const pc = pieces[q.i];
        return `<g transform="translate(${offsetX + q.x} ${q.y}) rotate(${q.deg}) translate(${-pc.jx} ${-pc.jy})">
          <image href="${pc.uri}" width="${pc.w}" height="${pc.h}"/>
        </g>`;
      };
      // Root piece sits BEHIND the body (its base tucks under the dorsal
      // plates); every other piece arcs in front, over the back and head.
      under = draw(placed[0]);
      over = placed.slice(1).map(draw).join('');
    }
    const svg = Buffer.from(`
      <svg width="${canvasW}" height="${h}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white"/>
        ${under}
        <image href="${base === 0 ? idleUri : bodyUri}" x="${offsetX}" y="0" width="${w}" height="${h}"/>
        ${over}
      </svg>`);
    rendered.push(await sharp(svg).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
  }

  // Anchor stability: the runtime auto-crops each frame to its own ink, so
  // frames whose tail reaches further would re-centre and make the BODY
  // drift between frames. Stamp two tiny registration pins on every panel at
  // one shared bounding box — the union of all frames, symmetrised around
  // the idle frame's centre so the strike anchors exactly like the idle
  // pose. Every frame then crops identically and the body stays pinned.
  const bboxes = rendered.map(({ data: buf, info }) => {
    let minX = info.width;
    let minY = info.height;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * 4;
        const r = buf[i];
        const g = buf[i + 1];
        const b = buf[i + 2];
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        if (mx > 190 && mx - mn < 34) continue;
        // The source panel carries a magenta grid-separator rule; the runtime
        // keys it out, so it must not count as ink here either.
        if (r > 140 && b > 140 && g < r * 0.72 && g < b * 0.72) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    return { minX, minY, maxX, maxY };
  });
  const union = bboxes.reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }));
  const idleCX = (bboxes[0].minX + bboxes[0].maxX) / 2;
  let pinMinX = Math.round(Math.min(union.minX, 2 * idleCX - union.maxX));
  let pinMaxX = Math.round(Math.max(union.maxX, 2 * idleCX - union.minX));
  if (pinMinX < 0 || pinMaxX > canvasW - 2) {
    throw new Error(`registration frame exceeds canvas: ${pinMinX}..${pinMaxX} of ${canvasW}`);
  }
  const panels = [];
  for (const { data: buf, info } of rendered) {
    const stamp = (x, y) => {
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const i = ((y + dy) * info.width + (x + dx)) * 4;
          buf[i] = 68;
          buf[i + 1] = 58;
          buf[i + 2] = 82;
          buf[i + 3] = 255;
        }
      }
    };
    stamp(pinMinX, union.minY);
    stamp(pinMaxX - 1, union.maxY - 1);
    panels.push({
      buf: await sharp(buf, {
        raw: { width: info.width, height: info.height, channels: 4 },
      }).png().toBuffer(),
      w: info.width,
      h: info.height,
    });
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
