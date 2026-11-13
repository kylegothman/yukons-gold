import type { Command } from './commands';
import { GameState, isRaider, isContainer, isStation, isVehicle, isWash, itemById, onGround, tileAt, unitById } from './state';
import { buy, buyClaim, dismount, fillTank, fire, repair, sell, tickEconomy } from './systems/economy';
import { tickMachines } from './systems/machines';
import { operatorOf, planWorker } from './systems/jobs';
import { clearQueue, dropCarried, runOrder } from './systems/orders';
import { bossDefends, planGuard, planRaider, tickCombat } from './systems/combat';
import { freeTile, standable } from './systems/nav';

function toast(s: GameState, p: number, text: string) { s.events.push({ type: 'toast', owner: p, text }); }

function apply(s: GameState, cmd: Command) {
  const own = (id: number) => { const u = unitById(s, id); return u && u.owner === cmd.p ? u : undefined; };
  // Someone in an excavator can only drive and excavate until they get out.
  if (cmd.c === 'dig' || cmd.c === 'testpan' || cmd.c === 'pickup' || cmd.c === 'use' || cmd.c === 'place' || cmd.c === 'relocate' || cmd.c === 'drive') {
    const u = own(cmd.unit); if (u && u.vehicle >= 0) { toast(s, cmd.p, 'Get out of the machine first'); return; }
  }
  switch (cmd.c) {
    case 'move':
      cmd.units.forEach((id, i) => {
        const u = own(id); if (!u) return;
        clearQueue(s, u); u.job = null; u.target = -1;
        const a = i * 2.4, r = cmd.units.length > 1 ? 0.45 * Math.sqrt(i) : 0;
        let x = Math.max(0.1, Math.min(s.size - 0.1, cmd.x + Math.cos(a) * r));
        let y = Math.max(0.1, Math.min(s.size - 0.1, cmd.y + Math.sin(a) * r));
        // Nobody stands on top of a machine: aim for the nearest open tile instead.
        if (!standable(s, Math.floor(x), Math.floor(y))) { const [fx, fy] = freeTile(s, Math.floor(x), Math.floor(y)); x = fx + 0.5; y = fy + 0.5; }
        if (u.role === 'guard') u.post = { x, y };
        u.queue.push({ t: 'move', x, y });
      });
      return;
    case 'dig': { const u = own(cmd.unit); if (!u) return; clearQueue(s, u); u.queue.push({ t: 'dig', tx: cmd.tx, ty: cmd.ty }); return; }
    case 'testpan': {
      // Samples chain: clicking several tiles in a row queues them up.
      const u = own(cmd.unit); if (!u) return;
      if (cmd.deep && !s.players[cmd.p].drill) { toast(s, cmd.p, 'Buy a drill rig first'); return; }
      const chaining = u.queue.length > 0 && u.queue.length < 8 && u.queue.every(o => o.t === 'testpan');
      if (!chaining) clearQueue(s, u);
      u.job = null; u.queue.push({ t: 'testpan', tx: cmd.tx, ty: cmd.ty, deep: !!cmd.deep }); return;
    }
    case 'pickup': { const u = own(cmd.unit); if (!u) return; clearQueue(s, u); u.job = null; u.queue.push({ t: 'pickup', item: cmd.item }); return; }
    case 'drop': { const u = own(cmd.unit); if (!u) return; clearQueue(s, u); dropCarried(s, u); return; }
    case 'place': { const u = own(cmd.unit); if (!u || !tileAt(s, cmd.x, cmd.y)) return; clearQueue(s, u); u.queue.push({ t: 'dropAt', x: cmd.x, y: cmd.y }); return; }
    case 'use': {
      // One click runs the whole station visit for a hands-on miner.
      const u = own(cmd.unit), st = itemById(s, cmd.station);
      if (!u || !st || !(isStation(st.kind) || st.kind === 'trommel' || st.kind === 'washplant') || !onGround(st)) return;
      clearQueue(s, u); u.job = null;
      const c = itemById(s, u.carrying);
      const loaded = c && isContainer(c.kind) && c.contents !== 'empty';
      // A hired hand runs this station: just hand the bucket over and walk away.
      const hand = operatorOf(s, st.id);
      if (hand && loaded && (isWash(st.kind) || c!.contents === 'paydirt')) {
        u.queue.push(st.inSlot < 0 ? { t: 'put', station: st.id } : { t: 'dropAt', x: st.x, y: st.y });
        toast(s, cmd.p, `Left for ${hand.name}`);
        return;
      }
      if (st.kind === 'trommel' || st.kind === 'washplant') {
        if (c && c.contents === 'paydirt') u.queue.push({ t: 'put', station: st.id });
        else toast(s, cmd.p, 'Tip pay dirt in here, or let the excavator fill it');
      } else if (st.kind === 'sieve') {
        // If the sieve is already loaded, set this bucket down and deal with what is in it first.
        if (c && c.contents === 'paydirt' && st.inSlot >= 0 && st.operator < 0) { u.queue.push({ t: 'dropAt', x: st.x, y: st.y }); if (st.outSlot < 0) u.queue.push({ t: 'operate', station: st.id }); u.queue.push({ t: 'take', station: st.id }); }
        else if (c && c.contents === 'paydirt') u.queue.push({ t: 'put', station: st.id }, { t: 'operate', station: st.id }, { t: 'take', station: st.id });
        else if (c) toast(s, cmd.p, c.contents === 'fines' ? 'Already screened: take it to the pan' : 'Fill the bucket with dirt first');
        else if (st.outSlot >= 0) u.queue.push({ t: 'take', station: st.id });
        else if (st.inSlot >= 0) u.queue.push({ t: 'operate', station: st.id }, { t: 'take', station: st.id });
        else toast(s, cmd.p, 'Bring a bucket of pay dirt to the sieve');
      } else if (isWash(st.kind)) {
        if (loaded) u.queue.push({ t: 'put', station: st.id }, { t: 'operate', station: st.id }, { t: 'pickup', item: c!.id });
        else if (c) toast(s, cmd.p, 'Nothing in the bucket to wash');
        else if (st.inSlot >= 0) u.queue.push({ t: 'operate', station: st.id });
        else toast(s, cmd.p, 'Bring dirt here to wash it');
      }
      return;
    }
    case 'job':
      for (const id of cmd.units) {
        const u = own(id); if (!u || u.boss || u.role === 'guard') continue;
        if (u.vehicle >= 0 && cmd.job && cmd.job.type !== 'dig') { toast(s, cmd.p, 'Get out of the machine first'); continue; }
        clearQueue(s, u);
        u.job = cmd.job ? { ...cmd.job } : null;
      }
      return;
    case 'buyClaim': buyClaim(s, cmd.p, cmd.x0, cmd.y0); return;
    case 'relocate': {
      const u = own(cmd.unit), it = itemById(s, cmd.item);
      if (!u || !it || it.owner !== cmd.p || !tileAt(s, cmd.x, cmd.y)) return;
      clearQueue(s, u); u.job = null;
      if (u.carrying >= 0 && u.carrying !== it.id) dropCarried(s, u);
      if (u.carrying !== it.id) u.queue.push({ t: 'pickup', item: it.id });
      u.queue.push({ t: 'dropAt', x: cmd.x, y: cmd.y });
      return;
    }
    case 'buy': buy(s, cmd.p, cmd.what, cmd.x, cmd.y); return;
    case 'sell': sell(s, cmd.p, cmd.item); return;
    case 'fire': fire(s, cmd.p, cmd.unit); return;
    case 'drive': {
      const u = own(cmd.unit), ex = itemById(s, cmd.item);
      if (!u || !ex || !isVehicle(ex.kind) || ex.owner !== cmd.p) return;
      if (u.boss) { toast(s, cmd.p, 'Only hired hands drive machines'); return; }
      clearQueue(s, u); u.job = null; u.queue.push({ t: 'mount', item: ex.id });
      return;
    }
    case 'dismount': { if (own(cmd.unit)) dismount(s, cmd.unit); return; }
    case 'fuel': fillTank(s, cmd.p, cmd.item); return;
    case 'repair': repair(s, cmd.p, cmd.item); return;
  }
}

// Advance the game by one tick. Same state + same commands always gives the same result.
export function step(s: GameState, commands: Command[] = []) {
  if (s.over) return;
  for (const c of commands) apply(s, c);
  for (const u of [...s.units]) {   // a copy: units can fall mid-loop
    if (u.hp <= 0) continue;
    u.moving = false;
    if (isRaider(u)) { planRaider(s, u); if (u.hp > 0 && u.queue.length) runOrder(s, u); continue; }
    if (u.role === 'guard') { planGuard(s, u); if (u.queue.length) runOrder(s, u); continue; }
    if (u.boss) bossDefends(s, u);
    if (u.queue.length === 0) {
      if (u.boss) u.status = u.carrying >= 0 ? 'Carrying' : 'Idle';
      else planWorker(s, u);
    }
    if (u.queue.length) runOrder(s, u);
    // A hired hand stuck waiting gives up and re-plans.
    if (!u.boss && u.blocked > 40) clearQueue(s, u);
  }
  tickMachines(s);
  tickCombat(s);
  s.tick++;
  tickEconomy(s);
}
