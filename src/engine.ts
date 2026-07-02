/* ============================================================================
 * VAALBARA: THE LAST OASIS — engine.ts
 * Headless, deterministic simulation.
 *
 *  - The world advances only via advanceTick(state, inputs). No wall-clock
 *    time, no Math.random (a seeded xorshift PRNG lives in the state seed),
 *    no DOM. The same seed + ordered input stream replays identically, which
 *    is what makes lockstep multiplayer and catch-up interpolation possible.
 *  - Inputs are queued asynchronously and stamped with the tick they execute
 *    on (always a future tick). The TickDriver below owns real-time pacing.
 * ========================================================================== */

import {
  ACID_DMG, AQUA_MAX, AQUA_PER_TICK_P1, AQUA_PER_TICK_P2, BLESSING_MULT, BOARD_H, BOARD_W,
  CAPTURE_RATE, DEPLOY_ROWS, HAND_SIZE, LOTUS_HEAL_PCT, MAX_ARMY, PHASE1_TICKS, PHASE2_TICKS,
  TICK_MS, TRANSITION_TICKS, VENT_DMG, idx, inBounds,
} from './types';
import type {
  CardId, FactionId, GameEvent, GameState, GridPos, PhaseConfig, PlayerId, PlayerInput,
  TickResult, TileState, UnitState, UnitStats,
} from './types';
import { LAVA_RAIN, MECHANICS, SPELL_BALANCE, buildDeck, cardDef, speciesDef } from './data';

/* ------------------------------------------------------------------------ */
/* Deterministic PRNG                                                         */
/* ------------------------------------------------------------------------ */

function makeRng(seed: number) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };
}

/* ------------------------------------------------------------------------ */
/* Map generation                                                             */
/* ------------------------------------------------------------------------ */

function tile(terrain: TileState['terrain']): TileState {
  return { terrain, destroyed: false };
}

/** Phase 1 — The Basalt Fields: magma rivers form chess-like chokepoints. */
export function generateBasaltMap(seed: number): TileState[] {
  const rng = makeRng(seed ^ 0xba5a17);
  const board: TileState[] = new Array(BOARD_W * BOARD_H);
  for (let i = 0; i < board.length; i++) board[i] = tile('basalt');

  // Two horizontal magma rivers with staggered gaps => chokepoints.
  const riverRows = [5, 9];
  for (const ry of riverRows) {
    const gap1 = 1 + Math.floor(rng() * 3);
    const gap2 = BOARD_W - 2 - Math.floor(rng() * 3);
    for (let x = 0; x < BOARD_W; x++) {
      if (x === gap1 || x === gap2 || x === Math.floor(BOARD_W / 2)) continue;
      board[idx(x, ry)] = tile('magma');
    }
  }
  // Sulfur vents scattered in the midfield punish campers.
  let vents = 0;
  while (vents < 5) {
    const x = Math.floor(rng() * BOARD_W);
    const y = 4 + Math.floor(rng() * 7);
    if (board[idx(x, y)].terrain === 'basalt') {
      board[idx(x, y)] = tile('vent');
      vents++;
    }
  }
  return board;
}

/** Phase 2 — The Oasis: pond, shallows, reeds, lilies, lotus blooms. */
export function generateOasisMap(seed: number): TileState[] {
  const rng = makeRng(seed ^ 0x0a515);
  const board: TileState[] = new Array(BOARD_W * BOARD_H);
  const cx = (BOARD_W - 1) / 2;
  const cy = (BOARD_H - 1) / 2;

  for (let y = 0; y < BOARD_H; y++) {
    for (let x = 0; x < BOARD_W; x++) {
      const d = Math.hypot((x - cx) * 1.15, (y - cy) * 0.8);
      let t: TileState['terrain'] = 'grass';
      if (d < 1.7) t = 'deep';
      else if (d < 2.9) t = 'shallow';
      else if (d < 3.6) t = 'sand';
      board[idx(x, y)] = tile(t);
    }
  }
  // Lily pads bridge the deep water.
  const lilySpots: GridPos[] = [
    { x: Math.round(cx) - 1, y: Math.round(cy) },
    { x: Math.round(cx) + 1, y: Math.round(cy) },
  ];
  for (const p of lilySpots) if (inBounds(p.x, p.y)) board[idx(p.x, p.y)] = tile('lily');

  // Reed banks flanking the pond grant stealth.
  let reeds = 0;
  while (reeds < 6) {
    const x = Math.floor(rng() * BOARD_W);
    const y = 3 + Math.floor(rng() * (BOARD_H - 6));
    const i = idx(x, y);
    if (board[i].terrain === 'grass' || board[i].terrain === 'sand') {
      board[i] = tile('reeds');
      reeds++;
    }
  }
  // Four lotus blooms at the pond rim — breakable healing pinatas.
  let lotus = 0;
  while (lotus < 4) {
    const x = Math.floor(rng() * BOARD_W);
    const y = 3 + Math.floor(rng() * (BOARD_H - 6));
    const i = idx(x, y);
    if (board[i].terrain === 'shallow') {
      board[i] = tile('lotus');
      lotus++;
    }
  }
  return board;
}

/* ------------------------------------------------------------------------ */
/* Initial state                                                              */
/* ------------------------------------------------------------------------ */

export function createGame(
  seed: number,
  factions: [FactionId, FactionId],
  cfg: PhaseConfig = { phase1Ticks: PHASE1_TICKS, phase2Ticks: PHASE2_TICKS },
): GameState {
  const rng = makeRng(seed);
  const makePlayer = (faction: FactionId) => {
    const deck = buildDeck(faction);
    // Deterministic shuffle.
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return {
      faction,
      aqua: 5,
      hand: deck.slice(0, HAND_SIZE),
      queue: deck.slice(HAND_SIZE),
      ultUsed: false,
      damageDealt: 0,
      territoryScore: 0,
      blessed: false,
    };
  };
  return {
    seed,
    cfg,
    tick: 0,
    phase: 'basalt',
    phaseTicksLeft: cfg.phase1Ticks,
    board: generateBasaltMap(seed),
    units: [],
    zones: [],
    pendingLava: [],
    players: [makePlayer(factions[0]), makePlayer(factions[1])],
    captureMeter: 0,
    winner: null,
    dominanceP0: 0.5,
  };
}

/* ------------------------------------------------------------------------ */
/* Small helpers                                                              */
/* ------------------------------------------------------------------------ */

