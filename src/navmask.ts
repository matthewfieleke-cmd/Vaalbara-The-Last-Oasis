/* ============================================================================
 * VAALBARA: THE LAST OASIS — navmask.ts
 * Continuous-world terrain, baked from the arena paintings.
 *
 * scripts/gen-navmask.mjs samples the paintings offline into a 72x120 cell
 * mask over the 9x15 world (8 cells per world unit) so every client shares
 * a bit-identical world — a requirement for deterministic lockstep. The
 * arenas are not decoration: this mask IS the collision geometry, so
 * characters run the dark basalt paths and never cross the painted lava.
 * ========================================================================== */

import { FORT_ARCH_HALF_W, FORT_LANE_X, FORT_WALL_FRONT, WORLD_H, WORLD_W } from './types';
import { BASALT_MASK_B64, NAV_GH, NAV_GW, OASIS_MASK_B64 } from './navmask-data';

export type WorldId = 'basalt' | 'oasis';

export const CELL = {
  WALK: 0,
  BLOCKED: 1,
  VENT: 2,
  SAND: 3,
  SHALLOW: 4,
  DEEP: 5,
} as const;

function decode(b64: string): Uint8Array {
  // atob exists in every browser and in Node 16+ (used by the sim harness).
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

/** Carve the Phase-1 fortresses into the baked basalt mask: each end of the
 *  field becomes solid wall except for the two arch corridors, so ground
 *  units can only enter and leave the field through the gates. The corridors
 *  are forced WALKABLE end to end (overriding any painted clutter) so a unit
 *  dropped at a gate pad always has a clean march through its arch. */
function applyFortresses(mask: Uint8Array): Uint8Array {
  const cx = NAV_GW / WORLD_W;
  const cy = NAV_GH / WORLD_H;
  const bands: Array<[number, number]> = [
    [0, FORT_WALL_FRONT[1]],          // top fortress body (seat 1)
    [FORT_WALL_FRONT[0], WORLD_H],    // bottom fortress body (seat 0)
  ];
  for (const [y0, y1] of bands) {
    const gy0 = Math.max(0, Math.floor(y0 * cy));
    const gy1 = Math.min(NAV_GH, Math.ceil(y1 * cy));
    for (let gy = gy0; gy < gy1; gy++) {
      for (let gx = 0; gx < NAV_GW; gx++) {
        const wx = (gx + 0.5) / cx;
        const inArch = FORT_LANE_X.some((lx) => Math.abs(wx - lx) <= FORT_ARCH_HALF_W);
        // Keep the outermost row sealed so gates never leak off-world.
        const edge = gy < 1 || gy > NAV_GH - 2;
        mask[gy * NAV_GW + gx] = inArch && !edge ? CELL.WALK : CELL.BLOCKED;
      }
    }
  }
  return mask;
}

const MASKS: Record<WorldId, Uint8Array> = {
  basalt: applyFortresses(decode(BASALT_MASK_B64)),
  oasis: decode(OASIS_MASK_B64),
};

const CX = NAV_GW / WORLD_W; // cells per world unit (8)
const CY = NAV_GH / WORLD_H;

/** Terrain cell code at a world position. Out of bounds reads as BLOCKED. */
export function cellAt(world: WorldId, x: number, y: number): number {
  const gx = Math.floor(x * CX);
  const gy = Math.floor(y * CY);
  if (gx < 0 || gx >= NAV_GW || gy < 0 || gy >= NAV_GH) return CELL.BLOCKED;
  return MASKS[world][gy * NAV_GW + gx];
}

/** Ground units cannot enter lava/walls; everything else is fair ground. */
export function walkableAt(world: WorldId, x: number, y: number): boolean {
  return cellAt(world, x, y) !== CELL.BLOCKED;
}

export function isWater(world: WorldId, x: number, y: number): boolean {
  const c = cellAt(world, x, y);
  return c === CELL.SHALLOW || c === CELL.DEEP;
}

export function isDeep(world: WorldId, x: number, y: number): boolean {
  return cellAt(world, x, y) === CELL.DEEP;
}

/* ------------------------------------------------------------------------ */
/* Coarse pathing grid — 18 x 30 nodes for BFS corridor routing               */
/* ------------------------------------------------------------------------ */

export const PATH_GW = 18;
export const PATH_GH = 30;

const pathGrids: Record<WorldId, Uint8Array> = {
  basalt: buildPathGrid('basalt'),
  oasis: buildPathGrid('oasis'),
};

function buildPathGrid(world: WorldId): Uint8Array {
  // A path node is walkable when the majority of its 4x4 cell block is.
  const g = new Uint8Array(PATH_GW * PATH_GH);
  const bx = NAV_GW / PATH_GW;
  const by = NAV_GH / PATH_GH;
  for (let py = 0; py < PATH_GH; py++) {
    for (let px = 0; px < PATH_GW; px++) {
      let open = 0;
      let total = 0;
      for (let sy = 0; sy < by; sy++) {
        for (let sx = 0; sx < bx; sx++) {
          const cx2 = px * bx + sx;
          const cy2 = py * by + sy;
          total++;
          if (MASKS[world][cy2 * NAV_GW + cx2] !== CELL.BLOCKED) open++;
        }
      }
      g[py * PATH_GW + px] = open >= total * 0.55 ? 1 : 0;
    }
  }
  return g;
}

export function pathNodeOpen(world: WorldId, px: number, py: number): boolean {
  if (px < 0 || px >= PATH_GW || py < 0 || py >= PATH_GH) return false;
  return pathGrids[world][py * PATH_GW + px] === 1;
}

export const worldToPath = (x: number, y: number): { px: number; py: number } => ({
  px: Math.max(0, Math.min(PATH_GW - 1, Math.floor((x / WORLD_W) * PATH_GW))),
  py: Math.max(0, Math.min(PATH_GH - 1, Math.floor((y / WORLD_H) * PATH_GH))),
});

export const pathToWorld = (px: number, py: number): { x: number; y: number } => ({
  x: ((px + 0.5) / PATH_GW) * WORLD_W,
  y: ((py + 0.5) / PATH_GH) * WORLD_H,
});

/**
 * BFS from (sx, sy) toward (gx, gy) on the coarse grid; returns the next
 * corridor waypoint in world coords, or null when already adjacent / goal
 * unreachable (caller then steers directly and slides along walls).
 */
export function nextCorridor(
  world: WorldId, sx: number, sy: number, gx: number, gy: number,
): { x: number; y: number } | null {
  const s = worldToPath(sx, sy);
  const g = worldToPath(gx, gy);
  if (s.px === g.px && s.py === g.py) return null;

  const visited = new Int16Array(PATH_GW * PATH_GH).fill(-1);
  const queue: number[] = [];
  const si = s.py * PATH_GW + s.px;
  visited[si] = si;
  queue.push(si);
  let head = 0;
  const gi = g.py * PATH_GW + g.px;
  // Deterministic neighbour order, goal-biased.
  const dirs = [
    [0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1],
  ].sort((a, b) => {
    const da = Math.abs(s.px + a[0] - g.px) + Math.abs(s.py + a[1] - g.py);
    const db = Math.abs(s.px + b[0] - g.px) + Math.abs(s.py + b[1] - g.py);
    return da - db;
  });

  let found = -1;
  while (head < queue.length) {
    const cur = queue[head++];
    if (cur === gi) {
      found = cur;
      break;
    }
    const cx2 = cur % PATH_GW;
    const cy2 = (cur / PATH_GW) | 0;
    for (const [dx, dy] of dirs) {
      const nx = cx2 + dx;
      const ny = cy2 + dy;
      if (nx < 0 || nx >= PATH_GW || ny < 0 || ny >= PATH_GH) continue;
      const ni = ny * PATH_GW + nx;
      if (visited[ni] !== -1) continue;
      if (!pathNodeOpen(world, nx, ny)) continue;
      // No corner cutting through diagonal walls.
      if (dx !== 0 && dy !== 0 && (!pathNodeOpen(world, cx2 + dx, cy2) || !pathNodeOpen(world, cx2, cy2 + dy))) continue;
      visited[ni] = cur;
      queue.push(ni);
    }
  }
  if (found === -1) return null;

  // Walk back to the first step after the start.
  let node = found;
  while (visited[node] !== si && visited[node] !== node) node = visited[node];
  const nx = node % PATH_GW;
  const ny = (node / PATH_GW) | 0;
  return pathToWorld(nx, ny);
}
