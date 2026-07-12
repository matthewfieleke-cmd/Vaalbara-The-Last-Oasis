/* ============================================================================
 * VAALBARA: THE LAST OASIS — engine.ts
 * Headless, deterministic simulation over a CONTINUOUS world.
 *
 *  - Positions are floats in the 9 x 15 world. Terrain collision comes from
 *    navmask.ts (baked from the arena paintings): ground units steer along
 *    the dark basalt paths and can never cross painted lava; flyers ignore
 *    all of it.
 *  - Movement = corridor routing (coarse BFS over the navmask) + straight
 *    steering + wall sliding + soft unit-vs-unit separation, evaluated in
 *    deterministic id order. No wall-clock time, no Math.random.
 *  - Inputs are queued asynchronously and execute on a future tick; the
 *    TickDriver below owns real-time pacing and rewind/replay reconciliation.
 * ========================================================================== */

import {
  ACID_DMG, AGGRO_RANGE, AQUA_MAX, AQUA_PER_TICK_P1, AQUA_PER_TICK_P2, BLESSING_MULT,
  BRIDGE_HALF_W, CAPTURE_RATE, DEPLOY_DEPTH, FORT_ARCH_HALF_W, FORT_LANES, FORT_SPAWN_Y,
  FORT_WALL_FRONT, FORT_WING_R, FORT_WING_Y,
  HAND_SIZE, LANE_SOFT_CAP, LOTUS_HEAL_PCT, OBELISK_HP,
  PHASE1_TICKS, PHASE2_TICKS, RUBBLE_VISIBLE_DEPTH, RIVER_BANDS,
  TICK_MS, TRANSITION_TICKS, VENT_DMG, WORLD_H, WORLD_W, armyCap, fortPads, inDeployBand, inWorld,
} from './types';
import type {
  CardId, FactionId, GameEvent, GameState, ObeliskState, PhaseConfig, PlayerId,
  PlayerInput, PropState, TickResult, UnitState, UnitStats, Vec2,
} from './types';
import { LAVA_RAIN, MECHANICS, SPELL_BALANCE, buildDeck, cardDef, speciesDef } from './data';
import { LAVA_RAIN_CARD } from './types';
import { CELL, cellAt, isDeep, isWater, nextCorridor, walkableAt } from './navmask';
import type { WorldId } from './navmask';

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

const dist2 = (ax: number, ay: number, bx: number, by: number) => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};
const dist = (ax: number, ay: number, bx: number, by: number) => Math.sqrt(dist2(ax, ay, bx, by));

export function worldOf(st: GameState): WorldId {
  return st.phase === 'oasis' || st.phase === 'ended' ? 'oasis' : 'basalt';
}

/* ------------------------------------------------------------------------ */
/* Authored props — placed to match the arena paintings                       */
/* ------------------------------------------------------------------------ */

function basaltProps(): PropState[] {
  // Sulfur vents sit by the painting's smoking fissures near the flanks.
  return [
    { kind: 'vent', x: 0.9, y: 4.4, r: 0.6, destroyed: false },
    { kind: 'vent', x: 8.1, y: 4.6, r: 0.6, destroyed: false },
    { kind: 'vent', x: 0.9, y: 10.6, r: 0.6, destroyed: false },
    { kind: 'vent', x: 8.1, y: 10.4, r: 0.6, destroyed: false },
  ];
}

/** The Phase-1 objectives: each seat's fortress fields TWO gatehouse wings,
 *  one per lane. A wing crumbles at zero; the Basalt Fields end only when a
 *  fortress has lost both. */
function makeObelisks(): ObeliskState[] {
  const wings: ObeliskState[] = [];
  for (const owner of [0, 1] as const) {
    FORT_LANES[owner].forEach((x, wing) => {
      wings.push({
        owner, wing: wing as 0 | 1,
        hp: OBELISK_HP, maxHp: OBELISK_HP,
        x, y: FORT_WING_Y[owner], r: FORT_WING_R,
      });
    });
  }
  return wings;
}

