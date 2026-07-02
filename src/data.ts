/* ============================================================================
 * VAALBARA: THE LAST OASIS — data.ts
 * Faction rosters, the 7-card deck matrix, and every tuned balance number.
 *
 * Balance philosophy (tick = 1.2 s, aqua caps at 10):
 *  - Cheap swarm (2 aqua) trades up vs single big targets but melts to AOE.
 *  - Tanks (6 aqua) anchor lanes and soak vents; they should survive ~10
 *    ticks of focused mid-tier DPS.
 *  - A full hand cycle costs ~15 aqua, i.e. one cycle every ~15 s in phase 1
 *    and ~7.5 s in the doubled-income Oasis, so phase 2 is a frantic climax.
 * ========================================================================== */

import type { CardDef, CardId, FactionId, SpeciesId, UnitStats } from './types';
import { PHASE_SPELL_CARD } from './types';

const U = (s: Partial<UnitStats> & Pick<UnitStats, 'hp' | 'dmg' | 'speed' | 'atkCd'>): UnitStats => ({
  range: 1,
  geometry: 'orth',
  flying: false,
  canHitAir: false,
  heavy: false,
  colossal: false,
  reflectPct: 0,
  count: 1,
  formation: 'single',
  ...s,
});

/* ------------------------------------------------------------------------ */
/* Team A — The Magma Vanguard                                                */
/* ------------------------------------------------------------------------ */

export const MAGMA_CARDS: CardDef[] = [
  {
    id: 'trex', name: 'T-Rex', title: 'Tyrant of the Ashfall', cost: 6, kind: 'unit', species: 'trex',
    stats: U({ hp: 350, dmg: 58, speed: 0.34, atkCd: 2, canHitAir: true, heavy: true, colossal: true }),
    blurb: 'Colossal tank. Every stride stamps the basalt, chipping all ground foes within 2 tiles. Chomps flyers from the sky.',
    hue: 8,
  },
  {
    id: 'lion', name: 'Lion', title: 'Ember-Maned Commander', cost: 4, kind: 'unit', species: 'lion',
    stats: U({ hp: 158, dmg: 40, speed: 0.6, atkCd: 1 }),
    blurb: 'High-damage commander. His deployment roar freezes adjacent enemies solid for one tick.',
    hue: 35,
  },
  {
    id: 'eagle', name: 'Eagle', title: 'Cinder Talon', cost: 3, kind: 'unit', species: 'eagle',
    stats: U({ hp: 70, dmg: 30, speed: 1.0, atkCd: 1, flying: true, canHitAir: true }),
    blurb: 'High-speed air assassin. Soars over magma and blockers, hunting the weakest heart on the board.',
    hue: 20,
  },
  {
    id: 'honeybadger', name: 'Honey Badger', title: 'The Unkillable Grudge', cost: 3, kind: 'unit', species: 'honeybadger',
    stats: U({ hp: 120, dmg: 24, speed: 0.75, atkCd: 1 }),
    blurb: 'Fast berserker. Below 30% HP it snaps: double attack speed and total immunity to crowd control.',
    hue: 45,
  },
  {
    id: 'scorpion', name: 'Scorpion', title: 'Obsidian Flanker', cost: 3, kind: 'unit', species: 'scorpion',
    stats: U({ hp: 100, dmg: 28, speed: 0.6, atkCd: 1, geometry: 'diag' }),
    blurb: 'Strikes only on the diagonals, like a bishop with a grudge. Its first sting stuns for one tick.',
    hue: 285,
  },
  {
    id: 'fireants', name: 'Fire Ants', title: 'The Crawling Pyre', cost: 2, kind: 'unit', species: 'fireants',
    stats: U({ hp: 34, dmg: 9, speed: 0.75, atkCd: 1, count: 3, formation: 'line' }),
    blurb: 'Cheap swarm deployed as a line of three. Bites stack a burning acid debuff that eats through armour.',
    hue: 15,
  },
];

/* ------------------------------------------------------------------------ */
/* Team B — The Oasis Syndicate                                               */
/* ------------------------------------------------------------------------ */

