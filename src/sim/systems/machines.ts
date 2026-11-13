import { CRUSHER, GOLD_PRICE_PER_GRAM, HOPPER, MILL, PUMP, TANKS, TICKS_PER_DAY, TICKS_PER_SEC, TROMMEL, VEHICLES, WASH, WASHPLANT } from '../../data/balance';
import { GameState, Item, rectOf, isTank, isVehicle, needsWater, onGround, tileAt, tileLevel, unitById } from '../state';

const d2 = (a: Item, b: Item) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
/** Wrecked by raiders: it does nothing until it is repaired. */
export const broken = (it: Item) => it.maxHp > 0 && it.hp <= 0;
const ticks = (sec: number) => Math.max(1, Math.round(sec * TICKS_PER_SEC));

export function nearWater(s: GameState, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (tileAt(s, x + dx, y + dy)?.water) return true;
  return false;
}

/** Water for washing: the creek itself, or a running pump within hose range. */
export function wet(s: GameState, x: number, y: number, owner: number): boolean {
  if (nearWater(s, x, y)) return true;
  return s.items.some(p => p.kind === 'pump' && p.owner === owner && p.running && (p.x - x) ** 2 + (p.y - y) ** 2 <= PUMP.range ** 2);
}

/** Water for a machine: any tile it covers may touch the creek, or a pump may reach it. */
export function wetItem(s: GameState, it: Item): boolean {
  const [x0, y0, x1, y1] = rectOf(it);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (nearWater(s, x, y)) return true;
  return wet(s, it.x, it.y, it.owner);
}

/** Take diesel from the nearest of the owner's tanks that reaches this machine. */
export function drawFuel(s: GameState, it: Item, gallons: number): boolean {
  let best: Item | undefined, bd = Infinity;
  for (const t of s.items) {
    if (!isTank(t.kind) || t.owner !== it.owner || !onGround(t) || t.fuel < gallons) continue;
    const d = d2(t, it); if (d <= TANKS[t.kind].range ** 2 + 0.01 && d < bd) { bd = d; best = t; }
  }
  if (!best) return false;
  best.fuel -= gallons; return true;
}

/** A machine of the given kind on a tile touching this one. */
export function touching(s: GameState, it: Item, kind: string): Item | undefined {
  const [a0, b0, a1, b1] = rectOf(it);
  return s.items.find(i => {
    if (i.kind !== kind || i.owner !== it.owner || !onGround(i) || broken(i)) return false;
    const [c0, d0, c1, d1] = rectOf(i);
    return c0 <= a1 + 1 && c1 >= a0 - 1 && d0 <= b1 + 1 && d1 >= b0 - 1;
  });
}
export const linkedSluice = (s: GameState, tr: Item) => touching(s, tr, 'sluice');

/**
 * The pit rule: a tile may be at most one layer deeper than its shallowest
 * neighbour. Layer k of a tile can be dug once all four neighbours have lost
 * their first k layers. Ground off the map never opens.
 */
export function canDigLayer(s: GameState, tx: number, ty: number, k: number): boolean {
  if (k === 0) return true;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const t = tileAt(s, tx + dx, ty + dy);
    if (!t || tileLevel(t) < k) return false;
  }
  return true;
}
export const canDeepen = (s: GameState, tx: number, ty: number) => canDigLayer(s, tx, ty, 1);

function pay(s: GameState, it: Item, gold: number, recovery: number): number {
  const grams = gold * recovery, cash = grams * GOLD_PRICE_PER_GRAM, pl = s.players[it.owner];
  pl.cash += cash; pl.earned += cash; pl.goldGrams += grams; pl.loadsWashed++;
  return cash;
}
/** Move one load, and its share of the gold, out of a hopper. */
function takeLoad(it: Item): number {
  const g = it.hopperGold / it.hopper;
  it.hopper--; it.hopperGold -= g;
  if (it.hopper <= 0) { it.hopper = 0; it.hopperGold = 0; }
  return g;
}

