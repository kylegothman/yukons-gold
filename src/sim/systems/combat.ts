import { ARMORY_BONUS, GUARD_SIGHT, RAID, RAIDER, THIEF, TICKS_PER_DAY, TICKS_PER_SEC, TOWER, UNIT_STATS } from '../../data/balance';
import { newUnit } from '../mapgen';
import { nextRandom } from '../rng';
import { GameState, Item, Unit, centerOf, isFence, isRaider, itemById, onGround, unitById } from '../state';
import { dismount } from './economy';
import { broken } from './machines';
import { dirty, distToItem, freeTile } from './nav';
import { clearQueue, dropCarried } from './orders';

const secs = (n: number) => Math.round(n * TICKS_PER_SEC);
const hasArmory = (s: GameState, owner: number) => s.items.some(i => i.kind === 'armory' && i.owner === owner && !broken(i) && onGround(i));
export const raidersAlive = (s: GameState) => s.units.some(isRaider);
/** Days until the next raid shows up, for the HUD. */
export const daysToRaid = (s: GameState) => Math.max(0, (s.raid.next - s.tick) / TICKS_PER_DAY);

export function hurtUnit(s: GameState, u: Unit, dmg: number) {
  if (u.hp <= 0) return;
  u.hp -= dmg; u.hurt = s.tick;
  s.events.push({ type: 'hit', x: u.x, y: u.y, owner: u.owner });
  if (u.hp > 0) return;
  // Down they go, in a shower of gold sparks. Whatever they held stays on the ground.
  if (u.loot > 0) { s.players[0].cash += u.loot; s.events.push({ type: 'toast', owner: 0, text: `Got back $${Math.round(u.loot).toLocaleString()} from the thief` }); }
  if (!isRaider(u)) { clearQueue(s, u); dropCarried(s, u); dismount(s, u.id); }
  s.units.splice(s.units.indexOf(u), 1);
  s.events.push({ type: 'death', x: u.x, y: u.y, owner: u.owner, text: u.name });
  if (u.boss) s.over = 'dead';
  else if (!isRaider(u)) s.events.push({ type: 'toast', owner: u.owner, text: `${u.name} is down` });
}

export function hurtItem(s: GameState, it: Item, dmg: number) {
  if (it.maxHp <= 0 || it.hp <= 0) return;
  it.hp = Math.max(0, it.hp - dmg);
  const [cx, cy] = centerOf(it);
  s.events.push({ type: 'hit', x: cx, y: cy, owner: it.owner });
  if (it.hp > 0) return;
  s.events.push({ type: 'wreck', x: cx, y: cy, owner: it.owner, text: it.kind });
  // Fences and towers are flattened. Machines are left wrecked until someone pays for repairs.
  if (isFence(it.kind) || it.kind === 'tower' || it.kind === 'armory') { s.items.splice(s.items.indexOf(it), 1); dirty(s); }
  else { it.running = false; const d = unitById(s, it.driver); if (d) dismount(s, d.id); }
}

// Raiders come in from the nearest stretch of map edge to the camp, a few more each time.
function schedule(s: GameState) {
  const r = s.raid;
  if (r.spawnAt < 0 && s.tick >= r.next) {
    const { x, y } = s.spawn, n = s.size, a = nextRandom(s) * Math.PI * 2;
    r.fromX = Math.max(1, Math.min(n - 2, Math.round(x + Math.cos(a) * RAID.edgeDist)));
    r.fromY = Math.max(1, Math.min(n - 2, Math.round(y + Math.sin(a) * RAID.edgeDist)));
    r.spawnAt = s.tick + secs(RAID.warnSec);
    const dx = r.fromX - x, dy = r.fromY - y;
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : (dy > 0 ? 'south' : 'north');
    s.events.push({ type: 'raid', owner: 0, x: r.fromX, y: r.fromY, text: `Raiders! They are coming in from the ${dir}` });
  }
  if (r.spawnAt >= 0 && s.tick >= r.spawnAt) {
    // Raids grow with the season and with how much there is to take. A camp that is
    // still scraping by sees sneak thieves, not a war party.
    const day = s.tick / TICKS_PER_DAY, earned = s.players[0].earned;
    const wealth = Math.floor(Math.log10(Math.max(1000, earned) / 1000) * 2.5);
    const size = Math.min(RAID.maxSize, 1 + wealth + Math.floor((day - RAID.firstDay) / RAID.growEveryDays));
    const bandits = earned < RAID.poorBelow ? 0 : Math.floor(size * 2 / 3);
    for (let i = 0; i < size; i++) {
      const [tx, ty] = freeTile(s, r.fromX + (i % 4) - 1, r.fromY + Math.floor(i / 4), true);
      newUnit(s, RAIDER, tx + 0.5, ty + 0.5, false, i < bandits ? 'bandit' : 'thief');
    }
    r.wave++; r.spawnAt = -1;
    r.next = s.tick + Math.round((RAID.minGapDays + nextRandom(s) * (RAID.maxGapDays - RAID.minGapDays)) * TICKS_PER_DAY);
  }
}

