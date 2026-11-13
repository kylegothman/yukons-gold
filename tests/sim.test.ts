import { describe, expect, it } from 'vitest';
import { BANDS, GOLD_PRICE_PER_GRAM, SEASON_DAYS, TICKS_PER_DAY, bandOf } from '../src/data/balance';
import type { Command } from '../src/sim/commands';
import { createGame as newGame, organicGrade } from '../src/sim/mapgen';
import { deserialize, serialize } from '../src/sim/save';
import { step } from '../src/sim/step';
import { dailyBurn, nextClaimCost } from '../src/sim/systems/economy';
import { nearWater, wet } from '../src/sim/systems/machines';
import { canPlace, findPath } from '../src/sim/systems/nav';
import { newItem, newUnit } from '../src/sim/mapgen';
import { RAID, RAIDER } from '../src/data/balance';

// Most tests use the small map so they stay fast.
// Raids are switched off unless a test turns them on.
const createGame = (seed: number, size = 64) => { const s = newGame(seed, size); s.raid.next = 1e12; return s; };
const run = (s: ReturnType<typeof createGame>, ticks: number, cmds: Command[] = []) => { step(s, cmds); for (let i = 1; i < ticks && !s.over; i++) step(s); };

describe('map generation', () => {
  it('is deterministic for a seed', () => {
    expect(JSON.stringify(createGame(42).tiles)).toBe(JSON.stringify(createGame(42).tiles));
    expect(JSON.stringify(createGame(42).tiles)).not.toBe(JSON.stringify(createGame(43).tiles));
  });
  it('is mostly poor ground with a few rich pockets, and a creek top to bottom', () => {
    for (const seed of [1, 2, 3, 99]) {
      const s = createGame(seed);
      const counts = BANDS.map(() => 0);
      const land = s.tiles.filter(t => !t.water);
      land.forEach(t => counts[bandOf(organicGrade(t))]++);
      const share = counts.map(c => c / land.length);
      console.log(seed, share.map(x => x.toFixed(2)).join(' '));
      expect(share[0] + share[1]).toBeGreaterThan(0.5);
      expect(share[3] + share[4]).toBeGreaterThan(0.04);
      expect(share[3] + share[4]).toBeLessThan(0.3);
      for (let y = 0; y < s.size; y++) expect(s.tiles.slice(y * s.size, (y + 1) * s.size).some(t => t.water)).toBe(true);
    }
  });
  it('rich tiles cluster', () => {
    const s = createGame(7);
    let rich = 0, richNeighbors = 0, pairs = 0;
    for (let y = 1; y < s.size - 1; y++) for (let x = 1; x < s.size - 1; x++) {
      const t = s.tiles[y * s.size + x];
      if (t.water || bandOf(organicGrade(t)) < 3) continue;
      rich++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { pairs++; if (bandOf(organicGrade(s.tiles[(y + dy) * s.size + x + dx])) >= 3) richNeighbors++; }
    }
    const base = s.tiles.filter(t => bandOf(organicGrade(t)) >= 3).length / s.tiles.length;
    expect(richNeighbors / pairs).toBeGreaterThan(base * 2);
    expect(richNeighbors / pairs).toBeLessThan(0.95); // likely, not guaranteed
  });
});

