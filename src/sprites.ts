/* ============================================================================
 * VAALBARA: THE LAST OASIS — sprites.ts
 * Painted-character pipeline: portraits + frame ANIMATION sheets.
 *
 * Portraits (single paintings) feed cards/menus. The animation sheets are
 * film strips (run: 4 panels, attack: 3 panels, bear swat: 3 panels) drawn
 * facing RIGHT on white, with magenta separator lines. At load time each
 * sheet is:
 *   1. split into panels (magenta-line detection, equal-width fallback),
 *   2. background-keyed via border flood fill (bright/low-chroma pixels
 *      connected to the edge become transparent; interior whites survive),
 *   3. auto-cropped per frame and normalised so all frames of a set share
 *      one scale, anchored at bottom-centre (the ground contact point).
 *
 * Everything degrades gracefully to the procedural vector art.
 * ========================================================================== */

import type { SpeciesId } from './types';

export interface Sprite {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  nativeFacing: 1 | -1;
  anchorX: number;
  anchorY: number;
}

export interface AnimSet {
  run: Sprite[];
  attack: Sprite[];
  /** Bear only: rear-up anti-air swat. */
  swat?: Sprite[];
  /** 3/4 rear view — marching away from the camera (up the field). */
  up?: Sprite[];
  /** 3/4 front view — marching toward the camera (down the field). */
  down?: Sprite[];
  /** Duels defeat: 4-frame side-profile collapse (standing -> lying down). */
  ko?: Sprite[];
}

/* ------------------------------------------------------------------------ */
/* Metadata                                                                   */
/* ------------------------------------------------------------------------ */

interface PortraitMeta {
  file: string;
  nativeFacing: 1 | -1;
  groundLift: number;
  split?: 'wolves';
}

const PORTRAIT_META: Record<SpeciesId, PortraitMeta> = {
  trex: { file: 'trex.webp', nativeFacing: -1, groundLift: 0.10 },
  lion: { file: 'lion.webp', nativeFacing: -1, groundLift: 0.12 },
  eagle: { file: 'eagle.webp', nativeFacing: 1, groundLift: 0.02 },
  honeybadger: { file: 'honeybadger.webp', nativeFacing: -1, groundLift: 0.12 },
  scorpion: { file: 'scorpion.webp', nativeFacing: -1, groundLift: 0.12 },
  fireants: { file: 'fireants.webp', nativeFacing: -1, groundLift: 0.10 },
  bear: { file: 'bear.webp', nativeFacing: -1, groundLift: 0.10 },
  bighorn: { file: 'bighorn.webp', nativeFacing: 1, groundLift: 0.12 },
  bees: { file: 'bees.webp', nativeFacing: 1, groundLift: 0.10 },
  wolves: { file: 'wolves.webp', nativeFacing: 1, groundLift: 0.12, split: 'wolves' },
  porcupine: { file: 'porcupine.webp', nativeFacing: 1, groundLift: 0.03 },
  beetles: { file: 'beetles.webp', nativeFacing: -1, groundLift: 0.10 },
};

/** Animation sheet base names. Run sheets all face RIGHT; a couple of
 *  attack sheets were painted facing LEFT — `attackFacing` records that so
 *  the renderer mirrors them correctly (the T-Rex used to about-face
 *  mid-chomp). */