function nearestUnit(s: GameState, x: number, y: number, ok: (u: Unit) => boolean, maxD: number): Unit | undefined {
  let best: Unit | undefined, bd = maxD * maxD;
  for (const o of s.units) { if (!ok(o)) continue; const d = (o.x - x) ** 2 + (o.y - y) ** 2; if (d < bd) { bd = d; best = o; } }
  return best;
}
function nearestItem(s: GameState, x: number, y: number, ok: (i: Item) => boolean): Item | undefined {
  let best: Item | undefined, bd = Infinity;
  for (const i of s.items) { if (i.maxHp <= 0 || i.hp <= 0 || i.owner === RAIDER || !onGround(i) || !ok(i)) continue; const d = distToItem(i, x, y); if (d < bd) { bd = d; best = i; } }
  return best;
}
function goTo(u: Unit, x: number, y: number) {
  const q = u.queue[0];
  if (q && q.t === 'move' && Math.abs(q.x - x) < 0.6 && Math.abs(q.y - y) < 0.6) return;
  u.queue.length = 0; u.queue.push({ t: 'move', x, y });
}
function strike(s: GameState, u: Unit, dmg: number, tu?: Unit, ti?: Item) {
  if (u.cool > 0) return;
  u.cool = secs(UNIT_STATS[u.role].coolSec);
  const [x, y] = tu ? [tu.x, tu.y] : centerOf(ti!);
  if (UNIT_STATS[u.role].range > 2) s.events.push({ type: 'shot', x: u.x, y: u.y, x2: x, y2: y, owner: u.owner });
  if (tu) hurtUnit(s, tu, dmg); else if (ti) hurtItem(s, ti, dmg);
}

/** Decide what a bandit or thief does this tick. Runs before its orders do. */
export function planRaider(s: GameState, u: Unit) {
  const st = UNIT_STATS[u.role];
  if (u.cool > 0) u.cool--;
  if (u.role === 'thief') {
    // In, grab what the strongbox will give, and out the way they came.
    if (u.loot > 0) {
      u.status = 'Running off with your cash';
      const n = s.size, ex = u.x < n - u.x ? 0.3 : n - 0.3, ey = u.y < n - u.y ? 0.3 : n - 0.3;
      const [gx, gy] = Math.min(u.x, n - u.x) < Math.min(u.y, n - u.y) ? [ex, u.y] : [u.x, ey];
      if (Math.min(u.x, u.y, n - u.x, n - u.y) < 0.8) {
        s.events.push({ type: 'toast', owner: 0, text: `A thief got away with $${Math.round(u.loot).toLocaleString()}` });
        s.units.splice(s.units.indexOf(u), 1); return;
      }
      goTo(u, gx, gy); return;
    }
    const cx = s.spawn.x + 0.5, cy = s.spawn.y + 0.5;
    if (Math.hypot(cx - u.x, cy - u.y) > 1.2) { u.status = 'Sneaking to camp'; goTo(u, cx, cy); if (u.blocked > 15) breakIn(s, u); return; }
    u.queue.length = 0; u.status = 'Robbing the strongbox';
    if (++u.workLeft >= secs(THIEF.stealSec)) {
      const pl = s.players[0], take = Math.min(THIEF.max, pl.cash * THIEF.share);
      pl.cash -= take; u.loot = take; u.workLeft = 0;
      s.events.push({ type: 'steal', owner: 0, x: u.x, y: u.y, amount: take, text: `Thief took $${Math.round(take).toLocaleString()}: stop them before they reach the edge!` });
    }
    return;
  }
  // Bandit: anyone close by first, otherwise the nearest thing worth breaking.
  const foe = nearestUnit(s, u.x, u.y, o => !isRaider(o) && o.vehicle < 0, 7);
  if (foe) {
    u.status = 'Attacking ' + foe.name;
    if (Math.hypot(foe.x - u.x, foe.y - u.y) <= st.range) { u.queue.length = 0; strike(s, u, st.dmg, foe); }
    else { goTo(u, foe.x, foe.y); if (u.blocked > 15) breakIn(s, u); }
    return;
  }
  const it = nearestItem(s, u.x, u.y, i => !isFence(i.kind));
  if (it) {
    u.status = 'Wrecking the ' + it.kind;
    if (distToItem(it, u.x, u.y) <= st.range) { u.queue.length = 0; strike(s, u, st.dmg, undefined, it); }
    else { const [cx, cy] = centerOf(it); goTo(u, cx, cy); if (u.blocked > 15) breakIn(s, u); }
    return;
  }
  // Nothing to break: go for the boss wherever he is.
  const boss = s.units.find(o => o.boss);
  if (boss) { if (Math.hypot(boss.x - u.x, boss.y - u.y) <= st.range) strike(s, u, st.dmg, boss); else goTo(u, boss.x, boss.y); }
}

