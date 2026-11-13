import { DIGGERS, LAYER_KEYS, RAIDER, TANKS, VEHICLES, footprint } from '../data/balance';
import type { ItemKind } from '../data/balance';

export interface Tile {
  water: boolean;
  richness: number;      // grams per load at the brown layer (1x multiplier)
  thick: number[];       // thickness in ft of each of the five layers
  organicLeft: number;   // loads of organic dirt still in the ground
  topsoilLeft: number;   // loads of topsoil under it (excavator only)
  brownLeft: number;     // hard brown layer: a dozer rips it, then a mid excavator digs it
  blueLeft: number;      // large excavator
  bedrockLeft: number;   // mining excavator; comes out as ore for the crusher
  ripped: boolean;       // the brown layer has been ripped by a dozer
  drilled: boolean;      // core-sampled: every layer's grade is known
  sample: number;        // band index from a test pan, -1 if never sampled
  known: boolean;        // true once dug: real organic grade is visible
  owner: number;         // player id of the claim holder, -1 if unclaimed
}

export type Contents = 'empty' | 'paydirt' | 'fines';

export interface Item {
  id: number;
  kind: ItemKind;
  owner: number;
  x: number; y: number;          // tile position when on the ground
  carriedBy: number;             // unit id, or -1
  inStation: number;             // station item id when sitting in a slot, or -1
  // containers (bucket, barrow)
  contents: Contents;
  loads: number;
  gold: number;                  // grams of gold in the dirt
  reservedBy: number;            // unit id that is on its way to pick this up
  // stations (sieve, pan, sluice)
  inSlot: number;                // item id, or -1
  outSlot: number;               // item id, or -1
  operator: number;              // unit id currently working it, or -1
  // machines
  fuel: number;                  // gallons: a tank's stock, or a vehicle's own tank
  ore: boolean;                  // the load in a vehicle is bedrock ore, not dirt
  cargo: number;                 // gallons a fuel truck is carrying, or cash a wash plant has yet to report
  hopper: number;                // loads waiting in a trommel hopper or an excavator bucket
  hopperGold: number;
  feed: number;                  // loads a trommel has passed to this sluice
  feedGold: number;
  driver: number;                // unit id driving an excavator, or -1
  timer: number;                 // ticks until the machine finishes its current load
  running: boolean;
  note: string;                  // why a machine is stopped, for the HUD
  hp: number; maxHp: number;     // 0 max means raiders cannot damage it; hp 0 means wrecked
}

export type Order =
  | { t: 'move'; x: number; y: number }
  | { t: 'pickup'; item: number }
  | { t: 'dig'; tx: number; ty: number }
  | { t: 'testpan'; tx: number; ty: number; deep?: boolean }
  | { t: 'put'; station: number }
  | { t: 'operate'; station: number }
  | { t: 'take'; station: number }
  | { t: 'dropAt'; x: number; y: number }
  | { t: 'mount'; item: number }
  | { t: 'scoop'; tx: number; ty: number }
  | { t: 'dump'; station: number }
  | { t: 'refuel'; tank: number }
  | { t: 'rip'; tx: number; ty: number }
  | { t: 'fuelup'; item: number };

export type Job =
  | { type: 'dig'; tx: number; ty: number }
  | { type: 'operate'; station: number }
  | null;

export interface Unit {
  id: number;
  owner: number;
  boss: boolean;                 // the starting miner; takes one-off orders
  name: string;
  x: number; y: number;          // tile units, continuous
  carrying: number;              // item id, or -1
  vehicle: number;               // excavator item id this unit is driving, or -1
  queue: Order[];
  job: Job;
  workLeft: number;              // ticks left on the current timed action
  workTotal: number;
  blocked: number;               // ticks spent unable to progress
  status: string;                // short text for the HUD
  moving: boolean;
  facing: number;                // -1 left, 1 right (screen space)
  role: Role;
  hp: number; maxHp: number;
  cool: number;                  // ticks until the next attack
  hurt: number;                  // tick this unit last took damage
  target: number;                // id of the unit or item being attacked, or -1
  loot: number;                  // cash a thief is carrying
  post: { x: number; y: number } | null; // where a guard stands watch
  nav: { goal: number; path: number[]; at: number } | null; // A* route in progress
}

