/* ============================================================================
 * VAALBARA: THE LAST OASIS — types.ts
 * Absolute strict coordinate and state contracts.
 *
 * The world is CONTINUOUS: positions are floats in a 9 x 15 world-unit space
 * (x grows right, y grows down; seat 0 deploys at the bottom band). Terrain
 * collision comes from navmask.ts, which is baked offline from the arena
 * paintings — the art IS the geometry.
 *
 * The simulation (engine.ts) is fully headless and deterministic: given the
 * same seed and the same ordered input stream it produces identical states on
 * every client.
 * ========================================================================== */

/**
 * Discrete server tick. 1 tick = 300 ms of real time.
 * Fine ticks + continuous positions let every character move and fight on
 * its own cadence while staying lockstep-replayable for multiplayer.
 */
export type Tick = number;

export const TICK_MS = 300;

/** World dimensions in world units (portrait: narrow and tall). */
export const WORLD_W = 9;
export const WORLD_H = 15;

/** Phase durations, in ticks (300 ms/tick). Phase 1 is a siege that ends
 *  when a fortress loses BOTH gatehouses, or at the 5:00 stalemate valve.
 *  Target: most matches reach ~5:00 with traded gatehouses (see balance-gates). */
export const PHASE1_TICKS = 1000; // 5:00
export const TRANSITION_TICKS = 20; // 6 s marching cutscene
export const PHASE2_TICKS = 500;

/** Player seat. Seat 0 deploys along the bottom band, seat 1 along the top. */
export type PlayerId = 0 | 1;

export type FactionId = 'magma' | 'oasis';

/** Continuous world position / vector. */
export interface Vec2 {
  x: number;
  y: number;
}

export type GamePhase = 'basalt' | 'transition' | 'oasis' | 'ended';

/* ------------------------------------------------------------------------ */
/* Cards & species                                                            */
/* ------------------------------------------------------------------------ */

export type SpeciesId =
  // Team A — The Magma Vanguard
  | 'trex'
  | 'lion'
  | 'eagle'
  | 'honeybadger'
  | 'scorpion'
  | 'fireants'
  // Team B — The Oasis Syndicate
  | 'bear'
  | 'bighorn'
  | 'bees'
  | 'wolves'
  | 'porcupine'
  | 'beetles';

export type SpellId = 'sulfur' | 'thicket' | 'lavarain';

/** The 7th deck slot shifts identity with the game phase. */
export const PHASE_SPELL_CARD = 'phase-spell' as const;
/** Repeatable area-denial spell — fixed in every deck. */
export const LAVA_RAIN_CARD = 'lavarain' as const;
export type CardId = SpeciesId | typeof PHASE_SPELL_CARD | typeof LAVA_RAIN_CARD;

export interface UnitStats {
  readonly hp: number;
  readonly dmg: number;
  /** World units of movement per tick. */
  readonly speed: number;
  /** Ticks between attacks. */
  readonly atkCd: number;
  /** Attack reach in world units (melee ~0.9, artillery ~4). */
  readonly range: number;
  readonly ranged: boolean;
  readonly flying: boolean;
  readonly canHitAir: boolean;
  /** Heavy land units are slowed 40% in pond water. */
  readonly heavy: boolean;
  /** Colossal units are immune to knockback. */
  readonly colossal: boolean;
  /** Collision radius in world units. */
  readonly radius: number;
  /** % of incoming melee damage reflected to the attacker (porcupine). */
  readonly reflectPct: number;
  /** Units spawned per card play, and their formation. */
  readonly count: number;
  readonly formation: 'single' | 'line' | 'pair';
}

export interface CardDef {
  readonly id: CardId;
  readonly name: string;
  readonly title: string;
  readonly cost: number;
  readonly kind: 'unit' | 'spell';
  readonly species?: SpeciesId;
  readonly stats?: UnitStats;
  readonly blurb: string;
  /** Primary hue used for card art / particles (procedural palette). */
  readonly hue: number;
}

