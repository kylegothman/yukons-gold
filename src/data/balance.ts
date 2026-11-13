// Every tunable number lives here. All values are first guesses; tune by playing.

export const TICKS_PER_SEC = 10;
export const SECONDS_PER_DAY = 60; // 1 real minute = 1 game day at 1x speed
export const TICKS_PER_DAY = TICKS_PER_SEC * SECONDS_PER_DAY;

export const MAP_SIZE = 128;
export const MAP_SIZES = [{ size: 64, name: 'Small' }, { size: 128, name: 'Standard' }, { size: 256, name: 'Huge' }];
export const CLAIM_SIZE = 8;
export const SEASON_DAYS = 100;

export const START_CASH = 1000;
export const LIVING_COST_PER_DAY = 50;
export const GOLD_PRICE_PER_GRAM = 100;
export const SELL_BACK = 0.5;

export const FIRST_EXTRA_CLAIM_COST = 2000;
export const CLAIM_COST_GROWTH = 1.5;

export const UNIT_SPEED = 3.2; // tiles per second
export const WORKER_WAGE_PER_DAY = 75;
export const WORKER_HIRE_FEE = 200;

// One load is a 5-gallon bucket. A real 10x10x2 ft organic layer would be ~300
// loads; that is cut down so tiles visibly dig out and claims matter.
export const ORGANIC_LOADS_PER_TILE = 12;
export const TOPSOIL_LOADS_PER_TILE = 16;
// Loads per tile in each of the five layers, top to bottom.
export const LAYER_LOADS = [ORGANIC_LOADS_PER_TILE, TOPSOIL_LOADS_PER_TILE, 36, 60, 12];
export const LAYER_KEYS = ['organicLeft', 'topsoilLeft', 'brownLeft', 'blueLeft', 'bedrockLeft'] as const;

export const DIG_SEC_PER_LOAD = 5;
export const SIEVE_SEC_PER_LOAD = 4;
export const TEST_PAN_SEC = 3;
export const UNSCREENED_PENALTY = 3; // washing pay dirt that skipped the sieve
export const TEST_PAN_ERROR_CHANCE = 0.3; // chance a reading is off by one band

export const LAYERS = [
  { key: 'organic', name: 'Organic', mult: 0.2, tool: 'Shovel', thick: 2 },
  { key: 'topsoil', name: 'Topsoil', mult: 0.5, tool: 'Mini excavator', thick: 4 },
  { key: 'brown', name: 'Brown layer', mult: 1, tool: 'Dozer, then mid excavator', thick: 9 },
  { key: 'blue', name: 'Blue layer', mult: 3, tool: 'Large excavator', thick: 15 },
  { key: 'bedrock', name: 'Bedrock', mult: 8, tool: 'Mining excavator, crusher, mill', thick: 3 },
] as const;

// Organic-layer grade bands, in grams per load.
export const BANDS = [
  { name: 'Trace', min: 0 },
  { name: 'Low', min: 0.1 },
  { name: 'Fair', min: 0.3 },
  { name: 'Rich', min: 0.7 },
  { name: 'Bonanza', min: 1.5 },
] as const;

export function bandOf(gramsPerLoad: number): number {
  let b = 0;
  for (let i = 0; i < BANDS.length; i++) if (gramsPerLoad >= BANDS[i].min) b = i;
  return b;
}

export type ItemKind = 'bucket' | 'barrow' | 'atv' | 'sieve' | 'pan' | 'sluice'
  | 'excavator' | 'excavator2' | 'excavator3' | 'excavator4' | 'dozer' | 'truck' | 'fueltruck'
  | 'trommel' | 'washplant' | 'crusher' | 'mill' | 'pump' | 'tank' | 'tank2' | 'tank3'
  | 'woodfence' | 'chainfence' | 'tower' | 'armory';

// How many tiles each piece of gear covers (width x depth), roughly true to life at
// 10 ft a tile. Anything not listed covers one tile. item.x, item.y is the top-left tile.
export const FOOTPRINT: Record<string, [number, number]> = {
  trommel: [2, 1], washplant: [3, 2], crusher: [2, 2], mill: [2, 2], tank2: [2, 1], tank3: [2, 2],
  excavator2: [2, 1], excavator3: [2, 2], excavator4: [3, 3], dozer: [2, 1], truck: [2, 1], fueltruck: [2, 1],
  armory: [2, 2],
};
export const footprint = (kind: string): [number, number] => FOOTPRINT[kind] ?? [1, 1];