describe('economy', () => {
  it('doing nothing goes broke in 20 days', () => {
    const s = createGame(1);
    expect(dailyBurn(s, 0)).toBe(50);
    run(s, TICKS_PER_DAY * 20 - 5);
    expect(s.over).toBe('');
    run(s, 10);
    expect(s.over).toBe('broke');
  });
  it('first claim is free, then $2,000, then 50% more each time', () => {
    const s = createGame(1);
    expect(nextClaimCost(s, 0)).toBe(0);
    step(s, [{ c: 'buyClaim', p: 0, x0: 0, y0: 0 }]);
    expect(nextClaimCost(s, 0)).toBe(2000);
    s.players[0].cash = 1e6;
    step(s, [{ c: 'buyClaim', p: 0, x0: 11, y0: 3 }]);
    expect(nextClaimCost(s, 0)).toBe(3000);
  });
  it('claims sit anywhere but cannot overlap', () => {
    const s = createGame(1); s.players[0].cash = 1e6;
    step(s, [{ c: 'buyClaim', p: 0, x0: 3, y0: 5 }]);
    expect(s.players[0].claims).toBe(1);
    expect(s.tiles[5 * s.size + 3].owner).toBe(0);
    expect(s.tiles[12 * s.size + 10].owner).toBe(0);
    expect(s.tiles[13 * s.size + 11].owner).toBe(-1);
    step(s, [{ c: 'buyClaim', p: 0, x0: 10, y0: 12 }]); // overlaps by one tile
    expect(s.players[0].claims).toBe(1);
    step(s, [{ c: 'buyClaim', p: 0, x0: 11, y0: 5 }]); // flush against it
    expect(s.players[0].claims).toBe(2);
    step(s, [{ c: 'buyClaim', p: 0, x0: 60, y0: 60 }]); // off the map
    expect(s.players[0].claims).toBe(2);
  });
  it('store orders land on the tile you pick, and gear can be relocated', () => {
    const s = createGame(5); s.players[0].cash = 5000;
    const boss = s.units[0], bx = Math.floor(boss.x), by = Math.floor(boss.y);
    step(s, [{ c: 'buy', p: 0, what: 'sluice', x: bx - 3, y: by - 2 }]);
    const sluice = s.items.find(i => i.kind === 'sluice')!;
    expect([sluice.x, sluice.y]).toEqual([bx - 3, by - 2]);
    const sieve = s.items.find(i => i.kind === 'sieve')!;
    run(s, 150, [{ c: 'relocate', p: 0, unit: boss.id, item: sieve.id, x: bx - 4, y: by + 2 }]);
    expect([sieve.x, sieve.y, sieve.carriedBy]).toEqual([bx - 4, by + 2, -1]);
    expect(boss.carrying).toBe(-1);
  });
  it('wages and upkeep add to the burn', () => {
    const s = createGame(1); s.players[0].cash = 5000;
    step(s, [{ c: 'buy', p: 0, what: 'worker' }, { c: 'buy', p: 0, what: 'sluice' }]);
    expect(dailyBurn(s, 0)).toBe(135);
  });
  it('buying each tier\'s key item opens the next tier', () => {
    const s = createGame(1); s.players[0].cash = 1e7;
    for (const [key, tier] of [['sluice', 2], ['excavator', 3], ['excavator2', 4], ['excavator3', 5]] as const) {
      step(s, [{ c: 'buy', p: 0, what: key }]);
      expect(s.players[0].tier).toBe(tier);
    }
  });
  it('season ends on day 100', () => {
    const s = createGame(1); s.players[0].cash = 1e9;
    run(s, SEASON_DAYS * TICKS_PER_DAY + 1);
    expect(s.over).toBe('season');
  });
});

