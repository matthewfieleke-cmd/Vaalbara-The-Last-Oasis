/* ============================================================================
 * VAALBARA — duel.ts
 * The Duels mode engine: Pokémon-style champion battles between the two
 * coalitions. All six warriors per side fight one at a time; KO damage
 * carries over for the survivor, the fresh challenger enters at full
 * strength. Combat runs in discrete "exchanges": both sides lock an intent
 * (Strike / Guard / Special) and the engine resolves them into an ordered
 * event script the stage choreographs.
 *
 * Intent triangle (soft — stats bend it):
 *   STRIKE  beats GUARD-less foes; against GUARD most damage is blocked and
 *           the guardian counters.
 *   GUARD   blunts strikes (70% blocked) and answers with a counter-blow,
 *           but crumbles against a SPECIAL (only 25% blocked, no counter).
 *   SPECIAL needs a full Fury meter. Resolves before strikes. Each species
 *           has a signature move with its own effects.
 * ========================================================================== */

import type { FactionId, SpeciesId } from './types';
import { FACTIONS } from './data';

export type DuelSide = 0 | 1;
export type DuelIntent = 'strike' | 'guard' | 'special';

/* ------------------------------------------------------------------------ */
/* Stat sheet                                                                 */
/* ------------------------------------------------------------------------ */

export interface DuelSpecial {
  name: string;
  blurb: string;
}

export interface DuelStatDef {
  /** Champion hit points (swarm species pool their bodies into one bar). */
  hp: number;
  /** Base damage of one clean strike, before defense. */
  atk: number;
  /** Percent of incoming damage shrugged off (flat reduction). */
  def: number;
  /** Initiative 1–10. The faster warrior lands first in a trade. */
  spd: number;
  special: DuelSpecial;
  passive?: string;
}

export const DUEL_STATS: Record<SpeciesId, DuelStatDef> = {
  trex: {
    hp: 530, atk: 98, def: 30, spd: 3,
    special: { name: 'Tyrant Chomp', blurb: 'A bone-splitting bite for 210% damage that ignores all defense.' },
  },
  lion: {
    hp: 340, atk: 66, def: 16, spd: 6,
    special: { name: 'Ember Roar', blurb: 'A concussive roar for 100% damage that stuns — the foe loses its next move.' },
  },
  eagle: {
    hp: 240, atk: 58, def: 8, spd: 9,
    special: { name: 'Sky Dive', blurb: 'Takes to the sky, evading everything this exchange, then dives for 170% damage.' },
  },
  honeybadger: {
    hp: 300, atk: 56, def: 18, spd: 5,
    special: { name: 'Grudge Frenzy', blurb: 'Three savage snaps at 75% damage each.' },
    passive: 'The Grudge: below 35% HP its attacks hit 40% harder.',
  },
  scorpion: {
    hp: 285, atk: 56, def: 14, spd: 7,
    special: { name: 'Venom Sting', blurb: '110% damage and venom: the foe bleeds 6% max HP for 3 exchanges.' },
  },
  fireants: {
    hp: 270, atk: 48, def: 6, spd: 6,
    special: { name: 'Crawling Pyre', blurb: '90% damage and sets the foe ablaze for 5% max HP over 4 exchanges.' },
  },
  bear: {
    hp: 540, atk: 90, def: 32, spd: 3,
    special: { name: 'Crushing Swat', blurb: 'A 170% haymaker that staggers — the foe attacks 35% weaker for 2 exchanges.' },
  },
  bighorn: {
    hp: 360, atk: 64, def: 18, spd: 8,
    special: { name: 'Comet Charge', blurb: 'A full gallop headfirst: 240% damage.' },
    passive: 'Comet Entrance: its first strike after entering the arena lands 50% harder.',
  },
  bees: {
    hp: 230, atk: 46, def: 4, spd: 10,
    special: { name: 'Humming Veil', blurb: 'Dissolves into the swarm — evades everything, stings for 110%, and drains 30 foe Fury.' },
  },
  wolves: {
    hp: 310, atk: 60, def: 12, spd: 8,
    special: { name: 'Twin Fang', blurb: 'Both wolves strike as one: two hits at 115% damage each.' },
  },
  porcupine: {
    hp: 380, atk: 46, def: 28, spd: 4,
    special: { name: 'Quill Nova', blurb: '120% damage and bristles: attackers eat 35% of their damage back for 3 exchanges.' },
    passive: 'Thousand Needles: always reflects 12% of melee damage taken.',
  },
  beetles: {
    hp: 270, atk: 62, def: 10, spd: 5,
    special: { name: 'Acid Volley', blurb: '110% damage and melts armor: foe permanently loses 18 DEF (stacks twice).' },
  },
};

