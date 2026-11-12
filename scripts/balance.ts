// A bot that plays whole seasons against the simulation, with no browser, to
// check the economy: can a sensible player climb from a gold pan to bedrock in
// 100 days? Run with `npm run balance` (add a seed count and a map size).
//
// The bot only sends the same commands a player can. It is a decent player,
// not a perfect one: it samples a little, stakes the best reading, and buys
// each upgrade as soon as it can comfortably afford it.

import { CLAIM_SIZE, SEASON_DAYS, STORE, TICKS_PER_DAY } from '../src/data/balance';
import type { Command } from '../src/sim/commands';
import { createGame } from '../src/sim/mapgen';
import { GameState, Item, isContainer, isTank, isVehicle, itemById, onGround, tileAt, tileLevel } from '../src/sim/state';
import { step } from '../src/sim/step';
import { canClaim, dailyBurn, nextClaimCost } from '../src/sim/systems/economy';
import { nearWater } from '../src/sim/systems/machines';

declare const process: { argv: string[]; env: Record<string, string | undefined> };

const price = (id: string) => STORE.find(e => e.id === id)!.price;
export interface Result { seed: number; cash: number; earned: number; busted: number; tier: number; days: Record<string, number>; dug: number[]; claims: number; hands: number }

export function playSeason(seed: number, size = 128, verbose = false): Result {
  const s = createGame(seed, size), me = 0, pl = s.players[0], boss = s.units[0];
  const bx = Math.floor(boss.x), by = Math.floor(boss.y);
  const days: Record<string, number> = {};
  const day = () => Math.floor(s.tick / TICKS_PER_DAY) + 1;
  const mark = (k: string) => { if (!(k in days)) { days[k] = day(); if (verbose) console.log(`  day ${day()}: ${k} (cash $${Math.round(pl.cash)})`); } };
  const mine = (kind: string) => s.items.filter(i => i.kind === kind && i.owner === me);
  const hands = () => s.units.filter(u => !u.boss);
  let centre: [number, number] | null = null, round = 0, claimRing = 0;
  let plant: [number, number] | null = null;

  // A dry tile beside the creek near the camp, for wash gear.
  const creekSpot = (skip: number): [number, number] => {
    let k = 0;
    for (let r = 0; r < 14; r++) for (let y = by - r; y <= by + r; y++) for (let x = bx - r; x <= bx + r; x++) {
      const t = tileAt(s, x, y); if (!t || t.water || !nearWater(s, x, y) || s.items.some(i => i.x === x && i.y === y)) continue;
      if (k++ >= skip) return [x, y];
    }
    return [bx, by];
  };
  const freeNear = (x0: number, y0: number, touch?: Item): [number, number] => {
    for (let r = 1; r < 8; r++) for (let y = y0 - r; y <= y0 + r; y++) for (let x = x0 - r; x <= x0 + r; x++) {
      const t = tileAt(s, x, y); if (!t || t.water || s.items.some(i => i.x === x && i.y === y)) continue;
      if (touch && (Math.abs(x - touch.x) > 1 || Math.abs(y - touch.y) > 1)) continue;
      return [x, y];
    }
    return [x0, y0];
  };

  function policy(cmds: Command[]) {
    const buy = (what: string, at?: [number, number]) => { cmds.push({ c: 'buy', p: me, what, x: at?.[0], y: at?.[1] }); mark(what); };
    // 1. Prospect: eight test pans in a spread west of camp, then stake the best reading.
    if (!centre) {
      // Sample in rounds of eight, walking outward along the creek, until something reads Rich or four rounds are done.
      if (boss.queue.length) return;
      let best = -1, at: [number, number] = [bx - 5, by];
      s.tiles.forEach((t, i) => { if (t.sample > best) { best = t.sample; at = [i % size, Math.floor(i / size)]; } });
      if (best < 3 && round < 8) {
        const dy = [0, 0, -9, 9, -9, 9, -18, 18][round], side = round % 2 ? 1 : -1; round++;
        for (let i = 0; i < 8; i++) { const tx = bx + side * (3 + (i % 4) * 3) + (side > 0 ? 3 : 0), ty = by + dy - 2 + Math.floor(i / 4) * 4; const t = tileAt(s, tx, ty); if (t && !t.water) cmds.push({ c: 'testpan', p: me, unit: boss.id, tx, ty }); }
        return;
      }
      const x0 = Math.max(0, Math.min(size - CLAIM_SIZE, at[0] - 4)), y0 = Math.max(0, Math.min(size - CLAIM_SIZE, at[1] - 4));
      cmds.push({ c: 'buyClaim', p: me, x0, y0 }); centre = [x0 + 4, y0 + 4]; mark('claim');
      return;
    }
    const [cx, cy] = centre, cash = pl.cash, burn = dailyBurn(s, me);
    const spare = cash - burn * 3;   // never spend the next three days of burn

    // 2. The prospector works the hand loop whenever idle.
    if (boss.queue.length === 0) {
      const c = itemById(s, boss.carrying);
      const wash = mine('sluice').find(i => nearWater(s, i.x, i.y) && onGround(i)) ?? mine('pan')[0];
      if (!c) { const b = s.items.find(i => isContainer(i.kind) && onGround(i) && i.contents === 'empty' && i.reservedBy < 0); if (b) cmds.push({ c: 'pickup', p: me, unit: boss.id, item: b.id }); }
      else if (c.contents === 'empty') {
        let bd = Infinity, at: [number, number] | null = null;
        for (let y = cy - 9; y <= cy + 9; y++) for (let x = cx - 9; x <= cx + 9; x++) { const t = tileAt(s, x, y); if (!t || t.owner !== me || t.water || t.organicLeft <= 0) continue; const d = (x - boss.x) ** 2 + (y - boss.y) ** 2; if (d < bd) { bd = d; at = [x, y]; } }
        if (at) cmds.push({ c: 'dig', p: me, unit: boss.id, tx: at[0], ty: at[1] });
      } else if (c.contents === 'paydirt') { const tr = mine('trommel')[0] ?? mine('washplant')[0] ?? mine('sieve')[0]; cmds.push({ c: 'use', p: me, unit: boss.id, station: tr.id }); }
      else if (wash) cmds.push({ c: 'use', p: me, unit: boss.id, station: wash.id });
    }

    // 3. Put new hires into the machines waiting for them, then onto the claim.
    for (const u of hands()) {
      if (u.vehicle >= 0) { if (!u.job) cmds.push({ c: 'job', p: me, units: [u.id], job: { type: 'dig', tx: cx, ty: cy } }); continue; }
      const v = s.items.find(i => isVehicle(i.kind) && i.owner === me && i.driver < 0 && !s.units.some(o => o.queue.some(q => q.t === 'mount' && q.item === i.id)));
      if (v && !u.queue.some(q => q.t === 'mount')) { cmds.push({ c: 'drive', p: me, unit: u.id, item: v.id }); continue; }
      if (!u.job && !u.queue.length) cmds.push({ c: 'job', p: me, units: [u.id], job: { type: 'dig', tx: cx, ty: cy } });
    }
    for (const t of s.items) if (isTank(t.kind) && t.owner === me && t.fuel < 0.5 * (t.kind === 'tank' ? 100 : t.kind === 'tank2' ? 500 : 2000) && cash > 600) cmds.push({ c: 'fuel', p: me, item: t.id });

    // 4. Shopping, cheapest step first.
    const onFoot = hands().filter(u => u.vehicle < 0).length, drivers = s.items.filter(i => isVehicle(i.kind) && i.owner === me).length;
    const has = (k: string) => mine(k).length > 0;
    if (pl.tier === 1) {
      // Hire only once the ground has proved it pays.
      if (onFoot < 2 && pl.earned > 400 && spare > price('worker') + 400) { buy('worker'); buy('bucket', [bx, by]); return; }
      if (spare > price('sluice') + 200) { buy('sluice', creekSpot(0)); return; }
      return;
    }
    if (onFoot < 4 && !has('excavator') && spare > 600) { buy('worker'); buy('bucket', [bx, by]); return; }
    if (!has('excavator') && !has('excavator2')) {
      if (spare > price('trommel') + price('tank') + price('excavator') + price('worker') + 500) {
        const sl = mine('sluice')[0];
        buy('trommel', freeNear(sl.x, sl.y, sl)); buy('tank', freeNear(sl.x - 2, sl.y + 2)); buy('excavator', [cx, cy]); buy('worker');
      }
      return;
    }
    // Room to dig: add claims around the first one as the ground runs out, or as the pit needs width.
    let left = 0; for (const t of s.tiles) if (t.owner === me && !t.water && t.organicLeft > 0) left++;
    const want = pl.tier >= 5 ? 9 : pl.tier >= 4 ? 6 : pl.tier >= 3 ? 4 : 2;
    if ((left < 16 || pl.claims < want) && spare > nextClaimCost(s, me) * 1.3) {
      const ring = [[-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1], [1, 0], [1, -1], [1, 1], [-2, 0], [-2, -1], [-2, 1], [0, -2], [-1, -2], [1, -2], [0, 2], [-1, 2], [-2, -2], [-2, 2]];
      for (let k = claimRing; k < ring.length; k++) {
        const x0 = cx - 4 + ring[k][0] * CLAIM_SIZE, y0 = cy - 4 + ring[k][1] * CLAIM_SIZE;
        if (canClaim(s, x0, y0)) { cmds.push({ c: 'buyClaim', p: me, x0, y0 }); claimRing = k + 1; mark('claim ' + (pl.claims + 1)); return; }
      }
    }
    if (pl.tier >= 3 && !has('washplant')) {
      if (spare > price('washplant') + price('excavator2') + price('dozer') + price('tank2') + 2 * price('worker') + 3000) {
        plant = creekSpot(2);
        buy('washplant', plant); buy('tank2', freeNear(plant[0] - 2, plant[1])); buy('excavator2', [cx + 1, cy]); buy('dozer', [cx - 1, cy]); buy('worker'); buy('worker');
      }
      return;
    }
    if (pl.tier >= 3 && !has('truck') && spare > price('truck') + price('worker') + 5000) { buy('truck', [cx, cy + 1]); buy('worker'); return; }
    if (pl.tier >= 3 && !has('fueltruck') && has('truck') && spare > price('fueltruck') + price('worker') + 5000) { buy('fueltruck', [cx, cy - 1]); buy('worker'); return; }
    if (pl.tier === 4 && !has('excavator3') && spare > price('excavator3') + price('tank3') + price('worker') + 5000) { buy('excavator3', [cx + 1, cy + 1]); buy('tank3', freeNear(plant![0] - 3, plant![1] + 1)); buy('worker'); return; }
    if (pl.tier === 5 && !has('excavator4') && spare > price('excavator4') + price('crusher') + price('mill') + price('worker') + 10000) {
      const wp = mine('washplant')[0], m = freeNear(wp.x, wp.y, wp);
      buy('mill', m); buy('crusher', freeNear(m[0], m[1], { x: m[0], y: m[1] } as Item)); buy('excavator4', [cx - 1, cy - 1]); buy('worker');
      return;
    }
    void drivers;
  }

  let busted = 0;
  while (!s.over) {
    const cmds: Command[] = [];
    if (s.tick % 10 === 0) policy(cmds);
    step(s, cmds); s.events.length = 0;
  }
  if (s.over === 'broke') busted = day();
  const dug = [0, 0, 0, 0, 0];
  for (const t of s.tiles) if (t.owner === me && !t.water) { const k = tileLevel(t); for (let i = 0; i < k; i++) dug[i]++; }
  return { seed, cash: Math.round(pl.cash), earned: Math.round(pl.earned), busted, tier: pl.tier, days, dug, claims: pl.claims, hands: hands().length };
}

