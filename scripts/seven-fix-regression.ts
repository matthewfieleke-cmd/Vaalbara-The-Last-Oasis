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

// An attacker tucked INSIDE our standing arch (deeper than the old 18%
// visibility cutoff) while battering the gate is still visible: the defender
// turns at the rubble crest and engages instead of marching past it.
resetIds();
const tucked = createGame(111, ['oasis', 'magma']);
tucked.obelisks.find((o) => o.owner === 0 && o.wing === 0)!.hp = 0;
const lurker = unit(1, 'lion', FORT_LANES[0][1], 12.35); // depth ~0.23 in arch
lurker.buffs.stun = 999;
const sentinel = unit(0, 'bighorn', FORT_LANES[0][0], FORT_SPAWN_Y[0]);
sentinel.waypoint = { x: FORT_LANES[0][0], y: 10.85 };
tucked.units.push(sentinel, lurker);
let sawEarly = false;
let hitLurker = false;
for (let i = 0; i < 140; i++) {
  advanceTick(tucked, []);
  // Once over the crest, the defender must already be heading RIGHT along
  // the ledge — never deeper than the river line on its way to the arch.
  if (sentinel.y < FORT_WALL_FRONT[0] + 0.05) {
    assert(
      sentinel.y > 10.4,
      `defender overshot toward mid-field instead of turning at the crest (y=${sentinel.y})`,
    );
    if (sentinel.targetId === lurker.id) sawEarly = true;
  }
  if (lurker.hp < lurker.maxHp) {
    hitLurker = true;
    break;
  }
}
assert(sawEarly, 'defender never targeted the arch-tucked attacker');
assert(hitLurker, 'defender never engaged the arch-tucked attacker');

// Flying threats a ground warrior cannot hit are NOT its home threat: it
// marches straight down its own lane instead of standing under the bees.
resetIds();
const beeSiege = createGame(122, ['oasis', 'magma']);
beeSiege.obelisks.find((o) => o.owner === 0 && o.wing === 0)!.hp = 0;
const hoverBees = unit(1, 'bees', FORT_LANES[0][1], 11.2);
hoverBees.buffs.stun = 999;
const groundling = unit(0, 'bighorn', FORT_LANES[0][0], FORT_SPAWN_Y[0]);
groundling.waypoint = { x: FORT_LANES[0][0], y: 10.85 };
beeSiege.units.push(groundling, hoverBees);
for (let i = 0; i < 160 && groundling.y > 8.6; i++) {
  advanceTick(beeSiege, []);
  assert(
    groundling.targetId !== hoverBees.id,
    `ground warrior locked onto flying bees it cannot hit (tick ${i})`,
  );
}
assert(
  groundling.y <= 8.6,
  `ground warrior stalled instead of marching on past the unhittable flyers (y=${groundling.y}, x=${groundling.x})`,
);

// No attackers at either home gate: the warrior goes STRAIGHT — over the
// rubble and down its own lane, no detours.
resetIds();
const clear = createGame(133, ['oasis', 'magma']);
clear.obelisks.find((o) => o.owner === 0 && o.wing === 0)!.hp = 0;
const marcher = unit(0, 'bighorn', FORT_LANES[0][0], FORT_SPAWN_Y[0]);
marcher.waypoint = { x: FORT_LANES[0][0], y: 10.85 };
clear.units.push(marcher);
for (let i = 0; i < 160 && marcher.y > 8.6; i++) {
  advanceTick(clear, []);
  assert(
    Math.abs(marcher.x - FORT_LANES[0][0]) < 0.9,
    `warrior wandered off its lane with no threats present (x=${marcher.x}, y=${marcher.y})`,
  );
}
assert(marcher.y <= 8.6, `warrior failed to march straight ahead (y=${marcher.y})`);

console.log('seven-fix focused regressions: PASS');
