/* ============================================================================
 * VAALBARA: THE LAST OASIS — data.ts
 * Faction rosters, the 7-card deck matrix, and every tuned balance number.
 *
 * Balance philosophy (tick = 300 ms, continuous world, aqua caps at 10):
 *  - Cheap swarm (2 aqua) trades up vs single big targets but melts to AOE.
 *  - Tanks (6 aqua) anchor lanes; they survive ~15 s of mid-tier focus.
 *  - Income of 1 aqua / ~3.75 s (faster in the Oasis) plus the 4-unit army
 *    cap keeps the field a handful of readable duels, not a mob.
 *  - HP curves run generous so every engagement plays out long enough to
 *    watch, react to and counter.
 * ========================================================================== */

import type { CardDef, CardId, FactionId, SpeciesId, UnitStats } from './types';
import { PHASE_SPELL_CARD } from './types';

const U = (s: Partial<UnitStats> & Pick<UnitStats, 'hp' | 'dmg' | 'speed' | 'atkCd'>): UnitStats => ({
  range: 0.95,
  ranged: false,
  flying: false,
  canHitAir: false,
  heavy: false,
  colossal: false,
  radius: 0.34,
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
    stats: U({ hp: 520, dmg: 58, speed: 0.11, atkCd: 8, range: 1.1, canHitAir: true, heavy: true, colossal: true, radius: 0.55 }),
    blurb: 'Colossal tank. Every few strides stamps the ground, chipping nearby foes. Chomps flyers from the sky.',
    hue: 8,
  },
  {
    id: 'lion', name: 'Lion', title: 'Ember-Maned Commander', cost: 4, kind: 'unit', species: 'lion',
    stats: U({ hp: 235, dmg: 40, speed: 0.2, atkCd: 4, radius: 0.4 }),
    blurb: 'High-damage commander. His deployment roar freezes nearby enemies solid.',
    hue: 35,
  },
  {
    id: 'eagle', name: 'Eagle', title: 'Cinder Talon', cost: 3, kind: 'unit', species: 'eagle',
    stats: U({ hp: 105, dmg: 30, speed: 0.32, atkCd: 4, flying: true, canHitAir: true, radius: 0.32 }),
    blurb: 'High-speed air assassin. Soars over lava and blockers, hunting the weakest heart on the field.',
    hue: 20,
  },
  {
    id: 'honeybadger', name: 'Honey Badger', title: 'The Unkillable Grudge', cost: 3, kind: 'unit', species: 'honeybadger',
    stats: U({ hp: 180, dmg: 24, speed: 0.25, atkCd: 4, radius: 0.32 }),
    blurb: 'Fast berserker. Below 30% HP it snaps: double attack speed and total immunity to crowd control.',
    hue: 45,
  },
  {
    id: 'scorpion', name: 'Scorpion', title: 'Obsidian Flanker', cost: 3, kind: 'unit', species: 'scorpion',
    stats: U({ hp: 150, dmg: 28, speed: 0.2, atkCd: 4, range: 1.05, radius: 0.36 }),
    blurb: 'A circling flanker whose first sting on every victim stuns them cold.',
    hue: 285,
  },
  {
    id: 'fireants', name: 'Fire Ants', title: 'The Crawling Pyre', cost: 2, kind: 'unit', species: 'fireants',
    stats: U({ hp: 52, dmg: 9, speed: 0.24, atkCd: 4, radius: 0.24, count: 3, formation: 'line' }),
    blurb: 'Cheap swarm deployed as a trio. Bites stack a burning acid debuff that eats through armour.',
    hue: 15,
  },
];

/* ------------------------------------------------------------------------ */
/* Team B — The Oasis Syndicate                                               */
/* ------------------------------------------------------------------------ */