if (!process.env.VITEST) {
  const n = Number(process.argv[2]) || 12, size = Number(process.argv[3]) || 128;
  const keys = ['worker', 'sluice', 'excavator', 'washplant', 'truck', 'excavator3', 'excavator4'];
  console.log(`Playing ${n} seasons of ${SEASON_DAYS} days on ${size} x ${size} maps\n`);
  console.log(['seed', ...keys, 'tier', 'claims', 'final cash', 'tiles to bedrock', 'bust'].join('\t'));
  const all: Result[] = [];
  for (let i = 1; i <= n; i++) {
    const r = playSeason(i * 101, size); all.push(r);
    console.log([r.seed, ...keys.map(k => r.days[k] ?? '-'), r.tier, r.claims, '$' + r.cash.toLocaleString(), r.dug[4], r.busted || '-'].join('\t'));
  }
  const med = (f: (r: Result) => number | undefined) => { const v = all.map(f).filter((x): x is number => x !== undefined).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : '-'; };
  console.log(`\nmedian day bought: ${keys.map(k => `${k} ${med(r => r.days[k])} (${all.filter(r => k in r.days).length}/${n})`).join(', ')}`);
  console.log(`median final cash $${Number(med(r => r.cash)).toLocaleString()}, busted ${all.filter(r => r.busted).length}/${n}, reached bedrock ${all.filter(r => r.dug[4] > 0).length}/${n}`);
}