/* ------------------------------------------------------------------------ */
/* Duelist state                                                             */
/* ------------------------------------------------------------------------ */

export interface DuelStatus {
  /** Exchanges of poison left (6% maxHP per exchange). */
  poison: number;
  /** Exchanges of burn left (5% maxHP per exchange). */
  burn: number;
  /** Skips its next action. */
  stunned: boolean;
  /** Exchanges of −35% ATK left. */
  stagger: number;
  /** Exchanges of 35% melee reflect left. */
  thorns: number;
  /** Permanent DEF lost to acid (capped at 36). */
  defShred: number;
}

export interface Duelist {
  species: SpeciesId;
  name: string;
  title: string;
  hue: number;
  cost: number;
  maxHp: number;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  /** Fury meter 0–100; a special needs all of it. */
  meter: number;
  status: DuelStatus;
  ko: boolean;
  /** Bighorn passive: true until its first strike this entry. */
  freshEntry: boolean;
  /** Set while an evasive special is active this exchange. */
  evading: boolean;
}

const freshStatus = (): DuelStatus => ({
  poison: 0, burn: 0, stunned: false, stagger: 0, thorns: 0, defShred: 0,
});

export function makeDuelist(species: SpeciesId, faction: FactionId): Duelist {
  const card = FACTIONS[faction].cards.find((c) => c.species === species);
  const s = DUEL_STATS[species];
  return {
    species,
    name: card?.name ?? species,
    title: card?.title ?? '',
    hue: card?.hue ?? 0,
    cost: card?.cost ?? 3,
    maxHp: s.hp,
    hp: s.hp,
    atk: s.atk,
    def: s.def,
    spd: s.spd,
    meter: 0,
    status: freshStatus(),
    ko: false,
    freshEntry: true,
    evading: false,
  };
}

/* ------------------------------------------------------------------------ */
/* Match state                                                                */
/* ------------------------------------------------------------------------ */

