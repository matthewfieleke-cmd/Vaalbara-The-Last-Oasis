/* ============================================================================
 * VAALBARA: THE LAST OASIS — sprites.ts
 * Painted-character pipeline.
 *
 * The 12 character paintings ship with a light-grey card background baked in.
 * At load time each image is processed once:
 *   1. FLOOD-FILL KEYING from the borders: only background-coloured pixels
 *      connected to the image edge become transparent (with a feathered
 *      alpha), so near-white details INSIDE a character — porcupine quills,
 *      eagle rim light, bee wings — are preserved.
 *   2. Auto-crop to the content bounding box.
 *   3. Species metadata applied: native facing (so the renderer can mirror
 *      correctly) and a ground anchor (where the piece meets its tile).
 *   4. The Wolves painting contains the two pack members side by side; it is
 *      split into two separate sprites, assigned per unit instance.
 *
 * Everything degrades gracefully: if an image fails to load or process, the
 * renderer falls back to the procedural vector art, preserving the game's
 * offline-first, zero-required-assets guarantee.
 * ========================================================================== */

import type { SpeciesId } from './types';

export interface Sprite {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  /** Painting's native horizontal facing: 1 = faces +x (right). */
  nativeFacing: 1 | -1;
  /** Ground contact point in sprite pixels (piece sits on its tile here). */
  anchorX: number;
  anchorY: number;
}

interface SpeciesArtMeta {
  file: string;
  nativeFacing: 1 | -1;
  /** Fraction of content height above the ground plane (baked base tiles
   * mean the visual ground sits above the bitmap's bottom edge). */
  groundLift: number;
  split?: 'wolves';
}

const ART_META: Record<SpeciesId, SpeciesArtMeta> = {
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

/** species -> one or more processed sprites (wolves have two). */
const SPRITES = new Map<SpeciesId, Sprite[]>();
let phaseArt: { basalt: HTMLImageElement | null; oasis: HTMLImageElement | null } = {
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

export function getPhaseArt(world: 'basalt' | 'oasis'): HTMLImageElement | null {
  return phaseArt[world];
}

/* ------------------------------------------------------------------------ */
/* Processing                                                                 */
/* ------------------------------------------------------------------------ */

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed: ${url}`));
    img.src = url;
  });
}

/**
 * Remove the card background via border flood fill.
 * A pixel is "background-like" if it is bright and desaturated; the fill
 * only reaches such pixels connected to the border, then the reachable set
 * gets alpha = 0 with a soft feather at the boundary.
 */
function keyBackground(img: HTMLImageElement): HTMLCanvasElement {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true })!;
  cx.drawImage(img, 0, 0);
  const data = cx.getImageData(0, 0, w, h);
  const px = data.data;

  const bgLike = (i: number): boolean => {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    // bright + low chroma = the grey/white card backdrop
    return mx > 196 && mx - mn < 26;
  };

  const reach = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) {
    stack.push(x, (h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    stack.push(y * w, y * w + w - 1);
  }
  for (const s of stack) {
    if (!reach[s] && bgLike(s * 4)) reach[s] = 1;
    else reach[s] = reach[s] || 2; // border content pixel: mark visited only
  }
  // Iterative DFS.
  const work: number[] = stack.filter((s) => reach[s] === 1);
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

  // Apply alpha: keyed pixels transparent; feather one-pixel content rim.
  for (let i = 0; i < w * h; i++) {
    if (reach[i] === 1) {
      px[i * 4 + 3] = 0;
    }
  }
  // Soft edge: any opaque pixel adjacent to a keyed pixel gets partial alpha.
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

/** Crop a canvas to its non-transparent bounding box (with small margin). */
function autoCrop(cv: HTMLCanvasElement): HTMLCanvasElement {
  const cx = cv.getContext('2d', { willReadFrequently: true })!;
  const { width: w, height: h } = cv;
  const data = cx.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = 0, maxY = 0;
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
  if (maxX <= minX || maxY <= minY) return cv;
  const pad = 2;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d')!.drawImage(cv, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function sliceCanvas(cv: HTMLCanvasElement, x0: number, x1: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = x1 - x0;
  out.height = cv.height;
  out.getContext('2d')!.drawImage(cv, x0, 0, out.width, cv.height, 0, 0, out.width, cv.height);
  return out;
}

function toSprite(cv: HTMLCanvasElement, meta: SpeciesArtMeta, facing: 1 | -1): Sprite {
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
/* Public loader — call once at boot; safe to await multiple times            */
/* ------------------------------------------------------------------------ */

let loadPromise: Promise<void> | null = null;

export function loadSprites(baseUrl = './art/'): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const species = Object.keys(ART_META) as SpeciesId[];
    await Promise.all([
      ...species.map(async (sp) => {
        const meta = ART_META[sp];
        try {
          const img = await loadImage(baseUrl + meta.file);
          const keyed = autoCrop(keyBackground(img));
          if (meta.split === 'wolves') {
            // Two wolves side by side, facing each other: split at the
            // middle; left wolf faces right (+1), right wolf faces left (-1).
            const mid = Math.round(keyed.width / 2);
            const left = autoCrop(sliceCanvas(keyed, 0, mid));
            const right = autoCrop(sliceCanvas(keyed, mid, keyed.width));
            SPRITES.set(sp, [
              toSprite(left, meta, 1),
              toSprite(right, meta, -1),
            ]);
          } else {
            SPRITES.set(sp, [toSprite(keyed, meta, meta.nativeFacing)]);
          }
        } catch (err) {
          console.warn(`[sprites] ${sp} failed, using vector fallback`, err);
        }
      }),
      (async () => {
        try {
          phaseArt.basalt = await loadImage(`${baseUrl}phase1.webp`);
        } catch {
          phaseArt.basalt = null;
        }
      })(),
      (async () => {
        try {
          phaseArt.oasis = await loadImage(`${baseUrl}phase2.webp`);
        } catch {
          phaseArt.oasis = null;
        }
      })(),
    ]);
    loaded = true;
  })();
  return loadPromise;
}