/* ------------------------------------------------------------------------ */
/* Live unit state                                                            */
/* ------------------------------------------------------------------------ */

export interface UnitBuffs {
  /** Remaining ticks of hard crowd control. */
  stun: number;
  /** Remaining ticks of slow, and its strength (0.5 = half speed). */
  slowTicks: number;
  slowMult: number;
  /** Stacking acid burn: stacks * ACID_DMG applied per tick while burning. */
  burnStacks: number;
  burnTicks: number;
  /** Bees hovering overhead cap this unit's range while > 0. */
  rangeCapTicks: number;
  /** Vaalbara Blessing: +10% speed & damage for phase 2. */
  blessed: boolean;
  /** Honey badger frenzy (computed, persisted for renderer/audio). */
  berserk: boolean;
}

export interface UnitState {
  readonly id: number;
  readonly owner: PlayerId;
  readonly species: SpeciesId;
  /** Continuous world position. */
  x: number;
  y: number;
  /** Position at the previous tick — renderer interpolates px,py -> x,y. */
  px: number;
  py: number;
  hp: number;
  maxHp: number;
  facing: 1 | -1;
  /** Ticks until the next attack is permitted. */
  atkTimer: number;
  /** World distance travelled without attacking/interruption (bighorn). */
  traveled: number;
  /** T-Rex: distance bank toward the next ground-stomp. */
  stompBank: number;
  /** Targets already hit once (first-strike effects). */
  struckTargets: number[];
  /** Fling waypoint from vector spawning; unit paths here before free AI. */
  waypoint: Vec2 | null;
  /** Ticks without net progress toward the waypoint (stuck detection). */
  stall: number;
  /** Best distance-to-waypoint achieved so far (progress reference). */
  stallRef: number;
  buffs: UnitBuffs;
  /** True while inside reeds / thicket and not revealed. */
  stealthed: boolean;
  /** Renderer hint: what this unit did during the last sim tick. */
  action: 'idle' | 'move' | 'attack' | 'spawn';
  targetId: number | null;
  /** Gate lane this warrior sortied from (0/1). Soft-cap and readability
   *  count by home wing so midfield drift doesn't invent a sixth body in one corridor. */
  homeWing: 0 | 1;
}

/* ------------------------------------------------------------------------ */
/* Projectiles (visible artillery: the beetle's acid jet)                     */
/* ------------------------------------------------------------------------ */

export interface ProjectileState {
  readonly id: number;
  readonly owner: PlayerId;
  readonly kind: 'acid';
  x: number;
  y: number;
  px: number;
  py: number;
  /** Straight-line velocity per tick. */
  vx: number;
  vy: number;
  dmg: number;
  ticksLeft: number;
  /** Homing lock — acid jets steer toward this unit each tick. */
  targetId?: number;
}

/* ------------------------------------------------------------------------ */
/* Zones (spell areas & residues) — circular, world units                     */
/* ------------------------------------------------------------------------ */

export type ZoneKind = 'sulfur' | 'thicket' | 'acidpool' | 'healmist';

export interface ZoneState {
  readonly id: number;
  readonly kind: ZoneKind;
  readonly owner: PlayerId;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  ticksLeft: number;
}

export interface PendingLavaRain {
  readonly owner: PlayerId;
  readonly x: number;
  readonly y: number;
  readonly resolveTick: Tick;
}

/* ------------------------------------------------------------------------ */
/* Authored props — hand-placed to match the arena paintings                  */
/* ------------------------------------------------------------------------ */

export interface PropState {
  readonly kind: 'vent' | 'reeds' | 'lotus';
  readonly x: number;
  readonly y: number;
  readonly r: number;
  /** Lotus blooms flip this when trampled. */
  destroyed: boolean;
}