const ANIM_FILES: Record<SpeciesId, {
  run: string; attack: string; swat?: string; attackFacing?: 1 | -1;
  up: string; down: string; ko: string;
}> = {
  trex: { run: 'trex-run', attack: 'trex-attack', attackFacing: -1, up: 'trex-up', down: 'trex-down', ko: 'trex-ko' },
  lion: { run: 'lion-run', attack: 'lion-attack', up: 'lion-up', down: 'lion-down', ko: 'lion-ko' },
  eagle: { run: 'eagle-run', attack: 'eagle-attack', up: 'eagle-up', down: 'eagle-down', ko: 'eagle-ko' },
  honeybadger: { run: 'honeybadger-run', attack: 'honeybadger-attack', up: 'honeybadger-up', down: 'honeybadger-down', ko: 'honeybadger-ko' },
  scorpion: { run: 'scorpion-run', attack: 'scorpion-attack', up: 'scorpion-up', down: 'scorpion-down', ko: 'scorpion-ko' },
  fireants: { run: 'fireants-run', attack: 'fireants-attack', up: 'fireants-up', down: 'fireants-down', ko: 'fireants-ko' },
  bear: { run: 'bear-run', attack: 'bear-attack', swat: 'bear-swat', up: 'bear-up', down: 'bear-down', ko: 'bear-ko' },
  bighorn: { run: 'bighorn-run', attack: 'bighorn-attack', up: 'bighorn-up', down: 'bighorn-down', ko: 'bighorn-ko' },
  bees: { run: 'bees-run', attack: 'bees-attack', up: 'bees-up', down: 'bees-down', ko: 'bees-ko' },
  wolves: { run: 'wolf-run', attack: 'wolf-attack', up: 'wolf-up', down: 'wolf-down', ko: 'wolf-ko' },
  porcupine: { run: 'porcupine-run', attack: 'porcupine-attack', up: 'porcupine-up', down: 'porcupine-down', ko: 'porcupine-ko' },
  beetles: { run: 'beetle-run', attack: 'beetle-attack', attackFacing: -1, up: 'beetle-up', down: 'beetle-down', ko: 'beetle-ko' },
};

const SPRITES = new Map<SpeciesId, Sprite[]>(); // portraits (wolves: 2)
const ANIMS = new Map<SpeciesId, AnimSet>();
let arenaArt: { basalt: HTMLImageElement | null; oasis: HTMLImageElement | null } = {
  basalt: null,
  oasis: null,
};
let duelArt: { basalt: HTMLImageElement | null; oasis: HTMLImageElement | null } = {
  basalt: null,
  oasis: null,
};
let loaded = false;

export function spritesReady(): boolean {
  return loaded;
}

export function getSprite(species: SpeciesId, variant = 0): Sprite | null {
  const list = SPRITES.get(species);
  if (!list || list.length === 0) return null;
  return list[variant % list.length];
}

export function getAnim(species: SpeciesId): AnimSet | null {
  return ANIMS.get(species) ?? null;
}

export function getPhaseArt(world: 'basalt' | 'oasis'): HTMLImageElement | null {
  return arenaArt[world];
}

/** Side-view painted battlefield for the Duels mode. */
export function getDuelArt(world: 'basalt' | 'oasis'): HTMLImageElement | null {
  return duelArt[world];
}

