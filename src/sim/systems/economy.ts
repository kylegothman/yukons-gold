import {
  CLAIM_COST_GROWTH, CLAIM_SIZE, DIESEL_PRICE, TANKS, TIER_KEYS, FIRST_EXTRA_CLAIM_COST, LIVING_COST_PER_DAY, PRICE, SEASON_DAYS,
  SELL_BACK, STORE, TICKS_PER_DAY, UPKEEP, WORKER_WAGE_PER_DAY,
} from '../../data/balance';
import type { ItemKind } from '../../data/balance';
import { newItem, newUnit } from '../mapgen';
import { GameState, isContainer, isTank, itemById, onGround, tileAt, unitById } from '../state';
import { clearQueue, dropCarried } from './orders';

export function dailyBurn(s: GameState, p: number): number {
  let burn = LIVING_COST_PER_DAY;
  for (const u of s.units) if (u.owner === p && !u.boss) burn += WORKER_WAGE_PER_DAY;
  for (const i of s.items) if (i.owner === p) burn += UPKEEP[i.kind] ?? 0;
  return burn;
}

export function nextClaimCost(s: GameState, p: number): number {
  const n = s.players[p].claims;
  return n === 0 ? 0 : Math.round(FIRST_EXTRA_CLAIM_COST * Math.pow(CLAIM_COST_GROWTH, n - 1));
}

// A claim is CLAIM_SIZE x CLAIM_SIZE tiles and can sit anywhere on the map that
// is not already claimed. (x0, y0) is its top-left tile.
export function canClaim(s: GameState, x0: number, y0: number): boolean {
  if (x0 < 0 || y0 < 0 || x0 + CLAIM_SIZE > s.size || y0 + CLAIM_SIZE > s.size) return false;
  for (let y = y0; y < y0 + CLAIM_SIZE; y++) for (let x = x0; x < x0 + CLAIM_SIZE; x++) if (tileAt(s, x, y)!.owner !== -1) return false;
  return true;
}

export function buyClaim(s: GameState, p: number, x0: number, y0: number): boolean {
  const pl = s.players[p];
  if (!canClaim(s, x0, y0)) { s.events.push({ type: 'toast', owner: p, text: 'Claims cannot overlap or leave the map' }); return false; }
  const cost = nextClaimCost(s, p);
  if (pl.cash < cost) { s.events.push({ type: 'toast', owner: p, text: 'Not enough cash for that claim' }); return false; }
  pl.cash -= cost; pl.claims++;
  for (let y = y0; y < y0 + CLAIM_SIZE; y++) for (let x = x0; x < x0 + CLAIM_SIZE; x++) tileAt(s, x, y)!.owner = p;
  s.events.push({ type: 'claim', owner: p, x: x0 + CLAIM_SIZE / 2, y: y0 + CLAIM_SIZE / 2, amount: cost });
  return true;
}

export function buy(s: GameState, p: number, what: string, px?: number, py?: number): boolean {
  const pl = s.players[p];
  const entry = STORE.find(e => e.id === what);
  const boss = s.units.find(u => u.owner === p && u.boss);
  if (!entry || !boss) return false;
  if (entry.tier > pl.tier) { s.events.push({ type: 'toast', owner: p, text: `Tier ${entry.tier} is still locked` }); return false; }
  if (what === 'drill' && pl.drill) { s.events.push({ type: 'toast', owner: p, text: 'You already own a drill rig' }); return false; }
  if (pl.cash < entry.price) { s.events.push({ type: 'toast', owner: p, text: `Not enough cash for ${entry.name.toLowerCase()}` }); return false; }
  pl.cash -= entry.price;
  // Gear is delivered to the tile the player picked, or to the miner's feet.
  const placed = px !== undefined && py !== undefined && !!tileAt(s, px, py);
  const tx = placed ? px! : Math.floor(boss.x), ty = placed ? py! : Math.floor(boss.y);
  const opens = TIER_KEYS[what];
  if (what === 'drill') {
    pl.drill = true;
    s.events.push({ type: 'buy', owner: p, x: tx, y: ty, text: 'Drill rig ready: press R, then click a tile' });
  } else if (what === 'worker') {
    const u = newUnit(s, p, boss.x + 0.4, boss.y + 0.3, false);
    s.events.push({ type: 'hire', owner: p, x: u.x, y: u.y, text: `${u.name} hired` });
  } else {
    newItem(s, what as ItemKind, p, tx, ty);
    s.events.push({ type: 'buy', owner: p, x: tx, y: ty, text: `${entry.name} delivered` });
  }
  if (opens && pl.tier < opens) { pl.tier = opens; s.events.push({ type: 'toast', owner: p, text: `Tier ${opens} unlocked in the store` }); }
  return true;
}

export function sell(s: GameState, p: number, itemId: number): boolean {
  const it = itemById(s, itemId);
  if (!it || it.owner !== p || !onGround(it)) return false;
  if (it.driver >= 0) { s.events.push({ type: 'toast', owner: p, text: 'The driver has to get out first' }); return false; }
  if (it.inSlot >= 0 || it.outSlot >= 0 || it.operator >= 0 || it.hopper > 0 || it.feed > 0 || (isContainer(it.kind) && it.contents !== 'empty')) {
    s.events.push({ type: 'toast', owner: p, text: 'Empty it before selling' }); return false;
  }
  const value = Math.round((PRICE[it.kind] ?? 0) * SELL_BACK);
  s.players[p].cash += value;
  s.items.splice(s.items.indexOf(it), 1);
  s.events.push({ type: 'toast', owner: p, text: `Sold for $${value}` });
  return true;
}

export function fire(s: GameState, p: number, unitId: number): boolean {
  const u = s.units.find(x => x.id === unitId);
  if (!u || u.owner !== p || u.boss) return false;
  clearQueue(s, u); dropCarried(s, u); dismount(s, u.id);
  s.units.splice(s.units.indexOf(u), 1);
  s.events.push({ type: 'toast', owner: p, text: `${u.name} let go` });
  return true;
}

export function dismount(s: GameState, unitId: number) {
  const u = unitById(s, unitId); if (!u || u.vehicle < 0) return;
  const ex = itemById(s, u.vehicle); if (ex) ex.driver = -1;
  clearQueue(s, u); u.vehicle = -1; u.job = null;
}

/** Top a diesel tank up from the store, as far as cash allows. */
export function fillTank(s: GameState, p: number, itemId: number): boolean {
  const t = itemById(s, itemId), pl = s.players[p];
  if (!t || !isTank(t.kind) || t.owner !== p) return false;
  const cap = TANKS[t.kind].capacity;
  const gal = Math.min(cap - t.fuel, Math.floor(pl.cash / DIESEL_PRICE));
  if (gal <= 0) { s.events.push({ type: 'toast', owner: p, text: t.fuel >= cap ? 'The tank is already full' : 'Not enough cash for diesel' }); return false; }
  t.fuel += gal; pl.cash -= gal * DIESEL_PRICE;
  s.events.push({ type: 'refuel', owner: p, x: t.x, y: t.y });
  s.events.push({ type: 'toast', owner: p, text: `${Math.round(gal)} gallons delivered for $${Math.round(gal * DIESEL_PRICE)}` });
  return true;
}

export function tickEconomy(s: GameState) {
  for (const pl of s.players) {
    pl.cash -= dailyBurn(s, pl.id) / TICKS_PER_DAY;
    if (pl.cash <= 0) { pl.cash = 0; s.over = 'broke'; }
  }
  if (!s.over && s.tick >= SEASON_DAYS * TICKS_PER_DAY) s.over = 'season';
}