// Walled out: knock down the nearest fence.
function breakIn(s: GameState, u: Unit) {
  const f = nearestItem(s, u.x, u.y, i => isFence(i.kind));
  if (!f || distToItem(f, u.x, u.y) > 14) { u.blocked = 0; u.nav = null; return; }
  u.status = 'Breaking the fence';
  if (distToItem(f, u.x, u.y) <= 1.3) { u.queue.length = 0; strike(s, u, Math.max(6, UNIT_STATS[u.role].dmg), undefined, f); if (f.hp <= 0) { u.blocked = 0; u.nav = null; } }
  else { const [cx, cy] = centerOf(f); goTo(u, cx, cy); }
}

/** Guards hold their post, and go after any raider that comes within sight of it. */
export function planGuard(s: GameState, u: Unit) {
  const st = UNIT_STATS.guard;
  if (u.cool > 0) u.cool--;
  if (!u.post) u.post = { x: u.x, y: u.y };
  const ordered = u.queue.length > 0 && u.target < 0;   // walking somewhere on the player's say-so
  const foe = nearestUnit(s, u.x, u.y, isRaider, ordered ? st.range : GUARD_SIGHT);
  if (!foe) {
    if (u.target >= 0) { u.target = -1; goTo(u, u.post.x, u.post.y); }
    if (!u.queue.length) u.status = 'On guard';
    return;
  }
  const d = Math.hypot(foe.x - u.x, foe.y - u.y);
  if (d <= st.range) {
    if (!ordered) u.queue.length = 0;
    u.status = 'Firing'; u.target = foe.id;
    strike(s, u, st.dmg * (hasArmory(s, u.owner) ? ARMORY_BONUS : 1), foe);
  } else if (!ordered) { u.status = 'Chasing raiders'; u.target = foe.id; goTo(u, foe.x, foe.y); }
}

/** Yukon swings back at anything in arm's reach. */
export function bossDefends(s: GameState, u: Unit) {
  if (u.cool > 0) { u.cool--; return; }
  const st = UNIT_STATS.boss, foe = nearestUnit(s, u.x, u.y, isRaider, st.range);
  if (foe) strike(s, u, st.dmg, foe);
}

export function tickCombat(s: GameState) {
  schedule(s);
  const any = raidersAlive(s);
  for (const it of s.items) {
    if (it.kind !== 'tower' || !onGround(it)) continue;
    if (it.timer > 0) { it.timer--; continue; }
    if (!any) continue;
    const [cx, cy] = centerOf(it), foe = nearestUnit(s, cx, cy, isRaider, TOWER.range);
    if (!foe) continue;
    it.timer = secs(TOWER.coolSec);
    s.events.push({ type: 'shot', x: cx, y: cy, x2: foe.x, y2: foe.y, owner: it.owner });
    hurtUnit(s, foe, TOWER.dmg * (hasArmory(s, it.owner) ? ARMORY_BONUS : 1));
  }
  // Out of a fight, everyone gets their wind back.
  if (s.tick % TICKS_PER_SEC === 0) for (const u of s.units) if (!isRaider(u) && u.hp < u.maxHp && s.tick - u.hurt > secs(8)) u.hp = Math.min(u.maxHp, u.hp + 2);
}