describe('dig, sieve, pan', () => {
  it('a hand loop pays 70% of the gold in the load', () => {
    const s = createGame(5);
    const boss = s.units[0];
    const bucket = s.items.find(i => i.kind === 'bucket')!, sieve = s.items.find(i => i.kind === 'sieve')!, pan = s.items.find(i => i.kind === 'pan')!;
    const tx = Math.floor(boss.x) - 2, ty = Math.floor(boss.y);
    step(s, [{ c: 'buyClaim', p: 0, x0: tx - 4, y0: ty - 4 }]);
    const grade = organicGrade(s.tiles[ty * s.size + tx]);
    run(s, 60, [{ c: 'pickup', p: 0, unit: boss.id, item: bucket.id }]);
    expect(boss.carrying).toBe(bucket.id);
    run(s, 120, [{ c: 'dig', p: 0, unit: boss.id, tx, ty }]);
    expect(bucket.contents).toBe('paydirt');
    expect(bucket.gold).toBeCloseTo(grade);
    run(s, 120, [{ c: 'use', p: 0, unit: boss.id, station: sieve.id }]);
    expect(bucket.contents).toBe('fines');
    expect(boss.carrying).toBe(bucket.id);
    const before = s.players[0].earned;
    run(s, 200, [{ c: 'use', p: 0, unit: boss.id, station: pan.id }]);
    expect(s.players[0].earned - before).toBeCloseTo(grade * 0.7 * GOLD_PRICE_PER_GRAM);
    expect(bucket.contents).toBe('empty');
    expect(boss.carrying).toBe(bucket.id);
  });
  it('cannot dig unclaimed ground', () => {
    const s = createGame(5); const boss = s.units[0]; const bucket = s.items.find(i => i.kind === 'bucket')!;
    run(s, 60, [{ c: 'pickup', p: 0, unit: boss.id, item: bucket.id }]);
    run(s, 100, [{ c: 'dig', p: 0, unit: boss.id, tx: Math.floor(boss.x) - 2, ty: Math.floor(boss.y) }]);
    expect(bucket.contents).toBe('empty');
  });
  it('a three-person crew runs the whole chain unattended', () => {
    const s = createGame(5); s.players[0].cash = 3000;
    const boss = s.units[0];
    const sieve = s.items.find(i => i.kind === 'sieve')!, pan = s.items.find(i => i.kind === 'pan')!;
    const tx = Math.floor(boss.x) - 2, ty = Math.floor(boss.y);
    step(s, [{ c: 'buyClaim', p: 0, x0: tx - 4, y0: ty - 4 },
      { c: 'buy', p: 0, what: 'worker' }, { c: 'buy', p: 0, what: 'worker' }, { c: 'buy', p: 0, what: 'worker' }, { c: 'buy', p: 0, what: 'bucket' }]);
    const [a, b, c] = s.units.filter(u => !u.boss);
    step(s, [{ c: 'job', p: 0, units: [a.id], job: { type: 'dig', tx, ty } },
      { c: 'job', p: 0, units: [b.id], job: { type: 'operate', station: sieve.id } },
      { c: 'job', p: 0, units: [c.id], job: { type: 'operate', station: pan.id } }]);
    run(s, TICKS_PER_DAY * 4);
    console.log('crew: loads washed in 4 days', s.players[0].loadsWashed, 'tiles dug', s.players[0].tilesDug);
    expect(s.players[0].loadsWashed).toBeGreaterThan(20);
  });
  it('two hands sent to the claim run the whole chain with no station staff', () => {
    const s = createGame(5); s.players[0].cash = 3000;
    const boss = s.units[0];
    const tx = Math.floor(boss.x) - 2, ty = Math.floor(boss.y);
    step(s, [{ c: 'buyClaim', p: 0, x0: tx - 4, y0: ty - 4 },
      { c: 'buy', p: 0, what: 'worker' }, { c: 'buy', p: 0, what: 'worker' }, { c: 'buy', p: 0, what: 'bucket' }]);
    const hands = s.units.filter(u => !u.boss).map(u => u.id);
    step(s, [{ c: 'job', p: 0, units: hands, job: { type: 'dig', tx, ty } }]);
    run(s, TICKS_PER_DAY * 4);
    console.log('2 miners: loads washed in 4 days', s.players[0].loadsWashed);
    expect(s.players[0].loadsWashed).toBeGreaterThan(14);
  });
  it('one hand alone mines with the single starting bucket', () => {
    const s = createGame(5); s.players[0].cash = 3000;
    const boss = s.units[0];
    const tx = Math.floor(boss.x) - 2, ty = Math.floor(boss.y);
    step(s, [{ c: 'buyClaim', p: 0, x0: tx - 4, y0: ty - 4 }, { c: 'buy', p: 0, what: 'worker' }]);
    step(s, [{ c: 'job', p: 0, units: [s.units[1].id], job: { type: 'dig', tx, ty } }]);
    run(s, TICKS_PER_DAY * 3);
    console.log('1 miner: loads washed in 3 days', s.players[0].loadsWashed);
    expect(s.players[0].loadsWashed).toBeGreaterThan(5);
  });
  it('the boss hands a bucket to a staffed sieve and walks away', () => {
    const s = createGame(5); s.players[0].cash = 3000;
    const boss = s.units[0];
    const bucket = s.items.find(i => i.kind === 'bucket')!, sieve = s.items.find(i => i.kind === 'sieve')!;
    const tx = Math.floor(boss.x) - 2, ty = Math.floor(boss.y);
    step(s, [{ c: 'buyClaim', p: 0, x0: tx - 4, y0: ty - 4 }, { c: 'buy', p: 0, what: 'worker' }]);
    step(s, [{ c: 'job', p: 0, units: [s.units[1].id], job: { type: 'operate', station: sieve.id } }]);
    run(s, 60, [{ c: 'pickup', p: 0, unit: boss.id, item: bucket.id }]);
    run(s, 120, [{ c: 'dig', p: 0, unit: boss.id, tx, ty }]);
    run(s, 40, [{ c: 'use', p: 0, unit: boss.id, station: sieve.id }]);
    expect(boss.carrying).toBe(-1);
    expect(boss.queue.length).toBe(0);
    run(s, 100);
    expect(bucket.contents).toBe('fines');
  });
  it('a crew never deadlocks with every hand holding a full bucket', () => {
    // Regression: found by the balance bot. One sieve, more buckets than slots, nobody staffing it.
    const s = createGame(606); s.players[0].cash = 5000;
    const boss = s.units[0], bx = Math.floor(boss.x), by = Math.floor(boss.y);
    step(s, [{ c: 'buyClaim', p: 0, x0: bx - 7, y0: by - 4 }, { c: 'buy', p: 0, what: 'worker' }, { c: 'buy', p: 0, what: 'worker' }, { c: 'buy', p: 0, what: 'worker' },
      { c: 'buy', p: 0, what: 'bucket' }, { c: 'buy', p: 0, what: 'bucket' }, { c: 'buy', p: 0, what: 'bucket' }]);
    step(s, [{ c: 'job', p: 0, units: s.units.filter(u => !u.boss).map(u => u.id), job: { type: 'dig', tx: bx - 3, ty: by } }]);
    let last = 0;
    for (let d = 0; d < 12; d++) { run(s, TICKS_PER_DAY); expect(s.players[0].loadsWashed).toBeGreaterThan(last); last = s.players[0].loadsWashed; }
  });
  it('is deterministic with commands', () => {
    const play = () => { const s = createGame(9); step(s, [{ c: 'testpan', p: 0, unit: s.units[0].id, tx: 5, ty: 5 }]); for (let i = 0; i < 500; i++) step(s); return JSON.stringify(s); };
    expect(play()).toBe(play());
  });
});