let nextUnitId = 1;
let nextZoneId = 1;
export function resetIds(): void {
  nextUnitId = 1;
  nextZoneId = 1;
}

const cheb = (ax: number, ay: number, bx: number, by: number) =>
  Math.max(Math.abs(ax - bx), Math.abs(ay - by));

function unitAt(st: GameState, x: number, y: number, flying: boolean): UnitState | undefined {
  return st.units.find(
    (u) => u.hp > 0 && u.x === x && u.y === y && speciesDef(u.species).stats!.flying === flying,
  );
}

interface RuntimeUnit extends UnitState {
  flying: boolean;
  stats: UnitStats;
}

function rt(u: UnitState): RuntimeUnit {
  const stats = speciesDef(u.species).stats!;
  return Object.assign(u, { flying: stats.flying, stats });
}

function walkable(st: GameState, x: number, y: number, u: RuntimeUnit): boolean {
  if (!inBounds(x, y)) return false;
  const t = st.board[idx(x, y)];
  if (u.stats.flying) return true;
  if (t.terrain === 'magma') return false;
  if (t.terrain === 'deep' && !t.destroyed) {
    // Deep water passable only via lily pads (handled as separate terrain) —
    // ground units may still wade it, at heavy cost, to contest the pond.
    return true;
  }
  if (t.terrain === 'lily' && t.destroyed) return false; // sunk pad = open deep water hole
  return true;
}

function occupied(st: GameState, x: number, y: number, u: RuntimeUnit): boolean {
  return st.units.some((o) => o.hp > 0 && o.id !== u.id && o.x === x && o.y === y &&
    speciesDef(o.species).stats!.flying === u.stats.flying);
}

function effSpeed(st: GameState, u: RuntimeUnit): number {
  let s = u.stats.speed;
  if (u.buffs.blessed) s *= BLESSING_MULT;
  if (u.buffs.slowTicks > 0 && !(u.buffs.berserk)) s *= u.buffs.slowMult;
  const t = st.board[idx(u.x, u.y)];
  if (!u.stats.flying && u.stats.heavy && (t.terrain === 'shallow' || t.terrain === 'deep')) s *= 0.6;
  return s;
}

function effDmg(u: RuntimeUnit, st: GameState): number {
  let d = u.stats.dmg;
  if (u.buffs.blessed) d *= BLESSING_MULT;
  if (u.species === 'wolves') {
    const buddy = st.units.some((o) =>
      o.hp > 0 && o.id !== u.id && o.owner === u.owner && o.species === 'wolves' &&
      cheb(o.x, o.y, u.x, u.y) === 1);
    if (buddy) d *= 1 + MECHANICS.wolvesAdjacencyBonus;
  }
  return Math.round(d);
}

function isStealthTile(st: GameState, x: number, y: number): boolean {
  const t = st.board[idx(x, y)];
  if (t.terrain === 'reeds' && !t.destroyed) return true;
  return st.zones.some((z) => z.kind === 'thicket' && cheb(z.x, z.y, x, y) <= z.r);
}

/* ------------------------------------------------------------------------ */
/* Damage pipeline                                                            */
/* ------------------------------------------------------------------------ */

function dealDamage(
  st: GameState, ev: GameEvent[],
  attacker: RuntimeUnit | null, victim: UnitState, amount: number,
  kind: 'melee' | 'ranged' | 'burn' | 'vent' | 'lava' | 'reflect' | 'stomp',
): void {
  if (victim.hp <= 0 || amount <= 0) return;
  const vStats = speciesDef(victim.species).stats!;
  victim.hp -= amount;
  if (attacker) st.players[attacker.owner].damageDealt += amount;
  ev.push({ type: 'hit', unitId: victim.id, x: victim.x, y: victim.y, amount, kind });

  // Porcupine quill reflection — melee only, no infinite ping-pong.
  if (kind === 'melee' && attacker && vStats.reflectPct > 0 && attacker.hp > 0) {
    const back = Math.round(amount * vStats.reflectPct);
    if (back > 0) {
      attacker.hp -= back;
      ev.push({ type: 'hit', unitId: attacker.id, x: attacker.x, y: attacker.y, amount: back, kind: 'reflect' });
      if (attacker.hp <= 0) {
        ev.push({ type: 'death', unitId: attacker.id, species: attacker.species, owner: attacker.owner, x: attacker.x, y: attacker.y });
      }
    }
  }
  // Attacking from stealth reveals you.
  if (attacker && (kind === 'melee' || kind === 'ranged')) attacker.stealthed = false;
  // Getting hit reveals the victim too.
  victim.stealthed = false;

  if (victim.hp <= 0) {
    ev.push({ type: 'death', unitId: victim.id, species: victim.species, owner: victim.owner, x: victim.x, y: victim.y });
  }
}

/* ------------------------------------------------------------------------ */
/* Spawning                                                                   */
/* ------------------------------------------------------------------------ */

function freshBuffs() {
  return { stun: 0, slowTicks: 0, slowMult: 1, burnStacks: 0, burnTicks: 0, rangeCapTicks: 0, blessed: false, berserk: false };
}

export function armySize(st: GameState, owner: PlayerId): number {
  return st.units.reduce((n, u) => n + (u.hp > 0 && u.owner === owner ? 1 : 0), 0);
}

function spawnUnit(
  st: GameState, ev: GameEvent[], owner: PlayerId, species: UnitState['species'],
  x: number, y: number, waypoint: GridPos | null,
): UnitState | null {
  if (!inBounds(x, y)) return null;
  if (armySize(st, owner) >= MAX_ARMY) return null;
  const stats = speciesDef(species).stats!;
  if (!stats.flying && st.board[idx(x, y)].terrain === 'magma') return null;
  if (unitAt(st, x, y, stats.flying)) return null;
  const u: UnitState = {
    id: nextUnitId++,
    owner, species,
    x, y, px: x, py: y,
    hp: stats.hp, maxHp: stats.hp,
    facing: owner === 0 ? -1 : 1,
    // Personal cadence offset: units never step in unison with each other.
    moveBank: ((nextUnitId * 0.37) % 1) * 0.9,
    atkTimer: 3, // brief deploy wind-up (~0.9 s)
    traveled: 0,
    struckTargets: [],
    waypoint,
    buffs: freshBuffs(),
    stealthed: false,
    action: 'spawn',
    targetId: null,
  };
  if (st.players[owner].blessed) u.buffs.blessed = true;
  st.units.push(u);
  ev.push({ type: 'spawn', unitId: u.id, species, owner, x, y });
  return u;
}