export const OASIS_CARDS: CardDef[] = [
  {
    id: 'bear', name: 'Bear', title: 'Warden of the Shallows', cost: 6, kind: 'unit', species: 'bear',
    stats: U({ hp: 530, dmg: 56, speed: 0.12, atkCd: 8, range: 1.1, canHitAir: true, heavy: true, radius: 0.52 }),
    blurb: 'Heavy sweeping tank. Each swipe rakes everything beside its target — and it rears up to swat flyers out of the air.',
    // Forest green (matches the cinematic) — hue 25 read as a Magma card.
    hue: 140,
  },
  {
    id: 'bighorn', name: 'Bighorn Sheep', title: 'The Emerald Comet', cost: 4, kind: 'unit', species: 'bighorn',
    stats: U({ hp: 240, dmg: 34, speed: 0.26, atkCd: 4, heavy: true, radius: 0.42 }),
    blurb: 'A charger. After 3+ unbroken strides at full gallop, its first strike lands triple damage and hurls the victim back.',
    hue: 90,
  },
  {
    id: 'bees', name: 'Swarm of Bees', title: 'The Humming Veil', cost: 3, kind: 'unit', species: 'bees',
    stats: U({ hp: 104, dmg: 18, speed: 0.31, atkCd: 4, flying: true, canHitAir: true, radius: 0.34 }),
    blurb: 'Air support that ignores every ground block, smothering victims until they can barely reach past their own nose.',
    hue: 50,
  },
  {
    id: 'wolves', name: 'Pack of Wolves', title: 'Twin Fang Doctrine', cost: 3, kind: 'unit', species: 'wolves',
    stats: U({ hp: 155, dmg: 27, speed: 0.32, atkCd: 4, radius: 0.34, count: 2, formation: 'pair' }),
    blurb: 'Skirmish pair. Wolves fighting side by side feed off each other for +15% damage.',
    hue: 210,
  },
  {
    id: 'porcupine', name: 'Porcupine', title: 'The Thousand Needles', cost: 3, kind: 'unit', species: 'porcupine',
    stats: U({ hp: 290, dmg: 19, speed: 0.16, atkCd: 4, radius: 0.38, reflectPct: 0.2 }),
    blurb: 'Defensive tank. A fifth of every melee blow it takes is returned to the attacker as a face full of quills.',
    hue: 160,
  },
  {
    id: 'beetles', name: 'Bombardier Beetles', title: 'Chemical Artillery', cost: 3, kind: 'unit', species: 'beetles',
    stats: U({ hp: 140, dmg: 38, speed: 0.16, atkCd: 8, range: 4.4, ranged: true, canHitAir: true, radius: 0.36 }),
    blurb: 'Anti-air artillery. Fires a visible arc of boiling acid that bursts into a caustic, slowing pool.',
    hue: 130,
  },
];

/* ------------------------------------------------------------------------ */
/* Spells                                                                     */
/* ------------------------------------------------------------------------ */

export const PHASE_SPELL_DEF: Record<'sulfur' | 'thicket', CardDef> = {
  sulfur: {
    id: PHASE_SPELL_CARD, name: 'Sulfur Cloud', title: 'Volcanic Sulfur Cloud', cost: 3, kind: 'spell',
    blurb: 'A choking fog. Enemies inside crawl at half speed and cough away 1 HP per beat.',
    hue: 55,
  },
  thicket: {
    id: PHASE_SPELL_CARD, name: 'Thicket', title: 'Whispering Thicket', cost: 3, kind: 'spell',
    blurb: 'A temporary stand of high grass. Friendly units vanish into total camouflage; enemies wade through at half pace.',
    hue: 110,
  },
};

export const LAVA_RAIN = {
  name: 'Lava Rain',
  title: 'Judgement of Old Vaalbara',
  blurb: 'Once per round. A 1.2 s shadow warns the sky is falling. Centre: annihilation (flyers doubly so). Mid-ring: heavy burns. Rim: a scalding kiss. Enemies only.',
  telegraphTicks: 4,
  centerDmg: 130,
  flyerCenterMult: 1.6,
  midDmg: 65,
  rimDmg: 25,
  centerR: 0.8,
  midR: 1.7,
  rimR: 2.6,
  hue: 12,
};

export const SPELL_BALANCE = {
  sulfur: { duration: 33, slowMult: 0.5, chip: 1, radius: 1.5 },
  thicket: { duration: 40, slowMult: 0.5, radius: 1.5 },
  acidpool: { duration: 16, slowMult: 0.6, radius: 0.9 },
  healmist: { duration: 1, radius: 1.4 },
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
  trexStompDmg: 6,
  trexStompRadius: 1.8,
  /** T-Rex stomps once per world unit walked. */
  trexStompStride: 1.0,
  lionFreezeTicks: 4, // 1.2 s
  lionRoarRadius: 1.4,
  badgerThreshold: 0.3,
  scorpionStunTicks: 4, // 1.2 s
  bearSweepRadius: 1.0,
  bighornChargeDist: 3,
  bighornChargeMult: 3,
  bighornKnockback: 1.0,
  beesRangeCapTicks: 8, // 2.4 s
  beesRangeCap: 0.95,
  wolvesAdjacencyBonus: 0.15,
  wolvesAdjacencyRadius: 1.3,
  acidBurnTicks: 12, // ~3.6 s of burning
  acidMaxStacks: 4,
  /** Beetle acid jet: world units per tick, splash radius. */
  acidJetSpeed: 1.4,
  acidSplashRadius: 0.8,
};
