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

/** Animation sheet base names (all sheets face RIGHT). */
const ANIM_FILES: Record<SpeciesId, { run: string; attack: string; swat?: string }> = {
  trex: { run: 'trex-run', attack: 'trex-attack' },
  lion: { run: 'lion-run', attack: 'lion-attack' },
  eagle: { run: 'eagle-run', attack: 'eagle-attack' },
  honeybadger: { run: 'honeybadger-run', attack: 'honeybadger-attack' },
  scorpion: { run: 'scorpion-run', attack: 'scorpion-attack' },
  fireants: { run: 'fireants-run', attack: 'fireants-attack' },
  bear: { run: 'bear-run', attack: 'bear-attack', swat: 'bear-swat' },
  bighorn: { run: 'bighorn-run', attack: 'bighorn-attack' },
  bees: { run: 'bees-run', attack: 'bees-attack' },
  wolves: { run: 'wolf-run', attack: 'wolf-attack' },
  porcupine: { run: 'porcupine-run', attack: 'porcupine-attack' },
  beetles: { run: 'beetle-run', attack: 'beetle-attack' },
};

const SPRITES = new Map<SpeciesId, Sprite[]>(); // portraits (wolves: 2)
const ANIMS = new Map<SpeciesId, AnimSet>();
let arenaArt: { basalt: HTMLImageElement | null; oasis: HTMLImageElement | null } = {
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

/** Border flood-fill keying: connected bright/low-chroma pixels -> alpha 0. */
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

  const reach = new Uint8Array(w * h);
  const work: number[] = [];
  for (let x = 0; x < w; x++) {
    for (const s of [x, (h - 1) * w + x]) {
      if (!reach[s] && bgLike(s * 4)) {
        reach[s] = 1;
        work.push(s);
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (const s of [y * w, y * w + w - 1]) {
      if (!reach[s] && bgLike(s * 4)) {
        reach[s] = 1;
        work.push(s);
      }
    }
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
      if (reach[ni]) continue;
      if (bgLike(ni * 4)) {
        reach[ni] = 1;
        work.push(ni);
      } else {
        reach[ni] = 2;
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (reach[i] === 1) px[i * 4 + 3] = 0;
  }
  // Feather the content rim.
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (px[i * 4 + 3] === 0) continue;
      let holes = 0;
      if (px[(i - 1) * 4 + 3] === 0) holes++;
      if (px[(i + 1) * 4 + 3] === 0) holes++;
      if (px[(i - w) * 4 + 3] === 0) holes++;
      if (px[(i + w) * 4 + 3] === 0) holes++;
      if (holes > 0) px[i * 4 + 3] = Math.min(px[i * 4 + 3], 255 - holes * 48);
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
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const probe = document.createElement('canvas');
  probe.width = w;
  probe.height = h;
  const pctx = probe.getContext('2d', { willReadFrequently: true })!;
  pctx.drawImage(img, 0, 0);
  const data = pctx.getImageData(0, 0, w, h).data;

  // Column magenta density.
  const magenta: number[] = new Array(w).fill(0);
  for (let x = 0; x < w; x++) {
    let n = 0;
    for (let y = 0; y < h; y += 3) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 140 && b > 140 && g < r * 0.72 && g < b * 0.72) n++;
    }
    magenta[x] = n / (h / 3);
  }
  // Separator columns: dense magenta runs away from the borders.
  const cuts: number[] = [];
  let x = 4;
  while (x < w - 4) {
    if (magenta[x] > 0.5) {
      let x2 = x;
      while (x2 < w - 1 && magenta[x2] > 0.3) x2++;
      cuts.push(Math.round((x + x2) / 2));
      x = x2 + Math.round(w * 0.05); // skip past this separator region
    } else {
      x++;
    }
  }

  let panels: HTMLCanvasElement[];
  if (cuts.length >= expected - 1) {
    const bounds = [0, ...cuts.slice(0, expected - 1), w];
    panels = [];
    for (let i = 0; i < expected; i++) {
      panels.push(sliceCanvas(probe, bounds[i], bounds[i + 1]));
    }
  } else {
    panels = [];
    const step = w / expected;
    for (let i = 0; i < expected; i++) {
      panels.push(sliceCanvas(probe, Math.round(i * step), Math.round((i + 1) * step)));
    }
  }
  return panels.map((p) => autoCrop(keyBackground(p)));
}

/** Normalise frames of a set: shared scale, bottom-centre ground anchor. */
function toFrameSprites(frames: HTMLCanvasElement[], groundLift = 0.03): Sprite[] {
  const maxH = Math.max(...frames.map((f) => f.height));
  return frames.map((f) => ({
    canvas: f,
    w: f.width,
    // A shared logical height keeps scale steady across the cycle even when
    // individual frames crop differently.
    h: maxH,
    nativeFacing: 1 as const,
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
          const [runImg, atkImg, swatImg] = await Promise.all([
            loadImage(`${baseUrl}anim/${files.run}.webp`),
            loadImage(`${baseUrl}anim/${files.attack}.webp`),
            files.swat ? loadImage(`${baseUrl}anim/${files.swat}.webp`) : Promise.resolve(null),
          ]);
          const set: AnimSet = {
            run: toFrameSprites(splitStrip(runImg, 4)),
            attack: toFrameSprites(splitStrip(atkImg, 3)),
          };
          if (swatImg) set.swat = toFrameSprites(splitStrip(swatImg, 3));
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
    ]);
    loaded = true;
  })();
  return loadPromise;
}