export const OASIS_CARDS: CardDef[] = [
  {
    id: 'bear', name: 'Bear', title: 'Warden of the Shallows', cost: 6, kind: 'unit', species: 'bear',
    stats: U({ hp: 335, dmg: 48, speed: 0.34, atkCd: 2, canHitAir: true, heavy: true }),
    blurb: 'Heavy sweeping tank. Each swipe rakes the target tile plus both flanking tiles — and can swat flyers out of the air.',
    hue: 25,
  },
  {
    id: 'bighorn', name: 'Bighorn Sheep', title: 'The L-Shaped Comet', cost: 4, kind: 'unit', species: 'bighorn',
    stats: U({ hp: 152, dmg: 32, speed: 0.75, atkCd: 1, heavy: true }),
    blurb: 'Moves like a chess knight. After 3+ uninterrupted tiles, its first strike lands triple damage and a one-tile knockback.',
    hue: 90,
  },
  {
    id: 'bees', name: 'Swarm of Bees', title: 'The Humming Veil', cost: 3, kind: 'unit', species: 'bees',
    stats: U({ hp: 62, dmg: 15, speed: 0.9, atkCd: 1, flying: true, canHitAir: true }),
    blurb: 'Air support that ignores every ground block, hovering over enemies to smother their attack range down to a single tile.',
    hue: 50,
  },
  {
    id: 'wolves', name: 'Pack of Wolves', title: 'Twin Fang Doctrine', cost: 3, kind: 'unit', species: 'wolves',
    stats: U({ hp: 90, dmg: 22, speed: 0.9, atkCd: 1, count: 2, formation: 'pair' }),
    blurb: 'Skirmish pair. Wolves fighting from adjacent tiles feed off each other for +15% damage.',
    hue: 210,
  },
  {
    id: 'porcupine', name: 'Porcupine', title: 'The Thousand Needles', cost: 3, kind: 'unit', species: 'porcupine',
    stats: U({ hp: 185, dmg: 18, speed: 0.45, atkCd: 1, reflectPct: 0.2 }),
    blurb: 'Defensive tank. A fifth of every melee blow it takes is returned to the attacker as a face full of quills.',
    hue: 160,
  },
  {
    id: 'beetles', name: 'Bombardier Beetles', title: 'Chemical Artillery', cost: 3, kind: 'unit', species: 'beetles',
    stats: U({ hp: 80, dmg: 26, speed: 0.45, atkCd: 2, range: 4, geometry: 'line', canHitAir: true }),
    blurb: 'Anti-air ranged artillery firing boiling jets in straight lines. Impacts leave a caustic pool that slows ground tiles.',
    hue: 130,
  },
];

/* ------------------------------------------------------------------------ */
/* Spells                                                                     */
/* ------------------------------------------------------------------------ */

export const PHASE_SPELL_DEF: Record<'sulfur' | 'thicket', CardDef> = {
  sulfur: {
    id: PHASE_SPELL_CARD, name: 'Sulfur Cloud', title: 'Volcanic Sulfur Cloud', cost: 3, kind: 'spell',
    blurb: 'A choking 3x3 fog. Enemies inside crawl at half speed and cough away 3 HP per tick.',
    hue: 55,
  },
  thicket: {
    id: PHASE_SPELL_CARD, name: 'Thicket', title: 'Whispering Thicket', cost: 3, kind: 'spell',
    blurb: 'A temporary 3x3 stand of high grass. Friendly units vanish into total camouflage; enemies wade through at half pace.',
    hue: 110,
  },
};

export const LAVA_RAIN = {
  name: 'Lava Rain',
  title: 'Judgement of Old Vaalbara',
  blurb: 'Once per round. A 1.2 s shadow warns the sky is falling. Centre: annihilation (flyers doubly so). Mid-ring: heavy burns. Rim: a scalding kiss. Enemies only.',
  telegraphTicks: 1,
  centerDmg: 130,
  flyerCenterMult: 1.6,
  midDmg: 65,
  rimDmg: 25,
  hue: 12,
};

export const SPELL_BALANCE = {
  sulfur: { duration: 10, slowMult: 0.5, chip: 3, radius: 1 },
  thicket: { duration: 12, slowMult: 0.5, radius: 1 },
  acidpool: { duration: 5, slowMult: 0.6, radius: 1 },
  healmist: { duration: 1, radius: 1 },
};

/* ------------------------------------------------------------------------ */
/* Deck helpers                                                               */
/* ------------------------------------------------------------------------ */

export const FACTIONS: Record<FactionId, { name: string; tagline: string; hue: number; cards: CardDef[] }> = {
  magma: {
    name: 'The Magma Vanguard',
    tagline: 'Forged in the fissures. Tempered in fire.',
    hue: 14,
    cards: MAGMA_CARDS,
  },
  oasis: {
    name: 'The Oasis Syndicate',
    tagline: 'Water remembers. Water collects.',
    hue: 165,
    cards: OASIS_CARDS,
  },
};

const CARD_INDEX: Map<string, CardDef> = new Map();
for (const c of [...MAGMA_CARDS, ...OASIS_CARDS]) CARD_INDEX.set(c.id, c);

/** Resolve a card id to its definition. Phase spell resolves per game phase. */
export function cardDef(id: CardId, phase: 'basalt' | 'transition' | 'oasis' | 'ended'): CardDef {
  if (id === PHASE_SPELL_CARD) {
    return phase === 'oasis' || phase === 'ended' ? PHASE_SPELL_DEF.thicket : PHASE_SPELL_DEF.sulfur;
  }
  const def = CARD_INDEX.get(id);
  if (!def) throw new Error(`Unknown card: ${id}`);
  return def;
}

export function speciesDef(id: SpeciesId): CardDef {
  const def = CARD_INDEX.get(id);
  if (!def) throw new Error(`Unknown species: ${id}`);
  return def;
}

/** The full 7-card deck for a faction: 6 units + the shifting phase spell. */
export function buildDeck(faction: FactionId): CardId[] {
  return [...FACTIONS[faction].cards.map((c) => c.id), PHASE_SPELL_CARD];
}

/** Species-specific mechanic constants, kept together for tuning at a glance. */
export const MECHANICS = {
  trexStompDmg: 8,
  trexStompRadius: 2,
  lionFreezeTicks: 1,
  badgerThreshold: 0.3,
  scorpionStunTicks: 1,
  bearSweep: true,
  bighornChargeTiles: 3,
  bighornChargeMult: 3,
  beesRangeCapTicks: 2,
  wolvesAdjacencyBonus: 0.15,
  acidBurnTicks: 3,
  acidMaxStacks: 4,
};