export function tickMachines(s: GameState) {
  for (const it of s.items) {
    if (broken(it)) { it.running = false; it.note = 'Wrecked: repair it'; continue; }
    if (isVehicle(it.kind)) {
      const u = unitById(s, it.driver);
      it.running = !!u && it.fuel > 0 && (u.moving || u.workTotal > 0);
      if (u) { it.x = Math.floor(u.x); it.y = Math.floor(u.y); }
      if (it.running) it.fuel = Math.max(0, it.fuel - VEHICLES[it.kind].burnPerDay / TICKS_PER_DAY);
      it.note = u && it.fuel <= 0 ? 'Out of diesel' : '';
      continue;
    }
    if (it.kind === 'pump') {
      const placed = onGround(it) && nearWater(s, it.x, it.y);
      const needed = placed && s.items.some(w => needsWater(w.kind) && w.owner === it.owner && onGround(w) && !nearWater(s, w.x, w.y) && d2(w, it) <= PUMP.range ** 2);
      it.running = needed && drawFuel(s, it, PUMP.burnPerDay / TICKS_PER_DAY);
      it.note = !onGround(it) ? '' : !placed ? 'Set it beside the creek' : needed && !it.running ? 'No diesel in range' : '';
      continue;
    }
    if (it.kind === 'sluice') {            // a sluice fed by a trommel washes on its own
      it.running = false;
      if (it.feed <= 0 || !onGround(it) || !wet(s, it.x, it.y, it.owner)) continue;
      it.running = true;
      if (--it.timer <= 0) {
        const g = it.feedGold / it.feed;
        it.feed--; it.feedGold -= g; if (it.feed <= 0) { it.feed = 0; it.feedGold = 0; }
        s.events.push({ type: 'gold', owner: it.owner, x: it.x, y: it.y, amount: pay(s, it, g, WASH.sluice.recovery) });
        it.timer = ticks(WASH.sluice.secPerLoad);
      }
      continue;
    }
    if (it.kind !== 'trommel' && it.kind !== 'washplant' && it.kind !== 'crusher' && it.kind !== 'mill') continue;
    it.running = false;
    if (!onGround(it)) { it.note = ''; continue; }

    // Each processor passes loads to the next machine in its line.
    let next: Item | undefined, burn = 0, sec = 1;
    if (it.kind === 'trommel') {
      next = touching(s, it, 'sluice'); burn = TROMMEL.burnPerDay; sec = TROMMEL.secPerLoad;
      if (!next) { it.note = 'Needs a sluice on a touching tile'; continue; }
      if (!wet(s, next.x, next.y, next.owner)) { it.note = 'Its sluice needs water'; continue; }
      if (next.feed >= TROMMEL.feedMax) { it.note = ''; continue; }
    } else if (it.kind === 'crusher') {
      next = touching(s, it, 'mill'); burn = CRUSHER.burnPerDay; sec = CRUSHER.secPerLoad;
      if (!next) { it.note = 'Needs a mill on a touching tile'; continue; }
      if (next.hopper >= HOPPER.mill) { it.note = ''; continue; }
    } else if (it.kind === 'mill') {
      next = touching(s, it, 'washplant'); burn = MILL.burnPerDay; sec = MILL.secPerLoad;
      if (!next) { it.note = 'Needs a wash plant on a touching tile'; continue; }
      if (next.hopper >= HOPPER.washplant) { it.note = ''; continue; }
    } else {
      burn = WASHPLANT.burnPerDay; sec = WASHPLANT.secPerLoad;
      if (!wetItem(s, it)) { it.note = 'Needs water: creek or pump'; continue; }
      // report takings every two seconds, not once per load
      if (it.cargo > 0 && s.tick % 20 === 0) { s.events.push({ type: 'gold', owner: it.owner, x: it.x, y: it.y, amount: it.cargo }); it.cargo = 0; }
    }
    it.note = '';
    if (it.hopper <= 0) continue;
    if (!drawFuel(s, it, burn / TICKS_PER_DAY)) { it.note = 'No diesel in range'; continue; }
    it.running = true;
    if (--it.timer > 0) continue;
    it.timer = ticks(sec);
    const g = takeLoad(it);
    if (it.kind === 'trommel') { next!.feed++; next!.feedGold += g; }
    else if (it.kind === 'washplant') it.cargo += pay(s, it, g, WASHPLANT.recovery);
    else { next!.hopper++; next!.hopperGold += g; }
  }
}
