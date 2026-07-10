import assert from 'node:assert/strict';
import { cardDef, speciesDef } from '../src/data';
import { advanceTick, createGame, resetIds } from '../src/engine';
import { FORT_LANES, FORT_SPAWN_Y } from '../src/types';
import type { PlayerId, SpeciesId, UnitState } from '../src/types';

let id = 1000;
function unit(owner: PlayerId, species: SpeciesId, x: number, y: number): UnitState {
  const stats = speciesDef(species).stats!;
  return {
    id: id++,
    owner,
    species,
    x,
    y,
    px: x,
    py: y,
    hp: stats.hp,
    maxHp: stats.hp,
    facing: owner === 0 ? 1 : -1,
    atkTimer: 0,
    traveled: 0,
    stompBank: 0,
    struckTargets: [],
    waypoint: null,
    stall: 0,
    stallRef: Infinity,
    buffs: {
      stun: 0,
      slowTicks: 0,
      slowMult: 1,
      burnStacks: 0,
      burnTicks: 0,
      rangeCapTicks: 0,
      blessed: false,
      berserk: false,
    },
    stealthed: false,
    action: 'idle',
    targetId: null,
  };
}

// Beetle economy and projectile base damage.
const beetle = cardDef('beetles');
assert.equal(beetle.cost, 4);
assert.equal(beetle.stats?.dmg, 20);

// A defender spawned behind a razed left gate must cross the rear apron
// toward an enemy pressuring the right gate, not walk out to mid-field first.
resetIds();
const defense = createGame(77, ['oasis', 'magma']);
defense.obelisks.find((o) => o.owner === 0 && o.wing === 0)!.hp = 0;
const defender = unit(0, 'bighorn', FORT_LANES[0][0], FORT_SPAWN_Y[0]);
const invader = unit(1, 'lion', FORT_LANES[0][1], 11.35);
invader.buffs.stun = 999;
defense.units.push(defender, invader);
for (let i = 0; i < 8; i++) advanceTick(defense, []);
assert(
  defender.x > FORT_LANES[0][0] + 0.5,
  `defender failed to cross rear apron toward threatened gate (x=${defender.x})`,
);
assert(
  defender.y > 14.2,
  `defender incorrectly entered the main bridge before changing lanes (y=${defender.y})`,
);
assert.equal(defender.targetId, invader.id);
for (let i = 0; i < 22; i++) advanceTick(defense, []);
assert(
  Math.abs(defender.x - FORT_LANES[0][1]) < 0.35,
  `defender failed to enter through the threatened gate lane (x=${defender.x})`,
);
assert(
  defender.y > 11.5,
  `defender detoured to the central battle plane (y=${defender.y})`,
);

// A flyer with an off-axis battlefield waypoint remains centered until its
// complete body clears the intact tunnel mouth.
resetIds();
const tunnel = createGame(88, ['oasis', 'magma']);
const laneX = FORT_LANES[0][0];
const bees = unit(0, 'bees', laneX, FORT_SPAWN_Y[0]);
bees.waypoint = { x: 8.2, y: 7.5 };
tunnel.units.push(bees);
for (let i = 0; i < 18; i++) {
  advanceTick(tunnel, []);
  if (bees.y > 11.1) {
    assert(
      Math.abs(bees.x - laneX) < 1e-6,
      `bees left tunnel centerline early (x=${bees.x}, lane=${laneX}, y=${bees.y})`,
    );
  }
}

console.log('seven-fix focused regressions: PASS');