// Raids. Bandits wreck gear and go for the crew; thieves grab cash and run for the map edge.
export const RAIDER = 99; // owner id of every bandit and thief
export const RAID = { firstDay: 8, firstSpreadDays: 2, minGapDays: 4, maxGapDays: 6, warnSec: 0, startSize: 2, growEveryDays: 15, maxSize: 12, edgeDist: 26, poorBelow: 10000 };
export const UNIT_STATS: Record<string, { hp: number; dmg: number; range: number; coolSec: number; speed: number }> = {
  boss: { hp: 220, dmg: 8, range: 1.3, coolSec: 1, speed: 3.2 },
  hand: { hp: 70, dmg: 0, range: 0, coolSec: 1, speed: 3.2 },
  guard: { hp: 150, dmg: 14, range: 5, coolSec: 1, speed: 3.4 },
  bandit: { hp: 80, dmg: 9, range: 1.3, coolSec: 1, speed: 2.8 },
  thief: { hp: 45, dmg: 0, range: 1.2, coolSec: 1, speed: 3.6 },
};
export const TOWER = { range: 8, dmg: 12, coolSec: 0.8 };
export const ARMORY_BONUS = 1.5;        // guards and towers hit this much harder while an armory stands
export const GUARD_SIGHT = 9;
export const THIEF = { stealSec: 3, share: 0.05, max: 25000 };
export const REPAIR_SHARE = 0.25;       // of the purchase price, to fix a wrecked machine
/** Hit points of gear raiders can damage. Anything not listed cannot be attacked. */
export const ITEM_HP: Record<string, number> = {
  woodfence: 80, chainfence: 220, tower: 320, armory: 400,
  trommel: 200, washplant: 400, crusher: 500, mill: 500, pump: 120, tank: 150, tank2: 250, tank3: 400,
  excavator: 250, excavator2: 400, excavator3: 600, excavator4: 900, dozer: 500, truck: 350, fueltruck: 300,
};

// Machines. Fuel burn is gallons per game day while the machine is working.
// Anything a hired hand drives:
export const VEHICLES: Record<string, { speed: number; tank: number; burnPerDay: number }> = {
  excavator: { speed: 2.4, tank: 10, burnPerDay: 6 },
  excavator2: { speed: 2.2, tank: 25, burnPerDay: 10 },
  excavator3: { speed: 2.0, tank: 50, burnPerDay: 20 },
  excavator4: { speed: 1.8, tank: 100, burnPerDay: 40 },
  dozer: { speed: 2.0, tank: 30, burnPerDay: 12 },
  truck: { speed: 3.4, tank: 30, burnPerDay: 8 },
  fueltruck: { speed: 3.2, tank: 30, burnPerDay: 6 },
};
// Excavators: loads per scoop and the deepest layer each can dig (0 organic .. 4 bedrock).
export const DIGGERS: Record<string, { scoop: number; maxLayer: number }> = {
  excavator: { scoop: 6, maxLayer: 1 }, excavator2: { scoop: 12, maxLayer: 2 }, excavator3: { scoop: 24, maxLayer: 3 }, excavator4: { scoop: 40, maxLayer: 4 },
};
export const EXCAVATOR = { scoopSec: 3, dumpSec: 1, refuelSec: 3, ripSec: 3 };
export const HOPPER: Record<string, number> = { trommel: 24, washplant: 96, crusher: 60, mill: 30, truck: 48 };
export const TROMMEL = { secPerLoad: 1.5, burnPerDay: 3, feedMax: 6 };
export const WASHPLANT = { secPerLoad: 0.5, burnPerDay: 8, recovery: 0.95 };
export const CRUSHER = { secPerLoad: 0.6, burnPerDay: 10 };
export const MILL = { secPerLoad: 0.6, burnPerDay: 10 };
export const PUMP = { range: 10, burnPerDay: 2 };
export const TANKS: Record<string, { capacity: number; range: number }> = { tank: { capacity: 100, range: 8 }, tank2: { capacity: 500, range: 10 }, tank3: { capacity: 2000, range: 12 } };
export const FUEL_TRUCK_CARGO = 200;
export const ATV_SPEED_BOOST = 1.8;
export const DRILL_FEE = 100;  // dollars per core sample
export const DRILL_SEC = 5;
export const DIESEL_PRICE = 4; // dollars per gallon

export const WASH = {
  pan: { secPerLoad: 6, recovery: 0.7 },
  sluice: { secPerLoad: 2, recovery: 0.9 },
} as const;

export const CAPACITY: Record<string, number> = { bucket: 1, barrow: 4, atv: 8 };

export interface StoreEntry {
  id: string;
  name: string;
  blurb: string;
  price: number;
  upkeep: number; // dollars per day
  tier: number;
  defense?: boolean; // listed under Defense in the store, open from the start
}

