/* Headless Duels engine test: bot vs bot across many seeds.
 * Verifies every match terminates, KO carry-over works, and reports
 * exchange counts + per-faction win rates for balance sanity.
 * Run: npx tsx scripts/dueltest.ts
 */

import {
  activeDuelist,
  createDuelMatch,
  pickBotIntent,
  pickBotReplacement,
  resolveExchange,
  sendNext,
} from '../src/duel';
import type { DuelIntent, DuelMatch } from '../src/duel';
import { FACTIONS } from '../src/data';
import type { SpeciesId } from '../src/types';

function playerIntent(m: DuelMatch): DuelIntent {
  // Mirror the bot brain for the player seat (bot-vs-bot).
  const me = activeDuelist(m, 0);
  const foe = activeDuelist(m, 1);
  const r = m.rng();
  if (me.meter >= 100) return r < 0.78 ? 'special' : 'strike';
  if (foe.meter >= 100) return r < 0.85 ? 'strike' : 'guard';
  return r < 0.68 ? 'strike' : 'guard';
}

let wins = [0, 0];
let totalEx = 0;
let maxEx = 0;
let fails = 0;
const roundLens: number[] = [];

for (let seed = 1; seed <= 400; seed++) {
  const faction = seed % 2 === 0 ? 'magma' : 'oasis';
  const order = FACTIONS[faction].cards.map((c) => c.species!) as SpeciesId[];
  // Shuffle the player's order per seed for coverage.
  const m = createDuelMatch(faction, order, seed * 7919);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(m.rng() * (i + 1));
    [m.teams[0][i], m.teams[0][j]] = [m.teams[0][j], m.teams[0][i]];
  }

  let guard = 0;
  while (m.winner === null && guard++ < 400) {
    const events = resolveExchange(m, [playerIntent(m), pickBotIntent(m)]);
    void events;
    for (const side of [0, 1] as const) {
      if (m.winner === null && activeDuelist(m, side).ko) {
        const pick =
          side === 1
            ? pickBotReplacement(m)
            : m.teams[0].findIndex((d) => !d.ko);
        if (pick >= 0) sendNext(m, side, pick);
      }
    }
  }
  if (m.winner === null) {
    fails++;
    console.log(`seed ${seed}: DID NOT FINISH after ${guard} exchanges`);
    continue;
  }
  totalEx += m.exchange;
  maxEx = Math.max(maxEx, m.exchange);
  roundLens.push(m.exchange);
  const winnerFaction = m.factions[m.winner];
  wins[winnerFaction === 'magma' ? 0 : 1]++;
}

roundLens.sort((a, b) => a - b);
console.log(`matches: 400, unfinished: ${fails}`);
console.log(`wins — magma: ${wins[0]}, oasis: ${wins[1]}`);
console.log(
  `exchanges/match — mean: ${(totalEx / roundLens.length).toFixed(1)}, ` +
  `median: ${roundLens[Math.floor(roundLens.length / 2)]}, max: ${maxEx}`,
);
if (fails > 0) process.exit(1);
