import assert from 'node:assert/strict';
import { cardDef, speciesDef } from '../src/data';
import { advanceTick, createGame, resetIds } from '../src/engine';
import { FORT_LANES, FORT_SPAWN_Y, FORT_WALL_FRONT } from '../src/types';
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

// Lane discipline: a defender spawned behind a razed left gate stays in its
// own lane until it has climbed over the rubble, and only then crosses over
// toward the enemy pressuring the right gate.
resetIds();
const defense = createGame(77, ['oasis', 'magma']);
defense.obelisks.find((o) => o.owner === 0 && o.wing === 0)!.hp = 0;
const defender = unit(0, 'bighorn', FORT_LANES[0][0], FORT_SPAWN_Y[0]);
defender.waypoint = { x: FORT_LANES[0][0], y: 10.85 };
const invader = unit(1, 'lion', FORT_LANES[0][1], 11.35);
invader.buffs.stun = 999;
defense.units.push(defender, invader);
let crossedAt = -1;
let struck = false;
for (let i = 0; i < 140; i++) {
  advanceTick(defense, []);
  if (defender.y > FORT_WALL_FRONT[0] + 0.05) {
    assert(
      Math.abs(defender.x - FORT_LANES[0][0]) < 0.45,
      `defender left its lane before clearing the rubble (x=${defender.x}, y=${defender.y})`,
    );
  } else if (crossedAt < 0) {
    crossedAt = i;
  }
  if (invader.hp < invader.maxHp) {
    struck = true;
    break;
  }
}
assert(crossedAt >= 0, 'defender never made it over the rubble mound');
assert(struck, 'defender never engaged the invader at the other gate');
assert(
  defender.x > FORT_LANES[0][0] + 1.5,
  `defender failed to cross over toward the threatened gate after the rubble (x=${defender.x})`,
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

// A flyer deployed while enemies press the OTHER gate must never freeze in
// its tunnel: it stays on the centreline, keeps making forward progress every
// tick, and swerves toward the threat only after fully exiting.
resetIds();
const swarm = createGame(99, ['oasis', 'magma']);
swarm.obelisks.find((o) => o.owner === 0 && o.wing === 0)!.hp = 0;
const raider = unit(1, 'lion', FORT_LANES[0][1], 11.35);
raider.buffs.stun = 999;
const flyers = unit(0, 'bees', FORT_LANES[0][0], FORT_SPAWN_Y[0]);
flyers.waypoint = { x: FORT_LANES[0][0], y: 10.85 };
swarm.units.push(flyers, raider);
for (let i = 0; i < 60 && flyers.y > 11.1; i++) {
  const prevY = flyers.y;
  advanceTick(swarm, []);
  assert(
    flyers.y < prevY - 1e-4,
    `bees froze in the tunnel (y stuck at ${flyers.y} on tick ${i})`,
  );
  assert(
    Math.abs(flyers.x - FORT_LANES[0][0]) < 1e-6,
    `bees drifted off the tunnel centreline (x=${flyers.x}, y=${flyers.y})`,
  );
}
assert(flyers.y <= 11.1, `bees never exited the tunnel (y=${flyers.y})`);

console.log('seven-fix focused regressions: PASS');