export const STORE: StoreEntry[] = [
  { id: 'bucket', name: 'Extra bucket', blurb: 'One more 5-gallon bucket in circulation.', price: 50, upkeep: 0, tier: 1 },
  { id: 'barrow', name: 'Wheelbarrow', blurb: 'Carries 4 loads per trip.', price: 300, upkeep: 0, tier: 1 },
  { id: 'worker', name: 'Hired hand', blurb: 'Send them to your claim and they mine on their own.', price: WORKER_HIRE_FEE, upkeep: WORKER_WAGE_PER_DAY, tier: 1 },
  { id: 'sluice', name: 'Sluice box', blurb: '90% recovery and 3x pan speed. Needs creek water. Unlocks tier 2.', price: 800, upkeep: 10, tier: 1 },
  { id: 'trommel', name: 'Trommel', blurb: 'Machine sieve with a 24-load hopper. Set it beside a sluice and it feeds it.', price: 1500, upkeep: 30, tier: 2 },
  { id: 'tank', name: 'Diesel tank', blurb: '100 gallons, delivered full. Feeds machines within 8 tiles.', price: 500, upkeep: 0, tier: 2 },
  { id: 'excavator', name: 'Mini excavator', blurb: 'A hand drives it. 6 loads a scoop, and it digs topsoil. Unlocks tier 3.', price: 3500, upkeep: 75, tier: 2 },
  { id: 'pump', name: 'Pump and hose', blurb: 'Beside the creek, it waters pans, sluices and wash plants within 10 tiles.', price: 1250, upkeep: 15, tier: 2 },
  { id: 'atv', name: 'ATV and trailer', blurb: 'A hand on foot hauls 8 loads a trip, and moves faster doing it.', price: 2000, upkeep: 0, tier: 2 },
  { id: 'drill', name: 'Drill rig', blurb: 'Core-sample a tile for $100 to see the grade of all five layers.', price: 1500, upkeep: 10, tier: 2 },
  { id: 'dozer', name: 'Dozer', blurb: 'Rips the hard brown layer so an excavator can dig it.', price: 10000, upkeep: 150, tier: 3 },
  { id: 'excavator2', name: 'Mid excavator', blurb: '12 loads a scoop. Digs down through the brown layer.', price: 16000, upkeep: 200, tier: 3 },
  { id: 'washplant', name: 'Wash plant', blurb: 'Screens and washes in one: 2 loads a second at 95% recovery. Needs water.', price: 12000, upkeep: 200, tier: 3 },
  { id: 'truck', name: 'Dump truck', blurb: 'Hauls 48 loads from an excavator to the plant so the excavator keeps digging.', price: 8000, upkeep: 100, tier: 3 },
  { id: 'tank2', name: '500-gallon tank', blurb: 'Delivered full. Feeds machines within 10 tiles.', price: 1000, upkeep: 0, tier: 3 },
  { id: 'fueltruck', name: 'Fuel truck', blurb: 'Carries 200 gallons out to your machines so they never leave the pit.', price: 5000, upkeep: 50, tier: 3 },
  { id: 'excavator3', name: 'Large excavator', blurb: '24 loads a scoop. Reaches the rich blue layer.', price: 250000, upkeep: 500, tier: 4 },
  { id: 'tank3', name: '2,000-gallon tank', blurb: 'Delivered full. Feeds machines within 12 tiles.', price: 3000, upkeep: 0, tier: 4 },
  { id: 'excavator4', name: 'Mining excavator', blurb: '40 loads a scoop. Breaks bedrock, the richest ground there is.', price: 600000, upkeep: 1250, tier: 5 },
  { id: 'crusher', name: 'Crusher', blurb: 'Takes bedrock ore. Set it touching a mill.', price: 150000, upkeep: 250, tier: 5 },
  { id: 'mill', name: 'Mill', blurb: 'Grinds crushed ore. Set it touching a crusher and a wash plant.', price: 200000, upkeep: 300, tier: 5 },
  { id: 'woodfence', name: 'Wood fence', blurb: 'One tile of fence. Slows raiders down until they break it. Your crew walks through.', price: 40, upkeep: 0, tier: 1, defense: true },
  { id: 'chainfence', name: 'Chain link fence', blurb: 'One tile, nearly three times as tough as wood.', price: 120, upkeep: 0, tier: 1, defense: true },
  { id: 'guard', name: 'Guard', blurb: 'Fights raiders on sight. Select and send them like any hand.', price: 300, upkeep: 60, tier: 1, defense: true },
  { id: 'tower', name: 'Guard tower', blurb: 'Fires on any raider within 8 tiles.', price: 2500, upkeep: 40, tier: 1, defense: true },
  { id: 'armory', name: 'Armory', blurb: 'Guards and towers hit 50% harder while it stands.', price: 6000, upkeep: 60, tier: 1, defense: true },
];
// Buying a tier's key item opens the next tier.
export const TIER_KEYS: Record<string, number> = { sluice: 2, excavator: 3, excavator2: 4, excavator3: 5 };

export const UPKEEP: Record<string, number> = Object.fromEntries(STORE.filter(e => e.upkeep && e.id !== 'worker' && e.id !== 'guard').map(e => [e.id, e.upkeep]));
export const PRICE: Record<string, number> = { sieve: 40, pan: 20, ...Object.fromEntries(STORE.filter(e => e.id !== 'worker' && e.id !== 'guard').map(e => [e.id, e.price])) };