describe('tier 2 machines', () => {
  // A claim with a trommel, sluice, tank and a driven excavator, set up beside the creek.
  function line(seed = 5) {
    const s = createGame(seed); s.players[0].cash = 50000;
    const boss = s.units[0], bx = Math.floor(boss.x), by = Math.floor(boss.y);
    step(s, [{ c: 'buyClaim', p: 0, x0: bx - 7, y0: by - 4 }, { c: 'buy', p: 0, what: 'sluice', x: bx + 1, y: by - 1 }]);
    step(s, [{ c: 'buy', p: 0, what: 'trommel', x: bx, y: by }, { c: 'buy', p: 0, what: 'tank', x: bx - 1, y: by + 1 },
      { c: 'buy', p: 0, what: 'excavator', x: bx - 2, y: by }, { c: 'buy', p: 0, what: 'worker' }]);
    const hand = s.units.find(u => !u.boss)!, ex = s.items.find(i => i.kind === 'excavator')!;
    run(s, 40, [{ c: 'drive', p: 0, unit: hand.id, item: ex.id }]);
    return { s, bx, by, hand, ex };
  }
  it('tier 2 is locked until a sluice box is bought', () => {
    const s = createGame(5); s.players[0].cash = 50000;
    step(s, [{ c: 'buy', p: 0, what: 'excavator' }]);
    expect(s.items.some(i => i.kind === 'excavator')).toBe(false);
    step(s, [{ c: 'buy', p: 0, what: 'sluice' }]); step(s, [{ c: 'buy', p: 0, what: 'excavator' }]);
    expect(s.items.some(i => i.kind === 'excavator')).toBe(true);
  });
  it('a driven excavator feeds the trommel, which feeds the sluice, which pays out', () => {
    const { s, bx, by, hand, ex } = line();
    expect(hand.vehicle).toBe(ex.id);
    const before = s.players[0].earned;
    run(s, TICKS_PER_DAY * 3, [{ c: 'job', p: 0, units: [hand.id], job: { type: 'dig', tx: bx - 3, ty: by } }]);
    const p = s.players[0];
    console.log('excavator line: 3 days washed', p.loadsWashed, 'loads, earned', Math.round(p.earned - before), 'tank', s.items.find(i => i.kind === 'tank')!.fuel.toFixed(1), 'ex fuel', ex.fuel.toFixed(1));
    expect(p.loadsWashed).toBeGreaterThan(40);
    expect(s.items.find(i => i.kind === 'tank')!.fuel).toBeLessThan(100);
  });
  it('topsoil waits for the pit rule', () => {
    const { s, bx, by, hand } = line();
    run(s, TICKS_PER_DAY * 12, [{ c: 'job', p: 0, units: [hand.id], job: { type: 'dig', tx: bx - 3, ty: by } }]);
    const n = s.size; let ringTop = 0, innerTop = 0;
    for (let y = by - 4; y < by + 4; y++) for (let x = bx - 7; x < bx + 1; x++) {
      const t = s.tiles[y * n + x]; if (t.water) continue;
      const edge = x === bx - 7 || x === bx || y === by - 4 || y === by + 3;
      if (edge) ringTop += 16 - t.topsoilLeft; else innerTop += 16 - t.topsoilLeft;
      expect(t.brownLeft).toBe(36); // a mini excavator never reaches the brown layer
    }
    console.log('topsoil dug: inner', innerTop, 'outer ring', ringTop);
    expect(innerTop).toBeGreaterThan(0);
    expect(ringTop).toBe(0); // unclaimed ground outside keeps the ring at organic depth
  });
  it('everything stops when the diesel runs out, and a refill restarts it', () => {
    const { s, bx, by, hand, ex } = line();
    const tank = s.items.find(i => i.kind === 'tank')!; tank.fuel = 0; ex.fuel = 0.05;
    run(s, TICKS_PER_DAY, [{ c: 'job', p: 0, units: [hand.id], job: { type: 'dig', tx: bx - 3, ty: by } }]);
    const stalled = s.players[0].loadsWashed;
    run(s, TICKS_PER_DAY);
    expect(s.players[0].loadsWashed).toBe(stalled);
    expect(ex.fuel).toBe(0);
    const cash = s.players[0].cash;
    step(s, [{ c: 'fuel', p: 0, item: tank.id }]);
    expect(cash - s.players[0].cash).toBeGreaterThan(390); // 100 gallons at $4
    run(s, TICKS_PER_DAY * 2);
    expect(s.players[0].loadsWashed).toBeGreaterThan(stalled);
  });
  it('a pump waters a sluice away from the creek', () => {
    const s = createGame(5); s.players[0].cash = 50000;
    const boss = s.units[0], bx = Math.floor(boss.x), by = Math.floor(boss.y);
    step(s, [{ c: 'buy', p: 0, what: 'sluice', x: bx - 6, y: by }]);
    const sl = s.items.find(i => i.kind === 'sluice')!;
    step(s); expect(wet(s, sl.x, sl.y, 0)).toBe(false);
    let px = bx; while (!nearWater(s, px, by)) px++;   // the first dry tile that touches the creek
    step(s, [{ c: 'buy', p: 0, what: 'pump', x: px, y: by }, { c: 'buy', p: 0, what: 'tank', x: bx - 1, y: by - 1 }]);
    run(s, 5); expect(wet(s, sl.x, sl.y, 0)).toBe(true);
    s.items.find(i => i.kind === 'tank')!.fuel = 0;
    run(s, 5); expect(wet(s, sl.x, sl.y, 0)).toBe(false);
  });
  it('a saved game resumes exactly where it left off', () => {
    const a = line(), b = line();
    const job: Command = { c: 'job', p: 0, units: [a.hand.id], job: { type: 'dig', tx: a.bx - 3, ty: a.by } };
    run(a.s, 900, [job]); run(b.s, 900, [job]);
    const data = JSON.stringify(serialize(a.s));
    const restored = deserialize(JSON.parse(data));
    run(restored, 900); run(b.s, 900);
    restored.events = []; b.s.events = []; // events are view-only and are not saved
    expect(JSON.stringify(restored)).toBe(JSON.stringify(b.s));
    const big = newGame(3, 256); step(big, [{ c: 'buyClaim', p: 0, x0: 100, y0: 100 }]);
    expect(JSON.stringify(serialize(big)).length).toBeLessThan(100000); // far under a browser's storage limit
  });
});