/* ------------------------------------------------------------------------ */
/* Obelisks — the Phase-1 "towers". Each seat guards one; breaking the        */
/* enemy's wins the Basalt Fields outright.                                   */
/* ------------------------------------------------------------------------ */

export interface ObeliskState {
  readonly owner: PlayerId;
  /** Which gatehouse wing of the owner's fortress: 0 = left lane, 1 = right
   *  lane (in world coordinates, before any seat-view mirroring). */
  readonly wing: 0 | 1;
  hp: number;
  /** Grows when the sister wing falls (last-stand fortification surge). */
  maxHp: number;
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/* ------------------------------------------------------------------------ */
/* Player economy & hand cycling                                              */
/* ------------------------------------------------------------------------ */

export interface PlayerBoardState {
  readonly faction: FactionId;
  aqua: number;
  hand: CardId[];
  queue: CardId[];
  damageDealt: number;
  territoryScore: number;
  blessed: boolean;
}

/* ------------------------------------------------------------------------ */
/* Inputs — all async; execute on the NEXT tick                               */
/* ------------------------------------------------------------------------ */

export interface DeployAction {
  readonly type: 'deploy';
  readonly card: CardId;
  /** Baseline touch position (must be inside the seat's deploy band). */
  readonly x: number;
  readonly y: number;
  /** Normalised fling direction from the drag vector. */
  readonly dirX: number;
  readonly dirY: number;
}

export interface SpellAction {
  readonly type: 'spell';
  readonly card: CardId;
  readonly x: number;
  readonly y: number;
}

export type PlayerAction = DeployAction | SpellAction;

export interface PlayerInput {
  readonly seq: number;
  readonly player: PlayerId;
  readonly tick: Tick;
  readonly action: PlayerAction;
}

/* ------------------------------------------------------------------------ */
/* Events — consumed by renderer (particles) and audio (synth triggers)       */
/* ------------------------------------------------------------------------ */

export type GameEvent =
  | { type: 'spawn'; unitId: number; species: SpeciesId; owner: PlayerId; x: number; y: number }
  | { type: 'attack'; unitId: number; species: SpeciesId; owner: PlayerId; x: number; y: number; tx: number; ty: number; crit: boolean; air: boolean }
  | { type: 'hit'; unitId: number; x: number; y: number; amount: number; kind: 'melee' | 'ranged' | 'burn' | 'vent' | 'lava' | 'reflect' | 'stomp' }
  | { type: 'death'; unitId: number; species: SpeciesId; owner: PlayerId; x: number; y: number }
  | { type: 'heal'; x: number; y: number; amount: number }
  | { type: 'roar'; species: SpeciesId; x: number; y: number }
  | { type: 'stomp'; x: number; y: number }
  | { type: 'charge'; unitId: number; x: number; y: number }
  | { type: 'shoot'; unitId: number; x: number; y: number; tx: number; ty: number }
  | { type: 'splash'; x: number; y: number }
  | { type: 'spellCast'; spell: SpellId; owner: PlayerId; x: number; y: number }
  | { type: 'lavaTelegraph'; x: number; y: number }
  | { type: 'lavaStrike'; x: number; y: number }
  | { type: 'lotusBurst'; x: number; y: number }
  | { type: 'obeliskHit'; owner: PlayerId; amount: number; x: number; y: number }
  | { type: 'obeliskDown'; owner: PlayerId; x: number; y: number }
  | { type: 'pondClaimed'; player: PlayerId }
  | { type: 'phaseChange'; phase: GamePhase }
  | { type: 'blessing'; player: PlayerId }
  | { type: 'gameOver'; winner: PlayerId | 'tie' };

/* ------------------------------------------------------------------------ */
/* Root game state                                                            */
/* ------------------------------------------------------------------------ */

export interface PhaseConfig {
  readonly phase1Ticks: number;
  readonly phase2Ticks: number;
}

export interface GameState {
  readonly seed: number;
  readonly cfg: PhaseConfig;
  tick: Tick;
  phase: GamePhase;
  phaseTicksLeft: number;
  units: UnitState[];
  projectiles: ProjectileState[];
  zones: ZoneState[];
  props: PropState[];
  /** Phase-1 objectives: [seat 0's obelisk, seat 1's obelisk]. Empty in P2. */
  obelisks: ObeliskState[];
  pendingLava: PendingLavaRain[];
  players: [PlayerBoardState, PlayerBoardState];
  /** Phase-2 capture meter, range [-100, +100]; positive favours player 0. */
  captureMeter: number;
  winner: PlayerId | 'tie' | null;
  dominanceP0: number;
}

export interface TickResult {
  state: GameState;
  events: GameEvent[];
}

/* ------------------------------------------------------------------------ */
/* Meta / app-level contracts                                                 */
/* ------------------------------------------------------------------------ */

export type Screen =
  | 'boot'
  | 'cinematic'
  | 'menu'
  | 'faction'
  | 'matchmaking'
  | 'game'
  | 'results'
  | 'duel-setup'
  | 'duel';

export interface Profile {
  name: string;
  wins: number;
  losses: number;
  ties: number;
  games: number;
  favouriteFaction: FactionId;
}

export type MatchMode = 'local' | 'online-host' | 'online-guest';

export interface MatchConfig {
  mode: MatchMode;
  seed: number;
  localSeat: PlayerId;
  factions: [FactionId, FactionId];
  roomId?: string;
}

/* Helpers ------------------------------------------------------------------ */

export const inWorld = (x: number, y: number): boolean =>
  x >= 0 && x < WORLD_W && y >= 0 && y < WORLD_H;

/** Deploy band depth (world units from a seat's own edge). */
export const DEPLOY_DEPTH = 3;
export const inDeployBand = (player: PlayerId, y: number): boolean =>
  player === 0 ? y >= WORLD_H - DEPLOY_DEPTH : y < DEPLOY_DEPTH;

/* Phase-1 fortresses ------------------------------------------------------ */
/** Gate/lane x positions per fortress owner, measured from the painted lava
 *  bridges in the basalt arena: each fortress's arches sit EXACTLY on the
 *  bridges over the river guarding it, so gate → bridge → field is one
 *  straight believable march. (Bottom river bridges: 1.75 / 6.5; top river
 *  bridges: 2.6 / 7.28.) */
export const FORT_LANES: Record<PlayerId, readonly [number, number]> = {
  0: [1.75, 6.5],
  1: [2.6, 7.28],
};
/** Field-facing wall line of each fortress: seat 1 (top) wall front and
 *  seat 0 (bottom) wall front. Everything beyond is fortress interior. */
export const FORT_WALL_FRONT: Record<PlayerId, number> = { 0: 11.65, 1: 3.35 };
/** Half-width of the arch corridors carved through each wall — matches the
 *  PAINTED openings (measured ≈0.45–0.49 half-width), so a unit's centre can
 *  never sit behind visible stone. */
export const FORT_ARCH_HALF_W = 0.48;
/** Lava rivers as exact geometry (not colour-traced from the painting, which
 *  leaked through dark crust): each river is a solid blocked band crossed
 *  ONLY by the two painted bridges of the fortress it guards. The top band
 *  runs right up to the top fortress wall — the strip in front of that wall
 *  is painted river bank, so the two gate ledges are separate and a unit
 *  must return to mid-field to switch lanes. */
export const RIVER_BANDS: Record<PlayerId, { y0: number; y1: number }> = {
  1: { y0: FORT_WALL_FRONT[1], y1: 5.35 }, // guards the top fortress (seat 1)
  0: { y0: 9.35, y1: 10.7 },               // guards the bottom fortress (seat 0)
};
/** Walkable half-width of a bridge deck, kerb to kerb — matches the painted
 *  decks after their slight widening. */
export const BRIDGE_HALF_W = 0.6;
/** Wing bodies (the gatehouses units batter) sit just inside the wall. */
export const FORT_WING_Y: Record<PlayerId, number> = { 0: 12.4, 1: 2.6 };
export const FORT_WING_R = 0.85;
/** Tap-to-deploy pads: on the apron just outside your rear tunnel mouths —
 *  the pulsing rings must never sit inside the openings themselves. */
export const FORT_PAD_Y: Record<PlayerId, number> = { 0: 14.55, 1: 0.45 };
/** Where deployed units actually MATERIALISE: on the apron just OUTSIDE the
 *  fortress, so every warrior walks in through the rear tunnel mouth, under
 *  the building, and emerges from the gateway onto the field. */
export const FORT_SPAWN_Y: Record<PlayerId, number> = { 0: 14.7, 1: 0.55 };
export const fortPads = (seat: PlayerId): Array<{ x: number; y: number }> =>
  FORT_LANES[seat].map((x) => ({ x, y: FORT_PAD_Y[seat] }));

export const AQUA_MAX = 10;
/** Slow drip (1 aqua / ~3.75 s) keeps armies small: distinct duels, not mobs. */
export const AQUA_PER_TICK_P1 = 0.08;
export const AQUA_PER_TICK_P2 = 0.16; // doubles in the Oasis
export const HAND_SIZE = 4;
/** Absolute ceiling on living units per player. Early Phase 1 stays at
 *  ARMY_BASE_CAP; slots 7–8 unlock with the minute-4 / minute-5 acts so the
 *  field never opens as a mob. See armyCap(). */
export const MAX_ARMY = 8;
/** Readable early-game army size — about three fighters per siege lane. */
export const ARMY_BASE_CAP = 6;
/** Soft max ground units per lane per player. Extras deploy to the emptier
 *  gate so lanes stay duels, not bumping piles. */
export const LANE_SOFT_CAP = 4;

/**
 * Staged army cap from Basalt elapsed time (seconds).
 *  - Minutes 1–3: 6 (readable duels)
 *  - Start of minute 4 (t=3:00): 7
 *  - Start of minute 5 (t=4:00): 8
 * Oasis / transition keep the absolute ceiling so late answers still fit.
 */
export function armyCap(phase: 'basalt' | 'transition' | 'oasis' | 'ended', basaltElapsedSec = 0): number {
  if (phase !== 'basalt') return MAX_ARMY;
  if (basaltElapsedSec < 180) return ARMY_BASE_CAP;
  if (basaltElapsedSec < 240) return 7;
  return MAX_ARMY;
}
export const CAPTURE_RATE = 1;
/** Phase-1 objective: each seat's fortress has TWO gatehouse wings, each
 *  with its own HP. The Basalt Fields end only when a fortress loses both. */
/** First-gate HP. The remaining wing hardens after its sister falls
 *  (see dealObeliskDamage) so clean sweeps stay rare — especially once
 *  staged army slots 7–8 add late siege pressure. */
export const OBELISK_HP = 2050;

/** On a razed lane, warriors become combat-visible once they've climbed
 *  onto the causeway / rubble pile (depth from the field-side wall lip). */
export const RUBBLE_VISIBLE_DEPTH = 0.06;
export const OBELISK_RADIUS = 0.55;
/** Units only auto-acquire enemies inside this radius; otherwise they push
 *  the lane toward the enemy obelisk (Clash-Royale-style tower pressure). */
/** Units only auto-acquire enemies inside this radius; otherwise they push
 *  the lane toward the enemy gatehouse. Kept tight so opposite-lane armies
 *  don't vacuum into one midfield brawl — both fortresses can take pressure
 *  in the same match (the 1–1 gate trade). */
export const AGGRO_RANGE = 2.15;
export const VENT_DMG = 2;
export const ACID_DMG = 1; // per stack per tick
export const LOTUS_HEAL_PCT = 0.15;
export const BLESSING_MULT = 1.1;