export interface DuelMatch {
  factions: [FactionId, FactionId];
  teams: [Duelist[], Duelist[]];
  /** Index into each team of the active champion. */
  active: [number, number];
  round: number;
  exchange: number;
  winner: DuelSide | null;
  rng: () => number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createDuelMatch(
  playerFaction: FactionId,
  playerOrder: SpeciesId[],
  seed = (Math.random() * 0xffffffff) >>> 0,
): DuelMatch {
  const botFaction: FactionId = playerFaction === 'magma' ? 'oasis' : 'magma';
  const rng = mulberry32(seed);
  const playerTeam = playerOrder.map((sp) => makeDuelist(sp, playerFaction));
  // The bot leads with a mid-cost brawler and holds its tank in reserve.
  const botSpecies = FACTIONS[botFaction].cards.map((c) => c.species!) as SpeciesId[];
  const botOrder = [...botSpecies].sort((a, b) => {
    const rank = (sp: SpeciesId) => DUEL_STATS[sp].spd + DUEL_STATS[sp].atk / 20 + rng() * 4;
    return rank(b) - rank(a);
  });
  return {
    factions: [playerFaction, botFaction],
    teams: [playerTeam, botOrder.map((sp) => makeDuelist(sp, botFaction))],
    active: [0, 0],
    round: 1,
    exchange: 0,
    winner: null,
    rng,
  };
}

export function activeDuelist(m: DuelMatch, side: DuelSide): Duelist {
  return m.teams[side][m.active[side]];
}

export function remaining(m: DuelMatch, side: DuelSide): number {
  return m.teams[side].filter((d) => !d.ko).length;
}

/* ------------------------------------------------------------------------ */
/* Exchange resolution                                                        */
/* ------------------------------------------------------------------------ */

export interface DuelEvent {
  kind: 'clash' | 'counter' | 'clinch' | 'skip' | 'dot' | 'status' | 'ko';
  /** Acting side (for 'dot'/'ko'/'skip'/'status': the side it happens to). */
  side: DuelSide;
  dmg?: number;
  /** Move name / status caption shown as a banner. */
  label?: string;
  special?: boolean;
  blocked?: boolean;
  evaded?: boolean;
  crit?: boolean;
  /** HP / meter snapshot after this event, for display sync. */
  after: { hp: [number, number]; meter: [number, number] };
}

const snap = (m: DuelMatch): DuelEvent['after'] => ({
  hp: [Math.max(0, Math.round(activeDuelist(m, 0).hp)), Math.max(0, Math.round(activeDuelist(m, 1).hp))],
  meter: [activeDuelist(m, 0).meter, activeDuelist(m, 1).meter],
});

function gainMeter(d: Duelist, amt: number): void {
  if (!d.ko) d.meter = Math.min(100, d.meter + amt);
}

function effAtk(d: Duelist): number {
  let a = d.atk;
  if (d.status.stagger > 0) a *= 0.65;
  if (d.species === 'honeybadger' && d.hp < d.maxHp * 0.35) a *= 1.4;
  return a;
}

function effDef(d: Duelist): number {
  return Math.max(0, Math.min(60, d.def - d.status.defShred));
}

interface HitSpec {
  mult: number;
  ignoreDef?: boolean;
  label?: string;
  special?: boolean;
}

/**
 * Applies one hit from `atkD` to `defD`, honoring guard, evasion, thorns and
 * crits. Returns the events it produced (clash + possible counter/ko).
 */
function applyHit(
  m: DuelMatch,
  events: DuelEvent[],
  atkSide: DuelSide,
  spec: HitSpec,
  defGuarding: boolean,
): void {
  const atkD = activeDuelist(m, atkSide);
  const defD = activeDuelist(m, (1 - atkSide) as DuelSide);
  if (atkD.ko || defD.ko) return;

  if (defD.evading) {
    events.push({
      kind: 'clash', side: atkSide, dmg: 0, evaded: true,
      label: spec.label, special: spec.special, after: snap(m),
    });
    return;
  }

  let base = effAtk(atkD) * spec.mult;
  if (atkD.species === 'bighorn' && atkD.freshEntry) base *= 1.5;
  atkD.freshEntry = false;

  const variance = 0.88 + m.rng() * 0.24;
  const crit = m.rng() < 0.12;
  base *= variance * (crit ? 1.5 : 1);

  const defPct = spec.ignoreDef ? 0 : effDef(defD) / 100;
  let dmg = base * (1 - defPct);
  let blocked = false;
  if (defGuarding) {
    blocked = true;
    dmg *= spec.special ? 0.75 : 0.3; // guard crumbles against specials
  }
  dmg = Math.max(1, Math.round(dmg));
  defD.hp -= dmg;
  gainMeter(defD, 15);

  events.push({
    kind: 'clash', side: atkSide, dmg, crit, blocked,
    label: spec.label, special: spec.special, after: snap(m),
  });

  // Quill reflection: passive 12%, Quill Nova 35%.
  const reflectPct =
    (defD.status.thorns > 0 ? 0.35 : 0) +
    (defD.species === 'porcupine' ? 0.12 : 0);
  if (reflectPct > 0 && defD.hp > 0 && !spec.special) {
    const ref = Math.max(1, Math.round(dmg * Math.min(0.4, reflectPct)));
    atkD.hp -= ref;
    events.push({ kind: 'counter', side: (1 - atkSide) as DuelSide, dmg: ref, label: 'QUILLS', after: snap(m) });
  }

  // Guard counter-blow (strikes only — specials smash through).
  if (defGuarding && !spec.special && defD.hp > 0 && atkD.hp > 0) {
    const cdmg = Math.max(1, Math.round(effAtk(defD) * 0.35));
    atkD.hp -= cdmg;
    gainMeter(atkD, 10);
    events.push({ kind: 'counter', side: (1 - atkSide) as DuelSide, dmg: cdmg, after: snap(m) });
  }

  checkKo(m, events);
}

function checkKo(m: DuelMatch, events: DuelEvent[]): void {
  for (const side of [0, 1] as DuelSide[]) {
    const d = activeDuelist(m, side);
    if (!d.ko && d.hp <= 0) {
      d.hp = 0;
      d.ko = true;
      events.push({ kind: 'ko', side, label: `${d.name} is down!`, after: snap(m) });
    }
  }
}

/** Runs the species signature move. Meter is spent by the caller. */
function castSpecial(m: DuelMatch, events: DuelEvent[], side: DuelSide, defGuarding: boolean): void {
  const me = activeDuelist(m, side);
  const foe = activeDuelist(m, (1 - side) as DuelSide);
  const name = DUEL_STATS[me.species].special.name.toUpperCase();
  const S = (mult: number, ignoreDef = false) =>
    applyHit(m, events, side, { mult, ignoreDef, label: name, special: true }, defGuarding);

  switch (me.species) {
    case 'trex': S(2.1, true); break;
    case 'lion':
      S(1.0);
      if (!foe.ko) {
        foe.status.stunned = true;
        events.push({ kind: 'status', side: (1 - side) as DuelSide, label: 'STUNNED', after: snap(m) });
      }
      break;
    case 'eagle': me.evading = true; S(1.7); break;
    case 'honeybadger': S(0.75); S(0.75); S(0.75); break;
    case 'scorpion':
      S(1.1);
      if (!foe.ko) {
        foe.status.poison = 3;
        events.push({ kind: 'status', side: (1 - side) as DuelSide, label: 'VENOM', after: snap(m) });
      }
      break;
    case 'fireants':
      S(0.9);
      if (!foe.ko) {
        foe.status.burn = 4;
        events.push({ kind: 'status', side: (1 - side) as DuelSide, label: 'ABLAZE', after: snap(m) });
      }
      break;
    case 'bear':
      S(1.7);
      if (!foe.ko) {
        foe.status.stagger = 2;
        events.push({ kind: 'status', side: (1 - side) as DuelSide, label: 'STAGGERED', after: snap(m) });
      }
      break;
    case 'bighorn': S(2.4); break;
    case 'bees':
      me.evading = true;
      S(1.1);
      if (!foe.ko) foe.meter = Math.max(0, foe.meter - 30);
      break;
    case 'wolves': S(1.15); S(1.15); break;
    case 'porcupine':
      S(1.2);
      me.status.thorns = 3;
      events.push({ kind: 'status', side, label: 'BRISTLING', after: snap(m) });
      break;
    case 'beetles':
      S(1.1);
      if (!foe.ko && foe.status.defShred < 36) {
        foe.status.defShred = Math.min(36, foe.status.defShred + 18);
        events.push({ kind: 'status', side: (1 - side) as DuelSide, label: 'ARMOR MELTED', after: snap(m) });
      }
      break;
  }
}

/**
 * Resolves one full exchange. Mutates the match and returns the ordered
 * event script for the stage to choreograph.
 */
export function resolveExchange(m: DuelMatch, intents: [DuelIntent, DuelIntent]): DuelEvent[] {
  const events: DuelEvent[] = [];
  m.exchange++;
  const a = activeDuelist(m, 0);
  const b = activeDuelist(m, 1);
  a.evading = false;
  b.evading = false;

  // Stun eats the whole action.
  const acts: (DuelIntent | 'skip')[] = [intents[0], intents[1]];
  for (const side of [0, 1] as DuelSide[]) {
    const d = activeDuelist(m, side);
    if (d.status.stunned) {
      d.status.stunned = false;
      acts[side] = 'skip';
      events.push({ kind: 'skip', side, label: 'STUNNED', after: snap(m) });
    } else if (acts[side] === 'special' && d.meter < 100) {
      acts[side] = 'strike'; // safety: UI shouldn't allow this
    }
  }

  const guarding: [boolean, boolean] = [acts[0] === 'guard', acts[1] === 'guard'];

  // Guard vs guard: a tense circling clinch — both bank Fury.
  if (guarding[0] && guarding[1]) {
    gainMeter(a, 20);
    gainMeter(b, 20);
    events.push({ kind: 'clinch', side: 0, label: 'STANDOFF', after: snap(m) });
  } else {
    // Action order: specials first, then strikes; speed breaks ties.
    const order = ([0, 1] as DuelSide[])
      .filter((s) => acts[s] === 'special' || acts[s] === 'strike')
      .sort((s1, s2) => {
        const pri = (s: DuelSide) => (acts[s] === 'special' ? 100 : 0) + activeDuelist(m, s).spd + m.rng();
        return pri(s2) - pri(s1);
      });

    for (const side of order) {
      const me = activeDuelist(m, side);
      if (me.ko || activeDuelist(m, (1 - side) as DuelSide).ko) break;
      if (acts[side] === 'special') {
        me.meter = 0;
        castSpecial(m, events, side, guarding[1 - side]);
      } else {
        gainMeter(me, 30);
        applyHit(m, events, side, { mult: 1 }, guarding[1 - side]);
      }
    }
    for (const side of [0, 1] as DuelSide[]) {
      if (guarding[side]) gainMeter(activeDuelist(m, side), 15);
    }
  }

  // Damage-over-time ticks close the exchange.
  for (const side of [0, 1] as DuelSide[]) {
    const d = activeDuelist(m, side);
    if (d.ko) continue;
    if (d.status.poison > 0) {
      d.status.poison--;
      const dmg = Math.max(1, Math.round(d.maxHp * 0.06));
      d.hp -= dmg;
      events.push({ kind: 'dot', side, dmg, label: 'VENOM', after: snap(m) });
    }
    if (d.status.burn > 0) {
      d.status.burn--;
      const dmg = Math.max(1, Math.round(d.maxHp * 0.05));
      d.hp -= dmg;
      events.push({ kind: 'dot', side, dmg, label: 'BURN', after: snap(m) });
    }
    if (d.status.stagger > 0) d.status.stagger--;
    if (d.status.thorns > 0) d.status.thorns--;
  }
  checkKo(m, events);

  // A KO ends the round: winner keeps HP and Fury, sheds lingering ailments.
  for (const side of [0, 1] as DuelSide[]) {
    if (activeDuelist(m, side).ko) {
      const survivor = activeDuelist(m, (1 - side) as DuelSide);
      survivor.status = { ...freshStatus(), defShred: survivor.status.defShred };
      if (remaining(m, side) === 0) m.winner = (1 - side) as DuelSide;
      else m.round++;
    }
  }
  return events;
}

/** Sends the next (or chosen) champion into the arena. */
export function sendNext(m: DuelMatch, side: DuelSide, teamIndex: number): void {
  if (m.teams[side][teamIndex].ko) throw new Error('champion is down');
  m.active[side] = teamIndex;
  const d = m.teams[side][teamIndex];
  d.freshEntry = true;
  d.evading = false;
}

/* ------------------------------------------------------------------------ */
/* Bot                                                                        */
/* ------------------------------------------------------------------------ */

export function pickBotIntent(m: DuelMatch): DuelIntent {
  const me = activeDuelist(m, 1);
  const foe = activeDuelist(m, 0);
  const r = m.rng();
  // A stunned foe skips the exchange — never waste the free hit.
  if (foe.status.stunned === true) {
    return me.meter >= 100 ? 'special' : 'strike';
  }
  if (me.meter >= 100) {
    // Fire the special almost always; hold it rarely for mind games.
    return r < 0.88 ? 'special' : 'strike';
  }
  if (foe.meter >= 100) {
    // Guard loses to specials — trade instead.
    return r < 0.92 ? 'strike' : 'guard';
  }
  if (me.hp < me.maxHp * 0.28) {
    return r < 0.4 ? 'guard' : 'strike';
  }
  // Striking builds meter faster than guarding — press the tempo.
  return r < 0.78 ? 'strike' : 'guard';
}

/** Bot replacement pick: sends its best matchup among the survivors. */
export function pickBotReplacement(m: DuelMatch): number {
  const foe = activeDuelist(m, 0);
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < m.teams[1].length; i++) {
    const d = m.teams[1][i];
    if (d.ko) continue;
    // Favor warriors that out-speed the foe and can absorb its attack.
    const score = d.hp / 100 + d.atk / 10 + (d.spd > foe.spd ? 3 : 0) + d.def / 8 + m.rng() * 1.2;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}
