import { footprint } from '../../data/balance';
import type { ItemKind } from '../../data/balance';
import { GameState, Item, Unit, isFence, isFixture, isRaider, isVehicle, onGround, rectOf } from '../state';

// What stands on each tile. 1 = a fixture nobody walks through; 2 = a fence, which
// stops raiders but not the owner's crew (they use the gates).
export const SOLID = 1, FENCE = 2;

const cache = new WeakMap<GameState, { tick: number; n: number; grid: Uint8Array; ids: Int32Array }>();

/** The occupancy grid for this tick. Rebuilt once a tick; it is cheap next to everything else. */
export function grid(s: GameState) {
  let c = cache.get(s);
  if (c && c.tick === s.tick && c.n === s.items.length) return c;
  if (!c || c.grid.length !== s.size * s.size) c = { tick: 0, n: 0, grid: new Uint8Array(s.size * s.size), ids: new Int32Array(s.size * s.size) };
  c.tick = s.tick; c.n = s.items.length; c.grid.fill(0); c.ids.fill(0);
  for (const it of s.items) {
    if (!onGround(it) || !isFixture(it.kind) || isVehicle(it.kind)) continue; // vehicles move, so they never wall anything in
    const [x0, y0, x1, y1] = rectOf(it), v = isFence(it.kind) ? FENCE : SOLID;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x >= 0 && y >= 0 && x < s.size && y < s.size) { c.grid[y * s.size + x] = v; c.ids[y * s.size + x] = it.id; }
  }
  cache.set(s, c);
  return c;
}

/** Throw the cached grid away after gear is placed, moved or removed mid-tick. */
export function dirty(s: GameState) { const c = cache.get(s); if (c) c.tick = -1; }

/** Can a piece of gear of this kind be set down with its top-left corner on (x, y)? */
export function canPlace(s: GameState, kind: ItemKind | string, x: number, y: number, ignoreId = -1): boolean {
  const [w, h] = footprint(kind), g = grid(s);
  const fixture = isFixture(kind as ItemKind);
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) {
    if (tx < 0 || ty < 0 || tx >= s.size || ty >= s.size) return false;
    const i = ty * s.size + tx;
    if (s.tiles[i].water) return false;
    if (g.grid[i] && g.ids[i] !== ignoreId) return false;
    // Parked machines and loose gear count too: one thing to a square.
    if (fixture) for (const o of s.items) {
      if (o.id === ignoreId || !onGround(o) || (isFixture(o.kind) && !isVehicle(o.kind))) continue;
      const [a, b, c, d] = rectOf(o); if (tx >= a && tx <= c && ty >= b && ty <= d) return false;
    }
  }
  return true;
}

/** Is this tile free for a person to stand on? */
export function standable(s: GameState, x: number, y: number, raider = false): boolean {
  if (x < 0 || y < 0 || x >= s.size || y >= s.size) return false;
  const v = grid(s).grid[y * s.size + x];
  return v === 0 || (v === FENCE && !raider);
}

/** The nearest spot to (x, y) where this kind fits, searching outward in rings. */
export function freeSpot(s: GameState, kind: ItemKind | string, x: number, y: number, maxR = 12): [number, number] | null {
  for (let r = 0; r <= maxR; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    if (canPlace(s, kind, x + dx, y + dy)) return [x + dx, y + dy];
  }
  return null;
}

/** The nearest tile to (x, y) a person can stand on. */
export function freeTile(s: GameState, x: number, y: number, raider = false): [number, number] {
  for (let r = 0; r <= 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    if (standable(s, x + dx, y + dy, raider)) return [x + dx, y + dy];
  }
  return [x, y];
}

const blockedFor = (v: number, raider: boolean) => v === SOLID || (v === FENCE && raider);

/** True when nothing stands on the straight line between two points. The end tiles are always allowed. */
export function lineClear(s: GameState, x0: number, y0: number, x1: number, y1: number, raider: boolean): boolean {
  const g = grid(s).grid, n = s.size, d = Math.hypot(x1 - x0, y1 - y0), steps = Math.ceil(d / 0.3);
  const a = Math.floor(y0) * n + Math.floor(x0), b = Math.floor(y1) * n + Math.floor(x1);
  for (let i = 1; i < steps; i++) {
    const t = i / steps, k = Math.floor(y0 + (y1 - y0) * t) * n + Math.floor(x0 + (x1 - x0) * t);
    if (k !== a && k !== b && blockedFor(g[k], raider)) return false;
  }
  return true;
}

// A* over the tile grid, eight directions, no cutting corners. Scratch arrays are
// shared and stamped per search so nothing is allocated per call.
let gScore = new Float32Array(0), from = new Int32Array(0), stamp = new Int32Array(0), closed = new Uint8Array(0), searchId = 0;
const heap: number[] = [], heapF: number[] = [];
function push(i: number, f: number) {
  let k = heap.length; heap.push(i); heapF.push(f);
  while (k > 0) { const p = (k - 1) >> 1; if (heapF[p] <= f) break; heap[k] = heap[p]; heapF[k] = heapF[p]; k = p; }
  heap[k] = i; heapF[k] = f;
}
function pop(): number {
  const top = heap[0], li = heap.pop()!, lf = heapF.pop()!;
  if (heap.length) {
    let k = 0; const n = heap.length;
    for (;;) { let c = k * 2 + 1; if (c >= n) break; if (c + 1 < n && heapF[c + 1] < heapF[c]) c++; if (heapF[c] >= lf) break; heap[k] = heap[c]; heapF[k] = heapF[c]; k = c; }
    heap[k] = li; heapF[k] = lf;
  }
  return top;
}

