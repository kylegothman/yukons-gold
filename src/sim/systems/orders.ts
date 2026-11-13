import {
  ATV_SPEED_BOOST, BANDS, CAPACITY, DIG_SEC_PER_LOAD, DIGGERS, DRILL_FEE, DRILL_SEC, EXCAVATOR, FUEL_TRUCK_CARGO, HOPPER, LAYERS, LAYER_KEYS, VEHICLES, GOLD_PRICE_PER_GRAM, SIEVE_SEC_PER_LOAD, TEST_PAN_ERROR_CHANCE,
  TEST_PAN_SEC, TICKS_PER_SEC, UNIT_SPEED, UNIT_STATS, UNSCREENED_PENALTY, WASH, bandOf,
} from '../../data/balance';
import { layerGrade, organicGrade } from '../mapgen';
import { canDigLayer, wet } from './machines';
import { SOLID, canPlace, dirty, distToItem, grid, waypoint } from './nav';

const ITEM_LABEL: Record<string, string> = { trommel: 'trommel', washplant: 'wash plant', crusher: 'crusher', mill: 'mill', truck: 'truck' };
export { nearWater } from './machines';
import { nextRandom } from '../rng';
import { GameState, Item, Unit, centerOf, isFixture, rectOf, isContainer, isDigger, isStation, isTank, isVehicle, isWash, itemById, onGround, tileAt, tileLevel } from '../state';

export function clearQueue(s: GameState, u: Unit) {
  u.queue.length = 0; u.workLeft = 0; u.workTotal = 0; u.blocked = 0;
  for (const i of s.items) {
    if (i.reservedBy === u.id) i.reservedBy = -1;
    if (i.operator === u.id) i.operator = -1;
  }
}

export function dropCarried(s: GameState, u: Unit) {
  const it = itemById(s, u.carrying);
  if (it) { it.carriedBy = -1; it.x = Math.floor(u.x); it.y = Math.floor(u.y); }
  u.carrying = -1;
}

function fail(s: GameState, u: Unit, text: string) {
  if (u.boss) s.events.push({ type: 'toast', owner: u.owner, text });
  u.status = text;
  clearQueue(s, u);
}

let cur: GameState;
let speed = UNIT_SPEED; // set per unit at the top of runOrder: an excavator is slower, and stops with no fuel

// Walk toward a point, around anything in the way; true once there.
function approach(u: Unit, tx: number, ty: number): boolean {
  const step = speed / TICKS_PER_SEC;
  if (step <= 0) return Math.hypot(tx - u.x, ty - u.y) < 0.01;
  // Heading for a machine: pulling up beside it is as good as being there.
  const gr = grid(cur), ti = Math.floor(ty) * cur.size + Math.floor(tx);
  if (gr.grid[ti] === SOLID) { const it = itemById(cur, gr.ids[ti]); if (it && distToItem(it, u.x, u.y) <= 0.4) { u.nav = null; return true; } }
  const w = waypoint(cur, u, tx, ty);
  const dx = w.x - u.x, dy = w.y - u.y, d = Math.hypot(dx, dy);
  const last = w.x === tx && w.y === ty;
  if (!w.reached && d < 0.05) { u.blocked++; return false; }   // walled off: wait at the closest point
  if (d <= step) { u.x = w.x; u.y = w.y; if (last) { u.nav = null; return true; } u.moving = true; return false; }
  u.x += (dx / d) * step; u.y += (dy / d) * step;
  u.moving = true;
  const sx = dx - dy; // screen-space x direction in the isometric view
  if (Math.abs(sx) > 0.01) u.facing = sx > 0 ? 1 : -1;
  return false;
}

// Each unit stands at its own spot on a tile so crews do not stack up.
function spot(u: Unit, tx: number, ty: number): [number, number] {
  const a = u.id * 2.4;
  return [tx + 0.5 + Math.cos(a) * 0.28, ty + 0.5 + Math.sin(a) * 0.28];
}

// Where to pull up beside a machine: `gap` tiles off the nearest edge of its footprint.
function standoff(it: Item, u: Unit, gap: number): [number, number] {
  const [x0, y0, x1, y1] = rectOf(it), [cx, cy] = centerOf(it);
  const px = Math.max(x0, Math.min(x1 + 1, u.x)), py = Math.max(y0, Math.min(y1 + 1, u.y));
  let dx = u.x - px, dy = u.y - py;
  if (Math.hypot(dx, dy) < 0.01) { dx = u.x - cx; dy = u.y - cy; }
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) { dx = 1; dy = 0; }
  // Leave along one axis, so the machine pulls up square to the edge.
  if (Math.abs(dx) >= Math.abs(dy)) return [dx > 0 ? x1 + 1 + gap : x0 - gap, Math.max(y0 + 0.5, Math.min(y1 + 0.5, u.y))];
  return [Math.max(x0 + 0.5, Math.min(x1 + 0.5, u.x)), dy > 0 ? y1 + 1 + gap : y0 - gap];
}

