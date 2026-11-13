import { ITEM_HP, LAYERS, LAYER_LOADS, MAP_SIZE, RAID, START_CASH, TANKS, TICKS_PER_DAY, UNIT_STATS, VEHICLES } from '../data/balance';
import { fbm, hash2 } from './rng';
import type { GameState, Item, Role, Tile, Unit } from './state';
import type { ItemKind } from '../data/balance';

export function organicGrade(t: Tile): number { return t.richness * LAYERS[0].mult; }
export function topsoilGrade(t: Tile): number { return t.richness * LAYERS[1].mult; }
/** Grams of gold per load in layer k of a tile. */
export function layerGrade(t: Tile, k: number): number { return t.richness * LAYERS[k].mult; }

export function newItem(s: GameState, kind: ItemKind, owner: number, x: number, y: number): Item {
  const it: Item = {
    id: s.nextId++, kind, owner, x, y, carriedBy: -1, inStation: -1,
    contents: 'empty', loads: 0, gold: 0, reservedBy: -1, inSlot: -1, outSlot: -1, operator: -1,
    fuel: TANKS[kind]?.capacity ?? VEHICLES[kind]?.tank ?? 0, ore: false, cargo: 0,
    hopper: 0, hopperGold: 0, feed: 0, feedGold: 0, driver: -1, timer: 0, running: false, note: '',
    hp: ITEM_HP[kind] ?? 0, maxHp: ITEM_HP[kind] ?? 0,
  };
  s.items.push(it);
  return it;
}

const NAMES = ['Hank', 'Dusty', 'Mabel', 'Jed', 'Rosa', 'Cyrus', 'Opal', 'Buck', 'Ines', 'Walt', 'June', 'Otis', 'Pearl', 'Gus', 'Nell', 'Amos'];

export function newUnit(s: GameState, owner: number, x: number, y: number, boss: boolean, role: Role = boss ? 'boss' : 'hand'): Unit {
  const id = s.nextId++, hp = UNIT_STATS[role].hp;
  const u: Unit = {
    id, owner, boss, name: boss ? 'Yukon' : role === 'bandit' ? 'Bandit' : role === 'thief' ? 'Thief' : NAMES[(id * 7 + s.seed) % NAMES.length],
    x, y, carrying: -1, vehicle: -1, queue: [], job: null, workLeft: 0, workTotal: 0, blocked: 0,
    status: 'Idle', moving: false, facing: 1,
    role, hp, maxHp: hp, cool: 0, hurt: -9999, target: -1, loot: 0, post: null, nav: null,
  };
  s.units.push(u);
  return u;
}

export function createGame(seed: number, size = MAP_SIZE): GameState {
  const tiles: Tile[] = new Array(size * size);
  // Creek: a meandering line from the top edge to the bottom edge.
  const creekX: number[] = [];
  for (let y = 0; y < size; y++) {
    creekX.push(Math.round(size / 2 + (fbm(seed + 7, y * 0.07, 0.5, 2) - 0.5) * size * 0.8));
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Smooth noise gives streaks and pockets; squaring skews it so most ground is poor.
      const n = fbm(seed + 99, x * 0.11, y * 0.11, 3);
      const v = Math.max(0, (n - 0.5) / 0.5);
      const jitter = 0.45 + 1.1 * hash2(seed + 5, x, y);
      const organic = 0.02 + 11 * v * v * jitter;
      const prev = creekX[Math.max(0, y - 1)], cur = creekX[y];
      const lo = Math.min(prev, cur), hi = Math.max(prev, cur);
      const wide = hash2(seed + 3, 0, y >> 2) > 0.6 ? 1 : 0;
      const water = x >= lo && x <= hi + wide;
      tiles[y * size + x] = {
        water,
        richness: organic / LAYERS[0].mult,
        thick: LAYERS.map((l, i) => Math.round(l.thick * (0.8 + 0.4 * hash2(seed + 20 + i, x, y)) * 10) / 10),
        organicLeft: water ? 0 : LAYER_LOADS[0], topsoilLeft: water ? 0 : LAYER_LOADS[1], brownLeft: water ? 0 : LAYER_LOADS[2],
        blueLeft: water ? 0 : LAYER_LOADS[3], bedrockLeft: water ? 0 : LAYER_LOADS[4], ripped: false, drilled: false,
        sample: -1, known: false, owner: -1,
      };
    }
  }
  const s: GameState = {
    seed, rng: seed | 0, tick: 0, size, tiles, units: [], items: [],
    players: [{ id: 0, cash: START_CASH, goldGrams: 0, earned: 0, claims: 0, tilesDug: 0, loadsWashed: 0, samples: 0, tier: 1, drill: false }],
    nextId: 1, over: '', events: [], spawn: { x: 0, y: 0 },
    raid: { next: RAID.firstDay * TICKS_PER_DAY, spawnAt: -1, wave: 0, fromX: 0, fromY: 0 },
  };
  // Camp goes on the creek bank. Of the spots along the middle half of the creek,
  // pick the one with the most paying ground within a short walk, so no season
  // starts in a dead zone. The gold itself is not moved.
  let sy = Math.floor(size / 2), bestScore = -1;
  for (let y = Math.floor(size * 0.25); y <= Math.floor(size * 0.75); y += 2) {
    let score = 0;
    for (let dy = -9; dy <= 9; dy++) for (let dx = -12; dx <= 12; dx++) {
      const t = tiles[(y + dy) * size + creekX[y] + dx];
      if (t && !t.water && creekX[y] + dx >= 0 && creekX[y] + dx < size) score += Math.min(1.5, t.richness * LAYERS[0].mult) >= 0.3 ? 1 : 0;
    }
    if (score > bestScore) { bestScore = score; sy = y; }
  }
  let sx = creekX[sy] - 2;
  while (sx > 1 && tiles[sy * size + sx].water) sx--;
  s.spawn = { x: sx, y: sy };
  newUnit(s, 0, sx + 0.5, sy + 0.5, true);
  newItem(s, 'bucket', 0, sx - 1, sy);
  newItem(s, 'sieve', 0, sx, sy + 1);
  newItem(s, 'pan', 0, sx + 1, sy + 1);
  return s;
}