/** Lion roar: freeze adjacent enemies for 1 tick on deployment. */
function lionRoar(st: GameState, ev: GameEvent[], lion: UnitState): void {
  ev.push({ type: 'roar', species: 'lion', x: lion.x, y: lion.y });
  for (const o of st.units) {
    if (o.hp <= 0 || o.owner === lion.owner) continue;
    if (cheb(o.x, o.y, lion.x, lion.y) === 1) {
      const os = speciesDef(o.species).stats!;
      const berserk = o.species === 'honeybadger' && o.hp / os.hp < MECHANICS.badgerThreshold;
      if (!berserk) o.buffs.stun = Math.max(o.buffs.stun, MECHANICS.lionFreezeTicks);
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Input application (start of tick)                                          */
/* ------------------------------------------------------------------------ */

function applyInput(st: GameState, ev: GameEvent[], input: PlayerInput): void {
  const p = st.players[input.player];
  const a = input.action;

  if (a.type === 'ult') {
    if (p.ultUsed) return;
    if (!inBounds(a.x, a.y)) return;
    p.ultUsed = true;
    st.pendingLava.push({ owner: input.player, x: a.x, y: a.y, resolveTick: st.tick + LAVA_RAIN.telegraphTicks });
    ev.push({ type: 'lavaTelegraph', x: a.x, y: a.y });
    ev.push({ type: 'spellCast', spell: 'lavarain', owner: input.player, x: a.x, y: a.y });
    return;
  }

  // Card actions: must be in hand and affordable.
  const handIdx = p.hand.indexOf(a.card);
  if (handIdx === -1) return;
  const def = cardDef(a.card, st.phase);
  if (p.aqua < def.cost) return;

  if (a.type === 'spell' && def.kind === 'spell') {
    if (!inBounds(a.x, a.y)) return;
    p.aqua -= def.cost;
    cycleCard(p, handIdx);
    const spell = def.name === 'Thicket' ? 'thicket' : 'sulfur';
    const bal = SPELL_BALANCE[spell];
    st.zones.push({
      id: nextZoneId++, kind: spell, owner: input.player,
      x: a.x, y: a.y, r: bal.radius, ticksLeft: bal.duration,
    });
    ev.push({ type: 'spellCast', spell, owner: input.player, x: a.x, y: a.y });
    return;
  }

  if (a.type === 'deploy' && def.kind === 'unit' && def.species) {
    // Vector spawning: baseline touch tile must be in the deploy zone…
    if (!inBounds(a.x, a.y) || !DEPLOY_ROWS[input.player].includes(a.y)) return;
    // …and the army cap keeps the battlefield a set of readable duels.
    if (armySize(st, input.player) >= MAX_ARMY) return;
    const stats = def.stats!;
    if (!stats.flying && st.board[idx(a.x, a.y)].terrain === 'magma') return;
    p.aqua -= def.cost;
    cycleCard(p, handIdx);

    // …and the drag vector defines the fling trajectory: the unit receives a
    // waypoint several tiles down-range and marches that entry lane before
    // its free AI takes over.
    const len = Math.hypot(a.dirX, a.dirY) || 1;
    const nx = a.dirX / len;
    const ny = a.dirY / len;
    const reach = 4;
    const wp: GridPos = {
      x: Math.max(0, Math.min(BOARD_W - 1, Math.round(a.x + nx * reach))),
      y: Math.max(0, Math.min(BOARD_H - 1, Math.round(a.y + ny * reach))),
    };

    const spawned: UnitState[] = [];
    if (stats.formation === 'line' && stats.count > 1) {
      for (let i = 0; i < stats.count; i++) {
        const off = i - Math.floor(stats.count / 2);
        const u = spawnUnit(st, ev, input.player, def.species, a.x + off, a.y, wp);
        if (u) spawned.push(u);
      }
    } else if (stats.formation === 'pair' && stats.count === 2) {
      const u1 = spawnUnit(st, ev, input.player, def.species, a.x, a.y, wp);
      const u2 = spawnUnit(st, ev, input.player, def.species, a.x + 1, a.y, wp) ??
        spawnUnit(st, ev, input.player, def.species, a.x - 1, a.y, wp);
      if (u1) spawned.push(u1);
      if (u2) spawned.push(u2);
    } else {
      const u = spawnUnit(st, ev, input.player, def.species, a.x, a.y, wp);
      if (u) spawned.push(u);
    }
    for (const u of spawned) if (u.species === 'lion') lionRoar(st, ev, u);
  }
}

function cycleCard(p: GameState['players'][0], handIdx: number): void {
  const played = p.hand[handIdx];
  const next = p.queue.shift();
  if (next !== undefined) {
    p.hand[handIdx] = next;
    p.queue.push(played);
  }
}

/* ------------------------------------------------------------------------ */
/* Pathfinding — greedy step with BFS fallback around magma/holes             */
/* ------------------------------------------------------------------------ */

const DIRS8: ReadonlyArray<GridPos> = [
  { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
  { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
];

const KNIGHT_MOVES: ReadonlyArray<GridPos> = [
  { x: 1, y: -2 }, { x: 2, y: -1 }, { x: 2, y: 1 }, { x: 1, y: 2 },
  { x: -1, y: 2 }, { x: -2, y: 1 }, { x: -2, y: -1 }, { x: -1, y: -2 },
];

/**
 * One BFS step toward the goal, avoiding blocked terrain and bodies.
 * Neighbours are expanded nearest-to-goal first so equal-length paths always
 * break ties toward the target — crucially this is symmetric for both seats
 * (a fixed direction order would give one side a permanent pathing edge).
 */
function bfsStep(st: GameState, u: RuntimeUnit, gx: number, gy: number): GridPos | null {
  if (u.x === gx && u.y === gy) return null;
  const visited = new Uint8Array(BOARD_W * BOARD_H);
  const queue: Array<{ x: number; y: number; first: GridPos | null }> = [
    { x: u.x, y: u.y, first: null },
  ];
  visited[idx(u.x, u.y)] = 1;
  let head = 0;
  while (head < queue.length && head < 220) {
    const cur = queue[head++];
    const dirs = [...DIRS8].sort((a, b) => {
      const da = Math.max(Math.abs(cur.x + a.x - gx), Math.abs(cur.y + a.y - gy)) * 4 +
        Math.abs(cur.x + a.x - gx) + Math.abs(cur.y + a.y - gy);
      const db = Math.max(Math.abs(cur.x + b.x - gx), Math.abs(cur.y + b.y - gy)) * 4 +
        Math.abs(cur.x + b.x - gx) + Math.abs(cur.y + b.y - gy);
      return da - db;
    });
    for (const d of dirs) {
      const nx = cur.x + d.x;
      const ny = cur.y + d.y;
      if (!inBounds(nx, ny) || visited[idx(nx, ny)]) continue;
      if (!walkable(st, nx, ny, u)) continue;
      const first = cur.first ?? { x: nx, y: ny };
      if (nx === gx && ny === gy) return first;
      // Bodies block pathing except at the goal tile itself.
      if (occupied(st, nx, ny, u)) continue;
      visited[idx(nx, ny)] = 1;
      queue.push({ x: nx, y: ny, first });
    }
  }
  return null;
}

/** Bighorn: knight-move pathing toward the goal. */
function knightStep(st: GameState, u: RuntimeUnit, gx: number, gy: number): GridPos | null {
  let best: GridPos | null = null;
  let bestD = cheb(u.x, u.y, gx, gy) + Math.abs(u.x - gx) + Math.abs(u.y - gy);
  for (const m of KNIGHT_MOVES) {
    const nx = u.x + m.x;
    const ny = u.y + m.y;
    if (!inBounds(nx, ny) || !walkable(st, nx, ny, u) || occupied(st, nx, ny, u)) continue;
    const d = cheb(nx, ny, gx, gy) + Math.abs(nx - gx) + Math.abs(ny - gy);
    if (d < bestD) {
      bestD = d;
      best = { x: nx, y: ny };
    }
  }
  return best;
}

/* ------------------------------------------------------------------------ */
/* Targeting                                                                  */
/* ------------------------------------------------------------------------ */

function visibleEnemies(st: GameState, u: RuntimeUnit): UnitState[] {
  return st.units.filter((o) => {
    if (o.hp <= 0 || o.owner === u.owner) return false;
    // Stealthed units are untargetable unless adjacent.
    if (o.stealthed && cheb(o.x, o.y, u.x, u.y) > 1) return false;
    return true;
  });
}

function pickTarget(st: GameState, u: RuntimeUnit): UnitState | null {
  const enemies = visibleEnemies(st, u);
  if (enemies.length === 0) return null;
  // Engagement stickiness: once locked in a duel, see it through. This is
  // what turns the battlefield into distinct one-on-one fights instead of a
  // mob that constantly re-shuffles targets.
  if (u.targetId !== null) {
    const cur = enemies.find((e) => e.id === u.targetId);
    if (cur && cheb(u.x, u.y, cur.x, cur.y) <= Math.max(2, u.stats.range + 1)) {
      return cur;
    }
  }
  // Eagle: hunts the lowest-HP unit on the board first.
  if (u.species === 'eagle') {
    return enemies.reduce((a, b) => (b.hp < a.hp ? b : a));
  }
  // Everyone else: nearest enemy; ties break toward lower id (deterministic).
  let best: UnitState | null = null;
  let bestD = Infinity;
  for (const e of enemies) {
    const eFly = speciesDef(e.species).stats!.flying;
    if (eFly && !u.stats.canHitAir && !u.stats.flying) continue; // cannot ever engage
    const d = cheb(u.x, u.y, e.x, e.y) * 10 + (e.id % 10) * 0.01;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best ?? enemies.reduce((a, b) => (cheb(u.x, u.y, b.x, b.y) < cheb(u.x, u.y, a.x, a.y) ? b : a));
}

function canAttack(u: RuntimeUnit, target: UnitState): boolean {
  const tStats = speciesDef(target.species).stats!;
  if (tStats.flying && !u.stats.canHitAir && !u.stats.flying) return false;
  const dx = Math.abs(u.x - target.x);
  const dy = Math.abs(u.y - target.y);
  let range = u.stats.range;
  if (u.buffs.rangeCapTicks > 0) range = 1;
  switch (u.stats.geometry) {
    case 'orth': return dx + dy === 1;
    case 'diag': return dx === 1 && dy === 1;
    case 'any': return Math.max(dx, dy) <= range;
    case 'line': return (dx === 0 || dy === 0) && dx + dy >= 1 && dx + dy <= range;
  }
}

/** Where should u stand to attack the target, honouring its geometry? */
function attackSlots(u: RuntimeUnit, t: UnitState): GridPos[] {
  const out: GridPos[] = [];
  if (u.stats.geometry === 'diag') {
    for (const d of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      out.push({ x: t.x + d[0], y: t.y + d[1] });
    }
  } else if (u.stats.geometry === 'line') {
    for (let r = 1; r <= u.stats.range; r++) {
      out.push({ x: t.x + r, y: t.y }, { x: t.x - r, y: t.y }, { x: t.x, y: t.y + r }, { x: t.x, y: t.y - r });
    }
  } else if (u.stats.geometry === 'any' && u.stats.range > 1) {
    for (let dy = -u.stats.range; dy <= u.stats.range; dy++) {
      for (let dx = -u.stats.range; dx <= u.stats.range; dx++) {
        if (dx === 0 && dy === 0) continue;
        out.push({ x: t.x + dx, y: t.y + dy });
      }
    }
  } else {
    for (const d of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      out.push({ x: t.x + d[0], y: t.y + d[1] });
    }
  }
  return out.filter((p) => inBounds(p.x, p.y));
}

/* ------------------------------------------------------------------------ */
/* Combat resolution                                                          */
/* ------------------------------------------------------------------------ */

function performAttack(st: GameState, ev: GameEvent[], u: RuntimeUnit, target: UnitState): void {
  let dmg = effDmg(u, st);
  let crit = false;

  // Bighorn charge: 3x + knockback if it travelled 3+ tiles uninterrupted.
  if (u.species === 'bighorn' && u.traveled >= MECHANICS.bighornChargeTiles && !u.struckTargets.includes(target.id)) {
    dmg *= MECHANICS.bighornChargeMult;
    crit = true;
    ev.push({ type: 'charge', unitId: u.id, x: u.x, y: u.y });
    const tStats = speciesDef(target.species).stats!;
    if (!tStats.colossal) {
      const kx = Math.sign(target.x - u.x);
      const ky = Math.sign(target.y - u.y);
      const nx = target.x + kx;
      const ny = target.y + ky;
      const tRt = rt(target);
      if (inBounds(nx, ny) && walkable(st, nx, ny, tRt) && !occupied(st, nx, ny, tRt)) {
        target.px = target.x; target.py = target.y;
        target.x = nx; target.y = ny;
      }
    }
  }

  // Scorpion: first strike on each target stuns 1 tick.
  if (u.species === 'scorpion' && !u.struckTargets.includes(target.id)) {
    const ts = speciesDef(target.species).stats!;
    const berserk = target.species === 'honeybadger' && target.hp / ts.hp < MECHANICS.badgerThreshold;
    if (!berserk) target.buffs.stun = Math.max(target.buffs.stun, MECHANICS.scorpionStunTicks);
  }

  if (!u.struckTargets.includes(target.id)) {
    u.struckTargets.push(target.id);
    if (u.struckTargets.length > 12) u.struckTargets.shift();
  }
  u.traveled = 0;
  u.targetId = target.id;
  u.action = 'attack';
  u.facing = target.x >= u.x ? 1 : -1;

  const ranged = u.stats.geometry === 'line' || u.stats.range > 1;
  ev.push({ type: 'attack', unitId: u.id, species: u.species, owner: u.owner, x: u.x, y: u.y, tx: target.x, ty: target.y, crit });

  // Bear sweep: target tile + the two tiles flanking it (perpendicular).
  if (u.species === 'bear') {
    const axisX = Math.abs(target.x - u.x) >= Math.abs(target.y - u.y);
    const side1 = axisX ? { x: target.x, y: target.y - 1 } : { x: target.x - 1, y: target.y };
    const side2 = axisX ? { x: target.x, y: target.y + 1 } : { x: target.x + 1, y: target.y };
    for (const p of [side1, side2]) {
      if (!inBounds(p.x, p.y)) continue;
      for (const fly of [false, true]) {
        const v = unitAt(st, p.x, p.y, fly);
        if (v && v.owner !== u.owner) dealDamage(st, ev, u, v, Math.round(dmg * 0.6), 'melee');
      }
    }
  }

  dealDamage(st, ev, u, target, dmg, ranged ? 'ranged' : 'melee');

  // Fire ants: stack burning acid.
  if (u.species === 'fireants' && target.hp > 0) {
    target.buffs.burnStacks = Math.min(MECHANICS.acidMaxStacks, target.buffs.burnStacks + 1);
    target.buffs.burnTicks = MECHANICS.acidBurnTicks;
  }
  // Bees: smother the victim's range.
  if (u.species === 'bees' && target.hp > 0) {
    target.buffs.rangeCapTicks = MECHANICS.beesRangeCapTicks;
  }
  // Beetles: splash pool at impact slows ground tiles.
  if (u.species === 'beetles') {
    st.zones.push({
      id: nextZoneId++, kind: 'acidpool', owner: u.owner,
      x: target.x, y: target.y, r: SPELL_BALANCE.acidpool.radius,
      ticksLeft: SPELL_BALANCE.acidpool.duration,
    });
  }

  // Attack cadence — honey badger frenzy doubles attack speed.
  let cd = u.stats.atkCd;
  if (u.buffs.berserk) cd = Math.max(1, Math.round(cd / 2));
  u.atkTimer = cd;
}

/** T-Rex stomp: chips all enemy ground units within 2 tiles as it moves. */
function trexStomp(st: GameState, ev: GameEvent[], u: RuntimeUnit): void {
  ev.push({ type: 'stomp', x: u.x, y: u.y });
  for (const o of st.units) {
    if (o.hp <= 0 || o.owner === u.owner) continue;
    if (speciesDef(o.species).stats!.flying) continue;
    if (cheb(o.x, o.y, u.x, u.y) <= MECHANICS.trexStompRadius) {
      dealDamage(st, ev, u, o, MECHANICS.trexStompDmg, 'stomp');
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Terrain & zone effects                                                     */
/* ------------------------------------------------------------------------ */

function applyTileEffects(st: GameState, ev: GameEvent[], u: RuntimeUnit): void {
  const t = st.board[idx(u.x, u.y)];

  if (!u.stats.flying) {
    // Sulfur vents punish campers (only damages units that did not move).
    if (t.terrain === 'vent' && u.action !== 'move') {
      dealDamage(st, ev, null, u, VENT_DMG, 'vent');
    }
    // Colossal units collapse lily pads.
    if (t.terrain === 'lily' && !t.destroyed && u.stats.colossal) {
      t.destroyed = true;
      ev.push({ type: 'lilySink', x: u.x, y: u.y });
      dealDamage(st, ev, null, u, Math.round(u.maxHp * 0.08), 'vent');
    }
    // Lotus blooms pop when trampled: 15% AOE healing mist.
    if (t.terrain === 'lotus' && !t.destroyed) {
      t.destroyed = true;
      ev.push({ type: 'lotusBurst', x: u.x, y: u.y });
      st.zones.push({
        id: nextZoneId++, kind: 'healmist', owner: u.owner,
        x: u.x, y: u.y, r: SPELL_BALANCE.healmist.radius, ticksLeft: SPELL_BALANCE.healmist.duration,
      });
    }
  }

  // Stealth from reeds / thicket.
  u.stealthed = isStealthTile(st, u.x, u.y) &&
    !st.zones.some((z) => z.kind === 'thicket' && z.owner !== u.owner && cheb(z.x, z.y, u.x, u.y) <= z.r);
}

function applyZoneEffects(st: GameState, ev: GameEvent[]): void {
  for (const z of st.zones) {
    for (const u of st.units) {
      if (u.hp <= 0) continue;
      if (cheb(u.x, u.y, z.x, z.y) > z.r) continue;
      switch (z.kind) {
        case 'sulfur':
          if (u.owner !== z.owner) {
            u.buffs.slowTicks = Math.max(u.buffs.slowTicks, 1);
            u.buffs.slowMult = Math.min(u.buffs.slowMult === 1 ? 1 : u.buffs.slowMult, SPELL_BALANCE.sulfur.slowMult);
            if (u.buffs.slowTicks === 1) u.buffs.slowMult = SPELL_BALANCE.sulfur.slowMult;
            dealDamage(st, ev, null, u, SPELL_BALANCE.sulfur.chip, 'burn');
          }
          break;
        case 'thicket':
          if (u.owner !== z.owner) {
            u.buffs.slowTicks = Math.max(u.buffs.slowTicks, 1);
            u.buffs.slowMult = SPELL_BALANCE.thicket.slowMult;
          }
          break;
        case 'acidpool':
          if (u.owner !== z.owner && !speciesDef(u.species).stats!.flying) {
            u.buffs.slowTicks = Math.max(u.buffs.slowTicks, 1);
            u.buffs.slowMult = SPELL_BALANCE.acidpool.slowMult;
          }
          break;
        case 'healmist': {
          const heal = Math.round(u.maxHp * LOTUS_HEAL_PCT);
          if (u.hp < u.maxHp) {
            u.hp = Math.min(u.maxHp, u.hp + heal);
            ev.push({ type: 'heal', x: u.x, y: u.y, amount: heal });
          }
          break;
        }
      }
    }
    z.ticksLeft--;
  }
  st.zones = st.zones.filter((z) => z.ticksLeft > 0);
}

function resolveLavaRain(st: GameState, ev: GameEvent[]): void {
  const due = st.pendingLava.filter((l) => l.resolveTick <= st.tick);
  st.pendingLava = st.pendingLava.filter((l) => l.resolveTick > st.tick);
  for (const strike of due) {
    ev.push({ type: 'lavaStrike', x: strike.x, y: strike.y });
    for (const u of st.units) {
      if (u.hp <= 0 || u.owner === strike.owner) continue; // enemies only
      const d = cheb(u.x, u.y, strike.x, strike.y);
      const flying = speciesDef(u.species).stats!.flying;
      let dmg = 0;
      if (d === 0) dmg = flying ? Math.round(LAVA_RAIN.centerDmg * LAVA_RAIN.flyerCenterMult) : LAVA_RAIN.centerDmg;
      else if (d === 1) dmg = LAVA_RAIN.midDmg;
      else if (d === 2) dmg = LAVA_RAIN.rimDmg;
      if (dmg > 0) dealDamage(st, ev, null, u, dmg, 'lava');
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Per-unit AI tick                                                           */
/* ------------------------------------------------------------------------ */

function tickUnit(st: GameState, ev: GameEvent[], raw: UnitState): void {
  const u = rt(raw);
  u.px = u.x;
  u.py = u.y;
  u.action = 'idle';

  // Debuff bookkeeping.
  const berserk = u.species === 'honeybadger' && u.hp / u.maxHp < MECHANICS.badgerThreshold;
  u.buffs.berserk = berserk;
  if (berserk) u.buffs.stun = 0; // CC immunity while enraged
  if (u.buffs.stun > 0) {
    u.buffs.stun--;
    return;
  }
  if (u.buffs.burnTicks > 0) {
    dealDamage(st, ev, null, u, ACID_DMG * u.buffs.burnStacks, 'burn');
    u.buffs.burnTicks--;
    if (u.buffs.burnTicks === 0) u.buffs.burnStacks = 0;
    if (u.hp <= 0) return;
  }
  if (u.buffs.rangeCapTicks > 0) u.buffs.rangeCapTicks--;
  if (u.buffs.slowTicks > 0) u.buffs.slowTicks--;
  else u.buffs.slowMult = 1;
  if (u.atkTimer > 0) u.atkTimer--;

  // 1. Attack if a target is in reach.
  const target = pickTarget(st, u);
  u.targetId = target?.id ?? null;
  if (target && canAttack(u, target) && u.atkTimer <= 0) {
    performAttack(st, ev, u, target);
    return;
  }

  // 2. Otherwise move.
  u.moveBank += effSpeed(st, u);
  if (u.moveBank < 1) return;
  u.moveBank -= 1;

  let goal: GridPos | null = null;
  if (target) {
    const slots = attackSlots(u, target)
      .filter((p) => walkable(st, p.x, p.y, u) && !occupied(st, p.x, p.y, u))
      .sort((a, b) => cheb(u.x, u.y, a.x, a.y) - cheb(u.x, u.y, b.x, b.y));
    goal = slots[0] ?? { x: target.x, y: target.y };
  } else if (u.waypoint && (u.x !== u.waypoint.x || u.y !== u.waypoint.y)) {
    goal = u.waypoint;
  } else {
    u.waypoint = null;
    // Advance toward enemy territory to score dominance.
    goal = { x: u.x, y: u.owner === 0 ? 1 : BOARD_H - 2 };
    // In the Oasis, converge on the pond instead.
    if (st.phase === 'oasis') goal = { x: Math.floor(BOARD_W / 2), y: Math.floor(BOARD_H / 2) };
  }

  const step = u.species === 'bighorn'
    ? (knightStep(st, u, goal.x, goal.y) ?? bfsStep(st, u, goal.x, goal.y))
    : bfsStep(st, u, goal.x, goal.y);

  if (step && !occupied(st, step.x, step.y, u)) {
    const dist = cheb(u.x, u.y, step.x, step.y);
    u.facing = step.x > u.x ? 1 : step.x < u.x ? -1 : u.facing;
    u.x = step.x;
    u.y = step.y;
    u.traveled += Math.max(1, dist);
    u.action = 'move';
    if (u.waypoint && u.x === u.waypoint.x && u.y === u.waypoint.y) u.waypoint = null;
    if (u.species === 'trex') trexStomp(st, ev, u);
  } else {
    u.traveled = 0;
  }
}

/* ------------------------------------------------------------------------ */
/* Phase orchestration                                                        */
/* ------------------------------------------------------------------------ */

function scoreTerritory(st: GameState): void {
  for (const u of st.units) {
    if (u.hp <= 0) continue;
    // Progress into enemy half scores territory points.
    const depth = u.owner === 0
      ? Math.max(0, Math.floor(BOARD_H / 2) - u.y)
      : Math.max(0, u.y - Math.floor(BOARD_H / 2));
    st.players[u.owner].territoryScore += depth;
  }
}

function computeDominance(st: GameState): number {
  const p0 = st.players[0];
  const p1 = st.players[1];
  const terrTotal = p0.territoryScore + p1.territoryScore;
  const dmgTotal = p0.damageDealt + p1.damageDealt;
  const terr = terrTotal > 0 ? p0.territoryScore / terrTotal : 0.5;
  const dmg = dmgTotal > 0 ? p0.damageDealt / dmgTotal : 0.5;
  return terr * 0.5 + dmg * 0.5; // Territory 50% + Damage 50%
}

function beginTransition(st: GameState, ev: GameEvent[]): void {
  st.phase = 'transition';
  st.phaseTicksLeft = TRANSITION_TICKS;
  st.dominanceP0 = computeDominance(st);
  const blessedPlayer: PlayerId | null =
    st.dominanceP0 > 0.5 ? 0 : st.dominanceP0 < 0.5 ? 1 : null;
  if (blessedPlayer !== null) {
    st.players[blessedPlayer].blessed = true;
    ev.push({ type: 'blessing', player: blessedPlayer });
  }
  ev.push({ type: 'phaseChange', phase: 'transition' });
}

function beginOasis(st: GameState, ev: GameEvent[]): void {
  st.phase = 'oasis';
  st.phaseTicksLeft = st.cfg.phase2Ticks;
  st.board = generateOasisMap(st.seed);
  st.zones = [];
  st.pendingLava = [];

  // Survivors march off Vaalbara and redeploy into the Oasis, HP intact.
  const survivors = st.units.filter((u) => u.hp > 0);
  st.units = [];
  for (const u of survivors) {
    const rows = DEPLOY_ROWS[u.owner];
    const baseRow = rows[Math.floor(rows.length / 2)];
    let placed = false;
    for (let ring = 0; ring < BOARD_W && !placed; ring++) {
      for (const dx of [0, ring, -ring]) {
        const nx = Math.max(0, Math.min(BOARD_W - 1, u.x + dx));
        for (const dy of [0, 1, -1, 2, -2]) {
          const ny = Math.max(0, Math.min(BOARD_H - 1, baseRow + dy));
          if (!st.units.some((o) => o.x === nx && o.y === ny &&
            speciesDef(o.species).stats!.flying === speciesDef(u.species).stats!.flying)) {
            u.x = nx; u.y = ny; u.px = nx; u.py = ny;
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
    }
    u.waypoint = { x: Math.floor(BOARD_W / 2), y: Math.floor(BOARD_H / 2) };
    u.buffs = freshBuffs();
    if (st.players[u.owner].blessed) u.buffs.blessed = true;
    u.action = 'spawn';
    st.units.push(u);
    ev.push({ type: 'spawn', unitId: u.id, species: u.species, owner: u.owner, x: u.x, y: u.y });
  }
  ev.push({ type: 'phaseChange', phase: 'oasis' });
}

function tickCapture(st: GameState): void {
  let p0 = 0;
  let p1 = 0;
  for (const u of st.units) {
    if (u.hp <= 0) continue;
    const t = st.board[idx(u.x, u.y)].terrain;
    const inPond = t === 'shallow' || t === 'deep' || t === 'lily' || t === 'lotus';
    if (!inPond) continue;
    const weight = t === 'deep' ? 2 : 1;
    if (u.owner === 0) p0 += weight;
    else p1 += weight;
  }
  if (p0 > p1) st.captureMeter = Math.min(100, st.captureMeter + CAPTURE_RATE);
  else if (p1 > p0) st.captureMeter = Math.max(-100, st.captureMeter - CAPTURE_RATE);
  // Perfect tie of presence locks the meter (no change).
}

function endGame(st: GameState, ev: GameEvent[]): void {
  st.phase = 'ended';
  if (st.captureMeter > 0) st.winner = 0;
  else if (st.captureMeter < 0) st.winner = 1;
  else st.winner = 'tie'; // 50/50 meter at the buzzer = official match Tie
  ev.push({ type: 'gameOver', winner: st.winner });
}

/* ------------------------------------------------------------------------ */
/* THE TICK — the single entry point that advances the world by 1.2 s         */
/* ------------------------------------------------------------------------ */

export function advanceTick(st: GameState, inputs: PlayerInput[]): TickResult {
  const ev: GameEvent[] = [];
  if (st.phase === 'ended') return { state: st, events: ev };

  st.tick++;

  // 1. Economy.
  const income = st.phase === 'oasis' ? AQUA_PER_TICK_P2 : AQUA_PER_TICK_P1;
  if (st.phase !== 'transition') {
    for (const p of st.players) p.aqua = Math.min(AQUA_MAX, p.aqua + income);
  }

  // 2. Apply queued inputs, deterministically ordered. Priority alternates
  //    by tick parity so neither seat owns a permanent first-mover edge.
  const first = st.tick % 2;
  const sorted = [...inputs].sort(
    (a, b) => (a.player === first ? -1 : 1) - (b.player === first ? -1 : 1) || a.seq - b.seq,
  );
  if (st.phase === 'basalt' || st.phase === 'oasis') {
    for (const input of sorted) applyInput(st, ev, input);
  }

  // 3. Lava rain resolution (telegraph expires).
  resolveLavaRain(st, ev);

  // 4. Units act in deterministic order; owner priority flips each tick so
  //    combat trades stay symmetric between the seats.
  if (st.phase === 'basalt' || st.phase === 'oasis') {
    const order = [...st.units].sort(
      (a, b) => (a.owner === first ? -1 : 1) - (b.owner === first ? -1 : 1) || a.id - b.id,
    );
    for (const u of order) {
      if (u.hp > 0) tickUnit(st, ev, u);
    }
    // 5. Terrain / zone effects.
    for (const u of st.units) if (u.hp > 0) applyTileEffects(st, ev, rt(u));
    applyZoneEffects(st, ev);
  }

  // 6. Cull the dead.
  st.units = st.units.filter((u) => u.hp > 0);

  // 7. Phase scoring & clock.
  if (st.phase === 'basalt') scoreTerritory(st);
  if (st.phase === 'oasis') tickCapture(st);

  st.phaseTicksLeft--;
  if (st.phaseTicksLeft <= 0) {
    if (st.phase === 'basalt') beginTransition(st, ev);
    else if (st.phase === 'transition') beginOasis(st, ev);
    else if (st.phase === 'oasis') endGame(st, ev);
  }

  return { state: st, events: ev };
}

/* ============================================================================
 * TickDriver — real-time pacing, async input queueing, and catch-up.
 *
 * The driver is transport-agnostic: local play, a scripted AI, and the
 * Firebase relay all speak the same PlayerInput language. On network desync
 * (a remote input arrives stamped for a past tick) the driver rewinds to its
 * last snapshot and fast-forwards deterministically; the renderer smooths the
 * correction with visual catch-up interpolation.
 * ========================================================================== */

export interface DriverCallbacks {
  onTick: (result: TickResult) => void;
  /** Broadcast local inputs to the transport layer (no-op offline). */
  sendInput?: (input: PlayerInput) => void;
}

export class TickDriver {
  state: GameState;
  private inputQueue = new Map<number, PlayerInput[]>();
  private history: Array<{ tick: number; snapshot: string }> = [];
  private appliedInputs: PlayerInput[] = [];
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cb: DriverCallbacks;
  private accumulatedEvents: GameEvent[] = [];

  constructor(seed: number, factions: [FactionId, FactionId], cb: DriverCallbacks, cfg?: PhaseConfig) {
    resetIds();
    this.state = createGame(seed, factions, cfg);
    this.cb = cb;
  }

  /** Queue a local player action; executes at the NEXT tick. */
  submit(player: PlayerId, action: PlayerInput['action']): PlayerInput {
    const input: PlayerInput = {
      seq: ++this.seq,
      player,
      tick: this.state.tick + 1,
      action,
    };
    this.enqueue(input);
    this.cb.sendInput?.(input);
    return input;
  }

  /** Receive a remote input; if it targets a past tick, rewind & replay. */
  receiveRemote(input: PlayerInput): void {
    if (input.tick <= this.state.tick) {
      this.rewindAndReplay(input);
    } else {
      this.enqueue(input);
    }
  }

  private enqueue(input: PlayerInput): void {
    const list = this.inputQueue.get(input.tick) ?? [];
    // De-dupe (relay echoes our own inputs back).
    if (list.some((i) => i.player === input.player && i.seq === input.seq)) return;
    list.push(input);
    this.inputQueue.set(input.tick, list);
  }

  private rewindAndReplay(lateInput: PlayerInput): void {
    // Find the newest snapshot at or before the late input's tick - 1.
    const snap = [...this.history].reverse().find((h) => h.tick < lateInput.tick);
    if (!snap) {
      // Too old to reconcile: apply on the next tick instead (graceful).
      this.enqueue({ ...lateInput, tick: this.state.tick + 1 });
      return;
    }
    const currentTick = this.state.tick;
    this.state = JSON.parse(snap.snapshot) as GameState;
    // Re-queue every input from the snapshot forward, plus the late one.
    const replay = this.appliedInputs.filter((i) => i.tick > snap.tick);
    replay.push(lateInput);
    for (const i of replay) this.enqueue(i);
    // Fast-forward silently to the present; renderer interpolates the catch-up.
    while (this.state.tick < currentTick) {
      this.stepOnce(true);
    }
  }

  private stepOnce(silent = false): void {
    const nextTick = this.state.tick + 1;
    const inputs = this.inputQueue.get(nextTick) ?? [];
    this.inputQueue.delete(nextTick);
    this.appliedInputs.push(...inputs);
    if (this.appliedInputs.length > 400) this.appliedInputs.splice(0, this.appliedInputs.length - 400);

    const result = advanceTick(this.state, inputs);
    this.state = result.state;

    // Snapshot every 10 ticks (3 s) for rewind support.
    if (this.state.tick % 10 === 0) {
      this.history.push({ tick: this.state.tick, snapshot: JSON.stringify(this.state) });
      if (this.history.length > 8) this.history.shift();
    }

    if (silent) {
      this.accumulatedEvents.push(...result.events);
    } else {
      const events = [...this.accumulatedEvents, ...result.events];
      this.accumulatedEvents = [];
      this.cb.onTick({ state: this.state, events });
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.stepOnce(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/* ============================================================================
 * Scripted opponent — a tuned AI so Local Guest Mode is instantly playable.
 * It reads only public state and submits inputs through the same async
 * pipeline as a human, so it can never cheat the tick system.
 * ========================================================================== */

export class BotBrain {
  private rng: () => number;
  constructor(private seat: PlayerId, seed: number) {
    this.rng = makeRng(seed ^ 0xb07);
  }

  /** Called once per tick; may return an action to submit. */
  think(st: GameState): PlayerInput['action'] | null {
    if (st.phase !== 'basalt' && st.phase !== 'oasis') return null;
    // Deliberate like a human: consider a move roughly every 1.2 s.
    if (st.tick % 4 !== 0) return null;
    const me = st.players[this.seat];
    const rows = DEPLOY_ROWS[this.seat];
    const phaseLen = st.phase === 'basalt' ? st.cfg.phase1Ticks : st.cfg.phase2Ticks;

    // Fire the ultimate at the densest enemy cluster late in a phase.
    if (!me.ultUsed && st.phaseTicksLeft < phaseLen * 0.55) {
      const enemies = st.units.filter((u) => u.hp > 0 && u.owner !== this.seat);
      if (enemies.length >= 3) {
        let best: GridPos | null = null;
        let bestScore = 2;
        for (const e of enemies) {
          const score = enemies.filter((o) => cheb(o.x, o.y, e.x, e.y) <= 1).length;
          if (score > bestScore) {
            bestScore = score;
            best = { x: e.x, y: e.y };
          }
        }
        if (best) return { type: 'ult', x: best.x, y: best.y };
      }
    }

    // Save up sometimes to build bigger pushes; never overfill the army.
    if (me.aqua < 4 || this.rng() < 0.35) return null;
    if (armySize(st, this.seat) >= MAX_ARMY) return null;

    const affordable = me.hand.filter((c) => cardDef(c, st.phase).cost <= me.aqua);
    if (affordable.length === 0) return null;
    const pick = affordable[Math.floor(this.rng() * affordable.length)] as CardId;
    const def = cardDef(pick, st.phase);

    if (def.kind === 'spell') {
      const enemies = st.units.filter((u) => u.hp > 0 && u.owner !== this.seat);
      if (enemies.length === 0) return null;
      const e = enemies[Math.floor(this.rng() * enemies.length)];
      return { type: 'spell', card: pick, x: e.x, y: e.y };
    }

    // Deploy along a lane; bias toward the pond in phase 2.
    const x = st.phase === 'oasis'
      ? Math.max(0, Math.min(BOARD_W - 1, Math.floor(BOARD_W / 2) + Math.floor(this.rng() * 5) - 2))
      : Math.floor(this.rng() * BOARD_W);
    const y = rows[Math.floor(this.rng() * rows.length)];
    const dirY = this.seat === 0 ? -1 : 1;
    return { type: 'deploy', card: pick, x, y, dirX: (this.rng() - 0.5) * 0.8, dirY };
  }
}