describe('tiers 3 to 5', () => {
  // Two claims side by side, fully stocked with the big machines, each with a driver.
  function bigPit(kinds: string[]) {
    const s = createGame(5); s.players[0].cash = 5e6; s.players[0].tier = 5;
    const boss = s.units[0], bx = Math.floor(boss.x), by = Math.floor(boss.y);
    step(s, [{ c: 'buyClaim', p: 0, x0: bx - 8, y0: by - 8 }, { c: 'buyClaim', p: 0, x0: bx - 16, y0: by - 8 }, { c: 'buyClaim', p: 0, x0: bx - 8, y0: by }, { c: 'buyClaim', p: 0, x0: bx - 16, y0: by }]);
    s.items = s.items.filter(i => i.kind !== 'sieve' && i.kind !== 'pan');   // the big plant goes where the hand gear stood
    step(s, [{ c: 'buy', p: 0, what: 'washplant', x: bx - 1, y: by + 1 }, { c: 'buy', p: 0, what: 'tank3', x: bx - 1, y: by + 3 },
      { c: 'buy', p: 0, what: 'mill', x: bx - 3, y: by + 1 }, { c: 'buy', p: 0, what: 'crusher', x: bx - 5, y: by + 1 }]);
    expect(s.items.filter(i => ['washplant', 'tank3', 'mill', 'crusher'].includes(i.kind)).length).toBe(4);
    const drivers: number[] = [];
    kinds.forEach((k, i) => {
      step(s, [{ c: 'buy', p: 0, what: k, x: bx - 3 - 4 * i, y: by - 4 }, { c: 'buy', p: 0, what: 'worker' }]);
      const hand = s.units[s.units.length - 1], veh = s.items[s.items.length - 1];
      run(s, 60, [{ c: 'drive', p: 0, unit: hand.id, item: veh.id }]);
      expect(hand.vehicle).toBe(veh.id);
      drivers.push(hand.id);
    });
    step(s, [{ c: 'job', p: 0, units: drivers, job: { type: 'dig', tx: bx - 8, ty: by } }]);
    return { s, bx, by };
  }
  const dug = (s: ReturnType<typeof createGame>, key: 'brownLeft' | 'blueLeft' | 'bedrockLeft', full: number) => s.tiles.reduce((a, t) => a + (t.water ? 0 : full - t[key]), 0);

  it('the brown layer waits for a dozer, then a mid excavator and wash plant work it', () => {
    const noDozer = bigPit(['excavator2']);
    run(noDozer.s, TICKS_PER_DAY * 14);
    expect(dug(noDozer.s, 'brownLeft', 36)).toBe(0);
    const { s } = bigPit(['excavator2', 'dozer']);
    run(s, TICKS_PER_DAY * 14);
    console.log('mid excavator + dozer, 14 days: brown loads dug', dug(s, 'brownLeft', 36), 'washed', s.players[0].loadsWashed, 'earned', Math.round(s.players[0].earned));
    expect(dug(s, 'brownLeft', 36)).toBeGreaterThan(100);
    expect(dug(s, 'blueLeft', 60)).toBe(0);
    expect(s.players[0].loadsWashed).toBeGreaterThan(500);
  });
  it('a dump truck hauls for the excavator', () => {
    const { s } = bigPit(['excavator2', 'truck']);
    run(s, TICKS_PER_DAY * 4);
    const truck = s.items.find(i => i.kind === 'truck')!;
    console.log('with truck, 4 days: washed', s.players[0].loadsWashed, 'truck load', truck.hopper);
    expect(s.players[0].loadsWashed).toBeGreaterThan(200);
  });
  it('the full line reaches bedrock and runs ore through crusher, mill and wash plant', () => {
    const { s } = bigPit(['excavator4', 'dozer', 'fueltruck']);
    const tank = s.items.find(i => i.kind === 'tank3')!;
    for (let d = 0; d < 60; d++) run(s, TICKS_PER_DAY, [{ c: 'fuel', p: 0, item: tank.id }]);
    const p = s.players[0];
    console.log('mining excavator, 60 days: blue dug', dug(s, 'blueLeft', 60), 'bedrock dug', dug(s, 'bedrockLeft', 12), 'earned', Math.round(p.earned),
      'machines', s.items.filter(i => ['crusher', 'mill', 'washplant', 'excavator4', 'fueltruck'].includes(i.kind)).map(i => `${i.kind}:${i.hopper}/${i.fuel.toFixed(0)}/${i.note}`).join(' '));
    expect(dug(s, 'blueLeft', 60)).toBeGreaterThan(0);
    expect(dug(s, 'bedrockLeft', 12)).toBeGreaterThan(0);
    expect(s.items.find(i => i.kind === 'crusher')!.hopper + s.items.find(i => i.kind === 'mill')!.hopper).toBeLessThan(90);
  });
  it('the pit rule holds at every depth', () => {
    const { s } = bigPit(['excavator4', 'dozer']);
    run(s, TICKS_PER_DAY * 60);
    const n = s.size, level = (x: number, y: number) => { const t = s.tiles[y * n + x]; if (t.water) return 9; let k = 0; const keys = ['organicLeft', 'topsoilLeft', 'brownLeft', 'blueLeft', 'bedrockLeft'] as const; while (k < 5 && t[keys[k]] <= 0) k++; return k; };
    let worst = 0;
    for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) { if (s.tiles[y * n + x].water) continue; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) worst = Math.max(worst, level(x, y) - level(x + dx, y + dy)); }
    expect(worst).toBeLessThanOrEqual(2); // a started layer counts one deeper than its last whole one
  });
  it('an ATV carries 8 loads and the drill rig reads every layer for a fee', () => {
    const s = createGame(5); s.players[0].cash = 1e5; s.players[0].tier = 2;
    const boss = s.units[0], bx = Math.floor(boss.x), by = Math.floor(boss.y);
    step(s, [{ c: 'buyClaim', p: 0, x0: bx - 7, y0: by - 4 }, { c: 'buy', p: 0, what: 'atv', x: bx, y: by }, { c: 'buy', p: 0, what: 'drill' }]);
    const atv = s.items.find(i => i.kind === 'atv')!;
    run(s, 30, [{ c: 'pickup', p: 0, unit: boss.id, item: atv.id }]);
    run(s, 450, [{ c: 'dig', p: 0, unit: boss.id, tx: bx - 2, ty: by }]);
    expect(atv.loads).toBe(8);
    const cash = s.players[0].cash;
    run(s, 200, [{ c: 'drop', p: 0, unit: boss.id }, { c: 'testpan', p: 0, unit: boss.id, tx: bx - 4, ty: by, deep: true }]);
    expect(s.tiles[by * s.size + bx - 4].drilled).toBe(true);
    expect(cash - s.players[0].cash).toBeGreaterThan(99);
  });
});

