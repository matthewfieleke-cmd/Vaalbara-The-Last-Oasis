/* ============================================================================
 * VAALBARA: THE LAST OASIS — types.ts
 * Absolute strict coordinate and state contracts.
 * The simulation (engine.ts) is fully headless and deterministic: given the
 * same seed and the same ordered input stream it produces identical states on
 * every client. Everything the renderer / audio system needs is expressed as
 * plain serialisable data in this file.
 * ========================================================================== */

/** Discrete server tick. 1 tick = 1.2 seconds of real time. */
export type Tick = number;

export const TICK_MS = 1200;

/** Board dimensions (portrait: narrow and tall). */
export const BOARD_W = 9;
export const BOARD_H = 15;

/** Phase durations, in ticks. 5 min / 1.2 s = 250, 3 min / 1.2 s = 150. */
export const PHASE1_TICKS = 250;
export const TRANSITION_TICKS = 4;
export const PHASE2_TICKS = 150;

/** Player seat. Seat 0 deploys along the bottom rows, seat 1 along the top. */
export type PlayerId = 0 | 1;

export type FactionId = 'magma' | 'oasis';

/** Integer grid coordinate. x = column [0..BOARD_W), y = row [0..BOARD_H). */
export interface GridPos {
  readonly x: number;
  readonly y: number;
}

/** Continuous vector used for fling trajectories and particle work. */
export interface Vec2 {
  x: number;
  y: number;
}

/* ------------------------------------------------------------------------ */
/* Terrain                                                                    */
/* ------------------------------------------------------------------------ */

export type TerrainId =
  | 'basalt' // walkable dark rock (phase 1)
  | 'magma' // impassable to ground units, damages nothing (river)
  | 'vent' // sulfur vent: damages ground units that camp on it
  | 'grass' // walkable oasis meadow (phase 2)
  | 'sand' // walkable shoreline
  | 'shallow' // pond shallows: heavy land units slowed 40%
  | 'deep' // pond centre: heavy slowed, counts double for capture presence
  | 'reeds' // tall reeds: grants stealth to occupants
  | 'lily' // lily pad over deep water: collapses under Colossal units
  | 'lotus'; // breakable lotus bloom: releases 15% AOE healing mist