/**
 * Shortest route from one tile to another as a list of tile indices (start left out).
 * The goal tile is always enterable, so a hand can step up to the machine it is using.
 * If the goal is walled off, the route leads to the closest tile that can be reached and `reached` is false.
 */
export function findPath(s: GameState, sx: number, sy: number, gx: number, gy: number, raider: boolean, limit = 6000): { path: number[]; reached: boolean } {
  const n = s.size, total = n * n, gr = grid(s), g = gr.grid, ids = gr.ids;
  if (gScore.length !== total) { gScore = new Float32Array(total); from = new Int32Array(total); stamp = new Int32Array(total); closed = new Uint8Array(total); searchId = 0; }
  searchId++; heap.length = 0; heapF.length = 0;
  const start = sy * n + sx, goal = gy * n + gx;
  // Heading for a machine: every tile of it counts as the way in, so any side will do.
  const goalId = g[goal] ? ids[goal] : -1;
  const h = (i: number) => { const dx = Math.abs((i % n) - gx), dy = Math.abs(Math.floor(i / n) - gy); return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy); };
  stamp[start] = searchId; gScore[start] = 0; from[start] = -1; closed[start] = 0; push(start, h(start));
  let best = start, bestH = h(start), seen = 0, found = false;
  while (heap.length && seen++ < limit) {
    const cur = pop();
    if (closed[cur]) continue; closed[cur] = 1;
    if (cur === goal) { found = true; best = cur; break; }
    const hc = h(cur); if (hc < bestH) { bestH = hc; best = cur; }
    const cx = cur % n, cy = (cur - cx) / n;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const i = y * n + x;
      const into = i === goal || ids[i] === goalId;
      if (!into && blockedFor(g[i], raider)) continue;
      if (dx && dy && !into && (blockedFor(g[cy * n + x], raider) || blockedFor(g[y * n + cx], raider))) continue;
      const cost = gScore[cur] + (dx && dy ? 1.4142 : 1);
      if (stamp[i] === searchId && (closed[i] || gScore[i] <= cost)) continue;
      stamp[i] = searchId; closed[i] = 0; gScore[i] = cost; from[i] = cur; push(i, cost + h(i));
    }
  }
  const path: number[] = [];
  for (let i = best; i !== start && i >= 0; i = from[i]) path.push(i);
  path.reverse();
  return { path, reached: found };
}

/**
 * One tick of walking toward (tx, ty) around whatever is in the way. Returns the point to
 * head for this tick, and whether the destination can be reached at all.
 */
export function waypoint(s: GameState, u: Unit, tx: number, ty: number): { x: number; y: number; reached: boolean } {
  const n = s.size, raider = isRaider(u);
  const gx = Math.max(0, Math.min(n - 1, Math.floor(tx))), gy = Math.max(0, Math.min(n - 1, Math.floor(ty))), goal = gy * n + gx;
  if (u.nav && u.nav.goal !== goal) u.nav = null;
  if (!u.nav) {
    if (lineClear(s, u.x, u.y, tx, ty, raider)) return { x: tx, y: ty, reached: true };
    const r = findPath(s, Math.floor(u.x), Math.floor(u.y), gx, gy, raider);
    u.nav = { goal, path: r.path, at: r.reached ? s.tick : -s.tick - 1 };
  }
  const nav = u.nav, ok = nav.at >= 0;
  // Re-plan now and then: gear gets moved, and fences fall.
  if (s.tick - Math.abs(nav.at) > 30) { u.nav = null; return waypoint(s, u, tx, ty); }
  while (nav.path.length) {
    const i = nav.path[0], cx = (i % n) + 0.5, cy = Math.floor(i / n) + 0.5;
    if (Math.hypot(cx - u.x, cy - u.y) < 0.35) nav.path.shift(); else break;
  }
  // Cut the corner when the tile after next is in plain view.
  if (nav.path.length > 1) { const j = nav.path[1]; if (lineClear(s, u.x, u.y, (j % n) + 0.5, Math.floor(j / n) + 0.5, raider) && !blockedFor(grid(s).grid[j], raider)) nav.path.shift(); }
  if (!nav.path.length) { if (ok) u.nav = null; return { x: ok ? tx : u.x, y: ok ? ty : u.y, reached: ok }; }   // a failed search is kept until the next re-plan
  if (nav.path.length === 1 && ok) return { x: tx, y: ty, reached: true };
  const i = nav.path[0];
  return { x: (i % n) + 0.5, y: Math.floor(i / n) + 0.5, reached: ok };
}

/** Distance from a point to the nearest edge of an item's footprint. */
export function distToItem(it: Item, x: number, y: number): number {
  const [x0, y0, x1, y1] = rectOf(it);
  const dx = Math.max(x0 - x, 0, x - (x1 + 1)), dy = Math.max(y0 - y, 0, y - (y1 + 1));
  return Math.hypot(dx, dy);
}