describe('footprints and pathfinding', () => {
  const open = (seed = 5) => { const s = createGame(seed); s.players[0].cash = 5e6; s.players[0].tier = 5; const b = s.units[0]; return { s, boss: b, bx: Math.floor(b.x), by: Math.floor(b.y) }; };
  it('nothing can be placed on an occupied square, and big machines cover several', () => {
    const { s, bx, by } = open();
    step(s, [{ c: 'buy', p: 0, what: 'washplant', x: bx - 8, y: by - 6 }]);
    const wp = s.items.find(i => i.kind === 'washplant')!;
    expect(wp).toBeTruthy();
    const cash = s.players[0].cash;
    for (const [dx, dy] of [[0, 0], [2, 1], [1, 0]]) step(s, [{ c: 'buy', p: 0, what: 'tank', x: wp.x + dx, y: wp.y + dy }]);
    expect(s.items.some(i => i.kind === 'tank')).toBe(false);
    expect(s.players[0].cash).toBeGreaterThan(cash - 10);         // refused orders cost nothing
    expect(canPlace(s, 'tank', wp.x + 3, wp.y)).toBe(true);       // right beside it is fine
    expect(canPlace(s, 'crusher', wp.x - 1, wp.y)).toBe(false);   // a 2 x 2 that would overlap
  });
  it('a walker goes around a wall of machines instead of through it', () => {
    const { s, boss, bx, by } = open();
    s.items.length = 0;
    for (let dy = -3; dy <= 3; dy++) newItem(s, 'tank', 0, bx - 4, by + dy);
    const wall = new Set(s.items.map(i => i.y * s.size + i.x));
    const { path, reached } = findPath(s, bx, by, bx - 8, by, false);
    expect(reached).toBe(true);
    expect(path.some(i => wall.has(i))).toBe(false);
    step(s, [{ c: 'move', p: 0, units: [boss.id], x: bx - 8 + 0.5, y: by + 0.5 }]);
    for (let i = 0; i < 200 && boss.queue.length; i++) { step(s); expect(wall.has(Math.floor(boss.y) * s.size + Math.floor(boss.x))).toBe(false); }
    expect(Math.hypot(boss.x - (bx - 7.5), boss.y - (by + 0.5))).toBeLessThan(0.1);
  });
});