export interface TileState {
  terrain: TerrainId;
  /** Lily pads that have sunk / lotus blooms that were broken flip this. */
  destroyed: boolean;
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
export type CardId = SpeciesId | typeof PHASE_SPELL_CARD;

export type AttackGeometry =
  | 'orth' // orthogonally adjacent tiles (classic melee)
  | 'diag' // diagonally adjacent tiles only (scorpion)
  | 'any' // any tile within Chebyshev range
  | 'line'; // straight rank/file lines up to range (beetles artillery)

export interface UnitStats {
  readonly hp: number;
  readonly dmg: number;
  /** Tiles of movement gained per tick (fractional => moves every N ticks). */
  readonly speed: number;
  /** Ticks between attacks. 1 = attacks every tick. */
  readonly atkCd: number;
  readonly range: number;
  readonly geometry: AttackGeometry;
  readonly flying: boolean;
  readonly canHitAir: boolean;
  /** Heavy land units are slowed 40% in pond shallows. */
  readonly heavy: boolean;
  /** Colossal units sink lily pads and are immune to knockback. */
  readonly colossal: boolean;
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
  /** Bees hovering overhead cap this unit's range at 1 while > 0. */
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
  /** Current logical tile. */
  x: number;
  y: number;
  /** Tile occupied at the previous tick — renderer interpolates px,py -> x,y. */
  px: number;
  py: number;
  hp: number;
  maxHp: number;
  facing: 1 | -1;
  /** Fractional movement bank; >= 1 allows a step. */
  moveBank: number;
  /** Ticks until the next attack is permitted. */
  atkTimer: number;
  /** Tiles travelled without attacking or being interrupted (bighorn charge). */
  traveled: number;
  /** Whether this unit has already delivered its first strike per target. */
  struckTargets: number[];
  /** Fling waypoint from vector spawning; unit paths here before free AI. */
  waypoint: GridPos | null;
  buffs: UnitBuffs;
  /** True while occupying stealth terrain / thicket and not revealed. */
  stealthed: boolean;
  /** Renderer hint: what this unit did during the last sim tick. */
  action: 'idle' | 'move' | 'attack' | 'spawn';
  targetId: number | null;
}

/* ------------------------------------------------------------------------ */
/* Zones (spell areas & residues)                                             */
/* ------------------------------------------------------------------------ */

export type ZoneKind = 'sulfur' | 'thicket' | 'acidpool' | 'healmist';

export interface ZoneState {
  readonly id: number;
  readonly kind: ZoneKind;
  readonly owner: PlayerId;
  readonly x: number;
  readonly y: number;
  /** Half-extent: zone covers Chebyshev radius r around (x, y). */
  readonly r: number;
  ticksLeft: number;
}

export interface PendingLavaRain {
  readonly owner: PlayerId;
  readonly x: number;
  readonly y: number;
  /** Tick at which the strike resolves (telegraph shows until then). */
  readonly resolveTick: Tick;
}

/* ------------------------------------------------------------------------ */
/* Player economy & hand cycling                                              */
/* ------------------------------------------------------------------------ */

export interface PlayerBoardState {
  readonly faction: FactionId;
  aqua: number;
  /** Four active hand slots. */
  hand: CardId[];
  /** Cycle queue (3 cards); played cards go to the back. */
  queue: CardId[];
  ultUsed: boolean;
  damageDealt: number;
  territoryScore: number;
  /** Filled at the transition: winner of phase 1 gets the blessing. */
  blessed: boolean;
}

/* ------------------------------------------------------------------------ */
/* Inputs — all async; execute on the NEXT tick                               */
/* ------------------------------------------------------------------------ */

export interface DeployAction {
  readonly type: 'deploy';
  readonly card: CardId;
  /** Baseline touch tile. */
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

export interface UltAction {
  readonly type: 'ult';
  readonly x: number;
  readonly y: number;
}

export type PlayerAction = DeployAction | SpellAction | UltAction;

export interface PlayerInput {
  readonly seq: number;
  readonly player: PlayerId;
  /** Tick at which the action executes. */
  readonly tick: Tick;
  readonly action: PlayerAction;
}

/* ------------------------------------------------------------------------ */
/* Events — consumed by renderer (particles) and audio (synth triggers)       */
/* ------------------------------------------------------------------------ */

export type GameEvent =
  | { type: 'spawn'; unitId: number; species: SpeciesId; owner: PlayerId; x: number; y: number }
  | { type: 'attack'; unitId: number; species: SpeciesId; owner: PlayerId; x: number; y: number; tx: number; ty: number; crit: boolean }
  | { type: 'hit'; unitId: number; x: number; y: number; amount: number; kind: 'melee' | 'ranged' | 'burn' | 'vent' | 'lava' | 'reflect' | 'stomp' }
  | { type: 'death'; unitId: number; species: SpeciesId; owner: PlayerId; x: number; y: number }
  | { type: 'heal'; x: number; y: number; amount: number }
  | { type: 'roar'; species: SpeciesId; x: number; y: number }
  | { type: 'stomp'; x: number; y: number }
  | { type: 'charge'; unitId: number; x: number; y: number }
  | { type: 'spellCast'; spell: SpellId; owner: PlayerId; x: number; y: number }
  | { type: 'lavaTelegraph'; x: number; y: number }
  | { type: 'lavaStrike'; x: number; y: number }
  | { type: 'lotusBurst'; x: number; y: number }
  | { type: 'lilySink'; x: number; y: number }
  | { type: 'phaseChange'; phase: GamePhase }
  | { type: 'blessing'; player: PlayerId }
  | { type: 'gameOver'; winner: PlayerId | 'tie' };

/* ------------------------------------------------------------------------ */
/* Root game state                                                            */
/* ------------------------------------------------------------------------ */

/** Phase lengths live in state so overrides stay deterministic in replays. */
export interface PhaseConfig {
  readonly phase1Ticks: number;
  readonly phase2Ticks: number;
}

export interface GameState {
  readonly seed: number;
  readonly cfg: PhaseConfig;
  tick: Tick;
  phase: GamePhase;
  /** Ticks remaining in the current phase. */
  phaseTicksLeft: number;
  board: TileState[]; // BOARD_W * BOARD_H, row-major
  units: UnitState[];
  zones: ZoneState[];
  pendingLava: PendingLavaRain[];
  players: [PlayerBoardState, PlayerBoardState];
  /**
   * Phase-2 capture meter, range [-100, +100].
   * Positive favours player 0, negative favours player 1. 0 = perfect tie.
   */
  captureMeter: number;
  winner: PlayerId | 'tie' | null;
  /** Dominance snapshot computed at the transition (0..1 for player 0). */
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
  | 'results';

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
  /** Which seat the local player occupies. */
  localSeat: PlayerId;
  factions: [FactionId, FactionId];
  roomId?: string;
}

/* Helpers ------------------------------------------------------------------ */

export const idx = (x: number, y: number): number => y * BOARD_W + x;
export const inBounds = (x: number, y: number): boolean =>
  x >= 0 && x < BOARD_W && y >= 0 && y < BOARD_H;

/** Deploy zone rows for each seat. */
export const DEPLOY_ROWS: Record<PlayerId, readonly number[]> = {
  0: [BOARD_H - 3, BOARD_H - 2, BOARD_H - 1],
  1: [0, 1, 2],
};

export const AQUA_MAX = 10;
export const AQUA_PER_TICK_P1 = 1;
export const AQUA_PER_TICK_P2 = 2; // doubles in the Oasis
export const HAND_SIZE = 4;
export const CAPTURE_RATE = 4; // meter points per tick of pond majority
export const VENT_DMG = 7;
export const ACID_DMG = 4;
export const LOTUS_HEAL_PCT = 0.15;
export const BLESSING_MULT = 1.1;