export type Role = 'boss' | 'hand' | 'guard' | 'bandit' | 'thief';

export interface Player {
  id: number;
  cash: number;
  goldGrams: number;             // total recovered
  earned: number;
  claims: number;                // number of claims owned
  tilesDug: number;
  loadsWashed: number;
  samples: number;
  tier: number;                  // highest store tier unlocked
  drill: boolean;                // owns a drill rig
}

export interface GameEvent {
  type: 'gold' | 'sample' | 'claim' | 'toast' | 'dug' | 'buy' | 'hire' | 'dig' | 'sieve' | 'scoop' | 'dump' | 'refuel' | 'rip' | 'drill' | 'raid' | 'shot' | 'hit' | 'death' | 'wreck' | 'steal';
  x?: number; y?: number;
  x2?: number; y2?: number;
  amount?: number;
  text?: string;
  owner?: number;
}

export interface GameState {
  seed: number;
  rng: number;
  tick: number;
  size: number;
  tiles: Tile[];
  units: Unit[];
  items: Item[];
  players: Player[];
  nextId: number;
  over: '' | 'broke' | 'season' | 'dead';
  raid: { next: number; spawnAt: number; wave: number; fromX: number; fromY: number };
  events: GameEvent[];           // cleared by the view after each frame
  spawn: { x: number; y: number };
}

export const tileAt = (s: GameState, x: number, y: number): Tile | undefined =>
  x >= 0 && y >= 0 && x < s.size && y < s.size ? s.tiles[y * s.size + x] : undefined;

export const unitById = (s: GameState, id: number) => s.units.find(u => u.id === id);
export const itemById = (s: GameState, id: number) => s.items.find(i => i.id === id);
export const isStation = (k: ItemKind) => k === 'sieve' || k === 'pan' || k === 'sluice';
/** Anything set down on a tile as a fixture: stations plus the stationary machines. */
export const isVehicle = (k: ItemKind) => k in VEHICLES;
export const isDigger = (k: ItemKind) => k in DIGGERS;
export const isTank = (k: ItemKind) => k in TANKS;
export const isProcessor = (k: ItemKind) => k === 'trommel' || k === 'washplant' || k === 'crusher' || k === 'mill';
export const isFence = (k: ItemKind) => k === 'woodfence' || k === 'chainfence';
export const isDefense = (k: ItemKind) => isFence(k) || k === 'tower' || k === 'armory';
export const isFixture = (k: ItemKind) => isStation(k) || isProcessor(k) || isTank(k) || isVehicle(k) || k === 'pump' || isDefense(k);
export const isRaider = (u: Unit) => u.owner === RAIDER;
/** Tiles an item covers: [x0, y0, x1, y1], inclusive. */
export function rectOf(i: { kind: ItemKind; x: number; y: number }): [number, number, number, number] { const [w, h] = footprint(i.kind); return [i.x, i.y, i.x + w - 1, i.y + h - 1]; }
/** The middle of an item's footprint, in tile units. */
export function centerOf(i: { kind: ItemKind; x: number; y: number }): [number, number] { const [w, h] = footprint(i.kind); return [i.x + w / 2, i.y + h / 2]; }

/** Loads left in layer k of a tile (0 organic .. 4 bedrock). */
export const layerLeft = (t: Tile, k: number): number => t[LAYER_KEYS[k]];
/** How many whole layers are gone from a tile. Water counts as fully open. */
export function tileLevel(t: Tile): number { if (t.water) return 5; let k = 0; while (k < 5 && t[LAYER_KEYS[k]] <= 0) k++; return k; }
export const isContainer = (k: ItemKind) => k === 'bucket' || k === 'barrow' || k === 'atv';
export const isWash = (k: ItemKind) => k === 'pan' || k === 'sluice';
/** Anything that needs water to run. */
export const needsWater = (k: ItemKind) => isWash(k) || k === 'washplant';
export const onGround = (i: Item) => i.carriedBy < 0 && i.inStation < 0;