describe('raids and defenses', () => {
  const camp = (seed = 5) => { const s = newGame(seed, 64); s.players[0].cash = 50000; const b = s.units[0]; return { s, boss: b, bx: Math.floor(b.x), by: Math.floor(b.y) }; };
  it('the first raid arrives after day 9: sneak thieves for a poor camp, a war party for a rich one', () => {
    const { s } = camp(); s.players[0].cash = 2000;
    run(s, RAID.firstDay * TICKS_PER_DAY - 5);
    expect(s.units.some(u => u.owner === RAIDER)).toBe(false);
    let stolen = 0, bandits = 0;
    for (let i = 0; i < 3 * TICKS_PER_DAY; i++) { step(s); stolen += s.events.filter(e => e.type === 'steal').length; bandits += s.units.filter(u => u.role === 'bandit').length; s.events.length = 0; }
    expect(stolen).toBeGreaterThan(0); expect(bandits).toBe(0); expect(s.over).toBe('');
    const rich = camp().s; rich.players[0].earned = 2e6;
    run(rich, (RAID.firstDay + 4) * TICKS_PER_DAY);
    expect(rich.over).toBe('dead');                       // nobody guarding the boss
  });
  it('guards and a tower see a raid off', () => {
    const { s, bx, by } = camp(); s.players[0].earned = 200000;
    step(s, [{ c: 'buy', p: 0, what: 'tower', x: bx - 2, y: by - 2 }, { c: 'buy', p: 0, what: 'guard' }, { c: 'buy', p: 0, what: 'guard' }, { c: 'buy', p: 0, what: 'guard' }]);
    expect(s.units.filter(u => u.role === 'guard').length).toBe(3);
    let saw = false, deaths = 0;
    for (let i = 0; i < 12 * TICKS_PER_DAY && !s.over; i++) { step(s); if (s.units.some(u => u.owner === RAIDER)) saw = true; deaths += s.events.filter(e => e.type === 'death' && e.owner === RAIDER).length; s.events.length = 0; }
    console.log('defended raid: raiders down', deaths, 'over', JSON.stringify(s.over), 'cash', Math.round(s.players[0].cash));
    expect(saw).toBe(true); expect(deaths).toBeGreaterThan(1); expect(s.over).toBe('');
  });
  it('a thief takes cash and gives it back if stopped', () => {
    const { s, bx, by } = camp(); s.raid.next = 1e12;
    const thief = newUnit(s, RAIDER, bx - 10.5, by + 0.5, false, 'thief');
    const before = s.players[0].cash;
    for (let i = 0; i < 300 && thief.loot === 0; i++) step(s);
    expect(thief.loot).toBeGreaterThan(100);
    expect(s.players[0].cash).toBeLessThan(before - 100);
    const mid = s.players[0].cash;
    newItem(s, 'tower', 0, Math.floor(thief.x) - 2, Math.floor(thief.y));
    run(s, 100);
    expect(s.units.includes(thief)).toBe(false);
    expect(s.players[0].cash).toBeGreaterThan(mid + 100);
  });
  it('a fence keeps bandits out until they break it, and a wrecked machine can be repaired', () => {
    const { s, boss, bx, by } = camp(); s.raid.next = 1e12; s.items.length = 0;
    const cx = bx - 6; boss.x = cx + 0.5;   // camp moved clear of the creek so the ring closes
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) newItem(s, 'chainfence', 0, cx + dx, by + dy);
    const fences = s.items.length;
    const bandit = newUnit(s, RAIDER, cx - 8.5, by + 0.5, false, 'bandit');
    expect(findPath(s, cx - 8, by, cx, by, true).reached).toBe(false);   // walled out
    expect(findPath(s, cx - 8, by, cx, by, false).reached).toBe(true);   // the crew uses the gates
    run(s, 150); expect(boss.hp).toBe(boss.maxHp);
    run(s, 600); expect(s.items.length).toBeLessThan(fences);            // through the fence eventually
    s.units.splice(s.units.indexOf(bandit), 1);
    const tank = newItem(s, 'tank', 0, bx - 6, by - 6); tank.hp = 0;
    const cash = s.players[0].cash;
    step(s, [{ c: 'repair', p: 0, item: tank.id }]);
    expect(tank.hp).toBe(tank.maxHp); expect(s.players[0].cash).toBeLessThan(cash);
  });
});