/* ------------------------------------------------------------------------ */
/* Image processing                                                           */
/* ------------------------------------------------------------------------ */

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed: ${url}`));
    img.src = url;
  });
}

function toCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  cv.getContext('2d')!.drawImage(img, 0, 0);
  return cv;
}

/** Border flood-fill keying: connected bright/low-chroma pixels -> alpha 0.
 *
 *  Leak-resistant: the fill only PROPAGATES through "deep background"
 *  (pixels whose whole 3×3 neighbourhood is bg-like), so it cannot squeeze
 *  through 1–2 px anti-aliased bridges into bright fur/wool inside the body
 *  (the Bighorn's white back). A final bounded dilation then eats the
 *  anti-aliased rim the strict fill leaves behind. */
function keyBackground(cv: HTMLCanvasElement): HTMLCanvasElement {
  const w = cv.width;
  const h = cv.height;
  const cx = cv.getContext('2d', { willReadFrequently: true })!;
  const data = cx.getImageData(0, 0, w, h);
  const px = data.data;

  const bgLike = (i: number): boolean => {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    // bright + low chroma, OR the magenta separator line
    const grey = mx > 196 && mx - mn < 26;
    const magenta = r > 150 && b > 150 && g < r * 0.7 && g < b * 0.7;
    return grey || magenta;
  };

  // The propagation gate needs a per-image reference: animation sheets sit
  // on pure ~253 paper, while portrait paintings fade to ~229 grey at the
  // corners. Sample the border's bg-like pixels and take a low percentile —
  // "pure background" is then anything at least as clean as the paper edge.
  const borderMins: number[] = [];
  const borderSample = (i: number): void => {
    const r = px[i * 4];
    const g = px[i * 4 + 1];
    const b = px[i * 4 + 2];
    if (bgLike(i * 4)) borderMins.push(Math.min(r, g, b));
  };
  for (let x = 0; x < w; x++) {
    borderSample(x);
    borderSample((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    borderSample(y * w);
    borderSample(y * w + w - 1);
  }
  borderMins.sort((a, b) => a - b);
  const paperRef = borderMins.length ? borderMins[Math.floor(borderMins.length * 0.25)] : 250;
  const pureFloor = Math.max(200, paperRef - 14);

  // Paper-clean pixels (or separator magenta) — shaded wool/fur is bright
  // but noisier than the paper, so the fill can't take root inside a body.
  const pureBg = (i: number): boolean => {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const white = mn > pureFloor && mx - mn < 10;
    const magenta = r > 150 && b > 150 && g < r * 0.7 && g < b * 0.7;
    return white || magenta;
  };

  const bg = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) bg[i] = bgLike(i * 4) ? 1 : 0;

  // Deep background: pure white/magenta with an entirely bg-like 3×3 window.
  const deep = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!bg[i]) continue;
      if (x === 0 || x === w - 1 || y === 0 || y === h - 1) {
        deep[i] = 1; // sheet border counts as deep
        continue;
      }
      let ok = pureBg(i * 4) ? 1 : 0;
      for (let dy = -1; dy <= 1 && ok; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!bg[i + dy * w + dx]) { ok = 0; break; }
        }
      }
      deep[i] = ok;
    }
  }

  const reach = new Uint8Array(w * h);
  const work: number[] = [];
  const seed = (s: number): void => {
    if (!reach[s] && deep[s]) {
      reach[s] = 1;
      work.push(s);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (work.length) {
    const cur = work.pop()!;
    const cy = (cur / w) | 0;
    const cxp = cur % w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cxp + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const ni = ny * w + nx;
      if (reach[ni] || !deep[ni]) continue;
      reach[ni] = 1;
      work.push(ni);
    }
  }
  // Dilate the reached region into the remaining bg-like rim (anti-aliased
  // halo around the silhouette) — bounded, so it can't re-enter the body.
  for (let pass = 0; pass < 3; pass++) {
    let grew = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (reach[i] || !bg[i]) continue;
        if ((x > 0 && reach[i - 1] === 1) || (x < w - 1 && reach[i + 1] === 1)
          || (y > 0 && reach[i - w] === 1) || (y < h - 1 && reach[i + w] === 1)) {
          reach[i] = 2;
          grew = true;
        }
      }
    }
    for (let i = 0; i < w * h; i++) if (reach[i] === 2) reach[i] = 1;
    if (!grew) break;
  }
  for (let i = 0; i < w * h; i++) {
    if (reach[i] === 1) px[i * 4 + 3] = 0;
  }

  // HALO EROSION — kill the white ghost around legs and bellies.
  // The bounded dilation above only eats pixels the fill FLAGGED as bg-like;
  // anti-aliased paper blends (e.g. 220-grey between white paper and a dark
  // leg) fall just under that gate and survive as a 1-3 px pale fringe that
  // reads as a white outline on every dark arena. Erode, from the
  // transparent side inward, any remaining boundary pixel that is still
  // clearly paper-tinted (bright, low chroma). Body edges are blends of the
  // CHARACTER's paint and fail the brightness/chroma test, so genuine white
  // fur eroded here is at most the same 1-3 px the halo occupied.
  const paperTinted = (i4: number): boolean => {
    const r = px[i4];
    const g = px[i4 + 1];
    const b = px[i4 + 2];
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    return mx > 178 && mx - mn < 40;
  };
  for (let pass = 0; pass < 3; pass++) {
    let ate = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (px[i * 4 + 3] === 0) continue;
        const holeAdj =
          x === 0 || x === w - 1 || y === 0 || y === h - 1 ||
          px[(i - 1) * 4 + 3] === 0 || px[(i + 1) * 4 + 3] === 0 ||
          px[(i - w) * 4 + 3] === 0 || px[(i + w) * 4 + 3] === 0;
        if (holeAdj && paperTinted(i * 4)) {
          px[i * 4 + 3] = 254; // mark: erased after the sweep (not mid-scan)
          ate = true;
        }
      }
    }
    if (!ate) break;
    for (let i = 0; i < w * h; i++) if (px[i * 4 + 3] === 254) px[i * 4 + 3] = 0;
  }

  // Feather the content rim. Any surviving BRIGHT rim pixel still carries a
  // trace of paper, so it feathers harder than painted-colour edges do.
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (px[i * 4 + 3] === 0) continue;
      let holes = 0;
      if (px[(i - 1) * 4 + 3] === 0) holes++;
      if (px[(i + 1) * 4 + 3] === 0) holes++;
      if (px[(i - w) * 4 + 3] === 0) holes++;
      if (px[(i + w) * 4 + 3] === 0) holes++;
      if (holes > 0) {
        const mx = Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
        const bright = mx > 165 ? 74 : 48;
        px[i * 4 + 3] = Math.min(px[i * 4 + 3], 255 - holes * bright);
      }
    }
  }
  cx.putImageData(data, 0, 0);
  return cv;
}

function contentBounds(cv: HTMLCanvasElement): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const cx = cv.getContext('2d', { willReadFrequently: true })!;
  const { width: w, height: h } = cv;
  const data = cx.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { minX, minY, maxX, maxY };
}

function cropTo(cv: HTMLCanvasElement, b: { minX: number; minY: number; maxX: number; maxY: number }, pad = 2): HTMLCanvasElement {
  const x0 = Math.max(0, b.minX - pad);
  const y0 = Math.max(0, b.minY - pad);
  const x1 = Math.min(cv.width - 1, b.maxX + pad);
  const y1 = Math.min(cv.height - 1, b.maxY + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(cv, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function autoCrop(cv: HTMLCanvasElement): HTMLCanvasElement {
  const b = contentBounds(cv);
  return b ? cropTo(cv, b) : cv;
}

function sliceCanvas(cv: HTMLCanvasElement, x0: number, x1: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = Math.max(1, x1 - x0);
  out.height = cv.height;
  out.getContext('2d')!.drawImage(cv, x0, 0, out.width, cv.height, 0, 0, out.width, cv.height);
  return out;
}

/**
 * Split a film strip into panels. Prefers magenta separator columns; falls
 * back to N equal slices. Returns keyed, cropped frames.
 */
function splitStrip(img: HTMLImageElement, expected: number): HTMLCanvasElement[] {
  const fullW = img.naturalWidth;
  const fullH = img.naturalHeight;
  const full = document.createElement('canvas');
  full.width = fullW;
  full.height = fullH;
  const fctx = full.getContext('2d', { willReadFrequently: true })!;
  fctx.drawImage(img, 0, 0);
  const fdata = fctx.getImageData(0, 0, fullW, fullH).data;

  // Some sheets carry a full-width dark rule hugging the top/bottom edge.
  // It survives white-keying (it isn't paper) and then reads as frame
  // content, so the animal's ground anchor lands on the BAR instead of its
  // feet — the whole species floats. Trim any near-edge row that is almost
  // entirely dark ink before slicing.
  const rowDark = (y: number): number => {
    let n = 0;
    let total = 0;
    for (let x = 0; x < fullW; x += 3) {
      const i = (y * fullW + x) * 4;
      const lum = fdata[i] * 0.3 + fdata[i + 1] * 0.5 + fdata[i + 2] * 0.2;
      if (lum < 70) n++;
      total++;
    }
    return n / total;
  };
  let trimTop = 0;
  while (trimTop < fullH * 0.12 && rowDark(trimTop) > 0.8) trimTop++;
  let trimBot = fullH;
  while (trimBot > fullH * 0.88 && rowDark(trimBot - 1) > 0.8) trimBot--;
  // Also shave the anti-aliased fringe the rule leaves behind.
  if (trimTop > 0) trimTop = Math.min(fullH, trimTop + 2);
  if (trimBot < fullH) trimBot = Math.max(0, trimBot - 2);

  const w = fullW;
  const h = trimBot - trimTop;
  const probe = document.createElement('canvas');
  probe.width = w;
  probe.height = h;
  const pctx = probe.getContext('2d', { willReadFrequently: true })!;
  pctx.drawImage(full, 0, trimTop, w, h, 0, 0, w, h);
  const data = pctx.getImageData(0, 0, w, h).data;

  // Column separator density. Sheets use either magenta rules or thin dark
  // grey rules; both read as "a narrow column of non-background ink running
  // nearly the full sheet height".
  const magenta: number[] = new Array(w).fill(0);
  const ink: number[] = new Array(w).fill(0);
  for (let x = 0; x < w; x++) {
    let nMag = 0;
    let nInk = 0;
    for (let y = 0; y < h; y += 3) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (r > 140 && b > 140 && g < r * 0.72 && g < b * 0.72) nMag++;
      if (!(mx > 196 && mx - mn < 26)) nInk++; // anything that is not paper-white
    }
    magenta[x] = nMag / Math.ceil(h / 3);
    ink[x] = nInk / Math.ceil(h / 3);
  }

  // Track FULL separator runs so panels are cut inset past them — otherwise
  // anti-aliased fringe survives keying as a ghost line inside the frame.
  const cuts: Array<{ a: number; b: number }> = [];
  const maxRule = Math.max(6, Math.round(w * 0.012));
  let x = 4;
  while (x < w - 4) {
    const isMag = magenta[x] > 0.5;
    // A dark rule: a tall, very narrow ink run sitting in an empty gutter —
    // no painted character ever presents as an isolated 2-5 px column.
    const isRule = ink[x] > 0.7;
    if (isMag || isRule) {
      let x2 = x;
      while (x2 < w - 1 && (isMag ? magenta[x2] > 0.15 : ink[x2] > 0.6)) x2++;
      const gutterL = ink[Math.max(0, x - 3)] < 0.05;
      const gutterR = ink[Math.min(w - 1, x2 + 3)] < 0.05;
      if (isMag || (x2 - x <= maxRule && gutterL && gutterR)) {
        cuts.push({ a: x, b: x2 });
        x = x2 + Math.round(w * 0.05); // skip past this separator region
        continue;
      }
      x = x2 + 1;
    } else {
      x++;
    }
  }

  const inset = Math.max(2, Math.round(w * 0.004));
  let panels: HTMLCanvasElement[] = [];
  if (cuts.length >= expected - 1) {
    const used = cuts.slice(0, expected - 1);
    for (let i = 0; i < expected; i++) {
      const x0 = i === 0 ? 0 : used[i - 1].b + inset;
      const x1 = i === expected - 1 ? w : used[i].a - inset;
      panels.push(sliceCanvas(probe, x0, x1));
    }
  } else {
    // Equal-width fallback — shave the shared edge in case a rule sits there.
    const step = w / expected;
    for (let i = 0; i < expected; i++) {
      const x0 = Math.round(i * step) + (i === 0 ? 0 : inset);
      const x1 = Math.round((i + 1) * step) - (i === expected - 1 ? 0 : inset);
      panels.push(sliceCanvas(probe, x0, x1));
    }
  }
  return panels.map((p) => autoCrop(keyBackground(p)));
}

/** Mean opaque-pixel area of a frame set — a pose-invariant proxy for the
 *  animal's drawn scale (a rearing pose is taller but covers ~the same ink). */
function meanContentArea(frames: HTMLCanvasElement[]): number {
  let total = 0;
  for (const f of frames) {
    const data = f.getContext('2d', { willReadFrequently: true })!
      .getImageData(0, 0, f.width, f.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 16) n++;
    total += n;
  }
  return Math.max(1, total / frames.length);
}

/** Normalise frames of a set: shared scale, bottom-centre ground anchor.
 *  `logicalH` overrides the set's own height so DIFFERENT sets of one
 *  species (run vs attack sheets, drawn at different sheet scales) render
 *  the animal at one consistent size — no more size-popping on attack. */
function toFrameSprites(
  frames: HTMLCanvasElement[],
  groundLift = 0.03,
  logicalH?: number,
  facing: 1 | -1 = 1,
): Sprite[] {
  const maxH = Math.max(...frames.map((f) => f.height));
  return frames.map((f) => ({
    canvas: f,
    w: f.width,
    // A shared logical height keeps scale steady across the cycle even when
    // individual frames crop differently.
    h: logicalH ?? maxH,
    nativeFacing: facing,
    anchorX: f.width / 2,
    anchorY: f.height * (1 - groundLift),
  }));
}

function toSprite(cv: HTMLCanvasElement, meta: PortraitMeta, facing: 1 | -1): Sprite {
  return {
    canvas: cv,
    w: cv.width,
    h: cv.height,
    nativeFacing: facing,
    anchorX: cv.width / 2,
    anchorY: cv.height * (1 - meta.groundLift),
  };
}

/* ------------------------------------------------------------------------ */
/* Public loader                                                              */
/* ------------------------------------------------------------------------ */

let loadPromise: Promise<void> | null = null;

export function loadSprites(baseUrl = './art/'): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const species = Object.keys(PORTRAIT_META) as SpeciesId[];
    await Promise.all([
      // Portraits for cards / menus.
      ...species.map(async (sp) => {
        const meta = PORTRAIT_META[sp];
        try {
          const img = await loadImage(baseUrl + meta.file);
          const keyed = autoCrop(keyBackground(toCanvas(img)));
          if (meta.split === 'wolves') {
            const mid = Math.round(keyed.width / 2);
            SPRITES.set(sp, [
              toSprite(autoCrop(sliceCanvas(keyed, 0, mid)), meta, 1),
              toSprite(autoCrop(sliceCanvas(keyed, mid, keyed.width)), meta, -1),
            ]);
          } else {
            SPRITES.set(sp, [toSprite(keyed, meta, meta.nativeFacing)]);
          }
        } catch (err) {
          console.warn(`[sprites] portrait ${sp} failed`, err);
        }
      }),
      // Animation sets.
      ...species.map(async (sp) => {
        const files = ANIM_FILES[sp];
        try {
          const [runImg, atkImg, swatImg, upImg, downImg, koImg] = await Promise.all([
            loadImage(`${baseUrl}anim/${files.run}.webp`),
            loadImage(`${baseUrl}anim/${files.attack}.webp`),
            files.swat ? loadImage(`${baseUrl}anim/${files.swat}.webp`) : Promise.resolve(null),
            loadImage(`${baseUrl}anim/${files.up}.webp`).catch(() => null),
            loadImage(`${baseUrl}anim/${files.down}.webp`).catch(() => null),
            loadImage(`${baseUrl}anim/${files.ko}.webp`).catch(() => null),
          ]);
          // The run set defines the species' reference scale; attack/swat
          // sets are area-matched against it so the animal never changes
          // size when it switches animation.
          const runFrames = splitStrip(runImg, 4);
          const runH = Math.max(...runFrames.map((f) => f.height));
          const runArea = meanContentArea(runFrames);
          const crossH = (frames: HTMLCanvasElement[]): number =>
            runH * Math.sqrt(meanContentArea(frames) / runArea);
          const atkFrames = splitStrip(atkImg, 3);
          const set: AnimSet = {
            run: toFrameSprites(runFrames),
            attack: toFrameSprites(atkFrames, 0.03, crossH(atkFrames), files.attackFacing ?? 1),
          };
          if (swatImg) {
            const swatFrames = splitStrip(swatImg, 3);
            set.swat = toFrameSprites(swatFrames, 0.03, crossH(swatFrames));
          }
          if (upImg) {
            const upFrames = splitStrip(upImg, 4);
            set.up = toFrameSprites(upFrames, 0.03, crossH(upFrames));
          }
          if (downImg) {
            const downFrames = splitStrip(downImg, 4);
            set.down = toFrameSprites(downFrames, 0.03, crossH(downFrames));
          }
          if (koImg) {
            const koFrames = splitStrip(koImg, 4);
            // KO frames must NOT share a logical height: each pose is
            // anchored at its own bottom so the body visibly sinks. But they
            // do share the run set's scale via per-frame area matching.
            set.ko = koFrames.map((f) => toFrameSprites([f], 0.02, crossH([f]))[0]);
          }
          ANIMS.set(sp, set);
        } catch (err) {
          console.warn(`[sprites] anim ${sp} failed, portrait/vector fallback`, err);
        }
      }),
      (async () => {
        try {
          arenaArt.basalt = await loadImage(`${baseUrl}arena1.webp`);
        } catch {
          arenaArt.basalt = null;
        }
      })(),
      (async () => {
        try {
          arenaArt.oasis = await loadImage(`${baseUrl}arena2.webp`);
        } catch {
          arenaArt.oasis = null;
        }
      })(),
      ...(['basalt', 'oasis'] as const).map(async (w) => {
        try {
          duelArt[w] = await loadImage(`${baseUrl}duel-${w}.webp`);
        } catch {
          duelArt[w] = null;
        }
      }),
    ]);
    loaded = true;
  })();
  return loadPromise;
}