function oasisProps(): PropState[] {
  return [
    // Reed banks (stealth) flanking the pond, where the cattails grow.
    { kind: 'reeds', x: 1.15, y: 5.4, r: 0.95, destroyed: false },
    { kind: 'reeds', x: 7.85, y: 5.6, r: 0.95, destroyed: false },
    { kind: 'reeds', x: 1.2, y: 9.6, r: 0.95, destroyed: false },
    { kind: 'reeds', x: 7.8, y: 9.4, r: 0.95, destroyed: false },
    // Lotus blooms at the shoreline — breakable healing bursts.
    { kind: 'lotus', x: 2.5, y: 4.9, r: 0.45, destroyed: false },
    { kind: 'lotus', x: 6.5, y: 5.1, r: 0.45, destroyed: false },
    { kind: 'lotus', x: 2.4, y: 10.1, r: 0.45, destroyed: false },
    { kind: 'lotus', x: 6.6, y: 9.9, r: 0.45, destroyed: false },
  ];
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
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return {
      faction,
      aqua: 5,
      hand: deck.slice(0, HAND_SIZE),
      queue: deck.slice(HAND_SIZE),
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
    units: [],
    projectiles: [],
    zones: [],
    props: basaltProps(),
    obelisks: makeObelisks(),
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
let nextProjId = 1;
export function resetIds(): void {
  nextUnitId = 1;
  nextZoneId = 1;
  nextProjId = 1;
}

interface RuntimeUnit extends UnitState {
  stats: UnitStats;
}

function rt(u: UnitState): RuntimeUnit {
  return Object.assign(u, { stats: speciesDef(u.species).stats! });
}

export function armySize(st: GameState, owner: PlayerId): number {
  return st.units.reduce((n, u) => n + (u.hp > 0 && u.owner === owner ? 1 : 0), 0);
}

/** Current deploy ceiling for this match state (staged 6→7→8 in Basalt). */
export function currentArmyCap(st: GameState): number {
  const elapsed = st.phase === 'basalt'
    ? Math.max(0, (st.cfg.phase1Ticks - st.phaseTicksLeft) * (TICK_MS / 1000))
    : 0;
  return armyCap(st.phase, elapsed);
}

/** Which gate lane (0/1) a world x is closer to for this owner. */
function laneWingOf(owner: PlayerId, x: number): 0 | 1 {
  const lanes = FORT_LANES[owner];
  return Math.abs(x - lanes[0]) < Math.abs(x - lanes[1]) ? 0 : 1;
}

/** Living ground units this owner has committed to a gate lane. */
export function laneGroundCount(st: GameState, owner: PlayerId, wing: 0 | 1): number {
  return st.units.reduce((n, u) => {
    if (u.hp <= 0 || u.owner !== owner) return n;
    if (speciesDef(u.species).stats!.flying) return n;
    return n + (u.homeWing === wing ? 1 : 0);
  }, 0);
}

/**
 * Pick a deploy gate: honour the player's tap when the lane has room for
 * `need` ground bodies; otherwise snap to the emptier corridor. Returns null
 * when neither lane can fit the card without breaking the soft cap.
 * Flyers ignore the soft cap (they don't clog the bridge deck).
 */
export function preferDeployLane(
  st: GameState, owner: PlayerId, preferredWing: 0 | 1, flying: boolean, need = 1,
): 0 | 1 | null {
  if (flying) return preferredWing;
  const other = (1 - preferredWing) as 0 | 1;
  const room = (wing: 0 | 1) => laneGroundCount(st, owner, wing) + need <= LANE_SOFT_CAP;
  if (room(preferredWing)) return preferredWing;
  if (room(other)) return other;
  return null;
}

function groundOpen(st: GameState, x: number, y: number): boolean {
  return inWorld(x, y) && walkableAt(worldOf(st), x, y);
}

/** Global march pace. The plodding gait animation reads the ACTUAL speed,
 *  so a small lift here quickens the stride without breaking foot contact. */
const MARCH_PACE = 1.20;

/** Is this ground position on a collapsed gatehouse's rubble mound? Razed
 *  lanes stay open, but crossing the debris is a scramble, not a march. */
export function onRubble(st: GameState, x: number, y: number): boolean {
  if (st.obelisks.length === 0) return false;
  const owner = y > FORT_WALL_FRONT[0] ? 0 : y < FORT_WALL_FRONT[1] ? 1 : null;
  if (owner === null) return false;
  const lanes = FORT_LANES[owner];
  const wing = Math.abs(x - lanes[0]) < Math.abs(x - lanes[1]) ? 0 : 1;
  const gate = st.obelisks.find((o) => o.owner === owner && o.wing === wing);
  if (!gate || gate.hp > 0) return false;
  const depth = owner === 0
    ? (y - FORT_WALL_FRONT[0]) / (FORT_SPAWN_Y[0] - FORT_WALL_FRONT[0])
    : (FORT_WALL_FRONT[1] - y) / (FORT_WALL_FRONT[1] - FORT_SPAWN_Y[1]);
  // Rear apron is open walking ground. The rubble starts after a couple of
  // steps and continues to the field-side wall lip.
  return depth >= 0 && depth <= 0.72;
}

function effSpeed(st: GameState, u: RuntimeUnit): number {
  let s = u.stats.speed * MARCH_PACE;
  if (u.buffs.blessed) s *= BLESSING_MULT;
  if (u.buffs.slowTicks > 0 && !u.buffs.berserk) s *= u.buffs.slowMult;
  if (!u.stats.flying && u.stats.heavy && isWater(worldOf(st), u.x, u.y)) s *= 0.6;
  // Clambering over a razed gate's debris: slow, deliberate scramble.
  if (!u.stats.flying && onRubble(st, u.x, u.y)) s *= 0.55;
  return s;
}

function effDmg(u: RuntimeUnit, st: GameState): number {
  let d = u.stats.dmg;
  if (u.buffs.blessed) d *= BLESSING_MULT;
  if (u.species === 'wolves') {
    const buddy = st.units.some((o) =>
      o.hp > 0 && o.id !== u.id && o.owner === u.owner && o.species === 'wolves' &&
      dist2(o.x, o.y, u.x, u.y) <= MECHANICS.wolvesAdjacencyRadius ** 2);
    if (buddy) d *= 1 + MECHANICS.wolvesAdjacencyBonus;
  }
  return Math.round(d);
}

function inStealthCover(st: GameState, u: UnitState): boolean {
  if (speciesDef(u.species).stats!.flying) return false;
  const reeds = st.props.some((p) => p.kind === 'reeds' && dist2(p.x, p.y, u.x, u.y) <= p.r * p.r);
  const thicket = st.zones.some((z) =>
    z.kind === 'thicket' && z.owner === u.owner && dist2(z.x, z.y, u.x, u.y) <= z.r * z.r);
  return reeds || thicket;
}

/* ------------------------------------------------------------------------ */
/* Damage pipeline                                                            */
/* ------------------------------------------------------------------------ */

function dealDamage(
  st: GameState, ev: GameEvent[],
  attacker: RuntimeUnit | null, victim: UnitState, amount: number,
  kind: 'melee' | 'ranged' | 'burn' | 'vent' | 'lava' | 'reflect' | 'stomp',
): void {
  // HP is discrete — round at the boundary so multipliers (charge, bless,
  // splash) never leak fractional chips into state or floating combat text.
  amount = Math.round(amount);
  if (victim.hp <= 0 || amount <= 0) return;
  const vStats = speciesDef(victim.species).stats!;
  victim.hp -= amount;
  if (attacker) st.players[attacker.owner].damageDealt += amount;
  ev.push({ type: 'hit', unitId: victim.id, x: victim.x, y: victim.y, amount, kind });

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
  if (attacker && (kind === 'melee' || kind === 'ranged')) attacker.stealthed = false;
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

function spawnUnit(
  st: GameState, ev: GameEvent[], owner: PlayerId, species: UnitState['species'],
  x: number, y: number, waypoint: Vec2 | null, homeWing: 0 | 1,
): UnitState | null {
  if (!inWorld(x, y)) return null;
  if (armySize(st, owner) >= currentArmyCap(st)) return null;
  const stats = speciesDef(species).stats!;
  if (!stats.flying && !groundOpen(st, x, y)) return null;
  const u: UnitState = {
    id: nextUnitId++,
    owner, species,
    x, y, px: x, py: y,
    hp: stats.hp, maxHp: stats.hp,
    facing: owner === 0 ? -1 : 1,
    atkTimer: 3,
    traveled: 0,
    stompBank: 0,
    struckTargets: [],
    waypoint,
    stall: 0,
    stallRef: Infinity,
    unstick: 0,
    buffs: freshBuffs(),
    stealthed: false,
    action: 'spawn',
    targetId: null,
    homeWing,
  };
  if (st.players[owner].blessed) u.buffs.blessed = true;
  st.units.push(u);
  ev.push({ type: 'spawn', unitId: u.id, species, owner, x, y });
  return u;
}

/** Lion roar: freeze nearby enemies on deployment. */
function lionRoar(st: GameState, ev: GameEvent[], lion: UnitState): void {
  ev.push({ type: 'roar', species: 'lion', x: lion.x, y: lion.y });
  for (const o of st.units) {
    if (o.hp <= 0 || o.owner === lion.owner) continue;
    if (dist2(o.x, o.y, lion.x, lion.y) <= MECHANICS.lionRoarRadius ** 2) {
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

  if (a.type === 'spell') {
    const handIdx = p.hand.indexOf(a.card);
    if (handIdx === -1) return;
    const def = cardDef(a.card, st.phase);
    if (p.aqua < def.cost) return;
    if (!inWorld(a.x, a.y)) return;

    if (a.card === LAVA_RAIN_CARD) {
      p.aqua -= def.cost;
      cycleCard(p, handIdx);
      st.pendingLava.push({
        owner: input.player, x: a.x, y: a.y,
        resolveTick: st.tick + LAVA_RAIN.telegraphTicks,
      });
      ev.push({ type: 'lavaTelegraph', x: a.x, y: a.y });
      ev.push({ type: 'spellCast', spell: 'lavarain', owner: input.player, x: a.x, y: a.y });
      return;
    }

    if (def.kind !== 'spell') return;
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

  const handIdx = p.hand.indexOf(a.card);
  if (handIdx === -1) return;
  const def = cardDef(a.card, st.phase);
  if (p.aqua < def.cost) return;

  if (a.type === 'deploy' && def.kind === 'unit' && def.species) {
    if (!inWorld(a.x, a.y)) return;
    if (armySize(st, input.player) >= currentArmyCap(st)) return;
    const stats = def.stats!;

    let sx = a.x;
    let sy = a.y;
    let wp: Vec2;
    let homeWing: 0 | 1 = laneWingOf(input.player, a.x);

    if (st.phase === 'basalt') {
      // Fortress siege: units enter the field THROUGH one of your two
      // gates. The touch snaps to the nearest gate lane, but the warrior
      // materialises at the FAR end of the arch corridor — outside the
      // fortress — and marches the whole tunnel before emerging onto the
      // field, so every deployment reads as a gate sortie.
      // Lane soft-cap: if the tapped gate is already crowded with ground
      // troops, snap to the emptier corridor so individual duels stay readable.
      const pads = fortPads(input.player);
      const tapped = pads.reduce((best, cur) =>
        Math.abs(cur.x - a.x) < Math.abs(best.x - a.x) ? cur : best);
      const lanes = FORT_LANES[input.player];
      const tappedWing: 0 | 1 = Math.abs(tapped.x - lanes[0]) < Math.abs(tapped.x - lanes[1]) ? 0 : 1;
      const wing = preferDeployLane(st, input.player, tappedWing, !!stats.flying, stats.count);
      if (wing === null) return; // both ground lanes soft-full
      homeWing = wing;
      const pad = pads[wing];
      sx = pad.x;
      const ownGate = st.obelisks.find((o) => o.owner === input.player && o.wing === wing);
      const ownRazed = !!ownGate && ownGate.hp <= 0;
      if (ownRazed) {
        // Own gate down: materialise on the rear apron (NOT on the field) so
        // the warrior marches a couple steps, then scrambles over the rubble
        // pile before entering the battlefield. It stays IN ITS LANE for the
        // whole crossing — threats at the other gate are engaged only after
        // it has climbed over the mound, from the battlefield side.
        sy = FORT_SPAWN_Y[input.player];
        wp = { x: pad.x, y: input.player === 0 ? 10.85 : 4.15 };
      } else {
        sy = FORT_SPAWN_Y[input.player];
        // March to the CENTRAL plateau (pulled toward mid-field from the
        // gate lane): both armies converge there and clash before anyone
        // pushes on down a lane toward the enemy walls.
        wp = {
          x: pad.x + (WORLD_W / 2 - pad.x) * 0.5,
          y: input.player === 0 ? 7.6 : 7.4,
        };
      }
    } else {
      // Oasis: free vector spawning along your own baseline; the drag
      // vector becomes an entry trajectory the unit sprints down.
      if (!inDeployBand(input.player, a.y)) return;
      // Nudge the spawn point onto open ground if the touch grazed water.
      if (!stats.flying && !groundOpen(st, sx, sy)) {
        let fixed = false;
        for (let r = 0.25; r <= 1.5 && !fixed; r += 0.25) {
          for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, r], [r, -r], [-r, -r]] as const) {
            if (inWorld(sx + dx, sy + dy) && inDeployBand(input.player, sy + dy) && groundOpen(st, sx + dx, sy + dy)) {
              sx += dx;
              sy += dy;
              fixed = true;
              break;
            }
          }
        }
        if (!fixed) return;
      }
      homeWing = laneWingOf(input.player, sx);
      const len = Math.hypot(a.dirX, a.dirY) || 1;
      const nx = a.dirX / len;
      const ny = a.dirY / len;
      wp = {
        x: Math.max(0.4, Math.min(WORLD_W - 0.4, sx + nx * 3.5)),
        y: Math.max(0.4, Math.min(WORLD_H - 0.4, sy + ny * 3.5)),
      };
      // Pull the waypoint back along the fling until it lands on open ground.
      if (!stats.flying) {
        for (let k = 0; k < 6 && !groundOpen(st, wp.x, wp.y); k++) {
          wp = { x: wp.x - nx * 0.5, y: wp.y - ny * 0.5 };
        }
      }
    }
    p.aqua -= def.cost;
    cycleCard(p, handIdx);

    // Inside the arch corridors multi-unit cards fall into COLUMN file — the
    // tunnel is only as wide as the painted opening, so packs march through
    // single file, each a step ahead of the next. On the open oasis baseline
    // they fan out side by side as before.
    const columnFile = st.phase === 'basalt';
    // Column steps advance toward the field (deeper index = closer to exit).
    const stepY = input.player === 0 ? -0.55 : 0.55;
    const at = (i: number, n: number, spread: number): { x: number; y: number } =>
      columnFile
        ? { x: sx, y: sy + i * stepY }
        : { x: sx + (i - (n - 1) / 2) * spread, y: sy };
    const spawned: UnitState[] = [];
    if (stats.formation === 'line' && stats.count > 1) {
      for (let i = 0; i < stats.count; i++) {
        const p2 = at(i, stats.count, 0.7);
        const u = spawnUnit(st, ev, input.player, def.species, p2.x, p2.y, wp, homeWing);
        if (u) spawned.push(u);
      }
    } else if (stats.formation === 'pair' && stats.count === 2) {
      const a1 = at(0, 2, 0.8);
      const a2 = at(1, 2, 0.8);
      const u1 = spawnUnit(st, ev, input.player, def.species, a1.x, a1.y, wp, homeWing);
      const u2 = spawnUnit(st, ev, input.player, def.species, a2.x, a2.y, wp, homeWing);
      if (u1) spawned.push(u1);
      if (u2) spawned.push(u2);
    } else {
      const u = spawnUnit(st, ev, input.player, def.species, sx, sy, wp, homeWing);
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
/* Combat visibility — no invisible warriors attack or are attacked           */
/* ------------------------------------------------------------------------ */

/** True when a warrior is visible enough to fight: on the open field, or
 *  climbing a razed gate's rubble pile / causeway in the breach lane. */
export function isCombatVisible(st: GameState, u: UnitState): boolean {
  if (st.phase !== 'basalt') return true;

  // Central battlefield between both fortress wall fronts.
  if (u.y <= FORT_WALL_FRONT[0] + 0.05 && u.y >= FORT_WALL_FRONT[1] - 0.05) return true;

  const owner: PlayerId | null =
    u.y > FORT_WALL_FRONT[0] + 0.05 ? 0 : u.y < FORT_WALL_FRONT[1] - 0.05 ? 1 : null;
  if (owner === null) return false;

  const lanes = FORT_LANES[owner];
  const wing = Math.abs(u.x - lanes[0]) < Math.abs(u.x - lanes[1]) ? 0 : 1;
  const gate = st.obelisks.find((o) => o.owner === owner && o.wing === wing);
  if (Math.abs(u.x - lanes[wing]) > FORT_ARCH_HALF_W + 0.55) return false;
  const depth = owner === 0
    ? (u.y - FORT_WALL_FRONT[0]) / (FORT_SPAWN_Y[0] - FORT_WALL_FRONT[0])
    : (FORT_WALL_FRONT[1] - u.y) / (FORT_WALL_FRONT[1] - FORT_SPAWN_Y[1]);
  if (!gate) return false;
  // A warrior at a standing arch's field mouth is already visible to nearby
  // defenders. Deep tunnel occupants remain concealed by the gatehouse —
  // but only in their OWN tunnel: an intruder inside an enemy arch can only
  // be there to batter that gate, and it is plainly visible doing so, so it
  // stays targetable at any depth. Without this, a freshly deployed defender
  // marches straight past an arch-tucked attacker chewing on its gatehouse.
  if (gate.hp > 0) return owner !== u.owner || depth <= 0.18;
  // depth=1 is the rear spawn apron; depth=0 is the field-side lip. A unit
  // becomes fightable only after it has crossed the mound and reached the
  // battlefield edge.
  return depth <= RUBBLE_VISIBLE_DEPTH;
}

/* ------------------------------------------------------------------------ */
/* Targeting                                                                  */
/* ------------------------------------------------------------------------ */

function visibleEnemies(st: GameState, u: RuntimeUnit): UnitState[] {
  return st.units.filter((o) => {
    if (o.hp <= 0 || o.owner === u.owner) return false;
    if (o.stealthed && dist2(o.x, o.y, u.x, u.y) > 1.3 * 1.3) return false;
    return true;
  });
}

/** Nearest enemy actively pressuring this owner's fortress. This is used by
 *  fresh defenders before generic lane-push goals, so a known home threat can
 *  never be ignored in favour of marching toward the central battlefield. */
function nearestHomeThreat(
  st: GameState,
  owner: PlayerId,
  canTarget?: (enemy: UnitState) => boolean,
): { enemy: UnitState; gate: ObeliskState; d2: number } | null {
  let best: { enemy: UnitState; gate: ObeliskState; d2: number } | null = null;
  const gates = st.obelisks.filter((o) => o.owner === owner);
  for (const enemy of st.units) {
    if (enemy.hp <= 0 || enemy.owner === owner) continue;
    if (canTarget && !canTarget(enemy)) continue;
    for (const gate of gates) {
      const d2 = dist2(enemy.x, enemy.y, gate.x, gate.y);
      if (d2 > 2.8 * 2.8 || (best && d2 >= best.d2)) continue;
      best = { enemy, gate, d2 };
    }
  }
  return best;
}

function onHomeSide(u: UnitState): boolean {
  return u.owner === 0 ? u.y >= RIVER_BANDS[0].y0 : u.y <= RIVER_BANDS[1].y1;
}

function pickTarget(st: GameState, u: RuntimeUnit): UnitState | null {
  const enemies = visibleEnemies(st, u).filter((e) => isCombatVisible(st, e));
  if (enemies.length === 0) return null;
  // Engagement stickiness: locked duels stay locked while in reach.
  if (u.targetId !== null) {
    const cur = enemies.find((e) => e.id === u.targetId);
    if (cur && dist(u.x, u.y, cur.x, cur.y) <= Math.max(2.2, u.stats.range + 1.2)) {
      const cs = speciesDef(cur.species).stats!;
      if (!(cs.flying && !u.stats.canHitAir && !u.stats.flying)) return cur;
    }
  }
  // Home-side defenders deal with warriors at either friendly gate before
  // resuming their central push. Threats the unit cannot actually FIGHT are
  // skipped — a ground warrior handed flying bees as its "home threat" would
  // walk to the gate and stand under them forever, attacking nothing.
  if (st.phase === 'basalt' && onHomeSide(u)) {
    const threat = nearestHomeThreat(st, u.owner, (e) => {
      const es = speciesDef(e.species).stats!;
      return !(es.flying && !u.stats.canHitAir && !u.stats.flying);
    });
    if (threat && enemies.some((e) => e.id === threat.enemy.id)) return threat.enemy;
  }
  // Eagle hunts the weakest visible heart. Everyone else hunts the NEAREST
  // visible enemy anywhere on the field.
  if (u.species === 'eagle') {
    return enemies.reduce((a, b) => (b.hp < a.hp ? b : a));
  }
  let best: UnitState | null = null;
  let bestD = Infinity;
  const aggroBase2 = AGGRO_RANGE * AGGRO_RANGE;
  // Ground anti-air artillery (bombardier beetles) may acquire flyers anywhere
  // inside their full weapon range — not capped at the melee aggro bubble.
  const flyerCap2 = u.stats.canHitAir && u.stats.ranged
    ? (attackReach(u) + 1.4) ** 2
    : aggroBase2;
  for (const e of enemies) {
    const eFly = speciesDef(e.species).stats!.flying;
    if (eFly && !u.stats.canHitAir && !u.stats.flying) continue;
    const d = dist2(u.x, u.y, e.x, e.y) + (e.id % 7) * 1e-4;
    if (eFly && !u.stats.flying && d > flyerCap2) continue;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** The enemy gatehouse wing this unit should be pressuring (phase 1 only).
 *  Units batter the wing of the lane they marched down — the wall around
 *  their own arch — and only swing to the far gatehouse once their lane's
 *  wing has already crumbled. */
function enemyObelisk(st: GameState, u: UnitState): ObeliskState | null {
  if (st.phase !== 'basalt') return null;
  const wings = st.obelisks.filter((o) => o.owner !== u.owner);
  if (wings.length === 0) return null;
  const laneWing = wings.reduce((best, cur) =>
    Math.abs(cur.x - u.x) < Math.abs(best.x - u.x) ? cur : best);
  if (laneWing.hp > 0) return laneWing;
  const other = wings.find((o) => o !== laneWing && o.hp > 0);
  return other ?? null;
}

/** Where a ground unit stands to besiege a wing: on the field, just off the
 *  fortress wall — the wing body itself is inside blocked wall cells. */
function siegeGoal(ob: ObeliskState): Vec2 {
  const front = FORT_WALL_FRONT[ob.owner];
  return { x: ob.x, y: ob.owner === 1 ? front + 0.45 : front - 0.45 };
}

function attackReach(u: RuntimeUnit): number {
  let range = u.stats.range;
  if (u.buffs.rangeCapTicks > 0) range = Math.min(range, MECHANICS.beesRangeCap);
  return range;
}

function canAttack(st: GameState, u: RuntimeUnit, target: UnitState): boolean {
  if (!isCombatVisible(st, u) || !isCombatVisible(st, target)) return false;
  const tStats = speciesDef(target.species).stats!;
  if (tStats.flying && !u.stats.canHitAir && !u.stats.flying) return false;
  const reach = attackReach(u) + u.stats.radius + tStats.radius;
  return dist2(u.x, u.y, target.x, target.y) <= reach * reach;
}

/* ------------------------------------------------------------------------ */
/* Combat resolution                                                          */
/* ------------------------------------------------------------------------ */

function performAttack(st: GameState, ev: GameEvent[], u: RuntimeUnit, target: UnitState): void {
  const tStats = speciesDef(target.species).stats!;

  // Bombardier beetle: launch a visible acid jet instead of instant damage.
  if (u.stats.ranged) {
    const d = Math.max(0.001, dist(u.x, u.y, target.x, target.y));
    const speed = MECHANICS.acidJetSpeed;
    st.projectiles.push({
      id: nextProjId++,
      owner: u.owner,
      kind: 'acid',
      x: u.x, y: u.y, px: u.x, py: u.y,
      vx: ((target.x - u.x) / d) * speed,
      vy: ((target.y - u.y) / d) * speed,
      dmg: effDmg(u, st),
      ticksLeft: Math.max(1, Math.ceil(d / speed)),
      targetId: target.id,
    });
    u.traveled = 0;
    u.targetId = target.id;
    u.action = 'attack';
    u.facing = target.x >= u.x ? 1 : -1;
    u.atkTimer = u.stats.atkCd;
    ev.push({ type: 'shoot', unitId: u.id, x: u.x, y: u.y, tx: target.x, ty: target.y });
    ev.push({ type: 'attack', unitId: u.id, species: u.species, owner: u.owner, x: u.x, y: u.y, tx: target.x, ty: target.y, crit: false, air: tStats.flying });
    return;
  }

  let dmg = effDmg(u, st);
  let crit = false;

  // Bighorn charge: heavy mult + knockback after a long unbroken gallop.
  if (u.species === 'bighorn' && u.traveled >= MECHANICS.bighornChargeDist && !u.struckTargets.includes(target.id)) {
    dmg = Math.round(dmg * MECHANICS.bighornChargeMult);
    crit = true;
    ev.push({ type: 'charge', unitId: u.id, x: u.x, y: u.y });
    if (!tStats.colossal) {
      const d = Math.max(0.001, dist(u.x, u.y, target.x, target.y));
      const kx = ((target.x - u.x) / d) * MECHANICS.bighornKnockback;
      const ky = ((target.y - u.y) / d) * MECHANICS.bighornKnockback;
      const nx = target.x + kx;
      const ny = target.y + ky;
      if (inWorld(nx, ny) && (tStats.flying || groundOpen(st, nx, ny))) {
        target.px = target.x;
        target.py = target.y;
        target.x = nx;
        target.y = ny;
      }
    }
  }

  // Scorpion: first sting on each victim stuns.
  if (u.species === 'scorpion' && !u.struckTargets.includes(target.id)) {
    const berserk = target.species === 'honeybadger' && target.hp / target.maxHp < MECHANICS.badgerThreshold;
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

  ev.push({ type: 'attack', unitId: u.id, species: u.species, owner: u.owner, x: u.x, y: u.y, tx: target.x, ty: target.y, crit, air: tStats.flying });

  // Bear sweep: the swipe rakes every enemy near the primary target.
  if (u.species === 'bear') {
    for (const o of st.units) {
      if (o.hp <= 0 || o.owner === u.owner || o.id === target.id) continue;
      if (dist2(o.x, o.y, target.x, target.y) <= MECHANICS.bearSweepRadius ** 2) {
        dealDamage(st, ev, u, o, Math.round(dmg * 0.6), 'melee');
      }
    }
  }

  dealDamage(st, ev, u, target, dmg, 'melee');

  if (u.species === 'fireants' && target.hp > 0) {
    target.buffs.burnStacks = Math.min(MECHANICS.acidMaxStacks, target.buffs.burnStacks + 1);
    target.buffs.burnTicks = MECHANICS.acidBurnTicks;
  }
  if (u.species === 'bees' && target.hp > 0) {
    target.buffs.rangeCapTicks = MECHANICS.beesRangeCapTicks;
  }

  let cd = u.stats.atkCd;
  if (u.buffs.berserk) cd = Math.max(1, Math.round(cd / 2));
  u.atkTimer = cd;
}

/* ------------------------------------------------------------------------ */
/* Obelisk siege                                                              */
/* ------------------------------------------------------------------------ */

function dealObeliskDamage(st: GameState, ev: GameEvent[], attacker: PlayerId, ob: ObeliskState, amount: number): void {
  amount = Math.round(amount);
  if (ob.hp <= 0 || amount <= 0) return;
  // Mild last-stand DR while the sister wing is already down. The big
  // fortification is the HP surge applied when the first wing falls (below).
  const sister = st.obelisks.find((o) => o.owner === ob.owner && o.wing !== ob.wing);
  const fortified = !!sister && sister.hp <= 0;
  const dealt = fortified ? Math.max(1, Math.round(amount * 0.82)) : amount;
  ob.hp -= dealt;
  st.players[attacker].damageDealt += dealt;
  ev.push({ type: 'obeliskHit', owner: ob.owner, amount: dealt, x: ob.x, y: ob.y });
  if (ob.hp <= 0) {
    ob.hp = 0;
    ev.push({ type: 'obeliskDown', owner: ob.owner, x: ob.x, y: ob.y });
    // Remaining wing surges: buys time for a counter-siege to land the
    // reciprocal first gate (1–1 trades) and keeps clean sweeps rare —
    // sized for staged late armies that would otherwise steamroll the sister.
    if (sister && sister.hp > 0) {
      const bonus = Math.round(sister.maxHp * 1.15);
      sister.maxHp += bonus;
      sister.hp = Math.min(sister.maxHp, sister.hp + bonus);
    }
  }
}

function attackObelisk(st: GameState, ev: GameEvent[], u: RuntimeUnit, ob: ObeliskState): void {
  u.traveled = 0;
  u.action = 'attack';
  u.facing = ob.x >= u.x ? 1 : -1;
  let cd = u.stats.atkCd;
  if (u.buffs.berserk) cd = Math.max(1, Math.round(cd / 2));
  u.atkTimer = cd;
  ev.push({ type: 'attack', unitId: u.id, species: u.species, owner: u.owner, x: u.x, y: u.y, tx: ob.x, ty: ob.y, crit: false, air: false });

  if (u.stats.ranged) {
    const d = Math.max(0.001, dist(u.x, u.y, ob.x, ob.y));
    const speed = MECHANICS.acidJetSpeed;
    st.projectiles.push({
      id: nextProjId++,
      owner: u.owner,
      kind: 'acid',
      x: u.x, y: u.y, px: u.x, py: u.y,
      vx: ((ob.x - u.x) / d) * speed,
      vy: ((ob.y - u.y) / d) * speed,
      dmg: effDmg(u, st),
      ticksLeft: Math.max(1, Math.ceil(d / speed)),
    });
    ev.push({ type: 'shoot', unitId: u.id, x: u.x, y: u.y, tx: ob.x, ty: ob.y });
    return;
  }
  dealObeliskDamage(st, ev, u.owner, ob, effDmg(u, st));
}

/** T-Rex stomp: chips all enemy ground units nearby, once per stride. */
function trexStomp(st: GameState, ev: GameEvent[], u: RuntimeUnit): void {
  ev.push({ type: 'stomp', x: u.x, y: u.y });
  for (const o of st.units) {
    if (o.hp <= 0 || o.owner === u.owner) continue;
    if (speciesDef(o.species).stats!.flying) continue;
    if (dist2(o.x, o.y, u.x, u.y) <= MECHANICS.trexStompRadius ** 2) {
      dealDamage(st, ev, u, o, MECHANICS.trexStompDmg, 'stomp');
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Projectiles                                                                */
/* ------------------------------------------------------------------------ */

function tickProjectiles(st: GameState, ev: GameEvent[]): void {
  for (const pr of st.projectiles) {
    if (pr.targetId != null) {
      const tgt = st.units.find((u) => u.id === pr.targetId && u.hp > 0);
      if (tgt) {
        const dx = tgt.x - pr.x;
        const dy = tgt.y - pr.y;
        const d = Math.max(0.001, Math.hypot(dx, dy));
        const speed = Math.hypot(pr.vx, pr.vy) || MECHANICS.acidJetSpeed;
        const steer = 0.88;
        const nx = dx / d;
        const ny = dy / d;
        pr.vx = pr.vx * (1 - steer) + nx * speed * steer;
        pr.vy = pr.vy * (1 - steer) + ny * speed * steer;
        pr.ticksLeft = Math.max(pr.ticksLeft, Math.ceil(d / speed) + 1);
        if (d < 0.35) {
          dealDamage(st, ev, null, tgt, pr.dmg, 'ranged');
          st.players[pr.owner].damageDealt += pr.dmg;
          pr.ticksLeft = 0;
        }
      }
    }
    pr.px = pr.x;
    pr.py = pr.y;
    pr.x += pr.vx;
    pr.y += pr.vy;
    pr.ticksLeft--;
    if (pr.ticksLeft <= 0) {
      ev.push({ type: 'splash', x: pr.x, y: pr.y });
      for (const o of st.units) {
        if (o.hp <= 0 || o.owner === pr.owner) continue;
        if (dist2(o.x, o.y, pr.x, pr.y) <= MECHANICS.acidSplashRadius ** 2) {
          dealDamage(st, ev, null, o, pr.dmg, 'ranged');
          st.players[pr.owner].damageDealt += pr.dmg;
        }
      }
      for (const ob of st.obelisks) {
        if (ob.owner === pr.owner || ob.hp <= 0) continue;
        if (dist2(ob.x, ob.y, pr.x, pr.y) <= (MECHANICS.acidSplashRadius + ob.r) ** 2) {
          dealObeliskDamage(st, ev, pr.owner, ob, pr.dmg);
        }
      }
      st.zones.push({
        id: nextZoneId++, kind: 'acidpool', owner: pr.owner,
        x: pr.x, y: pr.y, r: SPELL_BALANCE.acidpool.radius,
        ticksLeft: SPELL_BALANCE.acidpool.duration,
      });
    }
  }
  st.projectiles = st.projectiles.filter((p) => p.ticksLeft > 0);
}

/* ------------------------------------------------------------------------ */
/* Terrain, props & zone effects                                              */
/* ------------------------------------------------------------------------ */

function applyFieldEffects(st: GameState, ev: GameEvent[], u: RuntimeUnit): void {
  const world = worldOf(st);
  if (!u.stats.flying) {
    // Sulfur vents punish campers (only units that are not moving).
    if (u.action !== 'move' && (cellAt(world, u.x, u.y) === CELL.VENT ||
      st.props.some((p) => p.kind === 'vent' && dist2(p.x, p.y, u.x, u.y) <= p.r * p.r))) {
      dealDamage(st, ev, null, u, VENT_DMG, 'vent');
    }
    // Lotus blooms pop when trampled: AOE healing mist.
    for (const p of st.props) {
      if (p.kind !== 'lotus' || p.destroyed) continue;
      if (dist2(p.x, p.y, u.x, u.y) <= (p.r + u.stats.radius) ** 2) {
        p.destroyed = true;
        ev.push({ type: 'lotusBurst', x: p.x, y: p.y });
        st.zones.push({
          id: nextZoneId++, kind: 'healmist', owner: u.owner,
          x: p.x, y: p.y, r: SPELL_BALANCE.healmist.radius, ticksLeft: SPELL_BALANCE.healmist.duration,
        });
      }
    }
  }
  u.stealthed = inStealthCover(st, u);
}

function applyZoneEffects(st: GameState, ev: GameEvent[]): void {
  for (const z of st.zones) {
    for (const u of st.units) {
      if (u.hp <= 0) continue;
      if (dist2(u.x, u.y, z.x, z.y) > z.r * z.r) continue;
      switch (z.kind) {
        case 'sulfur':
          if (u.owner !== z.owner) {
            u.buffs.slowTicks = Math.max(u.buffs.slowTicks, 1);
            u.buffs.slowMult = SPELL_BALANCE.sulfur.slowMult;
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
      if (u.hp <= 0 || u.owner === strike.owner) continue;
      const d = dist(u.x, u.y, strike.x, strike.y);
      const flying = speciesDef(u.species).stats!.flying;
      let dmg = 0;
      if (d <= LAVA_RAIN.centerR) dmg = flying ? Math.round(LAVA_RAIN.centerDmg * LAVA_RAIN.flyerCenterMult) : LAVA_RAIN.centerDmg;
      else if (d <= LAVA_RAIN.midR) dmg = LAVA_RAIN.midDmg;
      else if (d <= LAVA_RAIN.rimR) dmg = LAVA_RAIN.rimDmg;
      if (dmg > 0) dealDamage(st, ev, null, u, dmg, 'lava');
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Movement — corridor routing + steering + wall slide                        */
/* ------------------------------------------------------------------------ */

/** True when any sample along the segment crosses non-walkable ground.
 *  Marching the WHOLE line (0.2-unit steps) matters: a thin lava river is
 *  invisible to a single end-point probe, which used to leave units grinding
 *  against chokepoint walls instead of routing around them. */
function groundLineBlocked(st: GameState, x0: number, y0: number, x1: number, y1: number): boolean {
  const d = dist(x0, y0, x1, y1);
  const steps = Math.max(1, Math.ceil(d / 0.2));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (!groundOpen(st, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return true;
  }
  return false;
}

function steerStep(
  st: GameState, u: RuntimeUnit, goalX: number, goalY: number, stepLen: number, depth = 0,
): boolean {
  const world = worldOf(st);
  // Route via corridors when the straight line to the goal is blocked ahead.
  let aimX = goalX;
  let aimY = goalY;
  const flyTunnel = u.stats.flying ? flyerTunnelLane(u.x, u.y) : null;
  if (flyTunnel) {
    // Flyers leave and enter a fortress along the arch centreline. Their
    // target may be far off-axis, but lateral steering begins only after the
    // whole body has cleared the tunnel mouth.
    aimX = flyTunnel.laneX;
    // Unless the goal itself sits inside THIS tunnel lane, keep flying
    // toward the field-side exit. An off-lane goal at tunnel height would
    // otherwise cancel against the centreline clamp and freeze the flyer.
    const goalInLane = Math.abs(goalX - flyTunnel.laneX) <= FORT_ARCH_HALF_W + 0.9;
    const goalInZone = flyTunnel.owner === 0
      ? goalY > FORT_WALL_FRONT[0] - 0.55
      : goalY < FORT_WALL_FRONT[1] + 0.55;
    if (!(goalInLane && goalInZone)) {
      aimY = flyTunnel.owner === 0 ? FORT_WALL_FRONT[0] - 1.0 : FORT_WALL_FRONT[1] + 1.0;
    }
  } else if (!u.stats.flying) {
    const d = Math.max(0.001, dist(u.x, u.y, goalX, goalY));
    const probe = Math.min(d, 1.4);
    const lx = u.x + ((goalX - u.x) / d) * probe;
    const ly = u.y + ((goalY - u.y) / d) * probe;
    if (groundLineBlocked(st, u.x, u.y, lx, ly)) {
      const wp = nextCorridor(world, u.x, u.y, goalX, goalY);
      if (wp) {
        aimX = wp.x;
        aimY = wp.y;
      }
    }
  }

  const d = Math.max(0.001, dist(u.x, u.y, aimX, aimY));
  const step = Math.min(stepLen, dist(u.x, u.y, goalX, goalY));
  let sx = ((aimX - u.x) / d) * step;
  let sy = ((aimY - u.y) / d) * step;

  const tryMove = (mx: number, my: number): boolean => {
    const nx = u.x + mx;
    const ny = u.y + my;
    if (!inWorld(nx, ny)) return false;
    if (!u.stats.flying && !groundOpen(st, nx, ny)) return false;
    u.x = nx;
    u.y = ny;
    return true;
  };

  // Full step, then wall-slide on each axis, then a widening deflection fan
  // (45°, 90°, 120°, 150°, 180° either way — deterministic order biased by
  // unit id). The retreat angles matter: a unit shoved into a terrain pocket
  // whose only open ground is BEHIND it could otherwise never move again.
  if (tryMove(sx, sy)) return true;
  if (tryMove(sx, 0)) return true;
  if (tryMove(0, sy)) return true;
  const rot = (vx: number, vy: number, ang: number) => ({
    x: vx * Math.cos(ang) - vy * Math.sin(ang),
    y: vx * Math.sin(ang) + vy * Math.cos(ang),
  });
  const sign = u.id % 2 === 0 ? 1 : -1;
  for (const base of [0.7853981633974483, 1.5707963267948966, 2.0943951023931953, 2.617993877991494, Math.PI]) {
    for (const ang of [base * sign, -base * sign]) {
      const v = rot(sx, sy, ang);
      if (tryMove(v.x, v.y)) return true;
    }
  }
  // Completely wedged: fall back to marching straight at the next corridor
  // waypoint (once), which aims around the obstacle rather than through it.
  if (depth === 0 && !u.stats.flying) {
    const wp = nextCorridor(world, u.x, u.y, goalX, goalY);
    if (wp && dist2(wp.x, wp.y, goalX, goalY) > 0.01) {
      return steerStep(st, u, wp.x, wp.y, stepLen, 1);
    }
  }
  return false;
}

/** Extended tunnel zone for flyers. The 0.55-unit field-side clearance keeps
 *  the full swarm sprite inside the opening until its rear edge clears stone. */
function flyerTunnelLane(x: number, y: number): { owner: PlayerId; laneX: number } | null {
  let owner: PlayerId | null = null;
  if (y > FORT_WALL_FRONT[0] - 0.55) owner = 0;
  else if (y < FORT_WALL_FRONT[1] + 0.55) owner = 1;
  if (owner === null) return null;
  const lanes = FORT_LANES[owner];
  const laneX = Math.abs(x - lanes[0]) < Math.abs(x - lanes[1]) ? lanes[0] : lanes[1];
  if (Math.abs(x - laneX) > FORT_ARCH_HALF_W + 0.9) return null;
  return { owner, laneX };
}

/** Lane discipline: while a ground unit is inside a lava-river band or a
 *  fortress arch corridor, clamp its sideways position to the corridor's
 *  centre ± (corridor half-width − the unit's OWN radius). A T-Rex is nearly
 *  as wide as a bridge deck, so it threads dead-centre; small units keep a
 *  little natural wiggle but their bodies always stay on the stone. */
function laneDiscipline(st: GameState): void {
  if (worldOf(st) !== 'basalt') return;
  for (const raw of st.units) {
    if (raw.hp <= 0) continue;
    const stats = speciesDef(raw.species).stats!;
    if (stats.flying) {
      const tunnel = flyerTunnelLane(raw.x, raw.y);
      if (tunnel) raw.x = tunnel.laneX;
      continue;
    }
    let lanes: readonly [number, number] | null = null;
    let halfW = 0;
    if (raw.y > FORT_WALL_FRONT[0]) {
      lanes = FORT_LANES[0];
      halfW = FORT_ARCH_HALF_W;
    } else if (raw.y < FORT_WALL_FRONT[1]) {
      lanes = FORT_LANES[1];
      halfW = FORT_ARCH_HALF_W;
    } else {
      for (const owner of [0, 1] as const) {
        const band = RIVER_BANDS[owner];
        if (raw.y >= band.y0 && raw.y <= band.y1) {
          lanes = FORT_LANES[owner];
          halfW = BRIDGE_HALF_W;
        }
      }
    }
    if (!lanes) continue;
    const laneX = Math.abs(raw.x - lanes[0]) < Math.abs(raw.x - lanes[1]) ? lanes[0] : lanes[1];
    const play = Math.max(0.05, halfW - stats.radius);
    raw.x = Math.min(laneX + play, Math.max(laneX - play, raw.x));
  }
}

/** Soft separation: overlapping same-layer units push each other apart.
 *  Same-owner pairs bias the shove along the lane (Y) so bridges don't
 *  spray warriors sideways into lava / neighboring corridors. */
function separateUnits(st: GameState): void {
  const units = st.units.filter((u) => u.hp > 0);
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i];
      const b = units[j];
      const aFly = speciesDef(a.species).stats!.flying;
      const bFly = speciesDef(b.species).stats!.flying;
      if (aFly !== bFly) continue;
      const ra = speciesDef(a.species).stats!.radius;
      const rb = speciesDef(b.species).stats!.radius;
      const minD = ra + rb;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const push = (minD - d) / 2;
      let ux = dx / d;
      let uy = dy / d;
      // Same army: prefer column depth over lateral shove (anti-chaos).
      if (a.owner === b.owner && !aFly) {
        ux *= 0.35;
        uy = uy >= 0 ? Math.max(0.55, Math.abs(uy)) : -Math.max(0.55, Math.abs(uy));
        const len = Math.hypot(ux, uy) || 1;
        ux /= len;
        uy /= len;
      }
      const world = worldOf(st);
      const move = (u: UnitState, mx: number, my: number, fly: boolean) => {
        const nx = Math.max(0.2, Math.min(WORLD_W - 0.2, u.x + mx));
        const ny = Math.max(0.2, Math.min(WORLD_H - 0.2, u.y + my));
        if (fly || walkableAt(world, nx, ny)) {
          u.x = nx;
          u.y = ny;
        }
      };
      move(a, -ux * push, -uy * push, aFly);
      move(b, ux * push, uy * push, bFly);
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

  const berserk = u.species === 'honeybadger' && u.hp / u.maxHp < MECHANICS.badgerThreshold;
  u.buffs.berserk = berserk;
  if (berserk) u.buffs.stun = 0;
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
  if (u.unstick > 0) u.unstick--;

  // 1. Attack when a target is in reach — unless we are already on an enemy
  // gatehouse. Siege takes priority over chasing a distant skirmish so a
  // counter-push can chip a tower while the main fight rages elsewhere.
  // (Previously any aggro'd enemy cancelled siege entirely, which made
  // mutual gate trades impossible: the field winner deleted the loser,
  // then walked both towers unopposed.)
  const target = pickTarget(st, u);
  u.targetId = target?.id ?? null;
  const ob = enemyObelisk(st, u);
  const siegeReach = ob ? attackReach(u) + u.stats.radius + ob.r : 0;
  const canSiege = !!ob && dist2(u.x, u.y, ob.x, ob.y) <= siegeReach * siegeReach;
  const threatClose = target
    && dist2(u.x, u.y, target.x, target.y) <= (Math.max(1.05, u.stats.radius + speciesDef(target.species).stats!.radius + 0.35) ** 2);

  if (canSiege && !threatClose) {
    if (u.atkTimer <= 0) attackObelisk(st, ev, u, ob!);
    else u.facing = ob!.x >= u.x ? 1 : -1;
    u.stall = 0;
    u.stallRef = Infinity;
    return;
  }

  if (target && canAttack(st, u, target)) {
    if (u.atkTimer <= 0) performAttack(st, ev, u, target);
    else u.facing = target.x >= u.x ? 1 : -1;
    u.stall = 0;
    u.stallRef = Infinity;
    return;
  }

  // 1b. Walk onto the gate if we're close but not yet in reach and nothing
  // is in attack range.
  if (ob && !target) {
    const reach = attackReach(u) + u.stats.radius + ob.r;
    if (dist2(u.x, u.y, ob.x, ob.y) <= reach * reach) {
      if (u.atkTimer <= 0) attackObelisk(st, ev, u, ob);
      else u.facing = ob.x >= u.x ? 1 : -1;
      u.stall = 0;
      u.stallRef = Infinity;
      return;
    }
  }

  // 2. Otherwise move.
  const speed = effSpeed(st, u);
  if (speed <= 0) return;

  // Standing in the deep pond IS the Phase-2 objective — but only rest on
  // the prize when there is NO enemy to fight. A duel target always takes
  // priority, otherwise both armies camp their own bank and never clash.
  if (st.phase === 'oasis' && !target && !u.waypoint && isDeep(worldOf(st), u.x, u.y)) {
    u.stall = 0;
    return;
  }

  let goal: Vec2;
  if (target && u.unstick === 0) {
    // Lane discipline: a warrior still behind its own wall FINISHES ITS OWN
    // LANE first — through the tunnel or up over the rubble mound — and only
    // then crosses toward enemies in other lanes from the battlefield side.
    const behindOwnWall = u.owner === 0
      ? u.y > FORT_WALL_FRONT[0] + 0.05
      : u.y < FORT_WALL_FRONT[1] - 0.05;
    if (behindOwnWall) {
      const lanes = FORT_LANES[u.owner];
      const ownLane = Math.abs(u.x - lanes[0]) < Math.abs(u.x - lanes[1])
        ? lanes[0]
        : lanes[1];
      goal = {
        x: ownLane,
        y: u.owner === 0 ? FORT_WALL_FRONT[0] - 0.5 : FORT_WALL_FRONT[1] + 0.5,
      };
    } else if (
      // On the enemy half with a gate still standing: commit to the siege
      // unless a foe is in our face. This is what allows BOTH seats to chip
      // a tower in the same match instead of one midfield wipe deciding all.
      st.phase === 'basalt' && ob && !threatClose &&
      (u.owner === 0 ? u.y < WORLD_H * 0.48 : u.y > WORLD_H * 0.52)
    ) {
      goal = siegeGoal(ob);
    } else {
      goal = { x: target.x, y: target.y };
    }
  } else if (u.waypoint && dist2(u.x, u.y, u.waypoint.x, u.waypoint.y) > 0.16) {
    goal = u.waypoint;
  } else {
    u.waypoint = null;
    goal = st.phase === 'oasis'
      ? { x: WORLD_W / 2, y: WORLD_H / 2 }
      : ob
        ? siegeGoal(ob)
        : { x: u.x, y: u.owner === 0 ? FORT_WALL_FRONT[1] + 0.6 : FORT_WALL_FRONT[0] - 0.6 };
  }

  const before = { x: u.x, y: u.y };
  const moved = steerStep(st, u, goal.x, goal.y, speed);
  if (moved) {
    const step = dist(before.x, before.y, u.x, u.y);
    u.traveled += step;
    if (Math.abs(u.x - before.x) > 0.01) u.facing = u.x > before.x ? 1 : -1;
    u.action = 'move';
    if (u.waypoint && dist2(u.x, u.y, u.waypoint.x, u.waypoint.y) <= 0.16) u.waypoint = null;
    if (u.species === 'trex') {
      u.stompBank += step;
      if (u.stompBank >= MECHANICS.trexStompStride) {
        u.stompBank -= MECHANICS.trexStompStride;
        trexStomp(st, ev, u);
      }
    }
  } else {
    u.traveled = 0;
  }
  // Waypoint give-up: measured as NET progress (best distance so far), so
  // wall-wiggling can't masquerade as movement. A fling that lands behind a
  // wall the fine grid can't cross is abandoned after ~3 s and the unit
  // marches on the phase objective instead of grinding at a chokepoint.
  if (u.waypoint) {
    const dw = dist(u.x, u.y, u.waypoint.x, u.waypoint.y);
    if (dw < u.stallRef - 0.05) {
      u.stallRef = dw;
      u.stall = 0;
    } else {
      u.stall++;
      if (u.stall >= 10) {
        u.waypoint = null;
        u.stall = 0;
        u.stallRef = Infinity;
      }
    }
  } else if (target && u.unstick === 0 && !moved) {
    // Chase-lock wedge: steering has HARD-FAILED (not wiggled — failed) for
    // 3 s straight while holding a target. Break off the chase for ~4 s so
    // movement falls back to the corridor-routed siege march, which walks
    // the unit around the river instead of leaving it planted at the bank
    // until an enemy happens to wander into attack range.
    u.stall++;
    u.stallRef = Infinity;
    if (u.stall >= 10) {
      u.stall = 0;
      u.unstick = 14;
    }
  } else {
    u.stall = 0;
    u.stallRef = Infinity;
  }
}

/* ------------------------------------------------------------------------ */
/* Phase orchestration                                                        */
/* ------------------------------------------------------------------------ */

function scoreTerritory(st: GameState): void {
  for (const u of st.units) {
    if (u.hp <= 0) continue;
    const depth = u.owner === 0
      ? Math.max(0, WORLD_H / 2 - u.y)
      : Math.max(0, u.y - WORLD_H / 2);
    st.players[u.owner].territoryScore += depth;
  }
}

/** Phase-1 dominance = share of obelisk damage dealt (the towers ARE the
 *  scoreboard). Destroying one is a hard 1.0/0.0; ties fall back to combat
 *  damage share. */
function computeDominance(st: GameState): number {
  const wings0 = st.obelisks.filter((o) => o.owner === 0);
  const wings1 = st.obelisks.filter((o) => o.owner === 1);
  if (wings0.length > 0 && wings1.length > 0) {
    const razed0 = wings0.every((o) => o.hp <= 0);
    const razed1 = wings1.every((o) => o.hp <= 0);
    if (razed1 && !razed0) return 1;
    if (razed0 && !razed1) return 0;
    // No fortress fully razed (timer safety valve): score by siege damage,
    // weighting each crumbled gatehouse as its full HP.
    const dealtByP0 = wings1.reduce((s, o) => s + (o.maxHp - Math.max(0, o.hp)), 0);
    const dealtByP1 = wings0.reduce((s, o) => s + (o.maxHp - Math.max(0, o.hp)), 0);
    if (dealtByP0 + dealtByP1 > 0 && !(razed0 && razed1)) {
      return dealtByP0 / (dealtByP0 + dealtByP1);
    }
  }
  const p0 = st.players[0];
  const p1 = st.players[1];
  const dmgTotal = p0.damageDealt + p1.damageDealt;
  return dmgTotal > 0 ? p0.damageDealt / dmgTotal : 0.5;
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
  // Survivors form marching columns home THROUGH their own gates — the
  // renderer plays the exodus cutscene over these ticks.
  for (const u of st.units) {
    if (u.hp <= 0) continue;
    const lanes = FORT_LANES[u.owner];
    const lane = Math.abs(u.x - lanes[0]) < Math.abs(u.x - lanes[1]) ? lanes[0] : lanes[1];
    u.waypoint = { x: lane, y: u.owner === 0 ? WORLD_H - 1.4 : 1.4 };
    u.stall = 0;
    u.stallRef = Infinity;
    u.targetId = null;
  }
  ev.push({ type: 'phaseChange', phase: 'transition' });
}

function tickTransitionMarch(st: GameState): void {
  // Units stream toward their own edge, unopposed, for the cutscene.
  for (const raw of st.units) {
    if (raw.hp <= 0) continue;
    const u = rt(raw);
    u.px = u.x;
    u.py = u.y;
    const gy = u.owner === 0 ? WORLD_H - 1 : 1;
    steerStep(st, u, u.x, gy, Math.max(0.22, u.stats.speed * 1.6));
    u.action = 'move';
    u.facing = u.owner === 0 ? 1 : -1;
  }
}

function beginOasis(st: GameState, ev: GameEvent[]): void {
  st.phase = 'oasis';
  st.phaseTicksLeft = st.cfg.phase2Ticks;
  st.zones = [];
  st.projectiles = [];
  st.pendingLava = [];
  st.props = oasisProps();
  st.obelisks = [];

  // Survivors re-enter from their own edge, HP intact, marching on the pond.
  const survivors = st.units.filter((u) => u.hp > 0);
  st.units = [];
  let lane = 0;
  for (const u of survivors) {
    const col = 1.4 + (lane % 6) * 1.25;
    const row = u.owner === 0 ? WORLD_H - 1.6 - Math.floor(lane / 6) * 0.9 : 1.6 + Math.floor(lane / 6) * 0.9;
    lane++;
    u.x = col;
    u.y = row;
    u.px = col;
    u.py = row;
    u.waypoint = { x: WORLD_W / 2, y: WORLD_H / 2 };
    u.stall = 0;
    u.stallRef = Infinity;
    u.buffs = freshBuffs();
    if (st.players[u.owner].blessed) u.buffs.blessed = true;
    u.action = 'spawn';
    u.targetId = null;
    st.units.push(u);
    ev.push({ type: 'spawn', unitId: u.id, species: u.species, owner: u.owner, x: u.x, y: u.y });
  }
  ev.push({ type: 'phaseChange', phase: 'oasis' });
}

function tickCapture(st: GameState, ev: GameEvent[]): void {
  let p0 = 0;
  let p1 = 0;
  const world = worldOf(st);
  for (const u of st.units) {
    if (u.hp <= 0) continue;
    if (!isWater(world, u.x, u.y)) continue;
    const weight = isDeep(world, u.x, u.y) ? 2 : 1;
    if (u.owner === 0) p0 += weight;
    else p1 += weight;
  }
  if (p0 > p1) st.captureMeter = Math.min(100, st.captureMeter + CAPTURE_RATE);
  else if (p1 > p0) st.captureMeter = Math.max(-100, st.captureMeter - CAPTURE_RATE);
  // Decisive claim: fill the meter and the pond is yours — game over early.
  if (Math.abs(st.captureMeter) >= 100 && st.phase === 'oasis') {
    const claimant: PlayerId = st.captureMeter > 0 ? 0 : 1;
    ev.push({ type: 'pondClaimed', player: claimant });
    endGame(st, ev);
  }
}

function endGame(st: GameState, ev: GameEvent[]): void {
  st.phase = 'ended';
  if (st.captureMeter > 0) st.winner = 0;
  else if (st.captureMeter < 0) st.winner = 1;
  else st.winner = 'tie';
  ev.push({ type: 'gameOver', winner: st.winner });
}

/* ------------------------------------------------------------------------ */
/* THE TICK                                                                   */
/* ------------------------------------------------------------------------ */

export function advanceTick(st: GameState, inputs: PlayerInput[]): TickResult {
  const ev: GameEvent[] = [];
  if (st.phase === 'ended') return { state: st, events: ev };

  st.tick++;

  const income = st.phase === 'oasis' ? AQUA_PER_TICK_P2 : AQUA_PER_TICK_P1;
  if (st.phase !== 'transition') {
    for (const p of st.players) p.aqua = Math.min(AQUA_MAX, p.aqua + income);
  }

  // Inputs, deterministically ordered with alternating seat priority.
  const first = st.tick % 2;
  const sorted = [...inputs].sort(
    (a, b) => (a.player === first ? -1 : 1) - (b.player === first ? -1 : 1) || a.seq - b.seq,
  );
  if (st.phase === 'basalt' || st.phase === 'oasis') {
    for (const input of sorted) applyInput(st, ev, input);
  }

  resolveLavaRain(st, ev);

  if (st.phase === 'basalt' || st.phase === 'oasis') {
    const order = [...st.units].sort(
      (a, b) => (a.owner === first ? -1 : 1) - (b.owner === first ? -1 : 1) || a.id - b.id,
    );
    for (const u of order) {
      if (u.hp > 0) tickUnit(st, ev, u);
    }
    tickProjectiles(st, ev);
    separateUnits(st);
    laneDiscipline(st);
    for (const u of st.units) if (u.hp > 0) applyFieldEffects(st, ev, rt(u));
    applyZoneEffects(st, ev);
  } else if (st.phase === 'transition') {
    tickTransitionMarch(st);
  }

  st.units = st.units.filter((u) => u.hp > 0);

  if (st.phase === 'basalt') scoreTerritory(st);
  if (st.phase === 'oasis') tickCapture(st, ev);

  // The Basalt Fields end only when a fortress has lost BOTH gatehouses —
  // a decisive phase-1 victory that carries the Blessing into the Oasis.
  if (st.phase === 'basalt' && ([0, 1] as const).some((seat) =>
    st.obelisks.filter((o) => o.owner === seat).every((o) => o.hp <= 0))) {
    beginTransition(st, ev);
  }

  st.phaseTicksLeft--;
  if (st.phaseTicksLeft <= 0) {
    if (st.phase === 'basalt') beginTransition(st, ev);
    else if (st.phase === 'transition') beginOasis(st, ev);
    else if (st.phase === 'oasis') endGame(st, ev);
  }

  return { state: st, events: ev };
}

/* ============================================================================
 * TickDriver — real-time pacing, async input queueing, rewind/replay.
 *
 * Battle pacing can phase-lock to the soundtrack's 8th-note grid (one tick =
 * MUSIC_TICK_SEC = TICK_MS/1000) via an injected TickClock. Sim contents stay
 * tick-authoritative; only wall-clock wake times move. Without a clock we
 * fall back to a plain interval (tests / non-audio hosts).
 * ========================================================================== */

export interface DriverCallbacks {
  onTick: (result: TickResult) => void;
  sendInput?: (input: PlayerInput) => void;
}

/** Optional audio/performance clock for phase-locking ticks to music. */
export interface TickClock {
  /** Current time in seconds (AudioContext.currentTime or performance). */
  now: () => number;
  /** Time corresponding to tick 0; tick k fires at origin + k * (TICK_MS/1000). */
  phaseOrigin: number;
  /** Snap a time down onto the shared 8th grid (used after long hitches). */
  align?: (t: number) => number;
}

export class TickDriver {
  state: GameState;
  private inputQueue = new Map<number, PlayerInput[]>();
  private history: Array<{ tick: number; snapshot: string }> = [];
  private appliedInputs: PlayerInput[] = [];
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private cb: DriverCallbacks;
  private accumulatedEvents: GameEvent[] = [];
  private clock: TickClock | null = null;
  private running = false;
  private onVis: (() => void) | null = null;

  constructor(seed: number, factions: [FactionId, FactionId], cb: DriverCallbacks, cfg?: PhaseConfig) {
    resetIds();
    this.state = createGame(seed, factions, cfg);
    this.cb = cb;
  }

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

  receiveRemote(input: PlayerInput): void {
    if (input.tick <= this.state.tick) {
      this.rewindAndReplay(input);
    } else {
      this.enqueue(input);
    }
  }

  private enqueue(input: PlayerInput): void {
    const list = this.inputQueue.get(input.tick) ?? [];
    if (list.some((i) => i.player === input.player && i.seq === input.seq)) return;
    list.push(input);
    this.inputQueue.set(input.tick, list);
  }

  private rewindAndReplay(lateInput: PlayerInput): void {
    const snap = [...this.history].reverse().find((h) => h.tick < lateInput.tick);
    if (!snap) {
      this.enqueue({ ...lateInput, tick: this.state.tick + 1 });
      return;
    }
    const currentTick = this.state.tick;
    this.state = JSON.parse(snap.snapshot) as GameState;
    const replay = this.appliedInputs.filter((i) => i.tick > snap.tick);
    replay.push(lateInput);
    for (const i of replay) this.enqueue(i);
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

  /**
   * Start real-time pacing. Pass a TickClock (from music.battleTickPhase) to
   * phase-lock sim ticks onto the soundtrack's 8th-note grid. Omitting the
   * clock keeps the classic setInterval fallback.
   */
  start(clock?: TickClock): void {
    if (this.running) return;
    this.running = true;
    this.clock = clock ?? null;
    if (this.clock) {
      this.armNextTick();
      this.onVis = () => this.reanchorIfStale();
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', this.onVis);
      }
    } else {
      this.timer = setInterval(() => this.stepOnce(), TICK_MS);
    }
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
    if (this.onVis && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVis);
    }
    this.onVis = null;
    this.clock = null;
  }

  /** Ideal wall time (sec) when tick `k` should fire. */
  private deadlineFor(k: number): number {
    const tickSec = TICK_MS / 1000;
    return (this.clock?.phaseOrigin ?? 0) + k * tickSec;
  }

  private armNextTick(): void {
    if (!this.running || !this.clock) return;
    if (this.timeout) clearTimeout(this.timeout);
    this.reanchorIfStale();
    const now = this.clock.now();
    const nextTick = this.state.tick + 1;
    const due = this.deadlineFor(nextTick);
    // Never dump a multi-tick burst: minimum delay keeps catch-up one-at-a-time.
    const delayMs = Math.max(4, (due - now) * 1000);
    this.timeout = setTimeout(() => {
      this.timeout = null;
      if (!this.running) return;
      this.stepOnce();
      this.armNextTick();
    }, delayMs);
  }

  /**
   * After a long hitch (background tab), redefine phaseOrigin so the current
   * tick maps onto the latest grid line — no skipped/doubled sim ticks.
   */
  private reanchorIfStale(): void {
    if (!this.clock) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const tickSec = TICK_MS / 1000;
    const now = this.clock.now();
    const expected = this.deadlineFor(this.state.tick);
    const lagSec = now - expected;
    if (lagSec <= tickSec * 2) return;
    const aligned = this.clock.align ? this.clock.align(now) : now;
    this.clock.phaseOrigin = aligned - this.state.tick * tickSec;
  }
}

/* ============================================================================
 * Scripted opponent for Local Guest Mode.
 * ========================================================================== */

export class BotBrain {
  private rng: () => number;
  private nextActionTick = 0;
  constructor(private seat: PlayerId, seed: number) {
    this.rng = makeRng(seed ^ 0xb07);
  }

  think(st: GameState): PlayerInput['action'] | null {
    if (st.phase !== 'basalt' && st.phase !== 'oasis') return null;
    if (st.tick < this.nextActionTick) return null;
    if (st.tick % 2 !== 0) return null;
    const me = st.players[this.seat];
    // Near the aqua cap every idle beat wastes income — spend with urgency.
    const flush = me.aqua >= 7;

    const lavaInHand = me.hand.includes(LAVA_RAIN_CARD);
    if (lavaInHand && me.aqua >= cardDef(LAVA_RAIN_CARD, st.phase).cost) {
      const enemies = st.units.filter((u) => u.hp > 0 && u.owner !== this.seat && isCombatVisible(st, u));
      if (enemies.length >= 2) {
        let best: Vec2 | null = null;
        let bestScore = 2;
        for (const e of enemies) {
          const score = enemies.filter((o) => dist2(o.x, o.y, e.x, e.y) <= 1.7 * 1.7).length;
          if (score > bestScore) {
            bestScore = score;
            best = { x: e.x, y: e.y };
          }
        }
        if (best && (bestScore >= 3 || (this.rng() < 0.55 && bestScore >= 2))) {
          this.nextActionTick = st.tick + 4;
          return { type: 'spell', card: LAVA_RAIN_CARD, x: best.x, y: best.y };
        }
      }
    }

    // Relentless pressure: no idle beats — if the bot can act, it acts.
    if (me.aqua < 2) return null;
    if (armySize(st, this.seat) >= currentArmyCap(st)) return null;

    const affordable = me.hand.filter((c) => cardDef(c, st.phase).cost <= me.aqua);
    if (affordable.length === 0) return null;
    // Score the hand: bigger bodies lead, with light counter-awareness —
    // anti-air against flyers, air pressure when the foe can't answer it.
    // Jitter keeps the bot human (reads, not scripts).
    const foes = st.units.filter((u) => u.hp > 0 && u.owner !== this.seat);
    const foeFlyers = foes.filter((u) => !!speciesDef(u.species).stats?.flying).length;
    const foeAntiAir = foes.some((u) => !!speciesDef(u.species).stats?.canHitAir);
    const scored = affordable.map((c) => {
      const d = cardDef(c, st.phase);
      let s = d.cost + this.rng() * 1.8;
      if (d.kind === 'unit') {
        if (foeFlyers > 0 && d.stats?.canHitAir) s += 2;
        if (!foeAntiAir && d.stats?.flying) s += 1.5;
      }
      return { c, s };
    });
    scored.sort((a, b) => b.s - a.s);
    const pick = scored[0].c as CardId;
    const def = cardDef(pick, st.phase);

    if (def.kind === 'spell' && pick !== LAVA_RAIN_CARD) {
      const enemies = st.units.filter((u) => u.hp > 0 && u.owner !== this.seat && isCombatVisible(st, u));
      if (enemies.length === 0) return null;
      // Aim at the densest knot — a random single target wasted the cast.
      let best = enemies[0];
      let bestN = 0;
      for (const e of enemies) {
        const n = enemies.filter((o) => dist2(o.x, o.y, e.x, e.y) <= 1.6 * 1.6).length;
        if (n > bestN) {
          bestN = n;
          best = e;
        }
      }
      if (bestN < 2 && !flush) return null; // hold it for a real clump
      this.nextActionTick = st.tick + 4;
      return { type: 'spell', card: pick, x: best.x, y: best.y };
    }
    if (def.kind === 'spell') return null;

    const dirY = this.seat === 0 ? -1 : 1;
    if (st.phase === 'basalt') {
      const pads = fortPads(this.seat);
      const wings = st.obelisks.filter((o) => o.owner !== this.seat && o.hp > 0);
      // Default: counter-siege the emptier lane so both fortresses take
      // pressure in the same match. Blind focus on the weakest wing made
      // both bots converge on one corridor — the winner razed both gates
      // and the loser never scored even one (0% 1–1 trades).
      let lane: 0 | 1 = this.rng() < 0.5 ? 0 : 1;
      if (foes.length > 0) {
        const c0 = foes.filter((u) => Math.abs(u.x - pads[0].x) <= Math.abs(u.x - pads[1].x)).length;
        const c1 = foes.length - c0;
        lane = c0 <= c1 ? 0 : 1;
      }
      // Commit to a crumbling wing (finishing blow).
      if (wings.length > 0 && this.rng() < 0.65) {
        const weakest = wings.reduce((a, b) => (b.hp < a.hp ? b : a));
        if (weakest.hp < weakest.maxHp * 0.55) lane = weakest.wing;
      }
      // Highest priority: defend a gate under real pressure.
      const myWings = st.obelisks.filter((o) => o.owner === this.seat && o.hp > 0);
      let danger: 0 | 1 | null = null;
      let dangerN = 0;
      for (const w of myWings) {
        const n = foes.filter((u) => dist2(u.x, u.y, w.x, w.y) <= 4.5 * 4.5).length;
        if (n > dangerN) {
          dangerN = n;
          danger = w.wing;
        }
      }
      if (danger !== null && dangerN >= 2 && this.rng() < 0.85) lane = danger;
      // Respect lane soft-cap so the bot doesn't invent mid-lane soup.
      const flying = !!def.stats?.flying;
      const chosen = preferDeployLane(st, this.seat, lane, flying, def.stats?.count ?? 1);
      if (chosen === null) return null;
      lane = chosen;
      const pad = pads[lane];
      this.nextActionTick = st.tick + 2;
      return { type: 'deploy', card: pick, x: pad.x, y: pad.y, dirX: 0, dirY };
    }
    const x = Math.max(0.8, Math.min(WORLD_W - 0.8, WORLD_W / 2 + (this.rng() - 0.5) * 5));
    const y = this.seat === 0
      ? WORLD_H - DEPLOY_DEPTH + 0.4 + this.rng() * (DEPLOY_DEPTH - 0.9)
      : 0.5 + this.rng() * (DEPLOY_DEPTH - 0.9);
    this.nextActionTick = st.tick + 2;
    return { type: 'deploy', card: pick, x, y, dirX: (this.rng() - 0.5) * 0.8, dirY };
  }
}