function work(u: Unit, seconds: number): boolean {
  if (u.workTotal === 0) { u.workTotal = Math.max(1, Math.round(seconds * TICKS_PER_SEC)); u.workLeft = u.workTotal; }
  u.workLeft--;
  if (u.workLeft <= 0) { u.workTotal = 0; u.workLeft = 0; return true; }
  return false;
}

function done(u: Unit) { u.queue.shift(); u.blocked = 0; u.workTotal = 0; u.workLeft = 0; }

export function washSeconds(station: Item, bucket: Item): number {
  const w = WASH[station.kind as 'pan' | 'sluice'];
  return w.secPerLoad * bucket.loads * (bucket.contents === 'paydirt' ? UNSCREENED_PENALTY : 1);
}

export function runOrder(s: GameState, u: Unit) {
  const o = u.queue[0];
  if (!o) return;
  const carried = itemById(s, u.carrying);
  const veh = itemById(s, u.vehicle);
  cur = s;
  // A dry excavator can only limp to a tank.
  speed = veh ? (veh.fuel > 0 ? VEHICLES[veh.kind].speed : 0.5) : carried?.kind === 'atv' ? UNIT_SPEED * ATV_SPEED_BOOST : UNIT_STATS[u.role].speed;
  if (veh && veh.maxHp > 0 && veh.hp <= 0) { u.status = 'Machine wrecked'; u.blocked++; return; }
  if (veh && veh.fuel <= 0 && o.t !== 'refuel') { u.status = 'Out of diesel'; u.blocked++; return; }
  if (veh && o.t !== 'move' && o.t !== 'scoop' && o.t !== 'dump' && o.t !== 'refuel' && o.t !== 'rip' && o.t !== 'fuelup') return fail(s, u, 'Get out of the machine first');
  switch (o.t) {
    case 'move': {
      u.status = 'Walking';
      if (approach(u, o.x, o.y)) done(u);
      return;
    }
    case 'pickup': {
      const it = itemById(s, o.item);
      if (!it || !onGround(it)) return fail(s, u, 'That is gone');
      if (carried) return fail(s, u, 'Hands are full (G to drop)');
      if (isVehicle(it.kind)) return fail(s, u, 'Too heavy to carry: have a hired hand drive it');
      if (it.operator >= 0 && it.operator !== u.id) return fail(s, u, 'Someone is working it right now');
      it.reservedBy = u.id;
      u.status = 'Fetching ' + it.kind;
      const [px, py] = spot(u, it.x, it.y);
      if (!approach(u, px, py)) return;
      // Moving a station sets any buckets sitting in it down where it stood.
      for (const slot of [it.inSlot, it.outSlot]) { const b = itemById(s, slot); if (b) { b.inStation = -1; b.x = it.x; b.y = it.y; } }
      it.inSlot = -1; it.outSlot = -1;
      it.carriedBy = u.id; it.reservedBy = -1; u.carrying = it.id; dirty(s);
      return done(u);
    }
    case 'dropAt': {
      if (!carried) return done(u);
      u.status = 'Carrying ' + carried.kind;
      const [px, py] = spot(u, o.x, o.y);
      if (isFixture(carried.kind) && !canPlace(s, carried.kind, o.x, o.y, carried.id)) return fail(s, u, 'Something is already there');
      if (!approach(u, px, py)) return;
      carried.carriedBy = -1; carried.x = o.x; carried.y = o.y; u.carrying = -1; dirty(s);
      return done(u);
    }
    case 'testpan': {
      const t = tileAt(s, o.tx, o.ty);
      if (!t || t.water) return fail(s, u, 'Nothing to sample there');
      u.status = 'Walking to sample';
      const [px, py] = spot(u, o.tx, o.ty);
      if (!approach(u, px, py)) return;
      if (o.deep) {
        // Core drill: exact grades for every layer of the tile, for a fee.
        const pl = s.players[u.owner];
        if (t.drilled) return done(u);
        if (pl.cash < DRILL_FEE) return fail(s, u, 'Not enough cash for a core sample');
        u.status = 'Core drilling';
        if (!work(u, DRILL_SEC)) return;
        pl.cash -= DRILL_FEE; t.drilled = true; t.sample = bandOf(organicGrade(t)); pl.samples++;
        s.events.push({ type: 'drill', owner: u.owner, x: o.tx, y: o.ty, amount: t.sample });
        return done(u);
      }
      u.status = 'Test panning';
      if (!work(u, TEST_PAN_SEC)) return;
      let band = bandOf(organicGrade(t));
      if (!t.known && !t.drilled && nextRandom(s) < TEST_PAN_ERROR_CHANCE) {
        band += nextRandom(s) < 0.5 ? -1 : 1;
        band = Math.max(0, Math.min(BANDS.length - 1, band));
      }
      t.sample = band;
      s.players[u.owner].samples++;
      s.events.push({ type: 'sample', owner: u.owner, x: o.tx, y: o.ty, amount: band });
      return done(u);
    }
    case 'dig': {
      const t = tileAt(s, o.tx, o.ty);
      if (!carried || !isContainer(carried.kind)) return fail(s, u, 'Pick up a bucket first');
      if (carried.contents !== 'empty') return fail(s, u, 'That bucket is already full');
      if (!t || t.water) return fail(s, u, 'Cannot dig there');
      if (t.owner !== u.owner) return fail(s, u, 'Stake a claim here first (C)');
      if (t.organicLeft <= 0) return fail(s, u, 'Dug out: deeper layers need machines');
      u.status = 'Walking to dig';
      const [px, py] = spot(u, o.tx, o.ty);
      if (!approach(u, px, py)) return;
      u.status = 'Digging';
      const cap = CAPACITY[carried.kind];
      if (!work(u, DIG_SEC_PER_LOAD * Math.min(cap, t.organicLeft))) return;
      const loads = Math.min(cap, t.organicLeft);
      t.organicLeft -= loads; t.known = true;
      carried.contents = 'paydirt'; carried.loads = loads; carried.gold = loads * organicGrade(t);
      s.events.push({ type: 'dig', x: o.tx, y: o.ty, owner: u.owner });
      if (t.organicLeft <= 0) { s.players[u.owner].tilesDug++; s.events.push({ type: 'dug', x: o.tx, y: o.ty, owner: u.owner }); }
      return done(u);
    }
    case 'put': {
      const st = itemById(s, o.station);
      if (!st || !onGround(st)) return fail(s, u, 'Station is gone');
      if (!carried || !isContainer(carried.kind) || carried.contents === 'empty') return fail(s, u, 'Nothing to load');
      if (st.kind === 'trommel' || st.kind === 'washplant') {
        // Tip the bucket into the hopper and keep the bucket.
        if (carried.contents !== 'paydirt') return fail(s, u, 'Already screened: take it to the creek');
        u.status = 'Carrying pay dirt';
        const [hx, hy] = spot(u, st.x, st.y);
        if (!approach(u, hx, hy)) return;
        if (st.hopper + carried.loads > HOPPER[st.kind]) { u.blocked++; u.status = 'Waiting: hopper is full'; return; }
        st.hopper += carried.loads; st.hopperGold += carried.gold;
        carried.contents = 'empty'; carried.loads = 0; carried.gold = 0;
        s.events.push({ type: 'dump', x: st.x, y: st.y, owner: u.owner });
        return done(u);
      }
      if (st.kind === 'sieve' && carried.contents !== 'paydirt') return fail(s, u, 'Already screened: take it to the creek');
      if (isWash(st.kind) && !wet(s, st.x, st.y, st.owner)) return fail(s, u, 'Needs water: move it to the creek or add a pump');
      u.status = 'Carrying ' + (carried.contents === 'fines' ? 'fines' : 'pay dirt');
      const [px, py] = spot(u, st.x, st.y);
      if (!approach(u, px, py)) return;
      if (st.inSlot >= 0) { u.blocked++; u.status = 'Waiting on ' + st.kind; return; }
      st.inSlot = carried.id; carried.carriedBy = -1; carried.inStation = st.id; carried.x = st.x; carried.y = st.y; u.carrying = -1;
      return done(u);
    }
    case 'operate': {
      const st = itemById(s, o.station);
      if (!st || !onGround(st)) return fail(s, u, 'Station is gone');
      const [px, py] = spot(u, st.x, st.y);
      u.status = 'Walking to ' + st.kind;
      if (!approach(u, px, py)) return;
      const b = itemById(s, st.inSlot);
      if (!b) return fail(s, u, 'Nothing loaded');
      // Screened dirt still sitting in the sieve: clear it instead of standing there.
      if (st.kind === 'sieve' && st.outSlot >= 0 && !carried && st.operator < 0) { u.queue.splice(0, u.queue.length, { t: 'take', station: st.id }); return; }
      if ((st.kind === 'sieve' && st.outSlot >= 0) || (st.operator >= 0 && st.operator !== u.id)) { u.blocked++; u.status = 'Waiting on ' + st.kind; return; }
      st.operator = u.id;
      if (st.kind === 'sieve') {
        u.status = 'Sieving';
        if (!work(u, SIEVE_SEC_PER_LOAD * b.loads)) return;
        b.contents = 'fines'; st.inSlot = -1; st.outSlot = b.id;
        s.events.push({ type: 'sieve', x: st.x, y: st.y, owner: u.owner });
      } else {
        u.status = st.kind === 'pan' ? 'Panning' : 'Running sluice';
        if (!work(u, washSeconds(st, b))) return;
        const grams = b.gold * WASH[st.kind as 'pan' | 'sluice'].recovery;
        const pl = s.players[st.owner];
        const cash = grams * GOLD_PRICE_PER_GRAM;
        pl.cash += cash; pl.earned += cash; pl.goldGrams += grams; pl.loadsWashed += b.loads;
        s.events.push({ type: 'gold', owner: st.owner, x: st.x, y: st.y, amount: cash });
        b.contents = 'empty'; b.loads = 0; b.gold = 0; b.inStation = -1; st.inSlot = -1;
      }
      st.operator = -1;
      return done(u);
    }
    case 'mount': {
      const ex = itemById(s, o.item);
      if (!ex || !isVehicle(ex.kind) || !onGround(ex)) return fail(s, u, 'That is gone');
      if (ex.driver >= 0 && ex.driver !== u.id) return fail(s, u, 'Someone is already driving it');
      u.status = 'Walking to the ' + (isDigger(ex.kind) ? 'excavator' : ex.kind === 'dozer' ? 'dozer' : 'truck');
      if (!approach(u, ex.x + 0.5, ex.y + 0.5)) return;
      if (carried) { carried.carriedBy = -1; carried.x = ex.x; carried.y = ex.y; u.carrying = -1; }
      ex.driver = u.id; u.vehicle = ex.id;
      return done(u);
    }
    case 'scoop': {
      const t = tileAt(s, o.tx, o.ty);
      if (!veh || !isDigger(veh.kind)) return fail(s, u, 'No excavator');
      if (!t || t.water || t.owner !== u.owner) return fail(s, u, 'Cannot dig there');
      const k = tileLevel(t), reach = DIGGERS[veh.kind].maxLayer;
      if (k > 4) return fail(s, u, 'Dug out to the bottom');
      if (k > reach) return fail(s, u, `The ${LAYERS[k].name.toLowerCase()} needs: ${LAYERS[k].tool.toLowerCase()}`);
      if (!canDigLayer(s, o.tx, o.ty, k)) return fail(s, u, 'Dig the tiles around it down first');
      if (k === 2 && !t.ripped) return fail(s, u, 'A dozer has to rip the brown layer first');
      u.status = 'Driving to the dig';
      if (!approach(u, o.tx + 0.5, o.ty + 0.5)) return;
      u.status = 'Digging ' + LAYERS[k].name.toLowerCase();
      if (!work(u, EXCAVATOR.scoopSec)) return;
      const key = LAYER_KEYS[k], left = t[key], loads = Math.min(DIGGERS[veh.kind].scoop, left);
      t[key] = left - loads; if (k === 0) t.known = true;
      veh.hopper = loads; veh.hopperGold = loads * layerGrade(t, k); veh.ore = k === 4;
      s.events.push({ type: 'scoop', x: o.tx, y: o.ty, owner: u.owner });
      if (left - loads <= 0) { if (k === 0) s.players[u.owner].tilesDug++; s.events.push({ type: 'dug', x: o.tx, y: o.ty, owner: u.owner }); }
      return done(u);
    }
    case 'rip': {
      const t = tileAt(s, o.tx, o.ty);
      if (!veh || veh.kind !== 'dozer') return fail(s, u, 'No dozer');
      if (!t || t.owner !== u.owner || t.ripped || tileLevel(t) !== 2) return done(u);
      u.status = 'Driving to the cut';
      if (!approach(u, o.tx + 0.5, o.ty + 0.5)) return;
      u.status = 'Ripping the brown layer';
      if (!work(u, EXCAVATOR.ripSec)) return;
      t.ripped = true;
      s.events.push({ type: 'rip', x: o.tx, y: o.ty, owner: u.owner });
      return done(u);
    }
    case 'dump': {
      // Tip a vehicle's load into a processor, or an excavator's scoop into a waiting truck.
      const st = itemById(s, o.station);
      if (!veh || !st || !(st.kind in HOPPER) || !onGround(st)) return fail(s, u, 'Nowhere to dump');
      if (veh.hopper <= 0) return done(u);
      u.status = st.kind === 'truck' ? 'Loading the truck' : 'Hauling to the ' + ITEM_LABEL[st.kind];
      if (distToItem(st, u.x, u.y) > 0.8 + 0.15 && !approach(u, ...standoff(st, u, 0.8))) return;
      const space = HOPPER[st.kind] - st.hopper, mixed = st.kind === 'truck' && st.hopper > 0 && st.ore !== veh.ore;
      if (space <= 0 || mixed || (space < veh.hopper && isDigger(veh.kind))) { u.blocked++; u.status = 'Waiting: no room to dump'; return; }
      u.status = 'Dumping';
      if (!work(u, EXCAVATOR.dumpSec)) return;
      const n = Math.min(space, veh.hopper), g = veh.hopperGold * (n / veh.hopper);
      st.hopper += n; st.hopperGold += g; veh.hopper -= n; veh.hopperGold -= g;
      if (st.kind === 'truck') st.ore = veh.ore;
      if (veh.hopper <= 0) { veh.hopper = 0; veh.hopperGold = 0; }
      s.events.push({ type: 'dump', x: st.x, y: st.y, owner: u.owner });
      if (veh.hopper > 0) return;   // a truck keeps tipping as the hopper drains
      return done(u);
    }
    case 'refuel': {
      const tank = itemById(s, o.tank);
      if (!veh || !tank || !isTank(tank.kind) || !onGround(tank)) return fail(s, u, 'No diesel tank');
      u.status = 'Driving to refuel';
      if (distToItem(tank, u.x, u.y) > 0.8 + 0.15 && !approach(u, ...standoff(tank, u, 0.8))) return;
      if (tank.fuel <= 0) return fail(s, u, 'The tank is empty');
      u.status = 'Refuelling';
      if (!work(u, EXCAVATOR.refuelSec)) return;
      let gal = Math.min(VEHICLES[veh.kind].tank - veh.fuel, tank.fuel);
      veh.fuel += gal; tank.fuel -= gal;
      if (veh.kind === 'fueltruck') { gal = Math.min(FUEL_TRUCK_CARGO - veh.cargo, tank.fuel); veh.cargo += gal; tank.fuel -= gal; }
      s.events.push({ type: 'refuel', x: tank.x, y: tank.y, owner: u.owner });
      return done(u);
    }
    case 'fuelup': {
      // A fuel truck tops another machine up where it stands.
      const target = itemById(s, o.item);
      if (!veh || veh.kind !== 'fueltruck' || !target || !isVehicle(target.kind)) return done(u);
      if (veh.cargo <= 0 || target.fuel >= VEHICLES[target.kind].tank - 0.5) return done(u);
      u.status = 'Taking diesel out to a machine';
      if (distToItem(target, u.x, u.y) > 1.0 + 0.15 && !approach(u, ...standoff(target, u, 1.0))) return;
      u.status = 'Fuelling a machine';
      if (!work(u, 2)) return;
      const gal = Math.min(VEHICLES[target.kind].tank - target.fuel, veh.cargo);
      target.fuel += gal; veh.cargo -= gal;
      s.events.push({ type: 'refuel', x: target.x, y: target.y, owner: u.owner });
      return done(u);
    }
    case 'take': {
      const st = itemById(s, o.station);
      if (!st || !onGround(st)) return fail(s, u, 'Station is gone');
      if (carried) return fail(s, u, 'Hands are full');
      const [px, py] = spot(u, st.x, st.y);
      if (!approach(u, px, py)) return;
      const b = itemById(s, st.outSlot);
      if (!b) return done(u);
      st.outSlot = -1; b.inStation = -1; b.carriedBy = u.id; u.carrying = b.id;
      return done(u);
    }
  }
}
