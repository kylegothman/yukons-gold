import { DIGGERS, HOPPER, VEHICLES } from '../../data/balance';
import { GameState, Item, Unit, isContainer, isDigger, isTank, isVehicle, isWash, itemById, onGround, tileAt, tileLevel, unitById } from '../state';
import { canDigLayer, wet } from './machines';

const d2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;

function nearest(s: GameState, u: Unit, ok: (i: Item) => boolean, fx = u.x, fy = u.y, maxD2 = Infinity): Item | undefined {
  let best: Item | undefined, bd = maxD2;
  for (const i of s.items) {
    if (i.owner !== u.owner || !onGround(i) || !ok(i)) continue;
    const d = d2(fx, fy, i.x + 0.5, i.y + 0.5);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

const free = (u: Unit, i: Item) => i.reservedBy < 0 || i.reservedBy === u.id;
const freeEmpty = (u: Unit) => (i: Item) => isContainer(i.kind) && i.contents === 'empty' && free(u, i);

// The hired hand whose standing job is to work this station, if there is one.
export function operatorOf(s: GameState, stationId: number, except = -1): Unit | undefined {
  return s.units.find(o => o.id !== except && o.job?.type === 'operate' && o.job.station === stationId);
}
// Someone else is already on their way to work or empty this station.
const targeted = (s: GameState, st: Item, u: Unit) =>
  s.units.some(o => { const q = o.queue[0]; return o.id !== u.id && o.blocked < 5 && !!q && (q.t === 'operate' || q.t === 'take') && q.station === st.id; });
const anyStaffed = (s: GameState, u: Unit, ok: (i: Item) => boolean) =>
  s.items.some(i => i.owner === u.owner && onGround(i) && ok(i) && operatorOf(s, i.id, u.id));

function findDigTile(s: GameState, u: Unit, tx: number, ty: number): [number, number] | null {
  let best: [number, number] | null = null, bd = Infinity;
  for (let y = ty - 8; y <= ty + 8; y++) for (let x = tx - 8; x <= tx + 8; x++) {
    const t = tileAt(s, x, y);
    if (!t || t.owner !== u.owner || t.water || t.organicLeft <= 0) continue;
    const d = d2(tx, ty, x, y);
    if (d < bd) { bd = d; best = [x, y]; }
  }
  return best;
}

function idleAt(u: Unit, x: number, y: number, status: string) {
  u.status = status;
  if (d2(u.x, u.y, x + 0.5, y + 0.5) > 1.6) u.queue.push({ t: 'move', x: x + 0.5 + Math.cos(u.id) * 0.7, y: y + 0.5 + Math.sin(u.id) * 0.7 });
}

// Hand a loaded bucket to a station: load it, or set it down beside a station that is already loaded.
// Setting it down frees the hand to work the station, so a crew can never all stand waiting with full buckets.
function deliver(s: GameState, u: Unit, st: Item) {
  const slotted = st.kind === 'sieve' || isWash(st.kind);
  if (slotted && st.inSlot >= 0 && (operatorOf(s, st.id, u.id) || st.operator < 0)) u.queue.push({ t: 'dropAt', x: st.x, y: st.y });
  else u.queue.push({ t: 'put', station: st.id });
}

/**
 * Where a vehicle's load of dirt or ore should go. Ore only goes to a crusher.
 * Dirt goes to a processor with room for it, and to the wash plant ahead of a
 * trommel, since the plant is the faster line.
 */
function processorFor(s: GameState, u: Unit, ore: boolean, load = 0): Item | undefined {
  if (ore) return nearest(s, u, i => i.kind === 'crusher');
  let best: Item | undefined, bs = Infinity;
  for (const i of s.items) {
    if (i.owner !== u.owner || !onGround(i) || (i.kind !== 'trommel' && i.kind !== 'washplant')) continue;
    const score = Math.sqrt(d2(u.x, u.y, i.x + 0.5, i.y + 0.5)) + (HOPPER[i.kind] - i.hopper < load ? 1000 : 0) + (i.kind === 'trommel' ? 12 : 0);
    if (score < bs) { bs = score; best = i; }
  }
  return best;
}

/** A hand in a machine: what it does next depends on the machine. */
function planDriver(s: GameState, u: Unit) {
  const job = u.job, veh = itemById(s, u.vehicle)!, V = VEHICLES[veh.kind];
  if (!job || job.type !== 'dig') { u.status = 'In the cab: right-click your claim to put it to work'; return; }
  // Diesel: drive to a tank when low, unless a fuel truck is doing the rounds.
  const tanker = veh.kind !== 'fueltruck' && s.items.some(i => i.kind === 'fueltruck' && i.owner === u.owner && i.cargo > 0 && unitById(s, i.driver)?.job);
  if (veh.fuel < V.tank * (tanker ? 0.08 : 0.2)) {
    const tank = nearest(s, u, i => isTank(i.kind) && i.fuel > 0);
    if (tank) { u.queue.push({ t: 'refuel', tank: tank.id }); return; }
    if (veh.fuel <= 0) { u.status = 'Out of diesel: fill a tank'; return; }
  }

  if (isDigger(veh.kind)) {
    if (veh.hopper > 0) {
      // Prefer a truck waiting close by, so the excavator never leaves the cut.
      const truck = nearest(s, u, i => i.kind === 'truck' && i.driver >= 0 && !unitById(s, i.driver)?.moving && HOPPER.truck - i.hopper >= veh.hopper && (i.hopper === 0 || i.ore === veh.ore), u.x, u.y, 4.5 * 4.5);
      const target = truck ?? processorFor(s, u, veh.ore, veh.hopper);
      if (!target) { u.status = veh.ore ? 'Bedrock ore needs a crusher' : 'Needs a trommel or wash plant to dump into'; return; }
      u.queue.push({ t: 'dump', station: target.id }); return;
    }
    const reach = DIGGERS[veh.kind].maxLayer;
    let best: [number, number] | null = null, bd = Infinity, blocked = '';
    for (let y = job.ty - 12; y <= job.ty + 12; y++) for (let x = job.tx - 12; x <= job.tx + 12; x++) {
      const t = tileAt(s, x, y);
      if (!t || t.owner !== u.owner || t.water) continue;
      const k = tileLevel(t);
      if (k > 4 || k > reach) continue;
      if (!canDigLayer(s, x, y, k)) continue;
      if (k === 2 && !t.ripped) { blocked = 'Waiting for a dozer to rip the brown layer'; continue; }
      const d = d2(job.tx, job.ty, x, y); if (d < bd) { bd = d; best = [x, y]; }
    }
    if (!best) { u.status = blocked || 'Nothing left it can dig here'; return; }
    // The job tile stays put, so the pit deepens around it instead of wandering.
    u.queue.push({ t: 'scoop', tx: best[0], ty: best[1] }); return;
  }

  if (veh.kind === 'dozer') {
    let best: [number, number] | null = null, bd = Infinity;
    for (let y = job.ty - 12; y <= job.ty + 12; y++) for (let x = job.tx - 12; x <= job.tx + 12; x++) {
      const t = tileAt(s, x, y);
      if (!t || t.owner !== u.owner || t.water || t.ripped || tileLevel(t) !== 2) continue;
      const d = d2(u.x, u.y, x + 0.5, y + 0.5); if (d < bd) { bd = d; best = [x, y]; }
    }
    if (!best) { u.status = 'Nothing to rip: the brown layer shows once topsoil is off'; return; }
    u.queue.push({ t: 'rip', tx: best[0], ty: best[1] }); return;
  }

  if (veh.kind === 'truck') {
    // Park beside the nearest working excavator; haul to the plant when full or when loading stops.
    const digger = nearest(s, u, i => isDigger(i.kind) && i.driver >= 0 && !!unitById(s, i.driver)?.job, job.tx + 0.5, job.ty + 0.5);
    // veh.timer counts ticks since the load last changed, so a part load still gets hauled
    if (veh.hopper !== veh.feed) { veh.feed = veh.hopper; veh.timer = 0; } else veh.timer++;
    const full = veh.hopper >= HOPPER.truck * 0.75, stale = veh.hopper > 0 && (veh.timer > 80 || !digger);
    if (full || stale) {
      const target = processorFor(s, u, veh.ore);
      if (!target) { u.status = veh.ore ? 'Bedrock ore needs a crusher' : 'Needs a wash plant or trommel to dump into'; return; }
      u.queue.push({ t: 'dump', station: target.id }); return;
    }
    if (!digger) { u.status = 'Waiting for an excavator to serve'; return; }
    const dj = unitById(s, digger.driver)!.job!, cx = dj.type === 'dig' ? dj.tx + 0.5 : digger.x + 0.5, cy = dj.type === 'dig' ? dj.ty + 0.5 : digger.y + 0.5;
    const plant = processorFor(s, u, false);
    let ax = plant ? plant.x + 0.5 - cx : 1, ay = plant ? plant.y + 0.5 - cy : 0; const al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
    const px = cx + ax * 2.2, py = cy + ay * 2.2;
    if (d2(u.x, u.y, px, py) > 1.2) { u.queue.push({ t: 'move', x: px, y: py }); return; }
    u.status = veh.hopper > 0 ? 'Being loaded' : 'Waiting to be loaded';
    return;
  }

  if (veh.kind === 'fueltruck') {
    if (veh.cargo < 10) {
      const tank = nearest(s, u, i => isTank(i.kind) && i.fuel > 0);
      if (tank) { u.queue.push({ t: 'refuel', tank: tank.id }); return; }
      u.status = 'No diesel to carry: fill a tank'; return;
    }
    const thirsty = nearest(s, u, i => isVehicle(i.kind) && i.id !== veh.id && i.fuel < VEHICLES[i.kind].tank * 0.5);
    if (thirsty) { u.queue.push({ t: 'fuelup', item: thirsty.id }); return; }
    u.status = 'Every machine is fuelled';
  }
}

// Decide a hired hand's next single step. Called whenever its queue is empty.
export function planWorker(s: GameState, u: Unit) {
  const job = u.job;
  if (u.vehicle >= 0) { planDriver(s, u); return; }
  if (!job) { u.status = 'Idle: right-click your claim to put them to work'; return; }
  const c = itemById(s, u.carrying);
  const wash = (fx = u.x, fy = u.y) => nearest(s, u, i => isWash(i.kind) && wet(s, i.x, i.y, i.owner), fx, fy);
  const dropHere = () => u.queue.push({ t: 'dropAt', x: Math.floor(u.x), y: Math.floor(u.y) });

  // Miner: works the whole chain alone, like a harvester. Dig, screen, wash, come back.
  // Any station that has its own operator is left to them.
  if (job.type === 'dig') {
    if (c && !isContainer(c.kind)) { dropHere(); return; }
    if (c && c.contents === 'empty') {
      const spot = findDigTile(s, u, job.tx, job.ty);
      if (!spot) { u.status = 'No ground left to dig here'; return; }
      job.tx = spot[0]; job.ty = spot[1];
      u.queue.push({ t: 'dig', tx: spot[0], ty: spot[1] }); return;
    }
    if (c) {
      const sieve = c.contents === 'paydirt' ? nearest(s, u, i => i.kind === 'sieve' || i.kind === 'trommel' || i.kind === 'washplant') : undefined;
      const target = sieve ?? wash();
      if (!target) { u.status = 'No pan or sluice at the creek'; return; }
      deliver(s, u, target); return;
    }
    const open = (st: Item) => !operatorOf(s, st.id, u.id) && !targeted(s, st, u);
    const near = 15 * 15;
    const take = nearest(s, u, i => i.kind === 'sieve' && i.outSlot >= 0 && open(i), u.x, u.y, near);
    if (take) { u.queue.push({ t: 'take', station: take.id }); return; }
    const screen = nearest(s, u, i => i.kind === 'sieve' && i.inSlot >= 0 && i.outSlot < 0 && open(i), u.x, u.y, near);
    if (screen) { u.queue.push({ t: 'operate', station: screen.id }); return; }
    const pan = nearest(s, u, i => isWash(i.kind) && i.inSlot >= 0 && wet(s, i.x, i.y, i.owner) && open(i), u.x, u.y, near);
    if (pan) { u.queue.push({ t: 'operate', station: pan.id }); return; }
    // Loaded buckets left lying around, unless an operator is there to deal with them.
    const sieveStaffed = anyStaffed(s, u, i => i.kind === 'sieve'), washStaffed = anyStaffed(s, u, i => isWash(i.kind));
    const stray = nearest(s, u, i => isContainer(i.kind) && free(u, i) && ((i.contents === 'paydirt' && !sieveStaffed) || (i.contents === 'fines' && !washStaffed)), u.x, u.y, near);
    const b = stray ?? nearest(s, u, freeEmpty(u));
    if (!b) { u.status = 'Waiting for an empty bucket'; return; }
    b.reservedBy = u.id; u.queue.push({ t: 'pickup', item: b.id }); return;
  }

  const st = itemById(s, job.station);
  if (!st) { u.job = null; u.status = 'Idle: station is gone'; return; }
  if (!onGround(st)) { u.status = 'Waiting: station is being moved'; return; }
  if (st.kind !== 'sieve' && !isWash(st.kind)) { u.job = null; return; }
  const pile = (ok: (i: Item) => boolean) => nearest(s, u, i => isContainer(i.kind) && free(u, i) && ok(i), st.x + 0.5, st.y + 0.5, 2.2 * 2.2);

  if (st.kind === 'sieve') {
    if (c) {
      if (!isContainer(c.kind)) { dropHere(); return; }
      if (c.contents === 'fines') {
        const w = wash(st.x, st.y);
        if (!w) { u.status = 'No pan or sluice at the creek'; return; }
        deliver(s, u, w); return;
      }
      if (c.contents === 'paydirt') { u.queue.push({ t: 'put', station: st.id }); return; }
      u.queue.push({ t: 'dropAt', x: st.x, y: st.y }); return; // bring empties home
    }
    if (st.outSlot >= 0) { u.queue.push({ t: 'take', station: st.id }); return; }
    if (st.inSlot >= 0) { u.queue.push({ t: 'operate', station: st.id }); return; }
    // Hands free away from the sieve (just delivered fines): carry an empty back.
    if (d2(u.x, u.y, st.x + 0.5, st.y + 0.5) > 4) {
      const b = nearest(s, u, freeEmpty(u));
      if (b && d2(u.x, u.y, b.x + 0.5, b.y + 0.5) < 4) { b.reservedBy = u.id; u.queue.push({ t: 'pickup', item: b.id }); return; }
    }
    const waiting = pile(i => i.contents === 'paydirt');
    if (waiting) { waiting.reservedBy = u.id; u.queue.push({ t: 'pickup', item: waiting.id }); return; }
    return idleAt(u, st.x, st.y, 'Waiting for pay dirt');
  }

  // Pan or sluice.
  if (c) {
    if (isContainer(c.kind) && c.contents !== 'empty') u.queue.push({ t: 'put', station: st.id }); else dropHere();
    return;
  }
  if (!wet(s, st.x, st.y, st.owner)) { u.status = 'Needs water: move it to the creek'; return; }
  if (st.inSlot >= 0) { u.queue.push({ t: 'operate', station: st.id }); return; }
  const hasSieve = s.items.some(i => i.owner === u.owner && i.kind === 'sieve' && onGround(i));
  const waiting = pile(i => i.contents === 'fines' || (i.contents === 'paydirt' && !hasSieve));
  if (waiting) { waiting.reservedBy = u.id; u.queue.push({ t: 'pickup', item: waiting.id }); return; }
  return idleAt(u, st.x, st.y, 'Waiting for dirt to wash');
}
